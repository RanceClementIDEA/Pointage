#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serveur.py -- interface web locale, alimentee en direct par la base.

CE QUE « TEMPS REEL » VEUT DIRE ICI, ET CE QU'IL NE VEUT PAS DIRE
-----------------------------------------------------------------
Les prix ne peuvent pas etre suivis en continu : la collecte s'impose un
delai de 2,5 s par domaine et un cycle complet dure quelques minutes. C'est
un choix assume (civisme reseau, prompt 8.3), pas une limite technique a
contourner. Interroger les marchands en boucle pour afficher un chiffre qui
bouge serait un abus, et la premiere consequence serait de se faire bloquer.

Ce qui est reellement en temps reel :

  * l'INTERFACE lit SQLite a chaque requete -- aucune regeneration de
    fichier, aucun cache. Un releve ecrit par un cycle en cours apparait au
    rafraichissement suivant, quelques secondes plus tard ;
  * une collecte peut etre LANCEE depuis la page, avec sa progression
    affichee ligne par ligne pendant qu'elle tourne ;
  * la page se rafraichit toute seule, donc un cycle declenche ailleurs
    (GitHub Actions, tache planifiee) s'y voit arriver.

Autrement dit : l'affichage est instantane, la collecte reste polie.

CE QUI NE CHANGE PAS
--------------------
  * le mail quotidien et l'alerte « occasion ultime » : inchanges ;
  * `dashboard.py` : toujours la, c'est lui qui produit le fichier autonome
    joint au mail, lisible hors ligne sans serveur.

Ce serveur est un CONFORT LOCAL en plus, il ne remplace rien.

Usage :
    python serveur.py                 # http://127.0.0.1:8765
    python serveur.py --port 9000
    python serveur.py --sans-navigateur

Aucune dependance : bibliotheque standard uniquement.
"""
import argparse
import json
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import price_tracker as pt                                   # noqa: E402
import dashboard as dash                                     # noqa: E402

try:
    import sqlite_store
except ImportError:                                          # pragma: no cover
    sqlite_store = None

PORT_DEFAUT = 8765

# Delai minimal entre deux collectes lancees a la main. Un bouton dans une
# page invite a cliquer ; sans garde-fou, on rejouerait un cycle complet
# toutes les dix secondes sur le dos des marchands. Le civisme ne se delegue
# pas a la discipline de l'utilisateur.
DELAI_MIN_COLLECTE = 600


# ---------------------------------------------------------------------------
# Etat courant, lu dans la base a chaque appel
# ---------------------------------------------------------------------------

def _serie(node, points_max=90):
    """Serie quotidienne d'un composant, allegee pour l'affichage."""
    par_jour = {}
    for e in node.get("entries", []):
        j = e["date"]
        if j not in par_jour or e["price"] < par_jour[j]:
            par_jour[j] = round(float(e["price"]), 2)
    complets = sorted(par_jour.items())
    if not complets:
        return []
    reduits, _ = dash.reduire(complets, points_max,
                              cle=lambda c: c[0], valeur=lambda c: c[1])
    return [{"d": j, "p": v} for j, v in reduits]


def _composant(r, node):
    a = r["analysis"]
    prix = [e["price"] for e in node.get("entries", [])]
    return {
        "id": r["id"], "nom": r["name"], "categorie": r["category"],
        "slot": r.get("slot"), "perf": r.get("perf_index"),
        "prix": a["current"], "vendeur": a["current_site"],
        "conseil": a["advice"], "score": a["score"],
        "confiance": a["confidence_label"],
        "jours_sans_verif": a["days_stale"], "perime": a["is_stale"],
        "plancher": min(prix) if prix else None,
        "plafond": max(prix) if prix else None,
        "n": len(prix),
        "plancher_connu": a["effective_low"],
        "prix_reve": a.get("dream_price"),
        "tendance": a["trend"], "tendance_pct": a["trend_pct"],
        "vs_plancher_pct": a["vs_low_pct"],
        "occasion_ultime": bool(a["is_ultimate"]),
        "bonne_affaire": bool(a["is_deal"]),
        "suspect": bool(a.get("prix_suspect")),
        "fausse_promo": bool(a.get("fausse_promo")),
        "raisons": a.get("reasons") or [],
        "note_saison": a.get("seasonal_note") or "",
        "meilleur_vendeur": (r.get("site_intel") or {}).get("best_site"),
        "serie": _serie(node),
    }


def _assurer_base():
    """Ouvre la base si ce n'est pas deja fait (appel direct sans `demarrer`)."""
    if sqlite_store and not sqlite_store.est_actif():
        sqlite_store.configure(BASE_DIR / "prices.db")


