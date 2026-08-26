/* Vérifie le mode « données réelles » de tests.html :
   fournit une mémoire locale et un cloud réalistes, lance l'analyse,
   et contrôle que les écarts sont correctement détectés. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const script = fs.readFileSync("tests.html", "utf8").match(/<script>([\s\S]*)<\/script>/)[1];

/* --- DOM simulé --- */
const registre = new Map();
function elem(tag, id) {
  const el = {
    tagName: (tag || "div").toUpperCase(), id: id || "", textContent: "", innerHTML: "",
    value: "", disabled: false, children: [], style: {}, dataset: {}, _cls: new Set(),
    classList: {
      add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c),
      toggle: (c, f) => (f === undefined ? (el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c))
                                         : (f ? el._cls.add(c) : el._cls.delete(c)))
    },
    get className() { return [...el._cls].join(" "); },
    set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.unshift(c); return c; },
    get firstChild() { return el.children[0] || null; },
    addEventListener(ev, fn) { (el._ev = el._ev || {})[ev] = fn; },
    setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, focus() {}, remove() {}
  };
  return el;
}
const tete = elem("head");
const documentSim = {
  getElementById(id) { if (!registre.has(id)) registre.set(id, elem("div", id)); return registre.get(id); },
  createElement: tag => elem(tag),
  querySelectorAll: () => [],
  addEventListener() {},
  head: tete
};

/* --- Données locales réalistes, avec anomalies volontaires --- */
const fiche = (t, f, extra) => Object.assign(
  { id: "kpi_" + t.toLowerCase().replace(/\W+/g, "_") + "_" + f.toLowerCase(),
    manual: true, title: t, freq: f, _mtime: 1000 }, extra || {});

const SAIN = process.argv.includes("--sain");

const localFiches = SAIN ? [
  fiche("Volumétrie distribution", "Mensuelle", { logistiport: "https://a" }),
  fiche("Taux service", "Mensuelle", { logistiport: "https://c" })
] : [
  fiche("Volumétrie distribution", "Mensuelle", { logistiport: "https://a", armement: "https://mg" }),
  fiche("Volumétrie distribution", "Hebdomadaire", { logistiport: "https://b" }),
  fiche("Taux service", "Mensuelle", { logistiport: "https://c" }),
  fiche("Seulement ici", "Mensuelle", { logistiport: "https://d" }),   // absente du cloud
  { id: "kpi_sans_lien_mensuelle", manual: true, title: "Sans lien", freq: "Mensuelle", _mtime: 900 },
  { id: "kpi_doublon_a", manual: true, title: "Doublon", freq: "Mensuelle", _mtime: 800, logistiport: "x" },
  { id: "kpi_doublon_b", manual: true, title: "Doublon", freq: "Mensuelle", _mtime: 810, logistiport: "y" }
];
const memoire = {
  kpiUser: "marie",
  kpiManualEntries: JSON.stringify(localFiches),
  kpiDeletedIds: JSON.stringify(SAIN ? [] : [{ id: "kpi_disparue", title: "Disparue", at: 500, state: "deleted" }]),
  kpiPurgedIds: JSON.stringify(SAIN ? [] : ["kpi_purgee_ailleurs"]),
  kpiLocalUpdatedAt: String(Date.now() - 60000),
  kpiSnapshots: JSON.stringify([{ at: Date.now() - 3600000, reason: "essai", counts: { kpis: 2, variantes: 2 } }]),
  kpiSyncConfig: JSON.stringify({ config: { projectId: "annuaire-kpi" }, code: "idea-kpi-2026" }),
  kpiActivity: JSON.stringify([{ at: Date.now(), by: "marie", action: "create", title: "K" }]),
  kpiSites: JSON.stringify(SAIN
    ? [{ key: "logistiport", name: "Logistiport", _mtime: 1 }]
    : [{ key: "logistiport", name: "Logistiport", _mtime: 1 },
       { key: "armement", name: "MG + Débords", _mtime: 1 }]),
  kpiMigratedV2: "1"
};
const stockageSim = {
  getItem: k => (memoire[k] === undefined ? null : memoire[k]),
  setItem: (k, v) => { memoire[k] = String(v); },
  removeItem: k => { delete memoire[k]; },
  key: i => Object.keys(memoire)[i],
  get length() { return Object.keys(memoire).length; }
};

