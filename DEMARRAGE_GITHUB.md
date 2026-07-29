#!/usr/bin/env python3
"""
dashboard.py
============
Genere un tableau de bord HTML autonome a partir de l'historique.

Le fichier produit est ENTIEREMENT autonome : aucun script externe, aucune
police distante, aucun appel reseau. Les graphiques sont dessines en SVG
pur. Consequence : il s'ouvre partout, hors ligne, sans rien telecharger,
et ne peut declencher aucun blocage reseau ou alerte de securite.

Trois usages :
  1. Joint automatiquement a l'email quotidien (recommande) : vous l'ouvrez
     depuis votre messagerie, y compris sur un poste verrouille.
  2. Ouvert en local : python dashboard.py puis double-clic sur le fichier.
  3. Publie sur GitHub Pages (voir DASHBOARD.md pour les reserves
     de confidentialite : le site publie est public).
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Graphiques SVG (aucune bibliotheque, aucun CDN)
# ---------------------------------------------------------------------------

# Points dessines au maximum dans une sparkline de 260 px et dans
# l'histogramme du total (680 px). Au-dela, on empile des traits sur le meme
# pixel : le fichier grossit sans que rien de plus ne devienne visible.
SPARKLINE_MAX = 130
BARRES_MAX = 180


def reduire(elements, cible, cle, valeur):
    """
    Reduit une serie pour l'affichage, EN PRESERVANT LES EXTREMES.

    Un echantillonnage naif (un point sur N) rabote les pics et les creux :
    la courbe s'aplatit et l'on ne voit plus les episodes qui comptent. On
    decoupe donc la periode en tranches et, dans chacune, on garde le point
    le plus bas ET le plus haut, remis dans l'ordre chronologique. Le premier
    et le dernier element sont toujours conserves.

    Les valeurs affichees restent des valeurs REELLES : rien n'est moyenne ni
    interpole. Et parce que le minimum et le maximum globaux appartiennent
    forcement a une tranche, ils survivent toujours a la reduction.

    Retourne (elements_gardes, a_ete_reduit).
    """
    if len(elements) <= cible:
        return list(elements), False

    tranches = max(1, cible // 2)
    taille = len(elements) / tranches
    gardes, vus = [], set()

    def _ajouter(e):
        marque = (cle(e), valeur(e))
        if marque not in vus:
            vus.add(marque)
            gardes.append(e)

    _ajouter(elements[0])
    for i in range(tranches):
        lot = elements[int(i * taille):int((i + 1) * taille)]
        if not lot:
            continue
        bas = min(lot, key=valeur)
        haut = max(lot, key=valeur)
        for e in sorted({id(bas): bas, id(haut): haut}.values(), key=cle):
            _ajouter(e)
    _ajouter(elements[-1])

    gardes.sort(key=cle)
    return gardes, True


def sparkline_svg(entries, largeur=260, hauteur=64, couleur="#2c3e50"):
    """Courbe d'evolution compacte a partir des relevés d'un composant."""
    if len(entries) < 2:
        return ('<div style="color:#bbb;font-size:11px;padding:20px 0;">'
                'Pas assez de donnees pour tracer une courbe</div>')

    # Un point par jour : on garde le prix le plus bas de chaque journee.
    par_jour = {}
    for e in entries:
        d = e["date"]
        if d not in par_jour or e["price"] < par_jour[d]:
            par_jour[d] = e["price"]

    # Sur trois ans, 1095 points s'ecrasent sur 260 px : on reduit l'affichage
    # apres avoir releve les extremes, qui restent ceux de la donnee complete.
    complet = sorted(par_jour.items())
    pmin, pmax = min(v for _, v in complet), max(v for _, v in complet)
    couples, _ = reduire(complet, SPARKLINE_MAX,
                         cle=lambda c: c[0], valeur=lambda c: c[1])

    jours = [j for j, _ in couples]
    prix = [v for _, v in couples]

    etendue = (pmax - pmin) or 1
    marge = 6

    def x(i):
        return marge + i * (largeur - 2 * marge) / max(1, len(prix) - 1)

    def y(p):
        return hauteur - marge - (p - pmin) / etendue * (hauteur - 2 * marge)

    points = " ".join(f"{x(i):.1f},{y(p):.1f}" for i, p in enumerate(prix))
    aire = f"{marge},{hauteur - marge} {points} {x(len(prix) - 1):.1f},{hauteur - marge}"

    dernier_x, dernier_y = x(len(prix) - 1), y(prix[-1])
    # Le minimum global survit toujours a la reduction (il est le plus bas de
    # sa tranche) ; la seconde branche n'est qu'une ceinture de securite.
    idx_min = (prix.index(pmin) if pmin in prix
               else min(range(len(prix)), key=lambda i: prix[i]))

    return f"""
    <svg viewBox="0 0 {largeur} {hauteur}" width="100%" height="{hauteur}"
         preserveAspectRatio="none" style="display:block;">
      <polygon points="{aire}" fill="{couleur}" opacity="0.08"/>
      <polyline points="{points}" fill="none" stroke="{couleur}"
                stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="{x(idx_min):.1f}" cy="{y(pmin):.1f}" r="2.8" fill="#1e8449"/>
      <circle cx="{dernier_x:.1f}" cy="{dernier_y:.1f}" r="3.2" fill="{couleur}"/>
    </svg>"""


def barres_total_svg(totaux, largeur=680, hauteur=120):
    """Histogramme de l'evolution du total de la configuration."""
    if len(totaux) < 2:
        return ""

    complet = sorted(totaux.items())
    # Extremes et bornes releves sur la donnee COMPLETE : la legende doit dire
    # le vrai minimum, pas celui des barres qui ont survecu au dessin.
    vmin = min(v for _, v in complet)
    vmax = max(v for _, v in complet)
    premier, dernier = complet[0][0], complet[-1][0]
    etendue = (vmax - vmin) or 1

    # Au-dela de 180 jours, une barre ferait moins de 4 px : le graphique
    # devient un aplat gris. On reduit donc l'affichage en gardant, par
    # tranche, le total le plus bas et le plus haut.
    couples, reduit = reduire(complet, BARRES_MAX,
                              cle=lambda c: c[0], valeur=lambda c: c[1])

    n = len(couples)
    largeur_barre = max(2, (largeur - 20) / n - 2)
    barres = []
    for i, (jour, v) in enumerate(couples):
        h = 12 + (v - vmin) / etendue * (hauteur - 34)
        xx = 10 + i * ((largeur - 20) / n)
        couleur = "#1e8449" if v == vmin else ("#c0392b" if v == vmax else "#5d6d7e")
        barres.append(
            f'<rect x="{xx:.1f}" y="{hauteur - 18 - h:.1f}" '
            f'width="{largeur_barre:.1f}" height="{h:.1f}" fill="{couleur}" rx="1">'
            f'<title>{jour} : {v:.2f} EUR</title></rect>'
        )

    mention = (f' &middot; {len(complet)} jours resumes en {n} barres'
               if reduit else "")

    return f"""
    <svg viewBox="0 0 {largeur} {hauteur}" width="100%" height="{hauteur}"
         preserveAspectRatio="none" style="display:block;">
      {"".join(barres)}
      <line x1="10" y1="{hauteur - 18}" x2="{largeur - 10}" y2="{hauteur - 18}"
            stroke="#ddd" stroke-width="1"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#999;
                padding:2px 10px 0 10px;">
      <span>{premier}</span><span>min {vmin:.0f} EUR</span>
      <span>max {vmax:.0f} EUR</span><span>{dernier}{mention}</span>
    </div>"""


