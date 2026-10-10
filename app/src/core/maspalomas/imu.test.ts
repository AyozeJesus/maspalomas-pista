import { describe, expect, it } from "vitest";
import { REAL_RIDES, realCsv } from "../../../test/fixtures-maspalomas";
import { legacyMaspalomas, outcome, plain } from "../../../test/legacy-maspalomas";
import { demoSession } from "./demo";
import { resampleTo } from "./numeric";
import * as T from "./telemetry";
import type { ImuSession, SensorSeries, SpeedFix } from "./types";

// La app de antes, tal cual (track-data.js, sim.js, analysis.js y telemetry.js de la raíz del repo).
const old = legacyMaspalomas();
type Tel = typeof T;

const demo = demoSession({ seed: 7 }).session;

// Señal sintética de 60 s a 50 Hz: parado (con sesgo), arrancando, curvas a los dos lados, sin velocidad del GPS
// un rato (girando y luego derecho, sin gravedad a ratos) y parado otra vez con la moto en la pata de cabra.
function synthetic() {
  const out: { t: number; w: number[]; v: number; g: number[] | null; sf: number[] }[] = [];
  for (let k = 0; k < 3000; k++) {
    const t = k / 50;
    const turn = t > 15 && t < 45 ? 0.6 * Math.sin(t / 2) : 0;
    const roll = t > 15 && t < 45 ? 0.4 * Math.cos(t / 2) : 0;
    const w = [0.01 + roll + 0.02 * Math.sin(t * 7), -0.005 + 0.1 * turn, 0.004 + turn];
    const v =
      t < 10
        ? 0.1
        : t < 30
          ? 20 + 5 * Math.sin(t)
          : t < 35
            ? NaN
            : t < 50
              ? 12
              : t < 53
                ? 0.2
                : t < 57
                  ? NaN
                  : 0.2;
    const g = k % 3 ? (t > 50 ? [0, 2, 9.6] : [0.1, 0.2, 9.79]) : null;
    out.push({ t, w, v, g, sf: [Math.sin(t) * 3, 0.5, 9.81 + Math.cos(t * 3)] });
  }
  return out;
}

describe("estimadores del móvil (igual que los de antes)", () => {
  it("LeanEstimator: misma inclinación paso a paso y mismo estado", () => {
    const run = (Tm: Tel) => {
      const est = new Tm.LeanEstimator();
      const out: number[] = [];
      for (const [k, s] of synthetic().entries()) {
        // Los ejes llegan a los 12 s (antes solo aprende el sesgo) y cambian a los 40 s.
        if (k === 600) est.setAxes([0, 1, 0.2], [0.05, -0.1, 1]);
        if (k === 2000) est.setAxes([0.1, 0.9, 0.3], [0, 0, 9.8]);
        out.push(est.step(k % 7 ? 0.02 : 0.25, s.w, s.v, s.g));
      }
      return { out, est: plain(est) };
    };
    const mine = run(T);
    expect(mine).toEqual(run(old.telemetry));
    expect(mine.out.filter((x) => Math.abs(x) > 5).length).toBeGreaterThan(100);
  });

  it("PitchEstimator: mismo cabeceo y aceleración paso a paso", () => {
    const run = (Tm: Tel) => {
      const est = new Tm.PitchEstimator();
      const out: unknown[] = [est.step(0.02, [0, 0, 0], [0, 0, 9.8], 0, 0)];
      est.setAxes([0, 1, 0], [0, 0, 1]);
      for (const [k, s] of synthetic().entries())
        out.push(est.step(0.02, s.w, s.sf, k % 11 ? s.t * 2 - 40 : NaN, k % 13 ? s.w[2] : NaN));
      return { out, est: plain(est) };
    };
    expect(plain(run(T))).toEqual(plain(run(old.telemetry)));
  });

  it("GyroAxes: descubre el mismo orden de ejes (y signo) con la tanda de ejemplo", () => {
    const g = demo.grav;
    const w = demo.gyro;
    // El giro como lo daría cada navegador: x, y, z; z, x, y (Safari); y cambiado de signo.
    const orders: ((k: number) => number[])[] = [
      (k) => [w.x[k], w.y[k], w.z[k]],
      (k) => [w.z[k], w.x[k], w.y[k]],
      (k) => [-w.y[k], -w.z[k], -w.x[k]],
    ];
    const choices = new Set<number>();
    for (const order of orders)
      for (const prior of [undefined, 0, 1]) {
        const run = (Tm: Tel) => {
          const chk = new Tm.GyroAxes(prior);
          const trace: unknown[] = [];
          for (let k = 0; k < 20000; k++) {
            // Un hueco de 1 s en las muestras (el móvil se atasca): se empieza a medir de nuevo.
            if (k >= 5000 && k < 5100) continue;
            chk.add(g.t[k], [g.x[k], g.y[k], g.z[k]], order(k));
            if (k % 500 === 0) trace.push(plain(chk), chk.map(order(k)));
          }
          chk.decide(2);
          return { trace, end: plain(chk) };
        };
        const mine = run(T);
        expect(mine).toEqual(run(old.telemetry));
        choices.add((mine.end as { choice: number }).choice);
      }
    expect(choices.size).toBeGreaterThan(1);
  });

  it("alignSums, alignAdd y alignRoot: igual", () => {
    const run = (Tm: Tel) => {
      const sums = Tm.alignSums();
      const roots: (number | null)[] = [Tm.alignRoot(sums, 0)];
      for (let k = 0; k < 800; k++) {
        const m1 = Math.sin(k * 0.37) * 0.8;
        const m2 = Math.cos(k * 0.11) * 0.3 + 0.05;
        Tm.alignAdd(sums, m1, m2, Math.sin(k * 0.05) * 0.6, Math.sin(k * 0.05) * 0.7);
        if (k % 50 === 0) for (const a0 of [0, 0.3, -1, 2]) roots.push(Tm.alignRoot(sums, a0));
      }
      return { sums: plain(sums), roots };
    };
    const mine = run(T);
    expect(mine).toEqual(run(old.telemetry));
    expect(mine.roots.filter((r) => r !== null).length).toBeGreaterThan(10);
  });
});