/* --- Cloud simulé : contient une fiche de plus, une divergente, une de moins --- */
const cloudFiches = SAIN ? JSON.parse(JSON.stringify(localFiches)) : [
  Object.assign({}, localFiches[0], { armement: "https://MG-DIFFERENT" }),  // divergente
  localFiches[1],
  localFiches[2],
  fiche("Seulement dans le cloud", "Mensuelle", { logistiport: "https://e" }),
  { id: "kpi_purgee_ailleurs", manual: true, title: "Fantôme purgé", freq: "Mensuelle", _mtime: 500 }
];
const docCloud = {
  kpiManual: cloudFiches, kpiDeleted: [], kpiPurged: [],
  kpiSites: SAIN ? [{ key: "logistiport", name: "Logistiport", _mtime: 1 }]
                 : [{ key: "logistiport", name: "Logistiport", _mtime: 1 },
                    { key: "armement", name: "MG + Débords", _mtime: 1 }],
  updatedAt: Date.now()
};
let ecritures = 0, suppressions = 0;
const docs = {};                 // documents du faux Firestore
const ecoutes = [];              // abonnements temps réel
const firebaseSim = {
  apps: [],
  initializeApp() { firebaseSim.apps = [{}]; return {}; },
  firestore: Object.assign(function () {
    return {
      collection: (col) => ({
        doc: (id) => {
          const cle = col + "/" + id;
          return {
            async get() {
              await new Promise(r => setTimeout(r, 4));   // latence réseau simulée
              if (id.indexOf("__autotest") >= 0) return { exists: true, data: () => ({ jeton: firebaseSim.__jeton }) };
              if (docs[cle] !== undefined) return { exists: true, data: () => JSON.parse(JSON.stringify(docs[cle])) };
              if (cle.indexOf("__scenario") < 0 && id === "idea-kpi-2026") return { exists: true, data: () => docCloud };
              return { exists: false, data: () => undefined };
            },
            async set(p) {
              await new Promise(r => setTimeout(r, 6));   // latence réseau simulée
              ecritures++;
              if (id.indexOf("__autotest") >= 0) { firebaseSim.__jeton = p.jeton; return; }
              docs[cle] = JSON.parse(JSON.stringify(p));
              ecoutes.filter(e => e.cle === cle)
                     .forEach(e => e.cb({ exists: true, data: () => JSON.parse(JSON.stringify(docs[cle])) }));
            },
            async delete() { suppressions++; delete docs[cle]; },
            onSnapshot(cb) {
              const abo = { cle, cb };
              ecoutes.push(abo);
              return function () { const i = ecoutes.indexOf(abo); if (i >= 0) ecoutes.splice(i, 1); };
            }
          };
        }
      })
    };
  }, { FieldValue: { serverTimestamp: () => ({ toMillis: () => Date.now() }) } })
};

const sandbox = {
  console,
  document: documentSim,
  localStorage: stockageSim,
  firebase: firebaseSim,
  location: { href: "https://ranceclementidea.github.io/Annuaire-KPI/tests.html",
              origin: "https://ranceclementidea.github.io", pathname: "/Annuaire-KPI/tests.html",
              protocol: "https:", reload() {} },
  performance: { now: () => Date.now() },
  navigator: { userAgent: "Vérificateur", onLine: true, clipboard: { writeText: async () => {} },
               serviceWorker: { register: async () => {} } },
  setTimeout, clearTimeout, setInterval,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
  fetch: async (url) => {
    const f = String(url).split("?")[0];
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => fs.readFileSync(p, "utf8") };
  }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "tests.html" });

