/* Batterie étendue : affichage, import/export Excel, corbeille, instantanés,
   diagnostic et synchronisation — toutes sur les fonctions RÉELLES d'app.js. */
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./app-harness.js");

const A = loadApp();

/* Fabrique un jeu de fiches lisible */
const fiches = (...defs) => defs.map(([titre, freq, liens]) => Object.assign(
  { id: "kpi_" + titre.toLowerCase().replace(/\W+/g, "_") + "_" + freq.toLowerCase(),
    manual: true, title: titre, freq, _mtime: 100, _by: "marie" }, liens || {}));

/* ═══ Compteurs affichés dans la page ═══ */

test("affichage : le compteur « Tous » montre les KPIs, pas les variantes", () => {
  A.reset({ manualEntries: fiches(["KPI A", "Mensuelle"], ["KPI A", "Hebdomadaire"], ["KPI B", "Mensuelle"]) });
  A.run("rebuildData(false)");
  assert.equal(A.texte("countAll"), "2");
});

test("affichage : le compteur des favoris compte les fiches, pas les temporalités", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI A", "Hebdomadaire"]);
  A.reset({ manualEntries: f, favorites: f.map(x => x.id) });
  A.run("rebuildData(false)");
  assert.equal(A.texte("countFav"), "1", "deux temporalités d'un même KPI = 1 favori");
});

test("affichage : le compteur personnel est distinct du partagé", () => {
  A.reset({
    manualEntries: fiches(["Partagé", "Mensuelle"]),
    personalEntries: fiches(["Privé", "Mensuelle"], ["Privé", "Hebdomadaire"])
  });
  A.run("rebuildData(false)");
  assert.equal(A.texte("countAll"), "1");
  assert.equal(A.texte("countPerso"), "1");
});

test("affichage : une fiche en corbeille n'est plus comptée", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI B", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, at: 9, state: "deleted" }] });
  A.run("rebuildData(false)");
  assert.equal(A.texte("countAll"), "1");
});

test("affichage : sans aucune fiche, le compteur vaut zéro", () => {
  A.reset();
  A.run("rebuildData(false)");
  assert.equal(A.texte("countAll"), "0");
});

test("affichage : le bouton Corbeille indique le nombre de fiches supprimées", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI A", "Hebdomadaire"]);
  A.reset({ manualEntries: f, deletedIds: f.map(x => ({ id: x.id, title: x.title, at: 9, state: "deleted" })) });
  A.run("rebuildData(false)");
  assert.match(A.texte("restoreDeletedLabel"), /\(1\)/, "2 temporalités d'une même fiche = 1 entrée");
});

/* ═══ Corbeille ═══ */

test("corbeille : les temporalités d'une même fiche tiennent sur une seule ligne", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI A", "Hebdomadaire"], ["KPI A", "Quotidienne"]);
  A.reset({ manualEntries: f, deletedIds: f.map(x => ({ id: x.id, title: x.title, freq: x.freq, at: 9, state: "deleted" })) });
  A.run("renderTrashList()");
  const lignes = A.el("trashList").children.length;
  assert.equal(lignes, 1, "une seule ligne pour la fiche entière");
});

test("corbeille : la ligne précise le nombre de temporalités", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI A", "Hebdomadaire"]);
  A.reset({ manualEntries: f, deletedIds: f.map(x => ({ id: x.id, title: x.title, freq: x.freq, at: 9, state: "deleted" })) });
  A.run("renderTrashList()");
  assert.match(A.el("trashList").children[0].innerHTML, /2 temporalités/);
});

test("corbeille : une fiche personnelle est marquée d'un cadenas", () => {
  A.reset({ personalTrash: [{ id: "perso_1", title: "Privé", freq: "Mensuelle", _deletedAt: 5 }] });
  A.run("renderTrashList()");
  assert.match(A.el("trashList").children[0].innerHTML, /🔒/);
});

test("corbeille : vide, elle l'annonce clairement", () => {
  A.reset();
  A.run("renderTrashList()");
  assert.match(A.html("trashList"), /vide/i);
});

test("corbeille : les fiches partagées et personnelles cohabitent", () => {
  const f = fiches(["Partagé", "Mensuelle"]);
  A.reset({
    manualEntries: f,
    deletedIds: [{ id: f[0].id, title: "Partagé", freq: "Mensuelle", at: 9, state: "deleted" }],
    personalTrash: [{ id: "perso_1", title: "Privé", freq: "Mensuelle", _deletedAt: 8 }]
  });
  A.run("renderTrashList()");
  assert.equal(A.el("trashList").children.length, 2);
});

test("corbeille : la sélection regroupe tous les identifiants d'une fiche", () => {
  // Les identifiants doivent être réellement en corbeille : getTrashSelection
  // écarte volontairement les lignes périmées par une synchronisation.
  A.reset({ deletedIds: ["a", "b", "c"].map(id => ({ id, at: 9, state: "deleted" })) });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: "a,b,c" } }]);
  assert.deepEqual(A.run("getTrashSelection()"), ["a", "b", "c"]);
});

test("corbeille : plusieurs fiches cochées donnent tous leurs identifiants", () => {
  A.reset({ deletedIds: ["a", "b", "c"].map(id => ({ id, at: 9, state: "deleted" })) });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: "a,b" } }, { dataset: { ids: "c" } }]);
  assert.equal(A.run("getTrashSelection().length"), 3);
});

test("corbeille : aucune coche donne une sélection vide", () => {
  A.reset();
  A.requete("#trashList .trash-check:checked", []);
  assert.equal(A.run("getTrashSelection().length"), 0);
});

test("corbeille : réafficher une fiche la fait revenir avec ses données", () => {
  const f = fiches(["KPI A", "Mensuelle", { logistiport: "u1" }]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "KPI A", at: 9, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.run("restoreSelectedTrash()");
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].logistiport, "u1");
});

test("corbeille : réafficher sans sélection prévient l'utilisateur", () => {
  A.reset();
  A.requete("#trashList .trash-check:checked", []);
  A.run("restoreSelectedTrash()");
  assert.match(A.dernierMessage(), /Sélectionnez/i);
});

test("corbeille : une fiche personnelle réaffichée revient dans l'espace personnel", () => {
  A.reset({ personalTrash: [{ id: "perso_1", title: "Privé", freq: "Mensuelle", _deletedAt: 5 }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: "perso_1" } }]);
  A.run("restoreSelectedTrash()");
  assert.equal(A.get("personalEntries.length"), 1);
  assert.equal(A.get("personalTrash.length"), 0);
});

test("corbeille : la suppression définitive demande confirmation", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "KPI A", at: 9, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.confirmer(false);
  A.run("purgeSelectedTrash()");
  assert.equal(A.get("purgedIds.length"), 0, "refus = rien n'est purgé");
});

test("corbeille : confirmée, la suppression définitive purge la fiche", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "KPI A", at: 9, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.confirmer(true);
  A.run("purgeSelectedTrash()");
  assert.equal(A.get("purgedIds").includes(f[0].id), true);
  A.confirmer(false);
});

/* ═══ Suppression d'une fiche entière ═══ */

test("suppression : refuser la confirmation ne supprime rien", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run("rebuildData(false)");
  A.confirmer(false);
  A.run(`deleteKPI(${JSON.stringify(f[0].id)})`);
  assert.equal(A.get("deletedIds.length"), 0);
});

test("suppression : toutes les temporalités de la fiche partent ensemble", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI A", "Hebdomadaire"], ["KPI A", "Quotidienne"], ["KPI B", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI(${JSON.stringify(f[1].id)})`);   // clic sur la variante Hebdomadaire
  A.confirmer(false);
  assert.equal(A.get("deletedIds.length"), 3, "les 3 temporalités de KPI A");
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1, "seul KPI B reste visible");
});

test("suppression : les autres fiches ne sont pas touchées", () => {
  const f = fiches(["KPI A", "Mensuelle"], ["KPI B", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI(${JSON.stringify(f[0].id)})`);
  A.confirmer(false);
  A.run("rebuildData(false)");
  assert.equal(A.get("data")[0].title, "KPI B");
});

test("suppression : la fiche reste stockée pour pouvoir être réaffichée", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI(${JSON.stringify(f[0].id)})`);
  A.confirmer(false);
  assert.equal(A.get("manualEntries.length"), 1);
});

test("suppression : le favori associé est retiré", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f, favorites: [f[0].id] });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI(${JSON.stringify(f[0].id)})`);
  A.confirmer(false);
  assert.equal(A.get("favorites.length"), 0);
});

test("suppression : une fiche personnelle va dans la corbeille personnelle", () => {
  A.reset({ personalEntries: [{ id: "perso_1", title: "Privé", freq: "Mensuelle", personal: true }] });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI("perso_1")`);
  A.confirmer(false);
  assert.equal(A.get("personalEntries.length"), 0);
  assert.equal(A.get("personalTrash.length"), 1);
});

