// Funciona sin cobertura en el circuito: la app se guarda en el móvil la primera vez que se abre (todos los archivos
// de la versión, que vite-plugin-pwa deja en self.__WB_MANIFEST al construir). Todo se pide primero a la red (para
// recibir las actualizaciones) y, si no hay red, sale de la copia. Mismo funcionamiento que el sw.js de siempre.
import { BUILD } from "../src/app/version";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// Igual que la versión de la portada. Las copias de antes (pista-v29…) se borran al activarse esta.
const CACHE = "pista-v" + BUILD;
// Sin repetidos: el plugin añade el manifest y sus iconos aunque ya estén en la lista, y cache.addAll falla entero si
// le llega dos veces el mismo archivo (sin copia, sin app sin cobertura).
const FILES = [...new Set(["./", ...self.__WB_MANIFEST.map((e) => e.url)])];

// GitHub Pages sirve con max-age=600: sin esto, en los 10 minutos después de publicar, tanto la copia como las
// recargas podían seguir dando los archivos viejos. Se pide siempre al servidor (que contesta «sin cambios» barato si
// no los hay).
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
          void caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(e.request)
          .then((r) => r || caches.match("index.html"))
          .then((r) => r || Response.error()),
      ),
  );
});
