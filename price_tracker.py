# Moteur de recherche v3

## Pourquoi

Constat : « il ne cherche pas assez et ne trouve pas les meilleures offres ».
Un audit du code a confirmé cinq défauts, tous mesurés avant correction.

| # | Défaut constaté | Effet concret |
|---|---|---|
| 1 | Sur une page de résultats, le moteur retenait le prix **le plus bas de toute la page**, sans jamais vérifier à quel produit il correspondait | Sur « AMD Ryzen 7 5700X », le plus bas est la pâte thermique à 7,90 €. Écartée par le filtre de plausibilité → **le vendeur ne remontait aucun prix alors que le bon produit était sur la page** |
| 2 | `1 299,00 €` était lu **299,00 €** (le séparateur de milliers coupait le nombre) | Prix faux, fausses alertes « occasion ultime » |
| 3 | `499 €` (sans décimales) n'était **pas lu du tout** | Vendeurs entiers muets |
| 4 | La disponibilité n'était **jamais lue** | Un produit en rupture à 99 € déclenchait une occasion ultime |
| 5 | `max_vendeurs_par_composant: 8` avec 16 vendeurs actifs | **8 marchands jamais interrogés**, toujours les mêmes : alternate, pccomponentes, cybertek, 1fodiscount, rueducommerce, fnac, boulanger, rakuten |

## Ce qui change

**Extraction offre par offre.** Chaque page est découpée en offres individuelles
(titre + prix + stock + lien), par trois méthodes en cascade : données
structurées JSON-LD, microdonnées `itemprop`, puis rattachement générique de
chaque étiquette de prix au titre le plus proche. La troisième méthode ne
dépend d'aucun sélecteur CSS : ajouter un vendeur ne demande pas de code.

**Appariement par titre.** Le titre trouvé est confronté au produit cherché.
Les jetons de référence (`5700x`, `b550`, `16g`) sont obligatoires, ce qui
distingue un 5700X d'un 5700G ou d'un 5700X3D, et une RTX 5060 Ti 16 Go d'une
8 Go. Les accessoires sont rejetés (« Ventirad compatible Ryzen 7 5700X »,
« Kit de fixation pour Peerless Assassin »), sans jamais rejeter le produit
lui-même quand c'est un ventirad qu'on cherche.

**Lecture du stock.** Une rupture ne remonte plus de prix, et est reléguée
derrière toute offre disponible. C'est exactement le cas PCDiscounts à 377 €
rencontré au début du projet.

**Frais de port dans le classement.** Un vendeur allemand à 112 € n'est pas
moins cher qu'un français à 118,90 € : avec 14 € de port il revient à 126 €.
Le classement se fait sur le prix livré.

**Tous les vendeurs, en parallèle.** Le plafond est levé (`max_vendeurs_par_composant: 0`)
et les 6 marchands européens sont activés : **22 vendeurs au lieu de 8**. Les
requêtes partent en parallèle, avec une session et un verrou par domaine, et un
délai minimum entre deux appels au même site. Plus de vendeurs, pas plus de
pression sur chacun.

**Variantes de recherche.** Chaque composant peut être cherché sous plusieurs
formulations (`recherche_variantes`), y compris sa référence constructeur.
Les vendeurs restés muets sur le terme principal sont réinterrogés avec la
variante suivante.

**Reprise adaptée à l'erreur.** Un 403 change de navigateur et réessaie, un 429
attend le délai annoncé, un 404 n'est pas réessayé. L'ancien moteur retentait
tout à l'identique, deux fois.

## Nouveaux réglages (`config.json` → `thresholds`)

| Clé | Défaut | Rôle |
|---|---|---|
| `max_vendeurs_par_composant` | `0` | 0 = aucun plafond. Remettre 8 pour raccourcir l'exécution |
| `vendeurs_en_parallele` | `8` | Requêtes simultanées |
| `delai_par_domaine` | `2.5` | Secondes minimum entre deux appels au même site |
| `seuil_pertinence_titre` | `0.72` | Exigence d'appariement. Monter si des produits voisins passent |
| `plausibilite_basse` / `_haute` | `0.35` / `2.5` | Fourchette autour du prix habituel. Remplace `tolerance_prix_recherche`, trop serrée : elle rejetait de vraies promotions |
| `comparer_prix_livre` | `true` | Classer sur prix + port |
| `inclure_ruptures` | `false` | Mettre `true` pour suivre aussi les indisponibles |
| `essayer_variantes` | `true` | Deuxième passe sur les vendeurs muets |

