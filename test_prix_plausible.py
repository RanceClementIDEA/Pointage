# -*- coding: utf-8 -*-
"""
Configuration commune de la suite (filet de securite price_tracker).

- rend price_tracker.py importable quel que soit le repertoire d'execution ;
- garantit que la suite tourne HORS-LIGNE : toute tentative d'acces reseau
  pendant un test leve une erreur explicite. Les tests ne doivent lire que
  les golden files de tests/golden/.
"""
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent
if str(RACINE) not in sys.path:
    sys.path.insert(0, str(RACINE))

import requests  # noqa: E402  (importe apres ajustement de sys.path)


def pytest_sessionfinish(session, exitstatus):
    """
    Memorise le resultat de la suite dans `.pytest_dernier.json`.

    Le controle d'installation (demarrer.py, option 8) l'affiche : on sait
    ainsi quand le filet de securite a tourne pour la derniere fois et s'il
    etait vert, sans avoir a relancer pytest depuis le menu.
    """
    import json
    from datetime import datetime

    rapport = getattr(session, "testscollected", 0)
    echecs = getattr(session, "testsfailed", 0)
    resultat = {
        "date": datetime.now().isoformat(timespec="seconds"),
        "total": rapport,
        "echecs": echecs,
        "reussis": max(0, rapport - echecs),
        "vert": exitstatus == 0,
    }
    try:
        (RACINE / ".pytest_dernier.json").write_text(
            json.dumps(resultat, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _suite_hors_ligne(monkeypatch):
    """Bloque tout appel reseau : la suite doit etre 100% locale."""
    def _interdit(*args, **kwargs):
        raise RuntimeError(
            "Acces reseau interdit pendant les tests : la suite est hors-ligne "
            "et ne s'appuie que sur les golden files (tests/golden/)."
        )
    for nom in ("get", "post", "head", "put", "delete", "patch", "options", "request"):
        monkeypatch.setattr(requests, nom, _interdit, raising=False)
    monkeypatch.setattr(requests.sessions.Session, "request", _interdit, raising=False)
    yield
