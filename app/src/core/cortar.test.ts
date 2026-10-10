import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ride, type Loc } from "../../test/fixtures";
import { REAL_FILES, realRecording, type Recording } from "../../test/fixtures-recording";
import { legacy, loadLegacy } from "../../test/legacy";
import * as K from "./cortar";

// La app de antes, tal cual (cortar.js de la raíz del repo).
const old = legacy<typeof K>("MaspaCortar", "cortar.js");

// Varios recorridos seguidos, uno detrás de otro.
function concat(...parts: Loc[]): Loc {
  const out: Loc = { t: [], lat: [], lon: [], speed: [], hacc: [] };
  for (const p of parts)
    for (const col of ["t", "lat", "lon", "speed", "hacc"] as const) out[col].push(...p[col]);
  return out;
}
const lastT = (l: Loc) => l.t[l.t.length - 1];
// El siguiente recorrido empieza 1 s después del último fijo de este (ride pone el primero a los 0,37 s).
const after = (l: Loc) => lastT(l) + 1 - 0.37;

// Una carretera de montaña de ~1,9 km.
const road: [number, number][] = [
  [0, 0],
  [300, 120],
  [520, 40],
  [800, 260],
  [1000, 180],
  [1250, 450],
  [1500, 600],
];
const back = road.slice().reverse();

// Subida y bajada por la misma carretera, parando arriba `stopTop` s.
function outAndBack(stopTop: number): Loc {
  const up = ride(road, { v: 15, wait: 6, waitEnd: stopTop });
  return concat(up, ride(back, { v: 13, wait: 0, waitEnd: 8, t0: after(up) }));
}

// Arriba, dos paradas: una corta y, 60 m más allá, una más larga.
function twoStops(): Loc {
  const up = ride(road, { v: 15, wait: 6, waitEnd: 6 });
  const top = road[road.length - 1];
  const more = ride([top, [top[0] + 60, top[1]]], { v: 5, wait: 0, waitEnd: 9, t0: after(up) });
  const down = ride([[top[0] + 60, top[1]], ...back], { v: 13, wait: 0, t0: after(more) });
  return concat(up, more, down);
}

// Con fijos malos (precisión de 50 m, sin posición) y sin velocidad del GPS (-1) de vez en cuando.
function rough(l: Loc): Loc {
  const out = concat(l);
  for (let i = 0; i < out.t.length; i++) {
    if (i % 7 === 3) out.speed[i] = -1;
    if (i % 11 === 5) out.hacc[i] = 50;
    if (i % 23 === 9) out.lat[i] = NaN;
  }
  return out;
}

const cases: [string, Loc][] = [
  ["ida y vuelta sin parar arriba", outAndBack(0)],
  ["ida y vuelta parando 12 s arriba", outAndBack(12)],
  ["ida y vuelta con dos paradas arriba", twoStops()],
  ["ida y vuelta con fijos malos y sin velocidad", rough(outAndBack(10))],
  ["solo ida", ride(road, { v: 15 })],
  [
    "una vuelta por otro camino",
    ride(
      [
        [0, 0],
        [800, 0],
        [800, 600],
        [0, 600],
        [0, 0],
      ],
      { v: 15 },
    ),
  ],
  [
    "ida y vuelta de 300 m",
    ride(
      [
        [0, 0],
        [300, 0],
        [0, 0],
      ],
      { v: 8 },
    ),
  ],
  [
    "lo más lejos, al principio",
    concat(
      ride(
        [
          [0, 0],
          [700, 0],
        ],
        { v: 90, wait: 2, waitEnd: 0 },
      ),
      ride(
        [
          [700, 0],
          [0, 0],
        ],
        { v: 10, wait: 0, waitEnd: 3, t0: 9 },
      ),
    ),
  ],
  [
    "corta",
    ride(
      [
        [0, 0],
        [200, 0],
      ],
      { v: 15, wait: 2, waitEnd: 2 },
    ),
  ],
];

// Una columna como la une el directo (Float64Array; null → NaN).
const f64 = (a: ArrayLike<number | null>) => Float64Array.from(a, (x) => (x === null ? NaN : x));
type F64Series = { t: Float64Array } & { [col: string]: Float64Array };

// Las series de una grabación como las une el directo.
function merged(series: Recording["series"]): Record<string, F64Series> {
  const out: Record<string, F64Series> = {};
  for (const [key, s] of Object.entries(series)) {
    if (!s) continue;
    const cols: Record<string, Float64Array> = {};
    for (const [col, arr] of Object.entries(s as Record<string, (number | null)[]>))
      cols[col] = f64(arr);
    out[key] = cols as F64Series;
  }
  return out;
}

