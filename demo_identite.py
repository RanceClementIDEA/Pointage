#!/usr/bin/env python3
"""
demarrer.py
===========
Lanceur tout-en-un du suivi de prix PC.

Aucune commande a retenir : ce fichier ouvre un menu.
Sur Windows, double-cliquez sur "lancer.bat".
Sur Mac, double-cliquez sur "lancer.command".
Sur Linux, lancez "./lancer.sh".

Il s'occupe aussi :
  * d'installer les dependances Python manquantes,
  * de configurer l'email pas a pas (avec test d'envoi),
  * d'installer la tache quotidienne automatique (cron / Planificateur Windows).
"""

import json
import os
import platform
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# On se place toujours dans le dossier du script : indispensable quand
# l'utilisateur double-clique depuis l'explorateur de fichiers.
BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

CONFIG_PATH = BASE_DIR / "config.json"
ENV_PATH = BASE_DIR / ".env"
TRACKER = BASE_DIR / "price_tracker.py"

IS_WINDOWS = platform.system() == "Windows"


# ---------------------------------------------------------------------------
# Affichage
# ---------------------------------------------------------------------------

def clear():
    os.system("cls" if IS_WINDOWS else "clear")


def title(text):
    print()
    print("=" * 62)
    print(f"  {text}")
    print("=" * 62)
    print()


def pause():
    try:
        input("\n  Appuyez sur Entree pour revenir au menu...")
    except EOFError:
        pass


def ask(question, default=None):
    suffix = f" [{default}]" if default else ""
    try:
        answer = input(f"  {question}{suffix} : ").strip()
    except EOFError:
        return default or ""
    return answer or default or ""


def confirm(question):
    try:
        return input(f"  {question} (o/n) : ").strip().lower() in ("o", "oui", "y", "yes")
    except EOFError:
        return False


# ---------------------------------------------------------------------------
# Dependances
# ---------------------------------------------------------------------------

def check_dependencies(auto_install=True):
    """Verifie que les bibliotheques necessaires sont presentes, propose
    de les installer sinon."""
    required = {"requests": "requests", "bs4": "beautifulsoup4", "dotenv": "python-dotenv"}
    missing = []
    for module, package in required.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)

    if not missing:
        return True

    print(f"  Bibliotheques manquantes : {', '.join(missing)}")
    if not auto_install or not confirm("Les installer maintenant ?"):
        print("\n  Installation manuelle : pip install -r requirements.txt")
        return False

    print("\n  Installation en cours...\n")
    cmd = [sys.executable, "-m", "pip", "install", *missing]
    # Sur les Python systeme recents (Debian/Ubuntu), pip refuse d'installer
    # sans ce drapeau.
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 and "externally-managed-environment" in result.stderr:
        result = subprocess.run([*cmd, "--break-system-packages"],
                                capture_output=True, text=True)

    if result.returncode == 0:
        print("  Installation reussie.\n")
        return True

    print(f"  Echec de l'installation :\n{result.stderr[:500]}")
    print("\n  Essayez manuellement : pip install -r requirements.txt")
    return False


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def email_is_configured():
    if not ENV_PATH.exists():
        return False
    try:
        cfg = load_config()
    except Exception:
        return False
    sender = cfg.get("email", {}).get("sender_email", "")
    content = ENV_PATH.read_text(encoding="utf-8")
    return ("VOTRE_ADRESSE" not in sender
            and "votre_mot_de_passe" not in content
            and "EMAIL_APP_PASSWORD=" in content)


def urls_needing_setup():
    """Liste les composants dont l'URL est encore un placeholder."""
    try:
        cfg = load_config()
    except Exception:
        return []
    todo = []
    for c in cfg.get("components", []):
        for s in c.get("sources", []):
            if "REMPLACEZ" in s["url"] or "CHANGEZ" in s["url"]:
                todo.append((c["name"], s["site"]))
    return todo


