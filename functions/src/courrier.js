'use strict';
/*
 * Guild Legends — le courrier des contrats (9 nov. 2026, demande de Théo).
 *
 * « Quand le héros est arrivé, on reçoit une lettre plus tard pour dire qu'il ou elle est arrivé·e. Il faut calculer le temps
 *   à vol d'oiseau pour l'arrivée du courrier au repère. C'est le représentant sur place de l'organisme qui nous écrit :
 *   l'heure d'arrivée, l'état moral, ce que fait le héros, puis une nouvelle missive à l'issue de la mission. »
 *
 * Les phrases sont écrites à la main (catalogue/vie/lettres/mission.txt). Ce module choisit, pour chaque fait (l'heure,
 * le moral, la forme, le caractère, l'issue, la notoriété de la guilde, les blessures), la phrase qui lui correspond.
 */
const fs = require('node:fs');
const path = require('node:path');
const Q = require('./quetes');
const { finir } = require('./langue');

// La missive vole en ligne droite, sans relais ni bateau : environ trois fois plus vite que les héros sur la route.
const volOiseau = aller => Math.max(1, Math.round((aller || 3) / 3));

let MODELES = null;
function modeles() {
  if (MODELES) return MODELES;
  MODELES = {};
  const f = path.join(require('./chemins'), 'vie/lettres/mission.txt');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue;
      const [cle, variante, ...t] = l.split('|');
      ((MODELES[cle] ||= {})[variante] ||= []).push(t.join('|').trim());
    }
  } catch { /* catalogue absent : pas de courrier */ }
  return MODELES;
}
// Choix stable : la même situation donne la même phrase, deux situations voisines des phrases différentes.
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const une = (liste, graine) => (liste?.length ? liste[hash(graine) % liste.length] : null);
// Avec la guilde : une phrase déjà lue par cette guilde dans le mois ne revient pas tant qu'il en reste d'autres.
const UN_MOIS = 24 * 30;
function phrase(cle, variante, graine, g) {
  const L = modeles()[cle]?.[variante]; if (!L?.length) return null;
  if (!g) return une(L, graine);
  g.usage ||= {};
  const neuves = L.filter(x => g.usage[`C:${x}`] == null || g.t - g.usage[`C:${x}`] >= UN_MOIS);
  const pool = neuves.length ? neuves : [...L].sort((a, b) => g.usage[`C:${a}`] - g.usage[`C:${b}`]).slice(0, 1);
  const x = une(pool, graine); g.usage[`C:${x}`] = g.t; return x;
}
let VOIX = null;
const voix = (h, sit) => (VOIX ||= require('./scenes').lireRepliques())[h.champion]?.[sit] || [];

const h24 = h => (h === 0 ? 'minuit' : h === 12 ? 'midi' : `${h} h`);
const heureTxt = (V, t) => h24(V.heureLocale(t));
const moment = h => (h >= 22 || h < 6 ? 'nuit' : h < 12 ? 'matin' : h < 18 ? 'jour' : 'soir');
const SIGNATAIRES_F = /correspondante/;
const listeNoms = n => (n.length <= 1 ? n[0] || '' : `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}`);
const dans = (V, t, depuis) => { const d = Math.max(1, Math.round(t - depuis)); return `dans ${d} h, vers ${h24(V.heureLocale(t))}`; };

function remplir(g, texte, x) {
  const signataire = x.signataire || '';
  return texte
    .replace(/\{maitre\}/g, g.maitre?.titre === 'maîtresse' ? 'Maîtresse' : 'Maître')
    .replace(/\{e\}/g, g.maitre?.titre === 'maîtresse' ? 'e' : '')
    .replace(/\{je_e\}/g, SIGNATAIRES_F.test(signataire) ? 'e' : '')
    .replace(/\{noms\}/g, x.noms || '').replace(/\{nom\}/g, x.nom || '')
    .replace(/\{(a|de|vers)_lieu\}/g, (_, p) => Q.avecPreposition(x.lieu || 'là-bas', p)).replace(/\{lieu\}/g, x.lieu || '')
    .replace(/\{heure\}/g, x.heure || '').replace(/\{retour\}/g, x.retour || '').replace(/\{mission\}/g, x.mission || '')
    .replace(/\{guilde\}/g, g.nom || '');
}
function signer(g, region, corps, x) {
  const sig = phrase('signataire', region, region) || 'Le correspondant de la Chambre des Bannières';
  const graine = `${x.lieu}#${corps.length}`, fin = phrase('signature', '*', graine, g) || '';
  const intro = remplir(g, phrase('intro', '*', graine, g) || 'Une lettre de la Chambre des Bannières arrive par la voie des airs, envoyée {de_lieu}.', x);
  return finir(`${intro} « ${remplir(g, corps, { ...x, signataire: sig })} » ${fin} ${sig}.`);
}

