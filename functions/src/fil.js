'use strict';
/*
 * Guild Legends — le fil de la guilde (11 nov. 2026, après l'audit).
 *
 * « Je veux la sensation Fairy Tail : une bande de gamins aussi insupportables qu'attachants. » L'audit a montré que la
 * chronique parlait à leur place, comme un narrateur de roman. Ici, ce sont les héros qui écrivent, chacun avec sa voix
 * (catalogue/vie/repliques/lot10 à lot18) : en partant, en rentrant, quand ils s'ennuient, quand ils se cherchent, et
 * quand ils s'adressent au maître, qui peut leur répondre.
 *
 * Rien n'est composé : chaque message est une ligne écrite à la main pour ce champion, et le jeu ne la répète pas avant
 * un mois.
 */
const S = require('./scenes');
const { elider } = require('./langue');

const PARAMS = {
  nonRepetition: 24 * 30,   // une même ligne ne revient pas avant un mois dans une guilde…
  nonRepetitionContrat: 24 * 7, // …sauf au départ et au retour, où une phrase fétiche peut revenir après une semaine
  parJour: 5,               // messages spontanés par jour (départs et retours en plus)
  maitreParJour: 1,         // messages adressés au maître, avec réponse possible
  chanceCreneau: 0.4,
  poidsBande: { gamin: 1, grand: 0.5, discret: 0.25 },
  parGroupe: 2,             // au départ et au retour d'un contrat, deux héros au plus prennent la parole
};
// Les réponses du maître : courtes, sans accord de genre, et qui vont à n'importe quel message.
const REPONSES = {
  encourager: { ton: 'ecoute', libelle: 'Encourager', textes: ['Ça me fait plaisir de te lire. Vraiment.', 'Continue comme ça. Je compte sur toi.', 'Tu as toute ma confiance, tu le sais.', 'Je suis là si tu as besoin. Pour de vrai.'] },
  taquiner: { ton: 'complice', libelle: 'Taquiner', textes: ['Je fais semblant de ne pas avoir lu ça.', 'Toi, tu vas finir par me rendre chèvre.', 'Noté. Je le ressortirai au pire moment.', 'C\'est beau. Je l\'encadre au-dessus de la cheminée.'] },
  recadrer: { ton: 'ferme', libelle: 'Recadrer', textes: ['Pas sur ce ton, s\'il te plaît.', 'On en reparle demain. Calmement.', 'Je t\'ai lu. Maintenant, au travail.', 'Ça suffit pour aujourd\'hui.'] },
};

let REP = null;
const rep = () => (REP ||= S.lireRepliques());
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const lignes = (h, sit) => rep()[h.champion]?.[sit] || [];
const bande = h => lignes(h, 'bande')[0] || 'grand';

/* Une ligne de ce champion pour cette situation, jamais lue dans le mois si possible. */
function choisir(g, h, sit, graine) {
  const L = lignes(h, sit); if (!L.length) return null;
  g.usage ||= {};
  const vue = x => g.usage[`F:${x}`];
  const delai = /^fil_(depart|retour|blesse)/.test(sit) ? PARAMS.nonRepetitionContrat : PARAMS.nonRepetition;
  const neuves = L.filter(x => vue(x) == null || g.t - vue(x) >= delai);
  // Tout a déjà été dit ce mois-ci : le héros se tait plutôt que de radoter (le départ garde alors sa ligne de récit).
  if (!neuves.length) return null;
  const x = neuves[hash(graine) % neuves.length];
  g.usage[`F:${x}`] = g.t;
  return x;
}
function remplir(g, texte, autre) {
  return texte.replace(/\{b\}/g, autre?.nom || 'quelqu\'un').replace(/\{chien\}/g, g.monde?.chien || 'le chien')
    .replace(/\{maitre\}/g, g.maitre?.titre === 'maîtresse' ? 'maîtresse' : 'maître');
}
/* Un message dans le fil. Rend l'entrée de chronique, ou null si ce champion n'a rien à dire dans cette situation. */
function poster(g, h, sit, { autre = null, contexte = null, scene = null, importance = 2, reponses = false } = {}) {
  const x = choisir(g, h, sit, `${g.id}#${h.id}#${sit}#${g.t}`); if (!x) return null;
  const e = { t: g.t, lieu: h.lieu || null, importance, declencheur: 'fil', voix: sit, auteur: h.id, heros: [h.id, autre?.id].filter(Boolean), texte: elider(remplir(g, x, autre)) };
  if (contexte) e.contexte = contexte;
  if (scene) e.scene = scene;
  if (reponses) { e.id = `F${(g.seqFil = (g.seqFil || 0) + 1)}`; e.reponses = true; }
  g.chronique.push(e);
  return e;
}
/* Qui parle quand un groupe part ou rentre : les plus bavards d'abord. */
function porteParole(hs) {
  const rang = { gamin: 0, grand: 1, discret: 2 };
  return [...hs].sort((a, b) => rang[bande(a)] - rang[bande(b)] || a.nom.localeCompare(b.nom)).slice(0, PARAMS.parGroupe);
}
function depart(g, hs, mission) {
  const contexte = `Part pour « ${mission.titre} »${mission.lieu ? ` · ${mission.lieu}` : ''}`;
  return porteParole(hs).map(h => poster(g, h, 'fil_depart', { contexte, scene: 'contrat#depart', importance: 3 })).filter(Boolean);
}
function retour(g, hs, issue, blesses, mission) {
  const contexte = mission?.titre ? `Retour de « ${mission.titre} »` : null;
  return porteParole(hs).map(h => poster(g, h, blesses.includes(h.id) ? 'fil_blesse' : ['eclatante', 'reussite'].includes(issue) ? 'fil_retour_bon' : 'fil_retour_mauvais', { contexte, importance: 3 })).filter(Boolean);
}

