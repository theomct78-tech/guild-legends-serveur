'use strict';
const test = require('node:test');
const assert = require('node:assert');
const RES = require('../src/resolution'), M = require('../src/missions'), { rapportMission } = require('../src/rapport');
const missions = require('../../catalogue/missions/missions.json');

const st = { Force: 50, Défense: 50, Magie: 50, 'Résistance magique': 50, Vitesse: 50, Précision: 50, Endurance: 50, Intelligence: 50, Leadership: 50 };
const equipe = [{ nom: 'Garen', stats: st, moral: 70 }, { nom: 'Jinx', stats: st, moral: 60 }];

test('rapport : chaque mission du catalogue se raconte sans jeton oublié, avec la route, les épreuves et le dénouement', () => {
  let s = 3; const rng = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (const m of missions) {
    const r = RES.resoudreMission(equipe, m, {}, {}, rng);
    const cal = M.calendrier('demacia', m);
    const p = rapportMission(m, r, { calendrier: cal, equipe, repos: 12, graine: 'g' });
    const texte = p.join('\n');
    assert.ok(!/[{}]/.test(texte), `${m.id} : jeton oublié\n${texte}`);
    assert.ok(p.length >= r.epreuves.length + 2, `${m.id} : rapport trop court`);
    const meneur = r.epreuves?.find(e => e.reussie)?.meneur || equipe[0].nom;
    assert.ok(texte.includes(require('../src/langue').finir(m.denouements[r.issue].replace(/\{meneur\}/g, meneur).replace(/\{chien\}/g, 'le chien'))), `${m.id} : dénouement absent`);
    assert.ok(!/ à (le|les|Le|Les) /.test(p[0]), `${m.id} : préposition mal accordée\n${p[0]}`);
  }
});

test('rapport : une mission en solo ne parle jamais d\'un ou d\'une deuxième', () => {
  const m = missions.find(x => x.epreuves.some(e => e.type === 'combat'));
  const r = { issue: 'reussite', epreuves: m.epreuves.map(e => ({ type: e.type, reussie: true, tirage: 0.5, chance: 60, meneur: 'Riven', detail: [{ nom: 'Riven' }] })), blessures: [] };
  const texte = rapportMission(m, r, { equipe: [{ nom: 'Riven' }] }).join(' ');
  assert.ok(!/undefined|tout le monde prennent/.test(texte), texte);
});
