# Schéma SQLite — source de vérité de l'historique

*Roadmap v3, Axe 1. Prompts 6.2 (écriture parallèle) puis **6.4 (bascule)**.*

**SQLite est désormais la source de vérité.** L'application y lit et y écrit.
`history.json` n'est plus qu'un **export de secours**, produit à la demande.

## Historique de la migration

| Étape | État |
|---|---|
| **6.2** | Écriture parallèle. `history.json` = source de vérité, SQLite = miroir. |
| **6.4** | **Bascule.** SQLite = source de vérité. `history.json` n'est plus ni lu ni écrit automatiquement. |

La bascule n'a été faite qu'après vérification formelle : suite `pytest` verte
et backtest produisant des résultats **strictement identiques** depuis les deux
sources (12 métriques + 13 composants, 0 divergence).

## Principes

- **SQLite est lu et écrit** par `price_tracker.py`, `dashboard.py` et
  `demarrer.py`. Le cycle est : `charger_history()` → travail en mémoire
  (code métier inchangé) → `persister()`.
- **Granularité complète conservée.** Contrairement à `history.json`, la base
  ne détruit plus rien : la condensation hebdomadaire au-delà de 90 jours est
  devenue une **vue SQL**, pas une suppression. L'historique complet reste
  interrogeable indéfiniment.
- **Fichier unique, sans serveur**, à la racine du projet : `prices.db`
  (réglable via `"sqlite_file"`). Committable dans Git ou publiable en artefact
  GitHub Actions, exactement comme `history.json` auparavant.
- Toute erreur SQLite est absorbée : elle ne peut pas interrompre le script.

## Le fichier

| Réglage (`config.json`) | Défaut | Rôle |
|---|---|---|
| `sqlite_file` | `prices.db` | Nom du fichier SQLite (racine du projet) |
| `history_file` | `history.json` | Cible de l'export de secours (`--export-history`) |

Aucune dépendance nouvelle : `sqlite3` fait partie de la bibliothèque standard.

## Export de secours

```bash
python price_tracker.py --export-history
```

Régénère un `history.json` à partir de SQLite — une photographie pour
inspection manuelle ou retour arrière, plus la source de vérité. L'export est
fidèle : il reproduit le fichier à l'octet près.

## Reprise sans perte

Au premier lancement après la bascule, si la base est vide mais qu'un
`history.json` existe, il est importé une fois automatiquement
(« Reprise de history.json vers SQLite »). Aucune donnée n'est perdue.

## Tables

### `releves` — le cœur (miroir de `node["entries"]`)

| Colonne | Type | Source dans `history.json` |
|---|---|---|
| `produit_id` | TEXT | clé du composant (ex. `gpu_rx9060xt`) |
| `vendeur_id` | TEXT | `entries[].site` |
| `prix` | REAL | `entries[].price` |
| `ts` | TEXT | `entries[].date` (ISO `AAAA-MM-JJ`) |
| `confiance` | REAL | **réservé** — non renseigné par relevé aujourd'hui → `NULL` |
| `source_tier` | TEXT | **réservé** — palier d'extraction, non disponible aujourd'hui → `NULL` |
| `origin` | TEXT | `entries[].origin` (`seed` / `tracked` / `manuel`) |

Clé primaire : `id` (clé de substitution). **Pas** de contrainte d'unicité
naturelle : un composant peut légitimement avoir plusieurs relevés *seed* pour le
même vendeur et la même date à des prix différents — `import_seed_history`
déduplique sur date + site + **prix**, pas seulement date + site. `mirror_history`
recopie donc le multiset exact de `history.json`. Un index non unique sur
`(produit_id, vendeur_id, ts, origin)` accélère les recherches.

> `confiance` et `source_tier` figurent au schéma car ils appartiennent au modèle
> cible de l'Axe 1, mais l'historique actuel ne les stocke pas par relevé : ils
> restent `NULL` en attendant que le moteur les fournisse. `origin`, lui, existe
> déjà dans `history.json` et est conservé intégralement.

### `produits` — contexte (depuis `config.json` / nœuds d'historique)

| Colonne | Type | Source |
|---|---|---|
| `id` | TEXT (PK) | `components[].id` |
| `nom` | TEXT | `components[].name` |
| `categorie` | TEXT | `components[].category` |
| `slot` | TEXT | `components[].slot` (nullable) |
| `perf_index` | REAL | `components[].perf_index` (nullable) |
| `seed_imported` | INTEGER | `1` si les `seed_history` ont déjà été importés |

> `seed_imported` est ajouté par la bascule 6.4. Il vivait auparavant dans
> `history.json` ; sans lui, les `seed_history` seraient réimportés à chaque
> exécution. Les bases créées par la 6.2 sont migrées automatiquement
> (`ALTER TABLE` au démarrage).

### `vendeurs` — catalogue (depuis `config.json`)

| Colonne | Type | Source |
|---|---|---|
| `id` | TEXT (PK) | clé de `vendeurs` (ou `site` vu dans un relevé) |
| `type` | TEXT | `vendeurs[].type` (`comparateur` / `marchand`) |
| `pays` | TEXT | `vendeurs[].pays` (si présent) |
| `actif` | INTEGER | `1`/`0` selon `vendeurs[].actif` |
| `priorite` | INTEGER | `vendeurs[].priorite` |

### `evenements` — calendrier produit (depuis `config.json`)

| Colonne | Type | Source |
|---|---|---|
| `date` | TEXT | `evenements_produits[].date` |
| `nom` | TEXT | `evenements_produits[].nom` |
| `impact` | TEXT | `evenements_produits[].impact` sérialisé `"GPU,CPU"` |
| `note` | TEXT | `evenements_produits[].note` |

Clé primaire : `(date, nom)`.

### `slots_winners` — reprise de `history["_slots_winners"]`

| Colonne | Type | Source |
|---|---|---|
| `slot` | TEXT (PK) | clé de `_slots_winners` |
| `winner_id` | TEXT | id du composant gagnant (calculé par `build_slot_comparisons`) |
| `maj_ts` | TEXT | horodatage de mise à jour |

## Probabilités empiriques (Axe 4, vague 7)

`probabilites.py` remplace toute notion de **prévision** par une statistique
**descriptive du passé**, calculée sur l'historique profond SQLite et
l'identité produit canonique.

