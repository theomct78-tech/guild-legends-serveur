# Format des missions

Une mission = un objet JSON, écrit à la main, rangé par région et par palier : `catalogue/missions/<region>/p<palier>-<lot>.json` (tableau de missions).

| Champ | Contenu |
|---|---|
| `id` | `DEM-1-001` : région, palier, numéro. Unique sur toute la base. |
| `titre` | Unique sur toute la base. |
| `source` | `privee` ou `institution`. |
| `region`, `palier` | Région de la bible ; palier 1 (Inconnue) à 5 (Légendaire). |
| `type` | enquete, escorte, chasse, sauvetage, livraison, garde, mediation, recherche, nuisibles, infiltration, voyage. Au plus 20 % d'un même type par lot de 50. |
| `ton` | drole, tragique, politique, horreur, aventure, tendre, mystere. Au moins 5 tons différents par lot. |
| `lieu` | Un lieu de la bible régionale (liste fermée dans `tools/verifier_missions.py`). |
| `demandeur` | `{ nom, qualite }` : un habitant inventé, jamais un champion. |
| `accroche` | Sa demande, dans sa voix, entre guillemets français. |
| `contexte` | Deux ou trois phrases : ce que la guilde sait en acceptant. |
| `postes` | Postes du moteur (`missions.js`) : Tank, DPS, Assassin, Combattant, Mage, Tireur, Support, Healer, Éclaireur. |
| `duree` | Heures sur place, sans les trajets. |
| `dangereuse` | `true` si une mort est possible. Rare aux paliers bas. |
| `epreuves` | `[{ type, difficulte, recit }]`. Types du moteur (`resolution.js`) : combat, nuee, siege, discretion, poursuite, voyage, diplomatie. |
| `complication` | `null` ou `{ texte, epreuve: { type, difficulte } }`. Cachée au départ, elle ajoute une épreuve surprise. Révélée par un Éclaireur ou la Reconnaissance, son épreuve perd 10 de difficulté. |
| `denouements` | `eclatante`, `reussite`, `partielle`, `echec` : un texte propre à chaque issue. |
| `recompenses` | `{ or, reputation, xp, objet: { rarete, chance } }`. L'objet est tiré dans la table des objets officiels (étape équipement). |
| `suite` | `null` ou une étiquette qui relie cette mission à une suite d'un palier supérieur. |

Fourchettes par palier (contrôlées par le script) :

| Palier | Épreuves | Difficulté | Postes | Durée | Or | Réputation | XP | Missions dangereuses |
|---|---|---|---|---|---|---|---|---|
| 1 Inconnue | 1 à 3 | 30 à 50 | 1 à 3 | 2 à 8 h | 30 à 150 | 1 à 4 | 20 à 80 | au plus 10 % |
| 2 Locale | 2 à 3 | 40 à 60 | 1 à 3 | 3 à 10 h | 100 à 300 | 2 à 6 | 60 à 150 | au plus 20 % |
| 3 Régionale | 2 à 4 | 50 à 70 | 2 à 4 | 4 à 14 h | 250 à 600 | 4 à 9 | 120 à 260 | au plus 30 % |
| 4 Renommée | 3 à 4 | 60 à 80 | 2 à 5 | 6 à 18 h | 500 à 1200 | 7 à 14 | 220 à 420 | au plus 45 % |
| 5 Légendaire | 3 à 5 | 70 à 95 | 3 à 5 | 8 à 24 h | 1000 à 3000 | 12 à 25 | 380 à 700 | au plus 60 % |
