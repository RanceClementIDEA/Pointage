#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
moteur_recherche.py  --  moteur de recherche v3
================================================
Remplace la recherche multi-vendeurs de price_tracker.py.

CE QUI CHANGE PAR RAPPORT A L'ANCIEN MOTEUR
-------------------------------------------
Ancien : sur une page de resultats, on prenait le prix le PLUS BAS de toute
la page, sans jamais regarder a quel produit il correspondait. Sur une
recherche "AMD Ryzen 7 5700X", le plus bas de la page est en general une
pate thermique a 7,90 EUR. Le filtre de plausibilite l'ecartait, et le
vendeur ne remontait donc AUCUN prix -- alors que le bon produit etait sur
la page.

Nouveau : la page est decoupee en offres individuelles (titre + prix +
stock + lien), chaque titre est confronte au terme recherche, et on retient
la moins chere des offres qui correspondent VRAIMENT au produit.

Les cinq apports :
  1. Extraction multi-offres (JSON-LD, microdonnees, puis cartes HTML).
  2. Appariement par titre : rejette 5700G, 5700X3D, ventirads, cables.
  3. Lecture du stock : une rupture ne declenche plus de fausse occasion.
  4. Frais de port pris en compte dans le classement (vendeurs UE).
  5. Requetes en parallele : tous les vendeurs interroges, pas seulement 8.

Utilisable seul pour tester :
    python moteur_recherche.py --auto-test