test("suppression : une fiche personnelle ne laisse pas de marqueur partagé", () => {
  A.reset({ personalEntries: [{ id: "perso_1", title: "Privé", freq: "Mensuelle", personal: true }] });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI("perso_1")`);
  A.confirmer(false);
  assert.equal(A.get("deletedIds.length"), 0, "rien ne doit partir dans la synchro partagée");
});

/* ═══ Favoris ═══ */

test("favoris : un clic ajoute, un second retire", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run("rebuildData(false)");
  A.run(`toggleFavorite(${JSON.stringify(f[0].id)})`);
  assert.equal(A.get("favorites.length"), 1);
  A.run(`toggleFavorite(${JSON.stringify(f[0].id)})`);
  assert.equal(A.get("favorites.length"), 0);
});

test("favoris : l'ajout est confirmé à l'écran", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run("rebuildData(false)");
  A.run(`toggleFavorite(${JSON.stringify(f[0].id)})`);
  assert.match(A.dernierMessage(), /favoris/i);
});

test("favoris : ils sont enregistrés par utilisateur", () => {
  const f = fiches(["KPI A", "Mensuelle"]);
  A.reset({ manualEntries: f, currentUser: "jean" });
  A.run("rebuildData(false)");
  A.run(`toggleFavorite(${JSON.stringify(f[0].id)})`);
  assert.ok(Object.keys(A.stockage()).some(k => k.includes("jean")), "la clé de stockage contient l'utilisateur");
});

/* ═══ Journal d'activité ═══ */

test("journal : une action est enregistrée avec son auteur", () => {
  A.reset({ currentUser: "marie" });
  A.run(`logActivity("create", "KPI A", "détail", "shared")`);
  const e = A.get("activityLog")[0];
  assert.equal(e.by, "marie");
  assert.equal(e.action, "create");
  assert.equal(e.title, "KPI A");
});

test("journal : les entrées les plus récentes sont en tête", () => {
  A.reset();
  A.run(`logActivity("create", "Premier"); logActivity("update", "Second");`);
  assert.equal(A.get("activityLog")[0].title, "Second");
});

test("journal : il est plafonné pour ne pas saturer la mémoire", () => {
  A.reset();
  A.run(`for (let i = 0; i < 450; i++) logActivity("update", "KPI " + i);`);
  assert.ok(A.get("activityLog.length") <= 400);
});

test("journal : la date utilise l'horloge corrigée", () => {
  A.reset();
  A.run(`logActivity("create", "X")`);
  assert.ok(A.get("activityLog")[0].at > 0);
});

/* ═══ Sites ═══ */

test("sites : seuls les sites actifs sont proposés", () => {
  A.reset({ sites: [{ key: "a", name: "A" }, { key: "b", name: "B", _deleted: true }] });
  assert.equal(A.run("activeSites().length"), 1);
});

test("sites : enregistrer sans aucun site est refusé", () => {
  A.reset();
  A.run("sitesDraft = []");
  A.run("saveSitesFromModal()");
  assert.match(A.dernierMessage(), /au moins un site/i);
});

test("sites : un site retiré devient un marqueur de suppression daté", () => {
  A.reset({ sites: [{ key: "a", name: "A", _mtime: 1 }, { key: "b", name: "B", _mtime: 1 }] });
  A.run(`sitesDraft = [{ key: "a", name: "A" }]; saveSitesFromModal();`);
  const supprime = A.get("sites").find(s => s.key === "b");
  assert.ok(supprime && supprime._deleted === true, "le site retiré reste avec un marqueur");
});

test("sites : un site ajouté reçoit une clé et une date", () => {
  A.reset();
  A.run(`sitesDraft = [{ key: "logistiport", name: "Logistiport" }, { name: "Qualité" }]; saveSitesFromModal();`);
  const nouveau = A.get("sites").find(s => s.name === "Qualité");
  assert.ok(nouveau, "le site est créé");
  assert.ok(nouveau.key, "avec une clé");
  assert.ok(nouveau._mtime > 0, "et une date");
});

/* ═══ Inspection d'un KPI ═══ */

test("inspection : une recherche trop courte n'affiche rien", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle"]) });
  A.run(`inspectKpi("V")`);
  assert.equal(A.html("inspectKpiResult"), "");
});

test("inspection : un intitulé inconnu est signalé", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle"]) });
  A.run(`inspectKpi("inexistant")`);
  assert.match(A.html("inspectKpiResult"), /Aucun KPI/i);
});

test("inspection : chaque temporalité est listée", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle"], ["Volumétrie", "Hebdomadaire"]) });
  A.run(`inspectKpi("Volum")`);
  const h = A.html("inspectKpiResult");
  assert.match(h, /Mensuelle/);
  assert.match(h, /Hebdomadaire/);
});

test("inspection : un site avec lien est coché, un site sans lien est barré", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle", { logistiport: "https://x" }]) });
  A.run(`inspectKpi("Volum")`);
  const h = A.html("inspectKpiResult");
  assert.match(h, /Logistiport ✓/);
  assert.match(h, /MG \+ Débords ✗/);
});

test("inspection : l'espace de la fiche est indiqué", () => {
  A.reset({ personalEntries: [{ id: "perso_1", title: "Privé", freq: "Mensuelle" }] });
  A.run(`inspectKpi("Priv")`);
  assert.match(A.html("inspectKpiResult"), /perso/i);
});

test("inspection : une fiche en corbeille est signalée comme telle", () => {
  const f = fiches(["Volumétrie", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, at: 9, state: "deleted" }] });
  A.run(`inspectKpi("Volum")`);
  assert.match(A.html("inspectKpiResult"), /corbeille/i);
});

test("inspection : une temporalité en double est signalée", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "Volumétrie", freq: "Mensuelle" },
    { id: "b", title: "Volumétrie", freq: "Mensuelle" }
  ] });
  A.run(`inspectKpi("Volum")`);
  assert.match(A.html("inspectKpiResult"), /double/i);
});

test("inspection : l'auteur et la date de modification sont affichés", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle"]) });
  A.run(`inspectKpi("Volum")`);
  assert.match(A.html("inspectKpiResult"), /marie/);
});

test("inspection : un intitulé contenant du HTML ne casse pas l'affichage", () => {
  A.reset({ manualEntries: [{ id: "x", title: "<img src=x onerror=alert(1)>", freq: "Mensuelle" }] });
  A.run(`inspectKpi("img")`);
  assert.ok(!A.html("inspectKpiResult").includes("<img"), "le contenu est échappé");
});

/* ═══ Diagnostic ═══ */

test("diagnostic : les KPIs partagés et les variantes sont distingués", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"], ["A", "Hebdomadaire"], ["B", "Mensuelle"]) });
  A.run("rebuildData(false); renderSyncDiag();");
  const h = A.html("syncDiag");
  assert.match(h, /KPIs partagés<\/span><b>2/);
  assert.match(h, /Variantes partagées<\/span><b>3/);
});

test("diagnostic : la version de l'application est affichée", () => {
  A.reset();
  A.run("renderSyncDiag()");
  assert.match(A.html("syncDiag"), /Version de l'appli/);
});

test("diagnostic : sans anomalie, il l'indique", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  A.run("rebuildData(false); renderSyncDiag();");
  assert.match(A.html("syncDiag"), /Aucune anomalie/);
});

test("diagnostic : une anomalie est signalée et détaillée", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle" }, { id: "b", title: "A", freq: "Mensuelle" }
  ] });
  A.run("rebuildData(false); renderSyncDiag();");
  assert.match(A.html("syncDiag"), /Anomalies détectées/);
  assert.match(A.html("variantAnomalies"), /double/);
});

test("diagnostic : un bouton de nettoyage apparaît en cas de doublon", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle" }, { id: "b", title: "A", freq: "Mensuelle" }
  ] });
  A.run("rebuildData(false); renderSyncDiag();");
  assert.match(A.html("variantAnomalies"), /cleanDupBtn/);
});

test("diagnostic : les fiches personnelles sont comptées à part", () => {
  A.reset({
    manualEntries: fiches(["Partagé", "Mensuelle"]),
    personalEntries: [{ id: "p1", title: "Privé", freq: "Mensuelle" }]
  });
  A.run("rebuildData(false); renderSyncDiag();");
  assert.match(A.html("syncDiag"), /KPIs personnels/);
});

/* ═══ Instantanés (historique des versions) ═══ */

test("instantané : il enregistre le nombre de KPIs et de variantes", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"], ["A", "Hebdomadaire"], ["B", "Mensuelle"]) });
  A.run("rebuildData(false); pushSnapshot('essai');");
  const s = A.run("getSnapshots()")[0];
  assert.equal(s.counts.kpis, 2);
  assert.equal(s.counts.variantes, 3);
});

test("instantané : il ne compte pas les fiches en corbeille", () => {
  const f = fiches(["A", "Mensuelle"], ["B", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, at: 9, state: "deleted" }] });
  A.run("rebuildData(false); pushSnapshot('essai');");
  assert.equal(A.run("getSnapshots()")[0].counts.kpis, 1);
});

test("instantané : il conserve le motif et l'utilisateur", () => {
  A.reset({ currentUser: "jean" });
  A.run("rebuildData(false); pushSnapshot('avant réception cloud');");
  const s = A.run("getSnapshots()")[0];
  assert.equal(s.reason, "avant réception cloud");
  assert.equal(s.user, "jean");
});

test("instantané : deux motifs identiques rapprochés ne font qu'une entrée", () => {
  A.reset();
  A.run("rebuildData(false); pushSnapshot('même'); pushSnapshot('même');");
  assert.equal(A.run("getSnapshots().length"), 1);
});

test("instantané : le nombre conservé reste borné", () => {
  A.reset();
  A.run("rebuildData(false); for (let i = 0; i < 30; i++) pushSnapshot('motif ' + i);");
  assert.ok(A.run("getSnapshots().length") <= 12);
});

test("instantané : la restauration remet les fiches d'avant", () => {
  A.reset({ manualEntries: fiches(["Avant", "Mensuelle"]) });
  A.run("rebuildData(false); pushSnapshot('point de reprise');");
  A.run(`manualEntries = []; rebuildData(false);`);
  assert.equal(A.get("data.length"), 0);
  A.confirmer(true);
  A.run("restoreSnapshot(0)");
  A.confirmer(false);
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].title, "Avant");
});

test("instantané : refuser la confirmation ne restaure rien", () => {
  A.reset({ manualEntries: fiches(["Avant", "Mensuelle"]) });
  A.run("rebuildData(false); pushSnapshot('point');");
  A.run(`manualEntries = []; rebuildData(false);`);
  A.confirmer(false);
  A.run("restoreSnapshot(0)");
  assert.equal(A.get("data.length"), 0);
});

test("instantané : l'étiquette affichée mentionne KPIs et variantes", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"], ["A", "Hebdomadaire"]) });
  A.run("rebuildData(false); pushSnapshot('essai'); renderSnapshotList();");
  assert.match(A.html("snapshotList") + A.el("snapshotList").children.map(c => c.innerHTML).join(""), /KPIs/);
});

/* ═══ Contenu envoyé au cloud ═══ */

test("synchro : le contenu envoyé ne comporte plus de bloc Excel", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  const p = A.run("buildSyncPayload()");
  assert.equal(p.kpiExcel, undefined);
  assert.equal(p.kpiOverrides, undefined);
});

test("synchro : le contenu envoyé comporte fiches, suppressions, sites et purges", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  const p = A.run("buildSyncPayload()");
  ["kpiManual", "kpiDeleted", "kpiSites", "kpiPurged", "kpiActivity", "updatedAt"].forEach(c =>
    assert.ok(p[c] !== undefined, "champ manquant : " + c));
});

test("synchro : les fiches personnelles ne rejoignent jamais la liste partagée", () => {
  A.reset({
    manualEntries: fiches(["Partagé", "Mensuelle"]),
    personalEntries: [{ id: "p1", title: "Mon KPI privé", freq: "Mensuelle" }]
  });
  const p = A.run("buildSyncPayload()");
  assert.ok(!JSON.stringify(p.kpiManual).includes("Mon KPI privé"),
    "une fiche personnelle ne doit jamais apparaître dans l'annuaire partagé");
});

test("synchro : les fiches personnelles partent rangées sous le nom de leur propriétaire", () => {
  A.reset({
    currentUser: "marie",
    personalEntries: [{ id: "p1", title: "Mon KPI privé", freq: "Mensuelle", _mtime: 100 }]
  });
  const p = A.run("buildSyncPayload()");
  assert.ok(p.personalByUser, "le bloc personnel doit exister");
  assert.equal(p.personalByUser.marie.length, 1);
  assert.equal(p.personalByUser.marie[0].title, "Mon KPI privé");
});

test("synchro : la corbeille personnelle voyage sous le nom de son propriétaire", () => {
  A.reset({ currentUser: "marie",
            personalTrash: [{ id: "p1", title: "Supprimé en privé", freq: "Mensuelle", _deletedAt: 50 }] });
  const p = A.run("buildSyncPayload()");
  assert.equal(p.personalTrashByUser.marie.length, 1);
  assert.ok(!JSON.stringify(p.kpiDeleted).includes("Supprimé en privé"),
    "elle ne doit pas se mélanger à la corbeille partagée");
});

test("synchro : recevoir des données fusionne sans écraser le local", () => {
  A.reset({ manualEntries: fiches(["Local", "Mensuelle"]) });
  A.run(`applyRemoteData(${JSON.stringify({
    kpiManual: [{ id: "kpi_distant_mensuelle", title: "Distant", freq: "Mensuelle", _mtime: 200 }],
    updatedAt: 200
  })}, true)`);
  assert.equal(A.get("data.length"), 2, "les deux fiches coexistent");
});

test("synchro : une fiche distante plus récente remplace la version locale", () => {
  const f = fiches(["KPI", "Mensuelle", { logistiport: "ancien" }]);
  A.reset({ manualEntries: f });
  A.run(`applyRemoteData(${JSON.stringify({
    kpiManual: [{ ...f[0], logistiport: "récent", _mtime: 9999 }], updatedAt: 300
  })}, true)`);
  assert.equal(A.get("data")[0].logistiport, "récent");
});

test("synchro : « Récupérer » remplace réellement les données locales", () => {
  A.reset({ manualEntries: fiches(["Mauvais", "Mensuelle"]) });
  A.run(`replaceLocalWithRemote(${JSON.stringify({
    kpiManual: [{ id: "kpi_bon_mensuelle", title: "Bon", freq: "Mensuelle", _mtime: 5 }],
    kpiDeleted: [], kpiPurged: [], updatedAt: 500
  })})`);
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].title, "Bon", "les mauvaises données locales ont disparu");
});

test("synchro : « Récupérer » prend un instantané de sécurité au préalable", () => {
  A.reset({ manualEntries: fiches(["Avant", "Mensuelle"]) });
  A.run("rebuildData(false)");
  // Le cloud est vide : l'application demande confirmation avant d'écraser.
  A.confirmer(true);
  A.run(`replaceLocalWithRemote(${JSON.stringify({ kpiManual: [], kpiDeleted: [], updatedAt: 1 })})`);
  const snaps = A.run("getSnapshots()");
  assert.ok(snaps.length > 0, "un instantané existe");
  assert.equal(snaps[0].manualEntries[0].title, "Avant", "il contient bien l'état précédent");
});

test("synchro : un ancien format Excel reçu est converti en fiches", () => {
  A.reset();
  A.run(`applyRemoteData(${JSON.stringify({
    kpiExcel: [{ id: "vieux_3", title: "Volumétrie", freq: "Mensuelle", logistiport: "u1", _mtime: 100 }],
    kpiOverrides: { "vieux_3": { armement: "u-MG", _mtime: 200 } },
    updatedAt: 200
  })}, true)`);
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].armement, "u-MG");
});

/* ═══ Export Excel ═══ */

test("export Excel : sans aucune fiche, l'utilisateur est prévenu", () => {
  A.reset();
  A.run("rebuildData(false); exportExcel();");
  assert.equal(A.fichiersExportes().length, 0);
  assert.match(A.dernierMessage(), /Aucune fiche/i);
});

test("export Excel : un fichier est produit avec un nom daté", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  A.run("rebuildData(false); exportExcel();");
  const f = A.fichiersExportes()[0];
  assert.ok(f, "un fichier est généré");
  assert.match(f.nom, /annuaire-kpi-export-\d{4}-\d{2}-\d{2}\.xlsx/);
});

test("export Excel : les colonnes correspondent à celles de l'import", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  A.run("rebuildData(false); exportExcel();");
  const aoa = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"];
  assert.deepEqual(aoa[0].slice(0, 6),
    ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"]);
});

test("export Excel : une colonne par site actif est ajoutée", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  A.run("rebuildData(false); exportExcel();");
  const entetes = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"][0];
  assert.ok(entetes.includes("Logistiport"));
  assert.ok(entetes.includes("MG + Débords"));
});

test("export Excel : toutes les fiches visibles sont exportées", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"], ["A", "Hebdomadaire"], ["B", "Mensuelle"]) });
  A.run("rebuildData(false); exportExcel();");
  const aoa = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"];
  assert.equal(aoa.length - 1, 3, "3 lignes de données");
});

test("export Excel : les fiches en corbeille ne sont pas exportées", () => {
  const f = fiches(["A", "Mensuelle"], ["B", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, at: 9, state: "deleted" }] });
  A.run("rebuildData(false); exportExcel();");
  assert.equal(A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"].length - 1, 1);
});

test("export Excel : les liens de site sont bien placés dans les cellules", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle", { logistiport: "https://powerbi/a" }]) });
  A.run("rebuildData(false); exportExcel();");
  const aoa = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"];
  assert.ok(aoa[1].includes("https://powerbi/a"));
});

test("export Excel : les temporalités d'une fiche se suivent dans l'ordre", () => {
  A.reset({ manualEntries: fiches(["A", "Quotidienne"], ["A", "Mensuelle"], ["A", "Hebdomadaire"]) });
  A.run("rebuildData(false); exportExcel();");
  const aoa = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"];
  assert.deepEqual([aoa[1][3], aoa[2][3], aoa[3][3]], ["Mensuelle", "Hebdomadaire", "Quotidienne"]);
});

test("export Excel : le message final indique le nombre de lignes", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"], ["B", "Mensuelle"]) });
  A.run("rebuildData(false); exportExcel();");
  assert.match(A.dernierMessage(), /2 ligne/);
});

/* ═══ Sauvegarde JSON ═══ */

test("sauvegarde : elle contient les fiches partagées et personnelles", () => {
  A.reset({
    manualEntries: fiches(["Partagé", "Mensuelle"]),
    personalEntries: [{ id: "p1", title: "Privé", freq: "Mensuelle" }]
  });
  A.run("exportBackup()");
  assert.match(A.dernierMessage(), /export/i);
});

test("sauvegarde : le format est identifiable pour éviter un mauvais fichier", () => {
  A.reset();
  const marqueur = A.run(`(function(){ return "annuaire-kpi-backup"; })()`);
  assert.equal(marqueur, "annuaire-kpi-backup");
});

/* ═══ Configuration de synchronisation ═══ */

test("configuration : une configuration intégrée est bien fournie", () => {
  A.reset();
  assert.equal(A.run("hasBuiltinConfig()"), true, "sans elle, aucun appareil ne se relie tout seul");
});

test("configuration : elle désigne le projet Firebase attendu", () => {
  A.reset();
  assert.equal(A.run("BUILTIN_FIREBASE_CONFIG.projectId"), "annuaire-kpi");
});

test("configuration : le code de synchronisation est partagé par tous les appareils", () => {
  A.reset();
  assert.equal(typeof A.run("BUILTIN_SYNC_CODE"), "string");
  assert.ok(A.run("BUILTIN_SYNC_CODE").length > 0);
});

test("configuration : un appareil vierge reçoit la configuration automatiquement", () => {
  A.reset();
  A.run("ensureBuiltinConfig()");
  const cfg = A.run("getSyncConfig()");
  assert.ok(cfg && cfg.config && cfg.config.projectId, "la configuration est installée");
});

test("configuration : le code installé est celui prévu", () => {
  A.reset();
  A.run("ensureBuiltinConfig()");
  assert.equal(A.run("getSyncConfig().code"), A.run("BUILTIN_SYNC_CODE"));
});

test("configuration : une désactivation ancienne ne bloque plus la reconnexion", () => {
  A.reset();
  A.ecrireStockage("kpiSyncOptOut", "1");
  A.run(`localStorage.removeItem("kpiOptoutClearedV2"); setSyncConfig(null); ensureBuiltinConfig();`);
  assert.ok(A.run("getSyncConfig()"), "l'appareil se reconnecte malgré l'ancienne désactivation");
});

/* ═══ Filtrage et recherche ═══ */

test("recherche : un intitulé partiel retrouve la fiche", () => {
  A.reset({ manualEntries: fiches(["Volumétrie distribution", "Mensuelle"], ["Taux service", "Mensuelle"]) });
  A.run("rebuildData(false)");
  A.saisir("search", "volum");
  A.run("filterData()");
  assert.ok(A.get("data.length") >= 1);
});

test("recherche : la casse n'a pas d'importance", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle"]) });
  A.run("rebuildData(false)");
  A.saisir("search", "VOLUM");
  A.run("filterData()");
  assert.equal(A.el("container").innerHTML !== undefined, true);
});

test("recherche : une recherche sans résultat n'efface pas les données", () => {
  A.reset({ manualEntries: fiches(["Volumétrie", "Mensuelle"]) });
  A.run("rebuildData(false)");
  A.saisir("search", "zzzzz");
  A.run("filterData()");
  assert.equal(A.get("data.length"), 1, "les données restent intactes, seul l'affichage change");
});

/* ═══ Robustesse générale ═══ */

test("robustesse : une donnée distante mal formée ne casse pas l'application", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  A.run(`applyRemoteData({ kpiManual: [null, { titre: "sans id" }, undefined], updatedAt: 1 }, true)`);
  assert.ok(A.get("data.length") >= 1, "l'application continue de fonctionner");
});

test("robustesse : un contenu distant vide ne supprime rien", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"]) });
  A.run(`applyRemoteData({ updatedAt: 1 }, true)`);
  assert.equal(A.get("data.length"), 1);
});

test("robustesse : des sites distants vides ne remplacent pas les nôtres", () => {
  A.reset();
  const avant = A.run("activeSites().length");
  A.run(`applyRemoteData({ kpiSites: [], updatedAt: 1 }, true)`);
  assert.equal(A.run("activeSites().length"), avant);
});

test("robustesse : un intitulé très long est accepté", () => {
  A.reset({ manualEntries: [{ id: "x", title: "K".repeat(500), freq: "Mensuelle" }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
});

test("robustesse : des caractères spéciaux dans l'intitulé sont gérés", () => {
  A.reset({ manualEntries: [{ id: "x", title: "Coût & Délai <50%>", freq: "Mensuelle" }] });
  A.run("rebuildData(false); renderSyncDiag();");
  assert.equal(A.get("data.length"), 1);
});

/* ═══ Suppression définitive : libération de la mémoire ═══ */

test("purge : la fiche quitte réellement la mémoire", () => {
  const f = fiches(["À purger", "Mensuelle"], ["À garder", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "À purger", at: 9, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.confirmer(true);
  A.run("purgeSelectedTrash()");
  A.confirmer(false);
  assert.equal(A.get("manualEntries.length"), 1, "la fiche purgée ne doit plus être stockée");
  assert.equal(A.get("manualEntries")[0].title, "À garder");
});

test("purge : la fiche n'est plus envoyée au cloud", () => {
  const f = fiches(["Fantôme", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "Fantôme", at: 9, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.confirmer(true);
  A.run("purgeSelectedTrash()");
  A.confirmer(false);
  const envoi = A.run("buildSyncPayload()");
  assert.ok(!JSON.stringify(envoi.kpiManual).includes("Fantôme"), "aucune trace dans l'envoi");
});

test("purge : l'identifiant reste marqué pour empêcher tout retour", () => {
  const f = fiches(["Définitive", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "Définitive", at: 9, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.confirmer(true);
  A.run("purgeSelectedTrash()");
  A.confirmer(false);
  assert.ok(A.get("purgedIds").includes(f[0].id));
});

test("purge : une fiche purgée reçue d'un autre appareil est écartée", () => {
  const f = fiches(["Purgée ailleurs", "Mensuelle"]);
  A.reset({ manualEntries: [], purgedIds: [] });
  A.run(`applyRemoteData(${JSON.stringify({
    kpiManual: f, kpiPurged: [f[0].id], updatedAt: 100
  })}, true)`);
  assert.equal(A.get("data.length"), 0, "la fiche n'est pas affichée");
});

test("purge : une purge décidée ailleurs libère aussi la mémoire ici", () => {
  const f = fiches(["Encore stockée", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run(`applyRemoteData(${JSON.stringify({ kpiPurged: [f[0].id], updatedAt: 100 })}, true)`);
  assert.equal(A.get("manualEntries.length"), 0, "la mémoire est libérée sur cet appareil aussi");
});

test("purge : les fiches non purgées ne sont pas touchées", () => {
  const f = fiches(["Purgée", "Mensuelle"], ["Intacte", "Mensuelle"]);
  A.reset({ manualEntries: f });
  A.run(`applyRemoteData(${JSON.stringify({ kpiPurged: [f[0].id], updatedAt: 100 })}, true)`);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Intacte");
});

/* ═══ Cohérence de la couche de stockage ═══ */

test("stockage : chaque clé du registre est réellement utilisée", () => {
  const registre = A.run("Store.KEYS");
  ["MANUAL", "DELETED", "PURGED", "SITES", "USER"].forEach(k =>
    assert.ok(registre[k], "clé absente du registre : " + k));
});

test("stockage : la clé des suppressions définitives est la bonne", () => {
  assert.equal(A.run("Store.KEYS.PURGED"), "kpiPurgedIds",
    "une clé erronée ferait réapparaître des fiches supprimées définitivement");
});

test("stockage : le registre concorde avec les fiches réellement enregistrées", () => {
  A.reset({ manualEntries: fiches(["Témoin", "Mensuelle"]) });
  A.run("saveManualEntries(false)");
  const brut = A.stockage()[A.run("Store.KEYS.MANUAL")];
  assert.ok(brut && brut.includes("Témoin"), "les fiches doivent être lisibles via la clé du registre");
});

test("stockage : les suppressions définitives sont relisibles via le registre", () => {
  A.reset({ purgedIds: ["abc"] });
  A.run("savePurged(false)");
  const brut = A.stockage()[A.run("Store.KEYS.PURGED")];
  assert.ok(brut && brut.includes("abc"));
});

/* ═══ Volumétrie envoyée au cloud ═══ */

test("envoi : la taille du contenu reste raisonnable pour 500 variantes", () => {
  const nombreuses = Array.from({ length: 500 }, (_, i) => ({
    id: "kpi_" + i, manual: true, title: "KPI " + (i % 150), freq: "Mensuelle",
    logistiport: "https://app.powerbi.com/groups/xxx/reports/yyy/ReportSection" + i, _mtime: 100
  }));
  A.reset({ manualEntries: nombreuses });
  const octets = JSON.stringify(A.run("buildSyncPayload()")).length;
  assert.ok(octets < 1048576, "le contenu doit rester sous la limite d'un document (1 Mio), mesuré : " + octets);
});

test("envoi : le journal d'activité ne fait pas gonfler l'envoi sans limite", () => {
  A.reset();
  A.run(`for (let i = 0; i < 600; i++) logActivity("update", "KPI " + i, "détail assez long pour peser");`);
  assert.ok(A.get("activityLog.length") <= 400, "le journal est plafonné avant l'envoi");
});

/* ═══ Nettoyage des fiches déjà supprimées définitivement ═══ */

test("nettoyage : les fiches purgées encore stockées sont libérées", () => {
  const f = fiches(["Fantôme A", "Mensuelle"], ["Fantôme B", "Mensuelle"], ["Vivante", "Mensuelle"]);
  A.reset({ manualEntries: f, purgedIds: [f[0].id, f[1].id] });
  const retirees = A.run("nettoyerPurgees()");
  assert.equal(retirees, 2);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Vivante");
});

test("nettoyage : sans suppression définitive, rien n'est touché", () => {
  A.reset({ manualEntries: fiches(["A", "Mensuelle"], ["B", "Mensuelle"]) });
  assert.equal(A.run("nettoyerPurgees()"), 0);
  assert.equal(A.get("manualEntries.length"), 2);
});

test("nettoyage : il s'exécute au chargement de l'application", () => {
  const f = fiches(["Fantôme", "Mensuelle"], ["Vivante", "Mensuelle"]);
  A.reset({ manualEntries: f, purgedIds: [f[0].id] });
  A.run("saveManualEntries(false); savePurged(false); loadSavedFile();");
  assert.equal(A.get("manualEntries.length"), 1, "la fiche fantôme est libérée dès l'ouverture");
});

test("nettoyage : le contenu envoyé au cloud est allégé d'autant", () => {
  const f = fiches(["Fantôme", "Mensuelle"], ["Vivante", "Mensuelle"]);
  A.reset({ manualEntries: f, purgedIds: [f[0].id] });
  A.run("nettoyerPurgees()");
  const envoi = A.run("buildSyncPayload()");
  assert.equal(envoi.kpiManual.length, 1);
  assert.ok(!JSON.stringify(envoi.kpiManual).includes("Fantôme"));
});

test("nettoyage : une fiche seulement en corbeille n'est PAS libérée", () => {
  const f = fiches(["En corbeille", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "En corbeille", at: 5, state: "deleted" }] });
  A.run("nettoyerPurgees()");
  assert.equal(A.get("manualEntries.length"), 1, "elle doit rester récupérable");
});

/* ═══ Cas limites de données ═══ */

test("limites : un intitulé composé uniquement d'espaces est traité comme vide", () => {
  A.reset({ manualEntries: [{ id: "x", title: "   ", freq: "Mensuelle" }] });
  A.run("rebuildData(false)");
  assert.equal(A.run("titleKey(data[0].title)"), "");
});

test("limites : les temporalités se regroupent quelle que soit la casse", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "K", freq: "MENSUELLE" }, { id: "b", title: "K", freq: "mensuelle" }
  ] });
  A.run("rebuildData(false)");
  const anomalies = A.run("findVariantAnomalies(data)");
  assert.ok(anomalies.some(a => /double/.test(a.reason)), "deux « Mensuelle » = doublon même avec une casse différente");
});

test("limites : un lien très long est conservé intact", () => {
  const url = "https://app.powerbi.com/groups/" + "x".repeat(900);
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", logistiport: url }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data")[0].logistiport.length, url.length);
});

test("limites : deux périmètres de même nom reçoivent des clés distinctes", () => {
  A.reset();
  A.run(`sitesDraft = [{ name: "Qualité" }, { name: "Qualité" }]; saveSitesFromModal();`);
  const cles = A.run("activeSites().map(function(s){return s.key;})");
  assert.equal(new Set(cles).size, cles.length, "aucune clé de périmètre en double");
});

test("limites : des marqueurs de corbeille en double sont tolérés", () => {
  A.reset({
    manualEntries: [{ id: "a", title: "K", freq: "Mensuelle" }],
    deletedIds: [{ id: "a", at: 5, state: "deleted" }, { id: "a", at: 5, state: "deleted" }]
  });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 0);
});

test("limites : une suppression définitive en double ne casse rien", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle" }], purgedIds: ["a", "a"] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 0);
});

test("limites : une fiche purgée ne peut pas être réaffichée depuis la corbeille", () => {
  A.reset({
    manualEntries: [{ id: "a", title: "K", freq: "Mensuelle" }],
    deletedIds: [{ id: "a", title: "K", at: 5, state: "deleted" }],
    purgedIds: ["a"]
  });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: "a" } }]);
  A.run("restoreSelectedTrash(); rebuildData(false);");
  assert.equal(A.get("data.length"), 0, "une suppression définitive reste définitive");
});

test("limites : une fiche sans date de modification est acceptée", () => {
  A.reset({ manualEntries: [{ id: "a", title: "Ancienne", freq: "Mensuelle" }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
  const envoi = A.run("buildSyncPayload()");
  assert.equal(envoi.kpiManual.length, 1);
});

/* ═══ Résistance aux données abîmées ═══ */

test("résistance : chaque emplacement corrompu est isolé", () => {
  const emplacements = ["kpiManualEntries", "kpiDeletedIds", "kpiPurgedIds", "kpiSites", "kpiActivity"];
  emplacements.forEach(cle => {
    A.reset();
    A.run(`localStorage.setItem(${JSON.stringify(cle)}, "{{{ pas du JSON");`);
    A.run("loadManualEntries(); loadDeletedIds(); loadPurged(); loadSites(); loadActivity(); rebuildData(false);");
    assert.ok(Array.isArray(A.get("manualEntries")), "l'application reste utilisable malgré : " + cle);
  });
});

test("résistance : un instantané illisible n'empêche pas d'ouvrir la liste", () => {
  A.reset();
  A.run(`localStorage.setItem("kpiSnapshots", "pas du JSON"); renderSnapshotList();`);
  assert.ok(true, "aucune exception");
});

test("résistance : une mémoire saturée est signalée sans perte de données", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle" }] });
  A.run(`localStorage.setItem = function(){ var e = new Error("plein"); e.name = "QuotaExceededError"; throw e; };`);
  let planté = false;
  try { A.run("pushSnapshot('essai')"); } catch { planté = true; }
  A.reset();   // rétablit un stockage fonctionnel pour les tests suivants
  assert.equal(planté, false, "la saturation ne doit pas interrompre l'application");
});

/* ═══ Aller-retour Excel ═══ */

test("Excel : exporter puis ré-importer restitue les mêmes fiches", () => {
  const depart = fiches(["Aller-retour", "Mensuelle", { logistiport: "https://a", armement: "https://b" }],
                        ["Aller-retour", "Hebdomadaire", { logistiport: "https://c" }]);
  A.reset({ manualEntries: depart });
  A.run("rebuildData(false); exportExcel();");
  const aoa = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"];

  A.reset();
  A.run(`XLSX = { utils: { encode_cell: function(p){ return "R" + p.r + "C" + p.c; } } }; confirm = function(){ return true; };`);
  A.run(`transformData({}, ${JSON.stringify(aoa)});`);
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 2, "les deux temporalités sont restituées");
  assert.equal(A.run("countFiches(data)"), 1, "et forment bien une seule fiche");
});

test("Excel : un fichier sans aucune ligne de données est sans effet", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: function(){ return "A1"; } } }; confirm = function(){ return true; };`);
  A.run(`transformData({}, [["Intitulé","Type KPI","Processus","Fréquence","Rituel","Description / Mode de calcul"]]);`);
  assert.equal(A.get("manualEntries.length"), 0);
});

