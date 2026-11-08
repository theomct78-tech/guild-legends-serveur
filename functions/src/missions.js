'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — postes, trajets et cycle de vie des missions (décisions du 7 nov. 2026, § 12 du cahier des charges).
 *
 * Une mission a des postes par rôle. Les guildes y placent leurs héros, premier arrivé premier servi.
 * Un héros doit pouvoir arriver sur place avant le départ : les trajets se comptent en heures.
 * Au départ, un poste vide demande la confirmation des guildes engagées. Si personne ne part,
 * la mission a lieu sans personne : les guildes à qui elle a été proposée et qui pouvaient arriver à temps perdent de la réputation.
 */

/* ---------- Postes ---------- */

// Qui peut tenir quel poste, et avec quelle efficacité (1 = pleinement).
// cles : épreuves où l'absence du poste se fait le plus sentir. blessure : risque ajouté si le poste est vide.
const POSTES = {
  Tank:       { accepte: { Tank: 1, Combattant: 0.5 }, cles: ['combat', 'nuee', 'siege'], blessure: 0.10 },
  DPS:        { accepte: { Assassin: 1, Combattant: 1, Mage: 1, Tireur: 1 }, cles: ['combat', 'nuee', 'siege', 'poursuite'] },
  Assassin:   { accepte: { Assassin: 1 }, cles: ['discretion', 'combat', 'poursuite'] },
  Combattant: { accepte: { Combattant: 1, Tank: 0.5 }, cles: ['combat', 'siege', 'nuee'] },
  Mage:       { accepte: { Mage: 1 }, cles: ['combat', 'nuee', 'siege'] },
  Tireur:     { accepte: { Tireur: 1 }, cles: ['combat', 'nuee', 'poursuite'] },
  Support:    { accepte: { Support: 1 }, cles: ['voyage', 'diplomatie', 'combat'] },
  // Spécialités : la spécialité pleine tient le poste, celle « d'appoint » le tient à moitié
  Healer:     { specialite: { Healer: 1, "Soins d'appoint": 0.5 }, cles: ['voyage', 'nuee', 'combat'], blessure: 0.10 },
  Éclaireur:  { specialite: { Éclaireur: 1, "Éclaireur d'appoint": 0.5 }, cles: ['discretion', 'voyage', 'poursuite'] },
};

const PARAMS = {
  roleSecondaire: 0.75,         // un rôle secondaire tient le poste à 75 %
  penalitePosteCle: 8,          // poste vide : -8 sur ses épreuves clés
  penalitePosteAutre: 3,        // et -3 sur les autres épreuves
  trajetIntraRegion: 3,         // heures pour rejoindre un lieu de sa propre région quand le lieu est inconnu
  // Décision de Théo (8 nov. 2026) : une mission dure longtemps, trajets compris, mais jamais plus de 48 h aller-retour.
  dureeMax: 48, surPlaceMin: 2,
  // Repos après une mission, en heures : base + part de la durée totale × dureté, + issue et blessures. Le héros reste au repère, indisponible.
  repos: { base: 6, parHeure: 0.3, issue: { eclatante: 0, reussite: 0, partielle: 2, echec: 6 }, blessureLegere: 12, blessureGrave: 36, max: 72 },
  durete: { inconnue: 1, locale: 1.25, regionale: 1.5, renommee: 1.75, legendaire: 2, quete: 1.25, risque: 0.75, dangereuse: 0.75 },
  delaiConfirmation: 2,         // heures pour confirmer un départ incomplet ; sans réponse, la guilde est réputée refuser
  perteReputationAbandon: 3,    // par niveau de mission, pour chaque guilde à qui la mission a été proposée
};

/* Efficacité d'un héros sur un poste : 0 s'il ne peut pas le tenir. heros : { role, role_secondaire, specialites }. */
function efficacitePoste(heros, type) {
  const p = POSTES[type]; if (!p) throw new Error(`Poste inconnu : ${type}`);
  if (p.specialite) return Math.max(0, ...(heros.specialites || []).map(s => p.specialite[s] || 0));
  const principal = p.accepte[heros.role] || 0;
  const secondaire = (p.accepte[heros.role_secondaire] || 0) * PARAMS.roleSecondaire;
  return Math.max(principal, secondaire);
}

/* Pénalité de composition sur une épreuve : chaque poste vide ou tenu imparfaitement coûte des points. */
function penaliteComposition(postes, typeEpreuve) {
  let p = 0;
  for (const poste of postes) {
    const manque = 1 - (poste.heros ? poste.efficacite : 0);
    if (manque <= 0) continue;
    p += manque * (POSTES[poste.type].cles.includes(typeEpreuve) ? PARAMS.penalitePosteCle : PARAMS.penalitePosteAutre);
  }
  return Math.round(p * 10) / 10;
}

