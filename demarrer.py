# Démarrage rapide

## Lancer l'outil

| Votre système | Ce que vous faites |
|---|---|
| **Windows** | Double-cliquez sur **`lancer.bat`** |
| **Mac** | Double-cliquez sur **`lancer.command`** |
| **Linux** | Dans un terminal : `chmod +x lancer.sh` puis `./lancer.sh` |

Un menu s'ouvre. Aucune commande à retenir.

> **Mac, premier lancement** : si macOS refuse d'ouvrir le fichier, faites
> clic droit → « Ouvrir » → « Ouvrir » à nouveau. C'est la sécurité Gatekeeper,
> une seule fois suffit.

> **Windows** : si Python n'est pas installé, le lanceur vous le dira et vous
> donnera le lien. Pensez à cocher **« Add Python to PATH »** pendant
> l'installation, sinon le lanceur ne trouvera pas Python.

Les bibliothèques Python manquantes sont installées automatiquement au
premier lancement (le script vous demande confirmation).

---

## Les 4 premières minutes

Dans le menu, faites simplement, dans cet ordre :

**1 — Option 9 : Démonstration**
Vous voyez à quoi ressemble un rapport, sans rien configurer et sans
connexion. 30 secondes.

**2 — Option 5 : Configurer l'email**
Le menu vous guide pas à pas, détecte automatiquement votre serveur SMTP
(Gmail, Outlook, Orange, Free, SFR, Laposte...) et propose un email de test
pour vérifier que tout marche.

Pour Gmail, il vous faudra un **mot de passe d'application** :
https://myaccount.google.com/apppasswords

**3 — Option 1 : Vérifier les prix maintenant**
Premier vrai relevé. Les prix se comparent à l'historique déjà pré-rempli
dans `config.json`, donc le rapport est utile immédiatement.

**4 — Option 6 : Automatiser l'envoi quotidien**
Vous choisissez une heure, le script crée tout seul la tâche planifiée
(Planificateur Windows ou cron selon votre système). C'est fini : le rapport
arrivera chaque matin.

---

## Le réflexe quotidien

Quand vous croisez un bon prix quelque part (Dealabs, une promo en magasin,
un forum) :

**Option 3 → choisissez le composant → saisissez le prix**

Chaque prix ajouté améliore la pertinence des conseils. C'est ce qui fait la
différence entre un outil qui devine et un outil qui sait.

---

## À faire quand vous aurez 10 minutes

**Option 7 : Modifier les composants suivis**

Quatre URLs sont encore des exemples à remplacer (Amazon et Rakuten). Ouvrez
`config.json` et collez les vraies adresses des fiches produit. Le menu
affiche en permanence combien il en reste à faire.

Profitez-en pour remplir les `seed_history` avec les historiques trouvés sur
**idealo.fr** (courbe de prix sur 12 mois) — c'est le meilleur investissement
de temps pour la qualité des conseils.

---

## En cas de problème

**Option 8 : Vérifier l'installation** — affiche l'état de chaque élément
(bibliothèques, email, URLs, historique, tâche planifiée) et ce qu'il reste
à faire.

Pour tout le reste : `README.md` (fonctionnement détaillé) et
`GUIDE_ACHAT.md` (stratégie d'achat : quand acheter, où, neuf ou occasion).
