#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
demo_probabilites.py -- demonstration des probabilites empiriques (Axe 4).

Montre les deux comportements du module, dans cet ordre :

  1. sur VOTRE historique reel : il refuse de produire un chiffre, et dit
     pourquoi. C'est le comportement attendu aujourd'hui ;
  2. sur un historique profond : il produit une frequence, une courbe de
     survie, un delai median -- et le resultat est verifie a la main.

La deuxieme partie existe parce que « ca refuse toujours » ne prouverait
rien. Il faut aussi montrer que le calcul est juste quand les donnees le
permettent.

Usage :
    python demo_probabilites.py
"""
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

import probabilites as pb

BASE = Path(__file__).resolve().parent


def titre(t):
    print()
    print("=" * 74)
    print(f"  {t}")
    print("=" * 74)


def serie_profonde(graine=7):
    """
    Trois ans de releves tous les 4 jours : tendance, cycles d'amplitude
    variable, bruit. Certains creux passent sous 400 EUR, d'autres non --
    c'est ce qui rend la frequence interessante (ni 0%, ni 100%).
    """
    random.seed(graine)
    depart = date.today() - timedelta(days=700)
    releves = []
    for i in range(0, 700, 4):
        cycle = i % 110
        amplitude = 60 if (i // 110) % 2 == 0 else 130
        position = cycle / 55 if cycle <= 55 else (110 - cycle) / 55
        prix = 500 - amplitude * position + random.uniform(-6, 6)
        releves.append({"date": (depart + timedelta(days=i)).isoformat(),
                        "site": "demo", "price": round(prix, 2)})
    return releves


def main():
    # ------------------------------------------------------------------
    titre("1. SUR VOTRE HISTORIQUE REEL : le module se tait")

    try:
        import sqlite_store
        config = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
        sqlite_store.configure(BASE / config.get("sqlite_file", "prices.db"))
        history = sqlite_store.charger_history(config)
    except Exception as e:
        print(f"  (historique reel indisponible : {e})")
        history, config = {}, {"components": []}

    refus = estimables = 0
    for comp in config.get("components", []):
        node = history.get(comp["id"])
        if not node or not node.get("entries"):
            continue
        ref = comp.get("reference") or {}
        seuil = ref.get("historical_low") or ref.get("typical_price")
        if not seuil:
            continue
        r = pb.probabilite_baisse(node["entries"], float(seuil), 60)
        if r["estimable"]:
            estimables += 1
            print(f"  {comp['id']:22} {pb.formater(r)}")
        else:
            refus += 1
            print(f"  {comp['id']:22} {r['message']}")

    print()
    print(f"  {refus} refus, {estimables} estimation(s).")
    print("  Chaque refus porte son motif et sa taille d'echantillon.")
    print("  C'est voulu : un pourcentage tire de 2 episodes serait un")
    print("  chiffre credible et faux -- exactement ce que la feuille de")
    print("  route v3 refuse.")

    # ------------------------------------------------------------------
    titre("2. SUR UN HISTORIQUE PROFOND : le module estime, et se verifie")

    releves = serie_profonde()
    serie = pb.serie_journaliere(releves)
    print(f"  Serie de demonstration : {len(serie)} jours de releve, "
          f"etendue {pb.etendue_observee(serie)} j")
    print(f"  Prix observes : min {min(p for _, p in serie):.2f} EUR, "
          f"max {max(p for _, p in serie):.2f} EUR\n")

    print(f"  {'seuil':>10}  {'horizon':>8}  {'frequence':>10}  {'n':>4}  "
          f"{'confiance':<10} {'median':>8}   controle manuel")
    print("  " + "-" * 70)

    ecarts = []
    for seuil, horizon in ((420.0, 60), (400.0, 60), (400.0, 90),
                           (380.0, 60), (340.0, 60)):
        r = pb.probabilite_baisse(releves, seuil, horizon)
        if not r["estimable"]:
            print(f"  {seuil:>10.2f}  {horizon:>6} j  {r['message']}")
            continue

        # Verification independante : proportion brute sur les episodes
        # disjoints, sans passer par Kaplan-Meier.
        eps = pb.episodes_baisse(serie, seuil, horizon)
        exploitables = [e for e in eps if e["evenement"] or not e["censure"]]
        disjoints = pb.episodes_disjoints(exploitables)
        manuel = (sum(1 for e in disjoints if e["evenement"])
                  / len(disjoints) * 100) if disjoints else 0.0
        ecarts.append(abs(manuel - r["probabilite"]))

        median = f"{r['delai_median']} j" if r["delai_median"] else "-"
        print(f"  {seuil:>10.2f}  {horizon:>6} j  {r['probabilite']:>9.1f}%  "
              f"{r['n']:>4}  {r['confiance_label']:<10} {median:>8}   "
              f"{manuel:>5.1f}%")

    print()
    if ecarts:
        print(f"  Ecart maximal Kaplan-Meier / comptage manuel : "
              f"{max(ecarts):.2f} point(s).")

    # ------------------------------------------------------------------
    titre("3. LA COURBE DE SURVIE")

    r = pb.probabilite_baisse(releves, 400.0, 90)
    if r["estimable"]:
        print(f"  Seuil 400 EUR, horizon 90 j, n={r['n']} episodes independants")
        print(f"  ({r['n_brut']} episodes bruts, {r['censures']} fenetre(s) "
              f"tronquee(s) exclue(s))\n")
        print(f"  {'jours':>7}  {'encore sans baisse':>19}  {'a risque':>9}")
        print("  " + "-" * 42)
        for t, s, a in r["courbe"]:
            barre = "#" * int(s * 30)
            print(f"  {t:>7}  {s * 100:>17.1f}%  {a:>9}  {barre}")
        print()
        print("  Lecture : la courbe ne dit pas quand le prix baissera. Elle")
        print("  dit a quelle frequence il avait baisse, passe tel delai,")
        print("  dans les episodes deja observes.")

    # ------------------------------------------------------------------
    titre("4. LES GARDE-FOUS, MIS A L'EPREUVE")

    court = [{"date": (date.today() - timedelta(days=d)).isoformat(),
              "site": "x", "price": 500.0 - d} for d in (30, 20, 10, 0)]
    cas = [
        ("echantillon trop mince", pb.probabilite_baisse(court, 400.0, 20)),
        ("horizon > etendue observee", pb.probabilite_baisse(releves, 400.0, 900)),
        ("seuil jamais depasse", pb.probabilite_baisse(releves, 9999.0, 60)),
    ]
    for nom, r in cas:
        marque = "ESTIME" if r["estimable"] else "REFUS "
        print(f"  [{marque}] {nom:28} -> {r['message'][:60]}")

    print()
    print("  Aucun de ces cas ne produit de pourcentage. Le module prefere")
    print("  se taire, comme detecter_fausse_promo le fait deja quand une")
    print("  fenetre compte moins de deux releves.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
