'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/vie');
const S = require('../src/scenes');
const base = require('../../catalogue/personnalites/personnalites.json');
const fiches = require('../../catalogue/fiches.json');

const SOLO = ['entrainement', 'repos', 'lecture', 'ville', 'solitude', 'recueillement', 'soins', 'discussion', 'jeux', 'nuit', 'retour_conges', 'absent_soiree', 'depart_conges', 'fugue', 'recit_mission', 'arrivee'];
const DUO = ['evite', 'premiere_rencontre', 'reconnaissance', 'bon_moment', 'confidence', 'desaccord', 'dispute', 'reconciliation', 'entrainement_duo', 'defi', 'lecon', 'jeu', 'soiree'];
const TRIO = ['mediation'];
const scenes = S.chargerScenes();

function heros(champion, extra = {}) {
  const p = base[champion];
  return { id: champion, nom: champion, champion, univers: 'classic', niveau: 5, salaire: 10, attente: 10, axes: p.axes, traits: p.traits, motivation: p.motivation, regions: p.regions, ...extra };
}
const liens = Object.fromEntries(Object.entries(base).map(([c, p]) => [c, p.liens]));
const T0 = Date.UTC(2026, 10, 9, 7) / 3600000; // lundi 9 nov. 2026, 8 h à Paris
function guilde(noms = ['Garen', 'Lux', 'Katarina', 'Draven', 'Jinx', 'Vi', 'Braum', 'Ahri', 'Teemo']) {
  return V.creerGuilde({ id: 'test', niveau: 10, or: 500, t: T0, heros: noms.map(n => heros(n)), liens });
}

test('catalogue de scènes : identifiants uniques, déclencheurs connus, noms cohérents avec le déclencheur', () => {
  const ids = new Set();
  const champions = new Set(fiches.map(f => f.champion));
  for (const s of scenes) {
    assert.ok(!ids.has(s.id), `doublon ${s.id}`); ids.add(s.id);
    assert.ok([...SOLO, ...DUO, ...TRIO].includes(s.declencheur), `${s.id} : déclencheur inconnu ${s.declencheur}`);
    for (const v of s.variantes) {
      const nomme = q => new RegExp(`\\{${q}(:[a-z_]+)?\\}|\\{(mission|lieu_mission):${q}\\}`).test(v);
      assert.ok(nomme('a'), `${s.id} : {a} absent`);
      if (SOLO.includes(s.declencheur)) assert.ok(!nomme('b') && !nomme('c'), `${s.id} : scène solo qui nomme un second héros`);
      if (DUO.includes(s.declencheur)) assert.ok(nomme('b') && !nomme('c'), `${s.id} : il faut {a} et {b}`);
      if (TRIO.includes(s.declencheur)) assert.ok(nomme('c'), `${s.id} : il faut {c}`);
      for (const [, q, sit] of v.matchAll(/\{([abc]):([a-z_]+)\}/g)) assert.ok(['salut', 'taquine', 'console', 'vante', 'plainte', 'merci', 'accueil', 'colere', 'rire', 'excuse'].includes(sit), `${s.id} : situation de réplique inconnue ${sit}`);
    }
    for (const c of s.conditions) if (c.type === 'champion') assert.ok(champions.has(c.valeur), `${s.id} : champion inconnu ${c.valeur}`);
  }
});

test('catalogue de scènes : chaque déclencheur a au moins une scène sans condition', () => {
  for (const d of [...SOLO, ...DUO, ...TRIO]) assert.ok(scenes.some(s => s.declencheur === d && !s.conditions.length), `aucune scène générique pour ${d}`);
});

test('catalogue de scènes : les couples canoniques existent dans la base des personnalités', () => {
  for (const s of scenes) {
    const ch = s.conditions.filter(c => c.type === 'champion'), lien = s.conditions.find(c => c.type === 'lien');
    if (!lien || lien.valeur === 'aucun' || ch.length < 2) continue;
    const [a, b] = ['a', 'b'].map(q => ch.find(c => c.qui === q).valeur);
    const ok = (base[a]?.liens || []).some(l => l.champion === b && l.type === lien.valeur) || (base[b]?.liens || []).some(l => l.champion === a && (l.type === lien.valeur || { mentor: 'eleve', eleve: 'mentor' }[l.type] === lien.valeur));
    assert.ok(ok, `${s.id} : ${a} et ${b} n'ont pas de lien ${lien.valeur}`);
  }
});