# ---------------------------------------------------------------------------
# Calculs
# ---------------------------------------------------------------------------

def totaux_par_jour(history, config):
    """Reconstitue le total de la config pour chaque journee de l'historique."""
    ids_slots = {}
    for c in config["components"]:
        if c.get("slot"):
            ids_slots.setdefault(c["slot"], []).append(c["id"])

    # Prix RETENU pour chaque composant et chaque journee : le MOINS CHER de
    # la journee, comme partout ailleurs dans le projet (cf. sparkline_svg,
    # donnees_embarquees).
    #
    # Auparavant, le dernier releve de la journee en ordre de liste ecrasait
    # les precedents. L'ordre des vendeurs interroges n'ayant aucune raison
    # d'etre significatif, le total affiche dependait du hasard : un jour ou
    # cdiscount proposait 121,45 EUR et ldlc 182,95 EUR, c'est 182,95 qui
    # entrait dans « TOTAL ACTUEL ». Le dashboard annoncait donc un total
    # plus eleve que le rapport, sur les memes donnees.
    par_jour = {}
    for cid, node in history.items():
        jours = {}
        for e in node.get("entries", []):
            j = e["date"]
            if j not in jours or e["price"] < jours[j]:
                jours[j] = e["price"]
        par_jour[cid] = jours

    toutes_dates = sorted({
        d for cid, jours in par_jour.items()
        if not cid.startswith("_") for d in jours
    })

    # Une seule passe en avant, en tenant a jour le dernier prix connu de
    # chaque composant, remplace le re-balayage integral de l'historique a
    # chaque journee. Le calcul etait quadratique dans la profondeur : depuis
    # que l'historique est complet (6.4), cela se payait en secondes.
    totaux = {}
    courant = {}
    for jour in toutes_dates:
        for cid, jours in par_jour.items():
            if jour in jours:
                courant[cid] = jours[jour]

        total, complet = 0.0, True
        deja_vus_slots = set()

        for comp in config["components"]:
            if comp["id"] not in courant:
                continue

            slot = comp.get("slot")
            if slot:
                # Pour un slot, on prend le moins cher parmi les candidats
                # connus a cette date (approximation raisonnable du "meilleur
                # achat du jour").
                if slot in deja_vus_slots:
                    continue
                candidats = [courant[cid] for cid in ids_slots[slot]
                             if cid in courant]
                if candidats:
                    total += min(candidats)
                    deja_vus_slots.add(slot)
                else:
                    complet = False
            else:
                total += courant[comp["id"]]

        if complet and total > 0:
            totaux[jour] = round(total, 2)
    return totaux


