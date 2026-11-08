'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — le monde partagé (8 nov. 2026).
 *
 * Ce module fait tourner le jeu entier, toutes guildes confondues, sans rien savoir de Firebase : il prend un état
 * (un objet), avance le temps, applique les actions des joueurs, et rend l'état. Le serveur (index.js) ne fait que
 * le charger, l'appeler et l'enregistrer. Tout est donc testable hors ligne (test/monde.test.js), et rejouable.
 *
 * Le temps est en heures depuis l'époque Unix (UTC), par créneaux de 2 h. Les rendez-vous du monde sont à l'heure de Paris :
 *  - 6 h : la Chambre des Bannières publie les contrats du jour ; une candidature spontanée peut arriver ;
 *          le lundi, on paie les salaires de la semaine.
 *  - 12 h : la vie du repère fait son bilan (fidélité, quêtes, billets : vie.js) ; le lundi, on recompte les territoires.
 *  - le premier samedi du mois, 18 h : le tournoi.
 * Un contrat ferme son recrutement à son départ (publication + 12 h). Chaque héros quitte le repère à temps pour être
 * sur place au départ, la mission se résout à la fin du travail sur place, et chacun rentre à l'heure de son trajet.
 */
const fs = require('node:fs');
const path = require('node:path');
const V = require('./vie'), S = require('./scenes'), A = require('./arcs'), Q = require('./quetes'), B = require('./billets');
const M = require('./missions'), RES = require('./resolution'), P = require('./progression'), REC = require('./recrutement');
const RP = require('./repere'), RG = require('./rangs'), MJ = require('./multijoueur'), RA = require('./rapport'), RULES = require('./rules');
const EQ = require('./equipement');

const H_MS = 3600000;
const PARAMS = {
  heurePublication: 6, heureBilan: 12, heureTournoi: 18,
  fenetreRecrutement: 12,                // heures entre la publication d'un contrat et son départ
  contratsBase: 3,                       // contrats par guilde et par jour, + 1 tous les 5 niveaux (et la salle des cartes, les territoires)
  partHorsRegion: 1 / 3,                 // part des contrats tirés dans une autre région à portée
  poFondation: 150, dossiersFondation: 3,
  // Salaire hebdomadaire selon le potentiel (proposition validée le 8 nov. 2026 : salaires à la semaine)
  salaire: { B: 8, 'B+': 10, 'A-': 12, A: 14, 'A+': 17, 'S-': 20, S: 24, 'S+': 28, G: 35 },
  // Missions sans lot écrit pour un palier : celles du palier Inconnue, mises à l'échelle
  echelle: { po: { inconnue: 1, locale: 3.3, regionale: 7.5, renommee: 17, legendaire: 40 }, rep: { inconnue: 1, locale: 1.6, regionale: 2.8, renommee: 4.2, legendaire: 7 }, diff: { inconnue: 0, locale: 10, regionale: 20, renommee: 30, legendaire: 40 } },
  issuePO: { eclatante: 1.15, reussite: 1, partielle: 0.5, echec: 0 },
  mortSurGrave: 0.25,                    // mission dangereuse, épreuve ratée gravement : une blessure grave sur quatre est mortelle
  conserverChronique: 300, conserverRapports: 30, conserverAvis: 60,
};

/* ---------- Catalogues (chargés une fois) ---------- */
let CAT = null;
function catalogues() {
  if (CAT) return CAT;
  const racine = CATALOGUE;
  const lire = f => JSON.parse(fs.readFileSync(path.join(racine, f), 'utf8'));
  const quetes = Q.chargerQuetes(); V.enregistrerQuetes(quetes);
  CAT = { fiches: lire('fiches.json'), base: lire('personnalites/personnalites.json'), perso: lire('personnalites/personnalites-heros.json'),
    missions: lire('missions/missions.json'), scenes: S.chargerScenes(), arcs: A.chargerArcs(), quetes };
  CAT.liens = Object.fromEntries(Object.entries(CAT.base).map(([c, p]) => [c, p.liens]));
  CAT.parCle = Object.fromEntries(CAT.fiches.map(f => [`${f.champion}|${f.skin}`, f]));
  return CAT;
}

/* ---------- Outils ---------- */
const rngDe = texte => V.rngDepuis(texte);
const creneauLocal = t => Math.floor(V.heureLocale(t) / 2) * 2;
const jourDe = t => Math.floor(t / 24);
const lundi = t => new Date(t * H_MS).getUTCDay() === 1;
function premierSamediDuMois(t) { const d = new Date(t * H_MS); return d.getUTCDay() === 6 && d.getUTCDate() <= 7; }
const actifs = g => g.heros.filter(h => !['parti', 'mort'].includes(h.etat));
const palierDe = g => REC.palierDe(g.niveau || 1).cle;
const ficheDe = h => catalogues().parCle[h.cle];
const statsDe = h => EQ.statsEquipees(P.statsActuelles(h.cle, ficheDe(h).plafonds, h.xp || {}), h, ficheDe(h));
const disponible = (g, h) => h.etat === 'present' && !V.enRepos(g, h) && !h.blesse && !h.reserve;
function avis(g, texte, extra = {}) { (g.avis ||= []).unshift({ t: g.t, texte, ...extra }); g.avis.length = Math.min(g.avis.length, PARAMS.conserverAvis); }

