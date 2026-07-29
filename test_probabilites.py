# -*- coding: utf-8 -*-
"""
Filet de securite de la publication optionnelle (Axe 6, prompt 9.2).

Ici, un test qui echoue n'est pas une regression fonctionnelle : c'est une
fuite de donnees. Les tests verrouillent donc les REFUS avant les
fonctionnalites :

  * desactive par defaut -- sans geste explicite, rien ne part ;
  * refus categorique si la cible est le depot courant (l'ecueil v2.6) ;
  * refus si un element sensible est detecte dans le fichier ;
  * le dossier publie ne contient QUE le dashboard, jamais config.json,
    l'historique, la base ou les snapshots.
"""
import json
from pathlib import Path

import pytest

import publier_dashboard as pub


DASHBOARD_SAIN = (
    '<!DOCTYPE html><html><body><h1>Suivi prix PC</h1>'
    '<script type="application/json" id="donnees-suivi">'
    '{"projets":[{"id":"p1","nom":"Tour polyvalente"}],"series":[]}'
    '</script>'
    '<div>sous l\'objectif de 1000 EUR</div>'
    '</body></html>')


@pytest.fixture
def projet(tmp_path, monkeypatch):
    """Un projet isole : config, dashboard, et rien d'autre."""
    monkeypatch.setattr(pub, "BASE_DIR", tmp_path)
    monkeypatch.setattr(pub, "FICHIER", tmp_path / "dashboard.html")
    (tmp_path / "dashboard.html").write_text(DASHBOARD_SAIN, encoding="utf-8")
    # Des fichiers qui ne doivent JAMAIS sortir.
    (tmp_path / "config.json").write_text('{"budget":{}}', encoding="utf-8")
    (tmp_path / "prices.db").write_text("BASE", encoding="utf-8")
    (tmp_path / ".env").write_text("EMAIL_APP_PASSWORD=secret", encoding="utf-8")
    monkeypatch.setattr(pub, "depot_courant", lambda: "")
    return tmp_path


def _config(actif=False, depot=None, anonymiser=False):
    return {"publication_dashboard": actif,
            "publication": {"depot": depot, "branche": "main",
                            "anonymiser": anonymiser}}


# --- Rien par defaut -------------------------------------------------------

def test_desactive_par_defaut(projet):
    autorise, messages = pub.controler(_config())
    assert autorise is False
    assert "desactivee" in " ".join(messages)


def test_une_config_sans_section_publication_est_desactivee(projet):
    autorise, _ = pub.controler({"budget": {}})
    assert autorise is False


def test_active_mais_sans_depot_refuse(projet):
    autorise, messages = pub.controler(_config(actif=True))
    assert autorise is False
    assert "aucun depot" in " ".join(messages)


# --- L'ecueil de la v2.6 ---------------------------------------------------

@pytest.mark.parametrize("courant, cible", [
    ("git@github.com:moi/suivi.git", "git@github.com:moi/suivi.git"),
    ("https://github.com/moi/suivi", "git@github.com:moi/suivi.git"),
    ("git@github.com:moi/suivi.git", "https://github.com/moi/suivi/"),
    ("https://github.com/Moi/Suivi.git", "git@github.com:moi/suivi.git"),
])
def test_refus_si_la_cible_est_le_depot_courant(projet, monkeypatch, courant, cible):
    """Toutes les ecritures d'une meme URL doivent etre reconnues."""
    monkeypatch.setattr(pub, "depot_courant", lambda: courant)
    autorise, messages = pub.controler(_config(actif=True, depot=cible))
    assert autorise is False
    assert "REFUS" in " ".join(messages)
    assert "depot COURANT" in " ".join(messages)


def test_un_depot_different_est_accepte(projet, monkeypatch):
    monkeypatch.setattr(pub, "depot_courant",
                        lambda: "git@github.com:moi/suivi-prive.git")
    autorise, _ = pub.controler(
        _config(actif=True, depot="git@github.com:moi/dashboard-public.git"))
    assert autorise is True


# --- Analyse du contenu ----------------------------------------------------

