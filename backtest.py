#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyse_offres.py  --  qualification des offres
================================================
Repond a deux questions que le moteur de recherche ne pose pas :

  1. Cette offre est-elle credible, ou est-ce une boutique frauduleuse,
     une erreur de prix, ou une lecture ratee ?
  2. Est-ce une vraie affaire, et a quel point ?

LE SIGNAL PRINCIPAL : LE CONSENSUS DU JOUR
-------------------------------------------
Quand quinze marchands annoncent 449 EUR et qu'un seizieme annonce 149 EUR,
ce n'est pas une affaire. C'est, par ordre de probabilite : une boutique
frauduleuse, une erreur de saisie qui sera annulee, un produit different, ou
une lecture ratee de la page.

Ce raisonnement est plus fiable que n'importe quel seuil fixe, parce qu'il
ne depend d'aucune valeur ecrite a l'avance : il se recalibre chaque jour sur
le marche reel. C'est pour cela qu'il est au centre de ce module.

TROIS SOURCES D'HISTORIQUE
--------------------------
  - votre propre historique (history.json), le plus fiable mais court ;
  - le plancher legal des 30 derniers jours, affiche par le marchand lui-meme
    en application de la directive europeenne Omnibus, et recupere en ligne
    dans la page ;
  - le consensus des autres vendeurs le jour meme.
