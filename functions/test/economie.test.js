'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/economie');
const RP = require('../src/repere');
const missions = require('../../catalogue/missions/missions.json');

const palierDuNiveau = n => n <= 5 ? 'inconnue' : n <= 12 ? 'locale' : n <= 20 ? 'regionale' : n <= 35 ? 'renommee' : 'legendaire';

test('pièces du repère : prix fixes, ouvertes rang après rang, chacune un vrai projet d\'épargne', () => {
  let precedent = 0, niveau = 0;
  for (const s of RP.SALLES) {
    assert.ok(s.prix > precedent && s.niveau > niveau, `${s.cle} : prix et rang croissants`);
    const semaines = s.prix / E.revenuHebdo(palierDuNiveau(s.niveau)).net;
    // Prix revus le 11 nov. (audit) : de une à quatre semaines de revenu théorique, pour qu'une guilde de bêta en ouvre au moins une.
    assert.ok(semaines >= 0.9 && semaines <= 4, `${s.cle} : ${semaines.toFixed(1)} semaines de contrats`);
    assert.ok(s.effet.length > 40 && Object.keys(s.regles).length, `${s.cle} : effet concret`);
    precedent = s.prix; niveau = s.niveau;
  }
  // la première pièce vaut au moins une dizaine de contrats ordinaires du début
  const ord = missions.filter(m => !m.risque && m.palier === 'inconnue'), moyenne = ord.reduce((t, m) => t + m.recompenses.po, 0) / ord.length;
  assert.ok(RP.SALLES[0].prix / moyenne >= 10);
  assert.equal(E.prixBatiment('table'), 600);
  assert.equal(RP.SALLES.length, 6); assert.deepEqual(RP.SALLES.map(s => s.niveau), [7, 14, 21, 28, 35, 42]);
});

test('construire : rang, prix et doublon', () => {
  const g = { niveau: 7, po: 1600, lieux: [] };
  assert.equal(RP.construire(g, 'soins').ok, false);          // rang 14
  assert.equal(RP.construire(g, 'table').ok, true);
  assert.equal(g.po, 1000); assert.ok(g.lieux.includes('cuisines') && g.lieux.includes('taverne'));
  assert.equal(RP.construire(g, 'table').ok, false);
  assert.equal(RP.effet(g, 'moralRepas'), 3); assert.equal(RP.effet(g, 'trajet'), 1);
  g.niveau = 35; g.po = 100; assert.match(RP.construire(g, 'ecuries').raison, /manque/);
  assert.equal(RP.prochaine({ niveau: 14 }).cle, 'armes');
});

test('effets : écuries, forge, salle des cartes, infirmerie', () => {
  const M = require('../src/missions'), R = require('../src/resolution');
  const m = missions.find(x => x.region === 'freljord' && x.palier === 'inconnue');
  assert.ok(M.calendrier('demacia', m, { trajet: 0.8 }).aller < M.calendrier('demacia', m).aller);
  const st = { Force: 30, Défense: 30, Magie: 30, 'Résistance magique': 30, Vitesse: 30, Précision: 30, Endurance: 30, Intelligence: 30, Leadership: 30 };
  const eq = [{ nom: 'A', stats: st, moral: 50 }, { nom: 'B', stats: st, moral: 50 }];
  const combat = { ...m, epreuves: [{ type: 'combat', difficulte: 60 }, { type: 'combat', difficulte: 60 }], complication: null };
  const blessures = f => { let n = 0; for (let i = 0; i < 400; i++) { let s = i + 1; const rng = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); n += R.resoudreMission(eq, combat, {}, { blessure: f }, rng).blessures.length; } return n; };
  assert.ok(blessures(0.8) < blessures(1));
  const V = require('../src/vie');
  const g = V.creerGuilde({ id: 'inf', nom: 'x', region: 'demacia', niveau: 5, t: 1000, heros: [{ id: 'A', nom: 'A', axes: { So: 50, Am: 50 }, traits: [], motivation: 'or' }] });
  V.retourMission(g, ['A'], 'reussite', { blesses: [{ id: 'A', niveau: 'grave' }], mission: { total: 20 } });
  const sans = g.heros[0].repos;
  const g2 = V.creerGuilde({ id: 'inf', nom: 'x', region: 'demacia', niveau: 5, t: 1000, heros: [{ id: 'A', nom: 'A', axes: { So: 50, Am: 50 }, traits: [], motivation: 'or' }] });
  g2.salles = ['soins'];
  V.retourMission(g2, ['A'], 'reussite', { blesses: [{ id: 'A', niveau: 'grave' }], mission: { total: 20 } });
  assert.ok(g2.heros[0].repos < sans);
});
