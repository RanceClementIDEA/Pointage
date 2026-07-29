# NE JAMAIS versionner les identifiants
.env

# Artefacts locaux
__pycache__/
*.pyc
log.txt

# Snapshots de diagnostic (prompt 8.4) : utiles localement pour comprendre
# un echec d'extraction, sans interet dans l'historique du depot. Ils sont
# supprimes automatiquement au bout de 30 jours, et recuperables sur GitHub
# Actions comme artefact du workflow.
snapshots/

# Artefacts generes
dashboard.html
docs/index.html
.pytest_dernier.json

# Note : prices.db N'EST PAS ignore volontairement.
# Depuis la bascule SQLite (prompt 6.4), c'est LA source de verite. Sur
# GitHub Actions, les serveurs sont remis a zero a chaque execution : sans
# ce fichier versionne, tout l'historique serait perdu d'un jour a l'autre.
#
# history.json n'est plus qu'un export de secours, produit a la demande
# (--export-history). Il n'est plus ecrit automatiquement.

# Donnees du site : regenerees a chaque publication par l'action
# (exporter_web.py). Les versionner ferait un commit de bruit par jour, et
# la version du depot serait toujours en retard sur celle qui est servie.
web/data.json

# Compte de service Firebase : NE JAMAIS versionner. Il donne un acces en
# ecriture a votre base. Il vit dans le secret de depot FIREBASE_SERVICE_ACCOUNT.
firebase-service-account.json
serviceAccountKey.json