// Unas series de prueba: posiciones, aceleración (con su reloj 40 s por delante) unida, canales con huecos, una
// serie vacía, una nula y otra sin tiempo.
function sampleSeries() {
  const loc = outAndBack(10);
  loc.speed[4] = null as unknown as number;
  const n = Math.round(lastT(loc) * 10);
  const accT = Float64Array.from({ length: n }, (_, i) => i / 10 - 40);
  const wave = (k: number) => Float64Array.from(accT, (t) => Math.sin(t * k));
  const canalT = loc.t.filter((_, i) => i % 3 === 0);
  return {
    loc: { ...loc },
    acc: { t: accT, x: wave(1), y: wave(2), z: wave(3) },
    canal: {
      t: canalT,
      s: canalT.map(() => null),
      v: canalT.map((t, i) => (i % 5 === 2 ? null : t / 10)),
    },
    vacia: { t: [] as number[], x: [] as number[] },
    gyro: null,
    rara: { x: [1, 2, 3] } as unknown as K.Series,
  };
}

// Las posiciones como las ve el directo (Float64Array).
function locView(loc: Loc) {
  return {
    t: f64(loc.t),
    lat: f64(loc.lat),
    lon: f64(loc.lon),
    speed: f64(loc.speed),
    hacc: f64(loc.hacc),
  };
}