# ---------------------------------------------------------------------------
# Actions du menu
# ---------------------------------------------------------------------------

def run_tracker(args, label):
    title(label)
    try:
        subprocess.run([sys.executable, str(TRACKER), *args])
    except KeyboardInterrupt:
        print("\n  Interrompu.")
    except Exception as e:
        print(f"  Erreur : {e}")


def action_check_now():
    if email_is_configured():
        if confirm("Envoyer aussi le rapport par email ?"):
            return run_tracker([], "Verification des prix + envoi email")
    run_tracker(["--no-email"], "Verification des prix")


def action_report():
    run_tracker(["--report-only", "--no-email"], "Rapport (sans interroger les sites)")


def action_demo():
    run_tracker(["--dry-run", "--no-email"], "Demonstration (prix simules)")


def action_add_price():
    title("Ajouter un prix vu ailleurs")
    cfg = load_config()
    components = cfg["components"]

    print("  Quel composant ?\n")
    for i, c in enumerate(components, 1):
        print(f"    {i}. {c['name']}")
    print()

    choice = ask("Numero")
    if not choice.isdigit() or not (1 <= int(choice) <= len(components)):
        print("  Choix invalide.")
        return

    component = components[int(choice) - 1]
    price = ask(f"Prix vu pour {component['name']} (en euros, ex: 389.90)")
    try:
        float(price.replace(",", "."))
    except ValueError:
        print("  Prix invalide.")
        return

    site = ask("Sur quel site ? (ex: dealabs, amazon, ldlc)")
    when = ask("Date (AAAA-MM-JJ), vide = aujourd'hui", "")

    args = ["--add-price", component["id"], price.replace(",", "."), site]
    if when:
        args += ["--date", when]

    print()
    subprocess.run([sys.executable, str(TRACKER), *args])


def action_history():
    title("Historique d'un composant")
    cfg = load_config()
    components = cfg["components"]

    for i, c in enumerate(components, 1):
        print(f"    {i}. {c['name']}")
    print()

    choice = ask("Numero")
    if not choice.isdigit() or not (1 <= int(choice) <= len(components)):
        print("  Choix invalide.")
        return

    subprocess.run([sys.executable, str(TRACKER), "--history",
                    components[int(choice) - 1]["id"]])


