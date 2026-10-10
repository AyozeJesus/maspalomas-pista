// Un navegador falso para comparar el almacén nuevo con el de antes (store.js): base de datos en memoria
// (fake-indexeddb), reloj y temporizadores que avanzan a mano, y una red con un «garaje» que contesta lo que pida cada
// prueba y apunta todo lo que le llega. Cada prueba corre igual en los dos y compara lo que pasa.
import "fake-indexeddb/auto"; // idb y los rangos de claves usan las clases IDB* globales
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { expect } from "vitest";
import {
  createStore,
  type RecordedChunk,
  type SessionMeta,
  type StorageLike,
  type SyncState,
  type Timers,
} from "../src/storage";
import { loadLegacyStore, type LegacyPistaStore } from "./legacy-store";

// ---------- reloj ----------
interface Timer {
  at: number;
  every: number;
  fn: () => void;
}

export class FakeClock {
  private t: number;
  private seq = 0;
  private readonly pending = new Map<number, Timer>();

  constructor(start: number) {
    this.t = start;
  }

  readonly now = (): number => this.t;
  readonly setTimeout = (fn: () => void, ms: number): number => this.add(fn, ms, 0);
  readonly setInterval = (fn: () => void, ms: number): number => this.add(fn, ms, ms);
  readonly clearTimeout = (id: number): void => {
    this.pending.delete(id);
  };
  readonly clearInterval = (id: number): void => {
    this.pending.delete(id);
  };
  // Los mismos, como los pide el almacén nuevo.
  readonly timers: Timers = {
    after: (ms, fn) => {
      const id = this.setTimeout(fn, ms);
      return () => this.clearTimeout(id);
    },
    every: (ms, fn) => {
      const id = this.setInterval(fn, ms);
      return () => this.clearInterval(id);
    },
  };

  // Temporizadores sin disparar ni cancelar.
  count(): number {
    return this.pending.size;
  }

  private add(fn: () => void, ms: number, every: number): number {
    const id = ++this.seq;
    this.pending.set(id, { at: this.t + ms, every, fn });
    return id;
  }

  // Adelanta el reloj y dispara por orden lo que venza (cada intervalo, todas las veces que le toque).
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let due: [number, Timer] | null = null;
      for (const e of this.pending) if (e[1].at <= end && (!due || e[1].at < due[1].at)) due = e;
      if (!due) break;
      const [id, timer] = due;
      this.t = timer.at;
      if (timer.every) timer.at += timer.every;
      else this.pending.delete(id);
      timer.fn();
    }
    this.t = end;
  }
}

// ---------- red ----------
// Una petición tal como le llega al garaje falso (el cuerpo, ya descomprimido y leído).
export interface Sent {
  at: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  cache: RequestCache | undefined;
  signal: boolean;
  gzip: boolean;
  body: unknown;
}

// Lo que contesta: un código con JSON (o texto), un fallo de red, o nada hasta que se cancele.
export type Reply = { status: number; json?: unknown; text?: string } | "neterror" | "hang";
export type Route = (req: Sent) => Reply | Promise<Reply>;

