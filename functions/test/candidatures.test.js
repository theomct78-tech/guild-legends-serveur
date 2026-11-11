'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/candidatures');

const D = C.chargerTout();
const graine = s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

test('chaque champion a un dossier complet, dans un registre connu', () => {
  const champions = new Set(Object.values(D.fiches).map(f => f.champion));
  for (const c of champions) {
    const d = D.dossiers[c];
    assert.ok(d, `pas de dossier pour ${c}`);
    assert.ok(D.fragments.registres[d.registre], `${c} : registre ${d.registre}`);
    for (const k of ['support', 'histoire', 'presentation', 'signature']) assert.ok(d[k] && d[k].length > 0, `${c} : ${k} vide`);
  }
});

test('les 1 754 héros produisent un dossier, une lettre écrite de leur main et une rumeur sur leur potentiel', () => {
  const rng = graine(7);
  for (const cle of Object.keys(D.fiches)) {
    const x = C.composerDossier(D, cle, rng);
    assert.ok(x.lettre.length >= 1 && x.rumeur && x.lettre.every(l => typeof l === 'string' && l.length > 1), cle);
    assert.ok(x.traits.length >= 2, cle);
  }
});

test('un skin de gamme reçoit son univers et son support', () => {
  const x = C.composerDossier(D, 'Ahri|Star Guardian Ahri', graine(3));
  assert.match(x.univers, /Gardiennes des étoiles/);
  assert.match(x.support, /étoiles/);
  assert.equal(x.signature, 'Star Guardian Ahri');
});

test('l\'indice suit le vrai palier trois fois sur quatre, et ne s\'écarte jamais de plus d\'un cran', () => {
  const rng = graine(11); let juste = 0; const n = 4000;
  for (let i = 0; i < n; i++) {
    const p = C.palierAffiche('A-', rng);
    assert.ok(['B', 'A', 'S'].includes(p));
    if (p === 'A') juste++;
  }
  assert.ok(juste / n > 0.7 && juste / n < 0.8, `taux ${juste / n}`);
  for (let i = 0; i < 500; i++) assert.ok(['S', 'G'].includes(C.palierAffiche('G', rng)));
});

test('le potentiel n\'apparaît jamais en clair dans le dossier', () => {
  const x = C.composerDossier(D, 'Garen|Classic', graine(5));
  assert.equal(x.potentiel, undefined);
  assert.ok(!JSON.stringify(x).includes('"A-"'));
});