/* Un héros prêt à vivre au repère, depuis sa fiche. */
function nouveauHeros(cle, t) {
  const C = catalogues(), f = C.parCle[cle]; if (!f) throw new Error(`Fiche inconnue : ${cle}`);
  const p = C.perso[cle] || C.base[f.champion], b = C.base[f.champion] || {};
  const id = f.skin === 'Classic' ? f.champion : `${f.champion} ${f.skin}`.replace(/\s+/g, ' ');
  // Dans les textes, un héros s'appelle par son nom de champion (« Graves », pas « Pool Party Graves ») ; l'apparence reste sur sa fiche.
  return { id, nom: f.champion, apparence: f.skin === 'Classic' ? null : f.skin, cle, champion: f.champion, univers: f.skin === 'Classic' ? 'classic' : (f.gamme || f.skin),
    niveau: 1, role: f.role, role_secondaire: f.role_secondaire, specialites: f.specialites || [], tier: f.potentiel,
    salaire: PARAMS.salaire[f.potentiel], attente: PARAMS.salaire[f.potentiel], axes: p.axes, traits: p.traits, motivation: p.motivation, regions: b.regions || { aime: [], deteste: [] }, xp: {}, equipement: [] };
}

/* ---------- Le monde ---------- */
function creerMonde(t) {
  return { t: Math.floor(t / 2) * 2, version: 0, seq: 0, guildes: {}, contrats: {}, alliances: {}, invitations: [], ruptures: {},
    territoires: { detenteurs: {}, gains: [] }, tournois: { inscriptions: {}, historique: [] }, registre: [] };
}
const indisponibles = monde => new Set([
  ...Object.values(monde.guildes).flatMap(g => [...actifs(g).map(h => h.cle), ...(g.candidatures || []).map(c => c.cle)]),
  ...monde.registre.map(r => r.cle),
]);

/* Fondation : 150 PO, trois dossiers au choix, un chien. */
function fonderGuilde(monde, { id, nom, region, maitre = null, chien = null, devise = '', maitreNom = null, couleur = null }) {
  if (monde.guildes[id]) throw new Error('Cette guilde existe déjà.');
  const C = catalogues();
  const g = V.creerGuilde({ id, nom, region, niveau: 1, po: PARAMS.poFondation, t: monde.t, heros: [], liens: C.liens, chien, maitre });
  Object.assign(g, { reputation: 0, fondee: monde.t, devise, maitreNom, couleur, candidatures: [], rapports: [], avis: [], pantheon: [], inventaire: [], salles: [], dernierePaie: monde.t });
  g.candidatures = REC.candidaturesMonteeNiveau(g, C.fiches, 1, jourDe(monde.t), { indisponibles: indisponibles(monde) }).slice(0, PARAMS.dossiersFondation)
    .map(d => ({ ...d, recue: monde.t, expire: monde.t + 24 * 7, fondation: true }));
  monde.guildes[id] = g;
  avis(g, `La guilde ${nom} ouvre les portes de son repère. Trois héros ont envoyé leur dossier : choisis qui entre en premier.`);
  return g;
}

/* ---------- Recrutement ---------- */
function recruter(monde, gid, cle, remplacerId = null) {
  const g = monde.guildes[gid], c = (g.candidatures || []).find(x => x.cle === cle && x.expire > monde.t);
  if (!c) throw new Error('Cette candidature n\'est plus valable.');
  const cap = RULES.capacity(g.niveau || 1), n = actifs(g).length;
  if (n >= cap) {
    if (!remplacerId) throw new Error(`Le repère est plein (${cap} places) : choisis qui laisser partir.`);
    const r = g.heros.find(h => h.id === remplacerId && !['parti', 'mort'].includes(h.etat)); if (!r) throw new Error('Ce héros ne fait pas partie de ta guilde.');
    if (r.etat !== 'present') throw new Error(`${r.nom} n'est pas au repère.`);
    r.etat = 'parti'; monde.registre.push({ cle: r.cle, depuis: monde.t, raison: 'remplace', perduPar: [gid] });
    EQ.rendreEquipement(g, r);
    avis(g, `${r.nom} quitte la guilde pour laisser sa place.`);
  } else if (remplacerId) throw new Error('Il reste une place libre : inutile de remplacer quelqu\'un.');
  const nh = nouveauHeros(cle, monde.t);
  // Deux héros du même champion au repère : le second garde son apparence dans son nom, pour qu'on sache de qui l'on parle.
  if (actifs(g).some(x => x.champion === nh.champion)) nh.nom = nh.apparence || `${nh.champion} le second`;
  const h = V.ajouterHeros(g, nh, catalogues().liens);
  g.candidatures = g.candidatures.filter(x => x !== c);
  avis(g, `${h.nom} pose son sac au repère.`);
  return h;
}
function refuserCandidature(monde, gid, cle) { const g = monde.guildes[gid]; g.candidatures = (g.candidatures || []).filter(c => c.cle !== cle); }
function poserAnnonce(monde, gid, role) { return REC.poserAnnonce(monde.guildes[gid], role); }

