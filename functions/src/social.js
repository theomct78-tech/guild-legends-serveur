'use strict';
/*
 * Guild Legends — ce qui se passe entre les gens (10 nov. 2026, demandes de Théo).
 *
 *  - L'entente : deux héros qui ont mené un contrat ensemble (même guilde ou non) en gardent une bonne ou une mauvaise
 *    impression, qui pèse quelques % sur leur prochaine collaboration.
 *  - Les lettres entre héros de guildes différentes, relayées par les maîtres (pure immersion).
 *  - Les missives entre maîtres de guilde, qui voyagent par la voie des airs.
 *  - Le courrier des habitants du bourg (pure immersion : aucune dette n'est prélevée).
 *
 * Tous les textes sont écrits à la main (catalogue/vie/lettres/heros.txt, habitants.txt) ; ce module choisit, il n'invente pas.
 */
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vie'), M = require('./missions'), Q = require('./quetes');
const { finir } = require('./langue');
const RACINE = require('./chemins');

const PARAMS = {
  entente: { issue: { eclatante: 1.5, reussite: 0.5, partielle: -0.5, echec: -1.5 }, fort: 2.5, leger: 1, pctFort: 4, pctLeger: 2, plafond: 8, duree: 24 * 60 },
  missives: { longueur: 400, enVolMax: 3, conserver: 40 },
  habitants: { heure: 10, chance: 0.55, poids: { duo: 4, champion: 2, trait: 1.2, tous: 0.6 } },
};

