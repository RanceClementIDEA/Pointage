/* ============================================
   ÉTAT GLOBAL
============================================ */
// Version de l'application. À comparer entre appareils via le diagnostic :
// si deux appareils affichent des versions différentes, l'un a un cache périmé.
const APP_VERSION = "2026.07.31";
let data = [];          // Liste affichée = fiches partagées visibles (manualEntries)
let excelData = [];     // Vestige (toujours vide) : l'Excel n'est plus une source de données
let manualEntries = []; // KPIs créés directement dans l'application (partagés)
let personalEntries = []; // Signets personnels de l'utilisateur (locaux, jamais synchronisés)
let overrides = {};     // Modifications apportées aux KPIs Excel, par id
let deletedIds = [];    // Fiches Excel supprimées : [{id, title, freq, at, by}]

/* ── Sélections de KPI & production du PowerPoint ────────────
   Déclarés ici, avec le reste de l'état : les fonctions de
   chargement tournent dès l'ouverture de session. */
let presets = [];          // sélections enregistrées, partagées avec l'équipe
let empreintes = [];       // mémoire du complément Power BI, par visuel (js/empreintes.js)
let selectionMode = false; // le mode « cocher des KPI » est-il actif ?
let selectionIds = [];     // variantes cochées, DANS L'ORDRE de l'ordre du jour
let presetCourant = "";    // identifiant de la sélection chargée, s'il y en a une
let dernierRendu = [];     // groupes affichés au dernier rendu (pour « tout cocher »)
let commentairesVolatils = {}; // commentaires saisis pour une sélection non enregistrée

function isDeleted(id) { return isDeletedIn(deletedIds, id); }

// Enregistre un marqueur de suppression daté (unique point d'entrée).
// Indispensable avec la fusion : sans marqueur, la fiche serait ressuscitée
// par la version encore présente sur le cloud ou un autre poste.
function markDeleted(id, kpi) {
  deletedIds = deletedIds.filter(d => d.id !== id);
  deletedIds.push({
    id,
    title: (kpi && kpi.title) || "",
    freq:  (kpi && kpi.freq)  || "",
    at: now(), by: currentUser || "?", state: "deleted"
  });
}

// Fiches purgées définitivement : masquées pour toujours, plus listées dans la corbeille
let purgedIds = [];
function loadPurged() {
  try { purgedIds = JSON.parse(localStorage.getItem("kpiPurgedIds")) || []; }
  catch { purgedIds = []; }
}
function savePurged(sync = true) {
  ecrireDonnees("kpiPurgedIds", purgedIds);
  if (sync) scheduleAutoSync();
}
function isPurged(id) { return purgedIds.includes(id); }

/* ============================================
   JOURNAL D'ACTIVITÉ (qui a fait quoi, quand)
============================================ */
const LS_ACTIVITY = "kpiActivity";
const MAX_ACTIVITY = 400;
let activityLog = [];

function loadActivity() {
  try { activityLog = JSON.parse(localStorage.getItem(LS_ACTIVITY)) || []; }
  catch { activityLog = []; }
}
function saveActivity(sync = true) {
  ecrireDonnees(LS_ACTIVITY, activityLog);
  if (sync) scheduleAutoSync();
}
// action : "create" | "update" | "delete" | "restore"
function logActivity(action, title, detail, space) {
  activityLog.unshift({
    at: now(),
    by: currentUser || "?",
    action,
    title: title || "",
    detail: detail || "",
    space: space || "shared"
  });
  while (activityLog.length > MAX_ACTIVITY) activityLog.pop();
  saveActivity(false); // l'appelant déclenche la synchro
}
let currentUser = localStorage.getItem("kpiUser");
let favorites = [];
let currentView = "all"; // "all" | "fav"
let editingKpiId = null; // id de référence du KPI en cours d'édition (pour Supprimer/Restaurer)

// ─── État de la modale multi-temporalités ───
const STD_FREQS = ["Mensuelle", "Hebdomadaire", "Quotidienne"];
let modalSlots = {};        // freq → { id, active, ritual, links:{siteKey:url} }

// ─── Sites configurables (périmètres) ───
const SITE_PALETTE = ["#0891B2", "#059669", "#D97706", "#64748B", "#7C3AED", "#DB2777", "#0D9488", "#B45309", "#4F46E5", "#BE123C"];
const DEFAULT_SITES = [
  { key: "logistiport", name: "Logistiport",  badge: "LOG",    color: "#0891B2" },
  { key: "armement",    name: "MG + Débords", badge: "MG+D",   color: "#059669" },
  { key: "armateur",    name: "Armateur",     badge: "ATEUR",  color: "#D97706" },
  { key: "global",      name: "Global",       badge: "GLOBAL", color: "#64748B" }
];
let sites = [];

function loadSites() {
  try { sites = JSON.parse(localStorage.getItem("kpiSites")); } catch { sites = null; }
  if (!Array.isArray(sites) || !sites.length) sites = JSON.parse(JSON.stringify(DEFAULT_SITES));
}
function saveSites(sync = true) {
  ecrireDonnees("kpiSites", sites);
  if (sync) scheduleAutoSync();
}
function siteBadgeLabel(s) { return (s.badge || s.name || "").toUpperCase().slice(0, 8); }

// Sites réellement visibles (hors marqueurs de suppression), dans l'ordre.
// `sites` peut contenir des sites _dele:true conservés pour la synchro.
function activeSites() { return sites.filter(s => s && !s._deleted); }
let modalCurrentFreq = "Mensuelle";
let modalExtraVariants = []; // variantes de fréquence non-standard, préservées telles quelles
let modalInitialIds = {};   // freq → id d'origine (pour détecter les suppressions)

// Classe un id : "manual", "perso" ou null.
// Si le même identifiant existe des deux côtés (donnée abîmée par une
// ancienne version), c'est le PRÉFIXE de l'identifiant qui tranche : lui seul
// est stable. Sans cette règle, une fiche partagée dupliquée dans l'espace
// personnel était classée « perso » et devenait impossible à supprimer de
// l'annuaire partagé.
function classifyId(id) {
  const dansPerso  = personalEntries.some(k => k.id === id);
  const dansPartage = manualEntries.some(k => k.id === id);
  if (dansPerso && dansPartage) return String(id).startsWith("perso_") ? "perso" : "manual";
  if (dansPerso) return "perso";
  if (dansPartage) return "manual";
  return null;
}

/**
 * Répare les identifiants présents à la fois dans l'annuaire partagé et dans
 * l'espace personnel. Le préfixe de l'identifiant fait foi ; la copie en trop
 * est retirée. Sans cela la fiche s'affichait en double et repartait dans
 * l'annuaire partagé à chaque synchronisation.
 * @returns {number} nombre de doublons corrigés
 */
function reparerCollisionsEspaces() {
  if (!manualEntries.length || !personalEntries.length) return 0;
  const idsPerso = new Set(personalEntries.map(k => k && k.id));
  const collisions = manualEntries.filter(k => k && idsPerso.has(k.id)).map(k => k.id);
  if (!collisions.length) return 0;

  collisions.forEach(id => {
    if (String(id).startsWith("perso_")) {
      manualEntries = manualEntries.filter(k => k.id !== id);
    } else {
      personalEntries = personalEntries.filter(k => k.id !== id);
    }
  });
  saveManualEntries(false);
  Store.writeJSON("kpiPersonal_" + currentUser, personalEntries);
  console.info(`[Réparation] ${collisions.length} fiche(s) présente(s) dans les deux espaces : doublon retiré.`);
  return collisions.length;
}

/* ============================================
   ÉCRITURE DES DONNÉES — avec gestion du manque de place
   ------------------------------------------------------
   Les données métier s'écrivaient directement dans le stockage du navigateur,
   sans filet. Quand celui-ci est saturé (limite ≈ 5 Mo), l'écriture échoue :
   l'application affichait « ✅ enregistré », la fiche existait à l'écran…
   et disparaissait au rechargement suivant.

   Désormais : on tente d'écrire ; en cas de saturation on libère de la place
   automatiquement, on réessaie, et si rien n'y fait on le DIT clairement.
============================================ */

/** Vrai si l'échec d'écriture vient d'un manque de place. */
function estErreurQuota(err) {
  return !!err && (err.name === "QuotaExceededError" ||
                   err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
                   err.code === 22 || err.code === 1014);
}

/**
 * Libère de la place en urgence, du moins précieux au plus précieux.
 * @returns {boolean} true si quelque chose a pu être libéré
 */
function libererEspaceEnUrgence() {
  let libere = false;
  // 1. Anciennes données que plus rien ne lit (classeur Excel recopié, caches)
  if (libererEspaceInutile() > 0) libere = true;
  // 2. Historique des versions : on ne garde que les 2 plus récentes
  try {
    const list = JSON.parse(localStorage.getItem("kpiSnapshots") || "[]");
    if (Array.isArray(list) && list.length > 2) {
      localStorage.setItem("kpiSnapshots", JSON.stringify(list.slice(0, 2)));
      libere = true;
    }
  } catch { /* illisible : on tente carrément de le retirer */ }
  if (!libere) {
    try { localStorage.removeItem("kpiSnapshots"); libere = true; } catch { /* rien à faire */ }
  }
  // 3. Journal d'activité : on le ramène à 100 entrées
  try {
    const j = JSON.parse(localStorage.getItem("kpiActivity") || "[]");
    if (Array.isArray(j) && j.length > 100) {
      localStorage.setItem("kpiActivity", JSON.stringify(j.slice(0, 100)));
      if (typeof activityLog !== "undefined" && Array.isArray(activityLog)) activityLog = activityLog.slice(0, 100);
      libere = true;
    }
  } catch { /* sans conséquence */ }
  return libere;
}

let dernierAvertissementQuota = 0;

/**
 * Enregistre une donnée métier. Point de passage UNIQUE : c'est ici, et
 * nulle part ailleurs, que le manque de place est traité.
 * @param {string} cle
 * @param {*} valeur   sérialisée en JSON
 * @returns {boolean}  true si l'enregistrement a réussi
 */
function ecrireDonnees(cle, valeur) {
  const texte = JSON.stringify(valeur);
  try {
    localStorage.setItem(cle, texte);
    return true;
  } catch (err) {
    if (!estErreurQuota(err)) {
      console.error(`[Stockage] Échec d'écriture pour « ${cle} ».`, err);
      return false;
    }
    // Deuxième chance : on fait de la place puis on réessaie
    if (libererEspaceEnUrgence()) {
      try { localStorage.setItem(cle, texte);
            console.warn(`[Stockage] Place libérée automatiquement pour enregistrer « ${cle} ».`);
            return true; }
      catch { /* toujours pas : on prévient franchement */ }
    }
    console.error(`[Stockage] Mémoire du navigateur saturée : « ${cle} » n'a PAS été enregistré.`, err);
    if (Date.now() - dernierAvertissementQuota > 30000) {
      dernierAvertissementQuota = Date.now();
      if (typeof showToast === "function") {
        showToast("⛔ Mémoire du navigateur pleine : votre dernière modification N'A PAS été enregistrée. " +
                  "Videz l'historique des versions, puis recommencez.", 8000);
      }
    }
    return false;
  }
}

// Échappe le HTML pour un affichage sûr dans les cartes
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ============================================
   ÉLÉMENTS DOM
============================================ */
const loginScreen   = document.getElementById("loginScreen");
const appShell      = document.getElementById("appShell");
const loginBtn      = document.getElementById("loginBtn");
const usernameInput = document.getElementById("usernameInput");
const userInfo      = document.getElementById("userInfo");
const userAvatar    = document.getElementById("userAvatar");
const logoutBtn     = document.getElementById("logoutBtn");
const container     = document.getElementById("kpiContainer");
const fileInput     = document.getElementById("fileInput");
const refreshBtn    = document.getElementById("refreshBtn");
const searchInput   = document.getElementById("search");
const typeFilter    = document.getElementById("typeFilter");
const processFilter = document.getElementById("processFilter");
const ritualFilter  = document.getElementById("ritualFilter");
const countAll      = document.getElementById("countAll");
const countFav      = document.getElementById("countFav");
const searchCount   = document.getElementById("searchCount");
const topbarBadge   = document.getElementById("topbarBadge");
const emptyState    = document.getElementById("emptyState");
const toastEl       = document.getElementById("toast");
const sidebarOverlay   = document.getElementById("sidebarOverlay");
const syncSettingsBtn  = document.getElementById("syncSettingsBtn");
const syncModal        = document.getElementById("syncModal");
const closeSyncModalBtn= document.getElementById("closeSyncModalBtn");

/* ============================================
   TOAST
============================================ */
let toastTimer;
function showToast(msg, duration = 2200) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), duration);
}

/* ============================================
   LOGIN
============================================ */
function login(user) {
  currentUser = user;
  localStorage.setItem("kpiUser", user);
  loginScreen.style.display = "none";
  appShell.style.display = "flex";

  userInfo.textContent = user;
  userAvatar.textContent = user.charAt(0).toUpperCase();

  // Sur mobile, la sidebar démarre repliée pour laisser la place au contenu
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("collapsed");
  }

  loadFavorites();
  loadSites();
  loadManualEntries();
  loadPersonalEntries();
  loadOverrides();
  loadDeletedIds();
  loadPurged();
  loadActivity();
  loadPresets();
  loadEmpreintes();
  // Sans await : l'annuaire doit s'afficher même si le fichier manque.
  chargerEmpreintesLivrees();
  loadSavedFile();

  try { connectSync(false); } catch (err) { console.error("connectSync (login) error:", err); }

  // Le chargement est terminé : les modifications suivantes sont de vraies actions utilisateur
  setTimeout(() => { isBooting = false; }, 2500);
}

loginBtn.addEventListener("click", () => {
  const user = usernameInput.value.trim();
  if (!user) { usernameInput.focus(); return; }
  login(user);
});

usernameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") loginBtn.click();
});

// Déconnexion. Extraite dans une fonction nommée pour être vérifiable par le
// banc de test : tant qu'elle vivait dans l'écouteur du bouton, aucun test ne
// pouvait la déclencher — et c'est le chemin qui pouvait vider le cloud.
function deconnecter() {
  // ⚠️ ORDRE IMPORTANT : on coupe d'abord tout envoi en cours ou en attente.
  // Les listes sont vidées juste après ; un envoi déclenché ensuite (retour
  // sur l'onglet, reprise du réseau) écrivait un document VIDE dans le cloud
  // et effaçait l'annuaire de toute l'équipe.
  clearTimeout(syncDebounceHandle);
  syncDebounceHandle = null;
  pendingPush = false;
  pendingRemotePayload = null;
  currentUser = null;

  localStorage.removeItem("kpiUser");
  data = [];
  excelData = [];
  manualEntries = [];
  personalEntries = [];
  personalTrash = [];
  overrides = {};
  deletedIds = [];
  purgedIds = [];
  activityLog = [];
  favorites = [];
  // Coupe proprement la synchro cloud pour le prochain utilisateur
  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  couperEcouteEmpreintes();
  connectedSyncCode = null;
  initialSyncDone = false;
  syncBusy = false;
  currentView = "all";
  updateRestoreDeletedBtn();   // sinon le bouton gardait le compteur du précédent utilisateur
  container.innerHTML = "";
  container.appendChild(emptyState);
  emptyState.style.display = "";
  appShell.style.display = "none";
  loginScreen.style.display = "flex";
  usernameInput.value = "";
}

logoutBtn.addEventListener("click", deconnecter);

/* ============================================
   VUES (all / fav)
============================================ */
function switchView(view, btn) {
  currentView = view;
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  filterData();
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("collapsed");
    sidebarOverlay.classList.remove("show");
  }
}

/* ============================================
   SIDEBAR TOGGLE
============================================ */
function toggleSidebar() {
  const sb = document.getElementById("sidebar");
  sb.classList.toggle("collapsed");
  if (window.innerWidth <= 768) {
    sidebarOverlay.classList.toggle("show", !sb.classList.contains("collapsed"));
  }
}

sidebarOverlay?.addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("collapsed");
  sidebarOverlay.classList.remove("show");
});

/* ============================================
   FAVORIS
============================================ */
function loadFavorites() {
  favorites = Store.readJSON("kpiFav_" + currentUser, []) || [];
}

/**
 * Recopie IMMÉDIATEMENT la liste de favoris de l'utilisateur courant dans le
 * bloc partagé (`kpiSyncFavorites` + `kpiFavMeta`).
 *
 * Pourquoi tout de suite : ces deux emplacements ne s'écrivaient qu'au moment
 * de l'envoi au cloud, 1,5 s plus tard. Une synchro reçue dans cet intervalle
 * relisait la version d'AVANT le clic et annulait le favori qu'on venait
 * d'ajouter (ou ressuscitait celui qu'on venait de retirer).
 */
function saveFavorisPartages() {
  if (!currentUser) return;
  const map  = Store.readJSON(Store.KEYS.SYNC_FAV, {}) || {};
  const meta = Store.readJSON(Store.KEYS.FAV_META, {}) || {};
  map[currentUser]  = favorites;
  meta[currentUser] = getMeta().favAt || now();
  Store.writeJSON(Store.KEYS.SYNC_FAV, map);
  Store.writeJSON(Store.KEYS.FAV_META, meta);
}

function saveFavorites() {
  Store.writeJSON("kpiFav_" + currentUser, favorites);
  saveFavorisPartages();
  scheduleAutoSync();
}

// Enregistre les favoris en local SANS déclencher de synchronisation.
// Utilisée quand la synchro est gérée séparément (réception cloud, suppression
// de fiche) pour éviter une double synchro ou une boucle.
function saveFavoritesLocalOnly() {
  Store.writeJSON("kpiFav_" + currentUser, favorites);
  saveFavorisPartages();
}

/**
 * Retire un identifiant des favoris en HORODATANT le changement.
 *
 * Indispensable : sans `touchMeta("favAt")`, la liste raccourcie partait avec
 * l'ancien horodatage. L'appareil d'en face, qui avait le même horodatage mais
 * la liste complète, la renvoyait — et le favori d'une fiche supprimée
 * réapparaissait indéfiniment.
 * @param {string[]} ids identifiants à retirer
 */
function retirerDesFavoris(ids) {
  const morts = new Set(ids || []);
  if (!morts.size) return 0;
  const avant = favorites.length;
  favorites = favorites.filter(f => !morts.has(f));
  const retires = avant - favorites.length;
  if (retires) touchMeta("favAt");
  return retires;
}

/** Reporte un favori d'un ancien identifiant vers le nouveau (fiche réécrite). */
function reporterFavori(ancienId, nouvelId) {
  if (!ancienId || !nouvelId || ancienId === nouvelId) return false;
  if (!favorites.includes(ancienId)) return false;
  favorites = favorites.filter(f => f !== ancienId);
  if (!favorites.includes(nouvelId)) favorites.push(nouvelId);
  touchMeta("favAt");
  return true;
}

function toggleFavorite(id) {
  if (favorites.includes(id)) {
    favorites = favorites.filter(f => f !== id);
    showToast("Retiré des favoris");
  } else {
    favorites.push(id);
    showToast("⭐ Ajouté aux favoris");
  }
  touchMeta("favAt");
  saveFavorites();
  updateCounts();
  animateNextRender = false;
  filterData();
}

function isFavorite(id) { return favorites.includes(id); }

/* ============================================
   EXCEL IMPORT + SAUVEGARDE
============================================ */
fileInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    const buf = evt.target.result;
    // Le classeur n'est PLUS recopié dans le stockage du navigateur.
    // Il y était écrit en entier (en base64, soit +33 %, puis stocké sur
    // 16 bits par caractère : un fichier de 180 Ko en occupait 480) alors
    // qu'aucune ligne de l'application ne le relisait. C'était la deuxième
    // cause d'encombrement de la mémoire locale.
    libererEspaceInutile();
    touchMeta("excelAt");            // ce bloc Excel devient le plus récent
    loadWorkbook(buf);
    showToast("✅ Fichier importé");
  };
  reader.readAsArrayBuffer(file);
});

function loadSavedFile() {
  migrateExcelToManual();
  nettoyerPurgees();
  nettoyerMarqueursPurges();
  reparerCollisionsEspaces();
  nettoyerFavoris();
  libererEspaceInutile();
  alegerInstantanes();   // allège l'historique laissé par les versions précédentes
  rebuildData(false);
}

/**
 * Libère la mémoire des fiches supprimées définitivement.
 * Une purge ancienne (ou faite avant la correction) pouvait laisser la fiche
 * stockée : elle restait invisible mais repartait vers le cloud à chaque envoi.
 * @returns {number} nombre de fiches retirées
 */
/**
 * Retire les favoris qui désignent des fiches supprimées DÉFINITIVEMENT.
 * On se limite aux suppressions définitives : un favori dont la fiche n'est
 * pas encore arrivée sur cet appareil doit être conservé.
 * @returns {number} nombre de favoris retirés
 */
function nettoyerFavoris() {
  if (!favorites.length) return 0;
  const avant = favorites.length;

  // 1. Toujours : les fiches supprimées définitivement ne reviendront jamais.
  favorites = favorites.filter(id => !purgedIds.includes(id));

  // 2. Après un premier échange complet avec le cloud seulement : un favori
  //    qui ne désigne AUCUNE fiche connue (ni partagée, ni personnelle, ni en
  //    corbeille) est une référence morte — typiquement un identifiant hérité
  //    d'une ancienne version dont la fiche a été réécrite sous un autre nom.
  //    Avant la première synchro on ne nettoie pas : la fiche pourrait
  //    simplement ne pas être encore arrivée sur cet appareil.
  if (initialSyncDone) {
    const connus = new Set([
      ...manualEntries.map(k => k && k.id),
      ...personalEntries.map(k => k && k.id),
      ...deletedIds.map(d => d && d.id),
      ...personalTrash.map(v => v && v.id)
    ]);
    favorites = favorites.filter(id => connus.has(id));
  }

  const retires = avant - favorites.length;
  if (retires) {
    touchMeta("favAt");          // sinon un autre appareil ressusciterait le favori
    saveFavorisPartages();
    saveFavoritesLocalOnly();
  }
  return retires;
}

function nettoyerPurgees() {
  if (!purgedIds.length || !manualEntries.length) return 0;
  const avant = manualEntries.length;
  manualEntries = manualEntries.filter(k => !purgedIds.includes(k.id));
  const retirees = avant - manualEntries.length;
  if (retirees) {
    saveManualEntries(false);
    console.info(`[Nettoyage] ${retirees} fiche(s) supprimée(s) définitivement libérée(s) de la mémoire.`);
  }
  return retirees;
}

/**
 * Retire de la corbeille les marqueurs dont la fiche a été supprimée
 * DÉFINITIVEMENT ailleurs. Sans ce nettoyage la corbeille affichait une ligne
 * « ⚠️ données absentes » que rien ne faisait disparaître : la supprimer
 * définitivement retirait bien le marqueur ici, mais le premier appareil
 * n'ayant pas encore rejoué l'opération le renvoyait aussitôt.
 * @returns {number} nombre de marqueurs retirés
 */
function nettoyerMarqueursPurges() {
  if (!deletedIds.length || !purgedIds.length) return 0;
  const avant = deletedIds.length;
  deletedIds = sansMarqueursPurges(deletedIds, purgedIds);
  const retires = avant - deletedIds.length;
  if (retires) saveDeletedIds(false);
  return retires;
}

// Migration unique : convertit les anciennes données Excel + surcharges en
// vraies fiches manuelles, puis efface les traces de l'ancien système.
// L'Excel n'est plus une source de données vivante, juste un import/export.
// Emplacements de l'ancien système, devenus inutiles. Ils ne sont plus jamais
// relus par l'application mais pouvaient rester stockés indéfiniment.
const CLES_OBSOLETES = ["kpiFileB64", "kpiFile", "kpiDataCache", "kpiOverrides"];

/**
 * Libère les emplacements de stockage que plus rien ne lit.
 * `kpiFileB64` (le classeur Excel recopié en entier) pouvait à lui seul
 * occuper plusieurs centaines de kilo-octets : il n'était effacé que par la
 * migration, laquelle sort immédiatement une fois qu'elle a eu lieu — donc un
 * import Excel postérieur restait stocké pour toujours.
 * @returns {number} octets libérés (approximation UTF-16)
 */
function libererEspaceInutile() {
  let liberes = 0;
  CLES_OBSOLETES.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v === null) return;
      liberes += (k.length + v.length) * 2;
      localStorage.removeItem(k);
    } catch { /* emplacement inaccessible : sans conséquence */ }
  });
  if (liberes > 0) console.info(`[Nettoyage] ${(liberes / 1024).toFixed(0)} Ko d'anciennes données libérés.`);
  return liberes;
}

function migrateExcelToManual() {
  // Migration déjà faite ? On ne la rejoue jamais (sinon risque de doublons/écrasement).
  if (localStorage.getItem("kpiMigratedV2") === "1") {
    excelData = [];
    overrides = {};
    libererEspaceInutile();   // ← s'exécute désormais dans TOUS les cas
    return;
  }

  let migrated = 0;
  const renommages = [];      // [ancienId, nouvelId] pour reporter les références
  const cached = localStorage.getItem("kpiDataCache");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      const oldExcel = parsed.filter(d => !d.manual);
      const overr = (() => { try { return JSON.parse(localStorage.getItem("kpiOverrides")) || {}; } catch { return {}; } })();
      oldExcel.forEach(d => {
        const merged = overr[d.id] ? { ...d, ...overr[d.id] } : d;
        const newId = "kpi_" + slugifyId(merged.title) + "_" + slugifyId(merged.freq);
        if (d.id !== newId) renommages.push([d.id, newId]);
        if (manualEntries.some(m => m.id === newId)) return;
        // La migration réécrit les identifiants : une fiche déjà supprimée
        // définitivement doit le rester, sous son ancien comme sous son
        // nouvel identifiant. Sans ce test, un vieux poste réinjectait dans
        // l'annuaire partagé des fiches que l'équipe avait effacées.
        if (isPurged(newId) || isPurged(d.id)) return;
        manualEntries.push({
          ...merged,
          id: newId,
          manual: true,
          // IMPORTANT : on conserve la date d'origine (jamais now()).
          // Une date récente ferait croire au cloud que ces données sont
          // les plus fraîches → le téléphone écraserait tout le monde.
          _mtime: merged._mtime || 1,
          _by: merged._by || "import"
        });
        migrated++;
      });
    } catch (err) {
      console.warn("[Migration] Cache Excel illisible.", err);
    }
  }

  // Report des références vers les nouveaux identifiants.
  // Auparavant, favoris, marqueurs de corbeille et suppressions définitives
  // continuaient de désigner l'ancien identifiant : les favoris devenaient des
  // références mortes (signalées par le banc de test) et une fiche supprimée
  // réapparaissait sous son nouveau nom.
  if (renommages.length) {
    const table = new Map(renommages);
    let refs = 0;
    favorites = favorites.map(id => { if (table.has(id)) { refs++; return table.get(id); } return id; });
    deletedIds = deletedIds.map(d => (d && table.has(d.id)) ? (refs++, { ...d, id: table.get(d.id) }) : d);
    purgedIds  = purgedIds.map(id => { if (table.has(id)) { refs++; return table.get(id); } return id; });
    if (refs) {
      saveFavoritesLocalOnly(); saveDeletedIds(false); savePurged(false);
      console.info(`[Migration] ${refs} référence(s) reportée(s) vers les nouveaux identifiants.`);
    }
  }

  if (migrated) saveManualEntries(false);

  // Efface les vestiges de l'ancien système et marque la migration comme faite
  libererEspaceInutile();
  localStorage.setItem("kpiMigratedV2", "1");
  excelData = [];
  overrides = {};
  if (migrated) console.info(`[Migration] ${migrated} fiche(s) converties (dates d'origine préservées).`);
}

