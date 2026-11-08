'use strict';
/*
 * Guild Legends — alliances, territoires et tournois (8 nov. 2026).
 *
 * Le cahier des charges (§ 13, § 20.6) fixe l'esprit : un multijoueur hybride, fait de compétition autour des missions,
 * de coopération, de territoires et de tournois, sans attaques directes permanentes. Les règles détaillées étaient
 * ouvertes. Théo a demandé de les trancher (« Go pour le point 5 ») : ce sont des propositions de Claude, réglées ici
 * dans PARAMS pour pouvoir les ajuster sans toucher au reste.
 *
 * Le jeu est fait pour un cercle d'amis (quelques guildes à une dizaine) : tout est pensé pour ce nombre-là.
 */
const R = require('./resolution');

const PARAMS = {
  alliances: {
    max: { inconnue: 1, locale: 2, regionale: 2, renommee: 3, legendaire: 3 },  // alliances simultanées selon le palier
    expirationInvitation: 72,      // heures pour accepter une proposition d'alliance
    preavisRupture: 48,            // heures entre l'annonce d'une rupture et sa prise d'effet
    delaiApresRupture: 24 * 14,    // pas de nouvelle alliance entre les deux mêmes guildes pendant 14 jours
    cohesion: 4,                   // bonus d'épreuve par paire de héros alliés dans une même mission (comme deux amis)
    prioriteContrat: 2,            // heures d'avance pour placer un héros sur un contrat partagé par un allié
  },
  territoires: {
    fenetre: 24 * 28,              // l'influence compte la réputation gagnée dans la région sur les 4 dernières semaines
    seuil: 20,                     // influence minimale pour tenir une région
    avanceDetenteur: 1.1,          // pour reprendre une région, il faut 10 % d'influence de plus que celui qui la tient
    bonusPO: 0.10,                 // +10 % de PO sur les contrats de la région tenue
    contratEnPlus: 1,              // un contrat de plus de cette région au tableau
    moralOrigine: 2,               // chaque midi, +2 de moral aux héros originaires de la région tenue
  },
  tournois: {
    taille: 3,                     // trois héros par équipe
    frais: { inconnue: 30, locale: 100, regionale: 250, renommee: 600, legendaire: 1500 },
    prixChambre: 2,                // la Chambre ajoute deux fois les frais d'une inscription à la cagnotte
    partage: [0.6, 0.3, 0.1],      // la cagnotte : 60 % au vainqueur, 30 % au finaliste, 10 % au troisième
    reputation: [12, 6, 3],
    manches: ['combat', 'aleatoire', 'combat'],   // trois manches ; la deuxième change à chaque match
    pouleMax: 6,                   // jusqu'à 6 équipes : tout le monde se rencontre ; au-delà, élimination directe
    pente: 6,                      // plus l'écart de score est grand, plus la manche est jouée d'avance
  },
};

/* ---------- Alliances ---------- */
const cleAlliance = (a, b) => [a, b].sort().join('|');

