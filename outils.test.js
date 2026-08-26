/* Tests des outils en ligne de commande (dossier outils/).
   Ces outils tournent sous Node uniquement, ils ne sont donc pas
   repris dans le banc de test du navigateur.
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const fsO = require("node:fs");
const pathO = require("node:path");
const osO = require("node:os");
const V = require("./outils/verifier-liens.js");

const VISUEL = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&width=1253.02&height=527.91";
const BANDEAU = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v9&width=1140.87&height=51.48";
const COURT = "https://app.powerbi.com/links/UWLu7wc3Ez?pbi_source=linkShare";

test("une sauvegarde d'annuaire est parcourue périmètre par périmètre", () => {
  const r = V.analyser({
    manualEntries: [{ id: "a", title: "Volumétrie", freq: "Hebdomadaire", logistiport: VISUEL, armement: BANDEAU }],
    sites: [{ key: "logistiport" }, { key: "armement" }]
  });
  assert.equal(r.entrees.length, 2);
  assert.deepEqual(r.entrees.map(e => e.perimetre), ["logistiport", "armement"]);
});

test("une sélection exportée est parcourue elle aussi", () => {
  const r = V.analyser({ diapos: [{ titre: "A", site: "logistiport", lien: VISUEL }] });
  assert.equal(r.entrees.length, 1);
  assert.equal(r.bons, 1);
});

test("un lien de visuel au bon format est validé", () => {
  assert.equal(V.verdict({ type: "visuel", aplati: false }).ok, true);
});

test("un lien de page est refusé : il afficherait tout le rapport", () => {
  const v = V.verdict({ type: "lien-court" });
  assert.equal(v.ok, false);
  assert.equal(v.etiquette, "PAGE");
});

test("un visuel au format très allongé est signalé pour confirmation", () => {
  const v = V.verdict({ type: "visuel", aplati: true });
  assert.equal(v.ok, false);
  assert.equal(v.etiquette, "ALLONGÉ");
});

test("le bilan compte séparément les pages et les bandeaux", () => {
  const r = V.analyser({
    manualEntries: [
      { id: "a", title: "A", logistiport: VISUEL },
      { id: "b", title: "B", logistiport: COURT },
      { id: "c", title: "C", logistiport: BANDEAU }
    ],
    sites: [{ key: "logistiport" }]
  });
  assert.equal(r.bons, 1);
  assert.equal(r.pages, 1);
  assert.equal(r.bandeaux, 1);
});

test("un même visuel servant plusieurs KPI est signalé", () => {
  const r = V.analyser({
    manualEntries: [
      { id: "a", title: "Volumétrie", logistiport: VISUEL },
      { id: "b", title: "Délai", logistiport: VISUEL }
    ],
    sites: [{ key: "logistiport" }]
  });
  assert.equal(r.partages.length, 1);
  assert.deepEqual(r.partages[0].titres.sort(), ["Délai", "Volumétrie"]);
});

test("deux temporalités du même intitulé ne comptent pas comme un partage", () => {
  const r = V.analyser({
    manualEntries: [
      { id: "a", title: "Volumétrie", freq: "Hebdomadaire", logistiport: VISUEL },
      { id: "b", title: "Volumétrie", freq: "Mensuelle", logistiport: VISUEL }
    ],
    sites: [{ key: "logistiport" }]
  });
  assert.deepEqual(r.partages, []);
});

test("une fiche sans aucun lien ne produit aucune ligne", () => {
  const r = V.analyser({ manualEntries: [{ id: "a", title: "Sans lien" }], sites: [{ key: "logistiport" }] });
  assert.deepEqual(r.entrees, []);
});

/* ─── Contrôle du support produit ───────────────────────────── */

const D = require("./outils/verifier-deck.js");

const V_BON = "https://app.powerbi.com/groups/me/reports/6a4c/p1?pbi_source=shareVisual&visual=vA&width=1253.02&height=527.91";
const V_AUTRE = "https://app.powerbi.com/groups/me/reports/6a4c/p2?pbi_source=shareVisual&visual=vB&width=1255&height=551";
const V_PLAT = "https://app.powerbi.com/groups/me/reports/6a4c/p1?pbi_source=shareVisual&visual=vC&width=1140.87&height=51.48";

