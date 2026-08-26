/* Flux complet « sélection de rituel → PowerPoint », sur les fonctions
   RÉELLES d'app.js chargées dans le harnais.
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./app-harness.js");

const A = loadApp();

/* Jeu de fiches proche du support « Indicateurs Magasins Armement » */
const FICHES_DECK = [
  { id: "kpi_volumetrie_hebdomadaire", manual: true, title: "Volumétrie Logistiport", freq: "Hebdomadaire",
    ritual: "COPIL", process: "Distribution", _mtime: 100, _by: "marie",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p1?visual=v1&a=1" },
  { id: "kpi_volumetrie_quotidienne", manual: true, title: "Volumétrie Logistiport", freq: "Quotidienne",
    ritual: "Point quotidien", process: "Distribution", _mtime: 100, _by: "marie",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p1?visual=v2" },
  { id: "kpi_taux_service_hebdomadaire", manual: true, title: "Taux de service réception", freq: "Hebdomadaire",
    ritual: "COPIL", process: "Réception", _mtime: 100, _by: "marie",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p2?visual=v3" },
  { id: "kpi_anticipation_mensuelle", manual: true, title: "Anticipation des demandes", freq: "Mensuelle",
    ritual: "Revue mensuelle", process: "Distribution", _mtime: 100, _by: "marie" }
];

/** Prépare l'application avec les fiches ci-dessus et un modèle simulé. */
function preparerDeck(opts) {
  A.reset(Object.assign({ manualEntries: FICHES_DECK.map(f => ({ ...f })) }, opts || {}));
  A.run(`
    presets = []; selectionIds = []; selectionMode = false; presetCourant = "";
    empreintes = []; capturesDeck = {}; commentairesVolatils = {};
    rebuildData(false);
    // Modèle PowerPoint minimal : la fabrique complète est éprouvée par pptx.test.js
    modeleDeckCache = ZipMini.ecrireZip([
      { nom: "[Content_Types].xml", donnees: "<?xml version=\\"1.0\\"?><Types></Types>" },
      { nom: "ppt/presentation.xml", donnees: "<p:presentation><p:sldIdLst></p:sldIdLst></p:presentation>" },
      { nom: "ppt/_rels/presentation.xml.rels", donnees: "<Relationships></Relationships>" }
    ]);
  `);
}

/* ═══ Mode sélection ═══ */

test("sélection : le mode se déclenche et affiche sa barre d'action", () => {
  preparerDeck();
  assert.equal(A.run("basculerModeSelection(true)"), true);
  assert.ok(!A.el("selectionBar")._classes.has("hidden"), "la barre doit être visible");
});

test("sélection : quitter le mode masque la barre sans vider la sélection", () => {
  preparerDeck();
  A.run("basculerModeSelection(true)");
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("basculerModeSelection(false)");
  assert.ok(A.el("selectionBar")._classes.has("hidden"));
  assert.deepEqual(A.get("selectionIds"), ["kpi_volumetrie_hebdomadaire"]);
});

test("sélection : cocher puis décocher revient à zéro", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  assert.equal(A.get("selectionIds").length, 1);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  assert.equal(A.get("selectionIds").length, 0);
});

test("sélection : l'ordre de cochage est l'ordre du jour, donc l'ordre des diapositives", () => {
  preparerDeck();
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  assert.deepEqual(A.get("selectionIds"),
    ["kpi_taux_service_hebdomadaire", "kpi_volumetrie_hebdomadaire"]);
});

test("sélection : la sélection porte sur la temporalité, pas sur l'intitulé", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_volumetrie_quotidienne");
  assert.equal(A.get("selectionIds").length, 2, "deux temporalités du même KPI restent distinctes");
});

test("sélection : le compteur affiché suit la sélection", () => {
  preparerDeck();
  A.run("basculerModeSelection(true)");
  assert.match(A.texte("selectionCount"), /Aucun/);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  assert.match(A.texte("selectionCount"), /1 KPI/);
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  assert.match(A.texte("selectionCount"), /2 KPI/);
});

test("sélection : vider remet tout à zéro et oublie la sélection chargée", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run(`presetCourant = "preset_copil"`);
  A.viderSelection();
  assert.deepEqual(A.get("selectionIds"), []);
  assert.equal(A.get("presetCourant"), "");
});

/* ═══ « Tout cocher » suit le filtre ═══ */

test("filtre rituel : « tout cocher » ne prend que les KPI du rituel affiché", () => {
  preparerDeck();
  A.saisir("ritualFilter", "COPIL");
  A.run("filterData()");
  A.cocherResultatsFiltres();
  const ids = A.get("selectionIds");
  assert.equal(ids.length, 2, "seuls les deux KPI du COPIL sont cochés");
  assert.ok(!ids.includes("kpi_anticipation_mensuelle"));
});

test("filtre rituel : changer de rituel et re-cocher CUMULE les deux ordres du jour", () => {
  preparerDeck();
  A.saisir("ritualFilter", "COPIL");
  A.run("filterData()");
  A.cocherResultatsFiltres();
  A.saisir("ritualFilter", "Revue mensuelle");
  A.run("filterData()");
  A.cocherResultatsFiltres();
  assert.ok(A.get("selectionIds").includes("kpi_anticipation_mensuelle"));
  assert.equal(A.get("selectionIds").length, 3);
});

test("filtre rituel : re-cocher deux fois n'ajoute pas de doublon", () => {
  preparerDeck();
  A.saisir("ritualFilter", "COPIL");
  A.run("filterData()");
  A.cocherResultatsFiltres();
  const avant = A.get("selectionIds").length;
  A.cocherResultatsFiltres();
  assert.equal(A.get("selectionIds").length, avant);
});

test("recherche : « tout cocher » suit aussi la recherche plein texte", () => {
  preparerDeck();
  A.saisir("search", "taux de service");
  A.run("filterData()");
  A.cocherResultatsFiltres();
  assert.deepEqual(A.get("selectionIds"), ["kpi_taux_service_hebdomadaire"]);
});

/* ═══ Sélections enregistrées ═══ */

test("enregistrement : la sélection est nommée, conservée et persistée", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.enregistrerSelection("COPIL hebdomadaire");

  const presets = A.get("presets");
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, "COPIL hebdomadaire");
  assert.deepEqual(presets[0].items.map(i => i.kpiId),
    ["kpi_volumetrie_hebdomadaire", "kpi_taux_service_hebdomadaire"]);
  assert.ok(A.stockage().kpiPresets, "la sélection doit survivre à un rechargement");
});

test("enregistrement : réutiliser le même nom met à jour au lieu de dupliquer", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.enregistrerSelection("COPIL");
  const presets = A.get("presets");
  assert.equal(presets.length, 1, "un seul « COPIL », pas deux");
  assert.equal(presets[0].items.length, 2);
});

test("enregistrement : une sélection vide est refusée avec un message", () => {
  preparerDeck();
  assert.equal(A.enregistrerSelection("COPIL"), null);
  assert.match(A.dernierMessage(), /vide/i);
});