"""

import json
import random
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, replace
from functools import lru_cache
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# lxml est nettement plus rapide que le parseur integre. Il n'est pas
# obligatoire : sans lui, le moteur fonctionne a l'identique, en plus lent.
try:
    import lxml  # noqa: F401
    PARSEUR = "lxml"
except ImportError:
    PARSEUR = "html.parser"


def _soupe(html):
    return BeautifulSoup(html, PARSEUR)


# ---------------------------------------------------------------------------
# Reglages par defaut (tous surchargeables depuis config.json)
# ---------------------------------------------------------------------------

TIMEOUT = 15
MAX_TENTATIVES = 3
DELAI_MEME_DOMAINE = 2.5      # secondes minimum entre 2 appels au meme site
WORKERS = 8                   # vendeurs interroges simultanement
SEUIL_PERTINENCE = 0.72

# Motif rendu par Recuperateur.get quand le site repond 304 : la page n'a pas
# change. Ce n'est pas un echec -- l'appelant reutilise le dernier prix connu.
NON_MODIFIE = "304 non modifie"       # 0-1, score minimum pour retenir une offre
MAX_OFFRES_PAR_PAGE = 60      # garde-fou sur les pages tres longues

# Frais de port estimes quand le vendeur ne les annonce pas. Utilises
# uniquement pour CLASSER les offres a armes egales : une carte a 429 EUR
# depuis l'Allemagne n'est pas moins chere qu'une a 445 EUR en France.
PORT_PAR_DEFAUT = {
    "FR": 0.0, "FR/DE": 0.0, "DE": 14.0, "DE/AT": 14.0, "DE/CH": 18.0,
    "AT": 14.0, "NL": 12.0, "ES": 10.0, "DK": 16.0, "BE": 8.0, "IT": 12.0,
}

# Plusieurs navigateurs plausibles : un seul User-Agent fige finit par etre
# reconnu et bloque par les protections anti-robot.
NAVIGATEURS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
]

# Mots qui trahissent un accessoire plutot que le produit lui-meme. Retires
# automatiquement de la liste s'ils figurent dans le terme recherche ou la
# categorie (pour ne pas exclure un ventirad quand on cherche un ventirad).
ACCESSOIRES = {
    "cable", "cables", "adaptateur", "rallonge", "riser", "support",
    "bracket", "equerre", "visserie", "vis", "coque", "housse", "sacoche",
    "sticker", "autocollant", "poster", "mug", "tshirt", "figurine",
    "pate", "thermique", "nettoyant", "chiffon", "manuel", "notice",
    "protection", "filtre", "poussiere", "antivol", "cadenas",
    "ventirad", "ventilateur", "refroidisseur", "dissipateur",
    "watercooling", "radiateur", "backplate", "waterblock",
    "fixation", "montage", "mounting", "entretoise", "platine",
    "socle", "boulon", "ecrou", "rondelle", "seringue", "spatule",
}

# Mots de marque ou de gamme que les revendeurs omettent ou reordonnent sans
# arret : "Gigabyte RTX 5060 Ti Eagle 8GB" ne dit jamais "GeForce". Les exiger
# faisait passer a cote d'annonces parfaitement valides. Le modele exact reste
# garanti par les jetons de reference (5060, 8Go), eux obligatoires.
MARQUES_OPTIONNELLES = {"geforce", "radeon", "nvidia", "amd", "intel",
                        "corsair", "technologies", "corp", "inc", "sa"}

# Familles de mots interchangeables : si l'une d'elles apparait dans ce qu'on
# cherche, aucun mot de la famille ne doit servir a exclure une offre. Sans
# cela, chercher un ventirad "Thermalright Peerless Assassin" ferait rejeter
# l'annonce intitulee "Refroidisseur Thermalright Peerless Assassin".
FAMILLES = [
    {"ventirad", "ventilateur", "refroidisseur", "dissipateur",
     "watercooling", "radiateur", "aio", "waterblock", "backplate"},
    {"cable", "cables", "adaptateur", "rallonge"},
    {"pate", "thermique"},
    {"coque", "housse", "sacoche", "protection"},
]

# "Ventirad compatible Ryzen 7 5700X" designe un accessoire POUR le 5700X,
# pas un 5700X. On s'en sert uniquement quand le mot precede la reference du
# produit dans le titre : "5700X compatible AM4" reste un vrai processeur.
MARQUEURS_COMPATIBILITE = {"compatible", "compatibles", "kompatibel",
                           "adapte", "adaptee", "geeignet", "convient"}

# Formulations de rupture de stock, dans les langues des vendeurs suivis.
RUPTURE = [
    "rupture", "indisponible", "epuise", "non disponible", "plus disponible",
    "sur commande", "precommande", "bientot disponible", "nous alerter",
    "out of stock", "sold out", "unavailable", "backorder",
    "nicht verfugbar", "ausverkauft", "nicht auf lager", "vorbestellung",
    "sin stock", "agotado", "no disponible",
    "niet op voorraad", "uitverkocht",
]
DISPONIBLE = [
    "en stock", "disponible", "expedie", "livraison", "ajouter au panier",
    "in stock", "auf lager", "lieferbar", "op voorraad", "en existencia",
]

SCHEMA_RUPTURE = {"outofstock", "soldout", "discontinued", "backorder",
                  "preorder", "presale"}
SCHEMA_DISPO = {"instock", "onlineonly", "instoreonly", "limitedavailability"}

# Etat du produit. Un GPU reconditionne a 300 EUR n'est pas une occasion
# ultime sur un GPU neuf a 450 EUR : ce n'est pas le meme produit. On les
# suit separement, et chaque composant declare les etats qu'il accepte.
ETATS = {
    "reconditionne": [
        "reconditionne", "reconditionnee", "refurbished", "refurb",
        "remis a neuf", "generaluberholt", "reacondicionado", "renewed",
        "certified refurbished", "grade a", "grade b",
    ],
    "occasion": [
        "occasion", "d occasion", "seconde main", "used", "second hand",
        "gebraucht", "usado", "tweedehands", "b ware", "bware",
        "open box", "boite ouverte", "retour client", "deballe",
        "ex demo", "demonstration",
    ],
}
SCHEMA_ETAT = {
    "newcondition": "neuf", "refurbishedcondition": "reconditionne",
    "usedcondition": "occasion", "damagedcondition": "occasion",
}

# Prix affiche hors taxes. Piege classique des marchands allemands et
# neerlandais : 377,31 EUR HT parait 16 % moins cher que 449 EUR TTC et rafle
# le meilleur prix, alors que c'est le meme montant.
RE_HORS_TVA = re.compile(
    r"\bhors\s*(?:taxes?|tva)\b|\bH\.?T\.?\b(?!\w)|\bprix\s+HT\b"
    r"|\bexkl\.?\s*(?:mwst|ust)|\bzzgl\.?\s*(?:mwst|ust)|\bnetto\b"
    r"|\bexcl\.?\s*(?:vat|btw|tax)|\bex\.?\s*vat\b"
    r"|\bsin\s+iva\b|\bescl\.?\s*iva\b|\bmas\s+iva\b",
    re.IGNORECASE)
RE_TTC = re.compile(
    r"\bT\.?T\.?C\.?\b|\btoutes?\s+taxes\b|\binkl\.?\s*(?:mwst|ust)"
    r"|\bincl\.?\s*(?:vat|btw|mwst)|\bIVA\s+incl|\bbrutto\b",
    re.IGNORECASE)

# Taux de TVA du pays du vendeur, pour ramener un prix HT au prix reellement
# paye. Un achat hors UE ou en franchise ne suit pas cette regle : c'est une
# estimation destinee a comparer, pas une facture.
TVA_PAR_PAYS = {
    "FR": 0.20, "FR/DE": 0.20, "DE": 0.19, "DE/AT": 0.19, "DE/CH": 0.19,
    "AT": 0.20, "NL": 0.21, "BE": 0.21, "ES": 0.21, "IT": 0.22, "PT": 0.23,
    "DK": 0.25, "SE": 0.25, "FI": 0.255, "PL": 0.23, "IE": 0.23, "LU": 0.17,
    "CZ": 0.21, "GR": 0.24, "RO": 0.19, "HU": 0.27,
}

# Prix le plus bas des 30 derniers jours. La directive europeenne Omnibus
# impose de l'afficher des qu'une reduction est annoncee : c'est un historique
# de prix officiel, present dans la page, et jusqu'ici ignore. Sans cette
# lecture, il etait meme pris pour un prix d'achat disponible.
RE_PLUS_BAS_30J = re.compile(
    r"(?:prix|tarif)\s+le\s+plus\s+bas[^.]{0,40}?30\s*(?:derniers\s*)?jours"
    r"|30\s*derniers\s*jours[^.]{0,30}?(?:prix|tarif)"
    r"|niedrigster\s+preis[^.]{0,40}?30\s*tage"
    r"|lowest\s+price[^.]{0,40}?30\s*days"
    r"|precio\s+m[ai]s\s+bajo[^.]{0,40}?30\s*d[ií]as"
    r"|prezzo\s+pi[uù]\s+basso[^.]{0,40}?30\s*giorni"
    r"|laagste\s+prijs[^.]{0,40}?30\s*dagen",
    re.IGNORECASE)

# "A partir de 449 EUR" designe l'entree de gamme d'une famille, pas le prix
# du produit precis que l'on suit.
RE_A_PARTIR_DE = re.compile(
    r"\b(?:a\s+partir\s+de|des|ab|from|desde|vanaf|a\s+partire\s+da)\s*$"
    r"|\b(?:a\s+partir\s+de|ab|from|desde|vanaf)\s+\d",
    re.IGNORECASE)

# Un prix barre (ancien tarif) ou une mensualite ne sont pas des prix
# d'achat. Les extraire comme tels fausse le minimum retenu.
BALISES_PRIX_BARRE = {"del", "s", "strike"}
CLASSES_PRIX_BARRE = ("old", "barre", "strike", "was", "regular", "original",
                      "crossed", "previous", "before", "reference", "msrp",
                      "avant", "ancien")
RE_MENSUALITE = re.compile(
    r"(?:/|\bpar\s+|\ba\s+)?\bmois\b|/month\b|\bmonthly\b|\bmensualit|"
    r"\b\d+\s*x\s*\d|\bsans\s+frais\b|\bpaiement\s+en\s+\d",
    re.IGNORECASE)

# Lots explicites uniquement : "lot de 3". On ne touche PAS aux ecritures
# du type "2x8Go", qui decrivent la composition d'un kit memoire et non
# une quantite commandee.
RE_LOT = re.compile(
    r"\b(?:lot|pack|paquet|ensemble|set|bundle)\s+de\s+(\d{1,2})\b"
    r"|\b(\d{1,2})\s*-\s*pack\b"
    r"|\b(\d{1,2})\s+(?:unites|pieces|stuck|pcs)\b",
    re.IGNORECASE)


def detecter_etat(texte):
    """neuf / reconditionne / occasion, a partir du titre ou du schema."""
    t = normaliser(texte)
    if not t:
        return "neuf"
    court = t.replace(" ", "")
    for cle, valeur in SCHEMA_ETAT.items():
        if cle in court:
            return valeur
    for etat, mots in _vocabulaires()[2]:
        for mot in mots:
            if mot in t:
                return etat
    return "neuf"


def detecter_lot(titre):
    """Nombre d'unites vendues ensemble (1 si vente a l'unite)."""
    m = RE_LOT.search(titre or "")
    if not m:
        return 1
    for g in m.groups():
        if g:
            try:
                n = int(g)
                return n if 2 <= n <= 50 else 1
            except ValueError:
                pass
    return 1


# ---------------------------------------------------------------------------
# 1. Lecture robuste d'un prix
# ---------------------------------------------------------------------------
# L'ancien moteur lisait "1 299,00 EUR" comme 299,00 EUR (le separateur de
# milliers coupait le nombre) et ignorait completement "499 EUR" faute de
# decimales. Les deux cas sont corriges ici.

# Le \s* avant les decimales gere les prix eclates sur deux balises :
# <span>106</span><span>,99 EUR</span> devient "106 ,99 EUR" une fois le
# texte extrait, et etait lu 99,00 EUR -- une fausse bonne affaire.
_NOMBRE = (r"\d{1,3}(?:[ \u00a0.,]\d{3})*\s*(?:[.,]\d{1,2})?"
           r"|\d+\s*(?:[.,]\d{1,2})?")

_RE_PRIX = re.compile(
    r"(?:(?P<avant>€|EUR|CHF)\s*(?P<n1>" + _NOMBRE + r"))"
    r"|(?:(?P<n2>" + _NOMBRE + r")\s*(?P<apres>€|EUR\b|euros?\b|CHF))",
    re.IGNORECASE,
)


def _nombre_vers_float(texte):
    """
    Convertit un nombre ecrit a la francaise, a l'allemande ou a l'anglaise.

    Regle : quand les deux separateurs sont presents, le DERNIER est le
    separateur decimal. Quand il n'y en a qu'un et qu'il est suivi d'exactement
    trois chiffres, c'est un separateur de milliers (1,299 = 1299).
    """
    t = texte.replace("\u00a0", " ").replace(" ", "").strip()
    if not t:
        return None

    pos_virgule, pos_point = t.rfind(","), t.rfind(".")

    if pos_virgule >= 0 and pos_point >= 0:
        if pos_virgule > pos_point:                 # 1.299,00
            t = t.replace(".", "").replace(",", ".")
        else:                                        # 1,299.00
            t = t.replace(",", "")
    elif pos_virgule >= 0 or pos_point >= 0:
        sep = "," if pos_virgule >= 0 else "."
        pos = max(pos_virgule, pos_point)
        decimales = len(t) - pos - 1
        if decimales == 3 and t.count(sep) >= 1 and pos > 0:
            t = t.replace(sep, "")                   # milliers : 1,299
        else:
            t = t.replace(sep, ".")                  # decimal : 299,90
    try:
        val = float(t)
    except ValueError:
        return None
    return val if 0 < val < 100000 else None


def lire_prix_et_devise(texte, plancher=1.0, plafond=20000.0):
    """Premier montant trouve, avec sa devise. Renvoie (valeur, devise)."""
    if not texte:
        return None, None
    for m in _RE_PRIX.finditer(texte):
        brut = m.group("n1") or m.group("n2")
        val = _nombre_vers_float(brut)
        if val is not None and plancher <= val <= plafond:
            symbole = (m.group("avant") or m.group("apres") or "").upper().strip()
            devise = "CHF" if symbole.startswith("CHF") else "EUR"
            return val, devise
    return None, None


def lire_prix(texte, plancher=1.0, plafond=20000.0):
    """Premier montant trouve dans un texte, ou None."""
    return lire_prix_et_devise(texte, plancher, plafond)[0]


def convertir(valeur, devise, config=None):
    """
    Ramene un montant en euros.

    Un prix suisse lu comme des euros fait passer une carte a 449 CHF pour
    une affaire alors qu'elle vaut environ 480 EUR. Sans taux renseigne, on
    prefere ecarter l'offre plutot que d'inventer une conversion.
    """
    if not devise or devise == "EUR":
        return valeur
    taux = ((config or {}).get("taux_change") or {}).get(devise)
    if not taux:
        return None
    return round(valeur * float(taux), 2)


def lire_tous_prix(texte, plancher=1.0, plafond=20000.0):
    valeurs = []
    for m in _RE_PRIX.finditer(texte or ""):
        val = _nombre_vers_float(m.group("n1") or m.group("n2"))
        if val is not None and plancher <= val <= plafond:
            valeurs.append(val)
    return valeurs


# ---------------------------------------------------------------------------
# 2. Appariement du titre avec le produit recherche
# ---------------------------------------------------------------------------

# Retrait des accents par table de traduction : environ dix fois plus rapide
# que unicodedata.normalize suivi d'un filtrage caractere par caractere, et
# cette fonction est appelee des milliers de fois par page.
_ACCENTS = str.maketrans(
    "àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŒÆ",
    "aaaaaaceeeeiiiinooooouuuuyyeaAAAAAACEEEEIIIINOOOOOUUUUYEA")
_RE_GO = re.compile(r"(\d+)\s*(?:go|gb)\b")
_RE_TO = re.compile(r"(\d+)\s*(?:to|tb)\b")
_RE_MHZ = re.compile(r"(\d+)\s*(?:mhz|mt/s|mts)\b")
_RE_CL = re.compile(r"\bcl\s*(\d+)")
_RE_NON_ALNUM = re.compile(r"[^a-z0-9]+")


@lru_cache(maxsize=8192)
def normaliser(texte):
    """Minuscules, sans accents, unites de capacite unifiees (16 Go = 16GB)."""
    if not texte:
        return ""
    t = texte.lower().translate(_ACCENTS)
    if not t.isascii():
        t = unicodedata.normalize("NFKD", t)
        t = "".join(c for c in t if not unicodedata.combining(c))
    t = _RE_GO.sub(r"\1g", t)
    t = _RE_TO.sub(r"\1t", t)
    # L'unite MHz est supprimee : le config ecrit "3200", les revendeurs
    # ecrivent "3200MHz". Sans cela, aucune barrette de RAM n'etait reconnue.
    t = _RE_MHZ.sub(r"\1", t)
    t = _RE_CL.sub(r"cl\1", t)
    return " ".join(_RE_NON_ALNUM.sub(" ", t).split())


def jetons(texte):
    return normaliser(texte).split()


def _est_reference(jeton):
    """
    Un "jeton de reference" identifie le modele exact : 5700x, b550, 9060,
    512g. C'est ce qui distingue un 5700X d'un 5700G ou d'un 5700X3D.
    """
    a_chiffre = any(c.isdigit() for c in jeton)
    a_lettre = any(c.isalpha() for c in jeton)
    return (a_chiffre and a_lettre) or (a_chiffre and len(jeton) >= 3)


def score_pertinence(titre, terme, categorie="", exclusions=None):
    """
    Renvoie un score 0-1 indiquant si `titre` designe bien le produit `terme`.

    Rejet immediat (score 0) si :
      - un jeton de reference du terme manque dans le titre (5700X absent) ;
      - le titre contient un mot d'accessoire (cable, pate thermique...) ;
      - le titre contient un mot d'exclusion defini pour le composant.
    """
    lt = jetons(titre)
    jt = set(lt)
    jr = jetons(terme)
    if not jt or not jr:
        return 0.0

    # Un accessoire n'est un accessoire que si le mot ne fait pas partie de
    # ce qu'on cherche : "pate thermique" reste valide si on cherche de la
    # pate thermique. Les familles de synonymes evitent les faux rejets.
    contexte = set(jr) | set(jetons(categorie))
    for famille in FAMILLES:
        if famille & contexte:
            contexte |= famille
    for mot in ACCESSOIRES - contexte:
        if mot in jt:
            return 0.0

    for mot in (exclusions or []):
        if set(jetons(mot)) <= jt:
            return 0.0

    references = [j for j in jr if _est_reference(j)]
    if any(r not in jt for r in references):
        return 0.0                     # mauvais modele : rejet net

    # Accessoire annonce comme "compatible avec" le produit recherche.
    if references:
        premiere_ref = min(lt.index(r) for r in references)
        marqueurs = [i for i, j in enumerate(lt)
                     if j in MARQUEURS_COMPATIBILITE]
        if marqueurs and min(marqueurs) < premiere_ref:
            return 0.0

    forts = [j for j in jr
             if (_est_reference(j) or len(j) >= 4) and j not in MARQUES_OPTIONNELLES]
    if not forts:
        forts = [j for j in jr if j not in MARQUES_OPTIONNELLES] or jr
    presents = sum(1 for j in forts if j in jt)
    return presents / len(forts)


# ---------------------------------------------------------------------------
# 3. Disponibilite
# ---------------------------------------------------------------------------

_RUPTURE_N = None
_DISPO_N = None
_ETATS_N = None


def _vocabulaires():
    """
    Les listes de mots etaient re-normalisees a chaque appel, soit des
    dizaines de milliers de fois par page. On ne le fait plus qu'une fois.
    """
    global _RUPTURE_N, _DISPO_N, _ETATS_N
    if _RUPTURE_N is None:
        _RUPTURE_N = [normaliser(m) for m in RUPTURE]
        _DISPO_N = [normaliser(m) for m in DISPONIBLE]
        _ETATS_N = [(etat, [normaliser(m) for m in mots])
                    for etat, mots in ETATS.items()]
    return _RUPTURE_N, _DISPO_N, _ETATS_N


def lire_disponibilite(texte_ou_schema):
    """True (dispo), False (rupture), None (inconnu)."""
    t = normaliser(texte_ou_schema)
    if not t:
        return None
    rupture_n, dispo_n, _ = _vocabulaires()
    court = t.replace(" ", "")
    for mot in SCHEMA_RUPTURE:
        if mot in court:
            return False
    for mot in SCHEMA_DISPO:
        if mot in court:
            return True
    for mot in rupture_n:
        if mot in t:
            return False
    for mot in dispo_n:
        if mot in t:
            return True
    return None


# ---------------------------------------------------------------------------
# 4. Structure d'une offre
# ---------------------------------------------------------------------------

@dataclass
class Offre:
    vendeur: str
    prix: float
    titre: str = ""
    url: str = ""
    dispo: object = None              # True / False / None
    port: float = 0.0
    port_estime: bool = False
    score: float = 0.0
    methode: str = ""                 # jsonld / microdonnees / carte
    pays: str = ""
    devise: str = "EUR"
    hors_taxes: bool = False          # prix affiche HT
    tva_ajoutee: float = 0.0          # TVA reconstituee, le cas echeant
    plus_bas_30j: float = None        # plancher legal des 30 derniers jours
    prix_barre: float = None          # ancien tarif affiche rature
    verifiee: bool = False            # prix confirme sur la fiche produit
    confiance: str = "inconnue"       # haute / moyenne / faible / inconnue
    etat: str = "neuf"                # neuf / reconditionne / occasion
    quantite: int = 1                 # nombre d'unites dans le lot
    gtin: str = None                  # EAN/UPC declare (Axe 2 : identite produit)
    mpn: str = None                   # reference fabricant declaree

    @property
    def prix_unitaire(self):
        return round(self.prix / self.quantite, 2) if self.quantite > 1 else self.prix

    @property
    def prix_livre(self):
        return round(self.prix + self.port, 2)

    def __repr__(self):
        d = {True: "stock", False: "RUPTURE", None: "stock ?"}[self.dispo]
        lot = f" x{self.quantite}" if self.quantite > 1 else ""
        return (f"<{self.vendeur} {self.prix:.2f}+{self.port:.0f} "
                f"={self.prix_livre:.2f} {d} {self.etat}{lot} s={self.score:.2f}>")


# ---------------------------------------------------------------------------
# 5. Extraction des offres d'une page
# ---------------------------------------------------------------------------

def _parcourir(obj):
    """Parcourt recursivement une structure JSON-LD."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _parcourir(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _parcourir(v)