/* Risque de blessure ajouté par les postes protecteurs vides (Tank, Healer). */
function risqueBlessureComposition(postes) {
  return postes.reduce((t, p) => t + (POSTES[p.type].blessure || 0) * (1 - (p.heros ? p.efficacite : 0)), 0);
}

/* ---------- Trajets ---------- */

// Durées en heures entre régions voisines. Temps de jeu compressé : réaliste dans les proportions, pas en temps réel.
// Valoran : Demacia à l'ouest, Noxus au centre, Freljord au nord, Piltover et Zaun sur la côte. Shurima au sud,
// Targon sur la frontière de Shurima, Ixtal dans ses jungles de l'est. Ionia et Bilgewater par la mer.
const ROUTES = [
  ['demacia', 'freljord', 8], ['demacia', 'noxus', 7], ['demacia', 'targon', 9],
  ['noxus', 'freljord', 9], ['noxus', 'piltover', 6], ['noxus', 'ionia', 12], ['noxus', 'shurima', 12],
  ['piltover', 'zaun', 1], ['piltover', 'shurima', 8], ['piltover', 'bilgewater', 10], ['piltover', 'ionia', 11],
  ['targon', 'shurima', 7], ['shurima', 'ixtal', 9], ['bilgewater', 'ionia', 10], ['bilgewater', 'shurima', 12],
];
// Bandle : les portails des yordles s'ouvrent un peu partout dans Runeterra, mais ne servent pas de raccourci aux autres
const PORTAILS_BANDLE = 6;

function graphe() {
  const g = {};
  const lier = (a, b, h) => { (g[a] ||= {})[b] = h; (g[b] ||= {})[a] = h; };
  for (const [a, b, h] of ROUTES) lier(a, b, h);
  for (const r of Object.keys(g)) lier('bandle', r, PORTAILS_BANDLE);
  return g;
}
const GRAPHE = graphe();

/* Trajet aller entre le repère et un lieu de sa région (catalogue/missions/trajets.json). */
const TRAJETS = (() => { try { return require(require('node:path').join(CATALOGUE, 'missions/trajets.json')); } catch { return {}; } })();
function trajetLieu(region, lieu) {
  if (!lieu) return PARAMS.trajetIntraRegion;
  return TRAJETS[region]?.[lieu] ?? TRAJETS._defaut ?? PARAMS.trajetIntraRegion;
}

/* Durée du trajet aller en heures entre la région d'une guilde et le lieu d'une mission (plus court chemin, puis le lieu). */
function dureeTrajet(de, vers, lieu = null) {
  const local = trajetLieu(vers, lieu);
  if (de === vers) return local;
  const dist = { [de]: 0 }; const vus = new Set();
  while (true) {
    const r = Object.keys(dist).filter(k => !vus.has(k)).sort((a, b) => dist[a] - dist[b])[0];
    if (r === undefined) throw new Error(`Aucune route de ${de} vers ${vers}`);
    if (r === vers) return dist[r] + local;
    vus.add(r);
    if (r === 'bandle' && de !== 'bandle') continue; // les portails ne servent qu'aux yordles qui partent de Bandle ou y vont
    for (const [v, h] of Object.entries(GRAPHE[r] || {})) if (dist[v] === undefined || dist[r] + h < dist[v]) dist[v] = dist[r] + h;
  }
}

/*
 * Le calendrier d'une mission pour une guilde : aller, temps sur place, retour. Le total ne dépasse jamais 48 h :
 * le temps sur place est raccourci si la route est longue (au moins 2 h), et la mission est hors de portée au-delà.
 */
// opts.trajet : multiplicateur des trajets (les écuries du repère : 0,8). Arrondi à l'heure, jamais moins d'une heure.
function calendrier(regionGuilde, mission, opts = {}) {
  const brut = dureeTrajet(regionGuilde, mission.region, mission.lieu);
  const aller = opts.trajet && opts.trajet !== 1 ? Math.max(1, Math.round(brut * opts.trajet)) : brut;
  const surPlace = Math.min(mission.duree, PARAMS.dureeMax - 2 * aller);
  const possible = surPlace >= PARAMS.surPlaceMin;
  return { aller, surPlace: possible ? surPlace : 0, retour: aller, total: possible ? 2 * aller + surPlace : 2 * aller + PARAMS.surPlaceMin, possible };
}

