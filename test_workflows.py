# -*- coding: utf-8 -*-
"""
Filet de securite de la cascade de collecte (Axe 3, prompt 8.1).

Verrouille :
  * les paliers sont ordonnes par confiance decroissante, API en tete ;
  * la cascade rend LE PALIER ayant reellement produit le prix ;
  * le comportement d'extraction est INCHANGE (memes prix qu'avant) ;
  * le palier survit a l'aller-retour SQLite -- sans quoi `persister`
    l'effacerait a la premiere sauvegarde ;
  * un composant entierement suivi par le palier le plus bas est signale.
"""
import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

import price_tracker as pt
import sqlite_store

RACINE = Path(__file__).resolve().parent.parent
GOLDEN = RACINE / "tests" / "golden"
_CONFIG = json.loads((RACINE / "config.json").read_text(encoding="utf-8"))
_SEL = _CONFIG.get("selecteurs_sites", {})


# --- Definition de la cascade ---------------------------------------------

def test_les_paliers_sont_ordonnes_par_confiance():
    rangs = [p["rang"] for p in pt.CASCADE]
    assert rangs == sorted(rangs), "La cascade doit etre ordonnee"
    assert pt.CASCADE[0]["tier"] == "api", "L'API officielle est en tete"
    assert pt.CASCADE[-1]["tier"] == pt.TIER_LE_PLUS_BAS


def test_le_palier_api_est_prevu_mais_non_implemente():
    api = pt.PALIERS["api"]
    assert "non implemente" in api["note"].lower()


def test_chaque_palier_est_documente():
    for p in pt.CASCADE:
        assert p["libelle"] and p["note"] and p["confiance"]
    assert pt.palier_info("jsonld")["confiance"] == "haute"
    assert pt.palier_info("borne")["confiance"] == "faible"
    assert pt.palier_info("inconnu") is None


# --- La cascade rend le bon palier ----------------------------------------

def _soup(fichier):
    return BeautifulSoup((GOLDEN / fichier).read_text(encoding="utf-8"),
                         "html.parser")


@pytest.mark.parametrize("fichier, site, comparateur, palier_attendu, prix_attendu", [
    ("marchand_ldlc.html", "ldlc", False, "jsonld", 429.99),
    ("marchand_cdiscount.html", "cdiscount", False, "jsonld", 419.90),
    ("cas_css_seul_ldlc.html", "ldlc", False, "selecteurs", 259.00),
    ("comparateur_idealo.html", "idealo", True, "jsonld", 399.00),
    ("cas_sans_prix.html", "ldlc", False, None, None),
])
def test_le_palier_correspond_a_la_methode_reelle(fichier, site, comparateur,
                                                  palier_attendu, prix_attendu):
    prix, palier = pt.extraire_prix_cascade(_soup(fichier), site, _SEL, comparateur)
    assert palier == palier_attendu
    if prix_attendu is None:
        assert prix is None
    else:
        assert prix == pytest.approx(prix_attendu)


def test_extraction_bornee_quand_le_comparateur_na_pas_de_jsonld():
    """Sur un comparateur sans donnees structurees : palier le plus bas."""
    html = ('<html><body><ul><li>Marchand A &mdash; 397,00 &euro;</li>'
            '<li>Marchand B &mdash; 421,50 &euro;</li></ul></body></html>')
    prix, palier = pt.extraire_prix_cascade(
        BeautifulSoup(html, "html.parser"), "idealo", _SEL, True)
    assert palier == "borne"
    assert prix == pytest.approx(397.00)


def test_le_comportement_dextraction_est_inchange():
    """
    La cascade ne doit rien changer aux prix : elle ne fait qu'expliciter
    d'ou ils viennent.
    """
    for fichier, site, comp in (("marchand_ldlc.html", "ldlc", False),
                                ("comparateur_geizhals.html", "geizhals", True),
                                ("cas_css_seul_ldlc.html", "ldlc", False)):
        soup_a, soup_b = _soup(fichier), _soup(fichier)
        # Reproduction de l'ancienne chaine, a l'identique.
        ancien = pt.extract_price_from_jsonld(soup_a, prefer_low=comp)
        if ancien is None and comp:
            ancien = pt.extract_min_price_from_page(soup_a)
        if ancien is None:
            ancien = pt.extract_price_fallback(soup_a, site, _SEL)
        nouveau, _ = pt.extraire_prix_cascade(soup_b, site, _SEL, comp)
        assert nouveau == ancien, f"{fichier} : le prix a change"


