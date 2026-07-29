# -*- coding: utf-8 -*-
"""
Filet de securite de simuler_promo rendu probabiliste (Axe 4, vague 7).

Verrouille :
  * chemin PROBABILISTE quand l'historique suffit -- avec sa taille
    d'echantillon ;
  * REPLI DETERMINISTE explicite sinon, jamais silencieux ;
  * les deux ne sont jamais presentes comme equivalents ;
  * le garde-fou d'echeance (`pression`) bloque la suggestion QUEL QUE SOIT
    le mode de calcul du gain ;
  * les cles historiques du dict restent presentes (retro-compatibilite du
    rapport).
"""
import random
from datetime import date, timedelta

import pytest

import price_tracker as pt
import probabilites as pb


EVENEMENT = {"name": "Black Friday", "days_until": 60, "typical_drop": 10,
             "best_for": ["GPU"]}


def _serie_profonde(prix_base=500.0, graine=3, jours=700, pas=4):
    """Historique long, avec cycles : de quoi estimer empiriquement."""
    random.seed(graine)
    depart = date.today() - timedelta(days=jours)
    entries = []
    for i in range(0, jours, pas):
        cycle = i % 110
        amplitude = 60 if (i // 110) % 2 == 0 else 130
        position = cycle / 55 if cycle <= 55 else (110 - cycle) / 55
        entries.append({"date": (depart + timedelta(days=i)).isoformat(),
                        "site": "demo",
                        "price": round(prix_base - amplitude * position
                                       + random.uniform(-6, 6), 2)})
    return entries


def _serie_mince():
    return [{"date": (date.today() - timedelta(days=d)).isoformat(),
             "site": "demo", "price": 400.0 - d}
            for d in (20, 10, 0)]


def _contexte(entries, cid="gpu_x", categorie="GPU", prix=450.0):
    results = [{"id": cid, "name": "GPU X", "category": categorie,
                "analysis": {"current": prix}}]
    history = {cid: {"name": "GPU X", "category": categorie,
                     "seed_imported": False, "entries": entries}}
    config = {"components": [{"id": cid, "name": "GPU X",
                              "category": categorie,
                              "recherche": "GPU X"}]}
    return results, history, config


# --- Chemin probabiliste ---------------------------------------------------

def test_historique_suffisant_donne_une_esperance_avec_n():
    results, history, config = _contexte(_serie_profonde())
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"},
                           history=history, config=config)
    assert sim is not None
    assert sim["methode"] == "probabiliste"
    assert sim["nb_probabilistes"] == 1 and sim["nb_deterministes"] == 0

    d = sim["detail"][0]
    assert d["methode"] == "probabiliste"
    assert d["n"] >= pb.SEUIL_ECHANTILLON, "n doit atteindre le seuil"
    # Les quatre grandeurs de la formule sont exposees.
    for cle in ("p_baisse", "p_hausse", "gain_moyen_pct", "perte_moyenne_pct"):
        assert d[cle] is not None
    assert "n=" in d["message"]


def test_lesperance_suit_la_formule_annoncee():
    """E[gain] = P(baisse) x gain_moyen - P(hausse) x perte_moyenne."""
    entries = _serie_profonde()
    r = pb.esperance_attente(entries, 60, prix_actuel=450.0)
    assert r["estimable"]
    attendu = (r["p_baisse"] / 100 * r["gain_moyen_pct"]
               - r["p_hausse"] / 100 * r["perte_moyenne_pct"])
    assert r["esperance_pct"] == pytest.approx(attendu, abs=0.02)


def test_les_deux_branches_sont_symetriques():
    """P(baisse) et P(hausse) partitionnent les fenetres observees."""
    r = pb.esperance_attente(_serie_profonde(), 60, 450.0)
    assert r["estimable"]
    assert r["p_baisse"] + r["p_hausse"] == pytest.approx(100.0, abs=0.1)


# --- Repli deterministe ----------------------------------------------------

def test_historique_insuffisant_retombe_sur_le_deterministe():
    results, history, config = _contexte(_serie_mince())
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"},
                           history=history, config=config)
    assert sim["methode"] == "deterministe"
    d = sim["detail"][0]
    assert d["methode"] == "deterministe"
    assert d["motif"], "Le repli doit dire POURQUOI il a lieu"
    # L'ancien calcul est bien celui applique : prix x typical_drop.
    assert d["economie"] == pytest.approx(450.0 * 0.10)


