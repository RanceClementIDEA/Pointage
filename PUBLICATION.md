# -*- coding: utf-8 -*-
"""
probabilites.py -- probabilites empiriques par courbes de survie (Axe 4).

CE MODULE NE PREDIT RIEN.
========================
Il ne contient aucun modele, aucun apprentissage, aucune extrapolation. Il
repond a une question strictement retrospective :

    « Dans l'historique dont je dispose, a quelle FREQUENCE un prix est-il
      descendu sous X dans les N jours suivants ? »

C'est une statistique DESCRIPTIVE DU PASSE. Elle ne dit pas ce qui va se
produire ; elle dit ce qui s'est produit, et combien de fois on l'a observe.
La distinction n'est pas rhetorique :

  * une prevision affirme « le prix sera a 380 EUR en septembre » ;
  * ce module constate « un prix <= 380 EUR est apparu dans les 60 jours
    suivant un pic dans 68% des cas observes (n=14 episodes) ».

La feuille de route v3 ecarte volontairement la prevision par apprentissage :
sur un marche pilote par des annonces produit, un modele donnerait une fausse
precision. Le present module est le remplacement assume -- il quantifie
l'attente au lieu de deviner le prix.

Regles de discipline appliquees
-------------------------------
1. TOUTE probabilite est rendue avec sa taille d'echantillon `n`. Jamais un
   chiffre nu.
2. En dessous de `SEUIL_ECHANTILLON` episodes independants, AUCUN pourcentage
   n'est produit : la fonction rend « historique insuffisant pour estimer ».
   C'est la meme logique que `detecter_fausse_promo`, qui exige deux releves
   par fenetre avant de rendre un verdict.
3. Aucune extrapolation : l'horizon demande ne peut pas depasser l'etendue
   reellement observee. Au-dela, la fonction refuse plutot que de prolonger
   une courbe.
4. Les episodes se chevauchent (deux fenetres glissantes partagent des
   releves) : ce ne sont PAS des tirages independants. Le garde-fou compte
   donc un `n_effectif` d'episodes DISJOINTS, et c'est lui qui commande le
   seuil. Le nombre brut reste affiche, mais ne sert jamais a autoriser un
   pourcentage.
5. Le droit-censure est traite : une fenetre tronquee par la fin des donnees
   et sans evenement observe ne compte pas comme un echec. Elle est censuree,
   exclue du denominateur, et signalee.
"""
import statistics
from datetime import date, datetime, timedelta

# Meme exigence que la fenetre de reference de detecter_fausse_promo : en
# dessous, on se tait plutot que de deviner.
SEUIL_ECHANTILLON = 5

# Niveaux de confiance, dans le style de confidence_level / confidence_label
# deja utilise pour les conseils.
def _confiance(n):
    if n >= 30:
        return 3, "haute"
    if n >= 15:
        return 2, "moyenne"
    if n >= SEUIL_ECHANTILLON:
        return 1, "faible"
    return 0, "insuffisante"


# ---------------------------------------------------------------------------
# Preparation de la serie
# ---------------------------------------------------------------------------

def serie_journaliere(releves):
    """
    Ramene des releves bruts a un prix par jour : le MOINS CHER du jour.

    C'est le prix reellement actionnable ce jour-la, et c'est deja la regle
    retenue en production pour designer le prix courant.

    `releves` : liste de {"date": "AAAA-MM-JJ", "price": float}
    Retourne  : [(date, prix), ...] trie par date croissante.
    """
    par_jour = {}
    for r in releves:
        jour = r["date"]
        prix = float(r["price"])
        if jour not in par_jour or prix < par_jour[jour]:
            par_jour[jour] = prix
    return sorted(par_jour.items())


def _en_date(j):
    return datetime.strptime(j, "%Y-%m-%d").date() if isinstance(j, str) else j


def etendue_observee(serie):
    """Nombre de jours entre le premier et le dernier releve."""
    if len(serie) < 2:
        return 0
    return (_en_date(serie[-1][0]) - _en_date(serie[0][0])).days


