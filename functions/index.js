'use strict';
/*
 * Guild Legends — fonctions serveur (Firebase Blaze).
 * Seules ces fonctions écrivent les données de jeu. Chaque opération sensible
 * passe par une transaction pour garantir qu'un héros n'a jamais deux propriétaires.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const R = require('./src/rules');

initializeApp();
const db = getFirestore();
const REGION = 'europe-west1';

const { ADMIN_EMAILS } = require('./config');

function emailOf(auth) {
  const e = auth && auth.token && auth.token.email;
  if (!e || auth.token.email_verified === false) throw new HttpsError('unauthenticated', 'Connexion Google requise.');
  return e.toLowerCase();
}
const isAdmin = (auth) => ADMIN_EMAILS.includes(emailOf(auth));

/* Entrée dans le jeu : vérifie l'invitation et crée le profil au premier passage. */
exports.enter = onCall({ region: REGION }, async (req) => {
  const email = emailOf(req.auth);
  const admin = ADMIN_EMAILS.includes(email);
  const inviteRef = db.doc(`invites/${email}`);
  const userRef = db.doc(`users/${req.auth.uid}`);
  return db.runTransaction(async (tx) => {
    const [inv, user] = await Promise.all([tx.get(inviteRef), tx.get(userRef)]);
    if (!inv.exists && !admin) {
      throw new HttpsError('permission-denied', 'Ce compte n’est pas sur la liste des invités.');
    }
    if (!inv.exists) tx.set(inviteRef, { addedBy: 'auto-admin', at: FieldValue.serverTimestamp() });
    if (!user.exists) {
      tx.set(userRef, {
        email,
        displayName: (req.auth.token.name || email.split('@')[0]).slice(0, 40),
        guildId: null,
        settings: {},
        createdAt: FieldValue.serverTimestamp(),
      });
      return { guildId: null, admin };
    }
    return { guildId: user.data().guildId || null, admin };
  });
});

/* ---------- Le monde partagé (monde.js) ----------
 * Tout l'état du jeu tient dans « monde/etat » (contrats, territoires, tournois, alliances, Registre) et un document
 * par guilde dans « etats/{guildId} » (héros, relations, chronique, courrier : privé). Chaque appel charge le monde,
 * le fait avancer jusqu'à maintenant, applique l'action, puis enregistre tout, dans une seule transaction : deux joueurs
 * qui placent un héros au même moment ne peuvent pas se marcher dessus.
 */
const W = require('./src/monde');
const VU = require('./src/vue');
const maintenant = () => Date.now() / 3600000;
const MONDE = () => db.doc('monde/etat');

async function chargerMonde(tx) {
  const [m, etats] = await Promise.all([tx.get(MONDE()), tx.get(db.collection('etats'))]);
  const monde = m.exists ? JSON.parse(m.data().json) : W.creerMonde(maintenant());
  monde.guildes = {};
  for (const d of etats.docs) monde.guildes[d.id] = JSON.parse(d.data().json);
  return monde;
}
function sauverMonde(tx, monde) {
  const { guildes, ...reste } = monde;
  tx.set(MONDE(), { json: JSON.stringify(reste), t: monde.t, version: monde.version });
  for (const [id, g] of Object.entries(guildes)) {
    tx.set(db.doc(`etats/${id}`), { json: JSON.stringify(g), t: monde.t });
    // Fiche publique de la guilde : ce que les autres joueurs voient (pas de moral, pas de potentiel).
    tx.set(db.doc(`guilds/${id}`), { level: g.niveau || 1, reputation: g.reputation || 0, region: g.region,
      heroes: g.heros.filter(h => !['parti', 'mort'].includes(h.etat)).map(h => ({ id: h.id, name: h.nom, cle: h.cle, role: h.role })), updatedAt: monde.t }, { merge: true });
  }
}
/* Charge, fait avancer, applique fn (qui peut lever une erreur métier), enregistre, renvoie la vue du joueur. */
async function avecMonde(auth, fn = null) {
  return db.runTransaction(async (tx) => {
    const user = auth ? await tx.get(db.doc(`users/${auth.uid}`)) : null;
    const gid = user?.exists ? user.data().guildId : null;
    const monde = await chargerMonde(tx);
    W.avancer(monde, maintenant());
    let resultat = null;
    if (fn) {
      if (!gid || !monde.guildes[gid]) throw new HttpsError('failed-precondition', 'Aucune guilde associée à ce compte.');
      try { resultat = fn(monde, gid); } catch (e) { if (e instanceof HttpsError) throw e; throw new HttpsError('failed-precondition', e.message); }
    }
    sauverMonde(tx, monde);
    return { resultat: resultat ?? null, vue: gid && monde.guildes[gid] ? VU.vue(monde, gid) : null };
  });
}