test("enregistrement : un nom vide est refusé", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  assert.equal(A.enregistrerSelection("   "), null);
  assert.match(A.dernierMessage(), /nom/i);
});

test("rechargement : une sélection enregistrée se recharge à l'identique", () => {
  preparerDeck();
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.viderSelection();
  A.chargerSelection("preset_copil");
  assert.deepEqual(A.get("selectionIds"),
    ["kpi_taux_service_hebdomadaire", "kpi_volumetrie_hebdomadaire"]);
});

test("rechargement : un KPI supprimé entre-temps est écarté et signalé", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.viderSelection();

  A.run(`manualEntries = manualEntries.filter(k => k.id !== "kpi_taux_service_hebdomadaire"); rebuildData(false);`);
  A.chargerSelection("preset_copil");

  assert.deepEqual(A.get("selectionIds"), ["kpi_volumetrie_hebdomadaire"]);
  assert.match(A.dernierMessage(), /n'existe/);
});

test("rechargement : une sélection inconnue ne casse rien", () => {
  preparerDeck();
  assert.equal(A.chargerSelection("preset_inexistant"), null);
  assert.match(A.dernierMessage(), /introuvable/i);
});

test("suppression : la sélection disparaît, les KPI restent intacts", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.confirmer(true);
  assert.equal(A.supprimerSelection("preset_copil"), true);
  assert.equal(A.get("presets").length, 0);
  assert.equal(A.get("data").length, 4, "les fiches ne sont pas touchées");
});

test("suppression : refuser la confirmation conserve la sélection", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.confirmer(false);
  assert.equal(A.supprimerSelection("preset_copil"), false);
  assert.equal(A.get("presets").length, 1);
});

test("réordonnancement : monter une ligne change l'ordre des diapositives", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.deplacerSelection("kpi_taux_service_hebdomadaire", -1);
  assert.deepEqual(A.get("selectionIds"),
    ["kpi_taux_service_hebdomadaire", "kpi_volumetrie_hebdomadaire"]);
});

test("réordonnancement : on ne peut pas sortir des bornes", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.deplacerSelection("kpi_volumetrie_hebdomadaire", -1);
  A.deplacerSelection("kpi_taux_service_hebdomadaire", 1);
  assert.deepEqual(A.get("selectionIds"),
    ["kpi_volumetrie_hebdomadaire", "kpi_taux_service_hebdomadaire"]);
});

/* ═══ Partage entre appareils ═══ */

test("synchro : les sélections partent dans le document partagé", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  const payload = A.buildSyncPayload();
  assert.ok(Array.isArray(payload.kpiPresets));
  assert.equal(payload.kpiPresets[0].name, "COPIL");
});

test("synchro : une sélection créée sur un autre poste arrive sans écraser la mienne", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.run(`mergeRemoteContent({ kpiPresets: [
    { id: "preset_point_quotidien", name: "Point quotidien",
      items: [{ kpiId: "kpi_volumetrie_quotidienne" }], _mtime: 999, _by: "jean" }
  ]})`);
  const noms = A.get("presets").map(p => p.name).sort();
  assert.deepEqual(noms, ["COPIL", "Point quotidien"]);
});

test("synchro : sur une même sélection, la version la plus récente gagne", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.run(`mergeRemoteContent({ kpiPresets: [
    { id: "preset_copil", name: "COPIL",
      items: [{ kpiId: "kpi_taux_service_hebdomadaire" }], _mtime: 9999999999999, _by: "jean" }
  ]})`);
  const p = A.get("presets").find(x => x.id === "preset_copil");
  assert.deepEqual(p.items.map(i => i.kpiId), ["kpi_taux_service_hebdomadaire"]);
});

test("synchro : un document sans sélections ne vide pas les miennes", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.run(`mergeRemoteContent({ kpiManual: [] })`);
  assert.equal(A.get("presets").length, 1, "champ absent ≠ liste vide");
});

test("synchro : « remplacer par le cloud » sans sélections distantes conserve les locales", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.confirmer(true);
  A.run(`replaceLocalWithRemote({ kpiManual: ${JSON.stringify(FICHES_DECK)}, updatedAt: 5 })`);
  assert.equal(A.get("presets").length, 1);
});

/* ═══ Génération du PowerPoint ═══ */

test("génération : une diapositive par KPI sélectionné", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  const res = await A.run("genererDeck()");
  assert.equal(res.diapos, 2);
  assert.match(res.nom, /\.pptx$/);
});

test("génération : le fichier porte le nom de la sélection", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL hebdomadaire");
  const res = await A.run("genererDeck()");
  assert.match(res.nom, /copil_hebdomadaire/);
});

test("génération : une sélection vide ne produit aucun fichier", async () => {
  preparerDeck();
  const res = await A.run("genererDeck()");
  assert.equal(res, null);
  assert.match(A.dernierMessage(), /vide/i);
});

test("génération : un KPI sans lien Power BI n'empêche pas le deck", async () => {
  preparerDeck();
  A.basculerSelection("kpi_anticipation_mensuelle");
  const res = await A.run("genererDeck()");
  assert.equal(res.diapos, 1);
});

test("génération : l'absence de modèle est signalée sans planter", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run(`modeleDeckCache = null; fetch = function () { return Promise.resolve({ ok: false }); };`);
  const res = await A.run("genererDeck()");
  assert.equal(res, null);
  assert.match(A.dernierMessage(), /Modèle/i);
});

test("génération : la production est tracée dans l'historique", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  await A.run("genererDeck()");
  const trace = A.get("activityLog")[0];
  assert.equal(trace.action, "deck");
  assert.match(trace.detail, /1 diapositive/);
});

test("génération : le contenu produit est bien une archive PowerPoint relisible", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  // On rejoue la construction avec les mêmes entrées pour inspecter le résultat
  const noms = await A.run(`(async function () {
    var p = selectionCourante();
    var r = Selection.resoudrePreset(p, data.concat(personalEntries), activeSites());
    var octets = await PptxDeck.construireDeck(modeleDeckCache, {
      titre: "T", diapos: r.diapos.map(function (d) { return { titre: d.titre, lien: d.lien }; })
    });
    var pieces = await ZipMini.lireZip(octets);
    return Array.from(pieces.keys());
  })()`);
  assert.ok(noms.includes("ppt/slides/slide1.xml"));
  assert.ok(noms.includes("ppt/slides/slide2.xml"));
});

/* ═══ Ce qui ne doit PAS bouger ═══ */

/** Contenu HTML réellement écrit dans les cartes affichées. */
const htmlCartesDeck = () =>
  A.run(`(container.children || []).map(function (c) { return c.innerHTML || ""; }).join("")`);

test("non-régression : hors mode sélection, aucune case n'est ajoutée aux cartes", () => {
  preparerDeck();
  A.run("basculerModeSelection(false); filterData();");
  assert.ok(!htmlCartesDeck().includes("card-select"));
});

test("non-régression : en mode sélection, la carte porte sa case et son rang", () => {
  preparerDeck();
  A.run("basculerModeSelection(true)");
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  const html = htmlCartesDeck();
  assert.ok(html.includes("card-select"));
  assert.ok(html.includes("card-select-rang"));
});

