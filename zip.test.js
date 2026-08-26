/* Tests de la couche archive (js/zip.js).
   Un .pptx est une archive ZIP : si cette couche est fausse,
   PowerPoint refuse d'ouvrir le fichier produit.
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const ZipZ = require("./js/zip.js");

const octetsZ = s => ZipZ.versOctets(s);

/* ─── CRC-32 ───────────────────────────────────────────────── */

test("crc32 : valeur de référence connue", () => {
  // « 123456789 » → 0xCBF43926, valeur de contrôle universelle du CRC-32
  assert.equal(ZipZ.crc32(octetsZ("123456789")), 0xCBF43926);
});

test("crc32 : une entrée vide vaut zéro", () => {
  assert.equal(ZipZ.crc32(new Uint8Array(0)), 0);
});

test("crc32 : deux contenus différents ne donnent pas la même empreinte", () => {
  assert.notEqual(ZipZ.crc32(octetsZ("abc")), ZipZ.crc32(octetsZ("abd")));
});

/* ─── Aller-retour ─────────────────────────────────────────── */

test("écrire puis relire restitue exactement les pièces", async () => {
  const archive = ZipZ.ecrireZip([
    { nom: "a.xml", donnees: "<a/>" },
    { nom: "dossier/b.txt", donnees: "contenu" }
  ]);
  const pieces = await ZipZ.lireZip(archive);
  assert.equal(pieces.size, 2);
  assert.equal(ZipZ.versTexte(pieces.get("a.xml")), "<a/>");
  assert.equal(ZipZ.versTexte(pieces.get("dossier/b.txt")), "contenu");
});

test("les accents survivent à l'aller-retour", async () => {
  const attendu = "Réception — Volumétrie « LGT »";
  const pieces = await ZipZ.lireZip(ZipZ.ecrireZip([{ nom: "é.xml", donnees: attendu }]));
  assert.equal(ZipZ.versTexte(pieces.get("é.xml")), attendu);
});

test("les données binaires ne sont pas altérées", async () => {
  const binaire = new Uint8Array(512);
  for (let i = 0; i < binaire.length; i++) binaire[i] = (i * 7) % 256;
  const pieces = await ZipZ.lireZip(ZipZ.ecrireZip([{ nom: "img.png", donnees: binaire }]));
  assert.deepEqual([...pieces.get("img.png")], [...binaire]);
});

test("une pièce vide reste une pièce, pas une disparition", async () => {
  const pieces = await ZipZ.lireZip(ZipZ.ecrireZip([{ nom: "vide.xml", donnees: "" }]));
  assert.ok(pieces.has("vide.xml"));
  assert.equal(pieces.get("vide.xml").length, 0);
});

test("une Map est acceptée comme source", async () => {
  const source = new Map([["x.xml", "<x/>"]]);
  const pieces = await ZipZ.lireZip(ZipZ.ecrireZip(source));
  assert.equal(ZipZ.versTexte(pieces.get("x.xml")), "<x/>");
});

test("l'ordre des pièces est conservé : [Content_Types].xml doit rester en tête", async () => {
  const archive = ZipZ.ecrireZip([
    { nom: "[Content_Types].xml", donnees: "<Types/>" },
    { nom: "ppt/presentation.xml", donnees: "<p/>" }
  ]);
  const noms = [...(await ZipZ.lireZip(archive)).keys()];
  assert.equal(noms[0], "[Content_Types].xml");
});

/* ─── Robustesse ───────────────────────────────────────────── */

test("une archive tronquée est signalée, pas silencieusement acceptée", async () => {
  const archive = ZipZ.ecrireZip([{ nom: "a.xml", donnees: "<a/>" }]);
  await assert.rejects(() => ZipZ.lireZip(archive.slice(0, 20)), /illisible/i);
});

test("un contenu qui n'est pas une archive est refusé", async () => {
  await assert.rejects(() => ZipZ.lireZip(new Uint8Array(64)), /illisible/i);
});

test("l'archive produite est reproductible : deux écritures identiques donnent le même fichier", () => {
  const faire = () => ZipZ.ecrireZip([{ nom: "a.xml", donnees: "<a/>" }]);
  assert.deepEqual([...faire()], [...faire()]);
});

test("une archive compressée par un autre outil reste lisible (méthode dégonflée)", async () => {
  if (typeof require !== "function") return;   // banc navigateur : pas de zlib
  const zlib = require("node:zlib");
  const contenu = ZipZ.versOctets("<xml>compressé</xml>".repeat(20));
  const comprime = zlib.deflateRawSync(Buffer.from(contenu));

  // Fabrication manuelle d'une archive « deflate » minimale
  const nom = ZipZ.versOctets("z.xml");
  const crc = ZipZ.crc32(contenu);
  const total = 30 + nom.length + comprime.length + 46 + nom.length + 22;
  const out = new Uint8Array(total);
  const vue = new DataView(out.buffer);
  let p = 0;
  vue.setUint32(p, 0x04034b50, true); vue.setUint16(p + 4, 20, true); vue.setUint16(p + 6, 0x0800, true);
  vue.setUint16(p + 8, 8, true); vue.setUint32(p + 14, crc, true);
  vue.setUint32(p + 18, comprime.length, true); vue.setUint32(p + 22, contenu.length, true);
  vue.setUint16(p + 26, nom.length, true);
  p += 30; out.set(nom, p); p += nom.length;
  out.set(comprime, p); p += comprime.length;
  const debutCentral = p;
  vue.setUint32(p, 0x02014b50, true); vue.setUint16(p + 4, 20, true); vue.setUint16(p + 6, 20, true);
  vue.setUint16(p + 8, 0x0800, true); vue.setUint16(p + 10, 8, true); vue.setUint32(p + 16, crc, true);
  vue.setUint32(p + 20, comprime.length, true); vue.setUint32(p + 24, contenu.length, true);
  vue.setUint16(p + 28, nom.length, true); vue.setUint32(p + 42, 0, true);
  p += 46; out.set(nom, p); p += nom.length;
  vue.setUint32(p, 0x06054b50, true); vue.setUint16(p + 8, 1, true); vue.setUint16(p + 10, 1, true);
  vue.setUint32(p + 12, p - debutCentral, true); vue.setUint32(p + 16, debutCentral, true);

  const pieces = await ZipZ.lireZip(out);
  assert.equal(ZipZ.versTexte(pieces.get("z.xml")), ZipZ.versTexte(contenu));
});
