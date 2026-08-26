/* Contrôle d'étanchéité de la copie d'essai : elle doit vivre à côté de
   l'annuaire réel sans jamais lire ni écrire ses données.

   Prérequis : npx playwright install chromium
   Lancement : node smoke-essai.js   (sert le dossier sur le port 8921)  */
let chromium;
try { ({ chromium } = require("playwright")); }
catch {
  console.log("Playwright absent — installez-le puis relancez :\n  npm i -D playwright && npx playwright install chromium");
  process.exit(0);
}
const fs = require("node:fs"), http = require("node:http"), pm = require("node:path");
const DIR = "/home/claude/Annuaire-KPI";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png",
                ".json":"application/json", ".pptx":"application/octet-stream", ".ico":"image/x-icon",
                ".svg":"image/svg+xml", ".xlsx":"application/octet-stream" };
const srv = http.createServer((q, r) => {
  // Page neutre : sert à relire le VRAI stockage, hors de la cloison
  if (q.url.split("?")[0] === "/vide.html") {
    r.writeHead(200, { "Content-Type": "text/html" });
    return r.end("<!doctype html><title>vide</title>");
  }
  const f = pm.join(DIR, decodeURIComponent(q.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": TYPES[pm.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});

const FICHES = [
  { id: "kpi_reel", manual: true, title: "KPI DE PRODUCTION", freq: "Hebdomadaire", ritual: "COPIL",
    type: "Contractuel", process: "Distribution", _mtime: 100, _by: "clement",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&width=1253&height=528&bookmarkGuid=aaa-111" }
];

(async () => {
  await new Promise(ok => srv.listen(8921, "127.0.0.1", ok));
  const b = await chromium.launch();
  const c = await b.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 950 } });
  const p = await c.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  /* Le VRAI stockage se lit depuis un onglet neuf de la même origine :
     la copie d'essai, elle, ne voit que sa cloison. */
  const surPageNeuve = async fn => {
    const q = await c.newPage();
    await q.goto("http://127.0.0.1:8921/vide.html").catch(() => {});
    const r = await q.evaluate(fn);
    await q.close();
    return r;
  };
  const clesReelles = () => surPageNeuve(() => {
    const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out;
  });
  const valeurReelle = async cle => { const q = await c.newPage();
    await q.goto("http://127.0.0.1:8921/vide.html").catch(() => {});
    const r = await q.evaluate(k => localStorage.getItem(k), cle); await q.close(); return r; };

  const etape = async (n, fn) => { try { await fn(); console.log("  ✓ " + n); }
    catch (e) { console.log("  ✗ " + n + " → " + String(e.message).split("\n")[0]); process.exitCode = 1; } };

  // ── L'annuaire RÉEL, avec ses données ──
  await p.addInitScript(([f]) => {
    localStorage.setItem("kpiUser", "clement");
    localStorage.setItem("kpiManualEntries", JSON.stringify(f));
    localStorage.setItem("kpiSyncOptOut", "1");
  }, [FICHES]);
  await p.goto("http://127.0.0.1:8921/index.html");
  await p.waitForTimeout(1500);

  await etape("l'annuaire réel affiche sa fiche", async () => {
    const t = await p.textContent("#kpiContainer");
    if (!/PRODUCTION/i.test(await p.evaluate(() => document.querySelector(".card").innerHTML)))
      throw new Error("fiche absente");
  });

  // ── La COPIE D'ESSAI, même origine ──
  await etape("la copie d'essai ne voit pas les fiches de production", async () => {
    await p.goto("http://127.0.0.1:8921/annuaire-test.html");
    await p.waitForTimeout(1500);
    const cartes = await p.locator("#kpiContainer .card").count();
    if (cartes !== 0) throw new Error("cartes visibles : " + cartes);
    const ecran = await p.locator("#loginScreen").isVisible();
    if (!ecran) throw new Error("elle devrait demander une connexion, comme un appareil neuf");
  });

  await etape("la bannière signale la copie d'essai et son code", async () => {
    const t = await p.textContent(".essai-banniere");
    if (!/idea-kpi-essai/.test(t)) throw new Error(t);
  });

  await etape("le stockage de la copie est préfixé", async () => {
    await p.fill("#usernameInput", "essai");
    await p.click("#loginBtn");
    await p.waitForTimeout(1500);
    const cles = await clesReelles();
    const sansPrefixe = cles.filter(k => k.indexOf("essai:") !== 0);
    if (!cles.some(k => k.indexOf("essai:") === 0)) throw new Error("aucune clé préfixée : " + cles.join(","));
    if (!sansPrefixe.includes("kpiManualEntries")) throw new Error("la clé de production a disparu !");
    console.log("      → " + cles.filter(k => k.startsWith("essai:")).length + " clé(s) d'essai, "
                + sansPrefixe.length + " clé(s) de production intactes");
  });

  await etape("la synchronisation de la copie vise le code dédié", async () => {
    const cfg = await p.evaluate(() => JSON.parse(localStorage.getItem("kpiSyncConfig") || "{}"));
    if (cfg.code !== "idea-kpi-essai") throw new Error("code : " + cfg.code);
  });

  await etape("créer une fiche dans la copie ne touche pas la production", async () => {
    await p.evaluate(() => {
      manualEntries = [{ id: "kpi_essai", manual: true, title: "KPI D'ESSAI", freq: "Hebdomadaire",
        ritual: "COPIL", type: "Contractuel", process: "Réception", _mtime: 200, _by: "essai",
        logistiport: "https://app.powerbi.com/groups/me/reports/r1/p2?pbi_source=shareVisual&visual=v2&width=1253&height=528&bookmarkGuid=bbb-222" }];
      saveManualEntries(false); rebuildData(false);
    });
    await p.waitForTimeout(400);
    const prod = await valeurReelle("kpiManualEntries");
    if (!/PRODUCTION/.test(prod)) throw new Error("les fiches de production ont été altérées");
    if (/ESSAI/.test(prod)) throw new Error("la fiche d'essai a fui dans la production");
  });

  await etape("la génération du PowerPoint fonctionne dans la copie", async () => {
    await p.click("#selectionModeBtn"); await p.waitForTimeout(300);
    await p.click("#selectAllBtn"); await p.waitForTimeout(300);
    await p.click("#deckBtn"); await p.waitForTimeout(500);
    /* Sans empreinte, le garde-fou demande confirmation avant de produire
       un support muet : c'est précisément son rôle. On accepte, car c'est
       la chaîne complète — complément et signet — qu'on éprouve ici. */
    p.once("dialog", d => d.accept());
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), p.click("#deckGenerateBtn")]);
    await dl.saveAs("/tmp/essai.pptx");
    const buf = fs.readFileSync("/tmp/essai.pptx");
    if (buf.indexOf(Buffer.from("webextension1.xml")) < 0) throw new Error("aucun complément");
    console.log("      → " + dl.suggestedFilename() + " (" + Math.round(buf.length / 1024) + " Ko)");
  });

  await etape("le signet du KPI est bien appliqué dans le fichier produit", async () => {
    const { execSync } = require("node:child_process");
    const out = execSync("node outils/verifier-deck.js /tmp/essai.pptx || true",
                         { cwd: DIR, encoding: "utf8" });
    if (!/signet bbb-222/.test(out)) throw new Error(out.slice(0, 300));
  });

  await etape("l'annuaire réel est intact après tout cela", async () => {
    await p.goto("http://127.0.0.1:8921/index.html");
    await p.waitForTimeout(1500);
    const html = await p.evaluate(() => document.querySelector(".card").innerHTML);
    if (!/PRODUCTION/i.test(html)) throw new Error("la fiche de production a disparu");
    const n = await p.locator("#kpiContainer .card").count();
    if (n !== 1) throw new Error("cartes : " + n);
  });

  await etape("aucune erreur JavaScript hors réseau", async () => {
    const vraies = errs.filter(e => !/firebase|gstatic|net::ERR|Failed to (load|fetch)|Unexpected token '<'/i.test(e));
    if (vraies.length) throw new Error(vraies.slice(0, 3).join(" | "));
  });

  await b.close(); srv.close();
  console.log(process.exitCode ? "\nLa copie d'essai n'est PAS étanche." : "\nLa copie d'essai est étanche à la production.");
})();
