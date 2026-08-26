/* Tests des empreintes de visuels (js/empreintes.js) : ce que le
   complément Power BI doit retrouver dans le fichier pour afficher
   le graphique au lieu de « l'objet visuel n'existe plus ».

   Le comportement décrit ici a été vérifié en conditions réelles sur
   un fichier ouvert dans PowerPoint :
     • adresse seule                      → échoue
     • carte d'identité sans état         → échoue
     • carte d'identité + état sérialisé  → affiche le graphique
     • idem sans les champs de session    → affiche le graphique
   Exécution : node --test  */
const { test } = require("node:test");
const assert = require("node:assert");
const E = require("./js/empreintes.js");

const LIEN = "https://app.powerbi.com/groups/me/reports/"
  + "6a4cf353-aac8-48de-a793-9a8066069ffc/faec2927b8728b9fd32f"
  + "?ctid=c8d76d42-5d9d-4eea-b5cb-d16d0a04a59e&pbi_source=shareVisual"
  + "&visual=14bddbd2925c24715a84&height=550.75&width=1254.63"
  + "&bookmarkGuid=702af139-c1c2-4dca-b44b-2ff37794a5df";

/* La clé porte le SIGNET : plusieurs KPI partagent souvent le même
   visuel, et ce sont leurs filtres — donc leur `bookmarkGuid` — qui les
   distinguent. Vérifié sur huit insertions du même visuel : huit
   signets, huit états sérialisés tous différents. */
const CLE_VISUEL = "6a4cf353-aac8-48de-a793-9a8066069ffc/faec2927b8728b9fd32f"
  + "/14bddbd2925c24715a84/702af139-c1c2-4dca-b44b-2ff37794a5df";

/* Un relevé tel qu'il sort d'un complément : valeurs encodées pour XML,
   guillemets compris — c'est ainsi que Power BI les écrit. */
const RELEVE = {
  reportUrl: "&quot;/groups/me/reports/6a4cf353-aac8-48de-a793-9a8066069ffc/"
    + "faec2927b8728b9fd32f?ctid=c8d76d42-5d9d-4eea-b5cb-d16d0a04a59e"
    + "&amp;pbi_source=shareVisual&amp;visual=14bddbd2925c24715a84"
    + "&amp;bookmarkGuid=702af139-c1c2-4dca-b44b-2ff37794a5df&quot;",
  embedUrl: "&quot;/reportEmbed?reportId=6a4cf353-aac8-48de-a793-9a8066069ffc&quot;",
  artifactName: "&quot;Histo empilé&quot;",
  reportName: "&quot;Pilotage d'exploitation logistique&quot;",
  pageName: "&quot;faec2927b8728b9fd32f&quot;",
  pageDisplayName: "&quot;✨Mix&quot;",
  datasetId: "&quot;55e74324-9265-4887-aa38-37a14b32a847&quot;",
  bookmark: "&quot;H4sIAAAAAAAAA-etat-serialise&quot;",
  initialStateBookmark: "&quot;H4sIAAAAAAAAA-etat-serialise&quot;",
  backgroundColor: "&quot;#FFF&quot;",
  reportState: "&quot;CONNECTED&quot;",
  creatorSessionId: "&quot;dd4155af&quot;",
  creatorUserId: "&quot;1003200592A84FCB&quot;",
  creatorTenantId: "&quot;c8d76d42&quot;",
  reportEmbeddedTime: "&quot;2026-08-24T11:23:44.821Z&quot;",
  numberOfAnnotations: "0",
  annotationNoteShown: "true"
};

/* ─── cleVisuel ────────────────────────────────────────────── */

test("la clé réunit le rapport, la page, le visuel ET le signet", () => {
  assert.strictEqual(E.cleVisuel(LIEN), CLE_VISUEL);
});

test("la clé ignore la taille demandée, qui change d'un partage à l'autre", () => {
  const autre = LIEN.replace("height=550.75&width=1254.63", "height=300&width=800");
  assert.strictEqual(E.cleVisuel(autre), E.cleVisuel(LIEN));
});

test("deux signets du même visuel sont deux KPI distincts", () => {
  const autre = LIEN.replace(/bookmarkGuid=[^&]*/, "bookmarkGuid=36cc4e7f-8950-48e0-98ea-7c59d8fce76e");
  assert.notStrictEqual(E.cleVisuel(autre), E.cleVisuel(LIEN));
});

