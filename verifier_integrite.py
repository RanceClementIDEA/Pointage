#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verifier_deployeur.py -- prouve que le deployeur se comporte correctement.

Les tests de `tests/test_deployeur.py` sont structurels : ils lisent le code.
Ils ne peuvent pas prouver qu'un fichier `.env` pose dans le dossier
INTERROMPT reellement l'envoi. Ce script ouvre la page dans un vrai
navigateur, avec l'API GitHub simulee, et verifie :

  1. un dossier propre est accepte, workflows compris ;
  2. un `.env` present bloque tout -- et AUCUN appel reseau n'est emis ;
  3. l'envoi tient en un seul commit ;
  4. un depot inexistant est cree, en prive ;
  5. les erreurs frequentes sont expliquees en clair.

AUCUNE REQUETE NE PART VERS GITHUB : l'API est interceptee et simulee.

Prerequis : pip install playwright
Usage     : python verifier_deployeur.py
"""
import http.server
import json
import shutil
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

BASE = Path(__file__).resolve().parent
CHEMINS_NAVIGATEUR = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
]
PORT = 8899


def _navigateur(pw):
    for c in CHEMINS_NAVIGATEUR:
        if Path(c).exists():
            return pw.chromium.launch(executable_path=c)
    return pw.chromium.launch()


def _projet_factice(racine, avec_secret=False):
    """Un dossier ressemblant au projet, sans son poids."""
    (racine / ".github" / "workflows").mkdir(parents=True, exist_ok=True)
    (racine / "web").mkdir(exist_ok=True)
    (racine / "__pycache__").mkdir(exist_ok=True)
    (racine / "price_tracker.py").write_text("print(1)\n", encoding="utf-8")
    (racine / "config.json").write_text('{"a":1}\n', encoding="utf-8")
    (racine / "prices.db").write_bytes(b"SQLite")
    (racine / "requirements.txt").write_text("requests\n", encoding="utf-8")
    (racine / ".github/workflows/price-tracker.yml").write_text("name: x\n", encoding="utf-8")
    (racine / ".github/workflows/site.yml").write_text("name: y\n", encoding="utf-8")
    (racine / "web/index.html").write_text("<html>\n", encoding="utf-8")
    (racine / "web/data.json").write_text("{}\n", encoding="utf-8")
    (racine / "__pycache__/x.pyc").write_bytes(b"\x00")
    if avec_secret:
        (racine / ".env").write_text("EMAIL_APP_PASSWORD=secret\n", encoding="utf-8")
    return racine


def _api(appels, depot_existe=True, echec=None):
    def repondre(route, requete):
        u = requete.url.replace("https://api.github.com", "")
        appels.append(f"{requete.method} {u}")

        def j(d, s=200):
            route.fulfill(status=s, content_type="application/json",
                          body=json.dumps(d))

        if echec and echec[0] == "auth" and u == "/user":
            return j({"message": "Bad credentials"}, 401)
        if u == "/user":
            return j({"login": "essai"})
        if u.startswith("/repos/") and u.count("/") == 3:
            if not depot_existe:
                return j({"message": "Not Found"}, 404)
            return j({"full_name": "essai/PC", "private": True,
                      "default_branch": "main"})
        if u == "/user/repos":
            return j({"full_name": "essai/PC", "private": True,
                      "default_branch": "main"})
        if u.endswith("/git/ref/heads/main"):
            return j({"object": {"sha": "a" * 40}}) if depot_existe \
                else j({"message": "Not Found"}, 404)
        if u.endswith("/git/blobs"):
            if echec and echec[0] == "workflows":
                return j({"message": "refusing to allow a Personal Access Token "
                                     "to create or update workflow"}, 403)
            return j({"sha": "b" * 40})
        if u.endswith("/git/trees"):
            return j({"sha": "c" * 40})
        if u.endswith("/git/commits"):
            return j({"sha": "d" * 40})
        if "/git/refs" in u:
            return j({})
        if u.endswith("/pages"):
            return j({})
        return j({"message": "non simule"}, 404)
    return repondre


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("playwright absent : pip install playwright")

    tmp = Path(tempfile.mkdtemp(prefix="deployeur-"))
    propre = _projet_factice(tmp / "propre")
    sale = _projet_factice(tmp / "avec-secret", avec_secret=True)

    # Serveur local pour charger la page (file:// bride les modules).
    class Silencieux(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(BASE), **k)

        def log_message(self, *a):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Silencieux)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{PORT}/deployer.html"

    resultats = []
    print("=" * 66)
    print("  DEPLOYEUR : verification en navigateur reel")
    print("=" * 66)
    print("\n  (l'API GitHub est simulee : aucune requete ne sort)\n")

    with sync_playwright() as pw:
        nav = _navigateur(pw)

        # --- 1 & 3 : dossier propre, envoi complet -----------------------
        appels, erreurs = [], []
        page = nav.new_page()
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.route("https://api.github.com/**", _api(appels))
        page.goto(url)
        page.set_input_files("#dossier", str(propre))
        page.wait_for_timeout(600)
        apercu = " ".join(page.inner_text("#apercu").split())
        workflows_vus = ".github/workflows/price-tracker.yml" in apercu
        print(f"  1. Dossier propre : {apercu[:56]}")
        print(f"     workflows inclus : {'OUI' if workflows_vus else 'NON'}")
        page.fill("#jeton", "jeton-de-test")
        page.fill("#proprietaire", "essai")
        page.click("#envoyer")
        page.wait_for_timeout(2500)
        journal = page.inner_text("#journal")
        commits = sum(1 for a in appels if a.endswith("/git/commits"))
        arbres = sum(1 for a in appels if a.endswith("/git/trees"))
        print(f"  3. Envoi : {arbres} arbre, {commits} commit, "
              f"{sum(1 for a in appels if a.endswith('/git/blobs'))} fichiers")
        ok1 = (workflows_vus and not erreurs and "TERMINE" in journal
               and commits == 1 and arbres == 1)
        resultats.append(ok1)
        page.close()

        # --- 2 : un secret bloque tout -----------------------------------
        emis = []
        p2 = nav.new_page()
        p2.route("https://api.github.com/**",
                 lambda r, q: (emis.append(q.url), r.abort()))
        p2.goto(url)
        p2.set_input_files("#dossier", str(sale))
        p2.wait_for_timeout(600)
        bloque = p2.is_disabled("#envoyer")
        message = " ".join(p2.inner_text("#apercu").split())
        print(f"  2. Dossier avec .env : envoi {'BLOQUE' if bloque else 'AUTORISE'}, "
              f"{len(emis)} requete(s) emise(s)")
        print(f"     {message[:62]}")
        resultats.append(bloque and not emis and "sensible" in message.lower())
        p2.close()

        # --- 4 : depot inexistant ----------------------------------------
        appels4 = []
        p4 = nav.new_page()
        p4.route("https://api.github.com/**", _api(appels4, depot_existe=False))
        p4.goto(url)
        p4.set_input_files("#dossier", str(propre))
        p4.wait_for_timeout(400)
        p4.fill("#jeton", "x")
        p4.fill("#proprietaire", "essai")
        p4.click("#envoyer")
        p4.wait_for_timeout(2500)
        cree = any(a == "POST /user/repos" for a in appels4)
        j4 = p4.inner_text("#journal")
        print(f"  4. Depot inexistant : creation {'OUI' if cree else 'NON'}, "
              f"mention 'prive' {'OUI' if 'prive' in j4 else 'NON'}")
        resultats.append(cree and "prive" in j4)
        p4.close()

        # --- 5 : erreurs expliquees --------------------------------------
        lignes = []
        for cle, attendu, libelle in [
            ("auth", "Jeton invalide", "jeton invalide"),
            ("workflows", "Workflows: Read and write", "permission manquante"),
        ]:
            p5 = nav.new_page()
            p5.route("https://api.github.com/**", _api([], echec=(cle,)))
            p5.goto(url)
            p5.set_input_files("#dossier", str(propre))
            p5.wait_for_timeout(400)
            p5.fill("#jeton", "x")
            p5.fill("#proprietaire", "essai")
            p5.click("#envoyer")
            p5.wait_for_timeout(1800)
            texte = p5.inner_text("#journal")
            lignes.append(attendu in texte)
            print(f"  5. Erreur '{libelle}' expliquee : "
                  f"{'OUI' if attendu in texte else 'NON'}")
            p5.close()
        resultats.append(all(lignes))

        nav.close()

    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

    ok = all(resultats)
    print()
    print("  >>> DEPLOYEUR CONFORME :", "OUI" if ok else "NON")
    print("=" * 66)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
