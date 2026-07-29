# Lancer le suivi sur GitHub Actions

Le script tourne sur les serveurs de GitHub, gratuitement. **Rien n'est
installé sur votre ordinateur**, rien ne tourne sur votre poste de travail,
aucune tâche planifiée locale — donc aucun des signaux qui font réagir un
antivirus d'entreprise.

---

## À lire avant de commencer

Une limite importante et honnête : **les sites marchands bloquent souvent les
adresses IP des datacenters**, et les serveurs GitHub en font partie.
Concrètement, Amazon et Cdiscount ont de fortes chances de renvoyer une page
d'erreur ou un captcha au lieu du prix. LDLC et les revendeurs spécialisés
passent généralement mieux.

Le script gère ça proprement (il signale « prix introuvable » et continue),
mais attendez-vous à ce que certaines sources ne remontent rien. Deux
parades :

1. **Privilégiez les sources qui répondent** — après quelques jours vous
   verrez lesquelles fonctionnent, gardez celles-là.
2. **Enrichissez à la main** avec les prix que vous voyez ailleurs (voir la
   section « saisie manuelle » plus bas). C'est ce qui rend l'historique
   solide de toute façon.

Si aucune source ne répond, cette approche ne vous conviendra pas : dans ce
cas, les alertes idealo.fr et Dealabs restent la meilleure solution.

---

## Installation en 6 étapes (~15 minutes)

### 1. Créer un compte GitHub

https://github.com/signup — gratuit.

### 2. Créer un dépôt **privé**

Sur https://github.com/new :
- **Repository name** : `suivi-prix-pc` (ou ce que vous voulez)
- Cochez **Private** — important : même si les mots de passe sont dans les
  secrets et jamais dans le code, un dépôt privé évite d'exposer publiquement
  votre liste d'achats et votre budget.
- Cochez **Add a README file**
- **Create repository**

### 3. Envoyer les fichiers

Le plus simple, sans installer Git :

1. Sur la page de votre dépôt : **Add file** → **Upload files**
2. Glissez-déposez **tous les fichiers** du dossier `price_tracker`
3. ⚠️ **Vérifiez que le dossier `.github` est bien inclus.** Certains
   navigateurs ignorent les dossiers commençant par un point lors d'un
   glisser-déposer. S'il manque, créez-le manuellement (voir encadré
   ci-dessous).
4. ⚠️ **N'envoyez surtout pas votre fichier `.env`** s'il existe (il contient
   votre mot de passe). Le `.gitignore` fourni le protège si vous utilisez
   Git, mais pas lors d'un glisser-déposer manuel.
5. **Commit changes**

> **Si le dossier `.github` n'a pas été transféré :**
> Add file → Create new file → tapez exactement
> `.github/workflows/price-tracker.yml` dans le champ du nom (GitHub crée les
> dossiers automatiquement quand vous tapez les `/`), puis collez le contenu
> du fichier `price-tracker.yml` → Commit.

### 4. Créer les secrets

Dans votre dépôt : **Settings** → **Secrets and variables** → **Actions** →
bouton **New repository secret**.

Créez-en trois (un par un) :

| Name | Secret |
|---|---|
| `EMAIL_SENDER` | votre adresse, ex. `vous@gmail.com` |
| `EMAIL_RECIPIENT` | l'adresse qui recevra le rapport (souvent la même) |
| `EMAIL_APP_PASSWORD` | votre mot de passe d'application (16 caractères) |

Deux secrets facultatifs si vous n'êtes pas chez Gmail :

| Name | Secret |
|---|---|
| `SMTP_SERVER` | ex. `smtp-mail.outlook.com`, `smtp.orange.fr`, `smtp.free.fr` |
| `SMTP_PORT` | ex. `587` |

**Pour obtenir le mot de passe d'application Gmail** :
https://myaccount.google.com/apppasswords (la validation en 2 étapes doit
être activée sur le compte). Ce n'est **pas** votre mot de passe Gmail
habituel.

Les secrets sont chiffrés par GitHub, invisibles dans les logs, et
inaccessibles à quiconque n'a pas accès à votre dépôt.

### 5. Tester tout de suite

Onglet **Actions** → **Suivi prix PC** (menu de gauche) → bouton **Run
workflow** → **Run workflow**.

> Si vous voyez un message « Workflows aren't being run on this forked
> repository » ou un bouton **I understand my workflows, go ahead and enable
> them**, cliquez dessus pour activer Actions.

Le job démarre en quelques secondes. Cliquez dessus pour suivre l'exécution
en direct. Comptez 1 à 2 minutes.

**Vérifiez ensuite votre boîte mail** (et les spams au premier envoi).

### 6. C'est tout

Le rapport partira désormais chaque jour automatiquement à 6h UTC (8h à
Paris en été, 7h en hiver).

---

## Régler l'heure d'envoi