def extraire_jsonld(soup, base_url=""):
    """Offres declarees en donnees structurees schema.org."""
    offres = []
    for script in soup.find_all("script", type="application/ld+json"):
        brut = script.string or script.get_text()
        if not brut:
            continue
        try:
            data = json.loads(brut)
        except (json.JSONDecodeError, TypeError):
            continue

        for noeud in _parcourir(data):
            types = noeud.get("@type")
            types = [types] if isinstance(types, str) else (types or [])
            types = [str(t).lower() for t in types]
            if not any("product" in t for t in types):
                continue

            nom = noeud.get("name") or ""
            if isinstance(nom, dict):
                nom = nom.get("@value", "")

            offres_brutes = noeud.get("offers")
            if not offres_brutes:
                continue
            liste = offres_brutes if isinstance(offres_brutes, list) else [offres_brutes]

            for off in liste:
                if not isinstance(off, dict):
                    continue
                t_off = str(off.get("@type", "")).lower()
                cles = ("lowPrice", "price") if "aggregate" in t_off else ("price",)
                prix = None
                for cle in cles:
                    if off.get(cle) not in (None, ""):
                        prix = _nombre_vers_float(str(off[cle]))
                        if prix is not None:
                            break
                if prix is None:
                    continue

                devise = str(off.get("priceCurrency") or "EUR").upper()
                tva_incluse = off.get("valueAddedTaxIncluded")
                ht = (tva_incluse is False)
                dispo = lire_disponibilite(str(off.get("availability", "")))
                etat = detecter_etat(
                    str(off.get("itemCondition") or noeud.get("itemCondition") or "")
                    or nom)
                url = off.get("url") or noeud.get("url") or ""
                if url and base_url:
                    url = urljoin(base_url, url)

                port = 0.0
                port_connu = False
                exp = off.get("shippingDetails")
                for e in _parcourir(exp) if exp else []:
                    tarif = e.get("shippingRate")
                    if isinstance(tarif, dict) and tarif.get("value") is not None:
                        v = _nombre_vers_float(str(tarif["value"]))
                        if v is not None:
                            port, port_connu = v, True
                            break

                # Identite produit (Axe 2) : code-barres et reference
                # fabricant, quand le marchand les declare. Ce sont eux qui
                # permettent d'affirmer que deux annonces portent sur le
                # meme article -- ce que le prix seul ne dira jamais.
                _gtin = None
                for _cle in ("gtin13", "gtin14", "gtin12", "gtin8", "gtin", "ean"):
                    if noeud.get(_cle):
                        _gtin = str(noeud[_cle]).strip()
                        break
                _mpn = noeud.get("mpn") or noeud.get("sku")
                _mpn = str(_mpn).strip() if _mpn else None

                offres.append(Offre(vendeur="", prix=prix, titre=nom, url=url,
                                    dispo=dispo, port=port,
                                    port_estime=not port_connu,
                                    etat=etat, quantite=detecter_lot(nom),
                                    devise=devise, hors_taxes=ht,
                                    gtin=_gtin, mpn=_mpn,
                                    methode="jsonld"))
    return offres


def extraire_microdonnees(soup, base_url=""):
    """Offres balisees en microdonnees (itemprop), courant sur les CMS FR."""
    offres = []
    for bloc in soup.select('[itemtype*="Product" i]'):
        nom_el = bloc.select_one('[itemprop="name"]')
        nom = ""
        if nom_el:
            nom = (nom_el.get("content") or nom_el.get_text(" ", strip=True) or "")

        prix_el = bloc.select_one('[itemprop="price"], [itemprop="lowPrice"]')
        if not prix_el:
            continue
        brut = prix_el.get("content") or prix_el.get_text(" ", strip=True)
        prix = _nombre_vers_float(str(brut)) or lire_prix(str(brut))
        if prix is None:
            continue

        dispo_el = bloc.select_one('[itemprop="availability"]')
        dispo = None
        if dispo_el:
            dispo = lire_disponibilite(
                dispo_el.get("href") or dispo_el.get("content")
                or dispo_el.get_text(" ", strip=True) or "")

        lien = bloc.select_one("a[href]")
        url = urljoin(base_url, lien["href"]) if lien and base_url else (
            lien["href"] if lien else "")

        cond = bloc.select_one('[itemprop="itemCondition"]')
        etat = detecter_etat(
            (cond.get("href") or cond.get("content") or "") if cond else nom)
        offres.append(Offre(vendeur="", prix=prix, titre=nom, url=url,
                            dispo=dispo, port_estime=True,
                            etat=etat, quantite=detecter_lot(nom),
                            methode="microdonnees"))
    return offres