def construire_etat(config=None, history=None):
    """
    Photographie complete, batie a partir de la base A CET INSTANT.

    Aucun cache : c'est ce qui permet a un releve ecrit il y a trois secondes
    par un cycle en cours d'etre deja visible.
    """
    config = config or pt.load_config()
    if history is None:
        _assurer_base()
        history = (sqlite_store.charger_history() if sqlite_store
                   else pt.load_history(config))

    evenements = pt.evenements_produits(config)
    projets_actifs = [p for p in pt.projets_du_config(config)
                      if p.get("actif", True)]

    projets, total_global, ultimes_globaux = [], 0.0, []
    for projet in projets_actifs:
        achats = pt.charger_achats(config, projet["id"])
        analyse = pt.analyser_projet(config, projet, history, achats,
                                     None, evenements)
        if not analyse:
            continue
        plan = analyse["plan"]
        composants = [_composant(r, history.get(r["id"], {}))
                      for r in analyse["results"]]
        statut, message = plan["budget_status"]
        total_global += plan["total"]

        for u in plan["ultimes"]:
            ultimes_globaux.append({
                "projet": projet.get("nom") or projet["id"],
                "nom": u.get("name") or u.get("nom"),
                "prix": u.get("prix") if "prix" in u else u.get("price"),
            })

        projets.append({
            "id": projet["id"], "nom": projet.get("nom") or projet["id"],
            "budget": analyse["budget"],
            "total": round(plan["total"], 2),
            "total_au_plus_bas": round(plan["total_at_low"], 2),
            "economie_possible": round(plan["potential_saving"], 2),
            "strategie": plan["strategy"],
            "explication": plan["rationale"],
            "budget_statut": statut, "budget_message": message,
            "composants": composants,
            "sequence": plan.get("sequence") or {},
            "incompatibilites": analyse.get("compat") or [],
            "achetes": sorted(achats),
        })

    dernier = ""
    for node in history.values():
        for e in node.get("entries", []):
            if e["date"] > dernier:
                dernier = e["date"]
    jours = None
    if dernier:
        jours = (datetime.now().date()
                 - datetime.strptime(dernier, "%Y-%m-%d").date()).days

    return {
        "instant": datetime.now().isoformat(timespec="seconds"),
        "fraicheur": {"dernier_releve": dernier, "jours": jours},
        "collecte": collecteur.etat(),
        "projets": projets,
        "total_global": round(total_global, 2),
        "occasions_ultimes": ultimes_globaux,
        "vendeurs_actifs": sum(
            1 for v in (config.get("vendeurs") or {}).values()
            if isinstance(v, dict) and v.get("actif")),
    }


# ---------------------------------------------------------------------------
# Collecte lancee depuis la page
# ---------------------------------------------------------------------------

