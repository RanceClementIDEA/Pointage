/* Vérifie que le diagnostic « données réelles » lit exactement les mêmes
   emplacements de stockage que l'application. Une clé mal orthographiée
   ferait compter des fiches supprimées comme si elles existaient encore. */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const app = fs.readFileSync("app.js", "utf8");
const shell = fs.readFileSync("tests-shell.html", "utf8");

/* Clés réellement écrites/lues par l'application (littérales + constantes) */
function clesDeLApplication() {
  const cles = new Set();
  for (const m of app.matchAll(/localStorage\.(?:setItem|getItem|removeItem)\("([^"]+)"/g)) cles.add(m[1]);
  // Constantes du type : const LS_ACTIVITY = "kpiActivity";
  for (const m of app.matchAll(/const\s+LS_[A-Z_]+\s*=\s*"([^"]+)"/g)) cles.add(m[1]);
  return cles;
}

/* Clés déclarées dans l'objet CLE du diagnostic */
function clesDuDiagnostic() {
  const bloc = shell.match(/const CLE = \{([\s\S]*?)\};/);
  assert.ok(bloc, "l'objet CLE du diagnostic doit exister");
  const cles = {};
  for (const m of bloc[1].matchAll(/([A-Z_]+)\s*:\s*"([^"]+)"/g)) cles[m[1]] = m[2];
  return cles;
}

/* L'application écrit soit directement, soit via son point de passage unique
   ecrireDonnees() : les deux comptent comme « écrit au bon endroit ». */
function ecritDans(cle) {
  return app.includes(`localStorage.setItem("${cle}"`) || app.includes(`ecrireDonnees("${cle}"`);
}

const app_ = clesDeLApplication();
const diag = clesDuDiagnostic();

test("le diagnostic déclare bien toutes ses clés de stockage", () => {
  ["MANUAL", "DELETED", "PURGED", "SITES", "USER", "CONFIG", "OPTOUT"].forEach(k =>
    assert.ok(diag[k], "clé manquante dans le diagnostic : " + k));
});

test("chaque clé du diagnostic existe réellement dans l'application", () => {
  const absentes = Object.entries(diag).filter(([, v]) =>
    !app_.has(v) && ![...app_].some(k => k.startsWith(v)) && !app.includes('"' + v + '"'));
  assert.deepEqual(absentes, [], "clés introuvables dans app.js : " + JSON.stringify(absentes));
});

test("les fiches partagées sont lues au bon endroit", () => {
  assert.equal(diag.MANUAL, "kpiManualEntries");
  assert.ok(ecritDans("kpiManualEntries"), "l'application écrit bien à cet endroit");
});

test("la corbeille est lue au bon endroit", () => {
  assert.equal(diag.DELETED, "kpiDeletedIds");
  assert.ok(ecritDans("kpiDeletedIds"));
});

test("les suppressions définitives sont lues au bon endroit", () => {
  assert.equal(diag.PURGED, "kpiPurgedIds",
    "sinon les fiches supprimées définitivement seraient comptées comme présentes");
  assert.ok(ecritDans("kpiPurgedIds"));
});

test("les périmètres sont lus au bon endroit", () => {
  assert.equal(diag.SITES, "kpiSites");
  assert.ok(ecritDans("kpiSites"));
});

test("les préfixes personnels correspondent à ceux de l'application", () => {
  assert.equal(diag.PERSO, "kpiPersonal_");
  assert.equal(diag.PERSO_TRASH, "kpiPersonalTrash_");
  assert.ok(app.includes('"kpiPersonal_" + currentUser'));
  assert.ok(app.includes('"kpiPersonalTrash_" + currentUser'));
});

test("le diagnostic masque les fiches en corbeille ET les suppressions définitives", () => {
  const bloc = shell.match(/const visibles = fiches\.filter\(([^;]+)\);/);
  assert.ok(bloc, "le filtrage des fiches visibles doit exister");
  assert.match(bloc[1], /idsSupprimes/, "la corbeille doit être exclue");
  assert.match(bloc[1], /purges/, "les suppressions définitives doivent être exclues");
});

/** Liste d'exceptions RÉELLEMENT utilisée par le garde-fou du diagnostic. */
function exceptionsDuDiagnostic() {
  const bloc = shell.match(/const inconnues = clesPresentes\.filter\([\s\S]*?\.indexOf\(k\) < 0\);/);
  assert.ok(bloc, "le garde-fou du diagnostic doit exister");
  return new Set([...bloc[0].matchAll(/"(kpi[A-Za-z0-9_]*)"/g)].map(m => m[1]));
}

test("aucune clé de stockage de l'application n'est oubliée sans raison", () => {
  const utilisees = new Set(Object.values(diag));
  const ignorees = exceptionsDuDiagnostic();
  const oubliees = [...app_].filter(k => !utilisees.has(k) && !ignorees.has(k));
  assert.deepEqual(oubliees, [], "clés de l'application non prises en compte : " + JSON.stringify(oubliees));
});

test("le garde-fou du diagnostic ne signalera aucun emplacement légitime", () => {
  // Reproduit exactement le calcul fait par le diagnostic sur un appareil réel :
  // toute clé écrite par l'application doit être soit déclarée, soit explicitement ignorée.
  const declarees = Object.values(diag);
  const ignorees = exceptionsDuDiagnostic();
  const signalees = [...app_].filter(k =>
    k.indexOf("kpi") === 0 &&
    declarees.every(v => k !== v && k.indexOf(v) !== 0) &&
    !ignorees.has(k));
  assert.deepEqual(signalees, [],
    "ces emplacements apparaîtraient comme « inconnus » dans le diagnostic : " + JSON.stringify(signalees));
});

test("l'espace personnel synchronisé est déclaré dans le diagnostic", () => {
  assert.equal(diag.PERSO_MAP, "kpiPersonalByUser");
  assert.equal(diag.PERSO_MAP_TRASH, "kpiPersonalTrashByUser");
  assert.equal(diag.PERSO_SYNC, "kpiPersonalSync");
  assert.ok(app.includes("kpiPersonalByUser"), "l'application utilise bien cet emplacement");
});
