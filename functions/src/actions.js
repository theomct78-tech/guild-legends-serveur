'use strict';
/*
 * Guild Legends — les actions de guilde et les gestes envers un héros (10 nov. 2026, demandes de Théo).
 *
 * « 100+ actions de guilde : banquet, jeu, compétition, sortie… certaines coûteuses, d'autres longues à préparer. »
 * « Plusieurs activités quand on clique sur un héros, adaptées à l'endroit où il se trouve dans le repère. »
 *
 * Les textes sont écrits à la main (catalogue/actions/guilde.txt, catalogue/vie/gestes.txt). Ce module gère l'argent,
 * les délais et les effets ; les héros jugent chaque geste selon leur caractère (maitre.js).
 */
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vie');
const { finir } = require('./langue');
const RACINE = require('./chemins');

const PARAMS = {
  // Le coût écrit vaut pour le palier Inconnue ; il suit ensuite le revenu d'une guilde (economie.js).
  cout: { inconnue: 1, locale: 5, regionale: 15, renommee: 45, legendaire: 150 },
  enPreparationMax: 2, delaiMemeAction: 24 * 7, souvenir: 48,
  geste: { delai: 4, souvenir: 24 },
};
const BESOINS = { s: 'social', l: 'loisir', e: 'elan', n: 'energie' };
const CATEGORIES = { table: 'À table', jeux: 'Jeux', concours: 'Concours et défis', sortie: 'Sorties', fete: 'Fêtes', travail: 'Entraînement et travail', calme: 'Au calme', bourg: 'Pour le bourg' };

