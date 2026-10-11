// @vitest-environment jsdom
// El resumen de la ruta enseña lo mismo que showRouteSummary de live.js con el mismo motor (la vuelta de ejemplo
// repasada como ruta libre, con caballitos, avisos de caída, nombre, circuito, tramos…): mismas etiquetas, ids,
// clases, textos, lo que está oculto y el valor de cada campo; y lo mismo al tocar «Ver las N», el punto que se mueve
// y «Cortar en dos». Lo que se hace al tocar el resto (color, nombre, tramos, circuito, compartir, cortar), aparte.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoSeries, EPOCH, lorosSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import {
  domTree,
  fakeCanvases,
  oldCutInput,
  oldCutToggle,
  oldWorld,
  runFrames,
  type OldWorld,
} from "../../../../test/legacy-ruta-fin";
import { refreshSummary, show, uiStore } from "../../../app/ui-store";
import type { CircuitTrack, LapTimer } from "../../../core/circuito";
import type { MergedSeriesSet } from "../../../core/formato";
import type { Wheelie } from "../../../core/recorrido";
import type { CrashRecord, Engine, ReplayMeta } from "../../../engine";
import { memoryKV, type KeyValueStore } from "../../../engine/kv";
import { DEFAULT_SETTINGS, type Settings } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { mapa } from "../../draw/mapa";
import { RuntimeContext } from "../../runtime-context";
import { RutaFin } from "./RutaFin";
import { saveTramoFrom } from "./tramo-save";

// La app de antes no tenía subidas de montaña: para comparar, sin ellas (la ruta de Los Loros pasa por una; con ellas,
// en src/engine/subidas.test.ts).
vi.mock("../../../app/subidas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/subidas")>()),
  todasLasSubidas: () => [],
}));

const frames: (() => void)[] = [];
let demoCache: MergedSeriesSet | null = null;

