/* Flux complets sur les fonctions RÉELLES d'app.js :
   synchronisation avec Firebase simulé, formulaire KPI de bout en bout,
   persistance, import Excel, historique et sauvegardes. */
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./app-harness.js");

const A = loadApp();

const fiche = (titre, freq, liens) => Object.assign(
  { id: "kpi_" + titre.toLowerCase().replace(/\W+/g, "_") + "_" + freq.toLowerCase(),
    manual: true, title: titre, freq, _mtime: 100, _by: "marie" }, liens || {});

/** Prépare un appareil connecté au cloud simulé. */
async function appareilConnecte(etat) {
  A.reset(etat || {});
  A.firebaseSimule();
  A.run("ensureBuiltinConfig(); connectSync(false);");
  await attendre();                    // connectSync lance une synchro initiale asynchrone
  return A;
}
/** Laisse les promesses internes se terminer (plusieurs tours si nécessaire). */
async function attendre(tours = 30) {
  // setTimeout fonctionne partout (setImmediate n'existe pas dans un navigateur)
  for (let i = 0; i < tours; i++) await new Promise(r => setTimeout(r, 0));
}

/* ═══ Connexion au cloud ═══ */

/* Deux documents sont écoutés, et deux seulement : l'annuaire partagé, et
   le document séparé des empreintes de visuels. Ce dernier est à part
   parce que l'état sérialisé pèse ~5 Ko par visuel, alors que le document
   principal est plafonné à 1 Mo. Un troisième abonnement signalerait une
   écoute oubliée à la reconnexion. */
function ecoutesAttendues() {
  const code = A.run("BUILTIN_SYNC_CODE");
  return ["kpi_sync/" + code, "kpi_sync/" + code + "__empreintes"].sort();
}


test("connexion : la configuration intégrée est réinstallée automatiquement", () => {
  A.reset(); A.firebaseSimule();
  A.run(`setSyncConfig(null); connectSync(false);`);
  assert.ok(A.run("getSyncConfig()"), "un appareil vierge se reconfigure tout seul");
  assert.deepEqual(A.ecoutesCles().sort(), ecoutesAttendues());
});

test("connexion : une désactivation volontaire empêche la reconnexion", () => {
  A.reset(); A.firebaseSimule();
  A.run(`
    setSyncConfig(null);
    localStorage.setItem("kpiOptoutClearedV2", "1");   // nettoyage unique déjà effectué
    localStorage.setItem(LS_SYNC_OPTOUT, "1");         // l'utilisateur a désactivé
    connectSync(false);
  `);
  assert.equal(A.ecoutesActives(), 0, "le choix de l'utilisateur est respecté");
});

test("connexion : avec la configuration intégrée, l'écoute démarre", async () => {
  await appareilConnecte();
  assert.deepEqual(A.ecoutesCles().sort(), ecoutesAttendues());
});

test("connexion : le code de synchro utilisé est celui intégré", async () => {
  await appareilConnecte();
  assert.equal(A.run("connectedSyncCode"), A.run("BUILTIN_SYNC_CODE"));
});

test("connexion : se reconnecter ne crée pas une seconde écoute", async () => {
  await appareilConnecte();
  A.run("connectSync(false)");
  assert.deepEqual(A.ecoutesCles().sort(), ecoutesAttendues(),
    "une seule écoute par document, jamais deux");
});

test("connexion : l'état affiché passe à « connecté »", async () => {
  await appareilConnecte();
  assert.match(A.texte("syncStatus") + A.html("syncStatus"), /connect/i);
});

test("connexion : se déconnecter coupe l'écoute", async () => {
  await appareilConnecte();
  A.run("disconnectSync()");
  assert.equal(A.ecoutesActives(), 0);
});

test("connexion : se déconnecter efface la configuration locale", async () => {
  await appareilConnecte();
  A.run("disconnectSync()");
  assert.equal(A.run("getSyncConfig()"), null);
});

test("connexion : la déconnexion remet l'état de synchro à zéro", async () => {
  await appareilConnecte();
  A.run("disconnectSync()");
  assert.equal(A.run("initialSyncDone"), false);
  assert.equal(A.run("syncBusy"), false);
});

/* ═══ Envoi vers le cloud ═══ */

test("envoi : les fiches locales arrivent bien dans le cloud", async () => {
  await appareilConnecte({ manualEntries: [fiche("KPI A", "Mensuelle", { logistiport: "u1" })] });
  await A.run("pushToCloud(true)");
  const doc = A.cloudPrincipal();
  assert.equal(doc.kpiManual.length, 1);
  assert.equal(doc.kpiManual[0].logistiport, "u1");
});

test("envoi : un message confirme l'opération manuelle", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  await A.run("pushToCloud(true)");
  assert.match(A.dernierMessage(), /Synchronis/i);
});

test("envoi : une panne du cloud est signalée sans faire planter l'application", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.panneCloud("permission-denied");
  await A.run("pushToCloud(true)");
  A.panneCloud(null);
  assert.equal(A.run("pendingPush"), true, "l'envoi est mis en attente pour être rejoué");
});

test("envoi : hors-ligne, l'envoi est reporté et non perdu", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run(`navigator = { onLine: false };`);
  await A.run("pushToCloud(false)");
  A.run(`navigator = { onLine: true };`);
  assert.equal(A.run("pendingPush"), true);
});

