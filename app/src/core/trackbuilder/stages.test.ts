import { describe, expect, it } from "vitest";
import { ride, type Loc } from "../../../test/fixtures";
import {
  CLUB,
  CLUB_CUT,
  KART,
  concatRides,
  gp,
  interleave,
  lastTime,
  legacyTrackBuilderInside,
  plain,
  realRecordings,
  repeatLaps,
  toXY,
} from "../../../test/fixtures-trackbuilder";
import * as assemble from "./assemble";
import * as band from "./band";
import * as build from "./build";
import * as centerline from "./centerline";
import * as constants from "./constants";
import * as corners from "./corners";
import * as fit from "./fit";
import * as fixes from "./fixes";
import * as laps from "./laps";
import * as points from "./points";
import * as projection from "./projection";
import * as rotate from "./rotate";
import * as sectors from "./sectors";
import * as smoothing from "./smoothing";
import * as start from "./start";
import * as system from "./system";
import * as timing from "./timing";
import * as trajectory from "./trajectory";
import type { FixesInput } from "./types";
import * as util from "./util";

// Todas las piezas, las nuevas y las de dentro de trackbuilder.js, con los mismos nombres.
const mine = {
  ...constants,
  ...util,
  ...projection,
  ...fixes,
  ...trajectory,
  ...laps,
  ...points,
  ...band,
  ...system,
  ...smoothing,
  ...fit,
  ...centerline,
  ...corners,
  ...sectors,
  ...start,
  ...assemble,
  ...build,
  ...timing,
  ...rotate,
};
type Inside = typeof mine;
const old = legacyTrackBuilderInside<Inside>();

function outcome<R>(f: () => R): { ok: R } | { error: string } {
  try {
    return { ok: f() };
  } catch (e) {
    const err = e as { name?: unknown; message?: unknown };
    return { error: String(err.name) + ": " + String(err.message) };
  }
}

// Cada etapa del constructor con una tanda, hecha toda con las piezas de un lado: lo que sale de cada una, tal cual
// (sin los redondeos del final), para compararlo número a número.
function stages(I: Inside, loc: FixesInput, minLaps = 1): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const c = I.cleanFixes(loc);
  out.clean = c;
  if (c.n < 2) return out;
  const mean = I.meanLatLon(c.lat, c.lon);
  const proj = I.projection(mean[0], mean[1]);
  out.mean = mean;
  out.projection = [
    proj.xy(c.lat[0], c.lon[0]),
    proj.xy(c.lat[c.n - 1], c.lon[c.n - 1]),
    proj.ll(123.4, -56.7),
  ];
  const tr = I.trajectory(c, proj);
  out.trajectory = plain(tr);
  out.timeSmooth = plain(I.timeSmooth(c.t, tr.x, 1.2));
  const det = I.detectLaps(tr);
  out.detectLaps = plain(det);
  // Pasadas por otras líneas, en los dos modos (vueltas por cierre del recorrido y cronómetro).
  for (const k of [Math.floor(tr.n / 3), Math.floor(tr.n / 2), Math.floor((2 * tr.n) / 3)]) {
    out["lapsThrough " + k] = plain(I.lapsThrough(tr, k));
    out["gateCrossings " + k] = plain(
      I.gateCrossings(tr, tr.xs[k], tr.ys[k], tr.hx[k], tr.hy[k], 100, false),
    );
  }
  if (!det || det.clean.length < minLaps) return out;
  const P = I.lapPoints(tr, det.clean);
  out.lapPoints = plain(P);
  const L = det.len as number;
  const M = Math.max(64, Math.round(L / (L <= 4000 ? 1 : L / 4000)));
  const S = I.fitSystem(P, P.u, P.w, M, L / M);
  out.fitSystem = plain(S);
  const sm = I.chooseSmoothing(S, P, P.u, P.w);
  out.chooseSmoothing = sm;
  const c0 = I.solveFit(S, S.pen, sm.scale, -1);
  out.solveFit = plain(c0);
  out["solveFit sin el grupo 0"] = plain(I.solveFit(S, S.pen, sm.scale * 3, 0));
  out.curveAt = [0, 0.25, 0.5, 0.999].map((u) => I.curveAt(c0, S, u));
  // El error de cada vuelta con la curva de las demás (lo que compara chooseSmoothing por dentro: su elección es
  // discreta y no deja ver una diferencia pequeña en él).
  const errs: number[] = [];
  for (let j = 0; j < P.folds; j++) {
    const cj = I.solveFit(S, S.pen, sm.scale, j);
    const rx = new Float64Array(P.n);
    const ry = new Float64Array(P.n);
    for (let q = 0; q + 1 < P.lapStart.length; q++) {
      const idx: number[] = [];
      for (let i = P.lapStart[q]; i < P.lapStart[q + 1]; i++)
        if (P.fold[i] === j && P.w[i] > 0) idx.push(i);
      idx.sort((a, b) => P.u[a] - P.u[b]);
      for (const i of idx) {
        const p = I.curveAt(cj, S, P.u[i]);
        rx[i] = P.x[i] - p[0];
        ry[i] = P.y[i] - p[1];
      }
      if (idx.length) errs.push(I.highPass(idx, rx, ry, P.w, P.u, S.M * S.h));
    }
  }
  out.highPass = errs;
  const pr = I.projectPoints(c0.cx.slice(S.E, S.E + M), c0.cy.slice(S.E, S.E + M), M, P, P.u, 30);
  out.projectPoints = plain(pr);
  out.robustWeights = plain(I.robustWeights(P.w, pr.dist));
  const f = I.fitLoop(P, L);
  out.fitLoop = plain(f);
  const R = I.resampleClosed(f.cx, f.cy, 2);
  out.resampleClosed = R;
  const n = R.P.length;
  const h = R.L / n;
  out.badCrossings = I.badCrossings(R.P, h);
  out.startFinish = [I.startFinish(R.P, h, tr.pit), I.startFinish(R.P, h, null)];
  const k = I.curvature(R.P, Math.max(1, Math.round(12 / h)));
  out.curvature = plain(k);
  out.cyclicRuns = I.cyclicRuns(n, (i) => k[i] > 0);
  const found = I.findCorners(k, h);
  out.findCorners = found;
  out.sectorBoundsOf = I.sectorBoundsOf(found, h, n);
  out.assemble = outcome(() =>
    I.assemble(
      R.P,
      proj,
      { name: "x" },
      { laps: det.clean.length, spread: 1, pit: tr.pit, fromGps: true },
    ),
  );
  return out;
}

