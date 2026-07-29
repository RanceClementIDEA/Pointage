# -*- coding: utf-8 -*-
"""
Filet de securite du modele multi-projets (Axe 5, prompt 8.5).

Le critere central est NEGATIF : un utilisateur avec un seul projet ne doit
voir AUCUN changement. Les tests verrouillent donc d'abord la
retro-compatibilite, puis la structure prete pour la suite :

  * la forme historique (`projet` : un dict) reste valide et se normalise ;
  * charger_achats / pression_calendrier / bilan_achats operent par projet
    sans changer de resultat quand il n'y en a qu'un ;
  * la migration cree le projet #1 sans perte ;
  * la forme multi-projets (`projets` : une liste) est deja acceptee.
"""
import json
from datetime import date, timedelta

import pytest

import price_tracker as pt
import sqlite_store


CONFIG_HISTORIQUE = {
    "budget": {"target_total": 1000, "max_total": 1150, "currency": "EUR"},
    "projet": {"_comment": "doc", "nom": "Tour polyvalente",
               "date_cible": None, "achats": []},
    "components": [
        {"id": "cpu", "name": "CPU", "category": "CPU", "slot": "CPU"},
        {"id": "gpu", "name": "GPU", "category": "GPU", "slot": "GPU"},
        {"id": "ssd", "name": "SSD", "category": "SSD"},
    ],
}


# --- Retro-compatibilite : la forme historique reste valide ---------------

def test_la_forme_historique_est_normalisee():
    projets = pt.projets_du_config(CONFIG_HISTORIQUE)
    assert len(projets) == 1
    p = projets[0]
    assert p["id"] == pt.PROJET_PAR_DEFAUT
    assert p["nom"] == "Tour polyvalente"
    assert p["budget"]["target_total"] == 1000
    assert p["composants"] is None, "Un projet unique couvre tous les composants"


def test_un_projet_unique_couvre_tous_les_composants():
    assert len(pt.composants_du_projet(CONFIG_HISTORIQUE)) == 3


def test_config_sans_projet_du_tout():
    """Une configuration minimale ne doit pas planter."""
    projets = pt.projets_du_config({"components": []})
    assert len(projets) == 1
    assert projets[0]["id"] == pt.PROJET_PAR_DEFAUT


def test_le_commentaire_de_config_nest_pas_pris_pour_un_projet():
    cfg = {**CONFIG_HISTORIQUE, "projet": {"_comment": "seulement de la doc"}}
    projets = pt.projets_du_config(cfg)
    assert len(projets) == 1


# --- Les trois fonctions adaptees --------------------------------------

def test_charger_achats_sans_projet_id_reproduit_lancien_comportement():
    cfg = {**CONFIG_HISTORIQUE,
           "projet": {"nom": "T", "achats": [
               {"id": "cpu", "prix": 150.0, "date": "2026-07-01", "site": "ldlc"}]}}
    achats = pt.charger_achats(cfg)
    assert set(achats) == {"cpu"}
    assert achats["cpu"]["prix"] == 150.0


def test_charger_achats_par_projet():
    cfg = {**CONFIG_HISTORIQUE, "projets": [
        {"id": "a", "nom": "A", "achats": [{"id": "cpu", "prix": 150.0,
                                            "date": "2026-07-01", "site": "x"}]},
        {"id": "b", "nom": "B", "achats": [{"id": "gpu", "prix": 400.0,
                                            "date": "2026-07-02", "site": "y"}]}]}
    assert set(pt.charger_achats(cfg, "a")) == {"cpu"}
    assert set(pt.charger_achats(cfg, "b")) == {"gpu"}


def test_pression_calendrier_lit_la_date_du_projet():
    cible = (date.today() + timedelta(days=10)).isoformat()
    cfg = {**CONFIG_HISTORIQUE,
           "projet": {"nom": "T", "date_cible": cible, "achats": []}}
    p = pt.pression_calendrier(cfg)
    assert p is not None and p["jours"] == 10


def test_pression_calendrier_par_projet():
    proche = (date.today() + timedelta(days=5)).isoformat()
    loin = (date.today() + timedelta(days=200)).isoformat()
    cfg = {**CONFIG_HISTORIQUE, "projets": [
        {"id": "a", "nom": "A", "date_cible": proche},
        {"id": "b", "nom": "B", "date_cible": loin}]}
    assert pt.pression_calendrier(cfg, "a")["jours"] == 5
    assert pt.pression_calendrier(cfg, "b")["jours"] == 200


def test_pression_calendrier_sans_date_cible():
    assert pt.pression_calendrier(CONFIG_HISTORIQUE) is None


def test_bilan_achats_etiquette_le_projet():
    history = {"cpu": {"name": "CPU", "entries": [
        {"date": "2026-07-01", "site": "x", "price": 140.0}]}}
    achats = {"cpu": {"id": "cpu", "prix": 150.0, "date": "2026-07-01", "site": "x"}}
    bilan = pt.bilan_achats(achats, history, "projet-1")
    assert bilan["projet_id"] == "projet-1"
    assert bilan["total_paye"] == pytest.approx(150.0)
    assert bilan["ecart_total"] == pytest.approx(10.0)


