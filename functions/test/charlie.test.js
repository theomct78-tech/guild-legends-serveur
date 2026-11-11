'use strict';
/* Charlie : parle des héros quand leur humeur franchit un seuil, de leurs besoins, et des pièces qu'on peut construire. */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/monde'), VU = require('../src/vue'), CH = require('../src/charlie');
const T0 = Date.UTC(2026, 10, 2, 5) / 3600000;

function monde1(titre = 'maître') {
  const monde = W.creerMonde(T0);
  W.fonderGuilde(monde, { id: 'a', nom: 'les Lanternes', region: 'demacia', chien: 'Gamelle', maitre: { titre, nom: 'ysolde' } });
  for (const c of [...monde.guildes.a.candidatures]) W.recruter(monde, 'a', c.cle);
  W.avancer(monde, T0 + 4);
  return monde;
}

test('le nom du maître est gardé, avec une majuscule ; Charlie change d\'apparence avec le titre', () => {
  const m = monde1('maîtresse'), v = VU.vue(m, 'a');
  assert.equal(v.guilde.nomMaitre, 'Ysolde');
  assert.equal(v.charlie.apparence, 'homme');
  assert.equal(VU.vue(monde1('maître'), 'a').charlie.apparence, 'femme');
  assert.throws(() => W.nommerMaitre(m, 'a', { nom: 'X3 <b>' }));
  W.nommerMaitre(m, 'a', { titre: 'maître', nom: 'Théo' });
  assert.equal(VU.vue(m, 'a').charlie.apparence, 'femme'); assert.equal(VU.vue(m, 'a').guilde.nomMaitre, 'Théo');
});

test('un héros qui passe sous le seuil du moral fait parler Charlie, une fois, de jour', () => {
  const m = monde1(), g = m.guildes.a, h = g.heros[0];
  CH.observer(g, 14);                       // Charlie fait connaissance
  h.moral = 20; h.etat = 'present';
  const n = CH.observer(g, 14);
  assert.ok(n, 'une remarque'); assert.equal(n.cle, 'triste'); assert.match(n.texte, new RegExp(h.nom));
  assert.doesNotMatch(n.texte, /\{|\}/); assert.deepEqual(n.action, { type: 'fiche', heros: h.id });
  g.t += 8; assert.equal(CH.observer(g, 14)?.cle === 'triste', false, 'pas deux fois la même chose');
});

test('la nuit, Charlie se tait ; le changement d\'humeur attend le matin', () => {
  const m = monde1(), g = m.guildes.a, h = g.heros[0];
  CH.observer(g, 14); h.moral = 20; h.etat = 'present';
  assert.equal(CH.observer(g, 2), null);
  g.t += 6; const n = CH.observer(g, 8); assert.equal(n?.cle, 'triste');
});

test('quand le coffre suffit pour une pièce ouverte au rang du repère, Charlie la propose', () => {
  const m = monde1('maîtresse'), g = m.guildes.a;
  for (const h of g.heros) { h.moral = 50; h.besoins = { energie: 80, social: 80, elan: 80, loisir: 80 }; h.blesse = false; h.salaire = h.attente; }
  CH.observer(g, 14); g.niveau = 7; g.po = 5000; g.t += 8;
  const n = CH.observer(g, 14);
  assert.equal(n?.cle, 'construire:table'); assert.match(n.texte, /patronne|Patronne/); assert.match(n.texte, /pourrait peut-être|Je dis ça/);
  assert.deepEqual(n.action, { type: 'salle', salle: 'table' });
});

test('aucun texte de Charlie n\'accorde un héros ou Charlie, et tous les repères existent', () => {
  const T = CH.catalogue();
  for (const [cle, l] of Object.entries(T)) for (const t of l) {
    assert.doesNotMatch(t, /\b(il|elle)s?\b(?! y a| y en| n'y| faut| faudra| ne manque| est temps| en reste| reste| revient| suffi)/i, `${cle} : ${t}`);
    assert.doesNotMatch(t, /\b(content|contente|sûre?|prête?|fatigué|fatiguée|seule?|heureuse?|rentrée?)\b/i, `${cle} : ${t}`);
    for (const r of t.match(/\{[^}]+\}/g) || []) assert.ok(['{h}', '{patron}', '{Patron}', '{chien}', '{salle}', '{prix}'].includes(r), r);
  }
  for (const k of ['triste', 'mieux', 'heureux', 'fatigue', 'seul', 'ennui', 'stagne', 'salaire', 'blesse', 'calme_vide', 'calme_mission', 'calme_matin', 'calme_soir', 'calme_jour', 'calme_contents']) assert.ok(T[k]?.length >= 2, k);
});
