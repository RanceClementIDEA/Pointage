# -*- coding: utf-8 -*-
"""Lance toutes les suites et resume."""
import subprocess, sys, re
SUITES = [("moteur (unitaire)", [sys.executable, "moteur_recherche.py", "--auto-test"]),
          ("composants reels",  [sys.executable, "test_reel.py"]),
          ("bout en bout",      [sys.executable, "test_e2e.py"]),
          ("integration",       [sys.executable, "test_integration.py"]),
          ("etat/lots/port",    [sys.executable, "test_v4.py"]),
          ("recherche groupee", [sys.executable, "test_groupe.py"]),
          ("devise/encodage/budget", [sys.executable, "test_v5.py"]),
          ("TVA/30j/credibilite", [sys.executable, "test_v6.py"]),
          ("catalogue europeen",  [sys.executable, "test_v7.py"])]
total_ok = total_ko = 0
for nom, cmd in SUITES:
    r = subprocess.run(cmd, capture_output=True, text=True)
    m = re.findall(r"(\d+)\s*(?:test\(s\)\s*)?reussis?[^\d]*(\d+)", r.stdout)
    p2 = re.search(r"(\d+)/(\d+) passes", r.stdout)
    m += re.findall(r"(\d+)/(\d+) controles passes", r.stdout)
    p2 = re.search(r"(\d+)/(\d+) passes", r.stdout)
    if p2:
        ok, ko = int(p2.group(1)), int(p2.group(2)) - int(p2.group(1))
    elif "controles passes" in r.stdout:
        a, b = re.search(r"(\d+)/(\d+) controles passes", r.stdout).groups()
        ok, ko = int(a), int(b) - int(a)
    elif m:
        ok, ko = int(m[0][0]), int(m[0][1])
    else:
        ok = ko = 0
    total_ok += ok; total_ko += ko
    etat = "OK" if ko == 0 and r.returncode == 0 else "ECHEC"
    print(f"  [{etat:5}] {nom:22} {ok:3} reussis, {ko} echecs")
print(f"\n  TOTAL : {total_ok} controles, {total_ko} echec(s)")
sys.exit(1 if total_ko else 0)
