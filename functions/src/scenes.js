'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — scènes de la vie de guilde : lecture du catalogue et choix d'une scène.
 *
 * Format d'une ligne : ID|déclencheur|conditions|importance|effets|texte
 *   conditions (séparées par des virgules, toutes requises) :
 *     a:TRAIT, !b:TRAIT       trait présent / absent chez a, b ou c
 *     a.So>70, b.Di<30        axe de personnalité
 *     a=Jinx                  champion
 *     a~or                    motivation
 *     a@demacia               région d'origine
 *     lien=famille            type de lien entre a et b ; lien=aucun pour des inconnus
 *     aff>40, aff<-20         affinité entre a et b
 *     lieu=cour, nuit, jour, matin (6-12 h), apresmidi (12-18 h), soir (18-24 h), blesse:a, meme_pays, pays_hai (b vient d'une région que a déteste)
 *   effets (séparés par des points-virgules) : aff+3, a.moral+4, b.moral-3, or-10
 *   texte : {a}, {b}, {c} sont remplacés par les noms, {lieu} par le lieu avec sa préposition (« sur les remparts ») ; plusieurs variantes séparées par « // ».
 *
 * Règle d'écriture : aucun accord de genre sur {a}, {b}, {c} (ni participe avec « être », ni adjectif qualifiant le héros).
 */
const fs = require('node:fs');
const path = require('node:path');
const { finir } = require('./langue');
const Q = () => require('./quetes');

// {lieu} s'écrit avec sa préposition : « {a} croise {b} {lieu} » donne « … sur les remparts ».
const LIBELLES_LIEUX = {
  dortoirs: 'dans les dortoirs', salle_commune: 'dans la salle commune', cour: 'dans la cour d\'entraînement', remparts: 'sur les remparts', ville: 'en ville',
  bibliotheque: 'à la bibliothèque', taverne: 'à la taverne du repère', sanctuaire: 'au sanctuaire', infirmerie: 'à l\'infirmerie', cuisines: 'aux cuisines',
  salle_armes: 'dans la salle d\'armes', ecuries: 'aux écuries', forge: 'à la forge', salle_cartes: 'dans la salle des cartes', aile_nord: 'dans l\'aile nord',
  bains: 'aux bains', galerie: 'dans la galerie des trophées', observatoire: 'à l\'observatoire', grand_hall: 'dans le grand hall',
};

function lireCondition(brut) {
  const c = brut.trim(); let m;
  if ((m = c.match(/^(!?)([abc]):([A-Z]+)$/))) return { type: 'trait', non: !!m[1], qui: m[2], valeur: m[3] };
  if ((m = c.match(/^([abc])\.(So|Di|Te|Al|Tm|Am)([<>])(\d+)$/))) return { type: 'axe', qui: m[1], axe: m[2], op: m[3], valeur: +m[4] };
  if ((m = c.match(/^([abc])=(.+)$/))) return { type: 'champion', qui: m[1], valeur: m[2] };
  if ((m = c.match(/^([abc])~([a-z]+)$/))) return { type: 'motivation', qui: m[1], valeur: m[2] };
  if ((m = c.match(/^([abc])@([a-z]+)$/))) return { type: 'origine', qui: m[1], valeur: m[2] };
  if ((m = c.match(/^lien=([a-z]+)$/))) return { type: 'lien', valeur: m[1] };
  if ((m = c.match(/^aff([<>])(-?\d+)$/))) return { type: 'aff', op: m[1], valeur: +m[2] };
  if ((m = c.match(/^lieu=([a-z_]+)$/))) return { type: 'lieu', valeur: m[1] };
  if ((m = c.match(/^blesse:([abc])$/))) return { type: 'blesse', qui: m[1] };
  if ((m = c.match(/^recent:(mission|reussite|echec|blessure|arrivee|soiree|absent_soiree|retour_conges|fugue):([abc])$/))) return { type: 'recent', quoi: m[1], qui: m[2] };
  if (c === 'recent:dispute') return { type: 'recent', quoi: 'dispute' };
  if (c === 'recent:mort') return { type: 'recent', quoi: 'mort' };
  if ((m = c.match(/^meteo=([a-z]+)$/))) return { type: 'meteo', valeur: m[1] };
  if ((m = c.match(/^saison=([a-z]+)$/))) return { type: 'saison', valeur: m[1] };
  if (['nuit', 'jour', 'matin', 'apresmidi', 'soir', 'meme_pays', 'pays_hai'].includes(c)) return { type: c };
  throw new Error(`Condition illisible : « ${c} »`);
}
function lireEffet(brut) {
  const e = brut.trim(); let m;
  if ((m = e.match(/^aff([+-]\d+)$/))) return { type: 'aff', valeur: +m[1] };
  if ((m = e.match(/^([abc])\.moral([+-]\d+)(?::(.+))?$/))) return { type: 'moral', qui: m[1], valeur: +m[2], libelle: m[3] };
  if ((m = e.match(/^(?:po|or)([+-]\d+)$/))) return { type: 'po', valeur: +m[1] }; // pièces d'or (PO)
  throw new Error(`Effet illisible : « ${e} »`);
}

function lireScenes(dossier) {
  const out = [];
  for (const f of fs.readdirSync(dossier).filter(n => /^lot\d+\.txt$/.test(n)).sort()) {
    fs.readFileSync(path.join(dossier, f), 'utf8').split('\n').forEach((l, i) => {
      if (!l.trim() || l.startsWith('#')) return;
      const p = l.split('|');
      if (p.length !== 6) throw new Error(`${f}:${i + 1} : 6 champs attendus, ${p.length} trouvés`);
      const [id, declencheur, cond, imp, eff, texte] = p.map(x => x.trim());
      out.push({ id, declencheur, conditions: cond ? cond.split(',').map(lireCondition) : [], importance: +imp || 1,
        effets: eff ? eff.split(';').map(lireEffet) : [], variantes: texte.split('//').map(x => x.trim()).filter(Boolean), fichier: f, ligne: i + 1 });
    });
  }
  return out;
}
const chargerScenes = () => { const s = lireScenes(path.join(CATALOGUE, 'vie/scenes')); s.repliques = lireRepliques(); return s; };

function verifie(cond, ctx) {
  const h = ctx[cond.qui];
  switch (cond.type) {
    case 'trait': return !!h && h.traits.includes(cond.valeur) !== cond.non;
    case 'axe': return !!h && (cond.op === '>' ? h.axes[cond.axe] > cond.valeur : h.axes[cond.axe] < cond.valeur);
    // Une scène écrite pour un champion parle du héros de Runeterra d'origine : Lux Star Guardian n'a pas grandi à Demacia.
    case 'champion': return !!h && h.champion === cond.valeur && (h.univers ?? 'classic') === 'classic';
    case 'motivation': return !!h && h.motivation === cond.valeur;
    case 'origine': return !!h && h.regions.aime[0] === cond.valeur;
    case 'lien': return !!ctx.relation && (cond.valeur === 'aucun' ? !ctx.relation.type : ctx.relation.type === cond.valeur);
    case 'aff': return !!ctx.relation && (cond.op === '>' ? ctx.relation.aff > cond.valeur : ctx.relation.aff < cond.valeur);
    case 'lieu': return ctx.lieu === cond.valeur;
    case 'blesse': return !!h && !!h.blesse;
    case 'nuit': return !!ctx.nuit;
    case 'jour': return !ctx.nuit;
    case 'matin': return ctx.heure >= 6 && ctx.heure < 12;
    case 'apresmidi': return ctx.heure >= 12 && ctx.heure < 18;
    case 'soir': return ctx.heure >= 18;
    case 'meme_pays': return !!ctx.a && !!ctx.b && ctx.a.regions.aime[0] && ctx.a.regions.aime[0] === ctx.b.regions.aime[0];
    case 'pays_hai': return !!ctx.a && !!ctx.b && ctx.a.regions.deteste.includes(ctx.b.regions.aime[0]);
    case 'meteo': return ctx.meteo?.temps === cond.valeur;
    case 'saison': return ctx.meteo?.saison === cond.valeur;
    case 'recent': return !!evenementRecent(ctx, cond);
  }
  return false;
}

/* ---------- Mémoire récente ----------
 * Fenêtres pendant lesquelles un événement « compte » encore pour les scènes (en heures).
 */
const FENETRES = { mission: 36, reussite: 36, echec: 48, blessure: 48, arrivee: 72, soiree: 18, absent_soiree: 18, retour_conges: 24, fugue: 48, dispute: 48, mort: 168 };
function evenementRecent(ctx, cond) {
  const h = cond.qui ? ctx[cond.qui] : null, f = FENETRES[cond.quoi], mem = ctx.memoire || [];
  for (let i = mem.length - 1; i >= 0; i--) {
    const e = mem[i]; if (ctx.t - e.t > f || ctx.t - e.t < 0) continue;
    switch (cond.quoi) {
      case 'mission': if (e.type === 'mission' && e.heros.includes(h?.id)) return e; break;
      case 'reussite': if (e.type === 'mission' && e.heros.includes(h?.id) && ['reussite', 'eclatante'].includes(e.issue)) return e; break;
      case 'echec': if (e.type === 'mission' && e.heros.includes(h?.id) && ['echec', 'partielle'].includes(e.issue)) return e; break;
      case 'blessure': if (e.type === 'mission' && (e.blesses || []).includes(h?.id)) return e; break;
      case 'arrivee': if (e.type === 'arrivee' && e.heros.includes(h?.id)) return e; break;
      case 'soiree': if (e.type === 'soiree' && e.heros.includes(h?.id)) return e; break;
      case 'absent_soiree': if (e.type === 'soiree' && (e.absents || []).includes(h?.id)) return e; break;
      case 'fugue': if (e.type === 'fugue' && e.heros.includes(h?.id)) return e; break;
      case 'retour_conges': if ((e.type === 'conges' || e.type === 'fugue') && e.heros.includes(h?.id)) return e; break;
      case 'dispute': if (e.type === 'dispute' && ctx.a && ctx.b && e.heros.includes(ctx.a.id) && e.heros.includes(ctx.b.id)) return e; break;
      case 'mort': if (e.type === 'mission' && (e.morts || []).length) return e; break;
    }
  }
  return null;
}

/* ---------- Répliques ----------
 * {a:situation} est remplacé par une réplique écrite pour ce champion, dans cette situation. Dans les scènes, il n'y a pas de voix
 * « par défaut » : une variante qui fait parler un héros n'est jouée que s'il a lui-même quelque chose à dire.
 * Les demandes adressées au maître (congés, augmentation, départ…) gardent la voix de son registre quand le champion n'a pas
 * de réplique à lui : une demande sans un mot du héros n'aurait pas de sens.
 */
function lireRepliques(dossier = path.join(CATALOGUE, 'vie/repliques')) {
  const out = {};
  if (!fs.existsSync(dossier)) return out;
  for (const f of fs.readdirSync(dossier).filter(n => /^lot\d+\.txt$/.test(n)).sort())
    for (const l of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue;
      const [qui, sit, texte] = l.split('|');
      ((out[qui] ||= {})[sit] ||= []).push(texte.trim());
    }
  return out;
}
// 11 nov. 2026 (audit) : les héros portent le nom de leur champion, quel que soit leur skin. Ils parlent donc tous avec sa voix ;
// avant, seuls les skins classiques parlaient, et presque tous les héros tombaient sur des répliques génériques.
const repliquesDe = (rep, h, sit) => (h && rep?.[h.champion]?.[sit]) || [];
// Certains héros n'ont pas de corps ordinaire : un golem, une statue, un spectre ou un esprit ne mange pas, ne boit pas et ne dort pas.
// Une scène de soupe ou de cauchemar ne leur est jamais confiée (respecter le personnage passe avant la variété).
const SANS_CORPS = new Set(['Blitzcrank', 'Orianna', 'Galio', 'Malphite', 'Thresh', 'Karthus', 'Hecarim', 'Kalista', 'Mordekaiser', 'Viego',
  'Fiddlesticks', 'Nocturne', 'Kindred', "Vel'Koz", 'Bard', 'Aurelion Sol', 'Anivia', 'Maokai', 'Yuumi']);
const CORPOREL = /\b(mange|mangent|manger|soupe|tourte|ragoût|repas|dîner|déjeuner|goûter|pain|biscuits?|confitures?|gâteaux?|tarte|fromage|thé|café|bière|chopes?|cidre|vin|hydromel|bouillon|dort|dorment|dormir|lit|rêve|cauchemar|réveil|réveille|sommeil|ronfle|sieste|grelotte|frissonne|bains?|cernes|bâille|endort|endormi|rougit|rougir|verre|lait|tisane|sueur|transpire|larmes|pleure|lame|épée|danse|danser)\b/i;
const corpsOk = (variante, ctx) => !CORPOREL.test(variante) || ['a', 'b', 'c'].every(k => !ctx[k] || !SANS_CORPS.has(ctx[k].champion) || !variante.includes(`{${k}}`));
const peutParler = (rep, variante, ctx) => corpsOk(variante, ctx) && [...variante.matchAll(/\{([abc]):([a-z_]+)\}/g)].every(([, k, sit]) => repliquesDe(rep, ctx[k], sit).length);
// Une même réplique ne revient pas dans la guilde avant deux jours, tant que le héros a autre chose à dire.
let REGISTRES = null;
function registreDe(champion) {
  if (!REGISTRES) { try { const d = require('./candidatures').chargerDossiers(); REGISTRES = Object.fromEntries(Object.entries(d).map(([c, x]) => [c, x.registre])); } catch (e) { REGISTRES = {}; } }
  return REGISTRES[champion] || 'sage';
}
function replique(rep, h, sit, autre, rng, usage = {}, t = 0, { registre = false } = {}) {
  let toutes = repliquesDe(rep, h, sit);
  if (!toutes.length && registre && h) toutes = rep?.[`registre:${registreDe(h.champion)}`]?.[sit] || [];
  if (!toutes.length) return null;
  // Audit du 11 nov. : une réplique ne revient pas avant deux semaines. Si le champion a tout dit, on prend une réplique de
  // son registre (gamin, grand, discret…) encore neuve, plutôt que de lui faire répéter la même phrase.
  const neuf = x => usage['R:' + x] == null || t - usage['R:' + x] >= 24 * 14;
  let neuves = toutes.filter(neuf);
  if (!neuves.length && h) neuves = (rep?.[`registre:${registreDe(h.champion)}`]?.[sit] || []).filter(neuf);
  const l = neuves.length ? neuves : [...toutes].sort((a, b) => (usage['R:' + a] ?? -1e9) - (usage['R:' + b] ?? -1e9)).slice(0, 1);
  const x = l[Math.floor(rng() * l.length) % l.length];
  usage['R:' + x] = t;
  return x.replace(/\{b\}/g, autre?.nom ?? 'toi');
}

/*
 * Choisit une scène. Les scènes les plus précises (le plus de conditions) sont favorisées, et une scène déjà jouée
 * dans la guilde depuis moins de « delai » heures est écartée. Si plus rien n'est disponible, un moment mineur
 * retombe dans la routine (null) ; un moment important reprend la scène la plus ancienne.
 */
function choisirScene(scenes, declencheur, ctx, usage, t, delai, rng, obligatoire = false) {
  const possibles = scenes.filter(s => s.declencheur === declencheur && s.conditions.every(c => verifie(c, ctx)) && s.variantes.some(v => peutParler(scenes.repliques, v, ctx)));
  if (!possibles.length) return null;
  let libres = possibles.filter(s => usage[s.id] == null || t - usage[s.id] >= delai);
  if (!libres.length) {
    if (!obligatoire) return null;
    libres = [possibles.reduce((m, s) => ((usage[s.id] ?? -1e9) < (usage[m.id] ?? -1e9) ? s : m))];
  }
  // Les scènes ancrées (mémoire récente, temps qu'il fait, voix des héros, monde du repère) passent avant les génériques.
  const ancree = s => (s.conditions.some(c => c.type === 'recent') ? 8 : 0) + (s.conditions.some(c => c.type === 'meteo' || c.type === 'saison') ? 3 : 0)
    + (s.variantes.some(v => /\{[abc]:|\{chien\}|\{bourg\}/.test(v)) ? 2 : 0);
  // Une scène déjà lue pèse moins : le joueur découvre d'abord ce qu'il n'a jamais vu.
  const poids = libres.map(s => ((s.conditions.length ? 1 : 0.6) + 2.5 * s.conditions.length + ancree(s)) / (1 + 0.6 * (ctx.vus?.[s.id] || 0)));
  let x = rng() * poids.reduce((a, b) => a + b, 0), s = libres[0];
  for (let i = 0; i < libres.length; i++) { x -= poids[i]; if (x <= 0) { s = libres[i]; break; } }
  const jouables = s.variantes.filter(v => peutParler(scenes.repliques, v, ctx));
  const variante = jouables[Math.floor(rng() * jouables.length) % jouables.length];
  const autre = k => (k === 'a' ? ctx.b : ctx.a);
  const derniere = k => evenementRecent(ctx, { quoi: 'mission', qui: k }) || {};
  const texte = variante
    .replace(/\{([abc]):([a-z_]+)\}/g, (_, k, sit) => replique(scenes.repliques, ctx[k], sit, autre(k), rng, usage, t) || '')
    .replace(/\{mission:([abc])\}/g, (_, k) => derniere(k).titre ? `la mission « ${derniere(k).titre} »` : 'la dernière mission')
    .replace(/\bde \{lieu_mission:([abc])\}/g, (_, k) => derniere(k).lieu ? Q().avecPreposition(derniere(k).lieu, 'de') : 'de là-bas')
    .replace(/\{lieu_mission:([abc])\}/g, (_, k) => derniere(k).lieu || 'là-bas')
    .replace(/\{([abc])\}/g, (_, k) => ctx[k]?.nom ?? '?')
    .replace(/\{lieu\}/g, LIBELLES_LIEUX[ctx.lieu] || 'au repère')
    .replace(/\{chien\}/g, ctx.monde?.chien || 'le chien')
    .replace(/\{bourg\}/g, ctx.monde?.bourg || 'le bourg voisin')
    .replace(/\{guilde\}/g, ctx.guilde || 'la guilde');
  return { id: s.id, importance: s.importance, effets: s.effets, texte: finir(texte) };
}

module.exports = { replique, lireScenes, lireRepliques, evenementRecent, FENETRES, chargerScenes, choisirScene, verifie, lireCondition, lireEffet, LIBELLES_LIEUX };
