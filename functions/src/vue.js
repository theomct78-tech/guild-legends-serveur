'use strict';
const CATALOGUE = require('./chemins');
/*
 * Guild Legends — ce que voit un joueur (8 nov. 2026).
 *
 * Construit, à partir du monde, la vue d'une guilde pour l'interface : exactement les données dont l'écran a besoin,
 * et rien de ce qui doit rester caché (le potentiel non révélé, le moral des héros des autres guildes, leurs cartes).
 * C'est le même format que la démonstration du prototype, désormais rempli par le vrai jeu.
 */
const V = require('./vie'), P = require('./progression'), M = require('./missions'), Q = require('./quetes');
const REC = require('./recrutement'), RP = require('./repere'), RG = require('./rangs'), E = require('./economie'), EQ = require('./equipement');
const MJ = require('./multijoueur'), RULES = require('./rules'), PR = require('./presentations'), W = require('./monde');
const PALETTE = require(require('node:path').join(CATALOGUE, 'personnalites/palette.json'));

let PRES = null, LEX = null;
const pres = () => (PRES ||= PR.chargerPresentations());
const lex = () => (LEX ||= PR.chargerLexique());
const COULEURS = ['#b5532f', '#4f7a5a', '#3f5f8f', '#8a5aa0', '#a8843a', '#2f7f7a', '#9a4060'];
const ACT = { repos: 'Sieste', entrainement: 'Entraînement', discussion: 'Discussion', jeux: 'Jeux', lecture: 'Lecture', ville: 'En ville', solitude: 'Au calme', recueillement: 'Recueillement', soins: 'Soins', dormir: 'Dort' };
const jour = t => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' }).format(new Date(t * 3600000));
const heure = t => V.heureLocale(t);
const trait = t => PALETTE.traits[t]?.label || t;
/* Nom de fichier d'image d'un héros : « Champion_Skin » simplifié (tools/images.py produit les mêmes noms). */
let ILLUS = null, DD = null;
/* Images d'un héros : le fichier du site s'il existe (tools/images.py), sinon l'illustration par défaut du champion
   sur Data Dragon, chargée directement par le navigateur. */
