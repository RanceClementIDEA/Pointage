const CACHE_NAME = "kpi-idea-cache-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./xlsx.full.min.js",
  "./js/storage.js",
  "./js/merge.js",
  "./js/carousel.js",
  "./js/zip.js",
  "./js/empreintes.js",
  "./js/derivation.js",
  "./js/pptx.js",
  "./js/inspecter-deck.js",
  "./js/selection.js",
  "./modele-deck.pptx",
  "./empreintes-livrees.json",
  "./logo-idea.png",
  "./footer-idea.png",
  "./manifest.json"
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cl = r.clone();
      caches.open(CACHE_NAME).then(cache => { if (cl.ok) cache.put(e.request, cl); });
      return r;
    }).catch(() => caches.match(e.request).then(c => {
      if (c) return c;
      // Repli sur la page seulement pour une NAVIGATION. Le faire pour tout
      // rendait index.html en réponse à un script indisponible (Firebase hors
      // ligne, CDN bloqué) : le navigateur tentait alors d'exécuter du HTML
      // et signalait « Unexpected token '<' ».
      if (e.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }))
  );
});
