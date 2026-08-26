/* Tests de la fabrique PowerPoint (js/pptx.js).
   On vérifie la STRUCTURE du fichier produit — c'est elle que
   PowerPoint refuse quand elle est fausse : table des matières,
   relations, ordre des diapositives, liens externes.
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const P = require("./js/pptx.js");
const ZipP = require("./js/zip.js");

/* Le modèle est lu à la demande : sous Node depuis le disque, dans le banc
   de test du navigateur depuis le fichier téléchargé par la coque. */
let _modele = null;
function MODELE() {
  if (!_modele) _modele = new Uint8Array(fs.readFileSync(path.join(__dirname, "modele-deck.pptx")));
  return _modele;
}

/** PNG 2×1 minimal, suffisant pour éprouver la mise à l'échelle. */
function pngP(largeur, hauteur) {
  const o = new Uint8Array(24);
  o.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
  const vue = new DataView(o.buffer);
  vue.setUint32(16, largeur); vue.setUint32(20, hauteur);
  return o;
}

const deckP = (diapos, opts) => P.construireDeck(MODELE(), Object.assign({ diapos }, opts || {}));
const lireP = async octets => {
  const pieces = await ZipP.lireZip(octets);
  const txt = n => ZipP.versTexte(pieces.get(n));
  return { pieces, txt };
};

/* ─── Le modèle lui-même ───────────────────────────────────── */

test("le modèle livré contient bien la charte et la couverture", async () => {
  const pieces = await ZipP.lireZip(MODELE());
  ["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml",
   "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout2.xml",
   "ppt/theme/theme1.xml"].forEach(n => assert.ok(pieces.has(n), "pièce manquante : " + n));
});

test("la couverture du modèle porte les trois jetons à substituer", async () => {
  const pieces = await ZipP.lireZip(MODELE());
  const xml = ZipP.versTexte(pieces.get("ppt/slides/slide1.xml"));
  ["{{TITRE}}", "{{SOUS_TITRE}}", "{{PERIODE}}"].forEach(j =>
    assert.ok(xml.includes(j), "jeton absent du modèle : " + j));
});

/* ─── Construction ─────────────────────────────────────────── */

test("une diapositive est produite par KPI, après la couverture", async () => {
  const { pieces } = await lireP(await deckP([
    { titre: "A", lien: "https://app.powerbi.com/a" },
    { titre: "B", lien: "https://app.powerbi.com/b" }
  ]));
  assert.ok(pieces.has("ppt/slides/slide1.xml"), "la couverture est conservée");
  assert.ok(pieces.has("ppt/slides/slide2.xml"));
  assert.ok(pieces.has("ppt/slides/slide3.xml"));
  assert.ok(!pieces.has("ppt/slides/slide4.xml"));
});

test("la couverture reçoit le titre, le sous-titre et la période", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A" }], {
    titre: "Indicateurs Magasins Armement", sousTitre: "IDEA / Chantiers", periode: "S30 à S33-2026"
  }));
  const c = txt("ppt/slides/slide1.xml");
  assert.ok(c.includes("Indicateurs Magasins Armement"));
  assert.ok(c.includes("IDEA / Chantiers"));
  assert.ok(c.includes("S30 à S33-2026"));
  assert.ok(!c.includes("{{"), "aucun jeton ne doit rester visible dans le support livré");
});

test("chaque diapositive est déclarée dans la table des matières du paquet", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A" }, { titre: "B" }]));
  const ct = txt("[Content_Types].xml");
  assert.ok(ct.includes("/ppt/slides/slide2.xml"));
  assert.ok(ct.includes("/ppt/slides/slide3.xml"));
});

test("chaque diapositive est reliée à la présentation et placée dans l'ordre", async () => {
  const octets = await deckP([{ titre: "Un" }, { titre: "Deux" }, { titre: "Trois" }]);
  const { txt } = await lireP(octets);
  const rels = txt("ppt/_rels/presentation.xml.rels");
  const pres = txt("ppt/presentation.xml");
  ["rIdKpi1", "rIdKpi2", "rIdKpi3"].forEach(id => {
    assert.ok(rels.includes(`Id="${id}"`), "relation manquante : " + id);
    assert.ok(pres.includes(`r:id="${id}"`), "diapositive absente du sommaire : " + id);
  });
  // L'ordre du sommaire doit être celui de la sélection
  assert.ok(pres.indexOf("rIdKpi1") < pres.indexOf("rIdKpi2"));
  assert.ok(pres.indexOf("rIdKpi2") < pres.indexOf("rIdKpi3"));
});

test("chaque diapositive utilise la disposition du modèle IDEA", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A" }]));
  assert.ok(txt("ppt/slides/_rels/slide2.xml.rels").includes("slideLayout2.xml"));
});

