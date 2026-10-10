// Lo que mide el móvil en los dos paneles: punto del GPS, inclinación, g, «Calibrar» y caballito (las mismas ramas que
// renderLive, renderRoute, renderCalib y renderWheelie de live.js; la comparación fotograma a fotograma con ellas está
// en Dash.test.tsx y Ruta.test.tsx).
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveFunctions } from "../../../../test/legacy";
import type { Engine } from "../../../engine";
import {
  calibView,
  gpsDotClass,
  gReading,
  leanReading,
  wheelieText,
  wheelieView,
} from "./live-view";

function eng(over: Record<string, unknown> = {}): Engine {
  return {
    sim: false,
    fix: null,
    calUi: null,
    motionDenied: false,
    hasGyro: true,
    leanDeg: NaN,
    leanAxes: 0,
    calib: { f: null },
    aEma: 0,
    lastFixT: null,
    gpsBad: false,
    wheelieRecap: null,
    wheelieT: -Infinity,
    ...over,
  } as unknown as Engine;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lecturas del panel", () => {
  it("punto del GPS: esperando, al día o sin fijos recientes", () => {
    expect(gpsDotClass(eng(), 10)).toBe("dot wait");
    expect(gpsDotClass(eng({ lastFixT: 9 }), 10)).toBe("dot ok");
    expect(gpsDotClass(eng({ lastFixT: 7.5 }), 10)).toBe("dot bad");
    expect(gpsDotClass(eng({ lastFixT: 9.9, gpsBad: true }), 10)).toBe("dot bad");
  });

  it("inclinación: sin permiso, sin giroscopio, sin ejes, recto y a cada lado", () => {
    expect(leanReading(eng({ motionDenied: true }), "dash")).toEqual({
      value: "—",
      label: "sensores sin permiso",
    });
    expect(leanReading(eng({ motionDenied: true }), "ruta").label).toBe("sin permiso");
    expect(leanReading(eng({ hasGyro: false, leanDeg: 10 }), "dash").label).toBe("sin giroscopio");
    // En la ruta libre no se mira si hay giroscopio.
    expect(leanReading(eng({ hasGyro: false, leanDeg: 10 }), "ruta").value).toBe("10°");
    expect(leanReading(eng(), "dash").label).toBe("calibrando…");
    expect(leanReading(eng({ leanAxes: "montaje" }), "ruta").label).toBe("inclinación");
    expect(leanReading(eng({ leanDeg: 2.6 }), "dash")).toEqual({ value: "3°", label: "recto" });
    expect(leanReading(eng({ leanDeg: -3 }), "dash")).toEqual({
      value: "3°",
      label: "izquierda",
    });
    expect(leanReading(eng({ leanDeg: 41.6 }), "ruta")).toEqual({ value: "42°", label: "derecha" });
  });

  it("g: solo en marcha y calibrado; si no, por qué no", () => {
    const f = [1, 0, 0];
    expect(gReading(eng({ calib: { f }, aEma: -2 }), true, "dash")).toEqual({
      value: "−0,20",
      label: "g freno",
    });
    expect(gReading(eng({ calib: { f }, aEma: 1.5 }), true, "ruta")).toEqual({
      value: "+0,15",
      label: "g gas",
    });
    expect(gReading(eng({ calib: { f }, aEma: 0.5 }), true, "dash")).toEqual({
      value: "+0,05",
      label: "g",
    });
    expect(gReading(eng({ calib: { f }, aEma: 3 }), false, "dash")).toEqual({
      value: "—",
      label: "g",
    });
    expect(gReading(eng(), true, "dash").label).toBe("calibrando…");
    expect(gReading(eng({ motionDenied: true }), true, "dash").label).toBe("sin permiso");
    expect(gReading(eng({ motionDenied: true }), true, "ruta").label).toBe("calibrando…");
  });

  it("«Calibrar»: parado, nunca en la vuelta de ejemplo, y cómo va", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const moving = { t: 0, v: 10 };
    expect(calibView(eng())).toEqual({ show: true, text: "Calibrar", why: null });
    expect(calibView(eng({ sim: true })).show).toBe(false);
    expect(calibView(eng({ fix: moving })).show).toBe(false);
    expect(calibView(eng({ fix: { t: 0, v: 1.9 } })).show).toBe(true);
    const busy = { state: "busy", why: "", until: Infinity };
    expect(calibView(eng({ fix: moving, calUi: busy }))).toEqual({
      show: true,
      text: "Calibrando",
      why: null,
    });
    const ok = { state: "ok", why: "", until: 2000 };
    expect(calibView(eng({ calUi: ok })).text).toBe("Hecho ✓");
    const note = { state: "note", why: "corregida en recta (7°)", until: 2000 };
    expect(calibView(eng({ fix: moving, calUi: note }))).toEqual({
      show: false,
      text: "Calibrar",
      why: "corregida en recta (7°)",
    });
    // Pasado su tiempo, ni nota ni estado.
    const old = { state: "fail", why: "para la moto", until: 999 };
    expect(calibView(eng({ calUi: old }))).toEqual({ show: true, text: "Calibrar", why: null });
  });

  it("caballito: el texto de antes, 8 s tras bajar la rueda", () => {
    type Old = { wheelieText(w: unknown): string };
    const old = liveFunctions<Old>(["wheelieText", "fmt"], { consts: ["NF"] });
    const ws = [
      { dur: 2.14, dist: 38, max: 24.4, lost: 0.351 },
      { dur: 0.05, dist: 3, max: 0.4, lost: 0 },
      { dur: 12, dist: 410, max: 61.5, lost: 1.005 },
    ];
    for (const w of ws) expect(wheelieText(w)).toBe(old.wheelieText(w));
    expect(wheelieText(ws[0])).toBe("Caballito · 2,1 s · 38 m · 24° · ≈0,35 s perdidos");
    const E = eng({ wheelieRecap: ws[0], wheelieT: 100 });
    expect(wheelieView(E, 107.9)).toBe(wheelieText(ws[0]));
    expect(wheelieView(E, 108)).toBeNull();
    expect(wheelieView(eng(), 0)).toBeNull();
  });
});
