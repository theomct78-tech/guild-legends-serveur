'use strict';
/*
 * Charlie, au comptoir du repère (11 nov. 2026, demande de Théo).
 *
 * « C'est elle qui sert l'alcool dans la guilde, elle s'occupe de tout et tout le monde. Tout le monde l'aime.
 *   Elle nous parle des héros, du repère. » Charlie a l'apparence d'un homme pour une maîtresse de guilde, d'une femme
 *   pour un maître.
 *
 * Charlie observe la guilde à chaque créneau et ne parle que quand il y a du neuf :
 * - le moral d'un héros franchit un seuil (avec une marge, pour ne pas commenter chaque oscillation) ;
 * - un besoin tombe très bas (énergie, compagnie, loisir, élan), ou le salaire est loin des attentes, ou une blessure ;
 * - une pièce est ouverte au rang du repère et le coffre suffit pour la construire.
 * Les textes sont écrits à la main (catalogue/vie/charlie.txt), choisis d'après ces faits ; parmi les variantes d'une
 * situation, la moins récemment dite.
 */
const fs = require('node:fs');
const path = require('node:path');
const CATALOGUE = require('./chemins');
const V = require('./vie');
const RP = require('./repere');

const PARAMS = {
  // Moral : trois états, avec une marge à la sortie (hystérésis).
  bas: 33, sortieBas: 42, haut: 65, sortieHaut: 56,
  besoin: 20,              // un besoin sous ce seuil mérite un mot
  salaire: 0.85,           // salaire / attentes sous ce ratio
  delaiHeros: 48,          // heures entre deux remarques sur le même héros
  delaiBesoin: 96,         // heures avant de reparler du même besoin pour le même héros
  delaiSalle: 120,         // heures avant de reparler de la même pièce
  parJour: 2,              // remarques au plus par jour
  ecart: 6,                // heures au moins entre deux remarques
  heures: [8, 22],         // Charlie parle de jour
  conserver: 30,
};

let textes = null;
function catalogue() {
  if (textes) return textes;
  textes = {};
  const brut = fs.readFileSync(path.join(CATALOGUE, 'vie', 'charlie.txt'), 'utf8');
  for (const l of brut.split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue;
    const i = l.indexOf('|'); if (i < 0) continue;
    (textes[l.slice(0, i)] ||= []).push(l.slice(i + 1).trim());
  }
  return textes;
}

const hash = s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
const patron = g => (g.maitre?.titre === 'maîtresse' ? 'patronne' : 'patron');
const minuscule = s => s ? s[0].toLowerCase() + s.slice(1) : s;

function etat(g) { const c = (g.charlie ||= { notes: [], moral: {}, dit: {}, usage: {} }); c.attente ||= {}; return c; }

/* La variante la moins récemment dite pour cette situation (à égalité, d'après le jour et le héros). */
function choisir(g, cle, graine) {
  const T = catalogue(), liste = T[cle] || [], c = etat(g);
  if (!liste.length) return null;
  const ordre = liste.map((texte, i) => ({ i, texte, vu: c.usage[`${cle}#${i}`] ?? -1e9, h: hash(`${graine}#${i}`) }))
    .sort((a, b) => a.vu - b.vu || a.h - b.h);
  return ordre[0];
}

function remplir(g, texte, { h = null, salle = null } = {}) {
  const p = patron(g);
  return texte
    .replace(/\{h\}/g, h?.nom || '')
    .replace(/\{patron\}/g, p).replace(/\{Patron\}/g, p[0].toUpperCase() + p.slice(1))
    .replace(/\{chien\}/g, g.monde?.chien || 'le chien')
    .replace(/\{salle\}/g, salle ? minuscule(salle.nom) : '')
    .replace(/\{prix\}/g, salle ? salle.prix.toLocaleString('fr-FR') : '');
}

function noter(g, cle, graine, { h = null, salle = null, action = null } = {}) {
  const c = etat(g), x = choisir(g, cle, graine); if (!x) return null;
  c.usage[`${cle}#${x.i}`] = g.t;
  const note = { id: `c${g.t}-${c.notes.length}-${hash(cle + graine) % 1000}`, t: g.t, cle, texte: remplir(g, x.texte, { h, salle }), heros: h?.id || null, salle: salle?.cle || null, action };
  c.notes.unshift(note); c.notes.length = Math.min(c.notes.length, PARAMS.conserver);
  return note;
}

const etatMoral = (m, avant) => {
  if (avant === 'bas') return m > PARAMS.sortieBas ? (m >= PARAMS.haut ? 'haut' : 'moyen') : 'bas';
  if (avant === 'haut') return m < PARAMS.sortieHaut ? (m < PARAMS.bas ? 'bas' : 'moyen') : 'haut';
  return m < PARAMS.bas ? 'bas' : m >= PARAMS.haut ? 'haut' : 'moyen';
};

