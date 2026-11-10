'use strict';
/*
 * Guild Legends — le regard des héros sur le maître de guilde (8 nov. 2026, demande de Théo).
 *
 * « Il faut savoir se montrer dur, compatissant, gentil, empathique… et ça change le regard de certains héros sur nous.
 *   Tout dépend du héros et de la situation. Le jeu ne doit pas être trop facile. »
 *
 * Chaque réponse du maître a un ton (ferme, dur, juste, compatissant, à l'écoute, généreux, complice, rusé, laxiste,
 * absent quand il ne répond pas). Chaque héros juge ce ton selon sa personnalité : Darius respecte la fermeté et méprise
 * la faiblesse, Lux attend de la compassion, Jinx déteste l'autorité, un mercenaire aime qu'on paie. Les héros concernés
 * jugent fort ; les autres l'apprennent et jugent aussi, moins fort. Il n'y a donc presque jamais de bonne réponse pour
 * tout le monde.
 *
 * L'estime (0 à 100, 50 au départ) pèse sur le moral, sur la fidélité, et il en faut assez pour qu'un héros confie sa
 * quête. Le joueur la lit en mots (« se méfie de toi », « te respecte »), jamais en chiffres, avec ce qui l'a marqué.
 */
const borne = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

// Ce que chaque trait pense de chaque ton (sur une échelle d'environ −6 à +6).
const GOUTS = {
  ferme:        { LOYAL: 3, HONORABLE: 2, IMPLACABLE: 3, FIER: 1, REBELLE: -4, LIBRE: -3, FARCEUR: -1, MERCENAIRE: 1 },
  dur:          { IMPLACABLE: 4, SANGUINAIRE: 3, BIENVEILLANT: -4, MELANCOLIQUE: -3, IDEALISTE: -2, ENJOUE: -2, PROTECTEUR: -2, REBELLE: -3, FIER: -1, HANTE: -2 },
  juste:        { HONORABLE: 4, IDEALISTE: 3, LOYAL: 1, PATIENT: 2, CALCULATEUR: 1, CYNIQUE: 1 },
  compatissant: { BIENVEILLANT: 4, MELANCOLIQUE: 4, HANTE: 3, IDEALISTE: 2, PROTECTEUR: 2, ENJOUE: 1, IMPLACABLE: -3, SANGUINAIRE: -2, CYNIQUE: -1 },
  ecoute:       { MELANCOLIQUE: 3, TACITURNE: 2, PATIENT: 3, BIENVEILLANT: 2, ERUDIT: 1, HANTE: 2, MEFIANT: 1, IMPULSIF: -1 },
  genereux:     { CUPIDE: 5, MERCENAIRE: 4, GOURMAND: 3, JOUEUR: 2, ENJOUE: 1, CALCULATEUR: -2, ARISTOCRATE: 1 },
  complice:     { FARCEUR: 4, ENJOUE: 3, JOUEUR: 2, BAVARD: 2, CHARMEUR: 2, ARISTOCRATE: -2, FANATIQUE: -2 },
  ruse:         { CALCULATEUR: 4, CHARMEUR: 2, JOUEUR: 1, HONORABLE: -3, IDEALISTE: -2, FANATIQUE: -1 },
  laxiste:      { LIBRE: 3, REBELLE: 2, FARCEUR: 1, LOYAL: -2, HONORABLE: -1, IMPLACABLE: -3, FIER: -1 },
  absent:       { LIBRE: 1, REBELLE: 1, LOYAL: -3, MELANCOLIQUE: -2, IDEALISTE: -2, PROTECTEUR: -1 },
};
// Les axes comptent aussi : la discipline aime la fermeté, l'altruisme la compassion, l'ambition la générosité.
function gout(h, ton) {
  const A = h.axes;
  let v = h.traits.reduce((t, tr) => t + (GOUTS[ton]?.[tr] || 0), 0);
  if (ton === 'ferme') v += (A.Di - 50) / 15;
  if (ton === 'dur') v += (A.Al < 35 ? 1 : 0) - (A.Al > 70 ? 1.5 : 0);
  if (ton === 'compatissant' || ton === 'ecoute') v += (A.Al - 50) / 18;
  if (ton === 'laxiste') v -= (A.Di - 50) / 15;
  if (ton === 'genereux') v += (h.motivation === 'or' ? 3 : 0) + (A.Am - 50) / 30;
  if (ton === 'complice') v += (A.So - 50) / 20;
  if (ton === 'absent') v -= h.motivation === 'appartenance' ? 2 : 0;
  return v;
}