/* Fondation d'une guilde : une seule par joueur, nom unique. Elle entre aussitôt dans le monde, avec 150 PO et trois dossiers. */
exports.createGuild = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120 }, async (req) => {
  emailOf(req.auth);
  let foundation;
  try { foundation = R.validateFoundation(req.data || {}); }
  catch (e) { throw new HttpsError('invalid-argument', e.message); }
  if (!W.regionsOuvertes().includes(foundation.region)) throw new HttpsError('invalid-argument', 'Cette région n\'est pas encore ouverte : ses missions sont en cours d\'écriture. Choisis-en une autre.');
  const nomChien = String(req.data?.dog || '').trim().replace(/\s+/g, ' ');
  const chien = /^[\p{L}][\p{L}' -]{0,19}$/u.test(nomChien) ? nomChien[0].toUpperCase() + nomChien.slice(1) : null;
  const maitre = { titre: req.data?.title === 'maîtresse' ? 'maîtresse' : 'maître', billetsDoux: req.data?.flirt !== false };

  const userRef = db.doc(`users/${req.auth.uid}`);
  const nameRef = db.doc(`guildNames/${foundation.nameKey}`);
  const guildRef = db.collection('guilds').doc();

  return db.runTransaction(async (tx) => {
    const [user, taken] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);
    if (!user.exists) throw new HttpsError('failed-precondition', 'Profil introuvable : reconnecte-toi.');
    if (user.data().guildId) throw new HttpsError('already-exists', 'Tu diriges déjà une guilde.');
    if (taken.exists) throw new HttpsError('already-exists', 'Ce nom de guilde est déjà pris.');
    const monde = await chargerMonde(tx);
    W.avancer(monde, maintenant());
    const COUL = { ambre: '#f0a43a', braise: '#e0703a', mousse: '#8fbf6a', riviere: '#6fb3c8', prune: '#c58fd0', ivoire: '#efe2c4' };
    W.fonderGuilde(monde, { id: guildRef.id, nom: foundation.name, region: foundation.region, chien, maitre, devise: foundation.motto, maitreNom: user.data().displayName || null, couleur: COUL[foundation.emblem.color] || null });

    tx.set(guildRef, { ...R.newGuild({ ownerUid: req.auth.uid, foundation, now: FieldValue.serverTimestamp() }), master: user.data().displayName || null });
    tx.set(nameRef, { guildId: guildRef.id });
    tx.update(userRef, { guildId: guildRef.id });
    sauverMonde(tx, monde);
    return { guildId: guildRef.id, vue: VU.vue(monde, guildRef.id) };
  });
});

/* L'état du jeu pour le joueur connecté (et le monde avance jusqu'à maintenant). */
exports.etat = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  return avecMonde(req.auth);
});

/*
 * Toutes les actions du joueur passent par ici. Liste fermée : rien d'autre ne peut modifier le monde.
 * Chaque action reçoit ses paramètres dans req.data et ne touche qu'à la guilde du joueur.
 */