// Entradas de imuSolve como las prepara analyze: fijos {t, speed} y la rejilla de tiempo común.
function imuInputs(session: ImuSession, hz: number, speedScale = 1) {
  const loc = session.loc;
  const fixes: SpeedFix[] = [];
  for (let k = 0; k < loc.t.length; k++) {
    const sp = loc.speed ? loc.speed[k] : NaN;
    if (!isFinite(loc.lat[k])) continue;
    fixes.push({ t: loc.t[k], speed: (isFinite(sp) && sp >= 0 ? sp : NaN) * speedScale });
  }
  const last = (a: ArrayLike<number>) => a[a.length - 1];
  const tStart = Math.max(fixes[0].t, session.acc.t[0], session.gyro.t[0], session.grav.t[0]);
  const tEnd = Math.min(
    fixes[fixes.length - 1].t,
    last(session.acc.t),
    last(session.gyro.t),
    last(session.grav.t),
  );
  const m = Math.max(2, Math.floor((tEnd - tStart) * hz));
  const tg = new Float64Array(m);
  for (let k = 0; k < m; k++) tg[k] = tStart + k / hz;
  return { fixes, tg };
}

function permuted(s: SensorSeries): SensorSeries {
  return { t: s.t, x: s.z, y: s.x, z: s.y.map((x) => -x) };
}

// Un giro que no tiene nada que ver con cómo gira la gravedad.
function unrelated(s: SensorSeries): SensorSeries {
  return {
    t: s.t,
    x: s.t.map((t) => Math.sin(t * 3) * 0.5),
    y: s.t.map((t) => Math.cos(t * 1.7) * 0.4),
    z: s.t.map((t) => Math.sin(t * 0.9 + 1) * 0.6),
  };
}

