'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — entrer dans Runeterra sans rien connaître (8 nov. 2026).
 * Présentations : une ligne par champion, affichée à la première rencontre.
 * Lexique : chaque terme du monde rencontré dans un texte peut s'ouvrir d'un toucher.
 * Principe : ne jamais expliquer avant que le joueur ait une raison de vouloir savoir.
 */
const fs = require('node:fs');
const path = require('node:path');
const DOS = path.join(CATALOGUE, 'presentations');
const lignes = f => fs.readFileSync(path.join(DOS, f), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'));

function chargerPresentations() { return Object.fromEntries(lignes('champions.txt').map(l => { const i = l.indexOf('|'); return [l.slice(0, i), l.slice(i + 1).trim()]; })); }

function chargerLexique() {
  return lignes('lexique.txt').map(l => {
    const [terme, formes, region, definition] = l.split('|');
    return { terme, formes: [terme, ...(formes ? formes.split(';').map(x => x.trim()).filter(Boolean) : [])], region, definition: definition.trim() };
  });
}

/*
 * Repère les termes du lexique dans un texte. Chaque terme n'est signalé qu'une fois par texte (sa première apparition),
 * et les formes les plus longues passent avant les plus courtes (« Placidium de Navori » avant « Navori »).
 * Retourne [{ debut, fin, terme }], trié, sans chevauchement.
 */
function reperer(texte, lexique) {
  const formes = lexique.flatMap(e => e.formes.map(f => ({ f, terme: e.terme }))).sort((a, b) => b.f.length - a.f.length);
  const pris = [], vus = new Set();
  const lettre = c => c && /[A-Za-zÀ-ÿ-]/.test(c); // l'apostrophe ne colle pas : « d'Ionia » contient bien « Ionia »
  for (const { f, terme } of formes) {
    if (vus.has(terme)) continue;
    let i = texte.indexOf(f);
    while (i >= 0) {
      const j = i + f.length;
      if (!lettre(texte[i - 1]) && !lettre(texte[j]) && !pris.some(p => i < p.fin && j > p.debut)) { pris.push({ debut: i, fin: j, terme }); vus.add(terme); break; }
      i = texte.indexOf(f, i + 1);
    }
  }
  return pris.sort((a, b) => a.debut - b.debut);
}

module.exports = { chargerPresentations, chargerLexique, reperer };
