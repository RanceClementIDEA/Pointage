# -*- coding: utf-8 -*-
"""
Filet de securite des snapshots de diagnostic (Axe 3, prompt 8.4).

Verrouille :
  * un echec d'extraction produit un fichier exploitable, SANS intervention ;
  * la page est allegee -- on garde ce qui sert au diagnostic, pas le reste ;
  * le nom respecte le contrat de `charger_snapshot` (prompt 8.2) ;
  * les snapshots de plus de 30 jours disparaissent d'eux-memes ;
  * la boucle est fermee : un snapshot alimente les propositions de 8.2.
"""
import os
import threading
import time
from pathlib import Path

import pytest

import moteur_recherche as mr
import price_tracker as pt


PAGE_SANS_PRIX_EXPLOITABLE = (
    '<html><head><title>Sapphire RX 9060 XT</title>'
    '<script type="application/ld+json">'
    '{"@context":"https://schema.org","@type":"Product","name":"RX 9060 XT"}'
    '</script></head><body>'
    + '<div class="filler">remplissage</div>' * 300
    + '<div class="product-pricing-v2"><span class="amount-value">429,99 EUR</span></div>'
    + '</body></html>')


@pytest.fixture
def dossier(tmp_path, monkeypatch):
    d = tmp_path / "snapshots"
    monkeypatch.setattr(pt, "SNAPSHOTS_DIR", d)
    return d


def _recuperateur(page):
    class _R:
        status_code, text, headers = 200, page, {}
        encoding = apparent_encoding = "utf-8"

    class _S:
        headers = {}

        def get(self, url, headers=None, timeout=None, allow_redirects=True):
            return _R()

    r = mr.Recuperateur(delai=0, timeout=1)
    verrou = threading.Lock()

    def _session(domaine):
        r.dernier_appel.setdefault(domaine, 0.0)
        return _S(), verrou

    r._session = _session
    return r


# --- Creation automatique --------------------------------------------------

def test_un_echec_dextraction_produit_un_snapshot(dossier):
    prix = pt.fetch_price("https://m.test/gpu", "marchand",
                          component={"id": "gpu_x", "name": "GPU"},
                          recuperateur=_recuperateur(PAGE_SANS_PRIX_EXPLOITABLE))
    assert prix is None
    fichiers = list(dossier.glob("*.html"))
    assert len(fichiers) == 1, "Un echec doit laisser une trace exploitable"


def test_aucun_snapshot_quand_lextraction_reussit(dossier):
    page = ('<html><head><script type="application/ld+json">'
            '{"@context":"https://schema.org","@type":"Product","name":"X",'
            '"offers":{"@type":"Offer","price":"100.00"}}</script></head>'
            '<body></body></html>')
    assert pt.fetch_price("https://m.test/ok", "m",
                          recuperateur=_recuperateur(page)) == 100.0
    assert not dossier.exists() or list(dossier.glob("*.html")) == []


def test_le_nom_respecte_le_contrat_de_82(dossier):
    pt.enregistrer_snapshot(PAGE_SANS_PRIX_EXPLOITABLE, "ldlc", "gpu_x")
    fichier = list(dossier.glob("*.html"))[0]
    # charger_snapshot cherche f"{site}*.html" : le nom doit commencer par le site.
    assert fichier.name.startswith("ldlc")
    assert "gpu_x" in fichier.name
    assert pt.charger_snapshot("ldlc") is not None


def test_les_caracteres_speciaux_sont_assainis(dossier):
    chemin = pt.enregistrer_snapshot(PAGE_SANS_PRIX_EXPLOITABLE,
                                     "site/avec:slash", "comp osant")
    assert chemin is not None
    assert "/" not in chemin.name and ":" not in chemin.name


# --- Allegement ------------------------------------------------------------

