# -*- coding: utf-8 -*-
"""
Filet de securite de la detection de selecteur casse (Axe 3, prompt 8.2).

Verrouille :
  * la distinction entre « ne repond plus » et « repond mais ne rend plus de
    prix » -- confondre les deux, c'est chercher une panne reseau la ou le
    HTML a change ;
  * le seuil de 48 h (2 jours consecutifs) fixe par la feuille de route ;
  * un site qui n'a JAMAIS produit de prix n'est pas declare « casse » ;
  * les candidats proposes sont pertinents, hierarchises, et JAMAIS appliques
    automatiquement ;
  * un prix barre est retrograde, pas propose en tete.
"""
from datetime import date, timedelta

import pytest

import price_tracker as pt
import sqlite_store


@pytest.fixture
def base(tmp_path, monkeypatch):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "sel.db")
    monkeypatch.setattr(pt, "SNAPSHOTS_DIR", tmp_path / "snapshots")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


CONFIG = {"components": [{"id": "c1", "name": "C1", "category": "GPU",
                          "sources": [{"site": "ldlc", "url": "https://ldlc.test/x"}],
                          "reference": {"typical_price": 430.0}}],
          "selecteurs_sites": {"ldlc": [".price"]}}


def _jour(n):
    return (date.today() - timedelta(days=n)).isoformat()


def _scenario(base, site="ldlc", jours_muets=2, succes_avant=True):
    if succes_avant:
        for n in (5, 4, 3):
            base.enregistrer_sante_extraction(
                {site: {"ok": 4, "prix": 4, "palier": "selecteurs"}}, jour=_jour(n))
    for n in range(jours_muets - 1, -1, -1):
        base.enregistrer_sante_extraction(
            {site: {"ok": 4, "prix": 0, "palier": None}}, jour=_jour(n))


# --- Detection -------------------------------------------------------------

def test_detecte_un_selecteur_casse_sous_48h(base):
    """Le critere : 2 jours consecutifs suffisent."""
    _scenario(base, jours_muets=2)
    casses = pt.detecter_selecteur_casse(CONFIG)
    assert len(casses) == 1
    assert casses[0]["site"] == "ldlc"
    assert casses[0]["jours_muets"] == 2
    assert casses[0]["requetes_recentes"] == 8


def test_un_seul_jour_muet_ne_suffit_pas(base):
    _scenario(base, jours_muets=1)
    assert pt.detecter_selecteur_casse(CONFIG) == []


def test_un_site_injoignable_nest_pas_un_selecteur_casse(base):
    """« Aucune reponse » est une autre panne : requetes_ok = 0."""
    for n in (5, 4, 3):
        base.enregistrer_sante_extraction(
            {"cdiscount": {"ok": 4, "prix": 4, "palier": "jsonld"}}, jour=_jour(n))
    for n in (1, 0):
        base.enregistrer_sante_extraction(
            {"cdiscount": {"ok": 0, "prix": 0, "palier": None}}, jour=_jour(n))
    assert pt.detecter_selecteur_casse(CONFIG) == []


def test_un_site_qui_na_jamais_produit_de_prix_nest_pas_casse(base):
    """Sans succes passe, il n'y a rien de « casse » a signaler."""
    _scenario(base, jours_muets=3, succes_avant=False)
    assert pt.detecter_selecteur_casse(CONFIG) == []


def test_un_retour_a_la_normale_efface_lalerte(base):
    _scenario(base, jours_muets=2)
    base.enregistrer_sante_extraction(
        {"ldlc": {"ok": 4, "prix": 4, "palier": "selecteurs"}}, jour=_jour(0))
    assert pt.detecter_selecteur_casse(CONFIG) == []


def test_le_dernier_succes_est_rapporte(base):
    _scenario(base, jours_muets=2)
    c = pt.detecter_selecteur_casse(CONFIG)[0]
    assert c["dernier_succes"] == _jour(3)
    assert c["palier_perdu"] == "selecteurs"


# --- Proposition de selecteur ---------------------------------------------

