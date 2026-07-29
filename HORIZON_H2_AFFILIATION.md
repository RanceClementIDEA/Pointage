# Horizon H.1 — Partage opt-in de relevés entre installations

> **Document de cadrage. Aucun code n'a été écrit.**
> Il sert à préparer une décision, pas à l'exécuter. Rien de ce qui suit
> n'est engagé. La conclusion de ce document est **une recommandation de ne
> pas engager le chantier en l'état** — les raisons sont détaillées, et la
> décision reste la vôtre.

**Condition préalable vérifiée** : les vagues 6 à 9 sont stables — 388 tests
verts au moment de la rédaction, rapport de référence inchangé
(883,98 EUR / ACHAT ECHELONNE).

---

## 1. L'idée, et ce qu'elle vaut réellement

Plusieurs installations indépendantes de ce projet observent les mêmes prix
publics chez les mêmes marchands. Chacune ne voit que ce qu'elle regarde, au
moment où elle regarde. Mutualiser ces observations donnerait à chacun une
couverture temporelle qu'aucun ne peut atteindre seul.

**Ce que le partage apporterait vraiment — et ce qu'il n'apporte pas :**

| | Apport |
|---|---|
| Couverture **temporelle** | ✅ Réel. Une promotion de trois heures un mardi matin, manquée par votre cycle quotidien, aurait été vue par quelqu'un d'autre. |
| Couverture **catalogue** | ✅ Réel, mais peu utile. Les prix d'un composant que vous ne suivez pas ne vous servent qu'au moment où vous commencez à le suivre. |
| Meilleure **décision aujourd'hui** | ❌ **Non.** Un prix observé par un tiers hier est un prix qui n'existe plus. Il ne change pas ce que vous pouvez acheter maintenant. |
| Meilleure **statistique** | ⚠️ Oui *si* les données sont fiables — et c'est là que tout se joue. |

Il faut être net sur ce point, parce qu'il commande tout le reste : **le
partage n'améliore pas les décisions, il améliore les statistiques.** Il
répond à « 429 EUR était-il vraiment le plancher ? », pas à « dois-je acheter
aujourd'hui ? ».

Or c'est exactement le terrain sur lequel le garde-fou transversal est le
plus strict : *aucune probabilité sans taille d'échantillon*. Un *n* gonflé
par des observations que vous ne pouvez pas vérifier n'est pas un meilleur
*n* — c'est un *n* dont vous ne savez plus ce qu'il mesure.

---

## 2. Ce qui serait partagé — et ce qui ne le serait jamais

### 2.1 Partagé

Une observation, et rien de plus :

| Champ | Exemple | Pourquoi c'est inoffensif |
|---|---|---|
| `k` — clé canonique (6.5) | `ean:4038816117526` | Identifiant **public** du produit, imprimé sur l'emballage |
| `d` — jour | `2026-07-29` | Jour, jamais l'heure : l'horodatage fin est un traceur |
| `p` — prix | `409.40` | Prix **public**, affiché à quiconque visite la page |
| `c` — devise | `EUR` | |
| `m` — domaine marchand | `ldlc.com` | Le marchand, pas l'URL : une URL peut porter un identifiant de session |
| `n` — pays | `FR` | |
| `t` — palier de cascade (8.1) | `jsonld` | Dit **comment** le prix a été obtenu, donc ce qu'il vaut |
| `v` — version de schéma | `1` | Sans quoi aucune évolution n'est possible |

### 2.2 Jamais partagé — liste fermée

- L'**identité** de l'utilisateur : nom, email, adresse, IP stable, identifiant d'installation persistant.
- Les **projets** : noms, budgets, objectifs, plafonds, dates cibles.
- Les **achats** : ce qui a été acheté, quand, à quel prix.
- Les **URLs** suivies, les sélecteurs CSS locaux, la configuration.
- Les **paramètres** de notification : email, SMTP, canal ntfy.
- L'**historique complet** : seules des observations unitaires sortent, jamais la base.

Cette liste est le miroir exact des `MOTIFS_SENSIBLES` de la publication
(9.2). Le mécanisme de contrôle existe déjà et serait réutilisé tel quel.

### 2.3 Le piège que la liste ci-dessus ne suffit pas à fermer

**L'ensemble des composants que vous suivez est lui-même une empreinte.**

Treize composants suivis ensemble — un Ryzen 7 5700X, une B550, une RX 9060
XT — c'est la signature d'une configuration précise. Un observateur qui
reçoit vos envois groupés apprend que *quelqu'un* monte cette machine, à ce
budget implicite, à ce rythme de surveillance. Aucun champ personnel n'a
pourtant été transmis.