def action_setup_email():
    title("Configuration de l'email")

    print("  Le rapport quotidien vous sera envoye par email.")
    print("  Pour Gmail, il faut un MOT DE PASSE D'APPLICATION")
    print("  (different de votre mot de passe habituel, et plus sur).\n")
    print("  Comment l'obtenir :")
    print("    1. Allez sur https://myaccount.google.com/apppasswords")
    print("    2. Activez la validation en 2 etapes si demande")
    print("    3. Creez un mot de passe pour 'Mail'")
    print("    4. Copiez le code de 16 caracteres\n")

    if not confirm("Continuer ?"):
        return

    cfg = load_config()
    current = cfg.get("email", {})

    print()
    sender = ask("Votre adresse email (expediteur)",
                 current.get("sender_email") if "VOTRE" not in current.get("sender_email", "VOTRE") else None)
    if not sender or "@" not in sender:
        print("  Adresse invalide.")
        return

    recipient = ask("Adresse de reception (vide = la meme)", sender)
    password = ask("Mot de passe d'application (16 caracteres)")
    if not password:
        print("  Mot de passe requis.")
        return

    # Detection automatique du serveur SMTP selon le domaine
    domain = sender.split("@")[-1].lower()
    smtp_map = {
        "gmail.com": ("smtp.gmail.com", 587),
        "outlook.com": ("smtp-mail.outlook.com", 587),
        "hotmail.com": ("smtp-mail.outlook.com", 587),
        "live.fr": ("smtp-mail.outlook.com", 587),
        "yahoo.com": ("smtp.mail.yahoo.com", 587),
        "yahoo.fr": ("smtp.mail.yahoo.com", 587),
        "orange.fr": ("smtp.orange.fr", 587),
        "free.fr": ("smtp.free.fr", 587),
        "sfr.fr": ("smtp.sfr.fr", 587),
        "laposte.net": ("smtp.laposte.net", 587),
    }
    server, port = smtp_map.get(domain, ("smtp.gmail.com", 587))
    if domain not in smtp_map:
        print(f"\n  Fournisseur '{domain}' non reconnu.")
        server = ask("Serveur SMTP", "smtp.gmail.com")
        port = int(ask("Port SMTP", "587"))
    else:
        print(f"\n  Serveur detecte automatiquement : {server}:{port}")

    cfg["email"] = {
        "smtp_server": server,
        "smtp_port": port,
        "sender_email": sender,
        "recipient_email": recipient,
        "subject_prefix": current.get("subject_prefix", "[PC Tracker]"),
    }
    save_config(cfg)

    ENV_PATH.write_text(f"EMAIL_APP_PASSWORD={password}\n", encoding="utf-8")
    print("\n  Configuration enregistree.")

    if confirm("\n  Envoyer un email de test maintenant ?"):
        print("\n  Envoi en cours...\n")
        result = subprocess.run([sys.executable, str(TRACKER), "--report-only"],
                                capture_output=True, text=True)
        output = (result.stdout + result.stderr)
        if "Email envoye" in output:
            print(f"  Email envoye a {recipient}. Verifiez votre boite (et les spams).")
        else:
            print("  L'envoi a echoue. Message d'erreur :\n")
            for line in output.strip().splitlines()[-6:]:
                print(f"    {line}")
            print("\n  Causes frequentes : mot de passe d'application incorrect,")
            print("  ou validation en 2 etapes non activee sur le compte.")


def action_schedule():
    title("Automatiser l'execution quotidienne")

    if not email_is_configured():
        print("  Configurez d'abord l'email (option 5 du menu),")
        print("  sinon la tache automatique n'aura personne a qui ecrire.\n")
        if not confirm("Continuer quand meme ?"):
            return

    hour = ask("A quelle heure lancer la verification chaque jour ? (0-23)", "8")
    if not hour.isdigit() or not (0 <= int(hour) <= 23):
        print("  Heure invalide.")
        return
    hour = int(hour)

    if IS_WINDOWS:
        _schedule_windows(hour)
    else:
        _schedule_unix(hour)


def _schedule_windows(hour):
    task_name = "SuiviPrixPC"
    cmd = [
        "schtasks", "/Create", "/TN", task_name, "/SC", "DAILY",
        "/ST", f"{hour:02d}:00",
        "/TR", f'"{sys.executable}" "{TRACKER}"',
        "/F",
    ]
    print(f"\n  Creation de la tache Windows '{task_name}' a {hour:02d}h00...\n")
    result = subprocess.run(cmd, capture_output=True, text=True, shell=False)

    if result.returncode == 0:
        print("  Tache creee. Le rapport partira chaque jour automatiquement.")
        print(f"\n  Pour la supprimer plus tard :")
        print(f"    schtasks /Delete /TN {task_name} /F")
    else:
        print("  Echec de la creation automatique.")
        print(f"  {result.stderr.strip()[:300]}\n")
        print("  Creez-la manuellement : Planificateur de taches > Creer une tache de base")
        print(f"    Programme : {sys.executable}")
        print(f"    Arguments : {TRACKER}")
        print(f"    Demarrer dans : {BASE_DIR}")


