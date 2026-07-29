# Groupes d'équivalence — le meilleur achat, pas juste le prix

*Roadmap 1.1 et 1.4 — vague 2*

Avant, l'outil répondait à « combien coûte la RX 9060 XT ? ».
Maintenant il répond à « **quel est le meilleur GPU pour mon argent
aujourd'hui ?** » — la vraie question.

---

## Le principe

Un **slot** regroupe des produits interchangeables pour un même poste.
Chaque candidat a un **indice de performance** relatif (100 = référence).
Le système calcule le **coût par point de performance** et désigne le
meilleur achat du moment.

Quand deux prix se croisent, **la recommandation bascule toute seule** et le
rapport vous le signale.

---

## Ce que ça donne concrètement

```
--- MEILLEUR ACHAT PAR POSTE ---
  Carte graphique : NVIDIA RTX 5060 Ti 16 Go
    399.00 EUR chez ldlc | perf 103 | 3.87 EUR/pt
    /!\ CHANGEMENT : passe devant AMD RX 9060 XT 16 Go (+9.7% cout/perf)
      - AMD RX 9060 XT 16 Go       : 429.00 EUR | 4.29 EUR/pt
      - AMD RX 9060 (non-XT) 8 Go  : 369.00 EUR | 4.39 EUR/pt
      - NVIDIA RTX 5060 Ti 8 Go    : 489.95 EUR | 5.10 EUR/pt
```

Regardez la troisième ligne : la **RX 9060 non-XT est la moins chère en
absolu (369 €)** mais arrive **avant-dernière au coût/perf (4,39)**. Payer
30 € de plus pour la 5060 Ti 16 Go rapporte 19 points de performance
supplémentaires.

C'est exactement le raisonnement qu'on faisait à la main pendant nos
recherches (i5 vs i7, XT vs non-XT) — désormais recalculé chaque jour
automatiquement.

---

## Le total ne compte qu'un candidat par slot

Point important pour la cohérence : avec 4 cartes graphiques suivies, le
total ne les additionne évidemment pas. **Seul le gagnant de chaque slot
entre dans le total** de la configuration.

Dans l'exemple ci-dessus, le total est passé de 883,98 € à 853,98 € parce
que le slot GPU a basculé vers une option au meilleur rapport.

---

## Les candidats configurés

### Slot CPU (socket AM4, carte mère compatible)

| Candidat | Perf | Pourquoi |
|---|---|---|
| **Ryzen 7 5700X** | 100 | Référence : 8c/16t, bon équilibre dev + jeu |
| Ryzen 7 5700X3D | 104 | 3D V-Cache, nettement meilleur en jeu, équivalent en applicatif |
| Ryzen 5 5600 | 80 | 6c/12t : proche en jeu, en retrait sur compilation/Docker/montage |

### Slot GPU

| Candidat | Perf | Pourquoi |
|---|---|---|
| **RX 9060 XT 16 Go** | 100 | Référence : 16 Go de VRAM, bon en 1080p/1440p |
| RTX 5060 Ti 16 Go | 103 | Meilleur ray tracing, encodeur NVENC AV1 (utile pour le montage) |
| RTX 5060 Ti 8 Go | 96 | Suffisant en 1080p compétitif, limitant sur certains AAA en 1440p |
| RX 9060 (non-XT) 8 Go | 84 | ~15-17% sous la XT (mesures TechSpot). Option budget |

**Ces indices sont des estimations**, calibrées sur les tests et
comparatifs consultés pendant nos recherches, et pondérées pour votre profil
« équilibré dev/gaming/multimédia ». Ajustez-les dans `config.json` selon
vos priorités réelles :

- **Vous jouez beaucoup plus que vous ne compilez ?** Montez le 5700X3D à
  110 et descendez le 5700X à 95.
- **Vous faites surtout du montage vidéo ?** Montez les cartes NVIDIA (NVENC
  AV1 fait une vraie différence à l'export).
- **Vous visez uniquement le 1080p ?** Les modèles 8 Go méritent un meilleur
  indice, la VRAM comptant moins.

---

## Ajouter un candidat

Dans `config.json`, un candidat est un composant normal avec deux champs en
plus :

```json
{
  "id": "gpu_rx9070",
  "name": "AMD RX 9070",
  "category": "GPU",
  "slot": "GPU",          ← rattache au groupe d'équivalence
  "perf_index": 125,       ← indice relatif (100 = référence du slot)
  "sources": [...],
  "reference": { "prix_reve": 480, ... }
}
```

Puis déclarez le slot s'il n'existe pas :

```json
"slots": {
  "GPU": { "label": "Carte graphique", "reference_id": "gpu_rx9060xt" }
}
```

Vous pouvez créer autant de slots que vous voulez : RAM (16 vs 32 Go), SSD
(512 Go vs 1 To), alimentation (650W vs 750W)... C'est la roadmap 1.4,
disponible avec le même mécanisme.

---

## Garde-fous intégrés

**Les prix périmés sont écartés du classement.** Un candidat dont le prix
n'a pas été revérifié depuis plus de 7 jours ne peut pas être désigné
gagnant — recommander un achat sur la base d'un prix vieux de deux mois
n'aurait aucun sens. Il reste affiché dans le tableau, marqué « non
vérifié ».

**L'alerte OCCASION ULTIME reste prioritaire.** Si un candidat non-gagnant
passe en occasion ultime, il est signalé quand même : un prix exceptionnel
sur une option légèrement moins performante peut tout à fait valoir le coup.

---

## Ce qui n'est pas (encore) géré

**La compatibilité croisée** (roadmap 1.2) n'est pas implémentée. Le système
ne vérifie pas encore que :
- le candidat CPU choisi correspond au socket de votre carte mère,
- l'alimentation suffit pour le GPU le plus gourmand du slot,
- le GPU tient physiquement dans le boîtier.

Concrètement, aujourd'hui : **tous les candidats CPU configurés sont en
AM4**, donc compatibles avec la Gigabyte B550 — c'est volontaire. Si vous
ajoutez un candidat Intel, vérifiez vous-même la carte mère. C'est la
prochaine étape logique de la roadmap.