"""

import statistics
from datetime import datetime, timedelta


# ---------------------------------------------------------------------------
# Reglages
# ---------------------------------------------------------------------------

# En dessous de ce rapport a la mediane du jour, une offre isolee est
# consideree comme non credible. 0,55 = moins de 55 % du prix constate
# partout ailleurs.
SEUIL_SUSPECT = 0.55
# Zone intermediaire : credible mais a confirmer soi-meme avant d'acheter.
SEUIL_A_VERIFIER = 0.75
# Nombre minimum de vendeurs pour que la mediane veuille dire quelque chose.
QUORUM = 4

NIVEAUX_CONFIANCE = {"haute": 3, "moyenne": 2, "faible": 1, "inconnue": 0}


# ---------------------------------------------------------------------------
# 1. Credibilite d'une offre
# ---------------------------------------------------------------------------

def consensus(offres, etat=None):
    """
    Prix de reference du jour : mediane des offres, hors valeurs extremes.

    La mediane est preferee a la moyenne precisement parce qu'une offre
    frauduleuse a 149 EUR ne doit pas tirer la reference vers le bas.

    Si `etat` est precise, seules les offres du meme etat comptent. Comparer
    un reconditionne a 339 EUR a des cartes neuves a 449 EUR le presenterait
    comme une remise de 24 %, alors que ce n'est pas le meme produit.
    """
    prix = sorted(o.prix for o in offres
                  if o.prix and (etat is None or getattr(o, "etat", "neuf") == etat))
    if not prix:
        return None
    return statistics.median(prix)


def pairs_comparables(offre, offres, quorum):
    """
    Offres auxquelles celle-ci peut etre honnetement comparee.

    On privilegie le meme etat (neuf avec neuf). Faute d'assez de points de
    comparaison, on elargit a tout le monde, mais l'appelant est prevenu :
    la reference devient approximative.
    """
    etat = getattr(offre, "etat", "neuf")
    memes = [o for o in offres
             if o.vendeur != offre.vendeur and getattr(o, "etat", "neuf") == etat]
    if len(memes) >= max(1, quorum - 1):
        return memes, True
    return [o for o in offres if o.vendeur != offre.vendeur], False


def evaluer_credibilite(offre, offres_du_jour, config=None):
    """
    Renvoie (verdict, raisons) ou verdict vaut
    "fiable", "a_verifier" ou "suspect".

    Une offre suspecte n'est pas supprimee : elle est signalee. Une erreur de
    prix reelle est parfois honoree, et c'est a vous de juger -- mais elle ne
    doit jamais declencher une alerte "occasion ultime" sans avertissement.
    """
    seuils = (config or {}).get("thresholds", {})
    seuil_suspect = seuils.get("seuil_offre_suspecte", SEUIL_SUSPECT)
    seuil_verif = seuils.get("seuil_offre_a_verifier", SEUIL_A_VERIFIER)
    quorum = seuils.get("quorum_consensus", QUORUM)

    raisons = []
    autres, comparable = pairs_comparables(offre, offres_du_jour, quorum)
    reference = consensus(autres)
    if not comparable and getattr(offre, "etat", "neuf") != "neuf":
        raisons.append(f"produit {offre.etat}, trop peu d'offres equivalentes "
                       f"pour comparer")

    rapport = None
    if reference and comparable and len(autres) >= quorum - 1:
        rapport = offre.prix / reference
        if rapport < seuil_suspect:
            raisons.append(
                f"{rapport:.0%} du prix constate chez {len(autres)} autres "
                f"vendeurs ({reference:.2f} EUR)")
        elif rapport < seuil_verif:
            raisons.append(
                f"nettement sous le consensus du jour ({reference:.2f} EUR)")

    if offre.confiance in ("faible", "inconnue"):
        raisons.append(f"marchand de confiance {offre.confiance}")
    if not offre.verifiee:
        raisons.append("prix non confirme sur la fiche produit")
    if offre.dispo is False:
        raisons.append("annonce en rupture")
    if offre.port_estime and offre.port:
        raisons.append(f"port estime a {offre.port:.0f} EUR, non confirme")

    # Un prix tres bas ET un marchand mal identifie : c'est le profil type
    # de la fausse boutique. Les deux signaux se renforcent.
    tres_bas = rapport is not None and rapport < seuil_suspect
    mal_connu = offre.confiance in ("faible", "inconnue")

    if tres_bas and (mal_connu or not offre.verifiee):
        return "suspect", raisons
    if tres_bas:
        return "a_verifier", raisons
    if rapport is not None and rapport < seuil_verif and mal_connu:
        return "a_verifier", raisons
    if offre.dispo is False:
        return "a_verifier", raisons
    return "fiable", raisons


def filtrer_credibles(offres, config=None):
    """
    Annote chaque offre d'un verdict et renvoie (retenues, ecartees).

    En mode `ecarter_suspectes`, les offres suspectes sortent du classement :
    elles ne peuvent plus devenir "le meilleur prix" ni entrer dans
    l'historique. C'est le reglage recommande.
    """
    seuils = (config or {}).get("thresholds", {})
    ecarter = seuils.get("ecarter_suspectes", True)

    retenues, ecartees = [], []
    for o in offres:
        verdict, raisons = evaluer_credibilite(o, offres, config)
        o.verdict = verdict
        o.raisons = raisons
        if verdict == "suspect" and ecarter:
            ecartees.append(o)
        else:
            retenues.append(o)
    return retenues, ecartees


# ---------------------------------------------------------------------------
# 2. Historique : le sien, celui du marchand, celui du marche
# ---------------------------------------------------------------------------

def stats_historique(entrees, jours=90):
    """Reperes tires de votre propre historique pour un composant."""
    if not entrees:
        return None
    limite = (datetime.now() - timedelta(days=jours)).strftime("%Y-%m-%d")
    recents = [e for e in entrees if e.get("date", "") >= limite] or entrees
    prix = sorted(e["price"] for e in recents)
    if not prix:
        return None
    return {
        "min": prix[0],
        "max": prix[-1],
        "median": statistics.median(prix),
        "n": len(prix),
        "jours": jours,
        "min_absolu": min(e["price"] for e in entrees),
    }


def percentile(valeur, echantillon):
    """Part de l'echantillon situee au-dessus de `valeur`, en pourcentage."""
    if not echantillon:
        return None
    superieurs = sum(1 for x in echantillon if x > valeur)
    return round(100 * superieurs / len(echantillon))


def plancher_connu(offre, hist):
    """
    Prix plancher le mieux etabli : le plus bas entre votre historique et le
    plancher legal des 30 derniers jours affiche par le marchand.

    Le second est precieux quand votre historique est court : il couvre une
    periode que vous n'avez pas observee.
    """
    candidats = [x for x in (offre.plus_bas_30j,
                             (hist or {}).get("min_absolu")) if x]
    return min(candidats) if candidats else None


