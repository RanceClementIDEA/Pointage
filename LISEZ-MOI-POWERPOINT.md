# Sélection de rituel → PowerPoint

Produit, depuis l'annuaire, un support à la charte IDEA : une diapositive de
couverture puis **une diapositive par KPI sélectionné**, calquée sur les pages 3 à 10
du support « Indicateurs Magasins Armement ».

## En trois gestes

1. dans l'annuaire, cochez vos KPI, puis **📊 Générer le PowerPoint** ;
2. si des lignes affichent `à relever`, suivez le guidage de la fenêtre :
   **📋 Préparer le relevé**, une insertion par KPI dans PowerPoint, puis vous
   **déposez le fichier** sur la fenêtre ;
3. **📊 Générer et télécharger**.

Le relevé ne se fait **qu'une fois par KPI**, et part dans la synchronisation :
personne d'autre n'a à le refaire.

## Utilisation

1. **Barre latérale → « Sélection & PowerPoint »**. Une barre d'action apparaît et
   chaque carte reçoit une case à cocher.
2. **Filtrez** (Rituel = COPIL, par exemple) puis **« ✓ Tout cocher »**. Le numéro
   affiché sur chaque case est le rang de la diapositive : c'est l'ordre du jour.
3. **« 💾 Enregistrer »** nomme la sélection. Elle est partagée avec l'équipe par la
   synchronisation existante et se recharge d'un clic la semaine suivante.
4. **« 📊 Générer le PowerPoint »** : réglez le titre, le sous-titre et la période,
   ajustez l'ordre et les commentaires, puis téléchargez.

### Une seule chaîne : le visuel vivant

Le choix se fait dans la fenêtre de génération, liste **« Contenu des visuels »**.

### Ce que fait le complément Power BI

Le générateur pose dans chaque diapositive le **complément Power BI pour PowerPoint**,
configuré sur l'adresse du KPI. Le visuel est *connecté* : rien à capturer, et le
support affiche les données du jour chez chaque lecteur qui a les droits. Le deck du
COPIL de la semaine prochaine montrera les chiffres de la semaine prochaine, sans le
régénérer.

Structure produite, relevée sur un fichier fabriqué par Power BI lui-même
(« Exporter → PowerPoint → Incorporer des données actives ») :

- `ppt/webextensions/webextensionN.xml` — complément `WA200003233`, avec la propriété
  `reportUrl` (chemin relatif à `app.powerbi.com`), `reportState = CONNECTED`,
  `artifactViewState = live`
- dans la diapositive, un `mc:AlternateContent` : la branche `Choice` porte le
  `graphicFrame` du complément, la branche `Fallback` affiche un cadre expliquant
  qu'il faut activer le complément — jamais un trou blanc

Prérequis côté lecteur : PowerPoint 365 avec WebView2, connecté au **même compte
professionnel** que Power BI. Si le complément est bloqué par la stratégie du tenant,
c'est la branche `Fallback` qui s'affiche.

#### L'adresse donnée au complément : verbatim, et rien d'autre

Le complément ne tolère aucun ajout dans `reportUrl`. Relevé sur une insertion faite à la
main dans PowerPoint — la seule qui affiche réellement le visuel — il conserve le lien de
partage **exactement** tel qu'il est collé, seulement privé de son hôte :

```
/groups/me/reports/{rapport}/{page}?ctid=…&pbi_source=shareVisual
&visual=…&height=…&width=…&bookmarkGuid=…
```

Y glisser `bookmarkUsage=1` et `fromEntryPoint=export` — qui appartiennent au format
d'export d'une PAGE — le fait échouer à résoudre le visuel **et** la page : il retombe
alors sur la première page du rapport.

#### L'adresse ne suffit pas : il faut l'EMPREINTE du visuel

Voici le point qui a longtemps bloqué, et il est contre-intuitif.

Un support généré dont le `reportUrl` est **octet pour octet identique** à celui d'une
insertion faite à la main affiche quand même :

> Impossible de charger votre objet visuel — l'objet visuel ajouté ici n'existe plus.

Parce que **le complément ne relit pas l'adresse à l'ouverture**. Il la résout une seule
fois, à l'insertion, puis mémorise le résultat dans le fichier et se contente ensuite de
le restaurer. Un fichier fabriqué de toutes pièces n'a rien à restaurer.

Ce qu'il mémorise, et qu'il faut donc lui rendre — l'**empreinte** du visuel :

