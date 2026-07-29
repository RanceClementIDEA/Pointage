#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verifier_dashboard.py -- prouve que le dashboard est interactif HORS LIGNE.

Un test structurel peut verifier qu'aucune URL distante n'apparait dans le
fichier. Il ne peut pas prouver que la page FONCTIONNE. Ce script ouvre le
dashboard dans un vrai navigateur, avec toute requete sortante bloquee, et
verifie que l'exploration repond :

  1. chargement sans aucune requete externe ni erreur JavaScript ;
  2. la courbe est reellement dessinee ;
  3. le clic sur un point affiche son detail ;
  4. le zoom temporel (7 j / 30 j / tout) restreint la courbe ;
  5. la comparaison affiche bien deux series ;
  6. le resume annonce le plancher HISTORIQUE, meme quand il tombe hors de
     la fenetre affichee (prompt 9.3) -- c'est tout l'interet d'avoir
     abandonne la fenetre fixe de 90 jours.

Prerequis : pip install playwright (le navigateur est deja present).

Usage :
    python price_tracker.py --dry-run --no-email   # produire des donnees
    python dashboard.py                            # generer le fichier
    python verifier_dashboard.py [chemin/vers/dashboard.html]
"""
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
CHEMINS_NAVIGATEUR = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
]


def _plancher(texte):
    """Extrait le montant du plancher annonce dans le resume."""
    m = re.search(r"plancher\s+([\d.]+)\s*EUR", texte)
    return m.group(1) if m else None


def _navigateur(pw):
    for chemin in CHEMINS_NAVIGATEUR:
        if Path(chemin).exists():
            return pw.chromium.launch(executable_path=chemin)
    return pw.chromium.launch()          # installation standard de Playwright


def main():
    fichier = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "dashboard.html"
    if not fichier.exists():
        sys.exit(f"{fichier} absent. Lancez d'abord : python dashboard.py")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("playwright absent : pip install playwright")

    externes, erreurs = [], []
    print("=" * 66)
    print("  DASHBOARD HORS LIGNE : verification en navigateur reel")
    print("=" * 66)

    with sync_playwright() as pw:
        nav = _navigateur(pw)
        page = nav.new_page()

        # MODE AVION : rien ne sort, et on note toute tentative.
        def filtrer(route, requete):
            if requete.url.startswith("file://"):
                route.continue_()
            else:
                externes.append(requete.url)
                route.abort()

        page.route("**/*", filtrer)
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.goto(f"file://{fichier.resolve()}")
        page.wait_for_timeout(500)

        print(f"\n  1. Chargement : {len(externes)} requete(s) externe(s), "
              f"{len(erreurs)} erreur(s) JS")
        if externes:
            print(f"     -> {externes[:3]}")
        if erreurs:
            print(f"     -> {erreurs[:2]}")

        chemins = page.eval_on_selector_all("#courbe path", "e => e.length")
        points = page.eval_on_selector_all("#courbe circle", "e => e.length")
        print(f"  2. Courbe dessinee : {chemins} trace(s), {points} point(s)")

        avant = page.inner_text("#detail")
        clic_ok = False
        if points:
            # Sur une fenetre longue les pastilles se chevauchent : si le clic
            # reel est intercepte par une voisine, on le rejoue en force. Ce
            # qui est prouve reste le meme -- le gestionnaire repond.
            try:
                page.click("#courbe circle >> nth=0", timeout=3000)
            except Exception:
                page.click("#courbe circle >> nth=0", force=True)
            page.wait_for_timeout(150)
            apres = page.inner_text("#detail")
            clic_ok = (apres != avant and "EUR" in apres)
            print(f"  3. Detail au clic : {apres[:60]}")

        def fenetre(jours):
            """Applique une fenetre et retourne le nombre de points dessines."""
            bouton = page.query_selector(f"button[data-zoom='{jours}']")
            if not bouton or bouton.get_attribute("disabled") is not None:
                return None            # fenetre plus large que l'historique
            bouton.click()
            page.wait_for_timeout(150)
            return page.eval_on_selector_all("#courbe circle", "e => e.length")

        p7, p30 = fenetre(7), fenetre(30)
        ptout = fenetre(0)
        mesures = [(j, n) for j, n in ((7, p7), (30, p30), (0, ptout)) if n is not None]
        zoom_ok = all(a[1] <= b[1] for a, b in zip(mesures, mesures[1:]))
        print("  4. Zoom temporel : "
              + ", ".join(f"{'tout' if j == 0 else str(j) + ' j'} -> {n} point(s)"
                          for j, n in mesures))

        options = page.eval_on_selector_all("#serieB option", "e => e.map(o => o.value)")
        comp_ok = False
        if len(options) > 2:
            page.select_option("#serieB", options[2])
            page.wait_for_timeout(200)
            chemins2 = page.eval_on_selector_all("#courbe path", "e => e.length")
            comp_ok = chemins2 > chemins
            print(f"  5. Comparaison : {chemins2} trace(s) (etait {chemins})")
            page.select_option("#serieB", "")
            page.wait_for_timeout(150)

        # 6. Le plancher historique survit au zoom (prompt 9.3).
        resume_tout = page.inner_text("#resume")
        resume_ok = "plancher" in resume_tout.lower() and "EUR" in resume_tout
        hors_fenetre = None
        if p7 is not None:
            fenetre(7)
            resume_court = page.inner_text("#resume")
            # Meme reduit a sept jours, le resume doit citer le meme plancher.
            resume_ok = resume_ok and _plancher(resume_court) == _plancher(resume_tout)
            hors_fenetre = "hors de la fenetre" in resume_court
            fenetre(0)
        print(f"  6. Plancher historique dans le resume : {resume_tout[:78]}")
        if hors_fenetre is not None:
            print(f"     signale hors fenetre a 7 j : "
                  f"{'oui' if hors_fenetre else 'non (plancher recent)'}")

        nav.close()

    ok = (not externes and not erreurs and chemins >= 1 and points >= 1
          and clic_ok and zoom_ok and comp_ok and resume_ok)
    print()
    print("  >>> PLEINEMENT INTERACTIF HORS LIGNE :", "OUI" if ok else "NON")
    print("=" * 66)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