/* ---------- Contrats ---------- */
function versionPalier(m, p) {
  if (m.palier === p) return { ...m, po: m.recompenses.po, rep: m.recompenses.reputation };
  const E = PARAMS.echelle;
  return { ...m, palier: p, epreuves: m.epreuves.map(e => ({ ...e, difficulte: e.difficulte + E.diff[p] })), po: Math.round(m.recompenses.po * E.po[p]), rep: Math.max(1, Math.round(m.recompenses.reputation * E.rep[p])) };
}
function publierContrats(monde) {
  const C = catalogues(), t = monde.t, actifsIds = new Set(Object.values(monde.contrats).filter(c => c.statut !== 'clos').map(c => c.mission.id));
  for (const g of Object.values(monde.guildes)) {
    const p = palierDe(g), rng = rngDe(`${g.id}#contrats#${jourDe(t)}`);
    const terr = MJ.effetsTerritoire(monde.territoires.detenteurs, g.id);
    const n = PARAMS.contratsBase + Math.floor((g.niveau || 1) / 5) + RP.effet(g, 'contrats') + terr.contratsEnPlus;
    for (let i = 0; i < n; i++) {
      const ailleurs = rng() < PARAMS.partHorsRegion;
      const regions = ailleurs ? [...new Set(C.missions.map(m => m.region))].filter(r => r !== g.region) : [g.region];
      const region = terr.regions.length && i < terr.contratsEnPlus ? terr.regions[i % terr.regions.length] : regions[Math.floor(rng() * regions.length)];
      const ecrites = C.missions.filter(m => m.region === region && m.palier === p && !actifsIds.has(m.id));
      const base = C.missions.filter(m => m.region === region && m.palier === 'inconnue' && !actifsIds.has(m.id));
      const pool = p !== 'inconnue' && ecrites.length && rng() < 2 / 3 ? ecrites : base; if (!pool.length) continue;
      const m = versionPalier(pool[Math.floor(rng() * pool.length)], p);
      // Atteignable, et à temps : il faut pouvoir partir avant la fermeture du recrutement.
      const calG = M.calendrier(g.region, m, { trajet: RP.effet(g, 'trajet') });
      if (!calG.possible) continue;
      // Le recrutement reste ouvert au moins 12 h, et assez longtemps pour que la guilde la plus proche ait le temps de partir.
      const fenetre = Math.max(PARAMS.fenetreRecrutement, calG.aller + 8);
      actifsIds.add(m.id);
      const id = `C${++monde.seq}`;
      // Le contrat est proposé à toutes les guildes du même palier qui peuvent l'atteindre : la course aux postes commence.
      const proposees = Object.values(monde.guildes).filter(o => { const cal = M.calendrier(o.region, m, { trajet: RP.effet(o, 'trajet') }); return palierDe(o) === p && cal.possible && cal.aller <= fenetre - 2; }).map(o => o.id);
      const mission = M.creerMission({ id, titre: m.titre, source: 'institution', region: m.region, lieu: m.lieu, palier: p, publiee: t * H_MS, depart: (t + fenetre) * H_MS,
        duree: m.duree, postes: m.postes, epreuves: m.epreuves, dangereuse: m.dangereuse, risque: m.risque, guildesProposees: proposees });
      monde.contrats[id] = { id, mission: m, m: mission, publie: t, depart: t + fenetre, statut: 'ouvert', origine: g.id };
    }
  }
}
function contratsPour(monde, gid) { return Object.values(monde.contrats).filter(c => c.statut === 'ouvert' && c.m.guildesProposees.includes(gid)); }

