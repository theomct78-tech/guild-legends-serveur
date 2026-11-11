'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/monde'), RG = require('../src/rangs');

const T0 = Date.UTC(2026, 10, 2, 0) / 3600000;   // lundi 2 novembre 2026, minuit UTC

/* Un joueur simple : recrute, répond, construit, place ses héros sur les contrats à sa portée. */
function jouer(monde, gid) {
  const g = monde.guildes[gid];
  for (const c of [...g.candidatures]) { try { W.recruter(monde, gid, c.cle); } catch { break; } }
  for (const c of g.cartes.filter(x => x.etat === 'ouverte')) { try { W.repondreCarte(monde, gid, c.id, c.type === 'quete' ? 'accepter' : c.options[0].id); } catch {} }
  // Pour chaque contrat : le meilleur héros libre à chaque poste vide, et on n'envoie l'équipe que si elle a ses chances.
  const M = require('../src/missions');
  for (const c of W.contratsPour(monde, gid).sort((a, b) => b.mission.po - a.mission.po)) {
    const pris = new Set(), ajouts = [];
    c.m.postes.forEach((p, i) => { if (p.heros) return;
      const h = g.heros.filter(x => W.disponible(g, x) && !pris.has(x.id) && M.efficacitePoste(x, p.type) >= 0.5)
        .sort((x, y) => RG.indice(RG.rangHeros(W.statsDe(y), p.type)) - RG.indice(RG.rangHeros(W.statsDe(x), p.type)))[0];
      if (h) { pris.add(h.id); ajouts.push({ index: i, gid, heroId: h.id }); } });
    if (!ajouts.length || W.chanceContrat(monde, c.id, ajouts) < 50) continue;
    for (const a of ajouts) { try { W.placer(monde, gid, c.id, a.index, a.heroId); } catch {} }
  }
  for (const u of [...(g.inventaire || [])]) for (const h of g.heros) { try { W.equiper(monde, gid, h.id, u.uid); break; } catch {} }
}

test('monde : trois guildes jouent un mois ensemble, de bout en bout', { timeout: 300000 }, () => {
  const monde = W.creerMonde(T0);
  W.fonderGuilde(monde, { id: 'lanternes', nom: 'les Lanternes', region: 'demacia', chien: 'Gamelle' });
  W.fonderGuilde(monde, { id: 'corbeaux', nom: 'les Corbeaux', region: 'noxus' });
  W.fonderGuilde(monde, { id: 'meute', nom: 'la Meute', region: 'freljord', maitre: { titre: 'maîtresse' } });
  for (const g of Object.values(monde.guildes)) assert.equal(g.candidatures.length, 3);
  W.inscrireTournoi;   // présent
  const jours = 31;
  for (let h = 0; h < jours * 24; h += 2) {
    W.avancer(monde, monde.t + 2);
    if (h % 8 === 0) for (const gid of Object.keys(monde.guildes)) jouer(monde, gid);
    if (h === 24 * 3) for (const [gid, g] of Object.entries(monde.guildes)) { const ids = g.heros.filter(x => x.etat !== 'parti').slice(0, 3).map(x => x.id); if (ids.length === 3) W.inscrireTournoi(monde, gid, ids); }
  }
  const gs = Object.values(monde.guildes);
  for (const g of gs) {
    assert.ok(g.heros.length >= 3, `${g.nom} a recruté`);
    assert.ok(g.rapports.length >= 1, `${g.nom} : ${g.rapports.length} rapports de mission`);
    assert.ok(g.rapports.every(r => r.paragraphes.length >= 3 && !r.paragraphes.join(' ').includes('{')));
    assert.ok((g.niveau || 1) >= 2, `${g.nom} niveau ${g.niveau}`);
    assert.ok(g.avis.some(a => a.type === 'paie'), 'salaires payés');
  }
  assert.ok(monde.tournois.historique.length >= 1, 'le tournoi du premier samedi a eu lieu');
  assert.ok(Object.keys(monde.territoires.detenteurs).length >= 1, 'au moins une région tenue');
  const issues = gs.flatMap(g => g.rapports.map(r => r.issue));
  assert.ok(issues.length >= 12, `${issues.length} missions en un mois`);
  console.log('# issues', JSON.stringify(issues.reduce((o, i) => (o[i] = (o[i] || 0) + 1, o), {})));
  assert.ok(issues.filter(i => i === 'reussite' || i === 'eclatante').length / issues.length > 0.4, 'des réussites');
  // L'état reste sérialisable et de taille raisonnable pour une base de données
  const taille = JSON.stringify(monde).length;
  for (const g of gs) assert.ok(JSON.stringify(g).length < 900000, `${g.nom} : ${JSON.stringify(g).length} octets`);
  console.log('# monde', JSON.stringify({ taille, guildes: gs.map(g => ({ n: g.nom, niv: g.niveau, po: g.po, heros: g.heros.length, rapports: g.rapports.length, inventaire: g.inventaire.length, salles: g.salles })), tournoi: monde.tournois.historique[0]?.classement, territoires: monde.territoires.detenteurs }));
});

