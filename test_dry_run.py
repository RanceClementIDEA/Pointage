# -*- coding: utf-8 -*-
"""
Filet de securite de la resolution d'identite produit (Axe 2).

Verrouille :
  * la validation GTIN (chiffre de controle GS1) et la normalisation MPN ;
  * les 3 niveaux de correspondance sur les golden files reels ;
  * la REGLE DU VETO : un EAN divergent prime sur un titre ressemblant ;
  * la fusion par identite canonique (ajout des releves etrangers, retrait
    des annonces dementies) ;
  * la RETRO-COMPATIBILITE : sans annonce connue, rien ne change.
"""
import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

import identite_produit as ip
import price_tracker as pt
import sqlite_store

GOLDEN = Path(__file__).resolve().parent / "golden"
_MANIFEST = json.loads((GOLDEN / "identite_manifest.json").read_text(encoding="utf-8"))

COMPOSANT = {
    "id": "gpu_rx9060xt", "name": "AMD RX 9060 XT 16 Go",
    "category": "GPU", "recherche": "Radeon RX 9060 XT 16Go",
}


# --- Normalisation ---------------------------------------------------------

@pytest.mark.parametrize("code, attendu", [
    ("4015454000014", True),      # EAN-13 valide
    ("96385074", True),           # EAN-8 valide
    ("4015454000018", False),     # chiffre de controle faux
    ("40154540000", False),       # longueur invalide
    ("", False),
    ("abcdefghijklm", False),
])
def test_gtin_valide(code, attendu):
    assert ip.gtin_valide(code) is attendu


def test_normaliser_gtin_ecarte_les_codes_invalides():
    assert ip.normaliser_gtin("4015454000018") is None   # checksum faux
    assert ip.normaliser_gtin(None) is None
    assert ip.normaliser_gtin("   ") is None


def test_normaliser_gtin_accepte_separateurs_et_prefixe():
    assert ip.normaliser_gtin(" 4015454000014 ") == "4015454000014"
    assert ip.normaliser_gtin("4-015454-000014") == "4015454000014"
    # GTIN-14 = EAN-13 prefixe d'un zero : meme article
    assert ip.normaliser_gtin("04015454000014") == "4015454000014"


def test_normaliser_mpn_rend_comparables_les_variantes():
    formes = ["RX9060XT-16G-GAMING", "rx9060xt 16g gaming",
              "RX9060XT_16G_GAMING", "  RX9060XT.16G.GAMING  "]
    normalises = {ip.normaliser_mpn(f) for f in formes}
    assert len(normalises) == 1


def test_normaliser_mpn_rejette_les_references_trop_courtes():
    assert ip.normaliser_mpn("A") is None
    assert ip.normaliser_mpn("") is None


# --- Cle canonique ---------------------------------------------------------

def test_cle_canonique_ordre_de_priorite():
    assert ip.cle_canonique(gtin="4015454000014", mpn="X-123",
                            terme="t") == "ean:4015454000014"
    assert ip.cle_canonique(gtin=None, mpn="X-123", terme="t") == "mpn:X123"
    assert ip.cle_canonique(gtin=None, mpn=None,
                            terme="Radeon RX 9060 XT") == "terme:radeon-rx-9060-xt"
    assert ip.cle_canonique() is None


# --- Les 3 niveaux, sur les golden files reels -----------------------------

def _annonces_golden():
    annonces = []
    for e in _MANIFEST["entrees"]:
        soup = BeautifulSoup((GOLDEN / e["fichier"]).read_text(encoding="utf-8"),
                             "html.parser")
        ident = pt.extract_identite_from_jsonld(soup)
        annonces.append({**ident, "site": e["site"], "url": "", "_attendu": e})
    return annonces


@pytest.mark.parametrize("entree", _MANIFEST["entrees"],
                         ids=[e["site"] for e in _MANIFEST["entrees"]])
def test_niveau_de_correspondance_attendu(entree):
    annonces = _annonces_golden()
    ref_gtin, ref_mpn = ip.identite_de_reference(annonces)
    cible = next(a for a in annonces if a["site"] == entree["site"])
    res = ip.resoudre(cible, COMPOSANT, ref_gtin, ref_mpn)
    assert res["correspondance_level"] == entree["niveau_attendu"], (
        f"{entree['site']} : {entree['commentaire']}")
    # Le libelle suit le style des scores de confiance existants.
    assert res["correspondance_label"] == ip.LABELS[entree["niveau_attendu"]]


def test_identite_de_reference_deduite_des_annonces():
    ref_gtin, ref_mpn = ip.identite_de_reference(_annonces_golden())
    assert ref_gtin == _MANIFEST["ean_reference"]
    assert ref_mpn == ip.normaliser_mpn(_MANIFEST["mpn_reference"])


def test_veto_ean_divergent_prime_sur_titre_ressemblant():
    """Le coeur de l'Axe 2 : un identifiant qui contredit bat une ressemblance."""
    annonce = {"gtin": "4712345000121",          # EAN valide, mais different
               "mpn": None,
               "titre": "Sapphire Radeon RX 9060 XT 16 Go"}   # titre parfait
    res = ip.resoudre(annonce, COMPOSANT, reference_gtin="4015454000014")
    assert res["correspondance_level"] == ip.NIVEAU_AUCUN
    assert res["methode"] == "gtin_divergent"
    assert "motif" in res


