'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules');

const guild = (over = {}) => ({ id: 'gA', level: 7, rosterCount: 3, ...over });
const hero = (over = {}) => ({ id: 'jinx-sg', status: 'registry', ownerGuildId: null, lostBy: [], ...over });
const cand = (over = {}) => ({ guildId: 'gA', heroId: 'jinx-sg', status: 'open', now: 1, ...over });

test('candidatures par niveau suivent le barème validé', () => {
  const expected = { 1: 3, 4: 3, 5: 4, 9: 4, 10: 5, 15: 6, 20: 7, 25: 8, 30: 9, 34: 9, 35: 10, 50: 10 };
  for (const [lvl, n] of Object.entries(expected)) assert.equal(R.candidatureCount(+lvl), n, `niveau ${lvl}`);
});

test('capacité : 5 au départ, 25 au niveau 50, jamais au-delà', () => {
  assert.equal(R.capacity(1), 5);
  assert.equal(R.capacity(50), 25); assert.equal(R.capacity(49), 24); assert.ok(R.capacity(25) >= 14 && R.capacity(25) <= 15);
  for (let l = 2; l <= 50; l++) assert.ok(R.capacity(l) - R.capacity(l - 1) <= 1, 'jamais plus d\'une place d\'un coup');
  for (let l = 1; l <= 50; l++) assert.ok(R.capacity(l) <= 25);
  for (let l = 2; l <= 50; l++) assert.ok(R.capacity(l) >= R.capacity(l - 1), 'jamais de baisse');
});

test('potentiel compris entre B et G', () => {
  assert.deepEqual(R.POTENTIALS, ['B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+', 'G']);
});

test('recrutement simple avec place libre', () => {
  const plan = R.planRecruitment({ guild: guild(), hero: hero(), candidature: cand() });
  assert.equal(plan.recruited.ownerGuildId, 'gA');
  assert.equal(plan.rosterCount, 4);
  assert.equal(plan.released, null);
});

test('Cas A : effectif plein, remplacement obligatoire, progression conservée, retour interdit', () => {
  const full = guild({ level: 50, rosterCount: 25 });
  assert.throws(() => R.planRecruitment({ guild: full, hero: hero(), candidature: cand() }), /remplacer/);
  const old = { id: 'garen', ownerGuildId: 'gA', status: 'guild', progression: { xp: 900 }, lostBy: [] };
  const plan = R.planRecruitment({ guild: full, hero: hero(), candidature: cand(), replaceHero: old });
  assert.equal(plan.rosterCount, 25);
  assert.equal(plan.released.status, 'registry');
  assert.deepEqual(plan.released.progression, { xp: 900 });
  assert.ok(plan.released.lostBy.includes('gA'));
  // l'ancienne guilde ne peut plus le recruter
  const back = { ...plan.released, id: 'garen' };
  assert.throws(() => R.planRecruitment({ guild: guild(), hero: back, candidature: cand({ heroId: 'garen' }) }), /ne peut plus/);
});

test('Cas C : départ volontaire, progression conservée, retour interdit', () => {
  const h = { id: 'x', ownerGuildId: 'gA', status: 'guild', progression: { xp: 50 } };
  const r = R.releaseHero(h, 'left');
  assert.deepEqual(r.progression, { xp: 50 });
  assert.deepEqual(r.lostBy, ['gA']);
});

test('Cas D : mort, progression remise à zéro, recrutable ailleurs, jamais dans sa guilde', () => {
  const h = { id: 'x', ownerGuildId: 'gA', status: 'guild', progression: { xp: 50 } };
  const r = R.releaseHero(h, 'died');
  assert.equal(r.progression, null);
  assert.equal(r.needsFreshStart, true);
  assert.equal(r.status, 'pool', 'un mort ne passe pas par le Registre');
  assert.equal(R.targetedCandidatesFor('gB', [{ ...r, interestedGuilds: ['gB'] }]).length, 0);
  assert.ok(r.lostBy.includes('gA'));
  const ok = R.planRecruitment({ guild: guild({ id: 'gB' }), hero: { ...r, id: 'x' }, candidature: cand({ guildId: 'gB', heroId: 'x' }) });
  assert.equal(ok.recruited.ownerGuildId, 'gB');
});

test('un héros déjà recruté ne peut pas appartenir à deux guildes', () => {
  assert.throws(() => R.planRecruitment({ guild: guild(), hero: hero({ ownerGuildId: 'gB', status: 'guild' }), candidature: cand() }), /déjà/);
});

test('une candidature close ou d’une autre guilde est refusée', () => {
  assert.throws(() => R.planRecruitment({ guild: guild(), hero: hero(), candidature: cand({ status: 'closed' }) }), /close/);
  assert.throws(() => R.planRecruitment({ guild: guild(), hero: hero(), candidature: cand({ guildId: 'gB' }) }), /introuvable/);
});

