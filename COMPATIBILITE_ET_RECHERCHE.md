# -*- coding: utf-8 -*-
"""Mesure du cout d'extraction sur des pages de taille realiste."""
import time, random
from bs4 import BeautifulSoup
import moteur_recherche as m

def page_marchande(n_produits, bruit=True):
    """Page de resultats realiste : cartes + entete + menus + pied de page."""
    menu = "".join(f"<li><a href='/c{i}'>Categorie {i}</a></li>" for i in range(40))
    cartes = []
    for i in range(n_produits):
        cartes.append(f"""
        <article class="product-card">
          <div class="img"><img src="/p{i}.jpg" alt="Produit {i}"></div>
          <div class="info">
            <h3 class="title"><a href="/p/{i}">AMD Ryzen 7 5700X variante {i}</a></h3>
            <div class="specs"><span>8 coeurs</span><span>AM4</span><span>65W</span></div>
            <div class="rating"><span>4.5</span><span>({i} avis)</span></div>
            <div class="prices"><del class="old">199,00 €</del>
              <span class="price">{120 + i},90 €</span></div>
            <div class="stock">En stock</div>
            <button class="add">Ajouter au panier</button>
          </div>
        </article>""")
    pied = "".join(f"<p>Mention legale {i}</p>" for i in range(30)) if bruit else ""
    return (f"<html><body><header><nav><ul>{menu}</ul></nav></header>"
            f"<main>{''.join(cartes)}</main><footer>{pied}</footer></body></html>")

print(f"{'produits':>9}{'balises':>9}{'extraction':>13}{'offres':>8}")
for n in (10, 25, 50, 100, 200):
    html = page_marchande(n)
    nb_balises = len(BeautifulSoup(html, "html.parser").find_all(True))
    m.extraire_offres(html, "https://x.fr/")          # chauffe
    mesures = []
    for _ in range(7):
        t0 = time.perf_counter()
        offres = m.extraire_offres(html, "https://x.fr/")
        mesures.append(time.perf_counter() - t0)
    dt = sorted(mesures)[len(mesures) // 2]           # mediane, moins bruitee
    print(f"{n:>9}{nb_balises:>9}{dt*1000:>11.0f}ms{len(offres):>8}")

print()
print("Extrapolation sur une vraie session :")
html = page_marchande(50)
m.extraire_offres(html, "https://x.fr/")
ech = []
for _ in range(11):
    t0 = time.perf_counter()
    m.extraire_offres(html, "https://x.fr/")
    ech.append(time.perf_counter() - t0)
unit = sorted(ech)[len(ech) // 2]
print(f"  1 page de 50 produits         : {unit*1000:.0f} ms")
print(f"  9 requetes (recherche groupee) x 22 vendeurs = 198 pages")
print(f"  cout total d'extraction       : {unit*198:.1f} s de CPU")