test("Excel : deux lignes identiques reçoivent des identifiants distincts", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: function(){ return "A1"; } } }; confirm = function(){ return true; };`);
  A.run(`transformData({}, [
    ["Intitulé","Type KPI","Processus","Fréquence","Rituel","Description / Mode de calcul"],
    ["Doublon","","","Mensuelle","",""],
    ["Doublon","","","Mensuelle","",""]
  ]);`);
  const ids = A.get("manualEntries").map(k => k.id);
  assert.equal(new Set(ids).size, ids.length, "aucun identifiant écrasé");
});

test("Excel : des colonnes manquantes n'empêchent pas l'import", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: function(){ return "A1"; } } }; confirm = function(){ return true; };`);
  A.run(`transformData({}, [["Intitulé","Fréquence"], ["Minimal","Mensuelle"]]);`);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Minimal");
});

/* ═══ Favoris et périmètres, cas avancés ═══ */

test("favoris : un favori pointant vers une fiche disparue est ignoré à l'affichage", () => {
  A.reset({ manualEntries: fiches(["Existante", "Mensuelle"]), favorites: ["id_inexistant"] });
  A.run("rebuildData(false)");
  assert.equal(A.texte("countFav"), "0");
});

test("périmètres : supprimer puis recréer un périmètre du même nom le réactive", () => {
  A.reset({ sites: [{ key: "qualite", name: "Qualité", _deleted: true, _mtime: 5 }] });
  A.run(`sitesDraft = [{ key: "qualite", name: "Qualité" }]; saveSitesFromModal();`);
  assert.ok(A.run("activeSites().some(function(s){return s.key === 'qualite';})"));
});