const lignes = f => { try { return fs.readFileSync(path.join(RACINE, f), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|')); } catch { return []; } };
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const effets = s => Object.fromEntries((s || '').trim().split(/\s+/).filter(Boolean).map(x => [x[0], Number(x.slice(1))]));
const borne = v => Math.max(0, Math.min(100, v));

let ACT = null, GES = null;
const catalogue = () => (ACT ||= lignes('actions/guilde.txt').map(([id, cat, titre, cout, prepa, ton, ef, ...r]) => ({ id, cat, titre, cout: +cout, prepa: +prepa, ton, effets: effets(ef), recit: r.join('|').trim() })));
function gestes() {
  if (GES) return GES;
  GES = { fait: [], geste: [] };
  for (const l of lignes('vie/gestes.txt')) {
    if (l[0] === 'fait') GES.fait.push({ lieux: l[1].split(','), act: l[2], texte: l.slice(3).join('|').trim() });
    else if (l[0] === 'geste') GES.geste.push({ lieux: l[1].split(','), id: l[2], libelle: l[3], effets: effets(l[4]), recit: l.slice(5).join('|').trim() });
  }
  return GES;
}
function appliquer(h, ef) { for (const [k, v] of Object.entries(ef)) if (BESOINS[k] && h.besoins) h.besoins[BESOINS[k]] = borne(h.besoins[BESOINS[k]] + v); }
const effetsEnMots = ef => [ef.m > 0 && 'moral', ef.s > 0 && 'liens', ef.l > 0 && 'détente', ef.e > 0 && 'envie de progresser', ef.n > 0 && 'repos', ef.r > 0 && 'réputation'].filter(Boolean)
  .concat([ef.n < 0 && 'fatigue'].filter(Boolean).map(x => `− ${x}`));

/* ---------- Actions de guilde ---------- */
const prix = (a, palier) => Math.round(a.cout * (PARAMS.cout[palier] || 1));
function listeActions(g, palier) {
  const prevues = new Set((g.actionsPrevues || []).map(a => a.id));
  return catalogue().map(a => { const c = prix(a, palier), dernier = g.actionsFaites?.[a.id];
    const attente = dernier != null ? Math.max(0, dernier + PARAMS.delaiMemeAction - g.t) : 0;
    return { id: a.id, cat: a.cat, titre: a.titre, cout: c, prepa: a.prepa, apporte: effetsEnMots(a.effets), enCours: prevues.has(a.id), attente,
      possible: !prevues.has(a.id) && !attente && (g.po || 0) >= c }; });
}
function lancerAction(g, id, palier, juger) {
  const a = catalogue().find(x => x.id === id); if (!a) throw new Error('Action inconnue.');
  g.actionsPrevues ||= []; g.actionsFaites ||= {};
  if (g.actionsPrevues.some(x => x.id === id)) throw new Error(`« ${a.titre} » est déjà en préparation.`);
  if (g.actionsPrevues.length >= PARAMS.enPreparationMax) throw new Error(`Le repère prépare déjà ${PARAMS.enPreparationMax} choses à la fois : attends que l'une d'elles ait eu lieu.`);
  const dernier = g.actionsFaites[id];
  if (dernier != null && g.t - dernier < PARAMS.delaiMemeAction) throw new Error(`« ${a.titre} » a eu lieu il y a peu : laisse passer une semaine.`);
  const c = prix(a, palier); if ((g.po || 0) < c) throw new Error(`Il manque ${c - (g.po || 0)} PO.`);
  g.po -= c;
  if (!a.prepa) return { ...executer(g, a, juger), cout: c, prepa: 0 };
  g.actionsPrevues.push({ id, t: g.t + a.prepa });
  g.chronique.push({ t: g.t, lieu: 'salle_commune', importance: 2, declencheur: 'action', heros: [],
    texte: `C'est écrit à la craie sur le tableau de la salle commune : « ${a.titre} », ${a.prepa >= 48 ? `dans ${Math.round(a.prepa / 24)} jours` : a.prepa >= 24 ? 'demain' : `dans ${a.prepa} h`}. Le repère en parle déjà.` });
  return { cout: c, prepa: a.prepa };
}
function executer(g, a, juger) {
  const presents = g.heros.filter(h => h.etat === 'present');
  g.actionsFaites[a.id] = g.t;
  if (!presents.length) { g.chronique.push({ t: g.t, lieu: null, importance: 1, declencheur: 'action', heros: [], texte: `« ${a.titre} » était prévu aujourd'hui, mais le repère est vide. Ce sera pour une autre fois.` }); return { lignes: [], recit: null }; }
  const i = hash(`${g.id}#${a.id}#${g.t}`) % presents.length, un = presents[i], deux = presents.length > 1 ? presents[(i + 1 + hash(a.id) % (presents.length - 1)) % presents.length] : null;
  // Sans second héros au repère, on ne garde que les phrases qui ne parlent pas de lui.
  let recit = deux ? a.recit : a.recit.split(/(?<=[.!?»])\s+/).filter(p => !p.includes('{deux}')).join(' ');
  recit = finir(recit.replace(/\{un\}/g, un.nom).replace(/\{deux\}/g, deux?.nom || '').replace(/\{chien\}/g, g.monde.chien).replace(/\{bourg\}/g, g.monde.bourg));
  for (const h of presents) { if (a.effets.m) V.souvenir(h, g.t, a.effets.m, a.titre, PARAMS.souvenir); appliquer(h, a.effets); }
  if (a.effets.r) g.reputation = (g.reputation || 0) + a.effets.r;
  const lignes = juger ? juger(g, a.ton, presents.map(h => ({ h, poids: 0.4 })), a.titre.toLowerCase()) : [];
  g.chronique.push({ t: g.t, lieu: a.cat === 'sortie' || a.cat === 'bourg' ? 'ville' : 'salle_commune', importance: 3, declencheur: 'action', heros: [un.id, deux?.id].filter(Boolean), titreArc: a.titre, texte: recit });
  return { lignes, recit };
}
/* À chaque créneau : ce qui était prévu a lieu. Rend true si la réputation a bougé. */
function avancerActions(g, juger) {
  if (!g.actionsPrevues?.length) return false;
  const dues = g.actionsPrevues.filter(a => a.t <= g.t); g.actionsPrevues = g.actionsPrevues.filter(a => a.t > g.t);
  let rep = false;
  for (const d of dues) { const a = catalogue().find(x => x.id === d.id); if (a) { executer(g, a, juger); rep ||= Boolean(a.effets.r); } }
  return rep;
}
const actionsPrevues = g => (g.actionsPrevues || []).map(p => ({ id: p.id, titre: catalogue().find(a => a.id === p.id)?.titre || p.id, dans: Math.max(0, p.t - g.t) }));

/* ---------- Toucher un héros : ce qu'il fait, ce qu'on peut lui proposer ici ---------- */
function ceQueFait(g, h) {
  if (h.etat !== 'present' || !h.lieu) return null;
  const L = gestes().fait.filter(f => f.lieux.includes(h.lieu)), precis = L.filter(f => f.act === h.activite), c = precis.length ? precis : L.filter(f => f.act === '*');
  if (!c.length) return null;
  return finir(c[hash(`${h.id}#${g.t}`) % c.length].texte.replace(/\{nom\}/g, h.nom).replace(/\{chien\}/g, g.monde.chien).replace(/\{bourg\}/g, g.monde.bourg));
}
function gestesPour(g, h) {
  if (h.etat !== 'present' || !h.lieu || h.activite === 'dormir' && !['dortoirs'].includes(h.lieu)) return [];
  const attente = Math.max(0, (h.dernierGeste ?? -1e9) + PARAMS.geste.delai - g.t);
  return gestes().geste.filter(x => x.lieux.includes(h.lieu)).map(x => ({ id: x.id, libelle: x.libelle.replace(/\{chien\}/g, g.monde.chien).replace(/\{nom\}/g, h.nom), apporte: effetsEnMots(x.effets), attente }));
}
function faireGeste(g, heroId, id) {
  const h = g.heros.find(x => x.id === heroId); if (!h || h.etat !== 'present') throw new Error(`${h?.nom || 'Ce héros'} n'est pas au repère.`);
  const x = gestes().geste.find(k => k.id === id && k.lieux.includes(h.lieu)); if (!x) throw new Error(`${h.nom} n'est plus au même endroit.`);
  if (g.t - (h.dernierGeste ?? -1e9) < PARAMS.geste.delai) throw new Error(`Laisse un peu ${h.nom} tranquille : tu viens de passer un moment ensemble.`);
  h.dernierGeste = g.t;
  if (x.effets.m) V.souvenir(h, g.t, x.effets.m, 'Un moment avec toi', PARAMS.geste.souvenir);
  appliquer(h, x.effets);
  const texte = finir(V.MA.accorder(g, x.recit).replace(/\{nom\}/g, h.nom).replace(/\{chien\}/g, g.monde.chien).replace(/\{bourg\}/g, g.monde.bourg));
  g.chronique.push({ t: g.t, lieu: h.lieu, importance: 2, declencheur: 'geste', heros: [h.id], texte });
  return { texte };
}

module.exports = { PARAMS, CATEGORIES, catalogue, gestes, listeActions, lancerAction, avancerActions, actionsPrevues, ceQueFait, gestesPour, faireGeste };
