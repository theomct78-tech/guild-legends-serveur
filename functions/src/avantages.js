'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — avantages de mission des compétences (décision du 7 nov. 2026).
 * Une compétence n'inflige plus de dégâts : elle apporte un ou plusieurs avantages à la mission.
 * Chaque avantage a une force (1 mineur, 2 notable, 3 majeur ; -1 pour un revers) écrite à la main par lot,
 * dans catalogue/avantages/lotNN.txt. L'effet chiffré d'un point de force est l'« unité » de la palette.
 */
const fs = require('node:fs');
const path = require('node:path');

const DOSSIER = path.join(CATALOGUE, 'avantages');
const PALETTE = JSON.parse(fs.readFileSync(path.join(DOSSIER, 'palette.json'), 'utf8'));

const PARAMS = {
  // L'effet d'une compétence grandit avec la progression du héros : × 1 au déblocage, × 2 au palier 4
  facteurMax: 2,
};

function chargerLots(dossier = DOSSIER) {
  const out = {};
  for (const f of fs.readdirSync(dossier).filter(n => /^lot\d+\.txt$/.test(n)).sort()) {
    for (const ligne of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n')) {
      if (!ligne.trim() || ligne.startsWith('#')) continue;
      const [champion, cle, av, phrase] = ligne.split('|');
      const avantages = av.split(',').map(a => { const [code, force] = a.split(':'); return { code, force: Number(force) }; });
      for (const a of avantages) if (!PALETTE[a.code]) throw new Error(`Avantage inconnu ${a.code} (${champion} ${cle})`);
      (out[champion] ||= {})[cle] = { avantages, phrase };
    }
  }
  return out;
}

/*
 * Avantages cumulés d'un héros pour une mission, à partir de ses compétences débloquées (clés P, Q, W, E, R).
 * Renvoie { CODE: valeur en points d'effet } et la liste des compétences qui ont joué, pour le récit.
 */
function avantagesHeros(lots, champion, clesDebloquees, progression) {
  const kit = lots[champion]; if (!kit) return { totaux: {}, sources: [] };
  const facteur = 1 + (PARAMS.facteurMax - 1) * Math.max(0, Math.min(progression, 4)) / 4;
  const totaux = {}; const sources = [];
  for (const cle of clesDebloquees) {
    const c = kit[cle]; if (!c) continue;
    for (const { code, force } of c.avantages) {
      totaux[code] = Math.round(((totaux[code] || 0) + force * PALETTE[code].unite * facteur) * 100) / 100;
    }
    sources.push({ cle, phrase: c.phrase, avantages: c.avantages });
  }
  // Survie de force 3 : une mort évitée dans l'équipe, une fois par mission
  return { totaux, sources, evitementMort: clesDebloquees.some(k => kit[k]?.avantages.some(a => a.code === 'SURVIE' && a.force >= 3)) };
}

/* Avantages d'une équipe : somme des totaux de chaque héros. */
function avantagesEquipe(lots, membres) {
  const totaux = {};
  for (const m of membres) {
    const r = avantagesHeros(lots, m.champion, m.cles, m.progression);
    for (const [k, v] of Object.entries(r.totaux)) totaux[k] = Math.round(((totaux[k] || 0) + v) * 100) / 100;
  }
  return totaux;
}

/*
 * Compétences débloquées (11 nov. 2026, audit des missions : les avantages étaient écrits pour les 173 champions mais
 * aucune mission ne les comptait). Un héros arrive avec son passif et sa compétence signature (la plus forte de Q, W, E) ;
 * il débloque les deux autres en progressant, puis son ultime quand son potentiel se révèle.
 * ratio : progression moyenne de ses 5 meilleures statistiques vers leur plafond (0,75 à l'arrivée environ, 1 au sommet).
 */
const SEUILS = [[0, 2], [0.80, 3], [0.85, 4], [0.90, 5]];
let LOTS = null;
const lots = () => (LOTS ||= chargerLots());
function clesDebloquees(champion, ratio, kit = lots()[champion]) {
  if (!kit) return [];
  const force = k => (kit[k]?.avantages || []).reduce((t, a) => t + Math.max(0, a.force), 0);
  const base = ['Q', 'W', 'E'].filter(k => kit[k]).sort((a, b) => force(b) - force(a) || a.localeCompare(b));
  const ordre = [...(kit.P ? ['P'] : []), ...base, ...(kit.R ? ['R'] : [])];
  const n = SEUILS.filter(([s]) => ratio >= s).pop()[1];
  return ordre.slice(0, n);
}
const palierProgression = ratio => Math.max(0, Math.min(4, (ratio - 0.75) / 0.25 * 4));
/* Ce qu'un héros apporte en mission, d'après son champion et sa progression : { totaux, sources, cles }. */
function avantagesDeHeros(champion, ratio) {
  const cles = clesDebloquees(champion, ratio);
  return { ...avantagesHeros(lots(), champion, cles, palierProgression(ratio)), cles, verrouillees: Object.keys(lots()[champion] || {}).filter(k => !cles.includes(k)) };
}
function sommer(liste) { const t = {}; for (const x of liste) for (const [k, v] of Object.entries(x.totaux || {})) t[k] = Math.round(((t[k] || 0) + v) * 100) / 100; return t; }

module.exports = { chargerLotsCache: lots, PALETTE, PARAMS, chargerLots, avantagesHeros, avantagesEquipe, clesDebloquees, avantagesDeHeros, palierProgression, sommer };
