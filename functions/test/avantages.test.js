'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/avantages');
const LOTS = A.chargerLots();

test('lots : chaque champion écrit a ses cinq compétences, chacune avec au moins un avantage et une phrase', () => {
  for (const [ch, kit] of Object.entries(LOTS)) {
    assert.deepEqual(Object.keys(kit).sort(), ['E', 'P', 'Q', 'R', 'W'], ch);
    for (const [k, c] of Object.entries(kit)) {
      assert.ok(c.avantages.length >= 1, `${ch} ${k}`);
      assert.ok(c.phrase && c.phrase.length > 10, `${ch} ${k}`);
    }
  }
});

test('une compétence non débloquée n’apporte rien', () => {
  const r = A.avantagesHeros(LOTS, 'Ashe', ['P'], 0);
  assert.equal(r.totaux.RECONNAISSANCE, undefined);
  const r2 = A.avantagesHeros(LOTS, 'Ashe', ['P', 'E'], 1);
  assert.ok(r2.totaux.RECONNAISSANCE > 0);
});

test('l’effet grandit avec la progression, jusqu’au double', () => {
  const a = A.avantagesHeros(LOTS, 'Braum', ['E'], 0).totaux.PROTECTION;
  const b = A.avantagesHeros(LOTS, 'Braum', ['E'], 4).totaux.PROTECTION;
  assert.equal(b, a * 2);
});

test('Renaissance d’Anivia évite une mort une fois par mission', () => {
  assert.equal(A.avantagesHeros(LOTS, 'Anivia', ['P'], 0).evitementMort, true);
  assert.equal(A.avantagesHeros(LOTS, 'Ashe', ['P', 'Q', 'W', 'E', 'R'], 4).evitementMort, false);
});

test('un revers compte en négatif : la forme de Fléau d’Aatrox inquiète ses alliés', () => {
  assert.ok(A.avantagesHeros(LOTS, 'Aatrox', ['R'], 4).totaux.INSPIRATION < 0);
});

test('les avantages d’une équipe s’additionnent', () => {
  const t = A.avantagesEquipe(LOTS, [
    { champion: 'Braum', cles: ['P', 'E'], progression: 1 },
    { champion: 'Alistar', cles: ['P', 'R'], progression: 4 },
  ]);
  assert.ok(t.PROTECTION > A.avantagesHeros(LOTS, 'Braum', ['P', 'E'], 1).totaux.PROTECTION);
});
