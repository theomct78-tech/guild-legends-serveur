'use strict';
/*
 * Guild Legends — moteur de la vie de guilde (8 nov. 2026, PROPOSITION soumise à validation).
 *
 * Principe : la vie avance par créneaux de 2 heures réelles, calée sur l'heure de Paris (la nuit, le repère dort).
 * Rien ne tourne en continu sur le serveur : à chaque visite, on rejoue les créneaux écoulés depuis la dernière,
 * avec un hasard dérivé de l'identifiant de la guilde et du numéro de créneau. Le résultat est donc toujours le même,
 * quel que soit le moment où on le calcule.
 *
 * À chaque créneau, chaque héros présent choisit une activité selon ses besoins, sa personnalité, les lieux du repère
 * et les gens qui s'y trouvent déjà (il évite ceux qu'il ne supporte pas). Les héros réunis au même endroit
 * interagissent ; l'issue dépend de leur compatibilité, de leur relation et de leur humeur. Les moments notables
 * deviennent des scènes écrites dans la chronique ; le reste est compté comme routine.
 *
 * Le moral suit une cible : une base, l'état des besoins, le salaire, les relations présentes, et des « souvenirs »
 * datés (une mission réussie, une dispute, une tournée offerte) qui s'effacent avec le temps. Chaque souvenir garde
 * son libellé : le jeu peut toujours dire au joueur ce qui pèse sur le moral d'un héros.
 */
const { choisirScene, replique } = require('./scenes');
const MA = require('./maitre');
const { reposApresMission } = require('./missions');
const PR = require('./progression');
const XP_ACTIVITE = { entrainement: PR.XP.entrainement, lecture: PR.XP.lecture, discussion: PR.XP.discussion };
const { vivreArcs } = require('./arcs');
const Q = require('./quetes');
const B = require('./billets');
const RP = require('./repere');
const F = require('./langue');
let BILLETS = null; try { BILLETS = B.chargerBillets(); } catch { BILLETS = null; }

const PARAMS = {
  creneau: 2,                       // heures réelles par créneau
  fuseau: 'Europe/Paris',
  nuitDebut: 0, nuitFin: 6,         // heures locales où le repère dort
  rattrapageDetailleMax: 72,        // au-delà, les heures sont résumées (pas de scènes, besoins et moral seulement)
  inertieMoral: 0.12,               // part de l'écart à la cible rattrapée à chaque créneau
  moralBase: 55,
  moralJoie: 1.5,                   // poids des raisons positives du moral (audit du 11 nov.)
  temperature: 7,                   // plus elle est basse, plus le héros suit strictement ses envies
  chanceInteraction: 0.55,          // chance qu'une paire réunie au même endroit interagisse
  chanceSceneSolo: 0.22,            // chance qu'une activité seule donne une scène plutôt qu'une ligne de routine
  delaiReutilisationScene: 336,     // heures avant qu'une même scène puisse revenir (14 jours : constat de la simulation de 3 mois)
  dureeCarte: 24,                   // heures avant qu'une demande sans réponse prenne sa réponse par défaut (24 h : simulation de 3 mois, joueurs occasionnels)
  factureChance: 0.3,               // une dispute fraîche avec un gamin dedans finit au bourg une fois sur trois…
  factureVille: 0.1,                // par créneau où un gamin traîne au bourg
  factureEcart: 24 * 5,             // …pas plus d'une facture tous les cinq jours
  dureeCarteDepart: 72,             // une lettre de départ attend trois jours : on ne perd pas un héros pour un week-end sans connexion
  fideliteDepart: 20,               // en dessous, le héros écrit sa lettre de départ
  usure: { energie: 6, social: 3.5, elan: 2.2, loisir: 5 }, // baisse des besoins par créneau éveillé (avant personnalité)
  echelleGains: 0.5,                // les activités comblent un besoin sans le saturer : il faut choisir
};

/* ---------- Lieux et activités ---------- */
// Lieux du repère de base ; les infrastructures en ajouteront (bibliothèque, taverne, sanctuaire, infirmerie…).
const LIEUX = {
  dortoirs: 'les dortoirs', salle_commune: 'la salle commune', cour: 'la cour d\'entraînement',
  remparts: 'les remparts', ville: 'la ville', bibliotheque: 'la bibliothèque', taverne: 'la taverne du repère',
  sanctuaire: 'le sanctuaire', infirmerie: 'l\'infirmerie', cuisines: 'les cuisines',
  salle_armes: 'la salle d\'armes', ecuries: 'les écuries', forge: 'la forge', salle_cartes: 'la salle des cartes', aile_nord: 'l\'aile nord',
  bains: 'les bains', galerie: 'la galerie des trophées', observatoire: 'l\'observatoire', grand_hall: 'le grand hall',
  brief: 'la salle de brief', jardin: 'le jardin',
};
const LIEUX_DE_BASE = ['dortoirs', 'salle_commune', 'cour', 'remparts', 'ville', 'brief', 'jardin'];

// gains : effet sur les besoins (énergie, social, élan = envie de progresser, loisir) ; lieux possibles par ordre de préférence.
const ACTIVITES = {
  dormir:       { lieux: ['dortoirs'], gains: { energie: 30, loisir: 2 }, nuit: true },
  repos:        { lieux: ['dortoirs', 'aile_nord', 'bains', 'jardin', 'remparts'], gains: { energie: 14, loisir: 4 } },
  entrainement: { lieux: ['salle_armes', 'cour'], gains: { energie: -12, elan: 26, loisir: -2 } },
  discussion:   { lieux: ['salle_commune', 'cuisines', 'taverne', 'forge', 'salle_cartes', 'grand_hall', 'galerie'], gains: { energie: -2, social: 22, loisir: 6 } },
  jeux:         { lieux: ['taverne', 'salle_commune'], gains: { energie: -4, social: 14, loisir: 20 } },
  lecture:      { lieux: ['bibliotheque', 'salle_cartes', 'observatoire', 'salle_commune', 'remparts'], gains: { energie: 2, elan: 8, loisir: 14 } },
  ville:        { lieux: ['ville'], gains: { energie: -6, social: 8, loisir: 24 } },
  solitude:     { lieux: ['jardin', 'remparts', 'ecuries', 'forge'], gains: { energie: 6, loisir: 10 } },
  recueillement:{ lieux: ['sanctuaire', 'jardin', 'remparts'], gains: { energie: 6, loisir: 8, elan: 4 } },
  soins:        { lieux: ['infirmerie', 'dortoirs'], gains: { energie: 10 } },
  // Placé sur un contrat : on prépare le départ en salle de brief (cartes, équipement, consignes), jusqu'à l'heure de partir.
  brief:        { lieux: ['brief'], gains: { energie: 2, elan: 8 } },
};

// Les lieux à ciel ouvert, et les activités qui se font à plusieurs.
const DEHORS = new Set(['cour', 'remparts', 'jardin']);
const SOCIALES = new Set(['jeux', 'discussion']);

// Attirance des traits pour les activités (s'ajoute à l'utilité).
const GOUTS = {
  FIER: { entrainement: 6 }, HONORABLE: { entrainement: 3 }, CUPIDE: { jeux: 4, ville: 3 }, MELANCOLIQUE: { solitude: 8, lecture: 3 },
  FARCEUR: { jeux: 6, discussion: 4 }, LOYAL: {}, RANCUNIER: {}, IMPULSIF: { jeux: 3, ville: 3 }, CALCULATEUR: { lecture: 5 },
  CURIEUX: { lecture: 8, ville: 5 }, PROTECTEUR: { entrainement: 3 }, TACITURNE: { solitude: 9, discussion: -6, jeux: -5 },
  BAVARD: { discussion: 10 }, VANITEUX: { ville: 4, jeux: 3 }, CYNIQUE: { solitude: 2 }, IDEALISTE: { lecture: 2, discussion: 2 },
  IMPLACABLE: { entrainement: 8 }, BIENVEILLANT: { discussion: 5 }, LIBRE: { ville: 9, solitude: 3 }, HANTE: { solitude: 6, recueillement: 4 },
  SANGUINAIRE: { entrainement: 9 }, JOUEUR: { jeux: 8 }, GOURMAND: { discussion: 4 }, DEVOT: { recueillement: 12 },
  ERUDIT: { lecture: 12 }, REBELLE: { ville: 5 }, CHARMEUR: { discussion: 6, ville: 4 }, MEFIANT: { solitude: 4 },
  PATIENT: { recueillement: 4, lecture: 3 }, FANATIQUE: { recueillement: 6, entrainement: 4 }, ENJOUE: { jeux: 5, discussion: 4 },
  SAUVAGE: { solitude: 5, ville: -4, lecture: -6 }, ARISTOCRATE: { lecture: 3, ville: 3 }, MERCENAIRE: { entrainement: 4, jeux: 3 },
};
const GOUTS_MOTIVATION = { savoir: { lecture: 6 }, pouvoir: { entrainement: 6 }, gloire: { entrainement: 4 }, plaisir: { jeux: 6, ville: 4 }, liberte: { ville: 5 }, vengeance: { entrainement: 5 }, redemption: { recueillement: 4 }, appartenance: { discussion: 5 } };

