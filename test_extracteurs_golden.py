# -*- coding: utf-8 -*-
"""
Filet de securite de la politesse reseau (Axe 3, prompt 8.3).

Trois mecanismes, tous par CIVISME -- jamais par contournement :

  * robots.txt : un chemin interdit n'est pas interroge, et c'est SIGNALE ;
  * cache conditionnel : un 304 evite le corps ET l'extraction, sans perte
    de fraicheur pour l'utilisateur ;
  * backoff exponentiel a l'echelle du SITE : un domaine qui trebuche
    plusieurs fois voit ses requetes suivantes espacees, pas seulement la
    requete fautive.
"""
import threading
from pathlib import Path

import pytest

import moteur_recherche as mr
import price_tracker as pt
import sqlite_store


# --- Backoff exponentiel ---------------------------------------------------

def test_le_backoff_est_exponentiel_et_plafonne():
    r = mr.Recuperateur(delai=2.5)
    d = "exemple.fr"
    attendus = [5.0, 10.0, 20.0, 40.0, 60.0, 60.0]
    obtenus = []
    for _ in attendus:
        r._noter_echec(d)
        obtenus.append(r._delai_domaine(d))
    assert obtenus == attendus


def test_le_backoff_sapplique_au_site_pas_a_la_requete():
    """Le delai penalise le DOMAINE : il vaut pour les requetes suivantes."""
    r = mr.Recuperateur(delai=2.0)
    r._noter_echec("lent.fr")
    r._noter_echec("lent.fr")
    assert r._delai_domaine("lent.fr") > r._delai_domaine("sain.fr")
    assert r._delai_domaine("sain.fr") == 2.0


def test_un_succes_remet_le_compteur_a_zero():
    r = mr.Recuperateur(delai=2.5)
    r._noter_echec("x.fr")
    r._noter_echec("x.fr")
    assert r._delai_domaine("x.fr") > 2.5
    r._noter_succes("x.fr")
    assert r._delai_domaine("x.fr") == 2.5


def test_le_delai_appris_reste_pris_en_compte():
    """Le backoff s'ajoute au delai appris des 429, il ne l'ecrase pas."""
    r = mr.Recuperateur(delai=1.0, delais_appris={"fragile.fr": 15.0})
    assert r._delai_domaine("fragile.fr") == 15.0


# --- robots.txt ------------------------------------------------------------

def test_robots_interdit_nest_pas_interroge_et_est_signale(monkeypatch):
    r = mr.Recuperateur(delai=0, respecter_robots=True)
    monkeypatch.setattr(r, "_autorise", lambda url: False)
    html, motif = r.get("https://interdit.test/page")
    assert html is None
    assert "robots.txt" in motif
    assert r.compteurs["robots_interdits"] == 1
    assert "interdit.test" in r.interdits


def test_robots_desactive_nempeche_rien():
    r = mr.Recuperateur(delai=0, respecter_robots=False)
    assert r._autorise("https://n-importe-quoi.test/x") is True


# --- Cache conditionnel ----------------------------------------------------

# Page de taille realiste : une fiche produit marchande pese des dizaines de
# Ko. Avec une page de 250 octets, l'en-tete d'un 304 couterait presque aussi
# cher que le corps, et la mesure d'economie n'aurait aucun sens.
_REMPLISSAGE = '<div class="bloc">contenu de remplissage</div>' * 400

PAGE = ('<html><head><script type="application/ld+json">'
        '{"@context":"https://schema.org","@type":"Product","name":"X",'
        '"offers":{"@type":"Offer","price":"100.00","priceCurrency":"EUR"}}'
        '</script></head><body><div class="price">100,00 &euro;</div>'
        + _REMPLISSAGE + '</body></html>')


class _Reponse:
    def __init__(self, code, texte="", entetes=None):
        self.status_code = code
        self.text = texte
        self.headers = entetes or {}
        self.encoding = self.apparent_encoding = "utf-8"


class _Marchand:
    def __init__(self, etag='"v1"', corps=PAGE):
        self.etag, self.corps = etag, corps
        self.requetes = self.trois_cent_quatre = 0
        self.octets = 0
        self.entetes_recus = []

    def get(self, url, headers=None, timeout=None, allow_redirects=True):
        self.requetes += 1
        headers = headers or {}
        self.entetes_recus.append(dict(headers))
        if headers.get("If-None-Match") == self.etag:
            self.trois_cent_quatre += 1
            self.octets += 200
            return _Reponse(304, "", {"ETag": self.etag})
        self.octets += len(self.corps.encode("utf-8"))
        return _Reponse(200, self.corps, {"ETag": self.etag})


