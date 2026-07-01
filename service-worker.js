const CACHE_NAME = "timeflow-cache-v1";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js",
  "./Logo.png", "./manifest.json"
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
      caches.open(CACHE_NAME).then(c => { if (cl.ok) c.put(e.request, cl); });
      return r;
    }).catch(() => caches.match(e.request).then(c => c || caches.match("./index.html")))
  );
});