def stats_composant(node):
    entries = node.get("entries", [])
    if not entries:
        return None
    prix = [e["price"] for e in entries]
    dernier = entries[-1]
    jours_ecart = (datetime.now().date()
                   - datetime.strptime(dernier["date"], "%Y-%m-%d").date()).days
    return {
        "actuel": dernier["price"],
        "site": dernier["site"],
        "min": min(prix),
        "max": max(prix),
        "n": len(prix),
        "jours_ecart": jours_ecart,
        "date": dernier["date"],
    }


# ---------------------------------------------------------------------------
# Generation du tableau de bord
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Donnees embarquees + explorateur (Axe 6, prompt 9.1)
# ---------------------------------------------------------------------------

# Plus de fenetre glissante par defaut (prompt 9.3) : depuis l'abandon de la
# compaction destructive (6.4), l'historique est complet et c'est justement ce
# qu'on veut pouvoir explorer. `None` = tout l'historique disponible.
FENETRE_JOURS = None

# Points conserves PAR SERIE pour l'affichage. Un SVG de 900 px de large ne
# peut pas montrer davantage : au-dela, on alourdit le fichier sans rien
# rendre visible. Les statistiques, elles, restent calculees sur la donnee
# COMPLETE -- c'est la difference entre alleger l'affichage et perdre de
# l'information.
POINTS_AFFICHES_MAX = 260

# Un echantillon calcule une fois sur trois ans laisse un point tous les
# quatre jours : zoomer sur sept jours ne montrerait plus que deux points.
# On embarque donc DEUX resolutions -- la periode recente au jour le jour,
# l'historique entier echantillonne -- et l'explorateur choisit selon la
# fenetre demandee. Le surcout est borne (120 points par serie) alors que
# tout embarquer au jour le jour croitrait sans fin avec l'historique.
FENETRE_FINE_JOURS = 120


def echantillonner(points, cible=POINTS_AFFICHES_MAX):
    """
    Allege une serie de l'explorateur pour l'affichage (cf. `reduire`).

    Les points conserves restent des relevés REELS, avec leur date, leur
    vendeur et leur palier : le detail au clic dit toujours la verite.
    """
    return reduire(points, cible, cle=lambda p: p["d"], valeur=lambda p: p["p"])


