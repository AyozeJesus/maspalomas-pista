// La franja de vueltas o tramos de la ruta libre: el circuito, el tramo en marcha (con y sin la mejor pasada), el
// recién acabado y la salida marcada a mano, con los textos de renderCircuit y renderTramoStrip de live.js (y
// passTimeAt número a número).
import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../test/legacy";
import { MARK, type TramoEstado } from "../../../core/tramos";
import type { Engine } from "../../../engine";
import { passTimeAt, stripView } from "./strip";

function eng(over: Record<string, unknown> = {}): Engine {
  return {
    circ: null,
    tramos: [],
    tramoDone: null,
    mark: null,
    extGps: null,
    lag: 0.4,
    route: { stats: { dist: 0 } },
    ...over,
  } as unknown as Engine;
}

function tramo(nombre: string, st: TramoEstado, best: unknown = null) {
  return { id: "x", nombre, gate: true, best, tk: { estado: () => st } };
}

const RUN = { en: true, t0: 10, tiempo: 75.4, tFix: 75, s: 1210, frac: 0.4, dMeta: 900 } as const;

describe("franja de la ruta libre", () => {
  it("passTimeAt: igual que antes, también fuera de las marcas", () => {
    const old = liveFunctions<{ passTimeAt(t: number[], s: number): number }>(["passTimeAt"], {
      globals: { MaspaTramos: { MARK } },
    });
    const tiempos = [0, 1.2, 2.5, 3.1, 4.9];
    for (const s of [-5, 0, 7, 20, 33.3, 79.9, 80, 81, 400])
      expect(passTimeAt(tiempos, s), "s = " + s).toBe(old.passTimeAt(tiempos, s));
  });

  it("nada en marcha: oculta", () => {
    expect(stripView(eng(), 100)).toEqual({ hidden: true });
  });

  it("circuito: vuelta, tiempo, mejor y diferencia (con color)", () => {
    const state = (st: object) => eng({ circ: { state: () => st } });
    expect(stripView(state({ lapNum: 0, lapTime: null, best: null, delta: null }), 5)).toEqual({
      hidden: false,
      lap: "Hacia meta",
      delta: "—",
      deltaCls: "num",
      best: "Mejor —",
    });
    expect(stripView(state({ lapNum: 3, lapTime: 31.26, best: 62.5, delta: -0.4 }), 5)).toEqual({
      hidden: false,
      lap: "Vuelta 3 · 0:31,3",
      delta: "−0,40",
      deltaCls: "num up",
      best: "Mejor 1:02,50",
    });
    expect(stripView(state({ lapNum: 2, lapTime: 3, best: 62.5, delta: 0.06 }), 5)).toMatchObject({
      delta: "+0,06",
      deltaCls: "num down",
    });
    expect(stripView(state({ lapNum: 2, lapTime: 3, best: 62.5, delta: 0.05 }), 5)).toMatchObject({
      deltaCls: "num",
    });
  });

  it("tramo en marcha: diferencia con la mejor en el mismo punto", () => {
    const best = { tiempo: 180.25, tiempos: Array.from({ length: 200 }, (_, k) => k * 1.2) };
    // A 1210 m la mejor iba por 72,6 s: 2,4 s peor.
    expect(stripView(eng({ tramos: [tramo("Los Loros", RUN, best)] }), 85)).toEqual({
      hidden: false,
      lap: "Los Loros · 1:15",
      delta: "+2,4",
      deltaCls: "num down",
      best: "Mejor 3:00,3",
    });
    const fast = { ...RUN, tFix: 72.5 };
    expect(stripView(eng({ tramos: [tramo("Los Loros", fast, best)] }), 85)).toMatchObject({
      delta: "−0,1",
      deltaCls: "num",
    });
  });

  it("tramo en marcha sin mejor: el % del camino o lo que queda a la meta", () => {
    expect(stripView(eng({ tramos: [tramo("Crono 1", RUN)] }), 85)).toEqual({
      hidden: false,
      lap: "Crono 1 · 1:15",
      delta: "40 %",
      deltaCls: "num",
      best: "Mejor —",
    });
    const noPath = { ...RUN, s: null, frac: null };
    expect(stripView(eng({ tramos: [tramo("Crono 1", noPath)] }), 85).hidden).toBe(false);
    expect(stripView(eng({ tramos: [tramo("Crono 1", noPath)] }), 85)).toMatchObject({
      delta: "a 900 m",
    });
    expect(
      stripView(eng({ tramos: [tramo("Crono 1", { ...noPath, dMeta: 2345 })] }), 85),
    ).toMatchObject({ delta: "a 2,3 km" });
  });

  it("el primero en marcha manda, y si no, el recién acabado (12 s) o la salida a mano", () => {
    const stopped: TramoEstado = { en: false };
    const both = eng({ tramos: [tramo("Parado", stopped), tramo("Este", RUN)] });
    expect(stripView(both, 85)).toMatchObject({ lap: "Este · 1:15" });
    const done = (best: unknown, tiempo = 181.04) =>
      eng({ tramoDone: { nombre: "Los Loros", tiempo, best, at: 100 } });
    expect(stripView(done(null), 111.9)).toEqual({
      hidden: false,
      lap: "Los Loros",
      delta: "3:01,0",
      deltaCls: "num",
      best: "Primera",
    });
    expect(stripView(done({ tiempo: 182 }), 105)).toMatchObject({ best: "¡Tu mejor!" });
    expect(stripView(done({ tiempo: 179.5 }), 105)).toMatchObject({ best: "+1,5 s" });
    expect(stripView(done(null), 112)).toEqual({ hidden: true });
    const mark = { t: 40, lat: 27.77, lon: -15.52, dist0: 1500 };
    const marked = eng({ mark, route: { stats: { dist: 3820 } } });
    expect(stripView(marked, 171.9)).toEqual({
      hidden: false,
      lap: "Desde la salida · 2,3 km",
      delta: "2:11",
      deltaCls: "num",
      best: "Al llegar, «Meta aquí»",
    });
    // Con un tramo en marcha, la salida a mano no se ve.
    const both2 = eng({ mark, route: { stats: { dist: 3820 } }, tramos: [tramo("Este", RUN)] });
    expect(stripView(both2, 85)).toMatchObject({ hidden: false, lap: "Este · 1:15" });
  });
});
