// Guardado de las tandas en el móvil (IndexedDB) y subida al garaje del Mac cuando se puede.
// La grabación se guarda en trozos de unos segundos mientras ruedas: si el móvil se apaga o la página se
// cierra, se pierde como mucho el último trozo. Cada trozo se sube una vez al Mac y se queda también aquí.
(function () {
  "use strict";
  const F = window.MaspaFormato;
  const DB_NAME = "pista";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("sin IndexedDB"));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const ses = db.createObjectStore("sesiones", { keyPath: "id" });
        ses.createIndex("pend", "pend");
        const tro = db.createObjectStore("trozos", { keyPath: ["id", "seq"] });
        // Solo los pendientes de subir tienen `pend`: el índice es la cola.
        tro.createIndex("pend", "pend");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("base de datos bloqueada"));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  // Ejecuta fn dentro de una transacción y resuelve al completarse (con lo que fn devuelva).
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("transacción cancelada"));
      out = fn(t);
    });
  }
  function reqP(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  // ---------- tandas ----------
  function putSession(meta) {
    const rec = Object.assign({}, meta, { pend: 1 });
    return tx(["sesiones"], "readwrite", (t) => {
      t.objectStore("sesiones").put(rec);
    });
  }
  function putChunk(chunk) {
    const rec = Object.assign({}, chunk, { pend: 1 });
    return tx(["trozos"], "readwrite", (t) => {
      t.objectStore("trozos").put(rec);
    });
  }
  async function sessions() {
    const db = await open();
    const all = await reqP(
      db.transaction("sesiones").objectStore("sesiones").getAll(),
    );
    return all.sort((a, b) => (a.id < b.id ? 1 : -1));
  }
  async function chunksOf(id) {
    const db = await open();
    const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
    return reqP(db.transaction("trozos").objectStore("trozos").getAll(range));
  }
  async function pendingCounts() {
    const db = await open();
    const t = db.transaction(["trozos", "sesiones"]);
    const [trozos, sesiones] = await Promise.all([
      reqP(t.objectStore("trozos").index("pend").count(IDBKeyRange.only(1))),
      reqP(t.objectStore("sesiones").index("pend").count(IDBKeyRange.only(1))),
    ]);
    return { trozos, sesiones };
  }
  // Tandas que quedaron grabando (la página se cerró sin terminar): se cierran como «cortadas».
  async function closeStale(currentId) {
    const list = await sessions();
    for (const s of list)
      if (s.estado === "grabando" && s.id !== currentId) {
        const fixed = Object.assign({}, s, { estado: "cortada" });
        delete fixed.pend;
        await putSession(fixed);
      }
  }

  // ---------- subida al garaje ----------
  const sync = {
    cfg: null,
    state: "off", // off | ok | offline | auth | busy
    lastOk: null,
    lastError: "",
    running: false,
    wait: 0,
    nextTry: 0,
    onChange: null,
  };

  function setState(state, err) {
    sync.state = state;
    if (err !== undefined) sync.lastError = err;
    if (state === "ok") sync.lastOk = Date.now();
    if (sync.onChange) sync.onChange();
  }

  async function body(obj) {
    const json = JSON.stringify(obj);
    if (typeof CompressionStream === "undefined")
      return { data: json, gzip: false };
    const stream = new Blob([json])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return { data: await new Response(stream).blob(), gzip: true };
  }

  async function call(method, path, obj) {
    const cfg = sync.cfg;
    const headers = { Authorization: "Bearer " + cfg.k };
    let payload;
    if (obj !== undefined) {
      const b = await body(obj);
      payload = b.data;
      headers["Content-Type"] = b.gzip
        ? "application/octet-stream"
        : "application/json";
      if (b.gzip) headers["X-Gzip"] = "1";
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      return await fetch(cfg.u + path, {
        method,
        headers,
        body: payload,
        signal: ctrl.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function hello() {
    if (!sync.cfg) return setState("off", "");
    try {
      const r = await call("GET", "/api/hola");
      if (r.status === 401) return setState("auth", "clave no válida");
      if (!r.ok) return setState("offline", reason({ status: r.status }));
      const j = await r.json();
      if (!j || j.ok !== true)
        return setState("offline", "lo que contesta no es el garaje");
      setState("ok", "");
    } catch (e) {
      setState("offline", reason(e));
    }
  }

  // Por qué no se ha podido subir, en palabras del piloto.
  function reason(e) {
    if (e && e.name === "AbortError") return "el Mac no contesta";
    if (e && e.status === 507) return "el disco del Mac está casi lleno";
    // 502/530/1033: el túnel ya no apunta a ningún garaje (se cerró o se reinició).
    if (e && e.status >= 500)
      return "el garaje está cerrado o ha cambiado de código";
    if (e && e.status) return "el Mac responde con error " + e.status;
    return "no hay red o el garaje está cerrado";
  }
  function failed(status) {
    const e = new Error("el Mac responde " + status);
    e.status = status;
    return e;
  }

  async function markDone(store, key, rec, status) {
    const fixed = Object.assign({}, rec);
    delete fixed.pend;
    if (status) fixed.rechazo = status;
    await tx([store], "readwrite", (t) => t.objectStore(store).put(fixed));
    return key;
  }

  // Sube lo pendiente (trozos primero, luego los resúmenes). maxItems acota cada pasada.
  async function syncNow(maxItems) {
    if (!sync.cfg || sync.running) return;
    if (sync.state === "auth") return;
    sync.running = true;
    let sent = 0;
    try {
      const db = await open();
      const limit = maxItems || 200;
      while (sent < limit) {
        const next = await reqP(
          db
            .transaction("trozos")
            .objectStore("trozos")
            .index("pend")
            .get(IDBKeyRange.only(1)),
        );
        if (!next) break;
        const chunk = {
          v: next.v,
          id: next.id,
          seq: next.seq,
          epoch: next.epoch,
          series: next.series,
        };
        const r = await call(
          "PUT",
          "/api/tandas/" + next.id + "/trozos/" + next.seq,
          F.cleanChunk(chunk),
        );
        if (r.status === 401) return setState("auth", "clave no válida");
        if (r.status === 400 || r.status === 413) {
          // El Mac no lo acepta: se queda en el móvil (exportable) y no bloquea la cola.
          await markDone("trozos", [next.id, next.seq], next, r.status);
        } else if (!r.ok) {
          throw failed(r.status);
        } else {
          await markDone("trozos", [next.id, next.seq], next);
        }
        sent++;
        if (sync.state !== "ok") setState("ok", "");
        else if (sync.onChange) sync.onChange();
      }
      const metas = await reqP(
        db
          .transaction("sesiones")
          .objectStore("sesiones")
          .index("pend")
          .getAll(IDBKeyRange.only(1)),
      );
      for (const m of metas) {
        const meta = Object.assign({}, m);
        delete meta.pend;
        const r = await call("PUT", "/api/tandas/" + m.id + "/meta", meta);
        if (r.status === 401) return setState("auth", "clave no válida");
        if (!r.ok && r.status !== 400) throw failed(r.status);
        // Si mientras subía se ha guardado una versión más nueva, esa sigue pendiente.
        const cur = await reqP(
          db.transaction("sesiones").objectStore("sesiones").get(m.id),
        );
        if (cur && JSON.stringify(cur) === JSON.stringify(m))
          await markDone("sesiones", m.id, m, r.ok ? 0 : r.status);
      }
      sync.wait = 0;
      if (sync.state !== "ok") setState("ok", "");
    } catch (e) {
      sync.wait = Math.min(300000, sync.wait ? sync.wait * 2 : 15000);
      sync.nextTry = Date.now() + sync.wait;
      setState("offline", reason(e));
    } finally {
      sync.running = false;
      if (sync.onChange) sync.onChange();
    }
  }

  // Comprueba la cola cada pocos segundos; tras un fallo espera cada vez más (hasta 5 min).
  // gapFn() > 0 pide ir despacio: como mucho un trozo cada gapFn() ms.
  function startLoop(everyMs, gapFn) {
    let lastRun = 0;
    setInterval(() => {
      if (!sync.cfg || sync.running || sync.state === "auth") return;
      if (Date.now() < sync.nextTry) return;
      const gap = gapFn ? gapFn() : 0;
      if (gap && Date.now() - lastRun < gap) return;
      lastRun = Date.now();
      syncNow(gap ? 1 : 40);
    }, everyMs || 10000);
  }

  function configure(cfg) {
    sync.cfg = cfg && cfg.u && cfg.k ? cfg : null;
    sync.wait = 0;
    sync.nextTry = 0;
    setState(sync.cfg ? "busy" : "off", "");
    if (sync.cfg) hello().then(() => syncNow(40));
  }

  // Enlace de emparejado del garaje: #garaje=<base64url de {"u": url, "k": clave}>.
  function parsePairing(hash) {
    const m = /^#garaje=([A-Za-z0-9_-]+)$/.exec(hash || "");
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const o = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4)));
      const u = String(o.u || "").replace(/\/+$/, "");
      const k = String(o.k || "");
      const url = new URL(u);
      const local = /^(127\.0\.0\.1|localhost)$/.test(url.hostname);
      if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
        return null;
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(k)) return null;
      return { u: url.origin, k };
    } catch (e) {
      return null;
    }
  }

  async function persist() {
    try {
      if (navigator.storage && navigator.storage.persisted) {
        if (await navigator.storage.persisted()) return true;
        if (navigator.storage.persist) return await navigator.storage.persist();
      }
    } catch (e) {
      /* el navegador no lo permite */
    }
    return false;
  }

  window.PistaStore = {
    open,
    putSession,
    putChunk,
    sessions,
    chunksOf,
    pendingCounts,
    closeStale,
    persist,
    sync,
    syncNow,
    hello,
    startLoop,
    configure,
    parsePairing,
  };
})();