| Propriété | |
|---|---|
| `artifactName` | le nom de l'objet visuel (« Histo empilé ») |
| `reportName`, `pageName`, `pageDisplayName` | la page où il vit |
| `datasetId` | le jeu de données |
| `bookmark`, `initialStateBookmark` | l'état sérialisé de la page — filtres et segments, ~5 Ko |
| `embedUrl`, `backgroundColor` | relevés aussi : l'adresse d'incorporation porte l'indicatif du locataire |

Vérifié en conditions réelles, une diapositive à la fois, dans PowerPoint :

| Ce que porte la diapositive | Résultat |
|---|---|
| l'adresse seule | ❌ « l'objet visuel n'existe plus » |
| + `artifactName` | ❌ |
| + page et jeu de données | ❌ |
| **+ l'état sérialisé** | ✅ **le graphique s'affiche** |
| tout, y compris les champs de session | ✅ |
| l'état réel **sans** `artifactName` | ✅ |
| un état **fabriqué**, vide ou portant le visuel visé | ❌ |

Quatre conclusions pratiques :

- **l'état sérialisé n'est pas facultatif.** On ne peut pas alléger une empreinte pour
  gagner de la place : elle deviendrait muette ;
- **il ne peut pas non plus être fabriqué.** Un état construit de toutes pièces, même
  contenant la description du visuel visé, est rejeté : le complément le valide auprès
  du service. Générer une empreinte à partir du seul lien est donc impossible ;
- **`artifactName` n'est qu'une étiquette.** L'état réel privé de ce nom affiche le
  graphique. Il sert au relevé — c'est la marque d'une insertion faite à la main — pas
  à l'affichage ;
- **les champs de session ne servent à rien** (`creatorSessionId`, `creatorUserId`,
  `creatorTenantId`, `reportEmbeddedTime`, annotations). Ils ne sont donc pas relevés :
  un fichier neuf n'a pas à porter les traces de la session de quelqu'un d'autre.

#### Le signet : ce qui distingue deux KPI d'un même visuel

Attention — c'est le piège le plus coûteux, et il a fallu un support réel pour le voir.

Plusieurs KPI peuvent pointer vers **le même visuel Power BI**. Sur cet annuaire, trois
« Volumétrie » partagent `14bddbd2…` et quatre « Taux de service » partagent `2d4bfd20…`.
Ce qui les distingue n'est pas `visual=`, c'est **`bookmarkGuid=`** : le signet, donc les
filtres et les segments.

Or l'état mémorisé **écrase le signet du lien**. Une empreinte relevée sur un signet et
appliquée à un autre affiche donc le bon graphique **avec les chiffres d'un autre KPI** —
et rien n'a l'air cassé.

L'empreinte mémorise donc le signet dont son état provient, et la fenêtre de génération
prévient : `⚠ autre vue`. L'état reste posé — sans lui le complément ne résout rien —
mais on ne prétend plus que la diapositive est juste.

#### Les empreintes livrées avec l'annuaire

`empreintes-livrees.json`, déposé à côté d'`index.html`, est chargé au démarrage. Il porte
les empreintes déjà relevées : **rien à importer**, ces KPI marchent dès le déploiement.

Il ne fait que COMBLER — ce qui est déjà connu localement ou partagé par l'équipe l'emporte
toujours. Son absence n'est pas une erreur : l'annuaire démarre normalement sans lui.

Pour le régénérer après de nouveaux relevés :

```bash
node outils/relever-empreintes.js *.pptx --sortie empreintes-livrees.json
```

⚠️ Ce fichier contient l'état sérialisé des pages du rapport — noms de tables, de colonnes
et de filtres. C'est de la métadonnée métier : à garder dans un dépôt privé.

#### Relever une empreinte

L'unique geste manuel, **une fois par KPI**. La fenêtre de génération le guide en trois
étapes, et n'affiche ce guidage que tant qu'il reste quelque chose à relever :

1. **📋 Préparer le relevé** télécharge un PowerPoint : une diapositive par KPI encore
   dépourvu d'empreinte, portant son nom et **son lien écrit en clair** ;
2. dans PowerPoint, pour chaque diapositive : sélectionner le lien affiché,
   *Insertion › Compléments › Power BI*, le coller, vérifier que le graphique s'affiche.
   Enregistrer ;
3. revenir dans la fenêtre et **déposer ce fichier dessus** — ou
   **🔎 Relever les empreintes**.

Le bouton accepte aussi un **relevé `.json`** déjà constitué, ce qui permet de transmettre
un relevé d'un annuaire à l'autre sans refaire l'insertion :

```bash
node outils/relever-empreintes.js support1.pptx support2.pptx --sortie empreintes.json
```