class Collecteur:
    """
    Lance `price_tracker.py` dans un sous-processus et diffuse sa sortie.

    Passer par le script plutot que d'appeler les fonctions dans le
    processus du serveur n'est pas un detour : cela reutilise TOUTES les
    garanties deja en place -- delai par domaine, plafond de vendeurs,
    budget de temps, cache conditionnel -- sans les redecrire ici, donc
    sans risque de les affaiblir par inadvertance.
    """

    def __init__(self):
        self.lignes = deque(maxlen=400)
        self.processus = None
        self.debut = None
        self.fin = None
        self.derniere = 0.0
        self.verrou = threading.Lock()

    def en_cours(self):
        return self.processus is not None and self.processus.poll() is None

    def etat(self):
        with self.verrou:
            attente = max(0, int(DELAI_MIN_COLLECTE - (time.time() - self.derniere))) \
                if self.derniere else 0
            return {
                "en_cours": self.en_cours(),
                "debut": self.debut,
                "fin": self.fin,
                "attente_avant_relance": attente,
                "lignes": list(self.lignes),
            }

    def lancer(self):
        with self.verrou:
            if self.en_cours():
                return False, "Une collecte est deja en cours."
            reste = DELAI_MIN_COLLECTE - (time.time() - self.derniere) \
                if self.derniere else 0
            if reste > 0:
                return False, (f"Trop tot : attendez {int(reste // 60)} min "
                               f"{int(reste % 60)} s. Interroger les marchands "
                               f"en boucle serait abusif.")
            self.lignes.clear()
            self.debut = datetime.now().isoformat(timespec="seconds")
            self.fin = None
            self.derniere = time.time()
            self.processus = subprocess.Popen(
                [sys.executable, "-u", "price_tracker.py", "--no-email"],
                cwd=str(BASE_DIR), stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace")
        threading.Thread(target=self._lire, daemon=True).start()
        return True, "Collecte lancee."

    def _lire(self):
        for ligne in self.processus.stdout:
            self.lignes.append(ligne.rstrip("\n"))
        self.processus.wait()
        self.fin = datetime.now().isoformat(timespec="seconds")
        self.lignes.append("")
        self.lignes.append("--- Collecte terminee ---")


collecteur = Collecteur()


# ---------------------------------------------------------------------------
# Serveur
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "SuiviPrixPC"

    def log_message(self, *args):                   # silence : la page suffit
        pass

    def _envoyer(self, code, corps, mime="application/json; charset=utf-8"):
        donnees = corps.encode("utf-8") if isinstance(corps, str) else corps
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(donnees)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(donnees)

    def do_GET(self):
        chemin = self.path.split("?")[0]
        if chemin in ("/", "/index.html"):
            return self._envoyer(200, PAGE, "text/html; charset=utf-8")
        if chemin == "/api/etat":
            try:
                etat = construire_etat()
            except Exception as e:                  # pragma: no cover
                return self._envoyer(500, json.dumps({"erreur": str(e)}))
            return self._envoyer(200, json.dumps(etat, ensure_ascii=False,
                                                 default=str))
        if chemin == "/api/collecte":
            return self._envoyer(200, json.dumps(collecteur.etat(),
                                                 ensure_ascii=False))
        return self._envoyer(404, json.dumps({"erreur": "inconnu"}))

    def do_POST(self):
        if self.path.split("?")[0] != "/api/collecte":
            return self._envoyer(404, json.dumps({"erreur": "inconnu"}))
        ok, message = collecteur.lancer()
        return self._envoyer(200 if ok else 429,
                             json.dumps({"ok": ok, "message": message},
                                        ensure_ascii=False))


def demarrer(port=PORT_DEFAUT, ouvrir=True):
    if sqlite_store:
        sqlite_store.configure(BASE_DIR / "prices.db")

    # Serveur MONO-THREAD, deliberement.
    #
    # Une connexion sqlite3 n'est utilisable que dans le thread qui l'a
    # ouverte. Avec un serveur multi-thread, chaque requete serait servie
    # ailleurs et la lecture echouerait -- silencieusement, car la couche de
    # donnees absorbe ses erreurs et rend un historique vide : la page se
    # serait affichee correctement, avec zero partout.
    #
    # Batir l'etat complet prend 2 ms. Il n'y a donc rien a gagner a
    # paralleliser, et un mode d'echec entier a s'epargner.
    #
    # 127.0.0.1 UNIQUEMENT : cette page expose vos budgets, vos objectifs de
    # prix et tout votre historique. Elle n'a rien a faire sur le reseau.
    serveur = HTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print("=" * 62)
    print("  SUIVI PRIX PC -- interface locale")
    print("=" * 62)
    print(f"\n  {url}\n")
    print("  Lecture directe de prices.db : tout cycle de collecte,")
    print("  d'ou qu'il vienne, apparait au rafraichissement suivant.")
    print("\n  Ctrl+C pour arreter.\n")
    if ouvrir:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\n  Arret.")
        serveur.shutdown()


PAGE = r"""<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suivi prix PC</title>
<style>
  :root{
    --fond:#f4f6f7; --carte:#fff; --texte:#2c3e50; --doux:#7f8c8d;
    --bord:#e5e8e8; --vert:#1e8449; --rouge:#c0392b; --orange:#b9770e;
    --violet:#8e44ad; --bleu:#2c3e50;
  }
  @media (prefers-color-scheme: dark){
    :root{ --fond:#15191c; --carte:#1e2429; --texte:#e6eaed; --doux:#8b979f;
           --bord:#2b3238; --bleu:#5dade2; }
  }
  *{box-sizing:border-box}
  body{margin:0;padding:16px;background:var(--fond);color:var(--texte);
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;}
  .page{max-width:1180px;margin:0 auto;}
  h1{font-size:21px;margin:0;}
  .rangee{display:flex;flex-wrap:wrap;gap:12px;align-items:center;}
  .carte{background:var(--carte);border:1px solid var(--bord);border-radius:10px;
         padding:15px;margin-bottom:13px;}
  .etiquette{font-size:10px;color:var(--doux);letter-spacing:1.1px;
             text-transform:uppercase;margin-bottom:9px;}
  .grille{display:grid;gap:11px;
          grid-template-columns:repeat(auto-fill,minmax(285px,1fr));}
  .badge{padding:2px 7px;border-radius:3px;font-size:10px;color:#fff;
         white-space:nowrap;}
  button{font-family:inherit;font-size:12px;padding:6px 13px;cursor:pointer;
         border:1px solid var(--bord);background:var(--carte);
         color:var(--texte);border-radius:6px;}
  button:hover:not(:disabled){border-color:var(--bleu);}
  button:disabled{opacity:.45;cursor:default;}
  .principal{background:var(--bleu);color:#fff;border-color:var(--bleu);}
  @media (prefers-color-scheme: dark){ .principal{color:#15191c;} }
  .pastille{width:8px;height:8px;border-radius:50%;display:inline-block;}
  pre{background:#11161a;color:#c8d6e0;padding:11px;border-radius:7px;
      font-size:11px;line-height:1.45;max-height:280px;overflow:auto;margin:0;
      white-space:pre-wrap;word-break:break-word;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  td,th{padding:5px 7px;text-align:left;border-bottom:1px solid var(--bord);}
  th{font-size:10px;color:var(--doux);text-transform:uppercase;
     letter-spacing:.7px;font-weight:600;}
  .num{text-align:right;font-variant-numeric:tabular-nums;}
  .doux{color:var(--doux);}
  a{color:inherit;}
</style>
</head><body>
<div class="page">

  <div class="rangee" style="justify-content:space-between;margin-bottom:13px;">
    <h1>Suivi prix PC</h1>
    <div class="rangee">
      <span id="fraicheur" class="doux" style="font-size:12px;"></span>
      <button id="collecter" class="principal">Lancer une collecte</button>
    </div>
  </div>

  <div id="alertes"></div>
  <div id="resume"></div>
  <div id="journal" style="display:none;" class="carte">
    <div class="etiquette">Collecte en cours</div>
    <pre id="journal-texte"></pre>
  </div>
  <div id="projets"></div>

  <p class="doux" style="font-size:10.5px;line-height:1.6;margin-top:18px;">
    Interface locale, lue directement dans <code>prices.db</code> : elle
    n'interroge aucun marchand d'elle-meme. La collecte respecte 2,5 s de
    delai par domaine et reste espacee de 10 minutes minimum &mdash;
    afficher un chiffre qui bouge ne vaut pas de se faire bloquer.
    Le mail quotidien et l'alerte &laquo;&nbsp;occasion ultime&nbsp;&raquo;
    fonctionnent comme avant, independamment de cette page.
  </p>
</div>

<script>
(function () {
  var E = document.getElementById.bind(document);
  var etat = null, minuteur = null;

  function euros(v) {
    return (v === null || v === undefined) ? "—" : Number(v).toFixed(2) + " EUR";
  }
  function esc(t) {
    return String(t === null || t === undefined ? "" : t)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var COULEURS = {
    "OCCASION ULTIME": "var(--rouge)", "ACHETER": "var(--vert)",
    "A VERIFIER": "var(--violet)", "ATTENDRE": "var(--orange)",
    "CORRECT": "var(--bleu)", "NEUTRE": "var(--doux)"
  };

  function courbe(serie, cible) {
    if (!serie || serie.length < 2) return "";
    var W = 260, H = 44, m = 3;
    var p = serie.map(function (x) { return x.p; });
    var bas = Math.min.apply(null, p), haut = Math.max.apply(null, p);
    var etendue = (haut - bas) || 1;
    var pts = serie.map(function (x, i) {
      var px = m + i * (W - 2 * m) / (serie.length - 1);
      var py = H - m - (x.p - bas) / etendue * (H - 2 * m);
      return px.toFixed(1) + "," + py.toFixed(1);
    }).join(" ");
    var ligne = "";
    if (cible && cible >= bas && cible <= haut) {
      var y = (H - m - (cible - bas) / etendue * (H - 2 * m)).toFixed(1);
      ligne = '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y +
              '" stroke="var(--rouge)" stroke-width="1" stroke-dasharray="3 3" opacity=".65"/>';
    }
    var d = serie[serie.length - 1];
    var cx = (W - m).toFixed(1);
    var cy = (H - m - (d.p - bas) / etendue * (H - 2 * m)).toFixed(1);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:44px;display:block;margin:7px 0;">'
      + ligne
      + '<polyline points="' + pts + '" fill="none" stroke="var(--bleu)" stroke-width="1.7" stroke-linejoin="round"/>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="2.6" fill="var(--bleu)"/></svg>';
  }

  function carteComposant(c) {
    var couleur = COULEURS[c.conseil] || "var(--doux)";
    var badges = '<span class="badge" style="background:' + couleur + '">'
               + esc(c.conseil) + "</span>";
    if (c.perime)
      badges += ' <span class="badge" style="background:var(--violet)">non verifie ' +
                c.jours_sans_verif + " j</span>";
    if (c.fausse_promo)
      badges += ' <span class="badge" style="background:var(--orange)">promo douteuse</span>';
    if (c.suspect)
      badges += ' <span class="badge" style="background:var(--rouge)">prix suspect</span>';

    var objectif = "";
    if (c.prix_reve) {
      var ecart = c.prix + 0 - c.prix_reve;
      objectif = '<div class="doux" style="font-size:11px;margin-top:3px;">Cible '
        + c.prix_reve.toFixed(0) + " EUR"
        + (ecart > 0 ? " — encore " + ecart.toFixed(2) + " EUR a baisser"
                     : " — <b style='color:var(--vert)'>atteinte</b>") + "</div>";
    }
    var fleche = c.tendance === "baisse" ? "▼" : (c.tendance === "hausse" ? "▲" : "▶");
    var ct = c.tendance === "baisse" ? "var(--vert)"
           : (c.tendance === "hausse" ? "var(--rouge)" : "var(--doux)");

    return '<div class="carte" style="margin:0;">'
      + '<div class="doux" style="font-size:10px;text-transform:uppercase;letter-spacing:1px;">'
      + esc(c.categorie) + (c.slot ? " · " + esc(c.slot) : "") + "</div>"
      + '<div style="font-size:13.5px;font-weight:600;margin:3px 0 7px;">' + esc(c.nom) + "</div>"
      + '<div class="rangee" style="align-items:baseline;gap:7px;">'
      +   '<span style="font-size:23px;font-weight:700;">' + Number(c.prix).toFixed(2) + "</span>"
      +   '<span class="doux" style="font-size:11.5px;">EUR chez ' + esc(c.vendeur) + "</span>"
      +   '<span style="margin-left:auto;color:' + ct + ';font-size:11.5px;">' + fleche + " "
      +   Math.abs(c.tendance_pct || 0).toFixed(1) + "%</span></div>"
      + '<div style="margin:5px 0 1px;">' + badges + "</div>"
      + courbe(c.serie, c.prix_reve)
      + '<div class="rangee doux" style="font-size:11px;justify-content:space-between;">'
      +   "<span>min " + Number(c.plancher).toFixed(2) + "</span>"
      +   "<span>" + c.n + " releves</span>"
      +   "<span>max " + Number(c.plafond).toFixed(2) + "</span></div>"
      + objectif + "</div>";
  }

  function sequence(seq) {
    if (!seq || (!(seq.maintenant || []).length && !(seq.plus_tard || []).length)) return "";
    function bloc(titre, lignes, couleur) {
      if (!lignes || !lignes.length) return "";
      return '<div style="flex:1 1 320px;"><div class="etiquette" style="color:' + couleur + '">'
        + titre + "</div><table>" + lignes.map(function (a) {
          var motif = (a.raisons_blocage && a.raisons_blocage.length)
            ? a.raisons_blocage[0]
            : (a.motif || "");
          return "<tr><td>" + esc(a.nom) + (motif ? '<br><span class="doux" style="font-size:10.5px;">'
                 + esc(motif) + "</span>" : "")
                 + '</td><td class="num">' + Number(a.prix).toFixed(2) + "</td></tr>";
        }).join("") + "</table></div>";
    }
    return '<div class="carte"><div class="rangee" style="align-items:flex-start;gap:22px;">'
      + bloc("A prendre maintenant", seq.maintenant, "var(--vert)")
      + bloc("A differer", seq.plus_tard, "var(--orange)")
      + "</div></div>";
  }

  function rendre() {
    if (!etat) return;

    var f = etat.fraicheur;
    E("fraicheur").textContent = f.dernier_releve
      ? "Dernier releve : " + f.dernier_releve +
        (f.jours === 0 ? " (aujourd'hui)" : " (il y a " + f.jours + " j)")
      : "Aucun releve";

    var u = etat.occasions_ultimes || [];
    E("alertes").innerHTML = u.length
      ? '<div class="carte" style="border-color:var(--rouge);border-width:2px;">'
        + '<div class="etiquette" style="color:var(--rouge)">Occasion ultime</div>'
        + u.map(function (o) {
            return '<div style="font-size:14px;font-weight:600;">' + esc(o.nom)
              + ' <span class="doux" style="font-weight:400;font-size:12px;">— '
              + esc(o.projet) + "</span>"
              + (o.prix ? ' <span style="color:var(--rouge)">' + euros(o.prix) + "</span>" : "")
              + "</div>";
          }).join("")
        + '<div class="doux" style="font-size:11px;margin-top:5px;">'
        + "Sous tout ce qui a ete observe jusqu'ici. Ce type de prix ne dure pas.</div></div>"
      : "";

    var p0 = (etat.projets || [])[0];
    E("resume").innerHTML = p0
      ? '<div class="carte"><div class="rangee" style="gap:30px;align-items:flex-end;">'
        + '<div><div class="etiquette">Total actuel</div>'
        + '<div style="font-size:30px;font-weight:700;">' + Number(etat.total_global).toFixed(2)
        + ' <span style="font-size:14px;font-weight:400;">EUR</span></div></div>'
        + '<div><div class="etiquette">Au plus bas connu</div><div style="font-size:17px;">'
        + Number(p0.total_au_plus_bas).toFixed(2) + "</div></div>"
        + '<div><div class="etiquette">Economie possible</div><div style="font-size:17px;color:var(--vert)">'
        + Number(p0.economie_possible).toFixed(2) + "</div></div>"
        + '<div style="flex:1 1 220px;"><div class="etiquette">Strategie</div>'
        + '<div style="font-size:14px;font-weight:600;">' + esc(p0.strategie) + "</div>"
        + '<div class="doux" style="font-size:11px;margin-top:2px;">' + esc(p0.budget_message)
        + "</div></div></div></div>"
      : '<div class="carte doux">Aucune donnee : lancez une collecte.</div>';

    E("projets").innerHTML = (etat.projets || []).map(function (p) {
      var incompat = (p.incompatibilites || []).length
        ? '<div class="carte" style="border-color:var(--rouge);"><div class="etiquette" '
          + 'style="color:var(--rouge)">Incompatibilites</div>'
          + p.incompatibilites.map(function (i) {
              return "<div>" + esc(i.message || i) + "</div>"; }).join("")
          + "</div>"
        : "";
      var entete = (etat.projets.length > 1)
        ? '<div class="etiquette" style="font-size:12px;letter-spacing:.5px;">'
          + esc(p.nom) + " — " + Number(p.total).toFixed(2) + " EUR</div>" : "";
      return entete + incompat + sequence(p.sequence)
        + '<div class="grille" style="margin-bottom:13px;">'
        + p.composants.map(carteComposant).join("") + "</div>";
    }).join("");

    var c = etat.collecte || {};
    var b = E("collecter");
    b.disabled = c.en_cours || c.attente_avant_relance > 0;
    b.textContent = c.en_cours ? "Collecte en cours…"
      : (c.attente_avant_relance > 0
          ? "Relance dans " + Math.ceil(c.attente_avant_relance / 60) + " min"
          : "Lancer une collecte");
    if (c.en_cours || (c.lignes || []).length) {
      E("journal").style.display = "";
      var t = E("journal-texte");
      t.textContent = (c.lignes || []).join("\n");
      t.scrollTop = t.scrollHeight;
    } else {
      E("journal").style.display = "none";
    }
  }

  function charger() {
    fetch("/api/etat", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { etat = d; rendre(); cadencer(); })
      .catch(function () { cadencer(); });
  }

  // Rafraichissement adaptatif : dense pendant une collecte, calme sinon.
  // Cette page ne parle qu'a votre machine -- la contrainte de politesse
  // porte sur les marchands, pas ici.
  function cadencer() {
    clearTimeout(minuteur);
    var enCours = etat && etat.collecte && etat.collecte.en_cours;
    minuteur = setTimeout(charger, enCours ? 1500 : 15000);
  }

  E("collecter").addEventListener("click", function () {
    E("collecter").disabled = true;
    fetch("/api/collecte", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) alert(d.message); charger(); })
      .catch(charger);
  });

  charger();
})();
</script>
</body></html>
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description="Interface web locale du suivi de prix")
    ap.add_argument("--port", type=int, default=PORT_DEFAUT)
    ap.add_argument("--sans-navigateur", action="store_true",
                    help="ne pas ouvrir le navigateur automatiquement")
    args = ap.parse_args(argv)
    demarrer(port=args.port, ouvrir=not args.sans_navigateur)


if __name__ == "__main__":
    main()