Par composant : `recherche_variantes` (liste) et `exclure` (produits proches à
ne jamais confondre). Par vendeur : `frais_port` pour une valeur exacte,
sinon estimation depuis `frais_port_par_pays`.

## Réserves à connaître

- **Les frais de port sont estimés**, pas relevés : 14 € pour l'Allemagne,
  12 € pour les Pays-Bas. Ils servent à classer à armes égales, pas à établir
  une facture. Vérifiez le montant réel avant de commander hors de France.
- **22 vendeurs × 13 composants** = beaucoup plus de requêtes. Le parallélisme
  compense largement, mais depuis GitHub Actions certains marchands bloquent
  les adresses de centre de données : le bilan de fin d'exécution liste ceux
  qui ne répondent jamais, retirez-les.
- **Le seuil de pertinence est un arbitrage.** À 0,72 il laisse passer les
  bundles (« Ryzen 7 5700X + carte mère »), volontairement : ce sont parfois
  de vraies bonnes affaires. Le garde-fou de plausibilité écarte les montants
  aberrants qui en découlent.
- L'analyse du HTML reste contraire aux CGU de la plupart des marchands. Rien
  n'a changé sur ce point : usage personnel, une fois par jour.

## Tests

64 contrôles automatisés, sans aucun accès réseau :

```
python moteur_recherche.py --auto-test     # 29 contrôles du moteur
python test_reel.py                        # 22 sur vos 13 composants
python test_e2e.py                         # 10 de bout en bout, 22 vendeurs simulés
python test_integration.py                 #  3 sur les URLs produit directes
```

Trois défauts réels ont été trouvés **par ces tests** pendant le développement
et corrigés : les refroidisseurs rejetés à tort, les barrettes de RAM jamais
reconnues (`3200` contre `3200MHz`), et les cartes graphiques omettant
« GeForce » dans leur titre.

---

# Moteur v4 — deuxième passe

Cinq angles morts restaient après la v3. Tous étaient reproductibles.

| Angle mort | Ce qui se passait |
|---|---|
| **État du produit** | « RX 9060 XT reconditionné » était traité comme du neuf. Un reconditionné à 319 € déclenchait une occasion ultime sur un neuf à 449 € — ce n'est pas le même produit |
| **Prix barrés** | L'ancien tarif rayé (`<del>599 €</del>`) était extrait comme une offre |
| **Mensualités** | « ou 4x 112,25 € sans frais » était lu comme un prix de 112,25 € |
| **Lots** | « Lot de 3 Ryzen 7 5700X » à 360 € passait le contrôle de plausibilité |
| **Franchise de port** | 14 € de port facturés sur une carte à 450 € livrée gratuitement |

## Ce qui a été ajouté

**État neuf / reconditionné / occasion**, lu depuis `itemCondition` ou depuis
le titre et le badge, en français, anglais, allemand et espagnol (`B-Ware`,
`gebraucht`, `renewed`, `retour client`…). Chaque composant déclare ce qu'il
accepte via `etats_acceptes`. **Vos 4 GPU sont réglés sur `["neuf", "reconditionne"]`**,
conformément à ce que vous aviez indiqué plus tôt dans le projet ; tout le
reste est en neuf seul.

**Prix barrés et mensualités écartés**, détectés par balise (`<del>`, `<s>`),
par classe CSS (`price-old`, `barre`, `msrp`…), par `line-through`, et par les
formulations de paiement échelonné. Le filtre ne regarde que l'étiquette
elle-même : l'élargir au bloc parent faisait rejeter le vrai prix, qui
cohabite presque toujours avec la mention « 4x sans frais ».

**Lots explicites détectés** (`lot de 3`, `pack de 2`, `3-pack`). Volontairement
strict : `2x8Go` décrit la composition d'un kit mémoire, pas une quantité
commandée, et n'est donc pas traité comme un lot.

**Franchise de port.** `franchise_port` par vendeur ; au-dessus du seuil, le
port passe à zéro. Les 12 marchands français sont à 0 €. **Aucune franchise
n'est supposée par défaut** (`franchise_port_par_defaut: null`) : inventer une
livraison gratuite non vérifiée ferait paraître les vendeurs étrangers moins
chers qu'ils ne sont, exactement le biais que le calcul du port cherche à
corriger.