def _schedule_unix(hour):
    line = f"0 {hour} * * * cd {BASE_DIR} && {sys.executable} {TRACKER} >> {BASE_DIR}/log.txt 2>&1"

    try:
        existing = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    except FileNotFoundError:
        print("\n  L'outil 'crontab' n'est pas installe sur ce systeme.")
        print("  Installez-le (ex: sudo apt install cron) puis relancez,")
        print(f"  ou ajoutez manuellement cette ligne a votre planificateur :\n\n    {line}")
        return

    current = existing.stdout if existing.returncode == 0 else ""

    if str(TRACKER) in current:
        print("\n  Une tache existe deja pour ce script.")
        if not confirm("La remplacer ?"):
            return
        current = "\n".join(l for l in current.splitlines() if str(TRACKER) not in l)

    new_cron = (current.rstrip() + "\n" + line + "\n").lstrip()
    result = subprocess.run(["crontab", "-"], input=new_cron, text=True,
                            capture_output=True)

    if result.returncode == 0:
        print(f"\n  Tache creee : verification chaque jour a {hour}h00.")
        print(f"  Les logs iront dans {BASE_DIR}/log.txt")
        print("\n  Pour la retirer plus tard : crontab -e (puis supprimez la ligne)")
    else:
        print(f"\n  Echec : {result.stderr.strip()[:300]}")
        print(f"\n  Ajoutez manuellement via 'crontab -e' :\n    {line}")


def action_status():
    title("Etat de l'installation")

    # Dependances
    deps_ok = True
    for module, package in {"requests": "requests", "bs4": "beautifulsoup4",
                            "dotenv": "python-dotenv"}.items():
        try:
            __import__(module)
            print(f"  [OK]     {package}")
        except ImportError:
            print(f"  [MANQUE] {package}")
            deps_ok = False

    # Email
    print(f"  [{'OK' if email_is_configured() else 'A FAIRE'}]"
          f"{'     ' if email_is_configured() else ' '}Configuration email")

    # URLs
    todo = urls_needing_setup()
    if todo:
        print(f"  [A FAIRE] {len(todo)} URL(s) a completer dans config.json :")
        for name, site in todo:
            print(f"              - {name} ({site})")
    else:
        print("  [OK]     Toutes les URLs sont renseignees")

    # Historique -- depuis la bascule 6.4, il vit dans SQLite.
    hist = _charger_historique()
    if hist:
        try:
            total = sum(len(v.get("entries", [])) for v in hist.values()
                        if isinstance(v, dict))
            days = set()
            for v in hist.values():
                if isinstance(v, dict):
                    days.update(e["date"] for e in v.get("entries", []))
            print(f"  [OK]     Historique : {total} releves sur {len(days)} dates")
            if len(days) < 5:
                print("             (les conseils gagneront en fiabilite avec plus de recul)")
        except Exception:
            print("  [!]      Historique illisible")
    else:
        print("  [INFO]   Aucun historique encore : lancez une verification")

    # Base de donnees (Axe 7 : elle est la source de verite depuis la 6.4)
    _etat_base()

    # Filet de securite : resultat de la derniere suite pytest
    _etat_tests()

    # Tache planifiee
    try:
        if IS_WINDOWS:
            r = subprocess.run(["schtasks", "/Query", "/TN", "SuiviPrixPC"],
                               capture_output=True, text=True)
            scheduled = r.returncode == 0
        else:
            r = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            scheduled = r.returncode == 0 and str(TRACKER) in r.stdout
        print(f"  [{'OK' if scheduled else 'A FAIRE'}]"
              f"{'     ' if scheduled else ' '}Tache quotidienne automatique")
    except FileNotFoundError:
        outil = "schtasks" if IS_WINDOWS else "crontab"
        print(f"  [INFO]   Planification indisponible ({outil} absent du systeme)")

    if not deps_ok:
        print("\n  Utilisez l'option 8 pour installer les dependances manquantes.")