test("un lien sans signet garde une clé, réduite au visuel", () => {
  const sans = LIEN.replace(/&bookmarkGuid=[^&]*/, "");
  assert.strictEqual(E.cleVisuel(sans),
    "6a4cf353-aac8-48de-a793-9a8066069ffc/faec2927b8728b9fd32f/14bddbd2925c24715a84");
});

test("un lien de page, sans visual, n'a pas de clé : il n'y a pas de visuel à retrouver", () => {
  assert.strictEqual(E.cleVisuel(LIEN.replace(/&visual=[^&]*/, "")), "");
});

test("un lien vide ou absurde ne fait pas tomber la fonction", () => {
  ["", null, undefined, "bonjour", "https://exemple.fr"].forEach(v => {
    assert.strictEqual(E.cleVisuel(v), "");
  });
});

/* ─── creerEmpreinte ───────────────────────────────────────── */

test("une empreinte se déduit d'un relevé de complément", () => {
  const emp = E.creerEmpreinte(RELEVE, { horodatage: 1000, auteur: "clement" });
  assert.strictEqual(emp.id, CLE_VISUEL);
  assert.strictEqual(emp.libelle, "Histo empilé");
  assert.strictEqual(emp._mtime, 1000);
  assert.strictEqual(emp._by, "clement");
});

test("les champs propres à la session d'insertion ne sont jamais relevés", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  E.CHAMPS_DE_SESSION.forEach(n => {
    assert.ok(!(n in emp.proprietes), n + " ne doit pas être relevé");
  });
});

test("l'état sérialisé n'est stocké qu'une fois : les deux copies sont identiques", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  assert.ok(emp.proprietes.bookmark, "l'état doit être conservé");
  assert.ok(!("initialStateBookmark" in emp.proprietes), "la copie ne doit pas être stockée");
});

test("une diapositive FABRIQUÉE ne produit pas d'empreinte : elle n'a rien appris", () => {
  const fabriquee = {
    reportUrl: RELEVE.reportUrl, embedUrl: RELEVE.embedUrl,
    reportState: RELEVE.reportState, backgroundColor: RELEVE.backgroundColor
  };
  assert.strictEqual(E.creerEmpreinte(fabriquee, {}), null);
});

test("un relevé sans adresse exploitable ne produit pas d'empreinte", () => {
  assert.strictEqual(E.creerEmpreinte({ artifactName: "&quot;X&quot;" }, {}), null);
  assert.strictEqual(E.creerEmpreinte(null, {}), null);
});

/* ─── proprietesPour ───────────────────────────────────────── */

test("la copie de l'état est reconstituée au moment de fabriquer le fichier", () => {
  const props = E.proprietesPour(E.creerEmpreinte(RELEVE, {}));
  assert.strictEqual(props.initialStateBookmark, props.bookmark);
});

test("les valeurs sont rendues telles qu'elles ont été relevées, sans ré-encodage", () => {
  const props = E.proprietesPour(E.creerEmpreinte(RELEVE, {}));
  assert.strictEqual(props.artifactName, RELEVE.artifactName);
  assert.strictEqual(props.pageDisplayName, RELEVE.pageDisplayName);
});

test("une empreinte vide ne rend aucune propriété", () => {
  assert.strictEqual(E.proprietesPour(null), null);
  assert.strictEqual(E.proprietesPour({ proprietes: {} }), null);
});

/* ─── empreinteComplete ────────────────────────────────────── */

test("une empreinte sans état sérialisé est incomplète — vérifié : elle ne suffit pas", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  assert.ok(E.empreinteComplete(emp));
  delete emp.proprietes.bookmark;
  assert.ok(!E.empreinteComplete(emp),
    "la carte d'identité seule laisse le complément afficher « l'objet visuel n'existe plus »");
});

test("le nom du visuel n'entre pas dans le compte : seul l'état fait s'afficher le graphique", () => {
  // Vérifié dans PowerPoint : l'état réel privé d'artifactName s'affiche.
  const emp = E.creerEmpreinte(RELEVE, {});
  delete emp.proprietes.artifactName;
  assert.ok(E.empreinteComplete(emp));
});

/* ─── trouver ──────────────────────────────────────────────── */

test("on retrouve l'empreinte d'un lien, quelle que soit sa taille demandée", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  const autre = LIEN.replace("height=550.75&width=1254.63", "height=200&width=400");
  assert.strictEqual(E.trouver([emp], autre).id, CLE_VISUEL);
});

