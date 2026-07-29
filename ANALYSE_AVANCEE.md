# Alerte OCCASION ULTIME

La fonction la plus importante du système : ne jamais rater un prix
exceptionnel.

---

## Ce qui déclenche l'alerte

Trois signaux **indépendants**. Un seul suffit.

### Signal 1 — Sous le plus bas jamais vu
Le prix passe **5% ou plus en dessous** du plancher historique connu
(relevés automatiques + `seed_history` + `historical_low` de la config).

Point technique important : la comparaison se fait **hors relevé du jour**.
Sinon le prix actuel ferait lui-même partie du minimum et ne pourrait
mathématiquement jamais le battre — l'alerte ne se déclencherait jamais.

### Signal 2 — Votre prix cible est atteint
Vous fixez un `prix_reve` par composant : le prix auquel vous achetez sans
réfléchir. Dès qu'il est atteint, alerte immédiate.

```json
"reference": {
  "historical_low": 349.00,
  "prix_reve": 340          // "à ce prix, je prends tout de suite"
}
```

C'est le signal le plus personnel et le plus fiable : il traduit *votre*
seuil, pas une statistique.

### Signal 3 — Chute brutale
Baisse de **15% ou plus en 3 jours maximum** : vente flash, déstockage,
erreur de prix.

La contrainte de délai est essentielle. Sans elle, une baisse de 20% étalée
sur six semaines — une simple tendance de marché — déclencherait une fausse
alerte. C'était d'ailleurs un bug réel repéré pendant les tests.

---

## Le garde-fou anti-arnaque

Si l'écart dépasse **30% sous le plancher**, le système passe en niveau 3 et
ajoute un avertissement explicite :

> ATTENTION : écart très inhabituel, vérifiez qu'il ne s'agit pas d'une
> erreur de prix ou d'un vendeur tiers non fiable

Un prix trop beau est souvent :
- une **erreur d'affichage** (le marchand annule la commande après coup — il
  en a le droit tant qu'elle n'est pas expédiée),
- un **vendeur tiers douteux** sur une marketplace,
- un produit qui n'est pas celui que vous croyez (version bridée, import
  sans garantie française, bundle incomplet).

L'alerte part quand même — c'est peut-être une vraie affaire — mais avec
l'avertissement bien visible.

---

## Comment vous êtes prévenu

### 1. Notification push instantanée (recommandé)

Via **ntfy.sh** : gratuit, sans inscription, sans compte.

**Mise en place, 3 minutes :**

1. Choisissez un nom de « topic » **secret et impossible à deviner**, par
   exemple `pcprix-k7m2x9qz`. Toute personne connaissant ce nom peut lire
   vos notifications, donc évitez `pc-prix` ou votre prénom.
2. Installez l'application **ntfy** (iOS / Android / navigateur web).
3. Dans l'app : **+** → tapez votre nom de topic → **Subscribe**.
4. Renseignez-le dans `config.json` :

```json
"alertes": { "ntfy_topic": "pcprix-k7m2x9qz" }
```

Sur GitHub Actions, utilisez plutôt un **secret** `NTFY_TOPIC` (la variable
d'environnement a priorité sur le fichier de config, qui lui est versionné
dans le dépôt).

La notification part en **priorité urgente** : elle passe même si votre
téléphone est en mode silencieux.

### 2. Email avec objet impossible à manquer

L'objet devient :

```
!!! OCCASION ULTIME !!! [PC Tracker] 23/07
```

Au lieu du classique `[PC Tracker] ACHAT ECHELONNE - 23/07`. Impossible de
le confondre avec un rapport de routine dans une boîte de réception chargée.

Le corps de l'email s'ouvre sur un **bandeau rouge** avec le prix, le
vendeur, les raisons du déclenchement et l'économie réalisée par rapport au
meilleur prix jamais vu.

### 3. Console

Même en mode `--no-email`, un bloc bien visible s'affiche. L'alerte push
part **aussi** dans ce mode : une occasion ultime ne doit jamais dépendre de
l'option choisie.

---

## Régler la sensibilité

```json
"thresholds": {
  "seuil_occasion_ultime_percent": 5,   // % sous le plancher pour alerter
  "seuil_bug_prix_percent": 30,          // au-delà : suspicion d'erreur
  "chute_soudaine_percent": 15           // chute en ≤3 jours
}
```

- **Trop d'alertes ?** Montez `seuil_occasion_ultime_percent` à 8 ou 10.
- **Pas assez ?** Descendez à 3 — mais attention, en dessous vous
  déclencherez sur du bruit normal de marché.
- **Le levier le plus efficace reste `prix_reve`** : ajustez-le composant par
  composant, c'est lui qui reflète vraiment votre décision d'achat.

---

## Autres améliorations livrées avec

### Indice de confiance (roadmap 6.2)
Chaque conseil affiche désormais sur quoi il repose :

| Confiance | Relevés | Ce que ça veut dire |
|---|---|---|
| haute | 30+ | Historique solide, conseil fiable |
| moyenne | 10-29 | Correct, tendance qui se dessine |
| faible | 4-9 | Indicatif, à recouper |
| très faible | 1-3 | Trop peu de recul, vérifiez vous-même |

Une donnée non revérifiée depuis plus de 7 jours plafonne automatiquement la
confiance à « faible ». Le système est ainsi explicite sur ce qu'il sait
vraiment — plutôt que d'afficher un chiffre rassurant sans fondement.

### Résumé en une phrase (roadmap 3.5)
En tête du rapport, avant tout le reste :

> **OCCASION ULTIME sur MSI MAG Forge 320R Airflow — foncez vérifier.**

ou

> **Commandez 3 composant(s) maintenant, patientez sur 2.**

### Alerte de santé des sources (roadmap 4.1)
Si un site cesse de répondre, le rapport le signale explicitement :

```
Sources en panne :
  - amazon : URL non configuree
  - rakuten : aucune reponse depuis 7 jours
```

Sans ce contrôle, une extraction cassée donne l'illusion d'un prix stable
(on garde le dernier connu) alors qu'on n'a simplement plus d'information.
C'est particulièrement utile sur GitHub Actions, où les blocages d'IP
datacenter sont fréquents.

---

## Tests effectués

Les cinq scénarios ont été validés :

| Scénario | Résultat attendu | Vérifié |
|---|---|---|
| 8% sous le plancher | Alerte niveau 2 | ✅ |
| Chute de 20% en 1 jour | Alerte niveau 1 | ✅ |
| 45% sous le plancher | Alerte niveau 3 + avertissement arnaque | ✅ |
| Prix normal | **Aucune alerte** | ✅ |
| Baisse lente sur 6 semaines | **Aucune alerte** | ✅ |

Les deux derniers cas comptent autant que les autres : un système qui alerte
tout le temps ne sert à rien, on finit par l'ignorer.
