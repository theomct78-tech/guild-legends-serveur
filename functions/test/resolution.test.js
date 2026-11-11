'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/resolution');

const stats = (o) => ({ Force: 50, Défense: 50, Magie: 50, 'Résistance magique': 50, Vitesse: 50, Précision: 50, Endurance: 50, Intelligence: 50, Leadership: 50, ...o });
const assassin = { nom: 'Assassin', stats: stats({ Vitesse: 80, Précision: 75, Intelligence: 65, Défense: 35 }) };
const tank = { nom: 'Tank', stats: stats({ Défense: 80, Endurance: 80, Force: 65, Vitesse: 35 }) };
const sequence = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('le profil compte : un assassin vaut mieux en discrétion, un tank en siège', () => {
  assert.ok(R.valeurHeros(assassin, 'discretion') > R.valeurHeros(tank, 'discretion'));
  assert.ok(R.valeurHeros(tank, 'siege') > R.valeurHeros(assassin, 'siege'));
});

test('le moral pèse sur la valeur d’un héros', () => {
  assert.ok(R.valeurHeros({ ...assassin, moral: 100 }, 'discretion') > R.valeurHeros({ ...assassin, moral: 10 }, 'discretion'));
});

test('la chance suit l’écart entre score et difficulté, sans jamais être certaine', () => {
  assert.equal(R.chanceReussite(50, 50), 0.5);
  assert.ok(R.chanceReussite(65, 50) > 0.85);
  assert.equal(R.chanceReussite(200, 50), R.PARAMS.chanceMax);
  assert.equal(R.chanceReussite(0, 90), R.PARAMS.chanceMin);
});

test('les avantages des compétences et la cohésion font pencher la balance', () => {
  const ep = { type: 'discretion', difficulte: 60 };
  const sans = R.scoreEpreuve([assassin], ep).score;
  assert.ok(R.scoreEpreuve([assassin], ep, { INFILTRATION: 12 }).score > sans);
  assert.ok(R.scoreEpreuve([assassin], ep, {}, { relations: ['amis'] }).score > sans);
  assert.ok(R.scoreEpreuve([assassin], ep, {}, { relations: ['rivaux'] }).score < sans);
  assert.ok(R.scoreEpreuve([assassin], ep, {}, { roleManquant: true }).score < sans);
});

test('la Maîtrise abaisse la difficulté d’un combat', () => {
  const ep = { type: 'combat', difficulte: 60 };
  assert.ok(R.scoreEpreuve([tank], ep, { MAITRISE: 20 }).difficulte < 60);
});

test('issue : toutes réussies, majorité, minorité, aucune', () => {
  const m = { epreuves: [{ type: 'combat', difficulte: 50 }, { type: 'poursuite', difficulte: 50 }, { type: 'voyage', difficulte: 50 }] };
  const eq = [assassin, tank];
  assert.equal(R.resoudreMission(eq, m, {}, {}, sequence(0.01)).issue, 'eclatante');
  assert.equal(R.resoudreMission(eq, m, {}, {}, sequence(0.99)).issue, 'echec');
});

test('une épreuve de combat ratée peut blesser, la Protection réduit ce risque', () => {
  const m = { epreuves: [{ type: 'combat', difficulte: 95 }] };
  const sansProtection = R.resoudreMission([tank], m, {}, {}, sequence(0.9, 0.2));
  assert.equal(sansProtection.blessures.length, 1);
  const protege = R.resoudreMission([tank], m, { PROTECTION: 100 }, {}, sequence(0.9, 0.2));
  assert.equal(protege.blessures.length, 0);
});

test('chance affichée avant le départ : la bonne équipe pour la bonne mission', () => {
  const infiltration = { epreuves: [{ type: 'discretion', difficulte: 60 }, { type: 'poursuite', difficulte: 55 }, { type: 'combat', difficulte: 50 }] };
  assert.ok(R.chanceMission([assassin], infiltration) > R.chanceMission([tank], infiltration));
});