def detecter_pics(serie, fenetre=14):
    """
    Maxima locaux : un jour dont le prix n'est depasse par aucun autre dans
    +/- `fenetre` jours. C'est le point de depart naturel de la question
    « combien de temps apres un pic le prix redescend-il ? ».
    """
    pics = []
    for i, (jour, prix) in enumerate(serie):
        d = _en_date(jour)
        voisins = [p for j2, p in serie
                   if abs((_en_date(j2) - d).days) <= fenetre and j2 != jour]
        if not voisins or prix >= max(voisins):
            pics.append((jour, prix))
    return pics


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------

def episodes_baisse(serie, seuil, horizon_jours, depuis="tout", fenetre_pic=14):
    """
    Construit les episodes observes.

    Un episode part d'un jour ou le prix est STRICTEMENT AU-DESSUS du seuil
    (sinon l'evenement serait deja realise), et suit la serie jusqu'a :
      * le premier jour ou le prix descend a `seuil` ou moins -> evenement ;
      * la fin de l'horizon sans evenement                     -> echec observe ;
      * la fin des donnees avant la fin de l'horizon           -> CENSURE.

    `depuis` : "tout" (chaque jour observe) ou "pic" (maxima locaux seulement).

    Retourne une liste de dicts :
        {debut, prix_debut, duree, evenement, censure, fin}
    `duree` est en jours ; `evenement` vaut True si la baisse a ete observee.
    """
    if not serie:
        return []

    departs = detecter_pics(serie, fenetre_pic) if depuis == "pic" else serie
    dernier_jour = _en_date(serie[-1][0])
    episodes = []

    for jour, prix in departs:
        if prix <= seuil:
            continue                     # evenement deja realise : pas d'attente
        d0 = _en_date(jour)
        limite = d0 + timedelta(days=horizon_jours)

        evenement = False
        duree = None
        for j2, p2 in serie:
            d2 = _en_date(j2)
            if d2 <= d0 or d2 > limite:
                continue
            if p2 <= seuil:
                evenement = True
                duree = (d2 - d0).days
                break

        if evenement:
            episodes.append({"debut": jour, "prix_debut": prix, "duree": duree,
                             "evenement": True, "censure": False,
                             "fin": (d0 + timedelta(days=duree)).isoformat()})
        else:
            observe = (min(limite, dernier_jour) - d0).days
            censure = dernier_jour < limite
            episodes.append({"debut": jour, "prix_debut": prix,
                             "duree": observe, "evenement": False,
                             "censure": censure,
                             "fin": min(limite, dernier_jour).isoformat()})

    return episodes


def episodes_disjoints(episodes):
    """
    Sous-ensemble d'episodes qui NE SE CHEVAUCHENT PAS.

    Deux fenetres glissantes qui partagent des releves ne sont pas deux
    observations independantes : compter 50 fenetres sur une serie de 60 jours
    donnerait une illusion d'echantillon. On retient donc un maximum
    d'episodes disjoints (parcours glouton par date de debut), et c'est ce
    nombre qui autorise -- ou non -- l'affichage d'un pourcentage.
    """
    retenus = []
    fin_precedente = None
    for ep in sorted(episodes, key=lambda e: e["debut"]):
        debut = _en_date(ep["debut"])
        if fin_precedente is None or debut >= fin_precedente:
            retenus.append(ep)
            fin_precedente = _en_date(ep["fin"])
    return retenus


# ---------------------------------------------------------------------------
# Courbe de survie (Kaplan-Meier)
# ---------------------------------------------------------------------------

