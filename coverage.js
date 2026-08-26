/* Mesure de couverture : enveloppe chaque fonction d'app.js pour savoir
   lesquelles sont réellement exécutées par la suite de tests. */
const fs = require("fs");
const { loadApp } = require("./app-harness.js");

const source = fs.readFileSync("app.js", "utf8");
const noms = [...new Set([...source.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]))];

const A = loadApp();

/* Enveloppe chaque fonction pour enregistrer les appels */
A.run("globalThis.__appelees = new Set();");
let enveloppees = 0;
noms.forEach(n => {
  try {
    A.run(`${n} = (function (orig) {
      return function () { globalThis.__appelees.add(${JSON.stringify(n)}); return orig.apply(this, arguments); };
    })(${n});`);
    enveloppees++;
  } catch { /* fonction non réassignable : ignorée */ }
});

/* Rejoue les tests des fichiers qui utilisent le harnais */
const fichiers = ["app.test.js", "app-ui.test.js", "app-flows.test.js"];
const assert = require("node:assert");

(async function () {
  let total = 0, echecs = 0;
  for (const f of fichiers) {
    const src = fs.readFileSync(f, "utf8")
      .replace(/^const \{ test \} = require\("node:test"\);\s*$/m, "")
      .replace(/^const assert = require\("node:assert"\);\s*$/m, "")
      .replace(/^const \{ loadApp \} = require\("\.\/app-harness\.js"\);\s*$/m, "")
      .replace(/^const A = loadApp\(\);.*$/m, "");
    const collectes = [];
    const test = (nom, fn) => collectes.push({ nom, fn });
    new Function("test", "assert", "A", src)(test, assert, A);
    for (const t of collectes) {
      total++;
      try { await t.fn(); } catch { echecs++; }
    }
  }

  const appelees = new Set(A.run("Array.from(globalThis.__appelees)"));
  const jamais = noms.filter(n => !appelees.has(n)).sort();
  console.log(`Fonctions dans app.js : ${noms.length} (dont ${enveloppees} instrumentées)`);
  console.log(`Tests rejoués : ${total} (${echecs} en échec)`);
  console.log(`Couverture : ${appelees.size}/${noms.length} = ${Math.round(appelees.size / noms.length * 100)} %`);
  console.log(`\nFonctions JAMAIS exécutées (${jamais.length}) :`);
  jamais.forEach(n => console.log("  · " + n));
})();
