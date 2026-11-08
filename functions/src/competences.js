'use strict';
/*
 * Guild Legends — compétences des héros (proposition du 7 nov. 2026).
 * Les compétences sont celles du jeu (Data Dragon 16.13.1, fr_FR), extraites dans catalogue/competences.json.
 * Un héros débloque d'abord son passif, puis ses trois compétences de base dans un ordre propre à son champion,
 * puis son ultime. Seules les compétences débloquées pèsent sur une mission.
 * Les valeurs de PARAMS restent à équilibrer.
 */

const PARAMS = {
  // Nombre de compétences débloquées selon le palier de progression du héros (0 à 4)
  debloquees: [1, 2, 3, 4, 5],
  // Une compétence de dégâts vaut ses dégâts de base divisés par cette valeur
  echelleDegats: 20,
  // Une compétence sans dégâts mais à l'étiquette demandée vaut ce poids
  valeurUtilitaire: 1,
  // Soins et boucliers valent leur montant divisé par cette valeur
  echelleSoutien: 15,
  // Chance de toucher : base de la compétence, ajustée par la Précision du lanceur face à l'esquive de la cible
  pointParEcart: 0.3, chanceMin: 5, chanceMax: 99,
};

const FAMILLE_DEGATS = ['degats_magiques', 'degats_physiques', 'degats_bruts'];

function competencesDebloquees(fiche, progression) {
  const n = PARAMS.debloquees[Math.max(0, Math.min(progression, PARAMS.debloquees.length - 1))];
  const cles = fiche.ordre_deblocage.slice(0, n);
  return fiche.competences.filter(c => cles.includes(c.cle));
}

/* Dégâts effectifs d'une compétence : du rang 1 au rang maximal selon la progression (0 à 4). */
function degatsEffectifs(comp, progression) {
  if (!comp.degats) return 0;
  const [r1, rmax] = comp.degats;
  const t = Math.max(0, Math.min(progression, 4)) / 4;
  return Math.round(r1 + (rmax - r1) * t);
}

function valeurRang(paire, progression) {
  if (!paire) return 0;
  const t = Math.max(0, Math.min(progression, 4)) / 4;
  return Math.round(paire[0] + (paire[1] - paire[0]) * t);
}

/*
 * Chance de toucher (en %) d'une compétence offensive. Les compétences sans jet (soins, boucliers,
 * effets sur soi) touchent toujours. precision : statistique du lanceur ; esquive : celle de la cible (0 à 100).
 */
function chanceToucher(comp, precision = 50, esquive = 50) {
  if (!comp.chance_toucher) return 100;
  const c = comp.chance_toucher + (precision - esquive) * PARAMS.pointParEcart;
  return Math.round(Math.max(PARAMS.chanceMin, Math.min(PARAMS.chanceMax, c)));
}

/* Correspondance entre une condition de mission et une compétence. « degats » accepte tous les types. */
function repond(comp, condition) {
  if (condition === 'degats') return comp.etiquettes.some(t => FAMILLE_DEGATS.includes(t));
  return comp.etiquettes.includes(condition);
}

/*
 * Apport des compétences d'un héros à une mission.
 * mission.conditions : { etiquette: poids }, par exemple { controle: 2, bouclier: 1, degats: 1 }.
 * Renvoie un score et les compétences décisives, pour le récit de la mission.
 */
function apportMission(fiche, progression, mission, stats = {}) {
  const precision = stats.precision ?? 50, esquive = mission.esquive ?? 50;
  const comps = competencesDebloquees(fiche, progression);
  let score = 0; const decisives = [];
  for (const c of comps) {
    let part = 0;
    for (const [cond, poids] of Object.entries(mission.conditions || {})) {
      if (!repond(c, cond)) continue;
      let valeur;
      if (FAMILLE_DEGATS.includes(cond) || cond === 'degats')   // dégâts espérés : montant × chance de toucher
        valeur = degatsEffectifs(c, progression) * chanceToucher(c, precision, esquive) / 100 / PARAMS.echelleDegats;
      else if (cond === 'soin' && c.soin) valeur = valeurRang(c.soin, progression) / PARAMS.echelleSoutien;
      else if (cond === 'bouclier' && c.bouclier) valeur = valeurRang(c.bouclier, progression) / PARAMS.echelleSoutien;
      else valeur = PARAMS.valeurUtilitaire;
      part += poids * valeur;
    }
    if (part > 0) { score += part; decisives.push({ cle: c.cle, nom: c.nom, apport: Math.round(part * 100) / 100 }); }
  }
  decisives.sort((a, b) => b.apport - a.apport);
  return { score: Math.round(score * 100) / 100, decisives };
}

module.exports = { PARAMS, competencesDebloquees, degatsEffectifs, valeurRang, chanceToucher, apportMission };
