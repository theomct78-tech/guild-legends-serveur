'use strict';
/*
 * Guild Legends — règles de jeu pures (sans Firebase).
 * Tout ce qui est ici est testable hors ligne et réutilisé par les fonctions serveur.
 *
 * Légende des statuts de validation :
 *   VALIDÉ      = décision écrite dans le cahier des charges
 *   PROPOSITION = valeur soumise à arbitrage, ne pas considérer comme définitive
 */

/* ---------- Rangs (VALIDÉ, §5.5) ---------- */
const RANKS = ['D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+', 'G'];
const POTENTIALS = RANKS.slice(RANKS.indexOf('B')); // B … G (VALIDÉ, §5.2)

function rankIndex(r) {
  const i = RANKS.indexOf(r);
  if (i < 0) throw new Error(`Rang inconnu : ${r}`);
  return i;
}

/* ---------- Niveau de guilde ---------- */
const MAX_GUILD_LEVEL = 50; // VALIDÉ, §3.1
const MAX_CAPACITY = 25;    // VALIDÉ, §3.1

/* Candidatures par montée de niveau (VALIDÉ, §6.1) */
function candidatureCount(level) {
  assertLevel(level);
  if (level >= 35) return 10;
  return 3 + Math.floor(level / 5);
}

/*
 * Capacité de l’effectif (décision de Théo, 8 nov. 2026 : « 25 héros max au repère au niveau 50, à étaler avec la
 * progression ») : 5 places au niveau 1, puis une place de plus tous les deux ou trois niveaux, sans à-coup,
 * jusqu’à 25 au niveau 50. Plus de saut de deux places d’un coup à la fin.
 */
function capacity(level) {
  assertLevel(level);
  // Courbe légèrement bombée : les places viennent un peu plus vite au début, quand chaque héros compte le plus.
  return 5 + Math.floor((MAX_CAPACITY - 5) * Math.pow((level - 1) / (MAX_GUILD_LEVEL - 1), 0.85));
}

function assertLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_GUILD_LEVEL) {
    throw new Error(`Niveau de guilde invalide : ${level}`);
  }
}

/* ---------- Héros : remise en circulation ---------- */

/*
 * Un héros qui quitte une guilde (remplacement, départ volontaire, mort)
 * ne pourra plus jamais y revenir (VALIDÉ, §7.1, §8, §9).
 * - remplacement / départ : progression conservée
 * - mort : progression réinitialisée, potentiel conservé, Panthéon alimenté par l'appelant
 */
function releaseHero(hero, reason) {
  if (!hero.ownerGuildId) throw new Error('Ce héros n’appartient à aucune guilde.');
  const lostBy = Array.from(new Set([...(hero.lostBy || []), hero.ownerGuildId]));
  const base = { ...hero, ownerGuildId: null, status: 'registry', lostBy, interestedGuilds: [] };
  if (reason === 'replaced' || reason === 'left') return base;
  if (reason === 'died') {
    // Recueil §7.4 : un héros mort va au Panthéon et retourne au tirage général,
    // pas au Registre des héros disponibles (qui ne concerne que les remplacés et démissionnaires).
    return {
      ...base,
      status: 'pool',
      progression: null,          // sera régénérée au prochain recrutement
      needsFreshStart: true,
      life: (hero.life || 0) + 1, // numéro d'incarnation dans le système, pour relier le Panthéon
    };
  }
  throw new Error(`Motif de départ inconnu : ${reason}`);
}

/*
 * Contrôle complet d'un recrutement. Ne fait aucune écriture : renvoie le plan,
 * que la fonction serveur applique dans une transaction.
 */
function planRecruitment({ guild, hero, candidature, replaceHero = null }) {
  if (!candidature || candidature.guildId !== guild.id || candidature.heroId !== hero.id) {
    throw new Error('Candidature introuvable pour cette guilde.');
  }
  if (candidature.status !== 'open') throw new Error('Cette candidature est close.');
  if (hero.ownerGuildId) throw new Error('Ce héros a déjà rejoint une guilde.');
  if ((hero.lostBy || []).includes(guild.id)) {
    throw new Error('Ce héros a quitté cette guilde : il ne peut plus la rejoindre.');
  }

  const roster = guild.rosterCount || 0;
  const cap = capacity(guild.level);
  let release = null;

  if (roster >= cap) {
    if (!replaceHero) throw new Error('Effectif complet : choisis le héros à remplacer.');
    if (replaceHero.ownerGuildId !== guild.id) throw new Error('Ce héros ne fait pas partie de ta guilde.');
    release = releaseHero(replaceHero, 'replaced');
  } else if (replaceHero) {
    throw new Error('Il reste une place libre : aucun remplacement nécessaire.');
  }

  const recruited = {
    ...hero,
    ownerGuildId: guild.id,
    status: 'guild',
    interestedGuilds: [],
    needsFreshStart: false,
    joinedAt: candidature.now,
  };

  return {
    recruited,
    released: release,
    rosterCount: release ? roster : roster + 1,
    closeCandidature: true,
  };
}

