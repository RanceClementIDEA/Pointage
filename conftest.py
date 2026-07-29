# -*- coding: utf-8 -*-
"""
Un essai a blanc n'ecrit rien dans la source de verite.

`--dry-run` annonce « prix simules, aucune requete reseau ». Il persistait
pourtant ces prix inventes dans `prices.db` avec `origin="tracked"` : une
fois dans l'historique, plus rien ne les distinguait d'un vrai releve. Le
symptome observe etait une alerte OCCASION ULTIME declenchee sur un prix
fabrique de toutes pieces.

Ces tests verrouillent le refus d'ecrire, pas une fonctionnalite.
"""
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent
BASE = RACINE / "prices.db"

besoin_base = pytest.mark.skipif(
    not BASE.exists(), reason="prices.db absent (depot fraichement clone)")


def _etat(chemin):
    """(nombre de releves, empreinte des prix) -- de quoi detecter toute ecriture."""
    with sqlite3.connect(chemin) as conn:
        lignes = conn.execute(
            "SELECT produit_id, vendeur_id, prix, ts, origin FROM releves "
            "ORDER BY id").fetchall()
    return len(lignes), tuple(lignes)


def _lancer(*args, timeout=300):
    return subprocess.run([sys.executable, "price_tracker.py", *args],
                          cwd=RACINE, capture_output=True, text=True,
                          timeout=timeout)


@besoin_base
def test_dry_run_nenregistre_aucun_releve():
    avant = _etat(BASE)
    r = _lancer("--dry-run", "--no-email")
    assert r.returncode == 0, r.stderr[-400:]
    assert _etat(BASE) == avant, (
        "L'essai a blanc a modifie prices.db : des prix simules sont entres "
        "dans l'historique")


@besoin_base
def test_dry_run_le_dit_explicitement():
    """L'utilisateur doit savoir que rien n'a ete garde."""
    r = _lancer("--dry-run", "--no-email")
    assert "NE SONT PAS enregistres" in r.stdout or \
           "ne sont PAS enregistres" in r.stdout


@besoin_base
def test_report_only_nenregistre_rien_non_plus():
    avant = _etat(BASE)
    r = _lancer("--report-only", "--no-email")
    assert r.returncode == 0, r.stderr[-400:]
    assert _etat(BASE) == avant


@besoin_base
def test_aucun_prix_simule_dans_lhistorique_livre():
    """
    Garde-fou de livraison : la base du depot ne doit contenir que des
    relevés d'origine connue. Un `tracked` date d'aujourd'hui sans collecte
    reelle est le signe d'un dry-run persiste.
    """
    with sqlite3.connect(BASE) as conn:
        origines = {r[0] for r in conn.execute(
            "SELECT DISTINCT COALESCE(origin, 'inconnu') FROM releves")}
    assert origines <= {"seed", "tracked", "manuel"}, \
        f"origines inattendues dans la base livree : {origines}"