def courbe_survie(episodes):
    """
    Estimateur de Kaplan-Meier de la fonction de survie.

    « Survivre » = ne PAS avoir vu le prix descendre sous le seuil. La courbe
    rend, pour chaque duree observee, la proportion d'episodes encore sans
    baisse. Kaplan-Meier est retenu parce qu'il traite correctement le
    droit-censure : une fenetre tronquee par la fin des donnees ne compte pas
    comme un echec, elle sort simplement du denominateur.

    C'est un estimateur NON PARAMETRIQUE : il ne suppose aucune loi, n'ajuste
    aucun modele, et n'existe qu'aux durees reellement observees. Aucune
    valeur n'est produite au-dela de la derniere observation.

    Retourne [(duree_jours, survie, n_a_risque), ...] croissant.
    """
    if not episodes:
        return []

    durees = sorted({e["duree"] for e in episodes if e["evenement"]})
    courbe = []
    survie = 1.0

    for t in durees:
        a_risque = sum(1 for e in episodes if e["duree"] >= t)
        evenements = sum(1 for e in episodes
                         if e["evenement"] and e["duree"] == t)
        if a_risque <= 0:
            continue
        survie *= (1 - evenements / a_risque)
        courbe.append((t, round(survie, 4), a_risque))

    return courbe


def _survie_a(courbe, horizon):
    """Valeur de la courbe a `horizon` jours (derniere marche atteinte)."""
    survie = 1.0
    for t, s, _ in courbe:
        if t <= horizon:
            survie = s
        else:
            break
    return survie


# ---------------------------------------------------------------------------
# Probabilite empirique -- la sortie principale
# ---------------------------------------------------------------------------

def probabilite_baisse(releves, seuil, horizon_jours, depuis="tout",
                       seuil_echantillon=SEUIL_ECHANTILLON, fenetre_pic=14):
    """
    Frequence historique a laquelle le prix est descendu sous `seuil` dans les
    `horizon_jours` suivants.

    CE N'EST PAS UNE PREVISION. C'est un comptage sur le passe observe : sur
    N episodes comparables, combien ont vu la baisse se produire. Aucune
    inference n'est faite sur l'avenir, aucune loi n'est ajustee, aucune
    valeur n'est extrapolee au-dela des donnees.

    Retourne toujours un dict, jamais un flottant nu :
        {
          "estimable": bool,        # False = pas assez de recul
          "probabilite": float|None,# en % ; None si non estimable
          "n": int,                 # episodes INDEPENDANTS (le garde-fou)
          "n_brut": int,            # episodes totaux, chevauchements compris
          "censures": int,          # fenetres tronquees par la fin des donnees
          "motif": str|None,        # pourquoi ce n'est pas estimable
          "message": str,           # phrase prete a afficher, avec n
          "confiance_level": int, "confiance_label": str,
          "courbe": [(jours, survie, a_risque), ...],
          "delai_median": int|None, # jours, si la moitie des episodes a bascule
        }
    """
    serie = serie_journaliere(releves)
    etendue = etendue_observee(serie)

    base = {"estimable": False, "probabilite": None, "n": 0, "n_brut": 0,
            "censures": 0, "motif": None, "courbe": [], "delai_median": None,
            "seuil": seuil, "horizon_jours": horizon_jours,
            "confiance_level": 0, "confiance_label": "insuffisante"}

    if len(serie) < 2:
        return {**base, "motif": "moins de deux releves",
                "message": "historique insuffisant pour estimer (n=0)"}

    # Regle 3 : pas d'extrapolation. On ne repond pas sur 60 jours quand on
    # n'observe que 20 jours d'historique.
    if horizon_jours > etendue:
        return {**base, "motif": (f"horizon de {horizon_jours} j superieur a "
                                  f"l'etendue observee ({etendue} j)"),
                "message": (f"historique insuffisant pour estimer : "
                            f"{etendue} j observes, {horizon_jours} j demandes")}

    episodes = episodes_baisse(serie, seuil, horizon_jours, depuis, fenetre_pic)
    if not episodes:
        return {**base, "motif": "aucun episode : le prix n'a jamais depasse le seuil",
                "message": (f"aucun episode comparable (le prix n'est jamais "
                            f"monte au-dessus de {seuil:.2f} EUR)")}

    # Seuls les episodes non censures repondent a « en N jours ? ».
    exploitables = [e for e in episodes if e["evenement"] or not e["censure"]]
    censures = len(episodes) - len(exploitables)

    independants = episodes_disjoints(exploitables)
    n = len(independants)
    n_brut = len(exploitables)

    if n < seuil_echantillon:
        return {**base, "n": n, "n_brut": n_brut, "censures": censures,
                "motif": f"{n} episode(s) independant(s) < {seuil_echantillon}",
                "message": (f"historique insuffisant pour estimer "
                            f"(n={n} episode(s) independant(s), "
                            f"{seuil_echantillon} requis)")}

    # --- Estimation, sur les episodes independants ---
    courbe = courbe_survie(independants)
    survie = _survie_a(courbe, horizon_jours)
    proba = round((1 - survie) * 100, 1)

    median = None
    for t, s, _ in courbe:
        if s <= 0.5:
            median = t
            break

    niveau, label = _confiance(n)
    message = (f"un prix <= {seuil:.2f} EUR est apparu dans les "
               f"{horizon_jours} jours dans {proba:.0f}% des cas "
               f"(n={n} episode(s))")
    if censures:
        message += f", {censures} fenetre(s) tronquee(s) exclue(s)"

    return {"estimable": True, "probabilite": proba, "n": n, "n_brut": n_brut,
            "censures": censures, "motif": None, "message": message,
            "confiance_level": niveau, "confiance_label": label,
            "courbe": courbe, "delai_median": median,
            "seuil": seuil, "horizon_jours": horizon_jours}


