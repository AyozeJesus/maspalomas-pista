// Subida al garaje del Mac: lo pendiente del móvil (trozos primero, luego los resúmenes) por HTTP con la clave del
// emparejado. Si no se puede, todo sigue en el móvil y se reintenta cada vez más tarde (hasta 5 min).
import { cleanChunk } from "../core/formato";
import { failed, reason } from "./errors";
import type { GarageConfig, StoreDeps, SyncState, SyncStatus, UploadQueue } from "./types";

// Lo que se espera la respuesta del Mac.
const TIMEOUT_MS = 25000;
// Cada cuánto mira la cola el bucle.
const LOOP_MS = 10000;
// Trozos por pasada: a mano (syncNow sin número), del bucle y al conectar, y en pista (de uno en uno).
const MANUAL_BATCH = 200;
const LOOP_BATCH = 40;
const SLOW_BATCH = 1;
// Espera tras el primer fallo; se dobla en cada uno, hasta el máximo.
const FIRST_WAIT_MS = 15000;
const MAX_WAIT_MS = 300000;

export interface Garage {
  sync: SyncState;
  // Sube lo pendiente (trozos primero, luego los resúmenes). maxItems acota cada pasada (sin él, 200 trozos).
  syncNow(maxItems?: number): Promise<void>;
  // Saluda al Mac para ver si contesta (y si es el garaje).
  hello(): Promise<void>;
  // Tiempos del día de todos los pilotos que suben a este garaje (resumen calculado en el Mac).
  fetchDay(): Promise<unknown>;
  // Mira la cola cada everyMs (10 s). gapFn() > 0 pide ir despacio: como mucho un trozo cada gapFn() ms. Devuelve con
  // qué pararlo.
  startLoop(everyMs?: number, gapFn?: () => number): () => void;
  // Garaje nuevo (o ninguno: null): vuelve a saludar y sube lo pendiente.
  configure(cfg: Partial<GarageConfig> | null | undefined): void;
}

function isGarage(cfg: Partial<GarageConfig> | null | undefined): cfg is GarageConfig {
  return !!(cfg && cfg.u && cfg.k);
}

// ¿Contesta el garaje? ({"ok": true})
function saysOk(j: unknown): boolean {
  return typeof j === "object" && j !== null && "ok" in j && j.ok === true;
}

type Deps = Pick<StoreDeps, "fetch" | "timers" | "now" | "compression">;

