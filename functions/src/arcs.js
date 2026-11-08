'use strict';
const CATALOGUE = require('./chemins');
const MA = require('./maitre');
/*
 * Guild Legends — arcs de la vie de guilde (8 nov. 2026).
 * Un arc est une petite histoire entre deux héros, sur plusieurs jours : une rivalité qui monte jusqu'au duel,
 * une amitié qui naît, une brouille… Il démarre quand la relation s'y prête, avance par étapes espacées
 * d'au moins quelques heures, puis se conclut sur une issue qui dépend de la relation à ce moment-là.
 * Décision du 8 nov. 2026 : le maître de guilde observe, il n'intervient pas.
 */
const fs = require('node:fs');
const path = require('node:path');
const { verifie, lireCondition, lireEffet } = require('./scenes');

const PARAMS = {
  chanceDepart: 0.08,      // par créneau de jour, chance qu'un nouvel arc cherche ses héros
  arcsSimultanes: 2,       // arcs en cours au plus dans une guilde
  chanceAvancer: 0.35,     // une étape due n'arrive pas forcément au premier créneau possible
  delaiRejouer: 24 * 21,   // heures avant qu'un même arc puisse revenir pour la même paire
  delaiMemeArc: 24 * 5,    // heures avant qu'un même arc revienne dans la guilde, quelle que soit la paire
};

function chargerArcs(fichier = path.join(CATALOGUE, 'vie/arcs/arcs.json')) {
  const brut = JSON.parse(fs.readFileSync(fichier, 'utf8')).arcs;
  return brut.map(a => ({
    ...a,
    declenche: a.declenche.map(lireCondition),
    etapes: a.etapes.map(e => ({ ...e, conditions: (e.conditions || []).map(lireCondition), effets: e.effets.map(lireEffet) })),
    issues: a.issues.map(i => ({ ...i, conditions: i.conditions.map(lireCondition), effets: i.effets.map(lireEffet) })),
  }));
}

const choisir = (l, rng) => l[Math.floor(rng() * l.length) % l.length];
const remplir = (t, ctx) => t.replace(/\{([ab])\}/g, (_, k) => ctx[k].nom);

/* Fait vivre les arcs d'une guilde pendant un créneau. outils : { relation, souvenir, borne } fournis par le moteur. */
function vivreArcs(g, arcs, rng, outils) {
  g.arcs ||= { enCours: [], fini: [] };
  const present = id => g.heros.find(h => h.id === id && h.etat === 'present');
  const ctxDe = (x) => { const a = g.heros.find(h => h.id === x.a), b = g.heros.find(h => h.id === x.b); return { a, b, relation: outils.relation(g, a, b) }; };
  const ecrire = (x, def, texte, importance, etape) => g.chronique.push({ t: g.t, declencheur: 'arc', arc: def.id, titreArc: def.titre, etape, scene: `${def.id}#${etape}`, importance, heros: [x.a, x.b], lieu: null, texte: MA.accorder(g, texte) });
  const appliquer = (effets, ctx) => { for (const e of effets) {
    if (e.type === 'aff') ctx.relation.aff = outils.borne(ctx.relation.aff + e.valeur, -100, 100);
    if (e.type === 'moral') outils.souvenir(ctx[e.qui], g.t, e.valeur, e.libelle || 'Un moment marquant', 36);
    if (e.type === 'po') g.po += e.valeur; } };

  // Abandon : un des deux n'est plus dans la guilde
  g.arcs.enCours = g.arcs.enCours.filter(x => [x.a, x.b].every(id => { const h = g.heros.find(y => y.id === id); return h && h.etat !== 'parti' && h.etat !== 'mort'; }));

  // Avancer les arcs en cours
  for (const x of [...g.arcs.enCours]) {
    const def = arcs.find(a => a.id === x.id);
    if (!present(x.a) || !present(x.b)) continue;
    const ctx = ctxDe(x);
    if (x.etape < def.etapes.length) {
      const e = def.etapes[x.etape];
      if (g.t - x.derniere < e.delai || !e.conditions.every(c => verifie(c, ctx)) || rng() > PARAMS.chanceAvancer) continue;
      ecrire(x, def, remplir(choisir(e.textes, rng), ctx), x.etape === def.etapes.length - 1 ? 3 : 2, x.etape);
      appliquer(e.effets, ctx); x.etape++; x.derniere = g.t;
    } else {
      if (g.t - x.derniere < 6) continue;
      const issue = def.issues.find(i => i.conditions.every(c => verifie(c, ctx))) || def.issues[def.issues.length - 1];
      ecrire(x, def, remplir(choisir(issue.textes, rng), ctx), 3, 'fin');
      appliquer(issue.effets, ctx);
      if (issue.type !== undefined && issue.type !== null) ctx.relation.type = issue.type;
      g.arcs.enCours.splice(g.arcs.enCours.indexOf(x), 1);
      g.arcs.fini.push({ id: x.id, a: x.a, b: x.b, t: g.t, issue: def.issues.indexOf(issue) });
    }
  }

  // Démarrer un nouvel arc
  if (g.arcs.enCours.length >= PARAMS.arcsSimultanes || rng() > PARAMS.chanceDepart) return;
  const occupes = new Set(g.arcs.enCours.flatMap(x => [x.a, x.b]));
  const libres = g.heros.filter(h => h.etat === 'present' && !occupes.has(h.id));
  const candidats = [];
  for (const a of libres) for (const b of libres) if (a !== b) {
    const ctx = { a, b, relation: outils.relation(g, a, b) };
    for (const def of arcs) {
      if (g.arcs.enCours.some(x => x.id === def.id) || g.arcs.fini.some(f => f.id === def.id && g.t - f.t < PARAMS.delaiMemeArc)) continue;
      if (g.arcs.fini.some(f => f.id === def.id && ((f.a === a.id && f.b === b.id) || (f.a === b.id && f.b === a.id)) && g.t - f.t < PARAMS.delaiRejouer)) continue;
      if (def.declenche.every(c => verifie(c, ctx))) candidats.push({ def, a, b });
    }
  }
  if (!candidats.length) return;
  // Les arcs écrits pour un duo célèbre passent devant les arcs génériques : ce sont eux qu'on attend.
  const poidsArc = c => (c.def.declenche.some(x => x.type === 'champion') ? 6 : 1);
  let x0 = rng() * candidats.reduce((t, c) => t + poidsArc(c), 0), pick = candidats[0];
  for (const c of candidats) { x0 -= poidsArc(c); if (x0 <= 0) { pick = c; break; } }
  const { def, a, b } = pick;
  const x = { id: def.id, a: a.id, b: b.id, etape: 0, debut: g.t, derniere: g.t - 1e6 };
  g.arcs.enCours.push(x);
}

module.exports = { PARAMS, chargerArcs, vivreArcs };