const PptxO = require("./js/pptx.js");
const ZipO = require("./js/zip.js");

/** PNG minimal aux dimensions choisies. */
function pngO(l, h) {
  const o = new Uint8Array(24);
  o.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
  const v = new DataView(o.buffer);
  v.setUint32(16, l); v.setUint32(20, h);
  return o;
}

const fsMod = require("node:fs");
let _modeleO = null;
const modeleO = () => (_modeleO ||= new Uint8Array(
  fsMod.readFileSync(pathO.join(__dirname, "modele-deck.pptx"))));

/* Un support de contrôle, fabriqué directement : le générateur est
   éprouvé par pptx.test.js, on ne le remet pas en cause ici. */
async function deckDe(diapos, options) {
  const o = options || {};
  return { octets: await PptxO.construireDeck(modeleO(), {
    titre: "Contrôle",
    diapos: diapos.map(d => Object.assign({ commentaire: "", vivant: !d.image && !!d.lien }, d))
  }) };
}

test("chaque diapositive pointe sur le lien de SON kpi, dans l'ordre", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON }, { titre: "Deux", lien: V_AUTRE }, { titre: "Trois", lien: V_PLAT }]);
  const r = await D.analyserDeck(octets);
  const kpi = r.diapos.filter(d => d.contenu !== "couverture");
  assert.deepEqual(kpi.map(d => d.titre), ["Un", "Deux", "Trois"]);
  assert.deepEqual(kpi.map(d => d.visuel), ["vA", "vB", "vC"]);
});

test("le contrôle retrouve la page et le rapport de chaque visuel", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON }]);
  const d = (await D.analyserDeck(octets)).diapos.find(x => x.contenu === "visuel vivant");
  assert.equal(d.page, "p1");
  assert.equal(d.rapport, "6a4c");
  assert.equal(d.format, "1253×528 px");
});

test("un support entièrement sain ne lève aucune alerte", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON }, { titre: "Deux", lien: V_AUTRE }]);
  assert.equal((await D.analyserDeck(octets)).alertes, 0);
});

test("le contrôle signale un visuel très plat", async () => {
  const { octets } = await deckDe([{ titre: "Plat", lien: V_PLAT }]);
  const r = await D.analyserDeck(octets);
  assert.ok(r.diapos.some(d => d.alertes.some(a => /allongé/.test(a))));
});

test("le contrôle signale un lien de page", async () => {
  const { octets } = await deckDe([{ titre: "Page", lien: COURT }]);
  const r = await D.analyserDeck(octets);
  assert.ok(r.diapos.some(d => d.alertes.some(a => /PAGE/.test(a))));
});

test("la couverture est reconnue comme telle", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON }]);
  const r = await D.analyserDeck(octets);
  assert.equal(r.diapos[0].contenu, "couverture");
  assert.equal(r.diapos.filter(d => d.contenu === "couverture").length, 1);
});

test("le cadre annoncé laisse la place au visuel, barre du complément comprise", async () => {
  const Pptx = require("./js/pptx.js");
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON }]);
  const d = (await D.analyserDeck(octets)).diapos.find(x => x.contenu === "visuel vivant");
  const [l, h] = d.cadre.split(" × ").map(parseFloat);
  const contenu = h - Pptx.BARRE_COMPLEMENT / 914400;
  assert.ok(Math.abs(l / contenu - 1253.02 / 527.91) < 0.05, "cadre : " + d.cadre);
});

test("le contrôle distingue une diapositive en image d'une diapositive vivante", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON, image: pngO(1200, 600) }]);
  const d = (await D.analyserDeck(octets)).diapos.find(x => x.contenu !== "couverture");
  assert.equal(d.contenu, "image");
  assert.equal(d.format, "1200×600 px");
});

test("une diapositive sans lien est signalée comme cadre d'attente", async () => {
  const { octets } = await deckDe([{ titre: "Rien", lien: "" }]);
  const d = (await D.analyserDeck(octets)).diapos.find(x => x.contenu !== "couverture");
  assert.equal(d.contenu, "cadre d'attente");
  assert.ok(d.alertes.length);
});

