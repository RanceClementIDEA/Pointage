/* Contrôle de bout en bout dans un VRAI navigateur : ce que les tests Node
   ne peuvent pas voir — les boutons de index.html, les écouteurs, la fenêtre
   de génération et le téléchargement réel du .pptx.

   Prérequis : npx playwright install chromium
   Lancement : node smoke-ui.js   (sert le dossier sur le port 8899)  */
let chromium;
try { ({ chromium } = require("playwright")); }
catch {
  console.log("Playwright absent — installez-le puis relancez :\n  npm i -D playwright && npx playwright install chromium");
  process.exit(0);
}
const http = require("node:http");
const pathmod = require("node:path");
const fs = require("node:fs");

const FICHES = [
  { id: "kpi_volumetrie_hebdomadaire", manual: true, title: "Volumétrie Logistiport", freq: "Hebdomadaire",
    ritual: "COPIL", type: "Contractuel", process: "Distribution", _mtime: 100, _by: "clement",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1" },
  { id: "kpi_taux_service_hebdomadaire", manual: true, title: "Taux de service réception", freq: "Hebdomadaire",
    ritual: "COPIL", type: "Contractuel", process: "Réception", _mtime: 100, _by: "clement",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p2?pbi_source=shareVisual&visual=v2" },
  { id: "kpi_anticipation_mensuelle", manual: true, title: "Anticipation des demandes", freq: "Mensuelle",
    ritual: "Revue mensuelle", type: "Contractuel", process: "Distribution", _mtime: 100, _by: "clement",
    logistiport: "https://app.powerbi.com/groups/me/reports/r1/p3?visual=v3" }
];

/* Petit serveur statique : le protocole file:// interdit les modules et le fetch */
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css",
                ".png":"image/png", ".json":"application/json",
                ".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const serveur = http.createServer((req, res) => {
  const f = pathmod.join(__dirname, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!f.startsWith(__dirname) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[pathmod.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(ok => serveur.listen(8899, "127.0.0.1", ok));
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push("PAGEERROR " + e.message));
  page.on("console", m => { if (m.type() === "error") erreurs.push("CONSOLE " + m.text()); });

  await page.addInitScript(([fiches]) => {
    localStorage.setItem("kpiUser", "clement");
    localStorage.setItem("kpiManualEntries", JSON.stringify(fiches));
    localStorage.setItem("kpiSyncOptOut", "1");   // pas de synchro pendant le test
  }, [FICHES]);

  await page.goto("http://127.0.0.1:8899/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const etape = async (nom, fn) => {
    try { await fn(); console.log("  ✓ " + nom); }
    catch (e) { console.log("  ✗ " + nom + " → " + e.message); process.exitCode = 1; }
  };

  await etape("les empreintes livrées sont chargées au démarrage", async () => {
    // empreintes-livrees.json est déposé à côté d'index.html : rien à
    // importer, les visuels déjà relevés marchent dès le déploiement.
    const etat = await page.evaluate(() => ({
      nb: empreintes.length,
      avecEtat: empreintes.every(e => !!e.proprietes.bookmark),
      avecSignet: empreintes.every(e => e.id.split("/").length === 4)
    }));
    if (!etat.nb) throw new Error("aucune empreinte livrée n'a été chargée");
    if (!etat.avecEtat) throw new Error("une empreinte livrée n'a pas d'état sérialisé");
    if (!etat.avecSignet) throw new Error("une empreinte livrée n'est pas rattachée à un signet");
  });

  await etape("l'annuaire affiche les 3 KPI", async () => {
    const n = await page.locator("#kpiContainer .card").count();
    if (n !== 3) throw new Error("cartes affichées : " + n);
  });

  await etape("le bouton « Sélection & PowerPoint » ouvre la barre", async () => {
    await page.click("#selectionModeBtn");
    await page.waitForSelector("#selectionBar:not(.hidden)", { timeout: 3000 });
  });

  await etape("les cases à cocher apparaissent sur les cartes", async () => {
    const n = await page.locator(".card-select").count();
    if (n !== 3) throw new Error("cases affichées : " + n);
  });

  await etape("le filtre rituel + « Tout cocher » sélectionne les 2 KPI du COPIL", async () => {
    await page.selectOption("#ritualFilter", "COPIL");
    await page.waitForTimeout(200);
    await page.click("#selectAllBtn");
    await page.waitForTimeout(200);
    const t = await page.textContent("#selectionCount");
    if (!/2 KPI/.test(t)) throw new Error("compteur : " + t);
  });

  await etape("enregistrer la sélection la range dans la liste", async () => {
    page.once("dialog", d => d.accept("COPIL hebdomadaire"));
    await page.click("#presetSaveBtn");
    await page.waitForTimeout(400);
    const opts = await page.locator("#presetSelect option").allTextContents();
    if (!opts.some(o => /COPIL hebdomadaire \(2\)/.test(o))) throw new Error("liste : " + JSON.stringify(opts));
  });

  await etape("la sélection survit à un rechargement de la page", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.click("#selectionModeBtn");
    await page.waitForTimeout(200);
    await page.selectOption("#presetSelect", "preset_copil_hebdomadaire");
    await page.waitForTimeout(400);
    const t = await page.textContent("#selectionCount");
    if (!/2 KPI/.test(t)) throw new Error("compteur après rechargement : " + t);
  });

  await etape("la fenêtre de génération liste les diapositives dans l'ordre", async () => {
    await page.click("#deckBtn");
    await page.waitForSelector("#deckModal:not(.hidden)", { timeout: 3000 });
    const lignes = await page.locator("#deckList .deck-row").count();
    if (lignes !== 2) throw new Error("lignes : " + lignes);
  });

  await etape("sans empreinte, chaque ligne réclame un relevé", async () => {
    // Le lien peut être parfait : sans la mémoire du complément, PowerPoint
    // afficherait « l'objet visuel n'existe plus ». La liste doit le dire.
    const lignes = await page.locator(".deck-shot").allTextContents();
    if (!lignes.every(t => /à relever/.test(t))) throw new Error("lignes : " + JSON.stringify(lignes));
    const bilan = await page.locator("#deckWarning").textContent();
    if (!/sans empreinte/.test(bilan || "")) throw new Error("bilan : " + bilan);
  });

  await etape("relever un PowerPoint fait à la main débloque les visuels", async () => {
    // Un .pptx minimal portant les deux compléments, comme après insertion
    // manuelle depuis Power BI — fabriqué dans la page, avec ses propres outils.
    await page.evaluate(async () => {
      const comp = (rapport, page_, visuel, nom) => {
        const url = `/groups/me/reports/${rapport}/${page_}?pbi_source=shareVisual&amp;visual=${visuel}`;
        const props = [
          `<we:property name="reportUrl" value="&quot;${url}&quot;"/>`,
          `<we:property name="artifactName" value="&quot;${nom}&quot;"/>`,
          `<we:property name="bookmark" value="&quot;H4sIEtat${visuel}&quot;"/>`
        ].join("");
        return `<we:webextension><we:properties>${props}</we:properties></we:webextension>`;
      };
      // UN SEUL complément : les deux KPI vivent sur des pages différentes,
      // celui-ci ne couvre donc que le premier. La suite le vérifie.
      const octets = ZipMini.ecrireZip([
        { nom: "[Content_Types].xml", donnees: '<?xml version="1.0"?><Types></Types>' },
        { nom: "ppt/webextensions/webextension1.xml", donnees: comp("r1", "p1", "v1", "Histo empilé") },
        { nom: "ppt/webextensions/webextension2.xml", donnees: comp("r1", "p2", "v2", "Courbe") }
      ]);
      await releverEmpreintesDepuis(octets);
      renderDeckLignes();
    });
    const lignes = await page.locator(".deck-shot").allTextContents();
    if (!lignes.every(t => /⚡ visuel/.test(t))) throw new Error("lignes : " + JSON.stringify(lignes));
  });

  await etape("une empreinte ne déborde pas sur un autre visuel ni un autre signet", async () => {
    // Vérifié dans PowerPoint : huit insertions du même visuel donnent huit
    // états. L'état porte les filtres du KPI relevé, jamais ceux du voisin.
    const etats = await page.evaluate(() => {
      const base = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=";
      return {
        propre: !!Empreintes.resoudre(empreintes, base + "v1"),
        autreVisuel: Empreintes.resoudre(empreintes, base + "vAutre"),
        autreSignet: Empreintes.resoudre(empreintes, base + "v1&bookmarkGuid=zzzz")
      };
    });
    if (!etats.propre) throw new Error("le KPI relevé n'est plus reconnu");
    if (etats.autreVisuel) throw new Error("un autre visuel a emprunté à tort");
    if (etats.autreSignet) throw new Error("un autre signet a emprunté à tort");
  });

  await etape("une empreinte relevée en engendre d'autres dans un vrai navigateur", async () => {
    // La compression du navigateur (CompressionStream) est exercée pour de
    // bon : c'est elle qui produit l'état de l'empreinte déduite.
    const r = await page.evaluate(async () => {
      const base = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1";
      const etat = {
        displayName: "S", name: "BOOKMARK_NAME",
        explorationState: { version: "1.40", activeSection: "p1",
          sections: { p1: { visualContainers: { g: { t: 1 }, seg: { zone: "LOG" } }, filters: {} } },
          objects: {} }
      };
      const autre = JSON.parse(JSON.stringify(etat));
      autre.explorationState.sections.p1.visualContainers.seg = { zone: "ARM" };

      const t = Derivation.transformation(etat, autre);
      const derive = Derivation.appliquer(etat, t);
      const valeur = await Derivation.ecrireEtat(derive);
      const relu = await Derivation.lireEtat(valeur);
      return {
        zone: relu.explorationState.sections.p1.visualContainers.seg.zone,
        graphiqueIntact: relu.explorationState.sections.p1.visualContainers.g.t === 1,
        cle: Empreintes.cleVisuel(base + "&bookmarkGuid=s9")
      };
    });
    if (r.zone !== "ARM") throw new Error("segment non transposé : " + r.zone);
    if (!r.graphiqueIntact) throw new Error("le reste de l'état a été abîmé");
    if (!/\/s9$/.test(r.cle)) throw new Error("clé : " + r.cle);
  });

  await etape("le support produit embarque la mémoire du complément", async () => {
    const noms = await page.evaluate(async () => {
      const { diapos } = Selection.resoudrePreset(selectionCourante(),
        [...data, ...personalEntries], activeSites());
      const d = PptxDeck.avecEmpreinte({ lien: diapos[0].lien, vivant: true }, empreintes);
      return Object.keys(d.proprietesComplement || {});
    });
    ["artifactName", "bookmark", "initialStateBookmark"].forEach(n => {
      if (!noms.includes(n)) throw new Error(n + " absent : " + JSON.stringify(noms));
    });
  });

  await etape("le PowerPoint est réellement téléchargé", async () => {
    await page.waitForTimeout(200);
    await page.fill("#deckTitleInput", "Indicateurs MAGASINS ARMEMENT");
    await page.fill("#deckSubtitleInput", "IDEA / CHANTIERS DE L'ATLANTIQUE");
    await page.fill("#deckPeriodInput", "S30 à S33-2026");
    page.once("dialog", d => d.accept());
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.click("#deckGenerateBtn")
    ]);
    const chemin = "/tmp/telecharge-" + dl.suggestedFilename();
    await dl.saveAs(chemin);
    const taille = fs.statSync(chemin).size;
    console.log("      → " + dl.suggestedFilename() + " (" + Math.round(taille / 1024) + " Ko)");
    if (taille < 100000) throw new Error("fichier suspect : " + taille + " octets");
    // Le complément Power BI doit être dans l'archive produite
    const contenu = fs.readFileSync(chemin);
    if (contenu.indexOf(Buffer.from("webextension1.xml")) < 0) {
      throw new Error("aucune pièce de complément dans le fichier produit");
    }
  });

  await etape("aucune erreur JavaScript dans la console", async () => {
    const vraies = erreurs.filter(e => !/firebase|gstatic|net::ERR|Failed to load resource/i.test(e));
    if (vraies.length) throw new Error(vraies.slice(0, 3).join(" | "));
  });

  await nav.close();
  serveur.close();
  console.log(process.exitCode ? "\nDes contrôles ont échoué." : "\nTous les contrôles d'interface passent.");
})();
