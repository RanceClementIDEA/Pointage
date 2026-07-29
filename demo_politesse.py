#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
demo_multiprojets.py -- mesure le cout marginal d'un projet supplementaire.

La feuille de route fixe l'objectif en §8 : « cout marginal proche de zero
grace a la mutualisation ». Ce script le VERIFIE plutot que de l'affirmer.

Trois executions comparees, sur la meme configuration de base :

  1. un seul projet ;
  2. deux projets partageant plusieurs composants ;
  3. deux projets dont un composant est un DOUBLON canonique (meme EAN sous
     deux identifiants differents).

On compte les collectes reellement effectuees -- chacune correspond aux
requetes reseau d'un composant chez tous ses vendeurs.

Aucun reseau : la collecte est simulee.

Usage :
    python demo_multiprojets.py
"""
import sys
import tempfile
from pathlib import Path

import identite_produit
import price_tracker as pt
import sqlite_store

BASE = Path(__file__).resolve().parent


def _config_base():
    cfg = pt.load_config()
    return {k: v for k, v in cfg.items()}


def _compter(config):
    """Nombre de collectes reelles + nombre de composants partages."""
    representants, partages = pt.produits_a_collecter(config)
    return len(representants), sum(len(v) for v in partages.values())


def titre(t):
    print()
    print("=" * 74)
    print(f"  {t}")
    print("=" * 74)


def main():
    cfg = _config_base()
    ids = [c["id"] for c in cfg["components"]]
    if len(ids) < 6:
        sys.exit("Configuration trop petite pour la demonstration.")

    with tempfile.TemporaryDirectory() as tmp:
        ancienne = sqlite_store._conn
        sqlite_store.configure(Path(tmp) / "multi.db")
        try:
            titre("COUT MARGINAL D'UN PROJET SUPPLEMENTAIRE")

            # --- 1 projet : toute la configuration ---
            un = {**cfg, "projets": [{"id": "tour", "nom": "Tour"}]}
            n1, p1 = _compter(un)

            # --- 2 projets partageant des composants ---
            # Le NAS reprend 4 composants de la tour et n'en ajoute aucun :
            # la collecte ne doit pas bouger d'un pouce.
            partage = ids[:4]
            deux = {**cfg, "projets": [
                {"id": "tour", "nom": "Tour"},
                {"id": "nas", "nom": "NAS", "composants": partage,
                 "budget": {"target_total": 600}}]}
            n2, p2 = _compter(deux)

            print(f"  {'scenario':38} {'collectes':>10} {'partages':>9}")
            print("  " + "-" * 60)
            print(f"  {'1 projet (13 composants)':38} {n1:>10} {p1:>9}")
            print(f"  {'2 projets, 4 composants communs':38} {n2:>10} {p2:>9}")
            print(f"  {'somme naive (1 projet + 4)':38} {n1 + len(partage):>10}")
            print()
            surcout = n2 - n1
            print(f"  >>> COUT MARGINAL DU 2e PROJET : {surcout} collecte(s) "
                  f"supplementaire(s)")
            print(f"      (une approche naive en aurait ajoute {len(partage)})")

            # --- 2 projets dont un composant EXCLUSIF au second ---
            titre("ET SI LE 2e PROJET APPORTE UN COMPOSANT INEDIT ?")
            exclusif = {**cfg, "projets": [
                {"id": "tour", "nom": "Tour", "composants": ids[:-1]},
                {"id": "nas", "nom": "NAS", "composants": partage + [ids[-1]]}]}
            n3, _ = _compter(exclusif)
            base_tour = len(ids) - 1
            print(f"  tour seule ({base_tour} composants)          : {base_tour} collectes")
            print(f"  tour + NAS (qui ajoute 1 inedit)  : {n3} collectes")
            print(f"  >>> le cout marginal se limite au NOUVEAU composant : "
                  f"{n3 - base_tour}")

            # --- Doublon canonique : meme EAN, deux identifiants ---
            titre("DOUBLON CANONIQUE : MEME PRODUIT, DEUX IDENTIFIANTS")
            jumeau = {**dict(cfg["components"][0]), "id": "doublon_ean"}
            cfg_doublon = {**cfg,
                           "components": cfg["components"] + [jumeau],
                           "projets": [
                               {"id": "tour", "nom": "Tour"},
                               {"id": "nas", "nom": "NAS",
                                "composants": [jumeau["id"]]}]}

            avant, _ = _compter(cfg_doublon)
            print(f"  sans identite connue : {avant} collectes "
                  f"(le doublon est collecte a part)")

            # On declare la meme identite canonique pour les deux.
            res = identite_produit.resoudre(
                {"gtin": "4015454000014", "titre": cfg["components"][0]["name"]},
                cfg["components"][0], reference_gtin="4015454000014")
            for cid in (cfg["components"][0]["id"], jumeau["id"]):
                sqlite_store.enregistrer_annonce(
                    cid, "ldlc", f"https://ldlc.test/{cid}",
                    cfg["components"][0]["name"], res["gtin"], res["mpn"], res)

            apres, partages_ean = _compter(cfg_doublon)
            print(f"  avec le meme EAN     : {apres} collectes, "
                  f"{partages_ean} prix partage(s) sans requete")
            print(f"  >>> {avant - apres} collecte(s) economisee(s) par "
                  f"l'identite canonique")

            titre("VERDICT")
            ok = (surcout == 0 and apres < avant)
            print(f"  Cout marginal d'un projet qui ne partage QUE des "
                  f"composants deja suivis : {surcout}")
            print(f"  Deux identifiants pour un meme article : fusionnes, "
                  f"{avant - apres} requete(s) en moins")
            print()
            print("  La collecte n'a jamais ete « par projet » : elle est")
            print("  « par produit ». Ajouter un projet n'ajoute de requetes")
            print("  que pour les composants qu'il apporte reellement.")
            return 0 if ok else 1
        finally:
            sqlite_store.fermer()
            sqlite_store._conn = ancienne


if __name__ == "__main__":
    sys.exit(main())
