# -*- coding: utf-8 -*-
"""
Filet de securite du dashboard explorable (Axe 6, prompt 9.1).

La propriete la plus precieuse du dashboard est son AUTONOMIE : il s'ouvre
depuis une piece jointe, hors ligne, sans rien telecharger. L'ajout d'un
explorateur ne doit pas l'entamer. Ces tests verrouillent donc d'abord
l'absence de dependance externe, puis le contenu.

L'interactivite reelle (clic, zoom, comparaison) est verifiee dans un vrai
navigateur par `verifier_dashboard.py` -- un test structurel ne peut pas
prouver qu'une page « fonctionne ».
"""
import json
import re
from datetime import date, timedelta

import pytest

import dashboard as dash


def _jour(n):
    return (date.today() - timedelta(days=n)).isoformat()


CONFIG = {
    "budget": {"target_total": 1000, "max_total": 1100},
    "projet": {"nom": "Tour", "achats": []},
    "components": [
        {"id": "gpu1", "name": "GPU 1", "category": "GPU", "slot": "GPU",
         "perf_index": 100, "reference": {"prix_reve": 350.0}},
        {"id": "cpu1", "name": "CPU 1", "category": "CPU"},
    ],
}

HISTORY = {
    "gpu1": {"name": "GPU 1", "category": "GPU", "entries": [
        {"date": _jour(60), "site": "ldlc", "price": 420.0, "origin": "tracked",
         "tier": "jsonld"},
        {"date": _jour(20), "site": "ldlc", "price": 400.0, "origin": "tracked"},
        {"date": _jour(1), "site": "cdiscount", "price": 380.0, "origin": "tracked"},
    ]},
    "cpu1": {"name": "CPU 1", "category": "CPU", "entries": [
        {"date": _jour(30), "site": "ldlc", "price": 150.0, "origin": "seed"},
        {"date": _jour(2), "site": "ldlc", "price": 140.0, "origin": "tracked"},
    ]},
}


@pytest.fixture
def page():
    return dash.build_dashboard(CONFIG, HISTORY)


# --- Autonomie : la propriete a ne jamais perdre ------------------------

@pytest.mark.parametrize("motif, libelle", [
    (r'src\s*=\s*["\']https?://', "script ou image distant"),
    (r'href\s*=\s*["\']https?://', "feuille de style distante"),
    (r'@import', "@import CSS"),
    (r'\bfetch\s*\(', "appel fetch"),
    (r'XMLHttpRequest', "XMLHttpRequest"),
    (r'WebSocket', "WebSocket"),
    (r'cdn\.|googleapis|unpkg|jsdelivr|cdnjs', "CDN connu"),
])
def test_aucune_dependance_externe(page, motif, libelle):
    assert not re.search(motif, page, re.I), f"dependance detectee : {libelle}"


def test_un_seul_fichier_suffit(page):
    """Tout est inline : donnees, style, script."""
    assert page.startswith("<!DOCTYPE html>")
    assert page.rstrip().endswith("</html>")
    assert "donnees-suivi" in page


def test_la_taille_reste_compatible_avec_un_email(page):
    assert len(page.encode("utf-8")) < 2_000_000, "Trop lourd pour une piece jointe"


# --- Donnees embarquees ----------------------------------------------------

def _payload(page):
    m = re.search(r'id="donnees-suivi">(.*?)</script>', page, re.S)
    assert m, "Le bloc de donnees doit exister"
    return json.loads(m.group(1).replace("<\\/", "</"))


def test_les_donnees_sont_du_json_valide(page):
    d = _payload(page)
    assert "series" in d and "projets" in d
    assert d["fenetre_jours"] == dash.FENETRE_JOURS


def test_chaque_composant_suivi_a_sa_serie(page):
    d = _payload(page)
    assert {s["id"] for s in d["series"]} == {"gpu1", "cpu1"}


def test_les_points_portent_le_detail_utile(page):
    d = _payload(page)
    gpu = next(s for s in d["series"] if s["id"] == "gpu1")
    p = gpu["points"][0]
    assert {"d", "p", "s"} <= set(p), "date, prix et site sont indispensables"
    assert gpu["reve"] == 350.0