beforeEach(() => {
  fakeCanvases(window);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  uiStore.setState({ screen: "home", summaryVersion: 0, toast: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  frames.length = 0;
});

function demo(): MergedSeriesSet {
  if (!demoCache) demoCache = demoSeries();
  return demoCache;
}

// Los primeros segundos de una grabación (una ruta casi sin trazada).
function firstSeconds(S: MergedSeriesSet, s: number): MergedSeriesSet {
  const out: Record<string, Record<string, Float64Array>> = {};
  for (const [key, cols] of Object.entries(S)) {
    if (!cols) continue;
    const t = (cols as Record<string, Float64Array>).t;
    const n = t.findIndex((x) => x > t[0] + s);
    const o: Record<string, Float64Array> = {};
    for (const [c, v] of Object.entries(cols as Record<string, Float64Array>)) o[c] = v.slice(0, n);
    out[key] = o;
  }
  return out as MergedSeriesSet;
}

interface Bench {
  eng: Engine;
  kv: KeyValueStore;
  store: { patchSession: ReturnType<typeof vi.fn> };
  runtime: Runtime;
  root: HTMLElement;
  old: OldWorld;
}

interface BenchOptions {
  series?: MergedSeriesSet;
  meta?: Partial<ReplayMeta>;
  kv?: KeyValueStore;
  settings?: Partial<Settings>;
  // Sin almacén en el móvil (sin nombre ni cortar).
  noStore?: boolean;
  // Cambios en el motor antes de pintar (lo que no sale del repaso).
  prepare?: (eng: Engine) => void;
  // El color del mapa con el que se pinta.
  incl?: boolean;
}

// El resumen de ahora (el componente con un runtime de mentira) y el de antes, pintados con el mismo motor.
async function bench(o: BenchOptions = {}): Promise<Bench> {
  const kv = o.kv ?? memoryKV();
  const eng = await routeOf(o.series ?? demo(), o.meta, kv);
  o.prepare?.(eng);
  const store = { patchSession: vi.fn(() => Promise.resolve(true)) };
  const settings: Settings = { ...DEFAULT_SETTINGS, ...o.settings };
  const runtime = {
    kv,
    store: o.noStore ? null : store,
    settings: { get: () => settings },
    session: { rt: { E: null, lastE: eng } },
    nav: { goHome: vi.fn() },
  } as unknown as Runtime;
  const { container } = render(
    <RuntimeContext.Provider value={runtime}>
      <RutaFin />
    </RuntimeContext.Provider>,
  );
  const root = container.querySelector<HTMLElement>("#ruta-fin");
  if (!root) throw new Error("sin #ruta-fin");
  act(() => {
    show("ruta-fin");
    refreshSummary();
  });
  if (o.incl) click(root, "ruf-color");
  act(() => runFrames(frames));
  const old = oldWorld({
    kv,
    store: o.noStore ? null : store,
    garaje: !!settings.garaje,
    color: o.incl ? "incl" : "fase",
  });
  old.old.showRouteSummary(eng as never);
  runFrames(old.frames);
  return { eng, kv, store, runtime, root, old };
}

function oldRoot(b: Bench): HTMLElement {
  const el = b.old.doc.getElementById("ruta-fin");
  if (!el) throw new Error("sin #ruta-fin de antes");
  return el;
}

function byId<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T {
  const el = root.querySelector<T>("#" + id);
  if (!el) throw new Error("sin #" + id);
  return el;
}

function click(root: ParentNode, id: string): void {
  act(() => byId(root, id).click());
}

function same(b: Bench): void {
  act(() => runFrames(frames));
  runFrames(b.old.frames);
  expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
}

// Una barra movida con el dedo (el valor y su «input», como las pruebas de siempre).
function slide(el: HTMLInputElement, value: number): void {
  act(() => {
    el.value = String(value);
    el.dispatchEvent(new Event("input"));
  });
}

const WHEELIES: Wheelie[] = Array.from({ length: 7 }, (_, k) => ({
  num: k + 1,
  t: 100 + 30 * k,
  dur: 0.8 + k / 3,
  dist: 12 + 7 * k,
  max: 9.6 + 4.1 * k,
  v0: 48 + 3 * k,
  lossIn: 0.04 * k,
  lost: 0.031 + 0.07 * k,
  pos: null,
}));

const CRASHES: CrashRecord[] = [
  {
    hora: new Date(EPOCH + 600000).toISOString(),
    t: 600,
    por: "golpe",
    g: 3.4,
    kmhAntes: 61,
    tumbada: true,
    paradoA: 12,
    alarma: false,
  },
  {
    hora: new Date(EPOCH + 900000).toISOString(),
    t: 900,
    por: "golpe",
    g: 4.1,
    kmhAntes: 72,
    tumbada: 40,
    paradoA: null,
    alarma: true,
  },
  {
    hora: new Date(EPOCH + 1200000).toISOString(),
    t: 1200,
    por: "parado",
    g: null,
    kmhAntes: 0,
    tumbada: null,
    paradoA: null,
    alarma: false,
  },
];

// Un circuito sacado de las vueltas (lo que pone applyCircuit; aquí, a mano).
function withCircuit(eng: Engine, saved: boolean): void {
  eng.circ = {
    laps: [
      { num: 1, time: 72.314, valid: true, t0: 10, t1: 82 },
      { num: 2, time: 70.051, valid: true, t0: 82, t1: 152 },
      { num: 3, time: 95.2, valid: false, t0: 152, t1: 247 },
      { num: 4, time: 70.88, valid: true, t0: 247, t1: 318 },
    ],
    best: { time: 70.051, grid: [], num: 2 },
  } as unknown as LapTimer;
  eng.circTrack = {
    name: "Circuito del 9 oct",
    origin: { lat: 27.77, lon: -15.52 },
    centerline: [],
    length: 2184.4,
  } as CircuitTrack;
  eng.circSaved = saved;
}

describe("resumen de la ruta: lo mismo que antes", () => {
  it("la vuelta de ejemplo repasada como ruta guardada", async () => {
    const b = await bench();
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    // De verdad pintado (no dos resúmenes vacíos iguales).
    expect(byId(b.root, "ruf-sub").textContent).toMatch(
      /^viernes, 9 de octubre · \d+,\d km · \d+:\d\d$/,
    );
    expect(b.root.querySelectorAll("#ruf-curves tr")).toHaveLength(15);
    expect(byId(b.root, "ruf-at").textContent).toMatch(/^km 0,0 · 0:00 · \d+ km\/h/);
  });

  it("con nombre, caballitos, avisos de caída, garaje y el mapa por inclinación", async () => {
    const b = await bench({
      meta: { nombre: "Los Loros", caidas: CRASHES },
      settings: { garaje: { u: "https://mac", k: "clave" } },
      prepare: (eng) => eng.route.wheelies.push(...WHEELIES),
      incl: true,
    });
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    expect(byId(b.root, "ruf-title").textContent).toBe("Los Loros");
    expect(byId(b.root, "ruf-stats2").textContent).toMatch(/Avisos de caída.*sonó la alarma/);
    expect(byId(b.root, "ruf-color").textContent).toBe("Color: inclinación");
  });

  it("la vuelta de ejemplo sin grabación (ni nombre, ni cortar, ni tramos)", async () => {
    const b = await bench({
      noStore: true,
      prepare: (eng) => {
        eng.viewing = null;
      },
    });
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    expect(byId(b.root, "ruf-nombre-box").hidden).toBe(true);
    expect(byId(b.root, "ruf-cut").hidden).toBe(true);
  });

  it("una ruta de unos segundos (sin curvas ni gráfica)", async () => {
    const b = await bench({ series: firstSeconds(demo(), 3) });
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    expect(byId(b.root, "ruf-ph").hidden).toBe(true);
  });

  it("por un circuito sacado de las vueltas, sin guardar y guardado", async () => {
    for (const saved of [false, true]) {
      const b = await bench({ prepare: (eng) => withCircuit(eng, saved) });
      expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
      expect(byId(b.root, "ruf-save").hidden).toBe(saved);
      cleanup();
    }
  });

  it("repasando una ruta con las vueltas apuntadas de un circuito sin guardar", async () => {
    const b = await bench({
      meta: {
        circuito: {
          nombre: "Maspalomas",
          longitud: 2190,
          guardado: false,
          mejor: 66.21,
          vueltas: [
            { num: 1, time: 68.4, valid: true },
            { num: 2, time: 66.21, valid: true },
            { num: 3, time: 80.02, valid: false },
          ],
          trazado: null,
          sentido: "normal",
          forzadas: null,
        },
      },
    });
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    expect(b.root.querySelectorAll("#ruf-laps tr")).toHaveLength(3);
  });

  it("con pasadas por un tramo guardado (comparadas con la mejor)", async () => {
    const kv = memoryKV();
    const first = await routeOf(demo(), {}, kv);
    expect(saveTramoFrom(kv, first, "Recta y horquilla", 60, 140, EPOCH)).not.toBeNull();
    const b = await bench({ kv, meta: { id: "20261010-100000-otra", epoch: EPOCH + 86400000 } });
    expect(b.eng.tramoPasses.length).toBeGreaterThan(1);
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    expect(b.root.querySelectorAll("#ruf-tr-list .tr-item canvas.tr-chart").length).toBeGreaterThan(
      0,
    );
  });

  it.skipIf(!lorosSeries())("Los Loros: subida y bajada (ida y vuelta)", async () => {
    const S = lorosSeries() as MergedSeriesSet;
    const b = await bench({ series: S });
    expect(domTree(b.root)).toEqual(domTree(oldRoot(b)));
    expect(byId(b.root, "ruf-cut-note").textContent).toMatch(/^Sube y baja/);
    expect(byId(b.root, "ruf-tr-two").hidden).toBe(false);
  });
});

describe("resumen de la ruta: al tocarlo, lo mismo que antes", () => {
  it("«Ver las N» y «Ver menos» en las tablas", async () => {
    const b = await bench({ prepare: (eng) => eng.route.wheelies.push(...WHEELIES) });
    for (const id of ["ruf-c-more", "ruf-b-more", "ruf-w-more"]) {
      click(b.root, id);
      byId(b.old.doc, id).click();
      same(b);
    }
    click(b.root, "ruf-b-more");
    byId(b.old.doc, "ruf-b-more").click();
    same(b);
  });

  it("el punto que se mueve: de curva en curva y con la barra", async () => {
    const b = await bench();
    for (const dir of [1, 1, 1, -1, 1] as const) {
      click(b.root, dir > 0 ? "ruf-next" : "ruf-prev");
      b.old.old.jumpCurve(dir as never);
      same(b);
    }
    const n = b.eng.route.trail.length;
    for (const at of [Math.round(n / 2), n - 1, 0, 37]) {
      slide(byId<HTMLInputElement>(b.root, "ruf-pos"), at);
      byId<HTMLInputElement>(b.old.doc, "ruf-pos").value = String(at);
      b.old.old.scrubTo(at as never);
      same(b);
    }
  });

  it("«Cortar en dos»: abrirlo (el punto rosa en el mapa) y mover la barra", async () => {
    const b = await bench();
    const mine: unknown[] = [];
    const theirs: unknown[] = [];
    const draw = mapa.draw;
    vi.spyOn(mapa, "draw").mockImplementation((cv, o) => {
      mine.push(o.dots);
      return draw(cv, o);
    });
    const oldDraw = b.old.mapa.draw;
    b.old.mapa.draw = (...args: unknown[]) => {
      theirs.push((args[1] as { dots?: unknown }).dots);
      return oldDraw(...args);
    };
    act(() => {
      byId<HTMLDetailsElement>(b.root, "ruf-cut").open = true;
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    oldCutToggle(b.old, true);
    same(b);
    for (const t of [200, 333, 500]) {
      slide(byId<HTMLInputElement>(b.root, "ruf-cut-t"), t);
      oldCutInput(b.old, t);
      same(b);
      expect(JSON.stringify(mine[mine.length - 1])).toBe(JSON.stringify(theirs[theirs.length - 1]));
    }
    expect(mine[mine.length - 1]).toEqual([
      expect.objectContaining({ label: "corte", color: "#ff5fd2" }),
    ]);
    // Cerrado, sin punto.
    act(() => {
      byId<HTMLDetailsElement>(b.root, "ruf-cut").open = false;
    });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    oldCutToggle(b.old, false);
    same(b);
    expect(mine[mine.length - 1]).toEqual([]);
  });

  it("el color del mapa repinta el resumen y el punto sigue donde estaba", async () => {
    const b = await bench();
    for (let k = 0; k < 4; k++) click(b.root, "ruf-next");
    for (let k = 0; k < 4; k++) b.old.old.jumpCurve(1 as never);
    same(b);
    click(b.root, "ruf-color");
    b.old.win.summaryColor = "incl";
    b.old.old.showRouteSummary(b.eng as never);
    same(b);
    expect(byId(b.root, "ruf-color").textContent).toBe("Color: inclinación");
  });
});