def donnees_embarquees(config, history, fenetre_jours=FENETRE_JOURS,
                       points_max=POINTS_AFFICHES_MAX,
                       fine_jours=FENETRE_FINE_JOURS):
    """
    Prepare les series a embarquer dans le HTML.

    Depuis l'abandon de la compaction destructive (6.4), l'historique va
    au-dela des 90 jours d'autrefois : c'est precisement ce que cette vue
    doit rendre explorable. Par defaut, TOUT l'historique est embarque.

    Trois precautions pour que le fichier reste joignable a un email :
      * un point par jour (le moins cher), comme partout ailleurs ;
      * un echantillonnage a l'AFFICHAGE au-dela de `points_max` -- les
        statistiques (plancher, plafond, effectif) restant calculees sur la
        donnee complete ;
      * pour les series ainsi allegees, la periode recente (`fine_jours`)
        est embarquee EN PLUS au jour le jour, afin que les fenetres
        courtes gardent leur resolution.
    """
    limite = ((datetime.now().date() - timedelta(days=fenetre_jours)).isoformat()
              if fenetre_jours else "")

    # Perimetre par projet, pour la comparaison de projets.
    projets = []
    bruts = config.get("projets")
    if not bruts:
        p = config.get("projet") or {}
        bruts = [{k: v for k, v in p.items() if k != "_comment"}]
    for i, p in enumerate(bruts, start=1):
        if not isinstance(p, dict) or (len(p) == 1 and "_comment" in p):
            continue
        projets.append({
            "id": p.get("id") or f"projet-{i}",
            "nom": p.get("nom") or f"Projet {i}",
            "composants": p.get("composants"),
        })

    series = []
    for comp in config.get("components", []):
        node = history.get(comp["id"])
        if not node or not node.get("entries"):
            continue
        par_jour = {}
        for e in node["entries"]:
            if e["date"] < limite:
                continue
            jour = e["date"]
            if jour not in par_jour or e["price"] < par_jour[jour]["p"]:
                # `o` et `t` ne sont ecrits que lorsqu'ils apportent quelque
                # chose : sur plusieurs milliers de points, repeter la valeur
                # par defaut coute une centaine de kilo-octets pour rien.
                # L'explorateur lit deja leur absence comme le cas nominal.
                point = {"p": round(float(e["price"]), 2),
                         "s": e.get("site", "?")}
                origine = e.get("origin", "tracked")
                if origine and origine != "tracked":
                    point["o"] = origine
                if e.get("tier"):
                    point["t"] = e["tier"]
                par_jour[jour] = point
        if not par_jour:
            continue
        complets = [{"d": j, **v} for j, v in sorted(par_jour.items())]

        # Statistiques sur la donnee COMPLETE : ce sont elles qui font foi.
        # Un plancher calcule sur un echantillon serait faux, et c'est
        # justement le chiffre qu'on regarde en premier.
        prix = [p["p"] for p in complets]
        plus_bas = min(complets, key=lambda p: p["p"])
        stats = {
            "min": min(prix), "max": max(prix), "n": len(complets),
            "debut": complets[0]["d"], "fin": complets[-1]["d"],
            "jour_min": plus_bas["d"],
        }

        points, echantillonne = echantillonner(complets, points_max)
        ref = comp.get("reference") or {}
        serie = {
            "id": comp["id"], "nom": comp["name"],
            "categorie": comp.get("category", ""),
            "slot": comp.get("slot"),
            "reve": ref.get("prix_reve"),
            "stats": stats,
            "echantillonne": echantillonne,
            "points": points,
        }

        # Seconde resolution, uniquement quand la premiere a ete allegee :
        # sans cela on paierait deux fois pour la meme information.
        if echantillonne:
            debut_fin = (datetime.strptime(complets[-1]["d"], "%Y-%m-%d").date()
                         - timedelta(days=fine_jours - 1)).isoformat()
            recents = [p for p in complets if p["d"] >= debut_fin]
            if len(recents) > 1:
                serie["recents"] = recents

        series.append(serie)

    profondeur = 0
    if series:
        debuts = [s["stats"]["debut"] for s in series]
        fins = [s["stats"]["fin"] for s in series]
        profondeur = (datetime.strptime(max(fins), "%Y-%m-%d").date()
                      - datetime.strptime(min(debuts), "%Y-%m-%d").date()).days

    return {
        "genere": datetime.now().isoformat(timespec="seconds"),
        "fenetre_jours": fenetre_jours,
        "profondeur_jours": profondeur,
        "points_max": points_max,
        "fine_jours": fine_jours,
        "projets": projets or [{"id": "projet-1", "nom": "Projet 1",
                                "composants": None}],
        "series": series,
    }


def _json_inline(donnees):
    """
    Serialise pour insertion dans une balise <script>.

    `</` est echappe : sans cela, une chaine contenant `</script>` fermerait
    la balise prematurement et casserait la page.
    """
    return json.dumps(donnees, ensure_ascii=False, separators=(",", ":")) \
               .replace("</", "<\\/")


EXPLORATEUR_HTML = """
  <div style="background:#fff;border:1px solid #e5e8e8;border-radius:10px;
              padding:16px;margin-bottom:14px;" id="explorateur">
    <style>
      button.zoom{font-size:11px;padding:3px 9px;margin-left:3px;cursor:pointer;
                  border:1px solid #d5dbdb;background:#fff;color:#555;
                  border-radius:4px;font-family:inherit;}
      button.zoom[aria-pressed="true"]{background:#2c3e50;border-color:#2c3e50;
                                       color:#fff;}
      button.zoom[disabled]{opacity:.3;cursor:default;}
    </style>
    <div style="font-size:11px;color:#999;letter-spacing:1px;margin-bottom:10px;">
      EXPLORATEUR<span id="profondeur" style="letter-spacing:0;"></span>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;
                font-size:12px;margin-bottom:10px;">
      <label>Serie A
        <select id="serieA" style="font-size:12px;padding:3px;max-width:200px;"></select>
      </label>
      <label>comparer a
        <select id="serieB" style="font-size:12px;padding:3px;max-width:200px;">
          <option value="">— aucune —</option>
        </select>
      </label>
      <span style="margin-left:auto;">
        <button data-zoom="7"   class="zoom">7 j</button>
        <button data-zoom="30"  class="zoom">30 j</button>
        <button data-zoom="90"  class="zoom">90 j</button>
        <button data-zoom="365" class="zoom">1 an</button>
        <button data-zoom="0"   class="zoom">tout</button>
      </span>
    </div>

    <svg id="courbe" viewBox="0 0 900 300" style="width:100%;height:300px;"></svg>

    <div id="resume" style="font-size:11px;color:#666;margin-top:6px;
                            line-height:1.55;"></div>

    <div id="detail" style="font-size:12px;color:#555;min-height:34px;
                            margin-top:6px;padding:6px 8px;background:#f8f9f9;
                            border-radius:5px;">
      Cliquez un point de la courbe pour en voir le detail.
    </div>

    <p id="note-donnees" style="font-size:10px;color:#aaa;margin:8px 0 0 0;">
      Donnees embarquees dans ce fichier : aucune connexion n'est necessaire.
    </p>
  </div>
"""

