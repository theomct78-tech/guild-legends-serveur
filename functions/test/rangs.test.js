'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RG = require('../src/rangs'), M = require('../src/missions'), R = require('../src/resolution');
const fiches = require('../../catalogue/fiches.json'), missions = require('../../catalogue/missions/missions.json');

// Un héros dont la valeur sur le poste vaut exactement v : on règle toutes ses statistiques à la même valeur.
const STATS = ['Force', 'Défense', 'Magie', 'Résistance magique', 'Vitesse', 'Précision', 'Endurance', 'Intelligence', 'Leadership'];
const plat = v => Object.fromEntries(STATS.map(k => [k, v]));
const deRang = r => plat((RG.SEUILS[r] + 1) / 1.025);   // moral neutre : × 1,025

test('rangs : l\'échelle prolonge les potentiels, et un héros au bout de son potentiel en a le rang', () => {
  assert.deepEqual(RG.RANGS.slice(6), ['B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+', 'G']);
  const parTier = {};
  for (const f of fiches) if (M.POSTES[f.role]) (parTier[f.potentiel] ||= []).push(RG.rangHeros(f.plafonds, f.role));
  for (const [tier, rangs] of Object.entries(parTier)) {
    const proches = rangs.filter(r => Math.abs(RG.indice(r) - RG.indice(tier)) <= 1).length / rangs.length;
    assert.ok(proches >= 0.6, `${tier} : ${Math.round(proches * 100)} % des héros au bout de leur potentiel sont à un rang près`);
  }
  // une recrue (75 % des plafonds) part plus bas que son potentiel
  const f = fiches.find(x => x.potentiel === 'A' && x.role === 'Support');
  const recrue = Object.fromEntries(Object.entries(f.plafonds).map(([k, v]) => [k, v * 0.75]));
  assert.ok(RG.indice(RG.rangHeros(recrue, 'Support')) <= RG.indice('B'));
});

test('rangs : sous le rang du contrat, le poste est moins bien tenu, jamais interdit', () => {
  const support = { role: 'Support', stats: deRang('C-') };
  assert.equal(RG.rangHeros(support.stats, 'Support'), 'C-');
  assert.equal(RG.efficaciteAvecRang(support, 'Support', 'B'), 0.6);            // 4 rangs manquants : -40 %
  assert.equal(RG.efficaciteAvecRang({ ...support, stats: deRang('B') }, 'Support', 'B'), 1);
  assert.ok(RG.efficaciteAvecRang({ ...support, stats: deRang('E') }, 'Support', 'S') >= 0.4);
  assert.match(RG.verdict(support, 'Support', 'B').texte, /4 rangs en dessous/);
});

test('rangs : un contrat de rang X donne de bonnes chances à une équipe de rang X, moins à une équipe plus faible', () => {
  const m = missions.find(x => x.id === 'DEM-L-021');   // un Support seul, deux épreuves de diplomatie
  const rang = RG.rangContrat(m);
  const chance = r => { const h = { nom: 'S', role: 'Support', stats: deRang(r), moral: 70 };
    return R.chanceMission([h], m, {}, { postes: [{ type: 'Support', heros: h, efficacite: RG.efficaciteAvecRang(h, 'Support', rang) }] }); };
  const auRang = chance(rang), dessous = chance(RG.RANGS[RG.indice(rang) - 4]);
  assert.ok(auRang >= 50, `au rang : ${auRang}`);
  assert.ok(dessous < auRang - 20 && dessous > 0, `4 rangs dessous : ${dessous}`);
});

test('poste disputé : le meilleur rang reprend un titulaire sous le rang, sinon le premier placé garde sa place', () => {
  const ep = [{ type: 'diplomatie', difficulte: 50 }, { type: 'diplomatie', difficulte: 52 }];
  const m = M.creerMission({ id: 'X', titre: 'x', source: 'institution', region: 'demacia', lieu: 'Zeffira', depart: 100 * 3600000, duree: 6, postes: ['Support'], epreuves: ep, guildesProposees: ['A', 'B', 'C'] });
  const rang = m.rang;
  const sup = (id, r) => ({ id, nom: id, role: 'Support', stats: deRang(r) });
  const bas = RG.RANGS[RG.indice(rang) - 4], haut = RG.RANGS[RG.indice(rang) + 1];
  M.positionner(m, 0, { guilde: 'A', regionGuilde: 'demacia', heros: sup('faible', bas) }, 0);
  const r = M.positionner(m, 0, { guilde: 'B', regionGuilde: 'demacia', heros: sup('fort', rang) }, 3600000);
  assert.equal(m.postes[0].heros.id, 'fort'); assert.equal(r.evince.guilde, 'A'); assert.equal(m.evinces.length, 1);
  // le titulaire a le rang du contrat : un héros encore meilleur ne le déloge pas
  assert.throws(() => M.positionner(m, 0, { guilde: 'C', regionGuilde: 'demacia', heros: sup('tres_fort', haut) }, 7200000), /déjà tenu/);
  // à rang égal sous le rang du contrat, le premier placé garde sa place
  const m2 = M.creerMission({ id: 'Y', titre: 'y', source: 'institution', region: 'demacia', lieu: 'Zeffira', depart: 100 * 3600000, duree: 6, postes: ['Support'], epreuves: ep, guildesProposees: ['A', 'B'] });
  M.positionner(m2, 0, { guilde: 'A', regionGuilde: 'demacia', heros: sup('a', bas) }, 0);
  assert.throws(() => M.positionner(m2, 0, { guilde: 'B', regionGuilde: 'demacia', heros: sup('b', bas) }, 3600000), /déjà tenu/);
});