def test_la_page_est_allegee():
    allegee = pt.alleger_page(PAGE_SANS_PRIX_EXPLOITABLE)
    assert len(allegee) < len(PAGE_SANS_PRIX_EXPLOITABLE) * 0.3


def test_lallegement_conserve_ce_qui_sert_au_diagnostic():
    allegee = pt.alleger_page(PAGE_SANS_PRIX_EXPLOITABLE)
    assert "JSON-LD" in allegee, "Les donnees structurees doivent etre gardees"
    assert "product-pricing-v2" in allegee, "Le motif de prix doit etre garde"
    assert "429,99" in allegee, "Le montant doit etre garde"
    assert "remplissage" not in allegee, "Le remplissage doit disparaitre"


def test_une_page_sans_motif_garde_un_extrait():
    """Filet : meme sans motif de prix, le snapshot reste informatif."""
    allegee = pt.alleger_page("<html><body><p>Erreur 500 interne</p></body></html>")
    assert "Erreur 500" in allegee


def test_lallegement_est_borne():
    enorme = "<html><body>" + '<div class="price">1,00</div>' * 50_000 + "</body></html>"
    assert len(pt.alleger_page(enorme)) <= pt.SNAPSHOT_TAILLE_MAX


def test_page_vide_ou_illisible():
    assert pt.alleger_page("") == ""
    assert pt.alleger_page(None) == ""
    assert pt.enregistrer_snapshot("", "site") is None


def test_lentete_documente_le_contexte(dossier):
    chemin = pt.enregistrer_snapshot(PAGE_SANS_PRIX_EXPLOITABLE, "ldlc",
                                     "gpu_x", "motif de test")
    contenu = chemin.read_text(encoding="utf-8")
    assert "ldlc" in contenu and "gpu_x" in contenu
    assert "motif de test" in contenu
    assert str(pt.SNAPSHOT_RETENTION_JOURS) in contenu


# --- Nettoyage automatique -------------------------------------------------

def test_les_snapshots_de_plus_de_30_jours_disparaissent(dossier):
    dossier.mkdir(parents=True, exist_ok=True)
    vieux = dossier / "vieux__x__20250101-000000.html"
    vieux.write_text("<html>ancien</html>", encoding="utf-8")
    ancien = time.time() - 31 * 86400
    os.utime(vieux, (ancien, ancien))

    recent = dossier / "recent__x__20260728-000000.html"
    recent.write_text("<html>recent</html>", encoding="utf-8")

    assert pt.nettoyer_snapshots() == 1
    assert not vieux.exists()
    assert recent.exists(), "Un snapshot recent doit survivre"


def test_le_seuil_est_reglable(dossier):
    dossier.mkdir(parents=True, exist_ok=True)
    f = dossier / "x__y__20260101-000000.html"
    f.write_text("<html></html>", encoding="utf-8")
    t = time.time() - 5 * 86400
    os.utime(f, (t, t))
    assert pt.nettoyer_snapshots(jours=30) == 0
    assert pt.nettoyer_snapshots(jours=2) == 1


def test_nettoyage_sans_dossier(dossier):
    assert pt.nettoyer_snapshots() == 0


# --- Boucle fermee avec 8.2 ------------------------------------------------

def test_un_snapshot_alimente_les_propositions_de_selecteur(dossier):
    """
    L'interet du snapshot : permettre a 8.2 de proposer un selecteur, hors
    ligne, sans relancer de requete.
    """
    pt.fetch_price("https://m.test/gpu", "marchand",
                   component={"id": "gpu_x", "name": "GPU"},
                   recuperateur=_recuperateur(PAGE_SANS_PRIX_EXPLOITABLE))
    html = pt.charger_snapshot("marchand")
    assert html is not None

    props = pt.proposer_selecteur(html)
    selecteurs = [p["selecteur"] for p in props]
    assert ".product-pricing-v2" in selecteurs or ".amount-value" in selecteurs
    assert all(p["prix"] == pytest.approx(429.99) for p in props)