test("le titre du KPI apparaît dans l'espace réservé de titre", async () => {
  const { txt } = await lireP(await deckP([{ titre: "Taux de service réception LGT" }]));
  const xml = txt("ppt/slides/slide2.xml");
  assert.ok(xml.includes('<p:ph type="title"/>'));
  assert.ok(xml.includes("Taux de service réception LGT"));
});

test("le commentaire est repris tel quel, préfixé comme dans le support existant", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", commentaire: "Réception en S32 655 lignes" }]));
  assert.ok(txt("ppt/slides/slide2.xml").includes("Commentaires : Réception en S32 655 lignes"));
});

test("sans commentaire, la ligne « Commentaires : » reste présente à remplir", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A" }]));
  assert.ok(txt("ppt/slides/slide2.xml").includes("Commentaires : "));
});

test("le numéro de diapositive est posé dans l'espace réservé du modèle", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A" }]));
  const xml = txt("ppt/slides/slide2.xml");
  assert.ok(xml.includes('type="sldNum"'));
  assert.ok(xml.includes('type="slidenum"'));
});

/* ─── Liens Power BI ───────────────────────────────────────── */

test("le lien Power BI devient une relation externe cliquable", async () => {
  const url = "https://app.powerbi.com/groups/me/reports/abc/def?visual=xyz";
  const { txt } = await lireP(await deckP([{ titre: "A", lien: url }]));
  const rels = txt("ppt/slides/_rels/slide2.xml.rels");
  assert.ok(rels.includes('TargetMode="External"'));
  assert.ok(rels.includes(url.replace(/&/g, "&amp;")));
  assert.ok(txt("ppt/slides/slide2.xml").includes("hlinkClick"));
});

test("une URL contenant des esperluettes reste un XML valide", async () => {
  const url = "https://app.powerbi.com/r?a=1&b=2&visual=z";
  const { txt } = await lireP(await deckP([{ titre: "A", lien: url }]));
  const rels = txt("ppt/slides/_rels/slide2.xml.rels");
  assert.ok(rels.includes("a=1&amp;b=2"), "les & doivent être échappés");
  assert.ok(!/&(?!amp;|apos;|quot;|lt;|gt;)/.test(rels), "aucune esperluette nue ne doit subsister");
});

test("sans lien, aucune relation externe n'est fabriquée", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A" }]));
  assert.ok(!txt("ppt/slides/_rels/slide2.xml.rels").includes("hyperlink"));
});

test("un KPI sans capture reçoit un cadre d'attente, pas une diapositive vide", async () => {
  const { txt } = await lireP(await deckP([{ titre: "Taux de service", lien: "https://app.powerbi.com/a" }]));
  const xml = txt("ppt/slides/slide2.xml");
  assert.ok(xml.includes("Visuel à capturer"));
  assert.ok(xml.includes("Cliquer pour ouvrir le visuel dans Power BI"));
});

/* ─── Images ───────────────────────────────────────────────── */

test("une capture fournie est intégrée au paquet et affichée", async () => {
  const { pieces, txt } = await lireP(await deckP([{ titre: "A", image: pngP(800, 400) }]));
  assert.ok(pieces.has("ppt/media/kpi1.png"));
  assert.ok(txt("ppt/slides/slide2.xml").includes("<p:pic>"));
  assert.ok(txt("ppt/slides/_rels/slide2.xml.rels").includes("../media/kpi1.png"));
});

test("deux captures ne se écrasent pas l'une l'autre", async () => {
  const { pieces } = await lireP(await deckP([
    { titre: "A", image: pngP(800, 400) },
    { titre: "B", image: pngP(400, 800) }
  ]));
  assert.ok(pieces.has("ppt/media/kpi1.png"));
  assert.ok(pieces.has("ppt/media/kpi2.png"));
});

test("les octets de la capture arrivent intacts dans le fichier", async () => {
  const image = pngP(640, 480);
  const { pieces } = await lireP(await deckP([{ titre: "A", image }]));
  assert.deepEqual([...pieces.get("ppt/media/kpi1.png")], [...image]);
});

test("dimensionsImage lit la taille réelle d'un PNG", () => {
  assert.deepEqual(P.dimensionsImage(pngP(1280, 720)), { l: 1280, h: 720 });
});

test("dimensionsImage ne s'effondre pas sur un contenu inattendu", () => {
  assert.deepEqual(P.dimensionsImage(new Uint8Array(4)), { l: 16, h: 9 });
  assert.deepEqual(P.dimensionsImage(null), { l: 16, h: 9 });
});