def action_interface():
    """
    Lance l'interface web locale, et rend la main quand elle s'arrete.

    Difference avec l'option 10 : le tableau de bord est un fichier FIGE,
    joignable a un mail et lisible hors ligne, sans rien qui tourne.
    L'interface, elle, relit la base a chaque rafraichissement et permet de
    declencher une collecte -- mais elle suppose que ce programme tourne.
    Les deux coexistent, aucun ne remplace l'autre.
    """
    title("Interface web locale")
    print("  Ouverture de http://127.0.0.1:8765 dans votre navigateur.")
    print("  Les donnees sont lues en direct dans prices.db.")
    print("\n  Ctrl+C pour revenir a ce menu.\n")
    try:
        subprocess.run([sys.executable, str(BASE_DIR / "serveur.py")])
    except KeyboardInterrupt:
        pass
    print("\n  Interface arretee.")


def action_dashboard():
    """Genere le tableau de bord et l'ouvre dans le navigateur."""
    title("Tableau de bord")
    result = subprocess.run([sys.executable, str(BASE_DIR / "dashboard.py")],
                            capture_output=True, text=True)
    print(result.stdout or result.stderr)

    fichier = BASE_DIR / "dashboard.html"
    if not fichier.exists():
        print("  Le tableau de bord n'a pas pu etre genere.")
        print("  Lancez d'abord une verification de prix (option 1 ou 9).")
        return

    if confirm("Ouvrir dans le navigateur ?"):
        try:
            if IS_WINDOWS:
                os.startfile(fichier)
            elif platform.system() == "Darwin":
                subprocess.run(["open", fichier])
            else:
                subprocess.run(["xdg-open", fichier])
        except Exception as e:
            print(f"  Ouverture automatique impossible : {e}")
            print(f"  Ouvrez manuellement : {fichier}")


def action_digest():
    run_tracker(["--digest", "--no-email"], "Bilan de la semaine")


def action_ajouter_source():
    """Ajoute un site marchand ou un comparateur a un composant."""
    title("Ajouter un site a surveiller")
    print("  Le systeme ne verifie QUE les sites que vous lui indiquez.")
    print("  Plus vous en ajoutez, moins vous risquez de rater un meilleur prix.\n")
    print("  Astuce : une URL de comparateur (idealo.fr, prix.net) couvre a elle")
    print("  seule des dizaines de marchands en une seule requete.\n")

    cfg = load_config()
    components = cfg["components"]

    for i, c in enumerate(components, 1):
        reelles = [s for s in c["sources"]
                   if "REMPLACEZ" not in s["url"] and "CHANGEZ" not in s["url"]]
        alerte = "  <-- peu surveille" if len(reelles) < 3 else ""
        print(f"    {i}. {c['name'][:44]:44} ({len(reelles)} site(s)){alerte}")
    print()

    choix = ask("Numero du composant")
    if not choix.isdigit() or not (1 <= int(choix) <= len(components)):
        print("  Choix invalide.")
        return

    composant = components[int(choix) - 1]
    print(f"\n  Composant : {composant['name']}")
    print("  Sites deja surveilles : "
          + ", ".join(s["site"] for s in composant["sources"]) + "\n")

    url = ask("Collez l'URL de la page produit (ou du comparateur)")
    if not url.startswith("http"):
        print("  URL invalide (elle doit commencer par http).")
        return

    # Nom du site deduit du domaine
    try:
        domaine = url.split("/")[2].replace("www.", "")
        defaut = domaine.split(".")[0]
    except IndexError:
        defaut = "site"

    site = ask("Nom court du site", defaut)
    est_comparateur = confirm("Est-ce une page de comparateur (idealo, prix.net...) ?")

    source = {"site": site, "url": url}
    if est_comparateur:
        source["type"] = "comparateur"

    if any(s["url"] == url for s in composant["sources"]):
        print("  Cette URL est deja surveillee.")
        return

    composant["sources"].append(source)
    save_config(cfg)

    reelles = [s for s in composant["sources"]
               if "REMPLACEZ" not in s["url"] and "CHANGEZ" not in s["url"]]
    print(f"\n  Ajoute. {composant['name']} est maintenant suivi sur "
          f"{len(reelles)} site(s).")
    if est_comparateur:
        print("  Le comparateur retiendra automatiquement le prix le plus bas")
        print("  parmi tous les marchands qu'il reference.")


