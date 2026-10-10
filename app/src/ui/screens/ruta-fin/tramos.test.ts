// La tarjeta «Tramos» del resumen, igual que live.js: lo que dice la comparación de dos pasadas (dónde se gana o se
// pierde y dónde se empieza a frenar), las frenadas que se comparan, cuánto de la ruta cubren los tramos y lo que se
// pinta de dos pasadas (la gráfica y el mapa del tramo).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asCanvas, DrawLog } from "../../../../test/fake-canvas";
import { demoSeries, EPOCH, routeOf } from "../../../../test/fixtures-ruta-fin";
import { legacy, liveFunctions, loadLegacy } from "../../../../test/legacy";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import { loadTramos } from "../../../services/tramos-store";
import { mapa } from "../../draw/mapa";
import { saveTramoFrom } from "./tramo-save";
import { drawTramoChart, drawTramoMap } from "./tramo-chart";
import { brakesPair, passInsights, tramoCoverage, type PassLike } from "./tramos";

const tramosJs = legacy<object>("MaspaTramos", "tramos.js");
const telemetry = loadLegacy(
  "track-data.js",
  "sim.js",
  "analysis.js",
  "telemetry.js",
).MaspaTelemetry;

interface Old {
  passInsights: typeof passInsights;
  brakesPair: typeof brakesPair;
  tramoCoverage: (eng: Engine) => number;
  drawTramoChart: (cv: unknown, a: PassLike, b: PassLike) => void;
  drawTramoMap: (
    cv: unknown,
    eng: Engine,
    tp: unknown,
    tr: unknown,
    a: PassLike,
    b: PassLike,
  ) => void;
}

function oldFns(globals: Record<string, unknown> = {}): Old {
  return liveFunctions<Old>(
    [
      "passInsights",
      "brakesPair",
      "tramoCoverage",
      "drawTramoChart",
      "drawTramoMap",
      "fmt",
      "fmtSigned",
    ],
    {
      consts: ["NF", "T"],
      globals: { MaspaTramos: tramosJs, MaspaTelemetry: telemetry, ...globals },
    },
  );
}

// Una pasada de n marcas (cada 20 m) a una velocidad que cambia con el seno (km/h), con sus frenadas (o sin ellas).
function pass(n: number, v: (k: number) => number, frenos?: [number, number][]): PassLike {
  const tiempos = [0];
  for (let k = 1; k < n; k++) tiempos.push(tiempos[k - 1] + (20 / v(k)) * 3.6);
  return frenos ? { tiempos, tiempo: tiempos[n - 1], frenos } : { tiempos, tiempo: tiempos[n - 1] };
}

const curvy =
  (base: number, amp: number, phase = 0) =>
  (k: number) =>
    base + amp * Math.sin((k + phase) / 6) + 0.3 * amp * Math.sin((k + phase) / 2.3);

const PASSES: [string, PassLike, PassLike][] = [
  [
    "más rápida al final",
    pass(150, curvy(80, 30)),
    pass(150, (k) => curvy(80, 30)(k) - (k > 100 ? 12 : 0)),
  ],
  [
    "más lenta en medio",
    pass(150, (k) => curvy(80, 30)(k) - (k > 50 && k < 80 ? 15 : 0)),
    pass(150, curvy(80, 30)),
  ],
  [
    "frenando antes (acelerómetro)",
    pass(120, curvy(70, 25), [
      [100, 0.6],
      [400, 0.8],
      [905, 0.5],
      [1400, 0.7],
    ]),
    pass(120, curvy(72, 25, 1), [
      [130, 0.6],
      [440, 0.7],
      [960, 0.5],
      [1420, 0.6],
    ]),
  ],
  [
    "frenando en los mismos sitios",
    pass(120, curvy(70, 25), [
      [100, 0.6],
      [400, 0.8],
      [905, 0.5],
    ]),
    pass(120, curvy(70, 25), [
      [102, 0.6],
      [398, 0.8],
      [907, 0.5],
    ]),
  ],
  [
    "con el GPS (sin acelerómetro en una)",
    pass(200, curvy(90, 35)),
    pass(200, curvy(88, 35, 2), [[300, 0.5]]),
  ],
  ["casi iguales", pass(80, curvy(60, 10)), pass(80, curvy(60.2, 10))],
  ["muy corta", pass(8, curvy(60, 10)), pass(8, curvy(50, 10))],
  ["de distinto largo", pass(140, curvy(75, 20)), pass(90, curvy(75, 20))],
];

let eng: Engine;

