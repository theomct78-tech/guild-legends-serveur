'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/billets');
const billets = B.chargerBillets();
const g = (o = {}) => ({ t: 1000, nom: 'les Lanternes', monde: { chien: 'Gamelle', bourg: 'Uwendale' }, maitre: { titre: 'maître', billetsDoux: true }, heros: [], ...o });

test('billets doux : seulement des adultes choisis, jamais une gamme jeune, et le joueur peut les couper', () => {
  const ez = { champion: 'Ezreal', univers: 'classic', traits: ['CHARMEUR'] };
  assert.ok(B.possibles(billets, ez, g()).some(b => b.genre === 'doux'));
  assert.ok(!B.possibles(billets, { ...ez, univers: 'Star Guardian' }, g()).some(b => b.genre === 'doux'));
  assert.ok(!B.possibles(billets, ez, g({ maitre: { billetsDoux: false } })).some(b => b.genre === 'doux'));
  // un charmeur quelconque n'écrit pas de billet doux générique
  assert.ok(!B.possibles(billets, { champion: 'Zoe', univers: 'classic', traits: ['CHARMEUR'] }, g()).some(b => b.genre === 'doux'));
  for (const b of billets.filter(x => x.genre === 'doux')) assert.ok(!['Zoe', 'Annie', 'Lulu', 'Teemo', 'Tristana', 'Gnar', 'Yuumi', 'Nunu'].includes(b.cle));
});

test('les billets s\'accordent au maître ou à la maîtresse, sans jeton oublié', () => {
  const h = { nom: 'Ezreal' };
  for (const b of billets) for (const titre of ['maître', 'maîtresse']) {
    const t = B.remplir(b.texte + (b.traduction || ''), g({ maitre: { titre } }), h, { nom: 'Lux' }, { nom: 'Ryze' });
    assert.doesNotMatch(t, /\{|\}/, `${b.id} : ${t}`);
    if (titre === 'maîtresse') assert.doesNotMatch(t.replace(/maître d'armes|Maître de Guilde|pas de maître/g, ''), /\bMaître\b|\bmaître\b/, `${b.id}`);
  }
  // les billets génériques n'accordent pas l'auteur (héros de n'importe quel genre)
  for (const b of billets.filter(x => x.cle.startsWith('@'))) assert.doesNotMatch(b.texte, /je suis (resté|restée|fatigué|seul)\b/i, b.id);
});

test('un billet arrive rarement, et une réponse n\'est jamais obligatoire', () => {
  const h = { id: 'Jinx', nom: 'Jinx', champion: 'Jinx', univers: 'classic', traits: ['FARCEUR'], etat: 'present', arrivee: 0 };
  const gg = g({ heros: [h, { id: 'Vi', nom: 'Vi', champion: 'Vi', traits: [], etat: 'present', arrivee: 0 }], cartes: [] });
  let n = 0; for (let j = 0; j < 100; j++) { gg.t = 1000 + j * 24; if (B.envoyerBillets(gg, billets, () => (j * 0.137) % 1, { estime: () => 60, creerCarte: (x, type, hs) => ({ type, heros: hs.map(z => z.id) }) })) n++; }
  assert.ok(n >= 3 && n <= 12, `${n} billets en 100 jours`);
  const r = B.repondreBillet(gg, { genre: 'clown', options: B.OPTIONS.clown }, h, 'garder', true);
  assert.equal(r.poids, 0);
});

test('maître ou maîtresse : la chronique, les réponses et les raisons du moral s\'accordent', () => {
  const MA = require('../src/maitre');
  const g = { maitre: { titre: 'maîtresse' } };
  assert.equal(MA.accorder(g, 'Le maître lui a donné raison'), 'La maîtresse lui a donné raison');
  assert.equal(MA.accorder(g, 'une imitation très réussie du maître de guilde.'), 'une imitation très réussie de la maîtresse de guilde.');
  assert.equal(MA.accorder({ maitre: { titre: 'maître' } }, 'Le maître'), 'Le maître');
  assert.equal(MA.accorder(g, 'mon maître d\'armes'), 'mon maître d\'armes');
});