test("l'adresse d'incorporation est posée pour chaque visuel", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: V_BON }]);
  const pieces = await ZipO.lireZip(octets);
  const we = ZipO.versTexte(pieces.get("ppt/webextensions/webextension1.xml"));
  assert.ok(D.propriete(we, "embedUrl").includes("reportId=6a4c"));
  assert.equal((await D.analyserDeck(octets)).alertes, 0);
});

/* ─── Le signet vu par l'inspecteur ─────────────────────────── */

const SIGNET_A = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&width=1253&height=528&bookmarkGuid=aaa-111";
const SIGNET_B = SIGNET_A.replace("aaa-111", "bbb-222");

test("le signet de chaque diapositive est restitué", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: SIGNET_A }]);
  const d = (await D.analyserDeck(octets)).diapos.find(x => x.contenu === "visuel vivant");
  assert.equal(d.signet, "aaa-111");
});

test("deux KPI sur le même visuel avec des signets différents ne sont pas confondus", async () => {
  const { octets } = await deckDe([{ titre: "Logistiport", lien: SIGNET_A }, { titre: "MG Armement", lien: SIGNET_B }]);
  const r = await D.analyserDeck(octets);
  assert.equal(r.alertes, 0, "des signets distincts = des états distincts");
});

test("deux diapositives strictement identiques sont signalées", async () => {
  const { octets } = await deckDe([{ titre: "Un", lien: SIGNET_A }, { titre: "Deux", lien: SIGNET_A }]);
  const r = await D.analyserDeck(octets);
  assert.ok(r.diapos.some(d => d.alertes.some(a => /identique à la diapositive/.test(a))));
});

/* ─── La copie d'essai de l'annuaire ────────────────────────── */

const T = require("./outils/construire-annuaire-test.js");
const indexHtml = fsO.readFileSync(pathO.join(__dirname, "index.html"), "utf8");

test("la copie d'essai est bien dérivée de l'annuaire réel", () => {
  const h = T.construire(indexHtml, {});
  ["js/pptx.js", "js/selection.js", "app.js", "style.css"].forEach(f =>
    assert.ok(h.includes(f), "ressource absente : " + f));
});

test("le stockage de la copie est cloisonné par un préfixe", () => {
  const h = T.construire(indexHtml, { prefixe: "essai:" });
  assert.ok(h.includes('var PREFIXE = "essai:"'));
  assert.ok(h.includes('Object.defineProperty(window, "localStorage"'),
    "sans redéfinition, la copie écrirait dans les vraies fiches");
});

test("l'isolation précède tout script de l'application", () => {
  const h = T.construire(indexHtml, {});
  assert.ok(h.indexOf("COPIE D'ESSAI") < h.indexOf("app.js"),
    "l'amorce doit s'exécuter avant qu'app.js ne touche au stockage");
});

test("la copie vise un code de synchronisation dédié", () => {
  const h = T.construire(indexHtml, { code: "mon-essai" });
  assert.ok(h.includes('var CODE_ESSAI = "mon-essai"'));
  assert.ok(h.includes('"kpiOptoutClearedV2", "1"'),
    "sans ce drapeau, l'application réaligne la copie sur le code de production");
});

test("le service worker n'est pas enregistré par la copie", () => {
  const h = T.construire(indexHtml, {});
  assert.ok(h.includes("navigator.serviceWorker.register = function"));
});

test("le manifeste est retiré : la copie ne s'installe pas comme application", () => {
  assert.ok(!/<link rel="manifest"/.test(T.construire(indexHtml, {})));
});

test("la bannière rappelle le code d'essai et ramène à l'annuaire réel", () => {
  const h = T.construire(indexHtml, { code: "mon-essai" });
  assert.ok(h.includes("Copie d'essai"));
  assert.ok(h.includes("mon-essai"));
  assert.ok(h.includes('href="index.html"'));
});

test("le titre distingue la copie au premier coup d'œil", () => {
  assert.ok(T.construire(indexHtml, {}).includes("<title>Annuaire KPI — copie d'essai</title>"));
});