Une fois relevées, les empreintes partent dans la synchronisation : **toute l'équipe en
profite**, personne n'a à refaire l'insertion.

⚠️ **Toujours coller le lien affiché sur la diapositive.** Repartager le visuel depuis
Power BI crée un **nouveau** `bookmarkGuid` : l'empreinte obtenue ne correspondrait à
aucun KPI. C'est l'erreur la plus facile à commettre, et la plus difficile à voir.

⚠️ **Et une fois l'empreinte relevée, ne repartagez plus ce lien.** Remplacer le lien d'un
KPI par un partage neuf périme son empreinte. La fenêtre le signale alors par
`⟳ lien repartagé` plutôt que par un simple `à relever` : on sait tout de suite qu'il ne
s'agit pas d'un oubli.

#### Où vivent les empreintes

Dans un **document de synchronisation séparé** — `kpi_sync/{code}__empreintes` — et non
dans le document principal. L'état sérialisé pèse ~5 Ko par visuel, alors que Firestore
plafonne un document à 1 Mo : les mêler ferait courir le risque de ne plus pouvoir
enregistrer l'annuaire du tout. Le document principal n'a pas changé de taille.

#### Le signet, ou pourquoi le bon visuel peut montrer les mauvaises données

Dans cet annuaire, plusieurs KPI partagent le même visuel Power BI : ce qui les distingue
est le **signet** (`bookmarkGuid`), qui applique le filtre — périmètre, temporalité. Le
même graphique devient « Volumétrie Distribution Logistiport hebdomadaire » ou
« … MG Armement mensuelle » selon le signet appliqué.

Le signet voyage dans l'adresse, dans le `bookmarkGuid` du lien de partage — et il suffit
de transmettre ce lien intact. C'est le complément qui l'applique et sérialise l'état à la
première ouverture.

Le contrôle affiche le signet de chaque diapositive, et signale deux diapositives qui
viseraient le même visuel **avec le même signet** — elles montreraient rigoureusement la
même chose.

#### Le bon graphique, et lui seul

Le complément n'affiche que ce que le lien désigne. Deux pièges, tous deux
détectés dans la fenêtre de génération :

- **un lien de PAGE** (`app.powerbi.com/links/…`, ou l'adresse copiée depuis la barre
  du navigateur) affiche **tout le rapport** ;
- **un visuel plus de dix fois plus large que haut** a un format inhabituel pour un
  graphique : la page le signale pour que vous l'ouvriez et confirmiez, elle ne tranche pas
  à votre place.

Chaque ligne annonce donc ce que son lien désigne — `⚡ visuel 1253×528 px`,
`⚠ page entière`, `⚠ format allongé` — et un bilan récapitule avant de générer. Le cadre du
complément épouse le format réel du visuel : un graphique large et bas reste large et
bas, il n'est ni étiré ni noyé. La barre d'outils du visuel est masquée
(`isVisualContainerHeaderHidden`) : il ne reste que le graphique.

**`verificateur-liens.html`** est la page qui tranche pour de bon : elle liste chaque lien
avec ce qu'il désigne, un bouton qui l'ouvre dans Power BI avec votre session, et deux
boutons « Le bon » / « Pas le bon ». Pour les liens à reprendre, un champ recueille le lien
corrigé ; l'export CSV vous rend la liste complète à reporter dans l'annuaire. Les réponses
restent dans votre navigateur, rien n'est envoyé.

Pour auditer tout l'annuaire d'un coup, sans ouvrir les liens :

```bash
node outils/verifier-liens.js sauvegarde.json
```

La sauvegarde s'exporte depuis **Synchronisation → Exporter la sauvegarde**. L'outil
liste chaque lien, son verdict et son format, et signale les visuels utilisés par
plusieurs KPI — signe d'un copier-coller resté en place.

**`testeur-powerpoint.html`** est le banc d'essai de la fabrication : collez des liens (ou
chargez une sauvegarde de l'annuaire), choisissez le contenu des visuels, générez — et la
page relit aussitôt le fichier qu'elle vient de produire pour dire, diapositive par
diapositive, quel visuel elle vise, de quelle page, dans quel format et avec quel cadre.
Le modèle IDEA y est embarqué : double-clic, hors ligne, rien n'est envoyé.

Et pour contrôler un support déjà produit, sans ouvrir PowerPoint :

```bash
node outils/verifier-deck.js deck.pptx
```

Il affiche, diapositive par diapositive, le visuel visé, sa page, son rapport, son
format et le cadre obtenu — puis conclut « Aucune anomalie » ou liste ce qui cloche.

