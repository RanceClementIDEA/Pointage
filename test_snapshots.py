# -*- coding: utf-8 -*-
"""
Filet de securite du banc de backtesting (backtest.py).

Un backtest faux est pire qu'aucun backtest : il produit un chiffre credible
et invérifiable. Ces tests verrouillent les proprietes qui rendent la mesure
honnete :

  * AUCUN LOOKAHEAD -- a la date simulee, l'analyse ne voit jamais le futur ;
  * horloge gelee pendant le rejeu, restauree apres ;
  * arithmetique des trois strategies (optimum <= regles, optimum <= jour 1) ;
  * reproductibilite (meme entree -> meme chiffre) ;
  * la jauge de validite refuse de conclure sur un echantillon mince.
"""
from datetime import date, datetime

import pytest

import backtest
import price_tracker as pt


# --- Jeu d'essai synthetique : trajectoire de prix connue a l'avance --------
# 4 dates, minimum reel le 2026-03-10 (80.00).
COMPOSANT = {
    "id": "test_widget",
    "name": "Widget de test",
    "category": "GPU",
    "reference": {"typical_price": 100.0, "historical_low": 85.0, "msrp": 120.0},
}
ENTRIES = [
    {"date": "2026-01-10", "site": "ldlc", "price": 100.0, "origin": "seed"},
    {"date": "2026-02-10", "site": "ldlc", "price": 95.0, "origin": "seed"},
    {"date": "2026-03-10", "site": "ldlc", "price": 80.0, "origin": "seed"},
    {"date": "2026-04-10", "site": "ldlc", "price": 90.0, "origin": "seed"},
]
CONFIG = {"thresholds": {}, "market_context": {}, "components": [COMPOSANT]}


def test_aucun_lookahead():
    """L'analyse ne doit jamais recevoir un releve posterieur a la date simulee."""
    vrai = pt.analyze_component
    violations = []

    def espion(node, *a, **k):
        jour = pt.datetime.now().date().isoformat()   # date simulee
        violations.extend(e["date"] for e in node["entries"] if e["date"] > jour)
        return vrai(node, *a, **k)

    pt.analyze_component = espion
    try:
        backtest.rejouer_composant(COMPOSANT, ENTRIES, CONFIG)
    finally:
        pt.analyze_component = vrai

    assert not violations, f"Lookahead detecte : {violations}"


def test_horloge_gelee_puis_restauree():
    reel = pt.datetime
    with backtest.horloge_gelee(date(2026, 3, 10)):
        assert pt.datetime.now().date() == date(2026, 3, 10)
    assert pt.datetime is reel
    assert pt.datetime.now().date() == date.today()


def test_horloge_restauree_meme_en_cas_derreur():
    reel = pt.datetime
    with pytest.raises(ValueError):
        with backtest.horloge_gelee(date(2026, 3, 10)):
            raise ValueError("boom")
    assert pt.datetime is reel


def test_strategies_coherentes():
    r = backtest.rejouer_composant(COMPOSANT, ENTRIES, CONFIG)
    assert r is not None
    # Le jour 1 est bien le premier releve.
    assert r["date_jour1"] == "2026-01-10"
    assert r["cout_jour1"] == pytest.approx(100.0)
    # L'optimum est le minimum reel de la trajectoire.
    assert r["date_optimum"] == "2026-03-10"
    assert r["cout_optimum"] == pytest.approx(80.0)
    # L'optimum ne peut etre battu par aucune strategie.
    assert r["cout_optimum"] <= r["cout_regles"]
    assert r["cout_optimum"] <= r["cout_jour1"]
    # Une decision par date distincte.
    assert len(r["decisions"]) == 4
    # Le gain declare est coherent avec les couts.
    assert r["gain_vs_jour1"] == pytest.approx(r["cout_jour1"] - r["cout_regles"])


def test_conseils_dans_le_vocabulaire_connu():
    r = backtest.rejouer_composant(COMPOSANT, ENTRIES, CONFIG)
    connus = {"ACHETER", "ATTENDRE", "CORRECT", "NEUTRE",
              "OCCASION ULTIME", "A VERIFIER"}
    assert {d["conseil"] for d in r["decisions"]} <= connus


def test_repli_documente_quand_regle_muette():
    """Si la regle ne declenche jamais, l'achat est compte au dernier releve."""
    # Prix constamment tres au-dessus du prix habituel : jamais d'ACHETER.
    entries = [
        {"date": "2026-01-10", "site": "ldlc", "price": 300.0, "origin": "seed"},
        {"date": "2026-02-10", "site": "ldlc", "price": 290.0, "origin": "seed"},
    ]
    r = backtest.rejouer_composant(COMPOSANT, entries, CONFIG)
    if not r["declenche"]:
        assert r["date_regles"] == "2026-02-10"
        assert r["conseil_declencheur"] is None


def test_composant_une_seule_date_non_informatif():
    entries = [{"date": "2026-01-10", "site": "ldlc", "price": 100.0, "origin": "seed"}]
    r = backtest.rejouer_composant(COMPOSANT, entries, CONFIG)
    assert r["informatif"] is False
    # Avec une seule date, aucune strategie ne peut se distinguer.
    assert r["cout_jour1"] == r["cout_regles"] == r["cout_optimum"]


def test_jauge_refuse_de_conclure_sur_echantillon_mince():
    resultats = [{
        "informatif": True, "dates": 2, "declenche": True,
        "decisions": [{"date": "2026-01-10"}, {"date": "2026-02-10"}],
        "cout_regles": 100.0, "cout_jour1": 100.0, "cout_optimum": 100.0,
        "gain_vs_jour1": 0.0,
    }]
    s = backtest.agreger(resultats)
    assert s["concluant"] is False, "Un echantillon de 2 dates ne peut pas conclure"


def test_reproductibilite():
    a = backtest.rejouer_composant(COMPOSANT, ENTRIES, CONFIG)
    b = backtest.rejouer_composant(COMPOSANT, ENTRIES, CONFIG)
    assert a["cout_regles"] == b["cout_regles"]
    assert a["gain_vs_jour1"] == b["gain_vs_jour1"]
    assert [d["conseil"] for d in a["decisions"]] == [d["conseil"] for d in b["decisions"]]


def test_decomposition_gain_declenche_vs_repli():
    """Le gain total doit se decomposer exactement en declenche + repli."""
    resultats = [
        {"informatif": True, "dates": 3, "declenche": True,
         "decisions": [{"date": "2026-01-10"}], "gain_vs_jour1": 5.0,
         "cout_regles": 95.0, "cout_jour1": 100.0, "cout_optimum": 90.0},
        {"informatif": True, "dates": 3, "declenche": False,
         "decisions": [{"date": "2026-01-10"}], "gain_vs_jour1": -2.0,
         "cout_regles": 102.0, "cout_jour1": 100.0, "cout_optimum": 98.0},
    ]
    s = backtest.agreger(resultats)
    assert s["gain_declenches_eur"] == pytest.approx(5.0)
    assert s["gain_repli_eur"] == pytest.approx(-2.0)
    assert s["gain_eur"] == pytest.approx(
        s["gain_declenches_eur"] + s["gain_repli_eur"])
