// Los textos del panel del circuito: vuelta, velocidad, diferencia con la mejor (y el aviso de frenada), tiempos y la
// última curva, con las mismas ramas y umbrales que render() y renderLive() de live.js.
import { describe, expect, it } from "vitest";
import type { CornerResult, CornerSummary, Engine } from "../../../engine";
import {
  dashClass,
  dashRecap,
  infoLines,
  lapClock,
  lapLabel,
  sectorClass,
  speedText,
  stepDelta,
} from "./dash-view";

function eng(over: Record<string, unknown> = {}): Engine {
  return {
    lapNum: 0,
    track: null,
    far: false,
    fix: null,
    lapStart: null,
    best: null,
    deltaEma: null,
    cueDone: new Set<number>(),
    prevCueS: null,
    laps: [],
    replay: false,
    recap: null,
    recapT: -Infinity,
    ...over,
  } as unknown as Engine;
}

const TRACK = { L: 3000 };
const CUE = { cue: true, lead: 20 };
const NO_CUE = { cue: false, lead: 20 };

describe("panel del circuito: arriba y la diferencia", () => {
  it("la vuelta: en marcha, hacia meta, fuera del circuito o buscando", () => {
    expect(lapLabel(eng({ lapNum: 3 }))).toBe("Vuelta 3");
    expect(lapLabel(eng({ track: TRACK }))).toBe("Hacia meta");
    expect(lapLabel(eng({ far: true }))).toBe("Fuera del circuito");
    expect(lapLabel(eng())).toBe("Buscando la pista");
  });

  it("velocidad: la prevista en el trazado o la del último fijo", () => {
    expect(speedText(eng({ fix: { v: 10 } }), { s: 0, v: 30.4 })).toBe("109");
    expect(speedText(eng({ fix: { v: 10 } }), null)).toBe("36");
    expect(speedText(eng(), null)).toBe("0");
  });

  it("sin referencia: lo que falta para tenerla", () => {
    const sub = (E: Engine) => stepDelta(E, 10, null, NO_CUE).sub;
    expect(sub(eng())).toBe("detectando el sentido de marcha");
    expect(sub(eng({ far: true }))).toBe(
      "Sin tiempos fuera del circuito · velocidad, g e inclinación sí (se calibran en marcha)",
    );
    expect(sub(eng({ track: TRACK }))).toBe("esperando meta");
    expect(sub(eng({ track: TRACK, lapStart: 2 }))).toBe("primera vuelta: sin referencia");
    expect(stepDelta(eng({ track: TRACK, lapStart: 2 }), 10, null, NO_CUE)).toEqual({
      main: "—",
      sub: "primera vuelta: sin referencia",
      cls: "",
      cue: false,
    });
  });

  it("con la mejor vuelta: diferencia suavizada y su color", () => {
    // Rejilla de 4 en 4 m: la mejor pasó por s = 400 m a los 20 s.
    const grid = Array.from({ length: 801 }, (_, k) => k * 0.2);
    const E = eng({ track: TRACK, lapStart: 100, best: { time: 65.4, grid } });
    const d1 = stepDelta(E, 121, { s: 400, v: 20 }, NO_CUE);
    expect(d1).toEqual({ main: "+1,00", sub: "frente a 1:05,40", cls: "bad", cue: false });
    expect(E.deltaEma).toBe(1);
    // Siguiente fotograma, 1 s por delante: se acerca un 15 %.
    const d2 = stepDelta(E, 119, { s: 400, v: 20 }, NO_CUE);
    expect(E.deltaEma).toBeCloseTo(0.7, 10);
    expect(d2.main).toBe("+0,70");
    // Hasta 0,05 s arriba o abajo, sin color.
    E.deltaEma = 0.04;
    expect(stepDelta(E, 120, { s: 400, v: 20 }, NO_CUE).cls).toBe("");
    E.deltaEma = -0.2;
    expect(stepDelta(E, 119.9, { s: 400, v: 20 }, NO_CUE).cls).toBe("good");
    expect(dashClass(E, "good")).toBe("dash good");
    expect(dashClass(eng({ replay: true }), "")).toBe("dash replay");
    expect(dashClass(eng({ replay: true }), "bad")).toBe("dash replay bad");
  });

  it("aviso de frenada: al pasar el punto (lead m antes), lanzado, una vez por curva", () => {
    const grid = Array.from({ length: 801 }, (_, k) => k * 0.2);
    const E = eng({
      track: TRACK,
      lapStart: 0,
      best: { time: 65, grid, brakeS: [300, null, 900] },
    });
    // Sin pasar por ningún sitio aún: no hay de dónde venir.
    expect(stepDelta(E, 50, { s: 270, v: 30 }, CUE).cue).toBe(false);
    expect(stepDelta(E, 51, { s: 285, v: 30 }, CUE).cue).toBe(true);
    expect([...E.cueDone]).toEqual([0]);
    expect(stepDelta(E, 52, { s: 300, v: 30 }, CUE).cue).toBe(false);
    // Despacio no avisa (y no se gasta el de esa curva).
    expect(stepDelta(E, 60, { s: 885, v: 20 }, CUE).cue).toBe(false);
    expect(E.cueDone.has(2)).toBe(false);
    E.prevCueS = 870;
    expect(stepDelta(E, 61, { s: 881, v: 26 }, NO_CUE).cue).toBe(false);
    E.prevCueS = 870;
    expect(stepDelta(E, 61, { s: 881, v: 26 }, CUE).cue).toBe(true);
    expect(E.prevCueS).toBe(881);
  });

  it("tiempos y sectores", () => {
    expect(lapClock(eng(), 10)).toBe("—");
    expect(lapClock(eng({ lapStart: 3 }), 68.46)).toBe("1:05,5");
    const laps = [
      { time: 70.1, valid: true },
      { time: 66.25, valid: true },
      { time: 61, valid: false },
    ];
    expect(infoLines(eng({ laps, best: { time: 66.25 } }))).toEqual([
      "Mejor 1:06,25",
      "Última 1:06,25",
    ]);
    expect(infoLines(eng())).toEqual(["Mejor —", "Última —"]);
    expect(sectorClass("best")).toBe("s-best");
    expect(sectorClass(null)).toBe("");
  });
});