/* Placer un héros sur un poste. Un poste tenu sous le rang du contrat peut être repris par un meilleur rang (rangs.js). */
function placer(monde, gid, cid, index, heroId) {
  const g = monde.guildes[gid], c = monde.contrats[cid];
  if (!c || c.statut !== 'ouvert') throw new Error('Ce contrat n\'accepte plus personne.');
  const h = g.heros.find(x => x.id === heroId); if (!h) throw new Error('Héros inconnu.');
  if (!disponible(g, h)) throw new Error(`${h.nom} n'est pas disponible.`);
  const heros = { id: h.id, nom: h.nom, role: h.role, role_secondaire: h.role_secondaire, specialites: h.specialites, stats: statsDe(h), guilde: gid };
  const r = M.positionner(c.m, index, { guilde: gid, regionGuilde: g.region, heros }, monde.t * H_MS);
  h.reserve = cid;
  if (r.evince) {
    const og = monde.guildes[r.evince.guilde], oh = og?.heros.find(x => x.id === r.evince.heros.id);
    if (oh) oh.reserve = null;
    if (og) avis(og, `${g.nom} a envoyé ${h.nom}, de meilleur rang, sur le poste de ${c.m.postes[index].type} du contrat « ${c.mission.titre} ». ${r.evince.heros.nom} rentre au repère et reste libre pour un autre contrat.`, { type: 'eviction', contrat: cid });
  }
  return { ...r, rang: RG.rangHeros(heros.stats, c.m.postes[index].type), rangContrat: c.m.rang };
}
/* Chances de réussite d'un contrat, avec les héros déjà placés et, si besoin, un héros de plus (pour l'aide au choix). */
function chanceContrat(monde, cid, ajouts = []) {
  const c = monde.contrats[cid]; if (!c) return 0;
  ajouts = Array.isArray(ajouts) ? ajouts : [ajouts];
  const postes = c.m.postes.map((p, i) => {
    const ajout = ajouts.find(a => a.index === i);
    if (ajout) { const g = monde.guildes[ajout.gid], h = g.heros.find(x => x.id === ajout.heroId);
      const st = statsDe(h); return { type: p.type, heros: { nom: h.nom, stats: st, moral: h.moral }, efficacite: RG.efficaciteAvecRang({ ...h, stats: st }, p.type, c.m.rang) }; }
    if (!p.heros) return { type: p.type, heros: null, efficacite: 0 };
    const h = monde.guildes[p.guilde]?.heros.find(x => x.id === p.heros.id);
    return { type: p.type, heros: { nom: p.heros.nom, stats: h ? statsDe(h) : p.heros.stats, moral: h?.moral ?? 60 }, efficacite: p.efficacite };
  });
  const eq = postes.filter(p => p.heros).map(p => p.heros); if (!eq.length) return 0;
  return RES.chanceMission(eq, c.mission, {}, { postes });
}
function retirer(monde, gid, cid, heroId) {
  const g = monde.guildes[gid], c = monde.contrats[cid];
  if (!c || c.statut !== 'ouvert') throw new Error('Trop tard : la mission est partie.');
  M.retirer(c.m, gid, heroId); const h = g.heros.find(x => x.id === heroId); if (h) h.reserve = null;
}

