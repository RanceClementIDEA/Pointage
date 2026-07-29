# Ligne de base — backtest des règles de décision

> Chiffre de référence de la v3. Toute amélioration de la Vague 7
> (décision probabiliste, modèle événementiel, optimisation budget)
> devra se comparer à ce nombre, obtenu par la même commande.

```bash
python backtest.py
```

## Le chiffre

**+11.24 EUR (+0.47 %) par rapport à un achat au jour 1.**

- Validité : **NON CONCLUANTE (échantillon trop mince)**
- Généré le : 2026-07-28 07:32 (source : `prices.db`)

| Stratégie | Coût total | Écart vs jour 1 |
|---|---:|---:|
| Achat jour 1 (naïf) | 2374.68 EUR | — |
| **Nos règles** (1er ACHETER / OCCASION ULTIME) | **2363.44 EUR** | **+11.24 EUR (+0.47 %)** |
| Achat au plus bas réel (optimum théorique) | 2334.93 EUR | -39.75 EUR |

Part du gain théoriquement disponible que les règles capturent : **28.3 %**.

## D'où vient ce gain ?

| Origine | Montant |
|---|---:|
| Composants où la règle s'est **déclenchée** | +1.15 EUR |
| Composants en **repli** (aucun signal, achat au dernier relevé) | +10.09 EUR |

> ⚠️ **L'essentiel du chiffre vient du repli, pas des règles.** Il mesure
> surtout la convention « achat au dernier relevé » appliquée quand aucun
> signal n'est venu — pas la qualité du moteur de décision.

## Échantillon

- Composants rejoués : **13**
- Dont informatifs (≥ 2 dates distinctes) : **11**
- Dates distinctes sur l'ensemble du projet : **6**
- Médiane de dates par composant informatif : **2**
- Règle déclenchée sur : **7/11** composants

### Pourquoi ce chiffre n'est pas encore une mesure de performance

Seuils de validité retenus (et état actuel) :

| Critère | Requis | Actuel |
|---|---:|---:|
| Composants informatifs | ≥ 8 | 11 |
| Dates distinctes (projet) | ≥ 20 | 6 |
| Médiane dates/composant | ≥ 5 | 2 |

Le nombre cumulé de décisions ne suffit pas comme critère : 11 composants
à 2 dates produisent 22 « décisions » sans qu'aucune stratégie ne puisse se
distinguer — avec deux points, acheter « au signal » revient à choisir entre
le premier et le dernier. Ce qui compte est la **densité** de l'historique.

L'historique disponible est presque entièrement constitué de `seed_history`
(relevés importés à la main) et d'un seul cycle de collecte automatique.

C'est volontairement affiché plutôt que masqué : la v2 refuse déjà de rendre
un verdict de fausse promo sans deux relevés par fenêtre, et écarte la
prévision ML pour cause de fausse précision. Le même principe s'applique ici.

**Ce chiffre devient exploitable sans rien changer au code** : chaque
exécution quotidienne ajoute une date de décision par composant. Relancer
`python backtest.py` régénère la mesure.

## Méthode

Pour chaque composant, l'historique SQLite (`prices.db`) est rejoué
chronologiquement. À chaque date, `analyze_component` est appelée avec
**uniquement les relevés antérieurs ou égaux à cette date** — aucun accès au
futur. L'horloge du module est gelée à la date simulée, sinon tout relevé
passé serait jugé « non revérifié » et le rejeu ne mesurerait rien de réel.

Trois stratégies sont chiffrées :

1. **Règles** — achat à la première date où le conseil est `ACHETER` ou
   `OCCASION ULTIME`. Si la règle ne se déclenche jamais, l'achat est
   compté au dernier relevé connu (convention : un projet finit par acheter).
2. **Jour 1** — achat au premier relevé connu (référence naïve).
3. **Optimum** — achat au jour le moins cher (référence théorique, elle
   suppose de connaître l'avenir).

Le prix retenu pour une date est le moins cher relevé ce jour-là, comme en
production.

Aucune logique métier n'est modifiée par le banc : `analyze_component` est
appelée telle quelle.

---

*Fichier régénéré par `python backtest.py --ecrire-baseline`.*