test('catalogue de scènes : pas d\'accord de genre sur un héros quelconque', () => {
  // Une scène réservée à un champion précis peut accorder ; une scène générique non.
  const suspect = /\{[abc]\} (est|reste|semble|paraît|devient|a l'air) [a-zàâéèêëîïôûç]+(é|ée|és|ées|eux|euse|if|ive|ien|ienne)(?![a-zàâéèêëîïôûç])|\b(il|elle)s? (est|a|reste|ne)\b/;
  for (const s of scenes) {
    const specifique = s.conditions.some(c => c.type === 'champion');
    if (specifique) continue;
    for (const v of s.variantes) assert.ok(!suspect.test(v.replace(/\bil (y a|faut|reste du|n'y a|a fallu|a été impossible)\b/g, '')), `${s.id} : accord ou pronom genré suspect : « ${v} »`);
  }
});

test('les liens du champion valent entre héros du même univers, pas entre univers différents', () => {
  const g = V.creerGuilde({ id: 'u', t: T0, liens, heros: [heros('Garen'), heros('Lux'), heros('Jinx', { id: 'Jinx SG', univers: 'Star Guardian' }), heros('Vi')] });
  assert.equal(V.relation(g, g.heros[0], g.heros[1]).type, 'famille');
  assert.ok(V.relation(g, g.heros[0], g.heros[1]).aff >= 50);
  const r = V.relation(g, g.heros[2], g.heros[3]);
  assert.equal(r.type, null);
  assert.equal(r.reconnaissance, true);
});

test('la simulation est déterministe : rejouer donne la même chronique', () => {
  const a = guilde(), b = guilde();
  V.simuler(a, T0 + 48, scenes); V.simuler(b, T0 + 48, scenes);
  assert.deepStrictEqual(a.chronique.map(e => e.texte), b.chronique.map(e => e.texte));
  assert.ok(a.chronique.length > 20);
});

test('la nuit, presque tout le monde dort', () => {
  const g = guilde();
  V.simuler(g, T0 + 18, scenes); // jusqu'à 2 h du matin
  V.simulerCreneau(g, scenes);
  const eveilles = g.heros.filter(h => h.activite !== 'dormir');
  assert.ok(eveilles.length <= 2, `${eveilles.length} héros debout la nuit`);
});

test('une scène ne revient pas dans la guilde avant cinq jours', () => {
  const g = guilde();
  V.simuler(g, T0 + 24 * 5, scenes);
  const vues = {};
  for (const e of g.chronique) {
    if (e.importance >= 3 || V.OBLIGATOIRES.includes(e.declencheur) || e.declencheur === 'fil') continue; // un moment majeur peut reprendre la scène la plus ancienne ; le fil a sa propre règle (un mois)
    if (vues[e.scene] != null) assert.ok(e.t - vues[e.scene] >= V.PARAMS.delaiReutilisationScene, `${e.scene} répétée`);
    vues[e.scene] = e.t;
  }
});

test('le moral s\'explique : chaque raison a un libellé et une valeur', () => {
  const g = guilde();
  const h = g.heros[0];
  V.souvenir(h, g.t, -10, 'Une mission ratée', 36);
  const r = V.raisonsMoral(g, h);
  assert.ok(r.some(x => x.libelle === 'Une mission ratée' && x.valeur === -10));
  assert.ok(r.every(x => typeof x.libelle === 'string' && Number.isFinite(x.valeur)));
});

test('soirée : chaque absent a une raison, et les héros en mission sont absents', () => {
  const g = guilde();
  V.departMission(g, ['Garen'], T0 + 10);
  const s = V.organiserSoiree(g, scenes, { organisateur: g.heros.find(h => h.id === 'Draven'), tournee: true });
  assert.equal(s.venus.length + s.absents.length, 9);
  assert.ok(s.absents.some(x => x.id === 'Garen' && x.raison === 'en mission'));
  assert.ok(s.absents.every(x => x.raison));
});

test('une demande de congés refusée à un héros libre et rebelle peut le faire partir quand même', () => {
  const g = V.creerGuilde({ id: 'c', t: T0, liens, heros: [heros('Jinx', { traits: ['LIBRE', 'REBELLE', 'IMPULSIF'] })] });
  const c = { id: 'C1', type: 'conges', t: T0, echeance: T0 + 12, etat: 'ouverte', heros: ['Jinx'], options: [], defaut: 'refuser' };
  g.cartes.push(c);
  const out = V.repondre(g, scenes, 'C1', 'refuser');
  assert.equal(g.heros[0].etat, 'conges');
  assert.ok(out.some(x => x.includes('sans prévenir')));
  assert.ok(g.chronique.some(e => e.declencheur === 'fugue'));
});

test('une demande sans réponse prend sa réponse par défaut à l\'échéance', () => {
  const g = guilde();
  g.cartes.push({ id: 'C9', type: 'augmentation', t: T0, echeance: T0 + 2, etat: 'ouverte', heros: ['Draven'], options: [], defaut: 'refuser' });
  V.simuler(g, T0 + 4, scenes);
  const c = g.cartes.find(x => x.id === 'C9');
  assert.equal(c.etat, 'traitee'); assert.equal(c.parDefaut, true);
});

test('la mort d\'un proche pèse lourd et longtemps', () => {
  const g = guilde();
  V.departMission(g, ['Garen'], T0 + 10);
  V.retourMission(g, ['Garen'], 'echec', { morts: ['Garen'] });
  const lux = g.heros.find(h => h.id === 'Lux');
  const r = V.raisonsMoral(g, lux).find(x => x.libelle === 'La mort de Garen');
  assert.ok(r && r.valeur <= -20);
});

const A = require('../src/arcs');
const arcs = A.chargerArcs();

test('arcs : textes à deux héros, sans accord de genre, et issues complètes', () => {
  const suspect = /\{[ab]\} (est|reste|semble|devient) [a-zàâéèêëîïôûç]+(é|ée|és|ées|eux|euse)(?![a-zàâéèêëîïôûç])|\b(il|elle)s? (est|a|reste|ne)\b|…/;
  for (const a of arcs) {
    assert.ok(a.etapes.length >= 2 && a.issues.length >= 2, `${a.id} : trop court`);
    assert.equal(a.issues[a.issues.length - 1].conditions.length, 0, `${a.id} : la dernière issue doit toujours être possible`);
    for (const t of [...a.etapes.flatMap(e => e.textes), ...a.issues.flatMap(i => i.textes)]) {
      assert.ok(t.includes('{a}') && t.includes('{b}'), `${a.id} : il faut {a} et {b} : ${t}`);
      if (!a.declenche.some(c => c.type === 'champion')) assert.ok(!suspect.test(t.replace(/\bil (y a|faut|reste)\b/g, '')), `${a.id} : genre suspect : ${t}`);
    }
  }
});

test('arcs : en deux semaines, des arcs démarrent, avancent et se concluent', () => {
  const g = guilde();
  for (let d = 1; d <= 14; d++) V.simuler(g, T0 + 24 * d, scenes, arcs);
  assert.ok(g.arcs.fini.length >= 1, 'aucun arc conclu');
  const entrees = g.chronique.filter(e => e.declencheur === 'arc');
  assert.ok(entrees.some(e => e.etape === 'fin'));
  // Les étapes d'un même arc sont dans l'ordre et espacées
  for (const f of g.arcs.fini) {
    const e = entrees.filter(x => x.arc === f.id && x.heros.includes(f.a) && x.heros.includes(f.b) && x.t <= f.t);
    for (let i = 1; i < e.length; i++) assert.ok(e[i].t > e[i - 1].t);
  }
});

const Q = require('../src/quetes');
const quetes = Q.chargerQuetes();
const M = require('../src/missions');

test('quêtes : chaque quête est complète, ses épreuves et ses régions existent', () => {
  const R = require('../src/resolution');
  const gammes = new Set(fiches.map(f => f.gamme).filter(Boolean));
  for (const q of Object.values(quetes)) {
    assert.ok(q.champion ? base[q.champion] : q.motivation ? true : gammes.has(q.gamme), `${q.id} : champion ou gamme inconnus`);
    for (const k of ['demande', 'eveil', 'fin', 'refus']) assert.ok(q[k] && q[k].length > 20, `${q.id} : ${k} manquant`);
    for (const e of q.etapes) {
      assert.ok(e.lieu && e.recit && e.reussite && e.echec && e.duree > 0, `${q.id} : étape incomplète`);
      for (const t of e.epreuves) assert.ok(R.EPREUVES[t], `${q.id} : épreuve inconnue ${t}`);
      if (!(q.motivation && e.region === '{pays}')) assert.ok(Number.isFinite(M.dureeTrajet('demacia', e.region)), `${q.id} : région inconnue ${e.region}`);
    }
  }
});

test('quêtes : la mission personnelle est calibrée sur le héros', () => {
  const R = require('../src/resolution');
  const stats = { Force: 60, Défense: 50, Magie: 20, 'Résistance magique': 40, Vitesse: 70, Précision: 65, Endurance: 55, Intelligence: 50, Leadership: 45 };
  const riven = { id: 'Riven', nom: 'Riven', role: 'Combattant', stats, moral: 60 };
  const m = Q.missionDeQuete(quetes.Riven, 0, riven);
  assert.equal(m.postes.length, 1);
  const c = R.chanceMission([{ nom: 'Riven', stats, moral: 60 }], m);
  assert.ok(c >= 55 && c <= 75, `chance ${c}`);
});

test('quêtes : éveil, demande, deux étapes et fin rapportent moral et fidélité', () => {
  const g = V.creerGuilde({ id: 'q', t: T0, liens, seConnaissent: true, heros: [heros('Riven'), heros('Garen'), heros('Lux')] });
  for (const h of g.heros) h.fidelite = 70;
  let carte = null;
  for (let t = 2; t <= 24 * 30 && !carte; t += 2) { V.simuler(g, T0 + t, scenes, null, quetes); carte = g.cartes.find(c => c.type === 'quete' && c.etat === 'ouverte'); }
  assert.ok(carte, 'aucune quête éveillée en un mois');
  const id = carte.heros[0], h = g.heros.find(x => x.id === id);
  V.repondre(g, scenes, carte.id, 'accepter');
  assert.equal(g.quetes[id].etat, 'ouverte');
  const f0 = h.fidelite;
  V.finMissionQuete(g, id, 'reussite');
  assert.equal(V.finMissionQuete(g, id, 'eclatante'), 'accomplie');
  assert.ok(h.fidelite >= Math.min(100, f0 + 20));
  assert.ok(V.raisonsMoral(g, h).some(r => r.libelle.startsWith('Sa quête accomplie') && r.valeur >= 14));
  assert.ok(g.chronique.some(e => e.scene && e.scene.endsWith('#fin')));
});

test('quêtes : deux échecs suspendent la quête, une issue partielle permet de réessayer', () => {
  const g = V.creerGuilde({ id: 'q2', t: T0, liens, heros: [heros('Jinx')] });
  V.enregistrerQuetes(quetes);
  g.quetes = { Jinx: { id: 'QUE-JINX', etat: 'ouverte', etape: 0, tentatives: 0 } };
  assert.equal(V.finMissionQuete(g, 'Jinx', 'partielle'), 'ouverte');
  assert.equal(V.finMissionQuete(g, 'Jinx', 'echec'), 'ouverte');
  assert.equal(V.finMissionQuete(g, 'Jinx', 'echec'), 'attente');
});

test('quêtes de gamme : texte sans accord de genre, et un héros de gamme reçoit la quête de sa gamme', () => {
  const suspect = /\{nom\} (est|reste|semble|devient) [a-zàâéèêëîïôûç]+(é|ée|és|ées|eux|euse)(?![a-zàâéèêëîïôûç])|\b(il|elle)s? (est|a|reste|ne)\b|…/;
  for (const q of Object.values(quetes).filter(q => q.gamme)) {
    for (const k of ['demande', 'eveil', 'fin', 'refus']) assert.ok(!suspect.test(q[k].replace(/\bil (y a|faut|reste)\b/g, '')), `${q.id} ${k} : ${q[k]}`);
    for (const e of q.etapes) for (const t of [e.reussite, e.echec]) assert.ok(!suspect.test(t.replace(/\bil (y a|faut|reste)\b/g, '')), `${q.id} : ${t}`);
  }
  assert.equal(Q.queteDe(quetes, { univers: 'Star Guardian', champion: 'Ahri' }).id, 'QUG-STAR-GUARDIAN');
  assert.equal(Q.queteDe(quetes, { univers: 'classic', champion: 'Riven' }).id, 'QUE-RIVEN');
});

test('quêtes : un compagnon rend la mission plus sûre et rapproche les deux héros', () => {
  const R = require('../src/resolution');
  const st = v => ({ Force: v, Défense: v, Magie: v, 'Résistance magique': v, Vitesse: v, Précision: v, Endurance: v, Intelligence: v, Leadership: v });
  const riven = { id: 'Riven', nom: 'Riven', role: 'Combattant', stats: st(55), moral: 60 }, garen = { id: 'Garen', nom: 'Garen', role: 'Tank', stats: st(60), moral: 60 };
  const seul = Q.missionDeQuete(quetes.Riven, 0, riven), duo = Q.missionDeQuete(quetes.Riven, 0, riven, garen);
  assert.equal(duo.postes.length, 2);
  const c1 = R.chanceMission([riven], seul), c2 = R.chanceMission([riven, garen], duo, {}, { postes: duo.postes.map((p, i) => ({ type: p, heros: [riven, garen][i].id, efficacite: 1 })) });
  assert.ok(c2 >= c1, `${c2} < ${c1}`);
  const g = V.creerGuilde({ id: 'qc', t: T0, liens, heros: [heros('Riven'), heros('Garen'), heros('Jinx')] });
  V.enregistrerQuetes(quetes);
  g.quetes = { Riven: { id: 'QUE-RIVEN', etat: 'ouverte', etape: 0, tentatives: 0 } };
  const a0 = V.relation(g, g.heros[0], g.heros[1]).aff;
  V.finMissionQuete(g, 'Riven', 'reussite', 'Garen');
  assert.ok(V.relation(g, g.heros[0], g.heros[1]).aff >= a0 + 8);
  assert.ok(g.chronique.some(e => e.scene === 'QUE-RIVEN#compagnon'));
  V.relation(g, g.heros[0], g.heros[2]).aff = -20;
  assert.equal(Q.peutAccompagner(g, g.heros[0], g.heros[2], V.relation).ok, false);
});

test('répliques : chaque registre couvre les demandes au maître, et les voix communes ne s\'accordent pas', () => {
  const sits = ['plaide', 'demande_conges', 'demande_augmentation', 'demande_soiree', 'depart'];
  const toutes = [...sits, 'salut', 'taquine', 'console', 'vante', 'plainte', 'merci', 'accueil', 'colere', 'rire', 'excuse',
    // Les voix du fil de la guilde, des stories et du courrier (11 nov. 2026)
    'bande', 'fil_depart', 'fil_retour_bon', 'fil_retour_mauvais', 'fil_blesse', 'fil_ennui', 'fil_maitre', 'fil_pique', 'fil_quotidien', 'story', 'correspondant'];
  const suspect = /\b(je suis|suis) [a-zàâéèêëîïôûç]+(é|ée|eux|euse)(?![a-zàâéèêëîïôûç])|…/;
  for (const r of ['noble', 'rue', 'sage', 'brut', 'joyeux', 'sombre', 'singulier']) for (const s of sits) {
    const l = scenes.repliques[`registre:${r}`]?.[s];
    assert.ok(l && l.length, `registre ${r} sans réplique « ${s} »`);
    for (const x of l) assert.ok(!suspect.test(x), `${r}/${s} : ${x}`);
  }
  for (const [qui, sit] of Object.entries(scenes.repliques)) if (!qui.startsWith('registre:')) for (const s of Object.keys(sit)) assert.ok(toutes.includes(s), `${qui} : situation inconnue ${s}`);
});

test('immersion : les scènes rappellent la dernière mission, parlent avec la voix des héros et nomment le chien', () => {
  const g = guilde(['Garen', 'Jinx', 'Vi', 'Lux']);
  V.departMission(g, ['Garen', 'Vi'], T0 + 2);
  V.simuler(g, T0 + 2, scenes);
  V.retourMission(g, ['Garen', 'Vi'], 'reussite', { blesses: ['Vi'], mission: { titre: 'Le camp de Vaskasia', lieu: 'Vaskasia' } });
  for (let t = 4; t <= 72; t += 2) V.simuler(g, T0 + t, scenes);
  const textes = g.chronique.map(e => e.texte).join('\n');
  assert.ok(/Vaskasia/.test(textes), 'aucune scène ne rappelle la mission');
  assert.ok(!/\{[a-z_:]+\}/.test(textes), 'un jeton n\'a pas été remplacé');
  assert.ok(textes.includes(g.monde.chien) || textes.includes(g.monde.bourg), 'ni le chien ni le bourg n\'apparaissent');
});

test('cohérence : une scène ou une réplique propre à un champion ne s\'applique pas à un skin d\'un autre univers', () => {
  const lux = { ...heros('Lux'), univers: 'Star Guardian' };
  const sc = scenes.find(s => s.id === 'VIE-0035');
  assert.ok(!sc.conditions.every(c => S.verifie(c, { a: lux })));
  assert.ok(sc.conditions.every(c => S.verifie(c, { a: heros('Lux') })));
});

const P = require('../src/progression');
test('fiche au combat : stats actuelles, jamais le plafond, potentiel révélé seulement à l\'approche', () => {
  const plafonds = { Force: 65, Défense: 59, Magie: 47, 'Résistance magique': 59, Vitesse: 53, Précision: 53, Endurance: 59, Intelligence: 47, Leadership: 59 };
  const st = P.statsDeDepart('Garen|Classic', plafonds);
  for (const s of P.STATS) assert.ok(st[s] < plafonds[s] && st[s] >= Math.round(plafonds[s] * 0.7));
  const f = P.ficheCombat({ stats: st, moral: 60 }, plafonds, 'A-');
  assert.ok(!JSON.stringify(f).includes('plafond') && !('plafond' in f.stats[0]));
  assert.equal(f.potentiel.revele, false);
  assert.ok(f.stats.every(s => s.etat === null));
  const pres = Object.fromEntries(P.STATS.map(s => [s, Math.round(plafonds[s] * 0.95)]));
  const g = P.ficheCombat({ stats: pres, moral: 60 }, plafonds, 'A-');
  assert.equal(g.potentiel.revele, true); assert.equal(g.potentiel.palier, 'A');
  assert.ok(g.stats.every(s => s.etat === 'proche'));
  assert.equal(f.epreuves.length, 7);
});

const PR = require('../src/presentations');
test('présentations et lexique : un champion, une ligne ; les termes se repèrent sans chevauchement', () => {
  const p = PR.chargerPresentations(), lx = PR.chargerLexique();
  assert.equal(Object.keys(p).length, Object.keys(base).length);
  for (const [c, t] of Object.entries(p)) assert.ok(t.length > 40 && t.length < 260, `${c} : ${t.length} caractères`);
  const termes = new Set();
  for (const e of lx) { assert.ok(!termes.has(e.terme), `doublon ${e.terme}`); termes.add(e.terme); assert.ok(e.definition.length > 30); }
  const r = PR.reperer('Vi rentre du Placidium de Navori, puis file à Zaun, puis encore à Zaun.', lx);
  assert.deepStrictEqual(r.map(x => x.terme), ['Placidium de Navori', 'Zaun']);
});

test('le chien du repère : nommé par le joueur, renommable, nom contrôlé', () => {
  const g = V.creerGuilde({ id: 'chien', t: T0, heros: [], chien: 'Saucisse' });
  assert.equal(g.monde.chien, 'Saucisse');
  assert.equal(V.nommerChien(g, '  croc-blanc '), 'Croc-blanc');
  assert.match(g.chronique.at(-1).texte, /Croc-blanc/);
  assert.throws(() => V.nommerChien(g, ''));
  assert.throws(() => V.nommerChien(g, '<script>'));
  assert.throws(() => V.nommerChien(g, 'x'.repeat(21)));
  assert.ok(V.CHIENS.includes(V.creerGuilde({ id: 'autre', t: T0, heros: [] }).monde.chien));
});

test('grand voyage : une étape de quête trop lointaine devient un voyage de plusieurs jours, avec des lettres', () => {
  const Q = require('../src/quetes');
  const quetes = Q.chargerQuetes(), def = quetes.Yasuo;
  const g = V.creerGuilde({ id: 'voy', region: 'demacia', t: T0, heros: [heros('Yasuo')], chien: 'Pilou' });
  const h = g.heros[0]; h.stats = Object.fromEntries(['Force', 'Défense', 'Magie', 'Résistance magique', 'Vitesse', 'Précision', 'Endurance', 'Intelligence', 'Leadership'].map(k => [k, 50]));
  const m = Q.missionDeQuete(def, 0, h, null, 'demacia');
  assert.equal(m.mode, 'voyage'); assert.ok(m.calendrier.total > 48);
  assert.equal(Q.missionDeQuete(quetes.Garen, 0, h, null, 'demacia').mode, 'mission');
  V.partirEnVoyage(g, ['Yasuo'], m, def.id);
  assert.equal(h.etat, 'voyage');
  V.simuler(g, T0 + m.calendrier.total + 2, null);
  const lettres = g.chronique.filter(e => e.declencheur === 'voyage').map(e => e.scene);
  assert.deepEqual(lettres, ['voyage#depart', 'voyage#route', 'voyage#arrivee', 'voyage#retour']);
  assert.match(g.chronique.find(e => e.scene === 'voyage#depart').texte, /Yasuo/);
  assert.equal(h.etat, 'present'); assert.ok(h.reposJusqua > g.t - 2);
  assert.deepEqual(g.voyagesARegler, [{ mission: m.id, heros: ['Yasuo'] }]);
  for (const e of g.chronique.filter(e => e.declencheur === 'voyage')) assert.doesNotMatch(e.texte, /\{/);
});