Dans `.github/workflows/price-tracker.yml`, modifiez la ligne :

```yaml
- cron: '0 6 * * *'
```

Le format est `minute heure * * *`, **en UTC**. Pour la France :

| Heure souhaitée (Paris) | Valeur cron été | Valeur cron hiver |
|---|---|---|
| 7h | `'0 5 * * *'` | `'0 6 * * *'` |
| 8h | `'0 6 * * *'` | `'0 7 * * *'` |
| 12h | `'0 10 * * *'` | `'0 11 * * *'` |
| 19h | `'0 17 * * *'` | `'0 18 * * *'` |

Le changement d'heure n'est pas géré automatiquement : votre rapport
arrivera avec une heure de décalage deux fois par an. Sans conséquence.

**À savoir** : les jobs planifiés GitHub ne sont pas ponctuels à la minute.
Un retard de 10 à 60 minutes est courant aux heures de forte charge. Sans
importance pour un rapport quotidien.

---

## Ajouter un prix vu ailleurs

C'est ce qui rend les conseils pertinents, et ça marche même sans rien
installer :

1. Ouvrez `config.json` directement sur GitHub (cliquez dessus → icône
   crayon ✏️)
2. Trouvez le composant, ajoutez une ligne dans son `seed_history` :

```json
"seed_history": [
  { "date": "2026-07-25", "site": "dealabs", "price": 389.90 }
]
```

3. **Commit changes**
4. Actions → Run workflow → ajoutez `--reset-seed`… **ou plus simple** :
   attendez le lendemain, l'import se fait automatiquement au prochain
   passage si vous avez ajouté un nouveau composant. Pour forcer la reprise
   des seeds sur un composant existant, supprimez la ligne
   `"seed_imported": true` correspondante dans `history.json`.

Alternative plus propre si vous êtes à l'aise avec Git en local : utilisez le
menu (`option 3`), puis poussez `history.json` mis à jour.

---

## Suivre ce qui se passe

- **Onglet Actions** : historique de toutes les exécutions. Une croix rouge
  signale un problème, cliquez pour voir les logs détaillés.
- **Fichier `prices.db`** dans le dépôt : mis à jour automatiquement à chaque
  exécution, avec un commit « Releve de prix du JJ/MM/AAAA ». Vous avez donc
  aussi l'historique des modifications via l'onglet des commits.
  *(C'est `prices.db` — et non plus `history.json` — qui porte l'historique
  depuis la bascule SQLite.)*

> **Si l'étape de sauvegarde échoue** avec
> `fatal: pathspec 'history.json' did not match any files`, votre workflow
> date d'avant le correctif : il ajoutait les deux fichiers sur une même
> ligne, et git refuse alors la commande **entière** — donc `prices.db`
> n'était pas enregistré non plus, silencieusement. Reprenez la version
> fournie dans `.github/workflows/price-tracker.yml`, qui teste l'existence
> de chaque fichier séparément.

---

## Ce que ça coûte

Gratuit dans votre cas. Pour information :
- Dépôt **public** : minutes Actions illimitées.
- Dépôt **privé** (recommandé ici) : 2000 minutes/mois offertes sur le plan
  Free. Ce job consomme environ 1 à 2 minutes par jour, soit **30 à 60
  minutes par mois**. Vous êtes très loin de la limite.

---

## Problèmes fréquents

| Symptôme | Cause probable et solution |
|---|---|
| Aucun email reçu | Vérifiez les spams. Puis dans Actions, ouvrez la dernière exécution et lisez les logs de l'étape « Verifier les prix ». |
| `EMAIL_APP_PASSWORD non definie` | Le secret n'existe pas ou son nom est mal orthographié (respectez les majuscules exactement). |
| Erreur d'authentification SMTP | Mot de passe d'application incorrect, ou validation en 2 étapes non activée sur le compte Google. |
| « prix introuvable » sur plusieurs sites | Blocage des IP datacenter (voir l'avertissement en haut). Normal sur Amazon/Cdiscount. |
| L'étape « Sauvegarder l'historique » échoue | Vérifiez que `permissions: contents: write` est bien présent dans le workflow. |
| **Le job ne se lance plus après ~2 mois** | GitHub désactive les workflows planifiés après **60 jours sans activité** sur le dépôt. Vous recevez un email d'avertissement avant. Il suffit de faire un commit quelconque, ou de cliquer « Run workflow » manuellement, pour réarmer le compteur. |

---

## Rappel sur le cadre

Ce montage exécute du scraping depuis l'infrastructure de GitHub. C'est
techniquement contraire aux CGU des sites marchands, comme depuis chez vous.
À raison d'une exécution quotidienne pour un usage personnel, l'impact est
négligeable — mais n'augmentez pas la fréquence (toutes les heures, par
exemple) : ce serait à la fois inutile pour votre besoin et bien plus
susceptible de poser problème.
