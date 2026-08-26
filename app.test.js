/* Tests portant sur les fonctions RÉELLES d'app.js (chargé via le harnais).
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./app-harness.js");

const A = loadApp();   // une instance partagée, réinitialisée à chaque test

/* ═══ Normalisation des intitulés (titleKey) ═══ */

test("titleKey : la casse n'influe pas sur le regroupement", () => {
  assert.equal(A.titleKey("Taux Service"), A.titleKey("taux service"));
});

test("titleKey : les espaces de début et de fin sont ignorés", () => {
  assert.equal(A.titleKey("  Taux service  "), "taux service");
});

test("titleKey : les espaces multiples internes sont normalisés", () => {
  assert.equal(A.titleKey("Volumétrie   distribution"), A.titleKey("Volumétrie distribution"));
});

test("titleKey : une tabulation compte comme un espace", () => {
  assert.equal(A.titleKey("Taux\tservice"), "taux service");
});

test("titleKey : une valeur absente ne provoque pas d'erreur", () => {
  assert.equal(A.titleKey(null), "");
  assert.equal(A.titleKey(undefined), "");
});

test("titleKey : les accents restent significatifs (intitulés distincts)", () => {
  assert.notEqual(A.titleKey("Volumetrie"), A.titleKey("Volumétrie"));
});

/* ═══ Identifiants stables (slugifyId) ═══ */

test("slugifyId : accents et majuscules sont neutralisés", () => {
  assert.equal(A.slugifyId("Volumétrie Distribution"), "volumetrie_distribution");
});

test("slugifyId : la ponctuation devient un séparateur unique", () => {
  assert.equal(A.slugifyId("Taux (service) — 2026"), "taux_service_2026");
});

test("slugifyId : deux écritures d'un même intitulé donnent le même identifiant", () => {
  assert.equal(A.slugifyId("  Taux  Service "), A.slugifyId("taux service"));
});

test("slugifyId : une chaîne vide reste exploitable", () => {
  assert.equal(A.slugifyId(""), "vide");
  assert.equal(A.slugifyId(null), "vide");
});

test("slugifyId : les identifiants ne contiennent que des caractères sûrs", () => {
  assert.match(A.slugifyId("Coût & Délai / Qualité"), /^[a-z0-9_]+$/);
});

/* ═══ Comptage KPIs vs variantes ═══ */

test("countFiches : trois temporalités d'un même KPI comptent pour 1", () => {
  const l = ["Mensuelle", "Hebdomadaire", "Quotidienne"].map(f => ({ id: "k_" + f, title: "KPI A", freq: f }));
  assert.equal(A.run(`countFiches(${JSON.stringify(l)})`), 1);
});

test("countFiches : des KPIs distincts sont comptés séparément", () => {
  const l = [{ title: "KPI A" }, { title: "KPI B" }, { title: "KPI C" }];
  assert.equal(A.run(`countFiches(${JSON.stringify(l)})`), 3);
});

test("countFiches : les écritures différentes d'un même intitulé ne gonflent pas le total", () => {
  const l = [{ title: "Taux service" }, { title: "taux  service" }, { title: " TAUX SERVICE " }];
  assert.equal(A.run(`countFiches(${JSON.stringify(l)})`), 1);
});

test("countFiches : une liste vide donne zéro", () => {
  assert.equal(A.run("countFiches([])"), 0);
});

/* ═══ Échappement HTML (sécurité) ═══ */

test("esc : les chevrons sont neutralisés", () => {
  assert.equal(A.esc("<script>"), "&lt;script&gt;");
});

test("esc : les guillemets d'attribut sont neutralisés", () => {
  assert.ok(!A.esc('" onerror="alert(1)').includes('"'));
});

test("esc : une tentative d'injection reste inerte", () => {
  const out = A.esc('<img src=x onerror="alert(1)">');
  assert.ok(!out.includes("<img"), "aucune balise ne subsiste");
});

test("esc : les esperluettes sont échappées en premier (pas de double échappement)", () => {
  assert.equal(A.esc("a & b"), "a &amp; b");
});

test("esc : une valeur nulle ne casse pas l'affichage", () => {
  assert.equal(A.esc(null), "");
  assert.equal(A.esc(undefined), "");
});

/* ═══ Normalisation des liens ═══ */

