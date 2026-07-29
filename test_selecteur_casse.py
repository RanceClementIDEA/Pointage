# -*- coding: utf-8 -*-
"""
Filet de securite de l'observabilite historisee et du mode degrade (Axe 7).

Verrouille :
  * les mesures de fiabilite sont DATEES et CONSERVEES, pas seulement
    calculees a la volee ;
  * une relance le meme jour corrige la mesure au lieu de la dupliquer ;
  * la question « ce site s'est-il degrade ? » se repond par une requete ;
  * le MODE DEGRADE : base verrouillee / corrompue / absente ne fait pas
    planter, et produit un avertissement explicite -- jamais un silence.
"""
import sqlite3
from datetime import date, timedelta

import pytest

import price_tracker as pt
import sqlite_store


@pytest.fixture
def base(tmp_path):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "obs.db")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


def _jour(n):
    return (date.today() - timedelta(days=n)).isoformat()


# --- Ecriture et conservation des mesures ---------------------------------

def test_les_mesures_sont_conservees(base):
    base.enregistrer_mesures_fiabilite(
        [{"site": "ldlc", "taux": 95.0, "jours_ok": 19, "jours_total": 20,
          "produits": 4, "prix_plausibles": 12, "latence_ms": 180.0,
          "statut": "ok", "motif": None}], jour=_jour(1))
    serie = base.historique_fiabilite("ldlc")
    assert len(serie) == 1
    assert serie[0]["taux"] == pytest.approx(95.0)
    assert serie[0]["latence_ms"] == pytest.approx(180.0)
    assert serie[0]["prix_plausibles"] == 12


def test_relancer_le_meme_jour_corrige_au_lieu_de_dupliquer(base):
    for taux in (50.0, 80.0):
        base.enregistrer_mesures_fiabilite(
            [{"site": "ldlc", "taux": taux, "jours_ok": 1, "jours_total": 1,
              "produits": 1, "prix_plausibles": 1, "latence_ms": None,
              "statut": "ok", "motif": None}], jour=_jour(0))
    serie = base.historique_fiabilite("ldlc")
    assert len(serie) == 1, "Une seule mesure par site et par jour"
    assert serie[0]["taux"] == pytest.approx(80.0), "La derniere valeur gagne"


def test_fenetres_differentes_coexistent(base):
    """fiabilite_sites (30 j) et source_health (7 j) ne s'ecrasent pas."""
    for fenetre in (7, 30):
        base.enregistrer_mesures_fiabilite(
            [{"site": "ldlc", "taux": 60.0 + fenetre, "jours_ok": 1,
              "jours_total": 1, "produits": 1, "prix_plausibles": 1,
              "latence_ms": None, "statut": "ok", "motif": None}],
            fenetre_jours=fenetre, jour=_jour(0))
    assert len(base.historique_fiabilite("ldlc")) == 2


# --- Le critere de reussite : une reponse, pas une supposition -------------

def test_une_degradation_est_detectee_par_requete(base):
    """« La fiabilite de LDLC s'est-elle degradee ces deux derniers mois ? »"""
    for j in range(60, 0, -3):
        taux = 98.0 if j > 30 else 61.0          # chute nette il y a un mois
        base.enregistrer_mesures_fiabilite(
            [{"site": "ldlc", "taux": taux, "jours_ok": 1, "jours_total": 1,
              "produits": 1, "prix_plausibles": 3, "latence_ms": 200.0,
              "statut": "ok", "motif": None}], jour=_jour(j))

    evo = base.evolution_fiabilite("ldlc")
    assert len(evo) == 1
    r = evo[0]
    assert r["taux_30_60j"] == pytest.approx(98.0)
    assert r["taux_30j"] == pytest.approx(61.0)
    assert r["tendance"] < -30, "La degradation doit ressortir comme negative"


def test_un_site_stable_ne_signale_pas_de_degradation(base):
    for j in range(60, 0, -3):
        base.enregistrer_mesures_fiabilite(
            [{"site": "cdiscount", "taux": 92.0, "jours_ok": 1, "jours_total": 1,
              "produits": 1, "prix_plausibles": 3, "latence_ms": None,
              "statut": "ok", "motif": None}], jour=_jour(j))
    r = base.evolution_fiabilite("cdiscount")[0]
    assert abs(r["tendance"]) < 5


