import { afterEach, describe, expect, it, vi } from "vitest";
import {
  circuitOutline,
  lapTrail,
  leanMarks,
  mountainTrail,
  sectorsOf,
} from "../../../test/draw-fixtures";
import {
  asCanvas,
  asDocument,
  asElement,
  DrawLog,
  type CanvasOptions,
  type LogEntry,
} from "../../../test/fake-canvas";
import { legacyDraw } from "../../../test/legacy-draw";
import * as M from "./mapa";

type Mapa = typeof M.mapa;

// La app de antes, tal cual (mapa.js de la raíz del repo).
const { mod: old, win } = legacyDraw<Mapa>("MaspaMapa", "mapa.js");

afterEach(() => {
  vi.unstubAllGlobals();
});

// Densidad de la pantalla para las dos versiones (las dos la leen de window).
function setDpr(dpr: number | undefined) {
  win.devicePixelRatio = dpr;
  vi.stubGlobal("window", { devicePixelRatio: dpr });
}

// Unos puntos para comparar lo que dicen las dos vistas.
const PROBE: [number, number][] = [
  [0, 0],
  [123.4, -56.7],
  [-800, 950],
];

interface Painted {
  log: LogEntry[];
  view: unknown;
}

// Pinta con una de las dos versiones en un canvas de mentira: lo apuntado y la vista que devuelve.
function paint(impl: Mapa, o: M.MapDrawOptions, cv: CanvasOptions): Painted {
  const log = new DrawLog();
  const view = impl.draw(asCanvas(log.canvas(cv)), o);
  return {
    log: log.entries,
    view: view && {
      scale: view.scale,
      dpr: view.dpr,
      px: PROBE.map(([x, y]) => view.toPx(x, y)),
      world: PROBE.map(([x, y]) => view.toWorld(x, y)),
    },
  };
}

// Pinta lo mismo con las dos y comprueba que han hecho lo mismo, llamada a llamada; devuelve lo de la nueva (para
// ver que la prueba ha pintado algo).
function same(o: M.MapDrawOptions, cv: CanvasOptions = { clientWidth: 380, clientHeight: 300 }) {
  const mine = paint(M.mapa, o, cv);
  const theirs = paint(old, o, cv);
  expect(mine.log).toStrictEqual(theirs.log);
  expect(mine.view).toEqual(theirs.view);
  return mine;
}

function calls(log: LogEntry[], what: string): LogEntry[] {
  return log.filter((e) => e[1] === what);
}

function strokeColors(log: LogEntry[]): Set<unknown> {
  return new Set(calls(log, "strokeStyle=").map((e) => e[2]));
}