test("une image large est ajustée en largeur et centrée verticalement", () => {
  const c = P.cadrer(P.ZONE, { l: 1600, h: 400 });
  assert.equal(c.l, P.ZONE.l, "la largeur disponible est utilisée");
  assert.ok(c.h < P.ZONE.h);
  assert.ok(c.y > P.ZONE.y, "l'image est recentrée dans la zone");
});

test("une image haute est ajustée en hauteur et centrée horizontalement", () => {
  const c = P.cadrer(P.ZONE, { l: 400, h: 1600 });
  assert.equal(c.h, P.ZONE.h);
  assert.ok(c.l < P.ZONE.l);
  assert.ok(c.x > P.ZONE.x);
});

test("les proportions de la capture sont préservées : jamais d'image écrasée", () => {
  const c = P.cadrer(P.ZONE, { l: 1000, h: 500 });
  assert.ok(Math.abs((c.l / c.h) - 2) < 0.01);
});

test("le visuel ne déborde jamais de la zone réservée", () => {
  [[1, 100], [100, 1], [1920, 1080], [3, 4]].forEach(([l, h]) => {
    const c = P.cadrer(P.ZONE, { l, h });
    assert.ok(c.x >= P.ZONE.x && c.y >= P.ZONE.y);
    assert.ok(c.x + c.l <= P.ZONE.x + P.ZONE.l + 1);
    assert.ok(c.y + c.h <= P.ZONE.y + P.ZONE.h + 1);
  });
});

test("un JPEG est reconnu et rangé avec la bonne extension", async () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x2C, 0x02, 0x58, ...new Array(16).fill(0)]);
  assert.equal(P.extensionImage(jpeg), "jpeg");
  const { pieces } = await lireP(await deckP([{ titre: "A", image: jpeg }]));
  assert.ok(pieces.has("ppt/media/kpi1.jpeg"));
});

/* ─── Robustesse ───────────────────────────────────────────── */

test("un deck sans diapositive est refusé plutôt que produit vide", async () => {
  await assert.rejects(() => deckP([]), /Aucune diapositive/);
});

test("un modèle amputé est signalé clairement", async () => {
  const amoindri = ZipP.ecrireZip([{ nom: "[Content_Types].xml", donnees: "<Types/>" }]);
  await assert.rejects(() => P.construireDeck(amoindri, { diapos: [{ titre: "A" }] }), /Modèle incomplet/);
});

test("les caractères spéciaux d'un intitulé ne cassent pas le fichier", async () => {
  const { txt } = await lireP(await deckP([{ titre: 'Taux <"service"> & retard', commentaire: "a < b & c" }]));
  const xml = txt("ppt/slides/slide2.xml");
  assert.ok(xml.includes("&lt;"), "les chevrons sont échappés");
  assert.ok(!/&(?!amp;|apos;|quot;|lt;|gt;)/.test(xml), "aucune esperluette nue");
});

test("le fichier produit est une archive relisible de bout en bout", async () => {
  const octets = await deckP([{ titre: "A", image: pngP(800, 400) }, { titre: "B" }]);
  const pieces = await ZipP.lireZip(octets);
  assert.ok(pieces.size > 20);
  assert.equal([...pieces.keys()][0], "[Content_Types].xml",
    "PowerPoint attend cette pièce en première position");
});

test("deux générations identiques produisent le même fichier", async () => {
  const faire = () => deckP([{ titre: "A", lien: "https://app.powerbi.com/a" }], { titre: "T", periode: "S30" });
  assert.deepEqual([...(await faire())], [...(await faire())]);
});

test("une centaine de KPI passe sans erreur", async () => {
  const diapos = Array.from({ length: 100 }, (_, i) => ({ titre: "KPI " + i, lien: "https://app.powerbi.com/" + i }));
  const pieces = await ZipP.lireZip(await deckP(diapos));
  assert.ok(pieces.has("ppt/slides/slide101.xml"));
});

/* ─── Visuel vivant : complément Power BI ──────────────────── */

const LIEN_PBI = "https://app.powerbi.com/groups/me/reports/6a4cf353/faec2927?ctid=c8d7&pbi_source=shareVisual&visual=b363375b";

test("le chemin transmis au complément est relatif à app.powerbi.com", () => {
  assert.equal(P.cheminRapport(LIEN_PBI),
    "/groups/me/reports/6a4cf353/faec2927?ctid=c8d7&pbi_source=shareVisual&visual=b363375b");
});

test("un chemin déjà relatif est laissé tel quel", () => {
  assert.equal(P.cheminRapport("/groups/me/reports/x/y?z=1"), "/groups/me/reports/x/y?z=1");
});