def test_un_point_par_jour_le_moins_cher():
    history = {"gpu1": {"name": "G", "category": "GPU", "entries": [
        {"date": _jour(1), "site": "a", "price": 400.0, "origin": "tracked"},
        {"date": _jour(1), "site": "b", "price": 380.0, "origin": "tracked"},
        {"date": _jour(0), "site": "a", "price": 390.0, "origin": "tracked"},
    ]}}
    d = dash.donnees_embarquees({"components": [{"id": "gpu1", "name": "G",
                                                 "category": "GPU"}]}, history)
    pts = d["series"][0]["points"]
    assert len(pts) == 2
    assert pts[0]["p"] == 380.0, "Le moins cher du jour"


def test_rien_nest_ecarte_pour_anciennete():
    """
    Le contraire de ce que faisait la v2.9 (prompt 9.3).

    Une fenetre fixe amputait l'historique a la generation : le plancher de
    l'an dernier disparaissait du fichier, donc de toute lecture possible.
    Desormais la fenetre est un choix d'AFFICHAGE ; la donnee, elle, reste
    entiere.
    """
    history = {"gpu1": {"name": "G", "category": "GPU", "entries": [
        {"date": _jour(2000), "site": "a", "price": 900.0, "origin": "seed"},
        {"date": _jour(10), "site": "a", "price": 400.0, "origin": "tracked"},
        {"date": _jour(5), "site": "a", "price": 390.0, "origin": "tracked"},
    ]}}
    d = dash.donnees_embarquees({"components": [{"id": "gpu1", "name": "G",
                                                 "category": "GPU"}]}, history)
    dates = [p["d"] for p in d["series"][0]["points"]]
    assert _jour(2000) in dates, "L'historique profond doit rester explorable"
    assert d["series"][0]["stats"]["debut"] == _jour(2000)
    assert d["profondeur_jours"] >= 1995


def test_les_projets_sont_embarques(page):
    d = _payload(page)
    assert d["projets"] and d["projets"][0]["nom"] == "Tour"


def test_la_forme_multi_projets_est_embarquee():
    cfg = {**CONFIG, "projets": [
        {"id": "tour", "nom": "Tour"},
        {"id": "nas", "nom": "NAS", "composants": ["cpu1"]}]}
    d = dash.donnees_embarquees(cfg, HISTORY)
    assert [p["id"] for p in d["projets"]] == ["tour", "nas"]
    assert d["projets"][1]["composants"] == ["cpu1"]


# --- Echappement : le piege du JSON inline -------------------------------

def test_le_json_ne_peut_pas_fermer_la_balise():
    """Une chaine contenant </script> casserait la page en silence."""
    piege = {"series": [{"nom": "</script><script>alert(1)</script>"}]}
    rendu = dash._json_inline(piege)
    assert "</script>" not in rendu
    assert "<\\/script>" in rendu


def test_un_nom_de_composant_hostile_ne_casse_pas_la_page():
    cfg = {"components": [{"id": "x", "name": "</script>bidon",
                           "category": "GPU"}]}
    history = {"x": {"name": "</script>bidon", "category": "GPU", "entries": [
        {"date": _jour(2), "site": "a", "price": 10.0, "origin": "tracked"},
        {"date": _jour(1), "site": "a", "price": 9.0, "origin": "tracked"}]}}
    page = dash.build_dashboard(cfg, history)
    bloc = re.search(r'id="donnees-suivi">(.*?)</script>', page, re.S)
    assert bloc, "Le bloc de donnees doit rester intact"
    json.loads(bloc.group(1).replace("<\\/", "</"))


# --- L'explorateur s'ajoute, il ne remplace pas ---------------------------

def test_le_dashboard_statique_est_conserve(page):
    """Sans JS, la page doit rester celle de la v2.9 : complete et lisible."""
    assert "TOTAL AU MOINS CHER" in page
    assert "EVOLUTION DU TOTAL" in page
    assert "GPU 1" in page and "CPU 1" in page
    assert "<svg" in page, "Les SVG statiques restent"


def test_lexplorateur_est_present(page):
    assert 'id="explorateur"' in page
    assert 'id="courbe"' in page
    assert 'id="serieA"' in page and 'id="serieB"' in page
    assert 'data-zoom="30"' in page and 'data-zoom="0"' in page


def test_le_selecteur_de_fenetre_est_complet(page):
    """7 j / 30 j / 90 j / 1 an / tout (prompt 9.3)."""
    for jours in ("7", "30", "90", "365", "0"):
        assert f'data-zoom="{jours}"' in page, f"fenetre {jours} manquante"


def test_sans_donnee_pas_dexplorateur():
    page = dash.build_dashboard({"components": []}, {})
    assert 'id="explorateur"' not in page
    assert "<script>" not in page