def formater(resultat):
    """Phrase courte, toujours accompagnee de n -- jamais un chiffre nu."""
    if not resultat.get("estimable"):
        return resultat.get("message", "historique insuffisant pour estimer")
    return (f"{resultat['probabilite']:.0f}% "
            f"(n={resultat['n']}, confiance {resultat['confiance_label']})")


def esperance_attente(releves, horizon_jours, prix_actuel=None,
                      seuil_echantillon=SEUIL_ECHANTILLON):
    """
    Esperance de gain a ATTENDRE `horizon_jours`, estimee sur le passe observe.

    CE N'EST PAS UNE PREVISION. On rejoue chaque fenetre historique de meme
    duree et on regarde ce qu'attendre aurait rapporte -- ou coute :

        pour chaque episode partant du jour t0 au prix p0,
        m = meilleur prix observe dans ]t0, t0+horizon]
          si m < p0 -> attendre aurait GAGNE  (p0 - m)
          si m > p0 -> attendre aurait COUTE  (m - p0)

    D'ou, en relatif (les prix d'hier ne sont pas ceux d'aujourd'hui) :

        E[gain] = P(baisse) x gain_moyen% - P(hausse) x perte_moyenne%

    Le terme soustrait est le « risque de hausse » : la frequence, sur les
    memes fenetres, ou le meilleur prix atteignable a fini PLUS CHER qu'au
    depart. Il est calcule exactement comme son symetrique -- aucune des deux
    branches n'est privilegiee.

    Memes garde-fous qu'ailleurs dans ce module : censure exclue, episodes
    disjoints seulement, refus sous `seuil_echantillon`, aucune extrapolation
    au-dela de l'etendue observee.

    Retourne toujours un dict, jamais un flottant nu.
    """
    serie = serie_journaliere(releves)
    etendue = etendue_observee(serie)

    base = {"estimable": False, "n": 0, "n_brut": 0, "censures": 0,
            "p_baisse": None, "p_hausse": None, "gain_moyen_pct": None,
            "perte_moyenne_pct": None, "esperance_pct": None,
            "esperance_eur": None, "horizon_jours": horizon_jours,
            "motif": None, "confiance_level": 0,
            "confiance_label": "insuffisante"}

    if len(serie) < 2:
        return {**base, "motif": "moins de deux releves",
                "message": "historique insuffisant pour estimer (n=0)"}

    if horizon_jours > etendue:
        return {**base,
                "motif": (f"horizon de {horizon_jours} j superieur a l'etendue "
                          f"observee ({etendue} j)"),
                "message": (f"historique insuffisant pour estimer : "
                            f"{etendue} j observes, {horizon_jours} j demandes")}

    dernier = _en_date(serie[-1][0])
    episodes = []
    for jour, p0 in serie:
        d0 = _en_date(jour)
        limite = d0 + timedelta(days=horizon_jours)
        if dernier < limite:
            continue                     # fenetre tronquee : censuree, inutilisable
        suite = [p for j2, p in serie
                 if d0 < _en_date(j2) <= limite]
        if not suite:
            continue
        meilleur = min(suite)
        episodes.append({"debut": jour, "fin": limite.isoformat(),
                         "prix_debut": p0, "meilleur": meilleur,
                         "ecart_pct": (p0 - meilleur) / p0 * 100})

    censures = sum(1 for jour, _ in serie
                   if dernier < _en_date(jour) + timedelta(days=horizon_jours))

    if not episodes:
        return {**base, "censures": censures,
                "motif": "aucune fenetre complete observee",
                "message": (f"historique insuffisant pour estimer "
                            f"(0 fenetre complete de {horizon_jours} j)")}

    independants = episodes_disjoints(episodes)
    n, n_brut = len(independants), len(episodes)

    if n < seuil_echantillon:
        return {**base, "n": n, "n_brut": n_brut, "censures": censures,
                "motif": f"{n} fenetre(s) independante(s) < {seuil_echantillon}",
                "message": (f"historique insuffisant pour estimer "
                            f"(n={n} fenetre(s) independante(s), "
                            f"{seuil_echantillon} requis)")}

    gains = [e["ecart_pct"] for e in independants if e["ecart_pct"] > 0]
    pertes = [-e["ecart_pct"] for e in independants if e["ecart_pct"] < 0]

    p_baisse = len(gains) / n * 100
    p_hausse = len(pertes) / n * 100
    gain_moyen = statistics.mean(gains) if gains else 0.0
    perte_moyenne = statistics.mean(pertes) if pertes else 0.0

    esperance_pct = (p_baisse / 100 * gain_moyen) - (p_hausse / 100 * perte_moyenne)
    esperance_eur = (prix_actuel * esperance_pct / 100) if prix_actuel else None

    niveau, label = _confiance(n)
    message = (f"attendre {horizon_jours} j a rapporte en moyenne "
               f"{esperance_pct:+.1f}% (n={n} fenetre(s) ; "
               f"baisse dans {p_baisse:.0f}% des cas de {gain_moyen:.1f}% en "
               f"moyenne, hausse dans {p_hausse:.0f}% des cas de "
               f"{perte_moyenne:.1f}%)")

    return {"estimable": True, "n": n, "n_brut": n_brut, "censures": censures,
            "p_baisse": round(p_baisse, 1), "p_hausse": round(p_hausse, 1),
            "gain_moyen_pct": round(gain_moyen, 2),
            "perte_moyenne_pct": round(perte_moyenne, 2),
            "esperance_pct": round(esperance_pct, 2),
            "esperance_eur": round(esperance_eur, 2) if esperance_eur is not None else None,
            "horizon_jours": horizon_jours, "motif": None, "message": message,
            "confiance_level": niveau, "confiance_label": label}


def seuils_candidats(releves, reference=None):
    """
    Seuils naturels a interroger pour un composant, du plus accessible au
    plus ambitieux. Tous sont tires des donnees ou de la configuration --
    aucun n'est invente.
    """
    serie = serie_journaliere(releves)
    prix = [p for _, p in serie]
    if not prix:
        return []

    candidats = []
    ref = reference or {}
    if ref.get("prix_reve"):
        candidats.append(("prix de reve", float(ref["prix_reve"])))
    if ref.get("historical_low"):
        candidats.append(("plus bas connu", float(ref["historical_low"])))
    if len(prix) >= 4:
        tries = sorted(prix)
        candidats.append(("1er quartile observe", tries[len(tries) // 4]))
    candidats.append(("mediane observee", statistics.median(prix)))

    # Deduplique en gardant l'ordre, et ecarte les seuils au-dessus du max.
    vus, retenus = set(), []
    plafond = max(prix)
    for nom, v in candidats:
        cle = round(v, 2)
        if cle in vus or v > plafond:
            continue
        vus.add(cle)
        retenus.append((nom, round(v, 2)))
    return retenus