test("un index.html méconnaissable est refusé plutôt que mal transformé", () => {
  assert.throws(() => T.construire("<html><body>rien</body></html>", {}), /introuvable/);
});

/* ═══ Relevé des empreintes en ligne de commande ═══════════
   Le même relevé que dans l'annuaire, pour traiter un lot de fichiers
   d'un coup — par exemple le support d'un rituel entier. */

const R = require("./outils/relever-empreintes.js");

function complementXml(props) {
  const lignes = Object.keys(props)
    .map(n => `<we:property name="${n}" value="${props[n]}"/>`).join("");
  return `<we:webextension><we:properties>${lignes}</we:properties></we:webextension>`;
}

const LIEN_R = "/groups/me/reports/6a4cf353/faec2927?pbi_source=shareVisual&amp;visual=v42";

function fichierAvec(complements) {
  const Zip = require("./js/zip.js");
  return Zip.ecrireZip([
    { nom: "[Content_Types].xml", donnees: '<?xml version="1.0"?><Types></Types>' },
    ...complements.map((c, i) => ({ nom: `ppt/webextensions/webextension${i + 1}.xml`, donnees: c }))
  ]);
}

test("relevé : les propriétés d'un complément sont lues telles quelles", () => {
  const props = R.proprietesDe(complementXml({ artifactName: "&quot;Histo&quot;", bookmark: "&quot;B&quot;" }));
  assert.equal(props.artifactName, "&quot;Histo&quot;");
  assert.equal(props.bookmark, "&quot;B&quot;");
});

test("relevé : une insertion manuelle donne une empreinte utilisable", async () => {
  const octets = fichierAvec([complementXml({
    reportUrl: `&quot;${LIEN_R}&quot;`, artifactName: "&quot;Histo&quot;",
    bookmark: "&quot;B&quot;", initialStateBookmark: "&quot;B&quot;"
  })]);
  const lot = await R.relever(octets, { horodatage: 7 });
  assert.equal(lot.length, 1);
  assert.equal(lot[0].libelle, "Histo");
  assert.equal(lot[0]._mtime, 7);
});

test("relevé : une diapositive fabriquée par le générateur est ignorée", async () => {
  const octets = fichierAvec([complementXml({
    reportUrl: `&quot;${LIEN_R}&quot;`, reportState: "&quot;CONNECTED&quot;"
  })]);
  assert.deepEqual(await R.relever(octets, {}), []);
});

test("relevé : le même visuel sur deux diapositives ne compte qu'une fois", async () => {
  const complet = complementXml({
    reportUrl: `&quot;${LIEN_R}&quot;`, artifactName: "&quot;Histo&quot;", bookmark: "&quot;B&quot;"
  });
  const partiel = complementXml({ reportUrl: `&quot;${LIEN_R}&quot;`, artifactName: "&quot;Histo&quot;" });
  const lot = await R.relever(fichierAvec([partiel, complet]), {});
  assert.equal(lot.length, 1);
  assert.ok(lot[0].proprietes.bookmark, "c'est le relevé le plus complet qui est gardé");
});

test("relevé : les options en ligne de commande sont comprises", () => {
  const o = R.options(["a.pptx", "b.pptx", "--sortie", "empreintes.json"]);
  assert.deepEqual(o.fichiers, ["a.pptx", "b.pptx"]);
  assert.equal(o.sortie, "empreintes.json");
});

test("relevé : une option inconnue est refusée plutôt que devinée", () => {
  assert.throws(() => R.options(["--nimporte"]), /Option inconnue/);
});

/* ═══ Dériver une empreinte d'une autre ═════════════════════
   13 KPI × 3 temporalités × 4 zones, c'est 156 relevés manuels :
   intenable. Or l'état d'un signet contient les SEGMENTS de la page —
   KPI, priorité, dimension, code aire — et deux états du même visuel
   ne diffèrent que par une poignée de conteneurs sur cinquante-quatre.

   Ces tests éprouvent la dérivation. Reste une inconnue qui ne dépend
   pas du code : le complément accepte-t-il un état ré-encodé ? C'est
   la diapositive 2 du support produit qui le dira. */

const DV = require("./outils/diagnostic-derivation.js");

