# -*- coding: utf-8 -*-
"""
Filet de securite de la collecte mutualisee (Axe 5, prompt 8.6).

Le critere de la feuille de route (§8) est chiffre : « cout marginal proche
de zero ». Ces tests le verrouillent, et verrouillent aussi les pieges du
multi-projet :

  * deux projets partageant des composants ne doublent PAS la collecte ;
  * un composant achete dans UN projet mais encore attendu dans un autre
    continue d'etre releve ;
  * deux identifiants pour un meme article (meme EAN) ne sont collectes
    qu'une fois, et le prix est partage ;
  * une ressemblance de titre ne suffit JAMAIS a fusionner deux collectes.
"""
import pytest

import identite_produit as ip
import price_tracker as pt
import sqlite_store


def _comp(cid, slot=None):
    return {"id": cid, "name": cid.upper(), "category": "GPU", "slot": slot,
            "recherche": cid}


CONFIG = {
    "budget": {"target_total": 1000},
    "components": [_comp(f"c{i}") for i in range(1, 7)],
}


@pytest.fixture
def base(tmp_path):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "mutu.db")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


def _n(config):
    representants, partages = pt.produits_a_collecter(config)
    return len(representants), sum(len(v) for v in partages.values())


# --- Le critere : cout marginal proche de zero ---------------------------

def test_un_projet_collecte_tous_ses_composants(base):
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "A"}]}
    assert _n(cfg)[0] == 6


def test_deux_projets_partageant_tout_ne_doublent_rien(base):
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "A"},
        {"id": "b", "nom": "B", "composants": ["c1", "c2", "c3"]}]}
    collectes, _ = _n(cfg)
    assert collectes == 6, "Le 2e projet ne doit rien ajouter"


def test_le_cout_marginal_se_limite_aux_composants_inedits(base):
    seul = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["c1", "c2", "c3"]}]}
    avec = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["c1", "c2", "c3"]},
        {"id": "b", "nom": "B", "composants": ["c2", "c3", "c4"]}]}
    assert _n(seul)[0] == 3
    assert _n(avec)[0] == 4, "Seul c4 est inedit : +1, pas +3"


def test_le_total_est_strictement_inferieur_a_la_somme(base):
    """Formulation litterale du critere de la feuille de route."""
    a = {**CONFIG, "projets": [{"id": "a", "nom": "A",
                                "composants": ["c1", "c2", "c3", "c4"]}]}
    b = {**CONFIG, "projets": [{"id": "b", "nom": "B",
                                "composants": ["c3", "c4", "c5"]}]}
    ensemble = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["c1", "c2", "c3", "c4"]},
        {"id": "b", "nom": "B", "composants": ["c3", "c4", "c5"]}]}
    na, nb, nab = _n(a)[0], _n(b)[0], _n(ensemble)[0]
    assert nab < na + nb, f"{nab} doit etre < {na}+{nb}"
    assert nab == 5


# --- Le piege du multi-projet : les achats -------------------------------

def test_un_composant_achete_partout_nest_plus_collecte(base):
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["c1", "c2"],
         "achats": [{"id": "c1", "prix": 10.0, "date": "2026-07-01", "site": "x"}]}]}
    ids = {c["id"] for c in pt.produits_a_collecter(cfg)[0]}
    assert ids == {"c2"}


def test_un_composant_achete_dans_un_seul_projet_reste_collecte(base):
    """
    Le piege : filtrer sur un seul projet ferait disparaitre un prix encore
    utile a l'autre.
    """
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["c1", "c2"],
         "achats": [{"id": "c1", "prix": 10.0, "date": "2026-07-01", "site": "x"}]},
        {"id": "b", "nom": "B", "composants": ["c1", "c3"]}]}
    ids = {c["id"] for c in pt.produits_a_collecter(cfg)[0]}
    assert "c1" in ids, "c1 est encore attendu par le projet b"
    assert ids == {"c1", "c2", "c3"}


def test_un_projet_inactif_nest_pas_collecte(base):
    cfg = {**CONFIG, "projets": [
        {"id": "a", "nom": "A", "composants": ["c1"]},
        {"id": "vieux", "nom": "Vieux", "composants": ["c5"], "actif": False}]}
    ids = {c["id"] for c in pt.produits_a_collecter(cfg)[0]}
    assert ids == {"c1"}


# --- Fusion par identite canonique ----------------------------------------

def _declarer_meme_ean(base, ids, ean="4015454000014"):
    comp = _comp(ids[0])
    res = ip.resoudre({"gtin": ean, "titre": comp["name"]}, comp,
                      reference_gtin=ean)
    for cid in ids:
        base.enregistrer_annonce(cid, "ldlc", f"https://x/{cid}", comp["name"],
                                 res["gtin"], res["mpn"], res)
    return res


def test_deux_identifiants_pour_un_meme_ean_sont_fusionnes(base):
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "A",
                                  "composants": ["c1", "c2"]}]}
    assert _n(cfg) == (2, 0)
    _declarer_meme_ean(base, ["c1", "c2"])
    collectes, partages = _n(cfg)
    assert collectes == 1, "Un seul article : une seule collecte"
    assert partages == 1, "Le second recoit le prix sans requete"


def test_le_representant_est_deterministe(base):
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "A",
                                  "composants": ["c1", "c2"]}]}
    _declarer_meme_ean(base, ["c1", "c2"])
    a = pt.produits_a_collecter(cfg)
    b = pt.produits_a_collecter(cfg)
    assert [c["id"] for c in a[0]] == [c["id"] for c in b[0]]
    assert a[1] == b[1]


def test_une_ressemblance_de_titre_ne_fusionne_pas(base):
    """
    Fusionner sur une heuristique reviendrait a ne collecter qu'un prix pour
    deux produits differents : exactement le faux positif que l'Axe 2 evite.
    """
    comp = _comp("c1")
    res = ip.resoudre({"gtin": None, "mpn": None, "titre": comp["name"]}, comp)
    for cid in ("c1", "c2"):
        base.enregistrer_annonce(cid, "ldlc", f"https://x/{cid}", comp["name"],
                                 None, None, res)
    cfg = {**CONFIG, "projets": [{"id": "a", "nom": "A",
                                  "composants": ["c1", "c2"]}]}
    assert _n(cfg)[0] == 2, "Niveau titre : pas de fusion"


# --- Retro-compatibilite ---------------------------------------------------

def test_config_mono_projet_collecte_tout(base):
    cfg = {**CONFIG, "projet": {"nom": "Unique", "achats": []}}
    assert _n(cfg)[0] == 6


def test_lordre_de_config_est_preserve(base):
    """La collecte reste lisible dans l'ordre decrit par l'utilisateur."""
    cfg = {**CONFIG, "projet": {"nom": "Unique", "achats": []}}
    ordre = [c["id"] for c in pt.produits_a_collecter(cfg)[0]]
    assert ordre == [c["id"] for c in CONFIG["components"]]


def test_sans_base_la_collecte_reste_complete():
    ancienne = sqlite_store._conn
    sqlite_store._conn = None
    try:
        cfg = {**CONFIG, "projet": {"nom": "U", "achats": []}}
        assert pt.produits_a_collecter(cfg)[0].__len__() == 6
    finally:
        sqlite_store._conn = ancienne
