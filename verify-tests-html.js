/* Vérifie tests.html hors navigateur : extrait son script et l'exécute
   avec un DOM, un fetch et une horloge simulés, puis lit le résultat affiché. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync("tests.html", "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.log("✗ aucun script trouvé dans tests.html"); process.exit(1); }
const script = m[1];

/* --- DOM simulé, avec registre persistant par identifiant --- */
const registre = new Map();
function elem(tag, id) {
  const el = {
    tagName: (tag || "div").toUpperCase(), id: id || "",
    textContent: "", innerHTML: "", value: "", children: [], style: {}, dataset: {},
    _cls: new Set(),
    classList: {
      add: c => el._cls.add(c), remove: c => el._cls.delete(c),
      contains: c => el._cls.has(c),
      toggle: (c, f) => (f === undefined ? (el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c))
                                         : (f ? el._cls.add(c) : el._cls.delete(c)))
    },
    get className() { return [...el._cls].join(" "); },
    set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.unshift(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); return c; },
    get firstChild() { return el.children[0] || null; },
    click() {}, blur() {}, scrollTo() {}, closest() { return null; },
    getAttribute() { return null; },
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; },
    querySelector() { return null; }, focus() {}, remove() {}
  };
  return el;
}
const documentSim = {
  getElementById(id) { if (!registre.has(id)) registre.set(id, elem("div", id)); return registre.get(id); },
  createElement: tag => elem(tag),
  querySelectorAll: () => [],
  addEventListener() {}
};

const sandbox = {
  console,
  document: documentSim,
  location: { href: "https://test/tests.html", reload() {} },
  performance: { now: () => Date.now() },
  navigator: { userAgent: "Vérificateur Node", onLine: true, clipboard: { writeText: async () => {} },
               serviceWorker: { register: async () => {} } },
  setTimeout, clearTimeout, setInterval,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
  fetch: async (url) => {
    const f = String(url).split("?")[0];
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true, status: 200,
      text: async () => fs.readFileSync(p, "utf8"),
      arrayBuffer: async () => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
    };
  }
};
sandbox.Uint8Array = Uint8Array; sandbox.DataView = DataView;
sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
sandbox.Blob = Blob; sandbox.DecompressionStream = DecompressionStream;
/* La dérivation compresse et décompresse les états : le contexte doit
   offrir ce que le navigateur offre, sans quoi le banc mesurerait autre
   chose que la page réelle. */
sandbox.CompressionStream = CompressionStream;
sandbox.Response = Response; sandbox.atob = atob; sandbox.btoa = btoa;
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);

try { vm.runInContext(script, sandbox, { filename: "tests.html" }); }
catch (e) { console.log("✗ erreur à l'exécution du script :", e.message); process.exit(1); }

/* Attend la fin, puis lit ce que la page affiche */
setTimeout(() => {
  const etat = registre.get("etatTxt");
  const cartes = registre.get("cartes");
  const texteEtat = etat ? etat.textContent : "(aucun état)";
  console.log("État affiché :", texteEtat);

  const nombres = cartes ? [...cartes.innerHTML.matchAll(/class="n [^"]*">([^<]+)</g)].map(x => x[1]) : [];
  if (nombres.length >= 3) console.log(`Tests : ${nombres[0]} · Réussis : ${nombres[1]} · Échoués : ${nombres[2]} · Durée : ${nombres[4] || "?"}`);

  /* Détail des échecs */
  const echecs = [];
  (function parcourir(n) {
    (n.children || []).forEach(c => {
      if (c.innerHTML && c.innerHTML.indexOf('puce ko') >= 0) {
        const nom = (c.innerHTML.match(/class="nom">([^<]+)/) || [])[1] || "?";
        const msg = (c.innerHTML.match(/class="msg">([^<]*)/) || [])[1] || "";
        echecs.push(nom.trim() + "  →  " + msg);
      }
      parcourir(c);
    });
  })(registre.get("sortie") || { children: [] });
  if (echecs.length) { console.log("\nTests en échec :"); echecs.slice(0, 25).forEach(e => console.log("  ✗ " + e)); }

  const ko = nombres.length >= 3 ? parseInt(nombres[2], 10) : 1;
  process.exit(ko === 0 && parseInt(nombres[0], 10) > 0 ? 0 : 1);
}, 12000);
