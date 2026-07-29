#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verifier_parite_sqlite.py -- controle que history.json et le fichier SQLite
contiennent la MEME information (releves + gagnants de slot).

C'est le critere de reussite de l'ecriture parallele (Axe 1) : apres un cycle
complet (`python price_tracker.py --dry-run`), les deux destinations doivent
coincider.

Usage :
    python verifier_parite_sqlite.py [history.json] [prices.db]

Sortie : 0 si parite exacte, 1 sinon (avec le detail des divergences).
"""
import json
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent


def _config():
    p = BASE / "config.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def releves_depuis_json(history):
    """Ensemble des releves cote JSON : (produit, vendeur, prix, date, origine)."""
    releves = set()
    for cid, node in history.items():
        if cid == "_slots_winners" or not isinstance(node, dict):
            continue
        for e in node.get("entries", []):
            releves.add((cid, e["site"], round(float(e["price"]), 2),
                         e["date"], e.get("origin", "tracked")))
    return releves


def releves_depuis_sqlite(conn):
    releves = set()
    for pid, vid, prix, ts, origin in conn.execute(
            "SELECT produit_id, vendeur_id, prix, ts, origin FROM releves"):
        releves.add((pid, vid, round(float(prix), 2), ts, origin))
    return releves


def main():
    cfg = _config()
    hp = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / cfg.get("history_file", "history.json")
    dbp = Path(sys.argv[2]) if len(sys.argv) > 2 else BASE / cfg.get("sqlite_file", "prices.db")

    if not hp.exists():
        sys.exit(f"history introuvable : {hp}")
    if not dbp.exists():
        sys.exit(f"fichier SQLite introuvable : {dbp}")

    history = json.loads(hp.read_text(encoding="utf-8"))
    conn = sqlite3.connect(str(dbp))

    j = releves_depuis_json(history)
    s = releves_depuis_sqlite(conn)
    manque = j - s          # dans JSON, absents de SQLite
    extra = s - j           # dans SQLite, absents de JSON

    js = history.get("_slots_winners", {}) or {}
    ss = {slot: winner for slot, winner in
          conn.execute("SELECT slot, winner_id FROM slots_winners")}
    conn.close()

    slots_ok = (js == ss)
    parite = not manque and not extra and slots_ok

    print(f"Releves   : JSON={len(j)}  SQLite={len(s)}  communs={len(j & s)}")
    if manque:
        print(f"  [-] {len(manque)} releve(s) dans JSON mais absents de SQLite :")
        for x in sorted(manque)[:10]:
            print("       ", x)
    if extra:
        print(f"  [+] {len(extra)} releve(s) dans SQLite mais absents de JSON :")
        for x in sorted(extra)[:10]:
            print("       ", x)
    print(f"Slots     : JSON={len(js)}  SQLite={len(ss)}  "
          f"{'identiques' if slots_ok else 'DIFFERENTS'}")
    if not slots_ok:
        for slot in sorted(set(js) | set(ss)):
            if js.get(slot) != ss.get(slot):
                print(f"        {slot} : JSON={js.get(slot)!r}  SQLite={ss.get(slot)!r}")

    print("\nRESULTAT :", "PARITE OK" if parite else "DIVERGENCE")
    sys.exit(0 if parite else 1)


if __name__ == "__main__":
    main()
