# Barème d'écriture des avantages

Il garantit que les 173 champions sont notés de la même façon, et que les compétences d'un même champion restent cohérentes entre elles.

## Forces
- **Passif** : 1 point en général. 2 si le passif est l'identité même du champion. 3 réservé à une résurrection ou un sursis (Survie 3).
- **Q, W, E** : 1 à 3 points au total. 3 seulement pour la compétence signature du champion.
- **Ultime** : 3 à 5 points au total. C'est toujours la compétence la plus forte du kit.
- **Champion entier** : entre 9 et 15 points au total. Un kit très polyvalent ne dépasse pas un kit spécialisé : il répartit autrement.
- **Revers (-1)** : seulement quand le lore dit clairement que la compétence inquiète ou met en danger les alliés.

## Correspondances
| Ce que fait la compétence dans le jeu | Avantage |
|---|---|
| Gros dégâts sur une cible | Assaut |
| Dégâts de zone, rebonds, plusieurs cibles | Contre la nuée |
| Étourdir, immobiliser, projeter, réduire au silence | Maîtrise (2 si de zone ou long) |
| Bouclier ou protection d'un allié, mur, provocation qui détourne | Protection |
| Soin d'un allié | Soins |
| Se soigner, résister, revenir à la vie | Survie (3 = évite une mort) |
| Ruée, saut, accélération | Célérité 1 ; téléportation longue ou trajet d'équipe : 2 à 3 |
| Vision, révélation, éclaireur | Reconnaissance |
| Invisibilité, camouflage, déguisement, charme | Infiltration |
| Grappin, attraction, marque, poursuite, portée globale sur une cible | Traque |
| Exécution, % des PV, perforation, destruction de structures | Siège |
| Or, pillage, pièces | Or |
| Objets, trouvailles, artisanat | Butin |
| Prestige, spectacle, exploit public | Renommée |
| Commandement, bannière, chant, présence rassurante | Inspiration |
| Apaisement, bienveillance, réconciliation | Concorde |

## Vérification
`tools/verifier_avantages.py` contrôle ces bornes pour tous les lots et signale les écarts.
