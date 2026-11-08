'use strict';
/*
 * Guild Legends — rangs véridiques (8 nov. 2026, demande de Théo).
 *
 * « Je veux que les contrats aient des rangs de difficulté véridiques. Si un contrat de rang B attend un support et que
 *   j'envoie un support de rang C-, ce ne sera pas impossible, mais plus compliqué de remplir la mission. »
 *
 * Une seule échelle pour tout le monde, mesurée sur la même grandeur que la résolution : la valeur d'un héros sur une
 * épreuve (statistiques pondérées, moral neutre). Elle prolonge l'échelle des potentiels (B à G) vers le bas :
 *   E, D, C-, C, C+, B-, B, B+, A-, A, A+, S-, S, S+, G.
 * - Les seuils sont calés sur les fiches : un héros arrivé au bout de son potentiel atteint le rang de son potentiel
 *   (médiane mesurée par tier). Une recrue fraîche (à 75 % de ses plafonds) part trois ou quatre rangs plus bas.
 * - Le rang d'un héros dépend du poste qu'il tient : on le mesure sur les épreuves clés de ce poste. Une assassine de
 *   rang B en discrétion peut n'être que C en diplomatie.
 * - Le rang d'un contrat est le rang qu'un héros doit avoir, à chaque poste, pour que la mission ait de bonnes chances
 *   (environ deux chances sur trois par épreuve). Il est tiré des difficultés écrites : il est donc toujours vrai.
 * - Sous le rang attendu, le poste est moins bien tenu : chaque rang manquant retire 10 % d'efficacité au poste
 *   (au plus 60 %). Cela s'ajoute à des statistiques plus faibles. Ce n'est jamais impossible : juste plus dur.
 */
const R = require('./resolution');
const M = require('./missions');

const RANGS = ['E', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+', 'G'];
// Valeur minimale de chaque rang (mesures du 8 nov. 2026 sur 1 755 fiches : B 47, B+ 55, A- 63, A 67, A+ 75, S- 80, S 85, S+ 91, G 98).
const SEUILS = { E: 0, D: 25, 'C-': 30, C: 34, 'C+': 39, 'B-': 44, B: 49, 'B+': 55, 'A-': 61, A: 67, 'A+': 73, 'S-': 78, S: 83, 'S+': 89, G: 96 };
const PARAMS = {
  margeContrat: 10,         // un contrat de rang X : ses épreuves valent en moyenne le seuil de X moins cette marge
  perteParRang: 0.10,       // efficacité perdue sur le poste par rang manquant
  perteMax: 0.60,
  moralNeutre: 70,          // le rang ne bouge pas avec l'humeur du jour
};

const indice = r => RANGS.indexOf(r);
function rangDe(valeur) { let r = 'E'; for (const x of RANGS) if (valeur >= SEUILS[x]) r = x; return r; }

/* Valeur d'un héros sur un poste : moyenne de sa valeur sur les épreuves clés du poste. */
function valeurPoste(stats, poste) {
  const cles = M.POSTES[poste]?.cles || ['combat'];
  return cles.reduce((t, c) => t + R.valeurHeros({ stats, moral: PARAMS.moralNeutre }, c), 0) / cles.length;
}
const rangHeros = (stats, poste) => rangDe(valeurPoste(stats, poste));

/* Rang du meilleur poste d'un héros, pour sa fiche. */
function rangPrincipal(stats, role) { return rangHeros(stats, M.POSTES[role] ? role : 'DPS'); }

/* Rang d'un contrat, tiré de ses épreuves. */
function rangContrat(mission) {
  const d = mission.epreuves.reduce((t, e) => t + e.difficulte, 0) / mission.epreuves.length;
  return rangDe(d + PARAMS.margeContrat);
}

/* Écart de rang d'un héros sur un poste d'un contrat : 0 s'il est au niveau ou au-dessus, sinon le nombre de rangs manquants. */
function ecart(stats, poste, rangAttendu) { return Math.max(0, indice(rangAttendu) - indice(rangHeros(stats, poste))); }

/* Efficacité d'un héros sur un poste, rang compris. heros : { role, role_secondaire, specialites, stats }. */
function efficaciteAvecRang(heros, poste, rangAttendu) {
  const base = M.efficacitePoste(heros, poste);
  if (!base || !heros.stats || !rangAttendu) return base;
  const n = ecart(heros.stats, poste, rangAttendu);
  return Math.round(base * (1 - Math.min(PARAMS.perteMax, n * PARAMS.perteParRang)) * 100) / 100;
}

/*
 * Concurrence sur un poste (décision de Théo, 8 nov. 2026) : tant que le recrutement est ouvert, un héros de meilleur rang
 * reprend le poste à un titulaire qui n'a pas le rang du contrat. À rang égal, ou dès que le titulaire a le rang attendu
 * (ou mieux), le premier placé garde sa place.
 */
function peutReprendre(statsTitulaire, statsCandidat, poste, rangAttendu) {
  const t = indice(rangHeros(statsTitulaire, poste)), c = indice(rangHeros(statsCandidat, poste));
  return t < indice(rangAttendu) && c > t;
}

/* Ce qu'on dit au joueur quand il place un héros. */
function verdict(heros, poste, rangAttendu) {
  const r = rangHeros(heros.stats, poste), n = indice(rangAttendu) - indice(r);
  if (n <= 0) return { rang: r, ecart: 0, texte: n < -1 ? `Rang ${r} : largement au niveau.` : `Rang ${r} : au niveau du contrat.` };
  return { rang: r, ecart: n, texte: n === 1 ? `Rang ${r} : un rang en dessous. Un peu plus difficile.` : n <= 3 ? `Rang ${r} : ${n} rangs en dessous. Nettement plus difficile.` : `Rang ${r} : ${n} rangs en dessous. Possible, mais très risqué.` };
}

module.exports = { peutReprendre, RANGS, SEUILS, PARAMS, rangDe, valeurPoste, rangHeros, rangPrincipal, rangContrat, ecart, efficaciteAvecRang, verdict, indice };