# JavaScript volontairement minimal et sans dependance. C'est l'unique
# exception au principe « zero script » qui prevalait jusqu'en v2.9 : elle est
# assumee ici, parce que l'exploration (zoom, comparaison, detail au clic) ne
# peut pas se faire en SVG statique. Aucune requete, aucun CDN : tout ce dont
# ce code a besoin est deja dans le fichier.
EXPLORATEUR_JS = r"""
<script>
(function () {
  var noeud = document.getElementById("donnees-suivi");
  if (!noeud) return;
  var D;
  try { D = JSON.parse(noeud.textContent); } catch (e) { return; }
  if (!D.series || !D.series.length) return;

  var svg = document.getElementById("courbe");
  var detail = document.getElementById("detail");
  var resume = document.getElementById("resume");
  var selA = document.getElementById("serieA");
  var selB = document.getElementById("serieB");
  var zoom = 0;
  var COULEURS = ["#2c3e50", "#c0392b"];

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
  }

  D.series.forEach(function (s, i) {
    [selA, selB].forEach(function (sel) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.nom + " (" + s.categorie + ")";
      sel.appendChild(o);
    });
  });
  selA.selectedIndex = 0;

  function parJour(d) { return new Date(d + "T00:00:00").getTime(); }

  // La fenetre est ancree sur le dernier releve connu, PAS sur l'horloge du
  // navigateur. Un fichier archive puis rouvert trois semaines plus tard doit
  // encore montrer ses sept derniers jours de donnees, pas une page vide.
  var fin = Math.max.apply(null, D.series.map(function (s) {
    return parJour(s.stats.fin);
  }));

  // Deux resolutions cohabitent : la periode recente au jour le jour et
  // l'historique entier echantillonne. Un echantillon calcule sur trois ans
  // laisse un point tous les quatre jours -- inutilisable a sept jours. On
  // prend donc la serie fine des que la fenetre demandee tient dedans.
  function source(s) {
    if (zoom && s.recents && D.fine_jours && zoom <= D.fine_jours)
      return { pts: s.recents, allege: false };
    return { pts: s.points, allege: !!s.echantillonne };
  }

  function filtrer(points) {
    if (!zoom) return points;
    var limite = fin - (zoom - 1) * 86400000;
    var gardes = points.filter(function (p) { return parJour(p.d) >= limite; });
    return gardes.length >= 2 ? gardes : points.slice(-2);
  }

  function serie(id) {
    for (var i = 0; i < D.series.length; i++)
      if (D.series[i].id === id) return D.series[i];
    return null;
  }

  function el(nom, attrs, texte) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", nom);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (texte !== undefined) n.textContent = texte;
    return n;
  }

  function dessiner() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var choisies = [];
    [selA.value, selB.value].forEach(function (id) {
      var s = id && serie(id);
      if (!s) return;
      var src = source(s);
      choisies.push({ s: s, pts: filtrer(src.pts), allege: src.allege });
    });
    if (!choisies.length) return;

    var W = 900, H = 300, mg = { g: 52, d: 12, h: 14, b: 30 };
    var tous = [].concat.apply([], choisies.map(function (c) { return c.pts; }));
    var prix = tous.map(function (p) { return p.p; });
    var dates = tous.map(function (p) { return parJour(p.d); });
    var pmin = Math.min.apply(null, prix), pmax = Math.max.apply(null, prix);
    var tmin = Math.min.apply(null, dates), tmax = Math.max.apply(null, dates);
    if (pmax === pmin) { pmax += 1; pmin -= 1; }
    if (tmax === tmin) { tmax += 86400000; }

    var X = function (t) { return mg.g + (t - tmin) / (tmax - tmin) * (W - mg.g - mg.d); };
    var Y = function (p) { return mg.h + (pmax - p) / (pmax - pmin) * (H - mg.h - mg.b); };

    // Grille et axe des prix
    for (var i = 0; i <= 4; i++) {
      var v = pmin + (pmax - pmin) * i / 4, y = Y(v);
      svg.appendChild(el("line", { x1: mg.g, y1: y, x2: W - mg.d, y2: y,
                                   stroke: "#eee", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: mg.g - 6, y: y + 4, "text-anchor": "end",
                                   "font-size": 10, fill: "#999" },
                         v.toFixed(0)));
    }

    choisies.forEach(function (c, idx) {
      var couleur = COULEURS[idx % COULEURS.length];
      var d = c.pts.map(function (p, i) {
        return (i ? "L" : "M") + X(parJour(p.d)).toFixed(1) + " " + Y(p.p).toFixed(1);
      }).join(" ");
      svg.appendChild(el("path", { d: d, fill: "none", stroke: couleur,
                                   "stroke-width": 2 }));

      // Un point par releve devient illisible sur une fenetre longue : au-dela
      // de ce seuil on ne dessine que le trace, et le detail au clic passe par
      // le point le plus proche (voir plus bas).
      var pastilles = c.pts.length <= 120;
      c.pts.forEach(function (p) {
        var cx = X(parJour(p.d)), cy = Y(p.p);
        var pt = el("circle", { cx: cx, cy: cy, r: pastilles ? 4 : 3,
                                fill: couleur,
                                "fill-opacity": pastilles ? 0.85 : 0,
                                cursor: "pointer" });
        pt.addEventListener("click", function () {
          detail.innerHTML = "<b>" + esc(c.s.nom) + "</b> — " + p.d +
            " : <b>" + p.p.toFixed(2) + " EUR</b> chez " + esc(p.s) +
            (p.t ? " <span style='color:#888'>(palier " + esc(p.t) + ")</span>" : "") +
            (p.o && p.o !== "tracked" ? " <span style='color:#888'>[" + esc(p.o) + "]</span>" : "");
        });
        svg.appendChild(pt);
      });

      // Repere du plancher historique lorsqu'il tombe dans la fenetre. C'est
      // le chiffre que l'on cherche en premier : autant le montrer sur la
      // courbe plutot que de laisser l'oeil le deviner.
      var plancher = null;
      for (var k = 0; k < c.pts.length; k++)
        if (c.pts[k].d === c.s.stats.jour_min) plancher = c.pts[k];
      if (plancher) {
        var px = X(parJour(plancher.d)), py = Y(plancher.p);
        svg.appendChild(el("circle", { cx: px, cy: py, r: 6, fill: "none",
                                       stroke: couleur, "stroke-width": 1.5 }));
        svg.appendChild(el("text", { x: px, y: py + 15 <= H - 12 ? py + 15 : py - 10,
                                     "text-anchor": "middle", "font-size": 9,
                                     fill: couleur }, "plancher"));
      }

      // Reperes de debut et de fin
      var der = c.pts[c.pts.length - 1];
      svg.appendChild(el("text", { x: W - mg.d, y: Y(der.p) - 8, "text-anchor": "end",
                                   "font-size": 11, fill: couleur, "font-weight": 600 },
                         c.s.nom + " " + der.p.toFixed(2)));
    });

    // Axe des dates
    var premier = choisies[0].pts[0], dernier = choisies[0].pts[choisies[0].pts.length - 1];
    svg.appendChild(el("text", { x: mg.g, y: H - 8, "font-size": 10, fill: "#999" },
                       premier.d));
    svg.appendChild(el("text", { x: W - mg.d, y: H - 8, "text-anchor": "end",
                                 "font-size": 10, fill: "#999" }, dernier.d));

    resumer(choisies);
    marquerActif();
  }

  /*
   * Sous la courbe : ce que la fenetre affichee ne dit pas.
   *
   * Les chiffres viennent tous de `stats`, calcule cote Python sur la donnee
   * COMPLETE. Un plancher lu sur la courbe visible serait le plancher des 30
   * derniers jours, ce qui n'est pas la meme information -- et c'est
   * exactement le piege qu'une fenetre fixe de 90 jours tendait jusqu'ici.
   */
  function resumer(choisies) {
    resume.innerHTML = choisies.map(function (c, idx) {
      var st = c.s.stats, couleur = COULEURS[idx % COULEURS.length];
      var bord = c.pts.length ? parJour(c.pts[0].d) : fin;
      var txt = '<span style="color:' + couleur + ';font-weight:600;">'
              + esc(c.s.nom) + "</span> — plancher <b>" + st.min.toFixed(2)
              + " EUR</b> le " + st.jour_min
              + (parJour(st.jour_min) < bord
                   ? ' <span style="color:#c0392b;">(hors de la fenetre'
                     + " affichee)</span>" : "")
              + " · plafond " + st.max.toFixed(2) + " EUR · " + st.n
              + " jours suivis, du " + st.debut + " au " + st.fin;
      if (c.allege)
        txt += ' <span style="color:#999;">· courbe allegee a '
             + c.s.points.length + " points (zoomez pour le detail au jour"
             + " le jour)</span>";
      return txt;
    }).join("<br>");
  }

  var profondeur = D.profondeur_jours || 0;
  var etiquette = document.getElementById("profondeur");
  if (etiquette && profondeur)
    etiquette.textContent = " · " + profondeur + " jours d'historique embarques";

  var boutons = Array.prototype.slice.call(
    document.querySelectorAll("button.zoom"));

  function marquerActif() {
    boutons.forEach(function (b) {
      b.setAttribute("aria-pressed",
        parseInt(b.getAttribute("data-zoom"), 10) === zoom ? "true" : "false");
    });
  }

  boutons.forEach(function (b) {
    var v = parseInt(b.getAttribute("data-zoom"), 10);
    // Proposer une fenetre plus large que l'historique disponible n'apporte
    // rien : elle donnerait exactement la meme courbe que « tout ».
    if (v && profondeur && v > profondeur) b.setAttribute("disabled", "disabled");
    b.addEventListener("click", function () {
      if (b.hasAttribute("disabled")) return;
      zoom = v;
      dessiner();
    });
  });

  var note = document.getElementById("note-donnees");
  if (note) {
    var allegees = D.series.filter(function (s) { return s.echantillonne; }).length;
    var jours = D.series.reduce(function (n, s) { return n + s.stats.n; }, 0);
    note.textContent = "Donnees embarquees dans ce fichier : " + jours
      + " jours de prix, aucune connexion n'est necessaire."
      + (allegees ? " " + allegees + " courbe" + (allegees > 1 ? "s sont allegees"
                                                              : " est allegee")
                  + " a l'affichage ; plancher, plafond et effectifs restent"
                  + " calcules sur la donnee complete." : "");
  }

  selA.addEventListener("change", dessiner);
  selB.addEventListener("change", dessiner);

  dessiner();
})();
</script>
"""


