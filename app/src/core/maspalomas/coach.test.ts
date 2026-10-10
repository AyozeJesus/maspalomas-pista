import { describe, expect, it } from "vitest";
import { fastGps, firstFixes, reversedGps } from "../../../test/fixtures-maspalomas-sessions";
import { legacyInternals, legacyMaspalomas, outcome, plain } from "../../../test/legacy-maspalomas";
import * as C from "./coach";
import { demoSession } from "./demo";
import { fuseDistance, segmentsOnTrack } from "./distance";
import { kalmanSpeed } from "./kalman";
import { cutLaps } from "./laps";
import { cornerMetrics, sectorTimes } from "./metrics";
import * as T from "./telemetry";
import { ring } from "./numeric";
import type { AnalyzeResult, CoachOptions, CoachResult, Fix, Session } from "./types";

// Metros de a hasta b hacia delante en una vuelta de L.
const ringGap = (a: number, b: number, L: number) => ring(b - a, L);

// La app de antes, tal cual: lo que publicaba y sus funciones internas.
const old = legacyMaspalomas();
const oldIn = legacyInternals();

const d7 = demoSession({ seed: 7 });
const d11 = demoSession({ seed: 11 });
const sessions: [string, Session][] = [
  ["semilla 7", d7.session],
  ["semilla 11", d11.session],
  ["solo GPS", { loc: d7.session.loc, warnings: [] }],
  ["GPS a 5 Hz", fastGps(d7)],
  ["al revés", reversedGps(d7.session)],
];
// Cada versión con su propio análisis (el entrenador busca la mejor vuelta entre las suyas, por identidad).
const results = sessions.map(([label, s]) => ({
  label,
  mine: T.analyze(s),
  theirs: old.telemetry.analyze(s),
}));

// Lo que devuelve coach, con los minisectores de cada vuelta (una función) ya llamados.
function coachView(c: CoachResult | null, r: AnalyzeResult) {
  if (!c) return null;
  return {
    c: plain(c),
    minis: r.laps.map((l) => c.minis.lap(l.num)).concat([c.minis.lap(999)]),
  };
}

describe("puntos de mejora y entrenador (igual que los de antes)", () => {
  for (const { label, mine, theirs } of results)
    it(label + ": insights de cada vuelta frente al objetivo y a la mejor, igual", () => {
      expect(plain(mine)).toEqual(plain(theirs));
      expect(mine.laps.length).toBeGreaterThan(3);
      const best = mine.best;
      const tBest = theirs.best;
      if (!best || !tBest) throw new Error("sin mejor vuelta");
      for (const [k, lap] of mine.laps.entries()) {
        expect(T.insights(lap, mine.ref.metrics, mine.ref.sectors, { ref: "el objetivo" })).toEqual(
          plain(
            old.telemetry.insights(theirs.laps[k], theirs.ref.metrics, theirs.ref.sectors, {
              ref: "el objetivo",
            }),
          ),
        );
        expect(T.insights(lap, best.corners, best.sectors, { ref: "tu mejor" })).toEqual(
          plain(
            old.telemetry.insights(theirs.laps[k], tBest.corners, tBest.sectors, {
              ref: "tu mejor",
            }),
          ),
        );
      }
      const ins = T.insights(mine.laps[0], mine.ref.metrics, mine.ref.sectors, {
        ref: "el objetivo",
      });
      expect(ins.length).toBe(4);
      expect(ins.some((x) => x.tips.length > 0)).toBe(true);
    });

  for (const [i, { label, mine, theirs }] of results.entries())
    it(label + ": coach con cada referencia y cada vuelta, igual", () => {
      // La mejor vuelta de otra tanda como referencia de «otro piloto».
      const other = results[(i + 1) % results.length];
      const ext = (r: AnalyzeResult, withAll: boolean) => {
        const b = r.best;
        if (!b) throw new Error("sin mejor vuelta");
        return withAll
          ? { grid: b.grid, corners: b.corners, time: b.time, label: "Ana" }
          : { grid: b.grid, time: b.time };
      };
      const opts = (r: AnalyzeResult, o: AnalyzeResult): (CoachOptions | undefined)[] => [
        undefined,
        {},
        { ref: "objetivo" },
        { ref: "mejor" },
        { ref: ext(o, true) },
        { ref: ext(o, false) },
        ...r.laps.map((l) => ({ lap: { num: l.num } })),
        { lap: { num: 999 }, ref: "mejor" },
        { lap: null },
      ];
      const mineOpts = opts(mine, other.mine);
      const theirOpts = opts(theirs, other.theirs);
      for (const [k, o] of mineOpts.entries()) {
        const a = outcome(() => coachView(T.coach(mine, o), mine));
        const b = outcome(() => coachView(old.telemetry.coach(theirs, theirOpts[k]), theirs));
        expect(a).toEqual(b);
      }
      const c = T.coach(mine);
      if (!c) throw new Error("sin entrenador");
      expect(c.phases.length).toBe(12);
      expect(c.laps.length).toBe(mine.laps.filter((l) => l.valid).length);
      expect(c.plan.length).toBeGreaterThan(0);
      expect(c.consistency.length).toBe(4);
    });

  it("sin vueltas válidas no hay entrenador (igual)", () => {
    const s = firstFixes(d7.session, 40);
    const r = T.analyze(s);
    expect(T.coach(r)).toBeNull();
    expect(old.telemetry.coach(old.telemetry.analyze(s))).toBeNull();
  });
});

