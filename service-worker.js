/* TimeFlow — service worker
   Réseau d'abord, cache en secours : une mise à jour poussée sur GitHub Pages
   est visible au rechargement suivant, au lieu de rester figée en cache.
   Hors ligne, l'app et les pointages continuent de fonctionner. */

const CACHE = "timeflow-cache-v9";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js", "./paie.js",
  "./firebase-config.js", "./manifest.json", "./Logo.png"
];

/* Mise en cache fichier par fichier : si l'un d'eux manque (oubli au dépôt),
   l'installation continue au lieu d'échouer en bloc — cache.addAll() rejette
   la promesse entière dès qu'une seule requête échoue, et l'app perdrait
   alors tout son fonctionnement hors ligne. */
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Firestore, polices Google : jamais interceptés, jamais mis en cache.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
  );
});
