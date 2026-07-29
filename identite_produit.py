# Horizon H.2 — APIs d'affiliation officielles comme palier de cascade

> **Document de cadrage. Aucun code n'a été écrit.**
> Ce chantier ne s'engage qu'après lecture et **décision explicite**,
> notamment sur la question de l'affiliation commerciale (§5), qui n'est pas
> une question technique.

**Condition préalable vérifiée** : les vagues 6 à 9 sont stables — 388 tests
verts au moment de la rédaction.

> **Avertissement sur les faits externes.** Les conditions d'inscription, les
> seuils et les limites de débit cités au §3 changent régulièrement et
> unilatéralement. Ils sont donnés comme **points à vérifier au moment de la
> décision**, pas comme un état certifié du marché. Tout ce qui concerne le
> code de ce projet (§2, §6, §7) a en revanche été vérifié dans le dépôt.

---

## 1. La place est déjà réservée

Le prompt 8.1 a formalisé la cascade de collecte en quatre paliers, ordonnés
par confiance décroissante. Le premier est vide, et il porte déjà le nom de ce
chantier :

```
  rang 0  api          confiance=haute    « Prevu, non implemente : reserve aux futures
                                            integrations d'affiliation. Aucun prix ne
                                            porte ce palier aujourd'hui. »
  rang 1  jsonld       confiance=haute
  rang 2  selecteurs   confiance=moyenne
  rang 3  borne        confiance=faible
```

Conséquence pratique importante : **l'intégration ne demande aucun travail
structurel.** Le palier existe, `palier_info()` le décrit, la traçabilité de
provenance (`releves.source_tier`), l'affichage du palier dans le dashboard et
la mesure de fiabilité par palier fonctionnent déjà. Ce qui manque, c'est un
producteur de prix qui déclare `tier="api"`.

C'est le point rare de ce cadrage : **le coût d'intégration est faible, et le
vrai coût est ailleurs** (§3 et §5).

---

## 2. Ce que le catalogue actuel dit vraiment

Vérifié dans `config.json` :

| | Nombre |
|---|---|
| Entrées au catalogue | 52 |
| **Vendeurs actifs** | **22** |
| Inactifs (`a_verifier`, URL non confirmée) | 30 |

Répartition des 22 actifs :

| | Détail |
|---|---|
| Par type | 19 marchands, 3 comparateurs (`idealo`, `ledenicheur`, `geizhals`) |
| Par pays | **13 FR**, 3 DE, 1 DE/AT, 1 FR/DE, 1 DE/CH, 1 ES, 1 NL, 1 DK |

**Marchands français actifs** — le périmètre où une affiliation aurait un
sens : `ldlc`, `materiel.net`, `topachat`, `grosbill`, `cybertek`,
`1fodiscount`, `cdiscount`, `rueducommerce`, `fnac`, `boulanger`, `rakuten`.

> ⚠️ **`amazon.fr` est `actif: false`** dans le catalogue livré (marqué
> `a_verifier`, URL de recherche non confirmée). Le projet **ne collecte rien
> chez Amazon aujourd'hui.** C'est un fait déterminant pour le §3.1 : la
> Product Advertising API porterait sur un vendeur qui n'est pas au périmètre.

---

## 3. Les programmes envisagés

### 3.1 Amazon Product Advertising API (PA-API 5.0)

**Le blocage est à l'entrée, et il est structurel.**

L'accès à PA-API n'est pas accordé à l'inscription au programme Amazon
Partenaires : il est conditionné à la réalisation de **ventes qualifiantes
via ses liens d'affiliation** dans une fenêtre glissante (de l'ordre de
3 ventes en 180 jours — *à vérifier*). L'accès est ensuite **révoqué** si le
volume de ventes retombe.

Autrement dit : *il faut déjà générer des ventes pour obtenir l'API.* Pour un
outil de suivi de prix personnel, sans audience et sans lien d'affiliation
publié, cette condition n'est pas remplissable — et elle ne le deviendra pas
en attendant.

À cela s'ajoutent :