Trois parades, aucune gratuite :

| Parade | Coût |
|---|---|
| Envoyer chaque observation séparément, sans identifiant d'envoi | Rend la lutte anti-abus quasi impossible (§4.2) |
| Envoyer par lots aléatoires, décalés dans le temps | Complexité réelle, protection partielle |
| Ne partager que les composants d'une liste publique commune | Réduit fortement l'intérêt du partage |

**Aucune de ces parades ne rend l'anonymat garanti.** Comme pour la
publication (9.2), le vocabulaire honnête est **atténuateur**, pas anonymat.

---

## 3. Mécanisme d'opt-in

Le précédent du prompt 9.2 est directement transposable, et il est strict.

### 3.1 Désactivé par défaut

```jsonc
"partage_releves": false,          // livré ainsi, un test le verrouille
"partage": {
  "point_de_collecte": null,       // aucune cible par défaut
  "paliers_partages": ["api", "jsonld"],
  "confirmation_lue": false        // voir 3.3
}
```

Un test de la même forme que `test_la_config_livree_a_la_publication_desactivee`
échouerait si le dépôt était livré avec le partage actif.

### 3.2 Trois garde-fous actifs, sur le modèle de `publier_dashboard.py`

Le partage **refuserait de s'exécuter** si :

1. `partage_releves` n'est pas à `true` ;
2. le lot à envoyer contient un **élément sensible** (§2.2), détecté avant
   tout envoi ;
3. le lot contient une observation de **niveau d'identité insuffisant**
   (§4.1) — refus catégorique, pas un avertissement.

### 3.3 Aperçu avant le premier envoi

Une activation consciente suppose de **voir ce qui part**. Un mode
`--partage-blanc` écrirait dans un fichier local le lot exact qui serait
transmis, sans rien envoyer, et le premier envoi réel serait refusé tant que
l'utilisateur n'a pas confirmé l'avoir lu.

C'est l'équivalent de `publier_dashboard.py --dossier ./public`, qui prépare
sans publier.

### 3.4 Réversibilité

Un opt-in sans opt-out est un piège. Il faut, dès le cadrage, décider :
peut-on retirer ses contributions passées ? Sur quelle base, puisque rien ne
les rattache à vous ? **La réponse honnête est : non.** Ce qui est envoyé ne
peut pas être repris. Cela doit être dit à l'activation, en toutes lettres,
pas dans une note de bas de page.

---

## 4. Format d'échange, appuyé sur l'identité canonique (6.5)

Sans identité canonique, des observations partagées sont inexploitables : un
prix associé à un titre marchand ne désigne aucun produit reconnaissable
ailleurs. Le prompt 6.5 a construit exactement la pièce manquante.

### 4.1 La règle qui commande tout : seuls les niveaux 3 et 2 sortent

`identite_produit.py` classe une correspondance en quatre niveaux :

| Niveau | Méthode | Partageable ? |
|---|---|---|
| `NIVEAU_EXACT` (3) | GTIN/EAN validé par somme de contrôle GS1 | ✅ oui |
| `NIVEAU_MODELE` (2) | MPN normalisé | ✅ oui |
| `NIVEAU_TITRE` (1) | heuristique de similarité de titre | ❌ **jamais** |
| `NIVEAU_AUCUN` (0) | — | ❌ jamais |

**Le niveau 1 doit être exclu sans exception.** Une correspondance par titre
est un jugement *local* : « cette annonce désigne probablement *mon*
composant ». Exportée, elle devient une affirmation sur un produit, que
l'installation réceptrice n'a aucun moyen de contester. C'est le mécanisme de
pollution le plus direct, et il est déjà nommé dans le code : la **règle du
veto** de 6.5 existe précisément parce qu'un titre plausible peut désigner un
autre produit.

Conséquence à assumer : **la majeure partie des relevés actuels ne serait pas
partageable.** Dans l'état de la base au moment de la rédaction, la table
`identites` est vide — les identités sont résolues pendant la collecte
réseau, qui n'a pas encore tourné en volume. Le taux réel de relevés de
niveau ≥ 2 est **inconnu**, et c'est la première mesure à faire avant toute
décision (§6).

### 4.2 Seuls les paliers de haute confiance sortent

La cascade (8.1) qualifie chaque prix par sa provenance. Deux paliers sont
marqués `confiance: haute` — `api` et `jsonld`. Les deux autres non :

