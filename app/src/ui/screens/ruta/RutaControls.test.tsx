// @vitest-environment jsdom
// El panel de la ruta libre montado: se pinta solo mientras se ve; «Terminar» y «Nuevo tramo» piden un segundo toque;
// «Salida aquí» / «Meta aquí» con un motor de verdad (grabando, no la vuelta de ejemplo); y los botones del mapa
// cambian lo que se pinta.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiStore } from "../../../app/ui-store";
import { createEngine, onFix, type Engine, type EngineHost, type RecState } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import { DEFAULT_SETTINGS } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { mapa, type MapDrawOptions } from "../../draw/mapa";
import { RuntimeContext } from "../../runtime-context";
import { Ruta } from "./Ruta";

let clockS = 100;

// Una ruta libre de verdad (no de ejemplo) con su grabación en marcha y un fijo bueno de hace un momento.
function liveEngine(toasts: string[]): Engine {
  const host: EngineHost = {
    settings: { ...DEFAULT_SETTINGS, caida: false },
    kv: memoryKV(),
    wallNow: () => Date.UTC(2026, 9, 10, 12),
    perfNow: () => clockS,
    isCurrent: () => true,
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: { toast: (text) => toasts.push(text) },
  };
  const E = createEngine(host, false, true);
  E.t0 = 0;
  E.rec = { id: "x" } as unknown as RecState;
  onFix(E, clockS - 0.5, 27.77, -15.52, 0, 4);
  return E;
}

function setup(E: Engine | null) {
  const session = {
    rt: { E, sim: { speed: 1 } },
    stopAll: vi.fn(),
    newSegment: vi.fn(() => Promise.resolve(true)),
  };
  const rt = {
    session,
    ext: { hzText: () => "" },
    view3d: { close: null, view: null },
    kv: memoryKV(),
  };
  const view = render(
    <RuntimeContext.Provider value={rt as unknown as Runtime}>
      <Ruta />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string): HTMLElement => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("sin #" + id);
    return el;
  };
  return { session, $ };
}

const nextFrame = () =>
  act(() => {
    vi.advanceTimersToNextFrame();
  });

let draws: MapDrawOptions[] = [];
let clockMs = 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout"] });
  draws = [];
  clockMs = 1000;
  clockS = 100;
  vi.spyOn(performance, "now").mockImplementation(() => clockMs);
  vi.spyOn(mapa, "draw").mockImplementation((_cv, o) => {
    draws.push(o);
    return undefined;
  });
  vi.spyOn(mapa, "legend").mockImplementation(() => {});
  uiStore.setState({ screen: "home", flash: null, toast: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("panel de la ruta libre montado", () => {
  it("el marcado de siempre y el pintado solo mientras se ve", async () => {
    const toasts: string[] = [];
    const E = liveEngine(toasts);
    const { $ } = setup(E);
    expect($("ru-title").textContent).toBe("Ruta libre");
    expect($("ru-mark").textContent).toBe("Salida aquí");
    expect($("ru-seg").hidden && $("ru-mark").hidden && $("ru-laps").hidden).toBe(true);
    await nextFrame();
    expect($("ru-mark").hidden).toBe(true);
    act(() => uiStore.setState({ screen: "ruta" }));
    await nextFrame();
    // Grabando de verdad: «Nuevo tramo» y «Salida aquí» a la vista; parado, «Calibrar» en el sitio del título.
    expect($("ru-seg").hidden || $("ru-mark").hidden).toBe(false);
    expect($("ru-calib").hidden).toBe(false);
    expect($("ru-title").hidden).toBe(true);
    expect($("ru-gps").className).toBe("dot ok");
    expect($("ru-speed").textContent).toBe("0");
    expect(draws.length).toBe(1);
  });

  it("«Terminar» y «Nuevo tramo»: dos toques", () => {
    const { $, session } = setup(null);
    fireEvent.click($("ru-stop"));
    expect($("ru-stop").textContent).toBe("¿Terminar? Otra vez");
    expect(session.stopAll).not.toHaveBeenCalled();
    fireEvent.click($("ru-stop"));
    expect(session.stopAll).toHaveBeenCalledTimes(1);
    expect($("ru-stop").textContent).toBe("Terminar");
    fireEvent.click($("ru-seg"));
    expect($("ru-seg").textContent).toBe("¿Nuevo tramo? Otra vez");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect($("ru-seg").textContent).toBe("Nuevo tramo");
    fireEvent.click($("ru-seg"));
    fireEvent.click($("ru-seg"));
    expect(session.newSegment).toHaveBeenCalledTimes(1);
  });

  it("«Salida aquí», «Meta aquí» y quitarla sin haberse movido", async () => {
    const toasts: string[] = [];
    const E = liveEngine(toasts);
    const { $ } = setup(E);
    act(() => uiStore.setState({ screen: "ruta" }));
    fireEvent.click($("ru-mark"));
    expect(E.mark).not.toBeNull();
    expect(toasts).toEqual(["Salida marcada: al llegar, «Meta aquí»"]);
    await nextFrame();
    expect($("ru-mark").textContent).toBe("Meta aquí");
    // Con la salida puesta, la franja dice desde dónde.
    expect($("ru-laps").hidden).toBe(false);
    expect($("ru-best").textContent).toBe("Al llegar, «Meta aquí»");
    fireEvent.click($("ru-mark"));
    expect($("ru-mark").textContent).toBe("¿Quitar la salida? Otra vez");
    // Mientras espera el segundo toque, el panel no le cambia el texto.
    await nextFrame();
    expect($("ru-mark").textContent).toBe("¿Quitar la salida? Otra vez");
    fireEvent.click($("ru-mark"));
    expect(E.mark).toBeNull();
    expect(uiStore.getState().toast?.text).toBe("Salida quitada");
    await nextFrame();
    expect($("ru-mark").textContent).toBe("Salida aquí");
    expect($("ru-laps").hidden).toBe(true);
  });

  it("los botones del mapa: color, toda o seguir, acercar y alejar", async () => {
    const E = liveEngine([]);
    const { $ } = setup(E);
    act(() => uiStore.setState({ screen: "ruta" }));
    await nextFrame();
    expect([$("ru-color").textContent, $("ru-fit").textContent]).toEqual(["Fases", "Toda"]);
    const last = () => draws[draws.length - 1];
    expect([last().colorBy, last().span]).toEqual(["fase", 600]);
    // Cada botón: el mapa otra vez en el fotograma siguiente (sin esperar sus 160 ms).
    fireEvent.click($("ru-color"));
    await nextFrame();
    expect(last().colorBy).toBe("incl");
    expect($("ru-color").textContent).toBe("Incl.");
    fireEvent.click($("ru-fit"));
    await nextFrame();
    expect($("ru-fit").textContent).toBe("Seguir");
    fireEvent.click($("ru-zin"));
    await nextFrame();
    expect([last().span, $("ru-fit").textContent]).toEqual([375, "Toda"]);
    fireEvent.click($("ru-zout"));
    await nextFrame();
    expect(last().span).toBe(600);
    expect(draws.length).toBe(5);
    // Sin tocar nada y sin pasar 160 ms, no se vuelve a pintar.
    await nextFrame();
    expect(draws.length).toBe(5);
  });
});