def action_marquer_achat():
    """Sort un composant du suivi actif et enregistre le prix paye."""
    title("Marquer un composant comme achete")

    cfg = load_config()
    projet = cfg.setdefault("projet", {"nom": "Mon PC", "date_cible": None, "achats": []})
    deja = {a["id"] for a in projet.get("achats", [])}
    dispo = [c for c in cfg["components"] if c["id"] not in deja]

    if not dispo:
        print("  Tous les composants suivis sont deja marques comme achetes.")
        return

    print("  Composants encore en suivi :\n")
    for i, c in enumerate(dispo, 1):
        print(f"    {i}. {c['name']}")
    print()

    choix = ask("Numero du composant achete")
    if not choix.isdigit() or not (1 <= int(choix) <= len(dispo)):
        print("  Choix invalide.")
        return

    composant = dispo[int(choix) - 1]
    prix = ask(f"Prix paye pour {composant['name']} (EUR)")
    try:
        prix_val = float(prix.replace(",", "."))
    except ValueError:
        print("  Prix invalide.")
        return

    site = ask("Achete sur quel site ?")
    date = ask("Date d'achat (AAAA-MM-JJ), vide = aujourd'hui",
               datetime.now().strftime("%Y-%m-%d"))

    projet.setdefault("achats", []).append({
        "id": composant["id"], "prix": prix_val, "date": date, "site": site,
    })
    save_config(cfg)

    print(f"\n  Enregistre. {composant['name']} sort du suivi actif.")
    print("  Il apparaitra desormais dans le bilan 'Deja achete' du rapport,")
    print("  avec la comparaison au meilleur prix jamais observe.")

    restants = len(cfg["components"]) - len(projet["achats"])
    print(f"  {restants} composant(s) encore a acheter.")


def action_vendeurs():
    """Active ou desactive les marchands interroges par recherche."""
    title("Vendeurs interroges")

    cfg = load_config()
    vendeurs = cfg.get("vendeurs", {})
    liste = [(k, v) for k, v in vendeurs.items() if k != "_comment"]
    if not liste:
        print("  Aucun catalogue de vendeurs configure.")
        return

    liste.sort(key=lambda kv: (kv[1].get("type") != "comparateur",
                               kv[1].get("priorite", 5), kv[0]))

    actifs = sum(1 for _, v in liste if v.get("actif"))
    maxi = cfg.get("thresholds", {}).get("max_vendeurs_par_composant", 8)
    print(f"  {actifs} vendeur(s) actif(s) sur {len(liste)}.")
    print(f"  Au maximum {maxi} sont interroges par composant "
          f"(comparateurs en priorite).\n")

    for i, (nom, v) in enumerate(liste, 1):
        etat = "[x]" if v.get("actif") else "[ ]"
        genre = "comparateur" if v.get("type") == "comparateur" else "marchand"
        print(f"    {i:2}. {etat} {nom:16} {v.get('pays','?'):6} {genre}")

    print("\n  Un comparateur couvre a lui seul des dizaines de marchands.")
    print("  Les vendeurs europeens livrent en France, avec la garantie legale UE,")
    print("  mais verifiez les frais de port avant de commander.\n")

    choix = ask("Numero a activer/desactiver (vide pour revenir)")
    if not choix.isdigit() or not (1 <= int(choix) <= len(liste)):
        return

    nom, v = liste[int(choix) - 1]
    v["actif"] = not v.get("actif")
    cfg["vendeurs"][nom] = v
    save_config(cfg)
    print(f"\n  {nom} est maintenant {'ACTIF' if v['actif'] else 'INACTIF'}.")

    nouveau = sum(1 for _, x in liste if x.get("actif"))
    nb_comp = sum(1 for c in cfg["components"] if c.get("recherche"))
    print(f"  Volume estime : ~{min(nouveau, maxi) * nb_comp} requetes de recherche par jour.")