test("le nom de page est extrait de l'adresse du rapport", () => {
  assert.equal(P.nomPage(LIEN_PBI), "faec2927");
  assert.equal(P.nomPage("https://app.powerbi.com/links/ABC?x=1"), "");
});

test("le complément déclaré est bien celui de Power BI", () => {
  assert.equal(P.COMPLEMENT.id, "WA200003233");
  assert.equal(P.COMPLEMENT.storeType, "OMEX");
});

test("une diapositive vivante embarque sa pièce de complément", async () => {
  const { pieces } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  assert.ok(pieces.has("ppt/webextensions/webextension1.xml"));
});

test("la pièce de complément porte l'adresse du visuel et l'état connecté", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const we = txt("ppt/webextensions/webextension1.xml");
  assert.ok(we.includes('name="reportUrl"'));
  assert.ok(we.includes("visual=b363375b"), "le visuel précis doit être désigné");
  assert.ok(we.includes("CONNECTED"), "le visuel doit être connecté, pas figé");
  assert.ok(we.includes("&quot;live&quot;"));
  assert.ok(!we.includes("https://app.powerbi.com"), "le complément attend un chemin relatif");
});

test("la pièce de complément est déclarée dans la table des matières", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  assert.ok(txt("[Content_Types].xml").includes("application/vnd.ms-office.webextension+xml"));
});

test("la diapositive référence son complément par une relation dédiée", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const rels = txt("ppt/slides/_rels/slide2.xml.rels");
  assert.ok(rels.includes("schemas.microsoft.com/office/2011/relationships/webextension"));
  assert.ok(rels.includes("../webextensions/webextension1.xml"));
});

test("le cadre du complément est posé dans la zone du visuel", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const xml = txt("ppt/slides/slide2.xml");
  assert.ok(xml.includes("<we:webextensionref"));
  assert.ok(xml.includes(`<a:off x="${P.ZONE.x}" y="${P.ZONE.y}"/>`));
});

test("les PowerPoint qui ignorent les compléments affichent une explication, pas un trou", async () => {
  const { txt } = await lireP(await deckP([{ titre: "Taux de service", lien: LIEN_PBI, vivant: true }]));
  const xml = txt("ppt/slides/slide2.xml");
  assert.ok(xml.includes("<mc:Fallback>"));
  assert.ok(xml.includes("Activez le complément Power BI"));
  assert.ok(xml.includes("Taux de service"));
});

test("chaque KPI vivant a SA pièce de complément, avec son propre identifiant", async () => {
  const { pieces, txt } = await lireP(await deckP([
    { titre: "A", lien: LIEN_PBI, vivant: true },
    { titre: "B", lien: LIEN_PBI.replace("faec2927", "62748b2b"), vivant: true }
  ]));
  assert.ok(pieces.has("ppt/webextensions/webextension1.xml"));
  assert.ok(pieces.has("ppt/webextensions/webextension2.xml"));
  const id1 = txt("ppt/webextensions/webextension1.xml").match(/we:webextension[^>]*id="([^"]+)"/)[1];
  const id2 = txt("ppt/webextensions/webextension2.xml").match(/we:webextension[^>]*id="([^"]+)"/)[1];
  assert.notEqual(id1, id2, "deux compléments ne peuvent pas partager le même identifiant");
  assert.ok(txt("ppt/webextensions/webextension2.xml").includes("62748b2b"));
});

test("sans lien, aucune pièce de complément n'est fabriquée", async () => {
  const { pieces } = await lireP(await deckP([{ titre: "A", vivant: true }]));
  assert.ok(!pieces.has("ppt/webextensions/webextension1.xml"));
  assert.ok(ZipP.versTexte(pieces.get("ppt/slides/slide2.xml")).includes("Visuel à capturer"));
});

test("le mode vivant l'emporte sur une capture fournie par erreur", async () => {
  const { pieces, txt } = await lireP(await deckP([
    { titre: "A", lien: LIEN_PBI, vivant: true, image: pngP(800, 400) }
  ]));
  assert.ok(!pieces.has("ppt/media/kpi1.png"), "aucune image inutile n'alourdit le fichier");
  assert.ok(txt("ppt/slides/slide2.xml").includes("<we:webextensionref"));
});

test("une adresse avec esperluettes reste un XML valide dans la pièce de complément", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const we = txt("ppt/webextensions/webextension1.xml");
  assert.ok(we.includes("&amp;"), "les & doivent être échappés");
  assert.ok(!/&(?!amp;|apos;|quot;|lt;|gt;)/.test(we), "aucune esperluette nue");
});