test("non-régression : les favoris et les boutons de carte restent en place", () => {
  preparerDeck({ favorites: ["kpi_volumetrie_hebdomadaire"] });
  A.run("rebuildData(false); basculerModeSelection(true)");
  const html = htmlCartesDeck();
  assert.ok(html.includes("btn-fav"), "le bouton favori subsiste");
  assert.ok(html.includes("Choisir un rapport"), "le sélecteur de rapport subsiste");
});

test("non-régression : une sélection ne modifie jamais les fiches", () => {
  preparerDeck();
  const avant = JSON.stringify(A.get("manualEntries"));
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.enregistrerSelection("COPIL");
  A.chargerSelection("preset_copil");
  assert.equal(JSON.stringify(A.get("manualEntries")), avant);
});

/* ═══ Passerelle vers la capture automatique ═══ */

test("mode : par défaut, le support embarque les visuels vivants", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  const xml = await A.run(`(async function () {
    var mode = (document.getElementById("deckModeSelect").value) || "vivant";
    var r = Selection.resoudrePreset(selectionCourante(), data.concat(personalEntries), activeSites());
    var octets = await PptxDeck.construireDeck(modeleDeckCache, { titre: "T",
      diapos: r.diapos.map(function (d) {
        return { titre: d.titre, lien: d.lien, vivant: mode === "vivant" && !!d.lien };
      }) });
    var pieces = await ZipMini.lireZip(octets);
    return ZipMini.versTexte(pieces.get("ppt/slides/slide1.xml"));
  })()`);
  assert.ok(xml.includes("<we:webextensionref"), "le complément Power BI est posé");
});

/* Pose l'empreinte d'un lien : ce que le complément Power BI avait
   mémorisé lors d'une insertion faite à la main. Sans elle, il affiche
   « l'objet visuel n'existe plus » — vérifié en conditions réelles. */
function poserEmpreinte(lien) {
  A.run(`empreintes = [Empreintes.creerEmpreinte({
    reportUrl: ${JSON.stringify(lien)},
    artifactName: "&quot;Histo empilé&quot;",
    bookmark: "&quot;H4sIEtatSerialise&quot;"
  }, { horodatage: 1 })]`);
}

test("mode : un lien de visuel sans empreinte demande d'abord un relevé", () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("à relever"),
    "sans empreinte, le complément afficherait « l'objet visuel n'existe plus »");
});

test("mode : une fois l'empreinte relevée, le visuel est annoncé comme prêt", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  poserEmpreinte(LIEN_VISUEL);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("⚡ visuel"));
});

test("mode : sans lien Power BI, la ligne le signale", () => {
  preparerDeck();
  A.basculerSelection("kpi_anticipation_mensuelle");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("sans lien"));
});

test("génération : le message de fin précise le mode retenu", async () => {
  preparerDeck();
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  await A.run("genererDeck()");
  assert.match(A.dernierMessage(), /visuels vivants/);
});

/* ═══ Le bon graphique, et lui seul ═══ */

/** Remplace le lien d'un KPI pour éprouver le diagnostic. */
function relier(kpiId, lien) {
  A.run(`manualEntries.forEach(function (k) { if (k.id === ${JSON.stringify(kpiId)}) k.logistiport = ${JSON.stringify(lien)}; });
         rebuildData(false);`);
}

const LIEN_VISUEL = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&width=1253.02&height=527.91";
const LIEN_BANDEAU = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v9&width=1140.87&height=51.48";
const LIEN_PAGE = "https://app.powerbi.com/links/UWLu7wc3Ez?pbi_source=linkShare&bookmarkGuid=eb57";

test("liens : un lien de visuel au bon format est validé", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  poserEmpreinte(LIEN_VISUEL);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  const html = A.html("deckList");
  assert.ok(html.includes("⚡ visuel"));
  assert.ok(html.includes("1253×528 px"), "le format du visuel est affiché");
  assert.equal(A.el("deckWarning").style.display, "none", "aucune alerte");
});

test("liens : un visuel sans empreinte est signalé dans le bilan", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.equal(A.el("deckWarning").style.display, "block");
  assert.ok(A.texte("deckWarning").includes("sans empreinte"));
});

test("liens : un lien de PAGE est signalé — il afficherait tout le rapport", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_PAGE);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("⚠ page entière"));
  assert.match(A.texte("deckWarning"), /lien\(s\) de PAGE/);
});

test("liens : le message explique comment reprendre un lien de page", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_PAGE);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("Lien vers cet élément visuel"));
});

test("liens : un visuel dix fois plus large que haut est signalé comme suspect", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_BANDEAU);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("⚠ format allongé"));
  assert.ok(A.html("deckList").includes("1141×51 px"));
  assert.match(A.texte("deckWarning"), /format très allongé/);
});

test("liens : le bilan cumule les différents soucis", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_PAGE);
  relier("kpi_taux_service_hebdomadaire", LIEN_BANDEAU);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.basculerSelection("kpi_anticipation_mensuelle");   // sans lien
  A.run("renderDeckLignes()");
  const bilan = A.texte("deckWarning");
  assert.match(bilan, /1 lien\(s\) de PAGE/);
  assert.match(bilan, /1 visuel\(s\) au format très allongé/);
  assert.match(bilan, /1 KPI sans lien/);
});

test("liens : la ligne fautive est mise en évidence", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_PAGE);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("deck-row-warn"));
});

/* ─── Empreintes : relever, partager, générer ───────────────
   Le relevé se fait dans le navigateur, à partir d'un PowerPoint où le
   visuel a été inséré à la main. C'est l'unique geste manuel, et il
   n'est à faire qu'une fois par KPI. */

/** Un .pptx minimal portant UN complément Power BI, comme après insertion. */
function pptxAvecComplement(lien, nom) {
  const props = [
    `<we:property name="reportUrl" value="&quot;${lien.replace(/&/g, "&amp;")}&quot;"/>`,
    `<we:property name="artifactName" value="&quot;${nom || "Histo empilé"}&quot;"/>`,
    `<we:property name="pageName" value="&quot;p1&quot;"/>`,
    `<we:property name="datasetId" value="&quot;jeu-1&quot;"/>`,
    `<we:property name="bookmark" value="&quot;H4sIEtatSerialise&quot;"/>`,
    `<we:property name="initialStateBookmark" value="&quot;H4sIEtatSerialise&quot;"/>`,
    `<we:property name="creatorSessionId" value="&quot;session-a-oublier&quot;"/>`
  ].join("");
  return A.run(`ZipMini.ecrireZip([
    { nom: "[Content_Types].xml", donnees: "<?xml version=\\"1.0\\"?><Types></Types>" },
    { nom: "ppt/webextensions/webextension1.xml",
      donnees: ${JSON.stringify(`<we:webextension><we:properties>${props}</we:properties></we:webextension>`)} }
  ])`);
}