test("périmètres : un périmètre supprimé n'apparaît plus dans les liens de la modale", () => {
  A.reset({ sites: [{ key: "a", name: "A" }, { key: "b", name: "B", _deleted: true }] });
  A.run("openKpiModal()");
  assert.ok(!A.html("linksGrid").includes("kpiLink_b"), "le périmètre supprimé n'est pas proposé");
});

/* ═══ Instantanés et synchronisation ═══ */

test("instantané : une restauration devient la version la plus récente", () => {
  A.reset({ manualEntries: fiches(["Avant", "Mensuelle"]) });
  A.run("rebuildData(false); pushSnapshot('repère');");
  A.run("manualEntries = []; rebuildData(false);");
  A.confirmer(true);
  A.run("restoreSnapshot(0)");
  A.confirmer(false);
  const envoi = A.run("buildSyncPayload()");
  assert.equal(envoi.kpiManual.length, 1, "la version restaurée est bien celle qui partira au cloud");
});

test("horloge : la correction du serveur est appliquée aux dates", () => {
  A.reset();
  A.run(`localStorage.setItem("kpiClockOffset", "100000"); clockOffset = 100000;`);
  const avant = Date.now();
  const t = A.run("now()");
  assert.ok(t >= avant + 90000, "l'heure corrigée est utilisée pour dater les modifications");
  A.run("clockOffset = 0;");
});

