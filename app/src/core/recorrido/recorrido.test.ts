import { describe, expect, it } from "vitest";
import {
  hasRealRecording,
  MOUNTAIN,
  realRecording,
  recordingEvents,
  simulate,
  type RouteEvent,
} from "../../../test/fixtures-recorrido";
import { legacy } from "../../../test/legacy";
import * as R from "./index";

// La app de antes, tal cual (recorrido.js de la raíz del repo).
const old = legacy<typeof R>("MaspaRecorrido", "recorrido.js");

// Copia de lo que llega en un aviso, en ese momento (el objeto se sigue tocando después: gps, lost…).
function copy(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(copy);
  if (x && typeof x === "object")
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, copy(v)]));
  return x;
}

// Todo lo que guarda el recorrido (sin los avisos, que son funciones).
function stateOf(r: R.Recorrido): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== "function"));
}

// JSON que distingue NaN, ±Infinity y −0, con las claves en su orden: igual solo si es idéntico, número a número.
function exact(x: unknown): string {
  return JSON.stringify(x, (_, v: unknown) =>
    typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0))
      ? (Object.is(v, -0) ? "-0" : String(v)) + "!"
      : v,
  );
}

interface Run {
  r: R.Recorrido;
  // Lo que se ve después de cada llamada (fijo o paso).
  rows: unknown[][];
  // Avisos de curva, frenada y caballito, como llegaron.
  calls: unknown[];
  // El resumen a ratos, a media ruta.
  snaps: string[];
  // Al final: velocidad del GPS, estimación guardada y posición (sin retraso, sin velocidad) en instantes de los
  // últimos 25 s y del segundo siguiente.
  looks: unknown[][];
}

// Alimenta un recorrido como la app: el origen de cada fijo (receptor externo o no) y el fijo; cada paso, y la posición
// que pide el panel.
function drive(impl: typeof R, events: readonly RouteEvent[]): Run {
  const r = new impl.Recorrido();
  const calls: unknown[] = [];
  r.onCurve = (c) => calls.push(["curva", copy(c)]);
  r.onBrake = (b) => calls.push(["frenada", copy(b)]);
  r.onWheelie = (w) => calls.push(["caballito", copy(w)]);
  const rows: unknown[][] = [];
  const snaps: string[] = [];
  events.forEach((ev, i) => {
    if (ev.kind === "fix") {
      r.fast = ev.fast;
      r.onFix(ev.t, ev.x, ev.y, ev.v);
      const e = r.est;
      rows.push([
        e ? e.x : null,
        e ? e.y : null,
        e ? e.h : null,
        r.corr[0],
        r.corr[1],
        r.corr[2],
        r.heading,
        r.yawVote,
        r.yawSign,
        r.hAccum,
        r.gapNext,
        r.cfix ? r.cfix.t : null,
        r.vHist.length,
        r.pendingBrk.length,
        r.stats.vMax,
      ]);
    } else {
      r.step(ev.t, ev.s);
      const p = r.position(ev.t, ev.s.v, ev.s.lag);
      rows.push([
        p ? p.x : null,
        p ? p.y : null,
        p ? p.heading : null,
        r.trail.length,
        r.curves.length,
        r.brakes.length,
        r.wheelies.length,
        r.curve ? r.curve.num : null,
        r.brake ? r.brake.t0 : null,
        r.bk ? r.bk.t0 : null,
        r.wheelie ? r.wheelie.t0 : null,
        r.lossOpen ? r.lossOpen.post : null,
        r.rawPh,
        r.lastPh,
        r.yawS,
        r.ySig,
        r.useEst,
        r.hAccum,
        r.stats.dist,
      ]);
    }
    if (i % 499 === 0) snaps.push(exact(r.summary()));
  });
  const looks: unknown[][] = [];
  const tEnd = events.length ? events[events.length - 1].t : 0;
  for (let t = tEnd - 25; t <= tEnd + 1; t += 0.37) {
    const h = r.histAt(t);
    const p = r.position(t, 12);
    const q = r.position(t, NaN, 0.4);
    looks.push([
      r.vAt(t),
      h ? h.x : null,
      h ? h.y : null,
      h ? h.h : null,
      p ? p.x : null,
      p ? p.y : null,
      p ? p.heading : null,
      q ? q.x : null,
      q ? q.y : null,
    ]);
  }
  return { r, rows, calls, snaps, looks };
}

// Valor a valor, idénticos (NaN con NaN, −0 distinto de 0).
function sameRows(what: string, mine: unknown[][], theirs: unknown[][]): void {
  expect(mine.length).toBe(theirs.length);
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i];
    const b = theirs[i];
    expect(a.length).toBe(b.length);
    for (let k = 0; k < a.length; k++)
      if (!Object.is(a[k], b[k]))
        expect.fail(what + " " + i + ", valor " + k + ": " + String(a[k]) + " ≠ " + String(b[k]));
  }
}