test("un deck mixte : un KPI vivant, un KPI en capture", async () => {
  const { pieces, txt } = await lireP(await deckP([
    { titre: "Vivant", lien: LIEN_PBI, vivant: true },
    { titre: "Capture", lien: LIEN_PBI, image: pngP(800, 400) }
  ]));
  assert.ok(txt("ppt/slides/slide2.xml").includes("<we:webextensionref"));
  assert.ok(txt("ppt/slides/slide3.xml").includes("<p:pic>"));
  assert.ok(pieces.has("ppt/media/kpi1.png"));
});

/* ─── Le cadre épouse le format du visuel ──────────────────── */

/** Dimensions du cadre du complément (p:xfrm du graphicFrame). */
function cadreComplement(xml) {
  const m = xml.match(/<p:xfrm><a:off[^>]*\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/p:xfrm>/);
  assert.ok(m, "cadre du complément introuvable");
  return m;
}

test("sous la barre du complément, la place laissée épouse les proportions du visuel", async () => {
  const large = LIEN_PBI + "&width=1253.02&height=527.91";
  const { txt } = await lireP(await deckP([{ titre: "A", lien: large, vivant: true }]));
  const m = cadreComplement(txt("ppt/slides/slide2.xml"));
  const contenu = Number(m[2]) - P.BARRE_COMPLEMENT;
  const ratio = Number(m[1]) / contenu;
  assert.ok(Math.abs(ratio - 1253.02 / 527.91) < 0.02, "ratio obtenu : " + ratio.toFixed(2));
});

test("un visuel très plat reste discret sans devenir invisible", async () => {
  const plat = LIEN_PBI + "&width=1140.87&height=51.48";
  const { txt } = await lireP(await deckP([{ titre: "A", lien: plat, vivant: true }]));
  const m = cadreComplement(txt("ppt/slides/slide2.xml"));
  assert.ok(Number(m[2]) < P.ZONE.h / 2, "il ne prend pas toute la zone : " + m[2]);
  assert.ok(Number(m[2]) >= P.HAUTEUR_MINI_COMPLEMENT, "mais reste lisible : " + m[2]);
  assert.equal(Number(m[1]), P.ZONE.l, "toute la largeur disponible est utilisée");
});

test("sans dimensions dans le lien, le cadre occupe toute la zone", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: "https://app.powerbi.com/x?visual=v", vivant: true }]));
  const m = cadreComplement(txt("ppt/slides/slide2.xml"));
  assert.equal(Number(m[1]), P.ZONE.l);
  assert.equal(Number(m[2]), P.ZONE.h);
});

test("les réglages d'affichage sont ceux d'une insertion manuelle qui fonctionne", async () => {
  // Relevés sur le fichier où le visuel s'affiche réellement : les deux à false.
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const we = txt("ppt/webextensions/webextension1.xml");
  assert.ok(we.includes('name="isVisualContainerHeaderHidden" value="false"'));
  assert.ok(we.includes('name="isFiltersActionButtonVisible" value="false"'));
});

/* ─── analyserLien ─────────────────────────────────────────── */

test("analyserLien reconnaît un lien de visuel et son format", () => {
  const a = P.analyserLien(LIEN_PBI + "&width=1253.02&height=527.91");
  assert.equal(a.type, "visuel");
  assert.equal(a.visualName, "b363375b");
  assert.equal(Math.round(a.largeur), 1253);
  assert.equal(a.aplati, false);
});

test("analyserLien distingue un lien court, qui désigne une page", () => {
  const a = P.analyserLien("https://app.powerbi.com/links/UWLu7wc3Ez?pbi_source=linkShare");
  assert.equal(a.type, "lien-court");
  assert.equal(a.visualName, "");
});

test("analyserLien distingue l'adresse d'une page de rapport", () => {
  assert.equal(P.analyserLien("https://app.powerbi.com/groups/me/reports/r1/p1?ctid=c8").type, "page");
});

test("analyserLien signale un visuel dix fois plus large que haut", () => {
  assert.equal(P.analyserLien(LIEN_PBI + "&width=1140.87&height=51.48").aplati, true);
});

test("analyserLien ne s'effondre pas sur une adresse absente", () => {
  const a = P.analyserLien("");
  assert.equal(a.type, "aucun");
  assert.equal(a.ratio, 0);
});

/* ─── Le signet : ce qui distingue un KPI d'un autre ────────── */

const AVEC_SIGNET = "https://app.powerbi.com/groups/me/reports/r1/p1?pbi_source=shareVisual&visual=v1&bookmarkGuid=5e2d502b-8642";

test("le signet est transmis tel qu'il figure dans le lien", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: AVEC_SIGNET, vivant: true }]));
  assert.ok(txt("ppt/webextensions/webextension1.xml").includes("bookmarkGuid=5e2d502b-8642"));
});

