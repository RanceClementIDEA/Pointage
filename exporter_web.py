/*
 * deployer.js -- envoie le projet sur GitHub en un seul commit.
 *
 * POURQUOI CETTE PAGE EXISTE
 * Le televersement par glisser-deposer de GitHub laisse tomber les dossiers
 * commencant par un point : `.github/` n'arrivait jamais, donc aucun workflow
 * n'apparaissait. Et fichier par fichier, un copier-coller peut atterrir dans
 * le mauvais fichier -- c'est ainsi qu'un document Markdown s'est retrouve
 * dans price_tracker.py.
 *
 * L'API Git de GitHub permet d'eviter les deux : on construit un arbre
 * complet, on cree UN commit, on deplace la branche. C'est atomique : soit
 * tout arrive, soit rien.
 *
 * CE QUI NE PART JAMAIS
 * Un depot GitHub est difficile a nettoyer : un secret pousse une fois reste
 * dans l'historique. Les exclusions ci-dessous sont donc de deux natures :
 *
 *   * IGNORES  -- bruit inutile (caches, artefacts). Simple filtrage.
 *   * REFUSES  -- secrets. Leur seule presence interrompt l'envoi, sans
 *                 proposer de continuer. Un garde-fou qu'on peut contourner
 *                 d'un clic n'en est pas un.
 *
 * Le jeton n'est ni enregistre ni transmis ailleurs qu'a api.github.com.
 */