@pytest.mark.parametrize("fuite, libelle", [
    ("<!-- contact: moi@exemple.fr -->", "adresse email"),
    ("<!-- smtp_server: smtp.gmail.com -->", "SMTP"),
    ("<!-- api_key: abc123 -->", "jeton"),
    ("<!-- ghp_aaaaaaaaaaaaaaaaaaaa -->", "jeton GitHub"),
    ("<!-- https://ntfy.sh/mon-canal-prive -->", "canal ntfy"),
])
def test_refus_si_element_sensible(projet, fuite, libelle):
    (projet / "dashboard.html").write_text(
        DASHBOARD_SAIN.replace("</body>", fuite + "</body>"), encoding="utf-8")
    autorise, messages = pub.controler(
        _config(actif=True, depot="git@github.com:moi/public.git"))
    assert autorise is False, f"{libelle} doit bloquer la publication"
    assert "sensible" in " ".join(messages)


def test_un_dashboard_sain_passe(projet):
    autorise, messages = pub.controler(
        _config(actif=True, depot="git@github.com:moi/public.git"))
    assert autorise is True
    assert messages == []


def test_dashboard_absent_refuse(projet):
    (projet / "dashboard.html").unlink()
    autorise, messages = pub.controler(
        _config(actif=True, depot="git@github.com:moi/public.git"))
    assert autorise is False
    assert "absent" in " ".join(messages)


# --- Ce qui sort, et uniquement cela --------------------------------------

def test_le_dossier_publie_ne_contient_que_le_dashboard(projet, tmp_path):
    dossier = pub.preparer(tmp_path / "site", _config(actif=True))
    noms = sorted(f.name for f in Path(dossier).iterdir())
    assert noms == ["index.html", "robots.txt"]


def test_aucun_fichier_sensible_ne_sort(projet, tmp_path):
    dossier = pub.preparer(tmp_path / "site", _config(actif=True))
    interdits = {"config.json", "prices.db", "history.json", ".env",
                 "snapshots", "vendeurs_sante.json"}
    presents = {f.name for f in Path(dossier).iterdir()}
    assert not (presents & interdits)


def test_le_dossier_est_reconstruit_a_vide(projet, tmp_path):
    cible = tmp_path / "site"
    cible.mkdir()
    (cible / "vieux_secret.txt").write_text("reste d'une publication passee")
    pub.preparer(cible, _config(actif=True))
    assert not (cible / "vieux_secret.txt").exists()


def test_lindexation_est_decouragee(projet, tmp_path):
    dossier = pub.preparer(tmp_path / "site", _config(actif=True))
    robots = (Path(dossier) / "robots.txt").read_text(encoding="utf-8")
    assert "Disallow: /" in robots


# --- Anonymisation (attenuateur, pas garantie) ----------------------------

def test_lanonymisation_retire_le_nom_du_projet(projet, tmp_path):
    dossier = pub.preparer(tmp_path / "site", _config(actif=True, anonymiser=True))
    contenu = (Path(dossier) / "index.html").read_text(encoding="utf-8")
    assert "Tour polyvalente" not in contenu
    assert "Projet 1" in contenu


def test_lanonymisation_retire_les_montants_de_budget(projet, tmp_path):
    dossier = pub.preparer(tmp_path / "site", _config(actif=True, anonymiser=True))
    contenu = (Path(dossier) / "index.html").read_text(encoding="utf-8")
    assert "objectif de 1000 EUR" not in contenu


def test_sans_anonymisation_le_contenu_est_intact(projet, tmp_path):
    dossier = pub.preparer(tmp_path / "site", _config(actif=True))
    contenu = (Path(dossier) / "index.html").read_text(encoding="utf-8")
    assert "Tour polyvalente" in contenu


def test_lanonymisation_laisse_un_json_valide(projet, tmp_path):
    import re
    dossier = pub.preparer(tmp_path / "site", _config(actif=True, anonymiser=True))
    contenu = (Path(dossier) / "index.html").read_text(encoding="utf-8")
    bloc = re.search(r'id="donnees-suivi">(.*?)</script>', contenu, re.S)
    assert bloc
    json.loads(bloc.group(1).replace("<\\/", "</"))


# --- La configuration livree ----------------------------------------------

def test_la_config_livree_a_la_publication_desactivee():
    """Le depot doit etre livre sans publication active."""
    cfg = json.loads((Path(__file__).resolve().parent.parent / "config.json")
                     .read_text(encoding="utf-8"))
    assert cfg.get("publication_dashboard") is False
    assert (cfg.get("publication") or {}).get("depot") in (None, "")