def _est_prix_barre(tag):
    """Ancien tarif affiche rature : ce n'est pas un prix d'achat."""
    noeud = tag
    for _ in range(4):
        if noeud is None or not getattr(noeud, "name", None):
            break
        if noeud.name in BALISES_PRIX_BARRE:
            return True
        classes = " ".join(noeud.get("class") or []).lower()
        ident = (noeud.get("id") or "").lower()
        if any(m in classes or m in ident for m in CLASSES_PRIX_BARRE):
            return True
        style = (noeud.get("style") or "").lower()
        if "line-through" in style:
            return True
        noeud = noeud.parent
    return False


# Les limites de mots sont indispensables : sans elles "8 coeurs" contient
# "eur" et etait traite comme un montant.
_RE_DEVISE = re.compile(r"€|\bEUR\b|\bCHF\b|\beuros?\b", re.IGNORECASE)
_BALISES_TITRE = ("h1", "h2", "h3", "h4", "h5", "a", "img")
_CLASSES_TITRE = ("titre", "title", "name", "nom", "libelle", "product")


def _prix_barre_dans(element, prix):
    """Le montant figure-t-il dans un tarif barre de ce bloc ?"""
    for balise in element.find_all(BALISES_PRIX_BARRE):
        if lire_prix(balise.get_text(" ", strip=True)) == prix:
            return True
    for balise in element.find_all(True):
        classes = " ".join(balise.get("class") or []).lower()
        if any(m in classes for m in CLASSES_PRIX_BARRE):
            if lire_prix(balise.get_text(" ", strip=True)) == prix:
                return True
    return False


_RE_DEBUT_DECIMAL = re.compile(r"^\s*[.,]\d")


def _debut_tronque(element, texte):
    """
    Le montant lu commence-t-il au milieu d'un nombre eclate sur deux
    balises ? Deux indices : le texte demarre par une virgule decimale
    (",99 EUR"), ou la balise precedente est un entier nu ("1" avant
    "299,00 EUR").

    Le test volontairement etroit sur l'entier nu evite de confondre avec
    une note de 4.5 etoiles placee juste avant le prix, qui donnerait un
    montant absurde en remontant.
    """
    if _RE_DEBUT_DECIMAL.match(texte):
        return True
    voisin = element.find_previous_sibling()
    if voisin is not None:
        avant = voisin.get_text(" ", strip=True)
        if avant.isdigit() and len(avant) <= 4:
            return True
    return False


def _feuilles_de_prix(soup):
    """
    Etiquettes de prix de la page.

    Optimisation : au lieu de parcourir TOUTES les balises du document et
    d'en extraire le texte (des milliers d'appels sur une page marchande),
    on part des noeuds de texte contenant un symbole monetaire et on remonte
    juste ce qu'il faut. Le nombre de balises inspectees passe de plusieurs
    milliers a quelques centaines.

    Les anciens tarifs barres et les mensualites de paiement en plusieurs
    fois sont ignores.
    """
    trouves, vus = [], set()
    for noeud in soup.find_all(string=_RE_DEVISE):
        element = noeud.parent
        # Le prix est parfois eclate sur deux balises : on remonte tant
        # qu'aucun montant complet n'est lisible.
        for _ in range(3):
            if element is None or not getattr(element, "name", None):
                break
            if element.name in ("script", "style", "noscript", "head"):
                break
            reperage = id(element)
            if reperage in vus:
                break
            texte = element.get_text(" ", strip=True)
            if len(texte) > 160:
                break
            prix, devise = lire_prix_et_devise(texte)
            if prix is None or _debut_tronque(element, texte):
                element = element.parent
                continue
            vus.add(reperage)
            if _est_prix_barre(element):
                break
            # Le montant a pu etre capte en remontant : on verifie qu'il ne
            # provient pas d'un ancien tarif barre situe dans ce bloc.
            if element is not noeud.parent and _prix_barre_dans(element, prix):
                break
            # "ou 4x 112,25 EUR sans frais" : mensualite, pas prix d'achat.
            # On ne regarde QUE le texte de l'etiquette elle-meme : elargir
            # au bloc parent ferait rejeter le vrai prix, qui cohabite
            # souvent avec la mention du paiement en plusieurs fois.
            if RE_MENSUALITE.search(texte):
                break
            # Le plancher legal des 30 derniers jours est un historique,
            # pas une offre : le compter comme prix d'achat faisait
            # enregistrer un montant indisponible.
            if RE_PLUS_BAS_30J.search(texte):
                break
            if RE_A_PARTIR_DE.search(texte):
                break
            voisin = element.find_previous_sibling()
            if voisin is not None:
                avant = voisin.get_text(" ", strip=True)
                if len(avant) <= 12 and RE_MENSUALITE.search(avant):
                    break
            trouves.append((element, prix, devise))
            break
    return trouves


def _texte_titre(el):
    """Libelle exploitable porte par une balise candidate."""
    valeur = el.get("title") or el.get("alt")
    if not valeur:
        valeur = el.get_text(" ", strip=True)
    valeur = (valeur or "").strip()
    if 6 <= len(valeur) <= 250 and lire_prix(valeur) is None:
        return valeur
    return None


def _titre_voisin(element, max_remontees=6):
    """
    Remonte depuis l'etiquette de prix jusqu'au titre du produit.

    Optimisation : l'ancienne version lancait quatorze selecteurs CSS par
    niveau, soit des milliers d'appels a soupsieve par page. On parcourt
    desormais les descendants une seule fois en testant nom de balise puis
    classe, ce qui donne le meme resultat sans moteur CSS.
    """
    noeud = element
    for niveau in range(max_remontees):
        # On inspecte d'abord le bloc du prix lui-meme : depuis que
        # l'extraction peut retenir le conteneur (cas d'un montant eclate
        # sur deux balises), le titre s'y trouve deja et remonter d'emblee
        # faisait sortir du produit.
        if niveau:
            noeud = noeud.parent
        if noeud is None or noeud.name in ("body", "html", "[document]"):
            break

        secours = None
        for el in noeud.descendants:
            if not getattr(el, "name", None):
                continue
            if el.name in _BALISES_TITRE:
                titre = _texte_titre(el)
                if titre:
                    # Un titre porte par un h1-h5 prime sur un simple lien.
                    if el.name[0] == "h":
                        return titre, noeud
                    if secours is None:
                        secours = titre
                continue
            attributs = " ".join(el.get("class") or []).lower() + " " + (el.get("id") or "").lower()
            if any(m in attributs for m in _CLASSES_TITRE):
                titre = _texte_titre(el)
                if titre and secours is None:
                    secours = titre
        if secours:
            return secours, noeud
    return None, None


def lire_plus_bas_30j(texte):
    """Plancher legal des 30 derniers jours annonce dans la page."""
    if not texte:
        return None
    m = RE_PLUS_BAS_30J.search(texte)
    if not m:
        return None
    # Le montant suit l'annonce dans la tres grande majorite des mises en page.
    apres = texte[m.end():m.end() + 60]
    valeur = lire_prix(apres)
    if valeur is None:
        avant = texte[max(0, m.start() - 60):m.start()]
        valeur = lire_prix(avant)
    return valeur


def lire_prix_barre(conteneur):
    """
    Ancien tarif rature du bloc.

    On ne le retient pas comme prix d'achat, mais sa presence prouve qu'une
    reduction est ANNONCEE. Confronte au plancher des 30 derniers jours, il
    permet de reconnaitre une fausse promotion.
    """
    if conteneur is None:
        return None
    montants = []
    for balise in conteneur.find_all(BALISES_PRIX_BARRE):
        val = lire_prix(balise.get_text(" ", strip=True))
        if val:
            montants.append(val)
    for balise in conteneur.find_all(True):
        classes = " ".join(balise.get("class") or []).lower()
        if any(mot in classes for mot in CLASSES_PRIX_BARRE):
            val = lire_prix(balise.get_text(" ", strip=True))
            if val:
                montants.append(val)
    return max(montants) if montants else None


def lire_regime_tva(texte):
    """True si le prix est affiche hors taxes, False si TTC, None si muet."""
    if not texte:
        return None
    if RE_TTC.search(texte):
        return False
    if RE_HORS_TVA.search(texte):
        return True
    return None


def extraire_cartes(soup, base_url=""):
    """
    Repli generique, sans dependre d'un selecteur CSS propre a chaque site :
    chaque etiquette de prix est rattachee au titre le plus proche au-dessus
    d'elle. C'est ce qui permet d'ajouter un vendeur sans ecrire de code.
    """
    offres = []
    for tag, prix, devise in _feuilles_de_prix(soup)[:MAX_OFFRES_PAR_PAGE * 3]:
        titre, conteneur = _titre_voisin(tag)
        if not titre:
            continue
        url = ""
        lien = conteneur.select_one("a[href]") if conteneur else None
        if lien:
            url = urljoin(base_url, lien["href"]) if base_url else lien["href"]
        contexte = conteneur.get_text(" ", strip=True) if conteneur else titre
        dispo = lire_disponibilite(contexte) if conteneur else None
        ht = lire_regime_tva(contexte[:400])
        plancher = lire_plus_bas_30j(contexte[:600])
        barre = lire_prix_barre(conteneur)
        # L'etat est souvent un badge separe du titre ("Reconditionne"),
        # d'ou la lecture du bloc entier et non du seul titre.
        etat = detecter_etat(contexte[:300])
        offres.append(Offre(vendeur="", prix=prix, titre=titre, url=url,
                            dispo=dispo, port_estime=True, etat=etat,
                            devise=devise or "EUR", hors_taxes=bool(ht),
                            plus_bas_30j=plancher, prix_barre=barre,
                            quantite=detecter_lot(titre), methode="carte"))
        if len(offres) >= MAX_OFFRES_PAR_PAGE:
            break
    return offres