def test_le_repli_est_signale_dans_le_rapport_texte():
    results, history, config = _contexte(_serie_mince())
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"},
                           history=history, config=config)
    html = pt.build_projet_html(None, None, sim, {})
    assert "forfaitaire" in html, "Le rapport doit qualifier l'estimation"
    assert "moins fiable" in html, "Les deux methodes ne se valent pas"


def test_sans_history_le_comportement_historique_est_preserve():
    """Appel sans history (compatibilite) : ancien calcul, sans planter."""
    results, _, _ = _contexte(_serie_mince())
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"})
    assert sim["methode"] == "deterministe"
    assert sim["economie"] == pytest.approx(450.0 * 0.10)


def test_mixte_quand_les_composants_different():
    riche = _serie_profonde()
    results = [
        {"id": "riche", "name": "GPU riche", "category": "GPU",
         "analysis": {"current": 450.0}},
        {"id": "pauvre", "name": "GPU pauvre", "category": "GPU",
         "analysis": {"current": 300.0}},
    ]
    history = {"riche": {"name": "GPU riche", "category": "GPU", "entries": riche},
               "pauvre": {"name": "GPU pauvre", "category": "GPU",
                          "entries": _serie_mince()}}
    config = {"components": [
        {"id": "riche", "name": "GPU riche", "category": "GPU"},
        {"id": "pauvre", "name": "GPU pauvre", "category": "GPU"}]}

    sim = pt.simuler_promo(results, EVENEMENT, {"riche", "pauvre"},
                           history=history, config=config)
    assert sim["methode"] == "mixte"
    assert sim["nb_probabilistes"] == 1 and sim["nb_deterministes"] == 1
    # Les deux totaux restent separes, pas fondus en un chiffre unique.
    assert sim["economie"] == pytest.approx(
        sim["economie_probabiliste"] + sim["economie_deterministe"], abs=0.01)


# --- Garde-fou d'echeance : intact, quel que soit le calcul ---------------

@pytest.mark.parametrize("entries, methode_attendue", [
    (_serie_profonde(), "probabiliste"),
    (_serie_mince(), "deterministe"),
])
def test_le_garde_fou_decheance_bloque_dans_les_deux_modes(entries, methode_attendue):
    """L'incompatibilite de date ne depend PAS du mode de calcul du gain."""
    results, history, config = _contexte(entries)
    pression = {"jours": 20, "niveau": "proche", "date": "2026-08-17",
                "message": "20 jours restants"}
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"}, pression=pression,
                           history=history, config=config)
    assert sim["methode"] == methode_attendue
    assert sim["incompatible"], "La suggestion doit rester bloquee"
    assert "APRES votre echeance" in sim["incompatible"]


def test_pas_dincompatibilite_quand_lecheance_est_lointaine():
    results, history, config = _contexte(_serie_profonde())
    pression = {"jours": 200, "niveau": "confortable", "date": "2027-02-01",
                "message": "200 jours restants"}
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"}, pression=pression,
                           history=history, config=config)
    assert sim["incompatible"] is None


# --- Retro-compatibilite du dict ------------------------------------------

def test_les_cles_historiques_restent_presentes():
    results, history, config = _contexte(_serie_profonde())
    sim = pt.simuler_promo(results, EVENEMENT, {"gpu_x"},
                           history=history, config=config)
    for cle in ("evenement", "jours", "baisse_pct", "nb_concernes", "noms",
                "total_actuel", "total_projete", "economie", "incompatible"):
        assert cle in sim, f"cle historique manquante : {cle}"
    assert sim["total_projete"] == pytest.approx(
        sim["total_actuel"] - sim["economie"], abs=0.01)


def test_aucun_evenement_rend_none():
    results, history, config = _contexte(_serie_profonde())
    assert pt.simuler_promo(results, None, {"gpu_x"},
                            history=history, config=config) is None


def test_categorie_non_concernee_rend_none():
    results, history, config = _contexte(_serie_profonde(), categorie="SSD")
    assert pt.simuler_promo(results, EVENEMENT, {"gpu_x"},
                            history=history, config=config) is None