/*
 * Lettre d'arrivée : écrite par le correspondant au moment où les héros arrivent, reçue au repère après le vol de l'oiseau.
 * heros : objets héros de la guilde ; tArrivee : heure (monde) d'arrivée sur place.
 */
function lettreArrivee(g, heros, mission, tArrivee, V) {
  const h0 = heros[0], plur = heros.length > 1, h = V.heureLocale(tArrivee), graine = `${mission.id}#${g.id}`;
  const base = { noms: listeNoms(heros.map(x => x.nom)), nom: h0.nom, lieu: mission.lieu, heure: heureTxt(V, tArrivee), mission: mission.titre };
  const parties = [phrase('entete', `${moment(h)}:${plur ? 'n' : '1'}`, graine, g)];
  // Une phrase par héros, pas trois : la première fois qu'un héros passe chez ce correspondant, son portrait (écrit pour
  // ce champion) ; ensuite, sa forme s'il est fatigué ou blessé, sinon son humeur. L'activité, seulement s'il est seul.
  for (const x of heros) {
    g.usage ||= {};
    const portrait = !g.usage[`P:${x.id}`] && voix(x, 'correspondant')[0];
    if (portrait) { g.usage[`P:${x.id}`] = g.t; parties.push(finir(portrait.replace(/\{nom\}/g, x.nom))); continue; }
    const band = x.moral >= 70 ? 'haut' : x.moral < 45 ? 'bas' : 'moyen';
    if ((x.besoins?.energie ?? 60) < 35) parties.push(remplir(g, phrase('forme', 'fatigue', `${graine}#${x.id}#f`, g) || '', { nom: x.nom }));
    else if (x.blesse) parties.push(remplir(g, phrase('forme', 'blessure', `${graine}#${x.id}#b`, g) || '', { nom: x.nom }));
    else parties.push(remplir(g, phrase('moral', band, `${graine}#${x.id}`, g) || '', { nom: x.nom }));
    const trait = (x.traits || []).find(t => modeles().activite?.[t]);
    if (!plur) parties.push(remplir(g, phrase('activite', trait || '*', `${graine}#${x.id}#a`, g) || '', { nom: x.nom }));
  }
  parties.push(phrase('fin', plur ? 'n' : '1', graine, g));
  return signer(g, mission.region, parties.filter(Boolean).join(' '), base);
}

/*
 * Lettre d'issue : le résultat, les blessures, l'heure du départ et l'arrivée prévue de chacun.
 * res : { issue, blessures: [{ nom, niveau }], morts: [noms] } ; retours : { [heroId]: t } ; tFin : fin du travail sur place.
 * Une mort fait l'objet d'une lettre à part, écrite avant les autres nouvelles.
 */
function lettresIssue(g, heros, mission, res, tFin, retours, V, { connue = false } = {}) {
  const graine = `${mission.id}#${g.id}#issue`, out = [];
  const sig = phrase('signataire', mission.region, mission.region) || '';
  const morts = heros.filter(x => (res.morts || []).includes(x.nom));
  for (const m of morts) out.push(signer(g, mission.region, phrase('mort', '1', `${graine}#${m.id}`, g), { nom: m.nom, lieu: mission.lieu, mission: mission.titre, signataire: sig }));
  const vivants = heros.filter(x => !morts.includes(x));
  const parties = [phrase('issue', `${res.issue}:${connue ? 'connue' : 'inconnue'}`, graine, g) || phrase('issue', `${res.issue}:*`, graine, g)];
  for (const x of vivants) {
    const b = (res.blessures || []).find(y => y.nom === x.nom);
    if (b) parties.push(remplir(g, phrase('blessure', b.niveau === 'grave' ? 'grave' : 'legere', `${graine}#${x.id}`, g) || '', { nom: x.nom, retour: dans(V, retours[x.id], tFin), signataire: sig }));
  }
  // Le départ : ceux qui rentrent ensemble partent à la même heure.
  const parRetour = {};
  for (const x of vivants) (parRetour[retours[x.id]] ||= []).push(x);
  for (const [tr, groupe] of Object.entries(parRetour)) {
    if (groupe.every(x => (res.blessures || []).find(y => y.nom === x.nom && y.niveau === 'grave'))) continue;   // déjà dit avec la blessure
    parties.push(remplir(g, phrase('depart', groupe.length > 1 ? 'n' : '1', graine, g) || '', { nom: groupe[0].nom, noms: listeNoms(groupe.map(x => x.nom)), lieu: mission.lieu, heure: heureTxt(V, tFin), retour: dans(V, +tr, tFin) }));
  }
  if (vivants.length) out.push(signer(g, mission.region, parties.filter(Boolean).join(' '), { mission: mission.titre, lieu: mission.lieu, signataire: sig }));
  return out;
}

module.exports = { volOiseau, lettreArrivee, lettresIssue, modeles };