def build_dashboard(config, history):
    maintenant = datetime.now().strftime("%d/%m/%Y a %H:%M")
    totaux = totaux_par_jour(history, config)
    total_actuel = list(totaux.values())[-1] if totaux else 0
    total_min = min(totaux.values()) if totaux else 0

    budget = config.get("budget", {})
    cible = budget.get("target_total")
    plafond = budget.get("max_total")

    if cible and total_actuel <= cible:
        couleur_budget, texte_budget = "#1e8449", f"sous l'objectif de {cible} EUR"
    elif plafond and total_actuel <= plafond:
        couleur_budget = "#b9770e"
        texte_budget = f"au-dessus de l'objectif ({cible} EUR), sous le plafond"
    else:
        couleur_budget, texte_budget = "#c0392b", "au-dessus du plafond"

    # --- Cartes composants ---
    cartes = []
    for comp in sorted(config["components"], key=lambda c: c["category"]):
        node = history.get(comp["id"])
        if not node:
            continue
        st = stats_composant(node)
        if not st:
            continue

        ref = comp.get("reference") or {}
        reve = ref.get("prix_reve")

        # Position dans la fourchette : 100% = au plus bas connu
        etendue = (st["max"] - st["min"]) or 1
        position = max(0, min(100, (st["max"] - st["actuel"]) / etendue * 100))

        if st["jours_ecart"] > 7:
            badge = (f'<span style="background:#8e44ad;color:#fff;padding:1px 6px;'
                     f'border-radius:3px;font-size:10px;">non verifie {st["jours_ecart"]}j</span>')
        elif reve and st["actuel"] <= reve:
            badge = ('<span style="background:#c0392b;color:#fff;padding:1px 6px;'
                     'border-radius:3px;font-size:10px;">PRIX CIBLE ATTEINT</span>')
        elif st["actuel"] <= st["min"] * 1.03:
            badge = ('<span style="background:#1e8449;color:#fff;padding:1px 6px;'
                     'border-radius:3px;font-size:10px;">au plus bas</span>')
        else:
            badge = ""

        objectif = ""
        if reve:
            ecart = st["actuel"] - reve
            if ecart > 0:
                objectif = (f'<div style="font-size:11px;color:#888;margin-top:4px;">'
                            f'Cible {reve:.0f} EUR &mdash; encore {ecart:.2f} EUR a baisser</div>')

        slot_tag = ""
        if comp.get("slot"):
            slot_tag = (f'<span style="background:#eaeded;color:#555;padding:1px 6px;'
                        f'border-radius:3px;font-size:10px;margin-left:4px;">'
                        f'{comp["slot"]} &middot; perf {comp.get("perf_index", "?")}</span>')

        cartes.append(f"""
        <div style="background:#fff;border:1px solid #e5e8e8;border-radius:8px;
                    padding:14px;flex:1 1 300px;min-width:280px;">
          <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;">
            {comp['category']}{slot_tag}
          </div>
          <div style="font-size:14px;font-weight:600;margin:3px 0 6px 0;">{comp['name']}</div>
          <div style="display:flex;align-items:baseline;gap:8px;">
            <span style="font-size:24px;font-weight:700;">{st['actuel']:.2f}</span>
            <span style="font-size:12px;color:#888;">EUR chez {st['site']}</span>
          </div>
          <div style="margin:2px 0 6px 0;">{badge}</div>
          {sparkline_svg(node['entries'])}
          <div style="display:flex;justify-content:space-between;font-size:11px;
                      color:#888;margin-top:4px;">
            <span>min {st['min']:.2f}</span>
            <span>{st['n']} releves</span>
            <span>max {st['max']:.2f}</span>
          </div>
          <div style="background:#eee;height:5px;border-radius:3px;margin-top:8px;">
            <div style="background:#1e8449;height:5px;border-radius:3px;width:{position:.0f}%;"></div>
          </div>
          {objectif}
        </div>""")

    graphique_total = barres_total_svg(totaux) if len(totaux) > 1 else (
        '<div style="color:#bbb;font-size:12px;padding:16px 0;text-align:center;">'
        'L\'evolution du total apparaitra apres quelques jours de suivi.</div>')

    # --- Axe 6 : donnees embarquees + explorateur ---
    # Le dashboard statique ci-dessus est CONSERVE tel quel : si le script est
    # bloque (messagerie stricte, JS desactive), la page reste celle de la
    # v2.9, complete et lisible. L'explorateur s'ajoute, il ne remplace pas.
    donnees = donnees_embarquees(config, history)
    bloc_donnees = (f'<script type="application/json" id="donnees-suivi">'
                    f'{_json_inline(donnees)}</script>')
    explorateur = EXPLORATEUR_HTML if donnees["series"] else ""

    return f"""<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suivi prix PC</title>
</head>
<body style="margin:0;padding:16px;background:#f4f6f7;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
             color:#2c3e50;">
<div style="max-width:1000px;margin:0 auto;">

  <div style="display:flex;justify-content:space-between;align-items:baseline;
              flex-wrap:wrap;gap:8px;">
    <h1 style="margin:0;font-size:22px;">Suivi prix PC</h1>
    <span style="font-size:12px;color:#999;">Mis a jour le {maintenant}</span>
  </div>

  <div style="background:#2c3e50;color:#fff;border-radius:10px;padding:20px;margin:14px 0;">
    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;">
      <div>
        <div style="font-size:11px;opacity:0.65;letter-spacing:1px;">TOTAL AU MOINS CHER</div>
        <div style="font-size:34px;font-weight:700;line-height:1.1;">{total_actuel:.2f} EUR</div>
        <div style="font-size:12px;color:{'#7dcea0' if couleur_budget == '#1e8449' else '#f5b041'};">
          {texte_budget}
        </div>
        <div style="font-size:10px;opacity:0.55;margin-top:4px;max-width:230px;line-height:1.4;">
          Option la moins chere de chaque emplacement. Le rapport, lui,
          totalise les composants qu'il RETIENT &mdash; les deux montants
          peuvent differer.
        </div>
      </div>
      <div>
        <div style="font-size:11px;opacity:0.65;letter-spacing:1px;">MEILLEUR TOTAL VU</div>
        <div style="font-size:22px;font-weight:600;">{total_min:.2f} EUR</div>
      </div>
      <div>
        <div style="font-size:11px;opacity:0.65;letter-spacing:1px;">ECART</div>
        <div style="font-size:22px;font-weight:600;">
          {total_actuel - total_min:+.2f} EUR
        </div>
      </div>
    </div>
  </div>

  <div style="background:#fff;border:1px solid #e5e8e8;border-radius:10px;
              padding:16px;margin-bottom:14px;">
    <div style="font-size:11px;color:#999;letter-spacing:1px;margin-bottom:8px;">
      EVOLUTION DU TOTAL
    </div>
    {graphique_total}
  </div>

  {explorateur}

  <div style="display:flex;flex-wrap:wrap;gap:12px;">
    {"".join(cartes)}
  </div>

  <p style="font-size:11px;color:#aaa;margin-top:20px;line-height:1.6;">
    Le point vert sur chaque courbe marque le prix le plus bas observe.
    La barre de progression indique la position du prix actuel dans sa
    fourchette historique (pleine = au plus bas). Les prix marques
    &laquo;&nbsp;non verifie&nbsp;&raquo; proviennent de l'historique importe
    et doivent etre reconfirmes sur le site marchand avant tout achat.
  </p>

</div>
{bloc_donnees}
{EXPLORATEUR_JS if donnees["series"] else ""}
</body></html>"""