def extraire_offres(html, base_url=""):
    """
    Toutes les offres d'une page, par ordre de fiabilite decroissante des
    methodes. Les doublons (meme titre, meme prix) sont fusionnes en gardant
    la version issue de la methode la plus fiable.
    """
    soup = _soupe(html)
    toutes = (extraire_jsonld(soup, base_url)
              + extraire_microdonnees(soup, base_url)
              + extraire_cartes(soup, base_url))

    vues, uniques = {}, []
    for o in toutes:
        cle = (normaliser(o.titre)[:80], round(o.prix, 2))
        if cle in vues:
            ancienne = vues[cle]
            if ancienne.dispo is None and o.dispo is not None:
                ancienne.dispo = o.dispo
            if not ancienne.url and o.url:
                ancienne.url = o.url
            continue
        vues[cle] = o
        uniques.append(o)
    return uniques


# ---------------------------------------------------------------------------
# 6. Recuperation reseau : session, rotation, politesse, reprise
# ---------------------------------------------------------------------------

class Recuperateur:
    """
    Une session HTTP par domaine (connexions reutilisees), un verrou par
    domaine (jamais deux requetes simultanees vers le meme site), et un delai
    minimum entre deux appels au meme domaine. C'est ce qui rend le
    parallelisme acceptable : on interroge 8 vendeurs a la fois, mais on
    reste poli avec chacun d'eux.
    """

    def __init__(self, delai=DELAI_MEME_DOMAINE, timeout=TIMEOUT, journal=None,
                 respecter_robots=False, budget_secondes=None,
                 delais_appris=None):
        self.delai = delai
        # Budget global : le workflow GitHub a une limite de duree. Plutot
        # que d'etre tue au milieu d'une ecriture, on s'arrete proprement et
        # on rapporte ce qui n'a pas pu etre interroge.
        self.budget = budget_secondes
        self.depart = time.time()
        self.abandons = 0
        # Delai par domaine appris des executions precedentes : un site qui
        # a renvoye 429 hier est aborde plus doucement aujourd'hui.
        self.delais = dict(delais_appris or {})
        self.timeout = timeout
        self.sessions = {}
        self.verrous = {}
        self.dernier_appel = {}
        self.cache = {}
        self.global_lock = threading.Lock()
        self.journal = journal if journal is not None else []
        self.respecter_robots = respecter_robots
        self._robots = {}
        # Latences observees par domaine (ms), pour l'observabilite historisee.
        self.latences = {}
        # --- Politesse reseau (prompt 8.3) ---
        # Echecs consecutifs par domaine : sert au backoff EXPONENTIEL a
        # l'echelle du site. Un domaine qui trebuche trois fois de suite ne
        # doit pas etre re-sollicite au meme rythme que les autres.
        self.echecs = {}
        # Compteurs, pour mesurer ce que la politesse fait gagner.
        self.compteurs = {"requetes": 0, "non_modifiees": 0, "cache_local": 0,
                          "robots_interdits": 0, "octets_economises": 0}
        # Domaines ecartes par robots.txt, pour les signaler explicitement.
        self.interdits = {}
        # Fournisseur de validateurs HTTP : injecte par price_tracker
        # (sqlite_store). Absent -> pas de cache conditionnel, rien ne casse.
        self.cache_http = None

    def _autorise(self, url):
        """
        Consulte le robots.txt du domaine. Desactive par defaut : la plupart
        des marchands interdisent tout robot, ce qui rendrait le script
        inutilisable. L'activer est le comportement le plus correct vis-a-vis
        des sites, au prix de la couverture -- a vous de trancher.
        """
        if not self.respecter_robots:
            return True
        domaine = self._domaine(url)
        with self.global_lock:
            lecteur = self._robots.get(domaine)
        if lecteur is None:
            from urllib.robotparser import RobotFileParser
            lecteur = RobotFileParser()
            lecteur.set_url(f"{urlparse(url).scheme}://{domaine}/robots.txt")
            try:
                lecteur.read()
            except Exception:
                lecteur = False          # illisible : on n'interdit pas
            with self.global_lock:
                self._robots[domaine] = lecteur
        if lecteur is False:
            return True
        try:
            return lecteur.can_fetch(NAVIGATEURS[0], url)
        except Exception:
            return True

    def _domaine(self, url):
        return urlparse(url).netloc.lower()

    def _delai_domaine(self, domaine):
        """
        Delai a respecter avant la prochaine requete vers ce domaine.

        Trois termes se combinent, on retient le plus grand :
          * le delai de politesse de base ;
          * le delai APPRIS (double a chaque 429, reutilise le lendemain) ;
          * une penalite EXPONENTIELLE fonction des echecs consecutifs du
            domaine pendant cette execution (prompt 8.3). Un site qui refuse
            trois fois de suite n'est pas re-sollicite au meme rythme : le
            retry n'est plus une propriete de la requete, mais du site.
        """
        base = max(self.delai, float(self.delais.get(domaine, 0)))
        echecs = self.echecs.get(domaine, 0)
        if echecs:
            base = max(base, min(60.0, self.delai * (2 ** min(echecs, 6))))
        return base

    def _noter_echec(self, domaine):
        with self.global_lock:
            self.echecs[domaine] = self.echecs.get(domaine, 0) + 1

    def _noter_succes(self, domaine):
        if self.echecs.get(domaine):
            with self.global_lock:
                self.echecs[domaine] = 0

    def _pause_backoff(self, tentative, domaine):
        """Backoff exponentiel plafonne, tenant compte du budget de temps."""
        pause = min(30.0, 1.5 * (2 ** (tentative - 1)))
        restant = self.temps_restant()
        if restant is not None and pause > restant:
            return False
        time.sleep(pause)
        return True

    def temps_restant(self):
        if self.budget is None:
            return None
        return self.budget - (time.time() - self.depart)

    def _session(self, domaine):
        with self.global_lock:
            if domaine not in self.sessions:
                s = requests.Session()
                s.headers.update({
                    "User-Agent": random.choice(NAVIGATEURS),
                    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
                    "Accept": "text/html,application/xhtml+xml,application/xml;"
                              "q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Encoding": "gzip, deflate",
                    "Connection": "keep-alive",
                    "Upgrade-Insecure-Requests": "1",
                })
                self.sessions[domaine] = s
                self.verrous[domaine] = threading.Lock()
                self.dernier_appel[domaine] = 0.0
            return self.sessions[domaine], self.verrous[domaine]

    def get(self, url, referer=None):
        """
        Renvoie (html, motif_echec). html vaut None en cas d'echec.

        Motif special `NON_MODIFIE` : le site a repondu 304, la page n'a pas
        change. Ce n'est PAS un echec -- l'appelant doit reutiliser le dernier
        prix connu plutot que de re-extraire.
        """
        if url in self.cache:
            self.compteurs["cache_local"] += 1
            return self.cache[url], None

        restant = self.temps_restant()
        if restant is not None and restant <= 0:
            self.abandons += 1
            return None, "budget de temps epuise"

        if not self._autorise(url):
            # Signale explicitement plutot que de se fondre dans les echecs :
            # ce n'est pas une panne, c'est un refus qu'on respecte.
            domaine_interdit = self._domaine(url)
            with self.global_lock:
                self.interdits[domaine_interdit] = \
                    self.interdits.get(domaine_interdit, 0) + 1
                self.compteurs["robots_interdits"] += 1
            return None, "interdit par robots.txt"

        domaine = self._domaine(url)
        session, verrou = self._session(domaine)
        entetes = {"Referer": referer} if referer else {}

        # --- Cache conditionnel : « as-tu change depuis ? » ---
        # On ne demande pas la page, on demande s'il faut la redemander.
        fiche = None
        if self.cache_http is not None:
            try:
                fiche = self.cache_http.lire(url)
            except Exception:
                fiche = None
        if fiche:
            if fiche.get("etag"):
                entetes["If-None-Match"] = fiche["etag"]
            if fiche.get("last_modified"):
                entetes["If-Modified-Since"] = fiche["last_modified"]

        for tentative in range(1, MAX_TENTATIVES + 1):
            with verrou:
                attente = (self._delai_domaine(domaine)
                           - (time.time() - self.dernier_appel[domaine]))
                if attente > 0:
                    restant = self.temps_restant()
                    if restant is not None and attente > restant:
                        self.abandons += 1
                        return None, "budget de temps epuise"
                    time.sleep(attente)
                _t0 = time.time()
                try:
                    r = session.get(url, headers=entetes, timeout=self.timeout,
                                    allow_redirects=True)
                except requests.RequestException as e:
                    self.dernier_appel[domaine] = time.time()
                    motif = type(e).__name__
                    self._noter_echec(domaine)
                    if tentative == MAX_TENTATIVES:
                        return None, motif
                    if not self._pause_backoff(tentative, domaine):
                        self.abandons += 1
                        return None, "budget de temps epuise"
                    continue
                self.dernier_appel[domaine] = time.time()
                self.compteurs["requetes"] += 1
                # Latence observee de la requete (hors attente de politesse),
                # relevee par domaine pour l'observabilite historisee.
                self.latences.setdefault(domaine, []).append(
                    (time.time() - _t0) * 1000.0)

            code = r.status_code

            # --- 304 : rien n'a change, inutile de re-extraire ---
            if code == 304:
                self._noter_succes(domaine)
                self.compteurs["non_modifiees"] += 1
                # Ce qu'on aurait telecharge si on n'avait pas demande.
                try:
                    self.compteurs["octets_economises"] += int(
                        r.headers.get("X-Original-Content-Length")
                        or (fiche or {}).get("taille") or 0)
                except (TypeError, ValueError):
                    pass
                if self.cache_http is not None:
                    try:
                        self.cache_http.noter_non_modifie(url)
                    except Exception:
                        pass
                return None, NON_MODIFIE

            if code == 200:
                self._noter_succes(domaine)
                # Memorise les validateurs pour la prochaine execution.
                if self.cache_http is not None:
                    try:
                        self.cache_http.memoriser(
                            url, domaine, r.headers.get("ETag"),
                            r.headers.get("Last-Modified"))
                    except Exception:
                        pass
                # Sans charset dans l'en-tete, requests suppose latin-1 et
                # "reconditionnee" devient "reconditionnAee" : l'etat du
                # produit et l'appariement du titre echouaient en silence.
                if "charset" not in (r.headers.get("Content-Type") or "").lower():
                    devine = r.apparent_encoding
                    if devine:
                        r.encoding = devine
                self.cache[url] = r.text
                return r.text, None

            # Reprise adaptee au type d'echec, au lieu de retenter a
            # l'identique : un 404 ne se repare pas, un 403 demande un autre
            # navigateur, un 429 demande d'attendre plus longtemps.
            if code in (404, 410):
                return None, f"HTTP {code}"
            if code in (403, 406) and tentative < MAX_TENTATIVES:
                session.headers["User-Agent"] = random.choice(NAVIGATEURS)
                self._noter_echec(domaine)
                if not self._pause_backoff(tentative, domaine):
                    self.abandons += 1
                    return None, "budget de temps epuise"
                continue
            if code == 429:
                # On note le domaine comme fragile : le delai retenu servira
                # aux prochains composants et sera reutilise demain.
                with self.global_lock:
                    self.delais[domaine] = min(30.0,
                                               self._delai_domaine(domaine) * 2)
                if tentative >= MAX_TENTATIVES:
                    return None, "HTTP 429"
                pause = 10.0
                try:
                    pause = min(60.0, float(r.headers.get("Retry-After", 10)))
                except ValueError:
                    pass
                restant = self.temps_restant()
                if restant is not None and pause > restant:
                    self.abandons += 1
                    return None, "budget de temps epuise"
                time.sleep(pause)
                continue
            if 500 <= code < 600 and tentative < MAX_TENTATIVES:
                self._noter_echec(domaine)
                if not self._pause_backoff(tentative, domaine):
                    self.abandons += 1
                    return None, "budget de temps epuise"
                continue
            self._noter_echec(domaine)
            return None, f"HTTP {code}"
        return None, "epuise"


