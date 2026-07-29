#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backtest.py -- banc de backtesting des regles de decision.

Roadmap v3, Axe 1 (deuxieme brique). Repond a UNE question :

    « Nos regles actuelles font-elles gagner de l'argent par rapport a
      acheter au hasard le jour 1 ? »

Methode
-------
On rejoue l'historique stocke en SQLite (prices.db, alimente par
sqlite_store.py) date par date, en simulant ce que `analyze_component`
aurait conseille A L'EPOQUE, puis on chiffre trois strategies :

  1. REGLES     : on achete a la premiere date ou le conseil est ACHETER
                  ou OCCASION ULTIME (le declencheur d'achat du produit).
  2. JOUR 1     : on achete au premier releve connu (reference naive).
  3. OPTIMUM    : on achete au jour le moins cher (reference theorique,
                  inatteignable -- elle demande de connaitre l'avenir).

Le chiffre de synthese est l'ecart REGLES vs JOUR 1, en euros et en %.

Honnetete methodologique
------------------------
* AUCUN LOOKAHEAD. A la date simulee D, l'analyse ne recoit que les releves
  de date <= D. Le moteur ne voit jamais le futur.
* TEMPS GELE. `analyze_component` lit `datetime.now()` (fraicheur du prix,
  fenetres 7/30/90 j, saisonnalite). On gele donc l'horloge du module a la
  date simulee, sinon tout releve passe serait juge « perime » et le
  backtest ne mesurerait rien de reel. Le gel est local au banc : aucune
  ligne de logique metier n'est modifiee.
* PRIX RETENU identique a la production : le moins cher du dernier jour
  releve (meme regle que `main()`).
* TAILLE D'ECHANTILLON AFFICHEE. Un backtest sur 2 dates ne prouve rien.
  Le banc calcule un niveau de validite et refuse de presenter un chiffre
  comme concluant tant que l'historique est trop court (voir SEUILS).

Usage
-----
    python backtest.py                     # rapport console
    python backtest.py --json              # sortie machine
    python backtest.py --ecrire-baseline   # (re)genere BASELINE.md
"""
import argparse
import json
import sqlite3
import statistics
import sys
from contextlib import contextmanager
from datetime import datetime, time as dtime, timedelta
from pathlib import Path

import price_tracker as pt
import probabilites

BASE_DIR = Path(__file__).resolve().parent

# Un composant n'est « informatif » qu'a partir de 2 dates distinctes : avec
# une seule date, les trois strategies achetent forcement le meme jour et
# l'ecart est nul par construction.
MIN_DATES_INFORMATIF = 2

# Seuils de validite de la ligne de base (choix explicite, documente).
#
# Le nombre cumule de decisions ne suffit pas : 11 composants a 2 dates font
# 22 « decisions » sans qu'aucune strategie puisse se distinguer (avec 2 points,
# acheter « au signal » revient a choisir entre le premier et le dernier). Ce
# qui compte, c'est la DENSITE : combien de dates distinctes le projet a-t-il
# reellement observees, et combien par composant.
SEUIL_COMPOSANTS_CONCLUANT = 8    # composants informatifs
SEUIL_DATES_CALENDRIER = 20       # dates distinctes sur l'ensemble du projet
SEUIL_MEDIANE_DATES = 5           # mediane de dates par composant informatif


# ---------------------------------------------------------------------------
# Gel de l'horloge (indispensable pour rejouer une date passee)
# ---------------------------------------------------------------------------

@contextmanager
def horloge_gelee(jour):
    """Fait croire a price_tracker que « aujourd'hui » est `jour`."""
    reel = pt.datetime

    class _Gelee(reel):
        @classmethod
        def now(cls, tz=None):
            return reel.combine(jour, dtime.min)

        @classmethod
        def today(cls):
            return reel.combine(jour, dtime.min)

    pt.datetime = _Gelee
    try:
        yield
    finally:
        pt.datetime = reel


# ---------------------------------------------------------------------------
# Lecture de l'historique depuis SQLite
# ---------------------------------------------------------------------------

def charger_releves(db_path):
    """Retourne {produit_id: [{date, site, price, origin}, ...]} trie par date."""
    if not Path(db_path).exists():
        sys.exit(f"Base introuvable : {db_path}\n"
                 f"Lancez d'abord : python price_tracker.py --dry-run --no-email")
    conn = sqlite3.connect(str(db_path))
    par_produit = {}
    # ORDER BY ts, id : `id` est la cle de substitution (rowid), donc l'ordre
    # d'insertion. Cela reproduit exactement l'ordre des entrees de
    # history.json (tri stable par date), ce qui garantit des resultats
    # identiques quelle que soit la source.
    for pid, site, prix, ts, origin in conn.execute(
            "SELECT produit_id, vendeur_id, prix, ts, origin FROM releves "
            "ORDER BY produit_id, ts, id"):
        par_produit.setdefault(pid, []).append(
            {"date": ts, "site": site, "price": float(prix), "origin": origin})
    conn.close()
    for entries in par_produit.values():
        entries.sort(key=lambda e: e["date"])
    return par_produit


def charger_releves_json(history_path):
    """Meme structure, mais lue depuis history.json (pour comparer les sources)."""
    if not Path(history_path).exists():
        sys.exit(f"history.json introuvable : {history_path}")
    history = json.loads(Path(history_path).read_text(encoding="utf-8"))
    par_produit = {}
    for cid, node in history.items():
        if cid == "_slots_winners" or not isinstance(node, dict):
            continue
        entries = [{"date": e["date"], "site": e["site"],
                    "price": float(e["price"]), "origin": e.get("origin", "tracked")}
                   for e in node.get("entries", [])]
        if entries:
            entries.sort(key=lambda e: e["date"])
            par_produit[cid] = entries
    return par_produit


def prix_du_jour(entries, jour):
    """Prix retenu pour une date : le moins cher releve ce jour-la."""
    du_jour = [e for e in entries if e["date"] == jour]
    return min(e["price"] for e in du_jour) if du_jour else None


# ---------------------------------------------------------------------------
# Rejeu d'un composant
# ---------------------------------------------------------------------------

def rejouer_composant(component, entries, config, regles="v2.9"):
    """
    Rejoue chronologiquement l'historique d'un composant et retourne le
    detail des decisions + le chiffrage des trois strategies.

    `regles` selectionne le moteur de decision rejoue :

      "v2.9"  regles deterministes d'origine. Le declencheur d'achat est le
              premier conseil ACHETER ou OCCASION ULTIME. C'est la LIGNE DE
              BASE etablie au prompt 6.3.

      "v3.1"  regles de la vague 7. Deux ajouts, et deux seulement :
                * le calendrier produit alimente la decision (prompt 7.3) :
                  un refresh annonce pousse le conseil vers ATTENDRE ;
                * un declencheur d'achat est SUSPENDU si l'esperance de gain
                  a attendre est mesurable et positive (prompt 7.2, qui
                  s'appuie sur les frequences du prompt 7.1).
              Rien d'autre ne change : meme historique, meme prix retenu,
              meme absence de lookahead.
    """
    thresholds = config.get("thresholds", {})
    market_ctx = config.get("market_context", {})
    reference = component.get("reference")
    probabiliste = (regles == "v3.1")
    horizon = thresholds.get("horizon_esperance_jours", 60)

    dates = sorted({e["date"] for e in entries})
    if not dates:
        return None

    decisions = []
    achat_regles = None          # (date, prix, conseil)
    suspensions = 0              # fois ou l'esperance a retenu l'achat

    for jour in dates:
        # --- Pas de lookahead : uniquement le passe et le present ---
        connus = [e for e in entries if e["date"] <= jour]
        if not connus:
            continue

        # Meme regle qu'en production : le moins cher du dernier jour releve.
        derniere = connus[-1]["date"]
        du_jour = [e for e in connus if e["date"] == derniere]
        moins_cher = min(du_jour, key=lambda e: e["price"])
        ordonnes = [e for e in connus if e["date"] != derniere] + [moins_cher]

        node = {
            "name": component["name"],
            "category": component["category"],
            "entries": ordonnes,
        }

        jour_date = datetime.strptime(jour, "%Y-%m-%d").date()
        with horloge_gelee(jour_date):
            ongoing, next_event = pt.current_and_next_events(jour_date)
            # Vague 7 : le calendrier produit est evalue A LA DATE SIMULEE,
            # sinon les delais seraient ceux d'aujourd'hui.
            evenements = pt.evenements_produits(config) if probabiliste else None
            analyse = pt.analyze_component(
                node, reference, thresholds, market_ctx, ongoing, next_event,
                evenements=evenements)

        if not analyse:
            continue

        conseil = analyse["advice"]
        prix = analyse["current"]
        decisions.append({"date": jour, "conseil": conseil, "prix": prix,
                          "score": analyse["score"],
                          "confiance": analyse["confidence_label"]})

        if achat_regles is None and conseil in ("ACHETER", "OCCASION ULTIME"):
            suspendu = False
            if probabiliste and conseil != "OCCASION ULTIME":
                # Attendre vaut-il mieux ? On ne suspend que sur une esperance
                # MESURABLE et positive -- jamais sur une intuition.
                with horloge_gelee(jour_date):
                    est = probabilites.esperance_attente(connus, horizon, prix)
                if est.get("estimable") and est["esperance_pct"] > 1.0:
                    suspendu = True
                    suspensions += 1
                    decisions[-1]["suspendu"] = est["esperance_pct"]
            if not suspendu:
                achat_regles = {"date": jour, "prix": prix, "conseil": conseil}

    if not decisions:
        return None

    # --- Chiffrage des trois strategies ---
    prix_par_date = {d: prix_du_jour(entries, d) for d in dates}

    cout_jour1 = prix_par_date[dates[0]]
    date_optimum = min(prix_par_date, key=lambda d: prix_par_date[d])
    cout_optimum = prix_par_date[date_optimum]

    if achat_regles:
        cout_regles = achat_regles["prix"]
        date_regles = achat_regles["date"]
        declenche = True
    else:
        # Jamais declenche : on considere que l'achat a lieu au dernier
        # releve connu (un projet finit par acheter). Convention documentee.
        date_regles = dates[-1]
        cout_regles = prix_par_date[date_regles]
        declenche = False

    return {
        "id": component["id"],
        "nom": component["name"],
        "categorie": component["category"],
        "regles": regles,
        "suspensions": suspensions,
        "dates": len(dates),
        "releves": len(entries),
        "informatif": len(dates) >= MIN_DATES_INFORMATIF,
        "decisions": decisions,
        "declenche": declenche,
        "conseil_declencheur": achat_regles["conseil"] if achat_regles else None,
        "date_regles": date_regles, "cout_regles": cout_regles,
        "date_jour1": dates[0], "cout_jour1": cout_jour1,
        "date_optimum": date_optimum, "cout_optimum": cout_optimum,
        "gain_vs_jour1": round(cout_jour1 - cout_regles, 2),
        "gain_max_possible": round(cout_jour1 - cout_optimum, 2),
    }


# ---------------------------------------------------------------------------
# Agregation
# ---------------------------------------------------------------------------

def agreger(resultats):
    informatifs = [r for r in resultats if r["informatif"]]

    def _totaux(lot):
        return (round(sum(r["cout_regles"] for r in lot), 2),
                round(sum(r["cout_jour1"] for r in lot), 2),
                round(sum(r["cout_optimum"] for r in lot), 2))

    t_regles, t_jour1, t_opt = _totaux(informatifs)
    gain = round(t_jour1 - t_regles, 2)
    gain_pct = round(gain / t_jour1 * 100, 2) if t_jour1 else 0.0
    gain_max = round(t_jour1 - t_opt, 2)
    capture_pct = round(gain / gain_max * 100, 1) if gain_max else None

    dates_decision = sum(len(r["decisions"]) for r in informatifs)

    # Densite reelle de l'historique
    toutes_dates = set()
    for r in resultats:
        toutes_dates.update(d["date"] for d in r["decisions"])
    dates_calendrier = len(toutes_dates)
    mediane_dates = (statistics.median([r["dates"] for r in informatifs])
                     if informatifs else 0)

    # Decomposition du gain : ce que les regles ont VRAIMENT produit, versus
    # ce qui vient de la convention de repli (regle jamais declenchee). Sans
    # cette separation, un composant ou la regle n'a rien dit peut porter
    # l'essentiel du chiffre et faire croire que les regles fonctionnent.
    gain_declenches = round(
        sum(r["gain_vs_jour1"] for r in informatifs if r["declenche"]), 2)
    gain_repli = round(
        sum(r["gain_vs_jour1"] for r in informatifs if not r["declenche"]), 2)

    concluant = (len(informatifs) >= SEUIL_COMPOSANTS_CONCLUANT
                 and dates_calendrier >= SEUIL_DATES_CALENDRIER
                 and mediane_dates >= SEUIL_MEDIANE_DATES)

    return {
        "composants_total": len(resultats),
        "composants_informatifs": len(informatifs),
        "dates_decision": dates_decision,
        "dates_calendrier": dates_calendrier,
        "mediane_dates_par_composant": mediane_dates,
        "declenches": sum(1 for r in informatifs if r["declenche"]),
        "total_regles": t_regles,
        "total_jour1": t_jour1,
        "total_optimum": t_opt,
        "gain_eur": gain,
        "gain_pct": gain_pct,
        "gain_declenches_eur": gain_declenches,
        "gain_repli_eur": gain_repli,
        "gain_max_eur": gain_max,
        "capture_pct": capture_pct,
        "concluant": concluant,
        "seuils": {"composants": SEUIL_COMPOSANTS_CONCLUANT,
                   "dates_calendrier": SEUIL_DATES_CALENDRIER,
                   "mediane_dates": SEUIL_MEDIANE_DATES},
    }


def comparer_regles(config=None, db_path=None, source="sqlite"):
    """
    Prompt 7.5 : la vague 7 a-t-elle ameliore les decisions, ou seulement
    leur complexite ?

    Rejoue le MEME historique avec les deux moteurs de decision et compare
    trois strategies :

        jour 1   achat au premier releve connu (reference naive)
        v2.9     regles deterministes -- la ligne de base du prompt 6.3
        v3.1     regles probabilistes de la vague 7

    Le resultat est donne en euros ET en dispersion : une moyenne seule
    masquerait le fait qu'un ecart provient parfois d'un seul composant.
    L'ecart v3.1 - v2.9 est calcule PAR COMPOSANT (comparaison appariee :
    meme composant, meme historique, seule la regle change), ce qui est la
    seule facon honnete de conclure sur un echantillon aussi petit.
    """
    config = config or pt.load_config()
    a = lancer(config, db_path, source, regles="v2.9")
    b = lancer(config, db_path, source, regles="v3.1")

    par_id_a = {r["id"]: r for r in a["composants"]}
    par_id_b = {r["id"]: r for r in b["composants"]}
    communs = [i for i in par_id_a if i in par_id_b
               and par_id_a[i]["informatif"]]

    lignes, ecarts = [], []
    for cid in sorted(communs):
        ra, rb = par_id_a[cid], par_id_b[cid]
        ecart = round(ra["cout_regles"] - rb["cout_regles"], 2)  # >0 = v3.1 moins cher
        ecarts.append(ecart)
        lignes.append({
            "id": cid, "nom": ra["nom"], "dates": ra["dates"],
            "jour1": ra["cout_jour1"],
            "v29": ra["cout_regles"], "v31": rb["cout_regles"],
            "optimum": ra["cout_optimum"],
            "ecart": ecart,
            "suspensions": rb.get("suspensions", 0),
            "declenche_v29": ra["declenche"], "declenche_v31": rb["declenche"],
        })

    def _stats(valeurs):
        if not valeurs:
            return {"n": 0, "moyenne": None, "ecart_type": None,
                    "min": None, "max": None}
        return {
            "n": len(valeurs),
            "moyenne": round(statistics.mean(valeurs), 2),
            "ecart_type": (round(statistics.stdev(valeurs), 2)
                           if len(valeurs) > 1 else None),
            "min": round(min(valeurs), 2),
            "max": round(max(valeurs), 2),
        }

    total_j1 = round(sum(l["jour1"] for l in lignes), 2)
    total_29 = round(sum(l["v29"] for l in lignes), 2)
    total_31 = round(sum(l["v31"] for l in lignes), 2)
    total_opt = round(sum(l["optimum"] for l in lignes), 2)

    gains_29 = [round(l["jour1"] - l["v29"], 2) for l in lignes]
    gains_31 = [round(l["jour1"] - l["v31"], 2) for l in lignes]

    # Verdict : on ne conclut que si un ecart existe ET qu'il depasse le
    # bruit. Sur un echantillon de cette taille, c'est rarement le cas --
    # et le dire est l'objet meme de ce prompt.
    stats_ecart = _stats(ecarts)
    non_nuls = [e for e in ecarts if abs(e) > 0.005]
    if not non_nuls:
        verdict = "identique"
        conclusion = ("Les deux jeux de regles produisent EXACTEMENT les memes "
                      "decisions sur l'historique disponible.")
    elif stats_ecart["moyenne"] and stats_ecart["ecart_type"] and \
            abs(stats_ecart["moyenne"]) > stats_ecart["ecart_type"]:
        mieux = stats_ecart["moyenne"] > 0
        verdict = "ameliore" if mieux else "degrade"
        conclusion = (f"v3.1 est en moyenne "
                      f"{abs(stats_ecart['moyenne']):.2f} EUR "
                      f"{'moins' if mieux else 'plus'} chere par composant, "
                      f"au-dela de la dispersion observee "
                      f"({stats_ecart['ecart_type']:.2f} EUR).")
    else:
        verdict = "indecidable"
        conclusion = ("L'ecart entre v2.9 et v3.1 ne se distingue pas du bruit : "
                      "il porte sur trop peu de composants pour conclure.")

    return {
        "genere_le": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": a["source"],
        "lignes": lignes,
        "totaux": {"jour1": total_j1, "v29": total_29, "v31": total_31,
                   "optimum": total_opt},
        "gain_v29": _stats(gains_29),
        "gain_v31": _stats(gains_31),
        "ecart_v31_v29": stats_ecart,
        "composants_divergents": len(non_nuls),
        "suspensions_totales": sum(l["suspensions"] for l in lignes),
        "verdict": verdict,
        "conclusion": conclusion,
        "validite": a["synthese"]["concluant"],
        "mecanisme": verifier_mecanisme(),
        "synthese_v29": a["synthese"], "synthese_v31": b["synthese"],
    }


def lancer(config=None, db_path=None, source="sqlite", regles="v2.9"):
    config = config or pt.load_config()
    if source == "json":
        chemin = BASE_DIR / config.get("history_file", "history.json")
        par_produit = charger_releves_json(chemin)
    else:
        chemin = db_path or (BASE_DIR / config.get("sqlite_file", "prices.db"))
        par_produit = charger_releves(chemin)

    resultats = []
    for component in config["components"]:
        entries = par_produit.get(component["id"])
        if not entries:
            continue
        r = rejouer_composant(component, entries, config, regles=regles)
        if r:
            resultats.append(r)

    resultats.sort(key=lambda r: (-r["dates"], r["id"]))
    return {"synthese": agreger(resultats), "composants": resultats,
            "regles": regles,
            "genere_le": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "source": str(Path(chemin).name)}


# ---------------------------------------------------------------------------
# Rapports
# ---------------------------------------------------------------------------

def afficher(rapport):
    s = rapport["synthese"]
    print("=" * 68)
    print("  BACKTEST DES REGLES DE DECISION")
    print("=" * 68)
    print(f"  Source : {rapport['source']}    genere le {rapport['genere_le']}\n")

    print(f"  Composants rejoues        : {s['composants_total']}")
    print(f"  dont informatifs (>= {MIN_DATES_INFORMATIF} dates) : {s['composants_informatifs']}")
    print(f"  Dates distinctes (projet) : {s['dates_calendrier']}")
    print(f"  Mediane dates/composant   : {s['mediane_dates_par_composant']}")
    print(f"  Regle declenchee sur      : {s['declenches']}/{s['composants_informatifs']} composants\n")

    print("  --- Detail par composant (informatifs) ---")
    print(f"  {'composant':24} {'dates':>5} {'jour1':>9} {'regles':>9} "
          f"{'optimum':>9} {'gain':>8}  declencheur")
    for r in rapport["composants"]:
        if not r["informatif"]:
            continue
        decl = r["conseil_declencheur"] or "(jamais -> dernier releve)"
        print(f"  {r['nom'][:24]:24} {r['dates']:>5} {r['cout_jour1']:>9.2f} "
              f"{r['cout_regles']:>9.2f} {r['cout_optimum']:>9.2f} "
              f"{r['gain_vs_jour1']:>8.2f}  {decl}")

    ignores = [r for r in rapport["composants"] if not r["informatif"]]
    if ignores:
        print(f"\n  ({len(ignores)} composant(s) ecarte(s) : une seule date, "
              f"aucun ecart possible)")

    print("\n  --- Synthese ---")
    print(f"  Achat jour 1 (naif)        : {s['total_jour1']:>9.2f} EUR")
    print(f"  Achat suivant nos regles   : {s['total_regles']:>9.2f} EUR")
    print(f"  Achat au plus bas (ideal)  : {s['total_optimum']:>9.2f} EUR")
    print()
    print(f"  >>> LIGNE DE BASE : {s['gain_eur']:+.2f} EUR "
          f"({s['gain_pct']:+.2f} %) vs achat jour 1")
    if s["capture_pct"] is not None:
        print(f"      part du gain theorique capturee : {s['capture_pct']} % "
              f"(gain max possible {s['gain_max_eur']:.2f} EUR)")

    print()
    print("  --- D'ou vient ce gain ? ---")
    print(f"  Composants ou la regle s'est declenchee : {s['gain_declenches_eur']:+.2f} EUR")
    print(f"  Composants en repli (regle muette)      : {s['gain_repli_eur']:+.2f} EUR")
    if abs(s["gain_repli_eur"]) > abs(s["gain_declenches_eur"]):
        print("  /!\\ L'essentiel du chiffre vient du REPLI, pas des regles :")
        print("      il mesure surtout la convention « achat au dernier releve »")
        print("      appliquee quand aucun signal n'est venu.")

    print()
    if s["concluant"]:
        print("  Validite : CONCLUANTE (echantillon suffisant).")
    else:
        print("  Validite : NON CONCLUANTE -- echantillon trop mince.")
        print(f"    Requis : >= {s['seuils']['composants']} composants informatifs "
              f"(actuel {s['composants_informatifs']}),")
        print(f"             >= {s['seuils']['dates_calendrier']} dates distinctes "
              f"(actuel {s['dates_calendrier']}),")
        print(f"             mediane >= {s['seuils']['mediane_dates']} dates/composant "
              f"(actuel {s['mediane_dates_par_composant']}).")
        print("    Le chiffre ci-dessus est un point de depart technique, pas")
        print("    encore une mesure de performance. Il se consolidera tout seul")
        print("    a mesure que le suivi quotidien accumule des releves.")
    print("=" * 68)


def ecrire_baseline(rapport, chemin):
    s = rapport["synthese"]
    verdict = "CONCLUANTE" if s["concluant"] else "NON CONCLUANTE (échantillon trop mince)"

    lignes = [
        "# Ligne de base — backtest des règles de décision",
        "",
        "> Chiffre de référence de la v3. Toute amélioration de la Vague 7",
        "> (décision probabiliste, modèle événementiel, optimisation budget)",
        "> devra se comparer à ce nombre, obtenu par la même commande.",
        "",
        "```bash",
        "python backtest.py",
        "```",
        "",
        "## Le chiffre",
        "",
        f"**{s['gain_eur']:+.2f} EUR ({s['gain_pct']:+.2f} %) par rapport à un achat au jour 1.**",
        "",
        f"- Validité : **{verdict}**",
        f"- Généré le : {rapport['genere_le']} (source : `{rapport['source']}`)",
        "",
        "| Stratégie | Coût total | Écart vs jour 1 |",
        "|---|---:|---:|",
        f"| Achat jour 1 (naïf) | {s['total_jour1']:.2f} EUR | — |",
        f"| **Nos règles** (1er ACHETER / OCCASION ULTIME) | **{s['total_regles']:.2f} EUR** | **{s['gain_eur']:+.2f} EUR ({s['gain_pct']:+.2f} %)** |",
        f"| Achat au plus bas réel (optimum théorique) | {s['total_optimum']:.2f} EUR | {-s['gain_max_eur']:+.2f} EUR |",
        "",
    ]
    if s["capture_pct"] is not None:
        lignes += [f"Part du gain théoriquement disponible que les règles capturent : "
                   f"**{s['capture_pct']} %**.", ""]

    lignes += [
        "## D'où vient ce gain ?",
        "",
        "| Origine | Montant |",
        "|---|---:|",
        f"| Composants où la règle s'est **déclenchée** | {s['gain_declenches_eur']:+.2f} EUR |",
        f"| Composants en **repli** (aucun signal, achat au dernier relevé) | {s['gain_repli_eur']:+.2f} EUR |",
        "",
    ]
    if abs(s["gain_repli_eur"]) > abs(s["gain_declenches_eur"]):
        lignes += [
            "> ⚠️ **L'essentiel du chiffre vient du repli, pas des règles.** Il mesure",
            "> surtout la convention « achat au dernier relevé » appliquée quand aucun",
            "> signal n'est venu — pas la qualité du moteur de décision.",
            "",
        ]

    lignes += [
        "## Échantillon",
        "",
        f"- Composants rejoués : **{s['composants_total']}**",
        f"- Dont informatifs (≥ {MIN_DATES_INFORMATIF} dates distinctes) : **{s['composants_informatifs']}**",
        f"- Dates distinctes sur l'ensemble du projet : **{s['dates_calendrier']}**",
        f"- Médiane de dates par composant informatif : **{s['mediane_dates_par_composant']}**",
        f"- Règle déclenchée sur : **{s['declenches']}/{s['composants_informatifs']}** composants",
        "",
    ]

    if not s["concluant"]:
        lignes += [
            "### Pourquoi ce chiffre n'est pas encore une mesure de performance",
            "",
            "Seuils de validité retenus (et état actuel) :",
            "",
            "| Critère | Requis | Actuel |",
            "|---|---:|---:|",
            f"| Composants informatifs | ≥ {s['seuils']['composants']} | {s['composants_informatifs']} |",
            f"| Dates distinctes (projet) | ≥ {s['seuils']['dates_calendrier']} | {s['dates_calendrier']} |",
            f"| Médiane dates/composant | ≥ {s['seuils']['mediane_dates']} | {s['mediane_dates_par_composant']} |",
            "",
            "Le nombre cumulé de décisions ne suffit pas comme critère : 11 composants",
            "à 2 dates produisent 22 « décisions » sans qu'aucune stratégie ne puisse se",
            "distinguer — avec deux points, acheter « au signal » revient à choisir entre",
            "le premier et le dernier. Ce qui compte est la **densité** de l'historique.",
            "",
            "L'historique disponible est presque entièrement constitué de `seed_history`",
            "(relevés importés à la main) et d'un seul cycle de collecte automatique.",
            "",
            "C'est volontairement affiché plutôt que masqué : la v2 refuse déjà de rendre",
            "un verdict de fausse promo sans deux relevés par fenêtre, et écarte la",
            "prévision ML pour cause de fausse précision. Le même principe s'applique ici.",
            "",
            "**Ce chiffre devient exploitable sans rien changer au code** : chaque",
            "exécution quotidienne ajoute une date de décision par composant. Relancer",
            "`python backtest.py` régénère la mesure.",
            "",
        ]
    else:
        lignes += [
            "### Lecture",
            "",
            "L'échantillon atteint les seuils de validité : le chiffre peut servir de",
            "référence pour juger les évolutions de la Vague 7.",
            "",
        ]

    lignes += [
        "## Méthode",
        "",
        "Pour chaque composant, l'historique SQLite (`prices.db`) est rejoué",
        "chronologiquement. À chaque date, `analyze_component` est appelée avec",
        "**uniquement les relevés antérieurs ou égaux à cette date** — aucun accès au",
        "futur. L'horloge du module est gelée à la date simulée, sinon tout relevé",
        "passé serait jugé « non revérifié » et le rejeu ne mesurerait rien de réel.",
        "",
        "Trois stratégies sont chiffrées :",
        "",
        "1. **Règles** — achat à la première date où le conseil est `ACHETER` ou",
        "   `OCCASION ULTIME`. Si la règle ne se déclenche jamais, l'achat est",
        "   compté au dernier relevé connu (convention : un projet finit par acheter).",
        "2. **Jour 1** — achat au premier relevé connu (référence naïve).",
        "3. **Optimum** — achat au jour le moins cher (référence théorique, elle",
        "   suppose de connaître l'avenir).",
        "",
        "Le prix retenu pour une date est le moins cher relevé ce jour-là, comme en",
        "production.",
        "",
        "Aucune logique métier n'est modifiée par le banc : `analyze_component` est",
        "appelée telle quelle.",
        "",
        "---",
        "",
        "*Fichier régénéré par `python backtest.py --ecrire-baseline`.*",
    ]

    Path(chemin).write_text("\n".join(lignes) + "\n", encoding="utf-8")


def verifier_mecanisme():
    """
    Controle de sanite : la machinerie v3.1 EST-ELLE seulement capable de
    changer une decision ?

    Sans ce controle, « v2.9 et v3.1 donnent le meme resultat » serait
    ambigu : mecanisme inoperant, ou code mort ? On rejoue donc un historique
    CONSTRUIT pour declencher la suspension (derive baissiere, plancher de
    reference bas), et on rapporte ce qui se passe -- y compris si le
    resultat est defavorable.

    Deterministe : graine fixe, aucune donnee reelle.
    """
    import random as _r
    _r.seed(2)
    depart = datetime.now().date() - timedelta(days=1000)
    entries = []
    for i in range(0, 1000, 5):
        cycle, derive = i % 100, (i // 100) * 22
        pos = cycle / 50 if cycle <= 50 else (100 - cycle) / 50
        entries.append({"date": (depart + timedelta(days=i)).isoformat(),
                        "site": "test",
                        "price": round(560 - derive - 45 * pos + _r.uniform(-3, 3), 2),
                        "origin": "tracked"})

    composant = {"id": "_controle", "name": "Composant de controle",
                 "category": "GPU",
                 "reference": {"typical_price": 480.0, "historical_low": 340.0,
                               "msrp": 600.0}}
    cfg = {"thresholds": {}, "market_context": {},
           "components": [composant], "evenements_produits": []}

    a = rejouer_composant(composant, entries, cfg, regles="v2.9")
    b = rejouer_composant(composant, entries, cfg, regles="v3.1")
    if not a or not b:
        return None

    ecart = round(a["cout_regles"] - b["cout_regles"], 2)
    return {
        "actif": b["suspensions"] > 0,
        "suspensions": b["suspensions"],
        "v29": {"date": a["date_regles"], "cout": a["cout_regles"],
                "declencheur": a["conseil_declencheur"]},
        "v31": {"date": b["date_regles"], "cout": b["cout_regles"],
                "declencheur": b["conseil_declencheur"]},
        "ecart": ecart,
        "jour1": a["cout_jour1"], "optimum": a["cout_optimum"],
        "sens": ("favorable" if ecart > 0.005
                 else "defavorable" if ecart < -0.005 else "neutre"),
    }


def afficher_comparaison(c):
    t = c["totaux"]
    print("=" * 78)
    print("  VAGUE 7 : LES REGLES PROBABILISTES FONT-ELLES MIEUX ?")
    print("=" * 78)
    print(f"  Source : {c['source']}    genere le {c['genere_le']}\n")

    print(f"  {'composant':24} {'dates':>5} {'jour 1':>9} {'v2.9':>9} "
          f"{'v3.1':>9} {'ecart':>8} {'susp.':>6}")
    print("  " + "-" * 74)
    for l in c["lignes"]:
        marque = " *" if abs(l["ecart"]) > 0.005 else ""
        print(f"  {l['nom'][:24]:24} {l['dates']:>5} {l['jour1']:>9.2f} "
              f"{l['v29']:>9.2f} {l['v31']:>9.2f} {l['ecart']:>8.2f} "
              f"{l['suspensions']:>6}{marque}")

    print("  " + "-" * 74)
    print(f"  {'TOTAL':24} {'':>5} {t['jour1']:>9.2f} {t['v29']:>9.2f} "
          f"{t['v31']:>9.2f} {t['v29'] - t['v31']:>8.2f}")
    print(f"  {'optimum theorique':24} {'':>5} {t['optimum']:>9.2f}")

    print("\n  --- Economie par rapport a l'achat jour 1 ---")
    for nom, s in (("v2.9 (ligne de base)", c["gain_v29"]),
                   ("v3.1 (probabiliste)", c["gain_v31"])):
        if s["moyenne"] is None:
            print(f"  {nom:22} : aucun composant exploitable")
            continue
        et = (f" +/- {s['ecart_type']:.2f}" if s["ecart_type"] is not None
              else " (ecart-type indisponible, n<2)")
        print(f"  {nom:22} : {s['moyenne']:+.2f} EUR/composant{et}  "
              f"(min {s['min']:+.2f}, max {s['max']:+.2f}, n={s['n']})")

    e = c["ecart_v31_v29"]
    print("\n  --- Ecart v3.1 - v2.9, apparie par composant ---")
    if e["moyenne"] is None:
        print("    aucun composant comparable")
    else:
        et = (f" +/- {e['ecart_type']:.2f}" if e["ecart_type"] is not None
              else "")
        print(f"    moyenne {e['moyenne']:+.2f} EUR{et}  "
              f"(min {e['min']:+.2f}, max {e['max']:+.2f}, n={e['n']})")
    print(f"    composants ou les deux regles divergent : "
          f"{c['composants_divergents']}/{len(c['lignes'])}")
    print(f"    achats suspendus par l'esperance de gain : "
          f"{c['suspensions_totales']}")

    m = c.get("mecanisme")
    if m:
        print("\n  --- Controle de sanite : le mecanisme v3.1 fonctionne-t-il ? ---")
        if not m["actif"]:
            print("    /!\\ Sur un historique CONSTRUIT pour le declencher, la")
            print("        suspension ne s'active pas : mecanisme suspect.")
        else:
            print(f"    Sur un historique construit pour le declencher : "
                  f"{m['suspensions']} suspension(s).")
            print(f"      v2.9 achete le {m['v29']['date']} a {m['v29']['cout']:.2f} EUR")
            print(f"      v3.1 achete le {m['v31']['date']} a {m['v31']['cout']:.2f} EUR")
            print(f"      ecart {m['ecart']:+.2f} EUR -> {m['sens']}")
            if m["sens"] == "defavorable":
                print("    Le mecanisme fonctionne mais DEGRADE le resultat dans ce")
                print("    cas : a force de differer, l'achat rate le bon prix.")

    print(f"\n  >>> VERDICT : {c['verdict'].upper()}")
    print(f"      {c['conclusion']}")
    if not c["validite"]:
        print("\n  RESERVE : l'echantillon reste sous les seuils de validite du")
        print("  banc (voir BASELINE.md). Aucun de ces chiffres ne doit servir")
        print("  a trancher tant que l'historique n'aura pas epaissi.")
    print("=" * 78)


def ecrire_vague7(c, chemin):
    t = c["totaux"]
    e = c["ecart_v31_v29"]

    def _stat(s):
        if s["moyenne"] is None:
            return "n/a"
        et = f" ± {s['ecart_type']:.2f}" if s["ecart_type"] is not None else ""
        return f"{s['moyenne']:+.2f} EUR{et}"

    lignes = [
        "# Vague 7 — validation par backtest",
        "",
        "> **La Vague 7 a-t-elle amélioré les décisions, ou seulement leur",
        "> complexité ?** Ce document répond, chiffres à l'appui, dans un sens",
        "> comme dans l'autre.",
        "",
        "```bash",
        "python backtest.py --comparer",
        "```",
        "",
        f"- Généré le : {c['genere_le']} (source : `{c['source']}`)",
        f"- Verdict : **{c['verdict'].upper()}**",
        "",
        "## Le résultat",
        "",
        f"**{c['conclusion']}**",
        "",
        "| Stratégie | Coût total | Économie vs jour 1 (par composant) |",
        "|---|---:|---:|",
        f"| Achat jour 1 (naïf) | {t['jour1']:.2f} EUR | — |",
        f"| **v2.9** (ligne de base, prompt 6.3) | {t['v29']:.2f} EUR | {_stat(c['gain_v29'])} |",
        f"| **v3.1** (probabiliste, prompts 7.1-7.4) | {t['v31']:.2f} EUR | {_stat(c['gain_v31'])} |",
        f"| Optimum théorique (connaît l'avenir) | {t['optimum']:.2f} EUR | — |",
        "",
        "### Écart v3.1 − v2.9, apparié par composant",
        "",
        "Comparaison appariée : même composant, même historique, seule la règle",
        "change. C'est la seule lecture honnête sur un échantillon de cette taille.",
        "",
        f"- Écart moyen : **{_stat(e)}** (n={e['n']})",
    ]
    if e["min"] is not None:
        lignes.append(f"- Étendue : {e['min']:+.2f} EUR à {e['max']:+.2f} EUR")
    lignes += [
        f"- Composants où les deux règles divergent : "
        f"**{c['composants_divergents']}/{len(c['lignes'])}**",
        f"- Achats suspendus par l'espérance de gain : "
        f"**{c['suspensions_totales']}**",
        "",
        "## Détail par composant",
        "",
        "| Composant | dates | jour 1 | v2.9 | v3.1 | écart | susp. |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for l in c["lignes"]:
        lignes.append(f"| {l['nom']} | {l['dates']} | {l['jour1']:.2f} | "
                      f"{l['v29']:.2f} | {l['v31']:.2f} | {l['ecart']:+.2f} | "
                      f"{l['suspensions']} |")

    lignes += [
        "",
        "## Ce que « v3.1 » change exactement dans le rejeu",
        "",
        "Deux ajouts, et deux seulement :",
        "",
        "1. **Calendrier produit décisionnel** (7.3) — un refresh annoncé pousse",
        "   le conseil vers ATTENDRE, évalué **à la date simulée**.",
        "2. **Suspension probabiliste** (7.2, fondée sur 7.1) — un déclencheur",
        "   d'achat est suspendu si l'espérance de gain à attendre est",
        "   **mesurable et positive**. Jamais sur une intuition : sous le seuil",
        "   d'échantillon, aucune suspension.",
        "",
        "L'optimiseur de séquence (7.4) n'intervient pas ici : il arbitre *entre*",
        "slots sous contrainte de budget, alors que le banc rejoue chaque",
        "composant indépendamment. Le mesurer demanderait un backtest de",
        "portefeuille — un chantier distinct, et honnêtement hors de portée de",
        "l'historique actuel.",
        "",
        "Tout le reste est identique : même historique, même prix retenu, même",
        "absence de lookahead, même horloge gelée.",
        "",
    ]

    if not c["validite"]:
        lignes += [
            "## ⚠️ Réserve de validité",
            "",
            "L'échantillon reste **sous les seuils de validité** du banc (voir",
            "`BASELINE.md`). Ces chiffres décrivent ce qui s'est passé sur",
            "l'historique disponible ; ils ne permettent pas de trancher sur la",
            "qualité générale des règles.",
            "",
            "C'est le risque que la feuille de route nomme explicitement en §9 —",
            "*« la fausse précision qui revient par la fenêtre »*. Un chiffre",
            "favorable produit ici serait un artefact, pas une preuve.",
            "",
            "**Ce document se met à jour tout seul** : chaque exécution",
            "quotidienne ajoute des dates de décision. Relancer",
            "`python backtest.py --comparer` régénère la comparaison.",
            "",
        ]

    m = c.get("mecanisme")
    if m:
        lignes += [
            "## Contrôle de sanité : le mécanisme fonctionne-t-il ?",
            "",
            "« Les deux règles donnent le même résultat » serait ambigu : mécanisme",
            "inopérant, ou code mort ? Le banc rejoue donc un historique **construit",
            "pour déclencher la suspension** (dérive baissière, plancher de référence",
            "bas). Résultat, exécuté à chaque génération de ce document :",
            "",
        ]
        if not m["actif"]:
            lignes += [
                "> ⚠️ **La suspension ne s'active pas**, même sur un historique conçu",
                "> pour la déclencher. Le mécanisme est suspect et mérite un examen.",
                "",
            ]
        else:
            lignes += [
                f"- Suspensions déclenchées : **{m['suspensions']}** — le mécanisme est actif.",
                f"- v2.9 achète le {m['v29']['date']} à **{m['v29']['cout']:.2f} EUR**",
                f"- v3.1 achète le {m['v31']['date']} à **{m['v31']['cout']:.2f} EUR**",
                f"- Écart : **{m['ecart']:+.2f} EUR** ({m['sens']})",
                "",
            ]
            if m["sens"] == "defavorable":
                lignes += [
                    "> ⚠️ **Le mécanisme fonctionne, mais dégrade le résultat dans ce",
                    "> cas.** À force de différer sur une espérance toujours positive",
                    "> (tendance baissière durable), l'achat rate le bon prix et finit",
                    "> au dernier relevé. C'est un piège réel de la règle de",
                    "> suspension : elle n'a pas de condition de sortie.",
                    "",
                    "Piste si ce comportement se confirme sur de vraies données :",
                    "borner le nombre de reports consécutifs, ou exiger que",
                    "l'espérance reste positive **et** que le prix ne soit pas déjà",
                    "sous le plancher de référence.",
                    "",
                ]

    if c["verdict"] == "identique":
        lignes += [
            "## Pourquoi les deux règles donnent le même résultat",
            "",
            "Ce n'est pas un bug, c'est le comportement voulu. Les mécanismes de",
            "la Vague 7 sont **conditionnés à une taille d'échantillon** :",
            "",
            "- `esperance_attente` refuse d'estimer sous 5 fenêtres indépendantes ;",
            "- l'historique actuel compte 1 à 4 dates par composant ;",
            "- aucun `refresh` n'est déclaré dans `config.json`.",
            "",
            "Résultat : aucune suspension ne se déclenche, aucun signal",
            "événementiel ne s'applique, et v3.1 se comporte exactement comme",
            "v2.9. **La Vague 7 n'a donc, à ce jour, ajouté que de la",
            "complexité — pas encore de valeur mesurable.** Elle en ajoutera",
            "quand les données le permettront, et ce document le dira.",
            "",
        ]

    lignes += [
        "---",
        "",
        "*Fichier régénéré par `python backtest.py --comparer --ecrire-vague7`.*",
    ]

    Path(chemin).write_text("\n".join(lignes) + "\n", encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description="Backtest des regles de decision")
    p.add_argument("--json", action="store_true", help="Sortie JSON brute")
    p.add_argument("--ecrire-baseline", action="store_true",
                   help="(Re)genere BASELINE.md")
    p.add_argument("--db", help="Chemin du fichier SQLite (defaut : config)")
    p.add_argument("--source", choices=("sqlite", "json"), default="sqlite",
                   help="Source de l'historique rejoue (defaut : sqlite)")
    p.add_argument("--regles", choices=("v2.9", "v3.1"), default="v2.9",
                   help="Moteur de decision rejoue (defaut : v2.9)")
    p.add_argument("--comparer", action="store_true",
                   help="Compare v2.9 et v3.1 sur le meme historique (prompt 7.5)")
    p.add_argument("--ecrire-vague7", action="store_true",
                   help="Avec --comparer : (re)genere VAGUE7.md")
    args = p.parse_args()

    if args.comparer or args.ecrire_vague7:
        comparaison = comparer_regles(db_path=args.db, source=args.source)
        if args.json:
            print(json.dumps(comparaison, ensure_ascii=False, indent=2))
        else:
            afficher_comparaison(comparaison)
        if args.ecrire_vague7:
            cible = BASE_DIR / "VAGUE7.md"
            ecrire_vague7(comparaison, cible)
            print(f"\n  VAGUE7.md ecrit ({cible}).")
        return

    rapport = lancer(db_path=args.db, source=args.source, regles=args.regles)

    if args.json:
        print(json.dumps(rapport, ensure_ascii=False, indent=2))
    else:
        afficher(rapport)

    if args.ecrire_baseline:
        cible = BASE_DIR / "BASELINE.md"
        ecrire_baseline(rapport, cible)
        print(f"\n  BASELINE.md ecrit ({cible}).")


if __name__ == "__main__":
    main()
