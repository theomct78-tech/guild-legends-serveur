'use strict';
/*
 * Guild Legends — l'économie de la guilde (8 nov. 2026). Proposition de Claude, validée sur le principe par Théo :
 * « le prix de l'agrandissement doit être bien plus haut, mais cohérent, et dépendre du niveau de réputation ».
 *
 * (Historique : jusqu'au 8 nov. 2026, le prix suivait le palier ; il est désormais fixe, et la pièce se débloque au rang voulu.)
 * Tout part de ce qu'une guilde gagne vraiment. Pour chaque palier de réputation, on estime le revenu net d'une semaine
 * de jeu actif (contrats moins salaires). Un bâtiment coûte un certain nombre de ces semaines : il reste un vrai
 * projet d'épargne à tout palier, et une guilde réputée paie plus cher (les artisans connaissent sa bourse, et elle
 * construit plus grand). Chaque bâtiment déjà construit renchérit le suivant : on ne bâtit pas tout d'un coup.
 */

const PALIERS = ['inconnue', 'locale', 'regionale', 'renommee', 'legendaire'];

const PARAMS = {
  // Contrats : gain moyen d'une mission (missions à risque comprises), par palier. Inconnue mesuré sur le catalogue
  // (25 PO pour une mission ordinaire, 129 pour une mission à risque, 8 % de missions à risque) ; les autres sont
  // le milieu des fourchettes du vérificateur, en attendant leurs lots. Locale mesuré sur les 50 missions de Demacia :
  // 107 PO pour une mission ordinaire, 360 pour une mission à risque, 6 % de missions à risque.
  gainMission: { inconnue: 34, locale: 122, regionale: 260, renommee: 600, legendaire: 1450 },
  issue: 0.85,                       // part du gain réellement touchée en moyenne (échecs et réussites partielles)
  // Un joueur actif : chaque héros part environ tous les 2,3 jours, à deux par mission en moyenne
  missionsParHerosParJour: 0.16,     // mesuré dans la simulation de 3 mois (joueur actif : 1,07 mission par jour pour 6,7 héros)
  // Effectif typique et salaire hebdomadaire moyen d'un héros, par palier (proposition)
  effectif: { inconnue: 5, locale: 7, regionale: 11, renommee: 15, legendaire: 21 },
  salaire: { inconnue: 12, locale: 30, regionale: 70, renommee: 150, legendaire: 300 },
};

/* Revenu net d'une semaine de jeu actif, pour une guilde typique du palier. */
function revenuHebdo(palier) {
  const P = PARAMS, n = P.effectif[palier];
  const missionsSemaine = n * P.missionsParHerosParJour * 7;
  const brut = missionsSemaine * P.gainMission[palier] * P.issue;
  return { brut: Math.round(brut), salaires: n * P.salaire[palier], net: Math.round(brut - n * P.salaire[palier]) };
}

/*
 * Prix des pièces du repère : fixes depuis le 8 nov. 2026 (décision de Théo), voir repere.js.
 * Ce module garde le revenu hebdomadaire, qui sert à calibrer ces prix et à dire au joueur combien de semaines il lui manque.
 */
const prixBatiment = cle => require('./repere').SALLES.find(s => s.cle === cle)?.prix;

/* Pour l'interface : combien de semaines de contrats représente une somme manquante (jamais plus précis qu'il ne faut). */
function semainesPour(somme, palier) { return Math.max(1, Math.ceil(somme / Math.max(1, revenuHebdo(palier).net))); }

module.exports = { PALIERS, PARAMS, revenuHebdo, prixBatiment, semainesPour };
