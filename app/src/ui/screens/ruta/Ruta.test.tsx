// @vitest-environment jsdom
// El panel de la ruta libre pinta lo mismo que renderRoute() de live.js con el mismo motor: la vuelta de ejemplo como
// ruta libre, fotograma a fotograma (textos, clases, lo que se ve, el mapa, su leyenda y sus botones), sola, con un
// circuito (vueltas en la franja) y con un tramo de salida y meta (tramo en marcha, acabado y la salida a mano). Y
// escribe en el DOM mucho menos que antes.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoEngine, demoLatLon, type DemoRun } from "../../../../test/demo-engine";
import {
  oldMapButtons,
  oldPanel,
  panelState,
  writeCounter,
  type OldPanel,
} from "../../../../test/legacy-panel";
import { uiStore } from "../../../app/ui-store";
import type { CircuitTrack } from "../../../core/circuito";
import { MASPA_GEO, toLatLon } from "../../../core/maspalomas";
import { applyCircuit, type Engine } from "../../../engine";
import { memoryKV, type KeyValueStore } from "../../../engine/kv";
import type { Runtime } from "../../../runtime";
import { loadTramos, TRAMOS_KEY } from "../../../services/tramos-store";
import { mapa } from "../../draw/mapa";
import { RuntimeContext } from "../../runtime-context";
import { Ruta } from "./Ruta";
import { createRutaPainter, type RutaPainter } from "./ruta-painter";

let clockMs = 1000;

function fakeRuntime(E: Engine, kv: KeyValueStore): Runtime {
  return {
    session: {
      rt: { E, sim: { speed: 1 } },
      stopAll: () => {},
      newSegment: () => Promise.resolve(true),
    },
    ext: { hzText: () => "" },
    view3d: { close: null, view: null },
    kv,
  } as unknown as Runtime;
}

interface Bench {
  run: DemoRun;
  old: OldPanel;
  root: HTMLElement;
  painter: RutaPainter;
  draws: string[];
  legends: string[];
}

function bench(kv: KeyValueStore = memoryKV()): Bench {
  const draws: string[] = [];
  const legends: string[] = [];
  vi.spyOn(mapa, "draw").mockImplementation((_cv, o) => {
    draws.push(JSON.stringify(o));
    return undefined;
  });
  vi.spyOn(mapa, "legend").mockImplementation((_el, by) => {
    legends.push(String(by));
  });
  let old: OldPanel | null = null;
  const run = demoEngine({
    free: true,
    kv,
    events: {
      lapFlash: (_E, time, isBest, prevBest) => {
        uiStore.setState({ flash: { kind: "lap", time, isBest, prevBest } });
        if (old) old.flash.hidden = false;
      },
    },
  });
  old = oldPanel(run.E, { settings: run.settings, tramos: loadTramos(kv) });
  const rt = fakeRuntime(run.E, kv);
  const { container } = render(
    <RuntimeContext.Provider value={rt}>
      <Ruta />
    </RuntimeContext.Provider>,
  );
  const root = container.querySelector<HTMLElement>("#ruta");
  if (!root) throw new Error("sin #ruta");
  return { run, old, root, painter: createRutaPainter(root, rt), draws, legends };
}

// Un fotograma de los dos paneles: tienen que quedar igual. Devuelve las escrituras de cada uno.
function frame(b: Bench, why: string): { oldW: number; mineW: number } {
  const oldDraws = b.old.draws.length;
  const mineDraws = b.draws.length;
  const oldW = writeCounter(b.old.ruta);
  b.old.renderRoute();
  const oldWrites = oldW.take();
  oldW.stop();
  const mineW = writeCounter(b.root);
  b.painter.paint();
  const mineWrites = mineW.take();
  mineW.stop();
  expect(panelState(b.root), why).toEqual(panelState(b.old.ruta));
  expect(b.draws.slice(mineDraws), why).toEqual(b.old.draws.slice(oldDraws));
  expect(b.legends, why).toEqual(b.old.legends);
  expect(!!uiStore.getState().flash, why).toBe(!b.old.flash.hidden);
  return { oldW: oldWrites, mineW: mineWrites };
}

// Toda la vuelta de ejemplo en fotogramas de dt segundos; each: algo que hacer antes de algunos fotogramas. tick: ms
// del reloj de la página por fotograma (el mapa se pinta cada 160 ms: con menos, no en todos).
function ride(
  b: Bench,
  dt: number,
  each?: (i: number) => void,
  tick = dt * 1000,
): { frames: number; old: number; mine: number } {
  let frames = 0;
  let old = 0;
  let mine = 0;
  while (!b.run.done()) {
    b.run.step(dt);
    clockMs += tick;
    if (each) each(frames);
    const r = frame(b, "t = " + b.run.E.simT.toFixed(2));
    frames++;
    old += r.oldW;
    mine += r.mineW;
  }
  return { frames, old, mine };
}

