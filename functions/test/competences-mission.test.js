'use strict';
/* Les compétences comptent en mission, se débloquent avec la progression ; la classe compte sur les épreuves de son poste. */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/monde'), VU = require('../src/vue'), AV = require('../src/avantages'), RES = require('../src/resolution');
const T0 = Date.UTC(2026, 10, 2, 5) / 3600000;

test('un héros arrive avec son passif et sa compétence signature, et débloque l\'ultime en dernier', () => {
  assert.deepEqual(AV.clesDebloquees('Aatrox', 0.76), ['P', 'Q']);
  assert.equal(AV.clesDebloquees('Aatrox', 0.82).length, 3);
  assert.equal(AV.clesDebloquees('Aatrox', 0.86).length, 4);
  assert.deepEqual(AV.clesDebloquees('Aatrox', 0.95).slice(-1), ['R']);
});

test('tenir un poste aide sur ses épreuves clés : un Tank pèse plus au combat qu\'en diplomatie', () => {
  const st = { Force: 60, Défense: 60, Magie: 20, 'Résistance magique': 50, Vitesse: 40, Précision: 50, Endurance: 60, Intelligence: 40, Leadership: 40 };
  const sans = RES.scoreEpreuve([{ nom: 'x', stats: st, moral: 70 }], { type: 'combat', difficulte: 40 });
  const avec = RES.scoreEpreuve([{ nom: 'x', stats: st, moral: 70, poste: 'Tank', efficacite: 1 }], { type: 'combat', difficulte: 40 });
  const diplo = RES.scoreEpreuve([{ nom: 'x', stats: st, moral: 70, poste: 'Tank', efficacite: 1 }], { type: 'diplomatie', difficulte: 40 });
  const diplo0 = RES.scoreEpreuve([{ nom: 'x', stats: st, moral: 70 }], { type: 'diplomatie', difficulte: 40 });
  assert.ok(avec.score > sans.score); assert.equal(diplo.score, diplo0.score);
});

test('la fiche d\'un héros montre ses compétences, débloquées ou à débloquer, et le contrat détaille ses chances', () => {
  const m = W.creerMonde(T0);
  W.fonderGuilde(m, { id: 'a', nom: 'A', region: 'demacia' });
  for (const c of [...m.guildes.a.candidatures]) W.recruter(m, 'a', c.cle);
  W.avancer(m, T0 + 4);
  const g = m.guildes.a, v = VU.vue(m, 'a'), h = v.heros[0];
  assert.ok(h.competences.liste.length >= 4);
  assert.ok(h.competences.liste.some(c => c.debloquee) && h.competences.liste.some(c => !c.debloquee && c.seuil));
  assert.ok(h.competences.prochain && h.competences.prochain.avance >= 0);
  let place = null;
  for (const c of W.contratsPour(m, 'a')) { for (const [i] of c.m.postes.entries()) for (const x of g.heros) { if (place) break; try { W.placer(m, 'a', c.id, i, x.id); place = c.id; } catch { /* suivant */ } } if (place) break; }
  assert.ok(place);
  const ct = VU.vue(m, 'a').contrats.find(c => c.id === place);
  assert.ok(ct.detail.length >= 1); for (const e of ct.detail) { assert.ok(e.chance >= 5 && e.chance <= 95); assert.ok(e.stats.length); assert.ok(e.meneur); }
  assert.ok(VU.vue(m, 'a').epreuves.combat.stats.length === 3);
});