function loadWorkbook(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    transformData(sheet, raw);
  } catch (e) {
    showToast("❌ Erreur de lecture du fichier", 3000);
  }
}

/* ============================================
   EXTRACTION LIENS
============================================ */
function extractLinksByColumn(sheet, headers, rowIndex) {
  const links = {};
  const inc = (h, v) => v && h.includes(v.toLowerCase());
  headers.forEach((header, colIndex) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
    if (cell && cell.l && cell.l.Target) {
      const url = cell.l.Target.replace(/&amp;/g, "&");
      const h = (header || "").toLowerCase();
      // 1) Correspondance avec un site configuré (nom, clé ou badge)
      let matched = sites.find(s => inc(h, s.name) || inc(h, s.key) || inc(h, s.badge));
      // 2) Repli sur les mots-clés historiques des sites par défaut
      if (!matched) {
        if (h.includes("log"))                               matched = sites.find(s => s.key === "logistiport");
        else if (h.includes("armement") || h.includes("mg")) matched = sites.find(s => s.key === "armement");
        else if (h.includes("armateur"))                     matched = sites.find(s => s.key === "armateur");
        else if (h.includes("global"))                       matched = sites.find(s => s.key === "global");
      }
      if (matched) links[matched.key] = url;
    }
  });
  return links;
}

/* ============================================
   TRANSFORMATION
============================================ */
function transformData(sheet, rawData) {
  const headers = rawData[0];
  const importAt = now();
  const idSeen = {};
  const imported = rawData.slice(1)
    .filter(row => row.some(cell => cell !== undefined && cell !== ""))
    .map((row, idx) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = row[i]));
      const title = obj["Intitulé"] || "";
      const freq  = obj["Fréquence"] || "";
      // ID STABLE : dérivé de l'intitulé + la fréquence, pas de la position de ligne.
      let base = "kpi_" + slugifyId(title) + "_" + slugifyId(freq);
      idSeen[base] = (idSeen[base] || 0) + 1;
      const id = idSeen[base] > 1 ? base + "_" + idSeen[base] : base;
      const links = extractLinksByColumn(sheet, headers, idx + 1);
      return {
        id,
        manual: true,            // fiche à part entière (plus de « bloc Excel »)
        title,
        type:    obj["Type KPI"] || "",
        process: obj["Processus"] || "",
        freq,
        ritual:  obj["Rituel"] || "",
        desc:    obj["Description / Mode de calcul"] || "",
        ...links,
        _mtime: importAt,
        _by: currentUser || "?"
      };
    });

  // L'Excel n'est qu'un point d'entrée : on fusionne les fiches importées
  // dans les fiches existantes (mise à jour si l'ID existe, ajout sinon).
  // L'utilisateur choisit d'écraser ou de compléter.
  const replace = imported.length && confirm(
    `Importer ${imported.length} ligne(s) depuis l'Excel.\n\n` +
    "• OK = REMPLACER : les fiches importées écrasent les versions existantes de même intitulé/temporalité\n" +
    "• Annuler = COMPLÉTER : on ajoute seulement ce qui n'existe pas encore"
  );

  let creees = 0, majs = 0, inchangees = 0;
  const masquees = [];   // importées mais masquées par la corbeille / une purge
  imported.forEach(imp => {
    const existing = manualEntries.find(k => k.id === imp.id);
    if (!existing)        { manualEntries.push(imp); creees++; }
    else if (replace)     { Object.assign(existing, imp, { _mtime: now() }); majs++; }
    else                  { inchangees++; }
    if (isDeleted(imp.id) || isPurged(imp.id)) masquees.push(imp);
  });

  saveManualEntries(true);
  rebuildData(true);

  const bilan = [];
  if (creees)      bilan.push(`${creees} créée(s)`);
  if (majs)        bilan.push(`${majs} mise(s) à jour`);
  if (inchangees)  bilan.push(`${inchangees} déjà présente(s)`);
  showToast(`✅ Import : ${bilan.join(", ") || "aucun changement"}`, 3500);

  // Transparence : une fiche supprimée reste masquée même si elle est ré-importée.
  // Sans ce message, l'utilisateur croirait que l'import n'a pas fonctionné.
  if (masquees.length) {
    const aRestaurer = masquees.filter(m => isDeleted(m.id) && !isPurged(m.id));
    const noms = [...new Set(masquees.map(m => m.title))].slice(0, 6).join("\n• ");
    const msg =
      `${masquees.length} ligne(s) importée(s) sont actuellement dans la corbeille et restent donc masquées :\n\n• ${noms}\n\n` +
      (aRestaurer.length
        ? `Voulez-vous les réafficher maintenant ?\n(OK = réafficher · Annuler = les laisser dans la corbeille)`
        : `Elles ont été supprimées définitivement et ne peuvent pas être réaffichées.`);
    if (aRestaurer.length && confirm(msg)) {
      const ids = aRestaurer.map(m => m.id);
      deletedIds = deletedIds.map(d => ids.includes(d.id)
        ? { ...d, state: "restored", at: now(), by: currentUser || "?" } : d);
      saveDeletedIds(false);
      rebuildData(true);
      showToast(`↩ ${ids.length} fiche(s) réaffichée(s)`, 3000);
    } else if (!aRestaurer.length) {
      alert(msg);
    }
  }
}

// Transforme un texte en identifiant stable (minuscules, sans accents ni espaces)
function slugifyId(txt) {
  return (txt || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "vide";
}

/* ============================================
   FUSION EXCEL + FICHES MANUELLES
============================================ */
function rebuildData(sync) {
  // Toutes les fiches partagées sont désormais dans manualEntries.
  // On masque simplement celles supprimées (corbeille) ou purgées.
  data = manualEntries.filter(d => !isDeleted(d.id) && !isPurged(d.id));
  initFilters();
  updateCounts();
  // Une mise à jour (sync=true) ou une synchro distante ne doit pas rejouer l'animation d'entrée
  if (sync || applyingRemoteSync) animateNextRender = false;
  filterData();
  updateRestoreDeletedBtn();
  if (sync) scheduleAutoSync();
}

/* ============================================
   FICHES MANUELLES (créées dans l'application)
============================================ */
function loadManualEntries() {
  try {
    manualEntries = JSON.parse(localStorage.getItem("kpiManualEntries")) || [];
  } catch { manualEntries = []; }
}

function saveManualEntries(sync = true) {
  ecrireDonnees("kpiManualEntries", manualEntries);
  if (sync) scheduleAutoSync();
}

/* ============================================
   ESPACE PERSONNEL
   Signets propres à l'utilisateur connecté :
   stockés en local par identifiant, jamais envoyés
   dans la synchronisation cloud partagée.
============================================ */
/* ─────────────────────────────────────────────────────────────────────
   ESPACE PERSONNEL
   Les fiches personnelles suivent l'UTILISATEUR d'un appareil à l'autre :
   elles voyagent dans le document partagé, mais rangées sous le nom de
   leur propriétaire. L'application n'affiche jamais que le bloc de
   l'utilisateur connecté ; les blocs des autres sont transportés tels
   quels, sans jamais être lus ni modifiés.
   ───────────────────────────────────────────────────────────────────── */

const LS_PERSO_SYNC   = "kpiPersonalSync";        // "0" = ne pas synchroniser cet espace
const LS_PERSO_MAP    = "kpiPersonalByUser";      // { utilisateur: [fiches] }
const LS_PERSO_TRASH  = "kpiPersonalTrashByUser"; // { utilisateur: [corbeille] }

/** L'utilisateur a-t-il laissé la synchronisation de son espace personnel active ? */
function isPersonalSyncOn() {
  return localStorage.getItem(LS_PERSO_SYNC) !== "0";
}

function lireMapPerso(cle) {
  try { const m = JSON.parse(localStorage.getItem(cle)); return (m && typeof m === "object") ? m : {}; }
  catch { return {}; }
}

function loadPersonalEntries() {
  try {
    personalEntries = JSON.parse(localStorage.getItem("kpiPersonal_" + currentUser)) || [];
  } catch { personalEntries = []; }
  loadPersonalTrash();

  // Nouvel appareil, même utilisateur : on adopte le bloc déjà reçu du cloud
  // plutôt que d'attendre la prochaine fusion. Ne remplit que si c'est vide.
  if (isPersonalSyncOn() && !personalEntries.length) {
    const distant = lireMapPerso(LS_PERSO_MAP)[currentUser];
    if (Array.isArray(distant) && distant.length) {
      personalEntries = distant;
      const corbeille = lireMapPerso(LS_PERSO_TRASH)[currentUser];
      if (Array.isArray(corbeille)) personalTrash = corbeille;
      ecrireDonnees("kpiPersonal_" + currentUser, personalEntries);
      ecrireDonnees("kpiPersonalTrash_" + currentUser, personalTrash);
    }
  }
}

function savePersonalEntries() {
  ecrireDonnees("kpiPersonal_" + currentUser, personalEntries);
  if (isPersonalSyncOn()) scheduleAutoSync();
}

// Corbeille personnelle : propre à chaque utilisateur.
let personalTrash = [];
function loadPersonalTrash() {
  try {
    personalTrash = JSON.parse(localStorage.getItem("kpiPersonalTrash_" + currentUser)) || [];
  } catch { personalTrash = []; }
}
function savePersonalTrash() {
  ecrireDonnees("kpiPersonalTrash_" + currentUser, personalTrash);
  if (isPersonalSyncOn()) scheduleAutoSync();
}

/**
 * Fusionne deux corbeilles personnelles : union par identifiant, en gardant
 * la date de suppression la plus récente.
 */
function mergePersonalTrash(locale, distante) {
  const map = new Map();
  [...(locale || []), ...(distante || [])].forEach(v => {
    if (!v || !v.id) return;
    const enPlace = map.get(v.id);
    if (!enPlace || (v._deletedAt || 0) > (enPlace._deletedAt || 0)) map.set(v.id, v);
  });
  return [...map.values()];
}

/**
 * Applique la corbeille aux fiches personnelles : une fiche supprimée
 * disparaît, sauf si elle a été ré-éditée APRÈS sa suppression (restauration
 * ou modification depuis un autre appareil).
 */
function appliquerCorbeillePerso() {
  const supprimee = new Map(personalTrash.filter(v => v && v.id).map(v => [v.id, v._deletedAt || 0]));
  personalEntries = personalEntries.filter(k => {
    const at = supprimee.get(k.id);
    return at === undefined || (k._mtime || 0) > at;
  });
  const vivantes = new Set(personalEntries.map(k => k.id));
  personalTrash = personalTrash.filter(v => v && !vivantes.has(v.id));
}



/* ============================================
   SURCHARGES : modifications des fiches Excel
   (conservées même après un ré-import du fichier)
============================================ */
// Système de surcharges Excel retiré. Ces fonctions sont conservées en
// « no-op » pour ne pas casser les appels existants ; overrides reste {}.
function loadOverrides() { overrides = {}; }
function saveOverrides() { /* plus rien à enregistrer */ }

function restoreOriginalKpi(id) {
  // Obsolète : il n'y a plus de « version d'origine » Excel distincte.
  showToast("Fonction retirée : les fiches sont désormais éditables directement", 3000);
}

/* ============================================
   SUPPRESSION DES FICHES EXCEL (masquage persistant)
============================================ */
function loadDeletedIds() {
  try {
    deletedIds = normalizeDeleted(JSON.parse(localStorage.getItem("kpiDeletedIds")));
  } catch { deletedIds = []; }
}

function saveDeletedIds(sync = true) {
  ecrireDonnees("kpiDeletedIds", deletedIds);
  if (sync) scheduleAutoSync();
}



// Point d'entrée unique de la corbeille sur les cartes.
// Supprime TOUTE la fiche : toutes les temporalités portant le même intitulé,
// dans le même espace (partagé ou personnel), pas seulement la variante affichée.
function deleteKPI(id) {
  const ref = data.find(k => k.id === id) || personalEntries.find(k => k.id === id);
  if (!ref) return;
  const key = titleKey(ref.title);
  const isPersonal = personalEntries.some(k => k.id === id);
  const source = isPersonal ? personalEntries : data;

  // Toutes les variantes (temporalités) de cette fiche dans le même espace
  const group = source.filter(k => titleKey(k.title) === key);
  const freqs = group.map(k => k.freq).filter(Boolean);

  const nbTemp = group.length;
  const detail = nbTemp > 1
    ? `\n\nCette fiche contient ${nbTemp} temporalités (${freqs.join(", ")}). Toutes seront supprimées.`
    : "";
  const suffix = isPersonal ? "" : "\n\nElle restera masquée même après un ré-import Excel. Vous pourrez la réafficher depuis « Corbeille ».";
  if (!confirm(`Supprimer la fiche « ${ref.title} » ?${detail}${suffix}`)) return;

  let touchedShared = false, touchedPerso = false;
  const deletedAt = now();
  group.forEach(v => {
    const kind = classifyId(v.id);
    if (kind === "perso") {
      // On déplace la fiche dans la corbeille personnelle (au lieu de l'effacer)
      personalEntries = personalEntries.filter(k => k.id !== v.id);
      personalTrash.push({ ...v, _deletedAt: deletedAt });
      touchedPerso = true;
    } else { // fiche partagée
      markDeleted(v.id, v);
      touchedShared = true;
    }
    retirerDesFavoris([v.id]);
  });

  saveFavoritesLocalOnly();
  if (touchedPerso) { savePersonalEntries(); savePersonalTrash(); }
  if (touchedShared) { saveOverrides(false); saveDeletedIds(false); saveManualEntries(false); }
  logActivity("delete", ref.title, nbTemp > 1 ? `fiche entière (${nbTemp} temporalités : ${freqs.join(", ")})` : "");
  rebuildData(true);
  showToast(nbTemp > 1 ? `🗑 Fiche supprimée (${nbTemp} temporalités)` : "🗑 Fiche supprimée");
}

/**
 * Marqueurs de corbeille réellement actifs : ni « restaurés », ni supprimés
 * définitivement (ceux-là ne sont plus récupérables et ne doivent donc plus
 * être ni comptés, ni affichés).
 */
function marqueursCorbeilleActifs() {
  return deletedIds.filter(d => d && d.state !== "restored" && !isPurged(d.id));
}

/**
 * Intitulé sous lequel un marqueur est regroupé.
 * Le bouton et la liste DOIVENT utiliser la même règle : ils comptaient
 * autrement des choses différentes (« Corbeille (1) » au-dessus d'une liste
 * de trois lignes) dès qu'un marqueur n'avait pas d'intitulé enregistré.
 */
function titreMarqueurCorbeille(d) {
  const orig = manualEntries.find(k => k && k.id === d.id);
  return d.title || (orig ? orig.title : d.id);
}

function updateRestoreDeletedBtn() {
  const btn = document.getElementById("restoreDeletedBtn");
  const label = document.getElementById("restoreDeletedLabel");
  if (!btn) return;
  const active = marqueursCorbeilleActifs();
  const sharedFiches = new Set(active.map(d => titleKey(titreMarqueurCorbeille(d)))).size;
  const persoFiches  = new Set(personalTrash.map(v => titleKey(v.title))).size;
  const nbFiches = sharedFiches + persoFiches;
  btn.style.display = nbFiches ? "" : "none";
  if (label) label.textContent = `Corbeille (${nbFiches})`;
  // Si la corbeille est ouverte, sa liste doit suivre : une synchronisation
  // reçue pendant la consultation la laissait périmée, et l'utilisateur
  // pouvait supprimer définitivement une fiche qu'un collègue venait de
  // restaurer — et qui était donc redevenue visible pour tout le monde.
  const modale = document.getElementById("trashModal");
  if (modale && !modale.classList.contains("hidden")) renderTrashList();
}

/* ============================================
   CORBEILLE : liste des fiches supprimées
============================================ */
function fmtDate(ts) {
  if (!ts) return "date inconnue";
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR") + " à " + d.toLocaleTimeString("fr-FR").slice(0, 5);
}

function renderTrashList() {
  const el = document.getElementById("trashList");
  if (!el) return;
  const active = marqueursCorbeilleActifs();
  if (!active.length && !personalTrash.length) {
    el.innerHTML = `<p class="modal-hint" style="margin:0">La corbeille est vide.</p>`;
    return;
  }
  // Regroupe les temporalités supprimées par intitulé : une seule ligne par fiche
  const groups = new Map();

  // Fiches partagées (annuaire)
  active.forEach(d => {
    const orig = manualEntries.find(k => k.id === d.id);
    const title = titreMarqueurCorbeille(d);
    const key = "shared:" + titleKey(title);
    if (!groups.has(key)) groups.set(key, { title, ids: [], freqs: [], at: 0, by: "", perso: false });
    const g = groups.get(key);
    g.ids.push(d.id);
    if (d.freq || (orig && orig.freq)) g.freqs.push(d.freq || orig.freq);
    if ((d.at || 0) >= g.at) { g.at = d.at || 0; g.by = d.by || ""; }
  });

  // Fiches personnelles (visibles seulement par l'utilisateur courant)
  personalTrash.forEach(v => {
    const key = "perso:" + titleKey(v.title);
    if (!groups.has(key)) groups.set(key, { title: v.title, ids: [], freqs: [], at: 0, by: "", perso: true });
    const g = groups.get(key);
    g.ids.push(v.id);
    if (v.freq) g.freqs.push(v.freq);
    if ((v._deletedAt || 0) >= g.at) g.at = v._deletedAt || 0;
  });

  const rows = [...groups.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
  el.innerHTML = "";
  rows.forEach(g => {
    const nb = g.ids.length;
    const tempTxt = nb > 1
      ? `${nb} temporalités (${g.freqs.join(", ")}) · `
      : (g.freqs[0] ? esc(g.freqs[0]) + " · " : "");
    const auteur = g.perso ? "" : (g.by ? " par " + esc(g.by) : "");
    // Un marqueur peut subsister sans ses données (fiche déjà effacée ailleurs) :
    // le réafficher ne ramènerait rien, autant le dire clairement.
    const recuperable = g.perso
      ? true
      : g.ids.some(id => manualEntries.some(k => k.id === id));
    const row = document.createElement("label");
    row.className = "trash-row" + (recuperable ? "" : " trash-vide");
    row.innerHTML = `
      <input type="checkbox" class="trash-check" data-ids="${esc(g.ids.join(","))}" data-perso="${g.perso ? "1" : "0"}">
      <div class="trash-info">
        <b>${g.perso ? "🔒 " : ""}${esc(g.title)}</b>
        <span>${tempTxt}supprimée le ${fmtDate(g.at)}${auteur}</span>
        ${recuperable ? "" : `<span class="trash-alerte">⚠️ données absentes — non récupérable, à supprimer définitivement</span>`}
      </div>`;
    el.appendChild(row);
  });
}

function openTrashModal() {
  renderTrashList();
  document.getElementById("trashModal").classList.remove("hidden");
}
function closeTrashModal() { document.getElementById("trashModal").classList.add("hidden"); }

function restoreSelectedTrash() {
  const sel = getTrashSelection();
  if (!sel.length) { showToast("Sélectionnez au moins une fiche", 2400); return; }

  // Sépare les identifiants partagés des identifiants personnels
  const personalIds = personalTrash.filter(v => sel.includes(v.id)).map(v => v.id);
  const sharedIds   = sel.filter(id => !personalIds.includes(id));

  const titres = new Set();

  // Fiches partagées : marqueur « restauré » daté (converge en synchro)
  const restoredShared = deletedIds.filter(d => sharedIds.includes(d.id));
  restoredShared.forEach(d => titres.add(d.title));
  if (sharedIds.length) {
    deletedIds = deletedIds.map(d => sharedIds.includes(d.id)
      ? { ...d, state: "restored", at: now(), by: currentUser || "?" }
      : d);
    saveDeletedIds(false);
  }

  // Fiches personnelles : on les ressort de la corbeille locale
  if (personalIds.length) {
    const back = personalTrash.filter(v => personalIds.includes(v.id));
    back.forEach(v => {
      titres.add(v.title);
      const { _deletedAt, ...clean } = v;
      // Sans ce test, restaurer deux fois la même fiche la dupliquait
      if (personalEntries.some(k => k && k.id === clean.id)) return;
      personalEntries.push(clean);
    });
    personalTrash = personalTrash.filter(v => !personalIds.includes(v.id));
    savePersonalEntries();
    savePersonalTrash();
  }

  // On ne compte que les fiches dont les données existent encore
  const revenues = new Set();
  [...titres].forEach(t => {
    const cle = titleKey(t);
    if (manualEntries.some(k => titleKey(k.title) === cle) ||
        personalEntries.some(k => titleKey(k.title) === cle)) revenues.add(cle);
  });
  const nbFiches = revenues.size;
  const nbVides = new Set([...titres].map(t => titleKey(t))).size - nbFiches;
  [...titres].forEach(t => logActivity("restore", t, "fiche réaffichée"));
  rebuildData(true);
  renderTrashList();
  if (nbFiches) showToast(`✅ ${nbFiches} fiche${nbFiches > 1 ? "s" : ""} réaffichée${nbFiches > 1 ? "s" : ""}`);
  if (nbVides) {
    showToast(`⚠️ ${nbVides} fiche${nbVides > 1 ? "s" : ""} sans données : rien à réafficher`, 4000);
  }
  const stillShared = marqueursCorbeilleActifs().length > 0;
  if (!stillShared && !personalTrash.length) closeTrashModal();
}

function getTrashSelection() {
  // Chaque case cochée regroupe toutes les temporalités d'une fiche
  const ids = [];
  document.querySelectorAll("#trashList .trash-check:checked").forEach(c => {
    (c.dataset.ids || "").split(",").filter(Boolean).forEach(id => ids.push(id));
  });
  // Défense en profondeur : on ne retient que les identifiants qui sont
  // RÉELLEMENT en corbeille à l'instant du clic. Si une synchronisation a
  // restauré une fiche entre l'affichage de la liste et le clic, la ligne
  // affichée est périmée — agir dessus détruirait une fiche redevenue active.
  const enCorbeille = new Set([
    ...marqueursCorbeilleActifs().map(d => d.id),
    ...personalTrash.map(v => v && v.id)
  ]);
  return ids.filter(id => enCorbeille.has(id));
}

// Suppression définitive : la fiche disparaît de la corbeille et ne reviendra plus,
// même après un ré-import du fichier Excel.
function purgeSelectedTrash() {
  const sel = getTrashSelection();
  if (!sel.length) { showToast("Sélectionnez au moins une fiche", 2400); return; }

  const personalIds = personalTrash.filter(v => sel.includes(v.id)).map(v => v.id);
  const sharedIds   = sel.filter(id => !personalIds.includes(id));

  const targetsShared = deletedIds.filter(d => sharedIds.includes(d.id));
  const targetsPerso  = personalTrash.filter(v => personalIds.includes(v.id));
  const allTargets = [...targetsShared, ...targetsPerso];
  // On annonce des FICHES, pas des temporalités : la ligne cochée disait
  // « 1 fiche (3 temporalités) » et la confirmation « 3 éléments », en
  // répétant trois fois le même intitulé.
  const nomsUniques = [...new Set(allTargets.map(d => d.title || d.id))];
  const nb = nomsUniques.length;
  const noms = nomsUniques.slice(0, 5).map(t => "• " + t).join("\n");
  const detailTemp = allTargets.length > nb ? ` (${allTargets.length} temporalités au total)` : "";
  if (!confirm(
    `Supprimer DÉFINITIVEMENT ${nb} fiche${nb > 1 ? "s" : ""}${detailTemp} ?\n\n` +
    noms + (nb > 5 ? `\n… et ${nb - 5} autre(s)` : "") +
    "\n\nElles quitteront la corbeille et ne réapparaîtront plus, même après un ré-import Excel. " +
    "Cette action est irréversible."
  )) return;

  // Partagées : marquées purgées + retirées des données
  if (sharedIds.length) {
    sharedIds.forEach(id => { if (!purgedIds.includes(id)) purgedIds.push(id); });
    deletedIds = deletedIds.filter(d => !sharedIds.includes(d.id));
    // Suppression définitive : la fiche quitte aussi la mémoire, sinon elle
    // resterait stockée et repartirait vers le cloud à chaque envoi.
    manualEntries = manualEntries.filter(k => !sharedIds.includes(k.id));
    retirerDesFavoris(sharedIds);
    savePurged(false);
    saveDeletedIds(false);
    saveManualEntries(false);
  }
  // Personnelles : simplement effacées de la corbeille locale
  if (personalIds.length) {
    personalTrash = personalTrash.filter(v => !personalIds.includes(v.id));
    savePersonalTrash();
  }

  saveFavoritesLocalOnly();
  nomsUniques.forEach(t => logActivity("purge", t, "suppression définitive"));
  rebuildData(true);
  renderTrashList();
  showToast(`🔥 ${nb} fiche${nb > 1 ? "s" : ""} définitivement supprimée${nb > 1 ? "s" : ""}`, 3000);
  if (!marqueursCorbeilleActifs().length && !personalTrash.length) closeTrashModal();
}

document.getElementById("restoreDeletedBtn")?.addEventListener("click", openTrashModal);
document.getElementById("purgeSelectedBtn")?.addEventListener("click", purgeSelectedTrash);document.getElementById("closeTrashModalBtn")?.addEventListener("click", closeTrashModal);
document.getElementById("cancelTrashBtn")?.addEventListener("click", closeTrashModal);
document.getElementById("restoreSelectedBtn")?.addEventListener("click", restoreSelectedTrash);
document.getElementById("trashSelectAll")?.addEventListener("click", () => {
  const boxes = document.querySelectorAll("#trashList .trash-check");
  const allChecked = Array.from(boxes).every(b => b.checked);
  boxes.forEach(b => b.checked = !allChecked);
});
document.getElementById("trashModal")?.addEventListener("click", e => {
  if (e.target === document.getElementById("trashModal")) closeTrashModal();
});

/* ============================================
   HISTORIQUE D'ACTIVITÉ (interface)
============================================ */
const ACTION_META = {
  create:  { icon: "➕", label: "Création",     cls: "act-create" },
  update:  { icon: "✏️", label: "Modification", cls: "act-update" },
  delete:  { icon: "🗑", label: "Suppression",  cls: "act-delete" },
  restore: { icon: "↩",  label: "Restauration", cls: "act-restore" },
  purge:   { icon: "🔥", label: "Suppression définitive", cls: "act-purge" },
  deck:    { icon: "📊", label: "PowerPoint généré", cls: "act-deck" }
};

function renderHistoryList() {
  const el = document.getElementById("historyList");
  if (!el) return;
  const fa = document.getElementById("historyActionFilter").value;
  const fu = document.getElementById("historyUserFilter").value;

  const rows = activityLog.filter(e => (!fa || e.action === fa) && (!fu || e.by === fu));
  if (!rows.length) {
    el.innerHTML = `<p class="modal-hint" style="margin:0">Aucune activité enregistrée${(fa || fu) ? " pour ce filtre" : " pour l'instant"}.</p>`;
    return;
  }
  el.innerHTML = "";
  rows.forEach(e => {
    const m = ACTION_META[e.action] || { icon: "•", label: e.action, cls: "" };
    const row = document.createElement("div");
    row.className = "history-row " + m.cls;
    row.innerHTML = `
      <span class="hist-icon">${m.icon}</span>
      <div class="hist-info">
        <b>${esc(e.title || "(sans titre)")}</b>
        <span>${m.label}${e.detail ? " · " + esc(e.detail) : ""}${e.space === "perso" ? " · espace personnel" : ""}</span>
      </div>
      <div class="hist-meta">
        <b>${esc(e.by || "?")}</b>
        <span>${fmtDate(e.at)}</span>
      </div>`;
    el.appendChild(row);
  });
}

function refreshHistoryUserFilter() {
  const sel = document.getElementById("historyUserFilter");
  if (!sel) return;
  const prev = sel.value;
  const users = [...new Set(activityLog.map(e => e.by).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Tous les utilisateurs</option>`;
  users.forEach(u => {
    const o = document.createElement("option");
    o.value = o.textContent = u;
    sel.appendChild(o);
  });
  if (users.includes(prev)) sel.value = prev;
}

function openHistoryModal() {
  refreshHistoryUserFilter();
  renderHistoryList();
  document.getElementById("historyModal").classList.remove("hidden");
}
function closeHistoryModal() { document.getElementById("historyModal").classList.add("hidden"); }

function exportHistoryCsv() {
  if (!activityLog.length) { showToast("Historique vide", 2200); return; }
  const esc2 = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["Date;Utilisateur;Action;Fiche;Détail;Espace"];
  activityLog.forEach(e => {
    const m = ACTION_META[e.action] || { label: e.action };
    lines.push([fmtDate(e.at), e.by, m.label, e.title, e.detail, e.space === "perso" ? "personnel" : "partagé"]
      .map(esc2).join(";"));
  });
  // BOM pour qu'Excel ouvre correctement les accents
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `annuaire-kpi-historique-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("💾 Historique exporté", 2500);
}

document.getElementById("historyBtn")?.addEventListener("click", openHistoryModal);
document.getElementById("closeHistoryModalBtn")?.addEventListener("click", closeHistoryModal);
document.getElementById("closeHistoryBtn2")?.addEventListener("click", closeHistoryModal);
document.getElementById("historyActionFilter")?.addEventListener("change", renderHistoryList);
document.getElementById("historyUserFilter")?.addEventListener("change", renderHistoryList);
document.getElementById("exportHistoryBtn")?.addEventListener("click", exportHistoryCsv);
document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
  if (!confirm("Vider tout l'historique d'activité ?\n\nCette action est définitive et s'appliquera aux appareils synchronisés.")) return;
  activityLog = [];
  saveActivity(true);
  renderHistoryList();
  refreshHistoryUserFilter();
  showToast("🧹 Historique vidé");
});
document.getElementById("historyModal")?.addEventListener("click", e => {
  if (e.target === document.getElementById("historyModal")) closeHistoryModal();
});

function fillDatalists() {
  const fill = (id, values) => {
    const dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = "";
    [...new Set(values.filter(Boolean))].sort().forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      dl.appendChild(o);
    });
  };
  fill("typeList",    [...data, ...personalEntries].map(d => d.type));
  fill("processList", [...data, ...personalEntries].map(d => d.process));
  fill("ritualList",  [...data, ...personalEntries].map(d => d.ritual));
}