/* Proposer une alliance. etat : { alliances: { cle: { guildes, depuis, rompue? } }, invitations: [], ruptures: { cle: t } } */
function proposerAlliance(etat, de, vers, palierDe, t) {
  if (de === vers) throw new Error('Une guilde ne peut pas s\'allier à elle-même.');
  const cle = cleAlliance(de, vers);
  if (etat.alliances?.[cle] && !etat.alliances[cle].finJusqua) throw new Error('Vos deux guildes sont déjà alliées.');
  const fin = etat.ruptures?.[cle];
  if (fin && t - fin < PARAMS.alliances.delaiApresRupture) throw new Error(`Votre alliance a été rompue récemment : il faut attendre encore ${Math.ceil((PARAMS.alliances.delaiApresRupture - (t - fin)) / 24)} jours.`);
  for (const g of [de, vers]) if (alliesDe(etat, g, t).length >= PARAMS.alliances.max[palierDe(g)]) throw new Error(`${g} a déjà autant d'alliés que son palier le permet.`);
  (etat.invitations ||= []).push({ cle, de, vers, t, expire: t + PARAMS.alliances.expirationInvitation });
  return cle;
}
function accepterAlliance(etat, cle, guilde, palierDe, t) {
  const inv = (etat.invitations || []).find(i => i.cle === cle && i.vers === guilde && i.expire > t);
  if (!inv) throw new Error('Cette proposition d\'alliance n\'existe plus.');
  for (const g of [inv.de, inv.vers]) if (alliesDe(etat, g, t).length >= PARAMS.alliances.max[palierDe(g)]) throw new Error(`${g} a déjà autant d'alliés que son palier le permet.`);
  etat.invitations = etat.invitations.filter(i => i !== inv);
  (etat.alliances ||= {})[cle] = { guildes: [inv.de, inv.vers], depuis: t };
  return etat.alliances[cle];
}
/* Rompre : l'alliance tient encore 48 h, le temps de finir les missions communes. */
function rompreAlliance(etat, a, b, t) {
  const cle = cleAlliance(a, b), al = etat.alliances?.[cle];
  if (!al || al.finJusqua) throw new Error('Il n\'y a pas d\'alliance à rompre.');
  al.finJusqua = t + PARAMS.alliances.preavisRupture; al.rompuePar = a;
  return al;
}
function alliesDe(etat, g, t) {
  const out = [];
  for (const [cle, al] of Object.entries(etat.alliances || {})) {
    if (al.finJusqua && t >= al.finJusqua) { delete etat.alliances[cle]; (etat.ruptures ||= {})[cle] = al.finJusqua; continue; }
    if (al.guildes.includes(g)) out.push(al.guildes.find(x => x !== g));
  }
  return out;
}
const sontAllies = (etat, a, b, t) => alliesDe(etat, a, t).includes(b);
/* Bonus de cohésion d'une mission où se croisent des héros de guildes alliées (à ajouter aux relations de l'équipe). */
function cohesionAlliance(etat, guildesDesPostes, t) {
  const gs = [...new Set(guildesDesPostes.filter(Boolean))]; let paires = 0;
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) if (sontAllies(etat, gs[i], gs[j], t)) paires++;
  return Math.min(10, paires * PARAMS.alliances.cohesion);
}

/* ---------- Territoires ---------- */
/*
 * Chaque région de Runeterra est un territoire. L'influence d'une guilde dans une région, c'est la réputation qu'elle y a
 * gagnée en mission sur les 4 dernières semaines. Chaque lundi midi, on recompte : la guilde la plus influente tient la
 * région, si elle dépasse le seuil. Pour la reprendre à celle qui la tient, il faut 10 % de plus qu'elle : une région
 * tenue ne change pas de mains sur une seule bonne semaine.
 * gains : [{ guilde, region, reputation, t }]
 */
function influences(gains, t) {
  const out = {};
  for (const x of gains) if (t - x.t <= PARAMS.territoires.fenetre && t >= x.t) ((out[x.region] ||= {})[x.guilde] = (out[x.region][x.guilde] || 0) + x.reputation);
  return out;
}
function recompterTerritoires(detenteurs, gains, t) {
  const inf = influences(gains, t), changements = [], P = PARAMS.territoires;
  for (const region of new Set([...Object.keys(inf), ...Object.keys(detenteurs)])) {
    const scores = Object.entries(inf[region] || {}).sort((a, b) => b[1] - a[1]);
    const actuel = detenteurs[region] || null, scoreActuel = inf[region]?.[actuel] || 0;
    let nouveau = actuel;
    if (actuel && scoreActuel < P.seuil) nouveau = null;                     // la région n'est plus tenue
    const [premier, score] = scores[0] || [null, 0];
    if (premier && premier !== nouveau && score >= P.seuil && score >= (nouveau ? (inf[region][nouveau] || 0) * P.avanceDetenteur : 0) && score > (nouveau ? inf[region][nouveau] : 0)) nouveau = premier;
    if (nouveau !== actuel) changements.push({ region, avant: actuel, apres: nouveau });
    if (nouveau) detenteurs[region] = nouveau; else delete detenteurs[region];
  }
  return { detenteurs, changements, influences: inf };
}
/* Effets pour une guilde : bonus de PO sur un contrat, contrats en plus, moral des héros originaires. */
function effetsTerritoire(detenteurs, guilde) {
  const regions = Object.entries(detenteurs).filter(([, g]) => g === guilde).map(([r]) => r);
  return { regions, bonusPO: r => regions.includes(r) ? PARAMS.territoires.bonusPO : 0, contratsEnPlus: regions.length * PARAMS.territoires.contratEnPlus, moralOrigine: PARAMS.territoires.moralOrigine };
}