def test_bilan_achats_sans_achat():
    assert pt.bilan_achats({}, {}) is None


# --- Structure prete pour le multi-projets -------------------------------

def test_la_forme_multi_projets_est_acceptee():
    cfg = {**CONFIG_HISTORIQUE, "projets": [
        {"id": "tour", "nom": "Tour", "budget": {"target_total": 1000}},
        {"id": "nas", "nom": "NAS", "budget": {"target_total": 600},
         "composants": ["ssd"]}]}
    projets = pt.projets_du_config(cfg)
    assert [p["id"] for p in projets] == ["tour", "nas"]
    assert len(pt.composants_du_projet(cfg, "tour")) == 3
    assert len(pt.composants_du_projet(cfg, "nas")) == 1


def test_chaque_projet_a_son_budget():
    cfg = {**CONFIG_HISTORIQUE, "projets": [
        {"id": "a", "nom": "A", "budget": {"target_total": 500}},
        {"id": "b", "nom": "B"}]}          # b herite du budget global
    projets = {p["id"]: p for p in pt.projets_du_config(cfg)}
    assert projets["a"]["budget"]["target_total"] == 500
    assert projets["b"]["budget"]["target_total"] == 1000


def test_projet_actif_choisit_le_premier_actif():
    cfg = {**CONFIG_HISTORIQUE, "projets": [
        {"id": "vieux", "nom": "Vieux", "actif": False},
        {"id": "courant", "nom": "Courant"}]}
    assert pt.projet_actif(cfg)["id"] == "courant"
    assert pt.projet_actif(cfg, "vieux")["id"] == "vieux"


# --- Migration vers SQLite -------------------------------------------------

@pytest.fixture
def base(tmp_path):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "projets.db")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


def test_la_migration_cree_le_projet_1_sans_perte(base):
    cfg = {**CONFIG_HISTORIQUE,
           "projet": {"nom": "Tour polyvalente", "date_cible": "2026-12-01",
                      "achats": [{"id": "cpu", "prix": 150.0,
                                  "date": "2026-07-01", "site": "ldlc"}]}}
    assert pt.synchroniser_projets(cfg) == 1

    projets = base.charger_projets()
    assert len(projets) == 1
    p = projets[0]
    assert p["id"] == pt.PROJET_PAR_DEFAUT
    assert p["nom"] == "Tour polyvalente"
    assert p["budget_target"] == pytest.approx(1000)
    assert p["budget_max"] == pytest.approx(1150)
    assert p["date_cible"] == "2026-12-01"

    comps = base.composants_du_projet(pt.PROJET_PAR_DEFAUT)
    assert len(comps) == 3
    achete = next(c for c in comps if c["produit_id"] == "cpu")
    assert achete["achete_le"] == "2026-07-01"
    assert achete["prix_achat"] == pytest.approx(150.0)
    assert achete["site_achat"] == "ldlc"


def test_le_slot_est_conserve(base):
    pt.synchroniser_projets(CONFIG_HISTORIQUE)
    comps = {c["produit_id"]: c for c in
             base.composants_du_projet(pt.PROJET_PAR_DEFAUT)}
    assert comps["cpu"]["slot"] == "CPU"
    assert comps["ssd"]["slot"] is None


def test_la_migration_est_idempotente(base):
    pt.synchroniser_projets(CONFIG_HISTORIQUE)
    pt.synchroniser_projets(CONFIG_HISTORIQUE)
    assert len(base.charger_projets()) == 1
    assert len(base.composants_du_projet(pt.PROJET_PAR_DEFAUT)) == 3


def test_un_composant_retire_disparait_du_projet(base):
    pt.synchroniser_projets(CONFIG_HISTORIQUE)
    reduit = {**CONFIG_HISTORIQUE,
              "components": CONFIG_HISTORIQUE["components"][:2]}
    pt.synchroniser_projets(reduit)
    ids = {c["produit_id"] for c in base.composants_du_projet(pt.PROJET_PAR_DEFAUT)}
    assert ids == {"cpu", "gpu"}


def test_deux_projets_partagent_le_socle(base):
    """Le meme composant peut servir deux projets : rien n'est duplique."""
    cfg = {**CONFIG_HISTORIQUE, "projets": [
        {"id": "tour", "nom": "Tour"},
        {"id": "nas", "nom": "NAS", "composants": ["ssd"]}]}
    assert pt.synchroniser_projets(cfg) == 2
    assert len(base.charger_projets()) == 2
    tour = {c["produit_id"] for c in base.composants_du_projet("tour")}
    nas = {c["produit_id"] for c in base.composants_du_projet("nas")}
    assert "ssd" in tour and "ssd" in nas, "Le socle est mutualise"


def test_synchronisation_sans_base_ne_plante_pas():
    ancienne = sqlite_store._conn
    sqlite_store._conn = None
    try:
        assert pt.synchroniser_projets(CONFIG_HISTORIQUE) == 0
    finally:
        sqlite_store._conn = ancienne