test("normalizeUrl : une adresse sans schéma reçoit https", () => {
  assert.match(A.normalizeUrl("app.powerbi.com/report"), /^https:\/\//);
});

test("normalizeUrl : une adresse https est laissée intacte", () => {
  assert.equal(A.normalizeUrl("https://app.powerbi.com/x"), "https://app.powerbi.com/x");
});

test("normalizeUrl : une chaîne vide reste vide (pas de faux lien)", () => {
  assert.equal(A.normalizeUrl(""), "");
});

test("normalizeUrl : un pseudo-lien javascript ne reste pas exécutable", () => {
  const out = A.normalizeUrl("javascript:alert(1)");
  assert.ok(!/^javascript:/i.test(out), "ne doit pas produire un lien javascript: actif");
});

/* ═══ Suppressions : marqueurs et masquage ═══ */

test("markDeleted pose un marqueur daté et attribué", () => {
  A.reset({ currentUser: "marie" });
  A.run(`markDeleted("k1", { title: "KPI A", freq: "Mensuelle" })`);
  const d = A.get("deletedIds")[0];
  assert.equal(d.id, "k1");
  assert.equal(d.title, "KPI A");
  assert.equal(d.by, "marie");
  assert.equal(d.state, "deleted");
  assert.ok(d.at > 0, "la date doit être renseignée");
});

test("markDeleted deux fois ne crée pas deux marqueurs", () => {
  A.reset();
  A.run(`markDeleted("k1", { title: "A" }); markDeleted("k1", { title: "A" });`);
  assert.equal(A.get("deletedIds").length, 1);
});

test("isDeleted reconnaît une fiche supprimée", () => {
  A.reset({ deletedIds: [{ id: "k1", at: 5, state: "deleted" }] });
  assert.equal(A.run(`isDeleted("k1")`), true);
});

test("isDeleted ignore un marqueur de restauration", () => {
  A.reset({ deletedIds: [{ id: "k1", at: 9, state: "restored" }] });
  assert.equal(A.run(`isDeleted("k1")`), false);
});

test("isDeleted renvoie faux pour un identifiant inconnu", () => {
  A.reset();
  assert.equal(A.run(`isDeleted("inexistant")`), false);
});

/* ═══ Construction de l'affichage (rebuildData) ═══ */

test("rebuildData n'affiche que les fiches partagées visibles", () => {
  A.reset({ manualEntries: [{ id: "a", title: "A" }, { id: "b", title: "B" }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 2);
});

test("rebuildData masque les fiches en corbeille", () => {
  A.reset({
    manualEntries: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
    deletedIds: [{ id: "a", at: 5, state: "deleted" }]
  });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].id, "b");
});

test("rebuildData masque les fiches purgées", () => {
  A.reset({ manualEntries: [{ id: "a", title: "A" }], purgedIds: ["a"] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 0);
});

test("rebuildData conserve les fiches supprimées en mémoire (pour la corbeille)", () => {
  A.reset({ manualEntries: [{ id: "a", title: "A" }], deletedIds: [{ id: "a", at: 5, state: "deleted" }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("manualEntries.length"), 1, "la fiche reste stockée");
  assert.equal(A.get("data.length"), 0, "mais n'est plus affichée");
});

test("rebuildData n'inclut jamais les fiches personnelles dans l'annuaire partagé", () => {
  A.reset({ manualEntries: [{ id: "a", title: "A" }], personalEntries: [{ id: "p", title: "Privé" }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
});

/* ═══ Détection d'anomalies ═══ */

test("anomalies : une fiche saine à trois temporalités n'est pas signalée", () => {
  const l = ["Mensuelle", "Hebdomadaire", "Quotidienne"].map(f => ({ id: "k" + f, title: "KPI A", freq: f }));
  assert.equal(A.run(`findVariantAnomalies(${JSON.stringify(l)}).length`), 0);
});

test("anomalies : une temporalité en double est détectée", () => {
  const l = [{ title: "A", freq: "Mensuelle" }, { title: "A", freq: "Mensuelle" }, { title: "A", freq: "Hebdomadaire" }];
  const r = A.run(`findVariantAnomalies(${JSON.stringify(l)})`);
  assert.equal(r.length, 1);
  assert.match(r[0].reason, /double/);
});

test("anomalies : une temporalité non standard est signalée", () => {
  const l = [{ title: "A", freq: "Trimestrielle" }];
  const r = A.run(`findVariantAnomalies(${JSON.stringify(l)})`);
  assert.match(r[0].reason, /non standard/);
});

test("anomalies : une temporalité vide est signalée", () => {
  const l = [{ title: "A", freq: "" }];
  assert.equal(A.run(`findVariantAnomalies(${JSON.stringify(l)}).length`), 1);
});

test("anomalies : deux orthographes d'un même intitulé sont signalées", () => {
  const l = [{ title: "Volumétrie distribution", freq: "Mensuelle" },
             { title: "Volumétrie  distribution", freq: "Hebdomadaire" }];
  const r = A.run(`findVariantAnomalies(${JSON.stringify(l)})`);
  assert.equal(r.length, 1);
  assert.match(r[0].reason, /diffèrent/);
});

test("anomalies : plus de trois temporalités est signalé", () => {
  const l = ["Mensuelle", "Hebdomadaire", "Quotidienne"].map(f => ({ title: "A", freq: f }));
  l.push({ title: "A", freq: "Annuelle" });
  assert.ok(A.run(`findVariantAnomalies(${JSON.stringify(l)}).length`) >= 1);
});

test("anomalies : une liste vide ne signale rien", () => {
  assert.equal(A.run("findVariantAnomalies([]).length"), 0);
});

test("anomalies : plusieurs fiches défectueuses sont toutes remontées", () => {
  const l = [
    { title: "A", freq: "Mensuelle" }, { title: "A", freq: "Mensuelle" },
    { title: "B", freq: "Trimestrielle" }
  ];
  assert.equal(A.run(`findVariantAnomalies(${JSON.stringify(l)}).length`), 2);
});

/* ═══ Nettoyage des doublons ═══ */

test("nettoyage : le doublon le plus ancien est retiré", () => {
  A.reset({ manualEntries: [
    { id: "vieux", title: "A", freq: "Mensuelle", logistiport: "ancien", _mtime: 100 },
    { id: "recent", title: "A", freq: "Mensuelle", logistiport: "recent", _mtime: 300 }
  ] });
  A.run("rebuildData(false)");
  const n = A.run("cleanDuplicateVariants()");
  assert.equal(n, 1, "un doublon retiré");
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
  assert.equal(A.get("data")[0].logistiport, "recent", "la version récente est conservée");
});

test("nettoyage : les doublons partent en corbeille (récupérables)", () => {
  A.reset({ manualEntries: [
    { id: "v1", title: "A", freq: "Mensuelle", _mtime: 100 },
    { id: "v2", title: "A", freq: "Mensuelle", _mtime: 200 }
  ] });
  A.run("rebuildData(false); cleanDuplicateVariants();");
  assert.equal(A.get("deletedIds").length, 1, "un marqueur de suppression est posé");
});

test("nettoyage : une fiche saine n'est pas touchée", () => {
  A.reset({ manualEntries: ["Mensuelle", "Hebdomadaire", "Quotidienne"]
    .map((f, i) => ({ id: "k" + i, title: "A", freq: f, _mtime: 100 })) });
  A.run("rebuildData(false)");
  assert.equal(A.run("cleanDuplicateVariants()"), 0);
});

test("nettoyage : plusieurs fiches sont traitées en une passe", () => {
  A.reset({ manualEntries: [
    { id: "a1", title: "A", freq: "Mensuelle", _mtime: 100 },
    { id: "a2", title: "A", freq: "Mensuelle", _mtime: 200 },
    { id: "b1", title: "B", freq: "Hebdomadaire", _mtime: 100 },
    { id: "b2", title: "B", freq: "Hebdomadaire", _mtime: 200 }
  ] });
  A.run("rebuildData(false)");
  assert.equal(A.run("cleanDuplicateVariants()"), 2);
});

/* ═══ Étiquette de l'historique des versions ═══ */

test("historique : le nouveau format affiche KPIs et variantes", () => {
  const s = A.run(`snapCountLabel(${JSON.stringify({ kpis: 13, variantes: 39, perso: 2 })})`);
  assert.match(s, /13 KPIs/);
  assert.match(s, /39 variantes/);
});

test("historique : l'ancien format « partagees » reste lisible", () => {
  const s = A.run(`snapCountLabel(${JSON.stringify({ partagees: 39, perso: 2 })})`);
  assert.match(s, /39/);
});

test("historique : le très ancien format excel+manuel est additionné", () => {
  const s = A.run(`snapCountLabel(${JSON.stringify({ excel: 20, manual: 19 })})`);
  assert.match(s, /39/);
});

test("historique : un instantané sans détail ne provoque pas d'erreur", () => {
  assert.equal(typeof A.run("snapCountLabel(null)"), "string");
});

test("historique : sans fiche personnelle, la mention perso est omise", () => {
  const s = A.run(`snapCountLabel(${JSON.stringify({ kpis: 5, variantes: 10, perso: 0 })})`);
  assert.ok(!s.includes("perso"));
});

/* ═══ Décision d'envoi au cloud (le bug corrigé) ═══ */

test("envoi : une fiche locale absente du cloud déclenche l'envoi", () => {
  A.reset({ manualEntries: [{ id: "local", _mtime: 100 }] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({ kpiManual: [] })})`), true);
});

test("envoi : un état strictement identique au cloud n'envoie rien", () => {
  const entries = [{ id: "a", _mtime: 100 }, { id: "b", _mtime: 200 }];
  A.reset({ manualEntries: entries });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({
    kpiManual: entries, kpiDeleted: [], kpiSites: [
      { key: "logistiport", _mtime: 1 }, { key: "armement", _mtime: 1 }], kpiPurged: []
  })})`), false);
});

test("envoi : une fiche locale plus récente déclenche l'envoi", () => {
  A.reset({ manualEntries: [{ id: "a", _mtime: 500 }] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({ kpiManual: [{ id: "a", _mtime: 100 }] })})`), true);
});

test("envoi : après fusion, un apport local n'est pas masqué par une fiche distante récente", () => {
  // Reproduit le bug corrigé : le local contient la fiche distante (très récente)
  // ET une fiche créée hors-ligne (plus ancienne) absente du cloud.
  A.reset({ manualEntries: [{ id: "distante", _mtime: 9999 }, { id: "hors-ligne", _mtime: 100 }] });
  const remote = { kpiManual: [{ id: "distante", _mtime: 9999 }], kpiDeleted: [], kpiSites: [], kpiPurged: [] };
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify(remote)})`), true,
    "l'apport hors-ligne doit être détecté malgré une date locale maximale identique");
});

test("envoi : une suppression locale inconnue du cloud déclenche l'envoi", () => {
  A.reset({ deletedIds: [{ id: "x", at: 500, state: "deleted" }] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({ kpiManual: [], kpiDeleted: [] })})`), true);
});

test("envoi : un site ajouté localement déclenche l'envoi", () => {
  A.reset({ sites: [{ key: "nouveau", name: "Nouveau", _mtime: 500 }] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({
    kpiManual: [], kpiDeleted: [], kpiSites: [], kpiPurged: []
  })})`), true);
});

test("envoi : une purge locale inconnue du cloud déclenche l'envoi", () => {
  A.reset({ purgedIds: ["ancien"], sites: [] });
  assert.equal(A.run(`hasLocalDataNewerThan(${JSON.stringify({
    kpiManual: [], kpiDeleted: [], kpiSites: [], kpiPurged: []
  })})`), true);
});

/* ═══ Sites actifs ═══ */

test("activeSites exclut les sites supprimés", () => {
  A.reset({ sites: [{ key: "a", name: "A" }, { key: "b", name: "B", _deleted: true }] });
  assert.equal(A.run("activeSites().length"), 1);
});

test("activeSites conserve les sites anciens sans métadonnées", () => {
  A.reset({ sites: [{ key: "a", name: "A" }, { key: "b", name: "B" }] });
  assert.equal(A.run("activeSites().length"), 2);
});

test("activeSites tolère une liste contenant des valeurs vides", () => {
  A.reset();
  A.run("sites = [{key:'a',name:'A'}, null, undefined]");
  assert.equal(A.run("activeSites().length"), 1);
});

/* ═══ Robustesse face à des données abîmées ═══ */

test("robustesse : une fiche sans intitulé ne fait pas planter le comptage", () => {
  A.reset({ manualEntries: [{ id: "a" }, { id: "b", title: "B" }] });
  A.run("rebuildData(false)");
  assert.equal(typeof A.run("countFiches(data)"), "number");
});

test("robustesse : des marqueurs de suppression au format ancien sont acceptés", () => {
  A.reset({ manualEntries: [{ id: "a", title: "A" }] });
  A.run(`deletedIds = normalizeDeleted(["a"]); rebuildData(false);`);
  assert.equal(A.get("data.length"), 0, "l'ancien format masque bien la fiche");
});

test("robustesse : une fiche sans temporalité reste affichable", () => {
  A.reset({ manualEntries: [{ id: "a", title: "Sans temporalité" }] });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 1);
});

test("robustesse : un très grand nombre de fiches reste traité", () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({ id: "k" + i, title: "KPI " + (i % 500), freq: "Mensuelle" }));
  A.reset({ manualEntries: many });
  A.run("rebuildData(false)");
  assert.equal(A.get("data.length"), 2000);
  assert.equal(A.run("countFiches(data)"), 500);
});
