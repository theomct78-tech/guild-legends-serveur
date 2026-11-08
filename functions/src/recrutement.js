'use strict';
/*
 * Guild Legends — arrivée des candidatures (décisions de Théo, 8 nov. 2026).
 *
 * - À chaque montée de niveau, de 3 à 10 dossiers selon le niveau (recueil § 6.2), tirés au hasard : rien ne comble
 *   automatiquement les manques (§ 6.1). Un héros ciblé depuis le Registre remplace un dossier aléatoire (§ 6.5).
 * - Hors montée de niveau, chaque jour, un héros tiré au sort a 10 % de chances de candidater (candidature spontanée).
 *   Il peut être de n'importe quel rôle et de n'importe quel rang, sauf G avant la Renommée.
 * - Le tier (potentiel maximal) suit le palier de réputation : les hauts rangs sont rares au départ, jamais impossibles
 *   (§ 6.3), et deviennent plus fréquents avec la réputation et l'ancienneté de la guilde.
 * - Annonce à la Chambre des Bannières : contre des PO, elle affiche qu'on cherche un rôle. À la montée de niveau
 *   suivante, la chance d'avoir au moins un candidat de ce rôle gagne 10 points. Le tier n'est jamais montré au joueur
 * (le dossier n'en donne qu'un indice) ; il se révèle à l'approche du sommet (progression.js).
 */

const PARAMS = {
  chanceParJour: 0.10,     // une chance par jour, tirée une fois par guilde et par jour
  expiration: 24,          // heures pour répondre à une candidature spontanée (décision du 8 nov. 2026)
  // Dossiers de montée de niveau : 72 h, le temps de les comparer (proposition de Claude, 8 nov. 2026, point 5)
  expirationMontee: 72,
  bonusAnnonce: 0.10,      // +10 points de chance d'avoir au moins un candidat du rôle annoncé
  // Prix de l'annonce selon le palier (proposition de Claude, à valider) : de quoi y réfléchir à deux fois
  prixAnnonce: { inconnue: 80, locale: 200, regionale: 450, renommee: 1000, legendaire: 2000 },
  // Ancienneté : les hauts rangs (A+ et plus) deviennent plus fréquents, jusqu'à × 2 après 240 jours (proposition)
  ancienneteMax: 2, joursAnciennete: 240,
  // Le rang G n'apparaît qu'à partir de ce palier (proposition : Renommée)
  palierG: 'renommee',
};
// Nombre de dossiers à la montée de niveau (recueil § 6.2)
const NOMBRE = [[4, 3], [9, 4], [14, 5], [19, 6], [24, 7], [29, 8], [34, 9], [50, 10]];
const nombreDossiers = niveau => NOMBRE.find(([n]) => niveau <= n)[1];

// Paliers de réputation validés le 7 nov. 2026, par niveau de guilde.
const PALIERS = [
  { cle: 'inconnue', nom: 'Inconnue', niveaux: [1, 5] },
  { cle: 'locale', nom: 'Locale', niveaux: [6, 12] },
  { cle: 'regionale', nom: 'Régionale', niveaux: [13, 20] },
  { cle: 'renommee', nom: 'Renommée', niveaux: [21, 35] },
  { cle: 'legendaire', nom: 'Légendaire', niveaux: [36, 50] },
];
const palierDe = niveau => PALIERS.find(p => niveau <= p.niveaux[1]) || PALIERS.at(-1);

// Chances (en %) du tier du candidat selon le palier de la guilde. Proposition de Claude, à valider.
const TIERS = ['B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+', 'G'];
// Jamais nulles (recueil § 6.3), sauf G avant la Renommée.
const CHANCES = {
  inconnue:   { B: 26, 'B+': 40, 'A-': 22, A: 8, 'A+': 2.5, 'S-': 1, S: 0.4, 'S+': 0.1 },
  locale:     { B: 10, 'B+': 28, 'A-': 32, A: 19, 'A+': 7, 'S-': 2.5, S: 1, 'S+': 0.5 },
  regionale:  { B: 4, 'B+': 12, 'A-': 24, A: 28, 'A+': 18, 'S-': 9, S: 3.5, 'S+': 1.5 },
  renommee:   { B: 1, 'B+': 5, 'A-': 12, A: 18, 'A+': 24, 'S-': 20, S: 11, 'S+': 8, G: 1 },
  legendaire: { B: 0.5, 'B+': 2, 'A-': 6, A: 12, 'A+': 18, 'S-': 22, S: 18, 'S+': 17, G: 4.5 },
};
const HAUTS = new Set(['A+', 'S-', 'S', 'S+', 'G']);

