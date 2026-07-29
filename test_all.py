# -*- coding: utf-8 -*-
"""
sqlite_store.py -- couche de donnees SQLite du suivi de prix.

Roadmap v3, Axe 1. Depuis la bascule (prompt 6.4), SQLite est la SOURCE DE
VERITE : l'application y lit ET y ecrit. `history.json` n'est plus qu'un
export de secours, genere a la demande (`--export-history`).

Historique de ce module :
  * 6.2 -- ecriture parallele, history.json restant la source de verite ;
  * 6.4 -- bascule des lectures ; history.json n'est plus ni lu ni ecrit
           automatiquement.

Cycle de vie d'une execution :

  1. `charger_history(config)` reconstruit l'etat de travail depuis SQLite
     (memes structures qu'avant : {cid: {name, category, entries, ...}},
     plus "_slots_winners"). C'est le remplacant de load_json(history.json).
  2. Le code metier travaille en memoire, inchange.
  3. `persister(history, config)` reecrit l'etat courant dans SQLite.

Granularite : contrairement a history.json, la base CONSERVE tous les
releves. La condensation hebdomadaire au-dela de 90 jours n'est plus une
suppression mais une VUE SQL (`v_historique_hebdomadaire`) -- l'historique
complet reste interrogeable indefiniment.

Le fichier SQLite est unique, sans serveur, a la racine du projet -- donc
committable dans Git ou publiable en artefact GitHub Actions, exactement
comme history.json auparavant.
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# --- Etat du module (connexion unique, ouverte par configure) --------------
_conn = None
_enabled = False
_db_path = None
_degrade = None          # motif du mode degrade, None si tout va bien

SCHEMA = """
CREATE TABLE IF NOT EXISTS produits (
    id            TEXT PRIMARY KEY, -- identifiant du composant (config.components[].id)
    nom           TEXT,             -- name
    categorie     TEXT,             -- category
    slot          TEXT,             -- slot (groupe d'equivalence), nullable
    perf_index    REAL,             -- indice de performance, nullable
    seed_imported INTEGER DEFAULT 0 -- les seed_history ont-ils deja ete importes ?
);

CREATE TABLE IF NOT EXISTS vendeurs (
    id          TEXT PRIMARY KEY,   -- nom du vendeur / site (= "site" des releves)
    type        TEXT,               -- comparateur | marchand (si connu)
    pays        TEXT,               -- pays (si connu)
    actif       INTEGER,            -- 0/1 (si connu)
    priorite    INTEGER             -- priorite du catalogue (si connu)
);

CREATE TABLE IF NOT EXISTS evenements (
    date        TEXT,               -- AAAA-MM-JJ
    nom         TEXT,
    impact      TEXT,               -- categories impactees, serialisees "GPU,CPU"
    note        TEXT,
    PRIMARY KEY (date, nom)
);

CREATE TABLE IF NOT EXISTS releves (
    id          INTEGER PRIMARY KEY, -- cle de substitution (rowid)
    produit_id  TEXT NOT NULL,       -- -> produits.id
    vendeur_id  TEXT NOT NULL,       -- -> vendeurs.id (le "site" du releve)
    prix        REAL NOT NULL,
    ts          TEXT NOT NULL,       -- date/horodatage du releve (ISO, "date" de l'entree)
    confiance   REAL,                -- reserve : non renseigne par entree aujourd'hui (NULL)
    source_tier TEXT,                -- reserve : palier d'extraction, non dispo aujourd'hui (NULL)
    origin      TEXT                 -- provenance : seed | tracked | manuel
    -- Pas de contrainte d'unicite naturelle : un composant peut legitimement
    -- avoir plusieurs releves seed pour un meme vendeur/jour a des prix
    -- differents (import_seed_history deduplique sur date+site+PRIX). Le
    -- multiset de history.json est donc recopie a l'identique par mirror_history.
);

CREATE TABLE IF NOT EXISTS slots_winners (
    slot        TEXT PRIMARY KEY,   -- reprend history["_slots_winners"]
    winner_id   TEXT,               -- id du composant gagnant du slot
    maj_ts      TEXT                -- horodatage de la derniere mise a jour
);

-- =========================================================================
-- OBSERVABILITE HISTORISEE (Axe 7)
-- fiabilite_sites et source_health ne calculaient qu'une valeur instantanee,
-- perdue a chaque execution. On la DATE et on la CONSERVE : la question
-- « la fiabilite de LDLC s'est-elle degradee ces deux derniers mois ? »
-- devient une requete, plus une supposition.
-- =========================================================================

CREATE TABLE IF NOT EXISTS mesures_fiabilite (
    id              INTEGER PRIMARY KEY,
    ts              TEXT NOT NULL,   -- horodatage de l'execution (ISO)
    jour            TEXT NOT NULL,   -- date seule, pour les regroupements
    site            TEXT NOT NULL,
    taux            REAL,            -- taux de reussite sur la fenetre (%)
    jours_ok        INTEGER,         -- jours ou le site a repondu
    jours_total     INTEGER,         -- jours de collecte sur la fenetre
    produits        INTEGER,         -- nb de produits suivis sur ce site
    prix_plausibles INTEGER,         -- nb de prix retenus (offres pertinentes)
    latence_ms      REAL,            -- latence mediane observee, si mesurable
    statut          TEXT,            -- ok | probleme
    motif           TEXT,            -- motif releve par source_health
    fenetre_jours   INTEGER          -- largeur de la fenetre de calcul
);

-- =========================================================================
-- PROJETS (Axe 5, prompt 8.5)
-- Jusqu'ici, un seul projet d'achat existait, implicite, dissous dans
-- config.json. Le rendre explicite ne change rien pour qui n'en a qu'un --
-- mais c'est ce qui permettra d'en suivre plusieurs sans dupliquer la
-- collecte : les produits et les vendeurs restent MUTUALISES.
-- =========================================================================

CREATE TABLE IF NOT EXISTS projets (
    id            TEXT PRIMARY KEY,
    nom           TEXT,
    budget_target REAL,
    budget_max    REAL,
    devise        TEXT DEFAULT 'EUR',
    date_cible    TEXT,         -- AAAA-MM-JJ, nullable
    actif         INTEGER DEFAULT 1,
    cree_le       TEXT
);

-- Liaison projet <-> composants, avec le slot occupe DANS CE PROJET.
-- Le meme composant peut servir deux projets, avec des roles differents.
CREATE TABLE IF NOT EXISTS projet_composants (
    projet_id   TEXT NOT NULL,
    produit_id  TEXT NOT NULL,
    slot        TEXT,           -- slot du composant pour ce projet
    achete_le   TEXT,           -- date d'achat, NULL si toujours suivi
    prix_achat  REAL,
    site_achat  TEXT,
    PRIMARY KEY (projet_id, produit_id)
);

CREATE INDEX IF NOT EXISTS idx_projet_composants ON projet_composants(projet_id);

-- Cache HTTP conditionnel (Axe 3, prompt 8.3).
-- On memorise les validateurs renvoyes par chaque page pour pouvoir demander
-- « as-tu change depuis ? » plutot que de retelecharger. Un 304 economise le
-- corps de la reponse ET l'extraction : c'est la forme la plus simple de
-- politesse envers un site, et elle est prevue par le protocole lui-meme.
CREATE TABLE IF NOT EXISTS cache_http (
    url            TEXT PRIMARY KEY,
    site           TEXT,
    etag           TEXT,       -- en-tete ETag
    last_modified  TEXT,       -- en-tete Last-Modified
    dernier_prix   REAL,       -- prix extrait la derniere fois que la page a change
    dernier_palier TEXT,       -- palier de cascade correspondant
    vu_le          TEXT,       -- horodatage de la derniere reponse 200
    verifie_le     TEXT,       -- horodatage de la derniere verification (200 ou 304)
    non_modifie    INTEGER DEFAULT 0   -- nombre de 304 cumules
);

CREATE INDEX IF NOT EXISTS idx_cache_site ON cache_http(site);

-- Sante d'EXTRACTION, distincte de la sante reseau (Axe 3, prompt 8.2).
-- « Le site ne repond plus » et « le site repond mais ne rend plus de prix »
-- sont deux pannes differentes : la seconde est la signature d'un selecteur
-- casse par une refonte. Sans separer les deux, elles se confondent.
CREATE TABLE IF NOT EXISTS sante_extraction (
    id              INTEGER PRIMARY KEY,
    jour            TEXT NOT NULL,
    site            TEXT NOT NULL,
    requetes_ok     INTEGER,    -- reponses HTTP exploitables (200)
    prix_obtenus    INTEGER,    -- prix plausibles reellement extraits
    palier_dominant TEXT,       -- palier de cascade majoritaire ce jour-la
    UNIQUE(site, jour)
);

CREATE INDEX IF NOT EXISTS idx_extraction_site ON sante_extraction(site, jour);

CREATE INDEX IF NOT EXISTS idx_mesures_site ON mesures_fiabilite(site, jour);
CREATE INDEX IF NOT EXISTS idx_mesures_jour ON mesures_fiabilite(jour);

-- Une seule mesure par site et par jour : relancer le script le meme jour
-- corrige la mesure au lieu de la dupliquer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mesures_unique
    ON mesures_fiabilite(site, jour, fenetre_jours);

-- =========================================================================
-- IDENTITE PRODUIT (Axe 2) : table de correspondance canonique.
-- Un produit canonique <-> N annonces vendeurs.
-- =========================================================================

CREATE TABLE IF NOT EXISTS identites (
    id_canonique TEXT PRIMARY KEY,  -- "ean:<gtin>" | "mpn:<ref>" | "terme:<slug>"
    produit_id   TEXT,              -- composant rattache (-> produits.id)
    gtin         TEXT,              -- code-barres normalise, si connu
    mpn          TEXT,              -- reference fabricant normalisee, si connue
    libelle      TEXT,              -- libelle lisible
    niveau       INTEGER,           -- meilleur niveau de correspondance observe
    maj_ts       TEXT
);

CREATE TABLE IF NOT EXISTS annonces (
    id           INTEGER PRIMARY KEY,
    produit_id   TEXT NOT NULL,     -- composant auquel l'annonce est rattachee
    vendeur_id   TEXT NOT NULL,     -- vendeur / site
    url          TEXT,
    titre        TEXT,
    gtin         TEXT,              -- tel que declare, normalise
    mpn          TEXT,
    id_canonique TEXT,              -- -> identites.id_canonique
    niveau       INTEGER,           -- 3 exacte (EAN) | 2 haute (MPN) | 1 faible (titre) | 0 aucune
    label        TEXT,              -- libelle du niveau, style confidence_label
    score        REAL,              -- score de similarite (1.0 si EAN)
    methode      TEXT,              -- gtin | mpn | titre | aucune
    vu_le        TEXT,
    UNIQUE(produit_id, vendeur_id, url)
);

CREATE INDEX IF NOT EXISTS idx_annonces_canonique ON annonces(id_canonique);
CREATE INDEX IF NOT EXISTS idx_annonces_produit   ON annonces(produit_id);

CREATE INDEX IF NOT EXISTS idx_releves_produit ON releves(produit_id);
CREATE INDEX IF NOT EXISTS idx_releves_ts      ON releves(ts);
CREATE INDEX IF NOT EXISTS idx_releves_cle     ON releves(produit_id, vendeur_id, ts, origin);

-- =========================================================================
-- VUES DES CHEMINS CHAUDS
-- Ce sont exactement les calculs qu'analyze_component fait a la volee sur la
-- liste `entries`. Les materialiser en SQL evite de reparcourir tout
-- l'historique en Python, et prepare la Vague 7 (statistiques sur historique
-- profond). SQLite n'a pas de vue materialisee physique : ce sont des vues
-- calculees a la demande, sur des colonnes indexees.
-- =========================================================================

-- Dernier prix connu par produit ET par vendeur.
DROP VIEW IF EXISTS v_dernier_prix;
CREATE VIEW v_dernier_prix AS
SELECT r.produit_id, r.vendeur_id, r.prix, r.ts
FROM releves r
WHERE r.ts = (SELECT MAX(r2.ts) FROM releves r2
              WHERE r2.produit_id = r.produit_id
                AND r2.vendeur_id = r.vendeur_id);

-- Prix du jour retenu par produit : le moins cher du dernier jour releve
-- (meme regle qu'en production).
DROP VIEW IF EXISTS v_prix_courant;
CREATE VIEW v_prix_courant AS
SELECT r.produit_id,
       MIN(r.prix)  AS prix,
       r.ts         AS ts
FROM releves r
WHERE r.ts = (SELECT MAX(r2.ts) FROM releves r2 WHERE r2.produit_id = r.produit_id)
GROUP BY r.produit_id;

-- Plancher / plafond historiques observes, sur TOUT l'historique conserve.
DROP VIEW IF EXISTS v_plancher_historique;
CREATE VIEW v_plancher_historique AS
SELECT produit_id,
       MIN(prix)   AS plancher,
       MAX(prix)   AS plafond,
       COUNT(*)    AS nb_releves,
       MIN(ts)     AS premier_releve,
       MAX(ts)     AS dernier_releve
FROM releves
GROUP BY produit_id;

-- Moyennes glissantes 7 / 30 / 90 jours.
DROP VIEW IF EXISTS v_moyennes_glissantes;
CREATE VIEW v_moyennes_glissantes AS
SELECT produit_id,
       AVG(CASE WHEN ts >= date('now', '-7 days')  THEN prix END) AS avg_7j,
       AVG(CASE WHEN ts >= date('now', '-30 days') THEN prix END) AS avg_30j,
       AVG(CASE WHEN ts >= date('now', '-90 days') THEN prix END) AS avg_90j,
       COUNT(CASE WHEN ts >= date('now', '-7 days')  THEN 1 END)  AS n_7j,
       COUNT(CASE WHEN ts >= date('now', '-30 days') THEN 1 END)  AS n_30j,
       COUNT(CASE WHEN ts >= date('now', '-90 days') THEN 1 END)  AS n_90j
FROM releves
GROUP BY produit_id;

-- =========================================================================
-- VUES FUSIONNEES PAR IDENTITE CANONIQUE (Axe 2, point 3)
-- Le plancher et le prix courant refletent enfin le VRAI minimum tous
-- vendeurs confondus -- et non plus seulement les `sources` listees dans la
-- configuration du composant.
-- =========================================================================

-- Chaque releve rattache a son identite canonique, via l'annonce du vendeur.
DROP VIEW IF EXISTS v_releves_canoniques;
CREATE VIEW v_releves_canoniques AS
SELECT a.id_canonique,
       a.niveau      AS niveau_correspondance,
       r.produit_id,
       r.vendeur_id,
       r.prix,
       r.ts,
       r.origin
FROM releves r
JOIN annonces a
  ON a.produit_id = r.produit_id
 AND a.vendeur_id = r.vendeur_id
WHERE a.id_canonique IS NOT NULL;

-- Plancher / plafond par identite canonique, tous vendeurs confondus.
-- `niveau_min` dit sur quelle qualite de correspondance repose l'agregat :
-- un plancher fonde sur une simple heuristique de titre vaut moins qu'un
-- plancher fonde sur des EAN identiques.
DROP VIEW IF EXISTS v_prix_canonique;
CREATE VIEW v_prix_canonique AS
SELECT id_canonique,
       MIN(prix)                  AS plancher,
       MAX(prix)                  AS plafond,
       COUNT(*)                   AS nb_releves,
       COUNT(DISTINCT vendeur_id) AS nb_vendeurs,
       MIN(niveau_correspondance) AS niveau_min,
       MAX(niveau_correspondance) AS niveau_max,
       MIN(ts)                    AS premier_releve,
       MAX(ts)                    AS dernier_releve
FROM v_releves_canoniques
GROUP BY id_canonique;

-- Prix courant par identite canonique : le moins cher du dernier jour releve,
-- tous vendeurs confondus.
DROP VIEW IF EXISTS v_prix_courant_canonique;
CREATE VIEW v_prix_courant_canonique AS
SELECT rc.id_canonique,
       MIN(rc.prix) AS prix,
       rc.ts        AS ts
FROM v_releves_canoniques rc
WHERE rc.ts = (SELECT MAX(rc2.ts) FROM v_releves_canoniques rc2
               WHERE rc2.id_canonique = rc.id_canonique)
GROUP BY rc.id_canonique;

-- Evolution de la fiabilite : derniere mesure, moyennes sur 30 et 60 jours,
-- et tendance (positive = amelioration). C'est la vue qui repond a
-- « ce site s'est-il degrade ? » sans supposition.
DROP VIEW IF EXISTS v_fiabilite_evolution;
CREATE VIEW v_fiabilite_evolution AS
SELECT site,
       COUNT(*)                                                      AS nb_mesures,
       MIN(jour)                                                     AS depuis,
       MAX(jour)                                                     AS jusqu_a,
       AVG(CASE WHEN jour >= date('now', '-30 days') THEN taux END)  AS taux_30j,
       AVG(CASE WHEN jour <  date('now', '-30 days')
                 AND jour >= date('now', '-60 days') THEN taux END)  AS taux_30_60j,
       AVG(CASE WHEN jour >= date('now', '-30 days') THEN taux END)
     - AVG(CASE WHEN jour <  date('now', '-30 days')
                 AND jour >= date('now', '-60 days') THEN taux END)  AS tendance,
       AVG(latence_ms)                                               AS latence_moyenne_ms,
       SUM(prix_plausibles)                                          AS prix_plausibles_total
FROM mesures_fiabilite
GROUP BY site;

-- Condensation hebdomadaire : REMPLACE l'ancien archiver_historique, qui
-- SUPPRIMAIT les releves de plus de 90 jours. Ici, rien n'est detruit --
-- la granularite complete reste en base, et cette vue offre la lecture
-- condensee (un point par semaine, le minimum) quand elle est utile.
DROP VIEW IF EXISTS v_historique_hebdomadaire;
CREATE VIEW v_historique_hebdomadaire AS
SELECT produit_id,
       strftime('%Y-%W', ts) AS semaine,
       MIN(ts)               AS debut_semaine,
       MIN(prix)             AS prix_min,
       AVG(prix)             AS prix_moyen,
       COUNT(*)              AS nb_releves
FROM releves
GROUP BY produit_id, strftime('%Y-%W', ts);
"""


# --- Infrastructure --------------------------------------------------------

def configure(db_path, enabled=True):
    """Ouvre (ou reouvre) la base et cree le schema. A appeler une fois."""
    global _conn, _enabled, _db_path
    _enabled = bool(enabled)
    _db_path = str(db_path)
    if not _enabled:
        _conn = None
        return
    global _degrade
    _degrade = None
    existait = Path(_db_path).exists()
    try:
        # timeout court : si la base est verrouillee par un autre processus,
        # on veut le savoir tout de suite, pas rester bloque plusieurs minutes.
        #
        # check_same_thread=False : la connexion doit etre utilisable depuis
        # les threads du moteur de collecte. Celui-ci interroge les vendeurs
        # par lots de 8 en parallele, et chaque worker consulte le cache HTTP
        # conditionnel (8.3). Sans cela, sqlite3 refuse l'acces hors du thread
        # d'ouverture -- l'erreur etait absorbee par `_avertir`, donc le cache
        # rendait None a CHAQUE appel : aucune requete conditionnelle n'etait
        # emise et chaque page etait retelechargee en entier. La politesse
        # reseau du prompt 8.3 etait annulee en silence.
        #
        # C'est sur : sqlite3.threadsafety vaut 3 (mode « serialized »), donc
        # la bibliotheque serialise elle-meme les acces concurrents. Aucun
        # verrou externe n'est necessaire.
        _conn = sqlite3.connect(_db_path, timeout=5.0, check_same_thread=False)
        # Un fichier peut s'ouvrir sans erreur et n'etre pas une base valide :
        # seule une vraie lecture le revele.
        _conn.execute("PRAGMA quick_check(1)").fetchone()
        _migrer(_conn)
        _conn.executescript(SCHEMA)
        _conn.commit()
    except Exception as e:
        motif = _diagnostiquer(e, existait)
        _degrade = motif
        _avertir(f"base inutilisable : {motif}")
        try:
            if _conn is not None:
                _conn.close()
        except Exception:
            pass
        _conn = None
        _enabled = False


def _diagnostiquer(erreur, existait):
    """Traduit une exception SQLite en motif comprehensible."""
    texte = str(erreur).lower()
    if "locked" in texte or "busy" in texte:
        return "fichier verrouille par un autre processus"
    if "not a database" in texte or "malformed" in texte or "corrupt" in texte:
        return "fichier corrompu ou illisible"
    if "unable to open" in texte or "permission" in texte or "denied" in texte:
        return ("acces refuse au fichier" if existait
                else "impossible de creer le fichier")
    if "readonly" in texte or "read-only" in texte:
        return "fichier en lecture seule"
    return f"{type(erreur).__name__}: {erreur}"


def etat():
    """
    Diagnostic de la couche de donnees, pour le mode degrade et pour le
    controle d'installation (demarrer.py, option 8).
    """
    infos = {"chemin": _db_path, "actif": est_actif(),
             "degrade": _degrade, "existe": bool(_db_path and Path(_db_path).exists())}
    if infos["existe"]:
        try:
            infos["taille_octets"] = Path(_db_path).stat().st_size
        except Exception:
            infos["taille_octets"] = None
    if est_actif():
        try:
            c = _conn.cursor()
            infos["releves"] = c.execute("SELECT COUNT(*) FROM releves").fetchone()[0]
            infos["produits"] = c.execute("SELECT COUNT(*) FROM produits").fetchone()[0]
            infos["mesures"] = c.execute(
                "SELECT COUNT(*) FROM mesures_fiabilite").fetchone()[0]
            infos["annonces"] = c.execute("SELECT COUNT(*) FROM annonces").fetchone()[0]
            row = c.execute("SELECT MIN(ts), MAX(ts) FROM releves").fetchone()
            infos["premier_releve"], infos["dernier_releve"] = row if row else (None, None)
        except Exception as e:                    # pragma: no cover (defensif)
            infos["erreur_lecture"] = str(e)
    return infos


def _migrer(conn):
    """Fait evoluer une base creee par une version anterieure du schema."""
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    if "produits" in tables:
        colonnes = {r[1] for r in conn.execute("PRAGMA table_info(produits)")}
        if "seed_imported" not in colonnes:
            conn.execute("ALTER TABLE produits ADD COLUMN seed_imported INTEGER DEFAULT 0")
            conn.commit()


def est_actif():
    return _enabled and _conn is not None


def fermer():
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
        _conn = None


def _avertir(msg):
    print(f"[sqlite] {msg}", file=sys.stderr)


_lecture_seule = False


def lecture_seule(actif=True):
    """
    Interdit toute ecriture de donnees, en laissant les lectures intactes.

    Sert aux essais a blanc (`--dry-run`) : les prix simules ne doivent pas
    entrer dans l'historique, sous peine d'y devenir indiscernables de vrais
    releves et de contaminer plancher, alertes et probabilites.

    Le verrou est pose ICI plutot qu'aux appelants : les ecritures partent de
    plusieurs endroits (`record_releve` au fil de l'eau, `persister` en fin
    de cycle), et une garantie qui depend du bon vouloir de chaque appelant
    n'en est pas une. La creation du schema et les migrations restent
    autorisees : elles ne portent aucune donnee.
    """
    global _lecture_seule
    _lecture_seule = bool(actif)


def est_en_lecture_seule():
    return _lecture_seule


def _ecrire(operation):
    """Execute une ecriture en absorbant toute erreur (garantit le risque nul)."""
    if not est_actif() or _lecture_seule:
        return
    try:
        operation(_conn)
        _conn.commit()
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"ecriture ignoree ({e})")
        try:
            _conn.rollback()
        except Exception:
            pass


# --- Ecritures incrementales (branchees sur les mutations de history) ------

def upsert_produit(produit_id, nom, categorie, slot=None, perf_index=None):
    def op(c):
        c.execute(
            """INSERT INTO produits(id, nom, categorie, slot, perf_index)
                 VALUES(?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 nom        = excluded.nom,
                 categorie  = excluded.categorie,
                 slot       = COALESCE(excluded.slot, produits.slot),
                 perf_index = COALESCE(excluded.perf_index, produits.perf_index)""",
            (produit_id, nom, categorie, slot, perf_index))
    _ecrire(op)


def record_releve(produit_id, vendeur_id, prix, ts, origin,
                  confiance=None, source_tier=None):
    """Equivalent SQLite d'une entree ajoutee a node['entries'] (ecriture au fil
    de l'eau). L'etat final exact est garanti par mirror_history, appele a
    chaque sauvegarde de history.json."""
    def op(c):
        c.execute("INSERT OR IGNORE INTO vendeurs(id) VALUES(?)", (vendeur_id,))
        c.execute(
            """INSERT INTO releves(produit_id, vendeur_id, prix, ts,
                                   confiance, source_tier, origin)
                 VALUES(?,?,?,?,?,?,?)""",
            (produit_id, vendeur_id, float(prix), ts, confiance, source_tier, origin))
    _ecrire(op)


def set_slot_winner(slot, winner_id):
    def op(c):
        c.execute(
            """INSERT INTO slots_winners(slot, winner_id, maj_ts)
                 VALUES(?,?,?)
               ON CONFLICT(slot) DO UPDATE SET
                 winner_id = excluded.winner_id,
                 maj_ts    = excluded.maj_ts""",
            (slot, winner_id, datetime.now().isoformat(timespec="seconds")))
    _ecrire(op)


def marquer_seed_importe(produit_id):
    def op(c):
        c.execute("UPDATE produits SET seed_imported = 1 WHERE id = ?", (produit_id,))
    _ecrire(op)


# --- OBSERVABILITE HISTORISEE (Axe 7) -------------------------------------

def enregistrer_mesures_fiabilite(mesures, fenetre_jours=30, jour=None):
    """
    Date et conserve les mesures de fiabilite d'une execution.

    `mesures` : liste de dicts {site, taux, jours_ok, jours_total, produits,
                prix_plausibles, latence_ms, statut, motif}

    Une seule mesure par (site, jour, fenetre) : relancer le script le meme
    jour corrige la mesure au lieu de la dupliquer.
    """
    if not mesures:
        return 0
    maintenant = datetime.now()
    jour = jour or maintenant.strftime("%Y-%m-%d")
    ts = maintenant.isoformat(timespec="seconds")

    ecrites = [0]

    def op(c):
        for m in mesures:
            if not m.get("site"):
                continue
            c.execute(
                """INSERT INTO mesures_fiabilite
                     (ts, jour, site, taux, jours_ok, jours_total, produits,
                      prix_plausibles, latence_ms, statut, motif, fenetre_jours)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(site, jour, fenetre_jours) DO UPDATE SET
                     ts=excluded.ts, taux=excluded.taux,
                     jours_ok=excluded.jours_ok, jours_total=excluded.jours_total,
                     produits=excluded.produits,
                     prix_plausibles=excluded.prix_plausibles,
                     latence_ms=excluded.latence_ms,
                     statut=excluded.statut, motif=excluded.motif""",
                (ts, jour, m["site"], m.get("taux"), m.get("jours_ok"),
                 m.get("jours_total"), m.get("produits"),
                 m.get("prix_plausibles"), m.get("latence_ms"),
                 m.get("statut", "ok"), m.get("motif"), fenetre_jours))
            ecrites[0] += 1

    _ecrire(op)
    return ecrites[0]


# --- PROJETS (Axe 5) -------------------------------------------------------

def enregistrer_projet(projet_id, nom=None, budget_target=None, budget_max=None,
                       devise="EUR", date_cible=None, actif=True):
    """Cree ou met a jour un projet."""
    def op(c):
        c.execute(
            """INSERT INTO projets(id, nom, budget_target, budget_max, devise,
                                   date_cible, actif, cree_le)
                 VALUES(?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 nom=excluded.nom,
                 budget_target=excluded.budget_target,
                 budget_max=excluded.budget_max,
                 devise=excluded.devise,
                 date_cible=excluded.date_cible,
                 actif=excluded.actif""",
            (projet_id, nom, budget_target, budget_max, devise, date_cible,
             1 if actif else 0, datetime.now().isoformat(timespec="seconds")))
    _ecrire(op)


def lier_composants(projet_id, liaisons):
    """
    Rattache des composants a un projet.

    `liaisons` : [{produit_id, slot, achete_le, prix_achat, site_achat}, ...]
    Remplacement integral du perimetre du projet : un composant retire de la
    configuration doit disparaitre du projet, pas y survivre.
    """
    def op(c):
        c.execute("DELETE FROM projet_composants WHERE projet_id = ?", (projet_id,))
        for l in liaisons:
            c.execute(
                """INSERT INTO projet_composants
                     (projet_id, produit_id, slot, achete_le, prix_achat, site_achat)
                   VALUES(?,?,?,?,?,?)""",
                (projet_id, l.get("produit_id"), l.get("slot"),
                 l.get("achete_le"), l.get("prix_achat"), l.get("site_achat")))
    _ecrire(op)


def charger_projets(actifs_seulement=False):
    """Liste des projets connus."""
    if not est_actif():
        return []
    try:
        sql = ("SELECT id, nom, budget_target, budget_max, devise, date_cible, "
               "actif FROM projets")
        if actifs_seulement:
            sql += " WHERE actif = 1"
        sql += " ORDER BY cree_le, id"
        cles = ("id", "nom", "budget_target", "budget_max", "devise",
                "date_cible", "actif")
        return [dict(zip(cles, r)) for r in _conn.execute(sql)]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture des projets impossible ({e})")
        return []


def composants_du_projet(projet_id):
    """Composants rattaches a un projet, achetes ou non."""
    if not est_actif():
        return []
    try:
        cles = ("produit_id", "slot", "achete_le", "prix_achat", "site_achat")
        return [dict(zip(cles, r)) for r in _conn.execute(
            "SELECT produit_id, slot, achete_le, prix_achat, site_achat "
            "FROM projet_composants WHERE projet_id = ? ORDER BY produit_id",
            (projet_id,))]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture des composants du projet impossible ({e})")
        return []


def lire_cache_http(url):
    """Validateurs et dernier prix connu pour une URL, ou None."""
    if not est_actif() or not url:
        return None
    try:
        row = _conn.execute(
            "SELECT url, site, etag, last_modified, dernier_prix, "
            "dernier_palier, vu_le, verifie_le, non_modifie "
            "FROM cache_http WHERE url = ?", (url,)).fetchone()
        if not row:
            return None
        return dict(zip(("url", "site", "etag", "last_modified", "dernier_prix",
                         "dernier_palier", "vu_le", "verifie_le", "non_modifie"),
                        row))
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture du cache HTTP impossible ({e})")
        return None


def memoriser_cache_http(url, site=None, etag=None, last_modified=None,
                         prix=None, palier=None, modifie=True):
    """
    Met a jour les validateurs d'une URL.

    `modifie=False` correspond a un 304 : la page n'a pas bouge, on ne touche
    ni au prix ni aux validateurs -- on note seulement qu'on a verifie.
    """
    if not url:
        return
    maintenant = datetime.now().isoformat(timespec="seconds")

    def op(c):
        if not modifie:
            c.execute(
                "UPDATE cache_http SET verifie_le = ?, "
                "non_modifie = COALESCE(non_modifie, 0) + 1 WHERE url = ?",
                (maintenant, url))
            return
        c.execute(
            """INSERT INTO cache_http(url, site, etag, last_modified,
                                      dernier_prix, dernier_palier,
                                      vu_le, verifie_le, non_modifie)
                 VALUES(?,?,?,?,?,?,?,?,0)
               ON CONFLICT(url) DO UPDATE SET
                 site=COALESCE(excluded.site, cache_http.site),
                 -- COALESCE et non ecrasement : le prix est memorise par un
                 -- appel SEPARE de celui qui enregistre les validateurs.
                 -- Sans cela, le second appel effacerait l'ETag du premier,
                 -- et aucun 304 ne pourrait plus etre obtenu.
                 etag=COALESCE(excluded.etag, cache_http.etag),
                 last_modified=COALESCE(excluded.last_modified, cache_http.last_modified),
                 dernier_prix=COALESCE(excluded.dernier_prix, cache_http.dernier_prix),
                 dernier_palier=COALESCE(excluded.dernier_palier, cache_http.dernier_palier),
                 vu_le=excluded.vu_le,
                 verifie_le=excluded.verifie_le,
                 non_modifie=0""",
            (url, site, etag, last_modified, prix, palier, maintenant, maintenant))

    _ecrire(op)


def statistiques_cache():
    """Etat du cache : combien d'URLs suivies, combien de 304 cumules."""
    if not est_actif():
        return {}
    try:
        row = _conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(non_modifie), 0), "
            "COUNT(CASE WHEN etag IS NOT NULL OR last_modified IS NOT NULL "
            "THEN 1 END) FROM cache_http").fetchone()
        return {"urls": row[0], "non_modifies_cumules": row[1],
                "avec_validateur": row[2]}
    except Exception:                             # pragma: no cover (defensif)
        return {}


def enregistrer_sante_extraction(mesures, jour=None):
    """
    Enregistre, par site et par jour : combien de requetes ont abouti (HTTP)
    et combien de prix en ont ete extraits.

    `mesures` : {site: {"ok": int, "prix": int, "palier": str|None}}
    """
    if not mesures:
        return 0
    jour = jour or datetime.now().strftime("%Y-%m-%d")
    ecrites = [0]

    def op(c):
        for site, m in mesures.items():
            c.execute(
                """INSERT INTO sante_extraction
                     (jour, site, requetes_ok, prix_obtenus, palier_dominant)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(site, jour) DO UPDATE SET
                     requetes_ok=excluded.requetes_ok,
                     prix_obtenus=excluded.prix_obtenus,
                     palier_dominant=excluded.palier_dominant""",
                (jour, site, m.get("ok", 0), m.get("prix", 0), m.get("palier")))
            ecrites[0] += 1

    _ecrire(op)
    return ecrites[0]


def historique_extraction(site=None, depuis=None):
    """Serie {jour, site, requetes_ok, prix_obtenus, palier_dominant}."""
    if not est_actif():
        return []
    try:
        sql = ("SELECT jour, site, requetes_ok, prix_obtenus, palier_dominant "
               "FROM sante_extraction WHERE 1=1")
        params = []
        if site:
            sql += " AND site = ?"
            params.append(site)
        if depuis:
            sql += " AND jour >= ?"
            params.append(depuis)
        sql += " ORDER BY site, jour"
        cles = ("jour", "site", "requetes_ok", "prix_obtenus", "palier_dominant")
        return [dict(zip(cles, r)) for r in _conn.execute(sql, params)]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture de la sante d'extraction impossible ({e})")
        return []


def evolution_fiabilite(site=None):
    """
    Repond a « ce site s'est-il degrade ? » : moyenne des 30 derniers jours
    comparee aux 30 jours precedents, et tendance (positive = amelioration).
    """
    if not est_actif():
        return []
    try:
        sql = ("SELECT site, nb_mesures, depuis, jusqu_a, taux_30j, "
               "taux_30_60j, tendance, latence_moyenne_ms, prix_plausibles_total "
               "FROM v_fiabilite_evolution")
        params = ()
        if site:
            sql += " WHERE site = ?"
            params = (site,)
        sql += " ORDER BY site"
        cles = ("site", "nb_mesures", "depuis", "jusqu_a", "taux_30j",
                "taux_30_60j", "tendance", "latence_moyenne_ms",
                "prix_plausibles_total")
        return [dict(zip(cles, r)) for r in _conn.execute(sql, params)]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture de l'evolution impossible ({e})")
        return []


def historique_fiabilite(site, depuis=None):
    """Serie temporelle brute des mesures d'un site (pour tracer une courbe)."""
    if not est_actif():
        return []
    try:
        sql = ("SELECT jour, taux, jours_ok, jours_total, prix_plausibles, "
               "latence_ms, statut, motif FROM mesures_fiabilite WHERE site = ?")
        params = [site]
        if depuis:
            sql += " AND jour >= ?"
            params.append(depuis)
        sql += " ORDER BY jour"
        cles = ("jour", "taux", "jours_ok", "jours_total", "prix_plausibles",
                "latence_ms", "statut", "motif")
        return [dict(zip(cles, r)) for r in _conn.execute(sql, params)]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture de l'historique de fiabilite impossible ({e})")
        return []


# --- IDENTITE PRODUIT (Axe 2) ---------------------------------------------

def enregistrer_annonce(produit_id, vendeur_id, url, titre, gtin, mpn,
                        resolution):
    """
    Memorise une annonce vendeur et son rattachement canonique.

    `resolution` est le dict rendu par identite_produit.resoudre().
    """
    def op(c):
        c.execute("INSERT OR IGNORE INTO vendeurs(id) VALUES(?)", (vendeur_id,))
        c.execute(
            """INSERT INTO annonces(produit_id, vendeur_id, url, titre, gtin, mpn,
                                    id_canonique, niveau, label, score, methode, vu_le)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(produit_id, vendeur_id, url) DO UPDATE SET
                 titre=excluded.titre, gtin=excluded.gtin, mpn=excluded.mpn,
                 id_canonique=excluded.id_canonique, niveau=excluded.niveau,
                 label=excluded.label, score=excluded.score,
                 methode=excluded.methode, vu_le=excluded.vu_le""",
            (produit_id, vendeur_id, url or "", titre or "",
             resolution.get("gtin"), resolution.get("mpn"),
             resolution.get("id_canonique"),
             resolution.get("correspondance_level"),
             resolution.get("correspondance_label"),
             resolution.get("score"), resolution.get("methode"),
             datetime.now().isoformat(timespec="seconds")))
    _ecrire(op)


def enregistrer_identite(id_canonique, produit_id, gtin, mpn, libelle, niveau):
    def op(c):
        c.execute(
            """INSERT INTO identites(id_canonique, produit_id, gtin, mpn,
                                     libelle, niveau, maj_ts)
                 VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(id_canonique) DO UPDATE SET
                 produit_id=excluded.produit_id,
                 gtin=COALESCE(excluded.gtin, identites.gtin),
                 mpn=COALESCE(excluded.mpn, identites.mpn),
                 libelle=excluded.libelle,
                 niveau=MAX(COALESCE(identites.niveau, 0), excluded.niveau),
                 maj_ts=excluded.maj_ts""",
            (id_canonique, produit_id, gtin, mpn, libelle, niveau,
             datetime.now().isoformat(timespec="seconds")))
    _ecrire(op)


def annonces_du_produit(produit_id):
    """Annonces connues pour un composant, avec leur score de correspondance."""
    if not est_actif():
        return []
    try:
        rows = _conn.execute(
            "SELECT vendeur_id, url, titre, gtin, mpn, id_canonique, niveau, "
            "label, score, methode FROM annonces WHERE produit_id = ? "
            "ORDER BY niveau DESC, vendeur_id", (produit_id,))
        cles = ("vendeur", "url", "titre", "gtin", "mpn", "id_canonique",
                "correspondance_level", "correspondance_label", "score", "methode")
        return [dict(zip(cles, r)) for r in rows]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture des annonces impossible ({e})")
        return []


def vendeurs_ecartes(produit_id):
    """
    Vendeurs dont TOUTES les annonces connues pour ce composant ont ete
    dementies par la resolution d'identite (niveau 0).

    Un vendeur n'est ecarte que si aucune de ses annonces n'atteint au moins
    le niveau 1 : une seule correspondance valable suffit a le conserver.
    """
    if not est_actif():
        return set()
    try:
        rows = _conn.execute(
            "SELECT vendeur_id FROM annonces WHERE produit_id = ? "
            "GROUP BY vendeur_id HAVING MAX(COALESCE(niveau, 0)) = 0",
            (produit_id,))
        return {r[0] for r in rows}
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture des vendeurs ecartes impossible ({e})")
        return set()


def identites_par_produit(niveau_min=2):
    """
    {produit_id: id_canonique} pour les composants dont l'identite est SURE.

    `niveau_min=2` : seules les correspondances EAN ou MPN comptent. Fusionner
    deux composants sur une simple ressemblance de titre reviendrait a ne
    collecter qu'un prix pour deux produits differents -- exactement le faux
    positif que l'Axe 2 existe pour empecher.
    """
    if not est_actif():
        return {}
    try:
        rows = _conn.execute(
            "SELECT produit_id, id_canonique, MAX(niveau) FROM annonces "
            "WHERE id_canonique IS NOT NULL AND niveau >= ? "
            "GROUP BY produit_id", (niveau_min,))
        return {r[0]: r[1] for r in rows}
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture des identites impossible ({e})")
        return {}


def prix_canonique(id_canonique):
    """Plancher / plafond / prix courant fusionnes pour une identite."""
    if not est_actif() or not id_canonique:
        return None
    try:
        row = _conn.execute(
            "SELECT plancher, plafond, nb_releves, nb_vendeurs, niveau_min, "
            "niveau_max, premier_releve, dernier_releve FROM v_prix_canonique "
            "WHERE id_canonique = ?", (id_canonique,)).fetchone()
        if not row:
            return None
        m = dict(zip(("plancher", "plafond", "nb_releves", "nb_vendeurs",
                      "niveau_min", "niveau_max", "premier_releve",
                      "dernier_releve"), row))
        cur = _conn.execute(
            "SELECT prix, ts FROM v_prix_courant_canonique WHERE id_canonique = ?",
            (id_canonique,)).fetchone()
        m["prix_courant"], m["date_courante"] = (cur if cur else (None, None))
        return m
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture canonique impossible ({e})")
        return None


def releves_fusionnes(produit_id, niveau_min=1):
    """
    Releves de TOUTES les annonces partageant une identite canonique avec ce
    composant -- y compris celles enregistrees sous un autre produit_id.

    C'est la fusion demandee par le point 3 : le plancher d'un composant
    reflete le vrai minimum tous vendeurs confondus, et non plus seulement
    ses `sources` configurees.

    `niveau_min` filtre par qualite de correspondance : 3 = EAN uniquement,
    2 = EAN + MPN, 1 = tout, heuristique de titre comprise.
    """
    if not est_actif():
        return []
    try:
        rows = _conn.execute(
            """SELECT rc.produit_id, rc.vendeur_id, rc.prix, rc.ts, rc.origin,
                      rc.niveau_correspondance, rc.id_canonique
               FROM v_releves_canoniques rc
               WHERE rc.id_canonique IN (
                     SELECT DISTINCT id_canonique FROM annonces
                     WHERE produit_id = ? AND id_canonique IS NOT NULL)
                 AND rc.niveau_correspondance >= ?
               ORDER BY rc.ts""", (produit_id, niveau_min))
        cles = ("produit_id", "site", "price", "date", "origin",
                "correspondance_level", "id_canonique")
        return [dict(zip(cles, r)) for r in rows]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture fusionnee impossible ({e})")
        return []


# --- LECTURES (SQLite est la source de verite depuis le prompt 6.4) --------

def charger_history(config=None):
    """
    Reconstruit l'etat de travail depuis SQLite. Remplace
    `load_json(history.json)`.

    Rend exactement la meme structure qu'auparavant :
        {cid: {"name", "category", "entries": [...], "seed_imported": bool},
         "_slots_winners": {slot: winner_id}}

    L'ordre des entrees reproduit celui de history.json : tri par date, puis
    par ordre d'insertion (`id`, la cle de substitution). Cet ordre compte --
    `analyze_component` prend `entries[-1]` comme prix courant.
    """
    if not est_actif():
        return {}
    try:
        history = {}
        c = _conn.cursor()

        for pid, nom, cat, seed in c.execute(
                "SELECT id, nom, categorie, COALESCE(seed_imported, 0) "
                "FROM produits ORDER BY rowid"):
            history[pid] = {"name": nom, "category": cat,
                            "entries": [], "seed_imported": bool(seed)}

        for pid, site, prix, ts, origin, tier in c.execute(
                "SELECT produit_id, vendeur_id, prix, ts, origin, source_tier "
                "FROM releves ORDER BY produit_id, ts, id"):
            noeud = history.get(pid)
            if noeud is None:
                # Releve orphelin (produit retire du config) : on le conserve
                # plutot que de le perdre silencieusement.
                noeud = history[pid] = {"name": pid, "category": "",
                                        "entries": [], "seed_imported": False}
            entree = {"date": ts, "site": site, "price": float(prix),
                      "origin": origin or "tracked"}
            if tier:                       # absent si inconnu : aller-retour stable
                entree["tier"] = tier
            noeud["entries"].append(entree)

        gagnants = {slot: winner for slot, winner in
                    c.execute("SELECT slot, winner_id FROM slots_winners")}
        if gagnants:
            history["_slots_winners"] = gagnants

        return history
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture impossible ({e}) -- historique vide")
        return {}


def historique_hebdomadaire(produit_id=None):
    """
    Lecture condensee (un point par semaine) via la vue SQL. Remplace
    l'ancienne SUPPRESSION des releves de plus de 90 jours : la granularite
    complete reste en base.
    """
    if not est_actif():
        return []
    try:
        if produit_id:
            rows = _conn.execute(
                "SELECT produit_id, semaine, debut_semaine, prix_min, prix_moyen, "
                "nb_releves FROM v_historique_hebdomadaire WHERE produit_id = ? "
                "ORDER BY semaine", (produit_id,))
        else:
            rows = _conn.execute(
                "SELECT produit_id, semaine, debut_semaine, prix_min, prix_moyen, "
                "nb_releves FROM v_historique_hebdomadaire ORDER BY produit_id, semaine")
        return [{"produit_id": r[0], "semaine": r[1], "debut_semaine": r[2],
                 "prix_min": r[3], "prix_moyen": r[4], "nb_releves": r[5]}
                for r in rows]
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture hebdomadaire impossible ({e})")
        return []


def metriques_produit(produit_id):
    """
    Chemins chauds lus depuis les vues SQL : prix courant, plancher/plafond,
    moyennes glissantes. Ce sont les memes grandeurs qu'analyze_component
    calcule en Python sur `entries` (voir tests/test_vues_sqlite.py, qui
    verifie l'egalite des deux chemins).
    """
    if not est_actif():
        return None
    try:
        c = _conn.cursor()
        m = {}
        row = c.execute("SELECT prix, ts FROM v_prix_courant WHERE produit_id = ?",
                        (produit_id,)).fetchone()
        m["prix_courant"], m["date_courante"] = (row if row else (None, None))

        row = c.execute("SELECT plancher, plafond, nb_releves, premier_releve, "
                        "dernier_releve FROM v_plancher_historique WHERE produit_id = ?",
                        (produit_id,)).fetchone()
        if row:
            m.update(zip(("plancher", "plafond", "nb_releves",
                          "premier_releve", "dernier_releve"), row))

        row = c.execute("SELECT avg_7j, avg_30j, avg_90j, n_7j, n_30j, n_90j "
                        "FROM v_moyennes_glissantes WHERE produit_id = ?",
                        (produit_id,)).fetchone()
        if row:
            m.update(zip(("avg_7j", "avg_30j", "avg_90j",
                          "n_7j", "n_30j", "n_90j"), row))
        return m
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"lecture des metriques impossible ({e})")
        return None


def exporter_history_json(chemin, config=None):
    """
    Export de secours : regenere un history.json depuis SQLite.

    Ce fichier n'est plus la source de verite -- c'est une photographie,
    produite a la demande (`price_tracker.py --export-history`), utile pour
    inspecter l'etat a la main ou revenir en arriere.
    """
    import json as _json
    history = charger_history(config)
    Path(chemin).write_text(
        _json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


# --- Persistance complete --------------------------------------------------

def mirror_history(history, config):
    """
    Recopie l'etat courant de l'objet `history` (source de verite) dans SQLite,
    par remplacement integral des releves et des gagnants de slot. Met aussi a
    jour les tables de reference produits / vendeurs / evenements depuis config.

    Ne LIT jamais SQLite : la source est l'objet history en memoire + config.
    """
    if not est_actif() or _lecture_seule:
        return
    try:
        _conn.executescript(SCHEMA)               # tables presentes
        with _conn:                               # transaction atomique
            c = _conn.cursor()

            # produits : config fait autorite (nom, categorie, slot, perf_index).
            # `seed_imported` vient de l'etat de travail : c'est lui qui evite
            # de reimporter les seed_history a chaque execution.
            for comp in config.get("components", []):
                noeud = history.get(comp.get("id")) or {}
                seed = 1 if noeud.get("seed_imported") else 0
                c.execute(
                    """INSERT INTO produits(id, nom, categorie, slot, perf_index,
                                            seed_imported)
                         VALUES(?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET
                         nom=excluded.nom, categorie=excluded.categorie,
                         slot=excluded.slot, perf_index=excluded.perf_index,
                         seed_imported=excluded.seed_imported""",
                    (comp.get("id"), comp.get("name"), comp.get("category"),
                     comp.get("slot"), comp.get("perf_index"), seed))

            # vendeurs : catalogue de config
            for nom, v in (config.get("vendeurs") or {}).items():
                if nom == "_comment" or not isinstance(v, dict):
                    continue
                c.execute(
                    """INSERT INTO vendeurs(id, type, pays, actif, priorite)
                         VALUES(?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET
                         type=excluded.type, pays=excluded.pays,
                         actif=excluded.actif, priorite=excluded.priorite""",
                    (nom, v.get("type"), v.get("pays"),
                     1 if v.get("actif") else 0, v.get("priorite")))

            # evenements : remplacement integral depuis config
            c.execute("DELETE FROM evenements")
            for ev in (config.get("evenements_produits") or []):
                if not isinstance(ev, dict) or "date" not in ev:
                    continue
                impact = ev.get("impact")
                if isinstance(impact, (list, tuple)):
                    impact = ",".join(str(x) for x in impact)
                c.execute(
                    "INSERT OR REPLACE INTO evenements(date, nom, impact, note) VALUES(?,?,?,?)",
                    (ev.get("date"), ev.get("nom"), impact, ev.get("note")))

            # releves : remplacement integral depuis history (source de verite)
            c.execute("DELETE FROM releves")
            for cid, node in history.items():
                if cid == "_slots_winners" or not isinstance(node, dict):
                    continue
                for e in node.get("entries", []):
                    c.execute("INSERT OR IGNORE INTO vendeurs(id) VALUES(?)", (e["site"],))
                    c.execute(
                        """INSERT INTO releves(produit_id, vendeur_id, prix, ts,
                                               confiance, source_tier, origin)
                             VALUES(?,?,?,?,?,?,?)""",
                        (cid, e["site"], float(e["price"]), e["date"],
                         None, e.get("tier"), e.get("origin", "tracked")))

            # slots_winners : remplacement integral depuis history["_slots_winners"]
            c.execute("DELETE FROM slots_winners")
            now = datetime.now().isoformat(timespec="seconds")
            for slot, winner in (history.get("_slots_winners") or {}).items():
                c.execute(
                    "INSERT OR REPLACE INTO slots_winners(slot, winner_id, maj_ts) VALUES(?,?,?)",
                    (slot, winner, now))
    except Exception as e:                        # pragma: no cover (defensif)
        _avertir(f"reconciliation ignoree ({e})")


def persister(history, config):
    """
    Ecrit l'etat de travail dans SQLite. Depuis la bascule (6.4), c'est LE
    chemin d'ecriture -- il remplace `save_json(history_path, history)`.

    Techniquement identique a `mirror_history` (remplacement integral, donc
    idempotent) ; le nom dit ce que la fonction fait desormais : persister la
    source de verite, et non plus dupliquer un miroir.
    """
    mirror_history(history, config)