/* ═══ Réception depuis le cloud ═══ */

test("réception : « Récupérer » remplace les données par celles du cloud", async () => {
  await appareilConnecte({ manualEntries: [fiche("Mauvais", "Mensuelle")] });
  A.run(`globalThis.__cloud["kpi_sync/" + getSyncConfig().code] = ${JSON.stringify({
    kpiManual: [fiche("Bon", "Mensuelle")], kpiDeleted: [], kpiPurged: [], updatedAt: 999
  })};`);
  await A.run("pullFromCloud(true, true)");
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].title, "Bon");
});

test("réception : sans document distant, l'utilisateur est prévenu", async () => {
  await appareilConnecte();
  A.run(`globalThis.__cloud = {};`);
  await A.run("pullFromCloud(true, true)");
  assert.match(A.dernierMessage(), /Aucune donnée cloud/i);
});

test("réception : une erreur affiche un message explicite", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.panneCloud("réseau coupé");
  await A.run("pullFromCloud(true, true)");
  A.panneCloud(null);
  assert.match(A.dernierMessage(), /Erreur/i);
});

test("réception : une opération déjà en cours est refusée proprement", async () => {
  await appareilConnecte();
  A.run("syncBusy = true");
  await A.run("pullFromCloud(true, true)");
  A.run("syncBusy = false");
  assert.match(A.dernierMessage(), /en cours/i);
});

test("réception : la fusion garde les apports locaux ET distants", async () => {
  await appareilConnecte({ manualEntries: [fiche("Local", "Mensuelle")] });
  A.run(`globalThis.__cloud["kpi_sync/" + getSyncConfig().code] = ${JSON.stringify({
    kpiManual: [fiche("Distant", "Mensuelle")], updatedAt: 999
  })};`);
  await A.run("pullFromCloud(true, false)");
  assert.equal(A.get("data.length"), 2);
});

/* ═══ Synchronisation initiale ═══ */

test("démarrage : un cloud vide reçoit les données de l'appareil", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run(`globalThis.__cloud = {}; initialSyncDone = false;`);
  await A.run(`initialSync(getSyncConfig().code, false)`);
  assert.ok(A.cloudPrincipal(), "le cloud a été alimenté");
});

test("démarrage : un appareil déjà à jour ne réécrit pas le cloud", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  await A.run("pushToCloud(false)");
  const avant = A.ecrituresCloud();
  A.run("initialSyncDone = false");
  await A.run(`initialSync(getSyncConfig().code, false)`);
  assert.equal(A.ecrituresCloud(), avant, "aucune écriture inutile");
});

test("démarrage : un apport local hors-ligne est bien renvoyé", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  await A.run("pushToCloud(false)");
  // Le cloud reçoit une fiche très récente d'un autre appareil
  A.run(`(function(){
    const c = globalThis.__cloud["kpi_sync/" + getSyncConfig().code];
    c.kpiManual.push({ id: "kpi_distant", title: "Distant", freq: "Mensuelle", _mtime: 99999 });
    c.updatedAt = 99999;
  })();`);
  // Et l'appareil crée une fiche hors-ligne (donc plus ancienne)
  A.run(`manualEntries.push({ id: "kpi_hors_ligne", title: "Hors-ligne", freq: "Mensuelle", _mtime: 150 });`);
  const avant = A.ecrituresCloud();
  A.run("initialSyncDone = false");
  await A.run(`initialSync(getSyncConfig().code, false)`);
  assert.ok(A.ecrituresCloud() > avant, "l'apport hors-ligne doit repartir vers le cloud");
  assert.ok(A.cloudPrincipal().kpiManual.some(k => k.id === "kpi_hors_ligne"));
});

test("démarrage : la fusion initiale marque la synchro comme prête", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run("initialSyncDone = false");
  await A.run(`initialSync(getSyncConfig().code, false)`);
  assert.equal(A.run("initialSyncDone"), true);
});

test("démarrage : deux synchros simultanées ne se chevauchent pas", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run("syncBusy = true; initialSyncDone = false;");
  await A.run(`initialSync(getSyncConfig().code, false)`);
  assert.equal(A.run("initialSyncDone"), false, "la seconde est ignorée tant que la première tourne");
  A.run("syncBusy = false");
});

/* ═══ Écoute temps réel ═══ */

test("temps réel : une écriture distante est reçue une fois la synchro prête", async () => {
  await appareilConnecte({ manualEntries: [fiche("Local", "Mensuelle")] });
  A.run("initialSyncDone = true; syncBusy = false; lastAppliedSyncAt = 0;");
  A.run(`(function(){
    const ref = fbDb.collection("kpi_sync").doc(getSyncConfig().code);
    return ref.set({ kpiManual: [${JSON.stringify(fiche("Distant", "Mensuelle"))}], updatedAt: 12345 });
  })();`);
  await attendre();
  assert.equal(A.get("data.length"), 2, "la fiche distante est intégrée");
});

test("temps réel : rien n'est appliqué avant la fin de la fusion initiale", async () => {
  await appareilConnecte({ manualEntries: [fiche("Local", "Mensuelle")] });
  A.run("rebuildData(false); initialSyncDone = false;");
  A.run(`(function(){
    const ref = fbDb.collection("kpi_sync").doc(getSyncConfig().code);
    return ref.set({ kpiManual: [${JSON.stringify(fiche("Distant", "Mensuelle"))}], updatedAt: 22222 });
  })();`);
  await attendre();
  assert.equal(A.get("data.length"), 1, "les données locales sont préservées");
});

