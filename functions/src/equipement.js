'use strict';
/*
 * Guild Legends — l'équipement (recueil § 11, 8 nov. 2026).
 *
 * - Les missions réussies peuvent rapporter un objet (la chance est écrite dans chaque mission). Il rejoint l'inventaire.
 * - Le joueur choisit quel héros porte quoi : deux objets durables par héros.
 * - Un objet améliore des statistiques, mais jamais au-delà des plafonds du héros : l'équipement ne change pas le potentiel.
 * - Les potions et élixirs sont des consommables : une potion soigne, un élixir sert pour la prochaine mission.
 * - Quand un héros part ou meurt, son équipement revient à l'inventaire de la guilde.
 * Les noms sont ceux des objets officiels de League of Legends ; les effets sont des propositions de Claude.
 */
const PARAMS = { emplacements: 2 };

const OBJETS = {
  'Épée longue':          { type: 'durable', stats: { Force: 4 }, texte: '+4 en Force' },
  'Dague':                { type: 'durable', stats: { Précision: 3, Vitesse: 2 }, texte: '+3 en Précision, +2 en Vitesse' },
  'Pioche':               { type: 'durable', stats: { Force: 6 }, texte: '+6 en Force' },
  'Armure de tissu':      { type: 'durable', stats: { Défense: 4 }, texte: '+4 en Défense' },
  'Cape de négation':     { type: 'durable', stats: { 'Résistance magique': 5 }, texte: '+5 en Résistance magique' },
  'Cristal de rubis':     { type: 'durable', stats: { Endurance: 4 }, texte: '+4 en Endurance' },
  'Cristal de saphir':    { type: 'durable', stats: { Intelligence: 4 }, texte: '+4 en Intelligence' },
  "Tome d'amplification": { type: 'durable', stats: { Magie: 4 }, texte: '+4 en Magie' },
  'Bottes':               { type: 'durable', stats: { Vitesse: 4 }, texte: '+4 en Vitesse' },
  'Ceinture du géant':    { type: 'durable', stats: { Endurance: 6 }, texte: '+6 en Endurance' },
  'Lame de Doran':        { type: 'durable', stats: { Force: 3, Endurance: 2 }, texte: '+3 en Force, +2 en Endurance' },
  'Anneau de Doran':      { type: 'durable', stats: { Magie: 3, Intelligence: 2 }, texte: '+3 en Magie, +2 en Intelligence' },
  'Bouclier de Doran':    { type: 'durable', stats: { Défense: 3, Endurance: 2 }, texte: '+3 en Défense, +2 en Endurance' },
  'Charme féerique':      { type: 'durable', stats: { Leadership: 3, Intelligence: 2 }, texte: '+3 en Leadership, +2 en Intelligence' },
  'Potion de soin':       { type: 'potion', soin: 12, texte: 'Soigne une blessure : 12 h de repos en moins. Un seul usage.' },
  'Potion rechargeable':  { type: 'potion', soin: 8, recharge: 72, texte: 'Soigne une blessure : 8 h de repos en moins. Se recharge en 3 jours.' },
  'Élixir de fer':        { type: 'elixir', stats: { Défense: 6, 'Résistance magique': 4 }, texte: 'Pour la prochaine mission : +6 en Défense, +4 en Résistance magique.' },
  'Élixir de sorcellerie':{ type: 'elixir', stats: { Magie: 8 }, texte: 'Pour la prochaine mission : +8 en Magie.' },
  'Élixir de rage':       { type: 'elixir', stats: { Force: 8 }, texte: 'Pour la prochaine mission : +8 en Force.' },
};

let seq = 0;
/* L'objet d'une mission réussie, ou null. */
function tirerObjet(mission, rng) {
  for (const o of mission.recompenses?.objets || []) if (OBJETS[o.nom] && rng() * 100 < o.chance) return { uid: `o${Date.now().toString(36)}${(++seq).toString(36)}`, nom: o.nom, ...OBJETS[o.nom] };
  return null;
}

/* Statistiques avec l'équipement porté (et l'élixir bu), plafonnées par les plafonds du héros. */
function statsEquipees(stats, h, fiche) {
  const objets = [...(h.equipement || []), ...(h.elixir ? [h.elixir] : [])];
  if (!objets.length) return stats;
  const out = { ...stats };
  for (const o of objets) for (const [k, v] of Object.entries(OBJETS[o.nom]?.stats || {})) out[k] = Math.min(fiche?.plafonds?.[k] ?? Infinity, (out[k] || 0) + v);
  return out;
}

function equiper(g, heroId, uid) {
  const h = g.heros.find(x => x.id === heroId); if (!h) throw new Error('Héros inconnu.');
  const i = (g.inventaire || []).findIndex(o => o.uid === uid); if (i < 0) throw new Error('Objet introuvable dans l\'inventaire.');
  const o = g.inventaire[i];
  if (o.type === 'potion') {
    if (!h.blesse && !(h.reposJusqua > g.t)) throw new Error(`${h.nom} n'a besoin d'aucun soin.`);
    if (o.rechargeJusqua > g.t) throw new Error(`La potion se recharge encore ${Math.ceil(o.rechargeJusqua - g.t)} h.`);
    h.reposJusqua = Math.max(g.t, (h.reposJusqua || g.t) - o.soin); h.blesse = h.blesse ? Math.max(0, h.blesse - o.soin) : h.blesse;
    if (o.recharge) o.rechargeJusqua = g.t + o.recharge; else g.inventaire.splice(i, 1);
    return `${h.nom} boit la potion. Ça va déjà mieux.`;
  }
  if (o.type === 'elixir') { if (h.elixir) throw new Error(`${h.nom} a déjà un élixir pour sa prochaine mission.`); h.elixir = o; g.inventaire.splice(i, 1); return `${h.nom} garde l'élixir pour sa prochaine mission.`; }
  if ((h.equipement ||= []).length >= PARAMS.emplacements) throw new Error(`${h.nom} porte déjà ${PARAMS.emplacements} objets : retire-en un d'abord.`);
  h.equipement.push(o); g.inventaire.splice(i, 1);
  return `${h.nom} s'équipe : ${o.nom}.`;
}
function desequiper(g, heroId, uid) {
  const h = g.heros.find(x => x.id === heroId), i = (h?.equipement || []).findIndex(o => o.uid === uid);
  if (i < 0) throw new Error('Cet objet n\'est pas porté par ce héros.');
  (g.inventaire ||= []).push(h.equipement.splice(i, 1)[0]);
}
/* L'élixir est bu au départ en mission : on le retire au retour. */
const elixirBu = h => { h.elixir = null; };
function rendreEquipement(g, h) {
  (g.inventaire ||= []).push(...(h.equipement || []), ...(h.elixir ? [h.elixir] : []));
  h.equipement = []; h.elixir = null;
}

module.exports = { PARAMS, OBJETS, tirerObjet, statsEquipees, equiper, desequiper, elixirBu, rendreEquipement };
