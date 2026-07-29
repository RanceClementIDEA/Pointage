#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
demo_politesse.py -- mesure ce que la politesse reseau fait economiser (8.3).

Simule un marchand qui respecte le protocole HTTP : il renvoie un ETag, et
repond 304 quand la page n'a pas change. On compare deux executions
identiques, avec et sans cache conditionnel, et on mesure :

  * le nombre d'extractions evitees ;
  * le volume de donnees transmis ;
  * la fraicheur du prix rendu -- qui doit etre IDENTIQUE, sinon
    l'economie serait payee par l'utilisateur.

Aucun reseau : le serveur est simule en memoire.

Usage :
    python demo_politesse.py
"""
import sys
import tempfile
from pathlib import Path

import moteur_recherche as mr
import price_tracker as pt
import sqlite_store

PAGE = """<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"GPU",
 "offers":{"@type":"Offer","price":"429.99","priceCurrency":"EUR"}}
</script></head><body><div class="price">429,99 &euro;</div>
<p>%s</p></body></html>"""


class Reponse:
    def __init__(self, code, texte="", entetes=None):
        self.status_code = code
        self.text = texte
        self.headers = entetes or {}
        self.encoding = "utf-8"
        self.apparent_encoding = "utf-8"


class MarchandSimule:
    """Serveur en memoire qui gere ETag / If-None-Match."""

    def __init__(self, etag='"v1"'):
        self.etag = etag
        self.corps = PAGE % ("remplissage " * 400)
        self.octets_transmis = 0
        self.requetes = 0
        self.trois_cent_quatre = 0

    def get(self, url, headers=None, timeout=None, allow_redirects=True):
        self.requetes += 1
        headers = headers or {}
        if headers.get("If-None-Match") == self.etag:
            self.trois_cent_quatre += 1
            # Un 304 ne transporte pas de corps : quelques centaines d'octets
            # d'en-tetes, contre la page entiere.
            self.octets_transmis += 200
            return Reponse(304, "", {"ETag": self.etag})
        self.octets_transmis += len(self.corps.encode("utf-8"))
        return Reponse(200, self.corps,
                       {"ETag": self.etag, "Content-Type": "text/html; charset=utf-8"})


def _recuperateur(marchand, avec_cache):
    recup = mr.Recuperateur(delai=0, timeout=1)
    if avec_cache:
        recup.cache_http = pt.CacheHTTP()

    class SessionSimulee:
        headers = {}

        def get(self, url, headers=None, timeout=None, allow_redirects=True):
            return marchand.get(url, headers, timeout, allow_redirects)

    import threading
    verrou = threading.Lock()

    def _session_simulee(domaine):
        # Le vrai _session initialise aussi dernier_appel : on reproduit ce
        # contrat, sinon le calcul du delai de politesse leve une KeyError.
        recup.dernier_appel.setdefault(domaine, 0.0)
        return SessionSimulee(), verrou

    recup._session = _session_simulee
    return recup


def executer(marchand, avec_cache, url, site, cycles):
    """Rejoue `cycles` executions et rend les prix obtenus."""
    prix_obtenus = []
    for _ in range(cycles):
        recup = _recuperateur(marchand, avec_cache)
        p = pt.fetch_price(url, site, recuperateur=recup)
        prix_obtenus.append(p)
    return prix_obtenus


def main():
    url = "https://marchand.test/gpu"
    site = "marchand"

    with tempfile.TemporaryDirectory() as tmp:
        ancienne = sqlite_store._conn
        sqlite_store.configure(Path(tmp) / "politesse.db")
        try:
            print("=" * 74)
            print("  POLITESSE RESEAU : ce que la retenue economise")
            print("=" * 74)
            print("  Scenario : 5 executions sur une page qui NE CHANGE PAS.\n")

            # --- Sans cache conditionnel ---
            sqlite_store._conn.execute("DELETE FROM cache_http")
            sqlite_store._conn.commit()
            sans = MarchandSimule()
            prix_sans = executer(sans, False, url, site, 5)

            # --- Avec cache conditionnel ---
            sqlite_store._conn.execute("DELETE FROM cache_http")
            sqlite_store._conn.commit()
            avec = MarchandSimule()
            prix_avec = executer(avec, True, url, site, 5)

            ko_sans = sans.octets_transmis / 1024
            ko_avec = avec.octets_transmis / 1024
            gain = (1 - ko_avec / ko_sans) * 100 if ko_sans else 0

            print(f"  {'':24} {'sans cache':>14} {'avec cache':>14}")
            print("  " + "-" * 56)
            print(f"  {'requetes emises':24} {sans.requetes:>14} {avec.requetes:>14}")
            print(f"  {'reponses 304':24} {sans.trois_cent_quatre:>14} "
                  f"{avec.trois_cent_quatre:>14}")
            print(f"  {'pages retelechargees':24} "
                  f"{sans.requetes - sans.trois_cent_quatre:>14} "
                  f"{avec.requetes - avec.trois_cent_quatre:>14}")
            print(f"  {'volume transmis (Ko)':24} {ko_sans:>14.1f} {ko_avec:>14.1f}")
            print()
            print(f"  >>> VOLUME TRANSMIS : -{gain:.0f}%")
            print(f"      {avec.trois_cent_quatre}/{avec.requetes} reponses sans "
                  f"corps ni extraction.")

            print("\n  --- Fraicheur percue par l'utilisateur ---")
            print(f"    sans cache : {prix_sans}")
            print(f"    avec cache : {prix_avec}")
            identiques = prix_sans == prix_avec
            print(f"    prix identiques : {'OUI' if identiques else 'NON'}")
            if not identiques:
                print("    /!\\ L'economie serait payee par l'utilisateur : anomalie.")

            # --- Page modifiee : le prix doit suivre ---
            print("\n  --- Et si la page change ? ---")
            avec.etag = '"v2"'
            avec.corps = avec.corps.replace("429.99", "399.00").replace(
                "429,99", "399,00")
            recup = _recuperateur(avec, True)
            nouveau = pt.fetch_price(url, site, recuperateur=recup)
            print(f"    nouveau prix detecte : {nouveau}")
            suit = nouveau == 399.00
            print(f"    le changement est bien capte : {'OUI' if suit else 'NON'}")

            print("=" * 74)
            return 0 if (identiques and suit and gain > 50) else 1
        finally:
            sqlite_store.fermer()
            sqlite_store._conn = ancienne


if __name__ == "__main__":
    sys.exit(main())