Pour reprendre un lien fautif : dans Power BI, sur **le visuel**, `…` → **Partager** →
**Lien vers cet élément visuel**, puis collez-le dans la fiche du KPI.

## Ce qui a été ajouté au dépôt

| Fichier | Rôle |
|---|---|
| `js/zip.js` | lecture / écriture d'archives ZIP (un .pptx en est une) |
| `js/pptx.js` | fabrique du support : diapositives, liens, images, sommaire |
| `js/selection.js` | modèle des sélections : ordre, périmètres, fusion multi-postes |
| `js/empreintes.js` | mémoire du complément par visuel : relevé, fusion, application |
| `js/derivation.js` | recompose une empreinte à partir d'autres : zones et temporalités |
| `outils/relever-empreintes.js` | relève les empreintes d'un ou plusieurs PowerPoint |
| `empreintes-livrees.json` | empreintes déjà relevées, chargées au démarrage — **doit être déployé** |
| `outils/diagnostic-derivation.js` | une empreinte peut-elle en engendrer d'autres ? |
| `modele-deck.pptx` | charte IDEA (masque, thème, couverture) — **doit être déployé** |
| `outils/verifier-liens.js` | audit des liens : visuel, page ou bandeau |
| `outils/verifier-deck.js` | contrôle d'un support produit, diapositive par diapositive |
| `js/inspecter-deck.js` | lecture d'un .pptx produit (partagée page web / ligne de commande) |
| `outils/construire-annuaire-test.js` | fabrique `annuaire-test.html`, la copie d'essai étanche |
| `smoke-essai.js` | contrôle d'étanchéité de la copie d'essai |
| `zip.test.js`, `pptx.test.js`, `selection.test.js`, `empreintes.test.js`, `deck.test.js`, `outils.test.js` | 331 tests |
| `smoke-ui.js` | contrôle de bout en bout dans un vrai navigateur |

`app.js`, `index.html`, `style.css`, `service-worker.js` et le banc de test ont été
complétés ; aucun comportement existant n'a été modifié.

### Le modèle `modele-deck.pptx`

Il contient le masque, le thème, les six dispositions et la diapositive de couverture,
dont trois jetons sont substitués à la génération : `{{TITRE}}`, `{{SOUS_TITRE}}`,
`{{PERIODE}}`. Pour changer la charte, ouvrez-le dans PowerPoint, modifiez le masque
ou la couverture, enregistrez — **en conservant les trois jetons**.

## Essayer sans toucher à l'annuaire réel

`annuaire-test.html` est la **même application** qu'`index.html` — mêmes scripts, même
modèle, mêmes fonctionnalités — mais étanche à la production sur trois points :

| | |
|---|---|
| **Stockage** | préfixé (`essai:`). Les deux pages partagent l'origine, donc le localStorage : sans ce cloisonnement, la copie lirait et écrirait les vraies fiches. |
| **Synchronisation** | code dédié `idea-kpi-essai` — le document de l'équipe n'est jamais touché. |
| **Service worker** | non enregistré : pas de cache qui se mélange entre les deux pages. |

Déposez-la **à côté d'`index.html`** : elle réutilise `js/`, `style.css`,
`modele-deck.pptx` et les images du dépôt, elle ne pèse donc que 40 Ko et ne peut pas
diverger de l'application réelle. Une bannière la signale en permanence, avec un lien de
retour vers l'annuaire réel et un bouton « Repartir de zéro » qui n'efface que les données
d'essai.

```bash
npm run build:essai                       # régénère annuaire-test.html depuis index.html
node outils/construire-annuaire-test.js --code mon-essai --prefixe bac:
npm run smoke:essai                       # prouve l'étanchéité dans un vrai navigateur
```

Régénérez-la après toute évolution d'`index.html` — c'est une commande, pas un fichier à
maintenir à la main.

## Tests

```bash
node --test              # 767 tests (dont 331 pour cette fonctionnalité)
npm run test:deck        # les seuls tests de la chaîne PowerPoint
npm run test:outils      # les outils en ligne de commande
node build-tests-html.js # régénère tests.html (banc de test navigateur)
node verify-tests-html.js
npm run smoke            # parcours réel dans Chromium (npx playwright install chromium)
npm run lint
```

## Un relevé en engendre d'autres

13 KPI × 3 temporalités × 4 zones, c'est **156 liens**. Autant de relevés : intenable.

L'état d'un signet contient les **segments de la page** — le KPI retenu, la priorité, la
dimension d'affichage, le code aire. Deux états du même visuel ne diffèrent que par **2 à
10 conteneurs sur 54**, exactement ceux-là.

Vérifié dans PowerPoint, et c'est ce qui change tout :