/*
 * Candidatures ciblées (VALIDÉ, §7.3–7.4) : le héros du Registre revient à la
 * première guilde intéressée qui monte de niveau, et prend la place d'un tirage aléatoire.
 * interestedGuilds est ordonné par date de positionnement, mais c'est la montée de niveau qui décide :
 * la fonction est appelée au moment où une guilde monte, et vérifie seulement qu'elle s'est positionnée.
 */
function targetedCandidatesFor(guildId, registryHeroes) {
  return registryHeroes.filter(h =>
    h.status === 'registry' &&
    !(h.lostBy || []).includes(guildId) &&
    (h.interestedGuilds || []).includes(guildId) &&
    !h.reservedCandidatureFor
  );
}

/* ---------- Régions de Runeterra (régions officielles) ----------
 * VALIDÉ : la région est choisie à la fondation et ne change plus (localisation permanente).
 * Elle servira aux missions privées (proximité) et aux territoires.
 * VALIDÉ : le Néant et les Îles obscures ne peuvent pas accueillir de repère.
 */
const REGIONS = [
  'bandle', 'bilgewater', 'demacia', 'freljord', 'ionia', 'ixtal',
  'noxus', 'piltover', 'shurima', 'targon', 'zaun',
];

/* ---------- Fondation d'une guilde (M0) ---------- */

/* Emblèmes originaux (aucun logo Riot) : forme + couleur. */
const EMBLEM_SHAPES = ['etoile', 'lanterne', 'epee', 'chope', 'cle', 'loup', 'flamme', 'lune'];
const EMBLEM_COLORS = ['ambre', 'braise', 'mousse', 'riviere', 'prune', 'ivoire'];

function normalizeGuildName(name) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}
/* Clé d'unicité : insensible à la casse et aux accents. */
function guildNameKey(name) {
  return normalizeGuildName(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validateFoundation({ name, motto = '', emblem, region } = {}) {
  if (!REGIONS.includes(region)) throw new Error('Choisis la région où s’installe ton repère.');
  const clean = normalizeGuildName(name);
  if (clean.length < 3 || clean.length > 32) throw new Error('Le nom doit faire entre 3 et 32 caractères.');
  if (!/^[\p{L}\p{N} '’\-]+$/u.test(clean)) throw new Error('Le nom ne peut contenir que des lettres, chiffres, espaces, apostrophes et tirets.');
  if (guildNameKey(clean).length < 3) throw new Error('Ce nom est trop court une fois simplifié.');
  const m = normalizeGuildName(motto);
  if (m.length > 120) throw new Error('La devise ne peut pas dépasser 120 caractères.');
  if (!emblem || !EMBLEM_SHAPES.includes(emblem.shape) || !EMBLEM_COLORS.includes(emblem.color)) {
    throw new Error('Emblème invalide.');
  }
  return { name: clean, nameKey: guildNameKey(clean), motto: m, emblem: { shape: emblem.shape, color: emblem.color }, region };
}

/*
 * État initial d'une guilde. Les valeurs encore à arbitrer restent à null
 * (rang de guilde, trésorerie de départ : économie à équilibrer, point 10) plutôt qu'inventées.
 */
function newGuild({ ownerUid, foundation, now }) {
  return {
    ownerUid,
    name: foundation.name,
    nameKey: foundation.nameKey,
    motto: foundation.motto,
    emblem: foundation.emblem,
    region: foundation.region,
    level: 1,
    xp: 0,
    rank: null,
    reputation: 0,
    treasury: null,
    rosterCount: 0,
    capacity: capacity(1),
    createdAt: now,
  };
}

/*
 * Tirage aléatoire classique (VALIDÉ) : seuls les héros libres du tirage général.
 * Les héros du Registre en sont exclus ; on ne les obtient qu'en s'étant positionné sur eux.
 */
function eligibleForRandomDraw(hero, guildId) {
  return hero.status === 'pool' && !hero.ownerGuildId && !(hero.lostBy || []).includes(guildId);
}

/*
 * Refus d'une candidature ciblée (VALIDÉ) : le héros retourne au Registre et reste
 * disponible pour les autres guildes. La guilde qui a refusé sort de la liste des intéressées.
 */
function refuseTargeted(hero, guildId) {
  if (hero.status !== 'registry') throw new Error('Ce héros n’est pas au Registre.');
  return {
    ...hero,
    reservedCandidatureFor: null,
    interestedGuilds: (hero.interestedGuilds || []).filter(g => g !== guildId),
  };
}

module.exports = {
  REGIONS, eligibleForRandomDraw, refuseTargeted,
  EMBLEM_SHAPES, EMBLEM_COLORS, normalizeGuildName, guildNameKey, validateFoundation, newGuild,
  RANKS, POTENTIALS, rankIndex,
  MAX_GUILD_LEVEL, MAX_CAPACITY,
  candidatureCount, capacity,
  releaseHero, planRecruitment, targetedCandidatesFor,
};
