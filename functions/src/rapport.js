'use strict';
/*
 * Guild Legends — rapport de mission (8 nov. 2026, audit des textes).
 *
 * L'audit a montré que les dénouements « réussite », « partielle » et « échec » sont courts (110 signes en moyenne,
 * contre 350 pour une issue éclatante), alors que ce sont eux que les joueurs lisent le plus. Plutôt que de tout réécrire,
 * le rapport raconte la mission à partir de ce qui s'est vraiment passé : la route, chaque épreuve dans l'ordre, qui l'a
 * menée, si elle a réussi de justesse ou haut la main, l'imprévu, les blessures, puis le dénouement écrit à la main,
 * et le retour. Le récit est donc toujours juste, et il change d'une mission à l'autre.
 *
 * Règle d'écriture : aucun accord de genre sur le nom d'un héros (les fiches ne donnent pas le genre).
 * Les tournures sont choisies pour s'en passer : « s'en charge », « y parvient », « n'y arrive pas »…
 */
const { avecPreposition } = require('./quetes');
const { finir } = require('./langue');

const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const choisir = (liste, graine) => liste[hash(graine) % liste.length];
const majuscule = t => t.charAt(0).toUpperCase() + t.slice(1);
const point = t => /[.!?»…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`;

function enDuree(heures) {
  if (heures < 1.5) return 'une heure';
  if (heures < 20) return `${Math.round(heures)} heures`;
  const j = Math.round(heures / 24 * 2) / 2;
  if (j <= 1) return 'une journée';
  if (j === 1.5) return 'une journée et demie';
  const n = ['', '', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'][Math.floor(j)] || String(Math.floor(j));
  return j % 1 ? `${n} jours et demi` : `${n} jours`;
}

/* La route, vue de l'extérieur (le rapport est écrit par la guilde, à la troisième personne). */
const ROUTE = {
  demacia: ["La route traverse des champs bien tenus, sous l'œil des patrouilles.", "Sur le chemin, on croise plus de soldats que de marchands. Demacia surveille ses routes."],
  noxus: ["Les routes de Noxus sont droites et pleines de légionnaires. Personne ne pose de questions à une équipe qui marche vite.", "On passe sous trois arches de victoire avant d'arriver. Noxus aime rappeler ce qu'elle a conquis."],
  freljord: ["Le froid ralentit tout le monde. On marche serrés, et on parle peu, pour garder son souffle.", "La neige efface les traces derrière l'équipe. Devant, il n'y en a aucune."],
  ionia: ["Le chemin longe des terrasses et des sanctuaires. Ici, même le vent a l'air de savoir où il va.", "Des enfants suivent l'équipe sur un bout de route, puis disparaissent entre les arbres."],
  piltover: ["L'équipe entre en ville au milieu des vitrines et des engrenages. Personne ne la regarde : à Piltover, tout le monde est pressé.", "Les ascenseurs de la ville font gagner une heure. Les files d'attente la font perdre."],
  zaun: ["Plus on descend, plus l'air devient lourd. Les foulards remontent sur les visages.", "Les passerelles de Zaun tanguent sous les pas. On apprend vite à ne pas regarder en bas."],
  shurima: ["On voyage la nuit et on s'abrite le jour : le soleil de Shurima ne pardonne pas.", "Le sable efface la piste plusieurs fois. Heureusement, il reste les étoiles."],
  targon: ["La montée est rude. On s'arrête souvent, et les arrêts deviennent de plus en plus longs.", "Plus on monte, plus le ciel est proche. Personne ne trouve ça rassurant."],
  bilgewater: ["L'équipe arrive par le port, entre les filets, les crochets et les marchands qui crient.", "À Bilgewater, on garde une main sur sa bourse et l'autre près de son arme. L'équipe fait pareil."],
  ixtal: ["La jungle se referme derrière l'équipe à chaque pas. Il faut parfois se frayer un chemin à la lame.", "Il pleut à verse, puis le soleil revient, puis il pleut de nouveau. Ixtal ne fait rien à moitié."],
  bandle: ["Les portails de Bandle sont capricieux. L'équipe en traverse trois avant de trouver le bon.", "Tout est petit, ici, sauf les ennuis. On se baisse beaucoup."],
};

/* Comment s'enchaînent les épreuves. */
const LIENS = [
  ['Il faut d\'abord {recit}.', 'Premier problème : il faut {recit}.', 'Sur place, la première chose à faire est de {recit}.'],
  ['Ensuite, il faut {recit}.', 'Reste ensuite à {recit}.', 'Puis vient le plus délicat : {recit}.'],
  ['Il faut enfin {recit}.', 'Dernière étape : {recit}.', 'Pour finir, il faut {recit}.'],
];

/* Ce qui se passe, selon le type d'épreuve et le résultat. {m} = celui ou celle qui mène, {x} = le ou la deuxième. */
const ISSUES = {
  brio: {
    _: ['{m} s\'en charge, et le fait avec une aisance qui laisse tout le monde sans voix.', '{m} prend les choses en main. C\'est réglé plus vite que prévu, et proprement.'],
    combat: ['{m} engage le combat sans attendre. Il ne dure pas : l\'adversaire n\'a jamais eu sa chance.', 'Le combat est bref. {m} a vu l\'ouverture avant tout le monde.'],
    diplomatie: ['{m} trouve les mots justes du premier coup. On l\'écoute, puis on lui donne raison.', '{m} parle peu, mais bien. À la fin, c\'est l\'autre camp qui remercie.'],
    discretion: ['{m} se fond dans le décor. Personne ne saura jamais que l\'équipe était là.'],
    poursuite: ['{m} ne perd jamais la piste. La traque est finie avant la nuit.'],
    voyage: ['{m} connaît un raccourci, ou en invente un. L\'équipe gagne une demi-journée.'],
    nuee: ['{m} organise la défense en un instant. La vague se brise sur l\'équipe sans la faire reculer.'],
    siege: ['{m} trouve le point faible du premier regard. Le reste n\'est qu\'une question d\'effort.'],
  },
  reussie: {
    _: ['{m} s\'en charge. Ce n\'est pas facile, mais {m} y parvient.', 'Ça demande du temps et de la patience. {m} finit par y arriver, avec l\'aide de {x}.'],
    combat: ['Le combat est rude. {m} tient bon, et c\'est l\'adversaire qui cède le premier.', 'Il y a des coups, de la sueur, un moment de doute. Puis {m} et {x} prennent le dessus.'],
    diplomatie: ['La discussion dure longtemps. {m} reste calme, insiste, et finit par obtenir ce qu\'il faut.', 'Il faut écouter, beaucoup, et promettre un peu. {m} s\'en sort bien.'],
    discretion: ['Il faut rester invisible, et ce n\'est pas simple. {m} y arrive, de justesse.', 'À un moment, tout manque de basculer. {m} se fige, attend, et repart au bon moment.'],
    poursuite: ['La piste se perd deux fois. Deux fois, {m} la retrouve.', '{m} suit les traces pendant des heures, sans lâcher. Ça paie.'],
    voyage: ['Le chemin est plus long que prévu, mais {m} garde le cap. L\'équipe arrive fatiguée, mais entière.'],
    nuee: ['Ils sont nombreux, bien trop nombreux. Mais {m} tient la ligne, et {x} couvre ses arrières.'],
    siege: ['Il faut s\'y reprendre à plusieurs fois. À la troisième, ça cède.'],
  },
  ratee: {
    _: ['{m} essaie, mais ça ne suffit pas.', 'Malgré les efforts de {m}, ça ne marche pas.'],
    combat: ['Le combat tourne mal. {m} doit reculer, et l\'équipe avec.', 'L\'adversaire est plus fort que prévu. {m} n\'arrive pas à reprendre l\'avantage.'],
    diplomatie: ['{m} parle, longtemps. Personne n\'écoute vraiment. La porte se referme.', 'Un mot de travers, et tout est à refaire. {m} n\'arrive pas à rattraper le coup.'],
    discretion: ['Un bruit de trop, et l\'équipe est repérée. {m} n\'a rien pu faire.'],
    poursuite: ['La piste s\'arrête net. {m} cherche jusqu\'à la nuit, sans rien trouver.'],
    voyage: ['La route est coupée, et le détour coûte cher. L\'équipe arrive trop tard.'],
    nuee: ['Ils sont trop nombreux. {m} ordonne le repli avant qu\'il soit trop tard.'],
    siege: ['Ça ne cède pas. {m} s\'y use les mains, en vain.'],
  },
  grave: {
    _: ['Ça tourne mal, très mal. L\'équipe s\'en sort, mais de justesse.'],
    combat: ['Le combat vire au désastre. On se replie dans la confusion, et tout le monde ne se relève pas tout de suite.'],
    nuee: ['La ligne craque. Pendant un long moment, personne ne sait si l\'équipe va s\'en sortir.'],
  },
};

/* Face à l'imprévu, on ne sait pas d'avance de quoi il s'agit : les tournures restent générales. */
const FACE_IMPREVU = {
  brio: ['{m} comprend tout de suite ce qu\'il faut faire. L\'équipe s\'adapte sans perdre un instant.'],
  reussie: ['Il faut tout repenser en quelques minutes. {m} trouve une solution, et l\'équipe suit.', '{m} garde son calme. Ce n\'est pas le plan prévu, mais ça marche.'],
  ratee: ['L\'équipe n\'arrive pas à s\'adapter à temps. {m} fait ce qui peut encore être fait.', 'L\'équipe est prise de court. {m} essaie de limiter les dégâts.'],
  grave: ['L\'équipe est prise de court, et elle le paie cher.'],
};
const IMPREVU = {
  surprise: ['Puis arrive l\'imprévu. {texte}', 'Et c\'est là que tout se complique. {texte}'],
  prevue: ['{e} l\'avait repéré à temps, ce qui évite le pire. {texte}', 'Heureusement, {e} avait vu venir le problème. {texte}'],
};

/*
 * mission : une mission du catalogue (missions.json), resultat : la sortie de resoudreMission,
 * opts : { calendrier, equipe: [{ nom }], eclaireur: nom, repos: heures, graine }.
 * Retourne une liste de paragraphes.
 */
function rapportMission(mission, resultat, opts = {}) {
  const gr = `${opts.graine ?? ''}#${mission.id}`, cal = opts.calendrier, equipe = opts.equipe || [];
  const noms = equipe.map(h => h.nom);
  const p = [];

  // 1. La route
  const route = [];
  if (cal && cal.aller > 0) route.push(`Après ${enDuree(cal.aller)} de route, l'équipe arrive ${avecPreposition(mission.lieu, 'a')}.`);
  else route.push(`L'équipe se rend ${avecPreposition(mission.lieu, 'a')}.`);
  if (ROUTE[mission.region] && cal?.aller > 6) route.push(choisir(ROUTE[mission.region], `${gr}#route`));
  if (mission.demandeur) {
    const qui = majuscule(mission.demandeur.split(',')[0].trim());
    route.push(mission.source === 'institution' ? 'Les instructions de la Chambre des Bannières sont claires, et le contact sur place les répète.'
      : /^les\s/i.test(qui) ? `Sur place, ${qui.charAt(0).toLowerCase() + qui.slice(1)} expliquent ce qui se passe.` : `Sur place, ${qui} explique ce qui se passe.`);
  }
  p.push(route.join(' '));

  // 2. Les épreuves, dans l'ordre
  const prevues = mission.epreuves || [], n = prevues.length;
  for (const [i, e] of (resultat.epreuves || []).entries()) {
    const m = e.meneur || noms[0] || "L'équipe";
    const x = (e.detail || []).map(d => d.nom).find(nm => nm !== m) || noms.find(nm => nm !== m);
    let phrase = '';
    if (e.complication) {
      const texte = point(mission.complication || '');
      phrase = choisir(IMPREVU[resultat.complication === 'prevue' ? 'prevue' : 'surprise'], `${gr}#imp`).replace('{e}', opts.eclaireur || m).replace('{texte}', texte) + ' ';
    } else if (prevues[i]?.recit) {
      const rang = i === 0 ? 0 : i === n - 1 && !resultat.complication ? 2 : 1;
      // Deux épreuves du milieu ne s'ouvrent jamais par la même tournure.
      phrase = LIENS[rang][(hash(`${gr}#lien`) + i) % LIENS[rang].length].replace('{recit}', prevues[i].recit) + ' ';
    }
    const brio = e.reussie && e.tirage != null && e.tirage < (e.chance / 100) * 0.3;
    const cle = e.reussie ? (brio ? 'brio' : 'reussie') : (e.grave ? 'grave' : 'ratee');
    // Seul en mission : pas de tournure qui parle d'un ou d'une deuxième.
    const filtre = l => x ? l : l.filter(t => !t.includes('{x}'));
    const banque = e.complication ? FACE_IMPREVU[cle] : filtre(ISSUES[cle][e.type] || []).length ? filtre(ISSUES[cle][e.type]) : filtre(ISSUES[cle]._);
    phrase += choisir(banque, `${gr}#iss${i}`).replace(/\{m\}/g, m).replace(/\{x\}/g, x);
    // Élision qu'un gabarit ne peut pas prévoir : « faire est de attendre » → « d'attendre ».
    p.push(phrase.replace(/\b(de|que) (?=[aeiouyéèêâîô])/g, (_, w) => `${w.slice(0, -1)}'`));
  }

  // 3. Les blessures
  const bl = resultat.blessures || [];
  if (bl.length) {
    const vus = new Map(); for (const b of bl) if (!vus.has(b.nom) || b.niveau === 'grave') vus.set(b.nom, b.niveau);
    const graves = [...vus].filter(([, n]) => n === 'grave').map(([n]) => n), legers = [...vus].filter(([, n]) => n !== 'grave').map(([n]) => n);
    const liste = l => l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l.at(-1)}` : l[0];
    const t = [];
    if (graves.length) t.push(`${liste(graves)} ${graves.length > 1 ? 'ont pris de très mauvais coups' : 'a pris un très mauvais coup'}. Il faudra du temps pour s'en remettre.`);
    if (legers.length) t.push(`${liste(legers)} ${legers.length > 1 ? 's\'en tirent' : 's\'en tire'} avec des bleus et quelques coupures.`);
    p.push(t.join(' '));
  }

  // 4. Le dénouement, écrit à la main
  const den = mission.denouements?.[resultat.issue];
  if (den) p.push(den.replace(/\{meneur\}/g, resultat.epreuves?.find(e => e.reussie)?.meneur || noms[0] || "L'équipe"));

  // 5. Le retour
  const fin = [];
  if (cal && cal.retour > 0) fin.push(`Le retour prend ${enDuree(cal.retour)}.`);
  if (opts.repos > 0) fin.push(opts.repos >= 36 ? `L'équipe rentre épuisée : il lui faudra ${enDuree(opts.repos)} de repos.` : `Au repère, tout le monde a besoin de ${enDuree(opts.repos)} de repos avant de repartir.`);
  if (fin.length) p.push(fin.join(' '));
  // Finitions : élisions autour des noms et des durées (« besoin de une journée » → « d'une journée »).
  // Le chien du repère peut apparaître dans un dénouement : sans son nom, on dit simplement « le chien ».
  return p.map(t => finir(t.replace(/\{chien\}/g, opts.chien || 'le chien').replace(/\bde (une?)\b/g, "d'$1")));
}

module.exports = { rapportMission, enDuree };