export function createGarage(deps: Deps, queue: UploadQueue): Garage {
  // Sin `this` (como window.fetch).
  const { fetch: send, timers, now, compression } = deps;
  const sync: SyncState = {
    cfg: null,
    state: "off",
    lastOk: null,
    lastError: "",
    running: false,
    wait: 0,
    nextTry: 0,
    onChange: null,
  };

  function setState(state: SyncStatus, err?: string): void {
    sync.state = state;
    if (err !== undefined) sync.lastError = err;
    if (state === "ok") sync.lastOk = now();
    if (sync.onChange) sync.onChange();
  }

  async function body(obj: unknown): Promise<{ data: string | Blob; gzip: boolean }> {
    const json = JSON.stringify(obj);
    if (!compression) return { data: json, gzip: false };
    const stream = new Blob([json]).stream().pipeThrough(new compression("gzip"));
    return { data: await new Response(stream).blob(), gzip: true };
  }

  async function call(method: "GET" | "PUT", path: string, obj?: unknown): Promise<Response> {
    const cfg = sync.cfg;
    // Garaje quitado a mitad de una subida: falla como en la de antes (al leer la clave de null), y la subida acaba
    // «offline».
    if (!cfg) throw new TypeError("Cannot read properties of null (reading 'k')");
    const headers: Record<string, string> = { Authorization: "Bearer " + cfg.k };
    let payload: string | Blob | undefined;
    if (obj !== undefined) {
      const b = await body(obj);
      payload = b.data;
      headers["Content-Type"] = b.gzip ? "application/octet-stream" : "application/json";
      if (b.gzip) headers["X-Gzip"] = "1";
    }
    const ctrl = new AbortController();
    const cancel = timers.after(TIMEOUT_MS, () => ctrl.abort());
    try {
      return await send(cfg.u + path, {
        method,
        headers,
        body: payload,
        signal: ctrl.signal,
        cache: "no-store",
      });
    } finally {
      cancel();
    }
  }

  async function hello(): Promise<void> {
    if (!sync.cfg) return setState("off", "");
    try {
      const r = await call("GET", "/api/hola");
      if (r.status === 401) return setState("auth", "clave no válida");
      if (!r.ok) return setState("offline", reason({ status: r.status }));
      const j: unknown = await r.json();
      if (!saysOk(j)) return setState("offline", "lo que contesta no es el garaje");
      setState("ok", "");
    } catch (e) {
      setState("offline", reason(e));
    }
  }

  async function fetchDay(): Promise<unknown> {
    if (!sync.cfg) throw new Error("sin garaje");
    const r = await call("GET", "/api/dia");
    if (r.status === 401) {
      setState("auth", "clave no válida");
      throw failed(401);
    }
    if (!r.ok) throw failed(r.status);
    return r.json();
  }

  async function syncNow(maxItems?: number): Promise<void> {
    if (!sync.cfg || sync.running) return;
    if (sync.state === "auth") return;
    sync.running = true;
    let sent = 0;
    try {
      const limit = maxItems || MANUAL_BATCH;
      while (sent < limit) {
        const next = await queue.nextChunk();
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
          cleanChunk(chunk),
        );
        if (r.status === 401) return setState("auth", "clave no válida");
        if (r.status === 400 || r.status === 413) {
          // El Mac no lo acepta: se queda en el móvil (exportable) y no bloquea la cola.
          await queue.markChunkDone(next, r.status);
        } else if (!r.ok) {
          throw failed(r.status);
        } else {
          await queue.markChunkDone(next);
        }
        sent++;
        if (sync.state !== "ok") setState("ok", "");
        else if (sync.onChange) sync.onChange();
      }
      const metas = await queue.pendingSessions();
      for (const m of metas) {
        const meta = Object.assign({}, m);
        delete meta.pend;
        const r = await call("PUT", "/api/tandas/" + m.id + "/meta", meta);
        if (r.status === 401) return setState("auth", "clave no válida");
        if (!r.ok && r.status !== 400) throw failed(r.status);
        // Si mientras subía se ha guardado una versión más nueva, esa sigue pendiente.
        const cur = await queue.session(m.id);
        if (cur && JSON.stringify(cur) === JSON.stringify(m))
          await queue.markSessionDone(m, r.ok ? 0 : r.status);
      }
      sync.wait = 0;
      if (sync.state !== "ok") setState("ok", "");
    } catch (e) {
      sync.wait = Math.min(MAX_WAIT_MS, sync.wait ? sync.wait * 2 : FIRST_WAIT_MS);
      sync.nextTry = now() + sync.wait;
      setState("offline", reason(e));
    } finally {
      sync.running = false;
      if (sync.onChange) sync.onChange();
    }
  }

  // Comprueba la cola cada pocos segundos; tras un fallo espera cada vez más (hasta 5 min).
  function startLoop(everyMs?: number, gapFn?: () => number): () => void {
    let lastRun = 0;
    return timers.every(everyMs || LOOP_MS, () => {
      if (!sync.cfg || sync.running || sync.state === "auth") return;
      if (now() < sync.nextTry) return;
      const gap = gapFn ? gapFn() : 0;
      if (gap && now() - lastRun < gap) return;
      lastRun = now();
      void syncNow(gap ? SLOW_BATCH : LOOP_BATCH);
    });
  }

  function configure(cfg: Partial<GarageConfig> | null | undefined): void {
    sync.cfg = isGarage(cfg) ? cfg : null;
    sync.wait = 0;
    sync.nextTry = 0;
    setState(sync.cfg ? "busy" : "off", "");
    if (sync.cfg) void hello().then(() => syncNow(LOOP_BATCH));
  }

  return { sync, syncNow, hello, fetchDay, startLoop, configure };
}
