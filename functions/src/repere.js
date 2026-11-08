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

const SALLES = [
  { cle: 'cuisines', nom: 'Les cuisines', niveau: 2, prix: 400, lieu: 'cuisines',
    effet: 'Des repas chauds tous les jours : chaque héros présent au repère gagne un peu de moral, chaque midi.',
    regles: { moralRepas: 2 } },
  { cle: 'infirmerie', nom: "L'infirmerie", niveau: 4, prix: 900, lieu: 'infirmerie',
    effet: 'Des soins dignes de ce nom : le repos après une blessure est un tiers plus court.',
    regles: { reposBlessure: 0.67 } },
  { cle: 'salle_armes', nom: "La salle d'armes", niveau: 6, prix: 2400, lieu: 'salle_armes',
    effet: "De vrais mannequins, des armes d'exercice : l'entraînement au repère fait progresser 60 % plus vite.",
    regles: { xpEntrainement: 1.6 } },
  { cle: 'taverne', nom: 'La taverne', niveau: 8, prix: 3000, lieu: 'taverne',
    effet: "Un endroit pour boire un verre et se parler : les tensions retombent plus vite, et les petits désaccords tournent moins souvent à la dispute.",
    regles: { tension: 0.7, escalade: 0.65 } },
  { cle: 'bibliotheque', nom: 'La bibliothèque', niveau: 10, prix: 4500, lieu: 'bibliotheque',
    effet: "Des livres, du calme : la lecture fait progresser 60 % plus vite, et les billets écrits dans une langue inconnue sont toujours traduits.",
    regles: { xpLecture: 1.6, traduction: true } },
  { cle: 'sanctuaire', nom: 'Le sanctuaire', niveau: 12, prix: 6500, lieu: 'sanctuaire',
    effet: "Un lieu pour se recueillir : les mauvais souvenirs s'effacent plus vite, et la fidélité se perd moins vite dans les moments difficiles.",
    regles: { souvenirsNegatifs: 0.7, perteFidelite: 0.75 } },
  { cle: 'ecuries', nom: 'Les écuries', niveau: 14, prix: 12000, lieu: 'ecuries',
    effet: "Des chevaux à la guilde : tous les trajets sont un cinquième plus courts. Plus de temps sur place, et des lieux plus lointains à portée de mission.",
    regles: { trajet: 0.8 } },
  { cle: 'forge', nom: 'La forge', niveau: 17, prix: 18000, lieu: 'forge',
    effet: "Des armures entretenues et des lames affûtées chaque semaine : le risque de blessure en mission baisse d'un cinquième.",
    regles: { blessure: 0.8 } },
  { cle: 'salle_cartes', nom: 'La salle des cartes', niveau: 20, prix: 26000, lieu: 'salle_cartes',
    effet: "Cartes, rapports et informateurs : un contrat de plus au tableau chaque jour, et les imprévus des missions sont moins rudes.",
    regles: { contrats: 1, imprevu: -5 } },
  // Le nombre de places suit le niveau de la guilde (25 au niveau 50, décision de Théo) : l'aile nord ne l'augmente pas.
  { cle: 'aile_nord', nom: "L'aile nord", niveau: 23, prix: 45000, lieu: 'aile_nord',
    effet: 'Une vraie chambre pour chacun, loin du bruit : le repos après une mission est un quart plus court.',
    regles: { repos: 0.75 } },
  // Paliers Renommée et Légendaire (8 nov. 2026). Revenus hebdomadaires de référence : 6 300 PO et 22 700 PO.
  { cle: 'bains', nom: 'Les bains', niveau: 27, prix: 55000, lieu: 'bains',
    effet: "De l'eau chaude et des pierres tièdes : chaque midi, un peu plus de moral pour chaque héros présent (en plus des repas).",
    regles: { moralRepas: 2 } },
  { cle: 'galerie', nom: 'La galerie des trophées', niveau: 31, prix: 75000, lieu: 'galerie',
    effet: 'Les trophées impressionnent les commanditaires : chaque contrat rapporte 5 % de PO en plus.',
    regles: { bonusPO: 0.05 } },
  { cle: 'observatoire', nom: "L'observatoire", niveau: 36, prix: 150000, lieu: 'observatoire',
    effet: "Des lunettes, des cartes du ciel, des informateurs partout : les imprévus des missions sont encore moins rudes.",
    regles: { imprevu: -5 } },
  { cle: 'grand_hall', nom: 'Le grand hall', niveau: 42, prix: 260000, lieu: 'grand_hall',
    effet: "Une salle digne d'une guilde légendaire, où la Chambre envoie ses émissaires : un contrat de plus au tableau chaque jour.",
    regles: { contrats: 1 } },
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
  if (g.lieux && !g.lieux.includes(s.lieu)) g.lieux.push(s.lieu);
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