**Recherche groupée.** Les composants partageant une `famille_recherche` sont
servis par une seule requête par vendeur. Chercher « GeForce RTX 5060 Ti »
renseigne d'un coup la 16 Go et la 8 Go. Mesuré sur vos composants :
**21 requêtes → 9, soit 57 % de moins**, à résultats identiques. Un vendeur qui
ne référence qu'une des deux variantes est quand même exploité. Les composants
que la famille n'a pas couverts sont repris individuellement.

**Suivi de fiabilité persistant** dans `vendeurs_sante.json` : nombre de jours
consécutifs sans réponse et sans offre par vendeur. Au bout de
`jours_avant_retrait` (7 par défaut), le script vous les nomme explicitement.

**`robots.txt` en option** (`respecter_robots`, désactivé par défaut). L'activer
est le comportement le plus correct vis-à-vis des sites ; la plupart des
marchands interdisant tout robot, cela réduira fortement la couverture. Le
choix vous appartient, il est maintenant possible.

## Nouveaux réglages

| Clé | Défaut | Rôle |
|---|---|---|
| `etats_acceptes_defaut` | `["neuf"]` | États retenus, surchargeable par composant |
| `autoriser_lots` | `false` | Accepter les ventes par lot |
| `recherche_groupee` | `true` | Mutualiser les requêtes par famille |
| `jours_avant_retrait` | `7` | Jours sans réponse avant signalement |
| `respecter_robots` | `false` | Consulter robots.txt avant chaque requête |
| `franchise_port_par_defaut` | `null` | Seuil de livraison offerte, non supposé |

Par composant : `famille_recherche`, `etats_acceptes`.
Par vendeur : `franchise_port`.

## Tests

**93 contrôles automatisés, aucun accès réseau.** `python test_all.py` lance
les six suites.

Deux défauts trouvés par ces tests pendant le développement : le filtre de
mensualité rejetait le vrai prix quand il regardait le bloc parent, et la
franchise par défaut à 100 € annulait à tort le port allemand.

---

# Moteur v5 — correction et optimisation

Cette passe a commencé par une **mesure**, pas par une idée : profilage de
l'extraction sur des pages marchandes réalistes. Le profil a désigné les vrais
coûts, et le travail a aussi mis au jour trois bugs de correction sérieux.

## Trois bugs qui fabriquaient de fausses affaires

| Bug | Effet mesuré |
|---|---|
| **Prix éclaté sur deux balises** — `<span>106</span><span>,99 €</span>` | lu **99,00 €** au lieu de 106,99 € : une fausse bonne affaire à chaque fois |
| **Devise ignorée** — geizhals et galaxus couvrent la Suisse | `449,00 CHF` compté comme **449 €**, alors que cela vaut ~480 € |
| **Encodage mal deviné** | sans `charset` dans l'en-tête, requests suppose latin-1 : « reconditionnée » devient « reconditionnÃ©e », et le produit repasse en **neuf** |

Un quatrième a été trouvé pendant l'optimisation : la détection de devise
matchait `EUR` à l'intérieur de « co**eur**s », si bien qu'une ligne de
spécifications faisait remonter la lecture jusqu'au **prix barré**.

**Corrections.** Les nombres tronqués sont reconstitués, avec un test
volontairement étroit — seul un entier nu de 4 chiffres maximum avant le prix
déclenche la recomposition, pour ne pas confondre avec une note « 4.5 étoiles »
placée juste avant, qui donnerait un montant absurde. La devise est portée par
chaque offre ; **sans taux de change renseigné, l'offre est écartée plutôt que
comptée en euros** — inventer une conversion serait pire que de perdre une
source. L'encodage réel est deviné quand l'en-tête ne le déclare pas.

## Optimisation, mesurée

Le profilage a désigné deux points chauds qui n'étaient pas ceux attendus :

- `normaliser()` appelée **2 650 fois par page** (24 % du temps), dont
  l'essentiel à re-normaliser les mêmes listes de mots constantes à chaque
  vérification de stock ou d'état ;
- **7 000 sélecteurs CSS par page** dans la recherche de titre.