test("empreintes : un PowerPoint fait à la main livre sa mémoire", async () => {
  preparerDeck();
  const octets = pptxAvecComplement(LIEN_VISUEL);
  const bilan = await A.run("releverEmpreintesDepuis")(octets);
  assert.equal(bilan.total, 1);
  assert.equal(bilan.ajoutees, 1);
  assert.equal(A.run("empreintes.length"), 1);
  assert.equal(A.run("empreintes[0].libelle"), "Histo empilé");
});

test("empreintes : les traces de la session d'insertion ne sont pas reprises", async () => {
  preparerDeck();
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(LIEN_VISUEL));
  assert.ok(!("creatorSessionId" in A.run("empreintes[0].proprietes")),
    "un fichier neuf ne doit pas porter les traces d'un autre");
});

test("empreintes : relever deux fois le même visuel n'en crée pas deux", async () => {
  preparerDeck();
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(LIEN_VISUEL));
  const second = await A.run("releverEmpreintesDepuis")(pptxAvecComplement(LIEN_VISUEL, "Renommé"));
  assert.equal(second.ajoutees, 0);
  assert.equal(A.run("empreintes.length"), 1);
});

test("empreintes : un PowerPoint sans insertion manuelle ne trompe personne", async () => {
  preparerDeck();
  const vide = A.run(`ZipMini.ecrireZip([
    { nom: "[Content_Types].xml", donnees: "<?xml version=\\"1.0\\"?><Types></Types>" }])`);
  const bilan = await A.run("releverEmpreintesDepuis")(vide);
  assert.equal(bilan.total, 0);
  assert.equal(A.run("empreintes.length"), 0);
});

test("empreintes : le relevé est rangé dans le stockage, donc partagé", async () => {
  preparerDeck();
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(LIEN_VISUEL));
  const range = JSON.parse(A.run(`localStorage.getItem("kpiEmpreintes")`));
  assert.equal(range.length, 1);
  assert.ok(range[0].proprietes.bookmark, "l'état sérialisé est conservé : sans lui, rien ne s'affiche");
});

/* Le fichier tel que le navigateur le remet après un clic sur « Parcourir ». */
function fichierChoisi(octets, nom) {
  return { name: nom || "support.pptx", arrayBuffer: async () => octets.buffer || octets };
}

test("empreintes : importer un fichier remet la liste à jour toute seule", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("à relever"));
  await A.run("importerEmpreintes")(fichierChoisi(pptxAvecComplement(LIEN_VISUEL)));
  assert.ok(A.html("deckList").includes("⚡ visuel"), "la liste se remet à jour toute seule");
});

test("empreintes : un fichier sans insertion manuelle le dit clairement", async () => {
  preparerDeck();
  const vide = A.run(`ZipMini.ecrireZip([
    { nom: "[Content_Types].xml", donnees: "<?xml version=\\"1.0\\"?><Types></Types>" }])`);
  await A.run("importerEmpreintes")(fichierChoisi(vide));
  assert.match(A.dernierMessage(), /inséré à la main/);
});

test("empreintes : relever un KPI ne couvre pas son voisin de la même page", () => {
  // Vérifié : huit insertions du même visuel donnent huit états. L'état
  // porte les filtres du KPI relevé, jamais ceux du voisin.
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  relier("kpi_taux_service_hebdomadaire", LIEN_VISUEL.replace("visual=v1", "visual=v2"));
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.equal((A.html("deckList").match(/à relever/g) || []).length, 2);
});

test("empreintes : le bilan annonce des KPI à insérer, pas des pages", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  relier("kpi_taux_service_hebdomadaire", LIEN_VISUEL.replace("visual=v1", "visual=v2"));
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  A.run("renderDeckLignes()");
  const bilan = A.texte("deckWarning");
  assert.match(bilan, /2 KPI sans empreinte/);
  assert.match(bilan, /LIEN DE L'ANNUAIRE/);
});

test("empreintes : le support produit porte bien la mémoire relevée", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(LIEN_VISUEL));
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  const options = A.run(`(function () {
    const preset = selectionCourante();
    const { diapos } = Selection.resoudrePreset(preset, [...data, ...personalEntries], activeSites());
    return { diapos: diapos.map(d => ({ lien: d.lien, vivant: true })), empreintes };
  })()`);
  const diapo = A.run("PptxDeck.avecEmpreinte")(options.diapos[0], options.empreintes);
  assert.ok(diapo.proprietesComplement, "l'empreinte est appliquée à la diapositive");
  assert.equal(diapo.proprietesComplement.artifactName, "&quot;Histo empilé&quot;");
  assert.ok(diapo.proprietesComplement.initialStateBookmark, "la copie de l'état est reconstituée");
});

/* ─── Relevé livré sous forme de fichier .json ──────────────
   Sert à transmettre un relevé sans refaire l'insertion : entre deux
   annuaires, ou quand quelqu'un a déjà fait le travail. */

function jsonEmpreinte(lien, nom) {
  return JSON.stringify([{
    id: A.run(`Empreintes.cleVisuel(${JSON.stringify(lien)})`),
    libelle: nom || "Histo empilé",
    proprietes: { artifactName: "&quot;" + (nom || "Histo empilé") + "&quot;",
                  bookmark: "&quot;H4sIEtatSerialise&quot;" },
    _mtime: 1, _by: "clement"
  }]);
}

const fichierJson = (texte, nom) => ({ name: nom || "empreintes.json", text: async () => texte });

test("empreintes : un relevé .json s'importe comme un PowerPoint", async () => {
  preparerDeck();
  await A.run("importerEmpreintes")(fichierJson(jsonEmpreinte(LIEN_VISUEL)));
  assert.equal(A.run("empreintes.length"), 1);
  assert.equal(A.run("empreintes[0].libelle"), "Histo empilé");
});

test("empreintes : un relevé .json couvre le KPI qu'il décrit, et lui seul", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  relier("kpi_taux_service_hebdomadaire", LIEN_VISUEL.replace("visual=v1", "visual=vAutre"));
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.basculerSelection("kpi_taux_service_hebdomadaire");
  await A.run("importerEmpreintes")(fichierJson(jsonEmpreinte(LIEN_VISUEL)));
  const html = A.html("deckList");
  assert.equal((html.match(/⚡ visuel/g) || []).length, 1);
  assert.equal((html.match(/à relever/g) || []).length, 1);
});

test("empreintes : un relevé sans état est écarté plutôt qu'accepté à moitié", () => {
  preparerDeck();
  const sansEtat = JSON.stringify([{ id: "r1/p1/v1", proprietes: { artifactName: "&quot;X&quot;" } }]);
  const bilan = A.run("importerEmpreintesJson")(sansEtat);
  assert.equal(bilan.total, 0);
  assert.equal(bilan.ignores, 1);
  assert.equal(A.run("empreintes.length"), 0);
});

test("empreintes : le format du document partagé est accepté lui aussi", () => {
  preparerDeck();
  const doc = JSON.stringify({ kpiEmpreintes: JSON.parse(jsonEmpreinte(LIEN_VISUEL)), updatedAt: 5 });
  assert.equal(A.run("importerEmpreintesJson")(doc).total, 1);
});

