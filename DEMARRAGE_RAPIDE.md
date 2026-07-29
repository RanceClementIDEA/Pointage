# Mettre le projet sur GitHub et lancer l'action

Ce dépôt est **déjà initialisé en git**, avec un premier commit contenant
l'intégralité du projet. Vous n'avez rien à téléverser fichier par fichier —
c'est précisément ce qui avait corrompu `price_tracker.py` la fois
précédente.

---

## Le plus simple : `deployer.html`

Ouvrez **`deployer.html`** par double-clic. C'est une page HTML/JS autonome
qui envoie tout le projet en **un seul commit**, via l'API GitHub. Rien à
installer, pas de ligne de commande.

Elle règle les trois problèmes rencontrés avec le téléversement manuel :

| Problème | Ce que fait le déployeur |
|---|---|
| `.github/` disparaît (le glisser-déposer ignore les dossiers en point) | envoyé comme les autres, et l'aperçu le montre |
| Un fichier écrasé par un autre contenu | envoi atomique : soit tout arrive, soit rien |
| Fichiers oubliés | l'arbre est complet — le dépôt devient l'exact reflet du dossier |

**Ce qu'elle refuse d'envoyer.** Un secret poussé une fois reste dans
l'historique du dépôt. La présence de `.env`, d'un compte de service
Firebase, d'une clé `.pem` ou SSH **interrompt l'envoi** — sans case à cocher
pour passer outre.

En trois étapes :

1. **Un jeton fine-grained** sur
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new),
   avec `Contents`, **`Workflows`**, `Administration` et `Pages` en écriture.
   *Sans `Workflows`, GitHub refuse tout envoi contenant `.github/workflows/`
   — c'est l'erreur la plus fréquente.*
2. Compte, nom du dépôt, puis le dossier `PC-main` décompressé.
3. **Déployer.**

Le jeton ne quitte pas la page : il n'est ni enregistré, ni envoyé ailleurs
qu'à `api.github.com`. Révoquez-le après usage.

> **Une étape reste manuelle**, l'API ne la couvre pas :
> `Settings` → `Actions` → `General` → **Read and write permissions**.
> Sans elle, l'action ne peut pas réenregistrer `prices.db` et l'historique
> repart de zéro chaque jour. Le déployeur vous le rappelle à la fin.

Pour vérifier son comportement sans rien envoyer :

```bash
python verifier_deployeur.py     # API GitHub simulee
```

---

## Sinon, à la main

## 1. Créer le dépôt sur GitHub — **vide**

Sur https://github.com/new :

| Champ | Valeur |
|---|---|
| Repository name | `PC` (ou ce que vous voulez) |
| Visibilité | **Private** — voir l'avertissement ci-dessous |
| Add a README file | ❌ **décoché** |
| Add .gitignore | ❌ **décoché** (`None`) |
| Choose a licence | ❌ **décoché** (`None`) |

> ⚠️ **Le dépôt doit être créé complètement vide.** Si GitHub y ajoute un
> README, votre premier `git push` sera refusé avec
> `Updates were rejected because the remote contains work that you do not
> have locally`.

> 🔒 **Choisissez « Private ».** Ce dépôt contient `config.json` (vos budgets,
> vos objectifs de prix) et `prices.db` (tout votre historique). La
> publication du tableau de bord, elle, est prévue pour un **second** dépôt
> public dédié — voir `PUBLICATION.md`.

---

## 2. Envoyer le projet

Décompressez l'archive, ouvrez un terminal **dans le dossier `PC-main`**, puis :

```bash
git remote add origin https://github.com/VOTRE_COMPTE/PC.git
git branch -M main
git push -u origin main
```

C'est tout. Les 110 fichiers partent en une fois, sans risque de mélange.

> Si `git remote add` répond `remote origin already exists`, utilisez
> `git remote set-url origin https://github.com/VOTRE_COMPTE/PC.git`.

---

## 3. Autoriser l'action à écrire

**Étape indispensable**, sans quoi l'historique repartira de zéro chaque jour.

`Settings` → `Actions` → `General` → section **Workflow permissions** :

