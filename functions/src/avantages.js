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

module.exports = { PALETTE, PARAMS, chargerLots, avantagesHeros, avantagesEquipe };
