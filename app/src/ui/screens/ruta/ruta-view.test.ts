// Los textos de la ruta libre: título, velocidad, morro (hunde, hundió, cabeceo), la última curva y los totales, con
// las ramas de renderRoute de live.js. La velocidad sin datos de los sensores aún es la diferencia a propósito: antes
// salía «—» (y el mapa sin posición); ahora, la del último fijo.
import { describe, expect, it } from "vitest";
import type { Engine } from "../../../engine";
import {
  curveRecap,
  markLabel,
  pitchReading,
  rideSpeedOf,
  rideStats,
  routeTitle,
} from "./ruta-view";

function eng(over: Record<string, unknown> = {}): Engine {
  return {
    circ: null,
    circTrack: null,
    segment: undefined,
    rideV: undefined,
    fix: null,
    diveRecap: null,
    diveT: undefined,
    route: { bk: null, stats: { dist: 0, t0: null, t1: null, vMax: 0, leanL: 0, leanR: 0 } },
    pitchDeg: NaN,
    turn: undefined,
    curveRecap: null,
    curveT: -Infinity,
    mark: null,
    ...over,
  } as unknown as Engine;
}

describe("panel de la ruta libre: textos", () => {
  it("título: el circuito, el tramo tras «Nuevo tramo» o «Ruta libre»", () => {
    expect(routeTitle(eng())).toBe("Ruta libre");
    expect(routeTitle(eng({ segment: 1 }))).toBe("Ruta libre");
    expect(routeTitle(eng({ segment: 3 }))).toBe("Tramo 3");
    expect(routeTitle(eng({ segment: 3, circ: {}, circTrack: { name: "Kartódromo" } }))).toBe(
      "Kartódromo",
    );
  });

  it("velocidad: la de los sensores y, sin ella, la del último fijo", () => {
    expect(rideSpeedOf(eng({ rideV: 12.5, fix: { v: 10 } }))).toBe(12.5);
    expect(rideSpeedOf(eng({ rideV: NaN, fix: { v: 10 } }))).toBe(10);
    expect(rideSpeedOf(eng({ rideV: NaN }))).toBe(0);
    // Antes de la primera muestra de los sensores (undefined): antes «—»; ahora, la del fijo.
    expect(rideSpeedOf(eng({ fix: { v: 10 } }))).toBe(10);
  });

  it("morro: hunde frenando recto, hundió 4 s al soltar, y si no el cabeceo", () => {
    const braking = { route: { bk: {}, stats: {} }, pitchDeg: -2.5 };
    expect(pitchReading(eng(braking), 0)).toEqual({ label: "hunde", value: "≈50 mm" });
    expect(pitchReading(eng({ ...braking, turn: 0.2 }), 0).label).toBe("morro");
    expect(pitchReading(eng({ ...braking, turn: 0.05 }), 0).label).toBe("hunde");
    const dr = { diveRecap: { diveMm: 61 }, diveT: 10 };
    expect(pitchReading(eng(dr), 13.9)).toEqual({ label: "hundió", value: "61 mm" });
    expect(pitchReading(eng(dr), 14)).toEqual({ label: "morro", value: "—" });
    expect(pitchReading(eng({ pitchDeg: 0.3 }), 0).value).toBe("0°");
    expect(pitchReading(eng({ pitchDeg: -0.4 }), 0).value).toBe("0°");
    expect(pitchReading(eng({ pitchDeg: 3.4 }), 0).value).toBe("+3°");
    expect(pitchReading(eng({ pitchDeg: -1.6 }), 0).value).toBe("−2°");
  });

  it("la última curva", () => {
    expect(curveRecap(eng(), 0)).toBeNull();
    const c = {
      num: 12,
      lean: -31.2,
      dur: 4.26,
      leanMax: 38.6,
      brakeG: 0.734,
      vEntry: 92.4,
      vMin: 61.5,
      dead: 1.62,
      brk: { bite: 0.42, dive: null, diveMm: null, trail: 0, leanMax: null },
    };
    expect(curveRecap(eng({ curveRecap: c, curveT: 50 }), 52)).toEqual({
      cls: "recap fresh",
      name: "Curva 12 · izquierda",
      dur: "4,3 s en curva",
      lean: "39°",
      g: "0,73 g",
      v: "92→62",
      dead: "1,6 s",
      deadCls: "num down",
      brk: "Llega 0,42 s",
    });
    const d = { ...c, lean: null, leanMax: 0, brakeG: null, dead: 0.5, brk: null };
    expect(curveRecap(eng({ curveRecap: d, curveT: 50 }), 53)).toMatchObject({
      cls: "recap",
      name: "Curva 12",
      lean: "—",
      g: "sin freno",
      deadCls: "num up",
      brk: "",
    });
    expect(curveRecap(eng({ curveRecap: { ...c, lean: 5, dead: 1 }, curveT: 0 }), 9)).toMatchObject(
      { name: "Curva 12 · derecha", deadCls: "num " },
    );
  });

  it("totales y el botón de la salida", () => {
    expect(rideStats(eng())).toEqual({
      dist: "0,0 km",
      time: "0:00",
      lean: "máx —",
      top: "punta —",
    });
    const stats = { dist: 23456, t0: 10, t1: 3735.4, vMax: 33.4, leanL: 38.4, leanR: 41.6 };
    expect(rideStats(eng({ route: { stats } }))).toEqual({
      dist: "23,5 km",
      time: "1:02:05",
      lean: "máx 42°",
      top: "punta 120",
    });
    expect(markLabel(eng())).toBe("Salida aquí");
    expect(markLabel(eng({ mark: { t: 0, lat: 0, lon: 0, dist0: 0 } }))).toBe("Meta aquí");
  });
});
