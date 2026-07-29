# -*- coding: utf-8 -*-
"""
identite_produit.py -- resolution d'identite produit (Axe 2).

Repond a la question que le systeme ne savait pas trancher : « ces N annonces
designent-elles le MEME produit ? », independamment du site et de l'URL.

Jusqu'ici, la recherche elargie ne disposait que de `prix_plausible` : un
filtre de fourchette de prix. Il ecarte les accessoires, mais il ne permet
jamais d'AFFIRMER qu'une annonce porte bien sur le produit cherche. D'ou des
planchers historiques calcules sur des annonces heterogenes.

Trois niveaux de correspondance, du plus sur au plus faible
-----------------------------------------------------------
  3 -- EXACTE  : GTIN/EAN identique (et valide au chiffre de controle).
                 C'est une identite au sens strict : le meme article.
  2 -- HAUTE   : MPN (reference fabricant) identique apres normalisation.
                 Tres fiable, mais un MPN peut couvrir plusieurs conditionnements.
  1 -- FAIBLE  : heuristique de titre, via moteur_recherche.score_pertinence
                 (le meme scoring que celui deja utilise pour apparier les
                 offres). Suffisant pour surveiller, insuffisant pour affirmer.
  0 -- AUCUNE  : rien ne permet de rattacher l'annonce.

Regle du veto
-------------
Un GTIN valide mais DIFFERENT de celui du produit suivi ramene la
correspondance a 0, meme si le titre ressemble a s'y meprendre. Un
code-barres qui contredit est une preuve positive qu'il s'agit d'un autre
article (autre modele, autre conditionnement, bundle) ; une ressemblance de
titre n'est qu'un indice. C'est exactement le faux positif que cette
resolution existe pour empecher -- un cable « pour RX 9060 XT » a 12 EUR ne
doit jamais fixer le plancher historique d'une carte graphique.

Le MPN, lui, ne declenche pas de veto : il est propre au fabricant, souvent
decline par conditionnement, et ses variantes de formatage sont trop
frequentes pour qu'une difference soit concluante.

L'affichage reprend le style du score de confiance des conseils
(`confidence_level` / `confidence_label`) : ici `correspondance_level` et
`correspondance_label`.
"""
import re
import unicodedata

# Le scoring de titre du moteur v3 est reutilise tel quel : il gere deja le
# rejet des accessoires, les familles de synonymes et les jetons de reference.
try:
    import moteur_recherche
    _SEUIL_TITRE = getattr(moteur_recherche, "SEUIL_PERTINENCE", 0.72)
except Exception:                                  # pragma: no cover
    moteur_recherche = None
    _SEUIL_TITRE = 0.72

# --- Niveaux de correspondance --------------------------------------------
NIVEAU_EXACT = 3
NIVEAU_MODELE = 2
NIVEAU_TITRE = 1
NIVEAU_AUCUN = 0

LABELS = {
    NIVEAU_EXACT:  "exacte (EAN)",
    NIVEAU_MODELE: "haute (MPN)",
    NIVEAU_TITRE:  "faible (titre)",
    NIVEAU_AUCUN:  "aucune",
}

# Longueurs GTIN valides (GS1) : EAN-8, UPC-A, EAN-13, GTIN-14.
_LONGUEURS_GTIN = (8, 12, 13, 14)
_RE_NON_CHIFFRE = re.compile(r"\D")
_RE_NON_ALNUM = re.compile(r"[^A-Z0-9]")


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def gtin_valide(code):
    """Chiffre de controle GS1 : ecarte les codes tronques ou inventes."""
    if not code or not code.isdigit() or len(code) not in _LONGUEURS_GTIN:
        return False
    chiffres = [int(c) for c in code]
    controle = chiffres[-1]
    corps = chiffres[:-1][::-1]        # de droite a gauche, hors cle
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(corps))
    return (10 - total % 10) % 10 == controle


def normaliser_gtin(valeur):
    """
    Rend un GTIN canonique, ou None si la valeur n'est pas exploitable.

    Un EAN-13 et le meme code sur 14 chiffres (prefixe 0) designent le meme
    article : on ramene tout a la forme la plus courte non ambigue.
    """
    if valeur is None:
        return None
    code = _RE_NON_CHIFFRE.sub("", str(valeur))
    if not code:
        return None
    # "0" de tete ajoutes par certains marchands (GTIN-14 sur un EAN-13)
    while len(code) > 13 and code.startswith("0"):
        code = code[1:]
    if len(code) not in _LONGUEURS_GTIN:
        return None
    if not gtin_valide(code):
        return None
    return code


def normaliser_mpn(valeur):
    """
    Reference fabricant comparable : majuscules, sans separateurs.

    « RX9060XT-16G-GAMING », « rx9060xt 16g gaming » et
    « RX9060XT_16G_GAMING » designent la meme reference.
    """
    if valeur is None:
        return None
    t = str(valeur).strip()
    if not t:
        return None
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = _RE_NON_ALNUM.sub("", t.upper())
    # Une reference d'un ou deux caracteres n'identifie rien.
    return t if len(t) >= 3 else None


