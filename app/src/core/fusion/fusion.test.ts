import { describe, expect, it } from "vitest";
import {
  drive,
  finishLine,
  onlyFixes,
  realEvents,
  resets,
  session,
  trackingErrors,
  type FusionEvent,
  type Trace,
} from "../../../test/fixtures-fusion";
import { legacy } from "../../../test/legacy";
import * as F from "./index";

// La app de antes, tal cual (fusion.js de la raíz del repo).
const old = legacy<typeof F>("MaspaFusion", "fusion.js");

// Los dos filtros con las mismas opciones y los mismos sucesos.
function both(opts: F.TrackKalmanOptions, events: readonly FusionEvent[]) {
  return {
    mine: drive(new F.TrackKalman(opts), events),
    theirs: drive(new old.TrackKalman(opts), events),
  };
}

// Igual número a número (toEqual compara los números con Object.is: NaN con NaN sí, 0 con −0 no). Por trozos, para
// que si algo no cuadra el aviso diga dónde sin sacar miles de líneas.
function expectSame<T>(mine: readonly T[], theirs: readonly T[], what: string): void {
  expect(mine.length, what).toBe(theirs.length);
  for (let i = 0; i < mine.length; i += 500)
    expect(mine.slice(i, i + 500), what + " desde el " + i).toEqual(theirs.slice(i, i + 500));
}

function expectSameTrace(mine: Trace, theirs: Trace): void {
  expectSame(mine.fixes, theirs.fixes, "fijos");
  expectSame(mine.states, theirs.states, "estados");
  expectSame(mine.laps, theirs.laps, "vueltas");
  expectSame(mine.ready, theirs.ready, "ready");
}

