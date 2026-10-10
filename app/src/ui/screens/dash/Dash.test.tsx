// @vitest-environment jsdom
// El panel del circuito pinta lo mismo que render() de live.js con el mismo motor: la vuelta de ejemplo entera,
// fotograma a fotograma (textos, clases, lo que se ve, el mapa, el destello y lo que cambia en el motor), y escribe
// en el DOM mucho menos que antes.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoEngine, type DemoRun } from "../../../../test/demo-engine";
import { oldPanel, panelState, writeCounter, type OldPanel } from "../../../../test/legacy-panel";
import { uiStore } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import type { Settings } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { mapa } from "../../draw/mapa";
import { RuntimeContext } from "../../runtime-context";
import { Dash } from "./Dash";
import { createDashPainter, type DashPainter } from "./dash-painter";

let clockMs = 1000;

function fakeRuntime(E: Engine, settings: Settings, hz: number): Runtime {
  return {
    session: { rt: { E, sim: { speed: 1 } }, enterPits: () => {}, stopAll: () => {} },
    settings: { get: () => settings },
    ext: { hzText: (kind: string | null) => (kind && hz >= 1 ? hz + " Hz" : "") },
    view3d: { close: null, view: null },
    kv: memoryKV(),
  } as unknown as Runtime;
}

interface Bench {
  run: DemoRun;
  old: OldPanel;
  root: HTMLElement;
  painter: DashPainter;
  // Lo que se manda pintar al mapa, en JSON.
  draws: string[];
}

// El panel de ahora (el componente, con un pintor a mano) y el de antes sobre el mismo motor.
function bench(opts: { settings?: Partial<Settings>; hz?: number } = {}): Bench {
  const draws: string[] = [];
  vi.spyOn(mapa, "draw").mockImplementation((_cv, o) => {
    draws.push(JSON.stringify(o));
    return undefined;
  });
  // La vuelta terminada (lapFlash del motor): el destello de antes y el de ahora.
  let old: OldPanel | null = null;
  const run = demoEngine({
    settings: opts.settings,
    events: {
      lapFlash: (_E, time, isBest, prevBest) => {
        uiStore.setState({ flash: { kind: "lap", time, isBest, prevBest } });
        if (old) {
          old.flash.className = "flash lap num";
          old.flash.hidden = false;
        }
      },
    },
  });
  old = oldPanel(run.E, { settings: run.settings, hz: opts.hz });
  const rt = fakeRuntime(run.E, run.settings, opts.hz ?? 0);
  const { container } = render(
    <RuntimeContext.Provider value={rt}>
      <Dash />
    </RuntimeContext.Provider>,
  );
  const root = container.querySelector<HTMLElement>("#dash");
  if (!root) throw new Error("sin #dash");
  return { run, old, root, painter: createDashPainter(root, rt), draws };
}

// Lo que cambia render() en el motor (y el destello).
function engineSide(E: Engine) {
  return {
    deltaEma: E.deltaEma,
    prevCueS: E.prevCueS,
    cueDone: [...E.cueDone],
    flashUntil: E.flashUntil,
  };
}

// Si se ve el destello y si es el de frenada (oculto, lo que quede de antes da igual).
function flashOf(b: Bench) {
  const f = uiStore.getState().flash;
  const shown = !b.old.flash.hidden;
  return {
    old: { shown, brake: shown && b.old.flash.className === "flash brake" },
    mine: { shown: !!f, brake: !!f && f.kind === "brake" },
  };
}