describe("imuSolve (igual que el de antes)", () => {
  const cases: [string, ImuSession, number, number, (k: number, fx: SpeedFix[]) => boolean][] = [
    ["tanda de ejemplo, 50 Hz", demo, 50, 1, (k, fx) => fx[k].speed > 4],
    ["tanda de ejemplo, 20 Hz y todos los fijos", demo, 20, 1, () => true],
    ["giroscopio en otro orden", { ...demo, gyro: permuted(demo.gyro) }, 50, 1, () => true],
    [
      "giroscopio que no cuadra con la gravedad",
      { ...demo, gyro: unrelated(demo.gyro) },
      50,
      1,
      () => true,
    ],
    ["casi parado (vertical con toda la tanda)", demo, 50, 0.05, () => true],
    ["sin fijos que valgan (no se puede orientar)", demo, 50, 1, () => false],
  ];
  for (const [label, session, hz, scale, usable] of cases)
    it(label + ": igual", () => {
      const { fixes, tg } = imuInputs(session, hz, scale);
      const mine = outcome(() => T.imuSolve(session, fixes, tg, hz, (k) => usable(k, fixes)));
      expect(mine).toEqual(
        outcome(() => old.telemetry.imuSolve(session, fixes, tg, hz, (k) => usable(k, fixes))),
      );
      if (label.startsWith("sin fijos")) expect(mine).toHaveProperty("error");
      else expect(mine).toHaveProperty("ok.fit.used");
    });

  it("en la tanda de ejemplo, orienta el móvil y el giroscopio como se generó", () => {
    const { fixes, tg } = imuInputs(demo, 50);
    const r = T.imuSolve(demo, fixes, tg, 50, (k) => fixes[k].speed > 4);
    expect(r.gyroAxes.orden).toBe(0);
    expect(r.fit.r2).toBeGreaterThan(0.9);
    expect(r.upFrom).toBe("rodando");
    const p = T.imuSolve({ ...demo, gyro: permuted(demo.gyro) }, fixes, tg, 50, () => true);
    expect(p.gyroAxes.orden).not.toBe(0);
    const slow = imuInputs(demo, 50, 0.05);
    expect(T.imuSolve(demo, slow.fixes, slow.tg, 50, () => true).upFrom).toBe("todo");
    const bad = T.imuSolve({ ...demo, gyro: unrelated(demo.gyro) }, fixes, tg, 50, () => true);
    expect(bad.warnings.join(" ")).toMatch(/giroscopio no cuadra/);
  });
});

describe("con grabaciones de verdad (rutas del 9 de octubre)", () => {
  for (const file of REAL_RIDES) {
    const files = realCsv(file);
    if (!files) {
      it.skip(file + ": sin PISTA_DATA en este ordenador", () => {});
      continue;
    }
    it(file + ": imuSolve y los estimadores, igual", () => {
      const session = outcome(() => T.sessionFromCsv(files));
      if ("error" in session) {
        // Sin GPS no hay sesión (lo mismo que antes; lo compara csv.test.ts).
        expect(session.error).toMatch(/Location\.csv/);
        return;
      }
      const s = T.sessionFromCsv(files);
      if (!s.acc || !s.gyro || !s.grav) throw new Error(file + ": sin sensores");
      const imu = { ...s, acc: s.acc, gyro: s.gyro, grav: s.grav };
      const hz = 50;
      const { fixes, tg } = imuInputs(imu, hz);
      const usable = (k: number) => fixes[k].speed > 4;
      const mine = outcome(() => T.imuSolve(imu, fixes, tg, hz, usable));
      expect(mine).toEqual(outcome(() => old.telemetry.imuSolve(imu, fixes, tg, hz, usable)));
      expect(mine).toHaveProperty("ok.fit.used");
      // Los estimadores muestra a muestra con los ejes que salen, a la frecuencia de verdad del móvil.
      const r = T.imuSolve(imu, fixes, tg, hz, usable);
      const v = resampleTo(
        s.gyro.t,
        fixes.map((f) => f.t),
        fixes.map((f) => f.speed),
      );
      const run = (Tm: Tel) => {
        const lean = new Tm.LeanEstimator();
        const pitch = new Tm.PitchEstimator();
        const chk = new Tm.GyroAxes(0);
        lean.setAxes(r.f, r.u);
        pitch.setAxes(r.f, r.u);
        const g = imu.grav;
        const w = imu.gyro;
        const a = imu.acc;
        const out = new Float64Array(w.t.length * 3);
        for (let k = 1; k < w.t.length; k++) {
          const dt = w.t[k] - w.t[k - 1];
          const wk = [w.x[k], w.y[k], w.z[k]];
          const gk = [g.x[k], g.y[k], g.z[k]];
          chk.add(w.t[k], gk, wk);
          const deg = lean.step(dt, wk, v[k], gk);
          const p = pitch.step(
            dt,
            wk,
            [a.x[k] + g.x[k], a.y[k] + g.y[k], a.z[k] + g.z[k]],
            deg,
            0.1,
          );
          out[3 * k] = deg;
          out[3 * k + 1] = p ? p.pitch : NaN;
          out[3 * k + 2] = p ? p.a : NaN;
        }
        return { out: Array.from(out), lean: plain(lean), pitch: plain(pitch), axes: plain(chk) };
      };
      const trace = run(T);
      expect(trace).toEqual(run(old.telemetry));
      expect(trace.out.some((x) => Math.abs(x) > 20)).toBe(true);
    });
  }
});