test("temps réel : notre propre écriture ne déclenche pas de re-fusion", async () => {
  await appareilConnecte({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run("initialSyncDone = true;");
  await A.run("pushToCloud(false)");
  const messages = A.messages().length;
  await attendre();
  assert.equal(A.messages().length, messages, "aucun message « mis à jour depuis un autre appareil »");
});

/* ═══ Réinitialisation complète ═══ */

test("réinitialisation : refuser la confirmation ne change rien", async () => {
  await appareilConnecte();
  A.confirmer(false);
  A.run("resetSyncCompletely()");
  assert.ok(A.run("getSyncConfig()"), "la configuration est conservée");
});

test("réinitialisation : confirmée, elle coupe la synchro", async () => {
  await appareilConnecte();
  A.confirmer(true);
  A.run("resetSyncCompletely()");
  A.confirmer(false);
  assert.equal(A.ecoutesActives(), 0);
});

/* ═══ Indicateur d'état ═══ */

test("indicateur : chaque état produit un libellé lisible", () => {
  A.reset();
  ["off", "syncing", "connected", "offline", "error"].forEach(e => {
    A.run(`setSyncStatusUI(${JSON.stringify(e)}, "détail")`);
    assert.ok(A.texte("syncStatus").length > 0, "état sans libellé : " + e);
  });
});

test("indicateur : une erreur affiche son détail", () => {
  A.reset();
  A.run(`setSyncStatusUI("error", "permission refusée")`);
  assert.match(A.texte("syncStatus"), /permission refusée/);
});

/* ═══ Formulaire KPI : création ═══ */

test("formulaire : l'ouverture en création part d'une fiche vierge", () => {
  A.reset();
  A.run("openKpiModal()");
  assert.equal(A.el("kpiTitleInput").value, "");
});

test("formulaire : un intitulé vide est refusé", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "   ");
  A.run("saveKpiForm()");
  assert.match(A.dernierMessage(), /intitulé/i);
  assert.equal(A.get("manualEntries.length"), 0);
});

test("formulaire : une fiche complète est créée", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Nouveau KPI");
  A.saisir("kpiTypeInput", "Suivi");
  A.saisir("kpiProcessInput", "Logistique");
  A.run(`switchFreqTab("Mensuelle"); modalSlots["Mensuelle"].active = true; saveKpiForm();`);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Nouveau KPI");
});

test("formulaire : les champs communs sont repris sur la fiche", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "KPI complet");
  A.saisir("kpiTypeInput", "Pilotage");
  A.saisir("kpiProcessInput", "Transport");
  A.saisir("kpiDescInput", "Mode de calcul");
  A.run(`modalSlots["Mensuelle"].active = true; saveKpiForm();`);
  const k = A.get("manualEntries")[0];
  assert.equal(k.type, "Pilotage");
  assert.equal(k.process, "Transport");
  assert.equal(k.desc, "Mode de calcul");
});

test("formulaire : plusieurs temporalités sont créées en une fois", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Multi");
  A.run(`["Mensuelle","Hebdomadaire","Quotidienne"].forEach(f => modalSlots[f].active = true); saveKpiForm();`);
  assert.equal(A.get("manualEntries.length"), 3);
  assert.equal(A.run("countFiches(manualEntries)"), 1, "mais une seule fiche");
});

test("formulaire : la création est journalisée", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Tracé");
  A.run(`modalSlots["Mensuelle"].active = true; saveKpiForm();`);
  assert.ok(A.get("activityLog").some(e => e.action === "create"));
});

test("formulaire : un message confirme l'enregistrement", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Message");
  A.run(`modalSlots["Mensuelle"].active = true; saveKpiForm();`);
  assert.match(A.dernierMessage(), /Temporalités/i);
});

test("formulaire : une fiche personnelle reste dans l'espace personnel", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Privé");
  A.saisir("kpiSpaceInput", "perso");
  A.run(`modalSlots["Mensuelle"].active = true; saveKpiForm();`);
  assert.equal(A.get("personalEntries.length"), 1);
  assert.equal(A.get("manualEntries.length"), 0);
});

/* ═══ Formulaire KPI : modification ═══ */

test("modification : l'ouverture pré-remplit les champs", () => {
  const f = fiche("À modifier", "Mensuelle", { logistiport: "u1" });
  A.reset({ manualEntries: [f] });
  A.run("rebuildData(false)");
  A.run(`editKPI(${JSON.stringify(f.id)})`);
  assert.equal(A.el("kpiTitleInput").value, "À modifier");
});

test("modification : les temporalités existantes sont cochées", () => {
  const f1 = fiche("Multi", "Mensuelle"), f2 = fiche("Multi", "Hebdomadaire");
  A.reset({ manualEntries: [f1, f2] });
  A.run("rebuildData(false)");
  A.run(`openKpiModal(${JSON.stringify(f1.id)})`);
  assert.equal(A.run(`modalSlots["Mensuelle"].active`), true);
  assert.equal(A.run(`modalSlots["Hebdomadaire"].active`), true);
  assert.equal(A.run(`modalSlots["Quotidienne"].active`), false);
});