describe("mapa (igual que el de antes)", () => {
  const trail = mountainTrail();
  const marks = leanMarks(trail);
  // Tres marcas casi encima de otras: no se pintan (no se pisan los textos).
  const crowded = marks.concat(
    marks.slice(0, 3).map((m) => ({ x: m.x + 4, y: m.y + 3, text: "99°" })),
  );
  const n = trail.length;
  const last = trail[n - 1];
  const heading = Math.atan2(last.y - trail[n - 2].y, last.x - trail[n - 2].x);
  // Como los de live.js: el corte, la salida y la meta de un tramo, las frenadas de dos pasadas y uno sin nada.
  const dots: M.MapDot[] = [
    { x: trail[200].x, y: trail[200].y, color: "#ff5fd2", label: "corte" },
    { x: trail[40].x, y: trail[40].y, color: "#38d0ff", r: 5, label: "S" },
    { x: trail[460].x, y: trail[460].y, color: "#38d0ff", r: 5, ring: true, label: "M" },
    { x: trail[300].x, y: trail[300].y, color: "#a86ff0", ring: true, r: 6 },
    { x: trail[302].x, y: trail[302].y, color: "#5aa5f0", ring: false, r: 3.5 },
    { x: trail[600].x, y: trail[600].y },
  ];

  it("la ruta entera por fases: huecos, caballito, marcas que se pisan, puntos y la flecha", () => {
    setDpr(2.75);
    const { log, view } = same({
      trail,
      pos: { x: last.x, y: last.y, heading },
      follow: false,
      span: 600,
      colorBy: "fase",
      marks: crowded,
      dots,
    });
    expect(view).toBeDefined();
    const colors = strokeColors(log);
    for (const c of Object.values(M.PHASE)) expect(colors).toContain(c);
    expect(colors).toContain("#d08bff");
    // Las marcas que se pisan no se pintan; las letras de los puntos, con su borde.
    const markTexts = calls(log, "fillText").length - 3;
    expect(markTexts).toBeGreaterThan(5);
    expect(markTexts).toBeLessThan(crowded.length);
    expect(calls(log, "strokeText")).toHaveLength(3);
    expect(calls(log, "arc")).toHaveLength(dots.length);
  });

  it("por inclinación, fuera de la pantalla (sin densidad: 1)", () => {
    const { log } = same({
      trail,
      colorBy: "incl",
      follow: false,
      marks,
      size: { w: 984, h: 660 },
    });
    // Todos los tramos de inclinación, y el gris de sin calibrar.
    const colors = strokeColors(log);
    for (const c of ["#6c7880", "#8a969e", "#5aa5f0", "#22c35f", "#f2b300", "#ff5b4f"])
      expect(colors).toContain(c);
    expect(calls(log, "width=")).toEqual([["canvas1", "width=", 984]]);
  });

  it("siguiendo a la moto con el rumbo arriba: lo lejano no se pinta", () => {
    setDpr(3.5);
    const at = trail[350];
    const { log } = same({
      trail,
      pos: { x: at.x, y: at.y, heading: 2.1 },
      follow: true,
      span: 600,
      colorBy: "fase",
      marks: crowded,
      dots,
    });
    const drawn = calls(log, "lineTo").length;
    expect(drawn).toBeGreaterThan(20);
    expect(drawn).toBeLessThan(n / 2);
    // Densidad 3 como mucho.
    expect(calls(log, "width=")).toEqual([["canvas1", "width=", 1140]]);
  });

  it("siguiendo sin rumbo todavía (norte arriba), con el alcance por defecto (500 m) y sin densidad", () => {
    setDpr(undefined);
    const at = trail[120];
    same({ trail, pos: { x: at.x, y: at.y, heading: null }, follow: true, marks, dots });
    same({ trail, pos: { x: at.x, y: at.y }, follow: true, colorBy: "incl", span: 150 });
    // Rumbo que no es un número de verdad: todo NaN, igual en las dos.
    same({ trail, pos: { x: at.x, y: at.y, heading: NaN }, follow: true, marks });
  });

  it("seguir sin posición: el recorrido entero, pero con el alcance de seguir", () => {
    setDpr(2);
    same({ trail, pos: null, follow: true, marks, dots });
  });

  it("el circuito del panel: trazado, sectores, frenadas, la vuelta y dónde va (canvas ya a su tamaño)", () => {
    setDpr(2.75);
    const outline = circuitOutline();
    const lap = lapTrail(outline);
    const brakes = [outline[30], outline[200], outline[410], outline[555]];
    const { log } = same(
      {
        outline,
        width: 12,
        sectors: sectorsOf(outline, ["best", "good", "bad", null, "rara"]),
        brakes,
        trail: lap.slice(0, 300),
        pos: { x: outline[300][0], y: outline[300][1], heading: -0.7 },
        follow: false,
        colorBy: "fase",
      },
      { clientWidth: 160, clientHeight: 120, width: 440, height: 330 },
    );
    expect(calls(log, "width=")).toHaveLength(0);
    const colors = strokeColors(log);
    for (const c of ["#a86ff0", "#22c35f", "#f2c230"]) expect(colors).toContain(c);
    expect(calls(log, "globalAlpha=")).toHaveLength(6);
    expect(calls(log, "arc")).toHaveLength(brakes.length);
  });

  it("trazado sin ancho (12) o de un solo punto, y trazada de un solo punto", () => {
    const outline = circuitOutline();
    const size = { w: 408, h: 340, dpr: 2.6 };
    same({ outline, trail: lapTrail(outline), follow: false, size });
    same({ outline: outline.slice(0, 1), trail: [trail[5]], follow: false, size });
    same({ trail: [trail[5]], brakes: [outline[3]], follow: false, size });
  });

  it("nada que pintar: solo prepara el canvas (también oculto, de 0 × 0)", () => {
    setDpr(2.75);
    const { log, view } = same({ trail: [], follow: false });
    expect(view).toBeUndefined();
    expect(log.map((e) => e[1])).toEqual([
      "width=",
      "height=",
      "getContext",
      "setTransform",
      "clearRect",
    ]);
    same({ follow: false, marks, dots });
    same({ trail, follow: false, marks }, { clientWidth: 0, clientHeight: 0 });
  });

  it("leyenda, colores y tablas: igual", () => {
    expect(Object.keys(M.mapa).sort()).toEqual(Object.keys(old).sort());
    expect(M.PHASE).toEqual(old.PHASE);
    for (const by of ["fase", "incl", undefined] as const)
      expect(M.legendItems(by)).toEqual(old.legendItems(by));
    const leans = [0, -0, 7, 14.99, 15, -29.9, 30, 39.99, -40, 49.9, 50, 75, -88, NaN, Infinity];
    for (const l of [...leans, undefined]) expect(M.leanColor(l)).toBe(old.leanColor(l));
    const points: M.MapTrailPoint[] = [
      { x: 0, y: 0, ph: "freno", lean: 44 },
      { x: 0, y: 0, ph: "gas", lean: -12, wh: true },
      { x: 0, y: 0, ph: "muerto", lean: NaN },
      { x: 0, y: 0, ph: "mantiene", lean: 31 },
      { x: 0, y: 0, ph: "rara", lean: 52 },
      { x: 0, y: 0 },
    ];
    for (const p of points)
      for (const by of ["fase", "incl", undefined] as const)
        expect(M.colorOf(p, by)).toBe(old.colorOf(p, by));
    // La leyenda en HTML: los mismos elementos con sus colores.
    for (const by of ["fase", "incl"] as const) {
      const legendOf = (impl: Mapa) => {
        const log = new DrawLog();
        const doc = log.document();
        win.document = doc;
        vi.stubGlobal("document", asDocument(doc));
        impl.legend(asElement(log.element("div")), by);
        return log.entries;
      };
      const mine = legendOf(M.mapa);
      expect(mine).toStrictEqual(legendOf(old));
      expect(calls(mine, "appendChild")).toHaveLength(5);
    }
  });
});