/* Départs, résolution, retours. */
function faireAvancerContrats(monde) {
  const t = monde.t;
  for (const c of Object.values(monde.contrats)) {
    // Chaque héros part à temps pour arriver au départ.
    if (c.statut === 'ouvert' || c.statut === 'route') for (const p of c.m.postes) {
      if (!p.heros || p.parti) continue;
      const g = monde.guildes[p.guilde], h = g?.heros.find(x => x.id === p.heros.id);
      if (!h || t < c.depart - p.trajet) continue;
      const cal = M.calendrier(g.region, c.mission, { trajet: RP.effet(g, 'trajet') });
      p.parti = true; p.retour = c.depart + cal.surPlace + cal.aller; h.reserve = null;
      try { V.departMission(g, [h.id], p.retour); } catch { p.heros = null; p.guilde = null; p.parti = false; }
    }
    if (c.statut === 'ouvert' && t >= c.depart) { c.statut = c.m.postes.some(p => p.heros) ? 'route' : 'clos'; if (c.statut === 'clos') c.abandon = true; }
    // La mission se résout à la fin du travail sur place.
    if (c.statut === 'route' && !c.resultat && t >= c.depart + Math.min(c.mission.duree, M.PARAMS.dureeMax)) resoudre(monde, c);
    // Chacun rentre à son heure.
    if (c.resultat) for (const p of c.m.postes) if (p.heros && !p.rentre && t >= p.retour) { rentrer(monde, c, p); p.rentre = true; }
    if (c.resultat && c.m.postes.every(p => !p.heros || p.rentre)) c.statut = 'clos';
  }
  // On ne garde que les contrats récents
  for (const [id, c] of Object.entries(monde.contrats)) if (c.statut === 'clos' && t - c.depart > 24 * 3) delete monde.contrats[id];
}
function resoudre(monde, c) {
  const postes = c.m.postes.filter(p => p.heros);
  const equipe = postes.map(p => { const g = monde.guildes[p.guilde], h = g.heros.find(x => x.id === p.heros.id); return { nom: h.nom, stats: statsDe(h), moral: h.moral }; });
  const guildes = [...new Set(postes.map(p => p.guilde))].map(id => monde.guildes[id]);
  const moy = f => guildes.reduce((s, g) => s + RP.effet(g, f), 0) / guildes.length;
  const relations = Array(Math.round(MJ.cohesionAlliance(monde, postes.map(p => p.guilde), monde.t) / 4)).fill('amis');
  const rng = rngDe(`${c.id}#resolution`);
  const r = RES.resoudreMission(equipe, c.mission, {}, { postes: c.m.postes.map(p => ({ type: p.type, heros: p.heros, efficacite: p.efficacite })), relations, blessure: moy('blessure'), imprevu: Math.min(...guildes.map(g => RP.effet(g, 'imprevu'))) }, rng);
  r.morts = r.mortPossible ? r.blessures.filter(b => b.niveau === 'grave' && rng() < PARAMS.mortSurGrave).map(b => b.nom) : [];
  c.resultat = r;
}
function rentrer(monde, c, p) {
  const g = monde.guildes[p.guilde], h = g.heros.find(x => x.id === p.heros.id), r = c.resultat; if (!h) return;
  const tenus = c.m.postes.filter(x => x.heros), part = tenus.filter(x => x.guilde === p.guilde).length / tenus.length;
  const premier = tenus.find(x => x.guilde === p.guilde) === p;      // gains et rapport une fois par guilde, au retour de son premier héros
  const blesse = r.blessures.find(b => b.nom === h.nom), mort = r.morts.includes(h.nom);
  P.ajouterExperience(h.xp ||= {}, P.experienceMission(statsDe(h), c.mission, r.issue)); EQ.elixirBu(h);
  const cal = M.calendrier(g.region, c.mission, { trajet: RP.effet(g, 'trajet') });
  V.retourMission(g, [h.id], r.issue, { blesses: blesse && !mort ? [{ id: h.id, niveau: blesse.niveau }] : [], morts: mort ? [h.id] : [], mission: { titre: c.mission.titre, lieu: c.mission.lieu, palier: c.mission.palier, risque: c.mission.risque, dangereuse: c.mission.dangereuse, total: cal.total } });
  if (mort) entrerAuPantheon(monde, g, h, c);
  if (!premier) return;
  // Partage de la récompense entre guildes : à proportion des postes tenus (proposition, 8 nov. 2026).
  const bonus = MJ.effetsTerritoire(monde.territoires.detenteurs, g.id).bonusPO(c.mission.region);
  const po = Math.round(c.mission.po * PARAMS.issuePO[r.issue] * part * (1 + bonus + RP.effet(g, 'bonusPO')));
  const repBase = r.issue === 'echec' ? 0 : r.issue === 'partielle' ? Math.floor(c.mission.rep / 2) : c.mission.rep + (r.issue === 'eclatante' ? 1 : 0);
  const rep = Math.max(r.issue === 'echec' ? 0 : 1, Math.round(repBase * part));
  g.po += po; g.reputation = (g.reputation || 0) + rep;
  if (rep) monde.territoires.gains.push({ guilde: g.id, region: c.mission.region, reputation: rep, t: monde.t });
  const objet = r.issue !== 'echec' ? EQ.tirerObjet(c.mission, rngDe(`${c.id}#${g.id}#objet`)) : null;
  if (objet) (g.inventaire ||= []).push({ ...objet, gagne: monde.t, mission: c.mission.titre });
  const miens = tenus.filter(x => x.guilde === g.id).map(x => g.heros.find(y => y.id === x.heros.id)).filter(Boolean);
  const allies = tenus.filter(x => x.guilde !== g.id).map(x => ({ id: x.heros.id, nom: x.heros.nom, guilde: x.guilde }));
  const paragraphes = RA.rapportMission(c.mission, r, { calendrier: cal, equipe: miens.map(x => ({ nom: x.nom })).concat(allies.map(a => ({ nom: a.nom }))), repos: h.repos, graine: g.id });
  (g.rapports ||= []).unshift({ id: c.id, t: monde.t, titre: c.mission.titre, lieu: c.mission.lieu, region: c.mission.region, issue: r.issue, heros: miens.map(x => x.id), allies, po, reputation: rep, objet: objet?.nom || null, paragraphes, lu: false });
  g.rapports.length = Math.min(g.rapports.length, PARAMS.conserverRapports);
  monterDeNiveau(monde, g);
}

/* ---------- Départs, morts, Panthéon ---------- */
function entrerAuPantheon(monde, g, h, c) {
  (g.pantheon ||= []).unshift({ id: h.id, nom: h.nom, cle: h.cle, t: monde.t, mission: c.mission.titre, lieu: c.mission.lieu, arrivee: h.arrivee, souvenir: `A donné sa vie pendant « ${c.mission.titre} », ${Q.avecPreposition(c.mission.lieu, 'a')}.` });
  EQ.rendreEquipement(g, h);
  // Recueil § 7.4 : un héros mort retourne au tirage général, sa progression repart de zéro (nouvelle incarnation).
  avis(g, `« ${c.mission.titre} » a coûté la vie à ${h.nom}. Son nom est inscrit au Panthéon de la guilde.`, { type: 'mort' });
}
function departsVolontaires(monde, g) {
  for (const h of g.heros) if (h.etat === 'parti' && !h.archive) {
    h.archive = true; EQ.rendreEquipement(g, h);
    if (!monde.registre.some(r => r.cle === h.cle)) monde.registre.push({ cle: h.cle, depuis: monde.t, raison: 'depart', perduPar: [g.id] });
  }
}

