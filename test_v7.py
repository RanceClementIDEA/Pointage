# -*- coding: utf-8 -*-
"""TVA, plancher 30 jours, verification fiche, credibilite, caracterisation."""
import json
import moteur_recherche as m
import analyse_offres as a

ok = fail = 0
def v(lib, o, att):
    global ok, fail
    b = (o == att); ok += b; fail += not b
    print(f"  [{'OK ' if b else 'ECHEC'}] {lib}" + ("" if b else f"   attendu {att!r}, obtenu {o!r}"))

def O(vendeur, prix, **kw):
    kw.setdefault("dispo", True); kw.setdefault("confiance", "haute")
    kw.setdefault("verifiee", True)
    return m.Offre(vendeur=vendeur, prix=prix, titre="RX 9060 XT 16Go", **kw)

print("\n1. Prix hors taxes ramene au prix reellement paye")
o = m.Offre("mindfactory", 377.31, hors_taxes=True)
r = m.appliquer_tva(o, {"pays": "DE"}, {})
v("377,31 HT (DE 19%) -> TTC", r.prix, 449.0)
v("TVA reconstituee notee", r.tva_ajoutee, 71.69)
v("pays sans taux connu : ecartee",
  m.appliquer_tva(m.Offre("x", 100, hors_taxes=True), {"pays": "ZZ"}, {}), None)

print("\n2. Plancher legal des 30 derniers jours (directive Omnibus)")
for texte, att in [
    ("Prix le plus bas des 30 derniers jours : 439,00 EUR", 439.0),
    ("Niedrigster Preis der letzten 30 Tage: 412,00 EUR", 412.0),
    ("Lowest price in the last 30 days: 429,00 EUR", 429.0),
    ("Aucune mention", None)]:
    v(f"{texte[:44]:46}", m.lire_plus_bas_30j(texte), att)

page = ('<div><h3>RX 9060 XT 16Go</h3><del>599,00 EUR</del><span>449,00 EUR</span>'
        '<p>Prix le plus bas des 30 derniers jours : 439,00 EUR</p></div>')
off = m.extraire_offres(page, "")
v("une seule offre (le plancher n'en est pas une)", len(off), 1)
v("prix reel", off[0].prix, 449.0)
v("plancher capte comme metadonnee", off[0].plus_bas_30j, 439.0)

print("\n3. 'A partir de' n'est pas le prix du produit")
p2 = '<div><h3>RX 9060 XT 16Go</h3><span>a partir de 399,00 EUR</span></div>'
v("ecarte", len(m.extraire_offres(p2, "")), 0)

print("\n4. Offre isolee tres basse : boutique frauduleuse ou erreur")
jour = [O("ldlc",449), O("topachat",452), O("materiel.net",447), O("grosbill",455),
        O("cdiscount",449.9), O("alternate.fr",444), O("cybertek",459),
        O("boutique-inconnue",149, confiance="inconnue", verifiee=False)]
v("consensus du jour", round(a.consensus(jour[:-1])), 450)
verdict, raisons = a.evaluer_credibilite(jour[-1], jour)
v("l'offre a 149 EUR est jugee suspecte", verdict, "suspect")
print(f"          raisons : {raisons[0]}")
v("une offre normale reste fiable", a.evaluer_credibilite(jour[0], jour)[0], "fiable")
retenues, ecartees = a.filtrer_credibles(jour, {})
v("elle sort du classement", [o.vendeur for o in ecartees], ["boutique-inconnue"])
v("les 7 autres sont conservees", len(retenues), 7)

print("\n5. Une vraie promo passe, une fausse non")
hist = [{"date":"2026-06-%02d"%d, "price":p} for d,p in
        enumerate([469,465,470,462,459,455,449,452,449,447], start=1)]
vraie = O("ldlc", 389.0, plus_bas_30j=440.0)
jour2 = [vraie, O("topachat",449), O("grosbill",455), O("cybertek",452), O("fnac",458)]
an = a.caracteriser(vraie, jour2, hist, {})
print(f"          389 EUR -> {an['note']}/100 : {an['libelle']}")
print(f"          {a.expliquer(vraie, an)}")
v("promo reelle bien notee", an["note"] >= 70, True)

fausse = O("rakuten", 449.0, plus_bas_30j=439.0, prix_barre=599.0)
jour3 = [fausse, O("ldlc",449), O("topachat",450), O("grosbill",452), O("fnac",448)]
an2 = a.caracteriser(fausse, jour3, hist, {})
print(f"          449 EUR (plancher 30j 439) -> {an2['note']}/100 : {an2['libelle']}")
v("fausse promo non presentee comme une affaire", an2["note"] < 55, True)

print("\n6. Une offre suspecte ne peut pas etre une opportunite")
susp = O("inconnue2", 149.0, confiance="inconnue", verifiee=False)
jour4 = [susp] + [O(f"v{i}", 449+i) for i in range(6)]
an3 = a.caracteriser(susp, jour4, hist, {})
v("libelle", an3["libelle"], "OFFRE NON CREDIBLE")
v("note plafonnee", an3["note"] <= 30, True)

print(f"\n{'='*56}\n  {ok} reussis / {fail} echecs\n{'='*56}")