def test_sans_recul_aucune_tendance_inventee(base):
    """Une seule mesure ne permet aucune comparaison : tendance = None."""
    base.enregistrer_mesures_fiabilite(
        [{"site": "nouveau", "taux": 100.0, "jours_ok": 1, "jours_total": 1,
          "produits": 1, "prix_plausibles": 1, "latence_ms": None,
          "statut": "ok", "motif": None}], jour=_jour(0))
    r = base.evolution_fiabilite("nouveau")[0]
    assert r["taux_30_60j"] is None
    assert r["tendance"] is None


# --- Instrumentation des fonctions existantes -----------------------------

CONFIG = {
    "components": [{"id": "c1", "name": "C1", "category": "GPU",
                    "sources": [{"site": "ldlc", "url": "https://ldlc.test/c1"}]}],
}
HISTORY = {"c1": {"name": "C1", "category": "GPU", "seed_imported": False,
                  "entries": [{"date": date.today().isoformat(), "site": "ldlc",
                               "price": 100.0, "origin": "tracked"}]}}


def test_fiabilite_sites_ecrit_quand_on_le_demande(base):
    stats = pt.fiabilite_sites(CONFIG, HISTORY, enregistrer=True,
                               latences={"ldlc": 250.0},
                               prix_plausibles={"ldlc": 7})
    assert stats, "La fonction doit toujours rendre ses statistiques"
    serie = base.historique_fiabilite("ldlc")
    assert serie and serie[0]["latence_ms"] == pytest.approx(250.0)
    assert serie[0]["prix_plausibles"] == 7


def test_fiabilite_sites_n_ecrit_pas_par_defaut(base):
    pt.fiabilite_sites(CONFIG, HISTORY)
    assert base.historique_fiabilite("ldlc") == []


def test_source_health_ecrit_les_pannes(base):
    vide = {"c1": {"name": "C1", "category": "GPU", "entries": []}}
    problemes = pt.source_health(CONFIG, vide, enregistrer=True)
    assert problemes
    serie = base.historique_fiabilite("ldlc")
    assert serie and serie[0]["statut"] == "probleme"
    assert serie[0]["motif"]


# --- Mode degrade ----------------------------------------------------------

def test_base_corrompue_ne_plante_pas(tmp_path):
    ancienne = sqlite_store._conn
    chemin = tmp_path / "corrompue.db"
    chemin.write_bytes(b"ceci n'est pas une base sqlite")
    try:
        sqlite_store.configure(chemin)
        etat = sqlite_store.etat()
        assert etat["degrade"], "La corruption doit etre signalee"
        assert "corrompu" in etat["degrade"]
        assert sqlite_store.est_actif() is False
        # Les lectures rendent du vide plutot que de lever.
        assert sqlite_store.charger_history({}) == {}
        assert sqlite_store.evolution_fiabilite() == []
    finally:
        sqlite_store._conn = ancienne


def test_base_verrouillee_est_diagnostiquee(tmp_path):
    ancienne = sqlite_store._conn
    chemin = tmp_path / "verrouillee.db"
    bloqueur = sqlite3.connect(str(chemin), timeout=1)
    bloqueur.execute("BEGIN EXCLUSIVE")
    bloqueur.execute("CREATE TABLE IF NOT EXISTS x(a)")
    try:
        sqlite_store.configure(chemin)
        etat = sqlite_store.etat()
        assert etat["degrade"], "Le verrou doit etre signale"
        assert "verrouille" in etat["degrade"]
    finally:
        bloqueur.close()
        sqlite_store._conn = ancienne


def test_diagnostic_traduit_les_erreurs():
    assert "verrouille" in sqlite_store._diagnostiquer(
        sqlite3.OperationalError("database is locked"), True)
    assert "corrompu" in sqlite_store._diagnostiquer(
        sqlite3.DatabaseError("file is not a database"), True)
    assert "lecture seule" in sqlite_store._diagnostiquer(
        sqlite3.OperationalError("attempt to write a readonly database"), True)


def test_etat_rend_un_diagnostic_exploitable(base):
    infos = base.etat()
    assert infos["actif"] is True
    assert infos["degrade"] is None
    assert "releves" in infos and "mesures" in infos


def test_le_rapport_porte_l_avertissement():
    """Un rapport de secours doit le DIRE, en HTML comme en texte."""
    # Plan reel plutot que factice : build_report en attend toutes les cles.
    plan = pt.build_buy_plan([], {}, None, None)
    msg = "Base inutilisable (test) : donnees de secours."
    html, texte = pt.build_report([], plan, None, None, {}, None,
                                  avertissement=msg)
    assert msg in html and "Donnees de secours" in html
    assert msg in "\n".join(texte) if isinstance(texte, list) else msg in texte
