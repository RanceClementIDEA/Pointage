/* Configuration ESLint (format « flat », v9+).
   Lancement : npm run lint  */
export default [
  {
    files: ["app.js", "js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",          // scripts classiques, portée globale partagée
      globals: {
        window: "readonly", document: "readonly", localStorage: "readonly",
        navigator: "readonly", console: "readonly", firebase: "readonly",
        XLSX: "readonly", Blob: "readonly", URL: "readonly", FileReader: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", confirm: "readonly",
        btoa: "readonly", atob: "readonly", Uint8Array: "readonly",
        Store: "readonly", createCarousel: "readonly",
        // Fabrique de PowerPoint (js/zip.js, js/pptx.js, js/selection.js)
        ZipMini: "readonly", PptxDeck: "readonly", Selection: "readonly", Empreintes: "readonly", Derivation: "readonly",
        InspecteurDeck: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly",
        DecompressionStream: "readonly", CompressionStream: "readonly",
        Response: "readonly", DataView: "readonly",
        /* js/derivation.js tourne des deux côtés : gzip par `zlib` sous
           Node, par les flux du navigateur ailleurs. */
        Buffer: "readonly",
        fetch: "readonly", alert: "readonly", prompt: "readonly", location: "readonly",
        // Double exposition : fichier <script> dans le navigateur, module sous Node
        module: "readonly", require: "readonly",
        mergeEntries: "readonly", mergeOverrides: "readonly", mergeDeleted: "readonly",
        mergeFavorites: "readonly", mergeActivity: "readonly",
        normalizeDeleted: "readonly", isDeletedIn: "readonly",
        mergeParUtilisateur: "readonly", sansMarqueursPurges: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],   // plus de catch muet
      "eqeqeq": ["warn", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
      "max-lines-per-function": ["warn", { max: 60, skipComments: true }]
    }
  },
  {
    /* Outils en ligne de commande : vrais modules Node */
    files: ["outils/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "readonly", process: "readonly",
        console: "readonly", __dirname: "readonly", Buffer: "readonly",
        Uint8Array: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "warn",
      "max-lines-per-function": ["warn", { max: 90, skipComments: true }]
    }
  }
];
