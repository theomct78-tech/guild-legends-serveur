'use strict';
/* Tests des fonctions serveur avec un Firestore en mémoire (les modules Firebase sont remplacés). */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createDb, SERVER_TS } = require('./fakeFirestore');

const db = createDb();
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fakes = {
  'firebase-functions/v2/https': { onCall: (_opts, handler) => handler, HttpsError },
  'firebase-functions/v2/scheduler': { onSchedule: (_opts, handler) => handler },
  'firebase-admin/app': { initializeApp: () => {} },
  'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => SERVER_TS } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] || origLoad.call(this, req, ...rest); };
const F = require('../index.js');
Module._load = origLoad;

const ADMIN = { uid: 'u-admin', token: { email: 'theo.mct78@gmail.com', email_verified: true, name: 'Théo' } };
const AMI = { uid: 'u-ami', token: { email: 'Ami@Gmail.com', email_verified: true, name: 'Ami' } };
const INCONNU = { uid: 'u-x', token: { email: 'inconnu@gmail.com', email_verified: true } };
const em = { shape: 'lanterne', color: 'ambre' };

test('un compte non invité est refusé', async () => {
  await assert.rejects(F.enter({ auth: INCONNU }), (e) => e.code === 'permission-denied');
  assert.equal(db.store.has('users/u-x'), false);
});

test('l’administrateur entre et devient invité automatiquement', async () => {
  const r = await F.enter({ auth: ADMIN });
  assert.deepEqual(r, { guildId: null, admin: true });
  assert.ok(db.store.has('invites/theo.mct78@gmail.com'));
});

test('seul l’administrateur gère les invités, adresses normalisées en minuscules', async () => {
  await assert.rejects(F.manageInvite({ auth: INCONNU, data: { email: 'a@b.fr' } }), (e) => e.code === 'permission-denied');
  await F.manageInvite({ auth: ADMIN, data: { email: ' AMI@gmail.com ', action: 'add' } });
  const { invites } = await F.listInvites({ auth: ADMIN });
  assert.ok(invites.includes('ami@gmail.com'));
  const r = await F.enter({ auth: AMI });
  assert.equal(r.admin, false);
});

test('fondation d’une guilde : état initial et chronique', async () => {
  const { guildId } = await F.createGuild({ auth: ADMIN, data: { name: 'Les Veilleurs du Pont', motto: 'Debout', emblem: em, region: 'ionia' } });
  const g = db.store.get(`guilds/${guildId}`);
  assert.equal(g.level, 1); assert.equal(g.capacity, 5); assert.equal(g.ownerUid, 'u-admin');
  assert.equal(db.store.get('users/u-admin').guildId, guildId);
  // La guilde entre dans le monde partagé : son état privé, 150 PO et trois dossiers de candidature.
  const etat = JSON.parse(db.store.get(`etats/${guildId}`).json);
  assert.equal(etat.po, 150); assert.equal(etat.candidatures.length, 3);
  assert.deepEqual(await F.enter({ auth: ADMIN }), { guildId, admin: true });
});

test('une seule guilde par joueur', async () => {
  await assert.rejects(F.createGuild({ auth: ADMIN, data: { name: 'Seconde guilde', emblem: em, region: 'ionia' } }), (e) => e.code === 'already-exists');
});

test('nom déjà pris, même avec une autre casse ou sans accents : refusé, rien n’est écrit', async () => {
  const avant = db.store.size;
  await assert.rejects(F.createGuild({ auth: AMI, data: { name: 'les veilleurs DU pont', emblem: em, region: 'ionia' } }), /déjà pris/);
  assert.equal(db.store.size, avant);
  assert.equal(db.store.get('users/u-ami').guildId, null);
});

test('données de fondation invalides refusées avant toute écriture', async () => {
  await assert.rejects(F.createGuild({ auth: AMI, data: { name: 'x', emblem: em, region: 'ionia' } }), (e) => e.code === 'invalid-argument');
});

test('jouer : l\'état du joueur, recruter, construire, une action inconnue refusée', async () => {
  const { guildId } = await F.enter({ auth: ADMIN });
  let r = await F.etat({ auth: ADMIN });
  assert.equal(r.vue.guilde.id, guildId); assert.equal(r.vue.candidatures.length, 3);
  r = await F.agir({ auth: ADMIN, data: { action: 'recruter', cle: r.vue.candidatures[0].cle } });
  assert.equal(r.vue.heros.length, 1);
  await assert.rejects(F.agir({ auth: ADMIN, data: { action: 'construire', salle: 'table' } }), /rang 7/);
  await assert.rejects(F.agir({ auth: ADMIN, data: { action: 'pirater' } }), (e) => e.code === 'invalid-argument');
  await assert.rejects(F.agir({ auth: INCONNU, data: { action: 'recruter', cle: 'x' } }));
  await F.tick();
  assert.ok(db.store.get('monde/etat').version >= 3);
});

test('bêta : seul l’administrateur remet le monde à zéro, avec confirmation, et les invités restent', async () => {
  await assert.rejects(F.reinitialiser({ auth: INCONNU, data: { confirmation: 'RECOMMENCER' } }), (e) => e.code === 'permission-denied');
  await assert.rejects(F.reinitialiser({ auth: ADMIN, data: { confirmation: 'oui' } }), (e) => e.code === 'invalid-argument');
  const r = await F.reinitialiser({ auth: ADMIN, data: { confirmation: 'recommencer' } });
  assert.ok(r.remisesAZero >= 1);
  const e = await F.enter({ auth: ADMIN });
  assert.equal(e.guildId, null, 'le joueur peut refonder une guilde');
  assert.equal(e.admin, true);
});
