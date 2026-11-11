'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require('../src/competences');
const DATA = require(path.join(__dirname, '../../catalogue/competences.json'));

test('catalogue : 173 champions, 5 compétences chacun, l’ultime toujours débloqué en dernier', () => {
  const noms = Object.keys(DATA);
  assert.equal(noms.length, 173);
  for (const n of noms) {
    assert.equal(DATA[n].competences.length, 5, n);
    assert.equal(DATA[n].ordre_deblocage[0], 'P', n);
    assert.equal(DATA[n].ordre_deblocage[4], 'R', n);
  }
});

test('chaque champion a au moins une compétence de dégâts avec des dégâts de base', () => {
  const sans = Object.entries(DATA).filter(([, v]) => !v.competences.some(c => c.degats)).map(([n]) => n);
  assert.deepEqual(sans, [], 'champions sans dégâts : ' + sans.join(', '));
});

test('déblocage progressif : passif seul au recrutement, ultime au dernier palier', () => {
  const annie = DATA.Annie;
  assert.deepEqual(C.competencesDebloquees(annie, 0).map(c => c.cle), ['P']);
  assert.equal(C.competencesDebloquees(annie, 3).length, 4);
  assert.ok(!C.competencesDebloquees(annie, 3).some(c => c.cle === 'R'));
  assert.ok(C.competencesDebloquees(annie, 4).some(c => c.cle === 'R'));
});

test('les dégâts progressent du rang 1 au rang maximal', () => {
  const q = DATA.Annie.competences.find(c => c.cle === 'Q');
  assert.equal(C.degatsEffectifs(q, 0), q.degats[0]);
  assert.equal(C.degatsEffectifs(q, 4), q.degats[1]);
});

test('une compétence non débloquée ne pèse pas sur la mission', () => {
  const soin = { conditions: { soin: 2 } };
  const soraka = DATA.Soraka;
  const avant = C.apportMission(soraka, 0, soin).score;
  const apres = C.apportMission(soraka, 4, soin).score;
  assert.ok(apres > avant, `${avant} -> ${apres}`);
  assert.ok(C.apportMission(soraka, 4, soin).decisives.some(d => d.nom === 'Infusion astrale'));
});

test('les étiquettes demandées départagent les héros : un Healer apporte plus à une mission de soins qu’un assassin', () => {
  const m = { conditions: { soin: 2, bouclier: 1 } };
  assert.ok(C.apportMission(DATA.Soraka, 4, m).score > C.apportMission(DATA.Zed, 4, m).score);
});

test('une mission d’infiltration valorise la furtivité', () => {
  const m = { conditions: { furtivite: 2 } };
  assert.ok(C.apportMission(DATA.Teemo, 4, m).score > 0);
  assert.equal(C.apportMission(DATA.Garen, 4, m).score, 0);
});

test('chance de toucher : ciblée > zone > projectile, ajustée par la Précision', () => {
  const q = DATA.Annie.competences.find(c => c.cle === 'Q');           // ciblée
  const ez = DATA.Ezreal.competences.find(c => c.cle === 'Q');         // projectile
  assert.ok(C.chanceToucher(q) > C.chanceToucher(ez));
  assert.ok(C.chanceToucher(ez, 90, 30) > C.chanceToucher(ez, 50, 50));
  assert.ok(C.chanceToucher(ez, 0, 100) >= C.PARAMS.chanceMin);
  assert.equal(C.chanceToucher(DATA.Soraka.competences.find(c => c.cle === 'W')), 100);   // soin : pas de jet
});

test('soins et boucliers ont des montants qui croissent avec la progression', () => {
  const w = DATA.Soraka.competences.find(c => c.cle === 'W');
  assert.ok(w.soin && C.valeurRang(w.soin, 4) > C.valeurRang(w.soin, 0));
  const garenW = DATA.Garen.competences.find(c => c.cle === 'W');
  assert.ok(garenW.bouclier);
});

test('un tireur précis apporte plus de dégâts espérés qu’un tireur maladroit', () => {
  const m = { conditions: { degats: 1 }, esquive: 50 };
  assert.ok(C.apportMission(DATA.Ezreal, 4, m, { precision: 85 }).score > C.apportMission(DATA.Ezreal, 4, m, { precision: 30 }).score);
});
