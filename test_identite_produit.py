# -*- coding: utf-8 -*-
"""
Filet de securite de la couche SQLite (bascule 6.4).

Verrouille les proprietes sur lesquelles repose la bascule :

  * les VUES SQL des chemins chauds donnent les memes valeurs que les calculs
    Python d'analyze_component (plancher, prix courant, moyennes) ;
  * `charger_history` reconstruit exactement l'etat de travail, y compris
    l'ORDRE des entrees -- analyze_component prend `entries[-1]` comme prix
    courant, un ordre different changerait les conseils ;
  * l'aller-retour charger -> persister -> charger est stable ;
  * `archiver_historique` NE DETRUIT PLUS RIEN et l'historique au-dela de
    90 jours reste interrogeable ;
  * la condensation hebdomadaire est une VUE : aucun releve n'est perdu.
"""
import sqlite3
import statistics
from datetime import date, timedelta

import pytest

import price_tracker as pt
import sqlite_store


# --- Jeu d'essai : inclut volontairement un releve tres ancien (> 90 jours)
#     et deux releves le meme jour chez le meme vendeur (prix differents).
def _hier(n):
    return (date.today() - timedelta(days=n)).isoformat()


HISTORY = {
    "widget_a": {
        "name": "Widget A", "category": "GPU", "seed_imported": True,
        "entries": [
            {"date": _hier(250), "site": "ldlc", "price": 400.0, "origin": "seed"},
            {"date": _hier(120), "site": "ldlc", "price": 380.0, "origin": "seed"},
            {"date": _hier(20), "site": "ldlc", "price": 350.0, "origin": "tracked"},
            {"date": _hier(3), "site": "ldlc", "price": 360.0, "origin": "tracked"},
            {"date": _hier(3), "site": "cdiscount", "price": 355.0, "origin": "tracked"},
        ],
    },
    "widget_b": {
        "name": "Widget B", "category": "CPU", "seed_imported": False,
        "entries": [
            {"date": _hier(10), "site": "ldlc", "price": 100.0, "origin": "tracked"},
            {"date": _hier(10), "site": "ldlc", "price": 110.0, "origin": "seed"},
        ],
    },
    "_slots_winners": {"gpu": "widget_a"},
}

CONFIG = {
    "components": [
        {"id": "widget_a", "name": "Widget A", "category": "GPU",
         "slot": "gpu", "perf_index": 100},
        {"id": "widget_b", "name": "Widget B", "category": "CPU"},
    ],
    "vendeurs": {"ldlc": {"type": "marchand", "actif": True, "priorite": 2}},
}


@pytest.fixture
def base(tmp_path):
    """Base temporaire peuplee, connexion restauree apres le test."""
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "test.db")
    sqlite_store.persister(HISTORY, CONFIG)
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


# --- Vues des chemins chauds -----------------------------------------------

def test_vue_plancher_egale_calcul_python(base):
    m = base.metriques_produit("widget_a")
    prix = [e["price"] for e in HISTORY["widget_a"]["entries"]]
    assert m["plancher"] == pytest.approx(min(prix))
    assert m["plafond"] == pytest.approx(max(prix))
    assert m["nb_releves"] == len(prix)


def test_vue_prix_courant_suit_la_regle_de_production(base):
    """Prix courant = le moins cher du dernier jour releve."""
    entries = HISTORY["widget_a"]["entries"]
    dernier_jour = max(e["date"] for e in entries)
    attendu = min(e["price"] for e in entries if e["date"] == dernier_jour)
    m = base.metriques_produit("widget_a")
    assert m["prix_courant"] == pytest.approx(attendu)
    assert m["date_courante"] == dernier_jour


def test_vue_dernier_prix_un_par_couple_produit_vendeur(base):
    rows = base._conn.execute(
        "SELECT produit_id, vendeur_id, COUNT(*) FROM v_dernier_prix "
        "GROUP BY produit_id, vendeur_id HAVING COUNT(*) > 1").fetchall()
    # Plusieurs lignes ne sont admises que si le meme vendeur a plusieurs
    # releves le meme (dernier) jour -- c'est le cas de widget_b.
    for pid, vid, _ in rows:
        jours = {r[0] for r in base._conn.execute(
            "SELECT ts FROM v_dernier_prix WHERE produit_id=? AND vendeur_id=?",
            (pid, vid))}
        assert len(jours) == 1, f"{pid}/{vid} : plusieurs dates dans v_dernier_prix"


def test_vue_moyennes_glissantes_coherentes(base):
    m = base.metriques_produit("widget_a")
    entries = HISTORY["widget_a"]["entries"]
    limite_30 = (date.today() - timedelta(days=30)).isoformat()
    attendu = statistics.mean([e["price"] for e in entries if e["date"] >= limite_30])
    assert m["avg_30j"] == pytest.approx(attendu)
    # Une fenetre plus large contient au moins autant de releves.
    assert m["n_90j"] >= m["n_30j"] >= m["n_7j"]


# --- Reconstruction de l'etat de travail -----------------------------------

def test_charger_history_reconstruit_les_entrees(base):
    h = base.charger_history(CONFIG)
    for cid in ("widget_a", "widget_b"):
        attendu = HISTORY[cid]["entries"]
        obtenu = h[cid]["entries"]
        assert len(obtenu) == len(attendu)
        # L'ORDRE compte : entries[-1] est le prix courant.
        assert [(e["date"], e["site"], e["price"]) for e in obtenu] == \
               [(e["date"], e["site"], e["price"]) for e in attendu]


def test_charger_history_restitue_seed_imported(base):
    """Sans ce drapeau, les seed_history seraient reimportes a chaque cycle."""
    h = base.charger_history(CONFIG)
    assert h["widget_a"]["seed_imported"] is True
    assert h["widget_b"]["seed_imported"] is False


def test_charger_history_restitue_les_gagnants_de_slot(base):
    h = base.charger_history(CONFIG)
    assert h["_slots_winners"] == HISTORY["_slots_winners"]


def test_aller_retour_stable(base):
    """charger -> persister -> charger doit etre un point fixe."""
    h1 = base.charger_history(CONFIG)
    base.persister(h1, CONFIG)
    h2 = base.charger_history(CONFIG)
    assert h1 == h2


# --- Granularite complete conservee ----------------------------------------

def test_archiver_historique_ne_detruit_plus_rien():
    avant = {k: {**v, "entries": list(v["entries"])}
             for k, v in HISTORY.items() if k != "_slots_winners"}
    assert pt.archiver_historique(avant, 90) == 0
    for cid, node in avant.items():
        assert len(node["entries"]) == len(HISTORY[cid]["entries"])


def test_historique_au_dela_de_90_jours_toujours_present(base):
    limite = (date.today() - timedelta(days=90)).isoformat()
    n = base._conn.execute(
        "SELECT COUNT(*) FROM releves WHERE ts < ?", (limite,)).fetchone()[0]
    assert n >= 2, "Les releves anciens doivent rester en base (granularite complete)"


def test_vue_hebdomadaire_ne_perd_aucun_releve(base):
    total = base._conn.execute("SELECT COUNT(*) FROM releves").fetchone()[0]
    somme = sum(r["nb_releves"] for r in base.historique_hebdomadaire())
    assert somme == total, "La condensation est une VUE : rien ne doit disparaitre"


def test_export_history_json_est_une_photographie(base, tmp_path):
    cible = tmp_path / "export.json"
    exporte = base.exporter_history_json(cible, CONFIG)
    assert cible.exists()
    assert exporte == base.charger_history(CONFIG)
