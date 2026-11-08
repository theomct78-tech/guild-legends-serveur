'use strict';
/*
 * Guild Legends — ce que le joueur voit des statistiques d'un héros (8 nov. 2026).
 *
 * Décision de Théo (8 nov. 2026) : on montre les statistiques ACTUELLES, jamais le plafond. Le potentiel maximal n'est pas
 * dévoilé : on ne le découvre qu'en s'en approchant.
 * Proposition pour « s'en approcher » (à valider) :
 *   - une statistique à moins de 10 % de son plafond porte la mention « proche de son sommet », puis « au sommet » quand elle l'atteint ;
 *   - le potentiel (B, A, S, G) se devine à partir de 80 % de progression moyenne, et se révèle à 90 %.
 * Valeur de départ : un héros recruté démarre à 75 % de ses plafonds (hypothèse de calibration du 7 nov. 2026),
 * avec un petit écart propre à chaque statistique pour que deux héros ne se ressemblent pas.
 */
const { EPREUVES, valeurHeros, chanceReussite } = require('./resolution');

const STATS = ['Force', 'Défense', 'Magie', 'Résistance magique', 'Vitesse', 'Précision', 'Endurance', 'Intelligence', 'Leadership'];
const PARAMS = {
  depart: 0.75, ecartDepart: 0.04,   // 75 % des plafonds, à ±4 % près selon la statistique
  procheSommet: 0.90,                // à moins de 10 % du plafond : « proche de son sommet »
  indicePotentiel: 0.80, revelationPotentiel: 0.90,
};