beforeAll(async () => {
  eng = await routeOf(demoSeries());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tramos en el resumen: lo mismo que antes", () => {
  it("lo que dice la comparación de dos pasadas", () => {
    const old = oldFns();
    const said = PASSES.map(([label, a, b]) => {
      const mine = passInsights(a, b);
      expect(mine, label).toBe(old.passInsights(a, b));
      expect(brakesPair(a, b), label).toEqual(old.brakesPair(a, b));
      return mine;
    });
    // De verdad dice cosas (no solo cadenas vacías iguales).
    expect(
      said.some((s) => /^Donde más pierdes: del km \d,\d al \d,\d \(\+\d,\d s\)\./.test(s)),
    ).toBe(true);
    expect(said.some((s) => /Donde más ganas: del km/.test(s))).toBe(true);
    expect(
      said.some((s) =>
        /Empiezas a frenar de media \d+ m (antes|más tarde) \(\d+ frenadas comparadas, con el acelerómetro\)\./.test(
          s,
        ),
      ),
    ).toBe(true);
    expect(said.some((s) => /Empiezas a frenar en los mismos sitios/.test(s))).toBe(true);
    expect(said.some((s) => /Donde más cambia: en el km \d,\d\d frenas \d+ m/.test(s))).toBe(true);
    expect(passInsights(PASSES[6][1], PASSES[6][2])).toBe("");
  });

  it("cuánto de la ruta cubren sus pasadas por tramos", async () => {
    const old = oldFns();
    expect(tramoCoverage(eng)).toBe(old.tramoCoverage(eng));
    const kv = memoryKV();
    const first = await routeOf(demoSeries(), {}, kv);
    saveTramoFrom(kv, first, "Una vuelta", 40, 120, EPOCH);
    saveTramoFrom(kv, first, "Otra", 100, 300, EPOCH);
    const again = await routeOf(demoSeries(), { id: "20261010-100000-otra" }, kv);
    expect(again.tramoPasses.length).toBeGreaterThan(2);
    expect(tramoCoverage(again)).toBe(old.tramoCoverage(again));
    expect(tramoCoverage(again)).toBeGreaterThan(0);
  });

  for (const dpr of [1, 3])
    it("la gráfica de dos pasadas (densidad " + dpr + ")", () => {
      for (const [label, a, b] of PASSES) {
        const L1 = new DrawLog();
        oldFns({ devicePixelRatio: dpr }).drawTramoChart(
          L1.canvas({ clientWidth: 380, clientHeight: 240 }),
          a,
          b,
        );
        vi.stubGlobal("window", { devicePixelRatio: dpr });
        const L2 = new DrawLog();
        drawTramoChart(asCanvas(L2.canvas({ clientWidth: 380, clientHeight: 240 })), a, b);
        expect(L2.entries, label).toStrictEqual(L1.entries);
      }
    });

  it("el mapa del tramo: la trazada de la pasada y dónde empieza cada frenada", async () => {
    const kv = memoryKV();
    const first = await routeOf(demoSeries(), {}, kv);
    saveTramoFrom(kv, first, "Una vuelta", 40, 120, EPOCH);
    const again = await routeOf(demoSeries(), { id: "20261010-100000-otra" }, kv);
    const tr = loadTramos(kv)[0];
    const tp = again.tramoPasses[1];
    const [a, b] = [again.tramoPasses[1].pasada, again.tramoPasses[0].pasada] as PassLike[];
    const seen: unknown[] = [];
    const record = { draw: (_cv: unknown, o: unknown) => seen.push(JSON.parse(JSON.stringify(o))) };
    oldFns({ MaspaMapa: record }).drawTramoMap({}, again, tp, tr, a, b);
    vi.spyOn(mapa, "draw").mockImplementation((_cv, o) => {
      seen.push(JSON.parse(JSON.stringify(o)));
      return undefined;
    });
    drawTramoMap(asCanvas(new DrawLog().canvas()), again, tp, tr, a, b);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
    expect((seen[1] as { trail: unknown[]; dots: unknown[] }).trail.length).toBeGreaterThan(20);
    expect((seen[1] as { dots: unknown[] }).dots.length).toBeGreaterThan(1);
    // Sin trazada de la pasada (no debería pasar): el camino del tramo.
    seen.length = 0;
    const lost = { ...tp, t0: NaN };
    oldFns({ MaspaMapa: record }).drawTramoMap({}, again, lost, tr, a, b);
    drawTramoMap(asCanvas(new DrawLog().canvas()), again, lost, tr, a, b);
    expect(seen[1]).toEqual(seen[0]);
  });
});
