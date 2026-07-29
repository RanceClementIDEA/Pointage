# Tableau de bord

*Roadmap 3.3 et 3.4 — vague 3*

Un tableau de bord visuel avec courbes d'évolution, généré à chaque
exécution. **Fichier HTML entièrement autonome** : aucun script externe,
aucune police distante, aucun appel réseau. Les graphiques sont dessinés en
SVG pur.

---

## Pourquoi c'est important pour votre cas

Vous m'avez dit être sur un ordinateur de travail qui bloque des choses.
Ce fichier ne peut rien déclencher :

- **aucune connexion sortante** — vérifié, il ne contient pas une seule URL
- **aucun JavaScript** — vérifié également
- **aucune installation** — c'est un fichier, pas un programme

Ouvrir une pièce jointe HTML depuis votre messagerie est une action
parfaitement banale, contrairement à l'exécution d'un script Python ou à la
création d'une tâche planifiée.

---

## Comment y accéder — 3 options

### Option 1 : en pièce jointe de l'email (recommandée)

**C'est automatique, il n'y a rien à faire.** Chaque email quotidien
contient le tableau de bord en pièce jointe :
`tableau-de-bord-2026-07-23.html`. Vous cliquez, il s'ouvre dans votre
navigateur.

Avantages : privé (rien n'est publié nulle part), fonctionne partout, garde
un historique consultable dans votre boîte mail.

### Option 2 : en local

```bash
python dashboard.py
```

Génère `dashboard.html` dans le dossier. Double-cliquez dessus.

### Option 3 : GitHub Pages — attention, lisez avant

C'est ce que j'avais suggéré initialement, mais **la réalité est plus
contraignante que je ne le pensais** :

| Votre situation | Ce qui est possible |
|---|---|
| Dépôt **privé** + plan **Free** | GitHub Pages **indisponible** |
| Dépôt **privé** + plan **Pro** (payant) | Pages disponible, mais **le site publié est public** |
| Dépôt **public** + plan Free | Pages disponible, site public, **et votre dépôt est visible** |
| Organisation **Enterprise Cloud** | Seul cas où le site peut être réellement privé |

Autrement dit : **il n'existe pas de configuration gratuite où le tableau de
bord serait à la fois hébergé et privé.** Si vous publiez, n'importe qui
connaissant l'URL `votrepseudo.github.io/nom-du-depot` verra votre liste de
composants, vos prix cibles et votre budget.

Ce n'est pas dramatique — ce sont des pièces PC, pas des données bancaires —
mais autant le savoir. **Pour la plupart des usages, l'option 1 (pièce
jointe) est meilleure sur tous les plans.**

Si vous voulez quand même publier : Settings → Pages → Source : branche
`main`, dossier `/docs`. Le fichier `docs/index.html` est déjà généré et
commité automatiquement par le workflow.

---

## Ce que contient le tableau de bord

**En-tête** : total actuel, meilleur total jamais atteint, écart entre les
deux, et position par rapport à votre budget (vert / orange / rouge).

**Évolution du total** : histogramme sur toute la période de suivi. La barre
verte marque le meilleur jour, la rouge le pire. Survolez une barre pour
voir la date et le montant exacts.

**Une carte par composant** :
- prix actuel et vendeur
- courbe d'évolution (point vert = prix le plus bas observé, point foncé =
  prix actuel)
- min / max / nombre de relevés
- barre de progression : position du prix dans sa fourchette historique
  (pleine = au plus bas)
- distance restante jusqu'à votre prix cible
- badge « PRIX CIBLE ATTEINT », « au plus bas » ou « non vérifié Xj »
- pour les composants en groupe d'équivalence : le slot et l'indice de perf

---

## Bilan hebdomadaire

*Roadmap 3.4*

Le rapport quotidien montre le bruit, le bilan hebdomadaire montre la
tendance de fond. Il s'affiche **automatiquement le dimanche**, ou à la
demande :

```bash
python price_tracker.py --digest --no-email
```

Exemple réel sur les données actuelles :

```
--- BILAN DE LA SEMAINE : 4 baisse(s), 6 hausse(s) ---
  v AMD Ryzen 7 5700X            156.94 -> 121.45 EUR (-22.6%)
  v MSI MAG Forge 320R Airflow    84.99 ->  69.29 EUR (-18.5%)
  v Gigabyte B550 Gaming X V2     99.99 ->  97.07 EUR  (-2.9%)
  ^ AMD RX 9060 XT 16 Go         419.00 -> 429.00 EUR  (+2.4%)
  ^ NVIDIA RTX 5060 Ti 8 Go      399.00 -> 433.09 EUR  (+8.5%)
```

Trié du plus forte baisse à la plus forte hausse : les bonnes nouvelles
d'abord.

---

## Mode silencieux

*Roadmap 3.6*

Un email quotidien qui ne dit rien de neuf finit par être ignoré — et le
jour où il contient une vraie information, vous ne l'ouvrez pas.

```bash
python price_tracker.py --silencieux
```

L'email ne part alors que s'il y a **matière** :
- une occasion ultime,
- au moins un composant à acheter,
- un changement de recommandation dans un groupe d'équivalence,
- une source en panne,
- le bilan hebdomadaire du dimanche.

L'alerte push ntfy, elle, part **toujours** en cas d'occasion ultime, quel
que soit le mode. Le silence ne s'applique jamais à ce qui est urgent.

Pour activer en permanence sur GitHub Actions, modifiez la dernière étape du
workflow : `run: python price_tracker.py --silencieux`.

---

## Vérifications effectuées

| Contrôle | Résultat |
|---|---|
| Aucune URL externe dans le fichier | ✅ |
| Un seul bloc `<script>` inline, sans dépendance | ✅ |
| Balises HTML équilibrées | ✅ |
| Graphiques générés | ✅ 12 SVG |
| Taille du fichier | ~38 Ko |

Le fichier reste léger **quelle que soit la profondeur de l'historique** : les
courbes n'utilisent qu'un point par jour (le prix le plus bas de la journée),
et au-delà de quelques centaines de jours le dessin est allégé — sans jamais
raboter les creux ni les pics.

Le plancher, le plafond et les effectifs affichés restent ceux de la donnée
**complète** : alléger l'affichage n'est pas perdre de l'information. Mesuré
sur un historique synthétique de cinq ans (23 738 relevés) : **368 Ko**,
généré en **0,10 s**.

Le sélecteur de fenêtre (**7 j · 30 j · 90 j · 1 an · tout**) remplace l'échelle
fixe : les fenêtres courtes sont servies au jour le jour, la vue « tout »
par une courbe allégée.