async function decode(body: BodyInit | null | undefined): Promise<unknown> {
  if (body === undefined || body === null) return undefined;
  const text =
    body instanceof Blob
      ? await new Response(body.stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : String(body);
  return JSON.parse(text);
}

export class FakeNet {
  readonly sent: Sent[] = [];
  // Peticiones sin contestar, a la espera de que las cancele el almacén.
  hanging = 0;
  route: Route = () => ({ status: 200, json: { ok: true } });

  constructor(private readonly clock: FakeClock) {}

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const req: Sent = {
      at: this.clock.now(),
      url,
      method: init.method ?? "",
      headers: { ...(init.headers as Record<string, string>) },
      cache: init.cache,
      signal: init.signal instanceof AbortSignal,
      gzip: init.body instanceof Blob,
      body: await decode(init.body),
    };
    this.sent.push(req);
    const reply = await this.route(req);
    if (reply === "neterror") throw new TypeError("fetch failed");
    if (reply === "hang") return this.hang(init.signal);
    return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), { status: reply.status });
  };

  private hang(signal: AbortSignal | null | undefined): Promise<Response> {
    this.hanging++;
    return new Promise((_, reject) => {
      signal?.addEventListener("abort", () => {
        this.hanging--;
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
  }
}

export function pathOf(req: Sent): string {
  return req.method + " " + new URL(req.url).pathname;
}

// Espera (con tiempo de verdad, sin tocar el reloj falso) a que se cumpla pred.
export async function until(pred: () => boolean, what = "la condición"): Promise<void> {
  const end = Date.now() + 3000;
  while (!pred()) {
    if (Date.now() > end) throw new Error("No se cumple: " + what);
    await new Promise((r) => setImmediate(r));
  }
}

// Deja correr lo que esté en marcha (promesas y tareas) sin tocar el reloj falso.
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

// Que acabe lo que esté haciendo la subida (saludar al Mac y subir).
export function settle(store: { sync: SyncState }): Promise<void> {
  return until(() => !store.sync.running && store.sync.state !== "busy", "que acabe la subida");
}

// ---------- datos ----------
export const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
export const A = "20261010-101500-ab12";
export const B = "20261010-113000-cd34";
export const C = "20261009-090000-ef56";
export const IDS = [A, B, C];
export const CFG = { u: "https://garaje.ejemplo.net", k: "clave-de-este-movil-0123" };

// Un resumen como los que guarda el directo (saveMeta).
export function meta(id: string, estado: string, extra: Record<string, unknown> = {}): SessionMeta {
  return {
    v: 1,
    id,
    epoch: T0,
    inicio: new Date(T0).toISOString(),
    fin: estado === "grabando" ? null : new Date(T0 + 600000).toISOString(),
    estado,
    sim: false,
    app: "v28",
    tipo: "ruta",
    recorrido: { km: 12.4, vMax: 31.2 },
    piloto: "Ayoze",
    objetivo: null,
    sentido: "normal",
    mejor: 95.432,
    gps: null,
    caidas: null,
    circuito: null,
    segmento: 1,
    anguloPantalla: 0,
    calibrado: true,
    montaje: { angulo: 0, postura: "de pie" },
    calibracionManual: null,
    vueltas: [{ num: 1, time: 95.432, valid: true, sectors: [30.1, 33.3, 32.032], corners: null }],
    analisis: null,
    ...extra,
  };
}

// Un trozo como los que graba el directo (columnas Float64Array, con NaN) y una serie en arrays con null.
export function chunk(id: string, seq: number, n: number): RecordedChunk {
  const t0 = seq * 5;
  const col = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
  return {
    v: 1,
    id,
    seq,
    epoch: T0,
    series: {
      loc: {
        t: col((i) => t0 + i),
        lat: col((i) => 27.75 + i * 1e-5),
        lon: col((i) => -15.6 - i * 1e-5),
        speed: col((i) => (i === 2 ? NaN : 20 + i)),
        hacc: col(() => 4),
      },
      acc: {
        t: col((i) => t0 + i * 0.01),
        x: col((i) => Math.sin(i)),
        y: col((i) => Math.cos(i)),
        z: col((i) => (i % 7 === 3 ? NaN : 9.8)),
      },
      canal: {
        t: [t0, t0 + 1],
        s: [0, 12.5],
        v: [20, null],
        a: [0.1, 0.2],
        lean: [5, -3],
        lap: [1, 1],
      },
    },
  };
}

// Dos tandas (una terminada, otra que quedó grabando) con sus trozos, guardadas en otro orden.
export async function seed(store: LegacyPistaStore): Promise<void> {
  await store.putChunk(chunk(B, 1, 5));
  await store.putSession(meta(A, "terminada"));
  await store.putChunk(chunk(A, 1, 30));
  await store.putChunk(chunk(A, 0, 30));
  await store.putSession(meta(B, "grabando"));
  await store.putChunk(chunk(B, 0, 20));
}

// ---------- mundos ----------
export type SyncSnapshot = Omit<SyncState, "onChange">;

function snapshot(s: SyncState): SyncSnapshot {
  return {
    cfg: s.cfg && { ...s.cfg },
    state: s.state,
    lastOk: s.lastOk,
    lastError: s.lastError,
    running: s.running,
    wait: s.wait,
    nextTry: s.nextTry,
  };
}

export interface World {
  clock: FakeClock;
  net: FakeNet;
  // La base de este mundo (undefined: sin IndexedDB).
  factory: IDBFactory | undefined;
  store: LegacyPistaStore;
  // Cada aviso de cambio (onChange), con el estado de la subida en ese momento.
  changes: SyncSnapshot[];
}

export interface WorldOptions {
  // Subir comprimido (CompressionStream).
  gzip?: boolean;
  // La base de cada mundo (undefined: navegador sin IndexedDB). Por omisión, una nueva vacía para cada uno.
  factory?: () => IDBFactory | undefined;
  storage?: StorageLike;
}

export function world(kind: "old" | "new", opts: WorldOptions = {}): World {
  const clock = new FakeClock(T0);
  const net = new FakeNet(clock);
  const factory = opts.factory ? opts.factory() : new IDBFactory();
  const gzip = opts.gzip ? CompressionStream : undefined;
  const store: LegacyPistaStore =
    kind === "old"
      ? loadLegacyStore({
          indexedDB: factory,
          IDBKeyRange,
          fetch: net.fetch,
          setTimeout: clock.setTimeout,
          clearTimeout: clock.clearTimeout,
          setInterval: clock.setInterval,
          clearInterval: clock.clearInterval,
          now: clock.now,
          CompressionStream: gzip,
          navigator: opts.storage && { storage: opts.storage },
        })
      : createStore({
          indexedDB: factory,
          fetch: net.fetch,
          timers: clock.timers,
          now: clock.now,
          compression: gzip,
          storage: opts.storage,
        });
  const changes: SyncSnapshot[] = [];
  store.sync.onChange = () => changes.push(snapshot(store.sync));
  return { clock, net, factory, store, changes };
}

// Lo guardado: las tandas, los trozos de cada una y lo pendiente.
export async function dump(store: LegacyPistaStore): Promise<unknown> {
  return {
    sessions: await store.sessions(),
    chunks: await Promise.all(IDS.map((id) => store.chunksOf(id))),
    pending: await store.pendingCounts(),
  };
}

export interface Played {
  result: unknown;
  sent: Sent[];
  changes: SyncSnapshot[];
  // Temporizadores que quedan puestos (el bucle, o un corte de 25 s sin quitar).
  timers: number;
  // Lo que da el almacén y los registros tal cual están en la base.
  db: unknown;
  raw: unknown;
}

export async function play(
  kind: "old" | "new",
  scenario: (w: World) => Promise<unknown>,
  opts: WorldOptions & { dump?: boolean } = {},
): Promise<Played> {
  const w = world(kind, opts);
  const result = await scenario(w);
  const db = opts.dump === false ? null : await dump(w.store);
  const raw =
    opts.dump === false || !w.factory
      ? null
      : {
          sesiones: await rawAll(w.factory, "sesiones"),
          trozos: await rawAll(w.factory, "trozos"),
        };
  return { result, sent: w.net.sent, changes: w.changes, timers: w.clock.count(), db, raw };
}

// Corre lo mismo con el de antes y con el nuevo (cada uno en su mundo) y exige que pase lo mismo: resultado,
// peticiones al garaje, avisos de cambio y lo que queda guardado (por el almacén y en la base). Devuelve lo del nuevo.
export async function same(
  scenario: (w: World) => Promise<unknown>,
  opts: WorldOptions & { dump?: boolean } = {},
): Promise<Played> {
  const theirs = await play("old", scenario, opts);
  const mine = await play("new", scenario, opts);
  expect(mine).toEqual(theirs);
  return mine;
}

// Lo que se ve de un error (de cualquier contexto): nombre, mensaje y código del Mac.
export function errorOf(e: unknown): {
  error: { name: unknown; message: unknown; status: unknown };
} {
  const x: { name?: unknown; message?: unknown; status?: unknown } = Object(e);
  return { error: { name: x.name, message: x.message, status: x.status } };
}

// ---------- la base, por dentro ----------
// Abre «pista» tal cual (sin almacén de por medio), para mirar qué hay de verdad.
function rawOpen(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open("pista");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Nombre, versión, almacenes, claves e índices.
export async function schemaOf(factory: IDBFactory): Promise<unknown> {
  const db = await rawOpen(factory);
  const names = Array.from(db.objectStoreNames);
  const t = db.transaction(names);
  const stores = names.map((name) => {
    const st = t.objectStore(name);
    return {
      name,
      keyPath: st.keyPath,
      autoIncrement: st.autoIncrement,
      indexes: Array.from(st.indexNames).map((i) => {
        const ix = st.index(i);
        return { name: i, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
      }),
    };
  });
  db.close();
  return { name: db.name, version: db.version, stores };
}

// Todos los registros de un almacén, con sus claves.
export async function rawAll(factory: IDBFactory, store: "sesiones" | "trozos"): Promise<unknown> {
  const db = await rawOpen(factory);
  const st = db.transaction(store).objectStore(store);
  const read = <T>(req: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const [keys, values] = await Promise.all([read(st.getAllKeys()), read(st.getAll())]);
  db.close();
  return { keys, values };
}

// Una fábrica que falla las primeras aperturas (bloqueada o con error) y luego abre de verdad.
export function flakyFactory(how: "blocked" | "error", times = 1): IDBFactory {
  const real = new IDBFactory();
  let left = times;
  return {
    open(name: string, version?: number): IDBOpenDBRequest {
      if (left-- <= 0) return real.open(name, version);
      const req: Record<string, unknown> & { onblocked?: () => void; onerror?: () => void } = {
        error: new DOMException("no se puede abrir", "UnknownError"),
      };
      setImmediate(() => (how === "blocked" ? req.onblocked?.() : req.onerror?.()));
      return req as unknown as IDBOpenDBRequest;
    },
    deleteDatabase: (name: string) => real.deleteDatabase(name),
    cmp: (a: unknown, b: unknown) => real.cmp(a, b),
    databases: () => real.databases(),
  };
}