test("RIEN n'est ajouté à l'adresse : c'est ce qui cassait la résolution du visuel", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: AVEC_SIGNET, vivant: true }]));
  const we = txt("ppt/webextensions/webextension1.xml");
  assert.ok(!we.includes("bookmarkUsage"), "bookmarkUsage appartient à l'export d'une page");
  assert.ok(!we.includes("fromEntryPoint"), "fromEntryPoint aussi");
});

test("l'adresse retenue est le lien de partage, à l'hôte près", () => {
  const lien = "https://app.powerbi.com/groups/me/reports/r1/p1?ctid=c8&pbi_source=shareVisual&visual=v1&height=550.75&width=1254.63&bookmarkGuid=b1e";
  assert.equal(P.urlPourComplement(lien),
    "/groups/me/reports/r1/p1?ctid=c8&pbi_source=shareVisual&visual=v1&height=550.75&width=1254.63&bookmarkGuid=b1e");
});

test("ni pageName ni reportName ne sont imposés au complément", async () => {
  const { txt } = await lireP(await deckP([{ titre: "Mon KPI", lien: LIEN_PBI, vivant: true }]));
  const we = txt("ppt/webextensions/webextension1.xml");
  assert.ok(!we.includes('name="pageName"'), "le complément résout la page depuis l'adresse");
  assert.ok(!we.includes('name="reportName"'), "et le nom du rapport aussi");
});

test("une adresse sans signet reste sans signet", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  assert.ok(!txt("ppt/webextensions/webextension1.xml").includes("bookmark"));
});

test("deux KPI sur le même visuel gardent chacun SON signet", async () => {
  const a = AVEC_SIGNET;
  const b = AVEC_SIGNET.replace("5e2d502b-8642", "24645b9e-ccb7");
  const { txt } = await lireP(await deckP([
    { titre: "Logistiport", lien: a, vivant: true },
    { titre: "MG Armement", lien: b, vivant: true }
  ]));
  assert.ok(txt("ppt/webextensions/webextension1.xml").includes("5e2d502b-8642"));
  assert.ok(txt("ppt/webextensions/webextension2.xml").includes("24645b9e-ccb7"));
  assert.ok(!txt("ppt/webextensions/webextension2.xml").includes("5e2d502b-8642"),
    "le signet du voisin ne doit jamais déborder");
});

test("un lien déjà porteur de ces paramètres n'est pas altéré non plus", () => {
  const url = P.urlPourComplement(AVEC_SIGNET + "&bookmarkUsage=1");
  assert.equal((url.match(/bookmarkUsage=/g) || []).length, 1);
});

test("une adresse vide ne produit pas d'adresse bancale", () => {
  assert.equal(P.urlPourComplement(""), "");
});

/* ─── Propriétés de complément personnalisées ───────────────── */

test("une propriété fournie remplace celle du générateur, sans doublon", async () => {
  const { txt } = await lireP(await deckP([{
    titre: "A", lien: LIEN_PBI, vivant: true,
    proprietesComplement: { reportState: "&quot;AUTRE&quot;" }
  }]));
  const we = txt("ppt/webextensions/webextension1.xml");
  assert.equal((we.match(/name="reportState"/g) || []).length, 1, "une seule fois");
  assert.ok(we.includes("AUTRE"));
  assert.ok(!we.includes("CONNECTED"));
});

test("une propriété nulle est purement retirée", async () => {
  const { txt } = await lireP(await deckP([{
    titre: "A", lien: LIEN_PBI, vivant: true,
    proprietesComplement: { embedUrl: null }
  }]));
  assert.ok(!txt("ppt/webextensions/webextension1.xml").includes('name="embedUrl"'));
});

test("une propriété inconnue est ajoutée telle quelle", async () => {
  const { txt } = await lireP(await deckP([{
    titre: "A", lien: LIEN_PBI, vivant: true,
    proprietesComplement: { bookmark: "&quot;H4sIAAA&quot;" }
  }]));
  assert.ok(txt("ppt/webextensions/webextension1.xml").includes('name="bookmark"'));
});

test("aucune propriété n'apparaît deux fois, quel que soit le remplacement", async () => {
  const remplacements = {};
  P.PROPRIETES_PAR_DEFAUT.forEach(n => { remplacements[n] = "&quot;x&quot;"; });
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true,
    proprietesComplement: remplacements }]));
  const noms = (txt("ppt/webextensions/webextension1.xml").match(/name="([^"]+)"/g) || []);
  assert.equal(noms.length, new Set(noms).size, "doublons : " + noms.join(","));
});

test("une adresse de complément imposée court-circuite la reconstruction", async () => {
  const { txt } = await lireP(await deckP([{
    titre: "A", lien: LIEN_PBI, vivant: true, urlComplement: "/chemin/impose?x=1"
  }]));
  assert.ok(txt("ppt/webextensions/webextension1.xml").includes("/chemin/impose?x=1"));
});