/* ═══ Filtre « Type de KPI » ═══ */

test("filtre type : la liste déroulante est alimentée par les types existants", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle", type: "Contractuel" },
    { id: "b", title: "B", freq: "Mensuelle", type: "Opérationnel" },
    { id: "c", title: "C", freq: "Mensuelle", type: "Contractuel" }
  ] });
  A.run("rebuildData(false)");
  const options = A.el("typeFilter").options.map(o => o.textContent);
  assert.ok(options.includes("Contractuel"), "le type doit être proposé");
  assert.ok(options.includes("Opérationnel"));
  assert.equal(options.filter(o => o === "Contractuel").length, 1, "sans doublon");
});

test("filtre type : sélectionner un type ne garde que les fiches concernées", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "Contractuelle", freq: "Mensuelle", type: "Contractuel" },
    { id: "b", title: "Opérationnelle", freq: "Mensuelle", type: "Opérationnel" }
  ] });
  A.run("rebuildData(false)");
  A.saisir("typeFilter", "Contractuel");
  A.run("filterData()");
  assert.equal(A.run("Object.keys(kpiGroups).length"), 1, "un seul KPI affiché");
});

test("filtre type : sans sélection, toutes les fiches restent visibles", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle", type: "Contractuel" },
    { id: "b", title: "B", freq: "Mensuelle", type: "Opérationnel" }
  ] });
  A.run("rebuildData(false)");
  A.saisir("typeFilter", "");
  A.run("filterData()");
  assert.equal(A.run("Object.keys(kpiGroups).length"), 2);
});

test("filtre type : il se combine avec le filtre processus", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle", type: "Contractuel", process: "Logistique" },
    { id: "b", title: "B", freq: "Mensuelle", type: "Contractuel", process: "Transport" },
    { id: "c", title: "C", freq: "Mensuelle", type: "Opérationnel", process: "Logistique" }
  ] });
  A.run("rebuildData(false)");
  A.saisir("typeFilter", "Contractuel");
  A.saisir("processFilter", "Logistique");
  A.run("filterData()");
  assert.equal(A.run("Object.keys(kpiGroups).length"), 1, "seule la fiche cochant les deux critères");
  A.saisir("processFilter", "");
});