test("modification : changer l'intitulé met à jour toutes les temporalités", () => {
  const f1 = fiche("Ancien nom", "Mensuelle"), f2 = fiche("Ancien nom", "Hebdomadaire");
  A.reset({ manualEntries: [f1, f2] });
  A.run("rebuildData(false)");
  A.run(`openKpiModal(${JSON.stringify(f1.id)})`);
  A.saisir("kpiTitleInput", "Nouveau nom");
  A.run("saveKpiForm()");
  const titres = A.get("manualEntries").map(k => k.title);
  assert.ok(titres.every(t => t === "Nouveau nom"), "toutes les temporalités suivent");
});

test("modification : décocher une temporalité la retire", () => {
  const f1 = fiche("Multi", "Mensuelle"), f2 = fiche("Multi", "Hebdomadaire");
  A.reset({ manualEntries: [f1, f2] });
  A.run("rebuildData(false)");
  A.run(`openKpiModal(${JSON.stringify(f1.id)}); modalSlots["Hebdomadaire"].active = false; saveKpiForm();`);
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].freq, "Mensuelle");
});

test("modification : le retrait d'une temporalité laisse un marqueur récupérable", () => {
  const f1 = fiche("Multi", "Mensuelle"), f2 = fiche("Multi", "Hebdomadaire");
  A.reset({ manualEntries: [f1, f2] });
  A.run("rebuildData(false)");
  A.run(`openKpiModal(${JSON.stringify(f1.id)}); modalSlots["Hebdomadaire"].active = false; saveKpiForm();`);
  assert.equal(A.get("deletedIds.length"), 1);
});

test("modification : ajouter une temporalité à une fiche existante", () => {
  const f = fiche("Extensible", "Mensuelle");
  A.reset({ manualEntries: [f] });
  A.run("rebuildData(false)");
  A.run(`openKpiModal(${JSON.stringify(f.id)}); modalSlots["Quotidienne"].active = true; saveKpiForm();`);
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 2);
});

test("modification : la modification est journalisée", () => {
  const f = fiche("Suivi", "Mensuelle");
  A.reset({ manualEntries: [f] });
  A.run("rebuildData(false)");
  A.run(`openKpiModal(${JSON.stringify(f.id)}); saveKpiForm();`);
  assert.ok(A.get("activityLog").some(e => e.action === "update"));
});

test("modification : basculer d'onglet conserve les liens saisis", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Bascule");
  A.run(`switchFreqTab("Mensuelle");`);
  A.saisir("kpiLink_logistiport", "https://mensuel");
  A.run(`switchFreqTab("Hebdomadaire"); switchFreqTab("Mensuelle");`);
  assert.equal(A.run(`modalSlots["Mensuelle"].links.logistiport`), "https://mensuel");
});

test("modification : chaque temporalité garde ses propres liens", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Liens séparés");
  A.run(`switchFreqTab("Mensuelle");`);
  A.cocher("freqActiveToggle", true);
  A.saisir("kpiLink_logistiport", "https://m");
  A.run(`switchFreqTab("Hebdomadaire");`);
  A.cocher("freqActiveToggle", true);      // l'utilisateur coche « cette temporalité existe »
  A.saisir("kpiLink_logistiport", "https://h");
  A.run("saveKpiForm()");
  const parFreq = {};
  A.get("manualEntries").forEach(k => { parFreq[k.freq] = k.logistiport; });
  assert.equal(parFreq["Mensuelle"], "https://m");
  assert.equal(parFreq["Hebdomadaire"], "https://h");
});

test("modification : fermer la fenêtre n'enregistre rien", () => {
  A.reset();
  A.run("openKpiModal()");
  A.saisir("kpiTitleInput", "Abandonné");
  A.run("closeKpiModal()");
  assert.equal(A.get("manualEntries.length"), 0);
});

test("modification : la fonction de restauration d'origine est neutralisée", () => {
  A.reset();
  A.run(`restoreOriginalKpi("x")`);
  assert.match(A.dernierMessage(), /retirée/i);
});

/* ═══ Vues, filtres et rapports ═══ */