- `selecteurs` (moyenne) dépend d'un sélecteur CSS **local**, dont la
  justesse ne peut pas être vérifiée à distance ;
- `borne` (faible) est explicitement décrit comme n'offrant *« aucune
  garantie que ce montant désigne LE produit »*.

Partager `borne` reviendrait à diffuser du bruit avec l'autorité d'une
donnée. **Règle : `paliers_partages` ne peut contenir que `api` et `jsonld`.**

### 4.3 Format

NDJSON — une observation par ligne, versionnée, lisible à l'œil nu :

```
{"v":1,"k":"ean:4038816117526","d":"2026-07-29","p":409.40,"c":"EUR","m":"ldlc.com","n":"FR","t":"jsonld"}
{"v":1,"k":"mpn:RX9060XT-16G","d":"2026-07-29","p":419.00,"c":"EUR","m":"alternate.fr","n":"FR","t":"jsonld"}
```

Une ligne = un fait public, daté, attribué à un marchand, qualifié par sa
méthode d'obtention. Rien d'autre n'y tient.

---

## 5. Risques et parades

### 5.1 Pollution involontaire

| Risque | Parade |
|---|---|
| Extraction erronée diffusée | Paliers `api`/`jsonld` uniquement (§4.2) |
| Mauvaise identification produit | Niveaux 3 et 2 uniquement (§4.1) |
| Prix promotionnel conditionnel (code, panier, adhérent) pris pour un prix courant | Aucune parade fiable — **risque résiduel assumé**, à afficher comme tel |
| Devises / TVA / frais de port hétérogènes | Champ `n` (pays) obligatoire ; jamais d'agrégation inter-pays sans conversion explicite (le projet a déjà `taux_change` et `frais_port_par_pays`) |

### 5.2 Abus délibéré — le risque sérieux

Le scénario : quelqu'un injecte de faux prix bas pour déclencher chez les
autres une alerte « occasion ultime », ou de faux prix hauts pour fausser les
planchers de référence.

C'est un risque **structurel**, pas un cas limite : le système repose sur des
contributeurs non authentifiés, par construction (§2.3 — authentifier, c'est
identifier).

Trois parades, à empiler :

1. **Une donnée partagée ne déclenche jamais rien.** Elle peut nourrir un
   affichage de contexte ; elle ne peut ni déclencher une alerte, ni entrer
   dans une recommandation d'achat, ni modifier un plancher de référence.
   *Le déclencheur reste ce que vous avez observé vous-même.*
2. **Corroboration.** Une observation n'est affichée que si *k* installations
   indépendantes l'ont rapportée. Efficace contre l'acteur isolé, inefficace
   contre un acteur qui simule *k* installations — ce que rien, dans ce
   design, n'empêche.
3. **Étanchéité statistique.** Les données partagées **n'entrent jamais** dans
   `probabilites.py`. Le `SEUIL_ECHANTILLON = 5` de 7.1 protège contre les
   petits échantillons ; il ne protège pas contre un échantillon empoisonné.
   Le *n* affiché doit rester **votre** *n*.

> La parade 3 mérite d'être lue deux fois : elle retire au partage l'essentiel
> de son intérêt annoncé (§1). C'est cohérent, et c'est embarrassant pour
> l'idée. C'est aussi la conclusion honnête.

### 5.3 Statut juridique — signalé, non tranché

Observer un prix public pour son usage personnel et **redistribuer** un
ensemble de prix collectés sont deux actes différents. Un prix isolé est un
fait ; une base de données de prix peut relever, dans l'Union européenne, du
droit *sui generis* du producteur de base de données (directive 96/9/CE), et
les conditions d'utilisation de plusieurs marchands interdisent explicitement
la réutilisation de leurs données tarifaires.

La posture actuelle du projet est *« observation personnelle, civisme
réseau »* — refus assumé de contourner les blocages, respect de `robots.txt`,
délai de 3 s entre requêtes, cache conditionnel HTTP. **Le partage déplace
cette posture vers la redistribution.** Ce n'est pas un détail de mise en
œuvre : c'est un changement de nature.

Je signale la question ; je ne suis pas en mesure d'y répondre, et un avis
compétent serait nécessaire avant tout engagement.

### 5.4 Le coût caché : il faut un serveur

Le projet tient aujourd'hui sur une promesse simple : `sqlite3` de la
bibliothèque standard, aucun service, un double-clic. Le partage suppose un
point de collecte : quelque chose qui reçoit, stocke, déduplique, modère et
redistribue.