/* ---------- Tournois ---------- */
/*
 * Un tournoi par mois, le premier week-end. Chaque guilde inscrit trois héros présents au repère, et paie des frais
 * selon son palier. Jusqu'à 6 équipes, tout le monde se rencontre (poule) ; au-delà, élimination directe, têtes de série
 * selon le niveau des guildes. Un match se joue en trois manches : combat, une manche tirée au hasard (poursuite,
 * siège, diplomatie…), combat. Chaque manche oppose le score de l'une à celui de l'autre, avec la même formule que les
 * missions ; la première à deux manches gagne. Une équipe dont un héros n'est plus là (blessé, en mission) joue à deux,
 * avec la pénalité d'un poste vide ; une équipe sans aucun héros déclare forfait.
 * equipe : { guilde, heros: [{ nom, stats, moral }] }
 */
const TYPES_ALEATOIRES = ['poursuite', 'siege', 'diplomatie', 'discretion', 'nuee', 'voyage'];
function manche(a, b, type, rng) {
  const sa = a.heros.length ? R.scoreEpreuve(a.heros, { type, difficulte: 0 }).score - (PARAMS.tournois.taille - a.heros.length) * 6 : -1e9;
  const sb = b.heros.length ? R.scoreEpreuve(b.heros, { type, difficulte: 0 }).score - (PARAMS.tournois.taille - b.heros.length) * 6 : -1e9;
  const p = 1 / (1 + Math.exp(-(sa - sb) / PARAMS.tournois.pente));
  return { type, gagnant: rng() < p ? 'a' : 'b', scoreA: Math.round(sa), scoreB: Math.round(sb), chanceA: Math.round(p * 100) };
}
function match(a, b, rng) {
  if (!a.heros.length || !b.heros.length) return { a: a.guilde, b: b.guilde, gagnant: a.heros.length ? a.guilde : b.guilde, forfait: true, manches: [] };
  const manches = []; let va = 0, vb = 0;
  for (const m of PARAMS.tournois.manches) {
    if (va === 2 || vb === 2) break;
    const type = m === 'aleatoire' ? TYPES_ALEATOIRES[Math.floor(rng() * TYPES_ALEATOIRES.length)] : m;
    const r = manche(a, b, type, rng); manches.push(r); r.gagnant === 'a' ? va++ : vb++;
  }
  return { a: a.guilde, b: b.guilde, gagnant: va > vb ? a.guilde : b.guilde, manches };
}
/* Le tournoi entier. equipes : [{ guilde, niveau, heros }]. Renvoie le classement, les matchs et la répartition des gains. */
function jouerTournoi(equipes, rng, palierDe) {
  const P = PARAMS.tournois, matchs = [];
  const cagnotte = equipes.reduce((t, e) => t + P.frais[palierDe(e.guilde)], 0) + P.prixChambre * Math.max(...equipes.map(e => P.frais[palierDe(e.guilde)]));
  let classement;
  if (equipes.length <= P.pouleMax) {
    const pts = Object.fromEntries(equipes.map(e => [e.guilde, { v: 0, manches: 0 }]));
    for (let i = 0; i < equipes.length; i++) for (let j = i + 1; j < equipes.length; j++) {
      const m = match(equipes[i], equipes[j], rng); matchs.push(m); pts[m.gagnant].v++;
      for (const x of m.manches) pts[x.gagnant === 'a' ? m.a : m.b].manches++;
    }
    // Égalité de victoires : le plus de manches gagnées, puis la confrontation directe.
    classement = equipes.map(e => e.guilde).sort((x, y) => pts[y].v - pts[x].v || pts[y].manches - pts[x].manches
      || (matchs.find(m => [m.a, m.b].includes(x) && [m.a, m.b].includes(y))?.gagnant === x ? -1 : 1));
  } else {
    let tour = [...equipes].sort((x, y) => y.niveau - x.niveau); const elimines = [];
    while (tour.length > 1) {
      const suivant = [];
      if (tour.length % 2) suivant.push(tour.shift());                     // la tête de série exempte si nombre impair
      while (tour.length) { const a = tour.shift(), b = tour.pop(); const m = match(a, b, rng); matchs.push(m); suivant.push(m.gagnant === a.guilde ? a : b); elimines.unshift(m.gagnant === a.guilde ? b.guilde : a.guilde); }
      tour = suivant;
    }
    classement = [tour[0].guilde, ...elimines];
  }
  const gains = classement.slice(0, 3).map((g, i) => ({ guilde: g, po: Math.round(cagnotte * P.partage[i]), reputation: P.reputation[i] }));
  return { classement, matchs, cagnotte, gains };
}

module.exports = { PARAMS, proposerAlliance, accepterAlliance, rompreAlliance, alliesDe, sontAllies, cohesionAlliance, influences, recompterTerritoires, effetsTerritoire, match, jouerTournoi };