// Las etapas con los dos lados, una a una (si algo difiere, se ve en cuál).
function sameStages(loc: FixesInput, minLaps = 1): Record<string, unknown> {
  const a = stages(mine, loc, minLaps);
  const b = stages(old, loc, minLaps);
  expect(Object.keys(a)).toEqual(Object.keys(b));
  for (const key of Object.keys(b)) expect(a[key], key).toEqual(b[key]);
  return a;
}

const club3 = ride(repeatLaps(CLUB, 3), { v: 25, wait: 6, waitEnd: 4, noise: 1 });

describe("trackbuilder por dentro (cada etapa, número a número, igual que la de antes)", () => {
  it("las mismas constantes", () => {
    for (const key of Object.keys(constants) as (keyof typeof constants)[])
      expect(mine[key], key).toEqual(old[key]);
  });

  it("tandas que dan circuito: todas las etapas hasta el circuito", { timeout: 60000 }, () => {
    const gpTop = ride(repeatLaps(gp(5), 3), { v: 24, wait: 20, waitEnd: 10 });
    const fiveHz = interleave(
      ...[0, 0.2, 0.4, 0.6, 0.8].map((t0) =>
        ride(repeatLaps(gp(0), 3), { v: 24, wait: 20, waitEnd: 10, t0 }),
      ),
    );
    const parts: Loc[] = [];
    let t0 = 0;
    for (const [poly, v] of [
      [CLUB, 25],
      [CLUB, 25],
      [CLUB, 9],
      [CLUB_CUT, 25],
      [CLUB, 25],
      [CLUB, 25],
    ] as const) {
      const r = ride(poly, { v, wait: t0 ? 0 : 6, waitEnd: 0, t0 });
      parts.push(r);
      t0 = lastTime(r) + 0.6;
    }
    parts.push(ride(CLUB.slice(0, 3), { v: 25, wait: 0, waitEnd: 5, t0 }));
    const rides: FixesInput[] = [
      club3,
      gpTop,
      fiveHz,
      { t: gpTop.t, lat: gpTop.lat, lon: gpTop.lon },
      ride(repeatLaps(KART, 5), { v: 12, wait: 10, waitEnd: 10, noise: 1 }),
      concatRides(...parts),
      ride(repeatLaps(CLUB, 6), { v: 25, wait: 6, waitEnd: 4, noise: 28 }),
    ];
    for (const loc of rides) expect(sameStages(loc)).toHaveProperty("assemble");
  });

  it("una sola vuelta (un único grupo de validación: suavizado fijo)", () => {
    const one = ride(repeatLaps(CLUB, 1, 0.4), { v: 25, wait: 6, waitEnd: 4, noise: 1 });
    expect((sameStages(one).lapPoints as { folds: number }).folds).toBe(1);
  });

  it("piezas sueltas en sus casos raros", () => {
    const same = <R>(f: (I: Inside) => R) => expect(plain(f(mine))).toEqual(plain(f(old)));
    same((I) => [NaN, 3, 1, NaN, 2, -0, 0].map((_, i, a) => I.median(a.slice(0, i + 1))));
    same((I) => [I.median([]), I.median([5]), I.median([4, 1])]);
    same((I) => [-540.5, -180, -179.99, 0, 179.99, 180, 359, 725.25].map(I.wrapLon));
    same((I) => [I.ring(-7, 5), I.ring(7.5, 5), I.ring(-0.25, 5), I.ring(3, 1)]);
    same((I) => [null, undefined, "", " ", "1e3", "x", 0, false, true, [], [7]].map(I.num));
    same((I) => [I.round(1.005, 2), I.round(-2.5, 0), I.round(123.456789, 7), I.round(-0.0001, 2)]);
    same((I) => [I.lapsMessage(1), I.lapsMessage(2), I.lapsMessage(7)]);
    same((I) => [
      I.options(undefined),
      I.options(null),
      I.options({ minLaps: 3.5, spacing: 0.2, name: "A" }),
      I.options({ minLaps: NaN, spacing: 99, name: "" }),
    ]);
    same((I) => {
      const p = I.projection(-16.8, 179.95);
      return [
        p.xy(-16.79, -179.98),
        p.ll(-5000, 1200),
        I.meanLatLon([1, 2, 3], [179.9, -179.9, 179.95]),
      ];
    });
    same((I) => [
      I.segCross([0, 0], [2, 2], [0, 2], [2, 0]),
      I.segCross([0, 0], [2, 0], [1, 0], [3, 0]),
      I.segCross([0, 0], [2, 0], [2, 0], [3, 1]),
      I.segCross([0, 0], [1, 1], [3, 3], [4, 0]),
    ]);
    same((I) => [
      I.cyclicRuns(6, () => true),
      I.cyclicRuns(6, () => false),
      I.cyclicRuns(7, (i) => i !== 2 && i !== 3),
      I.cyclicRuns(5, (i) => i === 0 || i === 4),
    ]);
    same((I) => [
      I.sectorOf([], 5, 10),
      I.sectorOf([3, 8], 2, 10),
      I.orderBounds([7, 1, 4], [], 10),
      I.orderBounds([7, 1, 4], [5, 2], 10),
    ]);
    // Curvas a mano: una sola que abarca todo, y dos vértices juntos que se funden.
    same((I) => {
      const k = new Float64Array(200).fill(0.012);
      const two = new Float64Array(300);
      for (let i = 50; i < 70; i++) two[i] = 0.05;
      for (let i = 74; i < 90; i++) two[i] = -0.06;
      for (let i = 200; i < 260; i++) two[i] = 0.02;
      const f1 = I.findCorners(k, 2);
      const f2 = I.findCorners(two, 2);
      return [
        f1,
        f2,
        I.sectorBoundsOf(f1, 2, 200),
        I.sectorBoundsOf(f2, 2, 300),
        I.sectorBoundsOf([], 2, 300),
      ];
    });
  });

  it("álgebra de banda, también con un pivote que no vale", () => {
    for (const b of [1, 2, 3]) {
      const n = 40;
      const bandMatrix = (sign: number) => {
        let seed = 11;
        const rnd = () => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647 - 0.5;
        };
        const a = new Float64Array(n * (b + 1));
        for (let i = 0; i < n; i++) {
          a[i * (b + 1)] = sign * (4 + rnd());
          for (let k = 1; k <= b && k <= i; k++) a[i * (b + 1) + k] = rnd();
        }
        return a;
      };
      const r = Array.from({ length: n }, (_, i) => Math.sin(i));
      for (const sign of [1, -1]) {
        const same = (I: Inside) => {
          const a = bandMatrix(sign);
          I.ldl(a, n, b);
          return [plain(a), plain(I.ldlSolve(a, n, b, r))];
        };
        expect(same(mine)).toEqual(same(old));
      }
      const rowW = Array.from({ length: n }, (_, i) => 1 + i / 7);
      expect(plain(mine.penaltyBand(n, 2, rowW))).toEqual(plain(old.penaltyBand(n, 2, rowW)));
      expect(plain(mine.penaltyBand(n, 3, null))).toEqual(plain(old.penaltyBand(n, 3, null)));
    }
  });

  describe("con las grabaciones de verdad (PISTA_DATA)", () => {
    const reals = realRecordings();
    if (!reals.length) {
      it.skip("sin PISTA_DATA en este ordenador", () => {});
      return;
    }
    for (const { file, loc } of reals)
      it(
        file + ": las etapas hasta buscar las vueltas, y con vueltas por trozos suyos",
        { timeout: 60000 },
        () => {
          sameStages(loc);
          if (!loc) return;
          // Tres vueltas sintéticas a lo largo de un trozo de la grabación, cerrado: curvas de verdad por todas las etapas.
          const n = loc.t.length;
          const seg = Array.from({ length: Math.floor(n * 0.2) }, (_, k) =>
            toXY(loc.lat[Math.floor(n * 0.5) + k], loc.lon[Math.floor(n * 0.5) + k]),
          );
          sameStages(ride(repeatLaps([...seg, seg[0]], 3), { v: 22, wait: 10, waitEnd: 5 }));
        },
      );
  });
});