function lignes(f) { try { return fs.readFileSync(path.join(RACINE, f), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|')); } catch { return []; } }
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const volEntre = (a, b) => { try { return Math.max(2, Math.ceil(M.dureeTrajet(a, b) / 3 / 2) * 2); } catch { return 6; } };

/* ---------- Entente ---------- */
const cleEntente = (a, b) => [a, b].sort().join('~');
/* Après un contrat : ce que chaque paire de héros retient de l'autre. equipe : [{ h, g }] ; rend les ententes marquées. */
function noterEntentes(monde, equipe, mission, issue) {
  const E = PARAMS.entente, out = []; monde.ententes ||= {};
  for (let i = 0; i < equipe.length; i++) for (let j = i + 1; j < equipe.length; j++) {
    const a = equipe[i], b = equipe[j], s = V.compatibilite(a.h, b.h) / 10 + (E.issue[issue] || 0);
    const v = s >= E.fort ? E.pctFort : s >= E.leger ? E.pctLeger : s <= -E.fort ? -E.pctFort : s <= -E.leger ? -E.pctLeger : 0;
    const cle = cleEntente(a.h.cle, b.h.cle);
    if (!v) { delete monde.ententes[cle]; continue; }
    monde.ententes[cle] = { v, t: monde.t, mission: mission.titre, lieu: mission.lieu, noms: { [a.h.cle]: a.h.nom, [b.h.cle]: b.h.nom }, guildes: { [a.h.cle]: a.g.id, [b.h.cle]: b.g.id } };
    out.push({ a, b, v });
  }
  return out;
}
/* Bonus ou malus (en points de %) d'une équipe, d'après les ententes de ses paires. */
function bonusEntente(monde, cles) {
  let s = 0; const E = monde.ententes || {};
  for (let i = 0; i < cles.length; i++) for (let j = i + 1; j < cles.length; j++) { const e = E[cleEntente(cles[i], cles[j])]; if (e && monde.t - e.t < PARAMS.entente.duree) s += e.v; }
  return Math.max(-PARAMS.entente.plafond, Math.min(PARAMS.entente.plafond, s));
}
function ententesDe(monde, h) {
  return Object.entries(monde.ententes || {}).filter(([k, e]) => k.split('~').includes(h.cle) && monde.t - e.t < PARAMS.entente.duree).map(([k, e]) => {
    const autre = k.split('~').find(c => c !== h.cle) ?? h.cle;
    return { avec: e.noms[autre], guilde: e.guildes[autre], v: e.v, mission: e.mission };
  });
}

/* ---------- Lettres entre héros ---------- */
let LH = null;
const lettresHeros = () => (LH ||= lignes('vie/lettres/heros.txt').reduce((o, [reg, ton, ...t]) => { ((o[reg] ||= {})[ton] ||= []).push(t.join('|').trim()); return o; }, {}));
function registre(h) { try { return require('./candidatures').chargerDossiers()[h.champion]?.registre || 'sage'; } catch { return 'sage'; } }
/*
 * Deux héros de guildes différentes qui se sont très bien ou très mal entendus : l'un écrit à l'autre. La lettre est confiée
 * au maître au retour de son auteur, et arrive chez l'autre après le vol de l'oiseau.
 */
function ecrireEntreHeros(monde, ententes, mission, retours) {
  for (const { a, b, v } of ententes) {
    if (a.g.id === b.g.id || Math.abs(v) < PARAMS.entente.pctFort) continue;
    const [de, a2] = hash(`${a.h.cle}${b.h.cle}${mission.titre}`) % 2 ? [a, b] : [b, a];
    const banque = lettresHeros()[registre(de.h)]?.[v > 0 ? 'merci' : 'reproche'] || []; if (!banque.length) continue;
    const corps = banque[hash(`${de.h.cle}>${a2.h.cle}#${mission.titre}`) % banque.length]
      .replace(/\{b\}/g, a2.h.nom).replace(/\{mission\}/g, mission.titre).replace(/\{(a|de)_lieu\}/g, (_, p) => Q.avecPreposition(mission.lieu, p)).replace(/\{lieu\}/g, mission.lieu);
    const t0 = (retours[de.h.id] ?? monde.t) + 2, vol = volEntre(de.g.region, a2.g.region);
    (de.g.lettres ||= []).push({ t: t0, heros: [de.h.id], scene: 'heros#envoi', dec: 'courrier',
      texte: `${de.h.nom} pose une lettre pliée en quatre sur ton bureau : « C'est pour ${a2.h.nom}, de ${a2.g.nom}. Tu peux la faire partir ? » L'oiseau s'envole dans l'heure ; il lui faudra ${vol} h pour arriver.` });
    (a2.g.lettres ||= []).push({ t: t0 + vol, heros: [a2.h.id], scene: 'heros#recu', dec: 'courrier',
      texte: `Un oiseau de ${de.g.nom} se pose sur le rebord de ta fenêtre, avec une lettre de ${de.h.nom} pour ${a2.h.nom}. Tu la lui remets sans l'ouvrir. ${a2.h.nom} te la lit quand même : ${corps}` });
  }
}

/* ---------- Missives entre maîtres ---------- */
function envoyerMissive(monde, de, vers, texte) {
  const P = PARAMS.missives, a = monde.guildes[de], b = monde.guildes[vers];
  if (!b || de === vers) throw new Error('Guilde inconnue.');
  const t = String(texte || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 2) throw new Error('Écris quelques mots avant de lâcher l\'oiseau.');
  if (t.length > P.longueur) throw new Error(`Un oiseau ne porte pas plus de ${P.longueur} caractères.`);
  monde.missives ||= [];
  if (monde.missives.filter(m => m.de === de && !m.livree).length >= P.enVolMax) throw new Error(`Tes ${P.enVolMax} oiseaux sont déjà en vol : attends qu'ils reviennent.`);
  const vol = volEntre(a.region, b.region);
  monde.missives.push({ id: `M${++monde.seq}`, de, vers, texte: t, envoyee: monde.t, arrive: monde.t + vol, livree: false });
  return { vol };
}
function livrerMissives(monde, avis) {
  if (!monde.missives?.length) return;
  for (const m of monde.missives) if (!m.livree && m.arrive <= monde.t) {
    m.livree = true; const a = monde.guildes[m.de], b = monde.guildes[m.vers]; if (!a || !b) continue;
    avis(b, `Un oiseau de ${a.nom} se pose au repère. « ${m.texte} »`, { type: 'missive', de: m.de });
    avis(a, `Ton oiseau est arrivé chez ${b.nom}.`, { type: 'missive' });
  }
  const P = PARAMS.missives;
  if (monde.missives.length > P.conserver * 4) monde.missives = monde.missives.filter(m => !m.livree || monde.t - m.arrive < 24 * 14);
}
function missivesDe(monde, gid) {
  const nom = id => monde.guildes[id]?.nom || 'une guilde disparue', L = (monde.missives || []).filter(m => m.de === gid || (m.vers === gid && m.livree));
  return L.slice(-PARAMS.missives.conserver).reverse().map(m => ({ id: m.id, sens: m.de === gid ? 'envoyee' : 'recue', guilde: m.de === gid ? m.vers : m.de, nom: nom(m.de === gid ? m.vers : m.de), texte: m.texte, t: m.livree ? m.arrive : m.envoyee, enVol: m.livree ? 0 : Math.max(0, m.arrive - monde.t) }));
}

/* ---------- Courrier des habitants ---------- */
let HAB = null;
const habitants = () => (HAB ||= lignes('vie/lettres/habitants.txt').map(([qui, sig, ...t], i) => ({ i, qui: qui.trim(), sig: sig.trim(), texte: t.join('|').trim() })));
const ENTREES = [
  'Au courrier du matin, une lettre montée de {bourg}.',
  'Quelqu\'un a glissé un mot sous le portail pendant la nuit.',
  'Le facteur dépose une enveloppe adressée « à la guilde, là-haut ».',
  'Une lettre attend sur ton bureau, pliée avec soin.',
  'Un gamin essoufflé apporte un mot de {bourg} et repart en courant.',
];
/* Une fois par jour au plus : une lettre qui parle d'un héros de la guilde, jamais deux fois la même. */
function courrierHabitants(g, jour) {
  const P = PARAMS.habitants, hs = g.heros.filter(h => !['parti', 'mort'].includes(h.etat) && g.t - (h.arrivee ?? g.t) >= 24);
  if (!hs.length) return null;
  const rng = V.rngDepuis(`${g.id}#habitants#${jour}`); if (rng() > P.chance) return null;
  const vus = new Set(g.habitantsVus || []), parChampion = Object.fromEntries(hs.map(h => [h.champion, h])), choix = [];
  for (const l of habitants()) {
    if (vus.has(l.i)) continue;
    if (l.qui === '*') choix.push({ l, hs: [hs[Math.floor(rng() * hs.length)]], p: P.poids.tous });
    else if (l.qui.startsWith('trait:')) { const c = hs.filter(h => h.traits.includes(l.qui.slice(6))); if (c.length) choix.push({ l, hs: [c[Math.floor(rng() * c.length)]], p: P.poids.trait }); }
    else if (l.qui.includes('+')) { const [x, y] = l.qui.split('+').map(s => parChampion[s.trim()]); if (x && y) choix.push({ l, hs: [x, y], p: P.poids.duo }); }
    else if (parChampion[l.qui]) choix.push({ l, hs: [parChampion[l.qui]], p: P.poids.champion });
  }
  if (!choix.length) return null;
  let x = rng() * choix.reduce((s, c) => s + c.p, 0); const c = choix.find(k => (x -= k.p) <= 0) || choix[0];
  (g.habitantsVus ||= []).push(c.l.i);
  const rem = s => s.replace(/\{nom2\}/g, c.hs[1]?.nom || '').replace(/\{nom\}/g, c.hs[0].nom).replace(/\{bourg\}/g, g.monde.bourg).replace(/\{chien\}/g, g.monde.chien)
    .replace(/\{guilde\}/g, g.nom).replace(/\{maitre\}/g, g.maitre?.titre === 'maîtresse' ? 'Maîtresse' : 'Maître');
  const texte = finir(`${rem(ENTREES[c.l.i % ENTREES.length])} « ${rem(c.l.texte)} » C'est signé : ${rem(c.l.sig)}.`);
  (g.lettres ||= []).push({ t: g.t, heros: c.hs.map(h => h.id), scene: 'habitant', dec: 'courrier', texte });
  return texte;
}

module.exports = { PARAMS, noterEntentes, bonusEntente, ententesDe, ecrireEntreHeros, envoyerMissive, livrerMissives, missivesDe, courrierHabitants, habitants, lettresHeros, volEntre };