function emptySlot() {
  return { id: null, active: false, ritual: "", links: {} };
}

// Construit les champs de liens dans la modale à partir de la liste des sites
function buildLinkFields() {
  const grid = document.getElementById("kpiLinksGrid");
  if (!grid) return;
  grid.innerHTML = activeSites().map(s => `
    <div>
      <label class="modal-label" for="kpiLink_${esc(s.key)}">
        <span class="link-swatch" style="background:${esc(s.color || "#64748B")}"></span>${esc(s.name)}
      </label>
      <input type="url" id="kpiLink_${esc(s.key)}" data-site="${esc(s.key)}" class="modal-input" placeholder="https://…">
    </div>`).join("");
}

function openKpiModal(id = null) {
  editingKpiId = id;
  const ref = id ? (data.find(k => k.id === id) || personalEntries.find(k => k.id === id)) : null;
  const isPersonal = !!(ref && personalEntries.some(k => k.id === id));

  // Rassemble toutes les temporalités du même intitulé, dans le même espace
  const key = ref ? titleKey(ref.title) : null;
  const groupSource = isPersonal ? personalEntries : data; // data = excel(+surcharges) + manuels
  const group = key ? groupSource.filter(k => titleKey(k.title) === key) : [];

  // Espace du groupe : excel (verrouillé partagé), perso, ou manuel (déplaçable)
  const hasExcel = group.some(k => classifyId(k.id) === "excel");
  const groupSpace = isPersonal ? "perso" : "shared";

  document.getElementById("kpiModalTitle").textContent = ref ? "✏️ Modifier le KPI" : "➕ Nouveau KPI";

  // Sélecteur d'espace : masqué si le groupe contient de l'Excel (toujours partagé)
  const spaceRow = document.getElementById("kpiSpaceRow");
  const spaceInput = document.getElementById("kpiSpaceInput");
  spaceRow.style.display = hasExcel ? "none" : "";
  spaceInput.value = ref ? groupSpace : (currentView === "perso" ? "perso" : "shared");

  // Champs partagés (repris de la variante cliquée, sinon de la première)
  const base = ref || group[0] || {};
  document.getElementById("kpiTitleInput").value   = base.title   || "";
  document.getElementById("kpiTypeInput").value    = base.type    || "";
  document.getElementById("kpiProcessInput").value = base.process || "";
  document.getElementById("kpiDescInput").value    = base.desc    || "";

  // Prépare les emplacements par temporalité
  modalSlots = {};
  modalInitialIds = {};
  modalExtraVariants = [];
  STD_FREQS.forEach(f => { modalSlots[f] = emptySlot(); });

  group.forEach(v => {
    const f = STD_FREQS.find(sf => sf.toLowerCase() === (v.freq || "").toLowerCase().trim());
    if (f) {
      const links = {};
      activeSites().forEach(s => { if (v[s.key]) links[s.key] = v[s.key]; });
      modalSlots[f] = { id: v.id, active: true, ritual: v.ritual || "", links };
      modalInitialIds[f] = v.id;
    } else {
      // Fréquence non standard : préservée telle quelle, non éditable ici
      modalExtraVariants.push(v);
    }
  });

  // Temporalité affichée par défaut : celle cliquée si standard, sinon la 1ʳᵉ active, sinon Mensuelle
  const clickedFreq = ref && STD_FREQS.find(sf => sf.toLowerCase() === (ref.freq || "").toLowerCase().trim());
  modalCurrentFreq = clickedFreq || STD_FREQS.find(f => modalSlots[f].active) || "Mensuelle";

  // Nouveau KPI : on active la temporalité de départ pour qu'il y ait quelque chose à enregistrer
  if (!ref) modalSlots[modalCurrentFreq].active = true;

  // Pied de modale
  document.getElementById("deleteKpiBtn").style.display = ref ? "" : "none";
  const rb = document.getElementById("restoreKpiBtn");
  if (rb) rb.style.display = "none";

  buildLinkFields();
  loadSlotIntoInputs(modalCurrentFreq);
  renderFreqTabs();
  fillDatalists();
  document.getElementById("kpiModal").classList.remove("hidden");
  document.getElementById("kpiTitleInput").focus();
}

// Charge les valeurs d'une temporalité dans les champs
function loadSlotIntoInputs(freq) {
  const slot = modalSlots[freq];
  document.getElementById("freqActiveToggle").checked = slot.active;
  document.getElementById("kpiRitualInput").value  = slot.ritual;
  activeSites().forEach(s => {
    const el = document.getElementById("kpiLink_" + s.key);
    if (el) el.value = (slot.links && slot.links[s.key]) || "";
  });
  document.getElementById("ritualScope").textContent = "(" + freq.toLowerCase() + ")";
  const ff = document.getElementById("freqFields");
  ff.style.opacity = slot.active ? "1" : "0.45";
  ff.style.pointerEvents = slot.active ? "" : "none";
}

// Sauvegarde les champs courants dans l'emplacement de la temporalité affichée
function syncInputsIntoSlot(freq) {
  const slot = modalSlots[freq];
  slot.active = document.getElementById("freqActiveToggle").checked;
  slot.ritual = document.getElementById("kpiRitualInput").value.trim();
  slot.links = {};
  activeSites().forEach(s => {
    const el = document.getElementById("kpiLink_" + s.key);
    const url = el ? normalizeUrl(el.value) : "";
    if (url) slot.links[s.key] = url;
  });
}

// Onglets de temporalité : état actif (coche) + onglet courant surligné
function renderFreqTabs() {
  document.querySelectorAll(".freq-tab").forEach(btn => {
    const f = btn.dataset.freq;
    btn.classList.toggle("current", f === modalCurrentFreq);
    btn.classList.toggle("has-data", modalSlots[f].active);
  });
}

function switchFreqTab(freq) {
  syncInputsIntoSlot(modalCurrentFreq);
  modalCurrentFreq = freq;
  loadSlotIntoInputs(freq);
  renderFreqTabs();
}

function closeKpiModal() {
  editingKpiId = null;
  document.getElementById("kpiModal").classList.add("hidden");
}

// Normalise une URL saisie (ajoute https:// si absent)
function normalizeUrl(v) {
  v = v.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  return v;
}

/**
 * Lit les champs communs de la modale (valables pour toutes les temporalités).
 * @returns {{title:string,type:string,process:string,desc:string}|null} null si l'intitulé manque
 */
function readSharedFields() {
  const title = document.getElementById("kpiTitleInput").value.trim();
  if (!title) {
    showToast("⚠️ L'intitulé est obligatoire", 2600);
    document.getElementById("kpiTitleInput").focus();
    return null;
  }
  return {
    title,
    type:    document.getElementById("kpiTypeInput").value.trim(),
    process: document.getElementById("kpiProcessInput").value.trim(),
    desc:    document.getElementById("kpiDescInput").value.trim()
  };
}

/**
 * Retire une temporalité décochée dans la modale.
 * Les fiches partagées reçoivent un marqueur daté (jamais de suppression
 * sèche, sinon la fusion les ferait réapparaître). Les fiches personnelles,
 * qui ne sont pas synchronisées, sont retirées directement.
 * @returns {{shared:boolean, perso:boolean}} espaces impactés
 */
function removeTemporality(initialId, kind) {
  const gone = data.find(k => k.id === initialId) || manualEntries.find(k => k.id === initialId);
  if (kind === "perso") {
    personalEntries = personalEntries.filter(k => k.id !== initialId);
    return { shared: false, perso: true };
  }
  // fiche partagée : marqueur daté (récupérable en corbeille)
  markDeleted(initialId, gone);
  return { shared: true, perso: false };
}

/**
 * Crée ou met à jour une temporalité.
 * Une fiche Excel passe par une surcharge (l'original reste intact pour
 * survivre à un ré-import) ; les autres sont des fiches à part entière.
 * @returns {{shared:boolean, perso:boolean, isNew:boolean}}
 */
function upsertTemporality(freq, slot, initialId, kind, shared, space) {
  const fields = { ...shared, freq, ritual: slot.ritual };
  activeSites().forEach(s => { fields[s.key] = (slot.links && slot.links[s.key]) || ""; });

  const targetPerso = space === "perso";
  const prefixe = targetPerso ? "perso_" : "kpi_";

  // Un identifiant ne doit JAMAIS changer d'espace.
  // Avant : la fiche gardait son id en passant de « partagé » à « personnel ».
  // Elle disparaissait de la liste partagée sans laisser de marqueur, donc un
  // collègue la renvoyait à la synchro suivante — et l'utilisateur se
  // retrouvait avec la même fiche des deux côtés, impossible à supprimer.
  const changeEspace = !!initialId && !!kind && ((kind === "perso") !== targetPerso);
  const id = (initialId && !changeEspace)
    ? initialId
    : prefixe + slugifyId(shared.title) + "_" + slugifyId(freq) + "_" + Date.now().toString(36);

  const entry = {
    id,
    manual: true,
    ...(targetPerso ? { personal: true } : {}),
    ...fields
  };
  stamp(entry);

  let quitteLePartage = false, quitteLePerso = false;
  if (changeEspace) {
    if (kind === "perso") {
      personalEntries = personalEntries.filter(k => k.id !== initialId);
      quitteLePerso = true;
    } else {
      // La fiche quitte l'annuaire partagé : marqueur daté, comme une
      // suppression normale. Elle reste stockée (donc récupérable depuis la
      // corbeille) et l'information circule vers les autres appareils.
      markDeleted(initialId, manualEntries.find(k => k.id === initialId));
      quitteLePartage = true;
    }
    reporterFavori(initialId, id);
  }

  // Retire l'ancienne occurrence des deux espaces (sécurité si un id a déjà
  // été dupliqué par une version antérieure de l'application)
  manualEntries   = manualEntries.filter(k => k.id !== entry.id);
  personalEntries = personalEntries.filter(k => k.id !== entry.id);
  if (targetPerso) personalEntries.push(entry);
  else             manualEntries.push(entry);

  return {
    shared: !targetPerso || quitteLePartage,
    perso:  targetPerso  || quitteLePerso,
    isNew: !initialId,
    id
  };
}

/**
 * Enregistre le formulaire : parcourt les trois temporalités et applique
 * la création, la mise à jour ou le retrait de chacune, puis persiste,
 * journalise et resynchronise.
 */
function saveKpiForm() {
  const shared = readSharedFields();
  if (!shared) return;

  // Fige les valeurs de la temporalité affichée avant de tout parcourir
  syncInputsIntoSlot(modalCurrentFreq);
  const space = document.getElementById("kpiSpaceInput").value; // "shared" | "perso"

  const done = { created: [], updated: [], removed: [] };
  const favorisARetirer = [];   // temporalités retirées qui étaient en favori
  const idsActifs = [];         // identifiants des temporalités conservées
  let touchesShared = false, touchesPerso = false;

  STD_FREQS.forEach(freq => {
    const slot = modalSlots[freq];
    const initialId = modalInitialIds[freq] || null;
    const kind = initialId ? classifyId(initialId) : null;

    if (!slot.active) {
      if (!initialId) return;                       // rien à retirer
      done.removed.push(freq);
      const t = removeTemporality(initialId, kind);
      touchesShared = touchesShared || t.shared;
      touchesPerso  = touchesPerso  || t.perso;
      // Le favori n'est retiré que si la fiche disparaît réellement. Quand
      // l'utilisateur change seulement de temporalité (Mensuelle décochée,
      // Hebdomadaire cochée), il sera reporté plus bas sur le nouvel
      // identifiant au lieu d'être perdu sans explication.
      favorisARetirer.push(initialId);
      return;
    }

    const t = upsertTemporality(freq, slot, initialId, kind, shared, space);
    touchesShared = touchesShared || t.shared;
    touchesPerso  = touchesPerso  || t.perso;
    idsActifs.push(t.id);
    (t.isNew ? done.created : done.updated).push(freq);
  });

  // Favori d'une temporalité retirée : s'il reste au moins une temporalité à
  // cette fiche (cas d'un simple changement Mensuelle → Hebdomadaire), on le
  // reporte au lieu de le perdre en silence. Sinon la fiche entière s'en va et
  // le favori est retiré proprement, avec horodatage.
  favorisARetirer.forEach(ancien => {
    if (!favorites.includes(ancien)) return;
    if (idsActifs.length) reporterFavori(ancien, idsActifs[0]);
    else retirerDesFavoris([ancien]);
  });

  persistKpiChanges(touchesShared, touchesPerso, shared.title, space, done);
  closeKpiModal();
}

/** Persiste les espaces modifiés, journalise et notifie. */
function persistKpiChanges(touchesShared, touchesPerso, title, space, done) {
  // Les DEUX espaces sont toujours réécrits.
  // Un déplacement « partagé ↔ personnel » modifie les deux listes en mémoire ;
  // n'enregistrer que celle d'arrivée laissait l'autre périmée sur le disque.
  // Au rechargement suivant la fiche existait dans les deux espaces, puis
  // repartait dans l'annuaire partagé de toute l'équipe.
  savePersonalEntries();
  saveManualEntries(false);
  saveOverrides(false);
  saveDeletedIds(false);
  saveFavoritesLocalOnly();

  const spaceLabel = space === "perso" ? "perso" : "shared";
  const plural = n => n > 1 ? "s" : "";
  if (done.created.length)
    logActivity("create", title, `${done.created.length} temporalité${plural(done.created.length)} : ${done.created.join(", ")}`, spaceLabel);
  if (done.updated.length)
    logActivity("update", title, `${done.updated.length} temporalité${plural(done.updated.length)} : ${done.updated.join(", ")}`, spaceLabel);
  if (done.removed.length)
    logActivity("delete", title, `temporalité${plural(done.removed.length)} retirée${plural(done.removed.length)} : ${done.removed.join(", ")}`, spaceLabel);

  rebuildData(true);

  const parts = [];
  if (done.created.length) parts.push(`${done.created.length} créée${plural(done.created.length)}`);
  if (done.updated.length) parts.push(`${done.updated.length} modifiée${plural(done.updated.length)}`);
  if (done.removed.length) parts.push(`${done.removed.length} retirée${plural(done.removed.length)}`);
  showToast("✅ Temporalités : " + (parts.join(", ") || "aucun changement"), 2800);
}

function editKPI(id) { openKpiModal(id); }

/* ============================================
   GESTION DES SITES (périmètres configurables)
============================================ */
let sitesDraft = []; // copie de travail éditée dans la modale

function slugifySite(name) {
  const base = (name || "site").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "site";
  let key = base, n = 2;
  while (sitesDraft.some(s => s.key === key)) key = base + "_" + (n++);
  return key;
}

function renderSitesList() {
  const list = document.getElementById("sitesList");
  if (!list) return;
  list.innerHTML = "";
  sitesDraft.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "site-row";
    row.innerHTML = `
      <input type="color" class="site-color" value="${esc(s.color || "#64748B")}" title="Couleur">
      <input type="text" class="modal-input site-name" placeholder="Nom du site" value="${esc(s.name || "")}">
      <input type="text" class="modal-input site-badge" placeholder="Badge" value="${esc(s.badge || "")}" maxlength="8">
      <button type="button" class="btn-tool btn-tool-danger site-del" title="Supprimer ce site">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>`;
    row.querySelector(".site-color").addEventListener("input", e => sitesDraft[i].color = e.target.value);
    row.querySelector(".site-name").addEventListener("input",  e => sitesDraft[i].name  = e.target.value);
    row.querySelector(".site-badge").addEventListener("input", e => sitesDraft[i].badge = e.target.value);
    row.querySelector(".site-del").addEventListener("click", () => {
      if (confirm(`Supprimer le site « ${sitesDraft[i].name || "sans nom"} » ?\nLes liens déjà saisis pour ce site resteront masqués mais ne seront pas perdus.`)) {
        sitesDraft.splice(i, 1);
        renderSitesList();
      }
    });
    list.appendChild(row);
  });
}

function openSitesModal() {
  sitesDraft = JSON.parse(JSON.stringify(activeSites()));
  renderSitesList();
  document.getElementById("sitesModal").classList.remove("hidden");
}
function closeSitesModal() { document.getElementById("sitesModal").classList.add("hidden"); }

function saveSitesFromModal() {
  // Nettoie : nom obligatoire, clé stable conservée, badge/couleur par défaut si vide
  const cleaned = [];
  sitesDraft.forEach(s => {
    const name = (s.name || "").trim();
    if (!name) return; // ignore les lignes sans nom
    // Clé unique : deux périmètres de même nom ne doivent pas se confondre,
    // sinon leurs liens se mélangeraient sur toutes les fiches.
    let key = s.key || slugifySite(name);
    if (!s.key) {
      let n = 2;
      while (cleaned.some(c => c.key === key) || sites.some(x => x.key === key && !x._deleted)) {
        key = slugifySite(name) + "_" + n++;
      }
    }
    // Reprend la date existante si le site est inchangé, sinon l'horodate maintenant
    const prev = sites.find(p => p.key === key);
    const changed = !prev || prev.name !== name ||
                    prev.badge !== ((s.badge || "").trim() || name.toUpperCase().slice(0, 6)) ||
                    prev.color !== (s.color || (prev && prev.color));
    cleaned.push({
      key,
      name,
      badge: (s.badge || "").trim() || name.toUpperCase().slice(0, 6),
      color: s.color || SITE_PALETTE[cleaned.length % SITE_PALETTE.length],
      _mtime: changed ? now() : (prev._mtime || now()),
      _deleted: false
    });
  });
  if (!cleaned.length) { showToast("⚠️ Gardez au moins un site", 2600); return; }

  // Sites retirés dans la modale : on les conserve comme marqueurs « supprimés »
  // datés, pour que la suppression se propage au lieu de « ressusciter » via l'autre poste.
  const keptKeys = new Set(cleaned.map(s => s.key));
  sites.forEach(old => {
    if (!keptKeys.has(old.key) && !old._deleted) {
      cleaned.push({ ...old, _deleted: true, _mtime: now() });
    } else if (!keptKeys.has(old.key) && old._deleted) {
      cleaned.push(old); // déjà supprimé, on garde le marqueur
    }
  });

  sites = cleaned;
  saveSites(true);
  rebuildData(true);       // rafraîchit les cartes avec les nouveaux périmètres
  // Si la modale KPI est ouverte, on régénère ses champs de liens
  if (!document.getElementById("kpiModal").classList.contains("hidden")) {
    syncInputsIntoSlot(modalCurrentFreq);
    buildLinkFields();
    loadSlotIntoInputs(modalCurrentFreq);
  }
  closeSitesModal();
  showToast("✅ Sites mis à jour");
}

document.getElementById("manageSitesBtn")?.addEventListener("click", openSitesModal);
document.getElementById("closeSitesModalBtn")?.addEventListener("click", closeSitesModal);
document.getElementById("cancelSitesBtn")?.addEventListener("click", closeSitesModal);
document.getElementById("saveSitesBtn")?.addEventListener("click", saveSitesFromModal);
document.getElementById("addSiteBtn")?.addEventListener("click", () => {
  const color = SITE_PALETTE[sitesDraft.length % SITE_PALETTE.length];
  sitesDraft.push({ key: slugifySite("site"), name: "", badge: "", color });
  renderSitesList();
});
document.getElementById("sitesModal")?.addEventListener("click", e => {
  if (e.target === document.getElementById("sitesModal")) closeSitesModal();
});
// Accès aussi depuis la modale KPI ("⚙ Gérer les sites")
document.getElementById("manageSitesBtn2")?.addEventListener("click", openSitesModal);



// Boutons d'ouverture / actions de la modale
document.getElementById("addKpiBtn")?.addEventListener("click", () => openKpiModal());
document.getElementById("fabAddBtn")?.addEventListener("click", () => openKpiModal());
document.getElementById("closeKpiModalBtn")?.addEventListener("click", closeKpiModal);
document.getElementById("cancelKpiBtn")?.addEventListener("click", closeKpiModal);
document.getElementById("saveKpiBtn")?.addEventListener("click", saveKpiForm);

// Onglets de temporalité dans la modale
document.querySelectorAll(".freq-tab").forEach(btn => {
  btn.addEventListener("click", () => switchFreqTab(btn.dataset.freq));
});
// Case « cette temporalité existe » : active/désactive les champs
document.getElementById("freqActiveToggle")?.addEventListener("change", function () {
  modalSlots[modalCurrentFreq].active = this.checked;
  const ff = document.getElementById("freqFields");
  ff.style.opacity = this.checked ? "1" : "0.45";
  ff.style.pointerEvents = this.checked ? "" : "none";
  renderFreqTabs();
});
document.getElementById("deleteKpiBtn")?.addEventListener("click", () => {
  if (!editingKpiId) return;
  const id = editingKpiId;
  closeKpiModal();
  deleteKPI(id);
});
document.getElementById("restoreKpiBtn")?.addEventListener("click", () => {
  if (!editingKpiId) return;
  const id = editingKpiId;
  closeKpiModal();
  restoreOriginalKpi(id);
});
document.getElementById("kpiModal")?.addEventListener("click", e => {
  if (e.target === document.getElementById("kpiModal")) closeKpiModal();
});

/* ============================================
   FILTRES
============================================ */
function initFilters() {
  const makeOptions = (arr, el) => {
    const prev = el.value; // conserve le filtre actif
    const first = el.options[0];
    el.innerHTML = "";
    el.appendChild(first);
    const values = [...new Set(arr.filter(Boolean))].sort();
    values.forEach(v => {
      const o = document.createElement("option");
      o.textContent = v;
      el.appendChild(o);
    });
    // Restaure la sélection si elle existe toujours
    if (prev && values.includes(prev)) el.value = prev;
  };
  makeOptions([...data, ...personalEntries].map(d => d.type),    typeFilter);
  makeOptions([...data, ...personalEntries].map(d => d.process), processFilter);
  makeOptions([...data, ...personalEntries].map(d => d.ritual),  ritualFilter);
}

function resetFilters() {
  searchInput.value = "";
  typeFilter.selectedIndex = 0;
  processFilter.selectedIndex = 0;
  ritualFilter.selectedIndex = 0;
  filterData();
  showToast("Filtres réinitialisés");
}

function getViewSource() {
  return currentView === "perso" ? personalEntries
       : currentView === "fav"   ? [...data, ...personalEntries]
       : data;
}

// Une variante correspond-elle aux filtres/recherche actifs ?
function variantMatches(d, s, p, r, t) {
  if (currentView === "fav" && !isFavorite(d.id)) return false;
  return (!t || d.type === t) &&
         (!p || d.process === p) &&
         (!r || d.ritual === r) &&
         (!s ||
           (d.title   || "").toLowerCase().includes(s) ||
           (d.desc    || "").toLowerCase().includes(s) ||
           (d.ritual  || "").toLowerCase().includes(s) ||
           (d.process || "").toLowerCase().includes(s) ||
           (d.type    || "").toLowerCase().includes(s));
}

function filterData() {
  const s = searchInput.value.toLowerCase().trim();
  const p = processFilter.value;
  const r = ritualFilter.value;
  const t = typeFilter.value;

  // Regroupe TOUTES les temporalités par intitulé : le KPI reste entier
  const groupsMap = new Map();
  getViewSource().forEach(k => {
    const key = titleKey(k.title);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(k);
  });

  // Conserve les groupes dont au moins une temporalité correspond
  const groups = [];
  let matchCount = 0;
  groupsMap.forEach((variants, key) => {
    const matching = variants.filter(v => variantMatches(v, s, p, r, t));
    if (!matching.length) return;
    matchCount += matching.length;
    variants.sort((a, b) => freqRank(a.freq) - freqRank(b.freq));
    groups.push({ key, variants, matchIds: new Set(matching.map(m => m.id)) });
  });

  // Groupes contenant un favori (sur une variante correspondante) en premier
  groups.sort((a, b) => {
    const favA = a.variants.some(v => a.matchIds.has(v.id) && isFavorite(v.id));
    const favB = b.variants.some(v => b.matchIds.has(v.id) && isFavorite(v.id));
    return favB - favA;
  });

  render(groups, matchCount);
}

/* ============================================
   COMPTEURS
============================================ */
// Nombre de fiches distinctes (regroupées par intitulé), pas de temporalités
function countFiches(list) {
  return new Set(list.map(k => titleKey(k.title))).size;
}

function updateCounts() {
  countAll.textContent = countFiches(data);
  // Favoris : compter les FICHES ayant au moins une temporalité en favori,
  // toutes sources confondues (annuaire + personnel)
  const favTitles = new Set();
  [...data, ...personalEntries].forEach(k => {
    if (favorites.includes(k.id)) favTitles.add(titleKey(k.title));
  });
  countFav.textContent = favTitles.size;
  const cp = document.getElementById("countPerso");
  if (cp) cp.textContent = countFiches(personalEntries);
}

