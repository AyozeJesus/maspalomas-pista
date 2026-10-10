import { describe, expect, it } from "vitest";
import { along, ride, switchbacks, toLatLon, type Loc } from "../../../../../test/fixtures";
import { legacy, liveFunctions } from "../../../../../test/legacy";
import { fromLoc, type LatLon, type LocSeries, type Tramo } from "../../../../core/tramos";
import { memoryKV } from "../../../../engine/kv";
import { TRAMOS_KEY } from "../../../../services/tramos-store";
import type { StoredChunk, StoredSession } from "../../../../storage";
import { locOf, scanTramo } from "./scan";

// La búsqueda de antes (live.js), con su localStorage y su PistaStore de mentira, frente a la nueva con los suyos: las
// mismas grabaciones y los mismos tramos dan las mismas pasadas, el mismo progreso y el mismo texto guardado.
type Progress = (i: number, total: number) => void;
interface Old {
  locOf(chunks: StoredChunk[]): LocSeries;
  scanTramo(id: string, onProgress?: Progress): Promise<number>;
}
interface FakeStore {
  sessions(): Promise<StoredSession[]>;
  chunksOf(id: string): Promise<StoredChunk[]>;
}

function fakeLocalStorage(raw: string) {
  const m = new Map([[TRAMOS_KEY, raw]]);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

function oldScan(raw: string, store: FakeStore | null) {
  const ls = fakeLocalStorage(raw);
  const fns = liveFunctions<Old>(
    [
      "load",
      "store",
      "loadTramos",
      "isGateTramo",
      "saveTramos",
      "recordPass",
      "locOf",
      "scanTramo",
    ],
    {
      consts: ["TRAMOS_KEY"],
      globals: {
        localStorage: ls,
        MaspaTramos: legacy("MaspaTramos", "tramos.js"),
        F: legacy("MaspaFormato", "formato.js"),
        ST: store,
        setTimeout,
      },
    },
  );
  return { fns, raw: () => ls.getItem(TRAMOS_KEY) };
}

// ---------- grabaciones ----------
const DAY = 86400000;
const EPOCH = Date.UTC(2026, 9, 9, 15, 0, 0);
// Dos carreteras: la de montaña (herraduras) y una en L, a más de 600 m.
const R1 = switchbacks();
const R2: [number, number][] = [
  [0, 1000],
  [2500, 1000],
  [2500, 2500],
];

// La serie «loc» de un trozo como la guarda el móvil: listas con null donde no hay dato.
function locChunk(id: string, seq: number, loc: Loc, from: number, to: number): StoredChunk {
  const cut = (a: number[]) => a.slice(from, to).map((x, i) => ((i + from) % 97 === 5 ? null : x));
  return {
    v: 1,
    id,
    seq,
    epoch: EPOCH,
    series: {
      loc: {
        t: loc.t.slice(from, to),
        lat: cut(loc.lat),
        lon: loc.lon.slice(from, to),
        speed: cut(loc.speed),
        hacc: cut(loc.hacc),
      },
    },
  };
}

interface Rec {
  meta: StoredSession;
  chunks: StoredChunk[] | "falla";
}

function recording(
  id: string,
  epoch: number,
  loc: Loc | null,
  extra: Partial<StoredSession> = {},
): Rec {
  const meta: StoredSession = { id, epoch, estado: "terminada", tipo: "ruta", ...extra };
  if (!loc) return { meta, chunks: [] };
  const half = Math.floor(loc.t.length / 2);
  // En dos trozos, desordenados: se juntan por su número.
  return {
    meta,
    chunks: [locChunk(id, 1, loc, half, loc.t.length), locChunk(id, 0, loc, 0, half)],
  };
}

const r1a = ride(R1, { v: 18 });
const r1b = ride(R1, { v: 22, wait: 9 });
const r2a = ride(R2, { v: 20 });
const r2b = ride(R2, { v: 25, wait: 3 });
const RECS: Rec[] = [
  recording("20261009-170000-aaaa", EPOCH, r1a),
  recording("20261009-160000-sim1", EPOCH, r2a, { sim: true }),
  recording("20261008-170000-bbbb", EPOCH - DAY, r1b),
  recording("20261008-160000-grab", EPOCH - DAY, r2a, { estado: "grabando" }),
  recording("20261007-170000-cccc", EPOCH - 2 * DAY, r2a),
  recording("20261007-160000-vaci", EPOCH - 2 * DAY, null),
  { meta: { id: "20261006-180000-roto", epoch: EPOCH - 3 * DAY }, chunks: "falla" },
  // Un trozo sin la columna de la precisión: no se puede leer y se salta.
  {
    meta: { id: "20261006-175000-mala", epoch: EPOCH - 3 * DAY },
    chunks: [
      {
        v: 1,
        id: "20261006-175000-mala",
        seq: 0,
        epoch: EPOCH,
        series: { loc: { t: [1], lat: [27.75], lon: [-15.6], speed: [3] } },
      } as unknown as StoredChunk,
    ],
  },
  recording("20261006-170000-dddd", EPOCH - 3 * DAY, r2b),
];

function fakeStore(recs: Rec[]): FakeStore {
  return {
    sessions: async () => recs.map((r) => r.meta),
    chunksOf: async (id) => {
      const r = recs.find((x) => x.meta.id === id);
      if (!r) return [];
      if (r.chunks === "falla") throw new Error("lectura");
      return r.chunks;
    },
  };
}

// ---------- tramos ----------
const ll = (poly: [number, number][], s: number): LatLon => {
  const [x, y] = along(poly, s);
  const [lat, lon] = toLatLon(x, y);
  return [+lat.toFixed(6), +lon.toFixed(6)];
};
const camino = fromLoc(r1a);
if (!camino) throw new Error("sin camino");
const TRAMOS: Tramo[] = [
  { id: "camino", nombre: "Herraduras", largo: camino.largo, pts: camino.pts, pasadas: [] },
  { id: "puertas", nombre: "La L", salida: ll(R2, 150), meta: ll(R2, 3500), pasadas: [] },
  { id: "lejos", nombre: "Lejos", salida: [28.1, -15.4], meta: [28.12, -15.42], pasadas: [] },
];

async function both(
  id: string,
  recs: Rec[] = RECS,
  raw = JSON.stringify(TRAMOS),
  withStore = true,
) {
  const old = oldScan(raw, withStore ? fakeStore(recs) : null);
  const kv = memoryKV();
  kv.setRaw(TRAMOS_KEY, raw);
  const pOld: [number, number][] = [];
  const pNew: [number, number][] = [];
  const nOld = await old.fns.scanTramo(id, (i, n) => pOld.push([i, n]));
  const nNew = await scanTramo({ kv, store: withStore ? fakeStore(recs) : null }, id, (i, n) =>
    pNew.push([i, n]),
  );
  return { nOld, nNew, pOld, pNew, rawOld: old.raw(), rawNew: kv.getRaw(TRAMOS_KEY) };
}

describe("las posiciones de una grabación", () => {
  it("juntadas por número de trozo, con NaN donde no hay dato, como antes", () => {
    const { fns } = oldScan("[]", null);
    for (const r of RECS) {
      if (r.chunks === "falla" || r.meta.id.endsWith("mala")) continue;
      const mine = locOf(r.chunks);
      expect(mine).toEqual(JSON.parse(JSON.stringify(fns.locOf(r.chunks)), (_k, v) => v ?? NaN));
      expect(Object.keys(mine)).toEqual(["t", "lat", "lon", "speed", "hacc"]);
    }
    const one = locOf((RECS[0].chunks as StoredChunk[]).slice());
    expect(one.t).toEqual(r1a.t);
    expect(Number.isNaN(one.lat[5])).toBe(true);
  });
});

describe("«Buscar» un tramo en las rutas guardadas", () => {
  it("un tramo con camino: sus pasadas en las dos rutas por la carretera de montaña", async () => {
    const r = await both("camino");
    expect(r.nNew).toBe(r.nOld);
    expect(r.nNew).toBe(2);
    expect(r.pNew).toEqual(r.pOld);
    // Sin la vuelta de ejemplo ni la que se está grabando: 7 de 9.
    expect(r.pNew.map((p) => p.join("/"))).toEqual([
      "1/7",
      "2/7",
      "3/7",
      "4/7",
      "5/7",
      "6/7",
      "7/7",
    ]);
    expect(r.rawNew).toBe(r.rawOld);
  });

  it("uno de salida y meta: la primera pasada le enseña el camino y la segunda ya se mide con él", async () => {
    const r = await both("puertas");
    expect(r.nNew).toBe(r.nOld);
    expect(r.nNew).toBe(2);
    expect(r.rawNew).toBe(r.rawOld);
    const saved = (JSON.parse(r.rawNew ?? "[]") as Tramo[]).find((t) => t.id === "puertas");
    expect(saved?.pts?.length).toBeGreaterThan(100);
    expect(saved?.pasadas.map((p) => p.sesion)).toEqual([
      "20261007-170000-cccc",
      "20261006-170000-dddd",
    ]);
    expect(saved?.pasadas[1].tiempos.length).toBeGreaterThan(100);
  });

  it("buscar otra vez no repite pasadas", async () => {
    const first = await both("puertas");
    const again = await both("puertas", RECS, first.rawNew ?? "[]");
    expect(again.nNew).toBe(0);
    expect(again.nOld).toBe(0);
    expect(again.rawNew).toBe(again.rawOld);
  });

  it("sin pasadas, sin el tramo o sin almacén: 0, como antes", async () => {
    for (const [id, withStore] of [
      ["lejos", true],
      ["no-está", true],
      ["camino", false],
    ] as const) {
      const r = await both(id, RECS, JSON.stringify(TRAMOS), withStore);
      expect(r.nNew).toBe(0);
      expect(r.nOld).toBe(0);
      expect(r.rawNew).toBe(r.rawOld);
      expect(r.pNew).toEqual(r.pOld);
    }
  });
});