/* Générateur déterministe : la même guilde, le même jour, tire toujours le même résultat (rejouable côté serveur). */
function rng(graine) {
  let h = 2166136261;
  for (const c of String(graine)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function tirerTier(palier, r, jours = 0) {
  const k = 1 + (PARAMS.ancienneteMax - 1) * Math.min(1, jours / PARAMS.joursAnciennete);
  const table = Object.fromEntries(Object.entries(CHANCES[palier]).map(([t, w]) => [t, HAUTS.has(t) ? w * k : w]));
  let x = r() * Object.values(table).reduce((a, b) => a + b, 0);
  for (const [tier, w] of Object.entries(table)) { x -= w; if (x < 0) return tier; }
  return Object.keys(table).at(-1);
}

const cleDe = f => `${f.champion}|${f.skin}`;
const gOK = (palier, f) => f.potentiel !== 'G' || PALIERS.findIndex(p => p.cle === palier) >= PALIERS.findIndex(p => p.cle === PARAMS.palierG);

/* Un dossier : un tier tiré selon la réputation et l'ancienneté, puis un héros libre de ce tier (on glisse au tier voisin s'il n'y en a plus). */
function tirerDossier(fiches, pris, palier, r, jours, filtre = () => true) {
  const voulu = tirerTier(palier, r, jours), i = TIERS.indexOf(voulu);
  const ordre = TIERS.map((_, k) => k).sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b);
  for (const k of ordre) {
    const libres = fiches.filter(f => f.potentiel === TIERS[k] && !pris.has(cleDe(f)) && gOK(palier, f) && filtre(f));
    if (libres.length) { const f = libres[Math.floor(r() * libres.length)]; pris.add(cleDe(f)); return f; }
  }
  return null;
}
const indispo = (g, indisponibles) => new Set([...indisponibles, ...[...(g.heros || []), ...(g.candidatures || [])].map(x => x.cle)]);
const joursDe = (g, jour) => Math.max(0, jour - Math.floor((g.fondee ?? jour * 24) / 24));

/*
 * La candidature spontanée du jour, ou null. g : { id, niveau, fondee (heure de fondation), heros: [{ cle }], candidatures: [{ cle }] }.
 * fiches : catalogue ({ champion, skin, potentiel, role }). jour : numéro du jour.
 * Unicité globale (recueil § 6.6) : `indisponibles` = héros de toutes les guildes, du Registre (on ne l'obtient qu'en s'y
 * positionnant) et candidatures en attente ailleurs (Set de clés « champion|skin »).
 */
function candidatureDuJour(g, fiches, jour, indisponibles = new Set()) {
  const r = rng(`${g.id}#candidature#${jour}`);
  if (r() >= PARAMS.chanceParJour) return null;
  const palier = palierDe(g.niveau || 1).cle;
  const f = tirerDossier(fiches, indispo(g, indisponibles), palier, r, joursDe(g, jour));
  return f && { cle: cleDe(f), tier: f.potentiel, role: f.role, palier, spontanee: true, recue: jour * 24, expire: jour * 24 + PARAMS.expiration };
}

/* Poser une annonce à la Chambre des Bannières : elle vaut pour la prochaine montée de niveau. */
function poserAnnonce(g, role) {
  const prix = PARAMS.prixAnnonce[palierDe(g.niveau || 1).cle];
  if ((g.po ?? 0) < prix) throw new Error(`L'annonce coûte ${prix} PO : le coffre n'y suffit pas.`);
  if (g.annonce) throw new Error(`Une annonce est déjà affichée (${g.annonce.role}).`);
  g.po -= prix; g.annonce = { role, prix };
  return g.annonce;
}

/*
 * Les dossiers d'une montée de niveau. ciblees : clés des héros du Registre pour lesquels la guilde est prioritaire
 * (chacun remplace un dossier aléatoire). L'annonce, s'il y en a une, ajoute 10 points à la chance d'avoir au moins un
 * candidat du rôle demandé ; elle est retirée ensuite.
 */
function candidaturesMonteeNiveau(g, fiches, niveau, jour, { indisponibles = new Set(), ciblees = [] } = {}) {
  const r = rng(`${g.id}#montee#${niveau}`), palier = palierDe(niveau).cle, jours = joursDe(g, jour);
  const pris = indispo(g, indisponibles), n = nombreDossiers(niveau);
  const dossiers = ciblees.slice(0, n).map(cle => { pris.add(cle); const f = fiches.find(x => cleDe(x) === cle); return { f, ciblee: true }; }).filter(d => d.f);
  while (dossiers.length < n) { const f = tirerDossier(fiches, pris, palier, r, jours); if (!f) break; dossiers.push({ f }); }
  const a = g.annonce;
  if (a) {
    const aleatoires = dossiers.filter(d => !d.ciblee);
    if (aleatoires.length && !dossiers.some(d => d.f.role === a.role)) {
      // Chance naturelle d'en avoir au moins un : 1 - (1 - part du rôle)^n. On complète pour gagner exactement 10 points.
      const libres = fiches.filter(f => !pris.has(cleDe(f))), part = libres.filter(f => f.role === a.role).length / (libres.length || 1);
      const naturel = 1 - Math.pow(1 - part, aleatoires.length);
      if (r() < Math.min(1, PARAMS.bonusAnnonce / Math.max(1e-6, 1 - naturel))) {
        const remplace = aleatoires[Math.floor(r() * aleatoires.length)];
        const f = tirerDossier(fiches, pris, palier, r, jours, x => x.role === a.role);
        if (f) remplace.f = f, remplace.annonce = true;
      }
    }
    g.annonce = null;
  }
  return dossiers.map(d => ({ cle: cleDe(d.f), tier: d.f.potentiel, role: d.f.role, palier, ciblee: Boolean(d.ciblee), parAnnonce: Boolean(d.annonce), recue: jour * 24, expire: jour * 24 + PARAMS.expirationMontee }));
}

module.exports = { PARAMS, PALIERS, CHANCES, TIERS, palierDe, nombreDossiers, tirerTier, candidatureDuJour, candidaturesMonteeNiveau, poserAnnonce, rng };