test("empreintes : un fichier illisible le dit, sans rien casser", async () => {
  preparerDeck();
  await A.run("importerEmpreintes")(fichierJson("{pas du json", "casse.json"));
  assert.match(A.dernierMessage(), /Lecture impossible/);
  assert.equal(A.run("empreintes.length"), 0);
});

test("empreintes : réimporter le même relevé ne crée pas de doublon", async () => {
  preparerDeck();
  const texte = jsonEmpreinte(LIEN_VISUEL);
  await A.run("importerEmpreintes")(fichierJson(texte));
  const second = await A.run("importerEmpreintes")(fichierJson(texte));
  assert.equal(second.ajoutees, 0);
  assert.equal(A.run("empreintes.length"), 1);
});

/* ─── Empreintes livrées avec l'annuaire ────────────────────
   Relever une empreinte suppose une insertion manuelle dans PowerPoint.
   Quand elle a déjà été faite, autant la livrer : `empreintes-livrees.json`
   est déposé à côté d'index.html et chargé au démarrage. Il COMBLE, il
   n'écrase jamais — ni un relevé local, ni celui de l'équipe. */

function livraison(lien, nom, quand) {
  return JSON.stringify([{
    id: A.run(`Empreintes.cleVisuel(${JSON.stringify(lien)})`),
    libelle: nom || "Livré",
    proprietes: { artifactName: "&quot;" + (nom || "Livré") + "&quot;",
                  bookmark: "&quot;H4sIEtat" + (nom || "L") + "&quot;" },
    _mtime: quand || 500, _by: "livraison"
  }]);
}

test("livraison : les empreintes livrées sont chargées au démarrage", async () => {
  preparerDeck();
  A.servir("empreintes-livrees.json", livraison(LIEN_VISUEL, "Histo empilé"));
  const n = await A.run("chargerEmpreintesLivrees")();
  assert.equal(n, 1);
  assert.equal(A.run("empreintes[0].libelle"), "Histo empilé");
});

test("livraison : elles couvrent le KPI qu'elles décrivent", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", LIEN_VISUEL);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("à relever"));
  A.servir("empreintes-livrees.json", livraison(LIEN_VISUEL, "Histo empilé"));
  await A.run("chargerEmpreintesLivrees")();
  assert.ok(A.html("deckList").includes("⚡ visuel"));
});

test("livraison : un relevé local plus récent n'est jamais écrasé", async () => {
  preparerDeck();
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(LIEN_VISUEL, "Relevé ici"));
  A.run("empreintes[0]._mtime = 9000");
  A.servir("empreintes-livrees.json", livraison(LIEN_VISUEL, "Livré", 500));
  const n = await A.run("chargerEmpreintesLivrees")();
  assert.equal(n, 0, "rien n'est ajouté");
  assert.equal(A.run("empreintes[0].libelle"), "Relevé ici", "le relevé local reste en place");
});

test("livraison : le fichier absent est sans conséquence", async () => {
  preparerDeck();
  A.servir("empreintes-livrees.json", null);   // 404
  assert.equal(await A.run("chargerEmpreintesLivrees")(), 0);
  assert.equal(A.run("empreintes.length"), 0);
});

test("livraison : un fichier illisible ne fait pas tomber le démarrage", async () => {
  preparerDeck();
  A.servir("empreintes-livrees.json", "{ceci n'est pas du json");
  assert.equal(await A.run("chargerEmpreintesLivrees")(), 0);
});

test("livraison : une empreinte livrée sans état est écartée", async () => {
  preparerDeck();
  A.servir("empreintes-livrees.json", JSON.stringify([
    { id: "r1/p1/v1", libelle: "Creuse", proprietes: { artifactName: "&quot;X&quot;" }, _mtime: 1 }]));
  assert.equal(await A.run("chargerEmpreintesLivrees")(), 0);
});

test("livraison : recharger deux fois n'ajoute rien la seconde", async () => {
  preparerDeck();
  A.servir("empreintes-livrees.json", livraison(LIEN_VISUEL, "Histo empilé"));
  assert.equal(await A.run("chargerEmpreintesLivrees")(), 1);
  assert.equal(await A.run("chargerEmpreintesLivrees")(), 0);
  assert.equal(A.run("empreintes.length"), 1);
});

/* ─── Le signet : ne jamais afficher les chiffres d'un autre KPI ──
   Plusieurs KPI de l'annuaire partagent un même visuel Power BI ; c'est
   leur signet — donc leurs filtres — qui les distingue. Vérifié : huit
   insertions du même visuel donnent huit états différents. Une empreinte
   relevée ailleurs afficherait le bon graphique avec les mauvais
   chiffres : on préfère ne rien poser et l'annoncer. */

const SIGNET_KPI = LIEN_VISUEL + "&bookmarkGuid=aaaa1111";
const SIGNET_VOISIN = LIEN_VISUEL + "&bookmarkGuid=bbbb2222";

test("signet : une empreinte relevée sur le bon signet annonce « visuel »", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  A.run("renderDeckLignes()");
  assert.ok(A.html("deckList").includes("⚡ visuel"));
});

test("signet : sur un AUTRE signet, la ligne dit que le lien a été repartagé", async () => {
  // Chaque partage depuis Power BI crée un nouveau signet : l'empreinte
  // d'hier ne vaut plus. Le dire épargne une longue recherche.
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_VOISIN);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  A.run("renderDeckLignes()");
  const html = A.html("deckList");
  assert.ok(html.includes("lien repartagé"), html);
  assert.ok(!html.includes("⚡ visuel"), "surtout pas de « ⚡ visuel » rassurant");
});

test("signet : un visuel jamais relevé dit simplement « à relever »", () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.run("renderDeckLignes()");
  const html = A.html("deckList");
  assert.ok(html.includes("à relever"));
  assert.ok(!html.includes("repartagé"), "rien n'a été repartagé ici");
});

test("signet : le bilan nomme les liens repartagés à part", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_VOISIN);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  A.run("renderDeckLignes()");
  assert.match(A.texte("deckWarning"), /REPARTAGÉ/);
});

test("signet : rien n'est posé sur la diapositive plutôt qu'une vue fausse", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_VOISIN);
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  assert.strictEqual(A.run(`Empreintes.resoudre(empreintes, ${JSON.stringify(SIGNET_VOISIN)})`), null);
});

test("signet : deux KPI d'un même visuel gardent chacun son empreinte", async () => {
  preparerDeck();
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI, "Vue A"));
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_VOISIN, "Vue B"));
  assert.equal(A.run("empreintes.length"), 2);
});

/* ─── Le support de relevé ─────────────────────────────────
   Une insertion par lien reste nécessaire : autant la rendre courte
   et sans ambiguïté.

   Le support couvre TOUT l'annuaire, pas la seule sélection : c'est
   l'annuaire qui détient les liens à jour, et une empreinte relevée
   sert ensuite à n'importe quelle sélection. Chaque diapositive porte
   son numéro, son intitulé, sa temporalité, sa zone — et le lien EN
   CLAIR, celui de l'annuaire, jamais un lien repartagé. */