- des **limites de débit** indexées sur le chiffre d'affaires généré
  (de l'ordre de 1 requête/seconde au départ — *à vérifier*) ;
- l'obligation d'**afficher les prix Amazon selon les règles du programme**
  (fraîcheur, mentions), contrainte de présentation qui déborde sur les
  rapports ;
- et, ici, l'absence d'objet : `amazon.fr` est inactif (§2).

**Verdict : non prioritaire, et probablement inaccessible.** Ce n'est pas un
arbitrage de calendrier, c'est une condition d'entrée que le projet ne peut
pas satisfaire sans devenir autre chose.

### 3.2 Awin

Réseau d'affiliation généraliste, bonne couverture des enseignes françaises
et européennes.

| Point | Ce qu'il faut savoir |
|---|---|
| Inscription éditeur | Validation du « site » de l'éditeur ; dépôt d'entrée modique et remboursable sur les premiers gains (*à vérifier*) |
| Délai | Quelques jours pour le compte éditeur, **puis une validation par annonceur** — chaque marchand accepte ou refuse individuellement |
| Écueil | Un outil personnel sans site public a de bonnes chances d'être **refusé par les annonceurs**, indépendamment de l'acceptation par le réseau |
| Données | Flux produits (*product feeds*) contenant référence, EAN/GTIN, prix, disponibilité |

### 3.3 Kwanko (ex-NetAffiliation) et réseaux français

Même logique qu'Awin, avec un ancrage français plus marqué. Plusieurs
enseignes du catalogue actif y sont historiquement présentes (*à vérifier au
cas par cas* — les enseignes changent de réseau).

### 3.4 Programmes propres aux enseignes

Plusieurs marchands du catalogue opèrent leur propre programme, ou passent par
un réseau spécifique (Rakuten Advertising pour Rakuten, par exemple). Ils
échappent à la logique « un réseau, plusieurs marchands » et se traitent un
par un.

### 3.5 Le point que personne n'annonce en première page

**Un flux d'affiliation n'est pas une API de prix temps réel.**

Ce que ces programmes distribuent, ce sont très majoritairement des **flux
produits en lot, rafraîchis une fois par jour** (parfois moins). Or la valeur
de ce projet tient précisément à ce qu'il attrape des baisses courtes :
le dashboard vient de montrer, sur trois ans simulés, que **7 planchers sur
13** tombent hors d'une fenêtre de 90 jours, et l'alerte « occasion ultime »
existe pour des fenêtres qui se comptent en heures.

| | Collecte actuelle | Flux d'affiliation |
|---|---|---|
| Fraîcheur | à chaque cycle | quotidienne, à heure imposée |
| Fiabilité structurelle | dépend du HTML du site | élevée, format contractuel |
| EAN/GTIN | rarement présent | **nativement présent** |
| Charge réseau imposée au marchand | requêtes HTTP | nulle |
| Casse silencieuse | possible (d'où le prompt 8.2) | improbable |

**Conclusion à retenir : une API officielle serait plus fiable et moins
fraîche.** Elle ne remplace pas la collecte actuelle — elle la complète. Le
palier `api` étant rang 0, il faudra décider explicitement si un prix d'API
plus ancien doit primer sur un prix `jsonld` plus récent. *Ma lecture : non —
la cascade ordonne la confiance, pas la fraîcheur, et les deux doivent être
arbitrées séparément.* C'est une décision de conception à prendre au moment de
l'implémentation, pas maintenant.

---

## 4. Ce que ça changerait concrètement

### 4.1 Fiabilité — le gain le plus net

Le prompt 8.2 existe parce que les sélecteurs CSS cassent : détection à 48 h,
proposition de sélecteur candidat, snapshots de diagnostic (8.4). Tout ce
dispositif est un traitement de symptôme. Un flux contractuel supprime la
cause pour les marchands concernés.

### 4.2 Identité produit — le gain le plus sous-estimé

C'est, à mon avis, le vrai argument, et il est indirect.

Le prompt 6.5 classe les correspondances en quatre niveaux ; seul le niveau 3
(GTIN validé GS1) est une identification certaine. Aujourd'hui, les EAN sont
extraits opportunistiquement du JSON-LD quand le marchand les publie —
souvent, il ne les publie pas, et l'heuristique de titre prend le relais.

**Les flux d'affiliation portent l'EAN nativement, pour tout le catalogue.**
Intégrer un seul flux d'un marchand bien fourni pourrait faire basculer une
part importante des composants suivis en identité de niveau 3, avec des effets
en cascade sur :

- la fusion des annonces `v_releves_canoniques` / `v_prix_canonique` (6.5) ;
- la règle du veto, qui deviendrait applicable bien plus souvent ;
- et, si elle était un jour rouverte, la faisabilité du partage H.1, dont le
  §4.1 montre qu'elle bute exactement sur ce taux.

### 4.3 Volume et civisme réseau

La collecte actuelle s'impose déjà une discipline : `DELAY_BETWEEN_REQUESTS =
3 s`, `MAX_RETRIES = 2`, cache conditionnel HTTP (ETag / 304), repli
exponentiel par domaine, respect de `robots.txt`. Un flux officiel **retire
entièrement la charge** pour le marchand concerné. C'est la continuation
naturelle du prompt 8.3 : la meilleure politesse réseau, c'est de ne pas
faire la requête.

### 4.4 Contrepartie commerciale

Voir §5 — ce n'est pas un avantage technique, c'est un changement de nature.

---

## 5. La question ouverte : un lien d'affiliation dans les rapports ?

**Cette question vous revient. Je ne la tranche pas.** Je la formule aussi
nettement que possible, parce que sa formulation habituelle — « veut-on
monétiser ? » — masque le vrai problème.

### Le conflit est structurel, pas déontologique

Cet outil a une fonction : **vous dire d'attendre.** C'est écrit partout dans
son comportement — `[ATTENDRE]`, « 23 % au-dessus du prix habituel », la
stratégie `ACHAT ECHELONNE`, l'espérance de gain de l'attente (7.2),
l'optimiseur qui diffère des achats sous contrainte de budget (7.4).

Un lien d'affiliation rémunère **l'achat**. Il ne rémunère jamais l'attente.

Le jour où un lien d'affiliation existe, chaque recommandation d'attendre
devient un renoncement chiffré, et chaque recommandation d'acheter devient un
gain. L'outil n'a plus le même intérêt que vous. Que personne n'ait
l'intention de fausser quoi que ce soit ne change rien : le désalignement est
dans la structure, pas dans les intentions.

### Trois positions cohérentes

| Position | Ce qu'elle implique |
|---|---|
| **A — Aucun lien d'affiliation** | Chercher un accès aux flux sans monétisation. Honnête, mais souvent **contractuellement impossible** : la plupart des programmes exigent une promotion active en contrepartie de l'accès aux données |
| **B — Liens d'affiliation, cloisonnés** | Accepter la contrepartie, avec des règles dures : le statut d'affiliation **n'entre jamais** dans le classement des offres ni dans le conseil ; mention explicite dans chaque rapport ; test de non-régression vérifiant qu'un marchand affilié n'est jamais favorisé |
| **C — Renoncer au chantier** | Garder la collecte actuelle. Coût : la fiabilité (§4.1) et l'EAN natif (§4.2) restent hors de portée |

La position **A** est la plus alignée avec le projet mais risque d'être un
non-choix : si les programmes refusent l'accès sans promotion, elle se réduit
à **C**.

La position **B** est tenable *si et seulement si* le cloisonnement est
vérifié par des tests, comme l'a été l'étanchéité de la publication (9.2). Une
règle non testée n'est pas une règle.

> **Mon avis, puisqu'il est demandé implicitement — mais c'est votre
> décision :** tenter **A** auprès d'un seul programme pour mesurer si l'accès
> aux données sans promotion est possible. Si la réponse est non, **C**.
> La position **B** vaut d'être envisagée le jour où ce projet aurait des
> utilisateurs autres que vous — pas avant, parce qu'elle échange une
> propriété rare (un outil qui n'a aucun intérêt à ce que vous achetiez)
> contre une somme qui, sur un usage personnel, sera négligeable.

---

## 6. Ordre de priorité selon la couverture actuelle

Critères, dans cet ordre : nombre de vendeurs **actifs** couverts par une
seule démarche · poids réel dans la collecte · probabilité d'obtenir l'accès ·
apport en EAN.

### Priorité 1 — Groupe LDLC (`ldlc` + `materiel.net`)

Deux des 22 vendeurs actifs, tous deux en priorité 2 au catalogue, appartenant
au même groupe : **une seule démarche pourrait couvrir les deux** (*à
vérifier*). `ldlc` est par ailleurs l'un des deux marchands qui produisent
effectivement des prix dans la base actuelle. Meilleur rapport
couverture/effort du catalogue.

### Priorité 2 — Cdiscount

Marchand actif, priorité 2, présent sur les réseaux d'affiliation français,
gros catalogue informatique. C'est le second vendeur réellement productif dans
la base actuelle (7 relevés sur 32). Bon candidat pour tester la démarche §5-A.

### Priorité 3 — Fnac, Rue du Commerce, Boulanger

Trois vendeurs actifs, généralement accessibles via un même réseau — donc une
démarche mutualisable. Couverture informatique plus étroite que les
précédents.

### Priorité 4 — Rakuten

Réseau propre. Vendeur actif, mais **place de marché** : les prix y sont ceux
de vendeurs tiers, ce qui complique l'identification produit et la stabilité
des offres. Gain en fiabilité plus faible qu'il n'y paraît.

### Priorité 5 — Comparateurs (`idealo`, `ledenicheur`, `geizhals`)

Les trois comparateurs actifs sont ce qui donne au projet sa largeur de
couverture au meilleur coût. Ils relèvent de modèles de partenariat
différents (CPC plutôt qu'affiliation classique), généralement réservés aux
marchands. **À traiter séparément, ne pas mélanger avec les priorités 1-4.**

### Hors priorité — Amazon

§3.1. Condition d'entrée non satisfiable, et `amazon.fr` inactif au catalogue.

### Non concernés — les 9 vendeurs actifs non français

`alternate.fr`, `pccomponentes`, `mindfactory`, `caseking`,
`computeruniverse`, `galaxus`, `megekko`, `proshop`, `geizhals` : programmes
nationaux distincts, à n'envisager qu'après un premier succès en France.

---

## 7. Estimation d'effort

> **Section séparée du reste**, et à ne lire qu'après avoir tranché le §5.

| Lot | Contenu | Effort |
|---|---|---|
| **0. Démarches** | Inscriptions, validation par annonceur, lecture des conditions | **faible en travail, long en délai** — semaines à mois, hors de tout contrôle |
| **1. Premier connecteur** | Un flux, un marchand : téléchargement, parcours, `tier="api"` | **moyen** |
| **2. Raccordement identité** | Injection des EAN du flux dans `identites` / `annonces` (6.5) | **faible** — le modèle existe |
| **3. Arbitrage fraîcheur** | Décider et tester la règle « API ancienne vs `jsonld` récent » (§3.5) | **moyen** — décision de conception, pas de code |
| **4. Cloisonnement** | Si position §5-B : tests garantissant qu'un marchand affilié n'est jamais favorisé | **faible en code, indispensable** |
| **5. Connecteurs suivants** | Par marchand, une fois le premier fait | **faible et décroissant** |

Le lot 0 domine le calendrier et ne dépend pas de vous. Les lots 1 à 5 sont du
développement borné, testable, sans migration risquée du socle — contrairement
à ce qu'a été la bascule SQLite du prompt 6.4.

---

## 8. Recommandation

**Chantier plus sain que H.1, mais à engager par le petit bout.**

Il ne contredit aucun garde-fou : il *renforce* le civisme réseau (§4.3), il
ne dégrade pas l'expérience double-clic, il s'insère dans un palier déjà
prévu, et il ne touche pas au socle.

Trois étapes, dans cet ordre :

1. **Trancher le §5.** Rien ne sert d'engager une démarche sans savoir si un
   lien d'affiliation est acceptable. C'est la seule décision réellement
   bloquante, et elle n'est pas technique.
2. **Une seule démarche, priorité 1 (Groupe LDLC).** Objectif : découvrir si
   l'accès aux données est possible sans promotion active. C'est
   l'information manquante qui commande tout le reste — et elle s'obtient en
   écrivant un courriel, pas du code.
3. **N'écrire le lot 1 qu'après un accès obtenu.** Un connecteur pour un flux
   auquel on n'a pas accès est du code mort, et le palier `api` peut rester
   vide sans gêner personne — il l'est déjà.

Une remarque pour finir : le gain le plus intéressant de ce chantier n'est pas
celui qu'on en attend. Ce n'est ni la fiabilité ni la contrepartie
commerciale, c'est **l'EAN natif** (§4.2) — la pièce sur laquelle bute
l'identité produit, et avec elle tout ce qui en dépend.

---

*Document de cadrage — horizon v4. Aucun engagement. Les conditions des
programmes tiers sont à revérifier au moment de la décision.*
