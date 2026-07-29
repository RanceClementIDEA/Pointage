# Guide d'achat — quand acheter, où, et comment ne pas se faire avoir

Complément au script : ce que l'automatisation ne peut pas deviner à votre
place.

---

## 1. Le calendrier de l'année

Le script connaît ces dates et ajuste ses conseils quand une période
approche (moins de 45 jours). Voici le raisonnement derrière.

| Période | Dates approx. | Baisse typique | Le plus intéressant pour |
|---|---|---|---|
| Soldes d'hiver | 8 janv. → 4 févr. | ~10% | Boîtier, alim, SSD, ventirad |
| French Days printemps | fin avril → début mai | ~8% | SSD, RAM, boîtier |
| Soldes d'été | 24 juin → 21 juil. | ~10% | Boîtier, alim, SSD, carte mère |
| Prime Day | mi-juillet | ~12% | SSD, RAM, accessoires |
| French Days automne | fin septembre | ~8% | SSD, RAM, carte mère |
| **Black Friday / Cyber Monday** | **20 nov. → 2 déc.** | **~18%** | **GPU, CPU, SSD, RAM, écran** |

**La règle simple** : si vous n'êtes pas pressé et qu'on est à moins de deux
mois du Black Friday, attendez. C'est la seule période où les cartes
graphiques et processeurs baissent vraiment. Le reste de l'année, les
promos portent surtout sur la périphérie (boîtiers, alims, stockage).

**Le piège du Black Friday** : beaucoup de « promos » sont des prix gonflés
quelques semaines avant, puis « baissés ». D'où l'intérêt d'avoir un
historique : votre script vous dira si les 399 € affichés sont vraiment un
plus bas ou juste le prix habituel avec un autocollant rouge.

### Les événements produit qui font bouger les prix

Plus important que le calendrier commercial pour les GPU/CPU :
- **Sortie d'une nouvelle génération** → la génération précédente chute de
  15-30% dans les semaines qui suivent.
- **Annonce (pas la sortie)** → parfois suffisante pour faire bouger les
  prix par anticipation.
- **CES en janvier, Computex fin mai** : les annonces majeures y sont faites.

Si une nouvelle série AMD/NVIDIA est annoncée pendant votre veille, attendez
2-3 semaines avant d'acheter l'ancienne génération.

---

## 2. Quel site pour quel composant

Le script mesure ça automatiquement pour vos produits (colonne « le moins
cher : X sur N comparaisons »), mais voici les tendances générales du marché
français.

### Les valeurs sûres

**LDLC / Materiel.net** (même groupe)
Prix rarement les plus bas, mais SAV et gestion de garantie excellents,
stock fiable, boutiques physiques. Le configurateur LDLC vérifie la
compatibilité entre composants — utile même si vous achetez ailleurs.
→ **Le bon choix pour les pièces où une panne serait pénible** : carte mère,
alimentation.

**Cdiscount (vendu et expédié par Cdiscount)**
Souvent les prix les plus agressifs sur les CPU et GPU. Attention : vérifiez
que c'est bien Cdiscount le vendeur, pas un tiers de la marketplace.
→ **Bon pour le CPU et le GPU** si le vendeur est bien Cdiscount.

**Amazon (vendu et expédié par Amazon)**
Prix compétitifs, retour très simple sous 30 jours. Même vigilance : évitez
les vendeurs tiers inconnus.
→ **Bon pour le stockage, ventirads, accessoires.**

### Les moins chers, mais à surveiller

**Rakuten, Fnac Marketplace, eBay** — le prix affiché est souvent le plus bas
du comparateur, mais c'est fréquemment un vendeur tiers. Vérifiez le nombre
d'évaluations et leur ancienneté. La garantie passe par le vendeur, pas par
la plateforme : en cas de panne à 8 mois, c'est beaucoup plus laborieux.

**Alternate, Grosbill, TopAchat, 1FODiscount** — revendeurs spécialisés
sérieux, souvent 20-50 € moins chers que LDLC sur les GPU. Moins de notoriété
grand public mais ce sont des acteurs établis du hardware.

### Le réflexe qui fait gagner de l'argent

**Dealabs.com** — communauté française qui repère les bugs de prix, ventes
flash et codes promo en temps réel. Créez une alerte par mot-clé sur vos
composants. C'est souvent plus rapide que n'importe quel script, parce que
ce sont des humains qui repèrent les anomalies.

**idealo.fr** — comparateur avec courbe de prix sur 12 mois. Indispensable
pour remplir la section `seed_history` de votre config, et pour vérifier
qu'une « promo » en est vraiment une.

