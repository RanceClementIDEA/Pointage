# -*- coding: utf-8 -*-
"""
Filet de securite du site statique et de sa chaine de publication.

Ce qui est verrouille ici, par ordre d'importance :

  1. le site ne depend pas de Firebase -- sans configuration, il lit
     data.json et fonctionne. Un service tiers en panne, dont les
     conditions changent ou dont le quota gratuit s'epuise ne doit pas
     emporter le site avec lui ;
  2. le navigateur ne peut pas ecrire dans la base. Les regles Firestore
     sont la seule chose qui empeche un tiers de remplacer vos prix -- et
     donc de declencher chez vous une fausse alerte « grosse offre » ;
  3. le mail reste le canal des alertes : le site l'affiche, il ne le
     remplace pas.
"""
import json
import re
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent
WEB = RACINE / "web"
REGLES = RACINE / "firestore.rules"


def _lire(nom):
    return (WEB / nom).read_text(encoding="utf-8")


# --- Le site existe et se tient tout seul ---------------------------------

@pytest.mark.parametrize("fichier", ["index.html", "app.js", "style.css", "config.js"])
def test_les_fichiers_du_site_existent(fichier):
    assert (WEB / fichier).exists(), f"{fichier} manquant"


def test_firebase_est_desactive_dans_la_configuration_livree():
    """
    Le depot doit se cloner et se deployer sans compte Firebase.
    Activer un service tiers est un geste explicite.
    """
    source = _lire("config.js")
    assert re.search(r"firebase\s*:\s*null", source), (
        "config.js doit etre livre avec firebase: null")


def test_le_site_fonctionne_sans_firebase():
    """Le mode fichier doit exister et etre le chemin par defaut."""
    source = _lire("app.js")
    assert "demarrerFichier" in source
    assert "data.json" in source
    assert re.search(r"if\s*\(C\.firebase[^)]*\)\s*demarrerDirect\(\);?\s*else\s*demarrerFichier",
                     source), "le mode fichier doit etre le repli par defaut"


def test_une_panne_de_firebase_retombe_sur_le_fichier():
    """
    Trois chemins d'echec doivent tous mener a demarrerFichier : import du
    SDK impossible, document absent, erreur d'abonnement.
    """
    source = _lire("app.js")
    bloc = source[source.index("function demarrerDirect"):
                  source.index("function echec")]
    assert bloc.count("demarrerFichier()") >= 3, (
        "chaque mode d'echec de Firebase doit retomber sur le fichier")


def test_aucune_ressource_distante_hors_firebase():
    """
    Le seul appel externe tolere est le SDK Firebase, et uniquement si
    l'utilisateur l'a configure.
    """
    html = _lire("index.html")
    for motif in (r'src\s*=\s*["\']https?://', r'href\s*=\s*["\']https?://',
                  r"@import", r"googleapis|unpkg|jsdelivr|cdnjs"):
        assert not re.search(motif, html, re.I), f"dependance dans index.html : {motif}"
    distants = re.findall(r'https?://[^\s"\')]+', _lire("app.js"))
    assert all("gstatic.com/firebasejs" in u for u in distants), distants


def test_le_site_ninterroge_aucun_marchand():
    """
    Un navigateur ne peut pas scraper (CORS), et le tenter contredirait la
    collecte polie. Le site lit une photographie deja calculee.
    """
    source = _lire("app.js")
    appels = re.findall(r'fetch\(\s*["\']([^"\']+)', source)
    assert appels == ["data.json?"] or all(
        a.startswith("data.json") for a in appels), appels


# --- Les regles Firestore -------------------------------------------------

def test_les_regles_existent():
    assert REGLES.exists(), (
        "sans regles deployees, une base creee en mode test est ouverte en "
        "ecriture a tout internet pendant 30 jours")


def test_le_navigateur_ne_peut_pas_ecrire():
    regles = REGLES.read_text(encoding="utf-8")
    assert re.search(r"match /suivi/\{document\}", regles)
    bloc = regles[regles.index("match /suivi/"):]
    bloc = bloc[:bloc.index("}", bloc.index("allow"))+400]
    assert re.search(r"allow read:\s*if true", bloc)
    assert re.search(r"allow write:\s*if false", bloc), (
        "l'ecriture depuis le navigateur permettrait a un tiers de fabriquer "
        "une fausse alerte « grosse offre »")


