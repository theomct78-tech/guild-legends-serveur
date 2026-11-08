'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — les billets des héros au maître (8 nov. 2026, demande de Théo).
 * De temps à autre, un héros glisse un mot sous la porte du bureau : billet doux, farce, poème sans queue ni tête,
 * lettre triste ou pensive, ou message dans une langue que personne ne lit. Tout dépend des héros de la guilde.
 *
 * Garde-fous :
 * - les billets doux ne viennent que de quelques adultes choisis pour qui le flirt est un jeu cohérent avec leur
 *   personnage (liste du catalogue), jamais d'une gamme d'adolescents, jamais explicites, et le joueur peut les couper ;
 * - il faut qu'un héros estime assez le maître pour lui écrire (et davantage pour flirter) ;
 * - c'est rare : en moyenne un billet par semaine pour toute la guilde, et jamais deux du même héros en deux semaines.
 */
const fs = require('node:fs');
const path = require('node:path');

const PARAMS = {
  chanceParJour: 0.15, ecartGuilde: 72, ecartHeros: 24 * 14, joursAvant: 5,
  estimeMin: 45, estimeDoux: 58,
};
// Gammes dont les héros sont des adolescents ou des enfants : jamais de billet doux
const GAMMES_JEUNES = ['Star Guardian', 'Battle Academia', 'Pajama Guardian', 'Little Legends', 'Snow Day', 'Battle Bunny Academy'];
const GENRES = ['doux', 'clown', 'poeme', 'triste', 'pensif', 'langue'];

function chargerBillets(dossier = path.join(CATALOGUE, 'vie/billets')) {
  const out = [];
  for (const f of fs.readdirSync(dossier).filter(n => n.endsWith('.txt')).sort())
    for (const l of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue;
      const [cle, genre, texte, traduction] = l.split('|');
      if (!GENRES.includes(genre)) throw new Error(`Billet : genre inconnu ${genre}`);
      out.push({ cle, genre, texte, traduction: traduction || null, id: `${cle}#${out.filter(b => b.cle === cle).length}` });
    }
  return out;
}

/* Les billets qu'un héros pourrait écrire. */
function possibles(billets, h, g) {
  const champion = (h.champion || '').replace(/[^A-Za-z]/g, '');
  const jeune = GAMMES_JEUNES.some(x => String(h.univers || '').includes(x));
  const doux = g.maitre?.billetsDoux !== false && !jeune;
  return billets.filter(b => {
    if (b.genre === 'doux' && !doux) return false;
    if (b.cle.startsWith('@')) return b.genre !== 'doux' && (h.traits || []).includes(b.cle.slice(1));
    return b.cle === champion;
  });
}

const TITRE = g => g.maitre?.titre === 'maîtresse' ? 'maîtresse' : 'maître';
function remplir(t, g, h, autre, traducteur) {
  const f = TITRE(g) === 'maîtresse';
  return t.replace(/\{le_maitre\}/g, f ? 'la maîtresse' : 'le maître').replace(/\{MAITRE\}/g, f ? 'MAÎTRESSE' : 'MAÎTRE').replace(/\{Maitre\}/g, f ? 'Maîtresse' : 'Maître').replace(/\{maitre\}/g, TITRE(g))
    .replace(/\{Cher\}/g, f ? 'Chère' : 'Cher').replace(/\{cher\}/g, f ? 'chère' : 'cher').replace(/\{e\}/g, f ? 'e' : '')
    .replace(/\{chien\}/g, g.monde?.chien || 'le chien').replace(/\{bourg\}/g, g.monde?.bourg || 'le bourg').replace(/\{guilde\}/g, g.nom || 'la guilde')
    .replace(/\{autre\}/g, autre?.nom || 'quelqu\'un').replace(/\{nom\}/g, h.nom).replace(/\{traducteur\}/g, traducteur?.nom || 'quelqu\'un');
}