def test_un_seul_bloc_de_script(page):
    """Un bloc JS et un bloc de donnees : rien d'autre."""
    assert page.count("<script>") == 1
    assert page.count('<script type="application/json"') == 1


# ===========================================================================
# Historique profond (prompt 9.3)
#
# Le compromis tient en une phrase : on ALLEGE L'AFFICHAGE, on ne perd pas
# d'information. Ces tests verrouillent les deux moities de cette phrase --
# le fichier doit rester leger quelle que soit la profondeur, ET les
# chiffres annonces doivent rester ceux de la donnee complete.
# ===========================================================================

def _serie_longue(jours, prix=None):
    """Un historique quotidien de `jours` jours, minimum au milieu."""
    entrees = []
    for k in range(jours):
        p = prix(k) if prix else (500.0 - (k % 50))
        entrees.append({"date": (date.today() - timedelta(days=jours - 1 - k)).isoformat(),
                        "site": "ldlc", "price": round(p, 2), "origin": "tracked"})
    return entrees


def _config_un(cid="gpu1"):
    return {"components": [{"id": cid, "name": "G", "category": "GPU"}]}


# --- La reduction : alleger sans mentir -----------------------------------

def test_reduire_ne_touche_pas_une_serie_courte():
    couples = [(f"j{i}", float(i)) for i in range(10)]
    gardes, reduit = dash.reduire(couples, 260, lambda c: c[0], lambda c: c[1])
    assert gardes == couples and reduit is False


@pytest.mark.parametrize("graine", range(12))
def test_reduire_preserve_toujours_les_extremes(graine):
    """La propriete essentielle : un echantillon qui raboterait les creux
    ferait disparaitre exactement les episodes que l'on cherche."""
    import random
    rnd = random.Random(graine)
    couples = [(f"{i:04d}", round(rnd.uniform(100, 900), 2)) for i in range(900)]
    gardes, reduit = dash.reduire(couples, 100, lambda c: c[0], lambda c: c[1])
    assert reduit is True
    valeurs = [v for _, v in gardes]
    assert min(valeurs) == min(v for _, v in couples)
    assert max(valeurs) == max(v for _, v in couples)


def test_reduire_garde_les_bornes_et_lordre():
    couples = [(f"{i:04d}", float(i % 37)) for i in range(700)]
    gardes, _ = dash.reduire(couples, 60, lambda c: c[0], lambda c: c[1])
    assert gardes[0] == couples[0] and gardes[-1] == couples[-1]
    assert [c[0] for c in gardes] == sorted(c[0] for c in gardes)
    assert len(gardes) <= 130, "La reduction doit vraiment reduire"


def test_reduire_ninvente_aucune_valeur():
    """Ni moyenne ni interpolation : uniquement des relevés reels."""
    couples = [(f"{i:04d}", float(i) * 1.7) for i in range(500)]
    gardes, _ = dash.reduire(couples, 40, lambda c: c[0], lambda c: c[1])
    assert set(gardes) <= set(couples)


# --- Les statistiques restent celles de la donnee complete ----------------

def test_le_plancher_annonce_est_celui_de_lhistorique_entier():
    creux = 800
    def prix(k):
        return 123.45 if k == creux else 500.0 + (k % 40)
    history = {"gpu1": {"entries": _serie_longue(1100, prix)}}
    d = dash.donnees_embarquees(_config_un(), history)
    st = d["series"][0]["stats"]
    assert st["min"] == 123.45
    assert st["n"] == 1100, "L'effectif compte les jours suivis, pas les points dessines"
    assert st["jour_min"] == (date.today() - timedelta(days=1100 - 1 - creux)).isoformat()


def test_le_plancher_survit_a_lechantillonnage():
    """Il est dans le fichier ET dans la courbe : on peut le montrer du doigt."""
    def prix(k):
        return 99.0 if k == 300 else 500.0
    history = {"gpu1": {"entries": _serie_longue(1000, prix)}}
    d = dash.donnees_embarquees(_config_un(), history)
    serie = d["series"][0]
    assert serie["echantillonne"] is True
    assert any(p["p"] == 99.0 for p in serie["points"])


def test_la_courbe_est_allegee_mais_pas_la_donnee():
    history = {"gpu1": {"entries": _serie_longue(1000)}}
    d = dash.donnees_embarquees(_config_un(), history)
    serie = d["series"][0]
    assert len(serie["points"]) <= d["points_max"] + 2
    assert serie["stats"]["n"] == 1000


