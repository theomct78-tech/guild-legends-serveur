'use strict';
/*
 * Guild Legends — effets des spécialités Healer et Éclaireur (proposition du 7 nov. 2026).
 * Fonctions pures, sans Firebase. Toutes les valeurs numériques sont dans PARAMS :
 * elles restent à équilibrer (point 10 du cahier) et peuvent être changées sans toucher au code.
 *
 * Principe : une spécialité principale compte pleinement, une spécialité « d'appoint » à moitié.
 */

const PARAMS = {
  // Poids d'un héros selon sa spécialité
  poids: { principal: 1, appoint: 0.5 },

  // Blessures : niveaux et durée de convalescence de base, en jours de jeu, sans soignant
  blessures: {
    legere:   { jours: 2,  label: 'Blessure légère' },
    grave:    { jours: 6,  label: 'Blessure grave' },
    critique: { jours: 14, label: 'Blessure critique' },
  },
  // Au repère : chaque point de soin accélère la guérison, avec rendement décroissant
  repere: {
    bonusParPoint: 0.6,      // 1 Healer présent : guérison 1,6 fois plus rapide
    plafondVitesse: 3,       // jamais plus de 3 fois plus vite, quel que soit le nombre de soignants
    patientsParPoint: 3,     // un Healer suit au plus 3 blessés à pleine efficacité
    relationParJour: 1,      // lien soignant / blessé renforcé chaque jour de soins
  },
  // En mission
  mission: {
    reductionMortParPoint: 0.35,     // 1 Healer : risque de mort × 0,65
    plancherMort: 0.25,              // jamais moins d'un quart du risque initial
    chanceAttenuerParPoint: 0.5,     // chance qu'une blessure soit réduite d'un niveau
    reductionEmbuscadeParPoint: 0.4, // 1 Éclaireur : risque d'embuscade × 0,6
    plancherEmbuscade: 0.2,
    bonusButinParPoint: 0.1,         // chance d'objet +10 % relatifs par point d'éclaireur
  },
  // Au repère, les éclaireurs rapportent des pistes de missions privées
  pistes: { chanceParPointParJour: 0.15, plafond: 0.5 },
};

const NIVEAUX = ['legere', 'grave', 'critique'];

/* Points de soin ou d'éclaireur d'un groupe de héros. */
function points(heros, famille) {
  const principal = famille === 'soin' ? 'Healer' : 'Éclaireur';
  const appoint = famille === 'soin' ? "Soins d'appoint" : "Éclaireur d'appoint";
  return heros.reduce((t, h) => {
    const s = h.specialites || [];
    if (s.includes(principal)) return t + PARAMS.poids.principal;
    if (s.includes(appoint)) return t + PARAMS.poids.appoint;
    return t;
  }, 0);
}

/* ---------- Au repère ---------- */

/*
 * Soignants disponibles : présents au repère, ni blessés, ni en mission, ni en vacances.
 * Vitesse de guérison du jour pour l'ensemble des blessés, partagée si les blessés sont nombreux.
 */
function vitesseGuerison(presents, blesses) {
  const soignants = presents.filter(h => !h.blessure && h.statut === 'repere');
  const pts = points(soignants, 'soin');
  if (pts === 0 || blesses.length === 0) return { vitesse: 1, soignants: [] };
  const capacite = pts * PARAMS.repere.patientsParPoint;
  const efficacite = Math.min(1, capacite / blesses.length);
  const vitesse = Math.min(PARAMS.repere.plafondVitesse, 1 + pts * PARAMS.repere.bonusParPoint * efficacite);
  return { vitesse, soignants: soignants.filter(h => points([h], 'soin') > 0) };
}

/* Avance la convalescence d'un blessé d'une journée. Renvoie le nouvel état et, s'il guérit, null. */
function avancerConvalescence(blessure, vitesse) {
  const reste = Math.max(0, blessure.joursRestants - vitesse);
  return reste === 0 ? null : { ...blessure, joursRestants: Math.round(reste * 100) / 100 };
}

function nouvelleBlessure(niveau) {
  if (!PARAMS.blessures[niveau]) throw new Error(`Niveau de blessure inconnu : ${niveau}`);
  return { niveau, joursRestants: PARAMS.blessures[niveau].jours };
}

/* Chance par jour qu'un éclaireur présent au repère rapporte une piste de mission privée. */
function chancePiste(presents) {
  const dispo = presents.filter(h => !h.blessure && h.statut === 'repere');
  return Math.min(PARAMS.pistes.plafond, points(dispo, 'eclaireur') * PARAMS.pistes.chanceParPointParJour);
}

/* ---------- En mission ---------- */

/* Multiplicateurs appliqués à la résolution d'une mission, selon l'équipe engagée. */
function modificateursMission(equipe) {
  const soin = points(equipe, 'soin');
  const ecl = points(equipe, 'eclaireur');
  const m = PARAMS.mission;
  return {
    pointsSoin: soin,
    pointsEclaireur: ecl,
    risqueMort: Math.max(m.plancherMort, 1 - soin * m.reductionMortParPoint),
    chanceAttenuerBlessure: Math.min(1, soin * m.chanceAttenuerParPoint),
    risqueEmbuscade: Math.max(m.plancherEmbuscade, 1 - ecl * m.reductionEmbuscadeParPoint),
    bonusButin: 1 + ecl * m.bonusButinParPoint,
    conditionsRevelees: ecl >= PARAMS.poids.principal,   // un vrai éclaireur révèle les conditions avant le départ
    conditionsPartielles: ecl > 0 && ecl < PARAMS.poids.principal,
  };
}

/* Une blessure subie en mission peut être réduite d'un niveau grâce aux soignants (tirage fourni). */
function attenuerBlessure(niveau, mods, tirage) {
  const i = NIVEAUX.indexOf(niveau);
  if (i <= 0 || tirage >= mods.chanceAttenuerBlessure) return niveau;
  return NIVEAUX[i - 1];
}

/*
 * Poste de mission « Healer » ou « Éclaireur » : qui peut l'occuper, et avec quelle efficacité.
 * Le rôle exigé par une mission se lit sur le rôle du site ou sur la spécialité.
 */
function efficacitePoste(heros, poste) {
  const s = heros.specialites || [];
  if (poste === 'Healer') return s.includes('Healer') ? 1 : s.includes("Soins d'appoint") ? PARAMS.poids.appoint : 0;
  if (poste === 'Éclaireur') return s.includes('Éclaireur') ? 1 : s.includes("Éclaireur d'appoint") ? PARAMS.poids.appoint : 0;
  return heros.role === poste || heros.role_secondaire === poste ? (heros.role === poste ? 1 : 0.75) : 0;
}

module.exports = {
  PARAMS, points, vitesseGuerison, avancerConvalescence, nouvelleBlessure, chancePiste,
  modificateursMission, attenuerBlessure, efficacitePoste,
};