test("vues : basculer sur les favoris change la vue courante", () => {
  A.reset({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run("rebuildData(false)");
  A.run(`switchView("fav", null)`);
  assert.equal(A.run("currentView"), "fav");
});

test("vues : l'espace personnel est une vue distincte", () => {
  A.reset();
  A.run(`switchView("perso", null)`);
  assert.equal(A.run("currentView"), "perso");
});

test("filtres : la réinitialisation vide la recherche", () => {
  A.reset({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run("rebuildData(false)");
  A.saisir("search", "recherche");
  A.run("resetFilters()");
  assert.equal(A.el("search").value, "");
});

test("rapports : la classe d'un processus est stable", () => {
  A.reset();
  const c1 = A.run(`processTagClass("Logistique")`);
  const c2 = A.run(`processTagClass("Logistique")`);
  assert.equal(c1, c2, "un même processus garde toujours la même couleur");
});

test("rapports : ouvrir sans lien sélectionné prévient l'utilisateur", () => {
  A.reset({ manualEntries: [fiche("A", "Mensuelle")] });
  A.run("rebuildData(false)");
  A.requete("#sel_test", []);
  A.run(`openReport("sel_inexistant", null)`);
  assert.equal(A.ouvertures().length, 0, "aucune fenêtre ouverte sans lien");
});

/* ═══ Persistance : enregistrer puis relire ═══ */

test("persistance : les fiches partagées survivent à un rechargement", () => {
  A.reset({ manualEntries: [fiche("Persistant", "Mensuelle")] });
  A.run("saveManualEntries(false); manualEntries = []; loadManualEntries();");
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Persistant");
});

test("persistance : les fiches personnelles sont propres à l'utilisateur", () => {
  A.reset({ currentUser: "marie", personalEntries: [{ id: "p1", title: "À Marie", freq: "Mensuelle" }] });
  A.run("savePersonalEntries();");
  A.run(`currentUser = "jean"; loadPersonalEntries();`);
  assert.equal(A.get("personalEntries.length"), 0, "Jean ne voit pas les fiches de Marie");
  A.run(`currentUser = "marie"; loadPersonalEntries();`);
  assert.equal(A.get("personalEntries.length"), 1, "Marie retrouve les siennes");
});

test("persistance : la corbeille personnelle est également par utilisateur", () => {
  A.reset({ currentUser: "marie", personalTrash: [{ id: "p1", title: "Supprimé", freq: "Mensuelle" }] });
  A.run("savePersonalTrash();");
  A.run(`currentUser = "jean"; loadPersonalTrash();`);
  assert.equal(A.get("personalTrash.length"), 0);
});

test("persistance : les marqueurs de suppression sont conservés", () => {
  A.reset({ deletedIds: [{ id: "x", title: "X", at: 5, state: "deleted" }] });
  A.run("saveDeletedIds(false); deletedIds = []; loadDeletedIds();");
  assert.equal(A.get("deletedIds.length"), 1);
});

test("persistance : les suppressions définitives sont conservées", () => {
  A.reset({ purgedIds: ["a", "b"] });
  A.run("savePurged(false); purgedIds = []; loadPurged();");
  assert.equal(A.get("purgedIds.length"), 2);
});

test("persistance : les périmètres sont conservés", () => {
  A.reset({ sites: [{ key: "x", name: "Site X", _mtime: 5 }] });
  A.run("saveSites(false); sites = []; loadSites();");
  assert.equal(A.get("sites")[0].name, "Site X");
});

test("persistance : sans périmètre enregistré, ceux par défaut reviennent", () => {
  A.reset();
  A.run(`localStorage.removeItem("kpiSites"); sites = []; loadSites();`);
  assert.ok(A.run("sites.length") >= 3, "les périmètres par défaut sont restaurés");
});

test("persistance : le journal d'activité est conservé", () => {
  A.reset({ activityLog: [{ at: 1, by: "marie", action: "create", title: "X" }] });
  A.run("saveActivity(false); activityLog = []; loadActivity();");
  assert.equal(A.get("activityLog.length"), 1);
});

test("persistance : les favoris sont relus au démarrage", () => {
  A.reset({ currentUser: "marie", favorites: ["k1", "k2"] });
  A.run("saveFavoritesLocalOnly(); favorites = []; loadFavorites();");
  assert.equal(A.get("favorites.length"), 2);
});

test("persistance : un contenu corrompu ne bloque pas le démarrage", () => {
  A.reset();
  A.run(`localStorage.setItem("kpiManualEntries", "{ceci n'est pas du JSON"); manualEntries = null; loadManualEntries();`);
  assert.deepEqual(A.get("manualEntries"), [], "on repart sur une liste vide plutôt que de planter");
});

/* ═══ Migration depuis l'ancien système Excel ═══ */

test("migration : les anciennes données Excel deviennent des fiches", () => {
  A.reset();
  A.run(`
    localStorage.setItem("kpiDataCache", JSON.stringify([
      { id: "vieux_1", title: "Volumétrie", freq: "Mensuelle", logistiport: "u1", _mtime: 50 }
    ]));
    localStorage.removeItem("kpiMigratedV2");
    manualEntries = [];
    migrateExcelToManual();
  `);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Volumétrie");
});

test("migration : les modifications de l'époque sont appliquées", () => {
  A.reset();
  A.run(`
    localStorage.setItem("kpiDataCache", JSON.stringify([
      { id: "vieux_1", title: "Volumétrie", freq: "Mensuelle", logistiport: "u1", _mtime: 50 }
    ]));
    localStorage.setItem("kpiOverrides", JSON.stringify({ "vieux_1": { armement: "u-MG", _mtime: 80 } }));
    localStorage.removeItem("kpiMigratedV2");
    manualEntries = [];
    migrateExcelToManual();
  `);
  assert.equal(A.get("manualEntries")[0].armement, "u-MG");
});

test("migration : les dates d'origine sont préservées (pas de faux « récent »)", () => {
  A.reset();
  A.run(`
    localStorage.setItem("kpiDataCache", JSON.stringify([
      { id: "vieux_1", title: "V", freq: "Mensuelle", _mtime: 50 }
    ]));
    localStorage.removeItem("kpiMigratedV2");
    manualEntries = [];
    migrateExcelToManual();
  `);
  assert.equal(A.get("manualEntries")[0]._mtime, 50, "sinon cet appareil écraserait tous les autres");
});

test("migration : elle ne se rejoue jamais deux fois", () => {
  A.reset();
  A.run(`
    localStorage.setItem("kpiDataCache", JSON.stringify([
      { id: "v1", title: "V", freq: "Mensuelle", _mtime: 50 }
    ]));
    localStorage.removeItem("kpiMigratedV2");
    manualEntries = []; migrateExcelToManual();
    localStorage.setItem("kpiDataCache", JSON.stringify([
      { id: "v2", title: "Autre", freq: "Mensuelle", _mtime: 60 }
    ]));
    migrateExcelToManual();
  `);
  assert.equal(A.get("manualEntries.length"), 1, "la seconde tentative est ignorée");
});

test("migration : les vestiges de l'ancien système sont effacés", () => {
  A.reset();
  A.run(`
    localStorage.setItem("kpiDataCache", "[]");
    localStorage.setItem("kpiOverrides", "{}");
    localStorage.setItem("kpiFileB64", "xxx");
    localStorage.removeItem("kpiMigratedV2");
    migrateExcelToManual();
  `);
  const s = A.stockage();
  assert.equal(s.kpiDataCache, undefined);
  assert.equal(s.kpiOverrides, undefined);
  assert.equal(s.kpiFileB64, undefined);
});

/* ═══ Historique d'activité ═══ */

test("historique : la liste affiche les entrées", () => {
  A.reset({ activityLog: [
    { at: Date.now(), by: "marie", action: "create", title: "KPI A", detail: "" },
    { at: Date.now() - 1000, by: "jean", action: "delete", title: "KPI B", detail: "" }
  ] });
  A.run("renderHistoryList()");
  assert.ok(A.el("historyList").children.length >= 1 || A.html("historyList").length > 0);
});

test("historique : vide, il l'annonce", () => {
  A.reset({ activityLog: [] });
  A.run("renderHistoryList()");
  assert.ok(A.html("historyList").length > 0);
});

test("historique : la liste des auteurs est alimentée", () => {
  A.reset({ activityLog: [
    { at: 2, by: "marie", action: "create", title: "A" },
    { at: 1, by: "jean", action: "update", title: "B" }
  ] });
  A.run("refreshHistoryUserFilter()");
  const opts = A.el("historyUserFilter").options.map(o => o.textContent);
  assert.ok(opts.includes("marie") && opts.includes("jean"));
});

test("historique : l'export produit un fichier CSV", () => {
  A.reset({ activityLog: [{ at: Date.now(), by: "marie", action: "create", title: "KPI A", detail: "d" }] });
  A.run("exportHistoryCsv()");
  assert.match(A.dernierMessage(), /export/i);
});

test("historique : exporter un journal vide prévient l'utilisateur", () => {
  A.reset({ activityLog: [] });
  A.run("exportHistoryCsv()");
  assert.ok(A.dernierMessage().length > 0);
});

/* ═══ Import Excel ═══ */

test("import Excel : un fichier illisible est signalé sans planter", () => {
  A.reset();
  A.run(`XLSX = { read: function () { throw new Error("fichier corrompu"); }, utils: {} };`);
  A.run(`loadWorkbook(new Uint8Array(0))`);
  assert.ok(A.dernierMessage().length > 0 || A.alertes().length > 0);
});

test("import Excel : les lignes deviennent des fiches", () => {
  A.reset();
  A.run(`
    XLSX = { utils: { sheet_to_json: () => [
      ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"],
      ["Volumétrie", "Suivi", "Log", "Mensuelle", "Comité", "desc"]
    ], encode_cell: () => "A1" } };
    confirm = () => true;
    transformData({}, XLSX.utils.sheet_to_json());
  `);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Volumétrie");
});

test("import Excel : l'identifiant ne dépend pas de la position de la ligne", () => {
  A.reset();
  const lignes = (ordre) => JSON.stringify([
    ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"],
    ...ordre
  ]);
  A.run(`XLSX = { utils: { encode_cell: () => "A1" } }; confirm = () => true;`);
  A.run(`transformData({}, ${lignes([["A", "", "", "Mensuelle", "", ""], ["B", "", "", "Mensuelle", "", ""]])});`);
  const id1 = A.get("manualEntries").find(k => k.title === "A").id;
  A.run(`manualEntries = []; transformData({}, ${lignes([["B", "", "", "Mensuelle", "", ""], ["A", "", "", "Mensuelle", "", ""]])});`);
  const id2 = A.get("manualEntries").find(k => k.title === "A").id;
  assert.equal(id1, id2, "sinon le même KPI apparaîtrait en double après fusion");
});

test("import Excel : ré-importer ne crée pas de doublon", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: () => "A1" } }; confirm = () => true;`);
  const donnees = JSON.stringify([
    ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"],
    ["Volumétrie", "", "", "Mensuelle", "", ""]
  ]);
  A.run(`transformData({}, ${donnees}); transformData({}, ${donnees});`);
  assert.equal(A.get("manualEntries.length"), 1);
});

test("import Excel : le bilan précise créations et mises à jour", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: () => "A1" } }; confirm = () => true;`);
  A.run(`transformData({}, ${JSON.stringify([
    ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"],
    ["Nouvelle", "", "", "Mensuelle", "", ""]
  ])});`);
  assert.match(A.dernierMessage(), /créée/i);
});