def action_open_config():
    title("Modifier les composants suivis")
    print(f"  Le fichier de configuration se trouve ici :\n")
    print(f"    {CONFIG_PATH}\n")
    print("  Vous pouvez y ajouter/retirer des composants, changer les URLs,")
    print("  ajuster le budget et les seuils. Voir README.md pour le detail.\n")

    if confirm("Ouvrir le fichier maintenant ?"):
        try:
            if IS_WINDOWS:
                os.startfile(CONFIG_PATH)
            elif platform.system() == "Darwin":
                subprocess.run(["open", CONFIG_PATH])
            else:
                subprocess.run(["xdg-open", CONFIG_PATH])
        except Exception as e:
            print(f"  Impossible d'ouvrir automatiquement : {e}")
            print(f"  Ouvrez-le a la main depuis : {CONFIG_PATH}")


# ---------------------------------------------------------------------------
# Menu principal
# ---------------------------------------------------------------------------

MENU = """
  SUIVI DE PRIX PC
  ----------------

   1.  Verifier les prix maintenant
   2.  Voir le dernier rapport (sans interroger les sites)
   3.  Ajouter un prix vu ailleurs (Dealabs, magasin...)
   4.  Consulter l'historique d'un composant

   5.  Configurer l'email
   6.  Automatiser l'envoi quotidien
   7.  Modifier les composants suivis

   8.  Verifier l'installation
   9.  Demonstration (prix simules, sans reseau)
  10.  Ouvrir le tableau de bord (fichier, hors ligne)
  11.  Bilan de la semaine
  12.  Ajouter un site a surveiller (couverture prix)
  13.  Marquer un composant comme achete
  14.  Gerer les vendeurs (France / Europe)
  15.  Interface web locale (lecture en direct, collecte a la demande)

   0.  Quitter
"""

ACTIONS = {
    "1": action_check_now,
    "2": action_report,
    "3": action_add_price,
    "4": action_history,
    "5": action_setup_email,
    "6": action_schedule,
    "7": action_open_config,
    "8": action_status,
    "9": action_demo,
    "10": action_dashboard,
    "11": action_digest,
    "12": action_ajouter_source,
    "13": action_marquer_achat,
    "14": action_vendeurs,
    "15": action_interface,
}


def _etat_base():
    """Etat de la base SQLite : accessible ? volume ? mode degrade ?"""
    try:
        import sqlite_store
    except Exception:
        print("  [!]      Module sqlite_store absent")
        return

    config = {}
    cfg_path = BASE_DIR / "config.json"
    if cfg_path.exists():
        try:
            config = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            config = {}

    chemin = BASE_DIR / config.get("sqlite_file", "prices.db")
    if not chemin.exists():
        print("  [INFO]   Base de donnees absente : elle sera creee au "
              "premier lancement")
        return

    sqlite_store.configure(chemin)
    etat = sqlite_store.etat()

    if etat.get("degrade"):
        print(f"  [!]      Base INUTILISABLE : {etat['degrade']}")
        secours = BASE_DIR / config.get("history_file", "history.json")
        if secours.exists():
            print(f"           Un export de secours existe ({secours.name}) : "
                  f"le rapport repartira de la")
        else:
            print("           Aucun export de secours. Lancez "
                  "'python price_tracker.py --export-history' quand la base "
                  "sera de nouveau lisible.")
        return

    ko = etat.get("taille_octets", 0) / 1024
    print(f"  [OK]     Base de donnees : {etat.get('releves', 0)} releves, "
          f"{etat.get('produits', 0)} produits ({ko:.0f} Ko)")
    details = []
    if etat.get("mesures"):
        details.append(f"{etat['mesures']} mesure(s) de fiabilite")
    if etat.get("annonces"):
        details.append(f"{etat['annonces']} annonce(s) identifiee(s)")
    if details:
        print(f"           {', '.join(details)}")
    if etat.get("premier_releve"):
        print(f"           historique du {etat['premier_releve']} au "
              f"{etat['dernier_releve']}")


