# -*- coding: utf-8 -*-
"""
Filet de securite des workflows GitHub Actions.

Ces fichiers ne sont jamais executes par la suite de tests, et pourtant ce
sont eux qui font tourner le projet au quotidien. Une erreur y reste donc
invisible jusqu'a ce qu'elle casse une execution reelle -- ou pire, jusqu'a
ce qu'elle ne casse RIEN visiblement tout en perdant des donnees.

C'est exactement ce qui s'est produit :

    git add prices.db history.json

`history.json` n'etant plus ecrit depuis la bascule SQLite (6.4), git
refusait TOUTE la commande (`fatal: pathspec ... did not match any files`)
et n'ajoutait donc pas non plus `prices.db`. L'etape se terminait sur
« Aucun changement dans l'historique » et l'historique repartait de zero
chaque jour, en silence.

Le test ci-dessous n'inspecte pas le texte du workflow : il EXECUTE le
script de l'etape de sauvegarde dans un depot temporaire, dans les trois
configurations de fichiers possibles.
"""
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

RACINE = Path(__file__).resolve().parent.parent
COLLECTE = RACINE / ".github" / "workflows" / "price-tracker.yml"
PUBLICATION = RACINE / ".github" / "workflows" / "publier-dashboard.yml"

besoin_git = pytest.mark.skipif(shutil.which("git") is None, reason="git absent")
besoin_bash = pytest.mark.skipif(shutil.which("bash") is None, reason="bash absent")


def _workflow(chemin):
    # `on:` est interprete comme le booleen True par YAML 1.1 -- d'ou la
    # lecture par cle normalisee plutot que par acces direct.
    return yaml.safe_load(chemin.read_text(encoding="utf-8"))


def _etapes(doc):
    (job,) = doc["jobs"].values()
    return job["steps"]


def _etape(doc, fragment):
    for e in _etapes(doc):
        if fragment.lower() in (e.get("name") or "").lower():
            return e
    raise AssertionError(f"etape introuvable : {fragment}")


# --- L'etape de sauvegarde, executee pour de vrai --------------------------

@besoin_git
@besoin_bash
@pytest.mark.parametrize("presents, attendus", [
    (["prices.db"], ["prices.db"]),
    (["prices.db", "history.json"], ["history.json", "prices.db"]),
    (["history.json"], ["history.json"]),
    ([], []),
])
def test_la_sauvegarde_ajoute_ce_qui_existe(tmp_path, presents, attendus):
    """
    Le coeur du correctif : chaque fichier est ajoute SEPAREMENT et
    seulement s'il existe. Un fichier absent ne doit jamais empecher
    l'enregistrement des autres.
    """
    script = _etape(_workflow(COLLECTE), "sauvegarder")["run"]
    # On garde la logique d'ajout, sans commit ni push (pas de remote ici).
    script = script.split("if git diff --cached")[0]

    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    for nom in presents:
        (tmp_path / nom).write_text("contenu", encoding="utf-8")

    r = subprocess.run(["bash", "-e", "-c", script], cwd=tmp_path,
                       capture_output=True, text=True)
    assert r.returncode == 0, (
        f"l'etape a echoue (code {r.returncode}) : {r.stderr.strip()[:200]}")

    indexes = subprocess.run(["git", "diff", "--cached", "--name-only"],
                             cwd=tmp_path, capture_output=True, text=True).stdout
    assert sorted(indexes.split()) == sorted(attendus)


@besoin_git
@besoin_bash
def test_un_fichier_absent_ne_fait_pas_echouer_letape(tmp_path):
    """Le symptome exact rapporte : exit code 128 sur pathspec invalide."""
    script = _etape(_workflow(COLLECTE), "sauvegarder")["run"]
    script = script.split("if git diff --cached")[0]
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "prices.db").write_text("x", encoding="utf-8")

    r = subprocess.run(["bash", "-e", "-c", script], cwd=tmp_path,
                       capture_output=True, text=True)
    assert "did not match any files" not in r.stderr
    assert r.returncode != 128


def test_la_sauvegarde_nutilise_pas_un_git_add_multi_fichiers():
    """La forme qui a cause la perte : plusieurs chemins sur une meme ligne."""
    script = _etape(_workflow(COLLECTE), "sauvegarder")["run"]
    for ligne in script.splitlines():
        nue = ligne.strip()
        if nue.startswith("git add ") and not nue.startswith("#"):
            chemins = [m for m in nue[len("git add "):].split()
                       if not m.startswith("-") and not m.startswith("2>")
                       and m not in ("||", "true")]
            assert len(chemins) <= 1, (
                f"git add multi-chemins : git refuse TOUT si l'un manque -- {nue!r}")


# --- Ce que le workflow de collecte doit garantir --------------------------

def test_prices_db_est_bien_sauvegarde():
    """
    Regression du prompt 6.4 : depuis la bascule SQLite, committer
    history.json seul ne sauvegarde plus rien.
    """
    script = _etape(_workflow(COLLECTE), "sauvegarder")["run"]
    assert "prices.db" in script


def test_le_workflow_peut_ecrire_dans_le_depot():
    doc = _workflow(COLLECTE)
    assert (doc.get("permissions") or {}).get("contents") == "write", (
        "sans contents: write, le commit d'historique echoue et les relevés "
        "du jour sont perdus")


def test_le_workflow_est_lancable_a_la_main():
    doc = _workflow(COLLECTE)
    declencheurs = doc.get("on") or doc.get(True) or {}
    assert "workflow_dispatch" in declencheurs, (
        "sans workflow_dispatch, impossible de tester sans attendre le lendemain")
    assert "schedule" in declencheurs


def test_lintegrite_est_controlee_avant_execution():
    """Un fichier abime doit etre nomme, pas produire une SyntaxError opaque."""
    doc = _workflow(COLLECTE)
    noms = [(e.get("name") or "") for e in _etapes(doc)]
    i_ctrl = next(i for i, n in enumerate(noms) if "integrite" in n.lower())
    i_exec = next(i for i, n in enumerate(noms) if "verifier les prix" in n.lower())
    assert i_ctrl < i_exec


# --- Ce que le workflow de publication ne doit JAMAIS faire ---------------

def test_la_publication_nest_jamais_automatique():
    """Garde-fou du prompt 9.2 : publier est un geste, pas une routine."""
    doc = _workflow(PUBLICATION)
    declencheurs = doc.get("on") or doc.get(True) or {}
    assert set(declencheurs) == {"workflow_dispatch"}, (
        f"declencheurs inattendus : {set(declencheurs)}")


def test_la_publication_ne_peut_pas_ecrire_dans_ce_depot():
    doc = _workflow(PUBLICATION)
    assert (doc.get("permissions") or {}).get("contents") == "read"
