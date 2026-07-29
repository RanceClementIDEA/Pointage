# Couverture des prix & pilotage du projet

*Correction majeure + roadmap 5.1, 5.3, 5.4 — vague 4*

---

## Partie 1 — La correction : chercher vraiment le moins cher

### Le problème que vous avez identifié

Vous aviez raison, et c'était une limite sérieuse : **le système ne cherche
pas le moins cher du web**. Il ne consulte que les URLs listées dans
`config.json`. Un audit l'a confirmé :

```
12 composants sur 13 n'avaient QU'UNE SEULE source.
```

Concrètement : un GPU 40 € moins cher chez un revendeur non listé passait
totalement inaperçu. C'est exactement ce que vous avez constaté.

### La correction : les comparateurs

Le système sait désormais interroger des **pages de comparateurs**
(idealo.fr, prix.net), qui agrègent déjà des dizaines de marchands.

Techniquement, il exploite le champ `lowPrice` des données structurées
schema.org `AggregateOffer` — le prix le plus bas parmi tous les vendeurs
référencés sur la page. **Une seule requête couvre des dizaines de
marchands**, sans multiplier les appels ni les risques de blocage.

```json
{
  "site": "idealo",
  "type": "comparateur",
  "url": "https://www.idealo.fr/prix/201899339/amd-ryzen-7-5700x.html"
}
```

Un repli existe si les données structurées sont absentes : extraction de
tous les montants de la page, avec plancher et plafond pour écarter les
frais de port et les prix aberrants.

### L'indicateur de couverture

Le rapport signale maintenant en permanence les composants mal surveillés :

```
Surveillance incomplete sur 10 composant(s) :
  - Kingston Fury Beast 16 Go (1 site)
  - Lexar ARES 512 Go NVMe Gen4 (0 site)
  - NVIDIA RTX 5060 Ti 8 Go (1 site)
```

Un comparateur compte double dans le calcul, puisqu'il couvre à lui seul de
nombreux marchands.

### Ajouter un site en 30 secondes

**Menu → option 12.** Vous collez l'URL, le système déduit le nom du site et
vous demande simplement si c'est un comparateur. C'est tout.

**Conseil pratique** : ajoutez un comparateur idealo ou prix.net sur vos 3-4
composants les plus chers. C'est le meilleur retour sur temps investi pour
ne plus rater de prix.

### Ce que ça ne résout pas

Restons honnêtes : même avec des comparateurs, certains prix vous
échapperont. Les comparateurs ne référencent pas tout (petits revendeurs,
Back Market, ventes flash Dealabs), et certains bloquent le scraping.

**Le réflexe qui reste indispensable** : quand vous voyez un bon prix
quelque part, ajoutez-le avec l'option 3. C'est ce qui rend l'historique
fiable, et donc les conseils pertinents.

---

## Partie 2 — Pilotage du projet (vague 4)

### Suivi post-achat (roadmap 5.1)

**Menu → option 13** pour marquer un composant comme acheté. Il sort du
suivi actif, et le rapport affiche :

```
--- DEJA ACHETE : 137.89 EUR ---
  MSI MAG Forge 320R Airflow     74.90 EUR le 2026-07-20 (au meilleur prix)
  MSI MAG A650BN 650W            62.99 EUR le 2026-07-20 (+6.34 vs min)
```

Vous savez ainsi, composant par composant, si vous avez bien joué le coup —
et le total restant se recalcule automatiquement.

### Échéance et compte à rebours (roadmap 5.3)

Fixez une date cible dans `config.json` :

```json
"projet": {
  "nom": "Tour polyvalente 1000 EUR",
  "date_cible": "2026-09-15"
}
```

Le rapport adapte alors son discours :

| Jours restants | Message |
|---|---|
| plus de 21 | « vous pouvez patienter » |
| 8 à 21 | « évitez d'attendre une hypothétique baisse » |
| 7 ou moins | « privilégiez la disponibilité au prix » |

Ce dernier point compte : à une semaine de l'échéance, une rupture de stock
coûte plus cher qu'un prix légèrement au-dessus de la moyenne.

### Simulateur « et si j'attendais ? » (roadmap 5.4)

```
--- SI VOUS ATTENDEZ BLACK FRIDAY (26 j) ---
  Aujourd'hui : 862.11 EUR
  Projection  : 810.34 EUR (economie estimee 51.77 EUR)
```

La projection s'appuie sur les baisses moyennes par catégorie du calendrier
saisonnier. Ce n'est **pas une garantie** — c'est un ordre de grandeur pour
objectiver l'arbitrage patience/impatience au lieu de le deviner.

### Le garde-fou de cohérence

En testant, une contradiction est apparue : le système suggérait d'attendre
les French Days (62 jours) alors que l'échéance du projet était à 54 jours.

Corrigé — il le signale désormais explicitement :

```
/!\ INCOMPATIBLE : Cette periode commence 8 jours APRES votre echeance
    du 2026-09-15 : attendre n'est pas envisageable si vous tenez
    a cette date.
```

---

## Récapitulatif du menu

| Option | Action |
|---|---|
| 1 | Vérifier les prix maintenant |
| 2 | Voir le dernier rapport |
| 3 | Ajouter un prix vu ailleurs |
| 4 | Consulter l'historique d'un composant |
| 5 | Configurer l'email |
| 6 | Automatiser l'envoi quotidien |
| 7 | Modifier les composants suivis |
| 8 | Vérifier l'installation |
| 9 | Démonstration |
| 10 | Ouvrir le tableau de bord |
| 11 | Bilan de la semaine |
| **12** | **Ajouter un site à surveiller** |
| **13** | **Marquer un composant comme acheté** |

---

## Où en est la roadmap

| Vague | Contenu | État |
|---|---|---|
| 1 | Score de confiance, résumé une phrase, santé des sources, alerte ultime | ✅ |
| 2 | Groupes d'équivalence €/perf, variantes | ✅ |
| 3 | Dashboard autonome, digest hebdo, mode silencieux, push ntfy | ✅ |
| **4** | **Suivi post-achat, échéance, simulateur promo, couverture prix** | ✅ |
| 5 | Fausses promos, calendrier produit, fiabilité par site, archivage | à venir |

Restent aussi hors vagues : compatibilité croisée (1.2), multi-configs
(5.2), downgrade automatique (5.5), APIs d'affiliation (2.2).
