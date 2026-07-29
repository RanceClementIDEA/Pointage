# Vague 7 — validation par backtest

> **La Vague 7 a-t-elle amélioré les décisions, ou seulement leur
> complexité ?** Ce document répond, chiffres à l'appui, dans un sens
> comme dans l'autre.

```bash
python backtest.py --comparer
```

- Généré le : 2026-07-28 13:04 (source : `prices.db`)
- Verdict : **IDENTIQUE**

## Le résultat

**Les deux jeux de regles produisent EXACTEMENT les memes decisions sur l'historique disponible.**

| Stratégie | Coût total | Économie vs jour 1 (par composant) |
|---|---:|---:|
| Achat jour 1 (naïf) | 2374.68 EUR | — |
| **v2.9** (ligne de base, prompt 6.3) | 2363.44 EUR | +1.02 EUR ± 13.16 |
| **v3.1** (probabiliste, prompts 7.1-7.4) | 2363.44 EUR | +1.02 EUR ± 13.16 |
| Optimum théorique (connaît l'avenir) | 2334.93 EUR | — |

### Écart v3.1 − v2.9, apparié par composant

Comparaison appariée : même composant, même historique, seule la règle
change. C'est la seule lecture honnête sur un échantillon de cette taille.

- Écart moyen : **+0.00 EUR ± 0.00** (n=11)
- Étendue : +0.00 EUR à +0.00 EUR
- Composants où les deux règles divergent : **0/11**
- Achats suspendus par l'espérance de gain : **0**

## Détail par composant

| Composant | dates | jour 1 | v2.9 | v3.1 | écart | susp. |
|---|---:|---:|---:|---:|---:|---:|
| MSI MAG A650BN 650W 80+ Bronze | 2 | 56.65 | 56.65 | 56.65 | +0.00 | 0 |
| MSI MAG Forge 320R Airflow | 2 | 74.90 | 74.90 | 74.90 | +0.00 | 0 |
| Gigabyte B550 Gaming X V2 | 2 | 94.99 | 94.99 | 94.99 | +0.00 | 0 |
| AMD Ryzen 5 5600 | 2 | 122.60 | 125.54 | 125.54 | +0.00 | 0 |
| AMD Ryzen 7 5700X | 4 | 122.60 | 121.45 | 121.45 | +0.00 | 0 |
| AMD Ryzen 7 5700X3D | 2 | 229.95 | 195.89 | 195.89 | +0.00 | 0 |
| NVIDIA RTX 5060 Ti 16 Go | 3 | 449.00 | 446.26 | 446.26 | +0.00 | 0 |
| NVIDIA RTX 5060 Ti 8 Go | 3 | 399.00 | 399.00 | 399.00 | +0.00 | 0 |
| AMD RX 9060 (non-XT) 8 Go | 2 | 369.00 | 392.77 | 392.77 | +0.00 | 0 |
| AMD RX 9060 XT 16 Go | 4 | 349.00 | 349.00 | 349.00 | +0.00 | 0 |
| Lexar ARES 512 Go NVMe Gen4 | 2 | 106.99 | 106.99 | 106.99 | +0.00 | 0 |

## Ce que « v3.1 » change exactement dans le rejeu

Deux ajouts, et deux seulement :

1. **Calendrier produit décisionnel** (7.3) — un refresh annoncé pousse
   le conseil vers ATTENDRE, évalué **à la date simulée**.
2. **Suspension probabiliste** (7.2, fondée sur 7.1) — un déclencheur
   d'achat est suspendu si l'espérance de gain à attendre est
   **mesurable et positive**. Jamais sur une intuition : sous le seuil
   d'échantillon, aucune suspension.

L'optimiseur de séquence (7.4) n'intervient pas ici : il arbitre *entre*
slots sous contrainte de budget, alors que le banc rejoue chaque
composant indépendamment. Le mesurer demanderait un backtest de
portefeuille — un chantier distinct, et honnêtement hors de portée de
l'historique actuel.

Tout le reste est identique : même historique, même prix retenu, même
absence de lookahead, même horloge gelée.

## ⚠️ Réserve de validité

L'échantillon reste **sous les seuils de validité** du banc (voir
`BASELINE.md`). Ces chiffres décrivent ce qui s'est passé sur
l'historique disponible ; ils ne permettent pas de trancher sur la
qualité générale des règles.

C'est le risque que la feuille de route nomme explicitement en §9 —
*« la fausse précision qui revient par la fenêtre »*. Un chiffre
favorable produit ici serait un artefact, pas une preuve.

**Ce document se met à jour tout seul** : chaque exécution
quotidienne ajoute des dates de décision. Relancer
`python backtest.py --comparer` régénère la comparaison.

## Contrôle de sanité : le mécanisme fonctionne-t-il ?

« Les deux règles donnent le même résultat » serait ambigu : mécanisme
inopérant, ou code mort ? Le banc rejoue donc un historique **construit
pour déclencher la suspension** (dérive baissière, plancher de référence
bas). Résultat, exécuté à chaque génération de ce document :

- Suspensions déclenchées : **13** — le mécanisme est actif.
- v2.9 achète le 2026-02-18 à **347.54 EUR**
- v3.1 achète le 2026-07-23 à **360.03 EUR**
- Écart : **-12.49 EUR** (defavorable)

> ⚠️ **Le mécanisme fonctionne, mais dégrade le résultat dans ce
> cas.** À force de différer sur une espérance toujours positive
> (tendance baissière durable), l'achat rate le bon prix et finit
> au dernier relevé. C'est un piège réel de la règle de
> suspension : elle n'a pas de condition de sortie.

Piste si ce comportement se confirme sur de vraies données :
borner le nombre de reports consécutifs, ou exiger que
l'espérance reste positive **et** que le prix ne soit pas déjà
sous le plancher de référence.

## Pourquoi les deux règles donnent le même résultat

Ce n'est pas un bug, c'est le comportement voulu. Les mécanismes de
la Vague 7 sont **conditionnés à une taille d'échantillon** :

- `esperance_attente` refuse d'estimer sous 5 fenêtres indépendantes ;
- l'historique actuel compte 1 à 4 dates par composant ;
- aucun `refresh` n'est déclaré dans `config.json`.

Résultat : aucune suspension ne se déclenche, aucun signal
événementiel ne s'applique, et v3.1 se comporte exactement comme
v2.9. **La Vague 7 n'a donc, à ce jour, ajouté que de la
complexité — pas encore de valeur mesurable.** Elle en ajoutera
quand les données le permettront, et ce document le dira.

---

*Fichier régénéré par `python backtest.py --comparer --ecrire-vague7`.*
