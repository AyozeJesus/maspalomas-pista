// Funciona sin cobertura en el circuito: la página se guarda en el móvil la primera vez que se abre.
// La página principal se pide primero a la red (para recibir las actualizaciones) y, si no hay red, sale de la copia.
// Igual que BUILD en live.js (se ve en la portada).
const CACHE = "pista-v24";
const FILES = [
  "./",
  "index.html",
  "live.js",
  "store.js",
  "formato.js",
  "comparativa.js",
  "mapa.js",
  "recorrido.js",
  "circuito.js",
  "caida.js",
  "compartir.js",
  "circuito-worker.js",
  "trackbuilder.js",
  "gnss-ble.js",
  "gnss-usb.js",
  "vista3d.js",
  "three.min.js",
  "telemetry.js",
  "analysis.js",
  "sim.js",
  "track-data.js",
  "jszip.min.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

// GitHub Pages sirve con max-age=600: sin esto, en los 10 minutos después de publicar, tanto la copia como las
// recargas podían seguir dando los archivos viejos. Se pide siempre al servidor (que contesta «sin cambios»
// barato si no los hay).
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))),
      )
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
    fetch(e.request, { cache: "no-cache" })
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
