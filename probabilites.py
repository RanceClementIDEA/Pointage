name: Suivi prix PC

# ---------------------------------------------------------------------------
# Quand le job se declenche
# ---------------------------------------------------------------------------
on:
  schedule:
    # Format cron GitHub = UTC (pas l'heure francaise !)
    #   ete  (heure d'ete, UTC+2) : 6h UTC = 8h a Paris
    #   hiver (heure d'hiver, UTC+1) : 6h UTC = 7h a Paris
    # Modifiez l'heure ci-dessous selon votre preference.
    - cron: '0 6 * * *'

  # Permet de lancer le job a la main depuis l'onglet Actions.
  # Indispensable pour tester sans attendre le lendemain.
  workflow_dispatch:

# Necessaire pour que le job puisse reecrire history.json dans le depot
permissions:
  contents: write

jobs:
  verifier-prix:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Recuperer le depot
        uses: actions/checkout@v4

      - name: Installer Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Installer les dependances
        run: pip install -r requirements.txt

      - name: Verifier les prix et envoyer le rapport
        env:
          # Ces valeurs viennent des "secrets" du depot.
          # Rien n'est jamais ecrit en clair dans le code.
          EMAIL_SENDER: ${{ secrets.EMAIL_SENDER }}
          EMAIL_RECIPIENT: ${{ secrets.EMAIL_RECIPIENT }}
          EMAIL_APP_PASSWORD: ${{ secrets.EMAIL_APP_PASSWORD }}
          SMTP_SERVER: ${{ secrets.SMTP_SERVER }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
        run: python price_tracker.py

      - name: Sauvegarder l'historique mis a jour
        # Les serveurs GitHub sont remis a zero apres chaque execution :
        # sans ce commit, l'historique serait perdu a chaque fois et les
        # conseils ne progresseraient jamais.
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          if git diff --quiet history.json 2>/dev/null; then
            echo "Aucun changement dans l'historique."
          else
            git add history.json
            git commit -m "Releve de prix du $(date +'%d/%m/%Y')"
            git push
          fi
