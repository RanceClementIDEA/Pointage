#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
demo_identite.py -- demonstration de la resolution d'identite produit (Axe 2).

Rejoue, hors ligne, le cas reel du composant `gpu_rx9060xt` : 5 sources
configurees plus la recherche elargie, tel qu'il se presente chez plusieurs
marchands (pages dans tests/golden/identite_*.html).

Montre :
  1. l'extraction EAN/GTIN + MPN depuis les donnees structurees ;
  2. le score de correspondance de chaque annonce, sur 3 niveaux ;
  3. la fusion par identite canonique, et ce qu'elle change au plancher ;
  4. l'effet sur detecter_fausse_promo et build_slot_comparisons.

Usage :
    python demo_identite.py
"""
import json
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

from bs4 import BeautifulSoup

import identite_produit
import price_tracker as pt
import sqlite_store

BASE = Path(__file__).resolve().parent
GOLDEN = BASE / "tests" / "golden"


def titre(t):
    print()
    print("=" * 74)
    print(f"  {t}")
    print("=" * 74)


def main():
    manifest_path = GOLDEN / "identite_manifest.json"
    if not manifest_path.exists():
        sys.exit("Golden files d'identite absents. Lancez : "
                 "python tests/golden/_generer_identite.py")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    config = pt.load_config()
    composant = next(c for c in config["components"]
                     if c["id"] == manifest["composant"])

    # ------------------------------------------------------------------
    titre("1. EXTRACTION DE L'IDENTITE DEPUIS LES DONNEES STRUCTUREES")
    annonces = []
    print(f"  Composant : {composant['name']}")
    print(f"  Recherche : {composant.get('recherche')!r}\n")
    print(f"  {'vendeur':14} {'prix':>8}  {'EAN/GTIN':>14}  {'MPN':<22}")
    print("  " + "-" * 68)
    for e in manifest["entrees"]:
        html = (GOLDEN / e["fichier"]).read_text(encoding="utf-8")
        soup = BeautifulSoup(html, "html.parser")
        ident = pt.extract_identite_from_jsonld(soup)
        prix = pt.extract_price_from_jsonld(soup)
        annonces.append({**ident, "site": e["site"],
                         "url": f"https://{e['site']}.test/{composant['id']}",
                         "prix": prix})
        print(f"  {e['site']:14} {prix:>8.2f}  {str(ident['gtin'] or '-'):>14}  "
              f"{str(ident['mpn'] or '-'):<22}")

    # ------------------------------------------------------------------
    titre("2. RESOLUTION : QUELLES ANNONCES PARLENT DU MEME PRODUIT ?")
    ref_gtin, ref_mpn = identite_produit.identite_de_reference(annonces)
    print(f"  Identite de reference deduite des annonces :")
    print(f"    EAN : {ref_gtin}")
    print(f"    MPN : {ref_mpn}")
    print("\n  Une identite decouverte chez UN vendeur valide -- ou invalide --")
    print("  les annonces de tous les autres.\n")

    resolutions = []
    print(f"  {'vendeur':14} {'prix':>8}  {'niv':>3}  {'correspondance':<16} "
          f"{'score':>6}  methode")
    print("  " + "-" * 68)
    for a in annonces:
        r = identite_produit.resoudre(a, composant, ref_gtin, ref_mpn)
        r = {**r, "vendeur": a["site"], "prix": a["prix"]}
        resolutions.append(r)
        print(f"  {a['site']:14} {a['prix']:>8.2f}  "
              f"{r['correspondance_level']:>3}  {r['correspondance_label']:<16} "
              f"{r['score']:>6.2f}  {r['methode']}")

    attendus = {e["site"]: e["niveau_attendu"] for e in manifest["entrees"]}
    ecarts = [r for r in resolutions
              if attendus[r["vendeur"]] != r["correspondance_level"]]
    print()
    if ecarts:
        print(f"  /!\\ {len(ecarts)} ecart(s) avec le niveau attendu :")
        for r in ecarts:
            print(f"      {r['vendeur']} : obtenu {r['correspondance_level']}, "
                  f"attendu {attendus[r['vendeur']]}")
    else:
        print("  Tous les niveaux correspondent a ce qui est attendu.")

    # ------------------------------------------------------------------
    titre("3. CE QUE L'IDENTITE CHANGE AU PLANCHER HISTORIQUE")
    tous = [r["prix"] for r in resolutions]
    confirmes = [r["prix"] for r in resolutions if r["correspondance_level"] >= 2]
    heuristique = [r["prix"] for r in resolutions if r["correspondance_level"] >= 1]
    rejetes = [r for r in resolutions if r["correspondance_level"] == 0]

    print(f"  Sans identite (toutes les annonces retenues) :")
    print(f"    plancher = {min(tous):.2f} EUR   <-- fausse affaire")
    for r in rejetes:
        print(f"      dont {r['vendeur']} a {r['prix']:.2f} EUR : "
              f"{r['correspondance_label']}")
    print(f"\n  Avec identite, correspondances sures (niveau >= 2) :")
    print(f"    plancher = {min(confirmes):.2f} EUR   <-- le vrai minimum")
    print(f"\n  Avec identite, heuristique de titre comprise (niveau >= 1) :")
    print(f"    plancher = {min(heuristique):.2f} EUR")
    print(f"\n  {len(rejetes)} annonce(s) ecartee(s) : elles auraient fait croire")
    print("  a une occasion ultime sur un produit qui n'est pas le bon.")

    # ------------------------------------------------------------------
    titre("4. FUSION EN BASE + EFFET SUR LES ANALYSES")
    with tempfile.TemporaryDirectory() as tmp:
        sqlite_store.configure(Path(tmp) / "demo.db")

        # Les annonces confirmees deviennent la source de verite de l'identite.
        for r, a in zip(resolutions, annonces):
            sqlite_store.enregistrer_annonce(
                composant["id"], a["site"], a["url"], a.get("titre", ""),
                r.get("gtin"), r.get("mpn"), r)
            if r.get("id_canonique"):
                sqlite_store.enregistrer_identite(
                    r["id_canonique"], composant["id"], r.get("gtin"),
                    r.get("mpn"), composant["name"], r["correspondance_level"])

        # Un releve par annonce, aujourd'hui.
        history = {composant["id"]: {"name": composant["name"],
                                     "category": composant["category"],
                                     "entries": [], "seed_imported": False}}
        aujourdhui = date.today().isoformat()
        for a in annonces:
            history[composant["id"]]["entries"].append(
                {"date": aujourdhui, "site": a["site"],
                 "price": a["prix"], "origin": "tracked"})
        sqlite_store.persister(history, config)

        canoniques = {}
        for r in resolutions:
            if r.get("id_canonique"):
                canoniques.setdefault(r["id_canonique"], []).append(r["vendeur"])

        print("  Identites canoniques enregistrees :")
        for cle, vendeurs in canoniques.items():
            info = sqlite_store.prix_canonique(cle)
            marque = "  <-- produit suivi" if cle.startswith(
                f"ean:{ref_gtin}") or cle.startswith("mpn:") else ""
            print(f"    {cle}")
            print(f"      vendeurs : {', '.join(vendeurs)}{marque}")
            if info:
                print(f"      plancher {info['plancher']:.2f} EUR sur "
                      f"{info['nb_vendeurs']} vendeur(s), "
                      f"niveau min {info['niveau_min']}")

        print("\n  Annonces telles que stockees (avec leur score) :")
        for a in sqlite_store.annonces_du_produit(composant["id"]):
            print(f"    {a['vendeur']:14} niveau {a['correspondance_level']} "
                  f"({a['correspondance_label']:<16}) score {a['score']:.2f}")

        # --- Fusion inter-produits ---------------------------------------
        # Cas reel : la recherche groupee (moteur_recherche.rechercher_groupe)
        # sert plusieurs composants d'une meme famille avec UNE requete. Une
        # annonce portant le meme EAN peut donc etre enregistree sous un autre
        # suivi. Sans identite canonique, ce prix serait invisible ici.
        AUTRE = "gpu_rx9060xt_autre_suivi"
        res_ean = next(r for r in resolutions
                       if r["correspondance_level"] == 3)
        sqlite_store.enregistrer_annonce(
            AUTRE, "proshop", "https://proshop.test/rx9060xt",
            "Sapphire Radeon RX 9060 XT 16GB", res_ean["gtin"], None, res_ean)
        hier = (date.today() - timedelta(days=1)).isoformat()
        sqlite_store.record_releve(AUTRE, "proshop", 389.00, hier, "tracked")

        print("\n  --- Effet sur les analyses (point 4) ---")
        node = history[composant["id"]]
        fusionnees = pt.fusionner_entries(composant, node)
        propres = {(e["date"], e["site"]) for e in node["entries"]}
        etrangers = [e for e in fusionnees if (e["date"], e["site"]) not in propres]

        print(f"    releves rattaches au composant : {len(node['entries'])}")
        print(f"    releves apres fusion canonique : {len(fusionnees)}")
        for e in etrangers:
            print(f"      + {e['site']} a {e['price']:.2f} EUR ({e['date']}) "
                  f"-- meme EAN, releve sous un autre suivi")
        retires = [e for e in node["entries"]
                   if (e["date"], e["site"]) not in
                   {(f["date"], f["site"]) for f in fusionnees}]
        for e in retires:
            print(f"      - {e['site']} a {e['price']:.2f} EUR retire "
                  f"-- identite dementie")
        av = min(e["price"] for e in node["entries"])
        ap = min(e["price"] for e in fusionnees)
        print(f"\n    plancher sans identite : {av:.2f} EUR  (accessoire)")
        print(f"    plancher apres fusion  : {ap:.2f} EUR  (vrai minimum)")
        print("\n    detecter_fausse_promo et build_slot_comparisons travaillent")
        print("    desormais sur cette base : le plancher et le prix courant")
        print("    qu'ils comparent refletent le vrai minimum inter-vendeurs.")

        sqlite_store.fermer()

    titre("RESULTAT")
    sur = [r for r in resolutions if r["correspondance_level"] >= 2]
    print(f"  {len(sur)}/{len(resolutions)} annonces confirmees comme etant le meme produit")
    print(f"  ({len([r for r in sur if r['correspondance_level'] == 3])} par EAN, "
          f"{len([r for r in sur if r['correspondance_level'] == 2])} par MPN), "
          f"{len(rejetes)} ecartee(s).")
    print(f"  Plancher retenu : {min(confirmes):.2f} EUR "
          f"(et non {min(tous):.2f} EUR, qui etait un accessoire).")
    print()
    return 0 if not ecarts else 1


if __name__ == "__main__":
    sys.exit(main())