function corner(over: Partial<CornerSummary>): CornerSummary {
  return {
    num: 3,
    leanMax: 40,
    gMax: 1.1,
    vMin: 80,
    brakeS: 1000,
    brk: null,
    time: 5,
    ...over,
  };
}

function recapOf(r: Partial<CornerResult>, ref: Partial<CornerSummary> | null): Engine {
  const rec: CornerResult = {
    ...corner({}),
    k: 2,
    name: "Horquilla",
    dt: null,
    ref: ref ? corner(ref) : null,
    ...r,
  };
  return eng({ track: TRACK, recap: rec, recapT: 100 });
}

describe("panel del circuito: la última curva", () => {
  it("sin curva no hay resumen", () => {
    expect(dashRecap(eng(), 0)).toBeNull();
  });

  it("nombre, diferencia de tiempo y recién salida", () => {
    const r = dashRecap(recapOf({ dt: -0.25 }, {}), 102.9);
    expect(r && [r.cls, r.name, r.dt, r.dtCls]).toEqual([
      "recap fresh",
      "C3 · Horquilla",
      "−0,25 s",
      "num up",
    ]);
    const s = dashRecap(recapOf({ dt: 0.02 }, {}), 103);
    expect(s && [s.cls, s.dt, s.dtCls]).toEqual(["recap", "+0,02 s", "num "]);
    const n = dashRecap(recapOf({ dt: null }, null), 103);
    expect(n && [n.dt, n.dtCls]).toEqual(["", "num "]);
  });

  it("cada dato frente a la mejor: «=», y en color solo si pasa del ruido", () => {
    const r = dashRecap(recapOf({ leanMax: 41.4, gMax: 1.12, vMin: 82.4 }, {}), 0);
    expect(r && [r.lean, r.g, r.v]).toEqual([
      { text: "41°", diff: "+1", diffCls: "num " },
      { text: "1,12 g", diff: "+0,02", diffCls: "num " },
      { text: "82", diff: "+2", diffCls: "num up" },
    ]);
    const s = dashRecap(recapOf({ leanMax: 40.2, gMax: 1.05, vMin: 78.4 }, {}), 0);
    expect(s && [s.lean, s.g, s.v]).toEqual([
      { text: "40°", diff: "=", diffCls: "num " },
      { text: "1,05 g", diff: "−0,05", diffCls: "num down" },
      { text: "78", diff: "−2", diffCls: "num down" },
    ]);
    // Sin la mejor (o sin ese dato en ella), sin diferencia.
    const n = dashRecap(recapOf({ leanMax: null }, null), 0);
    expect(n && [n.lean, n.g]).toEqual([
      { text: "—", diff: "", diffCls: "num " },
      { text: "1,10 g", diff: "", diffCls: "num " },
    ]);
    const g = dashRecap(recapOf({}, { gMax: null }), 0);
    expect(g && g.g.diff).toBe("");
  });

  it("dónde frenas: + más tarde, − antes, dando la vuelta por meta", () => {
    const bp = (brakeS: number | null, refS: number | null) => {
      const r = dashRecap(recapOf({ brakeS }, { brakeS: refS }), 0);
      return r && [r.bp, r.bpCls];
    };
    expect(bp(1012, 1000)).toEqual(["+12 m", "num up"]);
    expect(bp(998, 1000)).toEqual(["−2 m", "num "]);
    expect(bp(1000, 1000)).toEqual(["0 m", "num "]);
    expect(bp(5, 2990)).toEqual(["+15 m", "num up"]);
    expect(bp(2985, 4)).toEqual(["−19 m", "num down"]);
    expect(bp(null, 1000)).toEqual(["—", "num "]);
    expect(bp(1000, null)).toEqual(["—", "num "]);
  });

  it("la frenada, si la hay", () => {
    const brk = {
      peak: 1,
      bite: 0.351,
      dist: 30,
      dive: 4.12,
      diveMm: 95,
      trail: 14,
      leanMax: 22.4,
    };
    const r = dashRecap(recapOf({ brk }, {}), 0);
    expect(r && r.brk).toBe("Llega 0,35 s · hunde 4,1° ≈95 mm · tumbado 14 m (22°)");
    const n = dashRecap(recapOf({}, {}), 0);
    expect(n && n.brk).toBe("");
  });
});