// Los dos recorridos con las mismas llamadas: lo mismo después de cada una, los mismos avisos, el mismo estado al final
// y el mismo resumen (también su JSON, que es como la app lo compara con el guardado).
function compare(events: readonly RouteEvent[]): Run {
  const mine = drive(R, events);
  const theirs = drive(old, events);
  sameRows("llamada", mine.rows, theirs.rows);
  sameRows("consulta final", mine.looks, theirs.looks);
  expect(mine.calls).toEqual(theirs.calls);
  expect(exact(mine.calls)).toBe(exact(theirs.calls));
  expect(mine.snaps).toEqual(theirs.snaps);
  const st = stateOf(mine.r);
  expect(st).toEqual(stateOf(theirs.r));
  expect(exact(st)).toBe(exact(stateOf(theirs.r)));
  const sum = mine.r.summary();
  expect(sum).toEqual(theirs.r.summary());
  expect(JSON.stringify(sum)).toBe(JSON.stringify(theirs.r.summary()));
  expect(exact(sum)).toBe(exact(theirs.r.summary()));
  return mine;
}

const kinds = (run: Run) => new Set(run.calls.map((c) => (c as [string])[0]));

// Lo que no debería llegar pero puede: muestras con la hora repetida o de antes, y datos sueltos que faltan (NaN).
function oddities(events: readonly RouteEvent[]): RouteEvent[] {
  return events.map((e, i): RouteEvent => {
    if (e.kind === "fix") return e;
    const s = { ...e.s };
    let t = e.t;
    if (i % 89 === 0) t -= 0.02;
    if (i % 97 === 0) t -= 0.05;
    if (i % 53 === 0) s.lag = NaN;
    if (i % 59 === 0) s.yaw = NaN;
    if (i % 61 === 0) s.v = NaN;
    if (i % 67 === 0) s.turn = NaN;
    if (i % 71 === 0) s.pitch = NaN;
    if (i % 73 === 0) s.aW = NaN;
    if (i % 79 === 0) s.a = NaN;
    if (i % 83 === 0) s.lean = NaN;
    if (i % 101 === 0) s.yawRate = NaN;
    return { kind: "step", t, s };
  });
}