def _recup(marchand, avec_cache=True):
    r = mr.Recuperateur(delai=0, timeout=1)
    if avec_cache:
        r.cache_http = pt.CacheHTTP()
    verrou = threading.Lock()

    class _S:
        headers = {}

        def get(self, url, headers=None, timeout=None, allow_redirects=True):
            return marchand.get(url, headers, timeout, allow_redirects)

    def _session(domaine):
        r.dernier_appel.setdefault(domaine, 0.0)
        return _S(), verrou

    r._session = _session
    return r


@pytest.fixture
def base(tmp_path):
    ancienne = sqlite_store._conn
    sqlite_store.configure(tmp_path / "politesse.db")
    yield sqlite_store
    sqlite_store.fermer()
    sqlite_store._conn = ancienne


URL = "https://m.test/p"


def test_le_validateur_est_renvoye_a_la_requete_suivante(base):
    m = _Marchand()
    pt.fetch_price(URL, "m", recuperateur=_recup(m))
    pt.fetch_price(URL, "m", recuperateur=_recup(m))
    assert m.entetes_recus[0].get("If-None-Match") is None
    assert m.entetes_recus[1].get("If-None-Match") == '"v1"'


def test_un_304_evite_le_retelechargement_et_lextraction(base):
    m = _Marchand()
    prix = [pt.fetch_price(URL, "m", recuperateur=_recup(m)) for _ in range(4)]
    assert m.trois_cent_quatre == 3
    assert prix == [100.0] * 4, "La fraicheur percue doit etre identique"


def test_le_volume_transmis_diminue(base):
    """Le critere de reussite, mesure."""
    sans = _Marchand()
    for _ in range(5):
        pt.fetch_price(URL, "m", recuperateur=_recup(sans, avec_cache=False))
    base._conn.execute("DELETE FROM cache_http")
    base._conn.commit()
    avec = _Marchand()
    for _ in range(5):
        pt.fetch_price(URL, "m", recuperateur=_recup(avec, avec_cache=True))

    assert avec.requetes == sans.requetes, "Le nombre de requetes ne change pas"
    assert avec.octets < sans.octets * 0.5, "Le volume doit chuter nettement"


def test_une_page_modifiee_est_bien_detectee(base):
    m = _Marchand()
    assert pt.fetch_price(URL, "m", recuperateur=_recup(m)) == 100.0
    m.etag = '"v2"'
    m.corps = PAGE.replace("100.00", "80.00").replace("100,00", "80,00")
    assert pt.fetch_price(URL, "m", recuperateur=_recup(m)) == 80.0


def test_le_prix_memorise_ne_perd_pas_le_validateur(base):
    """
    Le prix et l'ETag sont ecrits par deux appels distincts : le second ne
    doit pas effacer ce que le premier a memorise.
    """
    m = _Marchand()
    pt.fetch_price(URL, "m", recuperateur=_recup(m))
    fiche = base.lire_cache_http(URL)
    assert fiche["etag"] == '"v1"'
    assert fiche["dernier_prix"] == pytest.approx(100.0)


def test_sans_prix_memorise_un_304_ne_rend_rien(base):
    """Un 304 sans prix connu ne doit pas inventer de valeur."""
    base.memoriser_cache_http(URL, "m", etag='"v1"')
    m = _Marchand()
    assert pt.fetch_price(URL, "m", recuperateur=_recup(m)) is None


def test_le_cache_est_desactivable(base):
    m = _Marchand()
    for _ in range(3):
        pt.fetch_price(URL, "m", recuperateur=_recup(m, avec_cache=False))
    assert m.trois_cent_quatre == 0


def test_statistiques_cache(base):
    m = _Marchand()
    pt.fetch_price(URL, "m", recuperateur=_recup(m))
    pt.fetch_price(URL, "m", recuperateur=_recup(m))
    stats = base.statistiques_cache()
    assert stats["urls"] == 1
    assert stats["avec_validateur"] == 1
    assert stats["non_modifies_cumules"] >= 1


# --- Compteurs de politesse ------------------------------------------------

def test_les_compteurs_sont_tenus(base):
    m = _Marchand()
    r = _recup(m)
    r.get(URL)
    r.get(URL)                       # cache de session
    assert r.compteurs["cache_local"] == 1
    assert r.compteurs["requetes"] == 1
