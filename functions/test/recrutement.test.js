'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/recrutement');
const fiches = require('../../catalogue/fiches.json');
const ordre = t => R.TIERS.indexOf(t);

test('candidatures : 10 % de chances par jour, rejouables', () => {
  let n = 0; for (let j = 0; j < 5000; j++) if (R.candidatureDuJour({ id: 'g1', niveau: 1 }, fiches, j)) n++;
  assert.ok(n > 420 && n < 580, `${n} candidatures sur 5000 jours`);
  assert.deepEqual(R.candidatureDuJour({ id: 'g1', niveau: 3 }, fiches, 17), R.candidatureDuJour({ id: 'g1', niveau: 3 }, fiches, 17));
});

test('le tier des candidats suit la réputation de la guilde', () => {
  const moyenne = niveau => { const l = []; for (let j = 0; j < 20000; j++) { const c = R.candidatureDuJour({ id: 'g' + niveau, niveau }, fiches, j); if (c) l.push(ordre(c.tier)); } return l.reduce((a, b) => a + b, 0) / l.length; };
  const m = [1, 8, 15, 25, 40].map(moyenne);
  for (let i = 1; i < m.length; i++) assert.ok(m[i] > m[i - 1], m.join(' < '));
  // Tous les rangs restent possibles, sauf G avant la Renommée ; et tous les rôles
  const vus = new Set(), roles = new Set();
  for (let j = 0; j < 60000; j++) { const c = R.candidatureDuJour({ id: 'x', niveau: 2 }, fiches, j); if (c) { assert.notEqual(c.tier, 'G'); vus.add(c.tier); roles.add(c.role); } }
  assert.ok(vus.has('S+') && vus.has('B'), [...vus].join(' '));
  assert.ok(roles.size >= 6, [...roles].join(' '));
});

test('un héros déjà recruté ou en attente ne candidate pas', () => {
  const tous = fiches.filter(f => f.potentiel === 'G').map(f => ({ cle: `${f.champion}|${f.skin}` }));
  for (let j = 0; j < 2000; j++) { const c = R.candidatureDuJour({ id: 'y', niveau: 45, heros: tous }, fiches, j); if (c) assert.notEqual(c.tier, 'G'); }
});

test('unicité globale : un héros d\'une autre guilde ou du Registre ne candidate pas', () => {
  const ailleurs = new Set(fiches.filter(f => f.potentiel === 'B+').map(f => `${f.champion}|${f.skin}`));
  for (let j = 0; j < 3000; j++) { const c = R.candidatureDuJour({ id: 'z', niveau: 1 }, fiches, j, ailleurs); if (c) assert.ok(!ailleurs.has(c.cle)); }
});

test('les hauts rangs deviennent plus fréquents avec l\'ancienneté', () => {
  const part = fondee => { let h = 0, n = 0; for (let j = 300; j < 40000; j++) { const c = R.candidatureDuJour({ id: 'anc', niveau: 8, fondee: fondee(j) }, fiches, j); if (c) { n++; if (['A+', 'S-', 'S', 'S+'].includes(c.tier)) h++; } } return h / n; };
  assert.ok(part(j => j * 24) < part(j => (j - 300) * 24));
});

test('montée de niveau : 3 à 10 dossiers, ciblés en tête, annonce = +10 points sur le rôle', () => {
  assert.equal(R.nombreDossiers(1), 3); assert.equal(R.nombreDossiers(12), 5); assert.equal(R.nombreDossiers(40), 10);
  const cible = 'Garen|Classic';
  const d = R.candidaturesMonteeNiveau({ id: 'm' }, fiches, 3, 10, { ciblees: [cible] });
  assert.equal(d.length, 3); assert.equal(d[0].cle, cible); assert.ok(d[0].ciblee);
  const avec = role => { let ok = 0; for (let i = 0; i < 4000; i++) { const g = { id: 'ann' + i, po: 1000, niveau: 3 }; if (role) R.poserAnnonce(g, role); if (R.candidaturesMonteeNiveau(g, fiches, 4, 10).some(x => x.role === 'Support')) ok++; assert.equal(g.annonce ?? null, null); } return ok / 4000; };
  const sans = avec(null), annonce = avec('Support');
  assert.ok(annonce - sans > 0.06 && annonce - sans < 0.14, `${sans} → ${annonce}`);
  assert.throws(() => R.poserAnnonce({ id: 'pauvre', po: 10, niveau: 1 }, 'Tank'), /PO/);
});
