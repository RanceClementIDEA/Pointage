<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deployer sur GitHub</title>
<style>
  :root{
    --fond:#f4f6f7; --carte:#fff; --texte:#2c3e50; --doux:#7f8c8d;
    --bord:#e5e8e8; --vert:#1e8449; --rouge:#c0392b; --orange:#b9770e;
    --accent:#2c3e50;
  }
  @media (prefers-color-scheme: dark){
    :root{--fond:#15191c;--carte:#1e2429;--texte:#e6eaed;--doux:#8b979f;
          --bord:#2b3238;--accent:#5dade2;}
  }
  *{box-sizing:border-box}
  body{margin:0;padding:18px;background:var(--fond);color:var(--texte);
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
       line-height:1.5;}
  .page{max-width:760px;margin:0 auto}
  h1{font-size:21px;margin:0 0 3px}
  h2{font-size:13px;margin:0 0 9px;letter-spacing:.6px;text-transform:uppercase;
     color:var(--doux)}
  .carte{background:var(--carte);border:1px solid var(--bord);border-radius:10px;
         padding:16px;margin-bottom:13px}
  label{display:block;font-size:12px;margin:9px 0 3px;font-weight:600}
  input[type=text],input[type=password]{
    width:100%;padding:8px 10px;font-size:13px;font-family:inherit;
    border:1px solid var(--bord);border-radius:6px;background:var(--fond);
    color:var(--texte);}
  input[type=file]{font-size:12px;font-family:inherit}
  button{font-family:inherit;font-size:13px;padding:9px 18px;cursor:pointer;
         border:1px solid var(--accent);background:var(--accent);color:var(--carte);
         border-radius:6px;font-weight:600}
  button.doux{background:var(--carte);color:var(--texte);border-color:var(--bord);
              font-weight:400}
  button:disabled{opacity:.4;cursor:default}
  .mini{font-size:11.5px}
  .doux{color:var(--doux)}
  .rangee{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
  pre{background:#11161a;color:#c8d6e0;padding:11px;border-radius:7px;
      font-size:11.5px;line-height:1.5;max-height:320px;overflow:auto;margin:0;
      white-space:pre-wrap;word-break:break-word}
  .avert{border-left:3px solid var(--orange);padding-left:11px;margin:11px 0}
  .refus{border-left:3px solid var(--rouge);padding-left:11px;margin:11px 0;
         color:var(--rouge)}
  ol{padding-left:20px;margin:6px 0}
  li{margin-bottom:4px}
  code{background:var(--fond);padding:1px 4px;border-radius:3px;font-size:.92em}
  a{color:var(--accent)}
</style>
</head>
<body>
<div class="page">

  <h1>Deployer sur GitHub</h1>
  <p class="doux mini" style="margin-top:0">
    Envoie tout le projet en <b>un seul commit</b>, via l'API GitHub.
    Rien a installer&nbsp;: cette page suffit. Les dossiers caches comme
    <code>.github/</code> partent normalement &mdash; c'est justement ce que le
    glisser-deposer de GitHub laisse tomber.
  </p>

  <!-- 1 -->
  <div class="carte">
    <h2>1. Jeton d'acces</h2>
    <p class="mini doux" style="margin-top:0">
      Creez un jeton <b>fine-grained</b> :
      <a href="https://github.com/settings/personal-access-tokens/new" target="_blank"
         rel="noopener">github.com/settings/personal-access-tokens/new</a>
    </p>
    <ol class="mini">
      <li><b>Repository access</b> &rarr; <i>Only select repositories</i> &rarr; votre depot
          (ou <i>All repositories</i> si vous voulez qu'il soit cree ici)</li>
      <li><b>Permissions &rarr; Repository</b> :
          <code>Contents: Read and write</code>,
          <code>Workflows: Read and write</code>,
          <code>Administration: Read and write</code> (creation du depot + Pages),
          <code>Pages: Read and write</code></li>
      <li>Expiration courte &mdash; 7 jours suffisent</li>
    </ol>
    <div class="avert mini">
      <b>Sans <code>Workflows</code>, l'envoi est refuse par GitHub</b> des qu'un
      fichier <code>.github/workflows/</code> est present. C'est l'erreur la plus
      frequente.
    </div>
    <label for="jeton">Jeton</label>
    <input type="password" id="jeton" placeholder="github_pat_..." autocomplete="off" spellcheck="false">
    <p class="mini doux" style="margin-bottom:0">
      Le jeton reste dans cette page&nbsp;: il n'est ni enregistre, ni envoye
      ailleurs qu'a <code>api.github.com</code>. Fermez l'onglet et il disparait.
      Revoquez-le apres usage.
    </p>
  </div>

  <!-- 2 -->
  <div class="carte">
    <h2>2. Depot</h2>
    <div class="rangee">
      <div style="flex:1 1 200px">
        <label for="proprietaire">Compte</label>
        <input type="text" id="proprietaire" placeholder="VotreCompte">
      </div>
      <div style="flex:1 1 200px">
        <label for="depot">Nom du depot</label>
        <input type="text" id="depot" value="PC">
      </div>
    </div>
    <label class="mini" style="font-weight:400;margin-top:10px">
      <input type="checkbox" id="creer" checked> Le creer s'il n'existe pas
      (<b>prive</b>)
    </label>
    <label class="mini" style="font-weight:400">
      <input type="checkbox" id="pages"> Activer GitHub&nbsp;Pages
      (source&nbsp;: GitHub&nbsp;Actions)
    </label>
    <div class="avert mini">
      Gardez le depot <b>prive</b>&nbsp;: il contient <code>config.json</code>
      (vos budgets) et <code>prices.db</code> (tout votre historique). Activer
      Pages publie le site &mdash; lisez <code>SITE_WEB.md</code> avant.
    </div>
  </div>

  <!-- 3 -->
  <div class="carte">
    <h2>3. Dossier du projet</h2>
    <p class="mini doux" style="margin-top:0">
      Choisissez le dossier <code>PC-main</code> decompresse. Rien n'est envoye
      tant que vous n'avez pas relu la liste.
    </p>
    <input type="file" id="dossier" webkitdirectory directory multiple>
    <div id="apercu" class="mini" style="margin-top:11px"></div>
  </div>

  <!-- 4 -->
  <div class="carte">
    <h2>4. Envoi</h2>
    <div class="rangee">
      <button id="envoyer" disabled>Deployer</button>
      <button id="effacer" class="doux">Effacer le journal</button>
      <span id="etat" class="mini doux"></span>
    </div>
    <pre id="journal" style="margin-top:12px">En attente.</pre>
  </div>

</div>
<script src="deployer.js"></script>
</body>
</html>