# ---------------------------------------------------------------------------
# 7. Recherche d'un composant chez tous les vendeurs
# ---------------------------------------------------------------------------

def _vendeurs_actifs(config):
    """
    Vendeurs interrogeables, tries par priorite.

    Le HTTPS est exige : une boutique qui ne chiffre pas ses pages en 2026
    n'est pas un marchand ou l'on saisit une carte bancaire.
    """
    v = config.get("vendeurs") or {}
    exiger_https = config.get("thresholds", {}).get("exiger_https", True)
    liste = [(nom, d) for nom, d in v.items()
             if nom != "_comment" and d.get("actif") and d.get("url")
             and (not exiger_https or str(d["url"]).startswith("https://"))]
    liste.sort(key=lambda kv: (kv[1].get("priorite", 5),
                               0 if kv[1].get("type") == "comparateur" else 1))
    return liste


def plausible(prix, reference, bas=0.35, haut=2.5):
    """
    Deuxieme ligne de defense, apres l'appariement du titre.

    L'appariement laisse passer des annonces au bon nom mais au mauvais prix :
    coffrets collector, lots de plusieurs unites, bundles carte mere incluse.
    La fourchette est volontairement LARGE (l'ancien moteur, a plus ou moins
    45 %, rejetait de vraies promotions) et asymetrique : on tolere une forte
    baisse, qui est precisement ce qu'on cherche, mais pas un prix triple.
    """
    if not reference or reference <= 0:
        return True
    return reference * bas <= prix <= reference * haut


def _port_vendeur(config, nom, infos, prix=None):
    """
    Frais de port estimes. La franchise est prise en compte : la plupart des
    marchands livrent gratuitement au-dessus d'un seuil, et facturer 14 EUR
    de port sur une carte graphique a 450 EUR faussait le classement.
    """
    franchise = infos.get("franchise_port")
    if franchise is None:
        franchise = (config.get("franchise_port_par_defaut")
                     if isinstance(config.get("franchise_port_par_defaut"), (int, float))
                     else None)
    if franchise is not None and prix is not None and prix >= float(franchise):
        return 0.0, True

    if infos.get("frais_port") is not None:
        return float(infos["frais_port"]), False
    table = {**PORT_PAR_DEFAUT, **(config.get("frais_port_par_pays") or {})}
    valeur = table.get(infos.get("pays", "FR"), 0.0)
    try:
        return float(valeur), True
    except (TypeError, ValueError):
        return 0.0, True


def appliquer_tva(offre, infos, config):
    """
    Ramene un prix hors taxes au montant reellement paye.

    Comparer un prix HT a des prix TTC fausse tout le classement : 377,31 EUR
    HT chez un marchand allemand, c'est 448,99 EUR a payer, soit exactement le
    tarif francais. Sans cette correction, l'offre HT gagnait systematiquement.
    """
    if not offre.hors_taxes:
        return offre
    taux = infos.get("tva")
    if taux is None:
        table = {**TVA_PAR_PAYS, **(config.get("tva_par_pays") or {})}
        taux = table.get(infos.get("pays", "FR"))
    if not taux:
        return None                  # pays inconnu : on n'invente pas
    avant = offre.prix
    offre.prix = round(avant * (1 + float(taux)), 2)
    offre.tva_ajoutee = round(offre.prix - avant, 2)
    offre.hors_taxes = False
    return offre


def confiance_vendeur(nom, infos, config):
    """
    Niveau de confiance declare pour un marchand.

    Sert a deux choses : ecarter les boutiques inconnues en mode strict, et
    ponderer une offre isolee tres basse -- le signal le plus fiable d'une
    boutique frauduleuse.
    """
    val = infos.get("confiance")
    if val:
        return str(val).lower()
    return (config.get("thresholds", {})
            .get("confiance_par_defaut", "inconnue")).lower()


def etats_acceptes(component, config):
    """Etats du produit retenus pour ce composant."""
    val = component.get("etats_acceptes")
    if val is None:
        val = config.get("thresholds", {}).get("etats_acceptes_defaut", ["neuf"])
    return {str(e).lower() for e in val}


def _termes_recherche(component):
    """Terme principal, puis references constructeur, puis variantes."""
    termes = []
    for cle in ("ean", "mpn", "reference_fabricant"):
        val = component.get(cle)
        if val:
            termes.append(str(val))
    if component.get("recherche"):
        termes.append(component["recherche"])
    termes += [t for t in (component.get("recherche_variantes") or []) if t]
    if not termes and component.get("name"):
        termes.append(component["name"])
    # Dedoublonnage en conservant l'ordre
    vus, sortie = set(), []
    for t in termes:
        if t.lower() not in vus:
            vus.add(t.lower())
            sortie.append(t)
    return sortie


def _charger_offres(recuperateur, nom, infos, terme):
    """
    Telecharge la page de resultats d'un vendeur et en extrait toutes les
    offres, sans encore les rattacher a un composant. Separer cette etape du
    filtrage permet de confronter UNE page a plusieurs composants.
    """
    url = infos["url"].replace("{q}", quote_plus(terme))
    html, motif = recuperateur.get(url)
    if html is None:
        recuperateur.journal.append({"vendeur": nom, "terme": terme,
                                     "statut": "echec", "motif": motif})
        return [], url
    return extraire_offres(html, url), url


def _filtrer_pour(component, config, brutes, nom, infos, terme,
                  recuperateur=None):
    """Retient, parmi les offres d'une page, celles qui sont ce composant."""
    seuils = config.get("thresholds", {})
    seuil = seuils.get("seuil_pertinence_titre", SEUIL_PERTINENCE)
    exclusions = component.get("exclure") or []
    categorie = component.get("category", "")
    acceptes = etats_acceptes(component, config)
    autoriser_lots = seuils.get("autoriser_lots", False)
    confiance_refusee = {c.lower() for c in
                         (seuils.get("confiance_refusee") or [])}
    reference = (component.get("reference") or {}).get("typical_price")
    bas = seuils.get("plausibilite_basse", 0.35)
    haut = seuils.get("plausibilite_haute", 2.5)

    retenues, aberrants, ecartes_etat, lots = [], 0, 0, 0
    devises_ecartees = ht_ecartees = confiance_ecartees = 0
    for brute in brutes:
        o = replace(brute)                 # copie : la page sert a plusieurs
        o.score = score_pertinence(o.titre, terme, categorie, exclusions)
        if o.score < seuil:
            continue
        if o.hors_taxes:
            corrigee = appliquer_tva(o, infos, config)
            if corrigee is None:
                ht_ecartees += 1       # pays sans taux connu : on n'invente pas
                continue
        if o.devise != "EUR":
            converti = convertir(o.prix, o.devise, config)
            if converti is None:
                devises_ecartees += 1      # pas de taux : on n'invente pas
                continue
            o.prix, o.devise = converti, "EUR"
        if o.etat not in acceptes:
            ecartes_etat += 1              # reconditionne alors qu'on suit du neuf
            continue
        if o.quantite > 1 and not autoriser_lots:
            lots += 1                      # "lot de 3" : le total trompe
            continue
        if not plausible(o.prix, reference, bas, haut):
            aberrants += 1                 # bon nom, prix invraisemblable
            continue
        o.vendeur = nom
        o.pays = infos.get("pays", "")
        o.confiance = confiance_vendeur(nom, infos, config)
        if o.confiance in confiance_refusee:
            confiance_ecartees += 1
            continue
        if o.port_estime:
            o.port, o.port_estime = _port_vendeur(config, nom, infos, o.prix)
        retenues.append(o)

    if recuperateur is not None:
        recuperateur.journal.append({
            "vendeur": nom, "terme": terme, "statut": "ok",
            "composant": component.get("id"),
            "offres_page": len(brutes), "offres_retenues": len(retenues),
            "prix_aberrants": aberrants, "ecartes_etat": ecartes_etat,
            "lots": lots, "devises_ecartees": devises_ecartees,
            "ht_ecartees": ht_ecartees,
            "confiance_ecartees": confiance_ecartees,
        })
    return retenues