describe("cortar (igual que el de antes)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const [label, loc] of cases)
    it(label + ": puntos y dónde cortar, igual", () => {
      expect(K.track(loc)).toEqual(old.track(loc));
      expect(K.turnaround(loc)).toEqual(old.turnaround(loc));
    });

  it("reconoce las idas y vueltas y la parada de arriba", () => {
    const stop = K.turnaround(outAndBack(12));
    expect(stop).toMatchObject({ parada: true });
    expect(K.turnaround(outAndBack(0))).toMatchObject({ parada: false });
    // De las dos paradas, la larga.
    const two = K.turnaround(twoStops());
    expect(two && two.parada).toBe(true);
    for (const [label, loc] of cases.slice(4)) expect(K.turnaround(loc), label).toBeNull();
  });

  it("sin posiciones: nada", () => {
    const empty: Loc = { t: [], lat: [], lon: [], speed: [], hacc: [] };
    for (const loc of [empty, null, undefined]) {
      expect(K.track(loc)).toEqual(old.track(loc));
      expect(K.turnaround(loc)).toEqual(old.turnaround(loc));
      expect(K.lightSummary({ loc })).toEqual(old.lightSummary({ loc }));
    }
    expect(K.lightSummary({})).toEqual(old.lightSummary({}));
  });

  it("parte las series igual (antes, después y con el reloj de los sensores corrido)", () => {
    const S = sampleSeries();
    const t1 = lastT(S.loc);
    for (const tCut of [-5, 0, 40.2, t1 / 2, t1 + 50])
      for (const shift of [undefined, 0, 40, NaN]) {
        const mine = K.splitSeries(S, tCut, shift);
        expect(mine).toEqual(old.splitSeries(S, tCut, shift));
        // Siempre arrays normales, también de una Float64Array.
        for (const part of mine)
          for (const s of Object.values(part))
            for (const col of Object.values(s as Record<string, unknown>))
              expect(Array.isArray(col)).toBe(true);
      }
    const [A, B] = K.splitSeries(S, t1 / 2, 40);
    expect(Object.keys(A)).toEqual(["loc", "acc", "canal"]);
    expect(B.loc && B.loc.t[0]).toBeGreaterThanOrEqual(0);
  });

  it("trocea y resume igual", () => {
    const S = sampleSeries();
    const [A, B] = K.splitSeries(S, lastT(S.loc) / 2, 40);
    for (const part of [A, B]) {
      for (const every of [undefined, 25, 60])
        expect(K.chunksOf(part, "20261009-120000-abcd", 1760000000000, 1, every)).toEqual(
          old.chunksOf(part, "20261009-120000-abcd", 1760000000000, 1, every),
        );
      expect(K.lightSummary(part)).toEqual(old.lightSummary(part));
    }
    expect(K.chunksOf(A, "x", 1, 1).length).toBeGreaterThan(1);
    expect(K.lightSummary(A).distancia).toBeGreaterThan(0);
    // Un hueco de más de un minuto: el trozo vacío no está y los números siguen seguidos.
    const gap = {
      loc: {
        t: [0, 10, 200, 230],
        lat: [1, 2, 3, 4],
        lon: [1, 2, 3, 4],
        speed: [0, 1, 2, 3],
        hacc: [5, 5, 5, 5],
      },
    };
    const chunks = K.chunksOf(gap, "x", 1, 1);
    expect(chunks).toEqual(old.chunksOf(gap, "x", 1, 1));
    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
    // De Float64Array salen Float64Array, como antes.
    const typed = { loc: locView(outAndBack(0)) };
    expect(K.chunksOf(typed, "x", 1, 1)).toEqual(old.chunksOf(typed, "x", 1, 1));
    expect(K.chunksOf(typed, "x", 1, 1)[0].series.loc?.lat).toBeInstanceOf(Float64Array);
    expect(K.chunksOf({ vacia: { t: [], x: [] } }, "x", 1, 1)).toEqual([]);
    // Posiciones sin velocidad: la distancia, de las posiciones.
    const noSpeed = rough(outAndBack(5));
    noSpeed.speed = noSpeed.speed.map(() => -1);
    expect(K.lightSummary({ loc: noSpeed })).toEqual(old.lightSummary({ loc: noSpeed }));
  });

  it("id con la hora de su principio, igual", () => {
    const at = [Date.UTC(2026, 9, 9, 16, 31, 5), Date.UTC(2026, 2, 29, 1, 59, 59), 1760000000000];
    for (const ms of at) {
      const mine = K.idAt(ms);
      expect(mine).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
      expect(mine.slice(0, 15)).toBe(old.idAt(ms).slice(0, 15));
    }
    // Con el mismo azar, entero (también cuando sale corto y se rellena con ceros).
    const ctx = loadLegacy("cortar.js");
    const theirs = ctx.MaspaCortar as typeof K;
    for (const r of [0.123456789, 0.5, 0]) {
      vm.runInContext("Math.random = function () { return " + r + "; };", ctx);
      vi.spyOn(Math, "random").mockReturnValue(r);
      for (const ms of at) expect(K.idAt(ms)).toBe(theirs.idAt(ms));
    }
  });

  // Grabaciones de verdad: la subida y bajada de Los Loros (9 de octubre) es de ida y vuelta; las otras, no.
  const recs = REAL_FILES.map((file) => ({ file, rec: realRecording(file) }));
  for (const { file, rec } of recs) {
    if (!rec) {
      it.skip(file + " de verdad: sin PISTA_DATA en este ordenador", () => {});
      continue;
    }
    it(file + " de verdad: puntos, corte, series, trozos y resumen igual", () => {
      const loc = rec.series.loc;
      const mine = K.track(loc);
      expect(mine).toEqual(old.track(loc));
      if (loc) expect(mine.length).toBeGreaterThan(100);
      const turn = K.turnaround(loc);
      expect(turn).toEqual(old.turnaround(loc));
      // Donde se cortaría: en la vuelta atrás o, si no es de ida y vuelta, a la mitad.
      const t = rec.series.acc?.t ?? [0];
      const tCut = turn ? turn.t : (t[0] + t[t.length - 1]) / 2;
      const series = rec.series as K.SeriesSet;
      const [A, B] = K.splitSeries(series, tCut, 0);
      expect([A, B]).toEqual(old.splitSeries(series, tCut, 0));
      for (const part of [A, B, series])
        expect(K.lightSummary(part)).toEqual(old.lightSummary(part));
      for (const part of [A, B])
        expect(K.chunksOf(part, "x", rec.meta.epoch, 1)).toEqual(
          old.chunksOf(part, "x", rec.meta.epoch, 1),
        );
      // Igual con las series unidas como en el directo (Float64Array).
      if (loc) expect(K.turnaround(locView(loc))).toEqual(turn);
      const S = merged(rec.series);
      expect(K.splitSeries(S, tCut, 3)).toEqual(old.splitSeries(S, tCut, 3));
    });
  }
  const available = recs.filter((r) => r.rec);
  if (available.length)
    it("alguna ruta de verdad es de ida y vuelta (y las partes miden lo suyo)", () => {
      const found = available.filter(({ rec }) => rec && K.turnaround(rec.series.loc));
      expect(found.length).toBeGreaterThan(0);
      for (const { rec } of found) {
        if (!rec) continue;
        const turn = K.turnaround(rec.series.loc);
        if (!turn) continue;
        const [A, B] = K.splitSeries(rec.series as K.SeriesSet, turn.t, 0);
        expect(K.lightSummary(A).distancia).toBeGreaterThan(1000);
        expect(K.lightSummary(B).distancia).toBeGreaterThan(1000);
      }
    });
});
