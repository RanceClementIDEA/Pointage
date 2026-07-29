# Le site web — HTML/JS pur, sur GitHub Pages

Le suivi de prix a désormais une **interface web publique**, écrite en
HTML/CSS/JavaScript sans framework, déployée automatiquement sur GitHub
Pages, avec Firebase en option pour la mise à jour en direct.

**Le mail « grosse offre » ne change pas.** Il reste envoyé par l'action de
collecte, et c'est lui qui vous prévient. Le site *affiche* l'offre ; une
page qu'il faut penser à ouvrir n'a jamais prévenu personne.

---

## Ce qui tourne où, et pourquoi

Trois contraintes commandent l'architecture, aucune n'est contournable :

| Contrainte | Conséquence |
|---|---|
| Un navigateur **ne peut pas** lire les pages des marchands (CORS) | La collecte reste en Python, dans GitHub Actions |
| Un site statique **ne peut pas** envoyer de mail | L'alerte reste émise par l'action |
| Firebase avec lecture publique **rend l'historique public** | Voir l'avertissement ci-dessous |

```
   GitHub Actions (Python)                    GitHub Pages (HTML/JS)
   ───────────────────────                    ──────────────────────
   collecte les prix          ──> prices.db
   envoie le MAIL si grosse offre
   exporte web/data.json      ─────────────>  le site le lit
   pousse vers Firestore  (option) ────────>  mise a jour en direct
```

---

## Deux modes, le second est facultatif

### Mode fichier — par défaut, rien à configurer

Le site lit `data.json`, republié à chaque collecte. **Aucun service tiers,
aucun compte, aucun quota.** C'est le mode livré, et il suffit.

### Mode direct — avec Firebase

La page se met à jour **d'elle-même** dès qu'une collecte se termine, sans
rechargement (`onSnapshot`). C'est le seul apport de Firebase.

> **Firebase est une amélioration, pas une dépendance.** Si le SDK ne se
> charge pas, si les règles sont trop strictes, si le quota est épuisé ou si
> le document n'existe pas encore, le site retombe sur `data.json` au lieu
> d'afficher une page vide. Trois chemins d'échec, trois replis — un test le
> vérifie.

---

## ⚠️ Avant d'activer quoi que ce soit

**GitHub Pages est public, même depuis un dépôt privé.** Tout ce que contient
`data.json` devient consultable par qui connaît l'URL : composants suivis,
prix, marchands, budget, nom du projet.

Un test vérifie qu'aucun élément sensible (SMTP, mot de passe, canal ntfy,
jeton, adresse email) ne part dans l'export. Mais **les données de suivi,
elles, partent bien** — c'est l'objet du site.

Lisez `PUBLICATION.md` : les mêmes réserves s'appliquent.

---

## Mise en place

### 1. Activer GitHub Pages

`Settings` → `Pages` → **Source : GitHub Actions**.

Puis onglet `Actions` → **`Publier le site`** → `Run workflow`.

Le site s'y republie ensuite tout seul après chaque collecte réussie
(`workflow_run`). Si la collecte échoue, rien n'est publié — il n'y aurait
rien de nouveau à montrer.

### 2. Firebase — facultatif

1. https://console.firebase.google.com → créer un projet
2. **Firestore Database** → créer une base, **en mode production**
3. **Règles** → coller le contenu de `firestore.rules` → *Publier*
4. `Paramètres du projet` → `Vos applications` → **Web** → copier la config
5. La coller dans `web/config.js`, à la place de `firebase: null`
6. `Paramètres du projet` → `Comptes de service` → **Générer une clé privée**
7. Dans GitHub : `Settings` → `Secrets and variables` → `Actions` →
   nouveau secret **`FIREBASE_SERVICE_ACCOUNT`** → coller le JSON entier

> **Les valeurs de `config.js` sont publiques par conception** — ce ne sont
> pas des secrets. Ce qui protège la base, ce sont les **règles**.
>
> **Le compte de service, lui, est un vrai secret.** Il ne doit jamais
> entrer dans le dépôt : un test parcourt tous les `.json` pour s'en
> assurer.

### 3. Les règles, avant tout le reste

Une base créée « en mode test » est **ouverte en écriture à tout internet
pendant 30 jours**. N'importe qui pourrait alors remplacer vos prix — et
donc déclencher chez vous une fausse alerte « grosse offre ».

`firestore.rules` dit exactement une chose : le navigateur **lit**, il
n'écrit jamais. Seule l'action écrit, avec le compte de service.

---

## Ce que le site sait faire

| | |
|---|---|
| **Grosse offre** | bloc rouge en tête, impossible à manquer |
| **Total, budget, stratégie** | le même calcul que le rapport, aux mêmes chiffres |
| **Carte par composant** | prix, vendeur, conseil, tendance, courbe, plancher/plafond |
| **Fenêtre** | 7 j · 30 j · 90 j · 1 an · tout — les profondeurs indisponibles sont désactivées |
| **Filtre** | n'afficher que les offres |
| **Séquence d'achat** | à prendre maintenant / à différer, avec les motifs |
| **Fraîcheur** | date du dernier relevé, et « non vérifié depuis N j » par composant |

Sur une fenêtre courte, la série au jour le jour est utilisée ; sur
l'historique complet, la courbe est allégée — mais **plancher et plafond
restent calculés sur la donnée complète** (même principe qu'en 9.3).

---

## Une seule source de chiffres

`exporter_web.py` réutilise `serveur.construire_etat()` — la fonction qui
alimente déjà l'interface locale. Le site, l'interface locale et le rapport
affichent donc les **mêmes montants**, sans seconde implémentation à tenir
en phase. Un test le vérifie.

---

## Développer en local

```bash
python exporter_web.py          # produit web/data.json
cd web && python -m http.server 8000
```

Puis http://localhost:8000. Aucun serveur n'est nécessaire en production :
GitHub Pages sert des fichiers statiques.

---

## Si quelque chose échoue

**La page dit « Donnees indisponibles »** — `data.json` est absent : le
workflow `Publier le site` n'a pas encore tourné, ou la collecte a échoué.

**Le site affiche des prix anciens** — normal si la dernière collecte a
échoué. La date du dernier relevé est affichée en haut, et chaque composant
non revérifié porte un badge.

**La pastille reste orange alors que Firebase est configuré** — le site est
en mode fichier : SDK bloqué, règles trop strictes, ou document pas encore
écrit. Vérifiez l'étape *Synchroniser Firestore* dans le journal de l'action.

**`Firestore a refuse (403)`** — le compte de service n'a pas les droits, ou
`FIREBASE_PROJECT_ID` désigne un autre projet.