/* Une fois par jour : peut-être un billet. outils : { estime(g, h) → nombre, creerCarte(g, type, heros) }. */
function envoyerBillets(g, billets, rng, outils) {
  if (!billets?.length || rng() >= PARAMS.chanceParJour || g.t - (g.dernierBillet ?? -1e9) < PARAMS.ecartGuilde) return null;
  g.billetsVus ||= {};
  const presents = g.heros.filter(h => h.etat === 'present');
  const candidats = presents.filter(h => (g.t - (h.arrivee ?? g.t)) >= PARAMS.joursAvant * 24 && g.t - (h.dernierBillet ?? -1e9) >= PARAMS.ecartHeros && outils.estime(g, h) >= PARAMS.estimeMin)
    .map(h => ({ h, liste: possibles(billets, h, g).filter(b => !g.billetsVus[b.id] && (b.genre !== 'doux' || outils.estime(g, h) >= PARAMS.estimeDoux)) }))
    .filter(x => x.liste.length);
  if (!candidats.length) return null;
  const { h, liste } = candidats[Math.floor(rng() * candidats.length)];
  const b = liste[Math.floor(rng() * liste.length)];
  const autre = presents.filter(x => x !== h)[Math.floor(rng() * Math.max(1, presents.length - 1))];
  g.dernierBillet = g.t; h.dernierBillet = g.t; g.billetsVus[b.id] = g.t;
  const c = outils.creerCarte(g, 'billet', [h]);
  Object.assign(c, { genre: b.genre, billet: b.id, texte: remplir(b.texte, g, h, autre), traduction: b.traduction, autre: autre?.id || null,
    titre: { doux: `Un mot de ${h.nom}, glissé sous ta porte`, clown: `${h.nom} t'a écrit (méfie-toi)`, poeme: `Un poème de ${h.nom}`, triste: `Une lettre de ${h.nom}`, pensif: `Quelques lignes de ${h.nom}`, langue: `Une lettre que personne ne sait lire` }[b.genre],
    options: OPTIONS[b.genre].map(o => ({ ...o })), defaut: 'garder' });
  return c;
}

// Réponses : légères, privées (sauf le poème affiché), et sans pénalité si l'on ne répond pas.
const OPTIONS = {
  doux: [{ id: 'jouer', libelle: 'Répondre sur le même ton', ton: 'complice', poids: 1.5 }, { id: 'distance', libelle: 'Garder une distance polie', ton: 'ferme', poids: -0.4 }, { id: 'garder', libelle: 'Le glisser dans un tiroir', ton: 'juste', poids: 0 }],
  clown: [{ id: 'rire', libelle: 'Éclater de rire', ton: 'complice', poids: 1 }, { id: 'pire', libelle: 'Répondre par une blague encore pire', ton: 'complice', poids: 1.5 }, { id: 'sermon', libelle: 'Rappeler que le courrier, c\'est sérieux', ton: 'dur', poids: -1 }, { id: 'garder', libelle: 'Sourire, et ne rien dire', ton: 'juste', poids: 0.3 }],
  poeme: [{ id: 'afficher', libelle: 'L\'accrocher dans la salle commune', ton: 'genereux', poids: 1.5, public: true }, { id: 'garder', libelle: 'Le garder pour toi', ton: 'juste', poids: 0.5 }, { id: 'corriger', libelle: 'Corriger les fautes et le rendre', ton: 'dur', poids: -1.5 }],
  triste: [{ id: 'voir', libelle: 'Aller le voir, sans rien dire', ton: 'ecoute', poids: 2 }, { id: 'ecrire', libelle: 'Lui répondre par écrit', ton: 'compatissant', poids: 1.5 }, { id: 'garder', libelle: 'Respecter sa solitude', ton: 'juste', poids: 0.2 }],
  pensif: [{ id: 'repondre', libelle: 'Lui répondre longuement', ton: 'ecoute', poids: 1.5 }, { id: 'diner', libelle: 'En parler au dîner, devant tout le monde', ton: 'complice', poids: 0.8, public: true }, { id: 'garder', libelle: 'Garder la lettre, et y repenser', ton: 'juste', poids: 0.3 }],
  langue: [{ id: 'traduire', libelle: 'Demander à un érudit de traduire', ton: 'ecoute', poids: 1 }, { id: 'dessin', libelle: 'Répondre par un dessin', ton: 'complice', poids: 1.2 }, { id: 'garder', libelle: 'La ranger avec soin', ton: 'juste', poids: 0.3 }],
};