/* ============================================
   OPEN KPI
============================================ */
// Ouvre le rapport sélectionné dans un nouvel onglet, sans recharger l'app
function openReport(selectId, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const url = opt && opt.dataset ? opt.dataset.url : "";
  if (!url) { showToast("Sélectionnez d'abord un rapport"); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}

// Mémorise le SITE choisi (pas l'URL) pour le conserver en changeant de temporalité
function onReportSelect(selId, key) {
  const sel = document.getElementById(selId);
  if (sel) groupReport[key] = sel.value;
}

/* ============================================
   RENDER
============================================ */
// Ordre d'affichage des temporalités : Mensuelle → Hebdomadaire → Quotidienne
const FREQ_ORDER = { "mensuelle": 1, "hebdomadaire": 2, "quotidienne": 3 };
function freqRank(f) { return FREQ_ORDER[(f || "").toLowerCase().trim()] || 9; }
function titleKey(t) { return (t || "").toLowerCase().replace(/\s+/g, " ").trim(); }

// Classe de couleur du tag Processus : réception / distribution se distinguent des sites
function processTagClass(p) {
  const v = (p || "").toLowerCase();
  if (v.includes("récept") || v.includes("recept")) return "tag tag-process tag-reception";
  if (v.includes("distrib")) return "tag tag-process tag-distribution";
  return "tag tag-process";
}

// Classe de couleur du tag Type : contractuel / non contractuel / opérationnel
function typeTagClass(t) {
  const v = (t || "").toLowerCase();
  if (v.includes("non") && v.includes("contract")) return "tag tag-type tag-noncontract";
  if (v.includes("contract"))  return "tag tag-type tag-contract";
  if (v.includes("opérat") || v.includes("operat")) return "tag tag-type tag-operationnel";
  return "tag tag-type";
}

let kpiGroups = {}; // gid → { key, variants } (reconstruit à chaque rendu)
let groupSel = {};  // titleKey → id de la variante sélectionnée (persiste entre rendus)
let groupReport = {}; // titleKey → site de rapport choisi (logistiport/armement/…)
let animateNextRender = true; // anime l'entrée des cartes seulement quand utile (pas sur simple mise à jour)

// Corps d'une carte pour UNE variante de KPI (grouped = true si la carte
// regroupe plusieurs temporalités : la fréquence est alors dans le sélecteur)
/**
 * Décrit la dernière modification d'une variante, en LECTURE SEULE.
 * Les métadonnées `_mtime` / `_by` servent déjà à l'arbitrage de la
 * synchronisation : on se contente de les afficher, jamais de les écrire.
 * @param {Object} kpi variante affichée
 * @returns {string} HTML, vide si l'information n'est pas disponible
 */
function derniereModifHtml(kpi) {
  const t = kpi && kpi._mtime;
  if (!t) return "";                       // fiche ancienne ou importée : rien à afficher
  const auteur = kpi._by ? ` par <b>${esc(kpi._by)}</b>` : "";
  return `<div class="card-modif" title="Dernière modification de cette temporalité">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Modifié le ${fmtDate(t)}${auteur}
          </div>`;
}

function cardBody(kpi, grouped, freqSelectorHtml = "", key = "") {
  const isFav  = isFavorite(kpi.id);
  const selId  = "sel_" + kpi.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const safeId = esc(kpi.id).replace(/'/g, "\\'");
  const safeKey = esc(key).replace(/'/g, "\\'");

  // Périmètres présents pour ce KPI, dans l'ordre de la config des sites
  const present = activeSites().filter(s => kpi[s.key]);
  const siteBadges = present.map(s =>
    `<span class="site-badge" style="background:${esc(s.color || "#64748B")}"><span class="dot"></span>${esc(siteBadgeLabel(s))}</span>`
  ).join("");

  // Options de rapport : value = clé du site, data-url = lien de CETTE temporalité
  const savedSite = groupReport[key];
  const options = present.map(s =>
    `<option value="${esc(s.key)}" data-url="${esc(kpi[s.key])}"${s.key === savedSite ? " selected" : ""}>${esc(s.name)}</option>`
  ).join("");

  // Mode sélection : une case par carte, numérotée dans l'ordre de l'ordre du jour.
  const rang = selectionIds.indexOf(kpi.id);
  const coche = selectionMode ? `
      <label class="card-select${rang >= 0 ? " on" : ""}" title="Ajouter cette temporalité à la sélection">
        <input type="checkbox" ${rang >= 0 ? "checked" : ""} onchange="basculerSelection('${safeId}')">
        <span class="card-select-rang">${rang >= 0 ? rang + 1 : ""}</span>
      </label>` : "";

  return `
      ${coche}
      ${isFav ? `<div class="fav-ribbon">⭐ Favori</div>` : ""}

      <div class="card-header">
        <div class="card-title">${esc(kpi.title)}</div>
        <div class="card-tools">
          <button type="button" class="btn-tool" onclick="editKPI('${safeId}')" title="Modifier">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" class="btn-tool btn-tool-danger" onclick="deleteKPI('${safeId}')" title="Supprimer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
          <button type="button" class="btn-fav${isFav ? " active" : ""}" onclick="toggleFavorite('${safeId}')" title="${isFav ? "Retirer des favoris" : "Ajouter aux favoris"}">⭐</button>
        </div>
      </div>

      ${(kpi.type || kpi.process || kpi.ritual) ? `
      <div class="card-tags">
        ${kpi.type    ? `<span class="${typeTagClass(kpi.type)}">${esc(kpi.type)}</span>` : ""}
        ${kpi.process ? `<span class="${processTagClass(kpi.process)}">${esc(kpi.process)}</span>` : ""}
        ${kpi.ritual  ? `<span class="tag tag-ritual">${esc(kpi.ritual)}</span>` : ""}
      </div>` : ""}

      ${siteBadges ? `<div class="card-sites">${siteBadges}</div>` : ""}

      ${kpi.desc ? `<p class="card-desc">${esc(kpi.desc)}</p>` : ""}

      ${options ? `
      <div class="card-action">
        <select id="${selId}" onchange="onReportSelect('${selId}','${safeKey}')">
          <option value="">Choisir un rapport</option>
          ${options}
        </select>
        <button type="button" class="btn-open" onclick="openReport('${selId}', event)">
          Ouvrir
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
      </div>` : ""}

      ${derniereModifHtml(kpi)}

      ${freqSelectorHtml}
  `;
}

// Changement de temporalité dans une carte groupée
function changeGroupFreq(gid, idx) {
  const grp = kpiGroups[gid];
  if (!grp) return;
  const variant = grp.variants[+idx];
  if (!variant) return;
  groupSel[grp.key] = variant.id;
  const body = document.getElementById("body_" + gid);
  if (body) {
    body.innerHTML = cardBody(variant, true, freqSelectorHtml(gid, grp.variants, +idx), grp.key);
    const card = body.closest(".card");
    if (card) card.classList.toggle("favorite", isFavorite(variant.id));
  }
}

// Génère le sélecteur de temporalité (placé en bas de carte, sous le sélecteur de rapport)
function freqSelectorHtml(gid, variants, selIdx) {
  return `
      <div class="card-freq">
        <span class="card-freq-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Temporalité
        </span>
        <select onchange="changeGroupFreq('${gid}', this.value)">
          ${variants.map((v, vi) => `<option value="${vi}"${vi === selIdx ? " selected" : ""}>${esc(v.freq || "Sans fréquence")}</option>`).join("")}
        </select>
      </div>`;
}

function render(groups, matchCount) {
  // Mémorise le défilement pour ne pas revenir en haut après une mise à jour
  const prevScroll = container.scrollTop;
  const animate = animateNextRender;
  animateNextRender = true; // par défaut, les rendus suivants animent
  container.innerHTML = "";
  kpiGroups = {};
  dernierRendu = groups;   // mémorisé pour « tout cocher ce qui est filtré »

  if (!groups.length) {
    const msg = currentView === "perso"
      ? { icon: "🔒", title: personalEntries.length ? "Aucun résultat" : "Espace personnel vide", sub: personalEntries.length ? "Essayez d'autres mots-clés ou réinitialisez les filtres" : "Créez un signet avec le bouton + : il ne sera visible que par vous" }
      : data.length === 0
      ? { icon: "📊", title: "Aucun KPI chargé", sub: "Importez votre fichier Excel pour commencer" }
      : currentView === "fav"
        ? { icon: "⭐", title: "Aucun favori", sub: "Cliquez sur ⭐ dans une carte pour ajouter aux favoris" }
        : { icon: "🔍", title: "Aucun résultat", sub: "Essayez d'autres mots-clés ou réinitialisez les filtres" };

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${msg.icon}</div>
        <h3>${msg.title}</h3>
        <p>${msg.sub}</p>
      </div>`;
    searchCount.textContent = "";
    topbarBadge.textContent = "";
    return;
  }

  // Compteurs
  const totalGroups = new Set(getViewSource().map(k => titleKey(k.title))).size;
  searchCount.textContent = groups.length !== totalGroups ? `${groups.length} résultat${groups.length > 1 ? "s" : ""}` : "";
  topbarBadge.textContent = `${groups.length} KPI${groups.length > 1 ? "s" : ""}${matchCount !== groups.length ? ` · ${matchCount} variantes` : ""}`;

  groups.forEach((g, i) => {
    const { key, variants, matchIds } = g;

    // Variante affichée : sélection mémorisée si elle correspond, sinon 1ʳᵉ correspondante
    let selIdx = variants.findIndex(v => v.id === groupSel[key] && matchIds.has(v.id));
    if (selIdx < 0) selIdx = variants.findIndex(v => matchIds.has(v.id));
    if (selIdx < 0) selIdx = 0;
    const selected = variants[selIdx];
    groupSel[key] = selected.id; // verrouille la temporalité affichée (survit aux re-rendus)

    const gid = "g" + i + "_" + key.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
    kpiGroups[gid] = { key, variants };

    const card = document.createElement("div");
    card.className = "card" + (isFavorite(selected.id) ? " favorite" : "") + (animate ? "" : " no-anim");
    if (animate) card.style.animationDelay = `${Math.min(i * 30, 180)}ms`;

    if (variants.length > 1) {
      card.innerHTML = `<div class="group-body" id="body_${gid}">${cardBody(selected, true, freqSelectorHtml(gid, variants, selIdx), key)}</div>`;
    } else {
      card.innerHTML = cardBody(selected, false, "", key);
    }

    container.appendChild(card);
  });

  // Rétablit le défilement là où l'utilisateur était (évite le retour en haut)
  container.scrollTop = prevScroll;
}



/* ============================================
   EVENTS
============================================ */
searchInput.addEventListener("input", filterData);
typeFilter.addEventListener("change", filterData);
processFilter.addEventListener("change", filterData);
ritualFilter.addEventListener("change", filterData);
refreshBtn.addEventListener("click", () => { rebuildData(false); showToast("🔄 Affichage rafraîchi"); });

/* ============================================
   SYNCHRONISATION CLOUD (Firebase Firestore)
============================================ */

/* ─────────────────────────────────────────────────────────────
   CONFIGURATION INTÉGRÉE — À REMPLIR UNE SEULE FOIS PAR L'ADMIN
   Collez ci-dessous la config de VOTRE projet Firebase (onglet
   Paramètres du projet › Vos applications › SDK) et choisissez un
   code de synchronisation. Une fois rempli et l'application
   redistribuée, TOUS les PC se synchronisent automatiquement :
   plus aucune saisie de config sur les nouveaux appareils.
   (Cette config web n'est pas secrète : la sécurité est assurée
   par les règles Firestore, pas par sa dissimulation.)
   ───────────────────────────────────────────────────────────── */
const BUILTIN_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBEWADm3g2ab-vUP-sMlQfjpy_QuxhafXM",
  authDomain: "annuaire-kpi.firebaseapp.com",
  projectId: "annuaire-kpi",
  storageBucket: "annuaire-kpi.firebasestorage.app",
  messagingSenderId: "701786102556",
  appId: "1:701786102556:web:9d831bd4efaf25e41778d9"
};
const BUILTIN_SYNC_CODE = "idea-kpi-2026";

const hasBuiltinConfig = () =>
  BUILTIN_FIREBASE_CONFIG && !!BUILTIN_FIREBASE_CONFIG.projectId && !!BUILTIN_FIREBASE_CONFIG.apiKey;

const LS_SYNC = "kpiSyncConfig";
const LS_SYNC_OPTOUT = "kpiSyncOptOut"; // l'utilisateur a désactivé la sync sur CET appareil
const getSyncConfig = () => { try { return JSON.parse(localStorage.getItem(LS_SYNC)); } catch { return null; } };
const setSyncConfig = cfg => cfg ? localStorage.setItem(LS_SYNC, JSON.stringify(cfg)) : localStorage.removeItem(LS_SYNC);

// Sur un nouvel appareil : si aucune config locale et qu'une config est
// intégrée à l'application, on l'installe automatiquement (sync activée).
function ensureBuiltinConfig() {
  // Réinitialisation unique : la config intégrée vient d'être renseignée.
  // On lève une seule fois l'éventuel « opt-out » posé lors d'essais précédents,
  // pour que TOUS les appareils se reconnectent automatiquement. Le bouton
  // « Désactiver » reste fonctionnel ensuite (il reposera le drapeau).
  if (hasBuiltinConfig() && localStorage.getItem("kpiOptoutClearedV2") !== "1") {
    localStorage.removeItem(LS_SYNC_OPTOUT);
    // Si un ancien appareil pointe vers une config/code différents, on le réaligne
    // une seule fois sur la config intégrée (même projet + même code partout).
    const existing = getSyncConfig();
    if (existing && (existing.code !== BUILTIN_SYNC_CODE ||
                     existing.config?.projectId !== BUILTIN_FIREBASE_CONFIG.projectId)) {
      setSyncConfig({ config: { ...BUILTIN_FIREBASE_CONFIG }, code: BUILTIN_SYNC_CODE, enabled: true });
    }
    localStorage.setItem("kpiOptoutClearedV2", "1");
  }

  if (getSyncConfig()) return;                          // déjà configuré ici
  if (localStorage.getItem(LS_SYNC_OPTOUT)) return;     // désactivé volontairement (après la réinit ci-dessus)
  if (!hasBuiltinConfig()) return;                       // aucune config intégrée
  setSyncConfig({ config: { ...BUILTIN_FIREBASE_CONFIG }, code: BUILTIN_SYNC_CODE, enabled: true });
}

let fbApp = null, fbDb = null, fbUnsub = null, fbUnsubEmpreintes = null;
let syncDebounceHandle = null;
let lastSyncPushAt = 0;
let lastAppliedSyncAt = 0;
let connectedSyncCode = null;
let applyingRemoteSync = false;
let syncBusy = false;       // verrou : une seule opération de synchro (fusion/envoi) à la fois
let initialSyncDone = false; // l'écoute temps réel n'agit qu'après la fusion initiale
// Dernière mise à jour reçue pendant que le verrou était pris. Elle était
// auparavant purement et simplement JETÉE : l'appareil gardait une vue périmée,
// puis son envoi suivant réécrivait le document partagé et annulait la
// modification du collègue. On la met désormais de côté pour la rejouer.
let pendingRemotePayload = null;
let localUpdatedAt = +(localStorage.getItem("kpiLocalUpdatedAt") || 0); // dernière modif locale
let isBooting = true;   // pendant le chargement initial : aucune modification "réelle", donc aucun envoi
let clockOffset = +(localStorage.getItem("kpiClockOffset") || 0); // écart horloge poste ↔ serveur

// Heure corrigée de l'écart avec le serveur (évite qu'un PC mal réglé gagne tous les arbitrages)
function now() { return Date.now() + clockOffset; }

/* ============================================
   MOTEUR DE FUSION (par élément, pas en bloc)
   Chaque fiche porte sa propre date de modification :
   deux personnes peuvent modifier deux KPIs différents
   en même temps sans que l'un efface le travail de l'autre.
============================================ */

// Estampille une fiche comme modifiée maintenant, par l'utilisateur courant
function stamp(entry) {
  entry._mtime = now();
  entry._by = currentUser || "?";
  return entry;
}

// Les fonctions de fusion (mergeEntries, mergeDeleted, mergeFavorites,
// mergeOverrides, mergeActivity, normalizeDeleted) vivent dans js/merge.js :
// logique pure, sans DOM ni stockage, couverte par merge.test.js.

// Métadonnées locales de fusion (horodatages des blocs non listés)
function getMeta() {
  try { return JSON.parse(localStorage.getItem("kpiMeta")) || {}; } catch { return {}; }
}
function setMeta(m) { ecrireDonnees("kpiMeta", m); }
function touchMeta(key) { const m = getMeta(); m[key] = now(); setMeta(m); return m; }
let pendingPush = false;    // un envoi n'a pas pu aboutir (hors-ligne) et devra être rejoué
let netHandlersBound = false;

function markLocalChange() {
  localUpdatedAt = Date.now();
  localStorage.setItem("kpiLocalUpdatedAt", String(localUpdatedAt));
}

let lastSyncState = "off";
function setSyncStatusUI(state, detail) {
  lastSyncState = state;
  const map = {
    off:       { text: "⚪ Synchronisation non configurée", cls: "",          pill: "Sync off",   show: false },
    connected: { text: "🟢 Connecté — synchronisation active", cls: "connected", pill: "Synchronisé", show: true  },
    syncing:   { text: "🔄 Synchronisation…", cls: "syncing",                 pill: "Sync…",      show: true  },
    offline:   { text: "🟠 Hors ligne — reprise automatique au retour du réseau", cls: "offline", pill: "Hors ligne", show: true },
    error:     { text: "🔴 Erreur : " + (detail || "voir console"), cls: "error", pill: "Erreur",   show: true  }
  };
  const s = map[state] || map.off;

  const el = document.getElementById("syncStatus");
  if (el) { el.textContent = s.text; el.className = "sync-status " + s.cls; }

  // Pilule discrète dans la barre du haut
  const pill = document.getElementById("syncPill");
  const pillText = document.getElementById("syncPillText");
  if (pill) {
    pill.style.display = s.show ? "" : "none";
    pill.className = "sync-pill " + s.cls;
    if (pillText) pillText.textContent = s.pill;
  }
}

function syncDocRef(code) {
  return fbDb.collection("kpi_sync").doc(code);
}

/* Document séparé pour les empreintes : ~5 Ko par visuel, alors que le
   document principal est plafonné à 1 Mo. Les mêler ferait courir le
   risque de ne plus pouvoir enregistrer l'annuaire du tout. */
function empreintesDocRef(code) {
  return fbDb.collection("kpi_sync").doc(code + "__empreintes");
}

/** Envoie les empreintes, en refusionnant d'abord ce qui est déjà en ligne. */
async function pousserEmpreintes() {
  const cfg = getSyncConfig();
  if (!cfg || !fbDb || !currentUser || !navigator.onLine) return false;
  try {
    const snap = await empreintesDocRef(cfg.code).get();
    if (snap.exists) {
      const distant = snap.data();
      if (distant && Array.isArray(distant.kpiEmpreintes)) {
        empreintes = Empreintes.fusionnerEmpreintes(empreintes, distant.kpiEmpreintes);
        ecrireDonnees(LS_EMPREINTES, empreintes);
      }
    }
    await empreintesDocRef(cfg.code).set({ kpiEmpreintes: empreintes, updatedAt: now() });
    return true;
  } catch (err) {
    // L'annuaire doit rester utilisable même si ce document-là échoue.
    return false;
  }
}

/** Récupère les empreintes partagées et les fusionne aux locales. */
async function tirerEmpreintes() {
  const cfg = getSyncConfig();
  if (!cfg || !fbDb) return 0;
  try {
    const snap = await empreintesDocRef(cfg.code).get();
    if (!snap.exists) return 0;
    const distant = snap.data();
    if (!distant || !Array.isArray(distant.kpiEmpreintes)) return 0;
    empreintes = Empreintes.fusionnerEmpreintes(empreintes, distant.kpiEmpreintes);
    ecrireDonnees(LS_EMPREINTES, empreintes);
    return empreintes.length;
  } catch (err) {
    return 0;
  }
}

function buildSyncPayload() {
  const meta = getMeta();
  const favoritesByUser = Store.readJSON(Store.KEYS.SYNC_FAV, {}) || {};
  const favoritesMeta   = Store.readJSON(Store.KEYS.FAV_META, {}) || {};
  favoritesByUser[currentUser] = favorites;
  favoritesMeta[currentUser]   = meta.favAt || now();
  // Une fiche supprimée définitivement ne reviendra jamais : les favoris qui
  // la désignent, y compris ceux des autres utilisateurs, sont des références
  // mortes. On les retire du document partagé pour qu'ils cessent de s'accumuler.
  if (purgedIds && purgedIds.length) {
    const morts = new Set(purgedIds);
    Object.keys(favoritesByUser).forEach(u => {
      const liste = favoritesByUser[u];
      if (Array.isArray(liste)) favoritesByUser[u] = liste.filter(id => !morts.has(id));
    });
    favorites = favoritesByUser[currentUser] || favorites;
  }

  // Références mortes des AUTRES utilisateurs : personne ne les nettoyait.
  // Un favori dont la fiche n'existe plus nulle part (identifiant réécrit par
  // une ancienne migration, fiche remplacée) restait publié indéfiniment et
  // était signalé par le banc de test. On ne le fait qu'APRÈS un premier
  // échange complet avec le cloud, pour ne pas retirer un favori dont la fiche
  // ne serait simplement pas encore arrivée sur cet appareil.
  if (initialSyncDone) {
    const cartePerso = lireMapPerso(LS_PERSO_MAP);
    const connus = new Set([
      ...manualEntries.map(k => k && k.id),
      ...personalEntries.map(k => k && k.id),
      ...deletedIds.map(d => d && d.id),
      ...personalTrash.map(v => v && v.id),
      ...Object.keys(cartePerso).reduce((acc, u) => acc.concat(
        (Array.isArray(cartePerso[u]) ? cartePerso[u] : []).map(k => k && k.id)), [])
    ]);
    Object.keys(favoritesByUser).forEach(u => {
      const liste = favoritesByUser[u];
      if (!Array.isArray(liste)) return;
      const propre = liste.filter(id => connus.has(id));
      if (propre.length !== liste.length) {
        favoritesByUser[u] = propre;
        favoritesMeta[u] = now();      // sinon un autre appareil les renverrait
      }
    });
    favorites = favoritesByUser[currentUser] || favorites;
  }
  Store.writeJSON(Store.KEYS.SYNC_FAV, favoritesByUser);
  Store.writeJSON(Store.KEYS.FAV_META, favoritesMeta);

  // Espace personnel : on remplace UNIQUEMENT son propre bloc et on
  // retransmet ceux des autres utilisateurs sans y toucher.
  const personalByUser      = lireMapPerso(LS_PERSO_MAP);
  const personalTrashByUser = lireMapPerso(LS_PERSO_TRASH);
  if (isPersonalSyncOn()) {
    personalByUser[currentUser]      = personalEntries;
    personalTrashByUser[currentUser] = personalTrash;
  } else {
    // Synchronisation désactivée ici : on retire son bloc du document partagé
    delete personalByUser[currentUser];
    delete personalTrashByUser[currentUser];
  }
  Store.writeJSON(LS_PERSO_MAP, personalByUser);
  Store.writeJSON(LS_PERSO_TRASH, personalTrashByUser);

  // Dernier filet avant l'envoi : aucune fiche supprimée définitivement ne
  // doit repartir vers le cloud, même si un chemin d'importation ou de
  // restauration l'avait réintroduite localement.
  const morts = new Set(purgedIds || []);
  const fichesPartagees = morts.size ? manualEntries.filter(k => k && !morts.has(k.id)) : manualEntries;

  return {
    kpiManual: fichesPartagees,   // toutes les fiches partagées, fusionnées par élément
    kpiDeleted: deletedIds,
    kpiSites: sites,
    kpiPurged: purgedIds,
    kpiActivity: activityLog,
    kpiPresets: presets,          // sélections de rituel, partagées comme les fiches
    personalByUser,
    personalTrashByUser,
    favoritesByUser,
    favoritesMeta,
    updatedAt: now()
  };
}

function scheduleAutoSync() {
  const cfg = getSyncConfig();
  // Pendant le démarrage, rien n'a été modifié par l'utilisateur : on n'envoie rien
  if (!cfg || !cfg.enabled || applyingRemoteSync || isBooting) return;
  markLocalChange();
  if (!fbDb || !navigator.onLine) { pendingPush = true; if (!navigator.onLine) setSyncStatusUI("offline"); return; }
  clearTimeout(syncDebounceHandle);
  syncDebounceHandle = setTimeout(() => pushToCloud(false), 1500);
}

/**
 * Envoie l'état local vers le document partagé.
 * @param {boolean} manual  déclenché par un clic (affiche des messages)
 * @param {boolean} forcer  « Cet appareil fait référence » : écrase sans
 *                          refusionner au préalable. Réservé au bouton dédié.
 */
async function pushToCloud(manual, forcer) {
  const cfg = getSyncConfig();
  if (!cfg || !fbDb) { pendingPush = true; return; }
  if (!navigator.onLine) { pendingPush = true; setSyncStatusUI("offline"); return; }
  // Garde-fou : après une déconnexion, toutes les listes sont vides. Un envoi
  // déclenché à ce moment-là (modification restée en attente, retour sur
  // l'onglet) écrivait un document VIDE et effaçait l'annuaire de toute
  // l'équipe. Sans utilisateur connecté, on n'envoie rien.
  if (!currentUser) { pendingPush = false; return; }
  setSyncStatusUI("syncing");
  try {
    // ── RELIRE AVANT D'ÉCRIRE ──
    // L'envoi remplace le document partagé en entier. Si cet appareil avait
    // manqué une modification (onglet en arrière-plan, verrou de synchro,
    // travail hors-ligne), son envoi effaçait le travail des autres. On
    // refusionne donc systématiquement l'état distant juste avant d'écrire.
    const avant = forcer ? null : await syncDocRef(cfg.code).get();
    if (avant && avant.exists) {
      const distant = avant.data();
      const dejaVu = distant && (distant.updatedAt === lastSyncPushAt || distant.updatedAt === lastAppliedSyncAt);
      if (distant && distant.updatedAt && !dejaVu) {
        applyingRemoteSync = true;
        try {
          mergeRemoteContent(distant);
          mergeRemoteSites(distant);
          mergeRemoteFavorites(distant);
        } finally { applyingRemoteSync = false; }
        lastAppliedSyncAt = distant.updatedAt;
        rebuildData(false);
      }
    }

    const payload = buildSyncPayload();
    lastSyncPushAt = payload.updatedAt;
    await syncDocRef(cfg.code).set(payload);
    pendingPush = false;
    setSyncStatusUI("connected");
    if (manual) showToast("Synchronisé ☁️ — données envoyées", 2500);
  } catch (err) {
    pendingPush = true;
    setSyncStatusUI(navigator.onLine ? "error" : "offline", err.message);
    if (manual) showToast("❌ Erreur de synchronisation", 3000);
  }
}

/**
 * Fusionne toutes les fiches partagées, suppressions, purges et journal.
 * Compatibilité : si un ancien payload contient encore kpiExcel/kpiOverrides,
 * on les convertit en fiches manuelles à la volée (transition en douceur).
 */
function mergeRemoteContent(payload) {
  // Fiches partagées (nouveau format)
  let remoteManual = Array.isArray(payload.kpiManual) ? [...payload.kpiManual]
                   : (Array.isArray(payload.kpiData) ? payload.kpiData.filter(d => d.manual) : []);

  // ── Compatibilité ancien format : kpiExcel + kpiOverrides → fiches ──
  // Ce chemin ne s'exécute QUE si le document ne contient pas déjà la liste
  // moderne `kpiManual`. Auparavant il tournait aussi quand `kpiManual`
  // faisait autorité : un résidu `kpiExcel`/`kpiData` oublié dans le document
  // réinjectait ses lignes dans l'annuaire de tout le monde, à chaque fusion.
  if (!Array.isArray(payload.kpiManual)) {
    const oldExcel = Array.isArray(payload.kpiExcel) ? payload.kpiExcel
                   : (Array.isArray(payload.kpiData) ? payload.kpiData.filter(d => !d.manual) : []);
    if (oldExcel.length) {
      const overr = (payload.kpiOverrides && typeof payload.kpiOverrides === "object") ? payload.kpiOverrides : {};
      oldExcel.forEach(d => {
        const merged = overr[d.id] ? { ...d, ...overr[d.id] } : d;
        const newId = "kpi_" + slugifyId(merged.title) + "_" + slugifyId(merged.freq);
        // Une conversion ne doit jamais ramener une fiche déjà supprimée
        // définitivement, ni une fiche mise à la corbeille ici.
        if (isPurged(newId) || isDeleted(newId)) return;
        if (!remoteManual.some(m => m.id === newId)) {
          remoteManual.push({ ...merged, id: newId, manual: true, _mtime: merged._mtime || 0 });
        }
      });
    }
  }

  if (remoteManual.length || Array.isArray(payload.kpiManual)) {
    manualEntries = mergeEntries(manualEntries, remoteManual);
    saveManualEntries(false);
  }
  if (Array.isArray(payload.kpiDeleted)) {
    deletedIds = mergeDeleted(deletedIds, normalizeDeleted(payload.kpiDeleted));
    saveDeletedIds(false);
  }
  if (Array.isArray(payload.kpiPurged)) {
    purgedIds = [...new Set([...(purgedIds || []), ...payload.kpiPurged])];
    savePurged(false);
  }
  // ⚠️ HORS du `if` ci-dessus, volontairement.
  // Les suppressions définitives connues de CET appareil doivent être
  // appliquées aux fiches qui viennent d'arriver, même si le document reçu
  // ne contient aucun champ `kpiPurged` (document ancien, partiel ou
  // corrompu). Sinon la fiche purgée revenait dans la liste locale… puis
  // repartait vers le cloud au premier envoi : c'est le mécanisme central
  // des « KPI qui reviennent alors qu'on les a supprimés ».
  nettoyerPurgees();
  // Un marqueur de corbeille dont la fiche a été purgée n'a plus d'objet :
  // il produirait une ligne fantôme, non récupérable et indestructible.
  nettoyerMarqueursPurges();

  if (Array.isArray(payload.kpiActivity)) {
    activityLog = mergeActivity(activityLog, payload.kpiActivity, MAX_ACTIVITY);
    saveActivity(false);
  }

  // Sélections de rituel : même arbitrage que les fiches, sélection par
  // sélection. Deux personnes peuvent en créer chacune une sans s'écraser.
  if (Array.isArray(payload.kpiPresets)) {
    presets = Selection.fusionnerPresets(presets, payload.kpiPresets);
    savePresets(false);
    remplirListePresets();
  }

  // ── Espace personnel, rangé par utilisateur ──
  if (payload.personalByUser && typeof payload.personalByUser === "object") {
    const distantTrash = (payload.personalTrashByUser && typeof payload.personalTrashByUser === "object")
                       ? payload.personalTrashByUser : {};
    // Fusion clé par clé, jamais remplacement en bloc : un appareil dont le
    // document était périmé effaçait sinon du stockage local (puis du cloud)
    // le bloc personnel de ses collègues.
    const distant = mergeParUtilisateur(lireMapPerso(LS_PERSO_MAP), payload.personalByUser, currentUser);
    const fusionTrash = mergeParUtilisateur(lireMapPerso(LS_PERSO_TRASH), distantTrash, currentUser);
    Store.writeJSON(LS_PERSO_MAP, distant);
    Store.writeJSON(LS_PERSO_TRASH, fusionTrash);

    if (isPersonalSyncOn()) {
      const mien = Array.isArray(payload.personalByUser[currentUser]) ? payload.personalByUser[currentUser] : [];
      const mienneTrash = Array.isArray(distantTrash[currentUser]) ? distantTrash[currentUser] : [];
      personalEntries = mergeEntries(personalEntries, mien);
      personalTrash   = mergePersonalTrash(personalTrash, mienneTrash);
      appliquerCorbeillePerso();
      Store.writeJSON("kpiPersonal_" + currentUser, personalEntries);
      Store.writeJSON("kpiPersonalTrash_" + currentUser, personalTrash);
    }
  }

  // Favoris devenus orphelins après cette fusion (fiche purgée ailleurs).
  nettoyerFavoris();
}

/**
 * Fusionne la configuration des sites CLÉ PAR CLÉ (comme les KPIs).
 * Un site ajouté sur un poste et un autre ajouté ailleurs coexistent
 * désormais : plus d'écrasement de toute la liste. Pour chaque clé,
 * la version la plus récente gagne, y compris les marqueurs de suppression.
 */
function mergeRemoteSites(payload) {
  if (!Array.isArray(payload.kpiSites) || !payload.kpiSites.length) return;
  const map = new Map();
  // On part des sites distants…
  payload.kpiSites.forEach(s => { if (s && s.key) map.set(s.key, s); });
  // …puis on garde la version locale quand elle est plus récente
  sites.forEach(s => {
    if (!s || !s.key) return;
    const other = map.get(s.key);
    if (!other || (s._mtime || 0) >= (other._mtime || 0)) map.set(s.key, s);
  });
  sites = [...map.values()];
  saveSites(false);
}

/** Fusionne les favoris utilisateur par utilisateur. */
function mergeRemoteFavorites(payload) {
  if (!payload.favoritesByUser) return;
  const localMap  = Store.readJSON(Store.KEYS.SYNC_FAV, {});
  const localMeta = Store.readJSON(Store.KEYS.FAV_META, {});
  const { map, meta: fmeta } =
    mergeFavorites(localMap, localMeta, payload.favoritesByUser, payload.favoritesMeta);
  Store.writeJSON(Store.KEYS.SYNC_FAV, map);
  Store.writeJSON(Store.KEYS.FAV_META, fmeta);
  if (map[currentUser]) { favorites = map[currentUser]; saveFavoritesLocalOnly(); }
}

/**
 * Intègre les données reçues du cloud par FUSION (jamais par écrasement).
 * Un instantané local est pris au préalable : il permet de revenir en
 * arrière si la fusion produit un résultat inattendu.
 */
function applyRemoteData(payload, fromSync) {
  pushSnapshot(fromSync ? "avant réception cloud" : "avant récupération manuelle");
  applyingRemoteSync = true;

  mergeRemoteContent(payload);   // fiches partagées (+ compat ancien format Excel)
  mergeRemoteSites(payload);
  mergeRemoteFavorites(payload);

  rebuildData(false);
  applyingRemoteSync = false;

  if (payload.updatedAt) {
    localUpdatedAt = Math.max(localUpdatedAt, payload.updatedAt);
    Store.writeRaw(Store.KEYS.LOCAL_AT, String(localUpdatedAt));
  }
  if (!fromSync) showToast("✅ Données récupérées depuis le cloud", 2500);
}

// Récupère et fusionne les données du cloud (bouton « Récupérer »).
// Utilise le même moteur de fusion : rien n'est écrasé sans arbitrage.
async function pullFromCloud(manual, replace) {
  const cfg = getSyncConfig();
  if (!cfg || !fbDb) { if (manual) showToast("⚠️ Synchronisation non connectée", 3000); return; }
  if (syncBusy) { if (manual) showToast("Synchro en cours, réessayez dans un instant", 2500); return; }
  syncBusy = true;               // bloque l'écoute temps réel pendant l'opération
  setSyncStatusUI("syncing");
  try {
    const snap = await syncDocRef(cfg.code).get();
    await tirerEmpreintes();   // document séparé : son absence n'est pas une erreur
    if (!snap.exists) {
      setSyncStatusUI("connected");
      if (manual) showToast("Aucune donnée cloud pour ce code", 2800);
      return;
    }
    if (replace) {
      replaceLocalWithRemote(snap.data());
    } else {
      applyRemoteData(snap.data(), false);
    }
    setSyncStatusUI("connected");
  } catch (err) {
    setSyncStatusUI(navigator.onLine ? "error" : "offline", err.message);
    if (manual) showToast("❌ Erreur de synchronisation : " + (err.message || ""), 3500);
  } finally {
    syncBusy = false;
  }
  rejouerSyncEnAttente();
}

// REMPLACE réellement les données locales par celles du cloud (pas de fusion).
// Sert à sortir d'une divergence : le cloud fait autorité, le local est écrasé.
function replaceLocalWithRemote(payload) {
  // Fiches partagées : on prend celles du cloud telles quelles
  let remoteManual = Array.isArray(payload.kpiManual) ? [...payload.kpiManual]
                   : (Array.isArray(payload.kpiData) ? payload.kpiData.filter(d => d.manual) : []);
  // Compat ancien format : convertit kpiExcel + overrides en fiches,
  // uniquement si le document ne contient pas déjà la liste moderne.
  if (!Array.isArray(payload.kpiManual)) {
    const oldExcel = Array.isArray(payload.kpiExcel) ? payload.kpiExcel : [];
    const overr = (payload.kpiOverrides && typeof payload.kpiOverrides === "object") ? payload.kpiOverrides : {};
    oldExcel.forEach(d => {
      const merged = overr[d.id] ? { ...d, ...overr[d.id] } : d;
      const id = "kpi_" + slugifyId(merged.title) + "_" + slugifyId(merged.freq);
      if (isPurged(id)) return;   // ne jamais ramener une suppression définitive
      if (!remoteManual.some(m => m.id === id)) remoteManual.push({ ...merged, id, manual: true, _mtime: merged._mtime || 1 });
    });
  }

  // Filet de sécurité : « Remplacer par le cloud » est destiné à sortir d'une
  // divergence, pas à vider l'annuaire. Un document cloud vide (ou dont les
  // fiches n'ont pas encore été écrites) effaçait tout sans prévenir.
  if (!remoteManual.length && manualEntries.length) {
    if (!confirm(
      `Le cloud ne contient AUCUNE fiche, alors que cet appareil en a ${manualEntries.length}.\n\n` +
      "Continuer effacerait toutes les fiches de cet appareil.\n\n" +
      "Voulez-vous vraiment remplacer vos données par un annuaire vide ?"
    )) { showToast("Remplacement annulé — vos fiches sont conservées", 3500); return; }
  }

  pushSnapshot("avant remplacement par le cloud");
  applyingRemoteSync = true;

  manualEntries = remoteManual;
  saveManualEntries(false);

  // Champ absent ≠ liste vide.
  // Un document ancien ou partiel n'a ni `kpiDeleted` ni `kpiPurged` : les
  // remettre à zéro faisait réapparaître toutes les fiches supprimées, y
  // compris celles supprimées définitivement, qui repartaient ensuite au cloud.
  if (Array.isArray(payload.kpiDeleted)) {
    deletedIds = normalizeDeleted(payload.kpiDeleted);
    saveDeletedIds(false);
  }
  if (Array.isArray(payload.kpiPurged)) {
    // Union : une suppression définitive décidée ici reste valable.
    purgedIds = [...new Set([...(purgedIds || []), ...payload.kpiPurged])];
    savePurged(false);
  }
  nettoyerPurgees();
  nettoyerMarqueursPurges();
  if (Array.isArray(payload.kpiSites) && payload.kpiSites.length) { sites = payload.kpiSites; saveSites(false); }
  if (Array.isArray(payload.kpiActivity)) { activityLog = payload.kpiActivity; saveActivity(false); }
  // Champ absent ≠ liste vide : un document ancien n'a pas de sélections,
  // les effacer ferait perdre le travail d'ordre du jour de l'équipe.
  if (Array.isArray(payload.kpiPresets)) {
    presets = payload.kpiPresets.map(p => Selection.normaliserPreset(p));
    savePresets(false);
  }
  if (payload.favoritesByUser) {
    ecrireDonnees("kpiSyncFavorites", payload.favoritesByUser);
    if (payload.favoritesByUser[currentUser]) { favorites = payload.favoritesByUser[currentUser]; saveFavoritesLocalOnly(); }
  }
  if (payload.personalByUser && typeof payload.personalByUser === "object") {
    ecrireDonnees(LS_PERSO_MAP, payload.personalByUser);
    ecrireDonnees(LS_PERSO_TRASH, payload.personalTrashByUser || {});
    if (isPersonalSyncOn()) {
      personalEntries = Array.isArray(payload.personalByUser[currentUser])
                      ? payload.personalByUser[currentUser] : [];
      personalTrash = Array.isArray((payload.personalTrashByUser || {})[currentUser])
                    ? payload.personalTrashByUser[currentUser] : [];
      ecrireDonnees("kpiPersonal_" + currentUser, personalEntries);
      ecrireDonnees("kpiPersonalTrash_" + currentUser, personalTrash);
    }
  }

  rebuildData(false);
  applyingRemoteSync = false;
  if (payload.updatedAt) {
    localUpdatedAt = payload.updatedAt;
    Store.writeRaw(Store.KEYS.LOCAL_AT, String(localUpdatedAt));
    lastAppliedSyncAt = payload.updatedAt;
  }
  showToast("✅ Données remplacées par celles du cloud", 3000);
}

/**
 * Rejoue la dernière mise à jour distante mise de côté pendant que le verrou
 * de synchronisation était pris. À appeler dès que le verrou est relâché.
 */
function rejouerSyncEnAttente() {
  const p = pendingRemotePayload;
  pendingRemotePayload = null;
  if (!p || !p.updatedAt) return;
  if (!initialSyncDone || syncBusy) { pendingRemotePayload = p; return; }
  if (p.updatedAt === lastSyncPushAt || p.updatedAt === lastAppliedSyncAt) return;
  syncBusy = true;
  try {
    lastAppliedSyncAt = p.updatedAt;
    applyRemoteData(p, true);
  } finally {
    syncBusy = false;
  }
}

/* Écoute du document d'empreintes. Séparée de l'écoute principale : une
   empreinte ajoutée par un collègue doit arriver sans rien re-rendre. */
/* Coupe l'écoute des empreintes. Appelée partout où l'écoute principale
   est coupée : un abonnement oublié continuerait d'écrire dans le
   stockage après la déconnexion. */
function couperEcouteEmpreintes() {
  if (fbUnsubEmpreintes) { fbUnsubEmpreintes(); fbUnsubEmpreintes = null; }
}

function ecouterEmpreintes(code) {
  couperEcouteEmpreintes();
  if (!fbDb) return;
  fbUnsubEmpreintes = empreintesDocRef(code).onSnapshot(snap => {
    if (!snap.exists) return;
    const distant = snap.data();
    if (!distant || !Array.isArray(distant.kpiEmpreintes)) return;
    const avant = empreintes.length;
    empreintes = Empreintes.fusionnerEmpreintes(empreintes, distant.kpiEmpreintes);
    ecrireDonnees(LS_EMPREINTES, empreintes);
    if (empreintes.length !== avant) renderDeckLignes();
  }, () => { /* silencieux : l'annuaire reste utilisable sans les empreintes */ });
}

function listenForRemoteChanges(code) {
  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  ecouterEmpreintes(code);
  fbUnsub = syncDocRef(code).onSnapshot(
    snap => {
      if (!snap.exists) return;
      const payload = snap.data();
      if (!payload || !payload.updatedAt) return;
      // Ne rien traiter tant que la fusion initiale n'est pas finie,
      // ni pendant qu'une autre opération de synchro est en cours (verrou),
      // ni si c'est l'écho de notre propre écriture.
      if (payload.updatedAt === lastSyncPushAt || payload.updatedAt === lastAppliedSyncAt) return;
      if (!initialSyncDone || syncBusy) { pendingRemotePayload = payload; return; }
      syncBusy = true;
      try {
        lastAppliedSyncAt = payload.updatedAt;
        applyRemoteData(payload, true);
        showToast("☁️ Données mises à jour depuis un autre appareil", 2800);
      } finally {
        syncBusy = false;
      }
      rejouerSyncEnAttente();
    },
    err => setSyncStatusUI(navigator.onLine ? "error" : "offline", err.message)
  );
}

// Premier échange à la connexion : récupère si le cloud est plus récent,
// envoie si nos données locales sont plus récentes (ou si le cloud est vide).
// Mesure l'écart entre l'horloge du poste et celle du serveur Firestore.
// Sans ça, un PC mal réglé (avance de plusieurs heures) gagnerait tous les arbitrages.
async function syncClockOffset(code) {
  try {
    const ref = syncDocRef(code + "__clock");
    await ref.set({ t: firebase.firestore.FieldValue.serverTimestamp() });
    const snap = await ref.get();
    const t = snap.data() && snap.data().t;
    if (t && typeof t.toMillis === "function") {
      const offset = t.toMillis() - Date.now();
      // On n'applique une correction que si l'écart est significatif (> 5 s)
      clockOffset = Math.abs(offset) > 5000 ? offset : 0;
      localStorage.setItem("kpiClockOffset", String(clockOffset));
      if (Math.abs(offset) > 60000) {
        console.warn("Horloge du poste décalée de", Math.round(offset / 1000), "s — correction appliquée.");
      }
    }
  } catch (err) {
    // Non bloquant, mais on trace : un échec répété fausserait l'arbitrage temporel
    console.warn("[Sync] Mesure de l'horloge serveur impossible, horloge locale conservée.", err);
  }
}

async function initialSync(code, manual) {
  if (!fbDb || !navigator.onLine) { if (!navigator.onLine) setSyncStatusUI("offline"); return; }
  if (syncBusy) return;      // évite deux fusions concurrentes
  syncBusy = true;
  setSyncStatusUI("syncing");
  try {
    await syncClockOffset(code);
    const snap = await syncDocRef(code).get();
    const remote = snap.exists ? snap.data() : null;
    const cfg = getSyncConfig();
    const canPush = cfg && cfg.enabled;

    if (!remote) {
      // Rien dans le cloud : on y dépose nos données locales
      if (canPush) await pushToCloud(false);
    } else {
      // Fusion systématique : personne n'écrase personne.
      lastAppliedSyncAt = remote.updatedAt || 0;
      applyRemoteData(remote, true);
      // On ne renvoie au cloud QUE si la fusion a réellement apporté quelque chose
      // de nouveau de notre côté (évite de réécrire le cloud à chaque ouverture).
      if (canPush && hasLocalDataNewerThan(remote)) await pushToCloud(false);
    }
    initialSyncDone = true;
    // Maintenant seulement on sait ce que le cloud contient réellement : c'est
    // le bon moment pour retirer les favoris qui ne désignent plus rien.
    if (nettoyerFavoris()) saveFavoritesLocalOnly();
    setSyncStatusUI("connected");
  } catch (err) {
    setSyncStatusUI(navigator.onLine ? "error" : "offline", err.message);
    if (manual) showToast("❌ Erreur de synchronisation", 3000);
  } finally {
    syncBusy = false;
  }
  rejouerSyncEnAttente();
}

// Notre état local contient-il une fiche plus récente que ce que le cloud connaît ?
// Sert à ne renvoyer au cloud que si l'on a réellement des apports.
function hasLocalDataNewerThan(remote) {
  // Comparaison ÉLÉMENT PAR ÉLÉMENT avec ce que le cloud contient réellement.
  // On ne peut pas comparer des dates maximales globales : cette fonction est
  // appelée APRÈS la fusion, donc nos données contiennent déjà celles du cloud
  // — le maximum local serait faussé et un apport local (créé hors-ligne,
  // par exemple) ne serait jamais renvoyé.
  const plusRecent = (locaux, distants, cle, date) => {
    const map = new Map((distants || []).map(x => [x[cle], x[date] || 0]));
    return (locaux || []).some(x => {
      const t = map.get(x[cle]);
      return t === undefined || (x[date] || 0) > t;   // absent du cloud, ou plus récent ici
    });
  };
  if (plusRecent(manualEntries, remote.kpiManual, "id", "_mtime")) return true;
  if (plusRecent(deletedIds,    remote.kpiDeleted, "id", "at"))    return true;
  if (plusRecent(sites,         remote.kpiSites,  "key", "_mtime")) return true;
  const distantsPurges = new Set(remote.kpiPurged || []);
  if ((purgedIds || []).some(id => !distantsPurges.has(id))) return true;

  // Espace personnel : on ne compare que SON propre bloc
  if (isPersonalSyncOn()) {
    const monBlocDistant   = (remote.personalByUser || {})[currentUser];
    const maCorbeilleDist  = (remote.personalTrashByUser || {})[currentUser];
    if (plusRecent(personalEntries, monBlocDistant, "id", "_mtime")) return true;
    if (plusRecent(personalTrash, maCorbeilleDist, "id", "_deletedAt")) return true;
  }
  return false;
}

// Reprise automatique : retour du réseau + retour sur l'onglet
function bindNetworkHandlers() {
  if (netHandlersBound) return;
  netHandlersBound = true;

  window.addEventListener("online", () => {
    const cfg = getSyncConfig();
    if (!cfg || !cfg.enabled) return;
    setSyncStatusUI("syncing");
    // Reconnecte si besoin, puis rejoue un envoi en attente
    if (!connectedSyncCode) connectSync(false);
    else {
      initialSync(cfg.code, false);
      if (pendingPush) pushToCloud(false);
    }
    showToast("🔄 Connexion rétablie — synchronisation…", 2500);
  });

  window.addEventListener("offline", () => {
    const cfg = getSyncConfig();
    if (cfg && cfg.enabled) setSyncStatusUI("offline");
  });

  // Reprise sur l'onglet : on renvoie seulement d'éventuelles modifications en attente.
  // (L'écoute temps réel onSnapshot garde déjà les données à jour, inutile de tout re-rendre.)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const cfg = getSyncConfig();
    if (!cfg || !cfg.enabled || !fbDb || !navigator.onLine) return;
    if (pendingPush) pushToCloud(false);
  });
}

function connectSync(manual) {
  try {
    ensureBuiltinConfig(); // nouvel appareil : installe la config intégrée si dispo
    const cfg = getSyncConfig();
    if (!cfg || !cfg.config || !cfg.code) { setSyncStatusUI("off"); return; }
    // Firebase refuse les origines "file://" : inutile d'essayer, on l'explique clairement
    if (isFileProtocol()) {
      setSyncStatusUI("error", "impossible en mode fichier local (file://). Ouvrez l'application via son adresse https://…");
      if (manual) showToast("⚠️ Synchro impossible en local (file://) — utilisez l'adresse https", 4000);
      return;
    }
    if (typeof firebase === "undefined") {
      setSyncStatusUI("error", "Librairie Firebase non chargée (vérifiez votre connexion).");
      return;
    }
    if (fbDb && fbUnsub && connectedSyncCode === cfg.code) {
      setSyncStatusUI("connected");
      if (manual) showToast("Déjà connecté ☁️", 2200);
      return;
    }
    if (!fbApp) {
      fbApp = firebase.apps && firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(cfg.config);
      fbDb  = firebase.firestore();
    }
    connectedSyncCode = cfg.code;
    bindNetworkHandlers();
    if (cfg.enabled) {
      // Échange initial : on décide d'envoyer ou de récupérer selon l'ancienneté
      initialSync(cfg.code, manual);
      // Écoute temps réel des changements des autres appareils
      listenForRemoteChanges(cfg.code);
    }
    setSyncStatusUI(navigator.onLine ? "connected" : "offline");
    if (manual) showToast("Connecté ☁️ — code : " + cfg.code, 2800);
  } catch (err) {
    console.error("connectSync error:", err);
    setSyncStatusUI("error", err.message);
    if (manual) showToast("❌ Échec de connexion", 3000);
  }
}

function disconnectSync() {
  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  couperEcouteEmpreintes();
  connectedSyncCode = null;
  initialSyncDone = false;
  syncBusy = false;
  setSyncConfig(null);
  localStorage.setItem(LS_SYNC_OPTOUT, "1"); // n'auto-réinstalle pas la config intégrée ici
  setSyncStatusUI("off");
  showToast("Synchronisation désactivée", 2200);
}

function isFileProtocol() { return location.protocol === "file:"; }

// Panneau de diagnostic : où sont stockées les données, et vers quel cloud on pointe
function renderSyncDiag() {
  const el = document.getElementById("syncDiag");
  if (!el) return;
  const cfg = getSyncConfig();
  const origin = isFileProtocol() ? "fichier local (file://)" : location.origin;
  const proj = cfg?.config?.projectId || "—";
  const code = cfg?.code || "—";
  const auto = cfg?.enabled ? "activée" : "en pause";

  // L'interrupteur reflète l'état réel enregistré sur cet appareil
  const bascule = document.getElementById("personalSyncToggle");
  if (bascule) bascule.checked = isPersonalSyncOn();

  // Analyse fiches vs variantes (temporalités), en séparant partagé et perso.
  // On ne compte que le VISIBLE (data exclut déjà la corbeille).
  const partKpis = countFiches(data);
  const partVar  = data.length;
  const persoKpis = countFiches(personalEntries);
  const persoVar  = personalEntries.length;
  const anomalies = findVariantAnomalies([...data, ...personalEntries]);

  el.innerHTML = `
    <div class="diag-row"><span>Emplacement des données</span><b>${esc(origin)}</b></div>
    <div class="diag-row"><span>Version de l'appli</span><b>${APP_VERSION}</b></div>
    <div class="diag-row"><span>Projet Firebase</span><b>${esc(proj)}</b></div>
    <div class="diag-row"><span>Code de synchro</span><b>${esc(code)}</b></div>
    <div class="diag-row"><span>Synchro automatique</span><b>${auto}</b></div>
    <div class="diag-row"><span>KPIs partagés</span><b>${partKpis}</b></div>
    <div class="diag-row"><span>Variantes partagées</span><b>${partVar}</b></div>
    ${persoVar ? `<div class="diag-row"><span>KPIs personnels</span><b>${persoKpis}</b></div>
    <div class="diag-row"><span>Variantes personnelles</span><b>${persoVar}</b></div>` : ""}
    ${anomalies.length
      ? `<div class="diag-row" style="color:var(--gold)"><span>⚠️ Anomalies détectées</span><b>${anomalies.length}</b></div>`
      : `<div class="diag-row" style="color:var(--green)"><span>✓ Aucune anomalie</span><b>—</b></div>`}`;

  const box = document.getElementById("variantAnomalies");
  if (box) {
    if (!anomalies.length) { box.innerHTML = ""; box.style.display = "none"; }
    else {
      box.style.display = "";
      const hasDuplicates = anomalies.some(a => a.reason.includes("double"));
      box.innerHTML = `<p class="modal-hint" style="margin:8px 0 6px"><b>Fiches à vérifier :</b></p>` +
        anomalies.map(a =>
          `<div class="diag-anomaly">
             <b>${esc(a.title)}</b> — ${a.count} variantes
             <span>${esc(a.reason)}</span>
           </div>`).join("") +
        (hasDuplicates
          ? `<button type="button" id="cleanDupBtn" class="btn-primary" style="margin-top:10px;width:100%">
               🧹 Nettoyer les temporalités en double
             </button>`
          : "");
    }
  }

  const warn = document.getElementById("fileProtocolWarning");
  if (warn) warn.style.display = isFileProtocol() ? "" : "none";
}

// Repère les fiches dont le nombre de temporalités est anormal :
// doublons exacts de temporalité, fréquences non standard, ou plus de 3 variantes.
function findVariantAnomalies(list) {
  const byTitle = new Map();
  const rawTitles = new Map(); // clé normalisée → ensemble des orthographes exactes
  list.forEach(k => {
    const key = titleKey(k.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(k);
    if (!rawTitles.has(key)) rawTitles.set(key, new Set());
    rawTitles.get(key).add(k.title || "");
  });

  const anomalies = [];
  byTitle.forEach((variants, key) => {
    const freqs = variants.map(v => (v.freq || "").trim());
    const title = variants[0].title;

    const seen = {}, dups = [];
    freqs.forEach(f => { const l = f.toLowerCase(); if (seen[l]) dups.push(f || "(vide)"); seen[l] = true; });
    const nonStd = freqs.filter(f => !STD_FREQS.some(s => s.toLowerCase() === f.toLowerCase()));
    const variantesOrtho = rawTitles.get(key);

    if (variantesOrtho.size > 1) {
      anomalies.push({ title, count: variants.length, reason: `intitulés qui diffèrent (espaces/majuscules) : « ${[...variantesOrtho].join(" » / « ")} »` });
    } else if (dups.length) {
      anomalies.push({ title, count: variants.length, reason: `temporalité en double : ${[...new Set(dups)].join(", ")}` });
    } else if (nonStd.length) {
      anomalies.push({ title, count: variants.length, reason: `temporalité non standard : ${[...new Set(nonStd)].map(f => f || "(vide)").join(", ")}` });
    } else if (variants.length > STD_FREQS.length) {
      anomalies.push({ title, count: variants.length, reason: `plus de ${STD_FREQS.length} temporalités` });
    }
  });
  return anomalies;
}

/**
 * Nettoie les temporalités en double : pour chaque fiche, si une même
 * temporalité (ex. « Mensuelle ») apparaît plusieurs fois, on GARDE la
 * variante la plus récente (_mtime le plus grand) et on retire les autres.
 * Les fiches Excel supprimées reçoivent un marqueur (comme une suppression
 * normale) ; les fiches manuelles/perso sont retirées directement.
 * @returns {number} nombre de doublons retirés
 */
function cleanDuplicateVariants() {
  const all = [...data, ...personalEntries];
  const byTitle = new Map();
  all.forEach(k => {
    const key = titleKey(k.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(k);
  });

  const toRemove = []; // variantes en trop à supprimer
  byTitle.forEach(variants => {
    const perFreq = new Map(); // temporalité (minuscule) → variante gardée
    variants.forEach(v => {
      const f = (v.freq || "").trim().toLowerCase();
      const kept = perFreq.get(f);
      if (!kept) { perFreq.set(f, v); return; }
      // Doublon : on garde la plus récente, l'autre part
      const keepNew = (v._mtime || 0) >= (kept._mtime || 0);
      if (keepNew) { toRemove.push(kept); perFreq.set(f, v); }
      else         { toRemove.push(v); }
    });
  });

  if (!toRemove.length) return 0;

  let touchedShared = false, touchedPerso = false;
  toRemove.forEach(v => {
    const kind = classifyId(v.id);
    if (kind === "perso") {
      personalEntries = personalEntries.filter(k => k.id !== v.id);
      touchedPerso = true;
    } else { // fiche partagée
      markDeleted(v.id, v);
      touchedShared = true;
    }
    retirerDesFavoris([v.id]);
  });

  saveFavoritesLocalOnly();
  if (touchedPerso) savePersonalEntries();
  if (touchedShared) { saveOverrides(false); saveDeletedIds(false); saveManualEntries(false); }
  logActivity("delete", `${toRemove.length} doublon(s) de temporalité`, "nettoyage automatique");
  rebuildData(true);
  return toRemove.length;
}

function initSyncModal() {
  ensureBuiltinConfig();
  const cfg = getSyncConfig();
  const usingBuiltin = hasBuiltinConfig() &&
    cfg?.config?.projectId === BUILTIN_FIREBASE_CONFIG.projectId;

  document.getElementById("syncConfigInput").value = cfg?.config ? JSON.stringify(cfg.config, null, 2) : "";
  document.getElementById("syncCodeInput").value   = cfg?.code || "";
  document.getElementById("syncEnabledToggle").checked = !!cfg?.enabled;

  // Config intégrée : on masque la saisie JSON et on montre un bandeau rassurant
  const banner   = document.getElementById("builtinConfigBanner");
  const configRow = document.getElementById("syncConfigRow");
  const advToggle = document.getElementById("advancedSyncToggle");
  if (usingBuiltin) {
    banner.style.display   = "";
    configRow.style.display = "none";      // rien à saisir
    advToggle.style.display = "";           // possibilité de basculer en manuel
    advToggle.textContent   = "⚙️ Paramètres avancés (changer de projet)";
  } else {
    banner.style.display   = hasBuiltinConfig() ? "" : "none";
    configRow.style.display = "";
    advToggle.style.display = "none";
  }

  if (cfg && cfg.config && cfg.code) connectSync(false); else setSyncStatusUI("off");
  renderSyncDiag();
  renderSnapshotList();
}

// Bouton « Paramètres avancés » : révèle la saisie manuelle de config
document.getElementById("advancedSyncToggle")?.addEventListener("click", function () {
  const row = document.getElementById("syncConfigRow");
  const shown = row.style.display !== "none";
  row.style.display = shown ? "none" : "";
  this.textContent = shown ? "⚙️ Paramètres avancés (changer de projet)" : "▲ Masquer les paramètres avancés";
});

syncSettingsBtn?.addEventListener("click", () => {
  initSyncModal();
  syncModal.classList.remove("hidden");
});
closeSyncModalBtn?.addEventListener("click", () => syncModal.classList.add("hidden"));
syncModal?.addEventListener("click", e => { if (e.target === syncModal) syncModal.classList.add("hidden"); });

document.getElementById("connectSyncBtn")?.addEventListener("click", () => {
  let parsedConfig;
  try {
    parsedConfig = JSON.parse(document.getElementById("syncConfigInput").value.trim());
  } catch {
    return showToast("❌ Configuration invalide (JSON)", 3000);
  }
  const code = document.getElementById("syncCodeInput").value.trim();
  if (!code) return showToast("Choisissez un code de synchronisation", 2800);

  fbApp = null; fbDb = null; connectedSyncCode = null;
  localStorage.removeItem(LS_SYNC_OPTOUT); // reconnexion volontaire
  setSyncConfig({ config: parsedConfig, code, enabled: true });
  connectSync(true);
});

document.getElementById("syncEnabledToggle")?.addEventListener("change", function () {
  const c = getSyncConfig();
  if (!c) return;
  c.enabled = this.checked;
  setSyncConfig(c);
  if (c.enabled) {
    // Réactivation : on rétablit l'échange initial et l'écoute temps réel
    if (fbDb && c.code) {
      initialSync(c.code, false);
      listenForRemoteChanges(c.code);
      setSyncStatusUI("connected");
    } else {
      connectSync(false);
    }
    showToast("Synchronisation activée", 2200);
  } else {
    // Mise en pause : on coupe l'écoute (la connexion reste pour l'usage manuel)
    if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  couperEcouteEmpreintes();
    clearTimeout(syncDebounceHandle);
    setSyncStatusUI("connected");
    showToast("Synchronisation en pause", 2200);
  }
});

// La pilule de la barre du haut ouvre la modale de synchronisation
document.getElementById("syncPill")?.addEventListener("click", () => {
  initSyncModal();
  syncModal.classList.remove("hidden");
});

document.getElementById("pushSyncBtn")?.addEventListener("click", () => pushToCloud(true));
document.getElementById("pullSyncBtn")?.addEventListener("click", () => {
  if (confirm(
    "Remplacer les données de CET appareil par celles du cloud ?\n\n" +
    "Utile si cet appareil a de mauvaises données : le cloud fait autorité, " +
    "tout ce qui est ici sera écrasé (une sauvegarde automatique est prise avant)."
  )) pullFromCloud(true, true);   // true = remplacement réel
});
document.getElementById("disconnectSyncBtn")?.addEventListener("click", () => {
  if (confirm("Désactiver la synchronisation cloud sur cet appareil ?")) disconnectSync();
});

/* ============================================
   INSTANTANÉS DE SÉCURITÉ (historique local)
   Une copie est prise AVANT toute opération
   destructive (réception cloud, import, reset).
============================================ */
const LS_SNAPSHOTS = "kpiSnapshots";
const MAX_SNAPSHOTS = 10;
// Espacement minimal entre deux instantanés portant le même motif.
// Il était de 5 SECONDES : comme un instantané est pris avant chaque réception
// cloud, un collègue modifiant une fiche toutes les 6 secondes remplissait
// les 12 emplacements en une minute et demie. Les « 12 versions de sécurité »
// ne couvraient donc que ~66 secondes d'historique, pour 2,6 Mo de stockage.
const ESPACEMENT_SNAPSHOT_MS = 10 * 60 * 1000;   // 10 minutes

// Place maximale, en caractères, que l'ensemble de l'historique peut occuper.
// Un nombre fixe d'instantanés ne suffit pas : chaque instantané est une copie
// COMPLÈTE de l'annuaire, donc son poids grandit avec l'annuaire. Sur un
// annuaire de 56 000 caractères, 12 instantanés pèsent 1,3 Mo à eux seuls —
// soit un quart de toute la mémoire autorisée par le navigateur.
// Avec un budget, l'historique reste profond quand l'annuaire est petit et se
// resserre automatiquement quand il grossit.
const BUDGET_SNAPSHOTS = 250000;   // ≈ 500 Ko dans le navigateur (2 octets/caractère)
const MIN_SNAPSHOTS = 2;           // on garde toujours de quoi revenir en arrière

// Champs que les anciennes versions recopiaient dans chaque instantané et qui
// n'y ont plus leur place. `activityLog` à lui seul pouvait peser 140 Ko par
// instantané.
const CHAMPS_SNAPSHOT_OBSOLETES = ["activityLog", "excelData", "overrides", "kpiDataCache"];

// Étiquette « N KPIs · M variantes · P perso » pour un instantané.
// Gère les anciens formats : partagees, ou excel+manual, ou seulement manual.
function snapCountLabel(c) {
  if (!c) return "détail indisponible";
  if (c.kpis !== undefined || c.variantes !== undefined) {
    const kpis = c.kpis ?? "?";
    const varn = c.variantes ?? "?";
    const perso = c.perso ?? 0;
    return `${kpis} KPIs · ${varn} variantes${perso ? " · " + perso + " perso" : ""}`;
  }
  const partag = c.partagees ?? ((c.excel || 0) + (c.manual || 0));
  const perso = c.perso ?? 0;
  return `${partag} variantes partagées${perso ? " · " + perso + " perso" : ""}`;
}

function getSnapshots() {
  try { return JSON.parse(localStorage.getItem(LS_SNAPSHOTS)) || []; } catch { return []; }
}

/** Poids de l'historique tel qu'il occupe la mémoire du navigateur, en octets. */
function poidsSnapshots() {
  try { return (localStorage.getItem(LS_SNAPSHOTS) || "").length * 2; } catch { return 0; }
}

/**
 * ALLÈGE L'HISTORIQUE DÉJÀ STOCKÉ.
 *
 * Empêcher l'historique de regrossir ne suffisait pas : les instantanés
 * enregistrés par les versions précédentes restaient tels quels, chacun
 * transportant une copie complète du journal d'activité. Un appareil pouvait
 * donc conserver près de 2 Mo d'historique indéfiniment, puisqu'il faut
 * désormais plusieurs heures pour que dix nouveaux instantanés les remplacent.
 *
 * Trois passes, de la moins destructive à la plus :
 *   1. on retire les champs que plus rien ne lit (journal, vestiges Excel) ;
 *   2. on ramène le nombre d'instantanés au maximum autorisé ;
 *   3. on retire les plus anciens tant que le budget de place est dépassé,
 *      sans jamais descendre sous MIN_SNAPSHOTS.
 *
 * @returns {number} octets libérés
 */
function alegerInstantanes() {
  const avant = poidsSnapshots();
  if (!avant) return 0;

  let list = getSnapshots();
  if (!Array.isArray(list) || !list.length) return 0;

  // 1. Champs devenus inutiles dans chaque instantané
  list = list.map(s => {
    if (!s || typeof s !== "object") return s;
    const copie = { ...s };
    CHAMPS_SNAPSHOT_OBSOLETES.forEach(c => delete copie[c]);
    return copie;
  });

  // 2. Nombre maximum
  list = list.slice(0, MAX_SNAPSHOTS);

  // 3. Budget de place : on retire les plus anciens
  while (list.length > MIN_SNAPSHOTS && JSON.stringify(list).length > BUDGET_SNAPSHOTS) {
    list.pop();
  }

  try { localStorage.setItem(LS_SNAPSHOTS, JSON.stringify(list)); }
  catch { return 0; }

  const libere = avant - poidsSnapshots();
  if (libere > 0) {
    console.info(`[Nettoyage] Historique des versions allégé de ${(libere / 1024).toFixed(0)} Ko ` +
                 `(${list.length} version(s) conservée(s)).`);
  }
  return Math.max(0, libere);
}

/** Efface tout l'historique des versions, à la demande de l'utilisateur. */
function viderInstantanes() {
  const poids = poidsSnapshots();
  const nb = getSnapshots().length;
  if (!nb) { showToast("L'historique est déjà vide", 2400); return 0; }
  if (!confirm(
    `Vider l'historique des versions ?\n\n` +
    `${nb} version(s) enregistrée(s), ${(poids / 1024).toFixed(0)} Ko de mémoire.\n\n` +
    "Vos fiches, votre corbeille et vos favoris ne sont PAS touchés : seule la " +
    "possibilité de revenir à un état antérieur est perdue."
  )) return 0;
  try { localStorage.removeItem(LS_SNAPSHOTS); } catch { /* rien à faire */ }
  renderSnapshotList();
  showToast(`🧹 Historique vidé — ${(poids / 1024).toFixed(0)} Ko libérés`, 3000);
  return poids;
}

function pushSnapshot(reason) {
  try {
    const snap = {
      at: Date.now(),
      reason: reason || "sauvegarde",
      user: currentUser,
      counts: {
        // On compte le VISIBLE (hors corbeille), comme ce que voit l'utilisateur.
        kpis:      countFiches(data),
        variantes: data.length,
        persoKpis: countFiches(personalEntries),
        perso:     personalEntries.length
      },
      manualEntries, personalEntries,
      deletedIds, sites,
      purgedIds, meta: getMeta(),
      favorites,
      favoritesByUser: Store.readJSON(Store.KEYS.SYNC_FAV, {}) || {},
      favoritesMeta:   Store.readJSON(Store.KEYS.FAV_META, {}) || {}
      // `activityLog` n'est volontairement PAS recopié ici : le journal pèse
      // jusqu'à 140 Ko et se retrouvait dupliqué dans chacun des 12
      // instantanés, soit près de la MOITIÉ de toute la mémoire occupée par
      // l'application. Il se reconstitue de toute façon par fusion avec les
      // autres appareils, et une restauration ne doit pas effacer l'historique
      // des actions faites entre-temps.
    };
    const list = getSnapshots();
    // Espacement : au plus un instantané par tranche de 10 minutes pour un
    // même motif (voir ESPACEMENT_SNAPSHOT_MS).
    if (list.length && list[0].reason === snap.reason && snap.at - list[0].at < ESPACEMENT_SNAPSHOT_MS) return;
    list.unshift(snap);
    while (list.length > MAX_SNAPSHOTS) list.pop();
    // Budget de place : chaque instantané pèse le poids de l'annuaire entier,
    // un simple plafond de NOMBRE laisserait l'historique grossir avec lui.
    while (list.length > MIN_SNAPSHOTS && JSON.stringify(list).length > BUDGET_SNAPSHOTS) list.pop();
    try {
      localStorage.setItem(LS_SNAPSHOTS, JSON.stringify(list));
    } catch (e) {
      // Espace saturé : on réduit l'historique et on réessaie
      while (list.length > 3) { list.pop(); }
      try {
        localStorage.setItem(LS_SNAPSHOTS, JSON.stringify(list));
      } catch (err2) {
        console.error("[Instantanés] Stockage saturé : impossible d'enregistrer un instantané.", err2);
        if (typeof showToast === "function") showToast("⚠️ Stockage saturé — instantané non enregistré", 4000);
      }
    }
  } catch (e) { console.error("pushSnapshot:", e); }
}

function restoreSnapshot(index) {
  const list = getSnapshots();
  const s = list[index];
  if (!s) return;
  const d = new Date(s.at);
  if (!confirm(
    `Restaurer la version du ${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR").slice(0,5)} ?\n` +
    `(${snapCountLabel(s.counts)})\n\n` +
    "L'état actuel sera lui-même sauvegardé avant restauration.\n\n" +
    "⚠️ Cette restauration s'applique à CET APPAREIL. Les fiches partagées que " +
    "vos collègues ont modifiées depuis garderont leur version la plus récente. " +
    "Pour imposer cette version à tout le monde, utilisez ensuite « ⭐ Cet appareil fait référence »."
  )) return;

  pushSnapshot("avant restauration");

  if (Array.isArray(s.manualEntries))   manualEntries = s.manualEntries;
  if (Array.isArray(s.personalEntries)) personalEntries = s.personalEntries;
  if (Array.isArray(s.personalTrash))   personalTrash = s.personalTrash;
  // Compat : ancien instantané avec excelData/overrides → converti en fiches
  if (Array.isArray(s.excelData) && s.excelData.length) {
    const overr = (s.overrides && typeof s.overrides === "object") ? s.overrides : {};
    s.excelData.forEach(d => {
      const merged = overr[d.id] ? { ...d, ...overr[d.id] } : d;
      const id = "kpi_" + slugifyId(merged.title) + "_" + slugifyId(merged.freq);
      if (!manualEntries.some(m => m.id === id)) {
        manualEntries.push({ ...merged, id, manual: true, _mtime: merged._mtime || now() });
      }
    });
  }
  if (Array.isArray(s.deletedIds))      deletedIds = normalizeDeleted(s.deletedIds);
  if (Array.isArray(s.sites) && s.sites.length) sites = s.sites;
  // UNION, jamais remplacement : une suppression définitive ne se « défait »
  // pas par un retour en arrière local. Sinon la fiche revenait ici, puis
  // repartait vers le cloud et réapparaissait chez tout le monde.
  if (Array.isArray(s.purgedIds)) {
    purgedIds = [...new Set([...(purgedIds || []), ...s.purgedIds])];
    savePurged(false);
  }
  // Le journal d'activité n'est plus recopié dans les instantanés (voir
  // pushSnapshot) ; les anciens instantanés en contiennent encore un.
  if (Array.isArray(s.activityLog))     { activityLog = s.activityLog; saveActivity(false); }
  if (s.meta && typeof s.meta === "object") setMeta(s.meta);
  if (Array.isArray(s.favorites))       { favorites = s.favorites; }
  // Favoris des AUTRES utilisateurs : sans ça, le bloc partagé continuait de
  // désigner des fiches que la restauration venait de faire disparaître.
  if (s.favoritesByUser && typeof s.favoritesByUser === "object") {
    Store.writeJSON(Store.KEYS.SYNC_FAV, s.favoritesByUser);
    if (s.favoritesMeta && typeof s.favoritesMeta === "object") Store.writeJSON(Store.KEYS.FAV_META, s.favoritesMeta);
  }

  nettoyerPurgees();
  nettoyerMarqueursPurges();
  reparerCollisionsEspaces();
  saveManualEntries(false); savePersonalEntries(); savePersonalTrash();
  saveDeletedIds(false); saveSites(false);
  saveFavoritesLocalOnly();
  markLocalChange();     // cette version devient la plus récente
  rebuildData(true);     // et repart vers le cloud si la synchro est active
  renderSnapshotList();
  renderSyncDiag();
  showToast("↩ Version restaurée sur cet appareil", 3000);
}

function renderSnapshotList() {
  const el = document.getElementById("snapshotList");
  if (!el) return;
  const list = getSnapshots();
  // Poids affiché sous la liste : l'historique est le premier poste de mémoire
  // de l'application, autant que ce soit visible sans ouvrir le banc de test.
  const poids = document.getElementById("snapshotPoids");
  if (poids) {
    const ko = poidsSnapshots() / 1024;
    poids.textContent = list.length
      ? `${list.length} version(s) · ${ko.toFixed(0)} Ko de mémoire occupée.`
      : "";
  }
  const bouton = document.getElementById("viderSnapshotsBtn");
  if (bouton) bouton.style.display = list.length ? "" : "none";
  if (!list.length) {
    el.innerHTML = `<p class="modal-hint" style="margin:0">Aucune version enregistrée pour l'instant.</p>`;
    return;
  }
  el.innerHTML = "";
  list.forEach((s, i) => {
    const d = new Date(s.at);
    const row = document.createElement("div");
    row.className = "snap-row";
    row.innerHTML = `
      <div class="snap-info">
        <b>${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR").slice(0,5)}</b>
        <span>${esc(s.reason)} · ${snapCountLabel(s.counts)}</span>
      </div>
      <button type="button" class="btn-secondary snap-restore">↩ Restaurer</button>`;
    row.querySelector(".snap-restore").addEventListener("click", () => restoreSnapshot(i));
    el.appendChild(row);
  });
}

/* ============================================
   DÉPANNAGE : réinitialisation + sauvegarde locale
============================================ */

// Coupe tout lien cloud et efface la config (les KPIs locaux sont conservés)
function resetSyncCompletely() {
  if (!confirm(
    "Réinitialiser complètement la synchronisation ?\n\n" +
    "• Le lien avec le projet cloud actuel sera coupé\n" +
    "• La configuration enregistrée sera effacée\n" +
    "• Vos KPIs présents sur cet appareil sont CONSERVÉS\n\n" +
    "Vous pourrez ensuite reconnecter le bon projet."
  )) return;

  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  couperEcouteEmpreintes();
  fbApp = null; fbDb = null; connectedSyncCode = null;
  pendingPush = false;
  clearTimeout(syncDebounceHandle);
  localStorage.removeItem(LS_SYNC);
  localStorage.setItem(LS_SYNC_OPTOUT, "1"); // évite la réinstallation auto de la config intégrée
  localStorage.removeItem("kpiLocalUpdatedAt");
  localUpdatedAt = 0;
  lastSyncPushAt = 0; lastAppliedSyncAt = 0;
  setSyncStatusUI("off");
  renderSyncDiag();
  initSyncModal();
  showToast("🧨 Synchronisation réinitialisée", 3000);
}

// Exporte TOUTES les données locales dans un fichier JSON
function exportBackup() {
  const backup = {
    _format: "annuaire-kpi-backup",
    _version: 1,
    exportedAt: new Date().toISOString(),
    exportedFrom: isFileProtocol() ? "file://" : location.origin,
    user: currentUser,
    manualEntries, deletedIds, sites,
    personalEntries, personalTrash,   // la corbeille personnelle manquait à l'export
    purgedIds, activityLog, meta: getMeta(),
    favorites,                        // la liste de l'utilisateur courant manquait aussi
    favoritesMeta: Store.readJSON(Store.KEYS.FAV_META, {}) || {},
    favoritesByUser: Store.readJSON(Store.KEYS.SYNC_FAV, {}) || {}
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `annuaire-kpi-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("💾 Sauvegarde exportée", 2500);
}

// Exporte toutes les fiches partagées visibles dans un fichier Excel (.xlsx)
// RÉ-IMPORTABLE : mêmes colonnes que l'import, et les liens de chaque site
// sont posés comme hyperliens cliquables (c'est ce que l'import relit).
function exportExcel() {
  const rows = data.slice(); // fiches partagées visibles
  if (!rows.length) { showToast("Aucune fiche à exporter", 2600); return; }

  const siteList = activeSites();
  // En-têtes : colonnes fixes + une colonne par site (avec son nom lisible)
  const headers = ["Intitulé", "Type KPI", "Processus", "Fréquence", "Rituel", "Description / Mode de calcul",
                   ...siteList.map(s => s.name)];

  // Ordre lisible : regroupé par intitulé, puis Mensuelle → Hebdo → Quotidienne
  const freqRank = f => { const i = STD_FREQS.findIndex(s => s.toLowerCase() === (f || "").toLowerCase()); return i < 0 ? 99 : i; };
  rows.sort((a, b) => titleKey(a.title).localeCompare(titleKey(b.title)) || freqRank(a.freq) - freqRank(b.freq));

  // Construit la feuille cellule par cellule pour pouvoir poser les hyperliens
  const aoa = [headers, ...rows.map(k => [
    k.title || "", k.type || "", k.process || "", k.freq || "", k.ritual || "", k.desc || "",
    ...siteList.map(s => k[s.key] || "")   // texte = l'URL (et on ajoute l'hyperlien juste après)
  ])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Pose les hyperliens sur les colonnes de sites (l'import les relit via cell.l.Target)
  const firstSiteCol = 6; // 0-based : après les 6 colonnes fixes
  rows.forEach((k, ri) => {
    siteList.forEach((s, si) => {
      const url = k[s.key];
      if (!url) return;
      const addr = XLSX.utils.encode_cell({ r: ri + 1, c: firstSiteCol + si }); // +1 pour l'en-tête
      if (ws[addr]) { ws[addr].l = { Target: url, Tooltip: s.name }; ws[addr].v = url; }
    });
  });

  // Largeurs de colonnes agréables
  ws["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 13 }, { wch: 18 }, { wch: 40 },
                 ...siteList.map(() => ({ wch: 30 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "KPIs");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `annuaire-kpi-export-${stamp}.xlsx`);
  showToast(`📊 Export Excel : ${rows.length} ligne(s)`, 2800);
}

// Restaure une sauvegarde JSON (remplace les données de cet appareil)
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let b;
    try { b = JSON.parse(reader.result); }
    catch { showToast("❌ Fichier illisible", 3000); return; }
    if (!b || b._format !== "annuaire-kpi-backup") {
      showToast("❌ Ce fichier n'est pas une sauvegarde de l'annuaire", 3200); return;
    }
    if (!confirm(
      `Restaurer la sauvegarde du ${(b.exportedAt || "").slice(0, 10)} ` +
      `(${(b.manualEntries?.length || 0)} fiche(s)) ?\n\n` +
      "Le contenu de la sauvegarde est FUSIONNÉ avec les données actuelles :\n" +
      "• les fiches de la sauvegarde absentes ici sont ajoutées ;\n" +
      "• pour une fiche présente des deux côtés, la version la plus récente est gardée ;\n" +
      "• les suppressions définitives restent définitives.\n\n" +
      "Rien de ce que vos collègues ont fait depuis ne sera effacé."
    )) return;

    pushSnapshot("avant import de sauvegarde");

    // FUSION et non remplacement.
    // Avant, l'import écrasait les fiches, la corbeille ET les suppressions
    // définitives, puis renvoyait le tout au cloud : les fiches supprimées
    // depuis la sauvegarde ressuscitaient pour toute l'équipe, et les fiches
    // créées entre-temps disparaissaient.
    if (Array.isArray(b.manualEntries))   manualEntries = mergeEntries(manualEntries, b.manualEntries);
    if (Array.isArray(b.personalEntries)) personalEntries = mergeEntries(personalEntries, b.personalEntries);
    if (Array.isArray(b.personalTrash))   personalTrash = mergePersonalTrash(personalTrash, b.personalTrash);
    // Compat : ancienne sauvegarde avec excelData/overrides → fiches
    if (Array.isArray(b.excelData) && b.excelData.length) {
      const overr = (b.overrides && typeof b.overrides === "object") ? b.overrides : {};
      b.excelData.forEach(d => {
        const merged = overr[d.id] ? { ...d, ...overr[d.id] } : d;
        const id = "kpi_" + slugifyId(merged.title) + "_" + slugifyId(merged.freq);
        if (!manualEntries.some(m => m.id === id)) {
          manualEntries.push({ ...merged, id, manual: true, _mtime: merged._mtime || now() });
        }
      });
    }
    if (Array.isArray(b.deletedIds))      deletedIds = mergeDeleted(deletedIds, normalizeDeleted(b.deletedIds));
    // Union : une suppression définitive ne se défait jamais par un import.
    if (Array.isArray(b.purgedIds))       { purgedIds = [...new Set([...(purgedIds || []), ...b.purgedIds])]; savePurged(false); }
    if (Array.isArray(b.activityLog))     { activityLog = mergeActivity(activityLog, b.activityLog, MAX_ACTIVITY); saveActivity(false); }
    if (b.meta && typeof b.meta === "object") setMeta(b.meta);
    if (b.favoritesMeta) Store.writeJSON(Store.KEYS.FAV_META, b.favoritesMeta);
    if (Array.isArray(b.sites) && b.sites.length) sites = b.sites;
    if (b.favoritesByUser) {
      Store.writeJSON(Store.KEYS.SYNC_FAV, b.favoritesByUser);
      if (b.favoritesByUser[currentUser]) favorites = b.favoritesByUser[currentUser];
    }
    // `favorites` a longtemps été absent des sauvegardes (seul le bloc partagé
    // était exporté, et il reste vide tant qu'aucun envoi n'a eu lieu).
    if (Array.isArray(b.favorites) && b.favorites.length) favorites = b.favorites;

    nettoyerPurgees();
    nettoyerMarqueursPurges();
    reparerCollisionsEspaces();
    appliquerCorbeillePerso();
    nettoyerFavoris();
    saveManualEntries(false); savePersonalEntries(); savePersonalTrash();
    saveDeletedIds(false); saveSites(false); saveFavoritesLocalOnly();
    markLocalChange();          // la restauration devient la version la plus récente
    rebuildData(true);          // ré-envoie vers le cloud si la synchro est active
    renderSyncDiag();
    showToast("✅ Sauvegarde fusionnée avec vos données", 3000);
  };
  reader.readAsText(file);
}

// Inspecte un KPI par son intitulé : montre, pour chaque temporalité,
// quels sites ont un lien enregistré. Sert à diagnostiquer un lien manquant
// (ex. MG absent sur un appareil).
function inspectKpi(query) {
  const box = document.getElementById("inspectKpiResult");
  if (!box) return;
  const q = (query || "").trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ""; return; }

  // On inspecte tout : visibles ET supprimées (corbeille), partagées ET perso.
  const deletedSet = new Set(deletedIds.filter(d => d.state !== "restored").map(d => d.id));
  const tagged = [
    ...manualEntries.map(k => ({ ...k, _space: "partagé", _del: deletedSet.has(k.id) })),
    ...personalEntries.map(k => ({ ...k, _space: "perso", _del: false })),
    ...personalTrash.map(k => ({ ...k, _space: "perso", _del: true }))
  ];
  const matches = tagged.filter(k => (k.title || "").toLowerCase().includes(q));
  if (!matches.length) {
    box.innerHTML = `<p class="modal-hint" style="margin:6px 0">Aucun KPI trouvé pour « ${esc(query)} ».</p>`;
    return;
  }

  const byTitle = new Map();
  matches.forEach(k => {
    const key = k._space + "|" + titleKey(k.title);
    if (!byTitle.has(key)) byTitle.set(key, { title: k.title, space: k._space, variants: [] });
    byTitle.get(key).variants.push(k);
  });

  const fmtWhen = t => t ? new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  let html = "";
  byTitle.forEach(g => {
    // Détecte les temporalités en double dans cette fiche
    const freqCount = {};
    g.variants.forEach(v => { const f = (v.freq || "").toLowerCase().trim(); freqCount[f] = (freqCount[f] || 0) + 1; });
    const dupFreqs = Object.entries(freqCount).filter(([, n]) => n > 1).map(([f]) => f);

    const visibles = g.variants.filter(v => !v._del).length;
    const badge = g.space === "perso" ? "🔒 perso" : "partagé";
    html += `<div class="inspect-fiche">
      <b>${esc(g.title)}</b>
      <span class="inspect-badge">${badge} · ${visibles}/${g.variants.length} visible(s)</span>`;

    if (dupFreqs.length) {
      html += `<div class="inspect-warn">⚠️ Temporalité en double : ${dupFreqs.map(f => esc(f || "(vide)")).join(", ")}</div>`;
    }

    g.variants.forEach(v => {
      const linkDetails = activeSites().map(s => {
        const url = v[s.key];
        return url
          ? `<span class="inspect-link-ok" title="${esc(url)}">${esc(s.name)} ✓</span>`
          : `<span class="inspect-link-no">${esc(s.name)} ✗</span>`;
      }).join(" ");
      html += `<div class="inspect-temp ${v._del ? "inspect-deleted" : ""}">
        <div class="inspect-line1">
          <span class="inspect-freq">${esc(v.freq || "sans temporalité")}</span>
          ${v._del ? `<span class="inspect-trash">🗑 corbeille</span>` : ""}
        </div>
        <div class="inspect-links">${linkDetails}</div>
        <div class="inspect-meta">modifié ${fmtWhen(v._mtime)}${v._by ? " par " + esc(v._by) : ""} · <code>${esc(v.id)}</code></div>
      </div>`;
    });
    html += `</div>`;
  });
  box.innerHTML = html;
}

document.getElementById("inspectKpiInput")?.addEventListener("input", function () {
  inspectKpi(this.value);
});

document.getElementById("resetSyncBtn")?.addEventListener("click", resetSyncCompletely);

// Interrupteur de synchronisation de l'espace personnel
document.getElementById("personalSyncToggle")?.addEventListener("change", function () {
  localStorage.setItem(LS_PERSO_SYNC, this.checked ? "1" : "0");
  if (this.checked) {
    // On (re)publie son espace sous son nom
    savePersonalEntries(); savePersonalTrash();
    showToast("✅ Vos KPIs personnels vous suivront sur vos appareils", 3200);
  } else {
    // On retire son bloc du document partagé, sans toucher aux données locales
    scheduleAutoSync();
    showToast("🔒 Vos KPIs personnels restent sur cet appareil", 3200);
  }
  renderSyncDiag();
});

// Test de connexion en direct : écrit puis relit une valeur dans Firestore.
// Affiche précisément ce qui bloque (config absente, Firebase non chargé,
// règles refusées, hors-ligne…). Indispensable pour diagnostiquer le mobile.
document.getElementById("testCloudBtn")?.addEventListener("click", async () => {
  const box = document.getElementById("cloudTestResult");
  if (!box) return;
  box.style.display = "";
  const line = (ok, txt) => `<div class="diag-row"><span>${ok ? "✓" : "✗"} ${esc(txt)}</span><b>${ok ? "OK" : "ÉCHEC"}</b></div>`;
  let html = "";

  // 1. Firebase chargé ?
  const fbLoaded = typeof firebase !== "undefined";
  html += line(fbLoaded, "Librairie Firebase chargée");
  if (!fbLoaded) { box.innerHTML = html + `<p class="modal-hint">La librairie ne s'est pas chargée : vérifiez la connexion Internet, ou un bloqueur qui empêcherait gstatic.com.</p>`; return; }

  // 2. Pas en file:// ?
  html += line(!isFileProtocol(), "Ouvert via une adresse web (pas file://)");
  if (isFileProtocol()) { box.innerHTML = html + `<p class="modal-hint">En mode fichier local, la synchro est impossible. Ouvrez l'adresse https.</p>`; return; }

  // 3. Config présente ?
  const cfg = getSyncConfig();
  const hasCfg = !!(cfg && cfg.config && cfg.config.projectId && cfg.code);
  html += line(hasCfg, "Configuration Firebase présente");
  if (!hasCfg) { box.innerHTML = html + `<p class="modal-hint"><b>C'est probablement ça :</b> aucune configuration Firebase sur cet appareil. Ouvrez « Paramètres avancés » et saisissez la même config + le même code que sur l'autre appareil.</p>`; return; }

  // 4. Écriture + lecture réelle
  box.innerHTML = html + `<p class="modal-hint">Test d'écriture en cours…</p>`;
  try {
    if (!fbApp) { fbApp = firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(cfg.config); fbDb = firebase.firestore(); }
    const testRef = fbDb.collection("kpi_sync").doc(cfg.code + "__conntest");
    const token = "t" + Date.now();
    await testRef.set({ token, at: Date.now() });
    const snap = await testRef.get();
    const readBack = snap.exists && snap.data().token === token;
    html += line(true, "Écriture dans le cloud");
    html += line(readBack, "Relecture depuis le cloud");

    // 5. Le document principal existe-t-il ?
    const mainSnap = await syncDocRef(cfg.code).get();
    const exists = mainSnap.exists;
    const count = exists ? (mainSnap.data().kpiManual?.length || 0) : 0;
    html += `<div class="diag-row"><span>Document principal (code ${esc(cfg.code)})</span><b>${exists ? count + " fiches" : "VIDE"}</b></div>`;
    box.innerHTML = html + (exists
      ? `<p class="modal-hint">✅ Connexion parfaite. Le cloud contient ${count} fiche(s). « Récupérer » va les charger.</p>`
      : `<p class="modal-hint">⚠️ Connexion OK mais le cloud est VIDE pour le code « ${esc(cfg.code)} ». Depuis l'appareil qui a les bonnes données, utilisez « ⭐ Cet appareil fait référence ».</p>`);
  } catch (err) {
    html += line(false, "Écriture/lecture cloud");
    const msg = (err && err.code === "permission-denied")
      ? "Refusé par les règles Firestore. Vos règles ont peut-être expiré (mode test) — republiez-les."
      : (err && err.message) || "Erreur inconnue";
    box.innerHTML = html + `<p class="modal-hint"><b>Erreur :</b> ${esc(msg)}</p>`;
  }
});

// « Cet appareil fait référence » : écrase le cloud avec l'état local.
// Sert à trancher quand les appareils divergent. Toutes les fiches locales
// sont réestampillées « maintenant » pour gagner tout arbitrage futur.
document.getElementById("viderSnapshotsBtn")?.addEventListener("click", viderInstantanes);

document.getElementById("forceMasterBtn")?.addEventListener("click", async () => {
  const cfg = getSyncConfig();
  if (!cfg || !fbDb) { showToast("⚠️ Synchronisation non connectée", 3000); return; }
  const nb = manualEntries.filter(d => !isDeleted(d.id) && !isPurged(d.id)).length;
  if (!confirm(
    `Faire de CET appareil la référence ?\n\n` +
    `Ses ${nb} fiche(s) partagées vont ÉCRASER les données du cloud.\n` +
    `Les autres appareils recevront cette version à leur prochaine synchro.\n\n` +
    `À n'utiliser que depuis l'appareil qui a les BONNES données.`
  )) return;

  const t = now();
  manualEntries.forEach(k => { k._mtime = t; });
  sites.forEach(s => { s._mtime = t; });
  saveManualEntries(false);
  saveSites(false);
  try {
    await pushToCloud(true, true);   // forcer : c'est le seul chemin qui écrase sans refusionner
    showToast("⭐ Cloud écrasé avec les données de cet appareil", 3500);
  } catch (err) {
    showToast("❌ Échec de l'envoi", 3000);
  }
});

// Bouton « Nettoyer les doublons » : recréé à chaque diagnostic, on écoute
// donc le conteneur parent plutôt que le bouton lui-même.
document.getElementById("variantAnomalies")?.addEventListener("click", e => {
  if (e.target && e.target.id === "cleanDupBtn") {
    const anomalies = findVariantAnomalies([...data, ...personalEntries]);
    const dups = anomalies.filter(a => a.reason.includes("double"));
    if (!confirm(
      `Nettoyer les temporalités en double sur ${dups.length} fiche(s) ?\n\n` +
      "Pour chaque temporalité présente en double, la version la plus récente est " +
      "conservée et les autres sont retirées (récupérables dans la corbeille).\n\n" +
      "Vos fiches et leurs liens ne sont pas perdus."
    )) return;
    const n = cleanDuplicateVariants();
    renderSyncDiag();
    showToast(n ? `🧹 ${n} doublon(s) retiré(s)` : "Aucun doublon à nettoyer", 3000);
  }
});
document.getElementById("exportBackupBtn")?.addEventListener("click", exportBackup);
document.getElementById("exportExcelBtn")?.addEventListener("click", exportExcel);
document.getElementById("importBackupBtn")?.addEventListener("click", () => {
  document.getElementById("backupFileInput").click();
});
document.getElementById("backupFileInput")?.addEventListener("change", function () {
  if (this.files && this.files[0]) importBackup(this.files[0]);
  this.value = "";
});

/* ============================================
   SÉLECTIONS DE RITUEL & GÉNÉRATION DU POWERPOINT
   --------------------------------------------
   Trois briques, dans cet ordre :
     1. cocher des KPI (mode sélection)
     2. enregistrer / recharger cette sélection (partagée)
     3. produire le PowerPoint aux couleurs IDEA

   La logique pure vit dans js/selection.js et js/pptx.js ;
   ici on ne fait que la relier à la page et au stockage.
============================================ */

const LS_PRESETS = "kpiPresets";
const LS_EMPREINTES = "kpiEmpreintes";
let modeleDeckCache = null;   // modele-deck.pptx, chargé une seule fois

/* ─── Empreintes de visuels ───────────────────────────────
   Le complément Power BI ne relit pas l'adresse à l'ouverture : il
   restaure ce qu'il avait mémorisé lors de l'insertion. Un support
   fabriqué sans cette mémoire affiche « l'objet visuel n'existe plus ».
   On la relève une fois, sur un PowerPoint où l'insertion a été faite
   à la main, et on la rejoue ensuite à volonté.

   Elles vivent dans un document de synchronisation SÉPARÉ : l'état
   sérialisé pèse ~5 Ko par visuel, et le document principal est
   plafonné à 1 Mo côté Firestore. */

function loadEmpreintes() {
  const brut = Store.readJSON(LS_EMPREINTES, []) || [];
  empreintes = (Array.isArray(brut) ? brut : []).map(e => Empreintes.normaliserEmpreinte(e));
}

/**
 * Empreintes livrées avec l'annuaire (`empreintes-livrees.json`).
 *
 * Relever une empreinte suppose une insertion manuelle dans PowerPoint :
 * autant ne la demander à personne quand elle a déjà été faite. Le
 * fichier est donc déposé à côté d'index.html, et chargé au démarrage.
 *
 * Il ne fait que COMBLER : ce qui est déjà connu localement ou partagé
 * par l'équipe l'emporte, et le fichier ne peut donc jamais écraser un
 * relevé plus récent. Son absence n'est pas une erreur.
 *
 * @returns {Promise<number>} nombre d'empreintes ajoutées
 */
async function chargerEmpreintesLivrees() {
  let liste;
  try {
    const rep = await fetch("./empreintes-livrees.json", { cache: "no-cache" });
    if (!rep.ok) return 0;
    const brut = await rep.json();
    liste = Array.isArray(brut) ? brut
          : (brut && Array.isArray(brut.kpiEmpreintes)) ? brut.kpiEmpreintes : null;
  } catch (err) {
    return 0;   // pas de fichier, hors ligne, JSON illisible : sans conséquence
  }
  if (!liste || !liste.length) return 0;

  const valides = liste
    .filter(e => e && e.id && e.proprietes)
    .map(e => Empreintes.normaliserEmpreinte(e))
    .filter(e => Empreintes.empreinteComplete(e));
  if (!valides.length) return 0;

  const avant = new Set(empreintes.map(e => e.id));
  // L'ordre compte : ce qui est déjà là passe en premier et l'emporte.
  empreintes = Empreintes.fusionnerEmpreintes(empreintes, valides);
  const ajoutees = empreintes.filter(e => !avant.has(e.id)).length;
  if (ajoutees) {
    ecrireDonnees(LS_EMPREINTES, empreintes);
    renderDeckLignes();
  }
  return ajoutees;
}

function saveEmpreintes(sync = true) {
  ecrireDonnees(LS_EMPREINTES, empreintes);
  if (sync) pousserEmpreintes();
}

/* Empreintes ENGENDRÉES : recomposées à partir des empreintes relevées,
   elles ne durent que la session. On ne les enregistre pas et on ne les
   partage pas — 156 états de 5 Ko feraient éclater le document commun,
   et il est de toute façon plus sûr de les recalculer que de les voir
   vieillir. */
let empreintesDerivees = {};

/** Toutes les variantes de l'annuaire qui portent un lien Power BI. */
function variantesAvecLien() {
  const sites = activeSites();
  const out = [];
  [...data, ...personalEntries].forEach(kpi => {
    sites.forEach(site => {
      const lien = kpi[site.key];
      if (typeof lien === "string" && lien) {
        out.push({ kpiId: kpi.id, titre: kpi.title || "", freq: kpi.freq || "",
                   site: site.key, lien });
      }
    });
  });
  return out;
}

/**
 * Ce qui distingue deux valeurs d'un même axe — une zone, une
 * temporalité — appris sur deux empreintes RÉELLES qui ne diffèrent
 * que par cet axe.
 *
 * On n'invente aucune valeur : on relève ce que Power BI a écrit d'un
 * côté et de l'autre, et on le rejoue ailleurs.
 *
 * Une leçon ne vaut QUE sur la page de rapport où elle a été apprise :
 * les conteneurs sont identifiés page par page, et rejouer ceux d'une
 * page sur une autre n'ajouterait que du bruit. La clé porte donc la
 * page en tête.
 *
 * @returns {Promise<Object>} { "rapport/page|site:a→b": transformation, … }
 */
async function axesDerivation() {
  const variantes = variantesAvecLien();
  const parLien = new Map(variantes.map(v => [Empreintes.cleVisuel(v.lien), v]));
  const connues = empreintes
    .filter(e => e.proprietes && e.proprietes.bookmark && parLien.has(e.id))
    .map(e => ({ emp: e, v: parLien.get(e.id) }));

  const axes = {};
  for (let i = 0; i < connues.length; i++) {
    for (let j = 0; j < connues.length; j++) {
      if (i === j) continue;
      const a = connues[i], b = connues[j];
      /* Même page, sinon les conteneurs ne parlent pas de la même chose. */
      const page = Empreintes.pageDeCle(a.emp.id);
      if (!page || page !== Empreintes.pageDeCle(b.emp.id)) continue;
      // Deux empreintes ne servent d'exemple que si UN SEUL axe les sépare.
      const memeTitre = a.v.titre === b.v.titre;
      const memeSite = a.v.site === b.v.site;
      const memeFreq = a.v.freq === b.v.freq;
      /* Trois axes : l'intitulé — le KPI retenu, celui qui change le
         graphique —, la zone et la temporalité. Un exemple ne vaut que
         si UN SEUL axe sépare ses deux termes ; autrement on apprendrait
         un mélange, et on le rejouerait à tort ailleurs. */
      const axe = memeTitre && memeFreq && !memeSite ? "site"
                : memeTitre && memeSite && !memeFreq ? "freq"
                : memeSite && memeFreq && !memeTitre ? "titre" : "";
      if (!axe) continue;
      const cle = page + "|" + axe + ":"
                + (axe === "site" ? a.v.site + "→" + b.v.site
                 : axe === "freq" ? a.v.freq + "→" + b.v.freq
                                  : a.v.titre + "→" + b.v.titre);
      if (axes[cle]) continue;
      try {
        /* Le visuel de l'exemple est passé : son conteneur ne sera pas
           recopié mais traduit en substitution de colonne, ce qui rend
           la leçon transposable à un autre visuel. */
        const t = Derivation.transformation(
          await Derivation.lireEtat(a.emp.proprietes.bookmark),
          await Derivation.lireEtat(b.emp.proprietes.bookmark),
          a.emp.id.split("/")[2]);
        /* Une leçon creuse vient de deux étiquettes posées sur la MÊME vue :
           l'une des deux est fausse. L'apprendre reviendrait à rendre la vue
           de départ sous un autre nom — l'erreur même qu'on traque. */
        if (!Derivation.estVide(t)) axes[cle] = t;
      } catch (err) { /* état illisible : on passe */ }
    }
  }
  return axes;
}

/**
 * Recompose les empreintes manquantes à partir de celles qu'on a.
 * @returns {Promise<{engendrees:number, restantes:number}>}
 */
async function engendrerEmpreintes() {
  empreintesDerivees = {};
  const variantes = variantesAvecLien();
  const axes = await axesDerivation();
  if (!Object.keys(axes).length) {
    return { engendrees: 0, restantes: variantes.filter(v => !Empreintes.trouver(empreintes, v.lien)).length };
  }

  const parCle = new Map(empreintes
    .filter(e => e.proprietes && e.proprietes.bookmark)
    .map(e => [e.id, e]));
  const varianteDe = new Map(variantes.map(v => [Empreintes.cleVisuel(v.lien), v]));

  let engendrees = 0, restantes = 0;
  for (const cible of variantes) {
    const cle = Empreintes.cleVisuel(cible.lien);
    if (!cle || parCle.has(cle)) continue;

    /* Une base, et le chemin le plus court pour l'amener à la cible :
       moins on transforme, moins on risque de se tromper.
       La base doit vivre sur la MÊME page de rapport que la cible :
       hors de sa page, un conteneur ne désigne plus rien. */
    const page = Empreintes.pageDeCle(cle);
    const lecon = axe => axes[page + "|" + axe];
    const candidats = [...parCle.values()]
      .map(e => ({ emp: e, v: varianteDe.get(e.id) }))
      .filter(x => x.v && Empreintes.pageDeCle(x.emp.id) === page)
      .map(x => ({
        base: x,
        etapes: [
          x.v.titre !== cible.titre ? lecon("titre:" + x.v.titre + "→" + cible.titre) : null,
          x.v.site !== cible.site ? lecon("site:" + x.v.site + "→" + cible.site) : null,
          x.v.freq !== cible.freq ? lecon("freq:" + x.v.freq + "→" + cible.freq) : null
        ],
        manquant: [
          x.v.titre !== cible.titre && !lecon("titre:" + x.v.titre + "→" + cible.titre),
          x.v.site !== cible.site && !lecon("site:" + x.v.site + "→" + cible.site),
          x.v.freq !== cible.freq && !lecon("freq:" + x.v.freq + "→" + cible.freq)
        ].some(Boolean)
      }))
      .filter(c => !c.manquant)
      .map(c => ({ base: c.base, chemin: c.etapes.filter(Boolean) }))
      .sort((a, b) => a.chemin.length - b.chemin.length);

    /* Deux axes qui touchent les mêmes segments s'annuleraient l'un
       l'autre : on préfère annoncer « à relever » qu'une vue fausse. */
    const retenu = candidats.find(c => !c.chemin.some((t, i) =>
      c.chemin.slice(i + 1).some(u => Derivation.seChevauchent(t, u))));
    if (!retenu) { restantes++; continue; }
    const base = retenu.base;
    const chemin = retenu.chemin;

    try {
      const etat = Derivation.appliquerToutes(
        await Derivation.lireEtat(base.emp.proprietes.bookmark), chemin,
        cle.split("/")[2]);   // le visuel VISÉ reçoit les substitutions
      const valeur = await Derivation.ecrireEtat(etat);
      const props = Object.assign({}, Empreintes.proprietesPour(base.emp),
        { bookmark: valeur, initialStateBookmark: valeur });
      delete props.artifactName;   // il nommerait la vue d'origine
      empreintesDerivees[cle] = { id: cle, libelle: cible.titre, proprietes: props, _derivee: true };
      engendrees++;
    } catch (err) { restantes++; }
  }
  return { engendrees, restantes };
}

/**
 * Ce qui sera posé pour ce lien : son empreinte, ou celle d'un voisin de
 * la même page. L'état sérialisé étant un état de PAGE, une insertion
 * manuelle par page suffit à couvrir tous ses KPI.
 * @returns {{proprietes:Object, empreinte:Object, emprunt:boolean}|null}
 */
function empreintePour(lien) {
  const exacte = Empreintes.resoudre(empreintes, lien);
  if (exacte) return exacte;
  const derivee = empreintesDerivees[Empreintes.cleVisuel(lien)];
  return derivee
    ? { proprietes: Empreintes.proprietesPour(derivee), empreinte: derivee, derivee: true }
    : null;
}

function loadPresets() {
  const brut = Store.readJSON(LS_PRESETS, []) || [];
  presets = (Array.isArray(brut) ? brut : []).map(p => Selection.normaliserPreset(p));
  // La liste déroulante doit être remplie dès l'ouverture de session : sans
  // cela, les sélections enregistrées n'apparaissaient qu'après en avoir
  // créé une nouvelle dans la même session.
  remplirListePresets();
}

function savePresets(sync = true) {
  ecrireDonnees(LS_PRESETS, presets);
  if (sync) scheduleAutoSync();
}

/* ─── Mode sélection ─────────────────────────────────────── */

function basculerModeSelection(actif) {
  selectionMode = actif === undefined ? !selectionMode : !!actif;
  const barre = document.getElementById("selectionBar");
  if (barre) barre.classList.toggle("hidden", !selectionMode);
  const bouton = document.getElementById("selectionModeBtn");
  if (bouton) bouton.classList.toggle("actif", selectionMode);
  if (selectionMode) remplirListePresets();
  document.body.classList.toggle("mode-selection", selectionMode);
  majBarreSelection();
  filterData();
  return selectionMode;
}

/** Coche ou décoche une variante. L'ORDRE d'ajout est conservé : c'est
    l'ordre de passage du rituel, donc l'ordre des diapositives. */
function basculerSelection(id) {
  if (!id) return selectionIds.slice();
  const i = selectionIds.indexOf(id);
  if (i >= 0) selectionIds.splice(i, 1);
  else selectionIds.push(id);
  majBarreSelection();
  filterData();
  return selectionIds.slice();
}

/** Coche toutes les variantes actuellement affichées (filtre en cours). */
function cocherResultatsFiltres() {
  let ajoutes = 0;
  dernierRendu.forEach(g => {
    const id = groupSel[g.key] || (g.variants[0] && g.variants[0].id);
    if (id && !selectionIds.includes(id)) { selectionIds.push(id); ajoutes++; }
  });
  majBarreSelection();
  filterData();
  showToast(ajoutes ? `✅ ${ajoutes} KPI ajouté(s) à la sélection` : "Tout est déjà sélectionné", 2400);
  return ajoutes;
}

function viderSelection() {
  selectionIds = [];
  presetCourant = "";
  majBarreSelection();
  filterData();
  return 0;
}

/** Déplace une ligne de la sélection (ordre du jour). */
function deplacerSelection(id, sens) {
  const i = selectionIds.indexOf(id);
  const j = i + (sens < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= selectionIds.length) return selectionIds.slice();
  selectionIds.splice(j, 0, selectionIds.splice(i, 1)[0]);
  renderDeckLignes();
  filterData();
  return selectionIds.slice();
}

function majBarreSelection() {
  const n = selectionIds.length;
  const compteur = document.getElementById("selectionCount");
  if (compteur) compteur.textContent = n === 0 ? "Aucun KPI sélectionné"
    : `${n} KPI sélectionné${n > 1 ? "s" : ""}`;
  const btn = document.getElementById("deckBtn");
  if (btn) btn.disabled = n === 0;
  return n;
}

/* ─── Sélections enregistrées ────────────────────────────── */

/** La sélection en cours, sous forme de sélection enregistrable. */
function selectionCourante(nom) {
  const existante = presets.find(p => p.id === presetCourant);
  return Selection.normaliserPreset({
    id: existante ? existante.id : undefined,
    name: nom || (existante && existante.name) || "Sélection",
    defaultSite: existante ? existante.defaultSite : "",
    items: selectionIds.map(id => {
      const ancienne = existante && existante.items.find(it => it.kpiId === id);
      return { kpiId: id, site: ancienne ? ancienne.site : "", commentaire: ancienne ? ancienne.commentaire : "" };
    }),
    _mtime: now(),
    _by: currentUser || "?"
  });
}

/**
 * Enregistre la sélection courante sous un nom.
 * Un nom déjà utilisé met à jour la sélection existante : on ne
 * multiplie pas les doublons « COPIL », « COPIL (2) »…
 */
function enregistrerSelection(nom) {
  const propre = String(nom || "").trim();
  if (!propre) { showToast("Donnez un nom à la sélection", 2600); return null; }
  if (!selectionIds.length) { showToast("La sélection est vide", 2600); return null; }

  const id = "preset_" + Selection.slug(propre);
  const existante = presets.find(p => p.id === id);
  const preset = Selection.normaliserPreset({
    id,
    name: propre,
    defaultSite: existante ? existante.defaultSite : "",
    items: selectionIds.map(kpiId => {
      const anc = existante && existante.items.find(it => it.kpiId === kpiId);
      return { kpiId, site: anc ? anc.site : "", commentaire: anc ? anc.commentaire : "" };
    }),
    _mtime: now(),
    _by: currentUser || "?"
  });

  presets = presets.filter(p => p.id !== id).concat([preset]);
  presetCourant = id;
  savePresets();
  remplirListePresets();
  logActivity("update", propre, `sélection de ${preset.items.length} KPI`);
  saveActivity();
  showToast(`💾 Sélection « ${propre} » enregistrée`, 2800);
  return preset;
}

function chargerSelection(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) { showToast("Sélection introuvable", 2600); return null; }
  const connus = new Set([...data, ...personalEntries].map(k => k && k.id));
  const vivants = preset.items.filter(it => connus.has(it.kpiId));
  const perdus = preset.items.length - vivants.length;

  selectionIds = vivants.map(it => it.kpiId);
  presetCourant = preset.id;
  if (!selectionMode) basculerModeSelection(true);
  majBarreSelection();
  filterData();
  showToast(perdus
    ? `📋 « ${preset.name} » chargée — ${perdus} KPI n'existe(nt) plus`
    : `📋 Sélection « ${preset.name} » chargée`, 3000);
  return selectionIds.slice();
}

function supprimerSelection(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return false;
  if (!confirm(`Supprimer la sélection « ${preset.name} » ?\n\nLes KPI eux-mêmes ne sont pas touchés.`)) return false;
  presets = presets.filter(p => p.id !== id);
  if (presetCourant === id) presetCourant = "";
  savePresets();
  remplirListePresets();
  showToast("Sélection supprimée", 2400);
  return true;
}

function remplirListePresets() {
  const sel = document.getElementById("presetSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const vide = document.createElement("option");
  vide.value = ""; vide.textContent = presets.length ? "— Sélections enregistrées —" : "Aucune sélection enregistrée";
  sel.appendChild(vide);
  presets.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.name} (${p.items.length})`;
    sel.appendChild(o);
  });
  sel.value = presetCourant || "";
}

/* ─── Fenêtre de génération ──────────────────────────────── */

function ouvrirDeckModal() {
  if (!selectionIds.length) { showToast("Sélectionnez d'abord des KPI", 2600); return; }
  /* Recomposer d'abord : sans cela la fenêtre annoncerait des relevés
     qui, en réalité, se déduisent de ceux déjà faits. */
  reperterEmpreintesJumelles()
    .then(() => engendrerEmpreintes())
    .then(bilan => {
      if (bilan.engendrees) {
        showToast("✨ " + bilan.engendrees + " empreinte(s) déduites de vos relevés", 3600);
      }
      renderDeckLignes();
    });
  const titre = document.getElementById("deckTitleInput");
  if (titre && !titre.value) {
    const p = presets.find(x => x.id === presetCourant);
    titre.value = p ? "Indicateurs — " + p.name : "Indicateurs KPI";
  }
  renderDeckLignes();
  document.getElementById("deckModal")?.classList.remove("hidden");
}

function fermerDeckModal() {
  document.getElementById("deckModal")?.classList.add("hidden");
}

/** Diapositives telles qu'elles seront produites, dans l'ordre. */
function diaposCourantes() {
  return Selection.resoudrePreset(
    selectionCourante(),
    [...data, ...personalEntries],
    activeSites()
  );
}

/* Il n'y a plus qu'un mode : le visuel vivant, avec son empreinte. La
   fonction demeure parce que la fabrique la nomme, et parce qu'elle dit
   ce que le support contiendra. */
function modeDeck() { return "vivant"; }

/**
 * Ce que le lien d'une diapositive désigne réellement.
 * C'est LE point qui décide si le support montrera le bon graphique :
 * un lien de page affiche tout le rapport, pas le visuel.
 */
function diagnosticLien(d) {
  const a = PptxDeck.analyserLien(d.lien);
  if (a.type === "aucun") {
    return { ok: false, court: "sans lien", detail: "aucun lien Power BI pour ce périmètre" };
  }
  if (a.type !== "visuel") {
    return { ok: false, court: "⚠ page entière",
             detail: "ce lien désigne une PAGE de rapport : le support affichera toute la page. " +
                     "Reprenez-le par « … → Partager → Lien vers cet élément visuel »." };
  }
  const format = Math.round(a.largeur) + "×" + Math.round(a.hauteur) + " px";
  if (a.aplati) {
    return { ok: false, court: "⚠ format allongé",
             detail: "visuel " + format + " — plus de dix fois plus large que haut. Ouvrez-le pour " +
                     "confirmer que c'est bien le graphique voulu." };
  }
  return { ok: true, court: "⚡ visuel", detail: format };
}

/**
 * Relève les empreintes d'un PowerPoint où les visuels ont été insérés
 * À LA MAIN. C'est l'opération à faire UNE FOIS par KPI ; ensuite la
 * génération est automatique.
 *
 * @returns {Promise<{ajoutees:number, total:number, ignores:number}>}
 */
async function releverEmpreintesDepuis(octets) {
  const pieces = await ZipMini.lireZip(octets);
  const noms = [...pieces.keys()]
    .filter(n => /^ppt\/webextensions\/webextension\d+\.xml$/.test(n));

  const trouvees = [];
  let ignores = 0;
  noms.forEach(nom => {
    const xml = ZipMini.versTexte(pieces.get(nom));
    const props = {};
    const re = /<we:property name="([^"]+)" value="([\s\S]*?)"\/>/g;
    let m;
    while ((m = re.exec(xml))) props[m[1]] = m[2];
    const emp = Empreintes.creerEmpreinte(props, { horodatage: now(), auteur: currentUser || "?" });
    if (emp) trouvees.push(emp); else ignores++;
  });

  const avant = new Set(empreintes.map(e => e.id));
  empreintes = Empreintes.fusionnerEmpreintes(trouvees, empreintes);
  const ajoutees = empreintes.filter(e => !avant.has(e.id)).length;
  if (trouvees.length) saveEmpreintes();
  return { ajoutees, total: trouvees.length, ignores };
}

/**
 * Empreintes déjà relevées ailleurs, livrées sous forme de fichier .json.
 * Sert à transmettre un relevé sans refaire l'insertion : entre deux
 * annuaires, ou quand quelqu'un a déjà fait le travail.
 * @returns {{ajoutees:number, total:number, ignores:number}}
 */
function importerEmpreintesJson(texte) {
  let brut;
  try { brut = JSON.parse(texte); }
  catch (err) { throw new Error("ce fichier n'est pas un relevé d'empreintes lisible"); }

  const liste = Array.isArray(brut) ? brut
              : (brut && Array.isArray(brut.kpiEmpreintes)) ? brut.kpiEmpreintes : null;
  if (!liste) throw new Error("ce fichier ne contient pas de liste d'empreintes");

  const valides = liste
    .filter(e => e && e.id && e.proprietes)
    .map(e => Empreintes.normaliserEmpreinte(e, { horodatage: now(), auteur: currentUser || "?" }))
    .filter(e => Empreintes.empreinteComplete(e));

  const avant = new Set(empreintes.map(e => e.id));
  empreintes = Empreintes.fusionnerEmpreintes(valides, empreintes);
  const ajoutees = empreintes.filter(e => !avant.has(e.id)).length;
  if (valides.length) saveEmpreintes();
  return { ajoutees, total: valides.length, ignores: liste.length - valides.length };
}

/**
 * Le fichier choisi dans la fenêtre de génération : un PowerPoint où
 * l'insertion a été faite à la main, ou un relevé .json déjà constitué.
 */
async function importerEmpreintes(fichier) {
  if (!fichier) return null;
  const estJson = /\.json$/i.test(fichier.name || "");
  try {
    const bilan = estJson
      ? importerEmpreintesJson(await fichier.text())
      : await releverEmpreintesDepuis(new Uint8Array(await fichier.arrayBuffer()));

    if (!bilan.total) {
      showToast(estJson
        ? "Ce relevé ne contient aucune empreinte exploitable"
        : "Aucun visuel inséré à la main dans ce fichier — "
          + "il faut un PowerPoint où le visuel a été ajouté depuis Power BI", 5000);
    } else {
      showToast("🔎 " + bilan.total + " empreinte(s) relevée(s)"
        + (bilan.ajoutees ? ", dont " + bilan.ajoutees + " nouvelle(s)" : ""), 3400);
      logActivity("empreintes", fichier.name, bilan.total + " visuel(s)");
      saveActivity();
    }
    renderDeckLignes();
    return bilan;
  } catch (err) {
    showToast("❌ Lecture impossible : " + (err.message || ""), 4000);
    return null;
  }
}

/**
 * Fabrique le support de RELEVÉ : une diapositive par KPI dépourvu
 * d'empreinte, portant son nom et son lien en toutes lettres.
 *
 * C'est le seul travail manuel qui reste, et il faut le rendre court :
 * pour chaque diapositive, sélectionner le lien affiché, le coller dans
 * *Insertion › Compléments › Power BI*, passer à la suivante. Puis
 * enregistrer et relever le fichier d'un coup.
 *
 * Le lien doit être celui de l'ANNUAIRE : repartager le visuel depuis
 * Power BI crée un nouveau signet, qui ne correspondrait à rien.
 *
 * @returns {Promise<{nom:string, diapos:number}|null>}
 */
async function preparerReleve() {
  /* D'abord déduire : inutile de réclamer ce que l'annuaire sait déjà
     recomposer. Ce qui reste est le strict nécessaire. */
  await engendrerEmpreintes();

  const sites = activeSites();
  const nomZone = c => (sites.find(s => s.key === c) || {}).name || c;
  const aFaire = variantesAvecLien()
    .filter(v => !empreintePour(v.lien))
    .map(v => ({
      titre: [v.titre, v.freq, nomZone(v.site)].filter(Boolean).join(" · "),
      lien: v.lien
    }))
    .sort((a, b) => a.titre.localeCompare(b.titre, "fr"));

  /* Deux lignes peuvent porter le même intitulé et pointer ailleurs :
     on les numérote, sinon on ne saurait pas laquelle on remplit. */
  const compte = {};
  aFaire.forEach(d => { compte[d.titre] = (compte[d.titre] || 0) + 1; });
  const vus = {};
  aFaire.forEach(d => {
    if (compte[d.titre] < 2) return;
    vus[d.titre] = (vus[d.titre] || 0) + 1;
    d.titre += " (vue " + vus[d.titre] + "/" + compte[d.titre] + ")";
  });
  aFaire.forEach((d, i) => { d.titre = (i + 1) + ". " + d.titre; });

  if (!aFaire.length) {
    showToast("Tout l'annuaire a son empreinte 👍", 3000);
    return null;
  }

  let modele;
  try { modele = await chargerModeleDeck(); }
  catch (err) {
    showToast("❌ Modèle PowerPoint introuvable — " + (err.message || ""), 4000);
    return null;
  }

  let octets;
  try {
    octets = await PptxDeck.construireDeck(modele, {
      titre: "Relevé des empreintes",
      sousTitre: "Une insertion par diapositive : Insertion › Compléments › Power BI",
      periode: aFaire.length + " KPI à insérer, puis enregistrer et relever ce fichier",
      diapos: aFaire.map(d => ({
        titre: d.titre,
        // Le lien EN CLAIR : c'est ce qu'il faut copier dans le complément.
        commentaire: d.lien,
        lien: d.lien
      }))
    });
  } catch (err) {
    showToast("❌ Préparation impossible : " + (err.message || ""), 4000);
    return null;
  }

  const nom = "releve-empreintes.pptx";
  telechargerOctets(octets, nom);
  showToast("📋 " + aFaire.length + " diapositive(s) à compléter — "
    + "collez le lien affiché dans le complément Power BI, puis relevez le fichier", 6000);
  return { nom, diapos: aFaire.length };
}

/** Ce qui sera posé dans le cadre du visuel, selon le mode choisi. */
function etatVisuel(d) {
  const diag = diagnosticLien(d);
  if (!diag.ok) return { texte: diag.court, cls: " alerte" };
  /* Sans empreinte, le visuel s'affiche parfois, mais dans son état par
     défaut : filtres et segments perdus. L'état relevé est ce qui garantit
     les BONNES données — c'est lui qu'on suit ici. */
  /* L'empreinte vaut pour un lien précis, signet compris : c'est le
     signet qui porte les filtres, et donc ce qui distingue deux KPI
     partageant le même visuel. */
  const emp = empreintePour(d.lien);
  if (emp) return { texte: emp.derivee ? "✨ déduit" : "⚡ visuel", cls: " on" };
  /* Une empreinte du même visuel sur un autre signet : le lien a été
     repartagé depuis le relevé. Le dire épargne une longue recherche. */
  return Empreintes.empreinteDepassee(empreintes, d.lien)
    ? { texte: "⟳ lien repartagé", cls: " alerte" }
    : { texte: "à relever", cls: " alerte" };
}

function renderDeckLignes() {
  const el = document.getElementById("deckList");
  if (!el) return;
  const { diapos } = diaposCourantes();
  el.innerHTML = diapos.map((d, i) => `
    <div class="deck-row${diagnosticLien(d).ok ? "" : " deck-row-warn"}">
      <span class="deck-num">${i + 1}</span>
      <div class="deck-main">
        <b>${esc(d.titre)}</b>
        <span class="deck-sub">${esc([d.kpi.freq || "", diagnosticLien(d).detail].filter(Boolean).join(" · "))}</span>
        <input type="text" class="deck-comment" data-kpi="${esc(d.kpiId)}"
               placeholder="Commentaires : …" value="${esc(d.commentaire)}"
               oninput="noterCommentaire('${esc(d.kpiId).replace(/'/g, "\\'")}', this.value)">
      </div>
      <div class="deck-tools">
        <span class="deck-shot${etatVisuel(d).cls}">${etatVisuel(d).texte}</span>
        <button type="button" class="btn-tool" onclick="deplacerSelection('${esc(d.kpiId).replace(/'/g, "\\'")}', -1)" title="Monter">▲</button>
        <button type="button" class="btn-tool" onclick="deplacerSelection('${esc(d.kpiId).replace(/'/g, "\\'")}', 1)" title="Descendre">▼</button>
      </div>
    </div>`).join("");

  /* Le guidage ne s'affiche que tant qu'il reste des empreintes à
     relever : une fois le travail fait, il n'a plus rien à dire. */
  const guide = document.getElementById("deckGuide");
  const nbDeduites = diapos.filter(d => { const e = empreintePour(d.lien); return e && e.derivee; }).length;
  const compteur = document.getElementById("deckGuideCompte");
  if (compteur) {
    compteur.textContent = nbDeduites
      ? nbDeduites + " diapositive(s) sont déduites de relevés existants — autant en moins à faire."
      : "";
    compteur.style.display = nbDeduites ? "block" : "none";
  }
  if (guide) {
    const reste = diapos.some(d => d.lien && !empreintePour(d.lien));
    guide.classList.toggle("termine", !reste);
  }

  // Bilan : ce qui empêcherait le support d'afficher le bon graphique.
  const soucis = diapos.filter(d => !diagnosticLien(d).ok);
  const avert = document.getElementById("deckWarning");
  if (avert) {
    const pages = soucis.filter(d => diagnosticLien(d).court === "⚠ page entière").length;
    const plats = soucis.filter(d => diagnosticLien(d).court === "⚠ format allongé").length;
    const vides = soucis.filter(d => !d.lien).length;
    const parties = [];
    if (pages) parties.push(`${pages} lien(s) de PAGE : tout le rapport s'affichera, pas le seul graphique`);
    if (plats) parties.push(`${plats} visuel(s) au format très allongé : à confirmer en les ouvrant`);
    if (vides) parties.push(`${vides} KPI sans lien`);
    if (modeDeck() === "vivant") {
      const sansEmpreinte = diapos.filter(d => diagnosticLien(d).ok && !empreintePour(d.lien));
      if (sansEmpreinte.length) {
        /* Une empreinte vaut pour UN lien, signet compris : chaque KPI
           demande donc sa propre insertion. Autant le dire franchement,
           plutôt que d'annoncer un chiffre rassurant et faux. */
        const repartages = sansEmpreinte.filter(d => Empreintes.empreinteDepassee(empreintes, d.lien)).length;
        if (repartages) {
          parties.push(`${repartages} KPI dont le lien a été REPARTAGÉ depuis son relevé : `
            + `chaque partage crée un nouveau signet, et l'empreinte d'hier ne vaut plus. `
            + `Ne repartagez plus un lien une fois son empreinte relevée.`);
        }
        parties.push(`${sansEmpreinte.length} KPI sans empreinte : leur visuel ne s'affichera pas. `
          + `Deux issues — soit « 📋 Préparer le relevé » et une insertion à la main par KPI, `
          + `en collant LE LIEN DE L'ANNUAIRE et jamais un lien repartagé ; `
          + `soit le mode « Image », qui capture la page entière sans aucune empreinte.`);
      }
    }
    if (empreintesJumelles.length) {
      parties.push(`${empreintesJumelles.length} empreinte(s) montrent la MÊME vue sous des noms `
        + `différents : le visuel a été inséré plusieurs fois sans toucher aux segments entre-temps. `
        + `Une seule de chaque groupe est juste — les autres afficheraient le mauvais graphique. `
        + `Relevez-les à nouveau.`);
    }
    avert.textContent = parties.length ? "⚠ " + parties.join(" · ") : "";
    avert.style.display = parties.length ? "block" : "none";
  }
}