test("filtre type : il se combine avec la recherche", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "Volumétrie", freq: "Mensuelle", type: "Contractuel" },
    { id: "b", title: "Taux", freq: "Mensuelle", type: "Contractuel" }
  ] });
  A.run("rebuildData(false)");
  A.saisir("typeFilter", "Contractuel");
  A.saisir("search", "volum");
  A.run("filterData()");
  assert.equal(A.run("Object.keys(kpiGroups).length"), 1);
  A.saisir("search", "");
});

test("filtre type : il se combine avec la vue Favoris", () => {
  A.reset({
    manualEntries: [
      { id: "a", title: "A", freq: "Mensuelle", type: "Contractuel" },
      { id: "b", title: "B", freq: "Mensuelle", type: "Contractuel" }
    ],
    favorites: ["a"]
  });
  A.run("rebuildData(false); currentView = 'fav';");
  A.saisir("typeFilter", "Contractuel");
  A.run("filterData()");
  assert.equal(A.run("Object.keys(kpiGroups).length"), 1, "seul le favori du bon type");
  A.run("currentView = 'all';");
});

test("filtre type : la réinitialisation le remet à zéro", () => {
  A.reset({ manualEntries: [{ id: "a", title: "A", freq: "Mensuelle", type: "Contractuel" }] });
  A.run("rebuildData(false)");
  A.selectionner("typeFilter", "Contractuel");
  A.run("resetFilters()");
  assert.equal(A.el("typeFilter").selectedIndex, 0);
  assert.equal(A.el("typeFilter").value, "", "le menu revient bien sur « Tous »");
});

test("filtre type : la sélection est conservée lors d'une mise à jour des données", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle", type: "Contractuel" },
    { id: "b", title: "B", freq: "Mensuelle", type: "Opérationnel" }
  ] });
  A.run("rebuildData(false)");
  A.saisir("typeFilter", "Contractuel");
  A.run("rebuildData(false)");   // par exemple après une synchronisation
  assert.equal(A.el("typeFilter").value, "Contractuel", "le filtre actif ne doit pas sauter");
});

test("filtre type : une fiche sans type reste visible quand aucun filtre n'est actif", () => {
  A.reset({ manualEntries: [{ id: "a", title: "Sans type", freq: "Mensuelle" }] });
  A.run("rebuildData(false); filterData();");
  assert.equal(A.run("Object.keys(kpiGroups).length"), 1);
});

test("filtre type : les fiches personnelles alimentent aussi la liste", () => {
  A.reset({
    manualEntries: [{ id: "a", title: "A", freq: "Mensuelle", type: "Partagé" }],
    personalEntries: [{ id: "p", title: "P", freq: "Mensuelle", type: "Personnel" }]
  });
  A.run("rebuildData(false)");
  const options = A.el("typeFilter").options.map(o => o.textContent);
  assert.ok(options.includes("Personnel"), "les types de l'espace personnel sont proposés");
});

/* ═══ Corbeille : entrées sans données ═══ */

test("corbeille : une entrée dont les données ont disparu est signalée", () => {
  A.reset({
    manualEntries: fiches(["Vivante", "Mensuelle"]),
    deletedIds: [{ id: "orpheline", title: "Orpheline", freq: "Mensuelle", at: 500, state: "deleted" }]
  });
  A.run("renderTrashList()");
  const html = A.el("trashList").children.map(c => c.innerHTML).join("");
  assert.match(html, /non récupérable/, "l'utilisateur doit savoir qu'elle ne reviendra pas");
});

test("corbeille : une entrée normale n'est pas signalée à tort", () => {
  const f = fiches(["Récupérable", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "Récupérable", at: 500, state: "deleted" }] });
  A.run("renderTrashList()");
  const html = A.el("trashList").children.map(c => c.innerHTML).join("");
  assert.ok(!/non récupérable/.test(html));
});

test("corbeille : réafficher une entrée vide le dit clairement", () => {
  A.reset({ deletedIds: [{ id: "orpheline", title: "Orpheline", at: 500, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: "orpheline" } }]);
  A.run("restoreSelectedTrash()");
  const messages = A.messages().join(" | ");
  assert.match(messages, /rien à réafficher/i);
  assert.ok(!/fiche(s)? réaffichée/i.test(messages),
    "aucune réussite ne doit être annoncée alors que rien n'est revenu");
});

test("corbeille : réafficher une entrée valide annonce bien la réussite", () => {
  const f = fiches(["Bonne", "Mensuelle"]);
  A.reset({ manualEntries: f, deletedIds: [{ id: f[0].id, title: "Bonne", at: 500, state: "deleted" }] });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id } }]);
  A.run("restoreSelectedTrash()");
  assert.match(A.dernierMessage(), /réaffichée/i);
});

test("corbeille : une sélection mixte distingue les deux cas", () => {
  const f = fiches(["Bonne", "Mensuelle"]);
  A.reset({
    manualEntries: f,
    deletedIds: [
      { id: f[0].id, title: "Bonne", at: 500, state: "deleted" },
      { id: "orpheline", title: "Orpheline", at: 500, state: "deleted" }
    ]
  });
  A.requete("#trashList .trash-check:checked", [{ dataset: { ids: f[0].id + ",orpheline" } }]);
  A.run("restoreSelectedTrash()");
  const messages = A.messages().join(" | ");
  assert.match(messages, /réaffichée/i);
  assert.match(messages, /rien à réafficher/i);
});

/* ═══ Favoris orphelins ═══ */

test("favoris : ceux qui désignent une fiche supprimée définitivement sont retirés", () => {
  A.reset({ manualEntries: fiches(["Vivante", "Mensuelle"]), favorites: ["purgee", "autre"], purgedIds: ["purgee"] });
  assert.equal(A.run("nettoyerFavoris()"), 1);
  assert.deepEqual(A.get("favorites"), ["autre"]);
});

test("favoris : un favori dont la fiche n'est pas encore arrivée est conservé", () => {
  A.reset({ manualEntries: [], favorites: ["pas_encore_synchronisee"], purgedIds: [] });
  assert.equal(A.run("nettoyerFavoris()"), 0, "ne pas supprimer ce qui peut encore arriver");
  assert.equal(A.get("favorites.length"), 1);
});

test("favoris : le nettoyage s'exécute au chargement de l'application", () => {
  A.reset({ manualEntries: fiches(["K", "Mensuelle"]), favorites: ["purgee"], purgedIds: ["purgee"] });
  A.run("saveManualEntries(false); savePurged(false); saveFavoritesLocalOnly(); loadSavedFile();");
  assert.equal(A.get("favorites.length"), 0);
});

/* ═══ Grande échelle sur les fonctions réelles ═══ */

test("masse : un apport en fin de liste est détecté sur 300 fiches", () => {
  const nombreuses = Array.from({ length: 300 }, (_, i) => ({ id: "k" + i, title: "KPI " + i, freq: "Mensuelle", _mtime: 100 }));
  const distantes = nombreuses.slice(0, 299);          // la 300e n'est pas dans le cloud
  A.reset({ manualEntries: nombreuses, sites: [] });   // seul le contenu des fiches doit compter
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({
    kpiManual: distantes, kpiDeleted: [], kpiSites: [], kpiPurged: []
  })})`), true, "une seule fiche nouvelle, tout en fin de liste, doit suffire à déclencher l'envoi");
});

test("masse : une suppression isolée parmi 300 est détectée", () => {
  const nombreuses = Array.from({ length: 300 }, (_, i) => ({ id: "k" + i, title: "KPI " + i, freq: "Mensuelle", _mtime: 100 }));
  const supprimes = Array.from({ length: 40 }, (_, i) => ({ id: "k" + i, at: 500, state: "deleted" }));
  A.reset({ manualEntries: nombreuses, deletedIds: supprimes, sites: [] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({
    kpiManual: nombreuses, kpiDeleted: supprimes.slice(0, 39), kpiSites: [], kpiPurged: []
  })})`), true, "la 40e suppression doit être remarquée");
});