test("un lien sans empreinte connue rend null, sans erreur", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  const inconnu = LIEN.replace("14bddbd2925c24715a84", "ffffffffffffffffffff");
  assert.strictEqual(E.trouver([emp], inconnu), null);
  assert.strictEqual(E.trouver([], LIEN), null);
  assert.strictEqual(E.trouver(null, LIEN), null);
});

test("les empreintes se cherchent aussi dans un dictionnaire", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  assert.strictEqual(E.trouver({ [CLE_VISUEL]: emp }, LIEN).id, CLE_VISUEL);
});

/* ─── fusionnerEmpreintes ──────────────────────────────────── */

test("la fusion garde la version la plus récente, comme pour les fiches", () => {
  const ancienne = E.normaliserEmpreinte({ id: CLE_VISUEL, libelle: "ancien",
    proprietes: { artifactName: "a", bookmark: "b" }, _mtime: 100 });
  const recente = E.normaliserEmpreinte({ id: CLE_VISUEL, libelle: "récent",
    proprietes: { artifactName: "z", bookmark: "b" }, _mtime: 900 });
  assert.strictEqual(E.fusionnerEmpreintes([ancienne], [recente])[0].libelle, "récent");
  assert.strictEqual(E.fusionnerEmpreintes([recente], [ancienne])[0].libelle, "récent");
});

test("la fusion réunit les empreintes des deux côtés", () => {
  const a = E.normaliserEmpreinte({ id: "r/p/a", proprietes: { artifactName: "A" }, _mtime: 1 });
  const b = E.normaliserEmpreinte({ id: "r/p/b", proprietes: { artifactName: "B" }, _mtime: 1 });
  assert.strictEqual(E.fusionnerEmpreintes([a], [b]).length, 2);
});

test("une empreinte sans identifiant est écartée de la fusion", () => {
  const bonne = E.normaliserEmpreinte({ id: CLE_VISUEL, proprietes: { artifactName: "A" }, _mtime: 1 });
  assert.strictEqual(E.fusionnerEmpreintes([bonne, { libelle: "orphelin" }], []).length, 1);
});

test("la fusion accepte l'absence de données des deux côtés", () => {
  assert.deepStrictEqual(E.fusionnerEmpreintes(null, undefined), []);
});

/* ─── poids ────────────────────────────────────────────────── */

test("le poids du lot est mesurable : le document partagé est plafonné", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  assert.ok(E.poids([emp]) > 0);
  assert.ok(E.poids([emp, emp]) > E.poids([emp]));
  assert.strictEqual(E.poids([]), 0);
  assert.strictEqual(E.poids(null), 0);
});

/* ─── normaliserEmpreinte ──────────────────────────────────── */

test("la normalisation comble les champs manquants sans inventer de contenu", () => {
  const emp = E.normaliserEmpreinte({});
  assert.deepStrictEqual(emp.proprietes, {});
  assert.strictEqual(emp.libelle, "");
  assert.strictEqual(emp._by, "?");
});

test("la normalisation écarte tout champ hors de la liste relevée", () => {
  const emp = E.normaliserEmpreinte({ id: CLE_VISUEL,
    proprietes: { artifactName: "A", creatorUserId: "X", nimporteQuoi: "Y" } });
  assert.deepStrictEqual(Object.keys(emp.proprietes), ["artifactName"]);
});

/* ─── Garde-fou : l'état doit être celui de la bonne page ───
   Un support de diagnostic porte des compléments où l'état d'une page a
   été posé sur le visuel d'une autre. Relevés tels quels, ils
   prétendraient couvrir une page dont ils n'ont pas l'état, et
   empêcheraient d'en relever la vraie empreinte. */

test("un complément dont l'état vient d'une autre page est écarté", () => {
  const piege = Object.assign({}, RELEVE, {
    reportUrl: RELEVE.reportUrl.replace("faec2927b8728b9fd32f", "62748b2b1a0c66bd4a3a")
    // pageName reste celui de faec2927 : l'état appartient à l'autre page
  });
  assert.strictEqual(E.creerEmpreinte(piege, {}), null);
});

test("un complément cohérent avec sa page est bien relevé", () => {
  const bon = Object.assign({}, RELEVE, {
    reportUrl: RELEVE.reportUrl.replace("faec2927b8728b9fd32f", "62748b2b1a0c66bd4a3a"),
    pageName: "&quot;62748b2b1a0c66bd4a3a&quot;"
  });
  assert.ok(E.creerEmpreinte(bon, {}));
});