def test_la_regle_par_defaut_est_fermee():
    regles = REGLES.read_text(encoding="utf-8")
    assert re.search(r"match /\{document=\*\*\}[\s\S]{0,120}allow read, write:\s*if false",
                     regles), "une regle par defaut permissive est la premiere cause de fuite"


# --- L'export ------------------------------------------------------------

def test_lexport_reutilise_letat_du_serveur():
    """
    Deux implementations des memes chiffres finiraient par diverger. Le
    site et l'interface locale doivent lire la meme fonction.
    """
    source = (RACINE / "exporter_web.py").read_text(encoding="utf-8")
    assert "serveur.construire_etat" in source


def test_lexport_produit_un_json_exploitable(tmp_path):
    import exporter_web
    if not (RACINE / "prices.db").exists():
        pytest.skip("prices.db absent")
    chemin, donnees = exporter_web.ecrire(tmp_path / "data.json")
    relu = json.loads(Path(chemin).read_text(encoding="utf-8"))
    assert relu["projets"], "aucun projet exporte"
    comp = relu["projets"][0]["composants"][0]
    assert {"id", "nom", "prix", "conseil", "serie", "stats"} <= set(comp)
    assert "profondeur_jours" in relu


def test_lexport_nemporte_aucun_secret(tmp_path):
    """Le fichier part sur un site PUBLIC : rien de sensible ne doit y etre."""
    import exporter_web
    if not (RACINE / "prices.db").exists():
        pytest.skip("prices.db absent")
    _, donnees = exporter_web.ecrire(tmp_path / "data.json")
    brut = json.dumps(donnees, ensure_ascii=False, default=str).lower()
    for motif in ("smtp", "password", "app_password", "ntfy.sh",
                  "ghp_", "private_key", "@gmail.com"):
        assert motif not in brut, f"element sensible exporte : {motif}"


# --- La synchronisation est facultative, et ne bloque rien ----------------

def test_la_synchronisation_sarrete_proprement_sans_secret(monkeypatch, capsys):
    import firebase_sync
    monkeypatch.delenv(firebase_sync.VAR_COMPTE, raising=False)
    assert firebase_sync.main([]) == 0, (
        "l'absence de Firebase n'est pas une erreur : le site marche sans")
    assert "data.json" in capsys.readouterr().out


def test_le_compte_de_service_nest_jamais_dans_le_depot():
    for chemin in RACINE.rglob("*.json"):
        if "__pycache__" in str(chemin) or "node_modules" in str(chemin):
            continue
        texte = chemin.read_text(encoding="utf-8", errors="ignore")
        assert "-----BEGIN PRIVATE KEY-----" not in texte, chemin
        assert '"type": "service_account"' not in texte, chemin


# --- Le mail reste le canal des alertes -----------------------------------

def test_le_site_ne_remplace_pas_le_mail():
    """
    Le site AFFICHE la grosse offre ; c'est le mail qui la SIGNALE. Une page
    qu'il faut penser a ouvrir n'a jamais prevenu personne.
    """
    assert "GROSSE OFFRE" in _lire("app.js").upper()
    assert "mail vous a ete envoye" in _lire("app.js")


def test_le_workflow_de_site_ne_collecte_pas():
    """
    Publier et collecter sont deux gestes distincts : un deploiement ne doit
    jamais declencher de requetes chez les marchands.
    """
    wf = (RACINE / ".github" / "workflows" / "site.yml").read_text(encoding="utf-8")
    assert "price_tracker.py" not in wf, (
        "le workflow de publication ne doit pas lancer de collecte")
    assert "exporter_web.py" in wf


def test_le_workflow_de_collecte_envoie_toujours_le_mail():
    wf = (RACINE / ".github" / "workflows" / "price-tracker.yml").read_text(encoding="utf-8")
    assert "EMAIL_APP_PASSWORD" in wf
    assert "--no-email" not in wf, (
        "la collecte quotidienne doit continuer d'envoyer le rapport")
