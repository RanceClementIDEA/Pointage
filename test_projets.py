# Filet de sécurité — suite de tests `pytest`

Cette suite fige le comportement du **moteur d'extraction de prix** et des
**garde-fous de décision** de `price_tracker.py`, **avant** toute refonte du
moteur de collecte. Objectif : si un extracteur ou une règle régresse, un test
casse immédiatement — sans dépendre du réseau ni des sites marchands.

## Lancer la suite

```bash
pip install pytest beautifulsoup4 requests python-dotenv   # dépendances
pytest                                                     # depuis la racine du projet
```

`pytest` est volontairement limité au dossier `tests/` (voir `pytest.ini`).
Les anciens scripts `test_*.py` de la racine (`test_all.py`, `test_v6.py`,
`test_v7.py`…) restent des programmes autonomes lancés avec `python`.

## Garantie « sans réseau »

`conftest.py` installe une *fixture* automatique qui **bloque tout appel réseau**
(`requests.get/post/...` et `Session.request`) pendant les tests. Toute la suite
s'appuie uniquement sur les *golden files* de `tests/golden/`. Si un jour un test
tentait une requête, il échouerait avec un message explicite plutôt que de
partir en ligne silencieusement.

## Contenu

| Fichier | Ce qui est couvert | Source des valeurs attendues |
|---|---|---|
| `test_extracteurs_golden.py` | `extract_price_from_jsonld`, `extract_price_fallback`, `extract_min_price_from_page` sur 20 golden files (11 marchands + 3 comparateurs + 6 cas limites) | `tests/golden/manifest.json` |
| `test_prix_plausible.py` | `prix_plausible` — les 7 cas de `COMPATIBILITE_ET_RECHERCHE.md` + bornes | Tableau « réf. 429 € » du doc |
| `test_detecter_fausse_promo.py` | `detecter_fausse_promo` — les 5 scénarios de `ANALYSE_AVANCEE.md` (dont 2 négatifs) | Tableau « Tests effectués » du doc |

Deux tests de **couverture** dans `test_extracteurs_golden.py` garantissent que
les trois fonctions sont bien exercées et qu'aucun site déclarant des sélecteurs
CSS (`FALLBACK_SELECTORS` + `config.json/selecteurs_sites`) n'échappe au filet.

## Ajouter un cas

- **Nouveau site marchand / comparateur** → voir `tests/golden/README.md`.
- **Nouveau cas `prix_plausible` / `detecter_fausse_promo`** → ajouter une ligne
  dans la liste paramétrée du module correspondant.

## Principe des *golden files*

Chaque page reproduit fidèlement une structure que le code sait analyser
(JSON-LD `schema.org` et/ou l'élément CSS réellement configuré pour le site). Le
prix embarqué **est** la valeur attendue : le test vérifie que l'extracteur le
retrouve. Ces pages ne sont **pas** aspirées en direct — pour une fidélité
maximale sur un site, remplacer le `.html` par une vraie page enregistrée (ou son
seul bloc JSON-LD) et ajuster la valeur dans `manifest.json`.
