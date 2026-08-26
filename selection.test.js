/* Tests du modèle de sélection (js/selection.js) : ce qui décide
   QUELS KPI partent dans le PowerPoint, dans quel ordre, et avec
   quel lien Power BI.
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const S = require("./js/selection.js");

const SITES_SEL = [
  { key: "logistiport", name: "Logistiport", badge: "LGT" },
  { key: "armement",    name: "MG + Débords", badge: "MG+D" },
  { key: "global",      name: "Global",       badge: "GLOBAL" }
];

const FICHES_SEL = [
  { id: "kpi_volumetrie_hebdomadaire", title: "Volumétrie Distribution", freq: "Hebdomadaire",
    ritual: "COPIL", logistiport: "https://app.powerbi.com/a", global: "https://app.powerbi.com/g" },
  { id: "kpi_volumetrie_quotidienne", title: "Volumétrie Distribution", freq: "Quotidienne",
    ritual: "Point quotidien", logistiport: "https://app.powerbi.com/b" },
  { id: "kpi_taux_service_hebdomadaire", title: "Taux de service réception", freq: "Hebdomadaire",
    ritual: "COPIL", armement: "https://app.powerbi.com/c" },
  { id: "kpi_sans_lien_mensuelle", title: "KPI sans lien", freq: "Mensuelle", ritual: "COPIL" }
];

/* ─── slug ─────────────────────────────────────────────────── */

test("slug : accents et espaces donnent un identifiant stable", () => {
  assert.equal(S.slug("COPIL Hebdomadaire — Réception"), "copil_hebdomadaire_reception");
});

test("slug : deux écritures du même nom donnent le même identifiant", () => {
  assert.equal(S.slug("Point Quotidien"), S.slug("  point   quotidien  "));
});

test("slug : un nom vide ne casse pas l'identifiant", () => {
  assert.equal(S.slug(""), "sans_nom");
  assert.equal(S.slug(null), "sans_nom");
});

/* ─── normalisation ────────────────────────────────────────── */

test("une sélection accepte une simple liste d'identifiants", () => {
  const p = S.normaliserPreset({ name: "COPIL", items: ["a", "b"] });
  assert.deepEqual(p.items.map(i => i.kpiId), ["a", "b"]);
});

test("les doublons sont retirés sans changer l'ordre", () => {
  const p = S.normaliserPreset({ name: "COPIL", items: ["a", "b", "a", "c"] });
  assert.deepEqual(p.items.map(i => i.kpiId), ["a", "b", "c"]);
});

test("une entrée sans identifiant est ignorée plutôt que de produire une diapositive vide", () => {
  const p = S.normaliserPreset({ name: "COPIL", items: [{ kpiId: "" }, null, { site: "global" }, "ok"] });
  assert.deepEqual(p.items.map(i => i.kpiId), ["ok"]);
});

test("l'identifiant de sélection dérive du nom quand il n'est pas fourni", () => {
  assert.equal(S.normaliserPreset({ name: "COPIL hebdo" }).id, "preset_copil_hebdo");
});

test("une sélection sans nom reste utilisable", () => {
  const p = S.normaliserPreset({});
  assert.equal(p.name, "Sans nom");
  assert.deepEqual(p.items, []);
});

test("creerPreset applique le périmètre par défaut à chaque ligne", () => {
  const p = S.creerPreset("COPIL", ["a", "b"], { defaultSite: "global", auteur: "marie", horodatage: 5 });
  assert.deepEqual(p.items, [
    { kpiId: "a", site: "global", commentaire: "" },
    { kpiId: "b", site: "global", commentaire: "" }
  ]);
  assert.equal(p._by, "marie");
  assert.equal(p._mtime, 5);
});

/* ─── fusion multi-appareils ───────────────────────────────── */

test("deux sélections créées sur deux postes coexistent", () => {
  const r = S.fusionnerPresets(
    [S.creerPreset("COPIL", ["a"], { horodatage: 10 })],
    [S.creerPreset("Point quotidien", ["b"], { horodatage: 20 })]
  );
  assert.equal(r.length, 2);
});

test("sur une même sélection, la version la plus récente gagne", () => {
  const r = S.fusionnerPresets(
    [S.creerPreset("COPIL", ["a", "b"], { horodatage: 300 })],
    [S.creerPreset("COPIL", ["z"], { horodatage: 100 })]
  );
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].items.map(i => i.kpiId), ["a", "b"]);
});

test("une sélection distante plus récente écrase la locale périmée", () => {
  const r = S.fusionnerPresets(
    [S.creerPreset("COPIL", ["ancien"], { horodatage: 100 })],
    [S.creerPreset("COPIL", ["recent"], { horodatage: 900 })]
  );
  assert.deepEqual(r[0].items.map(i => i.kpiId), ["recent"]);
});

test("une liste distante absente ou invalide ne détruit pas les sélections locales", () => {
  const locales = [S.creerPreset("COPIL", ["a"], { horodatage: 10 })];
  assert.equal(S.fusionnerPresets(locales, null).length, 1);
  assert.equal(S.fusionnerPresets(locales, "n'importe quoi").length, 1);
});

/* ─── nettoyage des références mortes ──────────────────────── */

test("un KPI supprimé disparaît de la sélection", () => {
  const p = S.creerPreset("COPIL", ["vivant", "mort"], { horodatage: 1 });
  const r = S.nettoyerPresets([p], ["vivant"], 999);
  assert.deepEqual(r.presets[0].items.map(i => i.kpiId), ["vivant"]);
  assert.equal(r.retires, 1);
});