```bash
python price_tracker.py --probabilite gpu_rx9060xt --horizon 60
python demo_probabilites.py        # démonstration + vérification du calcul
```

### Ce que ça dit — et ce que ça ne dit pas

| | |
|---|---|
| ❌ Une prévision affirmerait | « le prix sera à 380 EUR en septembre » |
| ✅ Ce module constate | « un prix ≤ 380 EUR est apparu dans les 60 jours suivant un pic dans 68 % des cas **(n=14 épisodes)** » |

Aucun modèle, aucun apprentissage, aucune extrapolation. Kaplan-Meier est un
estimateur **non paramétrique** : il n'existe qu'aux durées réellement
observées.

### Les cinq garde-fous

1. **Toute** probabilité est rendue avec sa taille d'échantillon `n`. Jamais
   un chiffre nu.
2. **En dessous de 5 épisodes indépendants, aucun pourcentage** — la fonction
   rend « historique insuffisant pour estimer ». Même logique que
   `detecter_fausse_promo`, qui exige deux relevés par fenêtre.
3. **Aucune extrapolation** : un horizon supérieur à l'étendue observée est
   refusé, pas prolongé.
4. **Indépendance** : des fenêtres glissantes qui se chevauchent ne sont pas
   des tirages indépendants. Le seuil est commandé par `n` = épisodes
   **disjoints** (135 épisodes bruts → 8 indépendants dans la démo). Le compte
   brut reste affiché mais n'autorise jamais un pourcentage.
5. **Droit-censure** : une fenêtre tronquée par la fin des données, sans
   baisse observée, ne prouve rien — elle est exclue du dénominateur et
   signalée.

### Modèle événementiel (7.3)

`evenements_produits` n'est plus un bloc d'affichage : c'est une **entrée du
moteur de décision**. Les prix GPU/CPU réagissent bien plus à une nouvelle
génération qu'à une période commerciale.

Champ `nature` (facultatif) dans `config.json` :

| `nature` | Effet |
|---|---|
| `"refresh"` | Nouvelle génération annoncée/rumorée → pousse le conseil vers **ATTENDRE** si elle tombe dans l'horizon |
| `"aucun_refresh"` | Silence produit constaté → **annule** un `refresh` de la même catégorie devenu caduc |
| *absent* | Entrée purement **informative** — ne change aucun conseil |

```json
{
  "date": "2027-03-01",
  "nom": "RTX 60xx (rumeur)",
  "nature": "refresh",
  "impact": ["GPU"],
  "slots": ["gpu"],
  "note": "Nouvelle génération annoncée."
}
```

- **Horizon** : 60 jours par défaut, réglable via `thresholds.horizon_refresh_jours`.
- **Ciblage** : `impact` (catégories) et `slots` (facultatif, plus fin).
- **Préséance** : `aucun_refresh` l'emporte sur `refresh` — c'est une
  déclaration explicite, saisie à la main.

**Ce qu'un refresh ne bascule JAMAIS** : une `OCCASION ULTIME` ni un prix au
plancher historique (`is_strong_deal`). Un plancher reste un plancher ; le
signal est alors seulement mentionné dans les raisons. Un `ACHETER` ordinaire
(proche du plancher sans y être), lui, bascule.

Le signal **s'ajoute** au contexte marché et au calendrier saisonnier — même
mécanisme d'ajustement de `advice`, appliqué en dernier — sans les remplacer.
Il est exposé dans `analysis["signal_produit"]`.

**Démonstration** — ajouter un `refresh` GPU à J+35 dans `config.json` :

```
AVANT                                  APRES
[CORRECT ] NVIDIA RTX 5060 Ti 8 Go     [ATTENDRE] NVIDIA RTX 5060 Ti 8 Go
[NEUTRE  ] NVIDIA RTX 5060 Ti 16 Go    [ATTENDRE] NVIDIA RTX 5060 Ti 16 Go
[ACHETER ] Kingston Fury Beast 16 Go   [ACHETER ] Kingston Fury Beast 16 Go   (RAM : intacte)
```

avec, dans `reasons` : *« RTX 6060 attendu dans 35 jours : la génération
actuelle devrait se déprécier (typiquement 15 à 30%). »*

### Espérance de gain de l'attente (7.2)

`simuler_promo` n'applique plus une baisse forfaitaire par catégorie. Quand
l'historique le permet, chaque composant est estimé par :

```
E[gain] = P(baisse) × gain_moyen − P(hausse) × perte_moyenne
```

Les quatre grandeurs sont comptées sur les fenêtres historiques de même durée
(`probabilites.esperance_attente`) : pour chaque fenêtre partant du prix `p0`,
on regarde le **meilleur prix atteignable ensuite**. S'il est inférieur,
attendre aurait gagné ; s'il est supérieur, attendre aurait coûté. Le terme
soustrait — le **risque de hausse** — est calculé exactement comme son
symétrique : `P(baisse) + P(hausse) = 100 %`.

**Les deux méthodes ne sont jamais présentées comme équivalentes.** Le rapport
sépare les totaux et qualifie chaque ligne :

```
  Projection : 1037.31 EUR (economie estimee 24.98 EUR, methode mixte)
    [mesure n=11] GPU riche  : +35.10 EUR (baisse 73% des cas / hausse 27%, confiance moyenne)
    [forfait    ] GPU pauvre : +30.00 EUR (10% de categorie -- horizon 60 j > etendue observee 20 j)
    (les lignes [forfait] sont indicatives : baisse moyenne de categorie, pas une mesure)
```

Le **garde-fou d'échéance** (`pression`) est inchangé et **indépendant du mode
de calcul** : une période promo qui tombe après la date cible bloque la
suggestion, que le gain soit mesuré ou forfaitaire.

### État sur les données actuelles

