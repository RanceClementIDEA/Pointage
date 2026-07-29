# Analyse avancée — vague 5

*Roadmap 6.1, 6.3, 4.4, 4.5, 8.1*

---

## 1. Détecteur de fausses promotions (6.1)

### Le piège qu'il évite

Le schéma classique du Black Friday : le prix monte discrètement 2 à 3
semaines avant, puis « baisse » avec une grosse étiquette rouge. Résultat
net : vous payez le prix habituel en croyant faire une affaire de -20%.

### Comment il fonctionne

Le système compare **trois fenêtres temporelles** :

| Fenêtre | Période | Rôle |
|---|---|---|
| Référence | J-60 à J-30 | Le prix « normal » de fond |
| Gonflage | J-21 à J-3 | La montée suspecte avant l'opération |
| Aujourd'hui | — | Le prix « promotionnel » |

Verdict **fausse promo** si le prix a monté d'au moins 5% pendant la fenêtre
de gonflage **et** que le prix actuel reste au-dessus du prix de référence.

### Les trois verdicts

**FAUSSE** — le conseil bascule automatiquement en ATTENDRE :
> Prix gonflé de 16% récemment (de 424.50 à 492.00 EUR), et le prix actuel
> reste 3% au-dessus du prix habituel d'il y a un mois.

**NEUTRE** — la « baisse » vous ramène simplement au prix normal :
> Le prix avait monté de 18% avant cette baisse : vous revenez simplement au
> prix habituel (400.00 EUR).

**RÉELLE** — vraie affaire malgré une hausse intermédiaire :
> Baisse réelle : 10% sous le prix habituel d'il y a un mois.

### Prérequis honnête

Le détecteur exige **au moins 2 relevés dans chaque fenêtre**, soit environ
2 mois d'historique. Avant ça, il ne dit rien plutôt que de deviner. C'est
volontaire : un faux verdict serait pire que pas de verdict.

Les `seed_history` du config comptent dans ce calcul — d'où l'intérêt de les
remplir depuis les courbes idealo.

### Tests effectués

| Scénario | Verdict attendu | Résultat |
|---|---|---|
| 400 → gonflé à 470 → « promo » à 415 | FAUSSE | ✅ |
| Même gonflage, prix final 360 | RÉELLE | ✅ |
| Retour au prix habituel (399) | NEUTRE | ✅ |
| Prix stable, aucun gonflage | **rien** | ✅ |
| Historique trop court | **rien** | ✅ |

---

## 2. Calendrier des événements produits (6.3)

Les prix GPU et CPU réagissent bien plus aux **annonces produit** qu'aux
périodes commerciales. Une nouvelle génération fait typiquement chuter la
précédente de 15 à 30% dans les semaines qui suivent.

Ce calendrier s'édite à la main dans `config.json` — c'est vous qui suivez
l'actualité :

```json
"evenements_produits": [
  {
    "date": "2027-01-06",
    "nom": "CES 2027",
    "impact": ["GPU", "CPU"],
    "note": "Annonces majeures AMD/NVIDIA/Intel."
  }
]
```

Les événements situés entre J-14 et J+120 apparaissent dans le rapport, avec
un code couleur selon la proximité.

**Repères à noter dans votre calendrier** : CES début janvier, Computex fin
mai, et toute rumeur de sortie sur les gammes que vous suivez.

---

## 3. Fiabilité des sources (4.4)

Un tableau du taux de réussite par site sur 30 jours :

```
FIABILITE DES SOURCES (30 DERNIERS JOURS)
  ldlc            7 produit(s)    95%  fiable
  cdiscount       5 produit(s)    88%  fiable
  amazon          1 produit(s)    12%  a retirer
```

| Taux | Verdict | Que faire |
|---|---|---|
| 80%+ | fiable | Rien |
| 40-79% | irrégulier | Surveiller |
| moins de 40% | à retirer | Remplacer par un comparateur |

C'est particulièrement utile sur GitHub Actions, où certains marchands
bloquent les IP de datacenter. Plutôt que de deviner, vous voyez les
chiffres et nettoyez votre config en connaissance de cause.

---

## 4. Archivage automatique de l'historique (4.5)

Au-delà de **90 jours**, les relevés quotidiens sont condensés en **un point
par semaine** (le minimum, le plus utile pour situer un prix).

Sans ça, `history.json` grossirait indéfiniment : avec 13 composants et 5
sources chacun, on atteindrait vite plusieurs dizaines de milliers de lignes
en un an — problématique sur GitHub qui commite le fichier à chaque
exécution.

L'archivage s'exécute automatiquement, et le rapport indique combien de
relevés ont été regroupés. Les calculs de score et de plancher historique
continuent de fonctionner normalement.

Réglable dans `config.json` : `"archivage_jours": 90`.

---

## 5. Ajouter un site sans toucher au code (8.1)

Les sélecteurs CSS vivent désormais dans `config.json` :

```json
"selecteurs_sites": {
  "ldlc": [".price", ".basket-price"],
  "monnouveausite": [".prix-produit", "#price"]
}
```

**Dans la plupart des cas vous n'aurez rien à faire** : la méthode
principale (données structurées JSON-LD) fonctionne sans configuration sur
la grande majorité des sites e-commerce, puisqu'ils l'exposent pour Google
Shopping. Les sélecteurs ne servent que de repli.

11 sites sont pré-configurés : LDLC, Cdiscount, Amazon, Rakuten,
Materiel.net, Grosbill, TopAchat, Alternate, PCComponentes, Fnac, Darty.

---

## Roadmap : où on en est

| Vague | Contenu | État |
|---|---|---|
| 1 | Score de confiance, résumé, santé des sources, **alerte occasion ultime** | ✅ |
| 2 | Groupes d'équivalence €/perf | ✅ |
| 3 | Dashboard autonome, digest hebdo, mode silencieux, push ntfy | ✅ |
| 4 | Couverture prix (comparateurs), suivi post-achat, échéance, simulateur promo | ✅ |
| **5** | **Fausses promos, calendrier produit, fiabilité sites, archivage, config déclarative** | ✅ |

### Ce qui reste (hors vagues)

| Item | Pourquoi ce n'est pas fait |
|---|---|
| Compatibilité croisée (1.2) | Utile surtout si vous ajoutez des candidats hors AM4 |
| Multi-configurations (5.2) | Faisable aujourd'hui en dupliquant le dossier |
| Downgrade automatique (5.5) | Dépend de 1.2 pour être fiable |
| APIs d'affiliation (2.2) | Demande une inscription partenaire, plusieurs jours |
| Keepa (2.3) | Payant, redondant avec les comparateurs |
| Prévision ML (6.4) | **Écarté volontairement** : fausse précision sur un marché piloté par des annonces |

Les cinq vagues couvrent l'essentiel. Le reste relève du cas par cas selon
comment vous utiliserez l'outil.