describe("recorrido (igual que el de antes)", () => {
  it("fases, umbrales y milímetros de horquilla: igual", () => {
    expect(R.BRAKE).toBe(old.BRAKE);
    expect(R.GAS).toBe(old.GAS);
    const as = [-Infinity, -1, -0.3, -0.15, -0.1500001, -0.14, -0.1, -0.09, -0, 0, 0.05, 0.0500001];
    for (const a of [...as, 0.3, Infinity, NaN])
      for (const braking of [false, true])
        expect(R.phaseOf(a, braking)).toBe(old.phaseOf(a, braking));
    for (const d of [0, -0, 0.4, 2.5, 4.1, 11, 45, 86.6, 89.9, -3, NaN, Infinity])
      expect(Object.is(R.diveMm(d), old.diveMm(d))).toBe(true);
  });

  it("sin llamadas: mismo estado, sin posición y el mismo resumen vacío", () => {
    const mine = new R.Recorrido();
    const theirs = new old.Recorrido();
    expect(stateOf(mine)).toEqual(stateOf(theirs));
    expect(mine.position(3, 10, 0.5)).toBeNull();
    expect(theirs.position(3, 10, 0.5)).toBeNull();
    expect(mine.vAt(3)).toBeNull();
    expect(mine.histAt(3)).toBeNull();
    expect(exact(mine.summary())).toBe(exact(theirs.summary()));
    // Cerrar sin curva ni caballito en marcha no se hace nunca: falla igual en los dos.
    const fails = (f: () => unknown) => {
      try {
        f();
        return null;
      } catch (e) {
        return (e as Error).name;
      }
    };
    for (const end of ["endCurve", "endWheelie"] as const) {
      expect(fails(() => mine[end](5))).toBe("TypeError");
      expect(fails(() => theirs[end](5))).toBe("TypeError");
    }
    expect(stateOf(mine)).toEqual(stateOf(theirs));
  });

  it("carretera de montaña con el GPS del móvil (1 Hz): igual, llamada a llamada", () => {
    const run = compare(simulate(MOUNTAIN));
    const { r } = run;
    // Lo que el guion tiene que dar (si no, la comparación diría poco).
    expect(r.curves.length).toBeGreaterThanOrEqual(5);
    expect(r.curves.some((c) => c.lean === null)).toBe(true);
    expect(r.curves.some((c) => c.dead > 0 && c.brk !== null && c.brakeG !== null)).toBe(true);
    expect(r.brakes.some((b) => b.gps === true && b.dive !== null && b.trail > 0)).toBe(true);
    expect(r.brakes.some((b) => b.gps === false)).toBe(true);
    expect(r.wheelies.length).toBeGreaterThanOrEqual(1);
    expect(r.wheelies[0].lost).toBeGreaterThan(0);
    expect(r.trail.some((p) => p.gap)).toBe(true);
    expect(r.trail.some((p) => p.ph === "muerto")).toBe(true);
    expect(r.trail.some((p) => p.wh)).toBe(true);
    expect(kinds(run)).toEqual(new Set(["curva", "frenada", "caballito"]));
    const s = r.summary();
    expect(s.tiempoMuertoMedio).not.toBeNull();
    expect(s.mordidaMejor).toBeGreaterThan(0);
    expect(s.frenadas).toBeLessThan(r.brakes.length);
  });

  it("móvil que da el giro al revés: lo corrige con el rumbo del GPS, igual", () => {
    const { r } = compare(simulate(MOUNTAIN, { yawSign: -1, seed: 5 }));
    expect(r.yawSign).toBe(-1);
    expect(r.curves.length).toBeGreaterThanOrEqual(5);
  });

  it("receptor externo a 10 Hz: igual", () => {
    const { r } = compare(simulate(MOUNTAIN, { gpsHz: 10, lag: 0.1, fast: true, seed: 3 }));
    expect(r.fast).toBe(true);
    expect(r.curves.length).toBeGreaterThanOrEqual(5);
    expect(r.trail.some((p) => p.gap)).toBe(true);
  });

  it("fijos a intervalos irregulares, sin retraso y sensores a 60 Hz: igual", () => {
    const { r } = compare(simulate(MOUNTAIN, { irregular: true, lag: 0, hz: 60, seed: 9 }));
    expect(r.curves.length).toBeGreaterThanOrEqual(3);
    expect(r.trail.length).toBeGreaterThan(100);
  });

  it("sin giroscopio: la trazada sigue al GPS, igual", () => {
    const run = compare(
      simulate(
        MOUNTAIN.map((s) => ({ ...s, noGyro: true })),
        { seed: 21 },
      ),
    );
    expect(run.rows.some((row) => row[16] === true)).toBe(false);
    expect(run.r.trail.length).toBeGreaterThan(100);
    expect(run.r.brakes.length).toBeGreaterThan(0);
  });

  it("sin GPS: sin posición ni trazada, pero con frenadas y curvas, igual", () => {
    const { r } = compare(
      simulate(
        MOUNTAIN.map((s) => ({ ...s, gpsOff: true })),
        { seed: 33 },
      ),
    );
    expect(r.fix).toBeNull();
    expect(r.trail.length).toBe(0);
    expect(r.brakes.length).toBeGreaterThan(0);
    expect(r.curves.length).toBeGreaterThan(0);
  });

  it("relojes que se repiten o retroceden y datos sueltos que faltan: igual", () => {
    const { r } = compare(oddities(simulate(MOUNTAIN, { seed: 44 })));
    expect(r.curves.length).toBeGreaterThan(0);
    expect(r.brakes.length).toBeGreaterThan(0);
  });

  // Grabaciones de verdad (9 de octubre), repasadas como en la app: todo el GPS y todos los sensores, en orden.
  const files = [
    "20261009-163105-bn2o.json",
    "20261009-170613-a0l8.json",
    "20261009-171527-csvc.json",
    "20261009-172312-eck7.json",
  ];
  for (const file of files) {
    if (!hasRealRecording(file)) {
      it.skip(file + " de verdad: sin PISTA_DATA en este ordenador", () => {});
      continue;
    }
    it(
      file + " de verdad, repasada como en la app: igual, llamada a llamada",
      () => {
        const rec = realRecording(file);
        expect(rec).not.toBeNull();
        if (!rec) return;
        const { r } = compare(recordingEvents(rec));
        expect(r.trail.length).toBeGreaterThan(100);
        expect(r.curves.length).toBeGreaterThan(5);
        expect(r.brakes.length).toBeGreaterThan(5);
        expect(r.brakes.some((b) => b.gps === true)).toBe(true);
        expect(r.trail.some((p) => p.ph === "muerto")).toBe(true);
      },
      60000,
    );
  }

  const small = "20261009-171527-csvc.json";
  it.skipIf(!hasRealRecording(small))(
    small + " con los fijos de un receptor externo: igual",
    () => {
      const rec = realRecording(small);
      expect(rec).not.toBeNull();
      if (!rec) return;
      const events = recordingEvents(rec, { lag: 0.1 }).map((e): RouteEvent =>
        e.kind === "fix" ? { ...e, fast: true } : e,
      );
      expect(compare(events).r.trail.length).toBeGreaterThan(100);
    },
    60000,
  );

  // Una grabación sin GPS (30 s con el móvil en la mano): solo sensores.
  const noGps = "20261009-183824-woqw.json";
  it.skipIf(!hasRealRecording(noGps))(
    noGps + " de verdad (sin GPS): igual",
    () => {
      const rec = realRecording(noGps);
      expect(rec).not.toBeNull();
      if (!rec) return;
      const events = recordingEvents(rec);
      expect(events.length).toBeGreaterThan(1000);
      const { r } = compare(events);
      expect(r.fix).toBeNull();
      expect(r.summary().distancia).toBe(0);
    },
    60000,
  );
});
