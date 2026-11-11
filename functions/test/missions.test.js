'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/missions');

const H = 3600 * 1000;
const janna = { id: 'janna', nom: 'Janna', role: 'Support', specialites: ['Healer'] };
const zed = { id: 'zed', nom: 'Zed', role: 'Assassin', specialites: [] };
const garen = { id: 'garen', nom: 'Garen', role: 'Combattant', specialites: [] };
const nouvelle = (o = {}) => M.creerMission({ id: 'm1', titre: 'Escorte', source: 'institution', region: 'freljord', depart: 24 * H, duree: 6, niveau: 2,
  postes: ['Support', 'DPS'], epreuves: [], guildesProposees: ['A', 'B', 'C'], ...o });

test('postes : qui peut tenir quoi, et à quelle efficacité', () => {
  assert.equal(M.efficacitePoste(zed, 'DPS'), 1);
  assert.equal(M.efficacitePoste(janna, 'DPS'), 0);
  assert.equal(M.efficacitePoste(garen, 'Tank'), 0.5);
  assert.equal(M.efficacitePoste({ role: 'Mage', role_secondaire: 'Support' }, 'Support'), 0.75);
  assert.equal(M.efficacitePoste(janna, 'Healer'), 1);
  assert.equal(M.efficacitePoste({ role: 'Mage', specialites: ["Soins d'appoint"] }, 'Healer'), 0.5);
});

test('un poste vide pèse surtout sur ses épreuves clés', () => {
  const postes = [{ type: 'DPS', heros: null }];
  assert.equal(M.penaliteComposition(postes, 'combat'), 8);
  assert.equal(M.penaliteComposition(postes, 'voyage'), 3);
  assert.equal(M.penaliteComposition([{ type: 'Tank', heros: garen, efficacite: 0.5 }], 'combat'), 4);
});

test('trajets en heures, plus courts chemins, Bandle par ses portails', () => {
  assert.equal(M.dureeTrajet('demacia', 'demacia'), 3);
  assert.equal(M.dureeTrajet('demacia', 'freljord'), 11);
  assert.equal(M.dureeTrajet('zaun', 'demacia'), 1 + 6 + 7 + 3);
  assert.equal(M.dureeTrajet('bandle', 'ionia'), 9);
  assert.equal(M.dureeTrajet('ionia', 'demacia'), M.dureeTrajet('demacia', 'ionia'));
});

test('positionnement : premier arrivé, premier servi, et il faut arriver à temps', () => {
  const m = nouvelle();
  const r = M.positionner(m, 0, { guilde: 'A', regionGuilde: 'demacia', heros: janna }, 0);
  assert.equal(r.trajet, 11);
  assert.throws(() => M.positionner(m, 0, { guilde: 'B', regionGuilde: 'freljord', heros: { ...janna, id: 'j2' } }, 0), /déjà réservé/);
  assert.throws(() => M.positionner(m, 1, { guilde: 'B', regionGuilde: 'ionia', heros: zed }, 10 * H), /Hors de portée/);
  assert.throws(() => M.positionner(m, 1, { guilde: 'B', regionGuilde: 'noxus', heros: zed }, 15 * H), /Trop loin/);
  assert.throws(() => M.positionner(m, 1, { guilde: 'B', regionGuilde: 'freljord', heros: { ...janna, id: 'j3' } }, 0), /ne peut pas tenir/);
  assert.throws(() => M.positionner(m, 1, { guilde: 'Z', regionGuilde: 'freljord', heros: zed }, 0), /pas été proposée/);
});

test('départ complet : la mission part', () => {
  const m = nouvelle();
  M.positionner(m, 0, { guilde: 'A', regionGuilde: 'demacia', heros: janna }, 0);
  M.positionner(m, 1, { guilde: 'B', regionGuilde: 'noxus', heros: zed }, 0);
  assert.equal(M.auDepart(m).statut, 'en_cours');
});

test('départ incomplet : confirmation, puis départ si la guilde accepte', () => {
  const m = nouvelle();
  M.positionner(m, 0, { guilde: 'A', regionGuilde: 'demacia', heros: janna }, 0);
  assert.equal(M.auDepart(m).statut, 'confirmation');
  assert.equal(M.confirmer(m, 'A', true).statut, 'en_cours');
  assert.equal(m.postes[0].heros.id, 'janna');
});