---

## 3. Neuf, occasion ou reconditionné : la règle par composant

| Composant | Recommandation | Pourquoi |
|---|---|---|
| **CPU** | Neuf sans hésiter | Écart de prix faible avec l'occasion, et un CPU d'occasion peut avoir des pins tordues |
| **Carte mère** | Neuf | Pièce la plus pénible à remplacer (tout démonter), garantie précieuse |
| **RAM** | Neuf | Garantie à vie chez la plupart des marques, écart faible |
| **GPU** | Occasion possible, avec précautions | C'est là que l'écart est le plus gros (100-200 €) |
| **SSD** | Neuf | L'usure NAND ne se voit pas ; risque non mesurable en occasion |
| **Alimentation** | **Neuf impérativement** | Une alim qui lâche peut emporter le reste de la config |
| **Boîtier** | Occasion très bien | Aucune électronique, seulement de la tôle |
| **Ventirad** | Occasion OK | Vérifiez juste la présence du kit de fixation |

### Si vous achetez un GPU d'occasion

- Demandez les **heures d'utilisation** et l'usage (gaming vs minage).
- Privilégiez un vendeur avec **facture** (garantie constructeur souvent
  transférable, 2-3 ans chez la plupart des marques).
- Testez dans les 48h : un stress test type FurMark ou 3DMark révèle
  rapidement un problème thermique.
- Sur Back Market / Rakuten, la garantie 12 mois de la plateforme change
  tout par rapport à un achat entre particuliers.

---

## 4. Le protocole avant de cliquer sur « payer »

1. **Vérifier le vendeur** — « vendu et expédié par [le marchand] » et non
   par un tiers. C'est la source n°1 de mauvaises surprises.
2. **Vérifier le prix barré** — le script vous dit si c'est un vrai plus bas.
   Les « -60% » affichés par les marketplaces sont souvent calculés sur un
   prix catalogue théorique qui n'a jamais existé en vrai.
3. **Compter les frais de port** — un composant 5 € moins cher avec 8 € de
   port n'est pas moins cher.
4. **Vérifier le stock réel** — « expédié sous 3 à 6 semaines » est un signal
   d'alerte.
5. **Payer par carte** (pas par virement) pour garder un recours.

---

## 5. Stratégie d'achat échelonné

Le script recommande parfois « ACHAT ECHELONNE ». C'est souvent la meilleure
approche, pour une raison simple : **vos composants n'atteignent pas leur
prix plancher le même jour**.

Comment procéder :

1. **Achetez d'abord ce qui est au plus bas**, en commençant par les pièces
   dont le prix ne baisse plus beaucoup (boîtier, alim, ventirad — ce sont
   des produits matures, leur prix est stable).
2. **Gardez le GPU pour la fin** si une période promo approche : c'est le
   poste le plus cher, donc celui où 15% font le plus de différence en
   euros absolus.
3. **Exception : la RAM.** En période de pénurie (c'est le cas en 2026),
   attendre coûte plus cher qu'acheter. Le script le signale via le
   `market_context`.

⚠️ **Le seul vrai risque de l'achat échelonné** : les délais de retour. Si
vous achetez la carte mère en septembre et découvrez un défaut en montant le
PC en décembre, les 30 jours de rétractation sont passés (la garantie légale
de conformité de 2 ans s'applique toujours, mais c'est plus lourd). Si vous
étalez sur plus d'un mois, testez chaque pièce à réception quand c'est
possible.

---

## 6. Combien de temps attendre ?

Question honnête : à un moment, il faut acheter.

- **Vous avez besoin du PC maintenant** → prenez ce qui est marqué ACHETER ou
  CORRECT, ignorez les ATTENDRE. Un écart de 30-50 € ne justifie pas deux
  mois sans machine.
- **Vous pouvez attendre 1-2 mois** → laissez tourner le script, achetez au
  fil des signaux ACHETER, et visez le Black Friday pour le GPU.
- **Vous attendez depuis plus de 3 mois** → posez-vous la question du coût
  d'opportunité. Le matériel se déprécie, et la config que vous visez
  aujourd'hui sera dépassée par une meilleure offre équivalente. À un moment,
  le meilleur prix est celui qui vous permet d'utiliser la machine.

**Repère chiffré** : si votre total est à moins de 5% du total « tout au
plus bas connu » affiché dans le rapport, vous êtes dans une bonne fenêtre.
Chercher les derniers 3% coûte généralement plus de temps que ça ne rapporte.