def main():
    config_path = BASE_DIR / "config.json"
    if not config_path.exists():
        sys.exit("config.json introuvable.")
    config = json.loads(config_path.read_text(encoding="utf-8"))

    # Depuis la bascule 6.4, SQLite est la source de verite. On lit la base ;
    # history.json ne sert plus que de repli (export de secours).
    history = {}
    try:
        import sqlite_store
        sqlite_store.configure(BASE_DIR / config.get("sqlite_file", "prices.db"))
        history = sqlite_store.charger_history(config)
    except Exception:
        history = {}

    if not history:
        history_path = BASE_DIR / config.get("history_file", "history.json")
        if not history_path.exists():
            sys.exit("Aucun historique. Lancez d'abord une verification de prix.")
        history = json.loads(history_path.read_text(encoding="utf-8"))

    html = build_dashboard(config, history)

    sortie = BASE_DIR / "dashboard.html"
    sortie.write_text(html, encoding="utf-8")
    print(f"Tableau de bord genere : {sortie}")

    # Copie pour GitHub Pages (voir DASHBOARD.md avant de publier)
    docs = BASE_DIR / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "index.html").write_text(html, encoding="utf-8")
    print(f"Copie GitHub Pages   : {docs / 'index.html'}")


if __name__ == "__main__":
    main()