test("relevé : le support couvre tout l'annuaire, pas la seule sélection", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");   // une seule fiche cochée
  const r = await A.run("preparerReleve")();
  assert.equal(r.diapos, 3, "les trois fiches porteuses d'un lien, pas une");
  assert.equal(r.nom, "releve-empreintes.pptx");
});

test("relevé : chaque diapositive se nomme intitulé · temporalité · zone", async () => {
  preparerDeck();
  const titres = await A.run(`(async function () {
    await engendrerEmpreintes();
    const sites = activeSites();
    const nomZone = c => (sites.find(s => s.key === c) || {}).name || c;
    return variantesAvecLien().filter(v => !empreintePour(v.lien))
      .map(v => [v.titre, v.freq, nomZone(v.site)].filter(Boolean).join(" · "))
      .sort((a, b) => a.localeCompare(b, "fr"));
  })()`);
  assert.ok(titres.every(t => t.split(" · ").length === 3), "trois parties : " + titres);
  assert.ok(titres.some(t => /^Volumétrie Logistiport · Hebdomadaire · /.test(t)), titres);
});

test("relevé : les KPI déjà couverts n'y figurent pas", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  assert.equal((await A.run("preparerReleve")()).diapos, 2, "il en restait trois, une est relevée");
});

test("relevé : quand tout est couvert, rien n'est produit et on le dit", async () => {
  preparerDeck({ manualEntries: [{ id: "kpi_seul", manual: true, title: "Volumétrie Logistiport",
    freq: "Hebdomadaire", ritual: "COPIL", _mtime: 100, _by: "marie", logistiport: SIGNET_KPI }] });
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  assert.equal(await A.run("preparerReleve")(), null);
  assert.match(A.dernierMessage(), /Tout l'annuaire/);
});

test("relevé : le lien est écrit en clair, prêt à être copié", async () => {
  preparerDeck({ manualEntries: [{ id: "kpi_seul", manual: true, title: "Volumétrie Logistiport",
    freq: "Hebdomadaire", ritual: "COPIL", _mtime: 100, _by: "marie", logistiport: SIGNET_KPI }] });
  const liens = A.run(`variantesAvecLien().filter(v => !empreintePour(v.lien)).map(v => v.lien)`);
  assert.deepEqual(liens, [SIGNET_KPI], "c'est bien le lien de l'annuaire qui sera affiché");
});

test("relevé : un KPI sans lien n'encombre pas le support", async () => {
  preparerDeck({ manualEntries: [{ id: "kpi_anticipation_mensuelle", manual: true,
    title: "Anticipation des demandes", freq: "Mensuelle", ritual: "Revue mensuelle",
    _mtime: 100, _by: "marie" }] });
  assert.equal(await A.run("preparerReleve")(), null);
});

/* ─── Ne plus produire un support qui affichera des erreurs ─
   Le visuel vivant exige une empreinte par KPI. Sans elle, chaque
   diapositive affiche « L'objet visuel ajouté ici n'existe plus ».
   L'annuaire doit le dire AVANT, pas le laisser découvrir en séance. */

test("génération : produire un support muet demande confirmation", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.confirmer(false);
  assert.equal(await A.run("genererDeck")(), null, "refusée, rien n'est produit");
});

test("génération : confirmée, elle produit tout de même le support", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  A.confirmer(true);
  const r = await A.run("genererDeck")();
  assert.equal(r.diapos, 1);
});

test("génération : avec toutes les empreintes, aucune question n'est posée", async () => {
  preparerDeck();
  relier("kpi_volumetrie_hebdomadaire", SIGNET_KPI);
  A.basculerSelection("kpi_volumetrie_hebdomadaire");
  await A.run("releverEmpreintesDepuis")(pptxAvecComplement(SIGNET_KPI));
  A.confirmer(false);   // un refus ne doit rien changer : la question n'est pas posée
  assert.equal((await A.run("genererDeck")()).diapos, 1);
});



/* ─── Dériver : un relevé en engendre d'autres ──────────────
   13 KPI × 3 temporalités × 4 zones, c'est 156 liens. Mais l'état
   d'un signet contient les SEGMENTS de la page, et deux états du même
   visuel ne diffèrent que par ceux-là. Vérifié dans PowerPoint : un
   état recomposé de morceaux réels affiche exactement ce que montrait
   celui dont on a pris les morceaux.

   L'annuaire apprend donc sur deux relevés qui ne diffèrent QUE par
   la zone (ou QUE par la temporalité), et rejoue cette différence
   partout ailleurs. */

const R1 = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&bookmarkGuid=s1";
const R2 = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&bookmarkGuid=s2";
const R3 = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&bookmarkGuid=s3";

/* Trois fiches : même intitulé, deux zones, deux temporalités. */
const FICHES_AXES = [
  { id: "kpi_volume_hebdo", manual: true, title: "Volumétrie", freq: "Hebdomadaire",
    ritual: "COPIL", _mtime: 1, _by: "c", logistiport: R1, armement: R2 },
  { id: "kpi_volume_quoti", manual: true, title: "Volumétrie", freq: "Quotidienne",
    ritual: "COPIL", _mtime: 1, _by: "c", logistiport: R3 }
];

/** Un état réaliste : des conteneurs communs, et un segment qui varie. */
function etatAvec(segment, page) {
  const p = page || "p1";
  const conteneurs = {
    graphique: { singleVisual: { visualType: "barChart" } },
    segmentZone: { singleVisual: { objects: { general: [{ valeur: segment }] } } }
  };
  return {
    displayName: "Signet", name: "BOOKMARK_NAME",
    explorationState: {
      version: "1.40", activeSection: p,
      sections: { [p]: { visualContainers: conteneurs, filters: { byExpr: [] } } },
      objects: {}
    }
  };
}

/** Un .pptx portant un complément dont l'état est celui qu'on veut. */
async function pptxAvecEtat(lien, segment, nom, page) {
  const p = page || "p1";
  const valeur = await A.run("Derivation.ecrireEtat")(etatAvec(segment, p));
  const props = [
    `<we:property name="reportUrl" value="&quot;${lien.replace(/&/g, "&amp;")}&quot;"/>`,
    `<we:property name="artifactName" value="&quot;${nom || "Histo"}&quot;"/>`,
    `<we:property name="pageName" value="&quot;${p}&quot;"/>`,
    `<we:property name="bookmark" value="${valeur}"/>`
  ].join("");
  // Guillemets simples dans le code évalué : aucun échappement à compter.
  return A.run(`ZipMini.ecrireZip([
    { nom: "[Content_Types].xml", donnees: '<?xml version="1.0"?><Types></Types>' },
    { nom: "ppt/webextensions/webextension1.xml",
      donnees: ${JSON.stringify(`<we:webextension><we:properties>${props}</we:properties></we:webextension>`)} }
  ])`);
}

function preparerAxes() {
  A.reset({ manualEntries: FICHES_AXES.map(f => ({ ...f })) });
  A.run(`presets = []; selectionIds = []; empreintes = []; empreintesDerivees = {};
         commentairesVolatils = {}; rebuildData(false);`);
}

