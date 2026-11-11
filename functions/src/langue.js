'use strict';
/*
 * Guild Legends — finitions de la langue, appliquées à tout texte composé (scènes, lettres, rapports, avis).
 * Les textes sont écrits à la main ; ce module ne corrige que ce que l'assemblage d'un nom dans une phrase abîme :
 * « de Ahri » → « d'Ahri », « que Ezreal » → « qu'Ezreal », la majuscule en début de phrase, les espaces doublées.
 */
const VOYELLE = '[AEIOUÉÈÊËÂÎÏÔÛ]';
function finir(t) {
  if (typeof t !== 'string') return t;
  return t
    .replace(new RegExp(`(?<![\\p{L}])(de|que|lorsque|puisque|jusque|presque) (${VOYELLE})`, 'gu'), (_, m, v) => `${m.slice(0, -1)}'${v}`)
    .replace(new RegExp(`(?<![\\p{L}])(De|Que|Lorsque|Puisque|Jusque) (${VOYELLE})`, 'gu'), (_, m, v) => `${m.slice(0, -1)}'${v}`)
    .replace(/(^|[.!?] |[.!?…] ?» )([a-zàâéèêîôû])/g, (_, a, c) => a + c.toUpperCase())
    .replace(/ {2,}/g, ' ').trim();
}
/* Seulement l'élision, pour les répliques du fil : elles sont écrites telles quelles (Fiddlesticks écrit sans majuscules). */
function elider(t) {
  return t.replace(new RegExp(`(?<![\\p{L}])(de|que|lorsque|puisque|jusque|presque|De|Que) (${VOYELLE})`, 'gu'), (_, m, v) => `${m.slice(0, -1)}'${v}`);
}
module.exports = { finir, elider };