/* Les empreintes qui montrent la même chose sous des noms différents.
   Deux insertions du même visuel sans avoir changé de segment entre-temps
   produisent deux empreintes identiques : l'une d'elles ment forcément.
   Mieux vaut le dire que laisser une diapositive afficher les chiffres
   d'un autre KPI sous le bon titre. */
let empreintesJumelles = [];

/** @returns {Promise<Array<Array<{id:string, libelle:string}>>>} les groupes. */
async function reperterEmpreintesJumelles() {
  const parVue = new Map();
  const varianteDe = new Map(variantesAvecLien().map(v => [Empreintes.cleVisuel(v.lien), v]));
  for (const e of empreintes) {
    if (!e.proprietes || !e.proprietes.bookmark) continue;
    const v = varianteDe.get(e.id);
    if (!v) continue;   // empreinte orpheline : traitée ailleurs
    let sig;
    try { sig = Derivation.signature(await Derivation.lireEtat(e.proprietes.bookmark)); }
    catch (err) { continue; }
    if (!parVue.has(sig)) parVue.set(sig, []);
    parVue.get(sig).push({ id: e.id, libelle: v.titre + " · " + v.freq + " · " + v.site });
  }
  empreintesJumelles = [...parVue.values()].filter(g => g.length > 1);
  return empreintesJumelles;
}