/* ─── Le complément a besoin de place ───────────────────────── */

test("le cadre réserve la hauteur de la barre du complément", () => {
  const image = P.cadrer(P.ZONE, { l: 1253, h: 528 });
  const addin = P.cadreComplement(image);
  assert.equal(addin.h, image.h + P.BARRE_COMPLEMENT);
});

test("un visuel très plat obtient quand même une hauteur lisible", () => {
  // Le cas qui ne montrait QUE la barre : cadre de 0,4 pouce pour une barre de 0,45.
  const addin = P.cadreComplement(P.cadrer(P.ZONE, { l: 1140.87, h: 51.48 }));
  assert.ok(addin.h >= P.HAUTEUR_MINI_COMPLEMENT, "hauteur obtenue : " + addin.h);
  assert.ok(addin.h - P.BARRE_COMPLEMENT > 1200000, "il doit rester de la place sous la barre");
});

test("le cadre ne déborde jamais de la zone réservée", () => {
  [[1, 100], [100, 1], [1141, 51], [1920, 1080], [3, 4]].forEach(([l, h]) => {
    const c = P.cadreComplement(P.cadrer(P.ZONE, { l, h }));
    assert.ok(c.h <= P.ZONE.h, l + "×" + h + " → " + c.h);
    assert.ok(c.y >= P.ZONE.y);
    assert.ok(c.y + c.h <= P.ZONE.y + P.ZONE.h + 1);
  });
});

test("le cadre reste centré verticalement après l'agrandissement", () => {
  const c = P.cadreComplement(P.cadrer(P.ZONE, { l: 1141, h: 51 }));
  const hautEnHaut = c.y - P.ZONE.y;
  const basEnBas = (P.ZONE.y + P.ZONE.h) - (c.y + c.h);
  assert.ok(Math.abs(hautEnHaut - basEnBas) <= 1, "écart : " + (hautEnHaut - basEnBas));
});

test("dans le support, un visuel plat n'est plus réduit à sa barre", async () => {
  const plat = LIEN_PBI + "&width=1140.87&height=51.48";
  const { txt } = await lireP(await deckP([{ titre: "A", lien: plat, vivant: true }]));
  const m = cadreComplement(txt("ppt/slides/slide2.xml"));
  assert.ok(Number(m[2]) >= P.HAUTEUR_MINI_COMPLEMENT, "hauteur du cadre : " + m[2]);
});

/* ─── Empreintes : ce qui fait que le complément retrouve le visuel ──
   Vérifié dans PowerPoint : sans la mémoire relevée sur une insertion
   manuelle, le complément affiche « l'objet visuel n'existe plus »,
   même quand l'adresse est rigoureusement la bonne. */

const EmpP = require("./js/empreintes.js");

/** Empreinte minimale mais complète, pour le lien d'essai. */
function empreintePour(lien) {
  return {
    id: EmpP.cleVisuel(lien),
    libelle: "Histo empilé",
    proprietes: {
      artifactName: "&quot;Histo empilé&quot;",
      reportName: "&quot;Pilotage&quot;",
      pageName: "&quot;page1&quot;",
      pageDisplayName: "&quot;Mix&quot;",
      datasetId: "&quot;55e74324&quot;",
      bookmark: "&quot;H4sIEtatSerialise&quot;",
      embedUrl: "&quot;/reportEmbed?reportId=abc&amp;config=xyz&quot;",
      backgroundColor: "&quot;#FFF&quot;"
    },
    _mtime: 1, _by: "essai"
  };
}

const nomsProprietes = xml =>
  [...xml.matchAll(/<we:property name="([^"]+)"/g)].map(m => m[1]);

test("sans empreinte, le générateur produit exactement ce qu'il produisait", async () => {
  const { txt } = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const noms = nomsProprietes(txt("ppt/webextensions/webextension1.xml"));
  assert.deepStrictEqual(noms, P.PROPRIETES_PAR_DEFAUT);
});

test("avec une empreinte, la mémoire du complément est rendue au fichier", async () => {
  const { txt } = await lireP(await deckP(
    [{ titre: "A", lien: LIEN_PBI, vivant: true }],
    { empreintes: [empreintePour(LIEN_PBI)] }
  ));
  const noms = nomsProprietes(txt("ppt/webextensions/webextension1.xml"));
  ["artifactName", "reportName", "pageName", "pageDisplayName", "datasetId",
   "bookmark", "initialStateBookmark"].forEach(n => {
    assert.ok(noms.includes(n), n + " doit être écrit dans le fichier");
  });
});