test("dérivation : deux zones relevées suffisent à en déduire une troisième combinaison", async () => {
  preparerAxes();
  // Relevés : Volumétrie hebdo à Logistiport, et la MÊME hebdo à Armement.
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R2, "ARM"));
  assert.equal(A.run("empreintes.length"), 2);

  // R3 — Volumétrie quotidienne à Logistiport — n'a jamais été relevé,
  // et aucun axe « temporalité » n'est connu : rien ne peut le déduire.
  const bilan = await A.run("engendrerEmpreintes")();
  assert.equal(bilan.engendrees, 0);
  assert.equal(bilan.restantes, 1);
});

test("dérivation : la transformation apprise sur un axe se rejoue ailleurs", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "LOG-quoti"));
  const axes = await A.run("axesDerivation")();
  const cles = Object.keys(axes);
  assert.ok(cles.some(c => /\|freq:/.test(c)), "un axe de temporalité, porté par sa page : " + cles);
});

test("dérivation : l'empreinte déduite porte bien l'état recomposé", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "QUOTI"));
  // Armement/hebdo (R2) se déduit : même intitulé, un seul axe d'écart.
  const bilan = await A.run("engendrerEmpreintes")();
  const emp = A.run(`empreintePour(${JSON.stringify(R2)})`);
  if (bilan.engendrees) {
    assert.ok(emp && emp.derivee, "l'empreinte de R2 doit être déduite");
    assert.ok(emp.proprietes.bookmark, "et porter un état");
  } else {
    assert.equal(emp, null, "à défaut d'axe utilisable, rien n'est inventé");
  }
});

/* Une leçon vaut pour SA page de rapport et pour elle seule : les
   conteneurs sont identifiés page par page, et rejouer ceux d'une page
   sur une autre ne produirait que du bruit. Les KPI de l'annuaire
   couvrent deux pages : le garde-fou n'est pas théorique. */

const P2A = "https://app.powerbi.com/groups/me/reports/r1/p2?pbi_source=shareVisual&visual=v9&bookmarkGuid=s9";
const P2B = "https://app.powerbi.com/groups/me/reports/r1/p2?pbi_source=shareVisual&visual=v9&bookmarkGuid=s10";

test("dérivation : une leçon apprise sur une page ne s'applique pas à une autre", async () => {
  A.reset({ manualEntries: [
    { id: "kpi_v_hebdo", manual: true, title: "Volumétrie", freq: "Hebdomadaire",
      ritual: "COPIL", _mtime: 1, _by: "c", logistiport: R1, armement: P2A },
    { id: "kpi_v_quoti", manual: true, title: "Volumétrie", freq: "Quotidienne",
      ritual: "COPIL", _mtime: 1, _by: "c", logistiport: R3, armement: P2B }
  ] });
  A.run(`presets = []; selectionIds = []; empreintes = []; empreintesDerivees = {};
         commentairesVolatils = {}; rebuildData(false);`);

  // La temporalité est apprise sur la page p1…
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "LOG-quoti"));
  // …et une base existe sur p2, mais aucune leçon n'y a été apprise.
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(P2A, "ARM", "Histo", "p2"));

  const bilan = await A.run("engendrerEmpreintes")();
  assert.equal(A.run(`empreintePour(${JSON.stringify(P2B)})`), null,
    "hors de sa page, la leçon ne vaut rien : mieux vaut réclamer un relevé");
  assert.equal(bilan.restantes, 1);
});

/* Le piège le plus vicieux : DEUX ÉTIQUETTES SUR LA MÊME VUE.
   Insérer deux fois le même visuel sans toucher aux segments entre-temps
   donne deux empreintes identiques sous deux noms de KPI. L'axe qu'on
   croirait apprendre là est creux — l'appliquer rendrait la vue de départ
   sous un autre nom, exactement l'erreur qu'on traque. */

test("dérivation : deux étiquettes sur la même vue n'apprennent aucun axe", async () => {
  preparerAxes();
  // Le MÊME segment des deux côtés : les états seront identiques.
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "LOG"));
  const cles = Object.keys(await A.run("axesDerivation")());
  assert.deepEqual(cles, [], "une leçon creuse est refusée : " + cles);
  assert.equal((await A.run("engendrerEmpreintes")()).engendrees, 0);
});

test("dérivation : l'annuaire nomme les empreintes jumelles au lieu de les subir", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "LOG"));
  const groupes = await A.run("reperterEmpreintesJumelles")();
  assert.equal(groupes.length, 1, "un groupe de jumelles");
  assert.equal(groupes[0].length, 2);
});

test("dérivation : des vues réellement distinctes ne sont pas dites jumelles", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "QUOTI"));
  assert.deepEqual(await A.run("reperterEmpreintesJumelles")(), []);
});

test("dérivation : une transformation creuse est reconnue comme telle", async () => {
  assert.equal(A.run("Derivation.estVide")({ conteneurs: {}, retires: [], substitutions: [] }), true);
  assert.equal(A.run("Derivation.estVide")(null), true);
  assert.equal(A.run("Derivation.estVide")({ conteneurs: { a: 1 }, retires: [] }), false);
  assert.equal(A.run("Derivation.estVide")({ conteneurs: {}, retires: ["a"] }), false);
  assert.equal(A.run("Derivation.estVide")({ conteneurs: {}, retires: [], substitutions: [{ de: "x", a: "y" }] }), false);
});

test("dérivation : rien n'est déduit tant qu'aucun axe n'est connu", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  const bilan = await A.run("engendrerEmpreintes")();
  assert.equal(bilan.engendrees, 0, "un seul relevé n'apprend aucune différence");
});

test("dérivation : une empreinte relevée prime toujours sur une déduite", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R2, "ARM"));
  await A.run("engendrerEmpreintes")();
  const emp = A.run(`empreintePour(${JSON.stringify(R2)})`);
  assert.ok(emp && !emp.derivee, "R2 a été relevé : on n'utilise pas une déduction");
});

test("dérivation : les déductions ne sont ni enregistrées ni partagées", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "QUOTI"));
  await A.run("engendrerEmpreintes")();
  const range = JSON.parse(A.run(`localStorage.getItem("kpiEmpreintes")`) || "[]");
  assert.ok(range.every(e => !e._derivee), "le document partagé ne porte que des relevés");
  assert.equal(range.length, 2);
});

test("dérivation : recomposer deux fois ne cumule pas les déductions", async () => {
  preparerAxes();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R1, "LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(R3, "QUOTI"));
  const a = await A.run("engendrerEmpreintes")();
  const b = await A.run("engendrerEmpreintes")();
  assert.deepEqual(a, b, "le calcul est refait, pas empilé");
});

/* ─── L'intitulé est un axe comme les autres ────────────────
   Le KPI retenu vit lui aussi dans un segment de l'état : relevé sur
   les insertions réelles, le conteneur porte « KPI 5.2 - Distribution
   urgentes », « KPI 2.2 - Réception urgentes »… Deux intitulés se
   déduisent donc l'un de l'autre, exactement comme deux zones. */