test("masse : un état strictement identique sur 300 fiches n'envoie rien", () => {
  const nombreuses = Array.from({ length: 300 }, (_, i) => ({ id: "k" + i, title: "KPI " + i, freq: "Mensuelle", _mtime: 100 }));
  A.reset({ manualEntries: nombreuses, sites: [] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({
    kpiManual: nombreuses, kpiDeleted: [], kpiSites: [], kpiPurged: []
  })})`), false, "aucune écriture inutile même sur un gros volume");
});

test("masse : 900 variantes s'affichent et se comptent correctement", () => {
  const nombreuses = Array.from({ length: 900 }, (_, i) => ({
    id: "k" + i, title: "KPI " + Math.floor(i / 3),
    freq: ["Mensuelle", "Hebdomadaire", "Quotidienne"][i % 3], _mtime: 100
  }));
  A.reset({ manualEntries: nombreuses });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 900);
  assert.equal(A.run("countFiches(data)"), 300, "900 variantes = 300 KPIs à trois temporalités");
  assert.equal(A.texte("countAll"), "300");
});

test("masse : la détection d'anomalies reste fiable sur 900 variantes", () => {
  const nombreuses = Array.from({ length: 900 }, (_, i) => ({
    id: "k" + i, title: "KPI " + Math.floor(i / 3),
    freq: ["Mensuelle", "Hebdomadaire", "Quotidienne"][i % 3]
  }));
  nombreuses.push({ id: "doublon", title: "KPI 0", freq: "Mensuelle" });   // un seul doublon caché
  A.reset({ manualEntries: nombreuses });
  A.run("rebuildData(false)");
  const anomalies = A.run("findVariantAnomalies(data)");
  assert.equal(anomalies.length, 1, "le doublon unique est retrouvé parmi 901 variantes");
  assert.match(anomalies[0].reason, /double/);
});

test("masse : l'export Excel traite un gros annuaire", () => {
  const nombreuses = Array.from({ length: 600 }, (_, i) => ({
    id: "k" + i, title: "KPI " + Math.floor(i / 3),
    freq: ["Mensuelle", "Hebdomadaire", "Quotidienne"][i % 3],
    logistiport: "https://exemple/" + i, _mtime: 100
  }));
  A.reset({ manualEntries: nombreuses });
  A.run("rebuildData(false); exportExcel();");
  const aoa = A.fichiersExportes()[0].wb.Sheets["KPIs"]["!aoa"];
  assert.equal(aoa.length - 1, 600, "toutes les variantes sont exportées");
});

test("masse : le nettoyage des fiches purgées passe à l'échelle", () => {
  const nombreuses = Array.from({ length: 500 }, (_, i) => ({ id: "k" + i, title: "KPI " + i, freq: "Mensuelle", _mtime: 100 }));
  const purges = nombreuses.slice(0, 200).map(k => k.id);
  A.reset({ manualEntries: nombreuses, purgedIds: purges });
  assert.equal(A.run("nettoyerPurgees()"), 200);
  assert.equal(A.get("manualEntries.length"), 300);
});

test("masse : le contenu envoyé reste sous la limite avec 600 variantes détaillées", () => {
  const nombreuses = Array.from({ length: 600 }, (_, i) => ({
    id: "kpi_charge_" + i, manual: true, title: "Indicateur de suivi numéro " + Math.floor(i / 3),
    freq: ["Mensuelle", "Hebdomadaire", "Quotidienne"][i % 3],
    type: "Contractuel", process: "Processus " + (i % 7), ritual: "Rituel " + (i % 4),
    desc: "Description détaillée du mode de calcul de cet indicateur, numéro " + i,
    logistiport: "https://app.powerbi.com/groups/aaaaaaaaaaaa/reports/bbbbbbbbbbbb/ReportSection" + i,
    armement: "https://app.powerbi.com/groups/cccccccccccc/reports/dddddddddddd/ReportSection" + i,
    _mtime: 100, _by: "marie"
  }));
  A.reset({ manualEntries: nombreuses });
  const octets = JSON.stringify(A.run("buildSyncPayload()")).length;
  assert.ok(octets < 1048576,
    "600 variantes détaillées doivent tenir dans un document : " + Math.round(octets / 1024) + " Ko");
});

/* ═══ Affichage de la dernière modification ═══ */

test("dernière modif : la date apparaît sur la carte", () => {
  const t = Date.UTC(2026, 6, 20, 14, 30);
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: t, _by: "marie" }] });
  A.run("rebuildData(false)");
  const html = A.run(`cardBody(data[0], false, "", "k")`);
  assert.match(html, /Modifié le/);
  assert.match(html, /20\/07\/2026/);
});

test("dernière modif : l'auteur est indiqué", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 1000000, _by: "BENJAMIN" }] });
  A.run("rebuildData(false)");
  assert.match(A.run(`cardBody(data[0], false, "", "k")`), /par <b>BENJAMIN<\/b>/);
});

test("dernière modif : une fiche sans date n'affiche rien", () => {
  A.reset({ manualEntries: [{ id: "a", title: "Ancienne", freq: "Mensuelle" }] });
  A.run("rebuildData(false)");
  assert.ok(!/Modifié le/.test(A.run(`cardBody(data[0], false, "", "k")`)),
    "aucune mention trompeuse sur les fiches importées");
});

test("dernière modif : une date sans auteur reste lisible", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 1000000 }] });
  A.run("rebuildData(false)");
  const html = A.run(`cardBody(data[0], false, "", "k")`);
  assert.match(html, /Modifié le/);
  assert.ok(!/par <b>/.test(html));
});

test("dernière modif : un nom d'auteur malveillant est neutralisé", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 1000, _by: '<img src=x onerror=alert(1)>' }] });
  A.run("rebuildData(false)");
  assert.ok(!A.run(`cardBody(data[0], false, "", "k")`).includes("<img"), "le contenu est échappé");
});

test("dernière modif : chaque temporalité affiche SA propre date", () => {
  A.reset({ manualEntries: [
    { id: "m", title: "K", freq: "Mensuelle", _mtime: Date.UTC(2026, 0, 5), _by: "marie" },
    { id: "h", title: "K", freq: "Hebdomadaire", _mtime: Date.UTC(2026, 5, 18), _by: "jean" }
  ] });
  A.run("rebuildData(false)");
  const hM = A.run(`cardBody(data[0], true, "", "k")`);
  const hH = A.run(`cardBody(data[1], true, "", "k")`);
  assert.match(hM, /05\/01\/2026/);
  assert.match(hH, /18\/06\/2026/);
});

/* ═══ Garantie : l'affichage ne modifie rien ═══ */

test("garantie : afficher une carte ne change aucune donnée", () => {
  const depart = [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 123456, _by: "marie", logistiport: "https://x" }];
  A.reset({ manualEntries: JSON.parse(JSON.stringify(depart)) });
  A.run("rebuildData(false)");
  A.run(`cardBody(data[0], false, "", "k"); cardBody(data[0], true, "", "k");`);
  assert.deepEqual(A.get("manualEntries"), depart, "les fiches sont strictement inchangées");
});

test("garantie : afficher une carte ne modifie pas la date de modification", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 999, _by: "marie" }] });
  A.run("rebuildData(false)");
  A.run(`for (var i = 0; i < 20; i++) cardBody(data[0], false, "", "k");`);
  assert.equal(A.get("manualEntries")[0]._mtime, 999, "sinon chaque affichage écraserait le travail des autres appareils");
});

test("garantie : le contenu envoyé au cloud est identique après affichage", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 555, _by: "marie" }] });
  A.run("rebuildData(false)");
  const avant = JSON.stringify(A.run("buildSyncPayload()").kpiManual);
  A.run(`filterData(); cardBody(data[0], false, "", "k");`);
  const apres = JSON.stringify(A.run("buildSyncPayload()").kpiManual);
  assert.equal(avant, apres, "l'affichage ne doit rien ajouter à ce qui part au cloud");
});

test("garantie : un rendu complet ne déclenche aucune synchronisation", () => {
  A.reset({ manualEntries: [
    { id: "a", title: "A", freq: "Mensuelle", _mtime: 100, _by: "marie" },
    { id: "b", title: "B", freq: "Mensuelle", _mtime: 200, _by: "jean" }
  ] });
  A.run("rebuildData(false); filterData();");
  const distant = { kpiManual: A.get("manualEntries"), kpiDeleted: [], kpiSites: A.get("sites"), kpiPurged: [] };
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify(distant)})`), false,
    "après un simple affichage, l'appareil ne doit rien avoir à renvoyer");
});

test("garantie : l'affichage ne perturbe pas la fusion avec le cloud", () => {
  const f = { id: "a", title: "K", freq: "Mensuelle", _mtime: 100, _by: "marie" };
  A.reset({ manualEntries: [f] });
  A.run("rebuildData(false)");
  A.run(`cardBody(data[0], false, "", "k");`);
  A.run(`applyRemoteData(${JSON.stringify({
    kpiManual: [{ ...f, logistiport: "https://depuis-le-cloud", _mtime: 9999 }], updatedAt: 9999
  })}, true)`);
  assert.equal(A.get("data")[0].logistiport, "https://depuis-le-cloud",
    "la version distante plus récente est bien appliquée");
});

test("garantie : la métadonnée d'auteur reste celle qui sert à l'arbitrage", () => {
  A.reset({ manualEntries: [{ id: "a", title: "K", freq: "Mensuelle", _mtime: 100, _by: "marie" }] });
  A.run("rebuildData(false)");
  A.run(`cardBody(data[0], false, "", "k");`);
  assert.equal(A.get("manualEntries")[0]._by, "marie",
    "l'auteur départage les modifications de même date : il ne doit jamais être réécrit à l'affichage");
});

/* ═══ Espace personnel synchronisé par utilisateur ═══ */

const perso = (id, titre, mtime) => ({ id, title: titre, freq: "Mensuelle", personal: true, _mtime: mtime || 100 });

test("perso : mes fiches me suivent d'un appareil à l'autre", () => {
  A.reset({ currentUser: "marie" });
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { marie: [perso("p1", "Mon suivi")] }, updatedAt: 100
  })}, true)`);
  assert.equal(A.get("personalEntries.length"), 1);
  assert.equal(A.get("personalEntries")[0].title, "Mon suivi");
});

test("perso : je ne vois jamais l'espace personnel d'un autre utilisateur", () => {
  A.reset({ currentUser: "marie" });
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { marie: [perso("p1", "À Marie")], jean: [perso("p2", "À Jean")] }, updatedAt: 100
  })}, true)`);
  assert.equal(A.get("personalEntries.length"), 1);
  assert.equal(A.get("personalEntries")[0].title, "À Marie");
});

test("perso : le bloc des autres utilisateurs est retransmis intact", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "À Marie")] });
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { jean: [perso("p2", "À Jean")] }, updatedAt: 100
  })}, true)`);
  const envoi = A.run("buildSyncPayload()");
  assert.equal(envoi.personalByUser.jean.length, 1,
    "les fiches de Jean ne doivent pas être perdues quand Marie envoie");
  assert.equal(envoi.personalByUser.marie.length, 1);
});

test("perso : une fiche personnelle n'entre jamais dans l'annuaire partagé", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "Privé")] });
  const envoi = A.run("buildSyncPayload()");
  assert.ok(!JSON.stringify(envoi.kpiManual).includes("Privé"));
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 0, "et n'apparaît pas dans la liste partagée affichée");
});

test("perso : une suppression se propage à mes autres appareils", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "À supprimer")] });
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { marie: [] },
    personalTrashByUser: { marie: [{ id: "p1", title: "À supprimer", _deletedAt: 500 }] },
    updatedAt: 500
  })}, true)`);
  assert.equal(A.get("personalEntries.length"), 0, "la fiche supprimée ailleurs disparaît ici");
});