/* ---------- Niveaux et candidatures ---------- */
function monterDeNiveau(monde, g) {
  const C = catalogues(), cible = P.niveauGuilde(g.reputation || 0);
  while ((g.niveau || 1) < cible) {
    g.niveau = (g.niveau || 1) + 1;
    const ds = REC.candidaturesMonteeNiveau(g, C.fiches, g.niveau, jourDe(monde.t), { indisponibles: indisponibles(monde), ciblees: ciblesDuRegistre(monde, g) });
    g.candidatures.push(...ds.map(d => ({ ...d, recue: monde.t, expire: monde.t + REC.PARAMS.expirationMontee })));
    const salle = RP.SALLES.find(s => s.niveau === g.niveau);
    avis(g, `La guilde passe au rang ${g.niveau}. ${ds.length} héros ont envoyé leur dossier.${salle ? ` ${salle.nom.replace(/^./, x => x.toUpperCase())} peut désormais être construite.` : ''}${RULES.capacity(g.niveau) > RULES.capacity(g.niveau - 1) ? ' Le repère compte une place de plus.' : ''}`, { type: 'niveau' });
  }
}
/* Registre : un héros remplacé ou parti revient, en priorité, à la première guilde intéressée qui monte de niveau. */
function ciblesDuRegistre(monde, g) {
  const out = [];
  for (const r of monde.registre) if ((r.interessees || [])[0] === g.id && !(r.perduPar || []).includes(g.id)) { out.push(r.cle); r.interessees.shift(); }
  monde.registre = monde.registre.filter(r => !out.includes(r.cle));
  return out;
}
function seMontrerInteresse(monde, gid, cle) {
  const r = monde.registre.find(x => x.cle === cle); if (!r) throw new Error('Ce héros n\'est pas au Registre.');
  if ((r.perduPar || []).includes(gid)) throw new Error('Ce héros a quitté ta guilde : il ne reviendra pas.');
  if (!(r.interessees ||= []).includes(gid)) r.interessees.push(gid);
  return r.interessees.indexOf(gid) + 1;
}
function candidatureDuJour(monde, g) {
  const c = REC.candidatureDuJour({ ...g, fondee: Math.floor(g.fondee / 24) * 24 }, catalogues().fiches, jourDe(monde.t), indisponibles(monde));
  if (c) { g.candidatures.push({ ...c, recue: monde.t, expire: monde.t + REC.PARAMS.expiration }); avis(g, 'Une candidature spontanée attend sur ton bureau.', { type: 'candidature' }); }
}

/* ---------- Salaires ---------- */
function payer(monde, g) {
  if (monde.t - g.fondee < 24 * 6) return;   // la première paie tombe après une semaine pleine
  const s = actifs(g).reduce((t, h) => t + (h.salaire || 0), 0);
  g.po -= s; g.dernierePaie = monde.t;
  avis(g, g.po < 0 ? `Les salaires de la semaine (${s} PO) vident le coffre : il manque ${-g.po} PO. Tes héros le remarquent.` : `Salaires de la semaine payés : ${s} PO.`, { type: 'paie' });
  if (g.po < 0) for (const h of actifs(g)) V.souvenir(h, monde.t, -8, 'Un salaire en retard', 72);
}

