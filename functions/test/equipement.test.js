'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EQ = require('../src/equipement');

test('équipement : deux objets par héros, bonus plafonnés par le potentiel, consommables', () => {
  const g = { t: 100, inventaire: [], heros: [{ id: 'A', nom: 'Garen', equipement: [] }] };
  for (const nom of ['Épée longue', 'Pioche', 'Bottes', 'Potion de soin', 'Élixir de rage']) g.inventaire.push({ uid: nom, nom, ...EQ.OBJETS[nom] });
  EQ.equiper(g, 'A', 'Épée longue'); EQ.equiper(g, 'A', 'Pioche');
  assert.throws(() => EQ.equiper(g, 'A', 'Bottes'), /déjà 2 objets/);
  const s = EQ.statsEquipees({ Force: 60 }, g.heros[0], { plafonds: { Force: 66 } });
  assert.equal(s.Force, 66);                                   // 60 + 4 + 6, plafonné à 66
  assert.throws(() => EQ.equiper(g, 'A', 'Potion de soin'), /aucun soin/);
  g.heros[0].reposJusqua = 130; EQ.equiper(g, 'A', 'Potion de soin');
  assert.equal(g.heros[0].reposJusqua, 118);
  EQ.equiper(g, 'A', 'Élixir de rage'); EQ.elixirBu(g.heros[0]); assert.equal(g.heros[0].elixir, null);
  EQ.rendreEquipement(g, g.heros[0]);
  assert.equal(g.heros[0].equipement.length, 0); assert.ok(g.inventaire.some(o => o.nom === 'Pioche'));
  // Chaque objet des missions existe
  const missions = require('../../catalogue/missions/missions.json');
  for (const m of missions) for (const o of m.recompenses.objets) assert.ok(EQ.OBJETS[o.nom], `${m.id} : ${o.nom}`);
});
