<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suivi prix PC</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>&#128200;</text></svg>">
</head>
<body>

<div class="page">

  <header>
    <div>
      <h1>Suivi prix PC</h1>
      <div id="source" class="doux mini"></div>
    </div>
    <div class="rangee">
      <span id="fraicheur" class="doux mini"></span>
      <span id="direct" class="pastille" title="Etat de la liaison"></span>
    </div>
  </header>

  <div id="chargement" class="carte doux">Chargement des donnees…</div>

  <!-- GROSSE OFFRE : le seul bloc qui a le droit de crier -->
  <div id="alertes"></div>

  <div id="resume"></div>

  <div id="barre" class="carte" style="display:none">
    <div class="rangee" style="justify-content:space-between">
      <div>
        <span class="etiquette">Fenetre</span>
        <span id="zooms"></span>
      </div>
      <label class="mini doux">
        <input type="checkbox" id="filtre-offres"> Uniquement les offres
      </label>
    </div>
  </div>

  <div id="composants" class="grille"></div>

  <div id="sequence"></div>

  <footer class="doux mini">
    <p>
      Les prix sont relevés une fois par jour par une action automatique, puis
      publiés ici. Cette page ne contacte aucun marchand&nbsp;: elle lit une
      photographie déjà calculée. Un prix affiché reste un prix
      <strong>constaté à sa date</strong> — vérifiez-le sur le site du vendeur
      avant de commander.
    </p>
    <p id="mention-firebase"></p>
  </footer>

</div>

<script src="config.js"></script>
<script src="app.js"></script>
</body>
</html>
