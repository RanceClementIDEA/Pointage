# Publier le tableau de bord — **facultatif**

> **Cette étape est facultative, et désactivée par défaut.**
> Le canal recommandé reste **l'email quotidien**, avec le dashboard en pièce
> jointe. Il ne nécessite aucune configuration, n'expose rien, et fonctionne
> déjà.

---

## ⚠️ Ce que publier veut dire

Publier le dashboard le rend **accessible à toute personne connaissant
l'URL** — sans mot de passe, sans authentification. Il n'y a pas de « demi-
publication ».

Concrètement, deviennent publics :

| Donnée | Exemple |
|---|---|
| Les composants suivis | *AMD Ryzen 7 5700X*, *RX 9060 XT 16 Go* |
| Tout l'historique des prix | **l'intégralité** de votre suivi, date par date |
| Les marchands consultés | *ldlc*, *cdiscount*, *idealo* |
| Le nom de vos projets | *Tour polyvalente 1000 EUR* |
| Vos objectifs de budget | *sous l'objectif de 1000 EUR* |

> Depuis le prompt 9.3, le dashboard n'embarque plus une fenêtre de 730 jours
> mais **tout l'historique disponible** — c'est ce qui le rend explorable, et
> c'est donc davantage de données qui deviennent publiques. Plus vous suivez
> longtemps, plus vous publiez.

Ce n'est pas anodin : ces informations disent ce que vous achetez, à quel
budget, et à quel rythme vous surveillez. **Ne publiez que si cela ne vous
dérange pas.**

Un mode d'atténuation existe (`anonymiser: true`) : il retire le nom des
projets et les montants de budget. Les prix et composants restent — sans eux
le dashboard n'aurait plus d'objet. **C'est un atténuateur, pas un anonymat.**

---

## L'écueil de la v2.6, et pourquoi il y a un second dépôt

La v2.6 avait envisagé GitHub Pages, puis écarté l'idée : **Pages n'est pas
disponible gratuitement sur un dépôt privé**.

La tentation évidente serait alors de rendre public le dépôt du suivi. **Ne
faites jamais cela** : il contient `config.json` (vos URLs, votre budget, vos
réglages email), `prices.db` (tout l'historique), et potentiellement des
traces de configuration.

La publication vise donc un **second dépôt, public, dédié à ce seul usage**.
Il ne contiendra jamais qu'un fichier : `index.html`.

---

## Trois garde-fous — actifs, pas seulement documentés

Le script `publier_dashboard.py` **refuse de s'exécuter** dans ces cas :

1. **Publication non activée** — `publication_dashboard` vaut `false`. C'est le
   défaut, et il faut un geste délibéré pour le changer.
2. **La cible est le dépôt courant** — le script compare l'URL cible à
   `origin` et s'arrête net. C'est la protection contre l'écueil ci-dessus.
3. **Un élément sensible est détecté dans le fichier** — adresse email,
   paramètre SMTP, jeton, canal de notification. La publication s'interrompt
   et affiche ce qui a été trouvé.

Le dossier publié est par ailleurs **reconstruit à vide** à chaque fois, et
**un seul fichier** y est copié : il n'y a rien à « oublier d'exclure ».
Un `robots.txt` interdisant l'indexation y est ajouté — une précaution, pas
une protection.

---

## Option A — Second dépôt GitHub public

**1.** Créez un dépôt public vide, par exemple `mon-suivi-prix-public`.
Ne l'utilisez pour rien d'autre.

**2.** Déclarez-le dans `config.json` :

```jsonc
"publication_dashboard": true,          // le geste explicite
"publication": {
  "depot": "git@github.com:VOUS/mon-suivi-prix-public.git",
  "branche": "main",
  "anonymiser": false
}
```

**3.** Vérifiez d'abord, sans rien publier :

```bash
python publier_dashboard.py --verifier
```

**4.** Publiez :

```bash
python dashboard.py            # régénérer avec les données du jour
python publier_dashboard.py
```

**5.** Sur ce dépôt public : *Settings → Pages → Source : branche `main`*.
L'URL sera `https://VOUS.github.io/mon-suivi-prix-public/`.

---

## Option B — Cloudflare Pages (sans second dépôt GitHub)

Pour qui préfère ne pas créer un deuxième dépôt public. L'offre gratuite de
Cloudflare Pages suffit largement.

```bash
python dashboard.py
python publier_dashboard.py --dossier ./public
```

Le dossier `./public` contient alors exactement deux fichiers : `index.html`
et `robots.txt`. **Rien n'est poussé** — le déploiement reste votre geste :

- **Interface Cloudflare** : *Workers & Pages → Create → Pages → Upload
  assets*, puis glissez le dossier.
- **Ou en ligne de commande** :
  ```bash
  npx wrangler pages deploy ./public --project-name mon-suivi-prix
  ```

Netlify Drop (`app.netlify.com/drop`) fonctionne de la même façon.

---

## Automatiser (facultatif, et déconseillé au début)

Un workflow `.github/workflows/publier-dashboard.yml` est fourni,
**désactivé** : il ne se déclenche que manuellement (`workflow_dispatch`) et
vérifie lui aussi que la publication est activée. Il exige un secret
`DASHBOARD_DEPLOY_KEY` (clé de déploiement en écriture sur le **dépôt
public**, jamais sur le privé).

Commencez par publier à la main quelques fois. Automatiser une publication
qu'on ne relit plus est le meilleur moyen d'y laisser passer quelque chose.

---

## Revenir en arrière

```jsonc
"publication_dashboard": false
```

Et supprimez le dépôt public (ou le projet Cloudflare). Attention : ce qui a
été publié a pu être copié ou indexé entre-temps — **une publication ne se
reprend pas vraiment**.

---

## En résumé

| | Email (défaut) | Publication (facultative) |
|---|---|---|
| Configuration | aucune | dépôt public + réglage explicite |
| Qui voit les données | vous seul | toute personne ayant l'URL |
| Réversible | — | imparfaitement |
| Recommandé | **oui** | seulement si l'exposition ne vous gêne pas |
