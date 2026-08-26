/* Génère tests.html : injecte le harnais, le simulateur et les tests
   dans la coque de présentation (tests-shell.html).
   Aucune duplication : les tests sont exactement ceux exécutés en local. */
const fs = require("fs");
const lire = f => fs.readFileSync(f, "utf8");

/* Retire les appels propres à Node des fichiers de test */
function adapter(src) {
  return src
    .replace(/^const \{ test \} = require\("node:test"\);\s*$/m, "")
    .replace(/^const assert = require\("node:assert"\);\s*$/m, "")
    .replace(/^const \{[^}]*\} = require\("\.\/js\/merge\.js"\);\s*$/m, "")
    .replace(/^const \{[^}]*\} = require\("\.\/sync-sim\.js"\);\s*$/m, "")
    .replace(/^const \{ loadApp \} = require\("\.\/app-harness\.js"\);\s*$/m, "")
    // Modules exposés globalement par le bac à sable : pas de require côté navigateur
    // Accès différé : les modules n'existent qu'une fois le bac à sable chargé,
    // or ces lignes s'exécutent au chargement de la page.
    .replace(/^const (\w+) = require\("\.\/js\/zip\.js"\);\s*$/m, "const $1 = __module(\"ZipMini\");")
    .replace(/^const (\w+) = require\("\.\/js\/pptx\.js"\);\s*$/m, "const $1 = __module(\"PptxDeck\");")
    .replace(/^const (\w+) = require\("\.\/js\/selection\.js"\);\s*$/m, "const $1 = __module(\"Selection\");")
    .replace(/^const (\w+) = require\("\.\/js\/empreintes\.js"\);\s*$/m, "const $1 = __module(\"Empreintes\");")
    .replace(/^const (\w+) = require\("\.\/js\/derivation\.js"\);\s*$/m, "const $1 = __module(\"Derivation\");")
    .replace(/^const fs = require\("node:fs"\);\s*$/m, "")
    .replace(/^const path = require\("node:path"\);\s*$/m, "")
    // Le modèle PowerPoint est téléchargé par la coque, pas lu sur le disque
    .replace(/if \(!_modele\) _modele = new Uint8Array\(fs\.readFileSync[\s\S]*?\);\n/,
             "if (!_modele) _modele = window.__modeleDeck;\n")
    .replace(/^const A = loadApp\(\);.*$/m, "")
    .replace(/^module\.exports[^;]*;\s*$/m, "");
}

const harnais = lire("harness-core.js").replace(/^\s*module\.exports[^;]*;\s*$/m, "");
const simulateur = lire("sync-sim.js")
  .replace(/^const M = require\("\.\/js\/merge\.js"\);\s*$/m,
           'const M = window;   // les fonctions de fusion sont exposées globalement')
  .replace(/^module\.exports[^;]*;\s*$/m, "");

const groupes = [
  ["Moteur de fusion", "merge.test.js"],
  ["Synchronisation multi-appareils", "sync.test.js"],
  ["Fonctions de l'application", "app.test.js"],
  ["Affichage, import/export et corbeille", "app-ui.test.js"],
  ["Flux complets : synchro, formulaire, persistance", "app-flows.test.js"],
  ["Archive ZIP (fabrique PowerPoint)", "zip.test.js"],
  ["Sélections de rituel", "selection.test.js"],
  ["Empreintes de visuels Power BI", "empreintes.test.js"],
  ["Fabrique PowerPoint", "pptx.test.js"],
  ["Sélection → PowerPoint : flux complet", "deck.test.js"]
];

const tests = groupes
  .map(([nom, fichier]) => `__ouvrirGroupe(${JSON.stringify(nom)});\n${adapter(lire(fichier))}`)
  .join("\n");

const html = lire("tests-shell.html")
  .replace("/*__HARNESS__*/", () => harnais)
  .replace("/*__SYNCSIM__*/", () => simulateur)
  .replace("/*__TESTS__*/", () => tests);

fs.writeFileSync("tests.html", html);
const nb = (tests.match(/^test\(/gm) || []).length;
console.log(`tests.html généré : ${(html.length / 1024).toFixed(1)} Ko · ${groupes.length} domaines · ~${nb} tests`);