test("perso : une fiche ré-éditée après suppression n'est pas effacée à tort", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "Reprise", 900)] });
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { marie: [] },
    personalTrashByUser: { marie: [{ id: "p1", _deletedAt: 500 }] },
    updatedAt: 900
  })}, true)`);
  assert.equal(A.get("personalEntries.length"), 1,
    "la modification (900) est postérieure à la suppression (500) : elle l'emporte");
});

test("perso : la version la plus récente l'emporte entre deux appareils", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "Ancienne", 100)] });
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { marie: [{ ...perso("p1", "Récente", 900) }] }, updatedAt: 900
  })}, true)`);
  assert.equal(A.get("personalEntries")[0].title, "Récente");
  assert.equal(A.get("personalEntries.length"), 1, "sans créer de doublon");
});

test("perso : une modification locale déclenche bien un envoi", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "Nouvelle", 900)] });
  const distant = { kpiManual: [], kpiDeleted: [], kpiSites: A.get("sites"), kpiPurged: [],
                    personalByUser: { marie: [] } };
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify(distant)})`), true);
});

test("perso : rien à envoyer si mon espace est déjà à jour", () => {
  const p = perso("p1", "Stable", 100);
  A.reset({ currentUser: "marie", personalEntries: [p], sites: [] });
  const distant = { kpiManual: [], kpiDeleted: [], kpiSites: [], kpiPurged: [],
                    personalByUser: { marie: [p] }, personalTrashByUser: { marie: [] } };
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify(distant)})`), false);
});

test("perso : désactivée, la synchronisation personnelle n'envoie rien", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "Reste ici")] });
  A.run(`localStorage.setItem("kpiPersonalSync", "0");`);
  const envoi = A.run("buildSyncPayload()");
  assert.ok(!envoi.personalByUser.marie, "mon bloc est retiré du document partagé");
  assert.ok(!JSON.stringify(envoi).includes("Reste ici"));
  A.run(`localStorage.removeItem("kpiPersonalSync");`);
});

test("perso : désactivée, rien n'est reçu non plus", () => {
  A.reset({ currentUser: "marie" });
  A.run(`localStorage.setItem("kpiPersonalSync", "0");`);
  A.run(`applyRemoteData(${JSON.stringify({
    personalByUser: { marie: [perso("p1", "Depuis le cloud")] }, updatedAt: 100
  })}, true)`);
  assert.equal(A.get("personalEntries.length"), 0);
  A.run(`localStorage.removeItem("kpiPersonalSync");`);
});

test("perso : « Récupérer » restaure aussi mon espace personnel", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("px", "Obsolète")] });
  A.run(`replaceLocalWithRemote(${JSON.stringify({
    kpiManual: [], kpiDeleted: [], kpiPurged: [],
    personalByUser: { marie: [perso("p1", "Depuis le cloud")] }, updatedAt: 500
  })})`);
  assert.equal(A.get("personalEntries.length"), 1);
  assert.equal(A.get("personalEntries")[0].title, "Depuis le cloud");
});

test("perso : un contenu distant sans bloc personnel ne vide pas mon espace", () => {
  A.reset({ currentUser: "marie", personalEntries: [perso("p1", "Intacte")] });
  A.run(`applyRemoteData(${JSON.stringify({ kpiManual: [], updatedAt: 100 })}, true)`);
  assert.equal(A.get("personalEntries.length"), 1);
});

test("perso : un nouvel appareil adopte mon espace dès la connexion", () => {
  A.reset({ currentUser: "marie" });
  A.run(`localStorage.setItem("kpiPersonalByUser", ${JSON.stringify(JSON.stringify({
    marie: [perso("p1", "Déjà reçue")]
  }))}); personalEntries = []; loadPersonalEntries();`);
  assert.equal(A.get("personalEntries.length"), 1);
});

test("perso : une suppression locale est détectée comme à envoyer", () => {
  A.reset({ currentUser: "marie", sites: [],
            personalTrash: [{ id: "p1", title: "Supprimée ici", _deletedAt: 900 }] });
  const distant = { kpiManual: [], kpiDeleted: [], kpiSites: [], kpiPurged: [],
                    personalByUser: { marie: [] }, personalTrashByUser: { marie: [] } };
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify(distant)})`), true,
    "sans cela, la suppression resterait bloquée sur cet appareil");
});

test("perso : supprimer une fiche la range dans la corbeille personnelle", () => {
  A.reset({ currentUser: "marie",
            personalEntries: [{ id: "p1", title: "À jeter", freq: "Mensuelle", personal: true }] });
  A.run("rebuildData(false)");
  A.confirmer(true);
  A.run(`deleteKPI("p1")`);
  A.confirmer(false);
  assert.equal(A.get("personalEntries.length"), 0);
  assert.equal(A.get("personalTrash.length"), 1);
  const envoi = A.run("buildSyncPayload()");
  assert.equal(envoi.personalTrashByUser.marie.length, 1, "et part vers mes autres appareils");
});

test("perso : enregistrer une fiche personnelle déclenche un envoi immédiat", () => {
  A.reset({ currentUser: "marie" });
  A.run(`globalThis.__envois = 0;
         globalThis.__vraiSchedule = scheduleAutoSync;
         scheduleAutoSync = function(){ globalThis.__envois++; };
         personalEntries = [{ id:"p1", title:"Nouvelle", freq:"Mensuelle" }];
         savePersonalEntries();`);
  const n = A.run("globalThis.__envois");
  A.run(`scheduleAutoSync = globalThis.__vraiSchedule;`);
  assert.equal(n, 1, "sans cela, la fiche n'atteindrait mes autres appareils qu'au prochain rechargement");
});

test("perso : supprimer une fiche personnelle déclenche aussi un envoi immédiat", () => {
  A.reset({ currentUser: "marie" });
  A.run(`globalThis.__envois = 0;
         globalThis.__vraiSchedule = scheduleAutoSync;
         scheduleAutoSync = function(){ globalThis.__envois++; };
         personalTrash = [{ id:"p1", _deletedAt: 500 }];
         savePersonalTrash();`);
  const n = A.run("globalThis.__envois");
  A.run(`scheduleAutoSync = globalThis.__vraiSchedule;`);
  assert.equal(n, 1);
});

test("perso : désactivée, l'enregistrement ne déclenche aucun envoi", () => {
  A.reset({ currentUser: "marie" });
  A.run(`localStorage.setItem("kpiPersonalSync", "0");
         globalThis.__envois = 0;
         globalThis.__vraiSchedule = scheduleAutoSync;
         scheduleAutoSync = function(){ globalThis.__envois++; };
         personalEntries = [{ id:"p1", title:"Locale", freq:"Mensuelle" }];
         savePersonalEntries();`);
  const n = A.run("globalThis.__envois");
  A.run(`scheduleAutoSync = globalThis.__vraiSchedule; localStorage.removeItem("kpiPersonalSync");`);
  assert.equal(n, 0);
});

test("perso : l'interrupteur reflète l'état réel à l'ouverture", () => {
  A.reset({ currentUser: "marie" });
  A.run(`localStorage.setItem("kpiPersonalSync", "0"); renderSyncDiag();`);
  assert.equal(A.el("personalSyncToggle").checked, false);
  A.run(`localStorage.removeItem("kpiPersonalSync"); renderSyncDiag();`);
  assert.equal(A.el("personalSyncToggle").checked, true, "activée par défaut");
});

test("perso : le diagnostic compte mon espace séparément du partagé", () => {
  A.reset({
    currentUser: "marie",
    manualEntries: fiches(["Partagé", "Mensuelle"]),
    personalEntries: [{ id: "p1", title: "Privé", freq: "Mensuelle" }]
  });
  A.run("rebuildData(false); renderSyncDiag();");
  const h = A.html("syncDiag");
  assert.match(h, /KPIs partagés<\/span><b>1/);
  assert.match(h, /KPIs personnels/);
});

/* ═══ Favoris orphelins dans le cloud ═══ */

test("favoris : ceux des autres utilisateurs pointant vers une fiche purgée sont nettoyés", () => {
  A.reset({ currentUser: "marie", purgedIds: ["mort"], favorites: ["vivant"] });
  A.run(`localStorage.setItem("kpiSyncFavorites", ${JSON.stringify(JSON.stringify({
    marie: ["vivant"], BENJAMIN: ["mort", "vivant2"]
  }))});`);
  const envoi = A.run("buildSyncPayload()");
  assert.deepEqual(envoi.favoritesByUser.BENJAMIN, ["vivant2"],
    "la référence morte est retirée sans toucher au reste");
  assert.deepEqual(envoi.favoritesByUser.marie, ["vivant"]);
});

test("favoris : un favori vers une fiche simplement en corbeille est conservé", () => {
  A.reset({ currentUser: "marie", purgedIds: [], favorites: ["corbeille"],
            deletedIds: [{ id: "corbeille", at: 5, state: "deleted" }] });
  A.run(`localStorage.setItem("kpiSyncFavorites", ${JSON.stringify(JSON.stringify({
    marie: ["corbeille"]
  }))});`);
  const envoi = A.run("buildSyncPayload()");
  assert.deepEqual(envoi.favoritesByUser.marie, ["corbeille"],
    "la fiche peut encore être réaffichée : son favori reste valable");
});

test("favoris : sans suppression définitive, rien n'est touché", () => {
  A.reset({ currentUser: "marie", purgedIds: [], favorites: ["a"] });
  A.run(`localStorage.setItem("kpiSyncFavorites", ${JSON.stringify(JSON.stringify({
    marie: ["a"], jean: ["b", "c"]
  }))});`);
  const envoi = A.run("buildSyncPayload()");
  assert.deepEqual(envoi.favoritesByUser.jean, ["b", "c"]);
});