const ACTIONS = {
  recruter: (m, g, d) => W.recruter(m, g, d.cle, d.remplacer || null),
  refuser: (m, g, d) => W.refuserCandidature(m, g, d.cle),
  annonce: (m, g, d) => W.poserAnnonce(m, g, d.role),
  placer: (m, g, d) => W.placer(m, g, d.contrat, d.poste, d.heros),
  retirer: (m, g, d) => W.retirer(m, g, d.contrat, d.heros),
  repondre: (m, g, d) => W.repondreCarte(m, g, d.carte, d.option),
  construire: (m, g, d) => W.construire(m, g, d.salle),
  quete: (m, g, d) => W.lancerQuete(m, g, d.heros, d.compagnon || null),
  equiper: (m, g, d) => W.equiper(m, g, d.heros, d.objet),
  desequiper: (m, g, d) => W.desequiper(m, g, d.heros, d.objet),
  tournoi: (m, g, d) => W.inscrireTournoi(m, g, d.heros || []),
  registre: (m, g, d) => W.seMontrerInteresse(m, g, d.cle),
  allianceProposer: (m, g, d) => W.proposerAlliance(m, g, d.guilde),
  allianceAccepter: (m, g, d) => W.accepterAlliance(m, d.cle, g),
  allianceRompre: (m, g, d) => W.rompreAlliance(m, g, d.guilde),
  chien: (m, g, d) => W.nommerChien(m, g, d.nom),
  solde: (m, g, d) => W.changerSolde(m, g, d.heros, d.sens > 0 ? 1 : -1),
  conges: (m, g, d) => W.donnerConges(m, g, d.heros, Number(d.jours) || 2),
  action: (m, g, d) => W.lancerAction(m, g, String(d.id || '')),
  geste: (m, g, d) => W.faireGeste(m, g, d.heros, String(d.id || '')),
  missive: (m, g, d) => W.envoyerMissive(m, g, d.guilde, d.texte),
  fil: (m, g, d) => W.repondreFil(m, g, String(d.id || ''), String(d.choix || '')),
  image: (m, g, d) => W.choisirImage(m, g, { cle: d.cle || null, photo: d.photo || null }),
  lu: (m, g, d) => { const r = (m.guildes[g].rapports || []).find(x => x.id === d.rapport); if (r) r.lu = true; return true; },
};
exports.agir = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  const { action, ...d } = req.data || {};
  const f = ACTIONS[action]; if (!f) throw new HttpsError('invalid-argument', 'Action inconnue.');
  return avecMonde(req.auth, (m, g) => f(m, g, d));
});

/* Le monde vit même quand personne n'est connecté : toutes les 2 heures, on le fait avancer. */
exports.tick = onSchedule({ region: REGION, schedule: 'every 2 hours', timeZone: 'Europe/Paris', memory: '1GiB', timeoutSeconds: 300 }, async () => {
  await avecMonde(null);
});

/*
 * Bêta : remise à zéro du monde, réservée à l'administrateur.
 * Efface le monde, toutes les guildes (état, fiche publique, nom réservé) et délie chaque joueur de sa guilde.
 * Garde la liste d'invités et les comptes : chacun se reconnecte et fonde une nouvelle guilde.
 * Il faut taper « RECOMMENCER » pour confirmer.
 */
exports.reinitialiser = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 300 }, async (req) => {
  if (!isAdmin(req.auth)) throw new HttpsError('permission-denied', 'Réservé à l’administrateur.');
  if (String(req.data?.confirmation || '').trim().toUpperCase() !== 'RECOMMENCER') throw new HttpsError('invalid-argument', 'Tape RECOMMENCER pour confirmer.');
  const bilan = await db.runTransaction(async (tx) => {
    const [etats, guilds, noms, users, beta] = await Promise.all([db.collection('etats'), db.collection('guilds'), db.collection('guildNames'), db.collection('users'), db.doc('monde/beta')].map(r => tx.get(r)));
    for (const d of [...etats.docs, ...guilds.docs, ...noms.docs]) tx.delete(d.ref);
    for (const u of users.docs) if (u.data().guildId) tx.update(u.ref, { guildId: null });
    tx.delete(MONDE());
    const n = (beta.exists ? beta.data().remisesAZero || 0 : 0) + 1;
    tx.set(db.doc('monde/beta'), { remisesAZero: n, derniere: FieldValue.serverTimestamp(), par: emailOf(req.auth) });
    return { guildes: guilds.size, joueurs: users.docs.filter(u => u.data().guildId).length, remisesAZero: n };
  });
  // Les sous-collections (anciens journaux de guilde) ne partent pas avec leur document : on balaie ce qui reste.
  if (typeof db.recursiveDelete === 'function') { await db.recursiveDelete(db.collection('guilds')); await db.recursiveDelete(db.collection('etats')); }
  return bilan;
});

/* Liste d'invités, gérée par l'administrateur depuis l'appli. */
exports.manageInvite = onCall({ region: REGION }, async (req) => {
  if (!isAdmin(req.auth)) throw new HttpsError('permission-denied', 'Réservé à l’administrateur.');
  const { email, action } = req.data || {};
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpsError('invalid-argument', 'Adresse e-mail invalide.');
  const ref = db.doc(`invites/${e}`);
  if (action === 'remove') { await ref.delete(); return { ok: true }; }
  await ref.set({ addedBy: emailOf(req.auth), at: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.listInvites = onCall({ region: REGION }, async (req) => {
  if (!isAdmin(req.auth)) throw new HttpsError('permission-denied', 'Réservé à l’administrateur.');
  const snap = await db.collection('invites').get();
  return { invites: snap.docs.map(d => d.id).sort() };
});

