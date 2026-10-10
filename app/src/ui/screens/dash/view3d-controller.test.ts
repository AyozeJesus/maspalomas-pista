// @vitest-environment jsdom
// La vista 3D en el panel: se carga al pedirla, se crea con el trazado (una vez; sin WebGL, un solo intento), pinta
// cada fotograma con la moto donde cree el panel, cambia de cámara y se suelta al cerrar. Como prepare3D, render3D y
// close3D de live.js.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../../../engine";
import type { View3dSlot } from "../../../runtime";
import type { Vista3D } from "../../three/vista3d";
import { createView3d, type Vista3DModule } from "./view3d-controller";

function fakeView() {
  return {
    update: vi.fn(),
    resize: vi.fn(),
    setMode: vi.fn(),
    setBrakes: vi.fn(),
    dispose: vi.fn(),
    mode: "casco" as const,
    debug: vi.fn(),
  };
}

function setup(make: () => Vista3D | null = () => fakeView()) {
  document.body.innerHTML =
    '<div class="v3d" id="d-3d"><p class="v3d-wait" id="d-3d-wait" hidden>x</p></div>';
  const box = document.getElementById("d-3d") as HTMLElement;
  const wait = document.getElementById("d-3d-wait") as HTMLElement;
  const create = vi.fn(make);
  const mod = { create } as unknown as Vista3DModule;
  const slot: View3dSlot = { close: null, view: null };
  const v3d = createView3d({ box, wait }, slot, () => Promise.resolve(mod));
  return { box, wait, create, slot, v3d };
}

function eng(over: Record<string, unknown> = {}): Engine {
  return {
    track: { L: 3000 },
    corners: [{ i: 3 }],
    bounds: [10, 20, 30, 40],
    best: null,
    leanDeg: 12,
    ...over,
  } as unknown as Engine;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vista 3D de la vuelta de ejemplo", () => {
  it("se carga, se crea una vez con el trazado y pinta cada fotograma", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { wait, create, slot, v3d } = setup();
    const E = eng();
    // Aún sin cargar: nada.
    v3d.render(E, { s: 10, v: 20 });
    await v3d.prepare();
    expect(wait.hidden).toBe(false);
    expect(wait.textContent).toBe("Cargando el circuito en 3D…");
    // Sin trazado aún (sin sentido de marcha): nada.
    v3d.render(eng({ track: null }), null);
    expect(create).not.toHaveBeenCalled();
    v3d.render(E, { s: 10, v: 20 });
    v3d.render(E, { s: 12, v: 20 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0].slice(1)).toEqual([
      E.track,
      { corners: E.corners, bounds: E.bounds },
    ]);
    const v = slot.view as unknown as ReturnType<typeof fakeView>;
    expect(v.setMode).toHaveBeenCalledWith("casco");
    expect(wait.hidden).toBe(true);
    // Sin mejor vuelta, sin carteles de frenada.
    expect(v.setBrakes).not.toHaveBeenCalled();
    expect(v.update.mock.calls).toEqual([
      [{ s: 10, lean: 12, v: 20 }, 0.016],
      [{ s: 12, lean: 12, v: 20 }, 0],
    ]);
    // Fuera del trazado: no se mueve la moto.
    v3d.render(E, null);
    expect(v.update).toHaveBeenCalledTimes(2);
    // Mejor vuelta nueva: sus carteles de frenada.
    const brakeS = [100, null, 900];
    E.best = { time: 65, grid: [], brakeS };
    v3d.render(E, { s: 13, v: 20 });
    v3d.render(E, { s: 14, v: 20 });
    expect(v.setBrakes.mock.calls).toEqual([[brakeS]]);
    // Una mejor vuelta sin frenadas: se quitan.
    E.best = { time: 64, grid: [] };
    v3d.render(E, { s: 15, v: 20 });
    expect(v.setBrakes).toHaveBeenLastCalledWith([]);
  });

  it("otra cámara, otro trazado y al cerrar", async () => {
    const { box, create, slot, v3d } = setup();
    await v3d.prepare();
    v3d.setMode("arriba");
    const E = eng();
    v3d.render(E, null);
    const v1 = slot.view as unknown as ReturnType<typeof fakeView>;
    expect(v1.setMode).toHaveBeenCalledWith("arriba");
    v3d.setMode("detras");
    expect(v1.setMode).toHaveBeenLastCalledWith("detras");
    // Otro sentido de marcha (otro trazado): la vista se rehace.
    v3d.render(eng({ track: { L: 3001 } }), null);
    expect(v1.dispose).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    const v2 = slot.view as unknown as ReturnType<typeof fakeView>;
    expect(v2.setMode).toHaveBeenCalledWith("detras");
    v3d.close();
    expect(v2.dispose).toHaveBeenCalledTimes(1);
    expect(slot.view).toBeNull();
    expect(box.hidden).toBe(true);
  });

  it("sin WebGL: lo dice y no lo vuelve a intentar", async () => {
    const { wait, create, slot, v3d } = setup(() => null);
    await v3d.prepare();
    v3d.render(eng(), null);
    v3d.render(eng(), null);
    expect(create).toHaveBeenCalledTimes(1);
    expect(wait.textContent).toBe("Este móvil no puede dibujar en 3D.");
    expect(wait.hidden).toBe(false);
    expect(slot.view).toBeNull();
    v3d.close();
  });

  it("sin conexión la primera vez: lo dice", async () => {
    document.body.innerHTML = '<div id="d-3d"><p id="d-3d-wait"></p></div>';
    const box = document.getElementById("d-3d") as HTMLElement;
    const wait = document.getElementById("d-3d-wait") as HTMLElement;
    const v3d = createView3d({ box, wait }, { close: null, view: null }, () =>
      Promise.reject(new Error("sin red")),
    );
    await v3d.prepare();
    expect(wait.textContent).toBe(
      "No se ha podido cargar la vista 3D (sin conexión la primera vez).",
    );
  });
});