const ESTIME_DEPART = h => 50 + (h.traits.includes('LOYAL') ? 6 : 0) - (h.traits.includes('MEFIANT') ? 10 : 0) - (h.traits.includes('REBELLE') || h.traits.includes('LIBRE') ? 5 : 0) - (h.traits.includes('CYNIQUE') ? 4 : 0);

function estime(g, h) { g.regard ||= {}; return (g.regard[h.id] ||= { estime: ESTIME_DEPART(h), marques: [] }); }

/*
 * Le maître a pris une décision sur un ton donné.
 * concernes : [{ h, poids }] — ceux que la décision touche (poids 1 à 3 ; négatif si la décision va contre eux).
 * motif : ce que les héros retiendront (« ta dureté envers Jinx »).
 * Retourne des lignes de récit : qui a réagi, et comment.
 */
function juger(g, ton, concernes, motif, rng = Math.random, { prive = false } = {}) {
  const lignes = [], reactions = [];
  const touches = new Map(concernes.map(c => [c.h.id, c]));
  // Lassitude : le même geste répété dans la semaine impressionne de moins en moins (une tournée par jour ne fait pas un grand maître).
  const cle = String(motif || '').replace(/ [A-ZÀ-Ý][\wÀ-ÿ' -]*$/, '');
  g.gestes = (g.gestes || []).filter(x => g.t - x.t < 168);
  const lassitude = Math.pow(0.6, g.gestes.filter(x => x.cle === cle).length); g.gestes.push({ t: g.t, cle });
  for (const h of g.heros) {
    if (h.etat === 'parti' || h.etat === 'mort') continue;
    const c = touches.get(h.id);
    const temoin = !c;
    if (temoin && prive) continue; // un billet reste entre l'auteur et le maître
    if (temoin && h.etat !== 'present' && rng() < 0.5) continue; // les absents l'apprennent… ou pas
    // Pour celui qui est concerné, l'issue compte plus que la manière : être désavoué fait mal, même avec fermeté.
    let d = gout(h, ton) * (temoin ? 0.5 : 0.6) * lassitude;
    if (c) d += c.poids * 5;
    d = Math.round(d * 10) / 10;
    if (Math.abs(d) < 0.5) continue;
    const r = estime(g, h);
    r.estime = borne(r.estime + d);
    if (Math.abs(d) >= 2) { r.marques.unshift({ t: g.t, texte: motif, sens: Math.sign(d) }); r.marques = r.marques.slice(0, 3); }
    reactions.push({ h, d, temoin });
  }
  // Le récit retient les réactions les plus fortes, les concernés d'abord.
  reactions.sort((x, y) => (x.temoin - y.temoin) || Math.abs(y.d) - Math.abs(x.d));
  const conc = reactions.filter(x => !x.temoin && Math.abs(x.d) >= 1.5), tem = reactions.filter(x => x.temoin && Math.abs(x.d) >= 1.5).slice(0, 2);
  for (const x of [...conc, ...tem]) lignes.push(ligneReaction(x, rng));
  return lignes;
}

const LIGNES = {
  fortPlus: ['{h} te regarde autrement, désormais. Avec du respect.', '{h} te fait un signe de tête appuyé en sortant. Ça ne lui ressemble pas.', 'Plus tard, {h} glisse : « Bien joué. Vraiment. »'],
  plus: ['{h} approuve en silence.', '{h} hoche la tête : la réponse lui convient.', 'Un petit sourire passe sur le visage de {h}.'],
  moins: ['{h} ne cache pas sa déception.', '{h} hausse les épaules et quitte la pièce.', '{h} échange un regard lourd avec les autres.'],
  fortMoins: ['{h} serre la mâchoire et sort sans un mot. Ça laissera des traces.', 'Le soir même, {h} dit à qui veut l\'entendre que tu n\'es pas à la hauteur.', '{h} te fixe longtemps. Quelque chose vient de se casser.'],
};
const LIGNES_TEMOINS = {
  plus: ['{h}, qui a tout entendu depuis le couloir, approuve d\'un hochement de tête.', 'Dans la salle commune, {h} raconte ta décision avec un certain respect.', '{h} l\'apprend au dîner et lève sa chope dans ta direction.'],
  moins: ['{h}, qui a tout entendu depuis le couloir, fronce les sourcils.', 'Dans la salle commune, {h} raconte ta décision d\'un ton qui n\'a rien d\'un compliment.', '{h} l\'apprend au dîner et repose sa chope sans un mot.'],
};
function ligneReaction({ h, d, temoin }, rng) {
  if (temoin) return LIGNES_TEMOINS[d > 0 ? 'plus' : 'moins'][Math.floor(rng() * 3) % 3].replace('{h}', h.nom);
  const cle = d >= 4 ? 'fortPlus' : d > 0 ? 'plus' : d <= -4 ? 'fortMoins' : 'moins';
  return LIGNES[cle][Math.floor(rng() * 3) % 3].replace('{h}', h.nom);
}

/* Ce que le joueur voit : des mots, jamais de chiffre. */
function regardEnMots(g, h) {
  const r = estime(g, h), e = r.estime;
  const mot = e < 20 ? 'Te méprise' : e < 35 ? 'Se méfie de toi' : e < 48 ? 'Doute de toi' : e < 58 ? 'Te jauge encore' : e < 70 ? 'Te respecte' : e < 85 ? 'Te fait confiance' : 'Te suivrait n\'importe où';
  return { mot, marques: r.marques.map(m => ({ texte: m.texte, sens: m.sens })) };
}

/* Effets de l'estime : une raison de moral, une pente de fidélité, et le seuil pour confier sa quête. */
const raisonEstime = (g, h) => { const e = estime(g, h).estime; const v = Math.round((e - 50) / 6); return v ? { libelle: v > 0 ? 'Son estime pour le maître' : 'Ses griefs contre le maître', valeur: v } : null; };
const penteFidelite = (g, h) => (estime(g, h).estime - 50) / 40;
const SEUIL_QUETE = 45;

/*
 * Maître ou maîtresse : les textes sont écrits au masculin (« le maître de guilde ») et accordés ici, au moment de les écrire
 * dans la guilde, selon le titre choisi par le joueur à la fondation.
 */
const ACCORDS = [
  [/\bdu maître de guilde\b/g, 'de la maîtresse de guilde'], [/\bau maître de guilde\b/g, 'à la maîtresse de guilde'],
  [/\ble maître de guilde\b/g, 'la maîtresse de guilde'], [/\bLe maître de guilde\b/g, 'La maîtresse de guilde'],
  [/\bdu maître\b/g, 'de la maîtresse'], [/\bau maître\b/g, 'à la maîtresse'], [/\ble maître\b/g, 'la maîtresse'], [/\bLe maître\b/g, 'La maîtresse'],
  [/\bun maître de guilde\b/g, 'une maîtresse de guilde'], [/« maître »/g, '« maîtresse »'],
];
function accorder(g, texte) {
  if (typeof texte !== 'string' || g?.maitre?.titre !== 'maîtresse') return texte;
  return ACCORDS.reduce((t, [re, v]) => t.replace(re, v), texte);
}

/*
 * Pourquoi ce regard, et comment le faire évoluer : ce que le joueur lit quand il touche « ses griefs » ou « son estime ».
 * Le point de départ dépend du caractère (un héros méfiant ou rebelle arrive avec des réserves) ; ensuite, chaque décision
 * du maître compte, selon le ton qu'il ou elle apprécie.
 */
const TONS = { ferme: 'la fermeté', dur: 'la dureté', juste: 'les décisions justes', compatissant: 'la compassion', ecoute: 'l\'écoute',
  genereux: 'la générosité', complice: 'la complicité', ruse: 'la ruse', laxiste: 'le laisser-faire', absent: 'les silences (ne pas répondre)' };
const DEPART_TRAITS = { MEFIANT: 'se méfie par nature de toute autorité nouvelle', REBELLE: 'n\'aime pas recevoir d\'ordres', LIBRE: 'supporte mal qu\'on décide à sa place',
  CYNIQUE: 'ne croit pas aux beaux discours d\'un maître de guilde', LOYAL: 'accorde volontiers sa confiance à qui l\'accueille' };
function regardExplique(g, h) {
  const r = regardEnMots(g, h), e = estime(g, h).estime;
  const depart = Object.keys(DEPART_TRAITS).filter(t => h.traits.includes(t)).map(t => DEPART_TRAITS[t]);
  const scores = Object.keys(TONS).map(t => [t, gout(h, t)]).sort((a, b) => b[1] - a[1]);
  return { ...r, niveau: e < 48 ? 'griefs' : e > 52 ? 'estime' : 'neutre',
    depart: accorder(g, depart.length ? `Dès son arrivée, ${h.nom} ${depart.join(', et ')}.` : `À son arrivée, ${h.nom} ne te connaissait pas : ni confiance, ni méfiance.`),
    aime: scores.filter(x => x[1] >= 1.5).slice(0, 3).map(x => TONS[x[0]]), deteste: scores.filter(x => x[1] <= -1.5).slice(-3).reverse().map(x => TONS[x[0]]) };
}

module.exports = { accorder, GOUTS, gout, estime, juger, regardEnMots, regardExplique, raisonEstime, penteFidelite, SEUIL_QUETE };