/** Mémorise le commentaire saisi pour une diapositive. */
function noterCommentaire(kpiId, texte) {
  const preset = presets.find(p => p.id === presetCourant);
  if (preset) {
    const it = preset.items.find(x => x.kpiId === kpiId);
    if (it) { it.commentaire = texte; preset._mtime = now(); savePresets(); return texte; }
  }
  // Sélection non enregistrée : on garde le commentaire le temps de la session
  commentairesVolatils[kpiId] = texte;
  return texte;
}

/** Le titre affiché d'un KPI de la sélection. */
function titreDeKpi(kpiId) {
  const { diapos } = diaposCourantes();
  const d = diapos.find(x => x.kpiId === kpiId);
  return d ? d.titre : "";
}


async function chargerModeleDeck() {
  if (modeleDeckCache) return modeleDeckCache;
  const rep = await fetch("modele-deck.pptx");
  if (!rep || !rep.ok) throw new Error("modele-deck.pptx introuvable");
  modeleDeckCache = new Uint8Array(await rep.arrayBuffer());
  return modeleDeckCache;
}

function telechargerOctets(octets, nom, type) {
  const blob = new Blob([octets], { type: type || "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return nom;
}

/**
 * Produit le PowerPoint : une diapositive de couverture puis une
 * diapositive par KPI sélectionné, dans l'ordre de la sélection.
 * @returns {Promise<{nom:string, diapos:number}|null>}
 */
async function genererDeck() {
  const preset = selectionCourante();
  const { diapos } = Selection.resoudrePreset(preset, [...data, ...personalEntries], activeSites());
  if (!diapos.length) { showToast("Sélection vide : rien à produire", 2800); return null; }

  let modele;
  try {
    modele = await chargerModeleDeck();
  } catch (err) {
    showToast("❌ Modèle PowerPoint introuvable (modele-deck.pptx) — " + (err.message || ""), 4000);
    return null;
  }

  const lire = id => document.getElementById(id);
  const mode = (lire("deckModeSelect") && lire("deckModeSelect").value) || "vivant";

  /* Garde-fou : en visuel vivant, un KPI sans empreinte affichera
     « l'objet visuel ajouté ici n'existe plus ». Mieux vaut le dire
     avant de produire le support que de le découvrir en séance. */
  if (mode === "vivant") {
    const muets = diapos.filter(d => d.lien && !empreintePour(d.lien));
    if (muets.length) {
      const suite = confirm(
        muets.length + " KPI sur " + diapos.length + " n'ont pas d'empreinte.\n\n"
        + "Leur diapositive affichera « L'objet visuel ajouté ici n'existe plus ».\n\n"
        + "Deux façons d'y remédier :\n"
        + "  • « 📋 Préparer le relevé », puis une insertion à la main par KPI ;\n"
        + "  • le mode « Image », qui capture la page entière sans aucune empreinte.\n\n"
        + "Produire quand même le support ?");
      if (!suite) return null;
    }
  }
  const options = {
    titre:     (lire("deckTitleInput") && lire("deckTitleInput").value) || "Indicateurs KPI",
    sousTitre: (lire("deckSubtitleInput") && lire("deckSubtitleInput").value) || "",
    periode:   (lire("deckPeriodInput") && lire("deckPeriodInput").value) || "",
    diapos: diapos.map(d => ({
      titre: d.titre,
      lien: d.lien,
      commentaire: d.commentaire || commentairesVolatils[d.kpiId] || "",
      // Le complément Power BI affiche le visuel connecté : aucune image à fournir.
      vivant: !!d.lien
    })),
    /* La mémoire relevée sur une insertion manuelle. Sans elle, le
       complément affiche « l'objet visuel n'existe plus ». */
    empreintes
  };

  let octets;
  try {
    octets = await PptxDeck.construireDeck(modele, options);
  } catch (err) {
    showToast("❌ Génération impossible : " + (err.message || ""), 4000);
    return null;
  }

  const nom = Selection.nomFichier(preset, new Date().toISOString().slice(0, 10));
  telechargerOctets(octets, nom);
  logActivity("deck", preset.name, `${diapos.length} diapositive(s)`);
  saveActivity();
  fermerDeckModal();
  showToast(`📊 PowerPoint généré : ${diapos.length} diapositive(s), visuels vivants`, 3400);
  return { nom, diapos: diapos.length };
}

/* ─── Branchements ───────────────────────────────────────── */

/* Déposer le PowerPoint du relevé sur la fenêtre : c'est le geste
   naturel après l'avoir enregistré, et il évite de chercher un bouton. */
document.getElementById("deckModal")?.addEventListener("dragover", e => {
  e.preventDefault();
  document.getElementById("deckGuide")?.classList.add("survol");
});
document.getElementById("deckModal")?.addEventListener("dragleave", () => {
  document.getElementById("deckGuide")?.classList.remove("survol");
});
document.getElementById("deckModal")?.addEventListener("drop", async e => {
  e.preventDefault();
  document.getElementById("deckGuide")?.classList.remove("survol");
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  if (!/\.(pptx|json)$/i.test(f.name || "")) {
    showToast("Déposez le PowerPoint du relevé, ou un fichier .json d'empreintes", 4000);
    return;
  }
  await importerEmpreintes(f);
});

document.getElementById("deckPreparerBtn")?.addEventListener("click", () => preparerReleve());
document.getElementById("deckEmpreintesBtn")?.addEventListener("click",
  () => document.getElementById("deckEmpreintesInput")?.click());
document.getElementById("deckEmpreintesInput")?.addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";       // rechoisir le même fichier doit rester possible
  if (f) await importerEmpreintes(f);
});