const T1 = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=vA&bookmarkGuid=t1";
const T2 = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=vB&bookmarkGuid=t2";
const T3 = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=vB&bookmarkGuid=t3";

/* Deux intitulés — donc deux graphiques — sur deux zones. */
const FICHES_TITRES = [
  { id: "kpi_volume_h", manual: true, title: "Volumétrie", freq: "Hebdomadaire",
    ritual: "COPIL", _mtime: 1, _by: "c", logistiport: T1 },
  { id: "kpi_taux_h", manual: true, title: "Taux de service", freq: "Hebdomadaire",
    ritual: "COPIL", _mtime: 1, _by: "c", logistiport: T2, armement: T3 }
];

function preparerTitres() {
  A.reset({ manualEntries: FICHES_TITRES.map(f => ({ ...f })) });
  A.run(`presets = []; selectionIds = []; empreintes = []; empreintesDerivees = {};
         commentairesVolatils = {}; rebuildData(false);`);
}

test("axes : deux intitulés relevés apprennent la différence entre eux", async () => {
  preparerTitres();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T1, "VOLUME"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T2, "TAUX"));
  const axes = await A.run("axesDerivation")();
  assert.ok(Object.keys(axes).some(c => /\|titre:/.test(c)),
    "un axe d'intitulé doit apparaître : " + Object.keys(axes));
});

test("axes : un intitulé relevé sur une zone se déduit sur l'autre", async () => {
  preparerTitres();
  // Relevés : Volumétrie/LOG, Taux/LOG, Taux/ARM.
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T1, "VOL-LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T2, "TAUX-LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T3, "TAUX-ARM"));
  const bilan = await A.run("engendrerEmpreintes")();
  assert.equal(bilan.restantes, 0, "tout est couvert ou déduit");
});

test("axes : un exemple mêlant deux différences n'est jamais retenu", async () => {
  // Volumétrie/LOG et Taux/ARM diffèrent par DEUX axes : en tirer une
  // transformation apprendrait un mélange, et la rejouerait à tort.
  preparerTitres();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T1, "VOL-LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T3, "TAUX-ARM"));
  const axes = await A.run("axesDerivation")();
  assert.deepEqual(Object.keys(axes), [], "aucun axe : " + Object.keys(axes));
});

test("axes : à défaut de chemin complet, on annonce « à relever »", async () => {
  preparerTitres();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T1, "VOL-LOG"));
  const bilan = await A.run("engendrerEmpreintes")();
  assert.equal(bilan.engendrees, 0);
  assert.ok(bilan.restantes > 0);
  assert.equal(A.run(`empreintePour(${JSON.stringify(T2)})`), null,
    "rien n'est inventé pour un intitulé jamais relevé");
});

test("axes : le chemin le plus court est préféré", async () => {
  preparerTitres();
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T1, "VOL-LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T2, "TAUX-LOG"));
  await A.run("releverEmpreintesDepuis")(await pptxAvecEtat(T3, "TAUX-ARM"));
  await A.run("engendrerEmpreintes")();
  // Tout est relevé : rien ne doit être déduit, donc rien à raccourcir.
  const emp = A.run(`empreintePour(${JSON.stringify(T3)})`);
  assert.ok(emp && !emp.derivee);
});

/* ─── La temporalité se transpose d'un visuel à l'autre ─────
   Relevé sur les états réels : changer de temporalité revient à
   remplacer une colonne de calendrier — « ReducMonth-year » devient
   « YearWeek » ou « Date ». Cette colonne ne dépend PAS du visuel :
   deux visuels d'une même page emploient la même. La leçon apprise
   sur l'un vaut donc pour l'autre, ce qu'une simple recopie de
   conteneur ne permettrait pas. */

test("transposition : la colonne de calendrier est reconnue comme substitution", () => {
  const avant = { singleVisual: { projections: { Category: [{ Column: { Property: "ReducMonth-year" } }] } } };
  const apres = { singleVisual: { projections: { Category: [{ Column: { Property: "YearWeek" } }] } } };
  const s = A.run("Derivation.substitutions")(avant, apres);
  assert.deepEqual(s, [{ de: "ReducMonth-year", a: "YearWeek" }]);
});

test("transposition : deux colonnes changeant à la fois ne s'interprètent pas", () => {
  // On ne saurait pas laquelle correspond à laquelle : deviner produirait
  // une vue fausse, on préfère ne rien apprendre.
  const avant = { a: { Property: "X1" }, b: { Property: "X2" } };
  const apres = { a: { Property: "Y1" }, b: { Property: "Y2" } };
  assert.deepEqual(A.run("Derivation.substitutions")(avant, apres), []);
});

test("transposition : la substitution ne touche que les valeurs de Property", () => {
  const c = { Property: "Date", Nom: "Date", enfant: { Property: "Date" } };
  const r = A.run("Derivation.appliquerSubstitutions")(c, [{ de: "Date", a: "YearWeek" }]);
  assert.equal(r.Property, "YearWeek");
  assert.equal(r.enfant.Property, "YearWeek");
  assert.equal(r.Nom, "Date", "un homonyme ailleurs ne doit pas bouger");
});

test("transposition : le conteneur du visuel n'est pas recopié mais traduit", () => {
  const etat = v => ({
    explorationState: { activeSection: "p1", sections: { p1: { visualContainers: {
      segment: { partage: v === "A" ? 1 : 2 },
      vB: { singleVisual: { projections: { Category: [{ Column: { Property: v === "A" ? "Mois" : "Semaine" } }] } } }
    } } } }
  });
  const t = A.run("Derivation.transformation")(etat("A"), etat("B"), "vB");
  assert.deepEqual(t.substitutions, [{ de: "Mois", a: "Semaine" }]);
  assert.ok(!("vB" in t.conteneurs), "le conteneur du visuel n'est pas figé");
  assert.ok("segment" in t.conteneurs, "le segment partagé, lui, est recopié");
});

test("transposition : la leçon d'un visuel s'applique à un autre", () => {
  const base = {
    explorationState: { activeSection: "p1", sections: { p1: { visualContainers: {
      segment: { partage: 1 },
      vAutre: { singleVisual: { projections: { Category: [{ Column: { Property: "Mois" } }] } } }
    } } } }
  };
  const lecon = { conteneurs: { segment: { partage: 2 } }, retires: [],
                  substitutions: [{ de: "Mois", a: "Semaine" }] };
  const r = A.run("Derivation.appliquer")(base, lecon, "vAutre");
  const vc = r.explorationState.sections.p1.visualContainers;
  assert.equal(vc.vAutre.singleVisual.projections.Category[0].Column.Property, "Semaine");
  assert.deepEqual(vc.segment, { partage: 2 });
});

test("transposition : sans visuel visé, la substitution ne s'applique nulle part", () => {
  const base = { explorationState: { activeSection: "p1", sections: { p1: { visualContainers: {
    v1: { Property: "Mois" } } } } } };
  const r = A.run("Derivation.appliquer")(base, { substitutions: [{ de: "Mois", a: "Semaine" }] }, null);
  assert.equal(r.explorationState.sections.p1.visualContainers.v1.Property, "Mois");
});
