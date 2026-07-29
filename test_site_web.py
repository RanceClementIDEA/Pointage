# -*- coding: utf-8 -*-
"""
Filet de securite des probabilites empiriques (Axe 4, vague 7).

Ce module est celui ou la discipline compte le plus : il serait facile d'y
produire des chiffres credibles et faux. Les tests verrouillent donc les
garde-fous AVANT la justesse du calcul :

  * REFUS en dessous de 5 episodes independants -- jamais de pourcentage ;
  * REFUS si l'horizon depasse l'etendue observee -- aucune extrapolation ;
  * `n` present dans TOUTE sortie, estimable ou non ;
  * episodes chevauchants comptes comme un seul echantillon effectif ;
  * droit-censure exclu du denominateur, et signale ;
  * et, une fois ces regles tenues, l'estimateur de Kaplan-Meier egale le
    comptage manuel sur des series construites a la main.
"""
from datetime import date, timedelta

import pytest

import probabilites as pb


def _serie(prix_par_pas, pas=5, depart=date(2024, 1, 1)):
    """Construit des releves espaces de `pas` jours."""
    return [{"date": (depart + timedelta(days=i * pas)).isoformat(),
             "price": float(p)}
            for i, p in enumerate(prix_par_pas)]


# --- Garde-fou 1 : refus sous le seuil d'echantillon ----------------------

def test_refuse_sous_le_seuil_dechantillon():
    """Le critere de reussite : pas de chiffre quand l'echantillon est mince."""
    releves = _serie([500, 490, 480, 470], pas=5)      # 4 releves, 15 j
    r = pb.probabilite_baisse(releves, 400.0, 10)
    assert r["estimable"] is False
    assert r["probabilite"] is None
    assert "insuffisant" in r["message"]


def test_toute_sortie_porte_la_taille_dechantillon():
    """Jamais un chiffre nu : `n` est present, estimable ou non."""
    for releves, seuil, horizon in [
        (_serie([500, 490]), 400.0, 5),
        (_serie([500] * 40, pas=5), 400.0, 30),
    ]:
        r = pb.probabilite_baisse(releves, seuil, horizon)
        assert "n" in r
        assert "n=" in r["message"] or "insuffisant" in r["message"]


def test_serie_vide_ou_trop_courte():
    assert pb.probabilite_baisse([], 100.0, 30)["estimable"] is False
    r = pb.probabilite_baisse(_serie([500]), 400.0, 30)
    assert r["estimable"] is False
    assert r["n"] == 0


# --- Garde-fou 2 : aucune extrapolation -----------------------------------

def test_refuse_un_horizon_superieur_a_letendue_observee():
    releves = _serie([500 - i for i in range(20)], pas=1)   # 19 jours observes
    r = pb.probabilite_baisse(releves, 490.0, 60)
    assert r["estimable"] is False
    assert "etendue" in r["motif"]
    assert "60" in r["message"] and "19" in r["message"]


def test_la_courbe_ne_depasse_pas_les_durees_observees():
    releves = _serie([500, 450, 400, 380, 500, 450, 400, 380] * 6, pas=5)
    r = pb.probabilite_baisse(releves, 390.0, 60)
    if r["estimable"] and r["courbe"]:
        assert max(t for t, _, _ in r["courbe"]) <= 60


# --- Garde-fou 3 : independance des episodes ------------------------------

def test_les_episodes_chevauchants_ne_gonflent_pas_lechantillon():
    """50 fenetres glissantes sur une meme serie ne font pas 50 observations."""
    releves = _serie([500 - (i % 20) * 10 for i in range(80)], pas=5)
    serie = pb.serie_journaliere(releves)
    eps = pb.episodes_baisse(serie, 380.0, 60)
    disjoints = pb.episodes_disjoints(eps)
    assert len(disjoints) < len(eps), "Les chevauchements doivent etre elimines"
    # Les episodes retenus ne se recouvrent effectivement pas.
    for a, b in zip(disjoints, disjoints[1:]):
        assert a["fin"] <= b["debut"]


def test_n_est_le_compte_independant_pas_le_compte_brut():
    releves = _serie([500, 470, 440, 410, 380, 410, 440, 470] * 8, pas=5)
    r = pb.probabilite_baisse(releves, 390.0, 40)
    if r["estimable"]:
        assert r["n"] <= r["n_brut"]
        assert "n=" + str(r["n"]) in r["message"]


# --- Garde-fou 4 : droit-censure ------------------------------------------

def test_une_fenetre_tronquee_nest_pas_un_echec():
    """
    Une fenetre coupee par la fin des donnees, sans baisse observee, ne prouve
    rien : elle est censuree, pas comptee comme un echec.
    """
    serie = pb.serie_journaliere(_serie([500, 500, 500, 500], pas=10))
    eps = pb.episodes_baisse(serie, 400.0, 60)
    # Les derniers departs n'ont pas 60 jours devant eux.
    assert any(e["censure"] for e in eps)
    assert all(not e["evenement"] for e in eps if e["censure"])