# ---------------------------------------------------------------------------
# 3. Caracterisation de l'affaire
# ---------------------------------------------------------------------------

ECHELLE = [
    ("OPPORTUNITE EXCEPTIONNELLE", 85),
    ("TRES BONNE AFFAIRE", 70),
    ("BONNE AFFAIRE", 55),
    ("CORRECT", 35),
    ("PRIX HAUT", 0),
]


def caracteriser(offre, offres_du_jour, entrees_historique=None, config=None):
    """
    Note une offre de 0 a 100 et lui attribue un libelle.

    La note combine quatre reperes independants, ponderes selon ce qu'ils
    valent reellement :

      - position dans VOTRE historique (35 %) : le repere le plus sur, mais
        limite a ce que vous avez observe ;
      - ecart au consensus des autres vendeurs aujourd'hui (30 %) : capte les
        promotions du jour que l'historique ignore encore ;
      - ecart au plancher des 30 derniers jours (20 %) : donnee officielle,
        recuperee dans la page du marchand ;
      - qualite de l'offre elle-meme (15 %) : stock, verification, confiance.

    Une offre jugee suspecte est plafonnee : elle ne peut pas etre presentee
    comme une opportunite tant que sa credibilite n'est pas etablie.
    """
    seuils = (config or {}).get("thresholds", {})
    quorum = seuils.get("quorum_consensus", QUORUM)
    hist = stats_historique(entrees_historique or [])
    autres, comparable = pairs_comparables(offre, offres_du_jour, quorum)
    reference = consensus(autres)
    plancher = plancher_connu(offre, hist)

    # Un reconditionne ne se juge pas sur l'historique des prix du neuf.
    etat = getattr(offre, "etat", "neuf")
    if etat != "neuf":
        hist = None
        if not comparable:
            reference = None       # aucune base honnete de comparaison

    composantes, poids_total, note = {}, 0.0, 0.0

    # -- Position dans votre historique
    if hist and hist["n"] >= 3:
        prix_hist = [e["price"] for e in entrees_historique]
        pct = percentile(offre.prix, prix_hist)
        composantes["historique"] = pct
        note += pct * 0.35
        poids_total += 0.35

    # -- Ecart au consensus du jour
    if reference and comparable:
        ecart = (reference - offre.prix) / reference     # 0,10 = 10 % moins cher
        valeur = max(0, min(100, 50 + ecart * 400))
        composantes["consensus"] = round(valeur)
        note += valeur * 0.30
        poids_total += 0.30

    # -- Ecart au plancher connu
    # Bareme volontairement severe : si le produit a ete disponible a 439 EUR
    # dans les trente derniers jours, l'acheter 449 aujourd'hui n'est pas une
    # affaire, meme si l'ecart parait faible en pourcentage.
    if plancher:
        if offre.prix <= plancher:
            valeur = 100
        else:
            depassement = (offre.prix - plancher) / plancher
            valeur = max(0, 55 - depassement * 1200)     # +4,5 % = 0
        composantes["plancher"] = round(valeur)
        note += valeur * 0.20
        poids_total += 0.20

    # -- Qualite intrinseque de l'offre
    qualite = 50
    qualite += 20 if offre.verifiee else -10
    qualite += {"haute": 20, "moyenne": 10, "faible": -15,
                "inconnue": -10}.get(offre.confiance, 0)
    qualite += 10 if offre.dispo is True else (-40 if offre.dispo is False else 0)
    qualite = max(0, min(100, qualite))
    composantes["qualite"] = qualite
    note += qualite * 0.15
    poids_total += 0.15

    note = round(note / poids_total) if poids_total else 50

    # Fausse promotion : une reduction est annoncee (ancien tarif barre) alors
    # que le produit valait moins cher dans les trente derniers jours. Le
    # marchand est en regle -- il affiche bien le plancher -- mais l'offre
    # n'est pas l'affaire qu'elle pretend etre.
    fausse_promo = bool(offre.prix_barre and plancher
                        and offre.prix > plancher * 1.001)
    if fausse_promo:
        note = min(note, 45)

    verdict = getattr(offre, "verdict", None)
    if verdict is None:
        verdict, _ = evaluer_credibilite(offre, offres_du_jour, config)
    if verdict == "suspect":
        return {"note": min(note, 30), "libelle": "OFFRE NON CREDIBLE",
                "verdict": verdict, "fausse_promo": fausse_promo,
                "composantes": composantes,
                "reference_jour": reference, "plancher": plancher}
    if verdict == "a_verifier":
        note = min(note, 70)

    libelle = next(nom for nom, seuil in ECHELLE if note >= seuil)
    if fausse_promo:
        libelle = "FAUSSE PROMOTION"
    elif etat != "neuf":
        libelle = f"{libelle} ({etat})"
    return {"note": note, "libelle": libelle, "verdict": verdict,
            "fausse_promo": fausse_promo, "composantes": composantes,
            "reference_jour": reference, "plancher": plancher,
            "etat": etat, "comparable": comparable}


