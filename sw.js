// Funciona sin cobertura en el circuito: la página se guarda en el móvil la primera vez que se abre.
// La página principal se pide primero a la red (para recibir las actualizaciones) y, si no hay red, sale de la copia.
const CACHE = "pista-v10";
const FILES = [
  "./",
  "index.html",
  "live.js",
  "store.js",
  "formato.js",
  "comparativa.js",
  "mapa.js",
  "recorrido.js",
  "telemetry.js",
  "analysis.js",
  "sim.js",
  "track-data.js",
  "jszip.min.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((r) => r || caches.match("index.html")),
      ),
  );
});