def test_les_censures_sont_signalees_dans_la_sortie():
    releves = _serie([500, 450, 380] * 20, pas=5)
    r = pb.probabilite_baisse(releves, 390.0, 30)
    assert "censures" in r
    if r["estimable"] and r["censures"]:
        assert "tronquee" in r["message"]


# --- Justesse du calcul, une fois les garde-fous tenus --------------------

def test_kaplan_meier_egale_le_comptage_manuel():
    """Sur des episodes independants, l'estimateur doit rendre la proportion."""
    # Dents de scie regulieres : chaque cycle descend a 340 puis remonte.
    prix = []
    for i in range(140):
        c = i % 16
        prix.append(500 - c * 20 if c <= 8 else 340 + (c - 8) * 20)
    releves = _serie(prix, pas=5)

    r = pb.probabilite_baisse(releves, 380.0, 60)
    assert r["estimable"] is True

    serie = pb.serie_journaliere(releves)
    eps = pb.episodes_baisse(serie, 380.0, 60)
    exploitables = [e for e in eps if e["evenement"] or not e["censure"]]
    disjoints = pb.episodes_disjoints(exploitables)
    manuel = sum(1 for e in disjoints if e["evenement"]) / len(disjoints) * 100

    assert r["probabilite"] == pytest.approx(manuel, abs=0.6)
    assert r["n"] == len(disjoints)


def test_un_seuil_jamais_atteint_donne_zero_pas_une_erreur():
    prix = [500 - (i % 10) * 5 for i in range(120)]     # jamais sous 455
    r = pb.probabilite_baisse(_serie(prix, pas=5), 300.0, 60)
    if r["estimable"]:
        assert r["probabilite"] == pytest.approx(0.0)


def test_un_horizon_plus_long_ne_diminue_jamais_la_probabilite():
    """Monotonie : plus on attend, plus la baisse a eu de chances d'arriver."""
    prix = []
    for i in range(160):
        c = i % 22
        prix.append(500 - c * 12 if c <= 11 else 368 + (c - 11) * 12)
    releves = _serie(prix, pas=5)

    court = pb.probabilite_baisse(releves, 400.0, 40)
    long_ = pb.probabilite_baisse(releves, 400.0, 90)
    if court["estimable"] and long_["estimable"]:
        assert long_["probabilite"] >= court["probabilite"] - 1e-9


# --- Utilitaires -----------------------------------------------------------

def test_serie_journaliere_retient_le_moins_cher_du_jour():
    releves = [
        {"date": "2026-01-01", "site": "a", "price": 120.0},
        {"date": "2026-01-01", "site": "b", "price": 99.0},
        {"date": "2026-01-02", "site": "a", "price": 110.0},
    ]
    assert pb.serie_journaliere(releves) == [("2026-01-01", 99.0),
                                             ("2026-01-02", 110.0)]


def test_detecter_pics_trouve_les_maxima_locaux():
    serie = pb.serie_journaliere(_serie([300, 500, 300, 280, 520, 300], pas=30))
    pics = dict(pb.detecter_pics(serie, fenetre=40))
    assert 500.0 in pics.values() or 520.0 in pics.values()


def test_seuils_candidats_ne_sort_pas_des_donnees():
    releves = _serie([500, 450, 400, 380], pas=5)
    seuils = pb.seuils_candidats(releves, {"prix_reve": 350, "historical_low": 370})
    valeurs = [v for _, v in seuils]
    assert valeurs, "Des seuils doivent etre proposes"
    assert max(valeurs) <= 500.0, "Aucun seuil au-dessus du maximum observe"


def test_formater_ne_rend_jamais_un_chiffre_nu():
    r = pb.probabilite_baisse(_serie([500, 490]), 400.0, 5)
    texte = pb.formater(r)
    assert "insuffisant" in texte
    prix = [500 - (i % 16) * 20 if (i % 16) <= 8 else 340 + ((i % 16) - 8) * 20
            for i in range(140)]
    r2 = pb.probabilite_baisse(_serie(prix, pas=5), 380.0, 60)
    if r2["estimable"]:
        assert "n=" in pb.formater(r2)


def test_le_docstring_dit_que_ce_nest_pas_une_prevision():
    """La distinction descriptif / predictif doit etre ecrite, pas sous-entendue."""
    doc = (pb.probabilite_baisse.__doc__ or "").lower()
    assert "pas une prevision" in doc or "n'est pas une prevision" in doc
    assert "prevision" in (pb.__doc__ or "").lower()
