'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/specialites');

const h = (nom, specialites = [], extra = {}) => ({ nom, specialites, statut: 'repere', ...extra });
const soraka = h('Soraka', ['Healer']);
const alistar = h('Alistar', ["Soins d'appoint"]);
const garen = h('Garen');
const quinn = h('Quinn', ['Éclaireur']);
const twitch = h('Twitch', ["Éclaireur d'appoint"]);

test('points : principal compte 1, appoint 0,5, les autres 0', () => {
  assert.equal(S.points([soraka, alistar, garen], 'soin'), 1.5);
  assert.equal(S.points([quinn, twitch, soraka], 'eclaireur'), 1.5);
});

test('repère : sans soignant, guérison normale', () => {
  const r = S.vitesseGuerison([garen], [h('Darius', [], { blessure: S.nouvelleBlessure('grave') })]);
  assert.equal(r.vitesse, 1);
});

test('repère : un Healer présent accélère la guérison', () => {
  const blesse = h('Darius', [], { blessure: S.nouvelleBlessure('grave') });
  const r = S.vitesseGuerison([soraka, garen], [blesse]);
  assert.equal(r.vitesse, 1.6);
  assert.deepEqual(r.soignants.map(x => x.nom), ['Soraka']);
});

test('repère : un Healer en mission ou lui-même blessé ne soigne pas', () => {
  const blesses = [h('Darius', [], { blessure: S.nouvelleBlessure('legere') })];
  assert.equal(S.vitesseGuerison([h('Soraka', ['Healer'], { statut: 'mission' })], blesses).vitesse, 1);
  assert.equal(S.vitesseGuerison([h('Soraka', ['Healer'], { blessure: S.nouvelleBlessure('legere') })], blesses).vitesse, 1);
});

test('repère : trop de blessés pour un seul Healer, l’efficacité se partage', () => {
  const blesses = Array.from({ length: 6 }, (_, i) => h('B' + i, [], { blessure: S.nouvelleBlessure('legere') }));
  assert.equal(S.vitesseGuerison([soraka], blesses).vitesse, 1.3);
});

test('repère : la vitesse plafonne, même avec beaucoup de soignants', () => {
  const healers = Array.from({ length: 8 }, (_, i) => h('H' + i, ['Healer']));
  const r = S.vitesseGuerison(healers, [h('D', [], { blessure: S.nouvelleBlessure('critique') })]);
  assert.equal(r.vitesse, S.PARAMS.repere.plafondVitesse);
});

test('convalescence : une blessure grave guérit plus vite avec un Healer', () => {
  let sans = S.nouvelleBlessure('grave'), avec = S.nouvelleBlessure('grave'), jSans = 0, jAvec = 0;
  while (sans) { sans = S.avancerConvalescence(sans, 1); jSans++; }
  while (avec) { avec = S.avancerConvalescence(avec, 1.6); jAvec++; }
  assert.equal(jSans, 6); assert.equal(jAvec, 4);
});

test('mission : un Healer réduit le risque de mort, avec un plancher', () => {
  assert.equal(S.modificateursMission([garen]).risqueMort, 1);
  assert.equal(S.modificateursMission([soraka, garen]).risqueMort, 0.65);
  const beaucoup = Array.from({ length: 5 }, (_, i) => h('H' + i, ['Healer']));
  assert.equal(S.modificateursMission(beaucoup).risqueMort, S.PARAMS.mission.plancherMort);
});

test('mission : une blessure peut être réduite d’un niveau, jamais en dessous de légère', () => {
  const mods = S.modificateursMission([soraka]);
  assert.equal(S.attenuerBlessure('critique', mods, 0.1), 'grave');
  assert.equal(S.attenuerBlessure('critique', mods, 0.9), 'critique');
  assert.equal(S.attenuerBlessure('legere', mods, 0), 'legere');
  assert.equal(S.attenuerBlessure('grave', S.modificateursMission([garen]), 0), 'grave');
});

test('mission : un vrai Éclaireur révèle les conditions, un éclaireur d’appoint seulement en partie', () => {
  const avec = S.modificateursMission([quinn, garen]);
  assert.equal(avec.conditionsRevelees, true); assert.equal(avec.risqueEmbuscade, 0.6);
  const appoint = S.modificateursMission([twitch]);
  assert.equal(appoint.conditionsRevelees, false); assert.equal(appoint.conditionsPartielles, true);
  assert.equal(S.modificateursMission([garen]).conditionsPartielles, false);
});

test('poste Healer : principal à 100 %, appoint à 50 %, les autres exclus', () => {
  assert.equal(S.efficacitePoste(soraka, 'Healer'), 1);
  assert.equal(S.efficacitePoste(alistar, 'Healer'), 0.5);
  assert.equal(S.efficacitePoste(garen, 'Healer'), 0);
});

test('poste de rôle : rôle principal à 100 %, rôle secondaire à 75 %', () => {
  const galio = { role: 'Tank', role_secondaire: 'Mage', specialites: [] };
  assert.equal(S.efficacitePoste(galio, 'Tank'), 1);
  assert.equal(S.efficacitePoste(galio, 'Mage'), 0.75);
  assert.equal(S.efficacitePoste(galio, 'Tireur'), 0);
});

test('repère : les éclaireurs présents rapportent des pistes de missions, avec un plafond', () => {
  assert.equal(S.chancePiste([garen]), 0);
  assert.equal(S.chancePiste([quinn]), 0.15);
  assert.equal(S.chancePiste(Array.from({ length: 10 }, (_, i) => h('E' + i, ['Éclaireur']))), 0.5);
});