test('monde : un meilleur rang reprend un poste tenu sous le rang du contrat, la guilde évincée est prévenue', () => {
  const M = require('../src/missions'), C = W.catalogues();
  const monde = W.creerMonde(T0 + 1);
  const a = W.fonderGuilde(monde, { id: 'a', nom: 'les Lanternes', region: 'demacia' }), b = W.fonderGuilde(monde, { id: 'b', nom: 'les Corbeaux', region: 'demacia' });
  // Deux supports : une recrue modeste chez A, une héroïne accomplie chez B (toute son expérience).
  const faible = C.fiches.find(f => f.role === 'Support' && f.potentiel === 'B+'), forte = C.fiches.find(f => f.role === 'Support' && f.potentiel === 'S+');
  const ha = W.nouveauHeros(`${faible.champion}|${faible.skin}`, monde.t), hb = W.nouveauHeros(`${forte.champion}|${forte.skin}`, monde.t);
  a.heros.push({ ...ha, etat: 'present', besoins: {}, souvenirs: [], moral: 60, fidelite: 60 });
  hb.xp = Object.fromEntries(require('../src/progression').STATS.map(k => [k, 1e7]));
  b.heros.push({ ...hb, etat: 'present', besoins: {}, souvenirs: [], moral: 60, fidelite: 60 });
  const ep = [{ type: 'diplomatie', difficulte: 50, recit: 'convaincre' }, { type: 'diplomatie', difficulte: 52, recit: 'conclure' }];
  const mission = { id: 'TEST-1', titre: 'Le contrat disputé', region: 'demacia', lieu: 'Zeffira', duree: 6, postes: ['Support'], epreuves: ep, po: 100, rep: 3, recompenses: { po: 100, reputation: 3, objets: [] }, denouements: { eclatante: 'x', reussite: 'x', partielle: 'x', echec: 'x' } };
  monde.contrats.K = { id: 'K', mission, m: M.creerMission({ id: 'K', titre: mission.titre, source: 'institution', region: 'demacia', lieu: 'Zeffira', depart: (monde.t + 12) * 3600000, duree: 6, postes: ['Support'], epreuves: ep, guildesProposees: ['a', 'b'] }), publie: monde.t, depart: monde.t + 12, statut: 'ouvert' };
  const r1 = W.placer(monde, 'a', 'K', 0, ha.id);
  assert.ok(RG.indice(r1.rang) < RG.indice(r1.rangContrat), `la recrue (${r1.rang}) est sous le rang du contrat (${r1.rangContrat})`);
  const r2 = W.placer(monde, 'b', 'K', 0, hb.id);
  assert.equal(r2.evince.guilde, 'a');
  assert.equal(monde.contrats.K.m.postes[0].heros.id, hb.id);
  assert.equal(a.heros.find(h => h.id === ha.id).reserve, null);
  assert.match(a.avis[0].texte, /meilleur rang/);
  // La recrue ne peut pas reprendre la place : l'héroïne a le rang du contrat.
  assert.throws(() => W.placer(monde, 'a', 'K', 0, ha.id), /déjà tenu/);
});