/* Ce que Charlie a envie de dire maintenant, par ordre d'importance (sans encore rien noter). */
function aDire(g) {
  const c = etat(g), out = [];
  const recent = (cle, delai) => c.dit[cle] != null && g.t - c.dit[cle] < delai;
  for (const h of g.heros) {
    if (['parti', 'mort'].includes(h.etat)) continue;
    const avant = c.moral[h.id], maintenant = etatMoral(h.moral, avant);
    c.moral[h.id] = maintenant;
    if (avant === undefined) continue;                              // on fait connaissance
    // Un changement d'humeur reste en attente un jour : Charlie en parle au premier moment possible (de jour, héros présent).
    if (maintenant !== avant) {
      const cle = maintenant === 'bas' ? 'triste' : avant === 'bas' ? 'mieux' : maintenant === 'haut' ? 'heureux' : null;
      if (cle) c.attente[h.id] = { cle, p: { triste: 10, mieux: 7, heureux: 4 }[cle], t: g.t }; else delete c.attente[h.id];
    }
    const at = c.attente[h.id];
    if (at && g.t - at.t >= 24) delete c.attente[h.id];
    if (h.etat !== 'present') continue;
    if (c.attente[h.id]) out.push({ p: at.p, cle: at.cle, h, humeur: true });
    const ici = recent(`h:${h.id}`, PARAMS.delaiHeros);
    if (ici) continue;
    const b = h.besoins || {};
    const besoin = (k, cle, p) => { if (b[k] < PARAMS.besoin && !recent(`b:${h.id}:${cle}`, PARAMS.delaiBesoin)) out.push({ p, cle, h, besoin: true }); };
    if (h.blesse && !recent(`b:${h.id}:blesse`, PARAMS.delaiBesoin * 2)) out.push({ p: 8, cle: 'blesse', h, besoin: true });
    if (!V.enRepos(g, h)) besoin('energie', 'fatigue', 6);
    besoin('social', 'seul', 5); besoin('loisir', 'ennui', 5); besoin('elan', 'stagne', 4);
    if (h.salaire != null && h.attente && h.salaire / h.attente < PARAMS.salaire && !recent(`b:${h.id}:salaire`, PARAMS.delaiBesoin * 2)) out.push({ p: 5, cle: 'salaire', h, besoin: true });
  }
  for (const s of RP.etatSalles(g)) {
    if (s.etat !== 'disponible' || (g.po || 0) < s.prix || recent(`s:${s.cle}`, PARAMS.delaiSalle)) continue;
    out.push({ p: 3, cle: `construire:${s.cle}`, salle: s });
  }
  return out.sort((a, b) => b.p - a.p);
}

/* À chaque créneau : Charlie regarde la guilde, et dit au plus une chose. */
function observer(g, heure) {
  const c = etat(g), envies = aDire(g);
  if (heure < PARAMS.heures[0] || heure >= PARAMS.heures[1] || !envies.length) return null;
  if (c.notes.filter(n => g.t - n.t < 24).length >= PARAMS.parJour || (c.notes[0] && g.t - c.notes[0].t < PARAMS.ecart)) return null;
  const e = envies.find(x => !x.h || x.humeur || !(c.dit[`h:${x.h.id}`] != null && g.t - c.dit[`h:${x.h.id}`] < PARAMS.delaiHeros)) || null;
  if (!e) return null;
  const action = e.salle ? { type: 'salle', salle: e.salle.cle } : e.cle === 'fatigue' ? { type: 'conges', heros: e.h.id } : { type: 'fiche', heros: e.h.id };
  const note = noter(g, e.cle, `${g.id}#${e.h?.id || e.salle?.cle}#${Math.floor(g.t / 24)}`, { h: e.h, salle: e.salle, action });
  if (!note) return null;
  if (e.h) { c.dit[`h:${e.h.id}`] = g.t; if (e.humeur) delete c.attente[e.h.id]; }
  if (e.besoin) c.dit[`b:${e.h.id}:${e.cle}`] = g.t;
  if (e.salle) c.dit[`s:${e.salle.cle}`] = g.t;
  return note;
}

/* Quand il n'y a rien de neuf : une phrase sur le moment, choisie d'après la situation (sans la retenir). */
function calme(g, heure) {
  const ici = g.heros.filter(h => !['parti', 'mort'].includes(h.etat));
  let cle;
  if (!ici.length) cle = 'calme_vide';
  else if (ici.filter(h => h.etat !== 'present').length * 2 >= ici.length) cle = 'calme_mission';
  else if (ici.reduce((s, h) => s + h.moral, 0) / ici.length >= 62) cle = 'calme_contents';
  else if (heure < 12) cle = 'calme_matin';
  else if (heure >= 18) cle = 'calme_soir';
  else cle = 'calme_jour';
  const liste = catalogue()[cle] || [];
  const i = hash(`${g.id}#${cle}#${Math.floor(g.t / 6)}`) % liste.length;
  return remplir(g, liste[i] || '');
}

/* Ce que la vue montre de Charlie. */
function vue(g, heure) {
  const c = etat(g);
  return {
    apparence: g.maitre?.titre === 'maîtresse' ? 'homme' : 'femme',
    notes: c.notes.slice(0, 8).map(({ id, t, texte, action }) => ({ id, t, texte, action })),
    calme: calme(g, heure),
  };
}

module.exports = { PARAMS, observer, aDire, vue, calme, catalogue, etatMoral };