function graine(t) { let h = 2166136261; for (const c of t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

/* Statistiques actuelles d'un héros qui vient d'être recruté. */
function statsDeDepart(cle, plafonds) {
  const out = {};
  for (const s of STATS) {
    const ecart = (graine(`${cle}#${s}`) * 2 - 1) * PARAMS.ecartDepart;
    out[s] = Math.max(1, Math.min(plafonds[s], Math.round(plafonds[s] * (PARAMS.depart + ecart))));
  }
  return out;
}

const PALIERS_POTENTIEL = { B: 'B', 'B+': 'B', A: 'A', 'A-': 'A', 'A+': 'A', S: 'S', 'S-': 'S', 'S+': 'S', G: 'G' };

/*
 * Ce que la fiche « Au combat » affiche. Le plafond n'en sort jamais : seulement la valeur actuelle et, quand c'est le cas,
 * la mention qu'on approche du sommet. Le potentiel n'apparaît qu'à l'approche.
 * difficulteRepere : difficulté moyenne des missions du palier de la guilde, pour traduire chaque épreuve en chance.
 */
function ficheCombat(heros, plafonds, potentiel, difficulteRepere = 35) {
  const stats = STATS.map(s => {
    const v = heros.stats[s], p = plafonds[s];
    const etat = v >= p ? 'sommet' : v >= p * PARAMS.procheSommet ? 'proche' : null;
    return { nom: s, valeur: v, etat };
  });
  // Progression : sur les 5 statistiques les plus avancées (un héros se forge dans sa spécialité ; un éclaireur n'a pas à devenir colosse)
  const ratios = STATS.map(s => heros.stats[s] / plafonds[s]).sort((a, b) => b - a).slice(0, 5);
  const progression = ratios.reduce((t, r) => t + r, 0) / ratios.length;
  let pot = { revele: false, texte: 'Inconnu. Il se dévoilera à mesure que le héros progressera.' };
  if (progression >= PARAMS.revelationPotentiel) pot = { revele: true, palier: PALIERS_POTENTIEL[potentiel] || potentiel, texte: `Potentiel ${PALIERS_POTENTIEL[potentiel] || potentiel} : le sommet est en vue.` };
  else if (progression >= PARAMS.indicePotentiel) pot = { revele: false, texte: 'Son potentiel commence à se dessiner. Encore un peu de chemin.' };
  const epreuves = Object.entries(EPREUVES).map(([type, def]) => {
    const v = valeurHeros({ stats: heros.stats, moral: heros.moral }, type);
    return { type, label: def.label, valeur: Math.round(v), chance: Math.round(chanceReussite(v, difficulteRepere) * 100) };
  }).sort((a, b) => b.valeur - a.valeur);
  return { stats, epreuves, potentiel: pot };
}

/* ---------- Progression longue durée (demande de Théo, 8 nov. 2026 : « un jeu long terme ») ----------
 * Proposition de Claude, à valider. Rien n'arrive au maximum en deux semaines :
 *   - un héros progresse statistique par statistique, selon les épreuves qu'il vit (un éclaireur gagne en vitesse,
 *     un diplomate en leadership), avec un rendement décroissant : chaque point coûte plus que le précédent ;
 *   - repères pour un joueur actif (simulés dans test/progression-longue.test.js) : potentiel deviné (80 %) vers 3 mois,
 *     révélé (90 %) vers 8 mois, statistiques principales au sommet entre un an et demi et deux ans ;
 *   - l'entraînement au repère compte un peu, les missions beaucoup, les missions difficiles davantage.
 */
const XP = {
  K: 850,                                                     // échelle : 63 % du chemin vers le plafond à K points dans une statistique
  mission: { inconnue: 10, locale: 16, regionale: 24, renommee: 34, legendaire: 46, quete: 14 },
  issue: { eclatante: 1.3, reussite: 1, partielle: 0.6, echec: 0.3 },   // on apprend aussi de ses échecs, moins
  risque: 1.25,
  entrainement: { Force: 0.5, Défense: 0.4, Vitesse: 0.4, Endurance: 0.5, Précision: 0.3 },  // par créneau de 2 h
  lecture: { Intelligence: 0.5, Magie: 0.4, 'Résistance magique': 0.3 },
  discussion: { Leadership: 0.25 },
};
const CLE_STAT = { Fo: 'Force', Dé: 'Défense', Ma: 'Magie', Ré: 'Résistance magique', Vi: 'Vitesse', Pr: 'Précision', En: 'Endurance', In: 'Intelligence', Le: 'Leadership' };

/* Valeur actuelle d'une statistique : départ + chemin parcouru vers le plafond, à rendement décroissant. */
function valeurStat(depart, plafond, xp = 0) {
  return Math.min(plafond, Math.round(depart + (plafond - depart) * (1 - Math.exp(-xp / XP.K))));
}
function statsActuelles(cle, plafonds, xpStats = {}) {
  const dep = statsDeDepart(cle, plafonds);
  return Object.fromEntries(STATS.map(s => [s, valeurStat(dep[s], plafonds[s], xpStats[s])]));
}

/*
 * Expérience gagnée par un héros pour une mission : répartie sur les statistiques sollicitées par les épreuves qu'il a vécues.
 * « Fo|Ma » : la statistique que ce héros utilise (la plus haute des deux). Renvoie { stat: points }.
 */
function experienceMission(stats, mission, issue) {
  const base = (XP.mission[mission.palier] ?? XP.mission.inconnue) * (XP.issue[issue] ?? 1) * (mission.risque ? XP.risque : 1);
  const out = {}, n = mission.epreuves.length || 1;
  for (const ep of mission.epreuves) for (const [cle, poids] of Object.entries(EPREUVES[ep.type].stats)) {
    const s = cle.split('|').map(k => CLE_STAT[k]).sort((a, b) => (stats[b] ?? 0) - (stats[a] ?? 0))[0];
    out[s] = (out[s] || 0) + base * poids * 2.4 / n;
  }
  return out;
}
function ajouterExperience(xpStats, gains) { for (const [s, v] of Object.entries(gains)) xpStats[s] = (xpStats[s] || 0) + v; return xpStats; }

/* ---------- Niveau de guilde : la réputation cumulée ----------
 * Les missions rapportent de la réputation (1 à 4 au palier Inconnue, jusqu'à 25 au palier Légendaire). Le niveau se lit
 * dans la réputation cumulée. Seuils calculés pour un joueur actif (missions envoyées chaque jour, 80 % de réussite) :
 * niveau 5 vers 3 semaines, 12 vers 3 mois, 20 vers 8 mois, 35 vers un an et demi, 50 vers trois ans.
 */
const RYTHME = {
  repMoyenne: { inconnue: 2.5, locale: 4, regionale: 7, renommee: 10.5, legendaire: 17.5 },
  jours: L => L < 5 ? 5 : L < 12 ? 10 : L < 20 ? 19 : L < 35 ? 21 : 37,  // jours pour passer du niveau L au suivant
};
const capaciteNiveau = L => require('./rules').capacity(L);
const palierNiveau = L => L <= 5 ? 'inconnue' : L <= 12 ? 'locale' : L <= 20 ? 'regionale' : L <= 35 ? 'renommee' : 'legendaire';
const repParJour = L => capaciteNiveau(L) / 3.2 * 0.7 * RYTHME.repMoyenne[palierNiveau(L)] * 0.8;
const SEUILS_GUILDE = (() => { const t = [0, 0]; for (let L = 1; L < 50; L++) t.push(t[L] + Math.round(repParJour(L) * RYTHME.jours(L) / 5) * 5); return t; })();
const seuilNiveau = L => SEUILS_GUILDE[L];
function niveauGuilde(reputation) { let L = 1; while (L < 50 && reputation >= SEUILS_GUILDE[L + 1]) L++; return L; }
/* Ce que le joueur voit : son niveau, et combien de réputation le sépare du suivant (jamais la table entière). */
function avancementGuilde(reputation) {
  const L = niveauGuilde(reputation); if (L === 50) return { niveau: 50, pourcent: 100, reste: 0 };
  const a = SEUILS_GUILDE[L], b = SEUILS_GUILDE[L + 1];
  return { niveau: L, pourcent: Math.floor((reputation - a) / (b - a) * 100), reste: b - reputation };
}

module.exports = { capaciteNiveau, STATS, PARAMS, XP, statsDeDepart, ficheCombat, valeurStat, statsActuelles, experienceMission, ajouterExperience,
  SEUILS_GUILDE, seuilNiveau, niveauGuilde, avancementGuilde };
