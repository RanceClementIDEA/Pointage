# -*- coding: utf-8 -*-
"""
Filet de securite du rapport multi-projets et de la vue portefeuille
(Axe 5, prompt 8.7).

Verrouille :
  * `analyser_projet` rend une analyse complete par projet, sans effet de
    bord (ni impression, ni envoi) ;
  * chaque projet garde SA structure de rapport ;
  * la vue portefeuille RESUME au lieu de repeter : pas de detail composant,
    et une occasion partagee par deux projets n'est comptee qu'une fois ;
  * elle agrege bien le total combine, les occasions ultimes, les
    incompatibilites bloquantes et les fenetres d'achat a venir.
"""
from datetime import date, timedelta

import pytest

import price_tracker as pt


def _jour(n):
    return (date.today() - timedelta(days=n)).isoformat()


def _comp(cid, cat="GPU", slot=None, perf=100):
    return {"id": cid, "name": cid.upper(), "category": cat, "slot": slot,
            "perf_index": perf, "recherche": cid,
            "reference": {"typical_price": 200.0, "historical_low": 150.0,
                          "msrp": 250.0},
            "sources": [{"site": "ldlc", "url": f"https://ldlc.test/{cid}"}]}


CONFIG = {
    "budget": {"target_total": 1000, "max_total": 1100},
    "thresholds": {}, "market_context": {}, "slots": {},
    "components": [_comp("gpu1"), _comp("cpu1", "CPU"), _comp("ssd1", "SSD")],
}


def _history(prix_par_comp):
    h = {}
    for cid, prix in prix_par_comp.items():
        h[cid] = {"name": cid.upper(), "category": "GPU", "seed_imported": False,
                  "entries": [
                      {"date": _jour(20), "site": "ldlc", "price": 200.0,
                       "origin": "tracked"},
                      {"date": _jour(0), "site": "ldlc", "price": prix,
                       "origin": "tracked"}]}
    return h


HISTORY = _history({"gpu1": 180.0, "cpu1": 190.0, "ssd1": 100.0})


def _analyses(config, history=None):
    history = history or HISTORY
    projets = [p for p in pt.projets_du_config(config) if p.get("actif", True)]
    out = []
    for p in projets:
        a = pt.analyser_projet(config, p, history, None, None, None)
        if a:
            out.append(a)
    return out


# --- analyser_projet -------------------------------------------------------

def test_analyser_projet_rend_une_analyse_complete():
    projet = pt.projets_du_config(CONFIG)[0]
    a = pt.analyser_projet(CONFIG, projet, HISTORY, None, None, None)
    assert a is not None
    for cle in ("projet", "achats", "budget", "results", "comparaisons",
                "pression", "plan", "compat"):
        assert cle in a
    assert len(a["results"]) == 3


def test_chaque_projet_est_analyse_sur_son_perimetre():
    cfg = {**CONFIG, "projets": [
        {"id": "tour", "nom": "Tour"},
        {"id": "nas", "nom": "NAS", "composants": ["ssd1"]}]}
    analyses = {a["projet"]["id"]: a for a in _analyses(cfg)}
    assert len(analyses["tour"]["results"]) == 3
    assert len(analyses["nas"]["results"]) == 1


def test_chaque_projet_a_son_budget_et_son_echeance():
    cible = (date.today() + timedelta(days=30)).isoformat()
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "budget": {"target_total": 500},
         "date_cible": cible},
        {"id": "b", "nom": "B", "budget": {"target_total": 300}}]}
    analyses = {a["projet"]["id"]: a for a in _analyses(cfg)}
    assert analyses["a"]["budget"]["target_total"] == 500
    assert analyses["a"]["pression"]["jours"] == 30
    assert analyses["b"]["pression"] is None


def test_un_projet_sans_donnee_rend_none():
    projet = pt.projets_du_config(CONFIG)[0]
    assert pt.analyser_projet(CONFIG, projet, {}, None, None, None) is None


def test_analyser_projet_nimprime_rien(capsys):
    projet = pt.projets_du_config(CONFIG)[0]
    pt.analyser_projet(CONFIG, projet, HISTORY, None, None, None)
    assert capsys.readouterr().out == ""


# --- Vue portefeuille ------------------------------------------------------

