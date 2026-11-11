'use strict';
/* Contrats : le départ se voit, la durée reste secrète, le correspondant écrit, le rappel prend le temps de l'oiseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/monde'), VU = require('../src/vue'), M = require('../src/missions');
const T0 = Date.UTC(2026, 10, 2, 5) / 3600000;

function monde1() {
  const monde = W.creerMonde(T0);
  W.fonderGuilde(monde, { id: 'a', nom: 'les Lanternes', region: 'demacia', chien: 'Gamelle', maitre: { titre: 'maîtresse' } });
  for (const c of [...monde.guildes.a.candidatures]) W.recruter(monde, 'a', c.cle);
  W.avancer(monde, T0 + 4);
  return monde;
}
// Place un héros libre sur le contrat le plus long à atteindre (pour avoir le temps de le rappeler en route).
function placerUn(monde) {
  const g = monde.guildes.a;
  const cs = W.contratsPour(monde, 'a').map(c => ({ c, cal: M.calendrier(g.region, c.mission) })).filter(x => x.cal.possible).sort((x, y) => y.cal.aller - x.cal.aller);
  for (const { c } of cs) for (const [i, p] of c.m.postes.entries()) for (const h of g.heros) {
    if (p.heros || !W.disponible(g, h) || !M.efficacitePoste(h, p.type)) continue;
    try { W.placer(monde, 'a', c.id, i, h.id); return { c, h, i }; } catch { /* poste suivant */ }
  }
  return null;
}

test('le héros passe en salle de brief, puis la mission apparaît en cours dès son départ, sans durée', () => {
  const monde = monde1(), x = placerUn(monde); assert.ok(x, 'un héros placé');
  let v = VU.vue(monde, 'a');
  const ct = v.contrats.find(c => c.id === x.c.id);
  assert.equal(ct.cal.surPlace, undefined, 'la durée sur place est cachée'); assert.equal(ct.briefing.length, 1);
  const p = x.c.m.postes[x.i];
  W.avancer(monde, x.c.depart - p.trajet + 2);
  v = VU.vue(monde, 'a');
  const m = v.missionsEnCours.find(y => y.id === x.c.id);
  assert.ok(m, 'mission en cours dès le départ'); assert.equal(m.total, undefined); assert.ok(['route', 'surPlace'].includes(m.phase));
  assert.ok(monde.guildes.a.chronique.some(e => e.scene === 'contrat#depart'));
});

test('le correspondant écrit à l\'arrivée puis à l\'issue, avec le délai de l\'oiseau', () => {
  const monde = monde1(), x = placerUn(monde); const p = x.c.m.postes[x.i];
  W.avancer(monde, x.c.depart + 72);
  const ch = monde.guildes.a.chronique.filter(e => /contrat#(arrivee|issue)/.test(e.scene));
  assert.ok(ch.some(e => e.scene === 'contrat#arrivee'), 'lettre d\'arrivée');
  assert.ok(ch.some(e => e.scene === 'contrat#issue'), 'lettre d\'issue');
  const arr = ch.find(e => e.scene === 'contrat#arrivee');
  assert.ok(arr.t >= x.c.depart + 1, 'la lettre arrive après les faits');
  assert.match(arr.texte, /Chambre des Bannières/); assert.match(arr.texte, /Maîtresse/); assert.doesNotMatch(arr.texte, /\{[a-z_]+\}/);
  for (const e of ch) assert.doesNotMatch(e.texte, /\{[a-z_]+\}|undefined/, e.texte);
  void p;
});

test('rappel : en brief, le héros reste ; en route, il revient après le vol de l\'oiseau et le chemin parcouru', () => {
  const monde = monde1(), x = placerUn(monde); const p = x.c.m.postes[x.i], g = monde.guildes.a;
  if (p.trajet < 4) return; // contrat trop proche : pas de rappel en route possible
  W.avancer(monde, x.c.depart - p.trajet + 2);
  const r = W.retirer(monde, 'a', x.c.id, x.h.id);
  assert.equal(r.rappel, 'route'); assert.equal(x.h.etat, 'rappel');
  W.avancer(monde, monde.t + r.retour + 2);
  assert.equal(g.heros.find(h => h.id === x.h.id).etat, 'present');
});