/* ---------- Pièces, cartes, quêtes, chien ---------- */
function construire(monde, gid, cle) {
  const g = monde.guildes[gid], r = RP.construire(g, cle);
  if (!r.ok) throw new Error(r.raison);
  avis(g, `${r.salle.nom.replace(/^./, x => x.toUpperCase())} : les travaux sont finis. ${r.salle.effet}`);
  return r.salle;
}
function repondreCarte(monde, gid, carteId, option) { const g = monde.guildes[gid]; return V.repondre(g, catalogues().scenes, carteId, option); }
function lancerQuete(monde, gid, heroId, compagnonId = null) {
  const g = monde.guildes[gid], h = g.heros.find(x => x.id === heroId), q = g.quetes?.[heroId];
  if (!q || q.etat !== 'ouverte' || q.enCours) throw new Error('Pas d\'étape de quête à lancer pour ce héros.');
  if (!disponible(g, h)) throw new Error(`${h.nom} n'est pas disponible.`);
  const def = Q.queteDe(catalogues().quetes, h, g.region), comp = compagnonId ? g.heros.find(x => x.id === compagnonId) : null;
  if (comp && !disponible(g, comp)) throw new Error(`${comp.nom} n'est pas disponible.`);
  const m = Q.missionDeQuete(def, q.etape, { ...h, stats: statsDe(h) }, comp && { ...comp, stats: statsDe(comp) }, g.region);
  const ids = [h.id, ...(comp ? [comp.id] : [])];
  q.enCours = { t: monde.t, mission: m, compagnon: comp?.id || null, retour: monde.t + m.calendrier.total };
  if (m.mode === 'voyage') V.partirEnVoyage(g, ids, m, def.id); else V.departMission(g, ids, q.enCours.retour);
  return m;
}
function finirQuetes(monde, g) {
  for (const [hid, q] of Object.entries(g.quetes || {})) {
    if (!q.enCours || monde.t < q.enCours.retour) continue;
    const h = g.heros.find(x => x.id === hid), comp = q.enCours.compagnon && g.heros.find(x => x.id === q.enCours.compagnon);
    const eq = [h, comp].filter(Boolean).map(x => ({ nom: x.nom, stats: statsDe(x), moral: x.moral }));
    const r = RES.resoudreMission(eq, q.enCours.mission, {}, {}, rngDe(`${g.id}#quete#${hid}#${q.etape}`));
    const ids = [h, comp].filter(x => x && x.etat === 'mission').map(x => x.id);
    if (ids.length) V.retourMission(g, ids, r.issue, { mission: { titre: q.enCours.mission.titre, lieu: q.enCours.mission.lieu, palier: 'quete', total: q.enCours.mission.calendrier.total } });
    q.enCours = false;
    V.finMissionQuete(g, hid, r.issue, comp?.id || null);
  }
}

/* ---------- Territoires et tournois ---------- */
function recompter(monde) {
  const T = monde.territoires;
  T.gains = T.gains.filter(x => monde.t - x.t <= MJ.PARAMS.territoires.fenetre);
  const { changements } = MJ.recompterTerritoires(T.detenteurs, T.gains, monde.t);
  for (const ch of changements) for (const g of Object.values(monde.guildes)) {
    if (ch.apres === g.id) avis(g, `Ta guilde tient désormais la région ${nomRegion(ch.region)} : contrats mieux payés et un contrat de plus là-bas chaque jour.`, { type: 'territoire' });
    else if (ch.avant === g.id) avis(g, `Ta guilde ne tient plus la région ${nomRegion(ch.region)}${ch.apres ? ` : ${monde.guildes[ch.apres].nom} y est plus influente` : ''}.`, { type: 'territoire' });
  }
}
const NOMS_REGIONS = { demacia: 'Demacia', noxus: 'Noxus', freljord: 'Freljord', ionia: 'Ionia', piltover: 'Piltover', zaun: 'Zaun', shurima: 'Shurima', targon: 'Targon', bilgewater: 'Bilgewater', ixtal: 'Ixtal', bandle: 'Bandle' };
const nomRegion = r => NOMS_REGIONS[r] || r;
function moralTerritoires(monde) {
  for (const [region, gid] of Object.entries(monde.territoires.detenteurs)) {
    const g = monde.guildes[gid]; if (!g) continue;
    for (const h of actifs(g)) if (h.etat === 'present' && (h.regions?.aime || []).includes(region)) V.souvenir(h, monde.t, MJ.PARAMS.territoires.moralOrigine, `La guilde tient ${nomRegion(region)}`, 24);
  }
}
function inscrireTournoi(monde, gid, heroIds) {
  const g = monde.guildes[gid];
  if (heroIds.length !== MJ.PARAMS.tournois.taille) throw new Error(`Une équipe de tournoi compte ${MJ.PARAMS.tournois.taille} héros.`);
  for (const id of heroIds) if (!g.heros.some(h => h.id === id && !['parti', 'mort'].includes(h.etat))) throw new Error('Héros inconnu.');
  const frais = MJ.PARAMS.tournois.frais[palierDe(g)];
  if (!monde.tournois.inscriptions[gid]) { if (g.po < frais) throw new Error(`L'inscription coûte ${frais} PO.`); g.po -= frais; }
  monde.tournois.inscriptions[gid] = heroIds;
  return frais;
}
function jouerLeTournoi(monde) {
  const ins = Object.entries(monde.tournois.inscriptions); monde.tournois.inscriptions = {};
  if (ins.length < 2) { for (const [gid] of ins) { const g = monde.guildes[gid]; g.po += MJ.PARAMS.tournois.frais[palierDe(g)]; avis(g, 'Pas assez d\'inscrits : le tournoi du mois est annulé, et tes frais te sont rendus.'); } return null; }
  const equipes = ins.map(([gid, ids]) => { const g = monde.guildes[gid];
    return { guilde: gid, niveau: g.niveau, heros: ids.map(id => g.heros.find(h => h.id === id)).filter(h => h && h.etat === 'present').map(h => ({ nom: h.nom, stats: statsDe(h), moral: h.moral })) }; });
  const res = MJ.jouerTournoi(equipes, rngDe(`tournoi#${monde.t}`), gid => palierDe(monde.guildes[gid]));
  for (const x of res.gains) { const g = monde.guildes[x.guilde]; g.po += x.po; g.reputation += x.reputation; monterDeNiveau(monde, g); }
  const noms = res.classement.map(id => monde.guildes[id].nom);
  for (const [gid, ids] of ins) {
    const g = monde.guildes[gid], rang = res.classement.indexOf(gid) + 1;
    avis(g, rang === 1 ? `Victoire au tournoi du mois ! ${res.gains[0].po} PO et toute la région en parle.` : `Tournoi du mois : ta guilde finit ${rang}e sur ${noms.length}. Vainqueur : ${noms[0]}.`, { type: 'tournoi' });
    for (const id of ids) { const h = g.heros.find(x => x.id === id); if (h) V.souvenir(h, monde.t, rang === 1 ? 10 : rang <= 3 ? 4 : -2, rang === 1 ? 'Vainqueur du tournoi' : 'Le tournoi du mois', 96); }
  }
  monde.tournois.historique.unshift({ t: monde.t, classement: res.classement, cagnotte: res.cagnotte, matchs: res.matchs.map(m => ({ a: m.a, b: m.b, gagnant: m.gagnant, forfait: !!m.forfait })) });
  monde.tournois.historique.length = Math.min(monde.tournois.historique.length, 12);
  return res;
}