# --- Persistance du palier -------------------------------------------------

@pytest.fixture
def base(tmp_path):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "cascade.db")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


CONFIG_TEST = {"components": [{"id": "c1", "name": "C1", "category": "GPU"}]}


def test_le_palier_survit_a_laller_retour(base):
    """`persister` reconstruit la table : le palier doit voyager avec l'entree."""
    history = {"c1": {"name": "C1", "category": "GPU", "seed_imported": False,
                      "entries": [
                          {"date": "2026-07-28", "site": "ldlc", "price": 100.0,
                           "origin": "tracked", "tier": "jsonld"},
                          {"date": "2026-07-28", "site": "cdiscount", "price": 110.0,
                           "origin": "tracked", "tier": "borne"}]}}
    base.persister(history, CONFIG_TEST)
    relu = base.charger_history(CONFIG_TEST)
    paliers = {e["site"]: e.get("tier") for e in relu["c1"]["entries"]}
    assert paliers == {"ldlc": "jsonld", "cdiscount": "borne"}


def test_une_entree_sans_palier_reste_sans_palier(base):
    """Aller-retour stable : pas de cle inventee pour les releves anciens."""
    history = {"c1": {"name": "C1", "category": "GPU", "seed_imported": False,
                      "entries": [{"date": "2026-07-28", "site": "ldlc",
                                   "price": 100.0, "origin": "seed"}]}}
    base.persister(history, CONFIG_TEST)
    relu = base.charger_history(CONFIG_TEST)
    assert "tier" not in relu["c1"]["entries"][0]
    # Et l'aller-retour est un point fixe.
    base.persister(relu, CONFIG_TEST)
    assert base.charger_history(CONFIG_TEST) == relu


def test_add_price_entry_enregistre_le_palier():
    history = {"c1": {"name": "C1", "category": "GPU", "entries": []}}
    pt.add_price_entry(history, "c1", 100.0, "ldlc", when="2026-07-28",
                       source_tier="jsonld")
    assert history["c1"]["entries"][0]["tier"] == "jsonld"


def test_add_price_entry_sans_palier_nen_invente_pas():
    history = {"c1": {"name": "C1", "category": "GPU", "entries": []}}
    pt.add_price_entry(history, "c1", 100.0, "ldlc", when="2026-07-28")
    assert "tier" not in history["c1"]["entries"][0]


# --- Signal de fragilite ---------------------------------------------------

def _hist(tiers, jours=1):
    jour = (date.today() - timedelta(days=jours)).isoformat()
    return {"c1": {"name": "C1", "category": "GPU", "entries": [
        {"date": jour, "site": f"s{i}", "price": 100.0 + i,
         "origin": "tracked", **({"tier": t} if t else {})}
        for i, t in enumerate(tiers)]}}


def test_toutes_les_sources_au_palier_le_plus_bas_est_signale():
    fragiles = pt.fragilite_cascade(_hist(["borne", "borne"]), CONFIG_TEST)
    assert len(fragiles) == 1
    assert fragiles[0]["id"] == "c1"
    assert fragiles[0]["sites"] == ["s0", "s1"]


def test_une_seule_source_sure_suffit_a_ne_pas_signaler():
    fragiles = pt.fragilite_cascade(_hist(["borne", "jsonld"]), CONFIG_TEST)
    assert fragiles == []


def test_un_palier_inconnu_ne_declenche_aucun_jugement():
    """Les releves anterieurs a la cascade ne prouvent rien."""
    fragiles = pt.fragilite_cascade(_hist(["borne", None]), CONFIG_TEST)
    assert fragiles == []


def test_le_signal_apparait_dans_le_rapport():
    fragiles = pt.fragilite_cascade(_hist(["borne"]), CONFIG_TEST)
    html = pt.build_fragilite_html(fragiles)
    assert "extraction bornee" in html
    assert "C1" in html
    assert pt.build_fragilite_html([]) == ""
