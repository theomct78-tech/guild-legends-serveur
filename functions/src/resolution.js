'use strict';
/*
 * Guild Legends — résolution des missions (proposition du 7 nov. 2026, à valider).
 *
 * Une mission est une suite d'épreuves. Chaque épreuve sollicite certaines statistiques.
 * L'équipe obtient un score pour l'épreuve, comparé à la difficulté : l'écart donne une chance de réussite.
 * Le bilan des épreuves donne l'issue de la mission ; les épreuves de combat ratées exposent aux blessures.
 * Toutes les valeurs sont dans PARAMS et restent à équilibrer.
 */

// Statistiques sollicitées par type d'épreuve, avec leur poids. « Fo|Ma » : la meilleure des deux pour ce héros.
const EPREUVES = {
  combat:     { label: 'Combat',      stats: { 'Fo|Ma': 0.45, Pr: 0.25, 'Dé|Ré': 0.30 }, avantages: ['ASSAUT', 'MAITRISE'] },
  nuee:       { label: 'Contre la nuée', stats: { 'Fo|Ma': 0.40, En: 0.30, 'Dé|Ré': 0.30 }, avantages: ['NUEE', 'MAITRISE'] },
  siege:      { label: 'Siège',       stats: { 'Fo|Ma': 0.40, En: 0.35, 'Dé|Ré': 0.25 }, avantages: ['SIEGE'] },
  discretion: { label: 'Discrétion',  stats: { Vi: 0.40, In: 0.35, Pr: 0.25 }, avantages: ['INFILTRATION'] },
  poursuite:  { label: 'Poursuite',   stats: { Vi: 0.50, Pr: 0.30, En: 0.20 }, avantages: ['TRAQUE', 'CELERITE'] },
  voyage:     { label: 'Voyage',      stats: { En: 0.50, In: 0.25, Ré: 0.25 }, avantages: ['CELERITE', 'RECONNAISSANCE'] },
  diplomatie: { label: 'Diplomatie',  stats: { Le: 0.55, In: 0.45 }, avantages: ['INSPIRATION', 'CONCORDE'] },
};

const PARAMS = {
  // Poids des héros dans une épreuve : le meilleur compte le plus, les autres soutiennent
  poidsRang: [0.5, 0.3, 0.2, 0.1, 0.1],
  // Moral et motivation (0 à 100) : de × 0,85 à × 1,10
  moralMin: 0.85, moralMax: 1.10,
  // Relations : +4 par paire d'amis, -4 par paire de rivaux, plafonné à ± 10
  relationParPaire: 4, relationPlafond: 10,
  // Avantages des compétences : rendement décroissant, bonus = plafond × (1 - e^(-total / echelle)).
  // Ils complètent les statistiques sans jamais les remplacer : un assassin ne prend pas une forteresse.
  bonusAvantageMax: 10, echelleAvantage: 40,
  // Maîtrise : réduit la difficulté d'un combat ou d'une nuée, même rendement décroissant
  maitriseMax: 6,
  // Rôle exigé absent : pénalité sur toutes les épreuves
  penaliteRoleManquant: 8,
  // Courbe de réussite : chance = 1 / (1 + e^(-(score - difficulté) / pente)), bornée
  pente: 7, chanceMin: 0.05, chanceMax: 0.95,
  // Blessures sur une épreuve de combat, de nuée ou de siège ratée
  risqueBlessureBase: 0.35, protectionMax: 0.6, // la Protection retire au plus 60 % du risque
  // Mort : seulement sur un échec grave (tirage très mauvais) d'une mission dangereuse
  seuilEchecGrave: 0.25,
  // Missions à risque (mieux payées) : le risque de blessure est multiplié
  multRisque: 1.6,
  // Complication (cachée dans chaque mission) : une fois sur deux, elle surgit et ajoute une épreuve surprise, plus dure
  // que les autres. Un Éclaireur dans l'équipe l'a vue venir : elle perd 10 de difficulté (FORMAT.md).
  // 11 nov. 2026, audit : avec des héros tout juste recrutés, un joueur appliqué ratait 11 contrats sur 14. Aux deux premiers
  // paliers, les épreuves sont allégées pour viser environ 65 % de réussite en jouant normalement. Mesuré sur 28 jours
  // (3 guildes) : les missions locales restaient à 20-40 % avec une équipe soignée, d'où un allègement plus fort à ce palier.
  allegement: { inconnue: 8, locale: 14, regionale: 10, renommee: 4, legendaire: 0 },
  brio: 0.3,                         // part basse du tirage qui fait une réussite éclatante
  chanceComplication: 0.5, surcoutComplication: 3, eclaireurComplication: 10,
  // 11 nov. 2026, audit : la classe compte aussi quand le poste est tenu. Sur les épreuves clés de son poste (un Tank au combat,
  // un Éclaireur en discrétion, un Support en diplomatie), le héros pèse 12 % de plus, selon l'efficacité avec laquelle il le tient.
  bonusPoste: 0.12,
  // Reconnaissance (compétences) : la complication perd jusqu'à 6 de difficulté. Soins : jusqu'à 60 % de chances qu'une blessure grave reste légère.
  reconnaissanceMax: 6, soinsMax: 0.6,
};