Cela pose quatre questions sans réponse technique :

- **qui l'héberge** et sous quelle responsabilité (§5.3) ;
- **qui le paie**, et que se passe-t-il quand il s'arrête ;
- **qui modère** les contributions abusives (§5.2) ;
- que devient une installation quand le point de collecte disparaît.

Une variante sans serveur — dépôt Git public alimenté par pull requests,
fichier NDJSON en append — supprime l'hébergement mais pas la modération, et
ajoute une latence de plusieurs jours qui annule l'intérêt de couverture
temporelle (§1).

**C'est, à mon sens, l'objection décisive : le partage contredit le garde-fou
« la complexité vit dans la couche donnée, pas dans l'usage ». Ici, la
complexité sort du projet et devient une infrastructure à tenir.**

---

## 6. Ce qu'il faudrait mesurer avant de décider

Aucune décision ne devrait être prise sans ces trois chiffres, qu'aucune
donnée actuelle ne permet d'établir :

1. **Taux de relevés de niveau ≥ 2.** Quelle proportion des observations est
   effectivement partageable ? Si c'est 10 %, le sujet est clos. *Mesurable
   après quelques semaines de collecte réelle, sans écrire une ligne de code
   de partage.*
2. **Taux de relevés en palier `jsonld`.** Même raisonnement, croisé avec le
   précédent : la double contrainte §4.1 + §4.2 est multiplicative.
3. **Gain réel sur le plancher.** Sur l'historique existant, simuler ce
   qu'aurait apporté une observation supplémentaire par jour : le plancher
   change-t-il ? de combien ? Le banc de backtesting (6.3) sait déjà faire ce
   genre de mesure sans anticipation.

Si le point 3 donne un écart indistinguable de zéro — comme l'a fait la
validation de la vague 7 — le chantier n'a pas d'objet.

---

## 7. Estimation d'effort

> **Section volontairement séparée du reste.** Ces chiffres ne valent que si
> la décision de §8 est de poursuivre, ce que je ne recommande pas.

| Lot | Contenu | Effort |
|---|---|---|
| **0. Mesure préalable** | Les 3 chiffres du §6, sans code de partage | **faible** — outillage existant (6.3, 6.5, 8.1) |
| **1. Export local** | Sérialisation NDJSON, filtres §4.1/§4.2, mode blanc, tests de refus | **moyen** |
| **2. Garde-fous** | Contrôle du contenu, opt-in, confirmation, irréversibilité annoncée | **faible** — le modèle 9.2 est réutilisable presque tel quel |
| **3. Point de collecte** | Réception, déduplication, corroboration, modération, exploitation | **élevé, et récurrent** — ce n'est pas un développement, c'est un service à tenir |
| **4. Consommation** | Affichage cloisonné, étanchéité statistique, distinction visuelle « vu par d'autres » | **moyen** |
| **5. Juridique** | Avis compétent (§5.3) | **hors compétence** |

Les lots 0 à 2 sont du travail de développement classique, borné et testable.
**Le lot 3 n'est pas un lot de développement** : c'est un engagement
d'exploitation à durée indéterminée. C'est lui qui décide, pas les autres.

---

## 8. Recommandation

**Ne pas engager le chantier en l'état.** Trois raisons, par ordre de poids :

1. **Le lot 3 change la nature du projet** (§5.4). Un outil autonome qui tient
   dans un double-clic deviendrait le client d'un service à héberger, payer et
   modérer.
2. **Les parades anti-abus vident le partage de son intérêt** (§5.2). Une
   donnée qui ne peut ni déclencher, ni décider, ni compter dans un *n* est
   une donnée décorative.
3. **Le statut juridique de la redistribution n'est pas établi** (§5.3), et il
   est en tension directe avec la posture de civisme réseau que le projet tient
   depuis le prompt 8.3.

**Ce que je recommande à la place, et qui capte l'essentiel du gain :**
exécuter le **lot 0** seul. Mesurer les trois chiffres du §6. Ils coûtent peu,
ils sont utiles indépendamment du partage — le taux d'identités de niveau ≥ 2
est exactement l'indicateur qui dira si le prompt 6.5 tient ses promesses en
production — et ils transformeraient cette décision en question tranchable.

Si le gain simulé du §6.3 est significatif, la question méritera d'être
rouverte, avec des chiffres. Sinon, elle sera close pour de bon.

---

*Document de cadrage — horizon v4. Aucun engagement. À relire avant toute
implémentation.*
