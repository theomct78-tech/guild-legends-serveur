'use strict';
/*
 * Guild Legends — les pièces du repère (8 nov. 2026, décision de Théo).
 *
 * « Les prix doivent être fixes, mais les extensions du repère se débloquent avec l'augmentation du rang du repère.
 *   Et chaque pièce doit avoir une vraie utilité dans le jeu. »
 *
 * - Le rang du repère, c'est le niveau de la guilde : chaque pièce s'ouvre à un niveau donné.
 * - Le prix d'une pièce est fixe : il ne dépend ni du palier, ni du nombre de pièces déjà construites.
 *   Il est calé sur le revenu d'une guilde active au moment où la pièce s'ouvre (6 à 13 semaines de contrats),
 *   pour que chaque pièce reste un vrai projet, et que le repère ne soit jamais complet avant de longs mois.
 * - Chaque pièce a un effet concret sur les règles (recueil § 12 : moral et motivation d'abord ; sans neutraliser la
 *   composition des équipes, le potentiel des héros ni le recrutement). Les effets sont lus par le moteur avec `effet(g, cle)`.
 * - Chaque pièce ouvre aussi un lieu de vie, avec ses activités et ses scènes.
 */

// 10 nov. 2026, décision de Théo : « beaucoup moins de pièces (5 ou 6 en plus, au maximum), toutes utiles et bien travaillées,
// débloquées tous les 7 niveaux contre de l'argent, pour que les pièces soient plus grandes ». Chaque pièce réunit donc deux
// lieux de vie et leurs effets. Les prix sont une proposition (4 à 12 semaines de contrats au moment où la pièce s'ouvre).
const SALLES = [
  { cle: 'table', nom: 'La cuisine et la taverne', niveau: 7, prix: 4000, lieu: 'cuisines', lieux: ['cuisines', 'taverne'], etage: 'rdc',
    effet: "Des repas chauds et un comptoir pour se parler : un peu de moral pour chaque héros présent, chaque midi. Les tensions retombent plus vite, et les petits désaccords tournent moins souvent à la dispute.",
    regles: { moralRepas: 3, tension: 0.7, escalade: 0.65 } },
  { cle: 'soins', nom: "L'infirmerie et les bains", niveau: 14, prix: 12000, lieu: 'infirmerie', lieux: ['infirmerie', 'bains'], etage: 'etage',
    effet: "Des soins dignes de ce nom et de l'eau chaude : le repos après une blessure est un tiers plus court, le repos après une mission un quart plus court.",
    regles: { reposBlessure: 0.67, repos: 0.75 } },
  { cle: 'armes', nom: "La salle d'armes et la forge", niveau: 21, prix: 40000, lieu: 'salle_armes', lieux: ['salle_armes', 'forge'], etage: 'rdc',
    effet: "De vrais mannequins, des lames affûtées chaque semaine : l'entraînement fait progresser 60 % plus vite, et le risque de blessure en mission baisse d'un cinquième.",
    regles: { xpEntrainement: 1.6, blessure: 0.8 } },
  { cle: 'savoir', nom: 'La bibliothèque et la salle des cartes', niveau: 28, prix: 70000, lieu: 'bibliotheque', lieux: ['bibliotheque', 'salle_cartes'], etage: 'etage',
    effet: "Des livres, des cartes, des informateurs : la lecture fait progresser 60 % plus vite, les billets en langue inconnue sont toujours traduits, un contrat de plus au tableau chaque jour, et les imprévus des missions sont moins rudes.",
    regles: { xpLecture: 1.6, traduction: true, contrats: 1, imprevu: -5 } },
  { cle: 'ecuries', nom: 'Les écuries', niveau: 35, prix: 85000, lieu: 'ecuries', lieux: ['ecuries'], etage: 'dehors',
    effet: "Des chevaux à la guilde : tous les trajets sont un cinquième plus courts. Plus de temps sur place, et des lieux plus lointains à portée de mission.",
    regles: { trajet: 0.8 } },
  { cle: 'hall', nom: 'Le grand hall et son sanctuaire', niveau: 42, prix: 260000, lieu: 'grand_hall', lieux: ['grand_hall', 'sanctuaire'], etage: 'rdc',
    effet: "Une salle digne d'une guilde légendaire, et un lieu pour se recueillir : chaque contrat rapporte 5 % de PO en plus, un contrat de plus au tableau chaque jour, les mauvais souvenirs s'effacent plus vite et la fidélité se perd moins vite dans les moments difficiles.",
    regles: { bonusPO: 0.05, contrats: 1, souvenirsNegatifs: 0.7, perteFidelite: 0.75 } },
];
const PAR_CLE = Object.fromEntries(SALLES.map(s => [s.cle, s]));

const construites = g => g.salles || (g.salles = []);
const aSalle = (g, cle) => construites(g).includes(cle);

/* L'état de chaque pièce pour ce repère : construite, disponible (rang atteint) ou verrouillée. */
function etatSalles(g) {
  return SALLES.map(s => ({ ...s, etat: aSalle(g, s.cle) ? 'construite' : (g.niveau || 1) >= s.niveau ? 'disponible' : 'verrouillee' }));
}

/* Construire : le rang doit être atteint, la pièce pas déjà là, et les PO suffisantes. */
function construire(g, cle) {
  const s = PAR_CLE[cle];
  if (!s) return { ok: false, raison: 'Pièce inconnue.' };
  if (aSalle(g, cle)) return { ok: false, raison: `${s.nom} existe déjà.` };
  if ((g.niveau || 1) < s.niveau) return { ok: false, raison: `${s.nom} s'ouvre au rang ${s.niveau} du repère.` };
  if ((g.po || 0) < s.prix) return { ok: false, raison: `Il manque ${(s.prix - (g.po || 0)).toLocaleString('fr-FR')} PO.` };
  g.po -= s.prix; construites(g).push(cle);
  if (g.lieux) for (const l of s.lieux) if (!g.lieux.includes(l)) g.lieux.push(l);
  return { ok: true, salle: s };
}

/*
 * Effet d'une règle pour ce repère. Les multiplicateurs valent 1 sans la pièce, les bonus 0, les drapeaux false.
 * effet(g, 'trajet') → 0.8 avec les écuries, 1 sinon.
 */
const NEUTRE = { moralRepas: 0, reposBlessure: 1, xpEntrainement: 1, tension: 1, escalade: 1, xpLecture: 1, traduction: false,
  souvenirsNegatifs: 1, perteFidelite: 1, trajet: 1, blessure: 1, contrats: 0, imprevu: 0, repos: 1, bonusPO: 0 };
// Plusieurs pièces peuvent jouer sur la même règle : les bonus s'additionnent, les multiplicateurs se multiplient.
const ADDITIFS = new Set(['moralRepas', 'contrats', 'imprevu', 'bonusPO']);
function effet(g, regle) {
  let v = NEUTRE[regle];
  for (const cle of construites(g || {})) {
    const r = PAR_CLE[cle]?.regles; if (!r || !(regle in r)) continue;
    v = typeof v === 'boolean' ? v || r[regle] : ADDITIFS.has(regle) ? v + r[regle] : v * r[regle];
  }
  return v;
}

/* La prochaine pièce à s'ouvrir, pour dire au joueur ce qui l'attend au prochain rang. */
function prochaine(g) { return SALLES.find(s => (g.niveau || 1) < s.niveau) || null; }

module.exports = { SALLES, etatSalles, construire, effet, aSalle, prochaine };