Trois changements : vocabulaires normalisés une seule fois au chargement,
`normaliser()` avec table de traduction et cache, recherche de titre par
parcours direct au lieu de soupsieve. Plus `lxml` comme parseur quand il est
installé (facultatif : sans lui, tout fonctionne à l'identique, en plus lent).
L'extraction ne balaie plus toutes les balises du document mais part des nœuds
de texte portant un symbole monétaire.

| | Avant | Après |
|---|---|---|
| Page de 50 produits | 105 ms | **39 ms** |
| Session complète (198 pages) | 21 s CPU | **8 s CPU** |

**2,7× plus rapide.** Le profil montre maintenant que le coût dominant est
l'analyse HTML elle-même, hors de mon code : c'est le signe qu'il faut arrêter
d'optimiser là.

## Deux protections pour GitHub Actions

**Budget de temps global** (`budget_secondes`, 900 s par défaut, sous le
timeout de 25 min). Au-delà, les requêtes restantes sont abandonnées
proprement et le rapport indique combien — plutôt que d'être tué en pleine
écriture de `history.json`.

**Délai adaptatif appris.** Un domaine qui renvoie 429 voit son délai doubler,
et la valeur est **conservée dans `vendeurs_sante.json` pour les exécutions
suivantes**. Le moteur devient plus poli avec les sites fragiles sans ralentir
les autres.

## Réserves

- Le taux CHF de la config (1,07) est **figé** : mettez-le à jour ou retirez-le,
  il ne se met pas à jour tout seul.
- Le budget de temps protège l'exécution mais **tronque la couverture** quand il
  se déclenche. Le message vous dit quoi ajuster.
- `lxml` est recommandé (`pip install lxml`) mais pas requis.

## Tests

**108 contrôles automatisés**, aucun accès réseau : `python test_all.py`.
`python bench.py` mesure les performances d'extraction.

---

# Moteur v6/v7 — vrai prix, sites frauduleux, caractérisation des affaires

## 1. Le vrai prix, pas le prix affiché

**TVA.** Les marchands allemands et néerlandais affichent souvent hors taxes.
`377,31 € HT` paraissait 16 % moins cher que `449 € TTC` et raflait le meilleur
prix — alors que c'est **exactement le même montant à payer**. Le régime est
maintenant lu (`exkl. MwSt`, `hors taxes`, `excl. VAT`, `sin IVA`…) et le prix
ramené au montant réellement dû, avec le taux du pays du vendeur. Pays sans
taux connu : l'offre est écartée plutôt que comparée de travers.

**« À partir de ».** `à partir de 399 €` désigne l'entrée d'une gamme, pas le
produit suivi. Écarté (`ab`, `from`, `desde`, `vanaf`).

**Vérification sur la fiche produit.** Le prix d'une page de résultats est
souvent périmé ou arrondi. Les **3 meilleures offres sont désormais rouvertes
sur leur propre fiche** pour confirmer prix, stock et plancher avant toute
alerte. Les écarts liste/fiche sont journalisés.

## 2. Historique récupéré en ligne

La directive européenne **Omnibus** oblige tout marchand annonçant une remise à
afficher le **prix le plus bas des 30 derniers jours**. C'est un historique
officiel, présent dans la page, et jusqu'ici non seulement ignoré mais
**compté comme un prix d'achat disponible** — un bug qui faisait enregistrer un
montant qu'on ne pouvait pas payer. Il est lu en FR, DE, EN, ES, IT, NL et
sert de troisième source d'historique, précieuse quand le vôtre est court.

**Détection des fausses promotions.** Le prix barré est désormais conservé
comme preuve qu'une remise est *annoncée*. Confronté au plancher 30 jours :
si Cdiscount barre 599 € pour vendre 449 € alors que le plancher est 439 €,
ce n'est pas une affaire. Étiqueté **FAUSSE PROMOTION**, note plafonnée à 45.

## 3. Écarter les sites frauduleux

**Le signal le plus fiable est le consensus du jour**, et il ne dépend d'aucune
valeur écrite à l'avance : il se recalibre chaque jour sur le marché réel.
Quand huit vendeurs disent 449 € et qu'un neuvième dit 199 €, ce n'est pas une
affaire — c'est une boutique frauduleuse, une erreur qui sera annulée, ou une
lecture ratée. L'offre est **écartée du classement et de l'historique**, avec
la raison affichée.

S'y ajoutent : **HTTPS obligatoire**, un **niveau de confiance par marchand**
(haute / moyenne / faible / inconnue), le **marquage des places de marché**
(Amazon, Cdiscount, Fnac, Rakuten, RueDuCommerce — vendeurs tiers), et un mode
strict `confiance_refusee` qui bloque les marchands non identifiés.

Une offre suspecte n'est jamais présentée comme une opportunité : sa note est
plafonnée à 30 et son libellé devient **OFFRE NON CRÉDIBLE**.

## 4. Caractérisation des affaires

Note sur 100 combinant quatre repères pondérés selon ce qu'ils valent :

| Repère | Poids | Ce qu'il apporte |
|---|---|---|
| Position dans **votre** historique | 35 % | Le plus sûr, mais borné à ce que vous avez observé |
| Écart au **consensus du jour** | 30 % | Capte les promos que l'historique ignore encore |
| Écart au **plancher 30 jours** | 20 % | Donnée officielle récupérée en ligne |
| Qualité de l'offre | 15 % | Stock, vérification fiche, confiance marchand |

Échelle : OPPORTUNITÉ EXCEPTIONNELLE / TRÈS BONNE AFFAIRE / BONNE AFFAIRE /
CORRECT / PRIX HAUT, plus FAUSSE PROMOTION et OFFRE NON CRÉDIBLE. Chaque
verdict est accompagné de sa justification en clair.

**Comparaison à état égal.** Un reconditionné à 339 € face à du neuf à 449 €
n'est pas une remise de 24 %, c'est un autre produit. Le consensus est calculé
entre offres de même état ; faute d'équivalents, la comparaison est désactivée
et signalée plutôt que faite de travers. Ce défaut a été trouvé en relisant la
démonstration, pas par un test.

## 5. Couverture européenne — et sa réserve

**52 marchands, 16 pays** (FR, DE, NL, BE, ES, IT, AT, PT, DK, SE, PL, CZ, UK,
CH…). 22 actifs, **30 en attente de vérification**.

> **Je n'ai pas pu tester ces 30 URLs de recherche depuis mon environnement.**
> Un site refond sa recherche et le modèle d'URL ne vaut plus rien. Ils sont
> donc livrés **inactifs**, avec l'outil pour trancher par l'expérience :
>
> ```
> python price_tracker.py --verifier-vendeurs            # teste et rapporte
> python price_tracker.py --verifier-vendeurs --activer-valides
> ```
>
> La commande interroge chaque marchand avec une vraie recherche, compte les
> offres exploitables, et n'active que ce qui fonctionne.

## Réglages ajoutés

| Clé | Défaut | Rôle |
|---|---|---|
| `verifier_sur_fiche` / `offres_a_verifier` | `true` / `3` | Confirmation sur la fiche produit |
| `seuil_offre_suspecte` | `0.55` | En deçà de 55 % du consensus : non crédible |
| `seuil_offre_a_verifier` | `0.75` | Zone à confirmer soi-même |
| `quorum_consensus` | `4` | Vendeurs minimum pour que la médiane compte |
| `ecarter_suspectes` | `true` | Exclure les offres non crédibles de l'historique |
| `exiger_https` | `true` | Refuser les boutiques non chiffrées |
| `confiance_refusee` | `[]` | Ex. `["inconnue","faible"]` pour un mode strict |
| `tva_par_pays` | 20 taux UE | Surchargeable |

## Réserves

- **Les taux de TVA et de change sont figés** dans la config. Ils ne se mettent
  pas à jour seuls.
- **Le consensus a besoin d'un quorum.** Avec moins de 4 vendeurs sur un
  composant, la détection de fraude ne se déclenche pas — c'est volontaire,
  une médiane sur 2 points ne veut rien dire.
- **Une offre écartée n'est pas forcément une arnaque.** Les vraies erreurs de
  prix existent et sont parfois honorées. La raison est toujours affichée pour
  que vous jugiez.
- La vérification sur fiche **ajoute 3 requêtes par composant**. Désactivable.

## Tests

**142 contrôles automatisés**, aucun accès réseau : `python test_all.py`.
`python demo_v7.py` rejoue un scénario complet à 10 vendeurs mêlant vraie
promo, fausse promo, prix HT, reconditionné et boutique frauduleuse.