function images(cle) {
  ILLUS ||= new Set(require(require('node:path').join(CATALOGUE, 'images.json')));
  DD ||= require(require('node:path').join(CATALOGUE, 'ddragon.json'));
  const s = slug(cle);
  if (ILLUS.has(s)) return { av: `img/h/${s}-av.webp`, carte: `img/h/${s}-carte.webp` };
  const id = DD.champions[cle.split('|')[0]];
  return id ? { av: `https://ddragon.leagueoflegends.com/cdn/${DD.version}/img/champion/${id}.png`, carte: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg` } : { av: '', carte: '' };
}
const slug = cle => cle.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function ficheCombat(g, h) {
  const f = W.catalogues().parCle[h.cle];
  return P.ficheCombat({ stats: W.statsDe(h), moral: h.moral }, f.plafonds, f.potentiel, 35 + 10 * ['inconnue', 'locale', 'regionale', 'renommee', 'legendaire'].indexOf(REC.palierDe(g.niveau || 1).cle));
}

/* Une carte du courrier, avec ce que provoquerait chaque réponse (calculé sur une copie : rien n'est joué). */
function carteVue(g, c) {
  const C = W.catalogues();
  return { id: c.id, type: c.type, genre: c.genre || null, titre: c.titre, texte: c.texte || null, contexte: c.contexte || [], voix: c.voix || [], heros: c.heros, defaut: c.defaut,
    options: c.options.map(o => { const cl = JSON.parse(JSON.stringify(g)); let out = [];
      try { out = V.repondre(cl, C.scenes, c.id, o.id); } catch (e) { out = [e.message]; }
      return { ...o, consequences: out.concat(cl.chronique.slice(g.chronique.length).map(e => e.texte)) }; }),
    traduction: null };
}

function vue(monde, gid) {
  const g = monde.guildes[gid], C = W.catalogues(), palier = REC.palierDe(g.niveau || 1);
  const H = id => g.heros.find(h => h.id === id);
  const actifs = g.heros.filter(h => !['parti', 'mort'].includes(h.etat));
  // Contrats proposés à la guilde, poste par poste, avec qui peut les tenir et à quel rang.
  const contrats = W.contratsPour(monde, gid).map(c => {
    const cal = M.calendrier(g.region, c.mission, { trajet: RP.effet(g, 'trajet') });
    return { id: c.id, titre: c.mission.titre, lieu: c.mission.lieu, region: c.mission.region, accroche: c.mission.accroche, demandeur: c.mission.demandeur, postes: c.m.postes.map(p => p.type),
      po: c.mission.po, risque: c.mission.risque, cal, rang: c.m.rang, ferme: c.depart - (cal.aller || 0) - monde.t, chance: W.chanceContrat(monde, c.id),
      detailPostes: c.m.postes.map((p, i) => ({ type: p.type,
        tenu: p.heros ? { id: p.heros.id, nom: p.heros.nom, guilde: p.guilde, rang: RG.rangHeros(p.heros.stats, p.type), moi: p.guilde === gid } : null,
        candidats: actifs.map(h => { if (!M.efficacitePoste(h, p.type)) return null; const st = W.statsDe(h), v = RG.verdict({ ...h, stats: st }, p.type, c.m.rang);
          return { id: h.id, rang: v.rang, ecart: v.ecart, texte: v.texte, dispo: W.disponible(g, h), chance: W.disponible(g, h) && !p.heros ? W.chanceContrat(monde, c.id, [{ index: i, gid, heroId: h.id }]) : null }; }).filter(Boolean).sort((a, b) => a.ecart - b.ecart) })) };
  });
  // Missions en cours de la guilde
  const missionsEnCours = Object.values(monde.contrats).filter(c => c.statut === 'route' && c.m.postes.some(p => p.guilde === gid && p.heros && !p.rentre)).map(c => {
    const mes = c.m.postes.filter(p => p.guilde === gid && p.heros), cal = M.calendrier(g.region, c.mission, { trajet: RP.effet(g, 'trajet') });
    const debut = c.depart - cal.aller;
    return { id: c.id, titre: c.mission.titre, region: c.mission.region, lieu: c.mission.lieu, heros: mes.map(p => p.heros.id),
      allies: c.m.postes.filter(p => p.heros && p.guilde !== gid).map(p => ({ id: p.heros.id, nom: p.heros.nom, guilde: p.guilde, poste: p.type })),
      trajet: cal.aller, duree: cal.surPlace, total: cal.total, ecoule: Math.max(0, monde.t - debut), po: c.mission.po };
  });
  const autres = Object.values(monde.guildes).filter(o => o.id !== gid);
  const etrangers = {};
  for (const o of autres) for (const h of o.heros.filter(x => !['parti', 'mort'].includes(x.etat))) {
    const f = C.parCle[h.cle];
    etrangers[h.id] = { id: h.id, nom: h.nom, cle: h.cle, img: images(h.cle), role: h.role, guilde: o.id, traits: h.traits.map(trait), motivation: h.motivation, region: h.regions?.aime?.[0] || null,
      presentation: pres()[h.champion] || null, rang: RG.rangPrincipal(W.statsDe(h), f.role), specialites: h.specialites };
  }
  const detenteurs = monde.territoires.detenteurs;
  return {
    t: monde.t, version: monde.version, guilde: { id: g.id, nom: g.nom, devise: g.devise || '', region: g.region, niveau: g.niveau || 1, reputation: g.reputation || 0, avancement: P.avancementGuilde(g.reputation || 0), titre: g.maitre?.titre || 'maître', billetsDoux: g.maitre?.billetsDoux !== false },
    po: g.po, niveau: g.niveau || 1, capacite: RULES.capacity(g.niveau || 1), effectif: actifs.length,
    salles: RP.etatSalles(g).map(({ cle, nom, niveau, prix, effet, etat }) => ({ cle, nom, niveau, prix, effet, etat })),
    economie: { palier: palier.nom, revenu: E.revenuHebdo(palier.cle) }, chien: g.monde.chien,
    repere: { region: g.region, bourg: g.monde.bourg },
    maintenant: { jour: jour(monde.t), heure: heure(monde.t) },
    heros: actifs.map(h => { const f = C.parCle[h.cle];
      return { id: h.id, nom: h.nom, apparence: h.apparence || null, cle: h.cle, img: images(h.cle), role: h.role, etat: h.etat, lieu: h.lieu, activite: ACT[h.activite] || '', repos: h.reposJusqua > monde.t ? Math.ceil(h.reposJusqua - monde.t) : 0, blesse: Boolean(h.blesse), reserve: h.reserve || null,
        moral: Math.round(h.moral), fidelite: Math.round(h.fidelite), besoins: Object.fromEntries(Object.entries(h.besoins || {}).map(([k, v]) => [k, Math.round(v)])),
        raisons: V.raisonsMoral(g, h).slice(0, 5), traits: h.traits.map(trait), motivation: h.motivation, region: h.regions?.aime?.[0] || null, salaire: h.salaire,
        relations: actifs.filter(o => o !== h).map(o => { const r = V.relation(g, h, o); return { id: o.id, aff: Math.round(r.aff), type: r.type }; }).sort((a, b) => Math.abs(b.aff) - Math.abs(a.aff)).slice(0, 4),
        presentation: pres()[h.champion] || null, combat: ficheCombat(g, h), rang: RG.rangPrincipal(W.statsDe(h), f.role), specialites: h.specialites,
        equipement: (h.equipement || []).map(o => ({ uid: o.uid, nom: o.nom, texte: o.texte })), elixir: h.elixir?.nom || null,
        quete: g.quetes?.[h.id] ? { id: g.quetes[h.id].id, titre: (() => { try { return Q.queteDe(C.quetes, h, g.region)?.titre || null; } catch { return null; } })(), etat: g.quetes[h.id].etat, etape: g.quetes[h.id].etape, enCours: Boolean(g.quetes[h.id].enCours) } : null }; }),
    cartes: g.cartes.filter(c => c.etat === 'ouverte').map(c => carteVue(g, c)),
    traitees: g.cartes.filter(c => c.etat === 'traitee' && c.parDefaut && monde.t - c.t < 72).map(c => ({ titre: c.titre, reponse: c.options.find(o => o.id === c.reponse)?.libelle, consequences: c.consequences || [] })),
    chronique: g.chronique.slice(-150).map(e => ({ jour: jour(e.t), heure: heure(e.t), texte: e.texte, importance: e.importance, dec: e.declencheur, heros: e.heros, arc: e.titreArc || null, quete: e.declencheur === 'quete' })),
    arcs: (g.arcs?.enCours || []).map(x => ({ titre: x.titre || x.id, a: x.a, b: x.b, etape: x.etape, total: x.total || null })),
    soiree: g.soirees?.[0] ? { jour: jour(g.soirees[0].t), venus: g.soirees[0].venus || [], absents: g.soirees[0].absents || [], moments: (g.soirees[0].moments || []).map(m => m.texte) } : null,
    contrats, missionsEnCours, rapports: (g.rapports || []).slice(0, 15),
    avis: (g.avis || []).slice(0, 30).map(a => ({ ...a, jour: jour(a.t), heure: heure(a.t) })),
    candidatures: (g.candidatures || []).map(c => { const f = C.parCle[c.cle], p = C.perso[c.cle] || C.base[f.champion];
      return { cle: c.cle, nom: f.skin === 'Classic' ? f.champion : f.skin, img: images(c.cle), role: f.role, specialites: f.specialites || [], traits: (p?.traits || []).map(trait), motivation: p?.motivation,
        indice: c.tier ? ({ B: 'modeste', 'B+': 'solide', 'A-': 'prometteur', A: 'prometteur', 'A+': 'remarquable', 'S-': 'remarquable', S: 'exceptionnel', 'S+': 'exceptionnel', G: 'légendaire' }[c.tier]) : null,
        rang: RG.rangPrincipal(P.statsDeDepart(c.cle, f.plafonds), f.role), salaire: W.PARAMS.salaire[f.potentiel], expire: Math.max(0, Math.round(c.expire - monde.t)), spontanee: Boolean(c.spontanee), fondation: Boolean(c.fondation), presentation: pres()[f.champion] || null }; }),
    recrutement: { palier: palier.nom, dossiers: REC.nombreDossiers((g.niveau || 1) + 1), prixAnnonce: REC.PARAMS.prixAnnonce[palier.cle], chances: REC.CHANCES[palier.cle] },
    annonce: g.annonce?.role || null,
    inventaire: (g.inventaire || []).map(o => ({ uid: o.uid, nom: o.nom, type: o.type, texte: o.texte, recharge: o.rechargeJusqua > monde.t ? Math.ceil(o.rechargeJusqua - monde.t) : 0 })),
    pantheon: g.pantheon || [],
    registre: monde.registre.map(r => { const f = C.parCle[r.cle]; return { cle: r.cle, nom: f.skin === 'Classic' ? f.champion : f.skin, img: images(r.cle), role: f.role, depuis: r.depuis, interessee: (r.interessees || []).indexOf(gid) + 1, perdu: (r.perduPar || []).includes(gid) }; }),
    guildes: autres.map(o => ({ id: o.id, nom: o.nom, devise: o.devise || '', region: o.region, couleur: o.couleur || COULEURS[[...o.id].reduce((t, c) => t + c.charCodeAt(0), 0) % COULEURS.length], maitre: o.maitreNom || (o.maitre?.titre === 'maîtresse' ? 'une maîtresse' : 'un maître'), niveau: o.niveau || 1, palier: REC.palierDe(o.niveau || 1).nom, heros: o.heros.filter(x => !['parti', 'mort'].includes(x.etat)).map(x => x.id),
      missions: (o.rapports || []).length, regions: Object.entries(detenteurs).filter(([, d]) => d === o.id).map(([r]) => r), allie: MJ.sontAllies(monde, gid, o.id, monde.t) })),
    etrangers,
    alliances: { allies: MJ.alliesDe(monde, gid, monde.t), max: MJ.PARAMS.alliances.max[palier.cle], recues: (monde.invitations || []).filter(i => i.vers === gid && i.expire > monde.t).map(i => ({ cle: i.cle, de: i.de })), envoyees: (monde.invitations || []).filter(i => i.de === gid && i.expire > monde.t).map(i => i.vers) },
    territoires: { detenteurs, influences: MJ.influences(monde.territoires.gains, monde.t) },
    tournoi: { inscrits: Object.keys(monde.tournois.inscriptions), monEquipe: monde.tournois.inscriptions[gid] || null, frais: MJ.PARAMS.tournois.frais[palier.cle], dernier: monde.tournois.historique[0] || null },
    lexique: lex(),
  };
}

module.exports = { vue, slug };