const { penaliteComposition, risqueBlessureComposition, POSTES } = require('./missions');

const CLE = { Fo: 'Force', Dé: 'Défense', Ma: 'Magie', Ré: 'Résistance magique', Vi: 'Vitesse', Pr: 'Précision', En: 'Endurance', In: 'Intelligence', Le: 'Leadership' };

function valeurStat(stats, cle) {
  return Math.max(...cle.split('|').map(k => stats[CLE[k]] ?? 0));
}

/* Valeur d'un héros pour un type d'épreuve : moyenne pondérée de ses statistiques, ajustée par son moral. */
function valeurHeros(heros, type) {
  const def = EPREUVES[type];
  let v = 0;
  for (const [cle, poids] of Object.entries(def.stats)) v += valeurStat(heros.stats, cle) * poids;
  const moral = (heros.moral ?? 70) / 100;
  return v * (PARAMS.moralMin + (PARAMS.moralMax - PARAMS.moralMin) * moral);
}

function rendement(total, plafond) { return plafond * (1 - Math.exp(-Math.max(0, total) / PARAMS.echelleAvantage)); }

/* Bonus de cohésion de l'équipe selon ses relations. */
function cohesion(relations = []) {
  const b = relations.reduce((t, r) => t + (r === 'amis' ? PARAMS.relationParPaire : r === 'rivaux' ? -PARAMS.relationParPaire : 0), 0);
  return Math.max(-PARAMS.relationPlafond, Math.min(PARAMS.relationPlafond, b));
}

/*
 * Score de l'équipe pour une épreuve, avec le détail de qui a pesé.
 * equipe : [{ nom, stats, moral }], avantages : totaux de l'équipe (module avantages), contexte : { relations, roleManquant }.
 */
function scoreEpreuve(equipe, epreuve, avantages = {}, contexte = {}) {
  const def = EPREUVES[epreuve.type];
  const classes = equipe.map(h => {
    const cle = h.poste && POSTES[h.poste]?.cles.includes(epreuve.type);
    return { nom: h.nom, valeur: valeurHeros(h, epreuve.type) * (cle ? 1 + PARAMS.bonusPoste * (h.efficacite ?? 1) : 1), poste: cle ? h.poste : null };
  }).sort((a, b) => b.valeur - a.valeur);
  const somme = PARAMS.poidsRang.slice(0, classes.length).reduce((a, b) => a + b, 0);
  let base = classes.reduce((t, h, i) => t + h.valeur * (PARAMS.poidsRang[i] ?? 0.1), 0) / somme;
  const total = def.avantages.filter(a => a !== 'MAITRISE').reduce((t, a) => t + (avantages[a] || 0), 0);
  const bonusAvantages = rendement(total, PARAMS.bonusAvantageMax);
  const reductionDifficulte = ['combat', 'nuee'].includes(epreuve.type) ? rendement(avantages.MAITRISE || 0, PARAMS.maitriseMax) : 0;
  // Composition : postes vides ou tenus imparfaitement (missions.js). L'ancien drapeau roleManquant reste accepté.
  const composition = contexte.postes ? penaliteComposition(contexte.postes, epreuve.type) : (contexte.roleManquant ? PARAMS.penaliteRoleManquant : 0);
  // L'entente née des contrats précédents (social.js) : quelques points de %, convertis en points de score autour de 50 %.
  const entente = (contexte.entente || 0) * 0.04 * PARAMS.pente;
  const score = base + bonusAvantages + cohesion(contexte.relations) + entente - composition;
  return {
    score: Math.round(score * 10) / 10,
    difficulte: Math.round((epreuve.difficulte - reductionDifficulte - (contexte.allegement || 0)) * 10) / 10,
    meneur: classes[0]?.nom, detail: classes, bonusAvantages: Math.round(bonusAvantages * 10) / 10, composition,
  };
}

function chanceReussite(score, difficulte) {
  const p = 1 / (1 + Math.exp(-(score - difficulte) / PARAMS.pente));
  return Math.max(PARAMS.chanceMin, Math.min(PARAMS.chanceMax, p));
}

/*
 * Résout une mission. rng : fonction qui renvoie un nombre entre 0 et 1 (injectée pour les tests et la rejouabilité).
 * Issue : 'eclatante' (tout réussi), 'reussite' (majorité), 'partielle' (minorité), 'echec' (rien).
 */
const TYPE_COMPLICATION = { enquete: 'discretion', escorte: 'combat', chasse: 'poursuite', diplomatie: 'diplomatie', sauvetage: 'voyage', defense: 'nuee',
  livraison: 'voyage', exploration: 'voyage', protection: 'combat', recuperation: 'poursuite', traque: 'poursuite' };