/* ---------- Hasard déterministe ---------- */
function graine(texte) { let h = 2166136261; for (const c of String(texte)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rngDepuis(texte) { let s = graine(texte) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const borne = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const cle = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function heureLocale(t) {
  const d = new Date(t * 3600 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: PARAMS.fuseau }).formatToParts(d);
  return Number(parts.find(x => x.type === 'hour').value) % 24;
}
const estNuit = t => { const h = heureLocale(t); return h >= PARAMS.nuitDebut && h < PARAMS.nuitFin; };

/* ---------- Création ---------- */
/*
 * h : { id, nom, champion, univers ('classic' ou nom de gamme), niveau, salaire, attente, axes, traits, motivation, regions }
 * Les liens du champion (famille, amour, rival…) ne valent qu'entre héros du même univers : Lux Star Guardian
 * n'est pas la sœur de Garen classique. Entre univers différents, ils se « reconnaissent » sans se connaître.
 */
function creerHeros(h, t = null) {
  return {
    arrivee: t,
    ...h,
    besoins: { energie: 80, social: 60, elan: 60, loisir: 60 },
    moral: 62, fidelite: h.traits.includes('LOYAL') ? 75 : h.traits.includes('LIBRE') || h.traits.includes('MERCENAIRE') ? 50 : 60,
    souvenirs: [], etat: 'present', jusqua: null, activite: null, lieu: null, routine: {},
  };
}

const VALEUR_LIEN = { famille: 60, amour: 50, ami: 45, mentor: 40, eleve: 40, rival: 0, ennemi: -60 };

/* Le nom qui suit « maître » ou « maîtresse » : des lettres, une apostrophe, un tiret, une espace ; 20 signes au plus. */
function nomMaitre(n) {
  const x = String(n || '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}][\p{L}' -]{0,19}$/u.test(x) ? x[0].toUpperCase() + x.slice(1) : null;
}
function creerGuilde({ id, nom = 'la guilde', region = 'demacia', niveau = 1, po = 0, or = undefined, lieux = LIEUX_DE_BASE, t, heros, liens = {}, seConnaissent = false, chien = null, maitre = null }) {
  const g = { id, nom, region, maitre: { titre: maitre?.titre === 'maîtresse' ? 'maîtresse' : 'maître', billetsDoux: maitre?.billetsDoux !== false, nom: nomMaitre(maitre?.nom) }, monde: creerMonde(id, region, chien), memoire: [], niveau, po: or ?? po, lieux: [...lieux], t, heros: heros.map(h => creerHeros(h, t)), relations: {}, cartes: [], chronique: [], usage: {}, soirees: [], seqCarte: 0 };
  for (let i = 0; i < g.heros.length; i++) for (let j = i + 1; j < g.heros.length; j++) relationInitiale(g, g.heros[i], g.heros[j], liens);
  if (seConnaissent) for (const r of Object.values(g.relations)) r.rencontres = Math.max(r.rencontres, 5);
  return g;
}

/* Un nouveau venu : il ne connaît encore personne (sauf ses liens du même univers). */
function ajouterHeros(g, h, liens = {}) {
  const n = creerHeros(h, g.t);
  memoriser(g, { type: 'arrivee', heros: [n.id] });
  for (const o of g.heros) relationInitiale(g, n, o, liens);
  g.heros.push(n);
  souvenir(n, g.t, 4, 'Un nouveau départ', 48); n.aRaconter = 'arrivee';
  return n;
}

/* liens : { Champion: [{champion, type}] } (base des personnalités) */
function relationInitiale(g, a, b, liens) {
  const k = cle(a.id, b.id);
  let type = null;
  if (a.univers === b.univers) {
    const l = (liens[a.champion] || []).find(x => x.champion === b.champion) || (liens[b.champion] || []).find(x => x.champion === a.champion);
    if (l) type = l.type === 'eleve' ? 'mentor' : l.type; // « mentor » désigne le lien maître-élève, quel que soit le sens
  }
  let aff = type ? VALEUR_LIEN[type] : 0;
  if (!type) {
    if (a.regions.deteste.includes(origine(b)) || b.regions.deteste.includes(origine(a))) aff -= 15;
    if (origine(a) && origine(a) === origine(b)) aff += 10;
  }
  g.relations[k] = { aff, tension: 0, type, rencontres: type ? 10 : 0, reconnaissance: !type && a.champion !== b.champion && a.univers !== b.univers && sontLies(liens, a, b) };
}
const origine = h => h.regions.aime[0] || null;
const sontLies = (liens, a, b) => (liens[a.champion] || []).some(x => x.champion === b.champion) || (liens[b.champion] || []).some(x => x.champion === a.champion);
const relation = (g, a, b) => g.relations[cle(a.id, b.id)];

/* ---------- Le monde du repère et sa mémoire ----------
 * Pour que la chronique parle de CETTE guilde : le bourg voisin, le chien du repère (que le joueur nomme), la saison et le temps qu'il fait,
 * et les événements récents (missions, blessures, disputes, arrivées, soirées) que les scènes peuvent rappeler.
 */
const BOURGS = { demacia: 'Uwendale', noxus: 'Drugne', freljord: 'Quchar', ionia: 'Puboe', piltover: 'Mid Town', zaun: 'les Failles', bilgewater: 'Port-aux-Rats', shurima: "Bel'zhun", targon: 'Rakkor', ixtal: 'Ixaocan', bandle: 'Bandle' };
// Le chien du repère : chaque joueur le nomme à la fondation (et peut le renommer). Sans nom choisi, la guilde en reçoit un.
const CHIENS = ['Biscuit', 'Capitaine', 'Pruneau', 'Brindille', 'Fenouil', 'Grimoire', 'Pétoche', 'Cendre', 'Noisette', 'Baron', 'Tartine', 'Gamelle'];
const NOM_CHIEN = /^[\p{L}][\p{L}' -]{0,19}$/u;
function nommerChien(g, nom) {
  const n = String(nom || '').trim().replace(/\s+/g, ' ');
  if (!NOM_CHIEN.test(n)) throw new Error('Un nom de chien : 1 à 20 lettres (espaces, tirets et apostrophes permis).');
  const ancien = g.monde.chien; g.monde.chien = n[0].toUpperCase() + n.slice(1);
  if (ancien && ancien !== g.monde.chien) (g.chronique ||= []).push({ t: g.t, lieu: 'cour', importance: 1, texte: `Le chien du repère répond désormais au nom de ${g.monde.chien}. Il lui faudra quelques jours pour s'y faire.` });
  return g.monde.chien;
}
const METEOS = { hiver: ['neige', 'gel', 'brume', 'soleil'], printemps: ['pluie', 'soleil', 'vent', 'brume'], ete: ['soleil', 'chaleur', 'orage', 'soleil'], automne: ['pluie', 'vent', 'brume', 'soleil'] };
function creerMonde(id, region, chien) {
  const r = rngDepuis(`${id}#monde`);
  return { bourg: BOURGS[region] || 'le bourg voisin', chien: chien ? String(chien).trim() : CHIENS[Math.floor(r() * CHIENS.length)] };
}
function saison(t) { const m = new Date(t * 3600000).getUTCMonth(); return m < 2 || m === 11 ? 'hiver' : m < 5 ? 'printemps' : m < 8 ? 'ete' : 'automne'; }
function meteo(g) { const s = saison(g.t), l = METEOS[s]; return { saison: s, temps: l[Math.floor(rngDepuis(`${g.id}#meteo#${Math.floor(g.t / 24)}`)() * l.length)] }; }
function memoriser(g, ev) { (g.memoire ||= []).push({ t: g.t, ...ev }); if (g.memoire.length > 60) g.memoire.shift(); }

/* ---------- Compatibilité de deux tempéraments (fixe, de −30 à +30) ---------- */
function compatibilite(a, b) {
  const A = a.axes, B = b.axes, ta = new Set(a.traits), tb = new Set(b.traits);
  const deux = (x, y) => (ta.has(x) && tb.has(y)) || (ta.has(y) && tb.has(x));
  const un = x => (ta.has(x) ? 1 : 0) + (tb.has(x) ? 1 : 0);
  let c = 0;
  if (A.Te > 65 && B.Te > 65) c -= 8;                                     // deux sanguins : étincelles
  if (Math.abs(A.Di - B.Di) > 55) c -= 6;                                 // la règle contre l'insolence
  if ((ta.has('FARCEUR') && B.Di > 70) || (tb.has('FARCEUR') && A.Di > 70)) c -= 7;
  if ((ta.has('REBELLE') && B.Di > 80) || (tb.has('REBELLE') && A.Di > 80)) c -= 5;
  if (deux('BAVARD', 'TACITURNE')) c -= 8;
  if (Math.abs(A.So - B.So) < 20) c += 4;
  if (A.Al > 65 && B.Al > 65) c += 6;
  if (A.Al < 30 && B.Al < 30) c -= 3;
  c += 5 * un('BIENVEILLANT') + 4 * un('ENJOUE') - 4 * un('MEFIANT') - 3 * un('FANATIQUE');
  if (deux('MELANCOLIQUE', 'BIENVEILLANT')) c += 6;
  if (deux('ARISTOCRATE', 'SAUVAGE') || deux('ARISTOCRATE', 'REBELLE')) c -= 6;
  if (deux('HONORABLE', 'MERCENAIRE') || deux('HONORABLE', 'CALCULATEUR')) c -= 5;
  if (deux('IDEALISTE', 'CYNIQUE')) c -= 5;
  if (deux('SANGUINAIRE', 'IDEALISTE') || deux('SANGUINAIRE', 'BIENVEILLANT')) c -= 5;
  if (deux('VANITEUX', 'CYNIQUE')) c -= 4;
  if (deux('ERUDIT', 'CURIEUX')) c += 6;
  if (deux('JOUEUR', 'JOUEUR') || deux('FARCEUR', 'FARCEUR') || deux('FARCEUR', 'ENJOUE')) c += 5;
  if (a.motivation === b.motivation) c += 4;
  return borne(c, -30, 30);
}

/* ---------- Souvenirs et moral ---------- */
function souvenir(h, t, valeur, libelle, demiVie = 24) { h.souvenirs.push({ t, valeur, libelle, demiVie }); }
const poids = (s, t) => s.valeur * Math.pow(0.5, (t - s.t) / s.demiVie);

/* Ce qui pèse sur le moral d'un héros, du plus fort au plus faible. */
function raisonsMoral(g, h, t = g.t) {
  const r = [];
  const b = h.besoins;
  const manque = [['energie', 'Épuisement'], ['social', 'Solitude'], ['elan', 'L\'impression de stagner'], ['loisir', 'L\'ennui']];
  for (const [k, lib] of manque) if (b[k] < 35) r.push({ libelle: lib, valeur: -Math.round((35 - b[k]) / 3) });
  const moy = (b.energie + b.social + b.elan + b.loisir) / 4;
  if (moy > 70) r.push({ libelle: 'Bien dans son quotidien', valeur: Math.round((moy - 70) / 3) });
  if (h.salaire != null && h.attente) {
    const ratio = h.salaire / h.attente, fois = h.motivation === 'or' || h.traits.includes('CUPIDE') ? 2 : 1;
    if (ratio < 0.95) r.push({ libelle: 'Un salaire en dessous de ses attentes', valeur: -Math.round((0.95 - ratio) * 30 * fois) });
    if (ratio > 1.15) r.push({ libelle: 'Un bon salaire', valeur: Math.round(Math.min(0.5, ratio - 1.15) * 16 * fois) });
  }
  // Relations présentes au repère
  let amis = 0, hostiles = [];
  for (const o of g.heros) if (o !== h) {
    const rel = relation(g, h, o); if (!rel) continue;
    if (rel.aff >= 50 && o.etat === 'present') amis++;
    if (rel.aff <= -40) hostiles.push(o.nom);
  }
  if (amis) r.push({ libelle: amis > 1 ? `${amis} proches au repère` : 'Un proche au repère', valeur: Math.min(8, 4 * amis) });
  if (hostiles.length) r.push({ libelle: `Vivre avec ${hostiles.join(', ')}`, valeur: -Math.min(12, 5 * hostiles.length) });
  // Souvenirs regroupés par libellé
  const sv = {};
  for (const s of h.souvenirs) { const v = poids(s, t); if (Math.abs(v) >= 0.5) sv[s.libelle] = (sv[s.libelle] || 0) + v; }
  for (const [libelle, v] of Object.entries(sv)) r.push({ libelle, valeur: Math.round(v) });
  const re = MA.raisonEstime(g, h); if (re) r.push(re);
  return r.filter(x => x.valeur).map(x => ({ ...x, libelle: MA.accorder(g, x.libelle) })).sort((x, y) => Math.abs(y.valeur) - Math.abs(x.valeur));
}

function majMoral(g, h) {
  // Audit du 11 nov. : tout le monde stagnait entre 50 et 60, personne n'était vraiment heureux. Les bonnes choses comptent
  // désormais un peu plus que les mauvaises, pour qu'un héros comblé se voie.
  const cible = borne(PARAMS.moralBase + raisonsMoral(g, h).reduce((s, x) => s + (x.valeur > 0 ? x.valeur * PARAMS.moralJoie : x.valeur), 0));
  let k = PARAMS.inertieMoral;
  if (h.traits.includes('MELANCOLIQUE') && cible > h.moral) k /= 2;   // remonte lentement
  if (h.traits.includes('ENJOUE') && cible > h.moral) k *= 1.5;
  h.moral = borne(h.moral + (cible - h.moral) * k);
  h.souvenirs = h.souvenirs.filter(s => Math.abs(poids(s, g.t)) >= 0.3);
}

// Fidélité : une fois par jour réel, elle suit le moral.
/* Une fois par jour : ce que les pièces du repère apportent à ceux qui y vivent. */
function piecesDuJour(g) {
  const repas = RP.effet(g, 'moralRepas');
  if (repas) for (const h of g.heros) if (h.etat === 'present') souvenir(h, g.t, repas, repas > 2 ? 'Un bon repas, un bain chaud' : 'Un bon repas chaud', 24);
  const s = RP.effet(g, 'souvenirsNegatifs');
  if (s !== 1) for (const h of g.heros) for (const x of h.souvenirs || []) if (x.valeur < 0 && !x.apaise) { x.demiVie *= s; x.apaise = true; }
}
function majFidelite(h, g = null) {
  // Calibré sur la simulation de 3 mois : la fidélité se gagne lentement (et de plus en plus lentement), se perd vite.
  let d = (g ? MA.penteFidelite(g, h) : 0) + (h.moral > 68 ? 1.2 : h.moral > 55 ? 0.3 : h.moral > 45 ? -0.4 : h.moral > 35 ? -1.5 : -3.5);
  if (d > 0) d *= Math.max(0.1, 1 - h.fidelite / 110);
  if (d < 0 && h.traits.includes('LOYAL')) d /= 2;
  if (d < 0 && (h.traits.includes('LIBRE') || h.traits.includes('MERCENAIRE'))) d *= 1.5;
  if (h.motivation === 'appartenance' && d > 0) d *= 1.5;
  if (d < 0 && g) d *= RP.effet(g, 'perteFidelite');   // le sanctuaire
  h.fidelite = borne(h.fidelite + d);
}

/* ---------- Besoins ---------- */
function usure(h, nuit) {
  const A = h.axes, b = h.besoins, t = new Set(h.traits);
  const u = PARAMS.usure;
  b.energie -= nuit ? 2 : u.energie;
  b.social -= nuit ? 0 : u.social + A.So / 25 - (t.has('TACITURNE') ? 2 : 0);
  b.elan -= nuit ? 0 : u.elan + (A.Di + A.Am) / 50;
  b.loisir -= nuit ? 0 : u.loisir + (t.has('CURIEUX') || h.motivation === 'plaisir' ? 2 : 0) + (t.has('PATIENT') ? -1.5 : 0);
  for (const k in b) b[k] = borne(b[k]);
}
const urgence = v => Math.pow((100 - v) / 100, 2) * 30;

function utilite(h, act, nuit, t = 0) {
  const A = ACTIVITES[act], b = h.besoins;
  if (act === 'soins') return h.blesse ? 40 : -99;
  if (act === 'dormir') return nuit ? 30 + urgence(b.energie) : b.energie < 15 ? urgence(b.energie) : -99;
  if (act === 'repos' && h.reposJusqua > t && !h.blesse) return 25 + urgence(b.energie); // au retour de mission, le corps réclame
  if (nuit) return (h.traits.includes('HANTE') || h.traits.includes('SAUVAGE') || h.traits.includes('JOUEUR')) && b.energie > 45 ? 2 + (GOUTS[h.traits[0]]?.[act] || 0) / 2 : -99;
  let u = 0;
  for (const [k, v] of Object.entries(A.gains)) u += (v / 25) * (v > 0 ? urgence(b[k]) : 3);
  for (const tr of h.traits) u += GOUTS[tr]?.[act] || 0;
  u += GOUTS_MOTIVATION[h.motivation]?.[act] || 0;
  if (act === 'entrainement') u += (h.axes.Di - 50) / 12;
  if (act === 'discussion' || act === 'jeux') u += (h.axes.So - 50) / 10;
  if (act === 'solitude') u -= (h.axes.So - 40) / 8;
  return u;
}

/* ---------- Un créneau ---------- */
function simulerCreneau(g, scenes, detaille = true, arcs = null, quetes = null) {
  const rng = rngDepuis(`${g.id}#${g.t}`);
  const nuit = estNuit(g.t);
  for (const l of ['brief', 'jardin']) if (!g.lieux.includes(l)) g.lieux.push(l);
  distribuerLettres(g);
  // Retours de congés et de soins (le voyage, lui, se termine par sa lettre de retour)
  for (const h of g.heros) if (h.etat !== 'present' && h.etat !== 'mission' && h.etat !== 'voyage' && h.jusqua != null && g.t >= h.jusqua) {
    if (h.etat === 'rappel' && detaille) g.chronique.push({ t: g.t, lieu: 'cour', importance: 3, declencheur: 'contrat', scene: 'contrat#rappel_retour', heros: [h.id], texte: F.finir(`${h.nom} repasse le portail, la poussière de la route sur les bottes : le message de rappel a bien été reçu. Le contrat se fera sans ${h.nom}.`) });
    if (h.etat === 'conges') { h.besoins.energie = 95; h.besoins.loisir = 95; souvenir(h, g.t, 10, 'De retour de congés', 36); if (detaille) ecrire(g, scenes, 'retour_conges', [h], null, rng, 2); }
    h.etat = 'present'; h.jusqua = null;
  }
  const presents = g.heros.filter(h => h.etat === 'present');
  for (const h of presents) usure(h, nuit);
  // Choix d'activité, dans un ordre tiré au hasard : chacun voit où sont déjà les autres.
  // Ceux qui sont à la soirée ce créneau-là n'ont rien d'autre à choisir.
  const ordre = presents.filter(h => !(h.occupeJusqua > g.t)).sort(() => rng() - 0.5);
  const lieuxPris = {}, choisis = [];
  // Le temps du jour : sous la pluie, l'orage ou la neige, on ne lit pas au jardin et on ne se recueille pas sur les remparts.
  const temps = meteo(g).temps, mouille = ['pluie', 'orage', 'neige'].includes(temps), rude = mouille || ['gel', 'vent'].includes(temps);
  for (const h of ordre) {
    const options = [];
    const imposee = h.reserve && !nuit ? 'brief' : h.prochaine; h.prochaine = null;
    for (const act of Object.keys(ACTIVITES)) {
      if (imposee && act !== imposee) continue;
      if (act === 'brief' && !h.reserve) continue;
      // Le premier lieu disponible d'abord ; parfois un autre, pour que chaque pièce construite vive vraiment.
      let dispo = ACTIVITES[act].lieux.filter(l => g.lieux.includes(l)); if (!dispo.length) continue;
      const abrites = dispo.filter(l => !DEHORS.has(l));
      if (rude && act !== 'entrainement' && abrites.length) dispo = abrites;   // on rentre, s'il y a de la place à l'abri
      const exposee = dispo.every(l => DEHORS.has(l)) ? (mouille ? (act === 'entrainement' ? 6 : 30) : rude ? (act === 'entrainement' ? 0 : 6) : 0) : 0;
      const alt = rngDepuis(`${g.id}#${g.t}#${h.id}#${act}`)();
      const lieu = dispo.length > 1 && alt < 0.35 ? dispo[1 + Math.floor(alt / 0.35 * (dispo.length - 1))] : dispo[0];
      let u = utilite(h, act, nuit, g.t) - exposee - (exposee && h.traits.includes('SAUVAGE') ? -exposee / 2 : 0); if (u <= -50 && !imposee) continue;
      let evite = null;
      for (const o of lieuxPris[lieu] || []) {
        const rel = relation(g, h, o);
        if (rel.aff >= 40) u += 3 + h.axes.So / 40;
        if (rel.aff <= -35 || rel.tension > 50) { u -= 10 + (h.traits.includes('RANCUNIER') ? 6 : 0); evite = o; }
      }
      options.push({ act, lieu, u, evite });
    }
    const max = Math.max(...options.map(o => o.u));
    const poidsO = options.map(o => Math.exp((o.u - max) / PARAMS.temperature));
    let x = rng() * poidsO.reduce((s, p) => s + p, 0), choix = options[0];
    for (let i = 0; i < options.length; i++) { x -= poidsO[i]; if (x <= 0) { choix = options[i]; break; } }
    // A-t-il renoncé à mieux pour éviter quelqu'un ? Le joueur doit pouvoir le voir.
    const meilleur = options.reduce((m, o) => (o.u + (o.evite ? 10 : 0) > m.u + (m.evite ? 10 : 0) ? o : m));
    if (detaille && meilleur.evite && meilleur !== choix && rng() < 0.5) ecrire(g, scenes, 'evite', [h, meilleur.evite], meilleur.lieu, rng, 2);
    (lieuxPris[choix.lieu] ||= []).push(h);
    choisis.push({ h, choix, options });
  }
  // Les jeux et les discussions se font à plusieurs : seul dans la pièce, on fait autre chose (la meilleure option qui se fait seul).
  for (const x of choisis) {
    if (!SOCIALES.has(x.choix.act)) continue;
    const autres = (lieuxPris[x.choix.lieu] || []).filter(o => o !== x.h);
    if (autres.length) continue;
    const ailleurs = x.options.filter(o => !SOCIALES.has(o.act) || (lieuxPris[o.lieu] || []).some(o2 => o2 !== x.h && !['dormir', 'soins'].includes(choisis.find(y => y.h === o2)?.choix.act)));
    if (!ailleurs.length) continue;
    const mieux = ailleurs.reduce((m, o) => (o.u > m.u ? o : m));
    lieuxPris[x.choix.lieu] = (lieuxPris[x.choix.lieu] || []).filter(o => o !== x.h);
    x.choix = mieux; (lieuxPris[mieux.lieu] ||= []).push(x.h);
  }
  for (const { h, choix } of choisis) {
    h.activite = choix.act; h.lieu = choix.lieu;
    if (XP_ACTIVITE[choix.act]) {   // un peu de progression au repère (plus avec la salle d'armes ou la bibliothèque)
      const m = choix.act === 'entrainement' ? RP.effet(g, 'xpEntrainement') : choix.act === 'lecture' ? RP.effet(g, 'xpLecture') : 1;
      PR.ajouterExperience(h.xp ||= {}, m === 1 ? XP_ACTIVITE[choix.act] : Object.fromEntries(Object.entries(XP_ACTIVITE[choix.act]).map(([k, v]) => [k, v * m])));
    }
    for (const [k, v] of Object.entries(ACTIVITES[choix.act].gains)) h.besoins[k] = borne(h.besoins[k] + (v > 0 && choix.act !== 'dormir' ? v * PARAMS.echelleGains : v));
    h.routine[choix.act] = (h.routine[choix.act] || 0) + 1;
    if (detaille && h.aRaconter && !nuit && choix.act !== 'dormir' && ecrire(g, scenes, h.aRaconter, [h], choix.lieu, rng, 2)) {
      // Un seul récit par retour de mission suffit : les compagnons de route se taisent, sauf les blessés, qui ont leur propre scène.
      if (h.aRaconter === 'recit_mission') for (const o of g.heros) if (o !== h && o.aRaconter === 'recit_mission' && !o.blesse) o.aRaconter = null;
      h.aRaconter = null;
    }
    if (h.blesse) { h.blesse = Math.max(0, h.blesse - (choix.act === 'soins' ? 2 : 1)); if (!h.blesse) souvenir(h, g.t, 3, 'Une blessure refermée', 24); }
  }
  // Interactions entre héros réunis
  const vus = new Set();
  for (let [lieu, gens] of Object.entries(lieuxPris)) {
    const eveilles = gens.filter(h => h.activite !== 'dormir');
    if (eveilles.length <= 1) {
      if (detaille) for (const h of eveilles) {
        if (nuit) { if (rng() < 0.5) ecrire(g, scenes, 'nuit', [h], lieu, rng, 1); }
        else if (rng() < PARAMS.chanceSceneSolo) ecrire(g, scenes, h.activite, [h], lieu, rng, 1);
      }
      continue;
    }
    gens = eveilles;
    const paires = [];
    for (let i = 0; i < gens.length; i++) for (let j = i + 1; j < gens.length; j++) paires.push([gens[i], gens[j]]);
    paires.sort(() => rng() - 0.5);
    for (const [a, b] of paires.slice(0, 3)) {
      if (vus.has(a.id) && vus.has(b.id)) continue;
      const pSoc = PARAMS.chanceInteraction * (0.6 + (a.axes.So + b.axes.So) / 250);
      if (rng() > pSoc) continue;
      vus.add(a.id); vus.add(b.id);
      interagir(g, scenes, a, b, lieu, rng, detaille, gens);
    }
  }
  if (detaille && arcs && !nuit) vivreArcs(g, arcs, rng, { relation, souvenir, borne });
  if (detaille && !nuit) require('./fil').vivre(g, rng);
  for (const h of presents) majMoral(g, h);
  // La taverne aide les tensions à retomber (un verre, une partie de cartes, et on se reparle).
  const apaise = RP.effet(g, 'tension');
  for (const r of Object.values(g.relations)) r.tension = Math.max(0, r.tension * (0.8 - (1 - apaise) * 0.15) - (apaise < 1 ? 1.5 : 1));
  // Une fois par jour, au créneau de midi (heure de Paris : 12 h en été, 13 h en hiver, les créneaux étant pairs en UTC)
  if (Math.floor(heureLocale(g.t) / 2) * 2 === 12) { piecesDuJour(g); for (const h of g.heros) majFidelite(h, g); if (quetes) { enregistrerQuetes(quetes); Q.eveillerQuetes(g, quetes, rng, outilsQuetes(g)); }
    if (BILLETS) B.envoyerBillets(g, BILLETS, rng, { estime: (gg, h) => MA.estime(gg, h).estime, creerCarte: (gg, type, hs) => creerCarte(gg, type, hs) }); }
  if (detaille) genererCartes(g, rng, scenes);
  echoirCartes(g, scenes);
  g.t += PARAMS.creneau;
}

/* Issue d'une rencontre. Ordre des personnes dans la scène : a agit, b reçoit. */
function interagir(g, scenes, a, b, lieu, rng, detaille, presents) {
  const rel = relation(g, a, b);
  if (rng() < 0.5) [a, b] = [b, a];
  const premiere = rel.rencontres === 0;
  rel.rencontres++;
  const humeur = ((a.moral + b.moral) / 2 - 50) / 5;
  const c = compatibilite(a, b) + rel.aff / 3 + humeur + (rng() * 30 - 15) - rel.tension / 3;
  const chaud = Math.max(a.axes.Te, b.axes.Te) > 65 || a.traits.includes('IMPULSIF') || b.traits.includes('IMPULSIF');
  const act = a.activite;
  let issue, delta, imp = 1;
  if (premiere && rel.reconnaissance) { issue = 'reconnaissance'; delta = 2; imp = 2; }
  else if (premiere) { issue = 'premiere_rencontre'; delta = Math.round(c / 4); imp = 1; }
  else if (c < -22 && chaud) { issue = 'dispute'; delta = -10; imp = 3; }
  else if (c < -5) { issue = 'desaccord'; delta = -3;
    // Les petits désaccords s'accumulent : au troisième en trois jours, ça éclate (simulation de 3 mois : il n'y avait presque jamais de conflit à arbitrer).
    rel.desaccords = [...(rel.desaccords || []).filter(t => g.t - t < 72), g.t];
    if (rel.desaccords.length >= 3 && rng() < 0.6 * RP.effet(g, 'escalade')) { issue = 'dispute'; delta = -8; imp = 3; rel.desaccords = []; } }
  else if (act === 'entrainement') { issue = rel.type === 'rival' || (a.axes.Am > 70 && b.axes.Am > 70) ? 'defi' : 'entrainement_duo'; delta = rel.type === 'rival' ? 1 : 3; imp = issue === 'defi' ? 2 : 1;
    if (enseigne(a, b) || rel.type === 'mentor' || rel.type === 'eleve') { issue = 'lecon'; delta = 4; imp = 2; } }
  else if (act === 'jeux') { issue = 'jeu'; delta = 3; }
  else if (c > 22 && rel.aff >= 35) { issue = 'confidence'; delta = 5; imp = 2; }
  else { issue = 'bon_moment'; delta = 3; }
  if (a.traits.includes('RANCUNIER') || b.traits.includes('RANCUNIER')) if (delta < 0) delta = Math.round(delta * 1.5);
  // Médiation : un héros bienveillant présent apaise une dispute.
  const mediateur = issue === 'dispute' && presents.find(o => o !== a && o !== b && o.traits.includes('BIENVEILLANT'));
  if (mediateur && rng() < 0.6) {
    delta = -4; rel.tension += 15;
    if (detaille) ecrire(g, scenes, 'mediation', [a, b, mediateur], lieu, rng, 2);
    souvenir(mediateur, g.t, 3, 'A ramené le calme', 24);
  } else {
    if (issue === 'dispute') { rel.tension += 45; souvenir(a, g.t, -6, `Une dispute avec ${b.nom}`, 24); souvenir(b, g.t, -6, `Une dispute avec ${a.nom}`, 24); rel.disputes = [...(rel.disputes || []), g.t].slice(-5); memoriser(g, { type: 'dispute', heros: [a.id, b.id] }); }
    // Réconciliation : bonne rencontre peu après une dispute
    const recente = (rel.disputes || []).some(t => g.t - t < 48 && g.t - t > 0);
    if (recente && delta > 0 && issue !== 'dispute' && rel.tension < 20) { issue = 'reconciliation'; delta = 6; imp = 2; rel.disputes = []; }
    if (detaille) ecrire(g, scenes, issue, [a, b], lieu, rng, imp);
  }
  if (issue === 'lecon') { const eleve = enseigne(a, b) ? b : a; eleve.besoins.elan = borne(eleve.besoins.elan + 10); }
  if (issue === 'confidence' || issue === 'reconciliation') { souvenir(a, g.t, 2, 'Un bon moment avec ' + b.nom, 18); souvenir(b, g.t, 2, 'Un bon moment avec ' + a.nom, 18); }
  for (const h of [a, b]) h.besoins.social = borne(h.besoins.social + 5);
  rel.aff = borne(rel.aff + delta, -100, 100);
}
const enseigne = (a, b) => (a.traits.includes('ERUDIT') || a.traits.includes('PATIENT')) && (a.niveau || 1) > (b.niveau || 1) + 2;

/* ---------- Chronique ---------- */
// Moments qui doivent toujours apparaître, quitte à reprendre la scène la plus ancienne.
// Le récit de mission n'est plus obligatoire (audit du 11 nov.) : le héros annonce lui-même son retour dans le fil, et une scène
// déjà lue dans les deux semaines ne revient plus pour combler le vide.
const OBLIGATOIRES = ['mediation', 'reconciliation', 'retour_conges', 'soiree', 'depart_conges', 'fugue', 'arrivee'];
function ecrire(g, scenes, declencheur, heros, lieu, rng, importance) {
  if (!scenes) return null;
  const ctx = { a: heros[0], b: heros[1], c: heros[2], lieu, nuit: estNuit(g.t), heure: heureLocale(g.t), relation: heros[1] ? relation(g, heros[0], heros[1]) : null,
    t: g.t, guilde: g.nom, monde: g.monde, meteo: meteo(g), memoire: g.memoire || [], heros: g.heros, vus: (g.vus ||= {}) };
  const s = choisirScene(scenes, declencheur, ctx, g.usage, g.t, PARAMS.delaiReutilisationScene, rng, importance >= 3 || OBLIGATOIRES.includes(declencheur));
  if (!s) return null;
  g.usage[s.id] = g.t; g.vus[s.id] = (g.vus[s.id] || 0) + 1;
  for (const e of s.effets) appliquerEffet(g, e, ctx);
  const entree = { t: g.t, declencheur, scene: s.id, importance: Math.max(importance, s.importance), heros: heros.map(h => h.id), lieu, texte: s.texte };
  entree.texte = MA.accorder(g, entree.texte);
  g.chronique.push(entree);
  return entree;
}
function appliquerEffet(g, e, ctx) {
  const h = ctx[e.qui];
  if (e.type === 'aff' && ctx.relation) ctx.relation.aff = borne(ctx.relation.aff + e.valeur, -100, 100);
  if (e.type === 'moral' && h) souvenir(h, g.t, e.valeur, e.libelle || 'Un moment marquant', 24);
  if (e.type === 'po') g.po += e.valeur;
}

/* ---------- Soirées ---------- */
/*
 * Une soirée réunit ceux qui en ont envie. Pour chaque absent, le jeu garde la raison principale :
 * en mission, en congés, trop fatigué, évite quelqu'un, n'aime pas les fêtes, préfère s'entraîner, pas d'humeur.
 */
function organiserSoiree(g, scenes, { organisateur = null, tournee = false, financee = false } = {}) {
  const rng = rngDepuis(`${g.id}#soiree#${g.t}`);
  const venus = [], absents = [];
  const candidats = g.heros.slice().sort((x, y) => y.axes.So - x.axes.So);
  if (organisateur) { candidats.splice(candidats.indexOf(organisateur), 1); candidats.unshift(organisateur); }
  for (const h of candidats) {
    if (h.etat === 'mission') { absents.push({ h, raison: 'en mission' }); continue; }
    if (h.etat === 'conges') { absents.push({ h, raison: 'en congés' }); continue; }
    if (h.etat === 'voyage') { absents.push({ h, raison: 'en voyage' }); continue; }
    if (h.etat === 'infirmerie' || h.blesse) { absents.push({ h, raison: 'à l\'infirmerie' }); continue; }
    if (h === organisateur) { venus.push(h); continue; }
    const t = new Set(h.traits), raisons = [];
    let envie = 0.25 + h.axes.So / 100 * 0.6 + (100 - h.besoins.social) / 300;
    if (tournee) envie += t.has('GOURMAND') ? 0.35 : 0.15;
    if (financee) envie += 0.08;
    if (t.has('JOUEUR') || t.has('FARCEUR') || t.has('ENJOUE') || t.has('BAVARD')) envie += 0.12;
    if (t.has('TACITURNE')) { envie -= 0.35; raisons.push([0.35, 'n\'aime pas les fêtes']); }
    if (t.has('SAUVAGE')) { envie -= 0.2; raisons.push([0.2, 'n\'aime pas la foule']); }
    if (h.besoins.energie < 18) { envie -= 0.4; raisons.push([0.4, 'a besoin de dormir']); }
    if (h.moral < 35) { envie -= 0.25; raisons.push([0.25, 'pas d\'humeur']); }
    if (h.axes.Di > 75 && h.besoins.elan < 40) { envie -= 0.2; raisons.push([0.2, 'préfère s\'entraîner']); }
    for (const o of venus) { const r = relation(g, h, o); if (r.aff >= 40) envie += 0.1; if (r.aff <= -35 || r.tension > 50) { envie -= 0.3; raisons.push([0.3, `évite ${o.nom}`]); } }
    if (rng() < borne(envie, 0.03, 0.97)) venus.push(h);
    else { const r = raisons.sort((x, y) => y[0] - x[0])[0]?.[1]; const [act, raison] = r ? [r === 'a besoin de dormir' ? 'repos' : null, r] : autreEnvie(h); h.prochaine = act; absents.push({ h, raison }); }
  }
  const s = { t: g.t, organisateur: organisateur && organisateur.id, tournee, venus: venus.map(h => h.id), absents: absents.map(x => ({ id: x.h.id, raison: x.raison })), moments: [] };
  if (venus.length >= 2) {
    const e = ecrire(g, scenes, 'soiree', [organisateur || venus[0], venus[1]], 'salle_commune', rng, 2); if (e) s.moments.push(e);
    for (const h of venus) { h.occupeJusqua = g.t + PARAMS.creneau; h.besoins.social = 100; h.besoins.loisir = borne(h.besoins.loisir + 30); h.besoins.energie = borne(h.besoins.energie - 15);
      if (tournee) souvenir(h, g.t, h.traits.includes('GOURMAND') ? 12 : 6, 'La tournée du maître de guilde', 36); else souvenir(h, g.t, 4, 'Une bonne soirée', 24); }
    const paires = []; for (let i = 0; i < venus.length; i++) for (let j = i + 1; j < venus.length; j++) paires.push([venus[i], venus[j]]);
    paires.sort(() => rng() - 0.5);
    for (const [a, b] of paires.slice(0, Math.min(4, paires.length))) { const n = g.chronique.length; interagir(g, scenes, a, b, 'salle_commune', rng, true, venus); if (g.chronique.length > n) s.moments.push(g.chronique[g.chronique.length - 1]); }
    for (const x of absents) if (x.raison.startsWith('évite') || x.raison === 'n\'aime pas les fêtes') { const e = ecrire(g, scenes, 'absent_soiree', [x.h], 'remparts', rng, 1); if (e) s.moments.push(e); }
  }
  g.soirees.push(s);
  memoriser(g, { type: 'soiree', heros: s.venus, absents: s.absents.map(x => x.id), tournee });
  return s;
}

// Quand rien ne retient un héros, il a simplement mieux à faire : on dit quoi.
const AUTRES_ENVIES = { entrainement: 'préfère s\'entraîner', lecture: 'préfère lire', solitude: 'préfère le calme des remparts', ville: 'passe la soirée en ville',
  repos: 'veut se coucher tôt', recueillement: 'se recueille', jeux: 'joue aux cartes ailleurs', discussion: 'discute dans un coin', soins: 'se soigne' };
function autreEnvie(h) {
  let best = 'repos', u = -Infinity;
  for (const act of Object.keys(AUTRES_ENVIES)) { const v = utilite(h, act, false); if (v > u && act !== 'discussion' && act !== 'jeux') { u = v; best = act; } }
  return [best, AUTRES_ENVIES[best]];
}

/* ---------- Cartes d'intervention du maître de guilde ---------- */
/*
 * Le maître n'a pas de menus : il reçoit des demandes, comme des plis posés sur son bureau. Chaque demande a des options
 * et une réponse par défaut qui s'applique si personne ne répond à temps.
 */
const CARTES = {
  conges: {
    titre: h => `${h.nom} demande des congés`,
    declenche: h => (h.traits.includes('LIBRE') || h.motivation === 'liberte' ? h.moral < 60 || h.besoins.loisir < 30 : h.moral < 42 && h.besoins.energie < 40),
    options: [
      { id: 'accorder', libelle: 'Accorder deux jours, sans discuter', ton: 'compatissant' },
      { id: 'negocier', libelle: 'Un jour, après la prochaine mission', ton: 'juste' },
      { id: 'refuser', libelle: 'Refuser : la guilde a besoin de tout le monde', ton: 'ferme' },
    ],
    defaut: 'refuser',
  },
  augmentation: {
    titre: h => `${h.nom} demande une augmentation`,
    declenche: h => ((h.motivation === 'or' || h.traits.includes('CUPIDE') || h.traits.includes('MERCENAIRE')) && h.salaire < h.attente * 1.1) || h.salaire < h.attente * 0.8,
    options: [
      { id: 'augmenter', libelle: 'Augmenter son salaire d\'un quart', ton: 'genereux' },
      { id: 'prime', libelle: 'Une prime, une seule fois', ton: 'juste' },
      { id: 'refuser', libelle: 'Refuser : personne n\'est payé plus que sa part', ton: 'ferme' },
    ],
    defaut: 'refuser',
  },
  conflit: {
    titre: (h, o) => `${h.nom} et ${o.nom} ne se supportent plus`,
    options: [
      { id: 'raison_a', libelle: 'Donner raison au premier', ton: 'ferme' },
      { id: 'raison_b', libelle: 'Donner raison au second', ton: 'ferme' },
      { id: 'ecouter', libelle: 'Les écouter tous les deux, longuement', ton: 'ecoute' },
      { id: 'savon', libelle: 'Leur passer un savon, à tous les deux', ton: 'dur' },
      { id: 'binome', libelle: 'Les envoyer ensemble couper le bois', ton: 'ruse' },
      { id: 'laisser', libelle: 'Les laisser se débrouiller', ton: 'laxiste' },
    ],
    defaut: 'laisser',
  },
  soiree: {
    titre: h => `${h.nom} veut organiser une soirée`,
    declenche: (h, g) => h.axes.So >= 75 && h.besoins.social < 45 && !g.soirees.some(s => g.t - s.t < 48),
    options: [
      { id: 'tournee', libelle: 'Offrir la tournée, et venir trinquer', ton: 'complice' },
      { id: 'financer', libelle: 'Payer la salle et les chandelles', ton: 'genereux' },
      { id: 'laisser', libelle: 'D\'accord, mais à leurs frais', ton: 'juste' },
      { id: 'interdire', libelle: 'Pas ce soir : on part tôt demain', ton: 'dur' },
    ],
    defaut: 'laisser',
  },
  // La facture du bourg : une dispute qui a fini au bourg, et quelqu'un à la porte avec la note (catalogue/vie/factures.txt).
  facture: {
    titre: () => 'Une facture du bourg',
    options: [
      { id: 'payer', libelle: 'Payer, et ne plus en parler', ton: 'genereux' },
      { id: 'retenue', libelle: 'Payer, mais sur leur solde', ton: 'juste' },
      { id: 'contester', libelle: 'Contester la note', ton: 'ruse' },
      { id: 'reparer', libelle: 'Les envoyer réparer eux-mêmes', ton: 'ferme' },
    ],
    defaut: 'payer',
  },
  billet: { titre: h => `Un mot de ${h.nom}`, options: [{ id: 'garder', libelle: 'Le garder', ton: 'juste' }], defaut: 'garder' },
  quete: {
    titre: h => `${h.nom} te demande une faveur`,
    options: [
      { id: 'accepter', libelle: 'Accepter : on y va', ton: 'compatissant' },
      { id: 'plus_tard', libelle: 'Plus tard, quand la guilde pourra', ton: 'juste' },
      { id: 'refuser', libelle: 'Refuser : le passé doit rester où il est', ton: 'dur' },
    ],
    defaut: 'plus_tard',
  },
  depart: {
    titre: h => `${h.nom} songe à quitter la guilde`,
    declenche: h => h.fidelite < PARAMS.fideliteDepart,
    options: [
      { id: 'entretien', libelle: 'Prendre le temps de l\'écouter', ton: 'ecoute' },
      { id: 'augmenter', libelle: 'Proposer plus d\'or pour rester', ton: 'genereux' },
      { id: 'laisser', libelle: 'Accepter son départ, sans rancune', ton: 'juste' },
    ],
    defaut: 'laisser',
  },
};
const COUT_SOIREE = { tournee: 12, financer: 5 }; // or par participant attendu (PROPOSITION)

let FACTURES = null;
function factures() {
  if (FACTURES) return FACTURES;
  try {
    FACTURES = require('node:fs').readFileSync(require('node:path').join(require('./chemins'), 'vie/factures.txt'), 'utf8').split('\n')
      .filter(l => l.trim() && !l.startsWith('#')).map(l => { const [m, recit, note] = l.split('|'); return { montant: +m, recit, note }; });
  } catch { FACTURES = []; }
  return FACTURES;
}
function genererCartes(g, rng, scenes = null) {
  const ouvertes = new Set(g.cartes.filter(c => c.etat === 'ouverte').map(c => `${c.type}|${c.heros.join('|')}`));
  const recente = (type, id, h) => g.cartes.some(c => c.type === type && c.heros.includes(id) && g.t - c.t < h);
  for (const h of g.heros) {
    if (h.etat !== 'present') continue;
    for (const type of ['depart', 'conges', 'augmentation', 'soiree']) {
      const def = CARTES[type];
      if (ouvertes.has(`${type}|${h.id}`) || recente(type, h.id, type === 'depart' ? 48 : 72)) continue;
      if (def.declenche(h, g) && rng() < (type === 'depart' ? 1 : type === 'soiree' ? 0.1 : 0.25)) creerCarte(g, type, [h], scenes);
    }
  }
  // Un gamin au bourg, et quelqu'un de la guilde l'y rejoint (de préférence quelqu'un déjà sur place) : il arrive que la
  // soirée tourne mal, même sans dispute au repère.
  const presents = g.heros.filter(h => h.etat === 'present'), gamin = presents.find(h => h.lieu === 'ville' && require('./fil').bande(h) === 'gamin');
  if (gamin && presents.length > 1 && factures().length && !g.cartes.some(c => c.type === 'facture' && g.t - c.t < PARAMS.factureEcart) && rngDepuis(`${g.id}#facture#${g.t}`)() < PARAMS.factureVille) {
    const autres = presents.filter(h => h !== gamin), surPlace = autres.filter(h => h.lieu === 'ville');
    const pool = surPlace.length ? surPlace : autres; creerCarte(g, 'facture', [gamin, pool[Math.floor(rng() * pool.length)]], scenes);
  }
  // Conflit : deux disputes en 48 h entre les mêmes héros
  for (const [k, r] of Object.entries(g.relations)) {
    // Une dispute qui laisse une forte tension, ou deux disputes en quatre jours (calibrage de la simulation de 3 mois)
    const n = (r.disputes || []).filter(t => g.t - t < 96).length, chaud = (r.disputes || []).some(t => g.t - t < 24) && r.tension >= 55;
    // Une dispute récente entre deux héros, dont au moins un gamin : parfois, elle a fini au bourg, et le bourg envoie la note.
    const fraiche = (r.disputes || []).some(t => g.t - t < 12), [ia, ib] = k.split('|');
    const A = g.heros.find(h => h.id === ia), Bh = g.heros.find(h => h.id === ib);
    if (fraiche && A && Bh && factures().length && !g.cartes.some(c => c.type === 'facture' && g.t - c.t < PARAMS.factureEcart)
      && [A, Bh].some(h => require('./fil').bande(h) === 'gamin') && rng() < PARAMS.factureChance) { creerCarte(g, 'facture', [A, Bh], scenes); continue; }
    if (n >= 2 || chaud) { const [a, b] = k.split('|'); if (!ouvertes.has(`conflit|${a}|${b}`) && !recente('conflit', a, 72)) creerCarte(g, 'conflit', [a, b].map(id => g.heros.find(h => h.id === id)), scenes); }
  }
}
function creerCarte(g, type, heros, scenes = null) {
  const def = CARTES[type];
  const c = { id: `C${++g.seqCarte}`, type, t: g.t, echeance: g.t + (type === 'depart' ? PARAMS.dureeCarteDepart : PARAMS.dureeCarte), etat: 'ouverte', heros: heros.map(h => h.id), titre: def.titre(...heros), options: def.options.map(o => ({ ...o })), defaut: def.defaut };
  if (type === 'conflit') { c.options[0].libelle = `Donner raison à ${heros[0].nom}`; c.options[1].libelle = `Donner raison à ${heros[1].nom}`; }
  Object.assign(c, contexteCarte(g, type, heros, scenes));
  g.cartes.push(c);
  return c;
}

/*
 * Une demande n'arrive jamais nue : ce qui s'est passé, puis ce que chacun en dit, avec sa voix.
 * Quand personne ne sait ce qui s'est passé, la demande le dit : les deux mettent la pression sans rien expliquer.
 */
const CONFLITS_OPAQUES = [
  'Personne ne sait ce qui s\'est passé. Depuis l\'aube, {a} et {b} attendent devant ton bureau, chacun d\'un côté de la porte. Personne ne veut parler en premier. Les deux veulent que tu tranches, et maintenant.',
  'Le repère entier marche sur des œufs. {a} et {b} ne se parlent plus, refusent de dire pourquoi, et les deux t\'ont fait savoir, très clairement, que tu ferais bien de choisir le bon camp.',
];
function contexteCarte(g, type, heros, scenes) {
  const rng = rngDepuis(`${g.id}#ctx#${g.t}#${type}`), rep = scenes?.repliques;
  const voix = (h, sit, autre) => { const l = rep && replique(rep, h, sit, autre, rng, {}, 0, { registre: true }); return l ? { heros: h.id, texte: F.finir(l) } : null; };
  if (type === 'conflit') {
    const [a, b] = heros;
    const vu = [...g.chronique].reverse().find(e => e.heros.includes(a.id) && e.heros.includes(b.id) && ['dispute', 'desaccord', 'evite', 'defi', 'jeu'].includes(e.declencheur) && g.t - e.t < 72);
    const contexte = vu ? [`Ce qui s'est passé : ${vu.texte}`, `Depuis, la tension n'est pas retombée. Le reste de la guilde attend de voir ce que tu vas faire.`]
      : [CONFLITS_OPAQUES[Math.floor(rng() * CONFLITS_OPAQUES.length)].replace(/\{a\}/g, a.nom).replace(/\{b\}/g, b.nom)];
    return { contexte, voix: [voix(a, 'plaide', b), voix(b, 'plaide', a)].filter(Boolean) };
  }
  if (type === 'facture') {
    const [a, b] = heros, L = factures(); g.usage ||= {};
    const neuves = L.filter(f => g.usage[`B:${f.recit}`] == null || g.t - g.usage[`B:${f.recit}`] >= 24 * 30);
    const f = (neuves.length ? neuves : L)[Math.floor(rng() * (neuves.length || L.length))]; g.usage[`B:${f.recit}`] = g.t;
    const r = x => F.finir(x.replace(/\{a\}/g, a.nom).replace(/\{b\}/g, b.nom).replace(/\{bourg\}/g, g.monde?.bourg || 'le bourg'));
    return { montant: f.montant, contexte: [r(f.recit), `La note, posée sur ton bureau : « ${r(f.note)} » Total : ${f.montant} PO.`], voix: [voix(a, 'plaide', b), voix(b, 'plaide', a)].filter(Boolean) };
  }
  const h = heros[0];
  const sit = { conges: 'demande_conges', augmentation: 'demande_augmentation', soiree: 'demande_soiree', depart: 'depart' }[type];
  const contexte = {
    conges: [`${h.nom} a laissé un pli sur ton bureau. Dans le repère, on dit que ça couve depuis plusieurs jours.`],
    augmentation: [`${h.nom} t'attend à la porte de ton bureau. D'autres héros font semblant de ne pas écouter.`],
    soiree: [`${h.nom} a déjà sorti les lanternes. Il ne manque que ton accord, et l'or.`],
    depart: [`${h.nom} a demandé à te voir en tête à tête. Ce n'est pas une menace. Pas encore.`],
  }[type];
  return { contexte: contexte || [], voix: sit ? [voix(h, sit, null)].filter(Boolean) : [] };
}
function echoirCartes(g, scenes) { for (const c of g.cartes) if (c.etat === 'ouverte' && g.t >= c.echeance) repondre(g, scenes, c.id, c.defaut, true); }

/* Réponse du maître de guilde. Retourne la liste des conséquences, lisibles. */
function repondre(g, scenes, idCarte, option, parDefaut = false) {
  const c = g.cartes.find(x => x.id === idCarte); if (!c || c.etat !== 'ouverte') throw new Error('Demande introuvable ou déjà traitée');
  if (!parDefaut) g.aRepondu = true;   // pour le carnet de l'intendante
  const H = c.heros.map(id => g.heros.find(h => h.id === id)), h = H[0], t = new Set(h.traits), out = [];
  // Les effets chiffrés restent cachés : le joueur voit ce qui se passe, pas les points.
  const effet = (x, v, lib, dv = 36) => souvenir(x, g.t, v, lib, dv);
  const silence = parDefaut ? ' sans réponse' : '';
  const rngJ = rngDepuis(`${g.id}#juge#${g.t}#${c.id}`);
  let concernes = [], motif = '';
  if (c.type === 'conges') {
    concernes = [{ h, poids: option === 'accorder' ? 1 : option === 'refuser' ? -1 : 0.2 }];
    motif = { accorder: `les congés accordés à ${h.nom}`, negocier: `le compromis proposé à ${h.nom}`, refuser: `les congés refusés à ${h.nom}` }[option];
    if (option === 'accorder') { memoriser(g, { type: 'conges', heros: [h.id] }); h.etat = 'conges'; h.jusqua = g.t + 48; effet(h, 6, 'Congés accordés'); h.fidelite = borne(h.fidelite + 5); out.push(`${h.nom} boucle son sac dans l'heure et part pour deux jours.`); ecrire(g, scenes, 'depart_conges', [h], null, rngDepuis(`${g.id}#cg#${g.t}`), 2); }
    if (option === 'negocier') { h.congesApresMission = 24; effet(h, t.has('LIBRE') ? 1 : 3, 'Congés promis'); out.push(`${h.nom} accepte le marché, du bout des lèvres.`); }
    if (option === 'refuser') {
      const v = t.has('LIBRE') ? -14 : h.axes.Di > 70 ? -3 : -8; effet(h, v, `Congés refusés${silence}`, 48);
      if ((t.has('LIBRE') || t.has('REBELLE')) && h.axes.Di < 35) { memoriser(g, { type: 'fugue', heros: [h.id] }); h.etat = 'conges'; h.jusqua = g.t + 24; h.fidelite = borne(h.fidelite - 8); out.push(`${h.nom} part quand même, sans prévenir.`); ecrire(g, scenes, 'fugue', [h], null, rngDepuis(`${g.id}#fg#${g.t}`), 3); }
      else out.push(h.axes.Di > 70 ? `${h.nom} range le pli et retourne au travail, sans un mot.` : `${h.nom} claque la porte de ton bureau en sortant.`);
    }
  }
  if (c.type === 'augmentation') {
    concernes = [{ h, poids: option === 'augmenter' ? 1.5 : option === 'prime' ? 0.5 : -1.5 }];
    motif = { augmenter: `l'augmentation accordée à ${h.nom}`, prime: `la prime versée à ${h.nom}`, refuser: `l'augmentation refusée à ${h.nom}` }[option];
    if (option === 'augmenter') { h.salaire = Math.round(h.salaire * 1.25); effet(h, 8, 'Augmentation obtenue', 72); h.fidelite = borne(h.fidelite + 6); out.push(`${h.nom} compte deux fois la nouvelle paie, pour être sûr que ce n'est pas un rêve.`.replace('pour être sûr', 'par prudence'));
      for (const o of g.heros) if (o !== h && (o.motivation === 'or' || o.traits.includes('CUPIDE')) && o.salaire <= h.salaire) { effet(o, -3, `L'augmentation de ${h.nom}`, 36); out.push(`${o.nom} a entendu. Et fait ses comptes.`); } }
    if (option === 'prime') { g.po -= h.salaire * 3; effet(h, 5, 'Une prime'); out.push(`${h.nom} prend la bourse. Ce n'est pas ce qui était demandé, mais c'est déjà ça.`); }
    if (option === 'refuser') { effet(h, t.has('MERCENAIRE') ? -10 : -7, `Augmentation refusée${silence}`, 72); if (t.has('MERCENAIRE')) h.fidelite = borne(h.fidelite - 6); out.push(t.has('MERCENAIRE') ? `${h.nom} sourit froidement : « D'autres guildes paient mieux. Je dis ça comme ça. »` : `${h.nom} encaisse le refus sans rien dire.`); }
  }
  if (c.type === 'conflit') {
    const [a, b] = H, rel = relation(g, a, b);
    if (option === 'raison_a' || option === 'raison_b') { const [gagne, perd] = option === 'raison_a' ? [a, b] : [b, a];
      concernes = [{ h: gagne, poids: 1.5 }, { h: perd, poids: -1.5 }]; motif = `le jour où tu as donné raison à ${gagne.nom} contre ${perd.nom}`;
      effet(gagne, 5, 'Le maître lui a donné raison'); effet(perd, perd.traits.includes('FIER') || perd.traits.includes('RANCUNIER') ? -12 : -7, 'Le maître lui a donné tort', 72); rel.tension = 0;
      out.push(`${gagne.nom} sort de ton bureau la tête haute. ${perd.nom}, la tête basse, et les poings serrés.`); }
    if (option === 'ecouter') { concernes = [{ h: a, poids: 0.7 }, { h: b, poids: 0.7 }]; motif = `les deux heures passées à écouter ${a.nom} et ${b.nom}`;
      rel.tension = 0; const ok = compatibilite(a, b) + rel.aff / 3 > -12;
      rel.aff = borne(rel.aff + (ok ? 12 : 4), -100, 100);
      out.push(ok ? `Il faut deux heures, une théière et beaucoup de patience. À la fin, ${a.nom} et ${b.nom} se serrent la main. Pas amis. Plus ennemis.` : `La conversation dure deux heures. Rien n'est vraiment réglé, mais plus personne ne crie.`); }
    if (option === 'savon') { concernes = [{ h: a, poids: -0.8 }, { h: b, poids: -0.8 }]; motif = `le savon passé à ${a.nom} et ${b.nom}`;
      rel.tension = 0; rel.aff = borne(rel.aff + 5, -100, 100); effet(a, -4, 'Un savon du maître', 36); effet(b, -4, 'Un savon du maître', 36);
      out.push(`On t'entend crier jusque dans la cour. ${a.nom} et ${b.nom} sortent de ton bureau, unis pour une fois : contre toi.`); }
    if (option === 'binome') { concernes = [{ h: a, poids: -0.2 }, { h: b, poids: -0.2 }]; motif = `la corvée de bois imposée à ${a.nom} et ${b.nom}`;
      const r = rngDepuis(`${g.id}#binome#${g.t}`)(); const delta = r < 0.55 ? 20 : -15; rel.aff = borne(rel.aff + delta, -100, 100); rel.tension = 0;
      out.push(delta > 0 ? `${a.nom} et ${b.nom} reviennent du bois couverts de sciure, et, contre toute attente, en riant.` : `${a.nom} et ${b.nom} reviennent du bois chacun de son côté. Une hache a volé. Personne n'a été touché. De justesse.`); }
    if (option === 'laisser') { concernes = [{ h: a, poids: -0.4 }, { h: b, poids: -0.4 }]; motif = `la dispute de ${a.nom} et ${b.nom} laissée sans réponse`;
      rel.tension += 10; out.push(`Rien n'est réglé. Ce soir, ${a.nom} et ${b.nom} mangent aux deux bouts de la table, et le repère entier compte les couteaux.`); }
  }
  if (c.type === 'soiree') {
    concernes = [{ h, poids: option === 'interdire' ? -1 : option === 'laisser' ? 0.2 : 1 }];
    motif = { tournee: 'la tournée offerte par le maître', financer: 'la soirée payée par le maître', laisser: `la soirée de ${h.nom}, à ses frais`, interdire: `la soirée interdite à ${h.nom}` }[option];
    const attendus = g.heros.filter(x => x.etat === 'present').length;
    if (option === 'interdire') { effet(h, -5, 'Soirée interdite'); out.push(`${h.nom} décroche les lanternes une à une, très lentement, pour que tout le monde voie.`); }
    else {
      const cout = (COUT_SOIREE[option] || 0) * attendus; g.po -= cout; if (cout) out.push(`La soirée coûte ${cout} PO au coffre.`);
      const s = organiserSoiree(g, scenes, { organisateur: h, tournee: option === 'tournee', financee: option === 'financer' });
      out.push(`${s.venus.length} héros viennent, ${s.absents.length} restent à l'écart.`); c.soiree = s;
    }
  }
  if (c.type === 'depart') {
    concernes = [{ h, poids: option === 'entretien' ? 1 : option === 'augmenter' ? 0.3 : 0 }];
    motif = { entretien: `le temps pris pour écouter ${h.nom}`, augmenter: `l'or proposé à ${h.nom} pour rester`, laisser: `le départ de ${h.nom}, accepté` }[option];
    if (option === 'entretien') { const pr = 0.35 + (h.motivation === 'appartenance' ? 0.25 : 0) + (t.has('LOYAL') ? 0.2 : 0) - (t.has('LIBRE') ? 0.15 : 0) + (MA.estime(g, h).estime - 50) / 100;
      if (rngDepuis(`${g.id}#entretien#${g.t}`)() < pr) { h.fidelite = 40; effet(h, 8, 'Une oreille attentive du maître', 72); out.push(`Après une longue conversation, ${h.nom} défait son sac.`); } else partir(g, h, out); }
    if (option === 'augmenter') { if (h.motivation === 'or' || t.has('CUPIDE') || t.has('MERCENAIRE')) { h.salaire = Math.round(h.salaire * 1.4); h.fidelite = 40; out.push(`${h.nom} reste, pour l'instant. L'or a parlé.`); } else { out.push(`${h.nom} regarde la bourse, puis toi : « Tu n'as rien compris. »`); partir(g, h, out); } }
    if (option === 'laisser') partir(g, h, out);
  }
  if (c.type === 'facture') {
    const [a, b] = H, m = c.montant || 40, bourg = g.monde?.bourg || 'le bourg';
    motif = { payer: `la facture du bourg, payée sans un mot`, retenue: `la facture retenue sur la solde de ${a.nom} et ${b.nom}`, contester: `la facture du bourg, contestée`, reparer: `${a.nom} et ${b.nom}, envoyés réparer au bourg` }[option];
    if (option === 'payer') { concernes = [{ h: a, poids: 0.6 }, { h: b, poids: 0.6 }]; g.po -= m; out.push(parDefaut ? `Faute de réponse, l'intendance paie les ${m} PO pour que l'affaire ne traîne pas.` : `Tu paies les ${m} PO. ${a.nom} et ${b.nom} évitent ton regard toute la soirée.`); }
    if (option === 'retenue') { concernes = [{ h: a, poids: -0.3 }, { h: b, poids: -0.3 }]; g.po -= m;
      for (const x of [a, b]) { x.retenue = (x.retenue || 0) + Math.ceil(m / 2); effet(x, -3, 'La facture retenue sur la solde', 48); }
      out.push(`Le coffre avance les ${m} PO. ${Math.ceil(m / 2)} PO chacun seront retenus sur la prochaine paie de ${a.nom} et ${b.nom}.`); }
    if (option === 'contester') { concernes = [{ h: a, poids: 0.3 }, { h: b, poids: 0.3 }];
      if (rngJ() < 0.5) out.push(`Tu fais remarquer que la vitre était déjà fêlée et que le banc était vermoulu. Le bourg retire la note en grommelant.`);
      else { const plus = Math.round(m * 1.5); g.po -= plus; out.push(`Le bailli de ${bourg} ne se laisse pas faire, et la note revient avec les frais de l'huissier : ${plus} PO.`); } }
    if (option === 'reparer') { concernes = [{ h: a, poids: -0.6 }, { h: b, poids: -0.6 }];
      for (const x of [a, b]) { effet(x, -5, 'Une journée de réparations au bourg', 48); }
      relation(g, a, b).tension = 0;
      out.push(`${a.nom} et ${b.nom} passent la journée à ${bourg}, un marteau à la main, sous les yeux de tout le monde. Ils rentrent ensemble, sans se parler, mais ensemble.`); }
  }
  if (c.type === 'billet') {
    const r = B.repondreBillet(g, c, h, option, parDefaut);
    out.push(...r.lignes);
    // Le regard bouge, mais en silence : un billet se vit en privé, ses lignes de récit suffisent.
    if (r.poids) MA.juger(g, r.ton, [{ h, poids: r.poids }], `la réponse au billet de ${h.nom}`, rngJ, { prive: r.prive });
    c.etat = 'traitee'; c.reponse = option; c.parDefaut = parDefaut; c.consequences = out;
    return out.map(l => MA.accorder(g, l));
  }
  if (c.type === 'quete') {
    concernes = [{ h, poids: option === 'accepter' ? 2 : option === 'refuser' ? -2 : -0.5 }];
    motif = { accepter: `la quête de ${h.nom}, acceptée`, plus_tard: `la quête de ${h.nom}, remise à plus tard`, refuser: `la quête de ${h.nom}, refusée` }[option];
    out.push(...Q.repondreQuete(g, h, defQuete(g, h, c.quete), option, outilsQuetes(g)));
  }
  // Le regard des héros : ceux qui sont concernés jugent fort, les autres l'apprennent.
  if (parDefaut) { concernes = H.map(x => ({ h: x, poids: -0.5 })); out.unshift(`Personne n'a répondu. ${H.map(x => x.nom).join(' et ')} l'ont remarqué.`.replace(' l\'ont remarqué', H.length > 1 ? ' l\'ont remarqué' : ' l\'a remarqué')); }
  const ton = parDefaut ? 'absent' : (c.options.find(o => o.id === option)?.ton || 'juste');
  out.push(...MA.juger(g, ton, concernes, parDefaut ? `${(c.titre || 'une demande').toLowerCase()}, restée sans réponse` : motif, rngJ));
  c.etat = 'traitee'; c.reponse = option; c.parDefaut = parDefaut; c.consequences = out;
  return out.map(l => MA.accorder(g, l));
}
function partir(g, h, out) {
  h.etat = 'parti'; out.push(`${h.nom} quitte la guilde et rejoint le Registre. Le départ est définitif.`);
  for (const o of g.heros) if (o !== h) { const r = relation(g, h, o); if (r && r.aff >= 45) souvenir(o, g.t, o.motivation === 'appartenance' ? -14 : -8, `Le départ de ${h.nom}`, 96); }
}

/* ---------- Quêtes personnelles ---------- */
// Le moteur garde la définition des quêtes déjà éveillées, pour répondre aux demandes sans recharger le catalogue.
const quetesConnues = {};
function outilsQuetes(g) {
  return {
    souvenir, relation,
    creerCarte: (type, heros) => creerCarte(g, type, heros),
    ecrireChronique: e => g.chronique.push({ t: g.t, lieu: null, ...e, texte: MA.accorder(g, e.texte).replace(/\{chien\}/g, g.monde?.chien || 'le chien') }),
  };
}
function enregistrerQuetes(quetes) { for (const q of Object.values(quetes)) quetesConnues[q.id] = q; }
// Une quête de motivation est personnalisée pour chaque héros (sa région, ses lieux) : on la reconstruit à partir de lui.
function defQuete(g, h, id) { const d = quetesConnues[id]; return d && !d.champion && !d.gamme ? Q.queteDe({ [`motivation:${d.motivation}`]: d }, { ...h, univers: '__aucun__' }, g.region) : d; }
/* Fin d'une mission personnelle : à appeler au retour de la mission, avec son issue. */
function finMissionQuete(g, idHeros, issue, idCompagnon = null) {
  const h = g.heros.find(x => x.id === idHeros), q = g.quetes?.[idHeros];
  if (!h || !q) throw new Error('Pas de quête en cours pour ce héros');
  const c = idCompagnon ? g.heros.find(x => x.id === idCompagnon) : null;
  return Q.terminerEtape(g, h, defQuete(g, h, q.id), issue, outilsQuetes(g), c);
}

/* ---------- Missions ---------- */
const MORAL_ISSUE = { eclatante: 10, reussite: 6, partielle: -1, echec: -8 };
/* Repos : un héros rentré de mission reste au repère, mais ne repart pas avant d'avoir récupéré. */
const enRepos = (g, h) => Boolean(h.reposJusqua && g.t < h.reposJusqua);
function departMission(g, ids, retour) {
  const las = ids.map(id => g.heros.find(x => x.id === id)).filter(h => enRepos(g, h));
  if (las.length) throw new Error(`${las.map(h => h.nom).join(' et ')} ${las.length > 1 ? 'se remettent' : 'se remet'} encore de la dernière mission.`);
  for (const id of ids) { const h = g.heros.find(x => x.id === id); h.etat = 'mission'; h.jusqua = retour; h.lieu = null; h.activite = null; }
}
function retourMission(g, ids, issue, { blesses = [], morts = [], violente = false, juste = null, mission = null } = {}) {
  // blesses : identifiants (blessure légère) ou { id, niveau: 'legere' | 'grave' }
  const niveauBlessure = id => { const b = blesses.find(x => (x.id ?? x) === id); return b ? (b.niveau || 'legere') : null; };
  blesses = blesses.map(x => x.id ?? x);
  memoriser(g, { type: 'mission', heros: ids.filter(id => !morts.includes(id)), issue, blesses, morts, titre: mission?.titre || null, lieu: mission?.lieu || null });
  for (const id of ids) {
    const h = g.heros.find(x => x.id === id); if (!h || h.etat === 'mort') continue;
    if (morts.includes(id)) { h.etat = 'mort'; continue; }
    h.etat = 'present'; h.jusqua = null;
    let v = MORAL_ISSUE[issue];
    if (h.motivation === 'gloire' && issue === 'eclatante') v += 5;
    if (h.traits.includes('SANGUINAIRE') && violente) v += 4;
    if (h.traits.includes('IDEALISTE') && juste != null) v += juste ? 4 : -8;
    if (h.motivation === 'redemption' && issue === 'echec') v -= 4;
    souvenir(h, g.t, v, { eclatante: 'Une mission éclatante', reussite: 'Une mission réussie', partielle: 'Une mission à moitié réussie', echec: 'Une mission ratée' }[issue], 36);
    if (blesses.includes(id)) { h.blesse = niveauBlessure(id) === 'grave' ? 30 : 12; souvenir(h, g.t, niveauBlessure(id) === 'grave' ? -10 : -5, 'Une blessure', 48); }
    h.repos = reposApresMission({ total: mission?.total ?? 12, palier: mission?.palier, risque: mission?.risque, dangereuse: mission?.dangereuse, issue, blessure: niveauBlessure(id) });
    { const f = RP.effet(g, 'repos'); if (f !== 1) h.repos = Math.max(2, Math.ceil(h.repos * f / 2) * 2); }   // l'aile nord
    if (niveauBlessure(id)) { const f = RP.effet(g, 'reposBlessure'); if (f !== 1) { h.repos = Math.ceil(h.repos * f / 2) * 2; h.blesse = Math.ceil(h.blesse * f); } }  // l'infirmerie
    h.reposJusqua = g.t + h.repos;
    h.besoins.energie = borne(h.besoins.energie - 30); h.besoins.elan = borne(h.besoins.elan + 20); h.aRaconter = 'recit_mission';
    if (h.congesApresMission) { h.etat = 'conges'; h.jusqua = g.t + h.congesApresMission; h.congesApresMission = null; }
  }
  // Les héros annoncent eux-mêmes leur retour dans le fil de la guilde.
  require('./fil').retour(g, ids.map(id => g.heros.find(x => x.id === id)).filter(h => h && h.etat !== 'mort'), issue, blesses, mission);
  for (const id of morts) {
    const mort = g.heros.find(x => x.id === id);
    for (const o of g.heros) if (o !== mort && o.etat !== 'mort') { const r = relation(g, mort, o); if (r && r.aff >= 30) souvenir(o, g.t, r.aff >= 60 ? -25 : -12, `La mort de ${mort.nom}`, 168); }
  }
}

/* ---------- Le grand voyage d'une quête ----------
 * Quand une étape de quête est trop loin pour une mission, le héros part en voyage (plusieurs jours). Le repère le suit
 * de loin : un départ au portail, une lettre de la route qui décrit la région traversée, un mot à l'arrivée, puis le retour.
 * Le serveur règle l'étape (resolution + quetes.terminerEtape) quand le voyage s'achève : g.voyagesARegler.
 */
/* Les lettres de la route et de l'arrivée sont écrites à la main, entières, dans catalogue/vie/lettres/voyage.txt :
 * une par région et par voix (le registre de la lettre de candidature). Le jeu en choisit une, il ne les compose pas. */
let LETTRES_ECRITES = null;
function lettresEcrites() {
  if (LETTRES_ECRITES) return LETTRES_ECRITES;
  LETTRES_ECRITES = [];
  try {
    const f = require('node:path').join(require('./chemins'), 'vie/lettres/voyage.txt');
    for (const l of require('node:fs').readFileSync(f, 'utf8').split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue;
      const [moment, region, registre, ...t] = l.split('|');
      LETTRES_ECRITES.push({ moment, region, registre, texte: t.join('|').trim() });
    }
  } catch (e) { /* catalogue absent : pas de lettre */ }
  return LETTRES_ECRITES;
}
function registreDe(h) { try { return require('./candidatures').chargerDossiers()[h.champion]?.registre || 'sage'; } catch { return 'sage'; } }
function lettreEcrite(moment, region, registre, rng) {
  const L = lettresEcrites().filter(x => x.moment === moment && (x.region === region || x.region === '*') && (x.registre === registre || x.registre === '*'));
  return L.length ? L[Math.floor(rng() * L.length) % L.length].texte : null;
}
/* Chaque texte existe au singulier et au pluriel (plusieurs héros partent ensemble). Les lettres de route sont écrites par le premier héros. */
const LETTRES_VOYAGE = {
  depart: [
    ["{nom} part à l'aube, un sac sur l'épaule, {vers_lieu}. {chien} suit jusqu'au portail, puis reste assis là longtemps, même quand il n'y a plus rien à voir.",
     "{nom} partent à l'aube, sac sur l'épaule, {vers_lieu}. {chien} les suit jusqu'au portail, puis reste assis là longtemps, même quand il n'y a plus rien à voir."],
    ["Avant de partir pour {region}, {nom} fait le tour du repère, pose la main sur la grande table, et s'en va sans se retourner. Le voyage va durer {duree}.",
     "Avant de partir pour {region}, {nom} font le tour du repère, saluent tout le monde, et s'en vont sans se retourner. Le voyage va durer {duree}."],
    ["{nom} a préparé son sac la veille, et l'a refait deux fois. Au matin, quelques mots griffonnés sur la table de la cuisine : « Je pars pour {region}. Gardez-moi une place au feu. »",
     "{nom} ont préparé leurs sacs la veille. Au matin, quelques mots griffonnés sur la table de la cuisine : « On part pour {region}. Gardez-nous une place au feu. »"],
  ],
  retour: [
    ["{nom} franchit le portail après {duree} d'absence, la poussière de {region} sur les bottes. {chien} saute dessus avant tout le monde.",
     "{nom} franchissent le portail après {duree} d'absence, la poussière de {region} sur les bottes. {chien} leur saute dessus avant tout le monde."],
    ["À la tombée du jour, une silhouette fatiguée remonte le chemin du repère. C'est {nom}, de retour de {region}. On ajoute une assiette, sans poser de questions. Les questions, ce sera pour demain.",
     "À la tombée du jour, deux silhouettes fatiguées remontent le chemin du repère. Ce sont {nom}, de retour de {region}. On ajoute des assiettes, sans poser de questions. Les questions, ce sera pour demain."],
  ],
};
const REGIONS_TXT = { demacia: 'Demacia', noxus: 'Noxus', freljord: 'Freljord', ionia: 'Ionia', piltover: 'Piltover', zaun: 'Zaun', shurima: 'Shurima', targon: 'Targon', bilgewater: 'Bilgewater', ixtal: 'Ixtal', bandle: 'Bandle' };
const enJours = h => { const j = Math.round(h / 24); return j <= 1 ? 'une journée' : `${['', '', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'][j] || j} jours`; };
function partirEnVoyage(g, ids, mission, quete = null) {
  const cal = mission.calendrier, rng = rngDepuis(`${g.id}#voyage#${g.t}`);
  const heros = ids.map(id => g.heros.find(x => x.id === id));
  const las = heros.filter(h => enRepos(g, h)); if (las.length) throw new Error(`${las.map(h => h.nom).join(' et ')} doit d'abord se reposer.`);
  const h = heros[0], pick = l => l[Math.floor(rng() * l.length) % l.length], pl = heros.length > 1;
  const noms = heros.map(x => x.nom).join(' et ');
  // Le genre des héros n'est pas connu : les textes sont écrits sans aucun accord sur leur nom.
  const remplir = (t, extra = {}) => t.replace(/\{nom\}/g, noms).replace(/\{auteur\}/g, h.nom).replace(/\{compagnon\}/g, heros[1]?.nom || '')
    .replace(/\{(a|de|vers)_lieu\}/g, (_, p) => Q.avecPreposition(mission.lieu, p)).replace(/\{lieu\}/g, mission.lieu)
    .replace(/\{region\}/g, REGIONS_TXT[mission.region] || mission.region)
    .replace(/\{chien\}/g, g.monde.chien).replace(/\{duree\}/g, enJours(cal.total)).replace(/\{reste\}/g, extra.reste || '');
  const deux = l => pick(l)[pl ? 1 : 0];
  // Une lettre entière, signée par le premier voyageur : « Une lettre de Braum : « … » ».
  const lettre = (moment, extra) => { const t = lettreEcrite(moment, mission.region, registreDe(h), rng); if (!t) return null;
    const corps = remplir(t, extra); return corps.startsWith('(') ? `Du courrier de ${h.nom}. ${corps}` : `Une lettre de ${h.nom} : ${corps}`; };
  for (const x of heros) { x.etat = 'voyage'; x.jusqua = g.t + cal.total; x.voyage = { mission: mission.id, quete, region: mission.region, lieu: mission.lieu }; }
  memoriser(g, { type: 'voyage', heros: ids, lieu: mission.lieu, region: mission.region });
  g.chronique.push({ t: g.t, lieu: 'cour', importance: 3, declencheur: 'voyage', scene: 'voyage#depart', heros: ids, texte: remplir(deux(LETTRES_VOYAGE.depart)) });
  const mi = Math.round(cal.aller * 0.5);
  (g.lettres ||= []).push(
    { t: g.t + mi, heros: ids, scene: 'voyage#route', texte: lettre(pl ? 'route2' : 'route', { reste: enJours(cal.aller - mi) }) },
    { t: g.t + cal.aller, heros: ids, scene: 'voyage#arrivee', texte: lettre(pl ? 'arrivee2' : 'arrivee') },
    { t: g.t + cal.total, heros: ids, scene: 'voyage#retour', texte: remplir(deux(LETTRES_VOYAGE.retour)), retour: true, mission: mission.id },
  );
}
/* Les lettres arrivent à leur heure ; le retour remet le héros au repère, fatigué, et signale l'étape à régler. */
function distribuerLettres(g) {
  if (!g.lettres?.length) return;
  const dues = g.lettres.filter(l => l.t <= g.t); g.lettres = g.lettres.filter(l => l.t > g.t);
  for (const l of dues) {
    if (l.texte) g.chronique.push({ t: g.t, lieu: l.retour ? 'cour' : null, importance: l.retour ? 3 : 2, declencheur: l.dec || 'voyage', scene: l.scene, heros: l.heros, texte: F.finir(l.texte) });
    if (!l.retour) continue;
    for (const id of l.heros) { const h = g.heros.find(x => x.id === id); if (!h || h.etat !== 'voyage') continue;
      h.etat = 'present'; h.jusqua = null; h.besoins.energie = Math.min(h.besoins.energie, 30); h.aRaconter = 'recit_mission';
      h.repos = 24; h.reposJusqua = g.t + 24; souvenir(h, g.t, 4, 'De retour de voyage', 48); }
    (g.voyagesARegler ||= []).push({ mission: l.mission, heros: l.heros });
  }
}

/* ---------- Rattrapage ---------- */
/* Rejoue la vie de la guilde jusqu'à l'instant donné (en heures depuis l'époque). */
function simuler(g, jusqua, scenes, arcs = null, quetes = null) {
  const debut = g.t;
  while (g.t + PARAMS.creneau <= jusqua) simulerCreneau(g, scenes, jusqua - g.t <= PARAMS.rattrapageDetailleMax, arcs, quetes);
  return g.chronique.filter(e => e.t >= debut);
}

/* Résumé pour le retour du joueur : les scènes marquantes d'abord, puis la routine comptée par héros. */
function resumerAbsence(g, depuis) {
  const scenes = g.chronique.filter(e => e.t >= depuis);
  return {
    marquantes: scenes.filter(e => e.importance >= 2),
    petites: scenes.filter(e => e.importance < 2),
    cartes: g.cartes.filter(c => c.t >= depuis || c.etat === 'ouverte'),
    soirees: g.soirees.filter(s => s.t >= depuis),
  };
}

module.exports = {
  nomMaitre,
  MA, PARAMS, nommerChien, CHIENS, OBLIGATOIRES, creerCarte, LIEUX, LIEUX_DE_BASE, ACTIVITES, CARTES,
  rngDepuis, heureLocale, estNuit, enRepos, meteo, memoriser, creerGuilde, ajouterHeros, compatibilite, relation, raisonsMoral, souvenir,
  simulerCreneau, simuler, organiserSoiree, enregistrerQuetes, finMissionQuete, repondre, departMission, retourMission, partirEnVoyage, distribuerLettres, resumerAbsence,
};
