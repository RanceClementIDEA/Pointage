# -*- coding: utf-8 -*-
"""Catalogue europeen, verification des vendeurs, HTTPS, marketplace."""
import json
import moteur_recherche as m

ok = fail = 0
def v(lib, o, att):
    global ok, fail
    b = (o == att); ok += b; fail += not b
    print(f"  [{'OK ' if b else 'ECHEC'}] {lib}" + ("" if b else f"   attendu {att!r}, obtenu {o!r}"))

cfg = json.load(open("config.json"))
V = cfg["vendeurs"]

print("\n1. Catalogue")
tous = [n for n in V if n != "_comment"]
pays = sorted({V[n].get("pays") for n in tous})
v("52 vendeurs au catalogue", len(tous), 52)
v("16 pays europeens couverts", len(pays), 16)
v("tous ont un niveau de confiance",
  all(V[n].get("confiance") for n in tous), True)
v("les places de marche sont signalees",
  sorted(n for n in tous if V[n].get("marketplace")),
  ["amazon.de", "amazon.fr", "cdiscount", "fnac", "rakuten", "rueducommerce"])

print("\n2. Les vendeurs non verifies restent inactifs")
non_verifies = [n for n in tous if V[n].get("a_verifier")]
v("30 en attente de verification", len(non_verifies), 30)
v("aucun n'est actif", any(V[n].get("actif") for n in non_verifies), False)
v("_vendeurs_actifs n'en retient aucun",
  set(non_verifies) & {n for n, _ in m._vendeurs_actifs(cfg)}, set())

print("\n3. HTTPS obligatoire")
cfg2 = {"vendeurs": {"sur": {"url":"https://a.fr/?q={q}","actif":True},
                     "pasSur": {"url":"http://b.fr/?q={q}","actif":True}},
        "thresholds": {"exiger_https": True}}
v("le vendeur en clair est ecarte",
  [n for n, _ in m._vendeurs_actifs(cfg2)], ["sur"])
cfg2["thresholds"]["exiger_https"] = False
v("desactivable si besoin", len(m._vendeurs_actifs(cfg2)), 2)

print("\n4. Confiance et mode strict")
v("ldlc en confiance haute", m.confiance_vendeur("ldlc", V["ldlc"], cfg), "haute")
v("rakuten en confiance moyenne (place de marche)",
  m.confiance_vendeur("rakuten", V["rakuten"], cfg), "moyenne")
v("vendeur non renseigne -> inconnue",
  m.confiance_vendeur("zzz", {}, cfg), "inconnue")

PAGE = '<div><h3>AMD Ryzen 7 5700X 8-Core AM4</h3><span>142,90 EUR</span><p>En stock</p></div>'
def faux(self, url, referer=None): return f"<html><body>{PAGE}</body></html>", None
m.Recuperateur.get = faux
cpu = dict(next(c for c in cfg["components"] if c["id"] == "cpu_5700x"))
cfg3 = json.loads(json.dumps(cfg))
cfg3["vendeurs"] = {"inconnu": {"url":"https://x.fr/?q={q}","actif":True,"pays":"FR"}}
cfg3["thresholds"]["max_vendeurs_par_composant"] = 0
cfg3["thresholds"]["confiance_refusee"] = []
v("marchand inconnu accepte par defaut",
  len(m.rechercher_compat(cpu, cfg3)), 1)
cfg3["thresholds"]["confiance_refusee"] = ["inconnue", "faible"]
v("mode strict : marchand inconnu ecarte",
  len(m.rechercher_compat(cpu, cfg3)), 0)

print(f"\n{'='*56}\n  {ok} reussis / {fail} echecs\n{'='*56}")
