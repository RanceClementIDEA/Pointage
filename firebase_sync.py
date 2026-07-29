#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
exporter_web.py -- produit le jeu de donnees consomme par le site statique.

Le site (`web/`) est du HTML/JS pur : il ne sait pas lire SQLite et ne peut
pas interroger les marchands (CORS l'interdit depuis un navigateur). Il lui
faut donc une photographie deja calculee. C'est ce que fait ce script, en
reutilisant `serveur.construire_etat()` -- la meme fonction qui alimente
l'interface locale, donc les memes chiffres, sans seconde implementation a
maintenir.

Deux sorties, volontairement :

  * `web/data.json`  -- lu directement par le site. Suffit a lui seul :
    sans Firebase configure, le site fonctionne quand meme, avec les
    donnees du dernier passage de l'Action.
  * la meme charge est poussee vers Firestore par `firebase_sync.py`,
    ce qui ajoute la mise a jour en direct (`onSnapshot`).

Autrement dit, Firebase est une AMELIORATION, pas une dependance. Un site
qui tombe en panne parce qu'un service tiers change ses conditions n'est pas
un site fiable.

Usage :
    python exporter_web.py
    python exporter_web.py --sortie web/data.json
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import serveur                                               # noqa: E402
import dashboard as dash                                     # noqa: E402

try:
    import sqlite_store
except ImportError:                                          # pragma: no cover
    sqlite_store = None

SORTIE_DEFAUT = BASE_DIR / "web" / "data.json"

# Profondeur embarquee par serie. Le site sait zoomer de 7 jours a « tout » ;
# au-dela de ce nombre de points l'affichage est allege, mais les statistiques
# restent calculees sur la donnee complete (meme principe qu'en 9.3).
POINTS_MAX = 260
POINTS_FINS = 120


def _series_completes(history, config):
    """
    Series par composant : historique entier, allege pour l'affichage.

    Reutilise `dashboard.donnees_embarquees`, qui porte deja la logique de
    reduction preservant les extremes et la double resolution.
    """
    payload = dash.donnees_embarquees(config, history,
                                      points_max=POINTS_MAX,
                                      fine_jours=POINTS_FINS)
    return {s["id"]: s for s in payload["series"]}, payload


def construire(config=None, history=None):
    """Charge utile complete du site."""
    config = config or serveur.pt.load_config()
    if history is None:
        serveur._assurer_base()
        history = (sqlite_store.charger_history() if sqlite_store
                   else serveur.pt.load_history(config))

    etat = serveur.construire_etat(config, history)
    series, payload = _series_completes(history, config)

    # La serie legere de l'interface locale est remplacee par la serie
    # complete : sur le site, on veut pouvoir zoomer.
    for projet in etat["projets"]:
        for comp in projet["composants"]:
            s = series.get(comp["id"])
            if not s:
                continue
            comp["serie"] = s["points"]
            comp["serie_fine"] = s.get("recents")
            comp["stats"] = s["stats"]
            comp["allegee"] = s["echantillonne"]

    etat["collecte"] = {}          # sans objet hors de l'interface locale
    etat["profondeur_jours"] = payload["profondeur_jours"]
    etat["fenetre_fine_jours"] = POINTS_FINS
    etat["exporte"] = datetime.now().isoformat(timespec="seconds")
    return etat


def ecrire(sortie=SORTIE_DEFAUT, donnees=None):
    sortie = Path(sortie)
    sortie.parent.mkdir(parents=True, exist_ok=True)
    donnees = donnees if donnees is not None else construire()
    sortie.write_text(
        json.dumps(donnees, ensure_ascii=False, separators=(",", ":"),
                   default=str),
        encoding="utf-8")
    return sortie, donnees


def main(argv=None):
    ap = argparse.ArgumentParser(description="Exporte les donnees du site statique")
    ap.add_argument("--sortie", default=str(SORTIE_DEFAUT))
    args = ap.parse_args(argv)

    chemin, donnees = ecrire(args.sortie)
    poids = chemin.stat().st_size
    composants = sum(len(p["composants"]) for p in donnees["projets"])
    points = sum(len(c.get("serie") or [])
                 for p in donnees["projets"] for c in p["composants"])
    print(f"Donnees du site : {chemin}")
    print(f"  {len(donnees['projets'])} projet(s), {composants} composant(s), "
          f"{points} point(s)")
    print(f"  profondeur : {donnees['profondeur_jours']} jours")
    print(f"  poids      : {poids / 1024:.0f} Ko")
    if donnees["occasions_ultimes"]:
        print(f"  GROSSE OFFRE : {len(donnees['occasions_ultimes'])} en cours")
    return 0


if __name__ == "__main__":
    sys.exit(main())