def similarite_titre(titre, terme, categorie="", exclusions=None):
    """Score 0-1 de correspondance titre <-> terme recherche."""
    if not titre or not terme:
        return 0.0
    if moteur_recherche is not None:
        try:
            return float(moteur_recherche.score_pertinence(
                titre, terme, categorie or "", exclusions))
        except Exception:                          # pragma: no cover
            pass
    # Repli minimal si le moteur v3 est absent : recouvrement de jetons.
    def jetons(t):
        t = unicodedata.normalize("NFKD", str(t).lower())
        t = "".join(c for c in t if not unicodedata.combining(c))
        return set(re.sub(r"[^a-z0-9]+", " ", t).split())
    a, b = jetons(titre), jetons(terme)
    return len(a & b) / len(b) if b else 0.0


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def cle_canonique(gtin=None, mpn=None, terme=None):
    """
    Identifiant canonique d'un produit, prefixe par la source de l'identite.

    L'ordre reflete la solidite : un GTIN prime toujours sur un MPN, qui prime
    sur le terme de recherche. Deux annonces partageant la meme cle sont le
    meme produit -- avec la confiance du niveau correspondant.
    """
    g = normaliser_gtin(gtin)
    if g:
        return f"ean:{g}"
    m = normaliser_mpn(mpn)
    if m:
        return f"mpn:{m}"
    if terme:
        t = re.sub(r"[^a-z0-9]+", "-", str(terme).lower()).strip("-")
        if t:
            return f"terme:{t}"
    return None


def resoudre(annonce, composant, reference_gtin=None, reference_mpn=None):
    """
    Determine si `annonce` porte sur le produit decrit par `composant`.

    `annonce`  : {"gtin", "mpn", "titre", "vendeur", "url"} (champs optionnels)
    `composant`: entree de config.json (id, name, category, recherche, exclure)
    `reference_gtin` / `reference_mpn` : identite deja connue du composant
        (issue d'une annonce de niveau 3 ou 2 rencontree precedemment). C'est
        ce qui permet a une identite decouverte chez un vendeur de valider les
        annonces des autres.

    Retourne un dict :
        {correspondance_level, correspondance_label, score, methode,
         id_canonique, gtin, mpn}
    """
    gtin = normaliser_gtin(annonce.get("gtin"))
    mpn = normaliser_mpn(annonce.get("mpn"))
    ref_gtin = normaliser_gtin(reference_gtin)
    ref_mpn = normaliser_mpn(reference_mpn)
    terme = composant.get("recherche") or composant.get("name")

    # --- Niveau 3 : GTIN identique ---
    if gtin and ref_gtin and gtin == ref_gtin:
        return _resultat(NIVEAU_EXACT, 1.0, "gtin", gtin, mpn, terme)

    # --- Veto : un GTIN qui CONTREDIT vaut mieux qu'un titre qui ressemble ---
    # Si l'annonce declare un code-barres valide et qu'il differe de celui du
    # produit suivi, c'est une preuve positive qu'il s'agit d'un autre article
    # (autre modele, autre conditionnement, bundle). Un titre ressemblant ne
    # doit pas pouvoir passer outre : c'est precisement le faux positif que la
    # resolution d'identite existe pour empecher.
    if gtin and ref_gtin and gtin != ref_gtin:
        score = similarite_titre(annonce.get("titre"), terme,
                                 composant.get("category", ""),
                                 composant.get("exclure"))
        res = _resultat(NIVEAU_AUCUN, round(score, 3), "gtin_divergent",
                        gtin, mpn, terme)
        res["motif"] = (f"EAN {gtin} different de l'identite connue "
                        f"{ref_gtin} : article distinct")
        return res

    # --- Niveau 2 : MPN identique apres normalisation ---
    if mpn and ref_mpn and mpn == ref_mpn:
        return _resultat(NIVEAU_MODELE, 0.9, "mpn", gtin, mpn, terme)

    # --- Niveau 1 : heuristique de titre ---
    score = similarite_titre(annonce.get("titre"), terme,
                             composant.get("category", ""),
                             composant.get("exclure"))
    if score >= _SEUIL_TITRE:
        return _resultat(NIVEAU_TITRE, round(score, 3), "titre", gtin, mpn, terme)

    # --- Aucune correspondance ---
    # Une annonce porteuse d'un GTIN valide reste identifiable pour
    # elle-meme : elle fonde sa propre identite canonique, ce qui permettra a
    # une future annonce de s'y rattacher.
    if gtin or mpn:
        return _resultat(NIVEAU_AUCUN, round(score, 3), "inconnue", gtin, mpn, terme)
    return {"correspondance_level": NIVEAU_AUCUN,
            "correspondance_label": LABELS[NIVEAU_AUCUN],
            "score": round(score, 3), "methode": "aucune",
            "id_canonique": None, "gtin": None, "mpn": None}


def _resultat(niveau, score, methode, gtin, mpn, terme):
    return {
        "correspondance_level": niveau,
        "correspondance_label": LABELS[niveau],
        "score": score,
        "methode": methode,
        "id_canonique": cle_canonique(gtin, mpn, terme),
        "gtin": gtin,
        "mpn": mpn,
    }


def identite_de_reference(annonces):
    """
    Determine l'identite canonique d'un composant a partir des annonces
    collectees : le GTIN (puis le MPN) le plus frequemment observe.

    C'est ainsi qu'une identite decouverte chez UN vendeur devient la
    reference qui valide -- ou invalide -- les annonces de tous les autres.
    """
    compte_gtin, compte_mpn = {}, {}
    for a in annonces:
        g = normaliser_gtin(a.get("gtin"))
        if g:
            compte_gtin[g] = compte_gtin.get(g, 0) + 1
        m = normaliser_mpn(a.get("mpn"))
        if m:
            compte_mpn[m] = compte_mpn.get(m, 0) + 1

    def _majoritaire(compte):
        if not compte:
            return None
        # Tri stable : frequence decroissante, puis valeur, pour etre
        # deterministe en cas d'egalite.
        return sorted(compte.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

    return _majoritaire(compte_gtin), _majoritaire(compte_mpn)
