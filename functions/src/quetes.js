'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — quêtes personnelles (8 nov. 2026).
 * Une quête par champion, née de sa motivation. Elle s'éveille quand le héros se sent assez chez lui
 * (une semaine au repère et une fidélité suffisante), arrive comme une demande sur le bureau du maître,
 * puis se joue en deux missions personnelles, en solo, calibrées sur le héros.
 * Décision du 8 nov. 2026 : la mener à bout rapporte du moral et de la fidélité, rien d'autre.
 */
const fs = require('node:fs');
const path = require('node:path');
const { scoreEpreuve } = require('./resolution');
const M = require('./missions');
const MA = require('./maitre');

const PARAMS = {
  joursAvantEveil: 7,          // jours au repère avant que l'envie d'une quête puisse naître
  fideliteEveil: 45,           // il faut se sentir assez chez soi pour demander
  chanceEveil: 0.1,            // par jour, une fois les conditions réunies
  ecartEveils: 72,             // heures au moins entre deux quêtes qui s'éveillent dans la même guilde
  chanceEtape: 0.8,            // chance visée de réussir chaque épreuve d'une mission de quête
  moralFin: 15, demiVieFin: 24 * 14,   // le souvenir d'une quête accomplie dure longtemps
  fideliteFin: 20,
  refus: { moral: -10, fidelite: -10, attente: 24 * 30 },
  plusTard: { moral: -3, attente: 24 * 5 },
  echec: { moral: -5, tentativesMax: 2, suspension: 24 * 14, moralSuspension: -8 },
};

function lireQuetes(dossier = path.join(CATALOGUE, 'vie/quetes')) {
  const out = {};
  for (const f of fs.readdirSync(dossier).filter(n => /^(lot|gammes|motivations)\d+\.txt$/.test(n)).sort()) {
    let q = null;
    for (const l of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n')) {
      if (l.startsWith('=== ')) { const [id, titre] = l.slice(4).split('|').map(s => s.trim()); q = { id, titre }; continue; }
      if (!q || !l.trim() || l.startsWith('#')) continue;
      const i = l.indexOf(':'); const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
      q[k] = v;
      if (k === 'refus') {
        q.etapes = [1, 2].map(n => ({
          region: q[`e${n}_region`], lieu: q[`e${n}_lieu`], duree: +q[`e${n}_duree`], recit: q[`e${n}_recit`],
          epreuves: q[`e${n}_epreuves`].split(';').map(x => x.trim().split(/\s+/)[0]),
          reussite: q[`e${n}_reussite`], echec: q[`e${n}_echec`],
        }));
        let cle = q.champion || (q.gamme ? `gamme:${q.gamme}` : `motivation:${q.motivation}`);
        // Plusieurs quêtes peuvent partager une motivation : la deuxième devient « motivation:or#2 », etc.
        if (q.motivation && !q.champion && !q.gamme) for (let n = 2; out[cle]; n++) cle = `motivation:${q.motivation}#${n}`;
        out[cle] = q;
      }
    }
  }
  return out;
}
const chargerQuetes = () => lireQuetes();
const remplir = (t, h) => t.replace(/\{nom\}/g, h.nom);

/*
 * Quêtes de motivation (8 nov. 2026) : la simulation de 3 mois a montré qu'aucune recrue, ou presque, n'avait de quête.
 * Un héros sans quête de champion ni de gamme reçoit celle de sa motivation. Elle se joue dans la région qu'il aime
 * (ou celle du repère), dans des lieux tirés de la bible de cette région, toujours les mêmes pour ce héros.
 */