/* On attend la fin de la suite en bac à sable, puis on lance l'analyse réelle */
setTimeout(async () => {
  try {
    await sandbox.analyseReelle(true);   // avec test d'écriture
  } catch (e) {
    console.log("✗ l'analyse réelle a échoué :", e.message);
    process.exit(1);
  }

  /* Batterie de scénarios de synchronisation */
  try { await sandbox.scenariosSynchro(); }
  catch (e) { console.log("✗ les scénarios ont échoué :", e.message); process.exit(1); }

  const cartes = registre.get("cartesR").innerHTML;
  const nb = [...cartes.matchAll(/class="n [^"]*">([^<]+)</g)].map(x => x[1]);
  console.log("État :", registre.get("etatR").innerHTML.replace(/<[^>]+>/g, ""));
  console.log(`Contrôles : ${nb[0]} · Conformes : ${nb[1]} · À vérifier : ${nb[2]} · Problèmes : ${nb[3]}`);

  /* Détail par ligne */
  const lignes = [];
  (function parcourir(n) {
    (n.children || []).forEach(c => {
      if (c.innerHTML && c.innerHTML.indexOf('class="puce') >= 0) {
        const etat = c.innerHTML.indexOf('puce ok') >= 0 ? "OK"
                   : c.innerHTML.indexOf('puce warn') >= 0 ? "!!" : "KO";
        const nom = (c.innerHTML.match(/class="nom">([^<]+)/) || [])[1] || "?";
        lignes.push({ etat, nom: nom.trim(), html: c.innerHTML });
      }
      parcourir(c);
    });
  })(registre.get("sortieR"));

  console.log("\nDétail des contrôles en échec :");
  lignes.filter(l => l.etat !== "OK").forEach(l => {
    const d = (l.html.match(/class="detail">([\s\S]*?)<\/div>/) || [])[1] || "";
    if (d) console.log("   ▸ " + l.nom + " :: " + d.replace(/<br>/g, " || ").replace(/<[^>]+>/g, "").slice(0, 300));
  });
  console.log("\nContrôles signalés :");
  lignes.filter(l => l.etat !== "OK").forEach(l => console.log("  " + l.etat + "  " + l.nom));

  /* Vérifications attendues sur ce jeu de données volontairement défectueux */
  const trouve = (motif) => lignes.find(l => l.nom.indexOf(motif) >= 0);
  const controles = SAIN ? [
    ["aucun écart signalé dans la comparaison",
      !lignes.some(l => l.etat !== "OK" && l.nom.indexOf("Fiches") >= 0)],
    ["aucune anomalie de temporalité", trouve("Cohérence des temporalités")?.etat === "OK"],
    ["aucun marqueur orphelin", trouve("Marqueurs de corbeille")?.etat === "OK"],
    ["toutes les fiches ont un lien", trouve("au moins un lien")?.etat === "OK"],
    ["périmètres alignés", trouve("Périmètres identiques")?.etat === "OK"],
    ["aucun problème bloquant", nb[3] === "0"]
  ] : [
    ["détecte la fiche absente du cloud", trouve("absentes du cloud")?.html.includes("Seulement ici")],
    ["détecte la fiche absente d'ici", trouve("absentes de cet appareil")?.html.includes("Seulement dans le cloud")],
    ["détecte la fiche divergente", trouve("identiques des deux côtés")?.html.includes("armement")],
    ["détecte le doublon de temporalité", trouve("Cohérence des temporalités")?.html.includes("double")],
    ["détecte la fiche sans lien", trouve("au moins un lien")?.html.includes("Sans lien")],
    ["détecte le marqueur orphelin", trouve("Marqueurs de corbeille")?.html.includes("1")],
    ["compte correctement les KPIs", trouve("Nombre de KPIs")?.html.includes("<b>5</b>")],
    ["détecte la fiche fantôme dans le cloud", trouve("fiche fantôme")?.html.includes("Fantôme purgé")],
    ["détecte l'écart de suppressions définitives", trouve("Suppressions définitives alignées")?.etat === "!!"],
    ["signale les liens mal formés ou leur absence", !!trouve("Liens de rapport bien formés")],
    ["contrôle l'unicité des identifiants", trouve("Identifiants uniques")?.etat === "OK"],
    ["mesure le volume envoyé", !!trouve("Volume envoyé")],
    ["le test d'écriture a bien écrit", ecritures > 0],
    ["le document de test a été effacé", suppressions > 0],
    ["scénario : les deux appareils se connectent", trouve("deux appareils se connectent")?.etat === "OK"],
    ["scénario : l'envoi vers le cloud aboutit", trouve("envoie sa fiche au cloud")?.etat === "OK"],
    ["scénario : le second appareil reçoit", trouve("reçoit la fiche de A")?.etat === "OK"],
    ["scénario : la modification remonte", trouve("modification de B remonte")?.etat === "OK"],
    ["scénario : aucun doublon", trouve("Aucun doublon après")?.etat === "OK"],
    ["scénario : la modification locale non envoyée est préservée", trouve("pas encore envoyée n'est pas écrasée")?.etat === "OK"],
    ["scénario : elle finit par arriver sur l'autre appareil", trouve("finit bien par arriver")?.etat === "OK"],
    ["scénario : la suppression se propage", trouve("disparaît aussi sur B")?.etat === "OK"],
    ["scénario : la restauration se propage", trouve("revient sur les deux appareils")?.etat === "OK"],
    ["scénario : les périmètres coexistent", trouve("périmètres ajoutés en parallèle")?.etat === "OK"],
    ["scénario : le travail hors-ligne remonte", trouve("créée hors-ligne remonte")?.etat === "OK"],
    ["scénario : réception automatique", trouve("reçue automatiquement")?.etat === "OK"],
    ["scénario : convergence des deux appareils", trouve("strictement identiques")?.etat === "OK"],
    ["scénario : nettoyage effectué", trouve("Documents de test supprimés")?.etat === "OK"],
    ["simultané : deux écoutes actives en parallèle", trouve("écoutent le cloud en même temps")?.etat === "OK"],
    ["simultané : trois appareils sans perte", trouve("Trois appareils écrivant")?.etat === "OK"],
    ["simultané : les trois convergent", trouve("trois appareils finissent identiques")?.etat === "OK"],
    ["simultané : verrou anti-chevauchement", trouve("ne se chevauchent pas")?.etat === "OK"],
    ["intégrité : données locales intactes", trouve("données locales sont restées intactes")?.etat === "OK"],
    ["intégrité : document principal non modifié", trouve("pas été modifié")?.etat === "OK"],
    ["concurrence : rien n'est définitivement perdu", trouve("retrouve les deux créations")?.etat === "OK"],
    ["concurrence : même résultat sur les deux appareils", trouve("aboutissent au même résultat")?.etat === "OK"],
    ["concurrence : rafale d'envois sans corruption", trouve("rafale d'envois")?.etat === "OK"],
    ["concurrence : démarrage simultané", trouve("marchent pas dessus")?.etat === "OK"],
    ["concurrence : état final identique", trouve("État final identique")?.etat === "OK"],
    ["concurrence : aucun doublon", trouve("doublon créé par la concurrence")?.etat === "OK"],
    ["vos données locales restent intactes", trouve("données locales sont restées intactes")?.etat === "OK"],
    ["votre document principal n'est pas touché", trouve("document de synchronisation n'a pas été modifié")?.etat === "OK"]
  ];
  console.log("\nVérifications du diagnostic :");
  let ko = 0;
  controles.forEach(([nom, ok]) => { console.log("  " + (ok ? "✓" : "✗") + " " + nom); if (!ok) ko++; });
  console.log(ko ? `\n✗ ${ko} vérification(s) en échec` : "\n✓ Le diagnostic réel détecte correctement tous les écarts");
  process.exit(ko ? 1 : 0);
}, 14000);