test('fondation : nom nettoyé, clé d’unicité insensible à la casse et aux accents', () => {
  const f = R.validateFoundation({ name: '  Les   Veilleurs du Pont ', motto: 'Toujours debout', emblem: { shape: 'lanterne', color: 'ambre' }, region: 'demacia' });
  assert.equal(f.name, 'Les Veilleurs du Pont');
  assert.equal(R.guildNameKey('LES VEILLEURS DU PONT'), f.nameKey);
  assert.equal(R.guildNameKey('Éclat d’Ionia'), R.guildNameKey('eclat d ionia'));
});

test('fondation : entrées invalides refusées', () => {
  const em = { shape: 'lanterne', color: 'ambre' };
const rg = 'ionia';
  assert.throws(() => R.validateFoundation({ name: 'ab', emblem: em, region: 'ionia' }), /3 et 32/);
  assert.throws(() => R.validateFoundation({ name: 'x'.repeat(33), emblem: em, region: 'ionia' }), /3 et 32/);
  assert.throws(() => R.validateFoundation({ name: '<script>', emblem: em, region: 'ionia' }), /lettres/);
  assert.throws(() => R.validateFoundation({ name: 'Bonne guilde', emblem: { shape: 'logo-riot', color: 'ambre' }, region: 'ionia' }), /Emblème/);
  assert.throws(() => R.validateFoundation({ name: 'Bonne guilde', motto: 'y'.repeat(121), emblem: em, region: 'ionia' }), /120/);
});

test('nouvelle guilde : niveau 1, capacité 5, valeurs non arbitrées laissées vides', () => {
  const g = R.newGuild({ ownerUid: 'u1', foundation: R.validateFoundation({ name: 'Test guilde', emblem: { shape: 'cle', color: 'prune' }, region: 'zaun' }), now: 0 });
  assert.equal(g.level, 1);
  assert.equal(g.capacity, 5);
  assert.equal(g.rosterCount, 0);
  assert.equal(g.treasury, null);
  assert.equal(g.rank, null);
});

test('région : obligatoire, choisie parmi les régions officielles, conservée dans la guilde', () => {
  const em = { shape: 'lanterne', color: 'ambre' };
  assert.throws(() => R.validateFoundation({ name: 'Bonne guilde', emblem: em }), /région/);
  assert.throws(() => R.validateFoundation({ name: 'Bonne guilde', emblem: em, region: 'atlantide' }), /région/);
  assert.throws(() => R.validateFoundation({ name: 'Bonne guilde', emblem: em, region: 'neant' }), /région/);
  assert.throws(() => R.validateFoundation({ name: 'Bonne guilde', emblem: em, region: 'iles-obscures' }), /région/);
  const g = R.newGuild({ ownerUid: 'u', foundation: R.validateFoundation({ name: 'Bonne guilde', emblem: em, region: 'freljord' }), now: 0 });
  assert.equal(g.region, 'freljord');
});

test('tirage aléatoire : les héros du Registre en sont exclus', () => {
  assert.equal(R.eligibleForRandomDraw(hero({ status: 'pool' }), 'gA'), true);
  assert.equal(R.eligibleForRandomDraw(hero({ status: 'registry' }), 'gA'), false);
  assert.equal(R.eligibleForRandomDraw(hero({ status: 'pool', lostBy: ['gA'] }), 'gA'), false, 'mort dans cette guilde');
  assert.equal(R.eligibleForRandomDraw(hero({ status: 'guild', ownerGuildId: 'gB' }), 'gA'), false);
});

test('refus d’une candidature ciblée : retour au Registre, disponible pour les autres', () => {
  const h = hero({ interestedGuilds: ['gB', 'gA', 'gC'], reservedCandidatureFor: 'gB' });
  const r = R.refuseTargeted(h, 'gB');
  assert.equal(r.status, 'registry');
  assert.equal(r.reservedCandidatureFor, null);
  assert.deepEqual(r.interestedGuilds, ['gA', 'gC']);
  assert.equal(R.targetedCandidatesFor('gA', [r]).length, 1);
  assert.equal(R.targetedCandidatesFor('gB', [r]).length, 0);
});

test('Cas B : seules les guildes positionnées reçoivent le héros ciblé', () => {
  const reg = [hero({ interestedGuilds: ['gA', 'gB', 'gC'] })];
  assert.equal(R.targetedCandidatesFor('gB', reg).length, 1);
  assert.equal(R.targetedCandidatesFor('gD', reg).length, 0);
  assert.equal(R.targetedCandidatesFor('gB', [hero({ interestedGuilds: ['gB'], lostBy: ['gB'] })]).length, 0);
});
