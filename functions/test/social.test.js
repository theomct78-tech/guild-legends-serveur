'use strict';
const test = require('node:test'), assert = require('node:assert');
const W = require('../src/monde'), SO = require('../src/social'), AC = require('../src/actions'), VUE = require('../src/vue');

function monde2() {
  const T0 = Date.UTC(2026, 10, 2, 5) / 3600000, m = W.creerMonde(T0);
  W.fonderGuilde(m, { id: 'a', nom: 'les Corbeaux', region: 'demacia' }); W.fonderGuilde(m, { id: 'b', nom: 'les Loutres', region: 'noxus' });
  for (const id of ['a', 'b']) for (const c of [...m.guildes[id].candidatures]) W.recruter(m, id, c.cle);
  return m;
}
test('catalogues : 100 actions au moins, une lettre d\'habitant par champion, des gestes pour chaque lieu de base', () => {
  assert.ok(AC.catalogue().length >= 100);
  for (const a of AC.catalogue()) { assert.ok(AC.CATEGORIES[a.cat], a.id); assert.ok(a.recit.includes('{un}') || a.recit.length > 40, a.id); assert.ok(Number.isFinite(a.cout) && Number.isFinite(a.prepa), a.id); }
  assert.equal(new Set(AC.catalogue().map(a => a.id)).size, AC.catalogue().length);
  const champions = new Set(W.catalogues().fiches.map(f => f.champion)), ecrits = new Set(SO.habitants().map(l => l.qui));
  for (const c of champions) assert.ok(ecrits.has(c), `pas de lettre d'habitant pour ${c}`);
  for (const l of SO.habitants()) if (l.qui.includes('+')) for (const c of l.qui.split('+')) assert.ok(champions.has(c), `champion inconnu : ${c}`);
  for (const lieu of ['dortoirs', 'salle_commune', 'cour', 'remparts', 'brief', 'jardin', 'taverne', 'bains', 'forge', 'salle_cartes', 'ecuries', 'sanctuaire'])
    assert.ok(AC.gestes().geste.filter(x => x.lieux.includes(lieu)).length >= 3, `gestes : ${lieu}`);
  for (const reg of ['noble', 'rue', 'sage', 'brut', 'joyeux', 'sombre', 'singulier']) for (const ton of ['merci', 'reproche']) assert.ok(SO.lettresHeros()[reg][ton].length >= 2);
});
test('action de guilde : payée, préparée, puis racontée dans la chronique ; pas deux fois dans la semaine', () => {
  const m = monde2(), g = m.guildes.a, po = g.po;
  W.avancer(m, m.t + 30);
  const r = W.lancerAction(m, 'a', 'barbecue'); assert.equal(r.prepa, 6); assert.equal(g.po, po - 15);
  assert.throws(() => W.lancerAction(m, 'a', 'barbecue'), /déjà en préparation/);
  W.avancer(m, m.t + 8);
  const e = g.chronique.filter(x => x.declencheur === 'action').pop();
  assert.ok(e && /braises|feu/.test(e.texte) && !/\{/.test(e.texte), e?.texte);
  assert.throws(() => W.lancerAction(m, 'a', 'barbecue'), /semaine/);
  const v = VUE.vue(m, 'a'); assert.ok(v.actions.liste.length >= 100); assert.ok(v.regions.noxus.route > 0);
});
test('geste envers un héros : adapté au lieu, raconté, pas deux fois de suite', () => {
  const m = monde2(), g = m.guildes.a; W.avancer(m, m.t + 30);
  const v = VUE.vue(m, 'a'), h = v.heros.find(x => x.gestes.length);
  assert.ok(h, 'un héros présent a des gestes possibles'); assert.ok(h.fait && !/\{/.test(h.fait));
  const r = W.faireGeste(m, 'a', h.id, h.gestes[0].id); assert.ok(r.texte.includes(h.nom));
  assert.throws(() => W.faireGeste(m, 'a', h.id, h.gestes[0].id), /tranquille/);
});
test('missive entre guildes : elle met le temps du vol', () => {
  const m = monde2(); const { vol } = W.envoyerMissive(m, 'a', 'b', 'Salut, on fait un contrat ensemble ?'); assert.ok(vol >= 2);
  assert.equal(VUE.vue(m, 'b').missives.length, 0); assert.equal(VUE.vue(m, 'a').missives[0].enVol, vol);
  W.avancer(m, m.t + vol + 2);
  assert.equal(VUE.vue(m, 'b').missives[0].sens, 'recue'); assert.ok(m.guildes.b.avis.some(a => a.type === 'missive' && a.texte.includes('contrat ensemble')));
  assert.throws(() => W.envoyerMissive(m, 'a', 'a', 'x'), /inconnue/);
});
test('entente : notée après un contrat, elle pèse sur les chances suivantes, et une lettre part entre deux guildes', () => {
  const m = monde2(), a = m.guildes.a, b = m.guildes.b, ha = a.heros[0], hb = b.heros[0];
  const liste = SO.noterEntentes(m, [{ g: a, h: { ...ha, traits: ['BIENVEILLANT', 'ENJOUE'] } }, { g: b, h: { ...hb, traits: ['BIENVEILLANT', 'ENJOUE'] } }], { titre: 'Test', lieu: 'Uwendale' }, 'eclatante');
  assert.equal(liste.length, 1); assert.ok(liste[0].v > 0);
  assert.equal(SO.bonusEntente(m, [ha.cle, hb.cle]), liste[0].v);
  assert.equal(SO.ententesDe(m, ha)[0].avec, hb.nom);
  liste[0].v = 4; SO.ecrireEntreHeros(m, liste, { titre: 'Test', lieu: 'Uwendale' }, {});
  const tous = [...(a.lettres || []), ...(b.lettres || [])];
  assert.equal(tous.length, 2); assert.ok(tous.every(l => !/\{/.test(l.texte)));
});
test('courrier des habitants : jamais deux fois la même lettre, toujours sur un héros de la guilde', () => {
  const m = monde2(), g = m.guildes.a; W.avancer(m, m.t + 24 * 20);
  const lettres = g.chronique.filter(e => e.scene === 'habitant');
  assert.ok(lettres.length >= 3, `${lettres.length} lettres en 20 jours`);
  assert.equal(new Set(g.habitantsVus).size, g.habitantsVus.length);
  for (const l of lettres) assert.ok(!/\{/.test(l.texte), l.texte);
});
test('fondation : seules les régions dont les missions Inconnue et Locale sont écrites sont ouvertes, et le site le sait', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ouvertes = W.regionsOuvertes();
  assert.ok(ouvertes.includes('demacia') && ouvertes.length >= 5);
  const f = path.join(__dirname, '../../public/js/regions.js'); if (!fs.existsSync(f)) return;   // dépôt serveur seul : pas de site
  const src = fs.readFileSync(f, 'utf8');
  const site = JSON.parse(src.match(/REGIONS_OUVERTES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(site.sort(), ouvertes, 'mettre à jour REGIONS_OUVERTES dans public/js/regions.js');
});
