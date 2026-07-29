# -*- coding: utf-8 -*-
"""
Filet de securite des extracteurs de prix (price_tracker.py), hors-ligne.

Execute les trois extracteurs sur les golden files de tests/golden/ et verifie
que le prix extrait correspond a la valeur attendue documentee dans
tests/golden/manifest.json :

  * extract_price_from_jsonld   -- donnees structurees schema.org (Offer / AggregateOffer)
  * extract_price_fallback      -- selecteurs CSS par site (FALLBACK_SELECTORS + config)
  * extract_min_price_from_page -- montants bornes d'une page de comparateur

Aucune requete reseau : tout part des golden files. Ajouter un site = deposer
un .html + une entree dans manifest.json (voir tests/golden/README.md).
"""
import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

import price_tracker as pt

TESTS = Path(__file__).resolve().parent
GOLDEN = TESTS / "golden"
RACINE = TESTS.parent

_MANIFEST = json.loads((GOLDEN / "manifest.json").read_text(encoding="utf-8"))
_CONFIG = json.loads((RACINE / "config.json").read_text(encoding="utf-8"))
_SELECTEURS_CONFIG = _CONFIG.get("selecteurs_sites", {})


def _cas():
    """Aplati le manifest en parametres (fichier, fn, kwargs, attendu)."""
    for entree in _MANIFEST["entrees"]:
        for chk in entree["checks"]:
            ident = f"{entree['fichier']}::{chk['fn']}"
            if "prefer_low" in chk.get("kwargs", {}):
                ident += f"::low={chk['kwargs']['prefer_low']}"
            yield pytest.param(entree["fichier"], chk["fn"],
                               chk["kwargs"], chk["attendu"], id=ident)


@pytest.mark.parametrize("fichier, fn_nom, kwargs, attendu", list(_cas()))
def test_extraction_golden(fichier, fn_nom, kwargs, attendu):
    html = (GOLDEN / fichier).read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    kwargs = dict(kwargs)
    # La sentinelle "@config" signifie : passer les selecteurs de config.json
    # (necessaire pour les sites presents seulement dans selecteurs_sites).
    if kwargs.get("selecteurs") == "@config":
        kwargs["selecteurs"] = _SELECTEURS_CONFIG

    resultat = getattr(pt, fn_nom)(soup, **kwargs)

    if attendu is None:
        assert resultat is None, (
            f"{fichier} / {fn_nom}({kwargs}) : attendu None, obtenu {resultat!r}")
    else:
        assert resultat == pytest.approx(attendu), (
            f"{fichier} / {fn_nom}({kwargs}) : attendu {attendu}, obtenu {resultat!r}")


def test_manifest_couvre_les_trois_extracteurs():
    """Verifie que la suite exerce bien les trois fonctions ciblees."""
    exerces = {chk["fn"] for e in _MANIFEST["entrees"] for chk in e["checks"]}
    assert exerces == {
        "extract_price_from_jsonld",
        "extract_price_fallback",
        "extract_min_price_from_page",
    }


def test_tous_les_sites_a_selecteurs_ont_un_golden():
    """
    Garde-fou de couverture : chaque site declarant des selecteurs CSS
    (FALLBACK_SELECTORS cote code + selecteurs_sites cote config) doit avoir
    un golden file marchand qui teste son fallback. Empeche qu'un site ajoute
    a la config passe silencieusement sans test.
    """
    sites_code = set(pt.FALLBACK_SELECTORS)
    sites_config = {s for s in _SELECTEURS_CONFIG if not s.startswith("_")}
    attendus = sites_code | sites_config

    testes_en_fallback = {
        chk["kwargs"]["site"]
        for e in _MANIFEST["entrees"] for chk in e["checks"]
        if chk["fn"] == "extract_price_fallback" and chk["attendu"] is not None
    }
    manquants = attendus - testes_en_fallback
    assert not manquants, f"Sites a selecteurs sans golden de fallback : {sorted(manquants)}"