(function () {
  "use strict";

  var API = "https://api.github.com";
  var $ = function (id) { return document.getElementById(id); };
  var fichiers = [];        // {chemin, blob}
  var enCours = false;

  // --- Ce qui ne monte pas -----------------------------------------------

  // Bruit : filtre silencieusement.
  var IGNORES = [
    /(^|\/)\.git\//, /(^|\/)__pycache__\//, /\.pyc$/,
    /(^|\/)\.pytest_cache\//, /(^|\/)node_modules\//,
    /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/,
    /(^|\/)snapshots\//, /(^|\/)\.pytest_dernier\.json$/,
    /(^|\/)dashboard\.html$/, /(^|\/)docs\/index\.html$/,
    /(^|\/)web\/data\.json$/, /(^|\/)log\.txt$/
  ];

  // Secrets : interrompt l'envoi.
  var REFUSES = [
    { motif: /(^|\/)\.env$/,                     quoi: "mot de passe d'application email" },
    { motif: /service[-_]?account.*\.json$/i,    quoi: "compte de service Firebase" },
    { motif: /serviceAccountKey\.json$/i,        quoi: "compte de service Firebase" },
    { motif: /\.pem$/i,                          quoi: "cle privee" },
    { motif: /(^|\/)id_(rsa|ed25519)$/,          quoi: "cle SSH privee" },
    { motif: /(^|\/)\.npmrc$/,                   quoi: "jeton de registre" }
  ];

  function ignore(chemin) { return IGNORES.some(function (r) { return r.test(chemin); }); }
  function refuse(chemin) {
    for (var i = 0; i < REFUSES.length; i++)
      if (REFUSES[i].motif.test(chemin)) return REFUSES[i];
    return null;
  }

  // --- Journal -----------------------------------------------------------

  function dire(texte) {
    var j = $("journal");
    j.textContent += (j.textContent === "En attente." ? "" : "\n") + texte;
    j.scrollTop = j.scrollHeight;
  }
  function etat(t) { $("etat").textContent = t; }

  // --- Appels GitHub -----------------------------------------------------

  function gh(chemin, options) {
    options = options || {};
    return fetch(API + chemin, {
      method: options.methode || "GET",
      headers: {
        "Authorization": "Bearer " + $("jeton").value.trim(),
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: options.corps ? JSON.stringify(options.corps) : undefined
    }).then(function (r) {
      if (r.status === 204) return {};
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error((d && d.message) || ("HTTP " + r.status));
          e.statut = r.status;
          e.detail = d;
          throw e;
        }
        return d;
      });
    });
  }

  function base64(tampon) {
    var octets = new Uint8Array(tampon), morceaux = [], TAILLE = 0x8000;
    for (var i = 0; i < octets.length; i += TAILLE)
      morceaux.push(String.fromCharCode.apply(null, octets.subarray(i, i + TAILLE)));
    return btoa(morceaux.join(""));
  }

  // --- Selection du dossier ---------------------------------------------

  $("dossier").addEventListener("change", function (e) {
    var bruts = Array.from(e.target.files);
    if (!bruts.length) return;

    // Le premier segment est le nom du dossier choisi : on le retire pour que
    // les fichiers arrivent a la racine du depot.
    var racine = bruts[0].webkitRelativePath.split("/")[0] + "/";
    var gardes = [], ignores = 0, bloquants = [];

    bruts.forEach(function (f) {
      var chemin = f.webkitRelativePath.startsWith(racine)
        ? f.webkitRelativePath.slice(racine.length) : f.webkitRelativePath;
      if (!chemin) return;
      var r = refuse(chemin);
      if (r) { bloquants.push({ chemin: chemin, quoi: r.quoi }); return; }
      if (ignore(chemin)) { ignores++; return; }
      gardes.push({ chemin: chemin, blob: f });
    });

    fichiers = gardes;
    var poids = gardes.reduce(function (n, f) { return n + f.blob.size; }, 0);

    var html = "";
    if (bloquants.length) {
      // Refus categorique : pas de case a cocher pour passer outre.
      fichiers = [];
      html += '<div class="refus"><b>Envoi impossible : element(s) sensible(s) detecte(s).</b><br>'
        + bloquants.map(function (b) {
            return "<code>" + b.chemin + "</code> — " + b.quoi;
          }).join("<br>")
        + "<br><br>Un secret pousse une fois reste dans l'historique du depot. "
        + "Retirez ces fichiers du dossier, puis recommencez.</div>";
    } else {
      html += "<b>" + gardes.length + " fichiers</b> a envoyer ("
        + (poids / 1024).toFixed(0) + " Ko), " + ignores + " ignore(s).<br>";
      var cles = ["price_tracker.py", "config.json", "prices.db",
                  ".github/workflows/price-tracker.yml",
                  ".github/workflows/site.yml", "web/index.html",
                  "requirements.txt"];
      html += '<div class="doux" style="margin-top:6px">';
      cles.forEach(function (c) {
        var la = gardes.some(function (f) { return f.chemin === c; });
        html += (la ? "&#10003; " : "&#10007; ") + "<code>" + c + "</code><br>";
      });
      html += "</div>";
      var wf = gardes.filter(function (f) { return f.chemin.indexOf(".github/") === 0; });
      if (!wf.length)
        html += '<div class="avert">Aucun fichier <code>.github/</code> : avez-vous '
              + "bien choisi le dossier <code>PC-main</code> lui-meme ?</div>";
    }
    $("apercu").innerHTML = html;
    $("envoyer").disabled = !fichiers.length || enCours;
  });

  // --- Deploiement -------------------------------------------------------

  function lire(f) {
    return new Promise(function (ok, ko) {
      var l = new FileReader();
      l.onload = function () { ok(base64(l.result)); };
      l.onerror = ko;
      l.readAsArrayBuffer(f);
    });
  }

  async function deployer() {
    var proprietaire = $("proprietaire").value.trim();
    var depot = $("depot").value.trim();
    if (!$("jeton").value.trim()) return dire("! Jeton manquant.");
    if (!proprietaire || !depot) return dire("! Compte ou nom de depot manquant.");

    enCours = true;
    $("envoyer").disabled = true;
    $("journal").textContent = "";

    try {
      var moi = await gh("/user");
      dire("Connecte comme " + moi.login + ".");

      // 1. Le depot existe-t-il ?
      var infos = null;
      try {
        infos = await gh("/repos/" + proprietaire + "/" + depot);
        dire("Depot trouve : " + infos.full_name + " (" +
             (infos.private ? "prive" : "PUBLIC") + ").");
      } catch (e) {
        if (e.statut !== 404) throw e;
        if (!$("creer").checked)
          throw new Error("Depot introuvable et creation non demandee.");
        dire("Depot absent : creation...");
        infos = await gh("/user/repos", {
          methode: "POST",
          corps: { name: depot, private: true, auto_init: false,
                   description: "Suivi de prix PC" }
        });
        dire("Depot cree : " + infos.full_name + " (prive).");
      }

      var branche = infos.default_branch || "main";

      // 2. Point de depart
      var base = null;
      try {
        var ref = await gh("/repos/" + proprietaire + "/" + depot +
                           "/git/ref/heads/" + branche);
        base = ref.object.sha;
        dire("Branche " + branche + " a " + base.slice(0, 7) + ".");
      } catch (e) {
        dire("Depot vide : premier commit.");
      }

      // 3. Les fichiers, un par un
      dire("Envoi de " + fichiers.length + " fichiers...");
      var entrees = [];
      for (var i = 0; i < fichiers.length; i++) {
        var f = fichiers[i];
        var contenu = await lire(f.blob);
        var b = await gh("/repos/" + proprietaire + "/" + depot + "/git/blobs", {
          methode: "POST", corps: { content: contenu, encoding: "base64" }
        });
        entrees.push({ path: f.chemin, mode: "100644", type: "blob", sha: b.sha });
        etat((i + 1) + " / " + fichiers.length);
        if ((i + 1) % 20 === 0 || i === fichiers.length - 1)
          dire("  " + (i + 1) + "/" + fichiers.length + " ...");
      }

      // 4. Arbre, commit, branche
      // L'arbre est construit SANS base_tree : ce qui n'est pas dans la liste
      // disparait. C'est voulu -- le depot devient l'exact reflet du dossier,
      // et un fichier corrompu lors d'un essai precedent est remplace.
      var arbre = await gh("/repos/" + proprietaire + "/" + depot + "/git/trees", {
        methode: "POST", corps: { tree: entrees }
      });
      var commit = await gh("/repos/" + proprietaire + "/" + depot + "/git/commits", {
        methode: "POST",
        corps: {
          message: "Deploiement du suivi de prix PC\n\n" + fichiers.length +
                   " fichiers envoyes en un seul commit depuis deployer.html.",
          tree: arbre.sha,
          parents: base ? [base] : []
        }
      });
      dire("Commit " + commit.sha.slice(0, 7) + " cree.");

      if (base) {
        await gh("/repos/" + proprietaire + "/" + depot + "/git/refs/heads/" + branche,
                 { methode: "PATCH", corps: { sha: commit.sha, force: true } });
      } else {
        await gh("/repos/" + proprietaire + "/" + depot + "/git/refs",
                 { methode: "POST",
                   corps: { ref: "refs/heads/" + branche, sha: commit.sha } });
      }
      dire("Branche " + branche + " mise a jour.");

      // 5. Pages, si demande
      if ($("pages").checked) {
        try {
          await gh("/repos/" + proprietaire + "/" + depot + "/pages", {
            methode: "POST", corps: { build_type: "workflow" }
          });
          dire("GitHub Pages active (source : Actions).");
        } catch (e) {
          if (e.statut === 409) dire("GitHub Pages etait deja actif.");
          else dire("! Pages non active : " + e.message +
                    " (Settings > Pages > Source : GitHub Actions)");
        }
      }

      dire("");
      dire("=== TERMINE ===");
      dire("Depot   : https://github.com/" + proprietaire + "/" + depot);
      dire("Actions : https://github.com/" + proprietaire + "/" + depot + "/actions");
      dire("");
      dire("Il reste UNE etape a faire a la main, l'API ne la couvre pas :");
      dire("  Settings > Actions > General > Workflow permissions");
      dire("  -> Read and write permissions -> Save");
      dire("Sans elle, l'action ne peut pas reenregistrer prices.db et");
      dire("l'historique repart de zero chaque jour.");
      dire("");
      dire("Pensez a revoquer le jeton.");
      etat("termine");
    } catch (e) {
      dire("");
      dire("!!! ECHEC : " + e.message);
      if (e.statut === 401) dire("    Jeton invalide ou expire.");
      if (e.statut === 403 && /workflow/i.test(e.message || ""))
        dire("    Il manque la permission 'Workflows: Read and write' au jeton.");
      else if (e.statut === 403)
        dire("    Permissions insuffisantes sur ce depot.");
      if (e.statut === 404) dire("    Compte ou depot introuvable.");
      dire("    Rien n'a ete modifie si l'echec est survenu avant le commit.");
      etat("echec");
    } finally {
      enCours = false;
      $("envoyer").disabled = !fichiers.length;
    }
  }

  $("envoyer").addEventListener("click", deployer);
  $("effacer").addEventListener("click", function () {
    $("journal").textContent = "En attente.";
    etat("");
  });
})();