/* À chaque créneau de jour : peut-être un message spontané. Les gamins postent beaucoup, les discrets presque jamais. */
function vivre(g, rng) {
  const j = Math.floor(g.t / 24);
  if (g.filJour?.j !== j) g.filJour = { j, n: 0, m: 0 };
  if (g.filJour.n >= PARAMS.parJour || rng() > PARAMS.chanceCreneau) return null;
  const presents = g.heros.filter(h => h.etat === 'present' && h.activite !== 'dormir');
  if (!presents.length) return null;
  const poids = presents.map(h => PARAMS.poidsBande[bande(h)] * ((h.besoins?.loisir ?? 60) < 40 ? 1.6 : 1));
  let x = rng() * poids.reduce((a, b) => a + b, 0), h = presents[0];
  for (let i = 0; i < presents.length; i++) { x -= poids[i]; if (x <= 0) { h = presents[i]; break; } }
  const autres = presents.filter(o => o !== h);
  let e = null;
  if (g.filJour.m < PARAMS.maitreParJour && rng() < 0.3) { e = poster(g, h, 'fil_maitre', { reponses: true }); if (e) g.filJour.m++; }
  else if (autres.length && rng() < 0.3) e = poster(g, h, 'fil_pique', { autre: autres[Math.floor(rng() * autres.length)] });
  // Le reste du temps : la vie du repère, ou l'ennui quand le héros n'a rien eu à faire depuis longtemps.
  if (!e) e = (h.besoins?.loisir ?? 60) < 40 && rng() < 0.6 ? poster(g, h, 'fil_ennui') || poster(g, h, 'fil_quotidien') : poster(g, h, 'fil_quotidien') || poster(g, h, 'fil_ennui');
  if (e) g.filJour.n++;
  return e;
}

/* Le maître répond à un message qui lui était adressé. Le héros (et ceux qui lisent par-dessus son épaule) jugent le ton. */
function repondre(g, idMessage, choix, juger) {
  const e = g.chronique.find(x => x.id === idMessage && x.reponses);
  if (!e) throw new Error('Ce message n\'attend plus de réponse.');
  if (e.repondu) throw new Error('Tu as déjà répondu.');
  const R = REPONSES[choix]; if (!R) throw new Error('Réponse inconnue.');
  const h = g.heros.find(x => x.id === e.auteur);
  e.repondu = choix;
  const texte = R.textes[hash(`${g.id}#${idMessage}`) % R.textes.length];
  g.chronique.push({ t: g.t, lieu: null, importance: 2, declencheur: 'fil', voix: 'reponse', auteur: 'maitre', heros: h ? [h.id] : [], texte, enReponseA: idMessage });
  const lignesReaction = h && juger ? juger(g, R.ton, [{ h, poids: choix === 'recadrer' ? -0.2 : 0.4 }], `Ta réponse à ${h.nom}`) : [];
  return { texte, lignes: lignesReaction };
}

/*
 * Les stories : une par héros et par jour. Ce que le héros a posté aujourd'hui s'il a posté quelque chose ; sinon, une de
 * ses légendes de story, qui change chaque jour. Le portrait vient de vue.js.
 */
function stories(g, t = g.t) {
  const j = Math.floor(t / 24), out = [];
  for (const h of g.heros) {
    if (h.etat === 'parti' || h.etat === 'mort') continue;
    const posts = g.chronique.filter(e => e.declencheur === 'fil' && e.auteur === h.id && t - e.t < 24).slice(-3);
    const L = lignes(h, 'story');
    const slides = posts.length ? posts.map(e => ({ t: e.t, texte: e.texte, contexte: e.contexte || null }))
      : L.length ? [{ t: Math.min(t, j * 24 + 6 + hash(h.id) % 12), texte: elider(remplir(g, L[(j + hash(h.id)) % L.length], null)), contexte: null }] : [];
    if (slides.length) out.push({ heros: h.id, slides, derniere: Math.max(...slides.map(s => s.t)) });
  }
  return out.sort((a, b) => b.derniere - a.derniere);
}

module.exports = { PARAMS, REPONSES, poster, depart, retour, vivre, repondre, stories, bande };