/* Une fois par jour : on garde l'état d'une guilde assez léger pour la base de données (un document de moins de 1 Mo). */
function elaguer(g) {
  if (g.chronique.length > PARAMS.conserverChronique) g.chronique.splice(0, g.chronique.length - PARAMS.conserverChronique);
  g.cartes = g.cartes.filter(c => c.etat === 'ouverte' || g.t - c.t < 24 * 7);
  if (g.soirees?.length > 5) g.soirees.length = 5;
  if (g.memoire?.length > 120) g.memoire.splice(0, g.memoire.length - 120);
  for (const h of g.heros) {
    h.souvenirs = (h.souvenirs || []).filter(x => g.t - x.t < x.demiVie * 6);
    if (['parti', 'mort'].includes(h.etat) && g.t - (h.jusqua || g.t) > 24 * 30) { h.souvenirs = []; h.routine = {}; }
  }
}

/* ---------- Avancer le temps ---------- */
function avancer(monde, jusqua) {
  const C = catalogues();
  jusqua = Math.floor(jusqua / 2) * 2;
  while (monde.t < jusqua) {
    const t = monde.t, h = creneauLocal(t);
    if (h === PARAMS.heurePublication) {
      publierContrats(monde);
      for (const g of Object.values(monde.guildes)) { candidatureDuJour(monde, g); if (lundi(t)) payer(monde, g); }
    }
    if (h === PARAMS.heureBilan) { moralTerritoires(monde); if (lundi(t)) recompter(monde); }
    if (h === PARAMS.heureTournoi && premierSamediDuMois(t)) jouerLeTournoi(monde);
    faireAvancerContrats(monde);
    for (const g of Object.values(monde.guildes)) {
      finirQuetes(monde, g);
      V.simuler(g, t + 2, C.scenes, C.arcs, C.quetes);
      departsVolontaires(monde, g);
      g.candidatures = (g.candidatures || []).filter(c => c.expire > t + 2);
      if (h === PARAMS.heureBilan) elaguer(g);
    }
    monde.t = t + 2;
  }
  monde.version++;
  return monde;
}

module.exports = { nommerChien: (monde, gid, nom) => V.nommerChien(monde.guildes[gid], nom), equiper: (monde, gid, heroId, uid) => EQ.equiper(monde.guildes[gid], heroId, uid), desequiper: (monde, gid, heroId, uid) => EQ.desequiper(monde.guildes[gid], heroId, uid),
  PARAMS, catalogues, creerMonde, fonderGuilde, nouveauHeros, recruter, refuserCandidature, poserAnnonce, publierContrats, contratsPour, placer, retirer, chanceContrat,
  construire, repondreCarte, lancerQuete, inscrireTournoi, jouerLeTournoi, seMontrerInteresse, avancer, statsDe, disponible, nomRegion,
  proposerAlliance: (monde, de, vers) => MJ.proposerAlliance(monde, de, vers, id => palierDe(monde.guildes[id]), monde.t),
  accepterAlliance: (monde, cle, gid) => MJ.accepterAlliance(monde, cle, gid, id => palierDe(monde.guildes[id]), monde.t),
  rompreAlliance: (monde, a, b) => MJ.rompreAlliance(monde, a, b, monde.t) };