def test_mpn_divergent_ne_declenche_pas_de_veto():
    """Un MPN different est trop peu concluant pour ecarter : titre reexamine."""
    annonce = {"gtin": None, "mpn": "AUTRE-REF-999",
               "titre": "Sapphire Radeon RX 9060 XT 16 Go"}
    res = ip.resoudre(annonce, COMPOSANT, reference_mpn="RX9060XT-16G-GAMING")
    assert res["correspondance_level"] >= ip.NIVEAU_TITRE


# --- Extraction ------------------------------------------------------------

def test_extract_identite_lit_gtin_et_mpn():
    soup = BeautifulSoup((GOLDEN / "identite_cdiscount.html").read_text(encoding="utf-8"),
                         "html.parser")
    ident = pt.extract_identite_from_jsonld(soup)
    assert ident["gtin"] == _MANIFEST["ean_reference"]
    assert ident["mpn"] == _MANIFEST["mpn_reference"]
    assert "9060" in ident["titre"]
    assert ident["marque"]


def test_extract_price_from_jsonld_retro_compatible():
    """La signature historique doit rester intacte (46 checks golden en dependent)."""
    soup = BeautifulSoup((GOLDEN / "identite_ldlc.html").read_text(encoding="utf-8"),
                         "html.parser")
    prix = pt.extract_price_from_jsonld(soup)
    assert isinstance(prix, float)
    prix2, ident = pt.extract_price_from_jsonld(soup, avec_identite=True)
    assert prix2 == prix
    assert ident["gtin"] == _MANIFEST["ean_reference"]


# --- Fusion par identite canonique ----------------------------------------

@pytest.fixture
def base(tmp_path):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "identite.db")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


NODE = {"name": "AMD RX 9060 XT 16 Go", "category": "GPU", "seed_imported": False,
        "entries": [
            {"date": "2026-07-28", "site": "ldlc", "price": 429.99, "origin": "tracked"},
            {"date": "2026-07-28", "site": "cybertek", "price": 12.90, "origin": "tracked"},
        ]}


def test_fusion_sans_annonce_ne_change_rien(base):
    """RETRO-COMPATIBILITE : sans information d'identite, comportement inchange."""
    obtenu = pt.fusionner_entries(COMPOSANT, NODE)
    assert obtenu == NODE["entries"]


def test_fusion_retire_les_annonces_dementies(base):
    res_ok = ip.resoudre({"gtin": "4015454000014", "titre": "RX 9060 XT 16 Go"},
                         COMPOSANT, reference_gtin="4015454000014")
    res_ko = ip.resoudre({"gtin": "4712345000121", "titre": "Cable PCIe"},
                         COMPOSANT, reference_gtin="4015454000014")
    base.enregistrer_annonce(COMPOSANT["id"], "ldlc", "u1", "RX 9060 XT",
                             res_ok.get("gtin"), None, res_ok)
    base.enregistrer_annonce(COMPOSANT["id"], "cybertek", "u2", "Cable PCIe",
                             res_ko.get("gtin"), None, res_ko)

    obtenu = pt.fusionner_entries(COMPOSANT, NODE)
    sites = {e["site"] for e in obtenu}
    assert "cybertek" not in sites, "L'annonce dementie doit sortir du plancher"
    assert "ldlc" in sites
    assert min(e["price"] for e in obtenu) == pytest.approx(429.99)


def test_fusion_ajoute_les_releves_dun_autre_suivi(base):
    """Meme EAN releve sous un autre composant : il doit entrer dans le calcul."""
    res_ok = ip.resoudre({"gtin": "4015454000014", "titre": "RX 9060 XT 16 Go"},
                         COMPOSANT, reference_gtin="4015454000014")
    base.enregistrer_annonce(COMPOSANT["id"], "ldlc", "u1", "RX 9060 XT",
                             res_ok.get("gtin"), None, res_ok)
    base.enregistrer_annonce("autre_suivi", "proshop", "u3", "RX 9060 XT",
                             res_ok.get("gtin"), None, res_ok)
    base.record_releve("autre_suivi", "proshop", 389.00, "2026-07-27", "tracked")

    obtenu = pt.fusionner_entries(COMPOSANT, NODE)
    # Le releve etranger entre bien dans l'historique du composant.
    assert any(e["site"] == "proshop" and e["price"] == pytest.approx(389.00)
               for e in obtenu)
    # cybertek n'a AUCUNE annonce enregistree ici : aucune information ne
    # permet de le juger, il est donc conserve (retro-compatibilite). Le
    # plancher est evalue sur les vendeurs effectivement identifies.
    identifies = {"ldlc", "proshop"}
    plancher = min(e["price"] for e in obtenu if e["site"] in identifies)
    assert plancher == pytest.approx(389.00)


def test_vendeurs_ecartes_epargne_un_vendeur_a_double_annonce(base):
    """Une seule correspondance valable suffit a conserver le vendeur."""
    ok = ip.resoudre({"gtin": "4015454000014", "titre": "RX 9060 XT"},
                     COMPOSANT, reference_gtin="4015454000014")
    ko = ip.resoudre({"gtin": "4712345000121", "titre": "Cable"},
                     COMPOSANT, reference_gtin="4015454000014")
    base.enregistrer_annonce(COMPOSANT["id"], "ldlc", "url-bonne", "RX", ok.get("gtin"), None, ok)
    base.enregistrer_annonce(COMPOSANT["id"], "ldlc", "url-mauvaise", "Cable", ko.get("gtin"), None, ko)
    assert "ldlc" not in base.vendeurs_ecartes(COMPOSANT["id"])