function resoudreMission(equipe, mission, avantages = {}, contexte = {}, rng = Math.random) {
  contexte = { allegement: PARAMS.allegement[mission.palier] || 0, ...contexte };
  let liste = mission.epreuves, complication = false;
  if (mission.complication && rng() < PARAMS.chanceComplication) {
    const eclaireur = (contexte.postes || []).some(p => p.type === 'Éclaireur' && p.heros);
    // contexte.imprevu : la salle des cartes du repère rend les imprévus moins rudes (valeur négative).
    const d = Math.max(...mission.epreuves.map(e => e.difficulte)) + PARAMS.surcoutComplication - (eclaireur ? PARAMS.eclaireurComplication : 0) + (contexte.imprevu || 0) - rendement(avantages.RECONNAISSANCE || 0, PARAMS.reconnaissanceMax);
    liste = [...liste, { type: TYPE_COMPLICATION[mission.type] || mission.epreuves[0].type, difficulte: d, recit: mission.complication, complication: true }];
    complication = eclaireur ? 'prevue' : 'surprise';
  }
  const epreuves = liste.map(ep => {
    const s = scoreEpreuve(equipe, ep, avantages, contexte);
    const chance = chanceReussite(s.score, s.difficulte);
    const tirage = rng();
    return { type: ep.type, ...s, chance: Math.round(chance * 100), reussie: tirage < chance, grave: tirage > 1 - chance * PARAMS.seuilEchecGrave && tirage >= chance, complication: Boolean(ep.complication), tirage };
  });
  const n = epreuves.filter(e => e.reussie).length, total = epreuves.length;
  // Éclatante : tout réussir ne suffit pas, il faut un coup d'éclat (une épreuve réussie avec une large marge).
  const brio = epreuves.some(e => e.reussie && e.tirage < e.chance / 100 * PARAMS.brio);
  // Moins de la moitié des épreuves réussies : c'est un échec (simulation de 3 mois : les échecs étaient trop rares).
  const issue = n === total ? (brio ? 'eclatante' : 'reussite') : n * 2 > total ? 'reussite' : n * 2 === total ? 'partielle' : 'echec';

  // Blessures : chaque épreuve physique ratée expose l'équipe, moins si elle est bien protégée
  const blessures = [];
  for (const ep of epreuves.filter(e => !e.reussie && ['combat', 'nuee', 'siege'].includes(e.type))) {
    const risque = Math.min(0.9, (PARAMS.risqueBlessureBase + (contexte.postes ? risqueBlessureComposition(contexte.postes) : 0)) * (mission.risque ? PARAMS.multRisque : 1) * (1 - rendement(avantages.PROTECTION || 0, PARAMS.protectionMax)) * (contexte.blessure ?? 1));  // contexte.blessure : la forge du repère
    for (const h of equipe) if (rng() < risque) blessures.push({ nom: h.nom, epreuve: ep.type, niveau: ep.grave && !(rng() < rendement(avantages.SOINS || 0, PARAMS.soinsMax)) ? 'grave' : 'legere' });
  }
  return { issue, reussies: n, total, epreuves, blessures, complication, mortPossible: Boolean(mission.dangereuse && epreuves.some(e => e.grave)) };
}

/* Chance globale de réussir (au moins la majorité des épreuves), calculée exactement, pour l'affichage avant le départ. */
function chanceMission(equipe, mission, avantages = {}, contexte = {}) {
  contexte = { allegement: PARAMS.allegement[mission.palier] || 0, ...contexte };
  const ps = mission.epreuves.map(ep => { const s = scoreEpreuve(equipe, ep, avantages, contexte); return chanceReussite(s.score, s.difficulte); });
  let dist = [1];
  for (const p of ps) { const nd = new Array(dist.length + 1).fill(0); dist.forEach((v, k) => { nd[k] += v * (1 - p); nd[k + 1] += v * p; }); dist = nd; }
  const total = ps.length;
  return Math.round(dist.reduce((t, v, k) => t + (k * 2 > total ? v : 0), 0) * 100);
}

/* Le détail d'une chance, épreuve par épreuve, pour que le joueur comprenne ce qui compte (fiche du contrat). */
function detailChance(equipe, mission, avantages = {}, contexte = {}) {
  contexte = { allegement: PARAMS.allegement[mission.palier] || 0, ...contexte };
  return mission.epreuves.map(ep => {
    const s = scoreEpreuve(equipe, ep, avantages, contexte), def = EPREUVES[ep.type];
    return { type: ep.type, label: def.label, stats: Object.keys(def.stats).map(k => k.split('|').map(x => CLE[x]).join(' ou ')), chance: Math.round(chanceReussite(s.score, s.difficulte) * 100),
      meneur: s.meneur, poste: s.detail[0]?.poste || null, avantages: s.bonusAvantages, composition: s.composition, codes: def.avantages };
  });
}
module.exports = { detailChance, EPREUVES, PARAMS, valeurHeros, cohesion, scoreEpreuve, chanceReussite, resoudreMission, chanceMission };
