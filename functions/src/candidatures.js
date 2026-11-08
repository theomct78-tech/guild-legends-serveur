'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — composition des dossiers de candidature (8 nov. 2026).
 * Un dossier = l'identité du héros, son univers, sa personnalité, son histoire, une compétence connue, une condition,
 * et une lettre écrite dans sa voix, avec un indice sur son potentiel qui n'est jamais une certitude.
 */
const fs = require('node:fs');
const path = require('node:path');

const CAT = CATALOGUE;
const lireJson = f => JSON.parse(fs.readFileSync(path.join(CAT, f), 'utf8'));

const PARAMS = {
  bruitIndice: 0.25,   // une fois sur quatre, l'indice vient du palier voisin : le flair reste un pari
};

const REGIONS = { bandle: 'Bandle', bilgewater: 'Bilgewater', demacia: 'Demacia', freljord: 'le Freljord', ionia: 'Ionia', ixtal: 'Ixtal', noxus: 'Noxus', piltover: 'Piltover', shurima: 'Shurima', targon: 'Targon', zaun: 'Zaun', neant: 'le Néant', iles: 'les Îles obscures' };
const MOTIVATIONS = { or: 'L\'or', gloire: 'La gloire', cause: 'Une cause', vengeance: 'La vengeance', savoir: 'Le savoir', proteger: 'Protéger', pouvoir: 'Le pouvoir', liberte: 'La liberté', redemption: 'La rédemption', appartenance: 'Trouver sa place', plaisir: 'Le plaisir' };
const PALIERS = ['B', 'A', 'S', 'G'];

function chargerDossiers(dossier = path.join(CAT, 'candidatures/champions')) {
  const out = {};
  for (const f of fs.readdirSync(dossier).filter(n => /^lot\d+\.txt$/.test(n)).sort()) {
    for (const l of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue;
      const [champion, registre, support, histoire, presentation, condition, signature] = l.split('|');
      out[champion] = { registre, support, histoire, presentation, condition, signature };
    }
  }
  return out;
}

function chargerTout() {
  const fiches = {};
  for (const f of lireJson('fiches.json')) fiches[`${f.champion}|${f.skin}`] = f;
  const passifs = {};
  for (const f of fs.readdirSync(path.join(CAT, 'avantages')).filter(n => /^lot\d+\.txt$/.test(n))) {
    for (const l of fs.readFileSync(path.join(CAT, 'avantages', f), 'utf8').split('\n')) {
      const [c, cle, , phrase] = l.split('|');
      if (cle === 'P' && phrase) passifs[c] = phrase.trim();
    }
  }
  return {
    fiches, passifs, dossiers: chargerDossiers(),
    fragments: lireJson('candidatures/fragments.json'), univers: lireJson('candidatures/gammes-univers.json'),
    personnalites: lireJson('personnalites/personnalites-heros.json'), palette: lireJson('personnalites/palette.json'),
    base: lireJson('personnalites/personnalites.json'),
  };
}

const choisir = (liste, rng) => liste[Math.floor(rng() * liste.length) % liste.length];
const palierIndice = potentiel => potentiel === 'G' ? 'G' : potentiel[0];

/* Palier de l'indice : le vrai, ou parfois un voisin (jamais deux crans d'écart). */
function palierAffiche(potentiel, rng) {
  const i = PALIERS.indexOf(palierIndice(potentiel));
  if (rng() >= PARAMS.bruitIndice) return PALIERS[i];
  const j = rng() < 0.5 ? i - 1 : i + 1;
  return PALIERS[Math.max(0, Math.min(PALIERS.length - 1, j))];
}

/* Compose le dossier d'un héros. cle : « Champion|Skin ». rng : fonction 0..1 (injectée pour les tests). */
function composerDossier(D, cle, rng = Math.random) {
  const f = D.fiches[cle]; if (!f) throw new Error(`Héros inconnu : ${cle}`);
  const d = D.dossiers[f.champion]; if (!d) throw new Error(`Pas de dossier pour ${f.champion}`);
  const p = D.personnalites[cle];
  const base = D.base[f.champion];
  const g = f.gamme && D.univers[f.gamme];
  const classique = f.skin === 'Classic';
  const nom = classique ? f.champion : f.skin;
  const palier = palierAffiche(f.potentiel, rng);
  // La lettre est celle que le champion a écrite, en entier, sans phrase rapportée d'ailleurs. Le potentiel ne se lit
  // jamais dans sa bouche : c'est une rumeur notée au dossier par la Chambre, à la troisième personne, sans accord de genre.
  const lettre = [d.presentation];
  if (g) lettre.push(g.phrase);
  const rumeur = choisir(D.fragments.indices._narrateur[palier], rng);
  return {
    cle, nom, champion: f.champion, skin: f.skin,
    titre: classique ? null : f.champion,
    origine: REGIONS[base.regions.aime[0]] || 'inconnue',
    univers: g ? g.univers : classique ? 'Runeterra, version d\'origine' : 'Une version singulière de ' + f.champion,
    support: g ? g.support : d.support,
    role: f.role + (f.role_secondaire ? ' / ' + f.role_secondaire : ''), specialites: f.specialites,
    traits: p.traits.map(t => D.palette.traits[t].label), motivation: MOTIVATIONS[p.motivation],
    histoire: (g ? g.univers.split(' :')[0] + '. ' : '') + d.histoire,
    competence: D.passifs[f.champion] || null,
    condition: d.condition || null,
    lettre, rumeur, signature: classique ? d.signature : nom,
    registre: d.registre,
  };
}

module.exports = { PARAMS, chargerTout, chargerDossiers, composerDossier, palierAffiche };