def expliquer(offre, analyse):
    """Une phrase disant pourquoi, en langage clair."""
    bouts = []
    etat = getattr(offre, "etat", "neuf")
    if etat != "neuf":
        bouts.append(f"produit {etat}")
        if not analyse.get("comparable", True):
            bouts.append("pas d'equivalent pour comparer")
    ref = analyse.get("reference_jour")
    if ref:
        ecart = (ref - offre.prix) / ref * 100
        if ecart > 2:
            bouts.append(f"{ecart:.0f} % sous le prix des autres vendeurs")
        elif ecart < -2:
            bouts.append(f"{-ecart:.0f} % au-dessus des autres vendeurs")
        else:
            bouts.append("au niveau des autres vendeurs")
    plancher = analyse.get("plancher")
    if plancher:
        if offre.prix <= plancher:
            bouts.append("au plus bas jamais observe")
        else:
            bouts.append(f"plancher connu {plancher:.2f} EUR")
    c = analyse["composantes"]
    if "historique" in c:
        bouts.append(f"moins cher que {c['historique']} % de vos releves")
    if analyse.get("fausse_promo"):
        bouts.append("reduction annoncee mais prix superieur au plancher 30 jours")
    if getattr(offre, "tva_ajoutee", 0):
        bouts.append(f"prix HT converti (+{offre.tva_ajoutee:.0f} EUR de TVA)")
    if analyse["verdict"] != "fiable":
        bouts.append(f"credibilite : {analyse['verdict'].replace('_', ' ')}")
    return " ; ".join(bouts) if bouts else "pas assez de donnees pour trancher"


# ---------------------------------------------------------------------------
# 4. Rapport
# ---------------------------------------------------------------------------

def analyser_composant(component, offres, historique, config=None):
    """Analyse complete pour un composant : offres retenues, ecartees, notes."""
    retenues, ecartees = filtrer_credibles(offres, config)
    entrees = (historique or {}).get(component["id"], {}).get("entries", [])

    analyses = []
    for o in retenues:
        a = caracteriser(o, retenues, entrees, config)
        analyses.append((o, a))
    analyses.sort(key=lambda oa: -oa[1]["note"])

    for o in ecartees:
        o.analyse = caracteriser(o, offres, entrees, config)
    return {"analyses": analyses, "ecartees": ecartees}


def afficher_analyse(component, resultat):
    print(f"[{component['category']}] {component['name']}")
    for o, a in resultat["analyses"]:
        marques = []
        if o.verifiee:
            marques.append("verifiee")
        if o.port:
            marques.append(f"+{o.port:.0f} port")
        suffixe = f" ({', '.join(marques)})" if marques else ""
        print(f"   {a['note']:3}/100  {a['libelle']:28} "
              f"{o.prix:8.2f} EUR chez {o.vendeur}{suffixe}")
        print(f"            {expliquer(o, a)}")
    for o in resultat["ecartees"]:
        print(f"   ECARTEE  {o.prix:8.2f} EUR chez {o.vendeur} "
              f"-- {'; '.join(o.raisons)}")
    print()
