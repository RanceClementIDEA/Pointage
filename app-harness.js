/* Harnais Node : lit les fichiers sur le disque et délègue au cœur partagé
   (harness-core.js), identique à celui utilisé par la page tests.html. */
const fs = require("fs");
const path = require("path");
const { creerHarnais } = require("./harness-core.js");

const FICHIERS = ["js/storage.js", "js/merge.js", "js/carousel.js",
                  "js/zip.js", "js/empreintes.js", "js/derivation.js", "js/pptx.js", "js/inspecter-deck.js",
                  "js/selection.js", "app.js"];

function loadApp() {
  const sources = FICHIERS.map(f => fs.readFileSync(path.join(__dirname, f), "utf8"));
  return creerHarnais(sources);
}
module.exports = { loadApp };
