'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/progression');
const missions = require('../../catalogue/missions/missions.json');
const fiches = require('../../catalogue/fiches.json');

// Un joueur actif : chaque héros part en mission environ tous les 2,3 jours (mission + repos + jours sans), 80 % de réussite.
function simulerHeros(jours, champion = 'Vi', graine = 1) {
  const f = fiches.find(x => x.champion === champion && x.skin === 'Classic'), cle = `${champion}|Classic`;
  let r = graine; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const xp = {}; const paliers = j => j < 21 ? 'inconnue' : j < 90 ? 'locale' : j < 240 ? 'regionale' : j < 540 ? 'renommee' : 'legendaire';
  for (let j = 0; j < jours; j++) {
    P.ajouterExperience(xp, { Force: 0.5 * 3, Endurance: 0.5 * 3 }); // trois créneaux d'entraînement par jour
    if (rnd() < 1 / 2.3) {
      const m = missions[Math.floor(rnd() * missions.length)];
      P.ajouterExperience(xp, P.experienceMission(P.statsActuelles(cle, f.plafonds, xp), { ...m, palier: paliers(j) }, rnd() < 0.8 ? 'reussite' : 'echec'));
    }
  }
  const st = P.statsActuelles(cle, f.plafonds, xp);
  return { fiche: P.ficheCombat({ stats: st, moral: 70 }, f.plafonds, f.potentiel), st, f };
}
const avance = ({ st, f }) => { const r = P.STATS.map(s => st[s] / f.plafonds[s]).sort((a, b) => b - a).slice(0, 5); return r.reduce((a, b) => a + b) / 5; };

test('un héros ne plafonne pas en deux semaines', () => {
  const h = simulerHeros(14);
  assert.ok(avance(h) < 0.8, avance(h));
  assert.ok(!h.fiche.stats.some(s => s.etat === 'sommet'));
  assert.equal(h.fiche.potentiel.revele, false);
});

test('le potentiel se devine en quelques mois et se révèle vers six mois, pas avant', () => {
  assert.equal(simulerHeros(60).fiche.potentiel.revele, false);
  const a = simulerHeros(100), b = simulerHeros(200), c = simulerHeros(320);
  assert.ok(avance(a) >= 0.8 && avance(a) < 0.9, `100 jours : ${avance(a)}`);
  assert.equal(b.fiche.potentiel.revele, false, `200 jours : ${avance(b)}`);
  assert.equal(c.fiche.potentiel.revele, true, `320 jours : ${avance(c)}`);
  assert.ok(avance(simulerHeros(365)) < 0.97, 'pas de sommet en un an');
});

test('niveau de guilde : long terme, jamais au maximum en deux semaines', () => {
  const N = P.niveauGuilde;
  assert.equal(N(0), 1);
  // réputation d'un joueur actif au palier Inconnue : ~2,2 par jour
  assert.ok(N(14 * 2.2) <= 4, N(14 * 2.2));
  for (let L = 2; L <= 50; L++) assert.ok(P.seuilNiveau(L) > P.seuilNiveau(L - 1));
  assert.equal(N(P.seuilNiveau(50)), 50);
  const av = P.avancementGuilde(P.seuilNiveau(7) + 5); assert.equal(av.niveau, 7); assert.ok(av.reste > 0 && av.pourcent >= 0);
});