| | |
|---|---|
| un état décompressé puis recompressé à l'identique | ✅ s'affiche |
| un état dont on a recopié les conteneurs divergents d'un autre | ✅ affiche **exactement** ce que montrait le second |

#### Ce qu'est vraiment une temporalité

Relevé sur les états réels : changer de temporalité revient à **remplacer une colonne de
calendrier**.

| Visuel | Mensuel → autre |
|---|---|
| `14bddbd2` | `ReducMonth-year` → `Date` |
| `d62c8a33` | `ReducMonth-year` → `YearWeek` |
| `2d4bfd20` | `Groupe Mois Fin Short` → `Groupe Semaine Fin` |

Et cette colonne **ne dépend pas du visuel** : deux visuels d'une même page emploient la
même. La leçon apprise sur l'un vaut donc pour l'autre — ce qu'une simple recopie de
conteneur ne permettrait pas, puisque chaque visuel a le sien.

L'annuaire distingue donc deux choses dans une leçon :

- les **segments partagés** de la page, recopiés tels quels ;
- la **substitution de colonne**, rejouée dans le conteneur du visuel VISÉ.

Une substitution n'est retenue que si une seule colonne change. Au-delà, on ne saurait pas
laquelle correspond à laquelle, et deviner produirait une vue fausse.

Il y a **trois axes**, et l'intitulé en fait partie : le KPI retenu vit lui aussi dans un
segment. Relevé sur les insertions réelles, ce conteneur porte
`'KPI 5.2 - Distribution urgentes'`, `'KPI 2.2 - Réception urgentes'`… Deux intitulés se
déduisent donc l'un de l'autre, exactement comme deux zones — **même quand le graphique
n'est pas le même**, car c'est le lien qui désigne le visuel, pas l'état.

L'annuaire apprend sur deux relevés qui ne diffèrent **que** par un axe, et rejoue cette
différence partout ailleurs. Il choisit le chemin le plus court, et refuse tout chemin dont
deux étapes toucheraient les mêmes segments — mieux vaut annoncer `à relever` qu'une vue
fausse. La fenêtre marque `✨ déduit` les diapositives obtenues ainsi.

**Ce qu'il faut relever à la main**, une fois : un KPI de départ, puis **un exemple par
valeur d'axe** — un par intitulé supplémentaire, un par zone supplémentaire, un par
temporalité supplémentaire. Sur 13 intitulés, 4 zones et 3 temporalités :
**1 + 12 + 3 + 2 = 18 relevés au lieu de 156.**

On ne fabrique jamais rien : on **recopie** ce que Power BI a lui-même écrit. Un état
inventé est rejeté — c'est vérifié — mais un état recomposé de morceaux réels ne l'est pas.

Les empreintes déduites ne durent que la session : ni enregistrées, ni partagées. 156 états
de 5 Ko feraient éclater le document commun, et il vaut mieux les recalculer que les voir
vieillir.

## Ce qui reste à faire à la main

Un relevé par intitulé, plus un exemple par zone et par temporalité. Le guidage de la
fenêtre l'explique, et s'efface quand il n'y a plus rien à relever.

`outils/diagnostic-derivation.js` a servi à établir tout ce qui précède ; il reste au
dépôt pour qu'on puisse le refaire si le complément Power BI change de comportement.

## Points restés ouverts

- **Une empreinte est à relever pour chaque KPI**, c'est-à-dire pour chaque lien. C'est un
  geste unique par KPI, mais il reste manuel : le complément valide l'état auprès du
  service, et n'expose aucun moyen de produire cette mémoire sans une insertion réelle
  dans PowerPoint. Ni l'API REST de Power BI ni le SDK JavaScript ne donnent l'état d'un
  lien de partage.
- **Une empreinte survit-elle à une refonte du rapport ?** Si un visuel est recréé, son
  identifiant change et l'empreinte devient orpheline : la ligne repassera à
  « à relever », ce qui est le bon signal, mais l'ancienne empreinte reste stockée.

- **La colonne Rituel n'est renseignée que sur 3 lignes sur 40.** Sélectionner par
  rituel suppose de la remplir, et de figer un vocabulaire : aujourd'hui le champ est
  libre, une faute de frappe crée un rituel fantôme.
- **Un KPI peut-il appartenir à plusieurs rituels ?** Si oui, `ritual` doit devenir une
  liste — cela touche l'import Excel, le filtre et l'export.
- **Un même KPI sur plusieurs périmètres dans un même rituel** produit aujourd'hui une
  seule diapositive (un périmètre par ligne de sélection).