/** Un état minimal mais complet, à la forme de ceux de Power BI. */
function etatDe(page, conteneurs, filtres) {
  return {
    displayName: "Signet", name: "BOOKMARK_NAME",
    explorationState: {
      version: "1.40", activeSection: page,
      sections: { [page]: { visualContainers: conteneurs, filters: filtres || { byExpr: [] } } },
      objects: {}
    }
  };
}

test("dérivation : compresser puis relire redonne l'objet de départ", () => {
  const e = etatDe("p1", { v1: { a: 1 } });
  assert.deepEqual(DV.lireEtat(DV.ecrireEtat(e)), e);
});

test("dérivation : seuls les conteneurs qui diffèrent sont relevés", () => {
  const a = etatDe("p1", { commun: { x: 1 }, segment: { kpi: "A" } });
  const b = etatDe("p1", { commun: { x: 1 }, segment: { kpi: "B" } });
  assert.deepEqual(DV.conteneursDivergents(a, b), ["segment"]);
});

test("dérivation : l'état dérivé porte les segments de B", () => {
  const a = etatDe("p1", { commun: { x: 1 }, segment: { kpi: "A" } });
  const b = etatDe("p1", { commun: { x: 1 }, segment: { kpi: "B" } });
  const d = DV.deriver(a, b);
  assert.deepEqual(DV.section(d).visualContainers.segment, { kpi: "B" });
  assert.deepEqual(DV.conteneursDivergents(d, b), [], "plus rien ne les distingue");
});

test("dérivation : tout ce qui ne diverge pas reste celui de A", () => {
  const a = etatDe("p1", { commun: { x: 1 }, segment: { kpi: "A" } }, { byExpr: [{ name: "fA" }] });
  const b = etatDe("p1", { commun: { x: 1 }, segment: { kpi: "B" } }, { byExpr: [{ name: "fB" }] });
  const d = DV.deriver(a, b);
  assert.deepEqual(DV.section(d).filters, { byExpr: [{ name: "fA" }] },
    "les filtres de section ne sont pas touchés");
  assert.deepEqual(DV.section(d).visualContainers.commun, { x: 1 });
});

test("dérivation : l'état de départ n'est jamais modifié au passage", () => {
  const a = etatDe("p1", { segment: { kpi: "A" } });
  const avant = JSON.stringify(a);
  DV.deriver(a, etatDe("p1", { segment: { kpi: "B" } }));
  assert.equal(JSON.stringify(a), avant);
});

test("dérivation : un conteneur absent de B disparaît du dérivé", () => {
  const a = etatDe("p1", { garde: { x: 1 }, parti: { y: 2 } });
  const b = etatDe("p1", { garde: { x: 1 } });
  assert.ok(!("parti" in DV.section(DV.deriver(a, b)).visualContainers));
});

test("dérivation : on choisit deux empreintes du MÊME visuel", () => {
  const emp = (visuel, signet) => ({
    id: "r1/p1/" + visuel + "/" + signet, signet,
    proprietes: { bookmark: "b", artifactName: "a" }
  });
  assert.ok(DV.deuxDuMemeVisuel([emp("vA", "s1"), emp("vB", "s2"), emp("vA", "s3")]));
  assert.equal(DV.deuxDuMemeVisuel([emp("vA", "s1"), emp("vB", "s2")]), null);
});

test("dérivation : une empreinte sans état n'est pas retenue comme paire", () => {
  const sansEtat = { id: "r1/p1/vA/s2", signet: "s2", proprietes: { artifactName: "a" } };
  const avec = { id: "r1/p1/vA/s1", signet: "s1", proprietes: { bookmark: "b", artifactName: "a" } };
  assert.equal(DV.deuxDuMemeVisuel([avec, sansEtat]), null);
});

test("dérivation : le lien se reconstitue depuis la clé et le signet", () => {
  const lien = DV.lienDe({ id: "6a4c/p1/vA/sig-1", signet: "sig-1" });
  assert.match(lien, /reports\/6a4c\/p1\?/);
  assert.match(lien, /visual=vA/);
  assert.match(lien, /bookmarkGuid=sig-1/);
});