test("une sélection intacte n'est pas rehorodatée inutilement", () => {
  const p = S.creerPreset("COPIL", ["a"], { horodatage: 42 });
  const r = S.nettoyerPresets([p], ["a"], 999);
  assert.equal(r.presets[0]._mtime, 42);
  assert.equal(r.retires, 0);
});

test("une sélection vidée est conservée : le travail de l'utilisateur n'est jamais effacé", () => {
  const p = S.creerPreset("COPIL", ["mort"], { horodatage: 1 });
  const r = S.nettoyerPresets([p], []);
  assert.equal(r.presets.length, 1);
  assert.deepEqual(r.presets[0].items, []);
});

/* ─── résolution en diapositives ───────────────────────────── */

test("chaque KPI sélectionné devient une diapositive, dans l'ordre choisi", () => {
  const p = S.creerPreset("COPIL", ["kpi_taux_service_hebdomadaire", "kpi_volumetrie_hebdomadaire"]);
  const r = S.resoudrePreset(p, FICHES_SEL, SITES_SEL);
  assert.deepEqual(r.diapos.map(d => d.kpiId),
    ["kpi_taux_service_hebdomadaire", "kpi_volumetrie_hebdomadaire"]);
});

test("le périmètre de la ligne l'emporte sur celui de la sélection", () => {
  const p = S.normaliserPreset({
    name: "COPIL", defaultSite: "global",
    items: [{ kpiId: "kpi_volumetrie_hebdomadaire", site: "logistiport" }]
  });
  assert.equal(S.resoudrePreset(p, FICHES_SEL, SITES_SEL).diapos[0].lien, "https://app.powerbi.com/a");
});

test("le périmètre par défaut sert quand la ligne n'en précise aucun", () => {
  const p = S.normaliserPreset({
    name: "COPIL", defaultSite: "global", items: [{ kpiId: "kpi_volumetrie_hebdomadaire" }]
  });
  assert.equal(S.resoudrePreset(p, FICHES_SEL, SITES_SEL).diapos[0].lien, "https://app.powerbi.com/g");
});

test("un périmètre demandé mais absent de la fiche retombe sur un périmètre réellement renseigné", () => {
  const p = S.normaliserPreset({
    name: "COPIL", items: [{ kpiId: "kpi_taux_service_hebdomadaire", site: "logistiport" }]
  });
  const d = S.resoudrePreset(p, FICHES_SEL, SITES_SEL).diapos[0];
  assert.equal(d.site, "armement");
  assert.equal(d.lien, "https://app.powerbi.com/c");
});

test("un KPI sans aucun lien produit quand même sa diapositive, et est signalé", () => {
  const p = S.creerPreset("COPIL", ["kpi_sans_lien_mensuelle"]);
  const r = S.resoudrePreset(p, FICHES_SEL, SITES_SEL);
  assert.equal(r.diapos.length, 1);
  assert.equal(r.diapos[0].lien, "");
  assert.deepEqual(r.sansLien, ["kpi_sans_lien_mensuelle"]);
});

test("un KPI disparu de l'annuaire est signalé et n'apparaît pas dans le deck", () => {
  const p = S.creerPreset("COPIL", ["kpi_volumetrie_hebdomadaire", "kpi_fantome"]);
  const r = S.resoudrePreset(p, FICHES_SEL, SITES_SEL);
  assert.equal(r.diapos.length, 1);
  assert.deepEqual(r.manquants, ["kpi_fantome"]);
});

test("deux temporalités du même intitulé donnent deux diapositives distinctes", () => {
  const p = S.creerPreset("Mixte", ["kpi_volumetrie_hebdomadaire", "kpi_volumetrie_quotidienne"]);
  const r = S.resoudrePreset(p, FICHES_SEL, SITES_SEL);
  assert.equal(r.diapos.length, 2);
  assert.notEqual(r.diapos[0].lien, r.diapos[1].lien);
});

/* ─── titres ───────────────────────────────────────────────── */

test("le titre de diapositive reprend l'intitulé suffixé du périmètre, comme le support IDEA", () => {
  const kpi = FICHES_SEL[0];
  assert.equal(S.titreDiapo(kpi, "logistiport", SITES_SEL), "Volumétrie Distribution LGT");
});

test("le suffixe de périmètre peut être désactivé", () => {
  assert.equal(S.titreDiapo(FICHES_SEL[0], "logistiport", SITES_SEL, { suffixeSite: false }), "Volumétrie Distribution");
});

test("un périmètre inconnu n'ajoute pas de suffixe bancal", () => {
  assert.equal(S.titreDiapo(FICHES_SEL[0], "inexistant", SITES_SEL), "Volumétrie Distribution");
});

test("une fiche sans intitulé reste identifiable dans le deck", () => {
  assert.equal(S.titreDiapo({}, "", SITES_SEL), "KPI sans intitulé");
});

/* ─── nom de fichier ───────────────────────────────────────── */

test("le nom de fichier proposé porte le nom de la sélection et la date", () => {
  assert.equal(S.nomFichier({ name: "COPIL hebdo" }, "2026-08-24"), "deck-kpi-copil_hebdo-2026-08-24.pptx");
});

test("sans sélection nommée, le nom de fichier reste valide", () => {
  assert.match(S.nomFichier(null, ""), /^deck-kpi-selection\.pptx$/);
});
