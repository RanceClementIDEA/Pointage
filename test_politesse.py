# -*- coding: utf-8 -*-
"""
Filet de securite : detecter_fausse_promo.

Les 5 scenarios documentes dans ANALYSE_AVANCEE.md (tableau "Tests effectues",
dont 2 negatifs) deviennent des assertions.

Le detecteur compare trois fenetres RELATIVES a aujourd'hui :
    reference : J-60 a J-30   |   gonflage : J-21 a J-3   |   actuel
On construit donc les releves relativement a la date du jour -- deterministe
au moment de l'execution, et sans reseau. Les points sont places au coeur des
fenetres (marge >= 9 jours des bords) pour rester insensibles a un eventuel
changement de date en cours d'execution.
"""
from datetime import date, timedelta

import pytest

import price_tracker as pt


def _releve(jours_avant, prix):
    return {"date": (date.today() - timedelta(days=jours_avant)).isoformat(),
            "price": prix}


# 2 points en fenetre de reference (mediane 400) + 2 en fenetre de gonflage
# (mediane 470) -> hausse de 17.5%, au-dessus du seuil de 5%.
HIST_GONFLE = [_releve(50, 400.0), _releve(40, 400.0),
               _releve(15, 470.0), _releve(7, 470.0)]


def test_scenario_fausse_promo():
    # 400 -> gonfle a 470 -> « promo » a 415 : le prix actuel reste au-dessus du fond.
    res = pt.detecter_fausse_promo(HIST_GONFLE, current=415.0)
    assert res is not None
    assert res["verdict"] == "fausse"
    assert res["med_reference"] == pytest.approx(400.0)
    assert res["med_gonflage"] == pytest.approx(470.0)
    assert res["hausse_pct"] == pytest.approx(17.5)


def test_scenario_baisse_reelle():
    # Meme gonflage, prix final 360 : vraie baisse sous le prix de fond.
    res = pt.detecter_fausse_promo(HIST_GONFLE, current=360.0)
    assert res is not None
    assert res["verdict"] == "reelle"


def test_scenario_retour_neutre():
    # Retour au prix habituel (399) apres gonflage : ni fausse promo, ni affaire.
    res = pt.detecter_fausse_promo(HIST_GONFLE, current=399.0)
    assert res is not None
    assert res["verdict"] == "neutre"


def test_scenario_negatif_prix_stable():
    # Negatif 1 : pas de gonflage (reference ~ gonflage, +0.5% < seuil 5%) -> aucun verdict.
    hist = [_releve(50, 400.0), _releve(40, 400.0),
            _releve(15, 402.0), _releve(7, 402.0)]
    assert pt.detecter_fausse_promo(hist, current=395.0) is None


def test_scenario_negatif_historique_trop_court():
    # Negatif 2 : moins de 2 releves dans la fenetre de reference -> aucun verdict.
    hist = [_releve(45, 400.0),                      # 1 seul point en reference
            _releve(15, 470.0), _releve(7, 470.0)]
    assert pt.detecter_fausse_promo(hist, current=415.0) is None