const BIBLES = {};
function lieuxDe(region) {
  if (!BIBLES[region]) { try { BIBLES[region] = require(require('node:path').join(CATALOGUE, `missions/bibles/${region}.json`)).lieux; } catch { BIBLES[region] = []; } }
  return BIBLES[region];
}
const NOMS_REGIONS = { demacia: 'Demacia', noxus: 'Noxus', freljord: 'Freljord', ionia: 'Ionia', piltover: 'Piltover', zaun: 'Zaun', bilgewater: 'Bilgewater', shurima: 'Shurima', targon: 'Targon', ixtal: 'Ixtal', bandle: 'Bandle' };
/* « à Bel'Zhun », « aux Docks de l'Abattoir », « au Port de Bilgewater », « à la Clairière », « à l'Arbre de Bandle ». */
const PLURIELS = /^(Docks|Grottes|Canaux|Jardins|Monts|Plaines|Ruines|Fermes|Salles|Bains|Cimetières|Hauts|Rochers|Portes|Terrains|Volières|Sculptures|Matrices|Motifs|Seuils|Pentes|Sanctuaires|Temples|Bas-quartiers|Raffineries|Bathysphères|Failles|Chemins|Bois sacrés|Îles|Archives|Remparts|Baies)\b/;
const MASCULINS = /^(Port|Pont|Puits|Temple|Quai|Grand|Village|Lac|Bosquet|Marché|Repaire|Jardin|Fleuve|Delta|Cercle|Bois|Mont|Domaine|Monastère|Placidium|Registre|Quartier|Stand|Parc|Cratère|Sanctuaire|Serpentrion|Lac|Pic|Village)\b/;
const FEMININS = /^(Place|Rue|Baie|Vallée|Cascade|Forêt|Tour|Caverne|Maison|Grande|Arche|Côte|Mer|Citadelle|Salle|Route|Plaine|Enclave|Arène|Montagne|Veille|Bibliothèque|Gazette|Forge|Porte|Falaise|Dernière|Statue|Vieille|Cité|Échoppe|Enseigne|Drague|Arcologie|Source|Oasis|Nouvelle|Ville|Mer)\b/;
function avecPreposition(lieu, p) {
  const art = /^(Les|La|Le|L')\s?/.exec(lieu);
  let a, de;
  if (art) { const reste = lieu.slice(art[0].length); const k = art[1];
    a = k === 'Le' ? `au ${reste}` : k === 'Les' ? `aux ${reste}` : k === 'La' ? `à la ${reste}` : `à l'${reste}`;
    de = k === 'Le' ? `du ${reste}` : k === 'Les' ? `des ${reste}` : k === 'La' ? `de la ${reste}` : `de l'${reste}`; }
  else if (PLURIELS.test(lieu)) { a = `aux ${lieu}`; de = `des ${lieu}`; }
  else if (FEMININS.test(lieu)) { const v = /^[AEIOUYÉÈÊÎÔ]/i.test(lieu); a = v ? `à l'${lieu}` : `à la ${lieu}`; de = v ? `de l'${lieu}` : `de la ${lieu}`; }
  else if (MASCULINS.test(lieu)) { const v = /^[AEIOUYÉÈÊÎÔ]/i.test(lieu); a = v ? `à l'${lieu}` : `au ${lieu}`; de = v ? `de l'${lieu}` : `du ${lieu}`; }
  else if (/^(Arbre|Abîme|Anneau|Ancien|Entrepôt)\b/.test(lieu)) { a = `à l'${lieu}`; de = `de l'${lieu}`; }
  else { a = `à ${lieu}`; de = /^[AEIOUYÉÈÊÎÔ]/i.test(lieu) ? `d'${lieu}` : `de ${lieu}`; }
  if (p === 'a') return a; if (p === 'A') return a[0].toUpperCase() + a.slice(1); if (p === 'de') return de;
  if (p === 'jusqua') return `jusqu'${a}`;
  if (p === 'vers') return a.replace(/^à la /, 'vers la ').replace(/^à l'/, "vers l'").replace(/^aux /, 'vers les ').replace(/^au /, 'vers le ').replace(/^à /, 'vers ');
  return lieu;
}
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function personnaliser(def, h, regionGuilde) {
  const region = (h.regions?.aime || []).find(r => lieuxDe(r).length) || regionGuilde || 'demacia';
  const L = lieuxDe(region), a = L[hash(h.id) % L.length], b = L[(hash(h.id) + 1 + hash(h.id + '#') % (L.length - 1)) % L.length];
  const sub = t => typeof t !== 'string' ? t : t.replace(/\{pays\}/g, NOMS_REGIONS[region] || region)
    .replace(/\{(a|A|de|jusqua|vers)_lieu([12])\}/g, (_, p, n) => avecPreposition(n === '1' ? a : b, p))
    .replace(/\{lieu1\}/g, a).replace(/\{lieu2\}/g, b);
  const out = Object.fromEntries(Object.entries(def).map(([k, v]) => [k, sub(v)]));
  out.etapes = def.etapes.map((e, i) => ({ ...e, region, lieu: e.lieu === '{lieu2}' ? b : e.lieu === '{lieu1}' ? a : i ? b : a, recit: sub(e.recit), reussite: sub(e.reussite), echec: sub(e.echec) }));
  return out;
}
// La quête d'un héros : celle de son champion s'il vient du Runeterra d'origine, celle de sa gamme sinon, celle de sa motivation à défaut.
const queteDe = (quetes, h, regionGuilde = null) => {
  const propre = h.univers === 'classic' ? quetes[h.champion] : quetes[`gamme:${h.univers}`];
  if (propre) return propre;
  // Plusieurs quêtes possibles pour une motivation : chaque héros reçoit toujours la même (tirage fixe sur son identifiant).
  const cles = Object.keys(quetes).filter(k => k === `motivation:${h.motivation}` || k.startsWith(`motivation:${h.motivation}#`)).sort();
  const m = cles.length ? quetes[cles[hash(`${h.id}#motivation`) % cles.length]] : null;
  return m ? personnaliser(m, h, regionGuilde) : null;
};

/*
 * La mission d'une étape, au format des missions du catalogue, avec une difficulté calibrée sur le héros :
 * chaque épreuve est réglée pour qu'il ait environ quatre chances sur cinq de la réussir à son niveau actuel.
 */
function missionDeQuete(def, n, heros, compagnon = null, regionGuilde = null) {
  const e = def.etapes[n];
  // Une étape à portée (48 h aller-retour au plus) est une mission comme les autres. Au-delà, ce n'est plus une mission :
  // c'est un grand voyage personnel (décision du 8 nov. 2026, laissée à Claude pour l'immersion). Le héros part plusieurs
  // jours, écrit depuis la route, et l'étape se joue là-bas, sans limite de 48 h ni raccourci.
  const c48 = regionGuilde ? M.calendrier(regionGuilde, { region: e.region, lieu: e.lieu, duree: e.duree }) : null;
  const voyage = Boolean(c48 && !c48.possible);
  const cal = voyage ? { aller: c48.aller, surPlace: e.duree, retour: c48.aller, total: 2 * c48.aller + e.duree, possible: true } : c48;
  const equipe = [{ nom: heros.nom, stats: heros.stats, moral: heros.moral }];
  const ecart = 7 * Math.log(PARAMS.chanceEtape / (1 - PARAMS.chanceEtape)); // pente de la résolution
  return {
    id: `${def.id}-${n + 1}`, titre: `${def.titre} (${n + 1}/2)`, source: 'quete', region: e.region, lieu: e.lieu,
    postes: compagnon ? [heros.role, compagnon.role] : [heros.role], duree: cal ? cal.surPlace : e.duree, calendrier: cal, mode: voyage ? 'voyage' : 'mission', palier: 'quete', dangereuse: false, heros: heros.id, compagnon: compagnon ? compagnon.id : null,
    epreuves: e.epreuves.map(type => ({ type, recit: e.recit, difficulte: Math.round(scoreEpreuve(equipe, { type, difficulte: 0 }).score - ecart) })),
    denouements: { eclatante: remplir(e.reussite, heros), reussite: remplir(e.reussite, heros), partielle: remplir(e.echec, heros), echec: remplir(e.echec, heros) },
  };
}

/* Une fois par jour : une quête peut s'éveiller. outils : { creerCarte, souvenir, ecrireChronique } fournis par le moteur. */
function eveillerQuetes(g, quetes, rng, outils) {
  g.quetes ||= {};
  for (const h of g.heros) {
    const def = queteDe(quetes, h, g.region);
    if (!def || h.etat !== 'present') continue;
    const q = g.quetes[h.id];
    if (q && !(q.etat === 'attente' && g.t >= q.jusqua)) continue;
    if ((g.t - (h.arrivee ?? g.t)) < PARAMS.joursAvantEveil * 24 || h.fidelite < PARAMS.fideliteEveil) continue;
    // Il faut aussi avoir gagné un minimum d'estime : on ne confie pas son passé à un maître dont on doute.
    if (MA.estime(g, h).estime < MA.SEUIL_QUETE) continue;
    if (rng() > PARAMS.chanceEveil || g.t - (g.dernierEveil ?? -1e9) < PARAMS.ecartEveils) continue;
    g.dernierEveil = g.t;
    g.quetes[h.id] = { id: def.id, etat: 'demandee', etape: 0, tentatives: 0 };
    outils.ecrireChronique({ texte: remplir(def.eveil, h), heros: [h.id], importance: 3, declencheur: 'quete', scene: `${def.id}#eveil` });
    const c = outils.creerCarte('quete', [h]);
    c.titre = `${h.nom} te demande une faveur : « ${def.titre} »`; c.texte = MA.accorder(g, remplir(def.demande, h)).replace(/\{chien\}/g, g.monde?.chien || 'le chien'); c.quete = def.id;
    // Si une étape est trop loin pour une mission, la demande le dit : ce sera un long voyage.
    const loin = g.region ? def.etapes.map(e => M.calendrier(g.region, { region: e.region, lieu: e.lieu, duree: e.duree })).filter(x => !x.possible) : [];
    if (loin.length) c.voyage = { jours: Math.ceil(Math.max(...loin.map(x => 2 * x.aller)) / 24 + 0.5) };
  }
}

/* Réponse du maître à la demande. Retourne les conséquences lisibles. */
function repondreQuete(g, h, def, option, outils) {
  const q = g.quetes[h.id], out = [];
  if (option === 'accepter') { q.etat = 'ouverte'; out.push(`La quête de ${h.nom} commence : la première mission personnelle est disponible.`); }
  if (option === 'plus_tard') { q.etat = 'attente'; q.jusqua = g.t + PARAMS.plusTard.attente; outils.souvenir(h, g.t, PARAMS.plusTard.moral, 'Sa demande remise à plus tard', 48); out.push(`${h.nom} attendra. La demande reviendra dans quelques jours.`); }
  if (option === 'refuser') {
    q.etat = 'attente'; q.jusqua = g.t + PARAMS.refus.attente;
    outils.souvenir(h, g.t, PARAMS.refus.moral, 'Sa quête refusée', 24 * 7); h.fidelite = Math.max(0, h.fidelite + PARAMS.refus.fidelite);
    outils.ecrireChronique({ texte: remplir(def.refus, h), heros: [h.id], importance: 2, declencheur: 'quete', scene: `${def.id}#refus` });
    out.push(`${h.nom} n'en reparlera pas avant longtemps.`);
  }
  return out;
}

/*
 * Un compagnon peut accompagner le héros (décision du 8 nov. 2026, laissée à Claude) : la difficulté reste calibrée
 * sur le héros seul, donc l'aide rend la mission plus sûre. Il faut que le compagnon soit au repère et qu'il ne soit
 * pas en froid avec le héros. Partager une quête rapproche, quelle qu'en soit l'issue.
 */
function peutAccompagner(g, h, c, relation) {
  if (!c || c === h) return { ok: false, raison: 'Choisis un autre héros.' };
  if (c.etat !== 'present') return { ok: false, raison: `${c.nom} n'est pas au repère.` };
  const r = relation(g, h, c);
  if (r.aff < 0 || r.tension > 40) return { ok: false, raison: `${c.nom} refuse : pas assez d'entente avec ${h.nom}.` };
  return { ok: true };
}
const LIGNES_COMPAGNON = [
  '{c} a accompagné {nom} sans poser de questions. Sur le chemin du retour, la conversation a duré tout le trajet.',
  '{c} était là, à chaque pas, pour {nom}. Ce genre de chose ne s\'oublie pas.',
  'En revenant, {nom} remercie {c} d\'un simple signe de tête. {c} comprend tout ce qu\'il veut dire.',
];

/* Fin d'une mission de quête : on avance, on réessaie, ou on suspend. */
function terminerEtape(g, h, def, issue, outils, compagnon = null) {
  const q = g.quetes[h.id], e = def.etapes[q.etape];
  if (compagnon && outils.relation) {
    const r = outils.relation(g, h, compagnon); r.aff = Math.min(100, r.aff + 8);
    outils.souvenir(compagnon, g.t, 3, `La quête de ${h.nom}`, 72); outils.souvenir(h, g.t, 3, `${compagnon.nom} à ses côtés`, 72);
    const l = LIGNES_COMPAGNON[(q.etape + q.tentatives) % LIGNES_COMPAGNON.length];
    outils.ecrireChronique({ texte: l.replace(/\{c\}/g, compagnon.nom).replace(/\{nom\}/g, h.nom), heros: [h.id, compagnon.id], importance: 2, declencheur: 'quete', scene: `${def.id}#compagnon` });
  }
  if (issue === 'eclatante' || issue === 'reussite') {
    outils.ecrireChronique({ texte: remplir(e.reussite, h), heros: [h.id], importance: 3, declencheur: 'quete', scene: `${def.id}#e${q.etape + 1}` });
    q.etape++; q.tentatives = 0;
    if (q.etape >= def.etapes.length) {
      q.etat = 'accomplie';
      outils.souvenir(h, g.t, PARAMS.moralFin, `Sa quête accomplie : ${def.titre}`, PARAMS.demiVieFin);
      h.fidelite = Math.min(100, h.fidelite + PARAMS.fideliteFin);
      outils.ecrireChronique({ texte: remplir(def.fin, h), heros: [h.id], importance: 3, declencheur: 'quete', scene: `${def.id}#fin` });
    }
    return q.etat;
  }
  outils.ecrireChronique({ texte: remplir(e.echec, h), heros: [h.id], importance: 2, declencheur: 'quete', scene: `${def.id}#e${q.etape + 1}x` });
  if (issue === 'partielle') return q.etat;             // on recommence, sans regret
  q.tentatives++;
  outils.souvenir(h, g.t, PARAMS.echec.moral, 'Une étape de sa quête manquée', 48);
  if (q.tentatives >= PARAMS.echec.tentativesMax) {
    q.etat = 'attente'; q.jusqua = g.t + PARAMS.echec.suspension; q.etape = q.etape; q.tentatives = 0;
    outils.souvenir(h, g.t, PARAMS.echec.moralSuspension, 'Sa quête en suspens', 24 * 7);
  }
  return q.etat;
}

module.exports = { PARAMS, avecPreposition, chargerQuetes, lireQuetes, queteDe, peutAccompagner, missionDeQuete, eveillerQuetes, repondreQuete, terminerEtape };