def interroger_vendeur(recuperateur, nom, infos, terme, component, config):
    """Interroge un vendeur pour un composant unique."""
    brutes, _ = _charger_offres(recuperateur, nom, infos, terme)
    if not brutes:
        return []
    return _filtrer_pour(component, config, brutes, nom, infos, terme,
                         recuperateur)


def interroger_vendeur_groupe(recuperateur, nom, infos, terme, membres, config):
    """
    Une seule requete, plusieurs composants servis.

    Chercher "RTX 5060 Ti" ramene une page ou figurent la 16 Go et la 8 Go :
    les deux composants sont renseignes pour le prix d'un seul appel, et un
    vendeur qui ne reference qu'une des deux variantes est quand meme
    exploite.
    """
    brutes, _ = _charger_offres(recuperateur, nom, infos, terme)
    if not brutes:
        return {}
    resultats = {}
    for comp in membres:
        propre = comp.get("recherche") or comp.get("name") or terme
        trouvees = _filtrer_pour(comp, config, brutes, nom, infos, propre,
                                 recuperateur)
        if trouvees:
            resultats[comp["id"]] = trouvees
    return resultats


def _familles(components):
    """Regroupe les composants partageant un terme de recherche large."""
    groupes = {}
    for comp in components:
        cle = comp.get("famille_recherche")
        if not cle:
            continue
        groupes.setdefault(cle, []).append(comp)
    # Un groupe d'un seul membre n'apporte rien : on le traite en solo.
    return {k: v for k, v in groupes.items() if len(v) >= 2}


def rechercher_groupe(components, config, recuperateur=None, verbeux=True):
    """
    Recherche pour un ensemble de composants, en mutualisant les requetes.

    Renvoie {id_composant: [offres triees]}. Les composants qui n'ont pas de
    famille, ou que la recherche par famille n'a pas servis, sont repris
    individuellement avec leur propre terme.
    """
    recup = recuperateur or Recuperateur()
    seuils = config.get("thresholds", {})
    workers = seuils.get("vendeurs_en_parallele", WORKERS)
    vendeurs = _vendeurs_actifs(config)
    plafond = seuils.get("max_vendeurs_par_composant") or 0
    if plafond > 0:
        vendeurs = vendeurs[:plafond]

    resultats = {}
    familles = _familles(components) if seuils.get("recherche_groupee", True) else {}

    for terme, membres in familles.items():
        if verbeux:
            noms = ", ".join(c["name"] for c in membres)
            print(f"  [famille] \"{terme}\" -> {len(membres)} composants ({noms})")
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            futurs = [pool.submit(interroger_vendeur_groupe, recup, nom, infos,
                                  terme, membres, config)
                      for nom, infos in vendeurs]
            for fut in as_completed(futurs):
                try:
                    for cid, offres in (fut.result() or {}).items():
                        resultats.setdefault(cid, []).extend(offres)
                except Exception as e:                  # pragma: no cover
                    recup.journal.append({"vendeur": "?", "statut": "erreur",
                                          "motif": repr(e)})

    # Reprise individuelle pour tout ce que la famille n'a pas couvert.
    for comp in components:
        deja = {o.vendeur for o in resultats.get(comp["id"], [])}
        manquants = [(n, d) for n, d in vendeurs if n not in deja]
        if not manquants:
            continue
        offres = _rechercher_solo(comp, config, manquants, recup, workers)
        if offres:
            resultats.setdefault(comp["id"], []).extend(offres)

    par_composant = {}
    index = {c["id"]: c for c in components}
    for cid, offres in resultats.items():
        classees = _meilleures_par_vendeur(offres)
        comp = index.get(cid)
        if comp is not None:
            classees = verifier_offres(recup, classees, comp, config)
        par_composant[cid] = classees
    return par_composant


def _rechercher_solo(component, config, vendeurs, recup, workers):
    """Interroge une liste de vendeurs pour un seul composant, avec variantes."""
    termes = _termes_recherche(component)
    if not termes or not vendeurs:
        return []
    seuils = config.get("thresholds", {})
    toutes = []

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futurs = {pool.submit(interroger_vendeur, recup, nom, infos,
                              termes[0], component, config): nom
                  for nom, infos in vendeurs}
        for fut in as_completed(futurs):
            try:
                toutes.extend(fut.result())
            except Exception as e:                      # pragma: no cover
                recup.journal.append({"vendeur": futurs[fut],
                                      "statut": "erreur", "motif": repr(e)})

    # Les vendeurs muets sont reinterroges avec une autre formulation : un
    # terme unique fait rater des marchands au moteur interne capricieux.
    muets = {n for n, _ in vendeurs} - {o.vendeur for o in toutes}
    if len(termes) > 1 and muets and seuils.get("essayer_variantes", True):
        secours = [(n, d) for n, d in vendeurs if n in muets]
        for terme in termes[1:3]:
            if not secours:
                break
            with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
                futurs = {pool.submit(interroger_vendeur, recup, nom, infos,
                                      terme, component, config): nom
                          for nom, infos in secours}
                for fut in as_completed(futurs):
                    try:
                        toutes.extend(fut.result())
                    except Exception:                   # pragma: no cover
                        pass
            muets -= {o.vendeur for o in toutes}
            secours = [(n, d) for n, d in secours if n in muets]
    return toutes


def verifier_sur_fiche(recuperateur, offre, component, config):
    """
    Rouvre la fiche produit pour confirmer le prix vu dans la liste.

    Le prix d'une page de resultats est frequemment perime, arrondi, ou
    correspond a une autre declinaison. Tant qu'une offre n'est pas
    confirmee sur sa propre fiche, elle ne devrait pas declencher d'alerte.
    """
    if not offre.url or not offre.url.startswith("http"):
        return offre, "pas d'URL de fiche"

    html, motif = recuperateur.get(offre.url)
    if html is None:
        return offre, f"fiche injoignable ({motif})"

    candidates = extraire_offres(html, offre.url)
    if not candidates:
        return offre, "aucun prix lisible sur la fiche"

    terme = component.get("recherche") or component.get("name") or ""
    seuil = config.get("thresholds", {}).get("seuil_pertinence_titre",
                                             SEUIL_PERTINENCE)
    pertinentes = [c for c in candidates
                   if score_pertinence(c.titre, terme,
                                       component.get("category", ""),
                                       component.get("exclure")) >= seuil]
    # Une fiche produit ne porte souvent qu'un seul prix : s'il n'y a rien
    # d'autre, c'est celui-la, meme si le titre est tronque.
    retenue = min(pertinentes or candidates[:1], key=lambda c: c.prix)

    confirmee = replace(offre)
    confirmee.prix = retenue.prix
    confirmee.devise = retenue.devise
    confirmee.hors_taxes = retenue.hors_taxes
    if retenue.dispo is not None:
        confirmee.dispo = retenue.dispo
    if retenue.plus_bas_30j is not None:
        confirmee.plus_bas_30j = retenue.plus_bas_30j
    confirmee.verifiee = True
    return confirmee, None


def verifier_offres(recuperateur, offres, component, config, combien=3):
    """
    Confirme les meilleures offres sur leur fiche. On se limite aux
    premieres : verifier les vingt couterait autant que la recherche entiere,
    et seules les moins cheres declenchent des alertes.
    """
    seuils = config.get("thresholds", {})
    if not seuils.get("verifier_sur_fiche", True):
        return offres
    combien = seuils.get("offres_a_verifier", combien)

    verifiees, journal = [], recuperateur.journal
    for i, offre in enumerate(offres):
        if i >= combien:
            verifiees.append(offre)
            continue
        confirmee, motif = verifier_sur_fiche(recuperateur, offre,
                                              component, config)
        if motif:
            journal.append({"vendeur": offre.vendeur, "statut": "ok",
                            "verification": motif})
        else:
            ecart = abs(confirmee.prix - offre.prix)
            if ecart >= 0.01:
                journal.append({
                    "vendeur": offre.vendeur, "statut": "ok",
                    "verification": (f"liste {offre.prix:.2f} -> "
                                     f"fiche {confirmee.prix:.2f}")})
            infos = (config.get("vendeurs") or {}).get(offre.vendeur, {})
            if confirmee.hors_taxes:
                corrigee = appliquer_tva(confirmee, infos, config)
                if corrigee is None:
                    verifiees.append(offre)
                    continue
            if confirmee.devise != "EUR":
                converti = convertir(confirmee.prix, confirmee.devise, config)
                if converti is None:
                    verifiees.append(offre)
                    continue
                confirmee.prix, confirmee.devise = converti, "EUR"
        verifiees.append(confirmee)
    return sorted(verifiees, key=_rang)


