// @vitest-environment jsdom
// El panel del circuito montado: se pinta en cada fotograma solo mientras se ve, sus botones («Boxes», «Calibrar», las
// cámaras y la velocidad de la vuelta de ejemplo) hacen lo de antes, y la vista 3D se abre con la vuelta de ejemplo y
// se cierra cuando el runtime lo pide.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoEngine } from "../../../../test/demo-engine";
import { uiStore } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import { DEFAULT_SETTINGS } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { mapa } from "../../draw/mapa";
import { RuntimeContext } from "../../runtime-context";
import { Dash } from "./Dash";

function setup(E: Engine | null) {
  const session = {
    rt: { E, sim: { speed: 1 } },
    enterPits: vi.fn(),
    stopAll: vi.fn(),
  };
  const rt = {
    session,
    settings: { get: () => DEFAULT_SETTINGS },
    ext: { hzText: () => "" },
    view3d: { close: null as (() => void) | null, view: null },
    kv: memoryKV(),
  };
  const view = render(
    <RuntimeContext.Provider value={rt as unknown as Runtime}>
      <Dash />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string): HTMLElement => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("sin #" + id);
    return el;
  };
  return { rt, session, $ };
}

const nextFrame = () =>
  act(() => {
    vi.advanceTimersToNextFrame();
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout"] });
  vi.spyOn(mapa, "draw").mockImplementation(() => undefined);
  uiStore.setState({ screen: "home", flash: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("panel del circuito montado", () => {
  it("el marcado de siempre, oculto fuera de pista", () => {
    const { $ } = setup(null);
    expect($("d-lap").textContent).toBe("Vuelta —");
    expect($("d-delta").textContent).toBe("—esperando meta");
    expect($("d-info").innerHTML).toBe("Mejor —<br>Última —");
    expect($("d-time").textContent).toBe("0:00,0");
    expect(document.getElementById("dash")?.hidden).toBe(true);
    expect($("d-calib").hidden && $("d-map").hidden && $("d-recap").hidden).toBe(true);
  });

  it("se pinta en cada fotograma solo mientras se ve", async () => {
    const run = demoEngine();
    run.step(1);
    const { $ } = setup(run.E);
    await nextFrame();
    expect($("d-lap").textContent).toBe("Vuelta —");
    act(() => uiStore.setState({ screen: "dash" }));
    await nextFrame();
    expect($("d-lap").textContent).toBe("Buscando la pista");
    expect($("d-gps").className).toBe("dot ok");
    act(() => uiStore.setState({ screen: "pits" }));
    run.E.lapNum = 4;
    await nextFrame();
    expect($("d-lap").textContent).toBe("Buscando la pista");
  });

  it("«Boxes»: a boxes con alguna vuelta; sin ninguna, terminar", () => {
    const run = demoEngine();
    const { $, session } = setup(run.E);
    fireEvent.click($("stop"));
    expect(session.stopAll).toHaveBeenCalledTimes(1);
    run.E.lapNum = 2;
    fireEvent.click($("stop"));
    expect(session.enterPits).toHaveBeenCalledTimes(1);
    session.rt.E = null;
    fireEvent.click($("stop"));
    expect(session.stopAll).toHaveBeenCalledTimes(2);
  });

  it("«Calibrar» empieza a calibrar (no en la vuelta de ejemplo)", () => {
    const run = demoEngine();
    const { $ } = setup(run.E);
    fireEvent.click($("d-calib"));
    expect(run.E.calUi).toBeNull();
    run.E.sim = false;
    fireEvent.click($("d-calib"));
    expect(run.E.calUi && run.E.calUi.state).toBe("busy");
  });

  it("cámaras y velocidad de la vuelta de ejemplo", () => {
    const { $, session } = setup(null);
    const cams = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".v3d-ctl [data-cam]")).map(
        (b) => b.dataset.cam + ":" + b.getAttribute("aria-pressed"),
      );
    expect(cams()).toEqual(["casco:true", "detras:false", "arriba:false"]);
    const detras = document.querySelector<HTMLElement>('[data-cam="detras"]');
    if (detras) fireEvent.click(detras);
    expect(cams()).toEqual(["casco:false", "detras:true", "arriba:false"]);
    const speeds: string[] = [];
    for (let i = 0; i < 4; i++) {
      fireEvent.click($("d-speedx"));
      speeds.push(session.rt.sim.speed + " " + $("d-speedx").textContent);
    }
    expect(speeds).toEqual(["2 ×2", "4 ×4", "1 ×1", "2 ×2"]);
  });

  it("vuelta de ejemplo con 3D: se abre al empezar y se cierra cuando el runtime lo pide", async () => {
    const run = demoEngine();
    run.E.replay = true;
    const { $, rt } = setup(run.E);
    rt.session.rt.sim.speed = 4;
    act(() => uiStore.setState({ screen: "dash" }));
    await nextFrame();
    expect($("d-3d").hidden).toBe(false);
    expect($("d-3d-wait").textContent).toBe("Cargando el circuito en 3D…");
    expect($("d-speedx").textContent).toBe("×4");
    expect($("dash").className).toBe("dash replay");
    expect(typeof rt.view3d.close).toBe("function");
    act(() => rt.view3d.close?.());
    expect($("d-3d").hidden).toBe(true);
  });
});
