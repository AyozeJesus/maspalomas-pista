// Lo que pinta el resumen en sus lienzos, igual que live.js, llamada a llamada en un canvas de mentira: la gráfica de
// fases (con su escala y su nota), el mapa entero y, encima de los dos, el punto que se mueve con su curva.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asCanvas, DrawLog, type LogEntry } from "../../../../test/fake-canvas";
import { demoSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { liveFunctions } from "../../../../test/legacy";
import { legacyDraw } from "../../../../test/legacy-draw";
import type { Engine } from "../../../engine";
import { mapa, type ColorBy } from "../../draw/mapa";
import { drawChartDot, drawPhaseChart, type ChartScale } from "./phase-chart";
import { phaseNote, phaseTimes, trailDistances } from "./phases";
import { drawMapDot, drawRouteMap } from "./route-map";
import { curveSpans, spanAt } from "./scrub";

type Mapa = typeof mapa;
const { mod: oldMapa, win: mapaWin } = legacyDraw<Mapa>("MaspaMapa", "mapa.js");

interface OldScrub {
  eng: Engine | null;
  i: number;
  d: Float64Array | null;
  spans: unknown[];
  map: unknown;
  chart: (ChartScale & { base: unknown }) | null;
}
interface Old {
  renderPhaseChart: (eng: Engine) => void;
  drawScrubChart: () => void;
  drawSummaryMap: (eng: Engine) => void;
  curveSpans: (eng: Engine) => unknown[];
  scrub: OldScrub;
}

const SIZE = { clientWidth: 380, clientHeight: 240 };

// live.js con un canvas de mentira para el mapa y otro para la gráfica, en un registro.
function oldOn(log: DrawLog, dpr: number, color: ColorBy) {
  const map = log.canvas(SIZE);
  const chart = log.canvas(SIZE);
  const doc = log.document();
  mapaWin.document = doc;
  mapaWin.devicePixelRatio = dpr;
  const notes: Record<string, string> = {};
  const els: Record<string, unknown> = {
    "ruf-map": map,
    "ruf-ph-chart": chart,
    "ruf-ph": { hidden: false },
    "ruf-ph-legend": log.element("p"),
  };
  const old = liveFunctions<Old>(
    [
      "renderPhaseChart",
      "drawScrubChart",
      "drawSummaryMap",
      "drawScrubMap",
      "summaryMapDots",
      "canvasCopy",
      "curveMarks",
      "topCurves",
      "curveSpans",
      "spanAt",
      "trailIndexAt",
      "trailDistances",
      "fmt",
    ],
    {
      consts: ["NF", "scrub"],
      globals: {
        $: (id: string) => els[id],
        setText: (id: string, text: string) => (notes[id] = text),
        MaspaMapa: oldMapa,
        devicePixelRatio: dpr,
        document: doc,
        summaryColor: color,
        cutUi: null,
      },
    },
  );
  return { old, notes, map, chart };
}

const on = (log: LogEntry[], who: string) => log.filter((e) => e[0] === who);

let eng: Engine;

beforeAll(async () => {
  eng = await routeOf(demoSeries());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lienzos del resumen: lo mismo que antes", () => {
  for (const dpr of [1, 2.625])
    it("la gráfica de fases, su escala y su nota (densidad " + dpr + ")", () => {
      const L1 = new DrawLog();
      const { old, notes } = oldOn(L1, dpr, "fase");
      old.renderPhaseChart(eng);
      vi.stubGlobal("window", { devicePixelRatio: dpr });
      const L2 = new DrawLog();
      L2.canvas(SIZE);
      const chart = L2.canvas(SIZE);
      const tr = eng.route.trail;
      const sc = drawPhaseChart(asCanvas(chart), tr, trailDistances(tr));
      expect(on(L2.entries, "canvas2")).toStrictEqual(on(L1.entries, "canvas2"));
      expect(on(L2.entries, "canvas2").length).toBeGreaterThan(100);
      const c = old.scrub.chart as ChartScale;
      for (const k of ["L", "left", "right", "top", "bottom", "dpr"] as const)
        expect(sc[k]).toBe(c[k]);
      for (const s of [0, 777, sc.L / 2, sc.L]) expect(sc.X(s)).toBe(c.X(s));
      for (const v of [0, 55.5, 120]) expect(sc.Y(v)).toBe(c.Y(v));
      expect(phaseNote(phaseTimes(tr), eng.route.curves)).toBe(notes["ruf-ph-note"]);
    });

  for (const color of ["fase", "incl"] as const)
    it("el mapa entero y el punto con su curva encima (" + color + ")", () => {
      const tr = eng.route.trail;
      const d = trailDistances(tr);
      const spans = curveSpans(tr, eng.route.curves);
      vi.stubGlobal("window", { devicePixelRatio: 2 });
      for (const i of [0, 40, 97, 98, Math.round(tr.length / 3), tr.length - 1]) {
        // Cada vez desde cero (un canvas nuevo, del tamaño aún sin poner).
        const L1 = new DrawLog();
        const { old } = oldOn(L1, 2, color);
        old.scrub.eng = eng;
        old.scrub.i = i;
        old.scrub.d = d;
        old.scrub.spans = old.curveSpans(eng);
        const before = L1.entries.length;
        old.drawSummaryMap(eng);
        const L2 = new DrawLog();
        const map = L2.canvas(SIZE);
        L2.canvas(SIZE);
        const view = drawRouteMap(asCanvas(map), eng, color, []);
        if (!view) throw new Error("sin vista");
        // La copia sin el punto (la de antes la hace canvasCopy: otro canvas del registro).
        const base = asCanvas(L2.canvas());
        drawMapDot(asCanvas(map), base, view, tr, spanAt(spans, i), i, color);
        const theirs = on(L1.entries.slice(before), "canvas1");
        expect(on(L2.entries, "canvas1")).toStrictEqual(theirs);
      }
    });

  it("el punto en la gráfica (la raya y el punto en su velocidad)", () => {
    const tr = eng.route.trail;
    const d = trailDistances(tr);
    const L1 = new DrawLog();
    const { old } = oldOn(L1, 2, "fase");
    old.renderPhaseChart(eng);
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const L2 = new DrawLog();
    L2.canvas(SIZE);
    const chart = L2.canvas(SIZE);
    const sc = drawPhaseChart(asCanvas(chart), tr, d);
    const base = asCanvas(L2.canvas());
    for (const i of [0, 333, tr.length - 1]) {
      old.scrub.eng = eng;
      old.scrub.i = i;
      old.scrub.d = d;
      const a = L1.entries.length;
      old.drawScrubChart();
      const b = L2.entries.length;
      drawChartDot(asCanvas(chart), base, sc, d[i], tr[i].v * 3.6);
      expect(on(L2.entries.slice(b), "canvas2")).toStrictEqual(on(L1.entries.slice(a), "canvas2"));
    }
  });
});