def _meilleures_par_vendeur(offres):
    """Une seule offre par vendeur : la moins chere reellement disponible."""
    meilleures = {}
    for o in offres:
        actuelle = meilleures.get(o.vendeur)
        if actuelle is None or _rang(o) < _rang(actuelle):
            meilleures[o.vendeur] = o
    return sorted(meilleures.values(), key=_rang)


def rechercher(component, config, exclure_vendeurs=None, recuperateur=None,
               verbeux=True):
    """
    Interroge TOUS les vendeurs actifs en parallele pour un composant et
    renvoie ses offres pertinentes, triees par prix livre croissant.

    L'ancien moteur s'arretait aux 8 premiers vendeurs par ordre de priorite,
    ce qui excluait definitivement 8 marchands sur 16 -- toujours les memes.
    """
    seuils = config.get("thresholds", {})
    plafond = seuils.get("max_vendeurs_par_composant") or 0
    vendeurs = _vendeurs_actifs(config)
    if exclure_vendeurs:
        vendeurs = [(n, d) for n, d in vendeurs if n not in exclure_vendeurs]
    if plafond > 0:
        vendeurs = vendeurs[:plafond]

    recup = recuperateur or Recuperateur()
    workers = seuils.get("vendeurs_en_parallele", WORKERS)
    resultat = _meilleures_par_vendeur(
        _rechercher_solo(component, config, vendeurs, recup, workers))
    resultat = verifier_offres(recup, resultat, component, config)
    if verbeux:
        _afficher(resultat, recup, component)
    return resultat


def _rang(offre):
    """Une rupture de stock est classee derriere toute offre disponible."""
    return (0 if offre.dispo is not False else 1, offre.prix_livre)


def _afficher(offres, recup, component):
    for o in offres:
        etat = {True: "en stock", False: "RUPTURE", None: "stock inconnu"}[o.dispo]
        port = (f" +{o.port:.0f} port{'~' if o.port_estime else ''}"
                if o.port else "")
        marques = []
        if o.verifiee:
            marques.append("fiche verifiee")
        if o.tva_ajoutee:
            marques.append(f"TVA +{o.tva_ajoutee:.0f}")
        if o.plus_bas_30j:
            marques.append(f"plancher 30j {o.plus_bas_30j:.0f}")
        suffixe = ("  [" + ", ".join(marques) + "]") if marques else ""
        print(f"     {o.vendeur:16} {o.prix:8.2f} EUR{port:14} {etat:14} "
              f"{o.score:.0%}{suffixe}")
    echecs = [j for j in recup.journal if j.get("statut") != "ok"]
    if echecs:
        detail = ", ".join(f"{j['vendeur']} ({j.get('motif','?')})"
                           for j in echecs[:6])
        print(f"     [!] {len(echecs)} vendeur(s) sans reponse : {detail}")


# ---------------------------------------------------------------------------
# 8. Passerelle vers price_tracker.py
# ---------------------------------------------------------------------------

def rechercher_compat(component, config, deja_vus=None, recuperateur=None):
    """
    Meme signature de sortie que l'ancien `rechercher_chez_vendeurs` :
    une liste [(nom_du_site, prix), ...]. Deux differences de fond :

    - Les ruptures de stock sont ecartees. Un prix affiche sur un produit
      indisponible n'est pas un prix : c'etait la principale source de
      fausses alertes "occasion ultime".
    - Le prix transmis est le prix LIVRE (article + port estime). Sans cela,
      le moteur classait un vendeur allemand a 112 EUR devant un francais a
      118,90 EUR alors qu'avec 14 EUR de port il revient a 126 EUR. Passer a
      false via `thresholds.comparer_prix_livre` pour revenir au prix nu.
    """
    seuils = config.get("thresholds", {})
    offres = rechercher(component, config, exclure_vendeurs=deja_vus,
                        recuperateur=recuperateur)
    garder_ruptures = seuils.get("inclure_ruptures", False)
    livre = seuils.get("comparer_prix_livre", True)
    return [(o.vendeur, o.prix_livre if livre else o.prix) for o in offres
            if garder_ruptures or o.dispo is not False]


# ---------------------------------------------------------------------------
# 9. Auto-test hors ligne
# ---------------------------------------------------------------------------

def _auto_test():
    """Verifie le moteur sur des pages fabriquees, sans aucun acces reseau."""
    ok = fail = 0

    def verifier(libelle, obtenu, attendu):
        nonlocal ok, fail
        bon = obtenu == attendu
        ok, fail = ok + bon, fail + (not bon)
        print(f"  [{'OK ' if bon else 'ECHEC'}] {libelle}")
        if not bon:
            print(f"          attendu {attendu!r}, obtenu {obtenu!r}")

    print("\n1. Lecture des prix (formats FR / DE / EN)")
    for texte, attendu in [
        ("1 299,00 €", 1299.00), ("1.299,00 €", 1299.00),
        ("€1,299.00", 1299.00), ("499€", 499.00), ("429 EUR", 429.00),
        ("134,90 €", 134.90), ("1 299 €", 1299.00), ("2 599,99 EUR", 2599.99),
    ]:
        verifier(f"{texte:14} -> {attendu}", lire_prix(texte), attendu)

    print("\n2. Appariement des titres (recherche 'AMD Ryzen 7 5700X')")
    terme = "AMD Ryzen 7 5700X"
    for titre, doit_passer in [
        ("AMD Ryzen 7 5700X 8-Core 3.4GHz Socket AM4", True),
        ("AMD Ryzen 7 5700X Boite", True),
        ("AMD Ryzen 7 5700G APU", False),
        ("AMD Ryzen 7 5700X3D 3D V-Cache", False),
        ("AMD Ryzen 5 5600", False),
        ("Ventirad compatible AMD Ryzen 7 5700X", False),
        ("Pate thermique pour Ryzen 7 5700X", False),
    ]:
        s = score_pertinence(titre, terme, "CPU")
        verifier(f"{titre[:44]:46} {'retenu' if doit_passer else 'rejete'}",
                 s >= SEUIL_PERTINENCE, doit_passer)

    print("\n3. Disponibilite")
    for texte, attendu in [
        ("https://schema.org/OutOfStock", False),
        ("https://schema.org/InStock", True),
        ("Rupture de stock", False), ("En stock, expedie sous 24h", True),
        ("Nicht auf Lager", False), ("Agotado", False),
        ("Blabla sans indication", None),
    ]:
        verifier(f"{texte[:34]:36} -> {attendu}", lire_disponibilite(texte), attendu)

    print("\n4. Page de resultats complete (le cas qui echouait avant)")
    page = """<html><body>
     <div class="r"><h3>Pate thermique Arctic MX-4 pour Ryzen</h3><span>7,90 €</span></div>
     <div class="r"><h3>Ventirad AMD Wraith compatible Ryzen 7 5700X</h3><span>24,99 €</span></div>
     <div class="r"><h3>AMD Ryzen 5 5600 6 coeurs</h3><span>98,00 €</span></div>
     <div class="r"><h3>AMD Ryzen 7 5700G APU Vega</h3><span>129,00 €</span></div>
     <div class="r"><h3>AMD Ryzen 7 5700X 8-Core Socket AM4</h3><span>134,90 €</span>
       <p>En stock</p></div>
     <div class="r"><h3>AMD Ryzen 7 5700X3D V-Cache</h3><span>189,00 €</span></div>
    </body></html>"""
    offres = [o for o in extraire_offres(page, "https://x.fr/")
              if score_pertinence(o.titre, terme, "CPU") >= SEUIL_PERTINENCE]
    verifier("une seule offre retenue", len(offres), 1)
    verifier("c'est bien le 5700X a 134,90", offres[0].prix if offres else None, 134.90)

    print("\n5. Rupture de stock a prix cassé (fausse occasion ultime)")
    page2 = """<html><body><script type="application/ld+json">
    {"@type":"Product","name":"AMD Ryzen 7 5700X",
     "offers":{"@type":"Offer","price":"109.00","priceCurrency":"EUR",
     "availability":"https://schema.org/OutOfStock"}}</script></body></html>"""
    o2 = extraire_offres(page2, "https://x.fr/")
    verifier("prix lu", o2[0].prix if o2 else None, 109.0)
    verifier("rupture detectee", o2[0].dispo if o2 else None, False)

    print("\n6. Prix a 4 chiffres (l'ancien moteur lisait 299 au lieu de 1299)")
    page3 = '<html><body><div><h3>Ecran AOC Q27G4ZR 27 pouces</h3>' \
            '<span>1 299,00 €</span></div></body></html>'
    o3 = extraire_offres(page3, "")
    verifier("1 299,00 lu correctement", o3[0].prix if o3 else None, 1299.00)

    print("\n7. Classement : frais de port et rupture")
    offres = [
        Offre("mindfactory", 429.00, "RX 9060 XT 16 Go", dispo=True, port=14),
        Offre("ldlc", 439.00, "RX 9060 XT 16 Go", dispo=True, port=0),
        Offre("cybertek", 399.00, "RX 9060 XT 16 Go", dispo=False, port=0),
    ]
    classe = sorted(offres, key=_rang)
    verifier("le moins cher livré passe devant", classe[0].vendeur, "ldlc")
    verifier("la rupture est reléguée en dernier", classe[-1].vendeur, "cybertek")

    print(f"\n{'='*54}\n  {ok} test(s) reussi(s), {fail} echec(s)\n{'='*54}")
    return fail == 0


if __name__ == "__main__":
    import sys
    if "--auto-test" in sys.argv:
        sys.exit(0 if _auto_test() else 1)
    print(__doc__)