PAGE_REFONDUE = """<html><body>
  <div class="product-pricing">429,99 &euro;</div>
  <div class="old-price">499,00 &euro;</div>
  <span itemprop="price" content="429.99">429,99 &euro;</span>
  <div class="shipping-cost">4,99 &euro;</div>
</body></html>"""


def test_propose_le_nouveau_selecteur():
    props = pt.proposer_selecteur(PAGE_REFONDUE, [".price"])
    selecteurs = [p["selecteur"] for p in props]
    assert ".product-pricing" in selecteurs, "Le vrai nouveau selecteur doit sortir"


def test_les_donnees_structurees_passent_en_tete():
    props = pt.proposer_selecteur(PAGE_REFONDUE, [".price"])
    assert props[0]["confiance"] == "haute"
    assert "itemprop" in props[0]["selecteur"]


def test_un_prix_barre_est_retrograde():
    props = pt.proposer_selecteur(PAGE_REFONDUE, [".price"])
    vieux = next((p for p in props if p["selecteur"] == ".old-price"), None)
    assert vieux is not None, "Il reste propose : il peut etre le seul repere"
    assert vieux["confiance"] == "faible"
    assert "ancien tarif" in vieux["motif"]
    # Et jamais en premier.
    assert props[0]["selecteur"] != ".old-price"


def test_le_selecteur_actuel_nest_pas_repropose():
    props = pt.proposer_selecteur(
        '<div class="price">429,99 &euro;</div>', [".price"])
    assert all(p["selecteur"] != ".price" for p in props)


def test_les_radicaux_sont_reconnus():
    """« pricing », « prixTTC », « costBox » doivent etre vus."""
    for classe in ("product-pricing", "prixTTC", "costBox", "montant-final"):
        props = pt.proposer_selecteur(
            f'<div class="{classe}">200,00 &euro;</div>')
        assert any(classe in p["selecteur"] for p in props), classe


def test_une_page_sans_prix_ne_propose_rien():
    assert pt.proposer_selecteur("<html><body>rien</body></html>") == []
    assert pt.proposer_selecteur("") == []
    assert pt.proposer_selecteur(None) == []


def test_les_montants_absurdes_sont_ecartes():
    props = pt.proposer_selecteur(
        '<div class="price">0,99 &euro;</div><div class="prix">99999,00 &euro;</div>')
    assert props == []


# --- Diagnostic complet ----------------------------------------------------

def test_diagnostic_avec_snapshot(base, tmp_path):
    _scenario(base, jours_muets=2)
    snaps = tmp_path / "snapshots"
    snaps.mkdir()
    (snaps / "ldlc.html").write_text(PAGE_REFONDUE, encoding="utf-8")

    diags = pt.diagnostiquer_selecteurs(CONFIG)
    assert len(diags) == 1
    assert diags[0]["snapshot"] is True
    assert diags[0]["propositions"], "Un snapshot doit permettre des candidats"


def test_diagnostic_sans_snapshot_alerte_quand_meme(base):
    """Savoir qu'un selecteur est casse vaut mieux que ne rien savoir."""
    _scenario(base, jours_muets=2)
    diags = pt.diagnostiquer_selecteurs(CONFIG)
    assert len(diags) == 1
    assert diags[0]["snapshot"] is False
    assert diags[0]["propositions"] == []


def test_le_rapport_distingue_les_deux_pannes(base, tmp_path):
    _scenario(base, jours_muets=2)
    snaps = tmp_path / "snapshots"
    snaps.mkdir()
    (snaps / "ldlc.html").write_text(PAGE_REFONDUE, encoding="utf-8")
    html = pt.build_selecteurs_html(pt.diagnostiquer_selecteurs(CONFIG))
    assert "casse" in html.lower()
    assert "pas d'une panne reseau" in html
    assert "Aucun selecteur n'est applique automatiquement" in html


def test_pas_dalerte_pas_de_bloc():
    assert pt.build_selecteurs_html([]) == ""


def test_charger_snapshot_absent(base):
    assert pt.charger_snapshot("inconnu") is None