def test_une_serie_courte_nest_pas_echantillonnee():
    history = {"gpu1": {"entries": _serie_longue(60)}}
    serie = dash.donnees_embarquees(_config_un(), history)["series"][0]
    assert serie["echantillonne"] is False
    assert len(serie["points"]) == 60
    assert "recents" not in serie, "Rien a dedoubler quand tout tient deja"


# --- Deux resolutions : zoomer doit rendre du detail ----------------------

def test_les_fenetres_courtes_gardent_le_jour_le_jour():
    """
    Un echantillon calcule sur trois ans laisse un point tous les quatre
    jours : sans seconde resolution, zoomer sur sept jours n'afficherait que
    deux points. C'est le defaut que ce test interdit.
    """
    history = {"gpu1": {"entries": _serie_longue(1100)}}
    d = dash.donnees_embarquees(_config_un(), history)
    serie = d["series"][0]
    assert "recents" in serie
    dates = [p["d"] for p in serie["recents"]]
    assert len(dates) == d["fine_jours"], "La periode recente est complete"
    assert dates == sorted(dates)
    # sept derniers jours reellement disponibles
    assert len([x for x in dates
                if x >= (date.today() - timedelta(days=6)).isoformat()]) == 7


def test_les_deux_resolutions_finissent_au_meme_jour():
    history = {"gpu1": {"entries": _serie_longue(1100)}}
    serie = dash.donnees_embarquees(_config_un(), history)["series"][0]
    assert serie["recents"][-1] == serie["points"][-1]


def test_la_serie_fine_ne_contient_que_des_points_reels():
    history = {"gpu1": {"entries": _serie_longue(900)}}
    serie = dash.donnees_embarquees(_config_un(), history)["series"][0]
    reels = {(e["date"], e["price"]) for e in history["gpu1"]["entries"]}
    assert all((p["d"], p["p"]) in reels for p in serie["recents"])


# --- Le poids ne doit pas suivre la profondeur ----------------------------

def _poids(annees, composants=3):
    cfg = {"components": [{"id": f"c{i}", "name": f"C{i}", "category": "GPU"}
                          for i in range(composants)]}
    jours = int(365 * annees)
    history = {f"c{i}": {"entries": _serie_longue(jours)} for i in range(composants)}
    return len(dash.build_dashboard(cfg, history).encode("utf-8"))


def test_le_poids_ne_croit_pas_avec_la_profondeur():
    """
    Critere du prompt 9.3 : sur plus d'un an, le fichier doit rester
    raisonnable. Il le reste parce que le nombre de points DESSINES est
    borne -- pas parce qu'on ampute l'historique.
    """
    un_an, cinq_ans = _poids(1), _poids(5)
    assert cinq_ans < 1_000_000, "Un dashboard de 5 ans doit rester joignable"
    assert cinq_ans < un_an * 1.35, (
        f"Le poids suit la profondeur : {un_an} -> {cinq_ans} octets")


def test_les_svg_statiques_aussi_sont_bornes():
    """La sparkline et l'histogramme du total suivaient la meme pente."""
    entrees = _serie_longue(1800)
    svg = dash.sparkline_svg(entrees)
    assert svg.count(",") < dash.SPARKLINE_MAX * 3
    totaux = {e["date"]: e["price"] for e in entrees}
    barres = dash.barres_total_svg(totaux)
    assert barres.count("<rect") <= dash.BARRES_MAX + 2
    assert "1800 jours resumes en" in barres


def test_lhistogramme_annonce_les_vrais_extremes():
    entrees = _serie_longue(1200, lambda k: 42.0 if k == 500 else 900.0)
    totaux = {e["date"]: e["price"] for e in entrees}
    barres = dash.barres_total_svg(totaux)
    assert "min 42 EUR" in barres and "max 900 EUR" in barres
    assert entrees[0]["date"] in barres and entrees[-1]["date"] in barres


def test_la_sparkline_pointe_le_vrai_minimum():
    entrees = _serie_longue(1000, lambda k: 11.0 if k == 400 else 500.0)
    svg = dash.sparkline_svg(entrees)
    # Le point vert du minimum doit exister : il serait perdu par un
    # echantillonnage naif un point sur N.
    assert 'fill="#1e8449"' in svg


# --- Le total par jour : optimise, mais a l'identique ---------------------