// Un fotograma de los dos paneles (el de antes primero, deshaciendo luego lo que cambia en el motor): tienen que
// quedar igual.
function frame(b: Bench, why: string): { old: number; mine: number; oldW: number; mineW: number } {
  const E = b.run.E;
  const before = engineSide(E);
  const oldDraws = b.old.draws.length;
  const oldW = writeCounter(b.old.dash);
  const fl = writeCounter(b.old.flash);
  b.old.render();
  const oldWrites = oldW.take();
  oldW.stop();
  fl.stop();
  const after = engineSide(E);
  Object.assign(E, { ...before, cueDone: new Set(before.cueDone) });
  const mineDraws = b.draws.length;
  const mineW = writeCounter(b.root);
  b.painter.paint();
  const mineWrites = mineW.take();
  mineW.stop();
  expect(engineSide(E), why).toEqual(after);
  expect(panelState(b.root), why).toEqual(panelState(b.old.dash));
  expect(b.draws.slice(mineDraws), why).toEqual(b.old.draws.slice(oldDraws));
  const f = flashOf(b);
  expect(f.mine, why).toEqual(f.old);
  return {
    old: b.old.draws.length - oldDraws,
    mine: b.draws.length - mineDraws,
    oldW: oldWrites,
    mineW: mineWrites,
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

describe("panel del circuito: igual que render() de antes", () => {
  it("la vuelta de ejemplo entera, con el aviso de frenada y el mapa", () => {
    const b = bench({ settings: { cue: true } });
    let frames = 0;
    let oldWrites = 0;
    let mineWrites = 0;
    let maps = 0;
    let brakes = 0;
    while (!b.run.done()) {
      b.run.step(0.25);
      clockMs += 250;
      const r = frame(b, "t = " + b.run.E.simT.toFixed(2));
      frames++;
      oldWrites += r.oldW;
      mineWrites += r.mineW;
      maps += r.mine;
      if (uiStore.getState().flash?.kind === "brake") brakes++;
    }
    // Lo que tiene que haber pasado por el panel.
    expect(b.run.E.laps.filter((l) => l.valid).length).toBeGreaterThanOrEqual(5);
    expect(maps).toBeGreaterThan(frames / 2);
    expect(brakes).toBeGreaterThan(0);
    // Escrituras en el DOM por fotograma: antes, todo cada vez; ahora, solo lo que cambia.
    const perOld = oldWrites / frames;
    const perMine = mineWrites / frames;
    expect(perMine, "antes " + perOld.toFixed(1) + ", ahora " + perMine.toFixed(1)).toBeLessThan(
      perOld / 3,
    );
  }, 120000);

  it("a 60 fotogramas por segundo, rodando: unas pocas escrituras por fotograma (antes, todo cada vez)", () => {
    const b = bench();
    while (!b.run.E.best && !b.run.done()) b.run.step(0.25);
    let frames = 0;
    let oldWrites = 0;
    let mineWrites = 0;
    for (let i = 0; i < 1800; i++) {
      b.run.step(1 / 60);
      clockMs += 1000 / 60;
      const r = frame(b, "t = " + b.run.E.simT.toFixed(3));
      frames++;
      oldWrites += r.oldW;
      mineWrites += r.mineW;
    }
    const perOld = oldWrites / frames;
    const perMine = mineWrites / frames;
    // Medido: 15,1 antes y 1,7 ahora.
    expect(perOld).toBeGreaterThan(12);
    expect(perMine, "antes " + perOld.toFixed(1) + ", ahora " + perMine.toFixed(1)).toBeLessThan(3);
  }, 120000);

  it("fotogramas seguidos sin nada nuevo: ninguna escritura", () => {
    const b = bench();
    while (!b.run.E.best && !b.run.done()) b.run.step(0.25);
    for (let i = 0; i < 40; i++) b.run.step(0.25);
    expect(b.run.E.best).not.toBeNull();
    // La diferencia suavizada tarda unos fotogramas en asentarse (se acerca un 15 % cada vez).
    for (let i = 0; i < 60; i++) frame(b, "asentando " + i);
    let writes = 0;
    for (let i = 0; i < 30; i++) writes += frame(b, "quieto " + i).mineW;
    // El reloj no avanza: ni el mapa (cada 200 ms) ni nada más se vuelve a escribir.
    expect(writes).toBe(0);
  });

  it("estados poco frecuentes: sin permiso, sin giroscopio, fuera del circuito, caballito, Calibrar, receptor", () => {
    const b = bench({ hz: 25 });
    const E = b.run.E;
    let t = 0;
    const tick = (why: string, fn?: () => void) => {
      b.run.step(0.25);
      clockMs += 250;
      t += 0.25;
      if (fn) fn();
      frame(b, why + " (" + t.toFixed(2) + " s)");
    };
    tick("al empezar");
    tick("fuera del circuito", () => {
      E.far = true;
    });
    tick("sin permiso de sensores", () => {
      E.motionDenied = true;
    });
    tick("vuelve el permiso", () => {
      E.motionDenied = false;
    });
    tick("sin giroscopio", () => {
      E.hasGyro = false;
    });
    tick("receptor externo", () => {
      E.extGps = "ble:bonogps";
    });
    for (let i = 0; i < 160; i++) tick("rodando " + i);
    tick("calibrando", () => {
      E.calUi = { state: "busy", why: "", until: Infinity };
    });
    tick("calibrado", () => {
      E.calUi = { state: "ok", why: "", until: clockMs + 8000 };
    });
    tick("nota de calibrar", () => {
      E.calUi = { state: "note", why: "corregida en recta (7°)", until: clockMs + 8000 };
    });
    tick("caballito", () => {
      E.wheelieRecap = { dur: 2.14, dist: 38, max: 24.4, lost: 0.351 };
      E.wheelieT = E.simT;
    });
    for (let i = 0; i < 40; i++) tick("después del caballito " + i);
    tick("sin mapa", () => {
      b.run.settings.mapa = false;
    });
    tick("parado", () => {
      if (E.fix) E.fix.v = 0;
    });
  });
});