// El circuito de Maspalomas como uno cualquiera (su eje en latitud y longitud): el cronómetro de la ruta libre.
function maspalomasCircuit(): CircuitTrack {
  const centerline = MASPA_GEO.main.map(([x, y]) => toLatLon(x, y));
  return {
    name: "Maspalomas",
    origin: { lat: centerline[0][0], lon: centerline[0][1] },
    centerline,
    length: 0,
  };
}

beforeEach(() => {
  clockMs = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clockMs);
  uiStore.setState({ flash: null, screen: "home" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("panel de la ruta libre: igual que renderRoute() de antes", () => {
  it("la vuelta de ejemplo como ruta libre, con los botones del mapa", () => {
    const b = bench();
    const E = b.run.E;
    let curves = 0;
    // 80 ms de reloj por fotograma: el mapa, uno sí y otro no (y en seguida al tocar sus botones).
    const r = ride(
      b,
      0.25,
      (i) => {
        if (E.curveRecap) curves++;
        // Los botones del mapa, en los dos paneles a la vez.
        const press = (k: keyof typeof oldMapButtons) => {
          oldMapButtons[k](b.old.mapView);
          b.painter[k]();
        };
        if (i === 301) press("color");
        if (i === 321) press("fit");
        if (i === 341) press("fit");
        if (i === 361) press("zoomIn");
        if (i === 381) press("zoomOut");
        if (i === 401) press("color");
        if (i === 500) E.segment = 2;
      },
      80,
    );
    expect(curves).toBeGreaterThan(100);
    expect(b.legends).toEqual(["fase", "incl", "fase"]);
    expect(r.mine / r.frames, "antes " + (r.old / r.frames).toFixed(1)).toBeLessThan(
      r.old / r.frames / 2,
    );
  }, 120000);

  it("a 60 fotogramas por segundo, rodando: unas pocas escrituras por fotograma (antes, todo cada vez)", () => {
    const b = bench();
    for (let i = 0; i < 480; i++) b.run.step(0.25);
    let oldWrites = 0;
    let mineWrites = 0;
    const frames = 1800;
    for (let i = 0; i < frames; i++) {
      b.run.step(1 / 60);
      clockMs += 1000 / 60;
      const r = frame(b, "t = " + b.run.E.simT.toFixed(3));
      oldWrites += r.oldW;
      mineWrites += r.mineW;
    }
    const perOld = oldWrites / frames;
    const perMine = mineWrites / frames;
    // Medido: 7,3 antes y 1,3 ahora (antes ya escribía casi todo solo si cambiaba, salvo lo que se ve o no y la
    // franja de vueltas).
    expect(perOld).toBeGreaterThan(5);
    expect(perMine, "antes " + perOld.toFixed(1) + ", ahora " + perMine.toFixed(1)).toBeLessThan(
      perOld / 2,
    );
  }, 120000);

  it("con un circuito: vueltas, tiempo y diferencia con la mejor en la franja", () => {
    const b = bench();
    applyCircuit(b.run.E, maspalomasCircuit(), false, true);
    const deltas = new Set<string>();
    // El mapa ya se compara entero en la otra: aquí, uno de cada cuatro fotogramas.
    ride(
      b,
      0.25,
      () => {
        const cls = b.root.querySelector("#ru-delta")?.className;
        if (cls) deltas.add(cls);
      },
      40,
    );
    expect(b.run.E.circ && b.run.E.circ.laps.length).toBeGreaterThanOrEqual(5);
    expect(b.root.querySelector("#ru-title")?.textContent).toBe("Maspalomas");
    expect([...deltas]).toEqual(expect.arrayContaining(["num up", "num down"]));
  }, 120000);

  it("con un tramo de salida y meta: en marcha, acabado y la salida marcada a mano", () => {
    const kv = memoryKV({
      [TRAMOS_KEY]: [
        {
          id: "tr-1",
          nombre: "Crono 1",
          salida: demoLatLon(95),
          meta: demoLatLon(125),
          pasadas: [],
        },
      ],
    });
    const b = bench(kv);
    const E = b.run.E;
    const seen = new Set<string>();
    ride(
      b,
      0.25,
      (i) => {
        // Una salida marcada a mano un rato (sin tramo en marcha se ve en la franja).
        if (i === 40) E.mark = { t: E.simT, lat: 27.77, lon: -15.52, dist0: E.route.stats.dist };
        if (i === 70) E.mark = null;
        const lap = b.root.querySelector("#ru-lap");
        if (lap) seen.add((lap.textContent || "").split(" · ")[0]);
      },
      40,
    );
    expect(E.tramoPasses.length).toBeGreaterThanOrEqual(4);
    expect([...seen]).toEqual(expect.arrayContaining(["Desde la salida", "Crono 1"]));
  }, 120000);
});
