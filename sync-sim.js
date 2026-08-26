/* Banc d'essai : simule des appareils réels avec le VRAI moteur de fusion.
   Reproduit fidèlement la logique de app.js (buildSyncPayload, mergeRemote*,
   initialSync, replaceLocalWithRemote, rebuildData). */
const M = require("./js/merge.js");

const STD_FREQS = ["Mensuelle", "Hebdomadaire", "Quotidienne"];
const titleKey = t => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
const slugifyId = t => (t || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "vide";
const MAX_ACTIVITY = 400;

/* Horloge murale commune : dans la réalité tous les appareils lisent le même
   temps qui avance. Chaque action obtient donc un instant strictement distinct. */
let horlogeGlobale = 1000000;

/* --- Le "cloud" : un document unique, comme Firestore --- */
class Cloud {
  constructor() { this.doc = null; this.writes = 0; }
  get() { return this.doc ? JSON.parse(JSON.stringify(this.doc)) : null; }
  set(payload) { this.doc = JSON.parse(JSON.stringify(payload)); this.writes++; }
}

/* --- Un appareil --- */
class Device {
  constructor(name, cloud, opts = {}) {
    this.name = name;
    this.cloud = cloud;
    this.user = opts.user || "marie";
    this.clockSkew = opts.clockSkew || 0;   // décalage d'horloge en ms
    this.online = opts.online !== false;
    this.manualEntries = [];
    this.personalEntries = [];
    this.deletedIds = [];
    this.purgedIds = [];
    this.sites = opts.sites ? JSON.parse(JSON.stringify(opts.sites)) : [
      { key: "logistiport", name: "Logistiport", _mtime: 1 },
      { key: "armement", name: "MG + Débords", _mtime: 1 }
    ];
    this.activityLog = [];
    this.favorites = [];
    this.favByUser = {};
    this.favMeta = {};
    this.data = [];
    this.initialSyncDone = false;
    this.syncBusy = false;
    this.lastAppliedSyncAt = 0;
  }
  now() { horlogeGlobale += 10; return horlogeGlobale + this.clockSkew; }
  stamp(e) { e._mtime = this.now(); e._by = this.user; return e; }

  isDeleted(id) { return M.isDeletedIn(this.deletedIds, id); }
  isPurged(id) { return this.purgedIds.includes(id); }
  rebuildData() {
    this.data = this.manualEntries.filter(d => !this.isDeleted(d.id) && !this.isPurged(d.id));
  }

  /* --- Actions utilisateur --- */
  createKpi(title, freq, links = {}) {
    const e = { id: "kpi_" + slugifyId(title) + "_" + slugifyId(freq), manual: true, title, freq, ...links };
    this.stamp(e);
    this.manualEntries = this.manualEntries.filter(k => k.id !== e.id);
    this.manualEntries.push(e);
    this.rebuildData();
    return e;
  }
  editKpi(id, changes) {
    const e = this.manualEntries.find(k => k.id === id);
    if (!e) return null;
    Object.assign(e, changes);
    this.stamp(e);
    this.rebuildData();
    return e;
  }
  deleteFiche(title) {
    const key = titleKey(title);
    const group = this.data.filter(k => titleKey(k.title) === key);
    group.forEach(v => {
      this.deletedIds = this.deletedIds.filter(d => d.id !== v.id);
      this.deletedIds.push({ id: v.id, title: v.title, freq: v.freq, at: this.now(), by: this.user, state: "deleted" });
    });
    this.rebuildData();
    return group.length;
  }
  restoreFiche(title) {
    const key = titleKey(title);
    const ids = this.deletedIds.filter(d => titleKey(d.title) === key).map(d => d.id);
    this.deletedIds = this.deletedIds.map(d => ids.includes(d.id)
      ? { ...d, state: "restored", at: this.now(), by: this.user } : d);
    this.rebuildData();
  }
  addSite(key, name) {
    this.sites = this.sites.filter(s => s.key !== key);
    this.sites.push({ key, name, _mtime: this.now(), _deleted: false });
  }
  removeSite(key) {
    const s = this.sites.find(x => x.key === key);
    if (s) { s._deleted = true; s._mtime = this.now(); }
  }
  activeSites() { return this.sites.filter(s => s && !s._deleted); }
  toggleFavorite(id) {
    if (this.favorites.includes(id)) this.favorites = this.favorites.filter(f => f !== id);
    else this.favorites.push(id);
    this.favMeta[this.user] = this.now();
  }
  logActivity(action, title) {
    this.activityLog.unshift({ at: this.now(), by: this.user, action, title, detail: "" });
    this.activityLog = this.activityLog.slice(0, MAX_ACTIVITY);
  }

  /* --- Synchronisation (copie fidèle de app.js) --- */
  buildSyncPayload() {
    this.favByUser[this.user] = this.favorites;
    this.favMeta[this.user] = this.favMeta[this.user] || this.now();
    return {
      kpiManual: JSON.parse(JSON.stringify(this.manualEntries)),
      kpiDeleted: JSON.parse(JSON.stringify(this.deletedIds)),
      kpiSites: JSON.parse(JSON.stringify(this.sites)),
      kpiPurged: [...this.purgedIds],
      kpiActivity: JSON.parse(JSON.stringify(this.activityLog)),
      favoritesByUser: JSON.parse(JSON.stringify(this.favByUser)),
      favoritesMeta: JSON.parse(JSON.stringify(this.favMeta)),
      updatedAt: this.now()
    };
  }
  mergeRemoteContent(payload) {
    let remoteManual = Array.isArray(payload.kpiManual) ? [...payload.kpiManual] : [];
    const oldExcel = Array.isArray(payload.kpiExcel) ? payload.kpiExcel : [];
    if (oldExcel.length) {
      const overr = payload.kpiOverrides || {};
      oldExcel.forEach(d => {
        const merged = overr[d.id] ? { ...d, ...overr[d.id] } : d;
        const id = "kpi_" + slugifyId(merged.title) + "_" + slugifyId(merged.freq);
        if (!remoteManual.some(m => m.id === id)) {
          remoteManual.push({ ...merged, id, manual: true, _mtime: merged._mtime || 0 });
        }
      });
    }
    if (remoteManual.length || Array.isArray(payload.kpiManual)) {
      this.manualEntries = M.mergeEntries(this.manualEntries, remoteManual);
    }
    if (Array.isArray(payload.kpiDeleted)) {
      this.deletedIds = M.mergeDeleted(this.deletedIds, M.normalizeDeleted(payload.kpiDeleted));
    }
    if (Array.isArray(payload.kpiPurged)) {
      this.purgedIds = [...new Set([...this.purgedIds, ...payload.kpiPurged])];
    }
    if (Array.isArray(payload.kpiActivity)) {
      this.activityLog = M.mergeActivity(this.activityLog, payload.kpiActivity, MAX_ACTIVITY);
    }
  }
  mergeRemoteSites(payload) {
    if (!Array.isArray(payload.kpiSites) || !payload.kpiSites.length) return;
    const map = new Map();
    payload.kpiSites.forEach(s => { if (s && s.key) map.set(s.key, s); });
    this.sites.forEach(s => {
      if (!s || !s.key) return;
      const other = map.get(s.key);
      if (!other || (s._mtime || 0) >= (other._mtime || 0)) map.set(s.key, s);
    });
    this.sites = [...map.values()];
  }
  mergeRemoteFavorites(payload) {
    if (!payload.favoritesByUser) return;
    const r = M.mergeFavorites(this.favByUser, this.favMeta, payload.favoritesByUser, payload.favoritesMeta);
    this.favByUser = r.map; this.favMeta = r.meta;
    if (this.favByUser[this.user]) this.favorites = this.favByUser[this.user];
  }
  applyRemoteData(payload) {
    this.mergeRemoteContent(payload);
    this.mergeRemoteSites(payload);
    this.mergeRemoteFavorites(payload);
    this.rebuildData();
    if (payload.updatedAt) this.lastAppliedSyncAt = payload.updatedAt;
  }
  hasLocalDataNewerThan(remote) {
    const plusRecent = (locaux, distants, cle, date) => {
      const map = new Map((distants || []).map(x => [x[cle], x[date] || 0]));
      return (locaux || []).some(x => {
        const t = map.get(x[cle]);
        return t === undefined || (x[date] || 0) > t;
      });
    };
    if (plusRecent(this.manualEntries, remote.kpiManual, "id", "_mtime")) return true;
    if (plusRecent(this.deletedIds, remote.kpiDeleted, "id", "at")) return true;
    if (plusRecent(this.sites, remote.kpiSites, "key", "_mtime")) return true;
    const dp = new Set(remote.kpiPurged || []);
    if ((this.purgedIds || []).some(id => !dp.has(id))) return true;
    return false;
  }
  pushToCloud() {
    if (!this.online) return false;
    this.cloud.set(this.buildSyncPayload());
    return true;
  }
  /* Séquence exacte de démarrage */
  initialSync() {
    if (!this.online || this.syncBusy) return;
    this.syncBusy = true;
    const remote = this.cloud.get();
    if (!remote) { this.pushToCloud(); }
    else {
      this.lastAppliedSyncAt = remote.updatedAt || 0;
      this.applyRemoteData(remote);
      if (this.hasLocalDataNewerThan(remote)) this.pushToCloud();
    }
    this.initialSyncDone = true;
    this.syncBusy = false;
  }
  /* Bouton "Récupérer" = remplacement réel */
  pullReplace() {
    const payload = this.cloud.get();
    if (!payload) return false;
    this.manualEntries = payload.kpiManual || [];
    this.deletedIds = M.normalizeDeleted(payload.kpiDeleted || []);
    this.purgedIds = payload.kpiPurged || [];
    if (payload.kpiSites?.length) this.sites = payload.kpiSites;
    if (payload.kpiActivity) this.activityLog = payload.kpiActivity;
    if (payload.favoritesByUser) {
      this.favByUser = payload.favoritesByUser;
      if (this.favByUser[this.user]) this.favorites = this.favByUser[this.user];
    }
    this.rebuildData();
    this.lastAppliedSyncAt = payload.updatedAt || 0;
    return true;
  }
  /* Bouton "Cet appareil fait référence" */
  forceMaster() {
    const t = this.now();
    this.manualEntries.forEach(k => { k._mtime = t; });
    this.sites.forEach(s => { s._mtime = t; });
    this.pushToCloud();
  }
  /* Écoute temps réel (onSnapshot) */
  onRemoteChange() {
    if (!this.initialSyncDone || this.syncBusy || !this.online) return;
    const payload = this.cloud.get();
    if (!payload || payload.updatedAt === this.lastAppliedSyncAt) return;
    this.syncBusy = true;
    this.lastAppliedSyncAt = payload.updatedAt;
    this.applyRemoteData(payload);
    this.syncBusy = false;
  }

  /* --- Observation --- */
  kpiCount() { return new Set(this.data.map(k => titleKey(k.title))).size; }
  variantCount() { return this.data.length; }
  signature() {
    return this.data.map(k => k.id + "=" + JSON.stringify(
      Object.keys(k).filter(x => !x.startsWith("_")).sort().map(x => x + ":" + k[x])
    )).sort().join("|");
  }
  siteSignature() { return this.activeSites().map(s => s.key).sort().join(","); }
}

function avancerHorloge(ms) { horlogeGlobale += ms; }
module.exports = { Cloud, Device, titleKey, slugifyId, STD_FREQS, avancerHorloge };