def test_totaux_par_jour_reste_fidele_a_la_definition():
    """
    Le calcul a ete rendu lineaire (il etait quadratique dans la profondeur).
    Ce test le confronte a la definition naive, celle qui n'a pas change :
    pour chaque jour, le dernier prix connu de chaque composant.
    """
    import random
    cfg = {"components": [
        {"id": "gpu1", "name": "G1", "category": "GPU", "slot": "GPU"},
        {"id": "gpu2", "name": "G2", "category": "GPU", "slot": "GPU"},
        {"id": "cpu1", "name": "C1", "category": "CPU"},
        {"id": "ram1", "name": "R1", "category": "RAM"},
    ]}
    for graine in range(40):
        rnd = random.Random(graine)
        history = {}
        for comp in cfg["components"]:
            if rnd.random() < 0.2:
                continue
            entrees = []
            for _ in range(rnd.randint(0, 20)):
                j = date(2026, 1, 1) + timedelta(days=rnd.randint(0, 60))
                entrees.append({"date": j.isoformat(), "site": "a",
                                "price": round(rnd.uniform(50, 900), 2)})
            entrees.sort(key=lambda e: e["date"])
            history[comp["id"]] = {"entries": entrees}

        # Definition naive, volontairement inefficace.
        slots = {}
        for c in cfg["components"]:
            if c.get("slot"):
                slots.setdefault(c["slot"], []).append(c["id"])
        def connu(cid, jour):
            """Prix retenu pour ce composant a cette date : le MOINS CHER de
            la derniere journee ou il a ete releve."""
            node = history.get(cid)
            if not node:
                return None
            jours = sorted({e["date"] for e in node["entries"]
                            if e["date"] <= jour})
            if not jours:
                return None
            return min(e["price"] for e in node["entries"]
                       if e["date"] == jours[-1])

        attendu = {}
        for jour in sorted({e["date"] for n in history.values()
                            for e in n["entries"]}):
            total, complet, vus = 0.0, True, set()
            for comp in cfg["components"]:
                prix = connu(comp["id"], jour)
                if prix is None:
                    continue
                if comp.get("slot"):
                    if comp["slot"] in vus:
                        continue
                    cands = [connu(cid, jour) for cid in slots[comp["slot"]]]
                    cands = [c for c in cands if c is not None]
                    if cands:
                        total += min(cands)
                        vus.add(comp["slot"])
                    else:
                        complet = False
                else:
                    total += prix
            if complet and total > 0:
                attendu[jour] = round(total, 2)

        assert dash.totaux_par_jour(history, cfg) == attendu, f"graine {graine}"


def test_le_total_retient_le_moins_cher_du_jour():
    """
    Le defaut trouve a la campagne de tests generale.

    Le total retenait le DERNIER releve de la journee en ordre de liste.
    L'ordre des vendeurs interroges n'ayant aucune raison d'etre
    significatif, le montant affiche dependait du hasard : un jour ou
    cdiscount proposait 121,45 EUR et ldlc 182,95 EUR, c'est 182,95 qui
    entrait dans le total. Le dashboard annoncait alors un total plus eleve
    que le rapport, sur exactement les memes donnees.
    """
    cfg = {"components": [{"id": "cpu", "name": "CPU", "category": "CPU"}]}
    history = {"cpu": {"entries": [
        {"date": _jour(1), "site": "cdiscount", "price": 121.45, "origin": "tracked"},
        {"date": _jour(1), "site": "ldlc", "price": 182.95, "origin": "tracked"},
    ]}}
    totaux = dash.totaux_par_jour(history, cfg)
    assert totaux[_jour(1)] == 121.45, (
        "le total doit retenir le prix le plus bas de la journee, comme "
        "partout ailleurs dans le projet")


def test_le_total_ne_depend_pas_de_lordre_des_vendeurs():
    """Meme journee, ordre inverse : le total ne doit pas bouger."""
    cfg = {"components": [{"id": "gpu", "name": "GPU", "category": "GPU"}]}
    prix = [("alternate", 429.0), ("compumsa", 472.9), ("cdiscount", 495.9)]
    resultats = []
    for ordre in (prix, list(reversed(prix))):
        history = {"gpu": {"entries": [
            {"date": _jour(2), "site": s, "price": p, "origin": "tracked"}
            for s, p in ordre]}}
        resultats.append(dash.totaux_par_jour(history, cfg)[_jour(2)])
    assert resultats[0] == resultats[1] == 429.0, resultats