/* La réponse du maître à un billet. Renvoie des lignes de récit (sans chiffres). */
function repondreBillet(g, c, h, option, parDefaut) {
  const o = c.options.find(x => x.id === option) || c.options.find(x => x.id === 'garder'), out = [];
  if (c.genre === 'langue' && option === 'traduire') {
    // Un érudit présent traduit ; avec la bibliothèque du repère, on finit toujours par trouver le bon dictionnaire.
    const t = g.heros.find(x => x.etat === 'present' && x !== h && (x.traits || []).some(tr => ['ERUDIT', 'CURIEUX'].includes(tr)))
      || ((g.salles || []).includes('bibliotheque') ? { nom: 'la bibliothèque du repère, après une longue soirée de recherches,' } : null);
    if (t && c.traduction) { out.push(remplir(c.traduction, g, h, null, t)); out.push(`Le sourire de ${h.nom} dit assez combien ça compte, qu'on ait pris la peine de comprendre.`); }
    else out.push('Personne au repère ne sait lire cette écriture. La lettre reste un mystère, rangée dans ton tiroir. Peut-être qu\'un jour, un érudit…');
  }
  const L = {
    doux: { jouer: `Ta réponse revient sous la porte de ${h.nom} avant le dîner. Ce soir, quelqu'un sourit un peu trop en mangeant sa soupe.`, distance: `${h.nom} lit ta réponse, hausse les épaules, et sourit quand même. « Message reçu. Pour l'instant. »`, garder: `Le mot rejoint le tiroir. ${h.nom} ne t'en reparle pas, mais te regarde passer d'un air amusé.` },
    clown: { rire: `On t'entend rire jusque dans la cour. ${h.nom} prend ça pour une victoire totale.`, pire: `Ta blague est si mauvaise que ${h.nom} la répète à toute la guilde. C'est un triomphe.`, sermon: `${h.nom} range ses crayons de couleur, l'air vexé. La prochaine blague attendra.`, garder: `Tu souris. ${h.nom} le sait. Ça suffit.` },
    poeme: { afficher: `Le poème trône désormais au mur de la salle commune. Personne ne le comprend. Tout le monde l'adore.`, garder: `Le poème rejoint tes affaires. ${h.nom} le devine, et ça lui fait plaisir.`, corriger: `${h.nom} reçoit le poème corrigé à l'encre rouge. Le silence qui suit est très poétique.` },
    triste: { voir: `Tu t'assieds à côté de ${h.nom}. Vous ne dites rien. Au bout d'une heure, ${h.nom} pose la tête contre le mur, et quelque chose se dénoue.`, ecrire: `Ta lettre, ${h.nom} la garde sur sa table de chevet. On l'a vue relue plusieurs fois.`, garder: `${h.nom} passe la soirée à l'écart, comme demandé. Au matin, ça va un peu mieux.` },
    pensif: { repondre: `Ta réponse fait trois pages. ${h.nom} y répond par quatre. Une correspondance est née.`, diner: `Au dîner, la question de ${h.nom} occupe toute la table jusque tard. Personne n'est d'accord. Tout le monde est ravi.`, garder: `Tu y repenses le soir même. ${h.nom} le voit à ta façon de saluer, le lendemain.` },
    langue: { dessin: `Ton dessin est maladroit. ${h.nom} le contemple longtemps, et l'emporte comme un trésor.`, garder: `La lettre rejoint tes affaires, soigneusement pliée. Peut-être qu'un jour, quelqu'un la lira.` },
  }[c.genre];
  if (L?.[option]) out.push(L[option]);
  if (parDefaut) out.push(`Tu n'as pas répondu. ${h.nom} ne s'en formalise pas : un billet n'attend pas de réponse.`);
  return { lignes: out, poids: parDefaut ? 0 : o.poids, ton: o.ton, prive: !o.public };
}

module.exports = { PARAMS, GAMMES_JEUNES, chargerBillets, possibles, envoyerBillets, repondreBillet, remplir, OPTIONS };