/* Repos après une mission : plus elle a été longue, dure, ratée ou sanglante, plus le héros a besoin de temps. Par tranches de 2 h. */
function reposApresMission({ total, palier = 'inconnue', risque = false, dangereuse = false, issue = 'reussite', blessure = null }) {
  const R = PARAMS.repos, D = PARAMS.durete;
  const durete = (D[palier] ?? 1) + (risque ? D.risque : 0) + (dangereuse ? D.dangereuse : 0);
  let h = R.base + total * R.parHeure * durete + (R.issue[issue] ?? 0);
  if (blessure === 'legere') h += R.blessureLegere;
  if (blessure === 'grave') h += R.blessureGrave;
  return Math.min(R.max, Math.ceil(h / 2) * 2);
}

/* ---------- Cycle de vie ---------- */

const H = 3600 * 1000;

/*
 * Crée une mission. source : 'institution' (proposée à toutes les guildes) ou 'privee' (une guilde hôte, qui peut inviter).
 * depart : horodatage (ms). duree : heures sur place. niveau : 1 à 5.
 */
function creerMission({ id, titre, source, region, lieu = null, palier = 'inconnue', publiee = 0, depart, duree, niveau = 1, postes, epreuves, dangereuse = false, risque = false, guildesProposees = [], hote = null }) {
  if (!['institution', 'privee'].includes(source)) throw new Error('Source de mission inconnue.');
  if (source === 'privee' && !hote) throw new Error('Une mission privée a une guilde hôte.');
  return {
    id, titre, source, region, lieu, palier, publiee, depart, duree, niveau, epreuves, dangereuse, risque, hote,
    rang: epreuves?.length ? require('./rangs').rangContrat({ epreuves }) : null,
    guildesProposees: source === 'privee' ? [hote] : guildesProposees,
    invitees: [],
    postes: postes.map(type => { efficacitePoste({}, type); return { type, guilde: null, heros: null, efficacite: 0 }; }),
    statut: 'ouverte', confirmations: {},
  };
}

/* Mission privée : la guilde hôte invite une autre guilde à compléter un poste. */
function inviter(mission, guildeHote, guildeInvitee) {
  if (mission.source !== 'privee') throw new Error('Seules les missions privées passent par invitation.');
  if (guildeHote !== mission.hote) throw new Error('Seule la guilde hôte peut inviter.');
  if (!mission.invitees.includes(guildeInvitee)) mission.invitees.push(guildeInvitee);
  if (!mission.guildesProposees.includes(guildeInvitee)) mission.guildesProposees.push(guildeInvitee);
  return mission;
}

function peutParticiper(mission, guilde) {
  return mission.source === 'institution' ? mission.guildesProposees.includes(guilde) : guilde === mission.hote || mission.invitees.includes(guilde);
}

/*
 * Place un héros sur un poste libre. Renvoie l'heure d'arrivée sur place.
 * candidat : { guilde, regionGuilde, heros: { id, nom, role, role_secondaire, specialites } }, maintenant : ms.
 */
function positionner(mission, index, candidat, maintenant) {
  if (mission.statut !== 'ouverte') throw new Error('Cette mission n’accepte plus de héros.');
  if (!peutParticiper(mission, candidat.guilde)) throw new Error('Cette mission ne t’a pas été proposée.');
  const poste = mission.postes[index]; if (!poste) throw new Error('Poste inconnu.');
  // Un poste pris peut être repris tant que le recrutement est ouvert (décision de Théo, 8 nov. 2026) :
  // un héros de meilleur rang l'emporte sur un titulaire qui n'a pas le rang du contrat. À rang égal, ou si le titulaire
  // a déjà le rang attendu, le premier placé garde sa place.
  const RG0 = require('./rangs'), rangC = mission.rang || (mission.epreuves?.length ? RG0.rangContrat(mission) : null);
  let evince = null;
  if (poste.heros) {
    const peut = rangC && candidat.heros.stats && poste.heros.stats && RG0.peutReprendre(poste.heros.stats, candidat.heros.stats, poste.type, rangC);
    if (!peut) throw new Error(poste.heros.stats && rangC ? `Ce poste est déjà tenu par ${poste.heros.nom} (rang ${RG0.rangHeros(poste.heros.stats, poste.type)}). Il faudrait un meilleur rang, et que ce titulaire soit sous le rang ${rangC} du contrat.` : 'Ce poste est déjà réservé par une autre guilde.');
    evince = { guilde: poste.guilde, heros: poste.heros };
  }
  if (mission.postes.some(p => p.heros?.id === candidat.heros.id)) throw new Error('Ce héros tient déjà un poste.');
  if (efficacitePoste(candidat.heros, poste.type) === 0) throw new Error(`${candidat.heros.nom} ne peut pas tenir le poste ${poste.type}.`);
  // Rang (rangs.js) : sous le rang du contrat, le poste est moins bien tenu. Jamais interdit.
  const RG = require('./rangs'), rang = mission.rang || (mission.epreuves?.length ? RG.rangContrat(mission) : null);
  const eff = RG.efficaciteAvecRang(candidat.heros, poste.type, rang);
  if (candidat.heros.reposJusqua && maintenant < candidat.heros.reposJusqua) throw new Error(`${candidat.heros.nom} se remet encore de sa dernière mission.`);
  const cal = calendrier(candidat.regionGuilde, mission), trajet = cal.aller;
  if (!cal.possible) throw new Error(`Hors de portée : ${trajet} h de route à l'aller, l'aller-retour dépasserait 48 h.`);
  const arrivee = maintenant + trajet * H;
  if (arrivee > mission.depart) throw new Error(`Trop loin : ${trajet} h de trajet, la mission part avant son arrivée.`);
  Object.assign(poste, { guilde: candidat.guilde, heros: candidat.heros, efficacite: eff, trajet, place: maintenant });
  if (evince) (mission.evinces ||= []).push({ ...evince, poste: poste.type, par: candidat.guilde, t: maintenant });
  return { arrivee, trajet, surPlace: cal.surPlace, total: cal.total, efficacite: eff, occupeJusqua: mission.depart + (cal.surPlace + trajet) * H, evince };
}