test('si personne ne part, la mission a lieu sans personne et les guildes sollicitées qui pouvaient venir perdent de la réputation', () => {
  const m = nouvelle();
  M.positionner(m, 0, { guilde: 'A', regionGuilde: 'demacia', heros: janna }, 0);
  M.auDepart(m);
  M.confirmer(m, 'A', false);
  assert.equal(m.statut, 'abandonnee');
  assert.deepEqual(m.pertesReputation, { A: -6, B: -6, C: -6 });
  // Nuance : seules les guildes qui pouvaient arriver à temps sont pénalisées (A engagée l'est toujours)
  const m2 = nouvelle();
  const regions = { A: 'freljord', B: 'demacia', C: 'ixtal' }; // C est à 33 h, la mission part dans 24 h
  M.positionner(m2, 0, { guilde: 'A', regionGuilde: 'freljord', heros: janna }, 0);
  M.auDepart(m2, regions);
  M.confirmer(m2, 'A', false, regions);
  assert.deepEqual(m2.pertesReputation, { A: -6, B: -6 });
  const vide = M.auDepart(nouvelle());
  assert.equal(vide.statut, 'abandonnee');
});

test('sans réponse à l’échéance, la guilde est réputée refuser', () => {
  const m = nouvelle();
  M.positionner(m, 0, { guilde: 'A', regionGuilde: 'demacia', heros: janna }, 0);
  M.positionner(m, 1, { guilde: 'B', regionGuilde: 'noxus', heros: zed }, 0);
  M.retirer(m, 'B');
  M.auDepart(m);
  assert.equal(M.conclureConfirmation(m).statut, 'abandonnee');
});

test('mission privée : seule la guilde hôte invite, l’invitée peut alors compléter', () => {
  const m = nouvelle({ source: 'privee', hote: 'A', guildesProposees: undefined });
  assert.throws(() => M.positionner(m, 1, { guilde: 'B', regionGuilde: 'freljord', heros: zed }, 0), /pas été proposée/);
  assert.throws(() => M.inviter(m, 'B', 'C'), /hôte/);
  M.inviter(m, 'A', 'B');
  M.positionner(m, 1, { guilde: 'B', regionGuilde: 'freljord', heros: zed }, 0);
  assert.equal(m.postes[1].guilde, 'B');
  assert.throws(() => M.inviter(nouvelle(), 'A', 'B'), /privées/);
});

test('48 h au plus, trajets compris : le temps sur place se raccourcit, puis la mission devient hors de portée', () => {
  const local = M.calendrier('demacia', { region: 'demacia', lieu: 'Vaskasia', duree: 6 });
  assert.deepEqual(local, { aller: 7, surPlace: 6, retour: 7, total: 20, possible: true });
  const loin = M.calendrier('demacia', { region: 'ionia', lieu: "Fermes d'Azur", duree: 8 });
  assert.equal(loin.total, 48); assert.equal(loin.surPlace, 2);
  assert.equal(M.calendrier('freljord', { region: 'ionia', lieu: 'Tuula', duree: 4 }).possible, false);
  // Toutes les missions du catalogue tiennent en 48 h depuis leur région
  for (const m of require('../../catalogue/missions/missions.json')) {
    const c = M.calendrier(m.region, m);
    assert.ok(c.possible && c.total <= 48, `${m.id} : ${c.total} h`);
    assert.ok(m.lieu in M.TRAJETS[m.region], `${m.id} : pas de trajet pour ${m.lieu}`);
  }
});

test('repos : adapté à la durée, à la dureté, à l\'issue et aux blessures', () => {
  const court = M.reposApresMission({ total: 10 }), long = M.reposApresMission({ total: 40 });
  const risque = M.reposApresMission({ total: 40, risque: true }), rate = M.reposApresMission({ total: 40, issue: 'echec' });
  const blesse = M.reposApresMission({ total: 40, blessure: 'grave' });
  assert.ok(court < long && long < risque && long < rate && rate < blesse, [court, long, risque, rate, blesse].join(' '));
  assert.ok(blesse <= 72); assert.equal(court % 2, 0);
});

test('gains : peu au départ, sauf quelques missions à risque mieux payées et plus dangereuses', () => {
  const L = require('../../catalogue/missions/missions.json').filter(m => m.palier === 'inconnue');
  const normales = L.filter(m => !m.risque), risquees = L.filter(m => m.risque);
  assert.ok(normales.every(m => m.recompenses.po <= 60));
  assert.ok(risquees.length >= 12 && risquees.length <= L.length * 0.1);
  assert.ok(risquees.every(m => m.recompenses.po >= 80));
  const R = require('../src/resolution');
  assert.ok(R.PARAMS.multRisque > 1);
});