test("import Excel : une fiche en corbeille ré-importée est signalée", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: () => "A1" } }; confirm = () => true;`);
  const donnees = JSON.stringify([
    ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"],
    ["Supprimée", "", "", "Mensuelle", "", ""]
  ]);
  A.run(`transformData({}, ${donnees});`);
  const id = A.get("manualEntries")[0].id;
  A.run(`deletedIds = [{ id: ${JSON.stringify(id)}, title: "Supprimée", at: 999, state: "deleted" }]; rebuildData(false);`);
  A.run(`confirm = () => false; transformData({}, ${donnees});`);
  assert.equal(A.get("data.length"), 0, "elle reste masquée");
});

test("import Excel : proposée, la réapparition fonctionne", () => {
  A.reset();
  A.run(`XLSX = { utils: { encode_cell: () => "A1" } }; confirm = () => true;`);
  const donnees = JSON.stringify([
    ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul"],
    ["Supprimée", "", "", "Mensuelle", "", ""]
  ]);
  A.run(`transformData({}, ${donnees});`);
  const id = A.get("manualEntries")[0].id;
  A.run(`deletedIds = [{ id: ${JSON.stringify(id)}, title: "Supprimée", at: 999, state: "deleted" }]; rebuildData(false);`);
  A.run(`confirm = () => true; transformData({}, ${donnees});`);
  assert.equal(A.get("data.length"), 1, "la fiche est réaffichée après confirmation");
});

test("import Excel : les liens de site sont extraits des cellules", () => {
  A.reset();
  A.run(`
    XLSX = { utils: { encode_cell: ({ r, c }) => "R" + r + "C" + c } };
    confirm = () => true;
    const feuille = { "R1C6": { l: { Target: "https://powerbi/log" } } };
    transformData(feuille, [
      ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul", "Logistiport"],
      ["Avec lien", "", "", "Mensuelle", "", "", ""]
    ]);
  `);
  assert.equal(A.get("manualEntries")[0].logistiport, "https://powerbi/log");
});

/* ═══ Import d'une sauvegarde ═══ */

test("sauvegarde : un fichier au mauvais format est refusé", () => {
  A.reset();
  A.run(`
    FileReader = function () {
      this.readAsText = () => { this.result = JSON.stringify({ pas: "le bon format" }); this.onload(); };
    };
    importBackup({});
  `);
  assert.match(A.dernierMessage(), /n'est pas une sauvegarde/i);
});

test("sauvegarde : un fichier illisible est signalé", () => {
  A.reset();
  A.run(`
    FileReader = function () {
      this.readAsText = () => { this.result = "pas du JSON {{{"; this.onload(); };
    };
    importBackup({});
  `);
  assert.match(A.dernierMessage(), /illisible/i);
});

test("sauvegarde : refuser la confirmation n'écrase rien", () => {
  A.reset({ manualEntries: [fiche("En place", "Mensuelle")] });
  A.run(`
    confirm = () => false;
    FileReader = function () {
      this.readAsText = () => {
        this.result = JSON.stringify({ _format: "annuaire-kpi-backup", manualEntries: [] });
        this.onload();
      };
    };
    importBackup({});
  `);
  assert.equal(A.get("manualEntries.length"), 1);
});

test("sauvegarde : confirmée, la restauration remplace les fiches", () => {
  A.reset({ manualEntries: [fiche("Ancien", "Mensuelle")] });
  A.run(`
    confirm = () => true;
    FileReader = function () {
      this.readAsText = () => {
        this.result = JSON.stringify({
          _format: "annuaire-kpi-backup",
          manualEntries: [${JSON.stringify(fiche("Restauré", "Mensuelle"))}],
          personalEntries: [], deletedIds: [], sites: []
        });
        this.onload();
      };
    };
    importBackup({});
  `);
  assert.equal(A.get("manualEntries")[0].title, "Restauré");
});

test("sauvegarde : une ancienne sauvegarde Excel est convertie", () => {
  A.reset();
  A.run(`
    confirm = () => true;
    FileReader = function () {
      this.readAsText = () => {
        this.result = JSON.stringify({
          _format: "annuaire-kpi-backup",
          excelData: [{ id: "v1", title: "Ancienne fiche", freq: "Mensuelle", _mtime: 10 }],
          overrides: {}, manualEntries: [], personalEntries: [], deletedIds: []
        });
        this.onload();
      };
    };
    importBackup({});
  `);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.get("manualEntries")[0].title, "Ancienne fiche");
});

/* ═══ Fenêtres et listes ═══ */

test("fenêtres : la corbeille s'ouvre et se remplit", () => {
  const f = fiche("Supprimée", "Mensuelle");
  A.reset({ manualEntries: [f], deletedIds: [{ id: f.id, title: "Supprimée", at: 9, state: "deleted" }] });
  A.run("openTrashModal()");
  assert.equal(A.el("trashList").children.length, 1);
});

test("fenêtres : l'historique s'ouvre et se remplit", () => {
  A.reset({ activityLog: [{ at: Date.now(), by: "marie", action: "create", title: "A", detail: "" }] });
  A.run("openHistoryModal()");
  assert.ok(A.el("historyList").children.length >= 1 || A.html("historyList").length > 0);
});

test("fenêtres : la gestion des sites reprend les sites actifs", () => {
  A.reset({ sites: [{ key: "a", name: "A" }, { key: "b", name: "B", _deleted: true }] });
  A.run("openSitesModal()");
  assert.equal(A.run("sitesDraft.length"), 1, "les sites supprimés ne sont pas proposés");
});

test("fenêtres : la liste des sites s'affiche", () => {
  A.reset();
  A.run("openSitesModal(); renderSitesList();");
  assert.ok(A.html("sitesList").length > 0 || A.el("sitesList").children.length > 0);
});

test("fenêtres : le tutoriel s'ouvre sans erreur", () => {
  A.reset();
  A.run("openTutorial()");
  assert.ok(true, "aucune exception levée");
});

/* ═══ Dernières fonctions : navigation, connexion, étiquettes ═══ */

test("connexion : l'identifiant saisi devient l'utilisateur courant", () => {
  A.reset();
  A.run(`login("jean")`);
  assert.equal(A.run("currentUser"), "jean");
});

test("connexion : l'identifiant est mémorisé pour la prochaine visite", () => {
  A.reset();
  A.run(`login("marie")`);
  assert.equal(A.stockage().kpiUser, "marie");
});

test("connexion : l'identifiant est affiché dans l'application", () => {
  A.reset();
  A.run(`login("céline")`);
  assert.equal(A.texte("userInfo"), "céline");
});

test("connexion : changer d'utilisateur recharge ses fiches personnelles", () => {
  A.reset({ currentUser: "marie", personalEntries: [{ id: "p1", title: "À Marie", freq: "Mensuelle" }] });
  A.run("savePersonalEntries();");
  A.run(`login("jean")`);
  assert.equal(A.get("personalEntries.length"), 0, "Jean démarre avec son propre espace");
});

test("démarrage : le chargement initial reconstruit l'affichage", () => {
  A.reset({ manualEntries: [fiche("Au démarrage", "Mensuelle")] });
  A.run("saveManualEntries(false); loadSavedFile();");
  assert.equal(A.get("data.length"), 1);
});

test("démarrage : le chargement initial déclenche la migration une seule fois", () => {
  A.reset();
  A.run(`
    localStorage.setItem("kpiDataCache", JSON.stringify([{ id: "v", title: "Vieux", freq: "Mensuelle", _mtime: 5 }]));
    localStorage.removeItem("kpiMigratedV2");
    manualEntries = [];
    loadSavedFile();
  `);
  assert.equal(A.get("manualEntries.length"), 1);
  assert.equal(A.stockage().kpiMigratedV2, "1");
});

test("navigation : replier le menu latéral fonctionne dans les deux sens", () => {
  A.reset();
  A.run("toggleSidebar()");
  const replie = A.el("sidebar").classList.contains("collapsed");
  A.run("toggleSidebar()");
  assert.notEqual(A.el("sidebar").classList.contains("collapsed"), replie);
});

test("navigation : changer la temporalité d'une carte mémorise le choix", () => {
  const m = fiche("Groupé", "Mensuelle"), h = fiche("Groupé", "Hebdomadaire");
  A.reset({ manualEntries: [m, h] });
  A.run("rebuildData(false); filterData();");   // filterData calcule les groupes puis rend
  const gid = A.run("Object.keys(kpiGroups)[0]");
  assert.ok(gid, "un groupe de carte a bien été construit");
  A.run(`changeGroupFreq(${JSON.stringify(gid)}, 1)`);
  assert.equal(Object.values(A.get("groupSel"))[0], h.id, "la temporalité choisie est mémorisée");
});

test("navigation : un identifiant de groupe inconnu ne provoque pas d'erreur", () => {
  A.reset();
  A.run(`changeGroupFreq("inexistant", 0)`);
  assert.ok(true);
});

test("rapports : choisir un site mémorise le choix pour la fiche", () => {
  A.reset();
  A.saisir("selTest", "armement");
  A.run(`onReportSelect("selTest", "ma-fiche")`);
  assert.equal(A.get("groupReport")["ma-fiche"], "armement");
});

test("rapports : un sélecteur absent ne provoque pas d'erreur", () => {
  A.reset();
  A.run(`onReportSelect("inexistant", "cle")`);
  assert.ok(true);
});

test("étiquettes : un KPI contractuel reçoit sa couleur dédiée", () => {
  A.reset();
  assert.match(A.run(`typeTagClass("Contractuel")`), /tag-contract/);
});

test("étiquettes : « non contractuel » n'est pas confondu avec « contractuel »", () => {
  A.reset();
  assert.match(A.run(`typeTagClass("Non contractuel")`), /noncontract/);
});

test("étiquettes : un type opérationnel est reconnu avec ou sans accent", () => {
  A.reset();
  assert.match(A.run(`typeTagClass("Opérationnel")`), /operationnel/);
  assert.match(A.run(`typeTagClass("Operationnel")`), /operationnel/);
});

test("étiquettes : un type inconnu reçoit l'apparence par défaut", () => {
  A.reset();
  assert.equal(A.run(`typeTagClass("Autre chose")`), "tag tag-type");
});

test("fenêtres : l'historique se referme", () => {
  A.reset();
  A.run("openHistoryModal(); closeHistoryModal();");
  assert.ok(A.el("historyModal").classList.contains("hidden"));
});

test("surcharges : le système obsolète est bien neutralisé", () => {
  A.reset();
  A.run(`localStorage.setItem("kpiOverrides", JSON.stringify({ x: { title: "vestige" } })); loadOverrides();`);
  assert.deepEqual(A.get("overrides"), {}, "plus aucune surcharge n'est rechargée");
});