**13/13 composants refusent**, chacun avec son motif (étendue insuffisante,
trop peu d'épisodes indépendants). C'est le comportement attendu : l'historique
compte 1 à 4 dates par composant. Les estimations deviendront possibles à
mesure que le suivi quotidien accumule des relevés — sans rien changer au code.

## Observabilité historisée (Axe 7)

`fiabilite_sites` et `source_health` ne calculaient qu'une **valeur
instantanée**, perdue à chaque exécution. Elle est désormais **datée et
conservée** : on peut tracer l'évolution d'un site dans le temps.

### `mesures_fiabilite`

| Colonne | Type | Rôle |
|---|---|---|
| `ts`, `jour` | TEXT | horodatage de l'exécution, date seule pour les regroupements |
| `site` | TEXT | source mesurée |
| `taux` | REAL | taux de réussite sur la fenêtre (%) |
| `jours_ok` / `jours_total` | INTEGER | jours où le site a répondu / jours de collecte |
| `produits` | INTEGER | nb de produits suivis sur ce site |
| `prix_plausibles` | INTEGER | offres pertinentes retenues |
| `latence_ms` | REAL | latence médiane observée, si mesurable |
| `statut` / `motif` | TEXT | `ok` \| `probleme`, et sa raison |
| `fenetre_jours` | INTEGER | largeur de la fenêtre (30 pour `fiabilite_sites`, 7 pour `source_health`) |

Index unique sur `(site, jour, fenetre_jours)` : relancer le script le même
jour **corrige** la mesure au lieu de la dupliquer. Les deux fenêtres
coexistent sans s'écraser.

La latence provient de `Recuperateur.latences`, relevée par domaine autour de
chaque requête HTTP (hors délai de politesse).

### Répondre à « ce site s'est-il dégradé ? »

```bash
python price_tracker.py --fiabilite          # tous les sites
python price_tracker.py --fiabilite ldlc     # série complète d'un site
```

```
  site                 30j   30-60j   tendance   latence  mesures
  ldlc                 68%      98%    -30 pts    300 ms       22  DEGRADE
  cdiscount            93%      92%     +1 pts    180 ms       22  stable
  amazon               78%      22%    +56 pts    180 ms       22  AMELIORE
```

Ou en SQL direct :

```sql
SELECT jour, taux FROM mesures_fiabilite
WHERE site = 'ldlc' AND fenetre_jours = 30 ORDER BY jour;
```

La vue `v_fiabilite_evolution` fait la comparaison 30 j vs 30-60 j. Sans
recul suffisant, `tendance` vaut `NULL` — **aucune tendance n'est inventée**.

## Mode dégradé

Base **verrouillée**, **corrompue**, en **lecture seule** ou **inaccessible** :
le script ne plante pas. Il repart du dernier export connu (`history.json`) et
le **dit** — en console *et* en tête du rapport (bandeau HTML + bloc texte).

Un silence serait pire qu'une panne : on croirait les prix à jour alors
qu'ils datent.

- `configure()` ouvre avec un `timeout` court et exécute un `PRAGMA quick_check`
  — un fichier peut s'ouvrir sans erreur et n'être pas une base valide.
- `_diagnostiquer()` traduit l'exception en motif lisible.
- `etat()` rend le diagnostic complet (volume, dates, mode dégradé), utilisé
  aussi par le contrôle d'installation.

## Dashboard explorable (Axe 6, prompt 9.1)

Le dashboard passe de statique à **explorable**, sans rien perdre de ce qui
fait sa valeur : **un seul fichier, ouvrable hors ligne depuis une pièce
jointe**.

### L'explorateur s'ajoute, il ne remplace pas

Le dashboard SVG de la v2.9 est **conservé tel quel**. Si le script est bloqué
(messagerie stricte, JS désactivé), la page reste complète et lisible — total,
évolution, cartes par composant. L'explorateur vient en supplément.

| Fonction | Détail |
|---|---|
| **Zoom temporel** | 7 j · 30 j · 90 j · 1 an · tout |
| **Comparaison** | deux composants superposés, couleurs distinctes |
| **Détail au clic** | date, prix, site, palier de cascade, origine |
| **Résumé** | plancher et plafond **historiques**, signalés *hors fenêtre* si besoin |

### Données embarquées

`donnees_embarquees()` sérialise **tout l'historique disponible**, un point par
jour (le moins cher), dans un
`<script type="application/json" id="donnees-suivi">`.

> **Échappement obligatoire** : `</` devient `<\/`. Sans cela, un nom de
> composant contenant `</script>` fermerait la balise prématurément et
> casserait la page **en silence**. Un test dédié le vérifie.

### L'exception au « zéro JS », assumée

Jusqu'en v2.9 le dashboard ne contenait **aucun** script. L'exploration (zoom,
comparaison, clic) ne peut pas se faire en SVG statique : **un seul bloc
`<script>` inline** est donc ajouté — vanilla, sans dépendance, sans requête.

### Vérification hors ligne — en navigateur réel

```bash
python verifier_dashboard.py
```

Un test structurel prouve qu'aucune URL distante n'apparaît. Il ne prouve pas
que la page **fonctionne**. Ce script l'ouvre dans Chromium avec **toute
requête sortante bloquée** :

```
  1. Chargement : 0 requete(s) externe(s), 0 erreur(s) JS
  2. Courbe dessinee : 1 trace(s), 4 point(s)
  3. Detail au clic : AMD Ryzen 7 5700X — 2026-06-06 : 122.60 EUR chez cdiscount
  4. Zoom temporel : 7 j -> 3 point(s), 30 j -> 3 point(s), tout -> 4 point(s)
  5. Comparaison : 2 trace(s) (etait 1)
  6. Plancher historique dans le resume : ... plancher 121.45 EUR le 2026-07-23 ...

  >>> PLEINEMENT INTERACTIF HORS LIGNE : OUI
```

Taille du fichier : **~38 Ko** sur l'historique actuel — le canal de diffusion
ne change pas, il reste joint à l'email quotidien.

## Historique profond (Axe 6, prompt 9.3)

Jusqu'ici le dashboard coupait à **730 jours** à la génération. Sur un
historique devenu complet (6.4), c'était la mauvaise coupe : le plancher de
l'an dernier disparaissait du fichier, donc de toute lecture possible.

**La fenêtre est désormais un choix d'affichage, pas une amputation.**

### Alléger l'affichage sans perdre d'information

Trois mécanismes, tous dans `dashboard.py` :

| Mécanisme | Rôle |
|---|---|
| `reduire()` | réduit une série pour le dessin **en préservant les extrêmes** |
| `stats` par série | plancher, plafond, effectif, période — calculés sur la donnée **complète** |
| Deux résolutions | historique entier échantillonné **+** les 120 derniers jours au jour le jour |

`reduire()` découpe la période en tranches et garde, dans chacune, le point le
**plus bas** et le **plus haut**. Un échantillonnage naïf (un point sur *N*)
raboterait les creux : la courbe s'aplatirait et les épisodes qui comptent
disparaîtraient. Ici le minimum global est forcément le plus bas de sa
tranche — il **survit toujours**. Et rien n'est moyenné ni interpolé : les
points affichés restent des relevés réels, cliquables, avec leur vendeur.

### Pourquoi deux résolutions

Un échantillon calculé une fois sur trois ans laisse un point tous les quatre
jours. Zoomer sur sept jours n'aurait alors montré que **deux points** — le
sélecteur de fenêtre aurait été décoratif. Les séries allégées embarquent donc
en plus la période récente (`FENETRE_FINE_JOURS = 120`) au jour le jour ;
l'explorateur bascule sur elle dès que la fenêtre demandée y tient.

Le surcoût est **borné** (120 points par série). Tout embarquer au jour le
jour, lui, croîtrait sans fin avec l'historique.

> Contrepartie assumée : la fenêtre « 1 an » sur un historique de trois ans
> est servie par la série échantillonnée (~87 points pour l'année). Lisible,
> mais moins fine que les fenêtres courtes.

### Le plancher, même hors fenêtre

Sous la courbe, le résumé cite toujours le plancher et le plafond de
l'historique **entier**, avec leur date. Quand le plancher tombe avant le début
de la fenêtre affichée, il est marqué **« hors de la fenêtre affichée »** en
rouge — c'est exactement l'information qu'une fenêtre fixe de 90 jours
masquait. Quand il y tombe, il est cerclé sur la courbe.

La fenêtre est ancrée sur le **dernier relevé connu**, pas sur l'horloge du
navigateur : un fichier archivé puis rouvert trois semaines plus tard montre
encore ses sept derniers jours de données, pas une page vide.

### Les SVG statiques suivaient la même pente

La sparkline de chaque carte et l'histogramme du total dessinaient **un point
par jour d'historique** : 1 095 points dans une sparkline de 260 px, 1 096
barres de 0,6 px de large — 370 Ko pour rien. Les deux passent désormais par
`reduire()` (`SPARKLINE_MAX = 130`, `BARRES_MAX = 180`) ; la légende de
l'histogramme continue d'annoncer les extrêmes **réels** et mentionne la
réduction.

### `totaux_par_jour()` était quadratique

Pour chaque journée, la fonction re-balayait l'historique **complet** de chaque
composant. Invisible sur 90 jours, coûteux dès que l'historique est entier :
**8,6 s sur cinq ans**, soit l'essentiel du temps de génération. Une seule
passe en avant, en tenant à jour le dernier prix connu, donne le même résultat.

Un test confronte l'implémentation à la définition naïve sur 40 historiques
tirés au hasard (trous, doublons, composants absents, slots) — elles doivent
coïncider exactement. Vérifié aussi sur l'historique réel et sur 300 tirages
supplémentaires avant la bascule.

### Mesures

Historique synthétique, 13 composants, un relevé par jour :

| Profondeur | Génération | Poids | Points dessinés |
|---|---|---|---|
| 1 an (4 758 relevés) | 0,04 s | 367 Ko | 3 381 |
| 3 ans (14 248 relevés) | 0,07 s | 367 Ko | 3 395 |
| 5 ans (23 738 relevés) | 0,10 s | 368 Ko | 3 399 |

*Avant 9.3, sur 3 ans : 1,29 s et 1 045 Ko — pour 730 jours seulement.* Le
poids ne suit plus la profondeur parce que le nombre de points **dessinés** est
borné, pas parce qu'on ampute l'historique. Un test le verrouille : le fichier
de 5 ans doit peser moins de 1,35 × celui d'un an.

Vérification en navigateur réel sur 3 ans — `python verifier_dashboard.py
chemin/vers/dashboard.html` :

```
  4. Zoom temporel : 7 j -> 7 point(s), 30 j -> 30 point(s), tout -> 263 point(s)
  6. Plancher historique dans le resume : ... plancher 661.56 EUR le 2025-11-19 ...
     signale hors fenetre a 7 j : oui
```

Sans la seconde résolution, la même ligne 4 donnait `7 j -> 2 point(s)`.

## Interface web locale (`serveur.py`)

### Ce que « temps réel » veut dire ici — et ce qu'il ne veut pas dire

Les prix **ne peuvent pas** être suivis en continu : la collecte s'impose
2,5 s par domaine et un cycle dure quelques minutes. C'est un choix assumé
(civisme réseau, 8.3), pas une limite à contourner. Interroger les marchands
en boucle pour animer un chiffre serait un abus, et la première conséquence
serait de se faire bloquer.

Ce qui est réellement instantané :

| | |
|---|---|
| **Affichage** | l'API relit SQLite à **chaque requête**, sans cache — 2 ms |
| **Collecte en cours** | progression affichée ligne par ligne pendant l'exécution |
| **Cycle venu d'ailleurs** | un run GitHub Actions ou planifié apparaît au rafraîchissement |

Autrement dit : **l'affichage est instantané, la collecte reste polie.**

### Ce qui ne change pas

Le mail quotidien et l'alerte « occasion ultime » sont **inchangés**, et
`dashboard.py` continue de produire le fichier autonome joint au mail —
lisible hors ligne, sans serveur. L'interface est un confort local **en
plus** ; un test vérifie que le dashboard autonome existe toujours.

### Garde-fous

- **`127.0.0.1` uniquement.** La page expose budgets, objectifs de prix et
  historique complet : elle n'a rien à faire sur le réseau.
- **`DELAI_MIN_COLLECTE = 600 s`** entre deux collectes lancées à la main.
  Un bouton invite à cliquer ; le garde-fou est dans le code, pas dans la
  discipline de l'utilisateur.
- **La collecte relance `price_tracker.py --no-email`** en sous-processus
  plutôt que de réimplémenter la boucle : toutes les garanties existantes
  (délai par domaine, plafond de vendeurs, budget de temps, cache
  conditionnel) sont réutilisées telles quelles, donc impossibles à
  affaiblir par inadvertance. Et `--no-email` garantit que le canal des
  alertes reste le mail quotidien.
- **Zéro dépendance, zéro ressource distante** : `http.server` de la
  bibliothèque standard, JS inline, aucun CDN.

### Serveur mono-thread, délibérément

Une connexion `sqlite3` n'est utilisable que dans le thread qui l'a ouverte.
Avec `ThreadingHTTPServer`, chaque requête serait servie ailleurs et la
lecture échouerait — **silencieusement**, la couche de données absorbant ses
erreurs pour rendre un historique vide. La page se serait affichée
correctement, avec zéro partout. Construire l'état complet prend 2 ms : il
n'y a rien à gagner à paralléliser, et un mode d'échec entier à s'épargner.

### ⚠️ Correctif : le cache HTTP conditionnel ne fonctionnait pas

Ce chantier a révélé un défaut **du moteur de collecte**, pas de l'interface.

`moteur_recherche.py` interroge les vendeurs par lots de 8 en parallèle
(`vendeurs_en_parallele`). Chaque worker consultait le cache HTTP
conditionnel (8.3) — et `sqlite3` refusait l'accès hors du thread
d'ouverture. L'erreur étant absorbée par `_avertir`, **`lire_cache_http()`
rendait `None` à chaque appel** : aucune requête conditionnelle n'était
émise, aucun `304` n'était reçu, et chaque page était retéléchargée en
entier. L'économie de bande passante du prompt 8.3 était annulée en silence.

Correctif : `check_same_thread=False` à l'ouverture. C'est sûr —
`sqlite3.threadsafety` vaut **3** (mode *serialized*), la bibliothèque
sérialise elle-même les accès concurrents, aucun verrou externe n'est
nécessaire.

Mesure avant / après, cache lu depuis 8 threads :

```
  avant : 0/16 lectures reussies
  apres : 16/16
```

Deux tests verrouillent le correctif ; remis dans son état d'origine, il en
fait échouer exactement ceux-là.

## Publication du dashboard (Axe 6, prompt 9.2) — **facultative**

Voir **[`PUBLICATION.md`](PUBLICATION.md)** pour le mode d'emploi complet.
Ici, seulement le mécanisme.

**Rien n'est publié sans un geste explicite.** `publication_dashboard` vaut
`false` dans la configuration livrée — un test le vérifie.

### Trois garde-fous actifs

`publier_dashboard.py` **refuse de s'exécuter** si :

1. `publication_dashboard` n'est pas à `true` ;
2. la cible est le **dépôt courant** — l'écueil de la v2.6 : publier ici
   exposerait `config.json`, l'historique et les secrets. La comparaison
   normalise les écritures d'URL (`git@…:a/b.git`, `https://…/a/b`, casse) ;
3. le fichier contient un **élément sensible** : adresse email, paramètre
   SMTP, jeton, canal ntfy. La publication s'interrompt et affiche ce qui a
   été trouvé.

### Ce qui sort — et rien d'autre

Le dossier publié est **reconstruit à vide**, et **un seul fichier** y est
copié. Il n'y a rien à « oublier d'exclure » : ce qui n'est pas copié n'existe
pas. Un `robots.txt` décourage l'indexation (précaution, pas protection).

```bash
python publier_dashboard.py --verifier            # contrôle, ne publie rien
python publier_dashboard.py                       # dépôt public dédié
python publier_dashboard.py --dossier ./public    # Cloudflare Pages / Netlify
```

### Atténuation facultative

`publication.anonymiser: true` retire le **nom des projets** et les **montants
de budget**. Les prix et composants restent — sans eux le dashboard n'aurait
plus d'objet. **C'est un atténuateur, pas un anonymat.**

### Workflow

`.github/workflows/publier-dashboard.yml` : **aucun `schedule`, aucun `push`**
— seulement `workflow_dispatch`, avec une confirmation à taper et
`permissions: contents: read` sur ce dépôt. L'écriture se fait sur le dépôt
**public** via une clé de déploiement dédiée.

## Projets multiples (Axe 5)

Un seul projet a toujours existé, **implicite**, dissous dans `config.json`
sous la clé `projet`. Le rendre explicite ne change rien pour qui n'en a
qu'un — mais c'est ce qui permettra d'en suivre plusieurs **sans dupliquer la
collecte** : produits, vendeurs et historique restent mutualisés.

### `projets` / `projet_composants`

| Table | Colonnes |
|---|---|
| `projets` | `id`, `nom`, `budget_target`, `budget_max`, `devise`, `date_cible`, `actif` |
| `projet_composants` | `projet_id`, `produit_id`, `slot`, `achete_le`, `prix_achat`, `site_achat` |

La liaison porte le **slot occupé dans ce projet** : le même composant peut
servir deux projets avec des rôles différents.

### Deux formes de configuration, une seule lecture

```jsonc
// Forme historique — toujours valide, aucune migration à faire
"projet": { "nom": "Tour polyvalente", "date_cible": null, "achats": [] }

// Forme multi-projets
"projets": [
  { "id": "tour", "nom": "Tour", "budget": {"target_total": 1000} },
  { "id": "nas",  "nom": "NAS",  "budget": {"target_total": 600},
    "composants": ["ssd_lexar_512"] }        // périmètre restreint
]
```

`projets_du_config()` normalise les deux en une **liste** : le code d'aval ne
voit plus qu'une seule forme. Un projet sans `composants` couvre **tous** les
composants — le cas historique.

Un projet sans `budget` hérite du `budget` global.

### Fonctions désormais par projet

| Fonction | Signature |
|---|---|
| `charger_achats(config, projet_id=None)` | achats du projet |
| `pression_calendrier(config, projet_id=None)` | échéance du projet |
| `bilan_achats(achats, history, projet_id=None)` | bilan étiqueté |
| `composants_du_projet(config, projet_id=None)` | périmètre du projet |

Sans `projet_id`, le **projet actif** est utilisé — strictement l'ancien
comportement quand il n'y en a qu'un.

### Collecte mutualisée (8.6) — le coût marginal

**La collecte n'a jamais été « par projet » : elle est « par produit ».**
`produits_a_collecter(config)` construit l'ensemble dédupliqué, tous projets
confondus, par trois réductions successives :

1. **Union par identifiant** — deux projets suivant le même composant le
   désignent par le même id : il n'apparaît qu'une fois.
2. **Retrait des achats — mais seulement si acheté PARTOUT.** Un composant
   déjà acquis pour la tour mais encore attendu pour le NAS continue d'être
   relevé. *C'est le piège du multi-projet* : filtrer sur un seul projet ferait
   disparaître des prix encore utiles.
3. **Fusion par identité canonique** (Axe 2) — deux composants distincts
   partageant le même EAN sont le même article : une seule collecte, le prix
   est recopié vers l'autre. Seules les correspondances **sûres** (EAN/MPN)
   fusionnent — une ressemblance de titre ne suffit jamais.

```bash
python demo_multiprojets.py
```

| Scénario | Collectes |
|---|---:|
| 1 projet (13 composants) | **13** |
| 2 projets, 4 composants communs | **13** |
| *somme naïve* | *17* |

> **Coût marginal du 2ᵉ projet : 0 collecte.** Un projet qui n'apporte qu'un
> composant inédit coûte exactement +1. Deux identifiants pour un même article
> (même EAN) : fusionnés, 1 requête en moins.

L'objectif §8 de la feuille de route — « coût marginal proche de zéro » — est
donc atteint et **mesuré**, pas supposé.

### Rapports par projet et vue portefeuille (8.7)

`analyser_projet(config, projet, history, …)` produit l'analyse complète d'un
projet — **sans imprimer ni envoyer quoi que ce soit**. C'est ce qui permet de
l'appeler autant de fois qu'il y a de projets.

**Chaque projet garde son rapport**, dans la structure exacte qu'il a toujours
eue. Avec un seul projet, la boucle ne tourne qu'une fois : sortie **identique
octet pour octet**.

```bash
python price_tracker.py                 # un rapport par projet actif
python price_tracker.py --projet nas    # restreint à un projet
python price_tracker.py --portefeuille  # + la vue d'ensemble
```

Activable aussi par `"portefeuille_actif": true` dans `config.json`.

### Ce que la vue portefeuille montre — et ce qu'elle tait

Elle ne garde que ce qui **ne se voit que d'en haut** :

```
2 projet(s) actif(s), total combine 1512.54 EUR (objectif cumule 1450 EUR)

  Tour polyvalente    1054.92 EUR  OCCASION ULTIME   8 suivi(s) | echeance 2026-09-07 (40 j)
  NAS maison           457.62 EUR  OCCASION ULTIME   5 suivi(s)

OCCASIONS ULTIMES EN COURS :
  MSI MAG Forge 320R Airflow : 70.81 EUR chez rakuten (5.5% sous le plancher)
      concerne : Tour polyvalente, NAS maison

FENETRES D'ACHAT A VENIR :
  dans  45 j — RTX 60xx (rumeur) (GPU) → Tour polyvalente

Le detail composant par composant figure dans le rapport de chaque projet.
```

Trois choix contre la redondance :

- **Une occasion partagée est une seule ligne**, avec les projets concernés —
  pas une répétition par projet.
- **Seules les incompatibilités bloquantes** remontent ; les points de
  vigilance restent dans le détail.
- **Aucun composant ordinaire n'est énuméré** : le rapport individuel le fait
  déjà.

Les fenêtres d'achat proviennent du **modèle événementiel** (7.3) et sont
filtrées par catégorie : un refresh GPU ne concerne pas un projet sans GPU.

### Où vit la vérité

`config.json` reste la surface d'**écriture** : le menu (option 13) y ajoute
les achats. `synchroniser_projets()` en tient le **miroir** dans SQLite à
chaque exécution. Aucune décision ne lit la base : le comportement d'un usage
mono-projet est donc **inchangé par construction** — vérifié par un A/B
octet-pour-octet sur le rapport complet.

## Cascade de collecte (Axe 3)

La chaîne de repli existait déjà, mais **implicitement** : on essayait une
méthode puis la suivante, sans jamais retenir laquelle avait produit le prix.
Deux prix identiques n'ont pourtant pas la même valeur selon leur provenance.

| Rang | Palier | Confiance | Fonction |
|---:|---|---|---|
| 0 | API officielle | haute | *prévu, non implémenté* (futures intégrations d'affiliation) |
| 1 | Données structurées (JSON-LD) | haute | `extract_price_from_jsonld` |
| 2 | Sélecteurs CSS déclarés | moyenne | `extract_price_fallback` |
| 3 | Extraction bornée | faible | `extract_min_price_from_page` |

`extraire_prix_cascade()` exécute la chaîne et rend **(prix, palier)**. Le
palier est stocké dans `releves.source_tier` — colonne réservée depuis la 6.2,
désormais renseignée.

> **Ordre d'exécution ≠ ordre de confiance.** Sur un comparateur, l'extraction
> bornée est tentée *avant* les sélecteurs — une page de comparateur n'a en
> général pas de sélecteur déclaré, et le plus bas montant y est justement
> l'information cherchée. Le comportement est conservé tel quel ; seule la
> provenance est désormais connue. Un test vérifie que les prix sont
> **inchangés**.

Le palier voyage **avec l'entrée** d'historique (`entries[].tier`) : `persister`
reconstruit la table depuis l'état en mémoire, sans quoi le palier serait
effacé à la première sauvegarde.

### Retrouver la provenance d'un prix

```bash
python price_tracker.py --cascade gpu_rx9060xt
```

```
  AMD RX 9060 XT 16 Go
       399.00 EUR  idealo           extraction bornee (faible)
       429.99 EUR  ldlc             donnees structurees (JSON-LD) (haute)
       412.78 EUR  alternate        palier inconnu (releve anterieur a la cascade)
```

### Snapshots de diagnostic (8.4)

Quand la cascade épuise **tous** ses paliers sans obtenir de prix plausible,
une version **allégée** de la page est déposée dans `snapshots/` — de quoi
comprendre plus tard, hors ligne, sans relancer de requête.

**Ce qui est gardé** (et pourquoi) :

| Contenu | Utilité |
|---|---|
| Blocs JSON-LD | S'ils existent, le problème vient de leur *contenu*, pas de leur absence |
| HTML autour des motifs de prix (+ parent) | C'est là que se trouve le sélecteur à corriger |
| Extrait du corps (filet) | Si rien d'autre n'a été retenu — page d'erreur, captcha… |

Mesuré : **8 985 → 635 octets (−93 %)**, en conservant le JSON-LD, le motif de
prix *et* le montant.

**Nom** : `<site>__<composant>__<horodatage>.html` — commence par le site, donc
compatible avec `charger_snapshot()` du prompt 8.2.

**Nettoyage** : les snapshots de plus de **30 jours** sont supprimés au début de
chaque exécution. Le dossier ne peut pas grossir indéfiniment, même si personne
n'y pense.

**Git** : `snapshots/` est dans `.gitignore`. Sur GitHub Actions, ils sont
récupérables comme **artefact du workflow en cas d'échec** (`if: failure()`,
rétention 14 jours).

### La boucle de l'Axe 3 est fermée

```
8.1 cascade  →  8.2 détecte un sélecteur cassé  →  8.4 fournit la page
                        ↑                                    │
                        └────────── propose un candidat ─────┘
```

Vérifié de bout en bout : un échec d'extraction crée le snapshot, et 8.2 y
retrouve `.product-pricing-v2` — le sélecteur exact à corriger.

### ⚠️ Correctif du workflow GitHub Actions

Le workflow committait **`history.json`**. Depuis la bascule 6.4, ce fichier
n'est plus écrit automatiquement : le commit ne sauvegardait donc **plus rien**,
et `prices.db` — la source de vérité — était **perdu à chaque exécution**, les
serveurs Actions étant remis à zéro.

Corrigé : le workflow commite désormais `prices.db` (et `history.json` s'il
existe). `.gitignore` documente explicitement pourquoi `prices.db` n'est *pas*
ignoré.

### Politesse réseau (8.3)

Trois mécanismes, **tous par civisme — jamais par contournement**, conformément
au refus assumé de contourner les blocages IP.

**1. `robots.txt`** — déjà présent (`respecter_robots`, désactivé par défaut car
la plupart des marchands interdisent tout robot). Un chemin interdit n'est plus
seulement ignoré : il est **compté et signalé** dans le bilan
(`recuperateur.interdits`), distinct des pannes.

**2. Cache conditionnel** — table `cache_http` mémorise `ETag` / `Last-Modified`
par URL. La requête suivante envoie `If-None-Match` / `If-Modified-Since` ; sur
**304**, le dernier prix connu est réutilisé sans re-télécharger ni ré-extraire.

```bash
python demo_politesse.py
```

```
                             sans cache     avec cache
  requetes emises                     5              5
  reponses 304                        0              4
  pages retelechargees                5              1
  volume transmis (Ko)             24.8            5.7

  >>> VOLUME TRANSMIS : -77%
```

Prix rendus **identiques** dans les deux cas : l'économie n'est pas payée par
l'utilisateur. Et une page qui change reste détectée (ETag différent → 200).

> Le nombre de **requêtes** ne baisse pas — une requête conditionnelle est
> quand même émise. Ce qui baisse, c'est le **volume transmis** et le nombre
> d'extractions. C'est exactement ce que le protocole HTTP prévoit pour ça.

Désactivable : `thresholds.cache_conditionnel = false`.

**3. Backoff exponentiel à l'échelle du site** — le retry n'est plus une
propriété de la requête mais du **domaine** :

| Échecs consécutifs | 0 | 1 | 2 | 3 | 4 | 5+ |
|---|---:|---:|---:|---:|---:|---:|
| Délai (base 2,5 s) | 2,5 | 5 | 10 | 20 | 40 | 60 (plafond) |

Un succès remet le compteur à plat. Le délai **appris** des 429 (doublé,
réutilisé le lendemain) reste pris en compte : les deux se combinent, on retient
le plus grand.

### Détection de sélecteur cassé (8.2)

`source_health` signalait une seule panne : « aucune réponse ». Or deux pannes
très différentes se confondaient :

| Symptôme | Cause | Table |
|---|---|---|
| Requêtes échouent (`requetes_ok = 0`) | Panne réseau, blocage IP | `mesures_fiabilite` |
| **Requêtes aboutissent, aucun prix** (`requetes_ok > 0`, `prix_obtenus = 0`) | **Refonte du HTML → sélecteur cassé** | `sante_extraction` |

```sql
CREATE TABLE sante_extraction (
    jour, site, requetes_ok, prix_obtenus, palier_dominant,
    UNIQUE(site, jour)
);
```

**Seuil : 2 jours consécutifs (48 h)** — la cible de la feuille de route. Un
site qui n'a **jamais** produit de prix n'est pas déclaré « cassé » : sans
succès passé, il n'y a rien de cassé.

```bash
python price_tracker.py --selecteurs
```

```
  ldlc -- SELECTEUR PROBABLEMENT CASSE
    repond toujours (8 requete(s) abouties) mais aucun prix depuis 2 jour(s)
    dernier prix obtenu le 2026-07-25 (palier selecteurs)
    candidats a valider a la main :
      [itemprop="price"]    ->  429.99 EUR  [haute]   microdonnees schema.org
      .product-pricing      ->  429.99 EUR  [moyenne] classe evoquant un prix
      .old-price            ->  499.00 EUR  [faible]  (ancien tarif ? a verifier)
```

**Aucun sélecteur n'est appliqué automatiquement.** Un candidat deviné peut
capter un prix barré ou un montant de livraison — comme `.old-price` ci-dessus,
détecté et **rétrogradé** plutôt que masqué. La validation reste manuelle.

Les candidats viennent du **snapshot** de la page (prompt 8.4) via
`charger_snapshot(site)` — contrat : `snapshots/<site>.html`. Sans snapshot,
**l'alerte est quand même émise** : savoir qu'un sélecteur est cassé vaut mieux
que ne rien savoir.

### Signal de fragilité

Un composant dont **toutes** les sources récentes reposent sur le palier le
plus bas est signalé dans le rapport : rien ne garantit que ces montants
désignent *le* produit. Le signal ne se déclenche que si le palier est connu
pour **tous** les relevés récents — un palier inconnu ne prouve rien.

## Identité produit (Axe 2)

Répond à la question que le prix seul ne tranche jamais : **« ces N annonces
désignent-elles le même produit ? »**

### `identites` — le produit canonique

| Colonne | Type | Rôle |
|---|---|---|
| `id_canonique` | TEXT (PK) | `ean:<gtin>` \| `mpn:<ref>` \| `terme:<slug>` |
| `produit_id` | TEXT | composant rattaché |
| `gtin` / `mpn` | TEXT | identifiants normalisés |
| `libelle`, `niveau`, `maj_ts` | | libellé lisible, meilleur niveau observé |

### `annonces` — les N annonces vendeurs

| Colonne | Type | Rôle |
|---|---|---|
| `produit_id`, `vendeur_id`, `url` | TEXT | clé unique de l'annonce |
| `titre`, `gtin`, `mpn` | TEXT | tels que déclarés par le marchand |
| `id_canonique` | TEXT | → `identites` |
| `niveau` | INTEGER | **3** exacte (EAN) · **2** haute (MPN) · **1** faible (titre) · **0** aucune |
| `label` | TEXT | libellé, dans le style de `confidence_label` |
| `score`, `methode`, `vu_le` | | score de similarité, méthode retenue |

### Les 3 niveaux de correspondance

| Niveau | Label | Fondement |
|---:|---|---|
| **3** | `exacte (EAN)` | GTIN identique, **chiffre de contrôle GS1 validé** |
| **2** | `haute (MPN)` | Référence fabricant identique après normalisation |
| **1** | `faible (titre)` | Heuristique de titre, via `moteur_recherche.score_pertinence` (seuil 0,72) |
| **0** | `aucune` | Rien ne rattache l'annonce — ou un identifiant la contredit |

L'identité de référence d'un composant est **déduite des annonces** (le GTIN,
puis le MPN, le plus fréquemment observé) : une identité découverte chez *un
seul* vendeur valide — ou invalide — les annonces de tous les autres.

### La règle du veto

Un GTIN valide mais **différent** de celui du produit suivi ramène la
correspondance à **0**, même si le titre ressemble à s'y méprendre. Un
code-barres qui contredit est une preuve positive qu'il s'agit d'un autre
article ; une ressemblance de titre n'est qu'un indice.

Le MPN, lui, ne déclenche pas de veto : propre au fabricant, souvent décliné
par conditionnement, ses variantes de formatage sont trop fréquentes pour
qu'une différence soit concluante.

### Vues fusionnées

| Vue | Ce qu'elle donne |
|---|---|
| `v_releves_canoniques` | Chaque relevé rattaché à son identité canonique |
| `v_prix_canonique` | Plancher / plafond **tous vendeurs confondus**, + `niveau_min` (sur quelle qualité de correspondance repose l'agrégat) |
| `v_prix_courant_canonique` | Prix du jour, tous vendeurs confondus |

### Effet sur l'analyse

`fusionner_entries(component, node)` construit l'historique servant à
l'analyse. Il fait **deux** choses :

1. **retire** les relevés des vendeurs dont l'annonce a été démentie
   (niveau 0) — sans quoi un accessoire passé au travers de `prix_plausible`
   continuerait de fixer le plancher ;
2. **ajoute** les relevés partageant l'identité canonique, y compris
   enregistrés sous un autre composant (cas réel : `rechercher_groupe`
   mutualise une requête entre plusieurs composants d'une même famille).

Le seuil par défaut est `niveau_min=2` : seules les correspondances sûres
(EAN ou MPN) élargissent l'historique. Une simple ressemblance de titre ne
suffit pas à faire entrer un prix étranger dans le plancher.

`detecter_fausse_promo` (appelé dans `analyze_component`) et
`build_slot_comparisons` (qui consomme ces analyses) travaillent
mécaniquement sur cette base élargie.

> **Rétro-compatibilité** : un vendeur sans annonce connue n'est jamais
> écarté — aucune information ne permet de le juger. Tant qu'aucune identité
> n'a été collectée, le comportement est strictement inchangé.

### Démonstration

```bash
python demo_identite.py
```

Rejoue hors ligne le cas réel de `gpu_rx9060xt` (5 sources + recherche
élargie) et montre les 3 niveaux, le veto, et ce que la fusion change au
plancher.

## Vues des chemins chauds

Ce sont exactement les calculs qu'`analyze_component` fait aujourd'hui à la
volée sur la liste `entries`. Les exprimer en SQL évite de reparcourir tout
l'historique en Python et prépare la Vague 7 (statistiques sur historique
profond). SQLite n'a pas de vue matérialisée physique : ce sont des vues
calculées à la demande, sur des colonnes indexées.

| Vue | Ce qu'elle donne |
|---|---|
| `v_dernier_prix` | Dernier prix connu par **produit × vendeur** |
| `v_prix_courant` | Prix du jour retenu par produit — *le moins cher du dernier jour relevé*, la règle de production |
| `v_plancher_historique` | Plancher / plafond observés, nb de relevés, première et dernière date |
| `v_moyennes_glissantes` | Moyennes **7 / 30 / 90 jours** + taille d'échantillon de chaque fenêtre |
| `v_historique_hebdomadaire` | Condensation hebdomadaire (min, moyenne, effectif) — **remplace la destruction** |

Accès Python : `sqlite_store.metriques_produit(id)` et
`sqlite_store.historique_hebdomadaire(id)`.

Les tests `tests/test_vues_sqlite.py` vérifient que ces vues rendent **les mêmes
valeurs** que les calculs Python correspondants.

## Archivage : d'une suppression à une vue

Avant, `archiver_historique` condensait les relevés de plus de 90 jours en un
point hebdomadaire et **supprimait les autres** — pour empêcher `history.json`
de grossir indéfiniment, puisqu'il était committé à chaque exécution.

Ce compromis n'a plus lieu d'être : la base conserve tout (c'est l'objet même de
l'Axe 1 — l'historique est le capital du projet), et la lecture condensée est
devenue la vue `v_historique_hebdomadaire`.

`archiver_historique` est conservée pour compatibilité et **retourne 0** : plus
aucun relevé n'est supprimé.

## Cycle de lecture / écriture

```
charger_history()  ->  travail en mémoire (code métier inchangé)  ->  persister()
```

- `charger_history(config)` reconstruit l'état de travail depuis SQLite —
  mêmes structures qu'avant, **y compris l'ordre des entrées** (tri par date
  puis par ordre d'insertion `id`). Cet ordre compte : `analyze_component`
  prend `entries[-1]` comme prix courant.
- `persister(history, config)` réécrit l'état courant (remplacement intégral,
  donc idempotent).

## Vérifier une migration

Le script `verifier_parite_sqlite.py` compare un `history.json` et la base. Il
reste utile pour contrôler un export ou une reprise :

```bash
python price_tracker.py --export-history
python verifier_parite_sqlite.py     # -> "RESULTAT : PARITE OK"
```