def test_le_total_combine_est_la_somme_des_projets():
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["gpu1"],
         "budget": {"target_total": 300}},
        {"id": "b", "nom": "B", "composants": ["ssd1"],
         "budget": {"target_total": 200}}]}
    analyses = _analyses(cfg)
    html, texte = pt.build_portefeuille(analyses, cfg)
    attendu = sum(a["plan"]["total"] for a in analyses)
    assert f"{attendu:.2f} EUR" in texte
    assert "500" in texte, "L'objectif cumule doit apparaitre"


def test_la_vue_ne_repete_pas_le_detail_composant():
    """Le point 3 : resumer, pas dupliquer."""
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "A"}]}
    _, texte = pt.build_portefeuille(_analyses(cfg), cfg)
    assert "Le detail composant par composant" in texte
    # Les composants ordinaires ne sont pas enumeres.
    assert "CPU1" not in texte


def test_une_occasion_partagee_nest_comptee_quune_fois():
    """Un composant suivi par deux projets est UNE occasion, pas deux."""
    history = _history({"gpu1": 100.0, "cpu1": 190.0, "ssd1": 100.0})
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "Tour", "composants": ["gpu1"]},
        {"id": "b", "nom": "NAS", "composants": ["gpu1"]}]}
    analyses = _analyses(cfg, history)
    ultimes = [r for a in analyses for r in a["plan"].get("ultimes", [])]
    if not ultimes:
        pytest.skip("Aucune occasion ultime dans ce jeu de donnees")
    _, texte = pt.build_portefeuille(analyses, cfg)
    assert texte.count("GPU1 :") == 1, "Une seule ligne pour un article partage"
    assert "Tour, NAS" in texte, "Les deux projets concernes sont nommes"


def test_les_incompatibilites_sont_etiquetees_par_projet():
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "Tour"}]}
    analyses = _analyses(cfg)
    analyses[0]["compat"] = [{"niveau": "bloquant", "message": "socket incompatible"}]
    _, texte = pt.build_portefeuille(analyses, cfg)
    assert "INCOMPATIBILITES BLOQUANTES" in texte
    assert "[Tour]" in texte and "socket incompatible" in texte


def test_les_vigilances_ne_remontent_pas_au_portefeuille():
    """Seul le bloquant merite la vue d'ensemble ; le reste est dans le detail."""
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "Tour"}]}
    analyses = _analyses(cfg)
    analyses[0]["compat"] = [{"niveau": "vigilance", "message": "marge juste"}]
    _, texte = pt.build_portefeuille(analyses, cfg)
    assert "marge juste" not in texte


def test_les_fenetres_dachat_viennent_du_modele_evenementiel():
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "Tour"},
        {"id": "b", "nom": "NAS", "composants": ["ssd1"]}]}
    evenements = [{"nom": "RTX 60xx", "nature": "refresh", "impact": ["GPU"],
                   "jours": 45}]
    _, texte = pt.build_portefeuille(_analyses(cfg), cfg, evenements)
    assert "FENETRES D'ACHAT" in texte
    assert "RTX 60xx" in texte
    assert "Tour" in texte
    # Le NAS n'a aucun GPU : il ne doit pas etre concerne.
    ligne = next(l for l in texte.splitlines() if "RTX 60xx" in l)
    assert "NAS" not in ligne


def test_un_evenement_informatif_nest_pas_une_fenetre():
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "Tour"}]}
    evenements = [{"nom": "CES", "impact": ["GPU"], "jours": 45}]   # sans nature
    _, texte = pt.build_portefeuille(_analyses(cfg), cfg, evenements)
    assert "CES" not in texte


def test_un_refresh_trop_lointain_est_ecarte():
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "Tour"}]}
    evenements = [{"nom": "Loin", "nature": "refresh", "impact": ["GPU"],
                   "jours": 400}]
    _, texte = pt.build_portefeuille(_analyses(cfg), cfg, evenements)
    assert "Loin" not in texte


def test_html_et_texte_sont_produits():
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "A"}]}
    html, texte = pt.build_portefeuille(_analyses(cfg), cfg)
    assert html and texte
    assert "<html" in html and "Vue portefeuille" in html


def test_sans_analyse_rien_nest_produit():
    assert pt.build_portefeuille([], CONFIG) == (None, None)


def test_chaque_projet_figure_dans_le_tableau():
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "Alpha", "composants": ["gpu1"]},
        {"id": "b", "nom": "Beta", "composants": ["ssd1"]}]}
    html, texte = pt.build_portefeuille(_analyses(cfg), cfg)
    for nom in ("Alpha", "Beta"):
        assert nom in texte and nom in html