test("aucune propriété n'est écrite deux fois : le complément n'en lirait qu'une", async () => {
  const { txt } = await lireP(await deckP(
    [{ titre: "A", lien: LIEN_PBI, vivant: true }],
    { empreintes: [empreintePour(LIEN_PBI)] }
  ));
  const noms = nomsProprietes(txt("ppt/webextensions/webextension1.xml"));
  assert.strictEqual(new Set(noms).size, noms.length, "doublons : " + noms.join(", "));
});

test("l'adresse d'incorporation relevée remplace celle que le générateur devine", async () => {
  const { txt } = await lireP(await deckP(
    [{ titre: "A", lien: LIEN_PBI, vivant: true }],
    { empreintes: [empreintePour(LIEN_PBI)] }
  ));
  const xml = txt("ppt/webextensions/webextension1.xml");
  const m = xml.match(/name="embedUrl" value="([^"]*)"/);
  assert.ok(m && m[1].includes("reportId=abc"), "adresse posée : " + (m && m[1]));
});

test("l'adresse du rapport n'est JAMAIS modifiée par l'empreinte", async () => {
  const sans = await lireP(await deckP([{ titre: "A", lien: LIEN_PBI, vivant: true }]));
  const avec = await lireP(await deckP(
    [{ titre: "A", lien: LIEN_PBI, vivant: true }],
    { empreintes: [empreintePour(LIEN_PBI)] }
  ));
  const url = t => t("ppt/webextensions/webextension1.xml").match(/name="reportUrl" value="([^"]*)"/)[1];
  assert.strictEqual(url(avec.txt), url(sans.txt));
});

/* L'empreinte vaut pour UN lien, signet compris. Vérifié dans PowerPoint :
   huit insertions du même visuel donnent huit états sérialisés
   différents — l'état porte les filtres du KPI relevé. L'emprunter à un
   voisin afficherait le bon graphique avec les mauvais chiffres. */

test("l'empreinte d'un autre visuel de la même page n'est PAS empruntée", async () => {
  const voisin = empreintePour(LIEN_PBI.replace(/visual=[^&]*/, "visual=ffffffffffffffffffff"));
  const { txt } = await lireP(await deckP(
    [{ titre: "A", lien: LIEN_PBI, vivant: true }], { empreintes: [voisin] }
  ));
  assert.deepStrictEqual(nomsProprietes(txt("ppt/webextensions/webextension1.xml")),
    P.PROPRIETES_PAR_DEFAUT);
});

test("l'empreinte d'un autre SIGNET du même visuel n'est pas appliquée", async () => {
  const lienA = LIEN_PBI + "&bookmarkGuid=aaaa";
  const lienB = LIEN_PBI + "&bookmarkGuid=bbbb";
  const { txt } = await lireP(await deckP(
    [{ titre: "A", lien: lienB, vivant: true }], { empreintes: [empreintePour(lienA)] }
  ));
  assert.deepStrictEqual(nomsProprietes(txt("ppt/webextensions/webextension1.xml")),
    P.PROPRIETES_PAR_DEFAUT);
});

test("l'empreinte du bon signet, elle, est appliquée intégralement", async () => {
  const lien = LIEN_PBI + "&bookmarkGuid=aaaa";
  const { txt } = await lireP(await deckP(
    [{ titre: "A", lien, vivant: true }], { empreintes: [empreintePour(lien)] }
  ));
  const noms = nomsProprietes(txt("ppt/webextensions/webextension1.xml"));
  ["artifactName", "bookmark", "initialStateBookmark"].forEach(n =>
    assert.ok(noms.includes(n), n + " doit être écrit"));
});

test("une diapositive en image ignore les empreintes", () => {
  const d = P.avecEmpreinte({ titre: "A", lien: LIEN_PBI, image: pngP(4, 3) },
    [empreintePour(LIEN_PBI)]);
  assert.ok(!d.proprietesComplement);
});

test("ce qui est posé à la main sur la diapositive prime sur l'empreinte", () => {
  const d = P.avecEmpreinte(
    { titre: "A", lien: LIEN_PBI, vivant: true, proprietesComplement: { artifactName: "&quot;Imposé&quot;" } },
    [empreintePour(LIEN_PBI)]
  );
  assert.strictEqual(d.proprietesComplement.artifactName, "&quot;Imposé&quot;");
  assert.ok(d.proprietesComplement.bookmark, "le reste de l'empreinte est conservé");
});

test("sans liste d'empreintes, la diapositive est rendue telle quelle", () => {
  const d = { titre: "A", lien: LIEN_PBI, vivant: true };
  assert.strictEqual(P.avecEmpreinte(d, null), d);
  assert.strictEqual(P.avecEmpreinte(d, []), d);
});
