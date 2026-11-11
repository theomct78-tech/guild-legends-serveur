'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MJ = require('../src/multijoueur');
const palier = () => 'locale';
const H = 1;

test('alliances : proposer, accepter, limite par palier, rupture avec préavis, délai avant de se réallier', () => {
  const e = {};
  const cle = MJ.proposerAlliance(e, 'A', 'B', palier, 0);
  MJ.accepterAlliance(e, cle, 'B', palier, 10);
  assert.ok(MJ.sontAllies(e, 'A', 'B', 20));
  MJ.accepterAlliance(e, MJ.proposerAlliance(e, 'A', 'C', palier, 20), 'C', palier, 21);
  assert.throws(() => MJ.proposerAlliance(e, 'A', 'D', palier, 22), /autant d'alliés/);        // 2 au palier Locale
  MJ.rompreAlliance(e, 'A', 'B', 100);
  assert.ok(MJ.sontAllies(e, 'A', 'B', 120));                 // préavis de 48 h
  assert.ok(!MJ.sontAllies(e, 'A', 'B', 149));
  assert.throws(() => MJ.proposerAlliance(e, 'B', 'A', palier, 200), /rompue récemment/);
  assert.equal(MJ.cohesionAlliance(e, ['A', 'C', null], 200), 4);
});

test('territoires : la plus influente tient la région, il faut 10 % de plus pour la reprendre, l\'influence s\'efface', () => {
  const det = {};
  let r = MJ.recompterTerritoires(det, [{ guilde: 'A', region: 'noxus', reputation: 30, t: 0 }, { guilde: 'B', region: 'noxus', reputation: 25, t: 0 }], 10);
  assert.equal(det.noxus, 'A'); assert.equal(r.changements.length, 1);
  r = MJ.recompterTerritoires(det, [{ guilde: 'A', region: 'noxus', reputation: 30, t: 0 }, { guilde: 'B', region: 'noxus', reputation: 32, t: 0 }], 20);
  assert.equal(det.noxus, 'A');                                // 32 < 30 × 1,1
  r = MJ.recompterTerritoires(det, [{ guilde: 'A', region: 'noxus', reputation: 30, t: 0 }, { guilde: 'B', region: 'noxus', reputation: 40, t: 0 }], 30);
  assert.equal(det.noxus, 'B');
  r = MJ.recompterTerritoires(det, [{ guilde: 'B', region: 'noxus', reputation: 40, t: 0 }], 24 * 30);   // plus de 4 semaines
  assert.equal(det.noxus, undefined);
  assert.equal(MJ.effetsTerritoire({ ionia: 'A' }, 'A').bonusPO('ionia'), 0.1);
});

test('tournois : poule jusqu\'à 6 équipes, élimination au-delà, la meilleure équipe gagne le plus souvent, forfait', () => {
  const st = v => ({ Force: v, Défense: v, Magie: v, 'Résistance magique': v, Vitesse: v, Précision: v, Endurance: v, Intelligence: v, Leadership: v });
  const eq = (g, v, n = 3) => ({ guilde: g, niveau: v, heros: Array.from({ length: n }, (_, i) => ({ nom: g + i, stats: st(v), moral: 70 })) });
  let s = 7; const rng = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  let victoires = 0;
  for (let i = 0; i < 100; i++) { const t = MJ.jouerTournoi([eq('fort', 70), eq('moyen', 55), eq('faible', 40)], rng, palier); if (t.classement[0] === 'fort') victoires++; }
  assert.ok(victoires > 70, `${victoires} victoires sur 100`);
  const t = MJ.jouerTournoi([eq('a', 60), eq('b', 50), eq('c', 50), eq('d', 50), eq('e', 50), eq('f', 50), eq('g', 50), eq('h', 40)], rng, palier);
  assert.equal(t.classement.length, 8); assert.equal(t.matchs.length, 7);
  assert.equal(t.gains[0].po, Math.round(t.cagnotte * 0.6));
  assert.ok(MJ.match(eq('x', 50), eq('y', 50, 0), rng).forfait);
});