function median(xs: readonly number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const lastOf = <T>(xs: readonly T[]): T => xs[xs.length - 1];

describe("fusion (igual que el de antes)", () => {
  it("opciones: las mismas por defecto y el mismo error sin longitud de pista", () => {
    const cases: F.TrackKalmanOptions[] = [
      { L: 1000 },
      { L: 1234.5, accelSigma: 0.8, biasSigma: 0.02, sSigma: 5, vSigma: 0.5, history: 2 },
      { L: 1000, accelSigma: 0, biasSigma: -1, sSigma: NaN, vSigma: Infinity, history: -2 },
      { L: Infinity },
    ];
    const fields = (k: F.TrackKalman) => ({
      L: k.L,
      accelSigma: k.accelSigma,
      biasSigma: k.biasSigma,
      sSigma: k.sSigma,
      vSigma: k.vSigma,
      history: k.history,
      lapCount: k.lapCount,
      ready: k.ready,
      state: k.state(),
    });
    for (const o of cases)
      expect(fields(new F.TrackKalman(o))).toEqual(fields(new old.TrackKalman(o)));
    expect(fields(new F.TrackKalman(cases[1])).sSigma).toBe(5);
    for (const L of [0, -5, NaN]) {
      const msg = "TrackKalman: falta L, la longitud de la pista (m)";
      expect(() => new old.TrackKalman({ L })).toThrow(msg);
      expect(() => new F.TrackKalman({ L })).toThrow(msg);
    }
  });

  it("tres vueltas con acelerómetro, fijos que llegan tarde, descartes, saltos y huecos: igual", () => {
    const L = 1000;
    const events = session({ L, laps: 3 });
    const { mine, theirs } = both({ L }, events);
    expectSameTrace(mine, theirs);
    // Que diga algo: sigue a la moto, cuenta las vueltas, descarta lo raro y acepta el salto al cuarto fijo.
    const accepted = mine.fixes.filter((f) => f.accepted);
    expect(accepted.length).toBeGreaterThan(0.85 * mine.fixes.length);
    expect(mine.fixes.length - accepted.length).toBeGreaterThanOrEqual(7);
    expect(accepted.some((f) => Math.abs(f.innovation) > 30)).toBe(true);
    expect(lastOf(mine.laps)).toBe(3);
    const ready = mine.states.filter((s) => s.ready);
    expect(ready.length).toBeGreaterThan(0.9 * mine.states.length);
    expect(ready.some((s) => Number.isNaN(s.b))).toBe(true);
    expect(ready.some((s) => Math.abs(s.b) > 0.1)).toBe(true);
    expect(ready.some((s) => s.v === 0)).toBe(true);
    expect(ready.some((s) => s.v > 35)).toBe(true);
    expect(median(trackingErrors(events, mine, L))).toBeLessThan(3);
  });

  it("sin acelerómetro en toda la tanda: igual", () => {
    const L = 1000;
    const events = session({ L, laps: 2, accel: false, seed: 3 });
    const { mine, theirs } = both({ L }, events);
    expectSameTrace(mine, theirs);
    expect(lastOf(mine.laps)).toBe(2);
    expect(mine.states.filter((s) => s.ready).every((s) => Number.isNaN(s.b))).toBe(true);
    expect(median(trackingErrors(events, mine, L))).toBeLessThan(5);
  });

  it("historia corta, sigmas propias, acelerómetro a 100 Hz y salida justo antes de la meta: igual", () => {
    const opts = {
      L: 1500,
      accelSigma: 0.8,
      biasSigma: 0.05,
      sSigma: 2.5,
      vSigma: 0.5,
      history: 1.2,
    };
    const events = session({ L: 1500, laps: 2, hz: 100, lag: 0.5, seed: 5, s0: 1490 });
    const { mine, theirs } = both(opts, events);
    expectSameTrace(mine, theirs);
    // Sale 10 m antes de la meta: al cruzarla ya cuenta una vuelta.
    expect(lastOf(mine.laps)).toBe(3);
    expect(median(trackingErrors(events, mine, 1500))).toBeLessThan(3);
  });

  it("solo fijos, uno que llega antes del primero y el acelerómetro que va y viene: igual", () => {
    const { mine, theirs } = both({ L: 500 }, onlyFixes());
    expectSameTrace(mine, theirs);
    // El primer fijo no trae posición: no hay estado hasta el segundo, que lo hace nacer.
    expect(mine.states[0].ready).toBe(false);
    expect(mine.fixes[0]).toEqual({ accepted: false, innovation: NaN });
    expect(mine.fixes[1]).toEqual({ accepted: true, innovation: 0 });
    expect(lastOf(mine.laps)).toBe(3);
    expect(mine.states.filter((s) => s.ready).length).toBeGreaterThan(120);
  });

  it("la meta: corrección hacia atrás justo después de cruzarla y vaivén parado en la línea: igual", () => {
    const L = 400;
    const events = finishLine();
    const { mine, theirs } = both({ L }, events);
    expectSameTrace(mine, theirs);
    // Tras la corrección, s se queda en 0 de la vuelta 1 en vez de volver a la 0.
    expect(mine.states.some((s) => s.ready && s.s === 0 && s.lap === 1)).toBe(true);
    // Las vueltas solo suben, y el vaivén en la línea cuenta una vez.
    expect(mine.laps.every((n, i) => i === 0 || n >= mine.laps[i - 1])).toBe(true);
    expect(lastOf(mine.laps)).toBe(3);
    expect(median(trackingErrors(events, mine, L))).toBeLessThan(2);
  });

  it("reinicios: igual", () => {
    const { mine, theirs } = both({ L: 800 }, resets());
    expectSameTrace(mine, theirs);
    expect(mine.ready.some((r) => !r)).toBe(true);
    expect(lastOf(mine.ready)).toBe(true);
    expect(mine.states.filter((s) => s.ready).length).toBeGreaterThan(100);
    expect(Math.max(...mine.laps)).toBe(1);
    // El fijo por detrás de la meta recién reiniciado: ahora s se queda en 0; en el pasado, vuelta −1.
    const [now, past] = mine.states.slice(-3);
    expect([now.s, now.lap]).toEqual([0, 0]);
    expect(past.lap).toBe(-1);
    expect(past.s).toBeGreaterThan(790);
  });

  it("sigmas extremas: el suelo de la covarianza y el estado que se vuelve NaN, igual", () => {
    // Fijos casi exactos: las varianzas de s y v bajan al suelo (y desde ahí crecen hasta la consulta).
    const tight = both(
      { L: 1000, sSigma: 1e-6, vSigma: 1e-7 },
      session({ L: 1000, laps: 1, seed: 9 }),
    );
    expectSameTrace(tight.mine, tight.theirs);
    expect(tight.mine.states.some((s) => s.ready && s.sSigma < 0.01)).toBe(true);
    // Ruido del acelerómetro infinito: con él la covarianza se hace infinita, el estado NaN (ready a false) y el
    // siguiente fijo lo vuelve a hacer nacer.
    const wild = both({ L: 500, accelSigma: 1e200 }, onlyFixes());
    expectSameTrace(wild.mine, wild.theirs);
    const r = wild.mine.ready;
    const died = r.findIndex((x, i) => i > 0 && r[i - 1] && !x);
    expect(died).toBeGreaterThan(0);
    expect(r.slice(died).some((x) => x)).toBe(true);
  });

  // Grabaciones de verdad del Vivo (9 de octubre), como si la ruta fuera una pista de 1 km, con los fijos 0,8 s tarde.
  const L = 1000;
  for (const file of [
    "20261009-163105-bn2o.json",
    "20261009-170613-a0l8.json",
    "20261009-171527-csvc.json",
    "20261009-172312-eck7.json",
  ]) {
    const gps = realEvents(file, 0.8, false);
    const live = realEvents(file, 0.8, true);
    if (!gps || !live) {
      it.skip(file + " de verdad: sin PISTA_DATA en este ordenador", () => {});
      continue;
    }
    it(file + " de verdad, solo con el GPS: igual", () => {
      const { mine, theirs } = both({ L }, gps.events);
      expectSameTrace(mine, theirs);
      // Sin acelerómetro sigue a la moto: casi todos los fijos entran y cuenta las vueltas recorridas.
      expect(mine.fixes.length).toBe(gps.fixes);
      expect(mine.fixes.filter((f) => f.accepted).length).toBeGreaterThan(0.98 * gps.fixes);
      expect(lastOf(mine.laps)).toBe(Math.floor(gps.total / L));
      expect(median(trackingErrors(gps.events, mine, L))).toBeLessThan(3);
    });
    // Con la aceleración del directo, que en estas rutas apenas se parece a la del GPS (la vibración del soporte), el
    // filtro de antes se desvía y descarta muchos fijos: tiene que desviarse igual.
    it(file + " de verdad, con la aceleración del directo: igual", () => {
      const { mine, theirs } = both({ L }, live.events);
      expectSameTrace(mine, theirs);
      const accepted = mine.fixes.filter((f) => f.accepted).length;
      expect(accepted).toBeGreaterThan(0.3 * live.fixes);
      expect(live.fixes - accepted).toBeGreaterThan(10);
      expect(mine.states.filter((s) => s.ready && Number.isFinite(s.b)).length).toBeGreaterThan(
        1000,
      );
    });
  }
});
