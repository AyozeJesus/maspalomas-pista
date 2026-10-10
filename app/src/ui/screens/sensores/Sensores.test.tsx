// @vitest-environment jsdom
// La pantalla de la prueba de sensores: el mismo marcado de antes, y con el runtime en marcha (lecturas de devicemotion
// de mentira) se pinta cada 100 ms; «Calibrar» y «Volver».
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domShape, legacyDocument } from "../../../../test/dom-shape";
import { show, uiStore } from "../../../app/ui-store";
import { memoryKV } from "../../../engine/kv";
import { createRuntime, type Runtime } from "../../../runtime";
import { RuntimeContext } from "../../runtime-context";
import { Sensores } from "./Sensores";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  uiStore.setState({ screen: "home", summaryVersion: 0, homeVersion: 0, toast: null });
});

function mount() {
  const rt: Runtime = createRuntime({ kv: memoryKV(), store: null });
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <Sensores />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  return { rt, $ };
}

// El móvil de pie, girado `deg` grados como un volante hacia la izquierda, con giroscopio y aceleración separada.
function motion(deg: number): void {
  const r = (deg * Math.PI) / 180;
  const ev = new Event("devicemotion");
  Object.assign(ev, {
    accelerationIncludingGravity: { x: 9.81 * Math.sin(r), y: 9.81 * Math.cos(r), z: 0.3 },
    acceleration: { x: 0, y: 0, z: 0 },
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
  });
  window.dispatchEvent(ev);
}

describe("prueba de sensores", () => {
  it("el marcado de siempre", () => {
    const old = legacyDocument("sensores");
    const { $ } = mount();
    act(() => show("sensores"));
    (old.getElementById("sensores") as HTMLElement).hidden = false;
    expect(domShape($("sensores"))).toEqual(
      domShape(old.getElementById("sensores") as HTMLElement),
    );
  });

  it("se pinta cada 100 ms mientras se ve, «Calibrar» y «Volver»", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const { rt, $ } = mount();
    await act(() => rt.sensors.start());
    expect(uiStore.getState().screen).toBe("sensores");
    expect(rt.sensors.active()).toBe(true);
    // Lecturas a 60 Hz: derecho (la postura de referencia sale de las primeras) y luego girado 10° a la izquierda.
    const readings = (deg: number, n: number) => {
      for (let i = 0; i < n; i++) {
        motion(deg);
        act(() => vi.advanceTimersByTime(16));
      }
    };
    motion(0);
    // Aún no se ha pintado: lo de partida.
    expect($("sen-tilt-g").textContent).toBe("—");
    readings(0, 40);
    readings(10, 80);
    expect($("sen-tilt-g").textContent).toBe("10° izq.");
    expect($("sen-mount").textContent).toBe(
      "Móvil de pie, pantalla en vertical: hacia delante, la espalda del móvil.",
    );
    // Sin GPS en este navegador (jsdom): lo dice.
    expect($("sen-gps-note").textContent).toBe("Este navegador no da acceso al GPS.");
    expect($("sen-gps-note").className).toBe("muted note-bad");
    expect($("sen-level").style.transform).toBe("rotate(" + rt.sensors.state()?.leanG + "deg)");
    // «Calibrar»: así es 0°.
    fireEvent.click($("sen-zero"));
    readings(10, 7);
    expect($("sen-tilt-g").textContent).toBe("0°");
    expect($("sen-tilt-note").textContent).toMatch(
      /^Calibrado: así es 0°\. Gíralo como un volante/,
    );
    fireEvent.click($("sen-back"));
    expect(rt.sensors.active()).toBe(false);
    expect(uiStore.getState().screen).toBe("home");
    // Ya no escucha ni pinta.
    motion(30);
    act(() => vi.advanceTimersByTime(300));
    expect($("sen-tilt-g").textContent).toBe("0°");
  });
});