document.getElementById("selectionModeBtn")?.addEventListener("click", () => basculerModeSelection());
document.getElementById("selectionExitBtn")?.addEventListener("click", () => basculerModeSelection(false));
document.getElementById("selectAllBtn")?.addEventListener("click", cocherResultatsFiltres);
document.getElementById("selectClearBtn")?.addEventListener("click", viderSelection);
document.getElementById("deckBtn")?.addEventListener("click", ouvrirDeckModal);
document.getElementById("closeDeckBtn")?.addEventListener("click", fermerDeckModal);
document.getElementById("deckGenerateBtn")?.addEventListener("click", () => { genererDeck(); });
document.getElementById("presetSaveBtn")?.addEventListener("click", () => {
  const p = presets.find(x => x.id === presetCourant);
  const nom = prompt("Nom de la sélection (ex : COPIL hebdomadaire)", p ? p.name : "");
  if (nom !== null) enregistrerSelection(nom);
});
document.getElementById("presetSelect")?.addEventListener("change", function () {
  if (this.value) chargerSelection(this.value);
});
document.getElementById("presetDeleteBtn")?.addEventListener("click", () => {
  const sel = document.getElementById("presetSelect");
  if (sel && sel.value) supprimerSelection(sel.value);
});



/* ============================================
   TUTORIEL ANIMÉ + AIDE POWER BI
   Les deux utilisent la même fabrique (js/carousel.js) :
   navigation, points, clavier, tactile et fermeture y sont
   écrits une seule fois.
============================================ */
const tutoCarousel = createCarousel({
  modalId: "tutorialModal", trackId: "tutoTrack", dotsId: "tutoDots",
  prevId: "tutoPrev", nextId: "tutoNext", closeId: "closeTutorialBtn",
  lastLabel: "Terminer ✓"
});
function openTutorial() { tutoCarousel.open(); }
document.getElementById("tutorialBtn")?.addEventListener("click", openTutorial);

const pbiCarousel = createCarousel({
  modalId: "pbiHelpModal", trackId: "pbiTrack", dotsId: "pbiDots",
  prevId: "pbiPrev", nextId: "pbiNext", closeId: "closePbiHelpBtn",
  lastLabel: "Compris ✓"
});
document.getElementById("pbiHelpBtn")?.addEventListener("click", () => pbiCarousel.open());

/* ============================================
   PWA : service worker
============================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.log("✅ Service worker enregistré"))
      .catch(err => console.warn("Service worker non enregistré :", err));
  });
}

/* ============================================
   AUTO-LOGIN (session mémorisée)
   Placé tout à la fin, après tous les boutons : une erreur ici
   (réseau, sync mal configurée…) ne peut plus jamais bloquer l'UI.
============================================ */
if (currentUser) {
  try {
    login(currentUser);
  } catch (err) {
    console.error("Erreur lors de la reconnexion automatique :", err);
    showToast("⚠️ Erreur au chargement — réessayez de vous connecter");
    loginScreen.style.display = "flex";
    appShell.style.display = "none";
  }
}