describe("del GPS a las vueltas: funciones internas (igual que las de antes)", () => {
  it("marcha atrás por la meta, un salto, un hueco y un tramo más corto que la rejilla: igual", () => {
    const L = 2229.87;
    const fix = (t: number, s: number, on = true): Fix => ({
      t,
      x: 0,
      y: 0,
      speed: 5,
      hacc: 3,
      s,
      idx: 0,
      on,
    });
    const fixes: Fix[] = [];
    // Despacio hacia atrás cruzando la meta (s de 40 a L − 30).
    for (let k = 0; k < 15; k++) fixes.push(fix(k, (((40 - 5 * k) % L) + L) % L));
    fixes.push(fix(15, 500)); // salto del GPS
    fixes.push(fix(15.5, 501, false)); // fuera de pista
    // Tras 6 s sin fijos, una ráfaga de 12 en 0,11 s (más corta que un paso de la rejilla de 1 s).
    for (let k = 0; k < 12; k++) fixes.push(fix(21 + k * 0.01, 100 + k * 0.05));
    const gpsT = fixes.map((f) => f.t);
    const tg = Float64Array.from({ length: 40 }, (_, k) => k);
    const v = Float64Array.from(tg, () => 5);
    const fa = structuredClone(fixes);
    const fb = structuredClone(fixes);
    const segs = segmentsOnTrack(fa, gpsT, L);
    expect(plain(segs)).toEqual(plain(oldIn.segmentsOnTrack(fb, gpsT, L)));
    expect(plain(fa)).toEqual(plain(fb));
    expect(segs.length).toBe(2);
    expect(fa[15].outlier).toBe(true);
    const sA = new Float64Array(tg.length).fill(NaN);
    const sB = new Float64Array(tg.length).fill(NaN);
    for (const seg of segs) {
      fuseDistance(seg, fa, gpsT, tg, v, sA, L, 1);
      oldIn.fuseDistance(seg, fb, gpsT, tg, v, sB, L, 1);
    }
    expect(Array.from(sA)).toEqual(Array.from(sB));
    expect(sA.some((x) => !isNaN(x))).toBe(true);
  });

  it("límites de fase con curvas más juntas que sus fases: igual", () => {
    const r = results[0].mine;
    const L = r.track.L;
    const close = r.ref.corners.map((c, k) => ({ ...c, sApex: [100, 160, 1200, 1250][k] }));
    for (const ms of [[r.ref.metrics, ...r.laps.map((l) => l.corners)], []]) {
      const bounds = C.phaseBounds(close, L, ms);
      expect(bounds).toEqual(plain(oldIn.phaseBounds(close, L, ms)));
      expect(C.phasesOf(bounds)).toEqual(plain(oldIn.phasesOf(bounds)));
      // Entre dos curvas quedan al menos 10 m de recta.
      expect(ringGap(bounds[0].exitEnd, bounds[1].entry, L)).toBeGreaterThan(9.99);
    }
  });

  for (const { label, mine: r } of results)
    it(label + ": Kalman, tramos, distancia fusionada y corte de vueltas igual", () => {
      const tg = r.timeline.t;
      const hz = Math.round(1 / (tg[1] - tg[0]));
      const gpsT = r.fixes.map((f) => f.t - r.lag);
      const fv = r.fixes.map((f) => f.speed);
      const holes = fv.map((x, k) => (k < 3 || k % 19 === 4 ? NaN : x));
      for (const v of [fv, holes])
        expect(Array.from(kalmanSpeed(tg, r.timeline.a, gpsT, v, hz))).toEqual(
          plain(oldIn.kalmanSpeed(tg, r.timeline.a, gpsT, v, hz)),
        );
      // Tramos en pista (marcan los fijos que saltan), desde fijos sin marcar.
      const fresh = () => structuredClone(r.fixes).map((f) => ({ ...f, outlier: undefined }));
      const fa = fresh();
      const fb = fresh();
      const segs = segmentsOnTrack(fa, gpsT, r.track.L);
      expect(plain(segs)).toEqual(plain(oldIn.segmentsOnTrack(fb, gpsT, r.track.L)));
      expect(plain(fa)).toEqual(plain(fb));
      expect(segs.length).toBeGreaterThan(0);
      const sA = new Float64Array(tg.length).fill(NaN);
      const sB = new Float64Array(tg.length).fill(NaN);
      const v = r.timeline.v;
      for (const seg of segs) {
        fuseDistance(seg, fa, gpsT, tg, v, sA, r.track.L, hz);
        oldIn.fuseDistance(seg, fb, gpsT, tg, v, sB, r.track.L, hz);
      }
      expect(Array.from(sA)).toEqual(Array.from(sB));
      expect(Array.from(sA)).toEqual(Array.from(r.timeline.s));
      // Corte de vueltas, también con un hueco en la distancia (esa vuelta no cuenta).
      const R = Float64Array.from(r.timeline.lean, (l, k) =>
        Math.abs(l) > 1
          ? v[k] ** 2 / (9.80665 * Math.tan((Math.abs(l) * Math.PI) / 180))
          : Infinity,
      );
      const gap = Float64Array.from(sA, (x, k) =>
        k > tg.length / 2 && k < tg.length / 2 + 40 ? NaN : x,
      );
      for (const sF of [sA, gap]) {
        const mine = cutLaps(tg, sF, v, r.timeline.a, r.timeline.lean, R, r.track, segs, hz);
        expect(plain(mine)).toEqual(
          plain(oldIn.cutLaps(tg, sF, v, r.timeline.a, r.timeline.lean, R, r.track, segs, hz)),
        );
        expect(mine.length).toBeGreaterThan(2);
      }
    });

  for (const { label, mine: r } of results)
    it(label + ": métricas por curva, sectores y fases igual", () => {
      const L = r.track.L;
      const shiftedCorners = r.ref.corners.map((c, k) => ({
        ...c,
        sApex: (c.sApex + [37, -500, 0, L][k]) % L,
      }));
      const cornerSets = [
        r.ref.corners,
        shiftedCorners,
        r.ref.corners.slice(1),
        r.ref.corners.slice(0, 1),
      ];
      const grids = [r.ref.grid, ...r.laps.map((l) => l.grid)];
      for (const grid of grids)
        for (const cs of cornerSets) {
          expect(plain(cornerMetrics(grid, cs, r.track))).toEqual(
            plain(oldIn.cornerMetrics(grid, cs, r.track)),
          );
          expect(sectorTimes(grid, cs, r.track)).toEqual(
            plain(oldIn.sectorTimes(grid, cs, r.track)),
          );
        }
      const metricSets = [
        [r.ref.metrics, ...r.laps.map((l) => l.corners)],
        [undefined, null],
        [],
        [r.laps[0].corners],
      ];
      for (const ms of metricSets) {
        const bounds = C.phaseBounds(r.ref.corners, L, ms);
        expect(bounds).toEqual(plain(oldIn.phaseBounds(r.ref.corners, L, ms)));
        const phases = C.phasesOf(bounds);
        expect(phases).toEqual(plain(oldIn.phasesOf(bounds)));
        expect(phases.length).toBe(12);
        const lap = r.laps[1];
        for (const ph of phases) {
          for (const [m, rm] of [
            [lap.corners[ph.k], r.ref.metrics[ph.k]],
            [r.ref.metrics[ph.k], lap.corners[ph.k]],
            [undefined, r.ref.metrics[ph.k]],
          ])
            expect(C.whyOf(ph, m, rm, lap.grid, r.ref.grid, L)).toEqual(
              plain(oldIn.whyOf(ph, m, rm, lap.grid, r.ref.grid, L)),
            );
          for (const key of ["v", "t", "lean"] as const)
            expect(C.maxBetween(lap.grid, key, ph.a, ph.b, L)).toBe(
              oldIn.maxBetween(lap.grid, key, ph.a, ph.b, L),
            );
          expect(C.timeBetween(lap.grid, ph.a, ph.b)).toBe(oldIn.timeBetween(lap.grid, ph.a, ph.b));
          expect(C.timeBetween(lap.grid, ph.b, ph.a)).toBe(oldIn.timeBetween(lap.grid, ph.b, ph.a));
        }
        const ref = {
          grid: r.ref.grid,
          metrics: r.ref.metrics,
          time: r.ref.lapTime,
          label: "objetivo",
        };
        for (const l of r.laps) {
          expect(plain(C.lapVsRef(l, ref, phases, L))).toEqual(
            plain(oldIn.lapVsRef(l, ref, phases, L)),
          );
          const bare = { num: l.num, time: l.time, grid: l.grid };
          const noMetrics = { ...ref, metrics: undefined };
          expect(plain(C.lapVsRef(bare, noMetrics, phases, L))).toEqual(
            plain(oldIn.lapVsRef(bare, noMetrics, phases, L)),
          );
        }
      }
    });
});