test("sans pageName mémorisé, on ne peut rien vérifier : le relevé passe", () => {
  const sansPage = Object.assign({}, RELEVE);
  delete sansPage.pageName;
  assert.ok(E.creerEmpreinte(sansPage, {}));
});

/* ─── Le signet, ce qui distingue deux KPI d'un même visuel ─
   Sur l'annuaire réel, trois KPI « Volumétrie » partagent un visuel et
   quatre « Taux de service » un autre. Vérifié en conditions réelles :
   huit insertions du même visuel donnent huit états différents. Une
   empreinte ne vaut donc QUE pour son signet — l'emprunter à un voisin
   afficherait le bon graphique avec les chiffres d'un autre KPI. */

const SIGNET_AUTRE = LIEN.replace(/bookmarkGuid=[^&]*/, "bookmarkGuid=36cc4e7f-8950-48e0-98ea-7c59d8fce76e");

test("le signet d'un lien est lu, et son absence ne casse rien", () => {
  assert.strictEqual(E.signetDe(LIEN), "702af139-c1c2-4dca-b44b-2ff37794a5df");
  assert.strictEqual(E.signetDe(LIEN.replace(/&bookmarkGuid=[^&]*/, "")), "");
  assert.strictEqual(E.signetDe(null), "");
});

test("l'empreinte mémorise le signet dont son état provient", () => {
  assert.strictEqual(E.creerEmpreinte(RELEVE, {}).signet,
    "702af139-c1c2-4dca-b44b-2ff37794a5df");
});

test("sur son propre signet, l'empreinte s'applique", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  const r = E.resoudre([emp], LIEN);
  assert.ok(r && r.proprietes.bookmark);
  assert.strictEqual(r.memeSignet, true);
});

test("sur un AUTRE signet, rien n'est posé : mieux vaut rien qu'une vue fausse", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  assert.strictEqual(E.resoudre([emp], SIGNET_AUTRE), null);
});

test("un autre visuel de la même page n'emprunte plus rien", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  const voisin = LIEN.replace("14bddbd2925c24715a84", "aaaabbbbccccddddeeee");
  assert.strictEqual(E.resoudre([emp], voisin), null);
});

test("le signet survit à la normalisation et à la fusion", () => {
  const emp = E.creerEmpreinte(RELEVE, { horodatage: 5 });
  assert.strictEqual(E.normaliserEmpreinte(emp).signet, emp.signet);
  assert.strictEqual(E.fusionnerEmpreintes([emp], [])[0].signet, emp.signet);
});

test("deux KPI d'un même visuel cohabitent sans s'écraser", () => {
  const autre = Object.assign({}, RELEVE, {
    reportUrl: RELEVE.reportUrl.replace("702af139-c1c2-4dca-b44b-2ff37794a5df",
                                        "36cc4e7f-8950-48e0-98ea-7c59d8fce76e") });
  const lot = E.fusionnerEmpreintes([E.creerEmpreinte(RELEVE, { horodatage: 1 })],
                                    [E.creerEmpreinte(autre, { horodatage: 2 })]);
  assert.strictEqual(lot.length, 2);
});

/* ─── Le lien repartagé ────────────────────────────────────
   Chaque partage depuis Power BI crée un NOUVEAU bookmarkGuid.
   L'empreinte relevée sur l'ancien devient orpheline : le KPI qui
   marchait hier réclame soudain un relevé, sans raison apparente. */

test("une empreinte du même visuel sur un autre signet est signalée comme dépassée", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  const repartage = LIEN.replace(/bookmarkGuid=[^&]*/, "bookmarkGuid=nouveau-partage");
  assert.strictEqual(E.empreinteDepassee([emp], repartage).id, CLE_VISUEL);
});

test("sur son propre signet, rien n'est dépassé", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  assert.strictEqual(E.empreinteDepassee([emp], LIEN), null);
});

test("un autre visuel n'est pas un lien repartagé", () => {
  const emp = E.creerEmpreinte(RELEVE, {});
  const autre = LIEN.replace("14bddbd2925c24715a84", "aaaabbbbccccddddeeee");
  assert.strictEqual(E.empreinteDepassee([emp], autre), null);
});

test("sans aucune empreinte, il n'y a rien à dépasser", () => {
  assert.strictEqual(E.empreinteDepassee([], LIEN), null);
  assert.strictEqual(E.empreinteDepassee(null, LIEN), null);
  assert.strictEqual(E.empreinteDepassee([E.creerEmpreinte(RELEVE, {})], "pas un lien"), null);
});
