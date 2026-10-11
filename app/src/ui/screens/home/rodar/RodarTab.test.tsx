// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCircuitPicker, refreshHome, uiStore } from "../../../../app/ui-store";
import { memoryKV, type KeyValueStore } from "../../../../engine/kv";
import { createRuntime, type Runtime } from "../../../../runtime";
import { RuntimeContext } from "../../../runtime-context";
import { RodarTab } from "../RodarTab";

afterEach(cleanup);

function mount(kv: KeyValueStore = memoryKV()) {
  const rt: Runtime = createRuntime({ kv, store: null });
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <RodarTab hidden={false} />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  return { rt, $ };
}

describe("pestaña «Rodar»", () => {
  it("lo de siempre al abrir: salir, el estado y los avisos", () => {
    const { $ } = mount();
    expect($("tab-rodar").hidden).toBe(false);
    expect(document.querySelector(".brand")?.textContent).toBe("poortelemetry");
    expect(["go", "free", "sensors", "sim"].map((id) => $(id).textContent)).toEqual([
      "Salir a pista",
      "Ruta libre",
      "Probar los sensores",
      "Vuelta de ejemplo",
    ]);
    expect($("st-gps-t").textContent).toBe("GPS: se activará al salir");
    expect($("st-imu-t").textContent).toBe("Pantalla y sensores: se activarán al salir");
    expect($("st-best-t").textContent).toBe("Mejor vuelta guardada: antihorario — · horario —");
    expect($("st-best").className).toBe("dot ");
    expect($("sensor-block").hidden).toBe(true);
    // En una pestaña del navegador: el aviso de instalarla, sin botón hasta que Chrome lo ofrezca.
    expect($("install").hidden).toBe(false);
    expect($("install-btn").hidden).toBe(true);
    expect($("install-how").textContent).toMatch(
      /^Menú ⋮ de Chrome → «Añadir a pantalla de inicio»/,
    );
    expect($("tips").tagName).toBe("DETAILS");
  });

  it("cada botón arranca lo suyo («Salir a pista» primero pide el circuito)", () => {
    const { rt, $ } = mount();
    const real = vi.spyOn(rt.session, "startReal").mockResolvedValue(undefined);
    const sim = vi.spyOn(rt.session, "startSim").mockImplementation(() => {});
    const sensors = vi.spyOn(rt.sensors, "start").mockResolvedValue(undefined);
    fireEvent.click($("go"));
    expect(uiStore.getState().circuitPicker).toBe(true);
    expect(real).not.toHaveBeenCalled();
    act(() => closeCircuitPicker());
    fireEvent.click($("free"));
    fireEvent.click($("ocho"));
    fireEvent.click($("sim"));
    fireEvent.click($("sensors"));
    // Ruta libre, y el entrenamiento en 8 (una ruta libre que cuenta los ochos).
    expect(real.mock.calls).toEqual([[true], [true, { ocho: true }]]);
    expect(sim.mock.calls).toEqual([[1]]);
    expect(sensors).toHaveBeenCalledTimes(1);
  });

  it("los puntos del GPS y la pantalla, como los pone la sesión", () => {
    const { rt, $ } = mount();
    act(() => rt.session.setStatus("gps", "wait", "GPS: buscando señal…"));
    expect($("st-gps").className).toBe("dot wait");
    expect($("st-gps-t").textContent).toBe("GPS: buscando señal…");
    act(() => rt.session.setStatus("imu", "ok", "Pantalla: siempre encendida"));
    expect($("st-imu").className).toBe("dot ok");
  });

  it("la mejor vuelta guardada: la del piloto, al pintar la portada y al cambiar de piloto", () => {
    const kv = memoryKV();
    const { rt, $ } = mount(kv);
    kv.store("pista-mejor-osm-0", { time: 68.5 });
    act(() => refreshHome());
    expect($("st-best-t").textContent).toBe(
      "Mejor vuelta guardada: antihorario 1:08,50 · horario —",
    );
    expect($("st-best").className).toBe("dot ok");
    // Al poner nombre la primera vez, la de antes pasa a ser suya.
    act(() => rt.settings.setPilot("  Ayoze "));
    expect($("st-best-t").textContent).toBe(
      "Mejor vuelta guardada de Ayoze: antihorario 1:08,50 · horario —",
    );
    act(() => rt.settings.setPilot("Amigo"));
    expect($("st-best-t").textContent).toBe(
      "Mejor vuelta guardada de Amigo: antihorario — · horario —",
    );
  });

  it("«Instalar la app» cuando Chrome lo ofrece: su aviso, una sola vez", async () => {
    const { $ } = mount();
    const prompt = vi.fn(async () => {});
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect($("install-btn").hidden).toBe(false);
    await act(async () => {
      fireEvent.click($("install-btn"));
    });
    expect($("install-btn").hidden).toBe(true);
    await act(async () => {
      fireEvent.click($("install-btn"));
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