/* Une guilde se désiste : son héros libère le poste. */
function retirer(mission, guilde, heroId) {
  for (const p of mission.postes) if (p.guilde === guilde && (!heroId || p.heros.id === heroId)) Object.assign(p, { guilde: null, heros: null, efficacite: 0, trajet: undefined });
  return mission;
}

function guildesEngagees(mission) { return [...new Set(mission.postes.filter(p => p.heros).map(p => p.guilde))]; }

/*
 * Mission abandonnée : elle a lieu sans personne. Perdent de la réputation les guildes à qui elle a été proposée
 * et qui pouvaient arriver à temps (trajet depuis leur région ≤ délai entre publication et départ), plus celles qui s'étaient engagées.
 * regions : { guilde: région }. Sans région connue, la guilde est pénalisée par défaut.
 */
function abandonner(mission, regions = {}) {
  mission.statut = 'abandonnee';
  const delai = (mission.depart - mission.publiee) / H;
  const engagees = mission.engageesAvantDepart || [];
  const fautives = mission.guildesProposees.filter(g => engagees.includes(g) || !regions[g] || dureeTrajet(regions[g], mission.region) <= delai);
  mission.pertesReputation = Object.fromEntries(fautives.map(g => [g, -PARAMS.perteReputationAbandon * mission.niveau]));
  return mission;
}

/* À l'heure du départ : complète → en cours ; incomplète → confirmation ; vide → abandonnée. */
function auDepart(mission, regions = {}) {
  if (mission.statut !== 'ouverte') return mission;
  const engagees = guildesEngagees(mission);
  mission.engageesAvantDepart = engagees;
  if (engagees.length === 0) return abandonner(mission, regions);
  if (mission.postes.every(p => p.heros)) { mission.statut = 'en_cours'; return mission; }
  mission.statut = 'confirmation';
  mission.confirmations = Object.fromEntries(engagees.map(g => [g, null]));
  mission.finConfirmation = mission.depart + PARAMS.delaiConfirmation * H;
  return mission;
}

/* Une guilde engagée accepte ou refuse de partir incomplète. Refuser retire ses héros. */
function confirmer(mission, guilde, accepte, regions = {}) {
  if (mission.statut !== 'confirmation') throw new Error('Aucune confirmation en attente.');
  if (!(guilde in mission.confirmations)) throw new Error('Ta guilde n’est pas engagée sur cette mission.');
  mission.confirmations[guilde] = Boolean(accepte);
  if (!accepte) retirer(mission, guilde);
  return conclureConfirmation(mission, false, regions);
}

/* Clôt la confirmation quand tout le monde a répondu, ou à l'échéance (sans réponse = refus). */
function conclureConfirmation(mission, echeance = true, regions = {}) {
  if (mission.statut !== 'confirmation') return mission;
  const reponses = Object.values(mission.confirmations);
  if (!echeance && reponses.includes(null)) return mission;
  for (const [g, r] of Object.entries(mission.confirmations)) if (r === null) { mission.confirmations[g] = false; retirer(mission, g); }
  return guildesEngagees(mission).length ? Object.assign(mission, { statut: 'en_cours' }) : abandonner(mission, regions);
}

module.exports = {
  POSTES, PARAMS, ROUTES, TRAJETS, efficacitePoste, penaliteComposition, risqueBlessureComposition, dureeTrajet, trajetLieu, calendrier, reposApresMission,
  creerMission, inviter, positionner, retirer, auDepart, confirmer, conclureConfirmation,
};