- cocher **Read and write permissions**
- `Save`

Pourquoi : à chaque exécution, GitHub repart d'une machine neuve. L'action
doit pouvoir recommitter `prices.db` dans le dépôt, sinon tous les relevés
du jour sont perdus et les conseils ne progressent jamais.

---

## 4. Configurer l'email — facultatif

Sans cela, **l'action fonctionne quand même** : elle affiche le rapport dans
le journal d'exécution au lieu de l'envoyer. Vous pouvez donc tout tester
avant de vous en occuper.

Pour recevoir le rapport par mail, `Settings` → `Secrets and variables` →
`Actions` → `New repository secret`, cinq fois :

| Nom du secret | Exemple |
|---|---|
| `EMAIL_SENDER` | `vous@gmail.com` |
| `EMAIL_RECIPIENT` | `vous@gmail.com` |
| `EMAIL_APP_PASSWORD` | mot de passe **d'application** Gmail (16 caractères) |
| `SMTP_SERVER` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |

> Ce n'est **pas** votre mot de passe Gmail habituel : il faut créer un
> « mot de passe d'application » depuis les réglages de sécurité Google.

---

## 5. Lancer l'action

Onglet **`Actions`** de votre dépôt.

1. GitHub affiche d'abord un bandeau *« Workflows aren't being run on this
   forked repository »* ou un bouton **`I understand my workflows, go ahead
   and enable them`** → cliquez dessus si présent.
2. Dans la colonne de gauche, choisissez **`Suivi prix PC`**.
3. Bouton **`Run workflow`** (à droite) → laissez la branche `main` →
   **`Run workflow`**.
4. Rafraîchissez : l'exécution apparaît au bout de quelques secondes.

Ensuite, elle part **toute seule chaque jour à 6 h UTC** (8 h à Paris en été,
7 h en hiver). Pour changer l'heure, modifiez la ligne `cron` en tête de
`.github/workflows/price-tracker.yml`.

> Deux limites propres à GitHub, bonnes à connaître :
> les workflows planifiés ne s'exécutent que sur la **branche par défaut**,
> et GitHub **suspend la planification** après 60 jours sans activité sur le
> dépôt (un lancement manuel la réactive).

---

## 6. Ce que vous devez voir

Le journal d'exécution enchaîne ces étapes :

```
Recuperer le depot
Installer Python
Installer les dependances
Controler l'integrite des fichiers      <- doit afficher "AUCUN FICHIER ABIME"
Verifier les prix et envoyer le rapport <- le rapport complet
Sauvegarder l'historique mis a jour     <- commit "Releve de prix du .."
```

La collecte interroge 8 vendeurs par composant, avec 2,5 s de délai par
domaine : **comptez quelques minutes**, c'est normal et voulu. Le plafond dur
est de 7 minutes (`budget_secondes` dans `config.json`).

---

## Si quelque chose échoue

**`SyntaxError` dans un fichier `.py`** — un fichier est abîmé. L'étape
*Controler l'integrite des fichiers* les liste tous d'un coup. En local :

```bash
python verifier_integrite.py
```

**`Permission denied` / `403` à l'étape de sauvegarde** — l'étape 3 n'a pas
été faite (Workflow permissions en lecture seule).

**`Updates were rejected` au premier push** — le dépôt n'a pas été créé vide
(étape 1). Le plus simple est de le supprimer et de le recréer sans README.

**L'action n'apparaît pas dans l'onglet Actions** — les workflows sont
désactivés sur le dépôt : un bandeau propose de les activer.

**Aucun email reçu** — normal tant que les 5 secrets de l'étape 4 ne sont pas
créés. Le rapport reste consultable dans le journal d'exécution.

---

## Utilisation en local

Aucune de ces étapes n'est nécessaire pour s'en servir sur votre machine :

```bash
pip install -r requirements.txt
python demarrer.py            # menu, ou double-clic sur lancer.bat
```

Pour tester sans attendre ni rien enregistrer :

```bash
python price_tracker.py --report-only --no-email   # rapport instantané
python price_tracker.py --dry-run --no-email       # prix simulés, base intacte
```