def _etat_tests():
    """Resultat de la derniere execution du filet de securite (pytest)."""
    chemin = BASE_DIR / ".pytest_dernier.json"
    if not (BASE_DIR / "tests").exists():
        return
    if not chemin.exists():
        print("  [INFO]   Filet de securite jamais lance : "
              "'pip install -r requirements-dev.txt && pytest'")
        return
    try:
        r = json.loads(chemin.read_text(encoding="utf-8"))
    except Exception:
        print("  [!]      Resultat des tests illisible")
        return

    quand = str(r.get("date", "?")).replace("T", " ")[:16]
    if r.get("vert"):
        print(f"  [OK]     Tests : {r.get('reussis', 0)}/{r.get('total', 0)} "
              f"passes (le {quand})")
    else:
        print(f"  [!]      Tests : {r.get('echecs', 0)} echec(s) sur "
              f"{r.get('total', 0)} (le {quand})")
        print("           Relancez 'pytest' pour le detail avant de vous fier "
              "aux conseils.")


def _charger_historique():
    """
    Lit l'historique. Depuis la bascule 6.4, la source de verite est SQLite ;
    history.json n'est plus qu'un export de secours, utilise en repli.
    """
    try:
        import sqlite_store
        config = {}
        cfg_path = BASE_DIR / "config.json"
        if cfg_path.exists():
            config = json.loads(cfg_path.read_text(encoding="utf-8"))
        sqlite_store.configure(BASE_DIR / config.get("sqlite_file", "prices.db"))
        hist = sqlite_store.charger_history(config)
        if hist:
            return hist
    except Exception:
        pass

    hist_path = BASE_DIR / "history.json"
    if hist_path.exists():
        try:
            return json.loads(hist_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def first_run_guide():
    """Message d'accueil au tout premier lancement."""
    if _charger_historique():
        return

    title("Bienvenue")
    print("  C'est votre premier lancement. Voici l'ordre conseille :\n")
    print("    1. Option 9  : voir une demonstration (30 secondes)")
    print("    2. Option 5  : configurer votre email")
    print("    3. Option 1  : lancer une vraie verification")
    print("    4. Option 6  : automatiser l'envoi quotidien\n")
    print("  Bon a savoir : le fichier config.json contient deja un historique")
    print("  de prix reels, donc les conseils sont utiles des maintenant.")
    pause()


def main():
    if not TRACKER.exists():
        print(f"Erreur : price_tracker.py introuvable dans {BASE_DIR}")
        input("Appuyez sur Entree pour fermer...")
        return

    clear()
    print("\n  Verification de l'environnement...\n")
    if not check_dependencies():
        input("\n  Appuyez sur Entree pour fermer...")
        return

    first_run_guide()

    while True:
        clear()
        print(MENU)

        # Rappels contextuels
        warnings = []
        if not email_is_configured():
            warnings.append("Email non configure (option 5)")
        todo = urls_needing_setup()
        if todo:
            warnings.append(f"{len(todo)} URL(s) a completer (option 7)")
        if warnings:
            print("  A faire : " + " | ".join(warnings))

        try:
            choice = input("\n  Votre choix : ").strip()
        except EOFError:
            print("\n  A bientot.\n")
            break

        if choice == "0":
            print("\n  A bientot.\n")
            break

        action = ACTIONS.get(choice)
        if action:
            clear()
            try:
                action()
            except KeyboardInterrupt:
                print("\n\n  Annule.")
            except Exception as e:
                print(f"\n  Une erreur est survenue : {e}")
            pause()
        else:
            print("\n  Choix invalide.")
            pause()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n  Interrompu.\n")
