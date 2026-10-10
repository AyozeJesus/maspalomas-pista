// @vitest-environment jsdom
// Boxes igual que antes: la misma tanda pintada por enterPits de live.js (sobre el marcado de index.html) y por la
// pantalla de React tiene que dar el mismo DOM (etiquetas, atributos, textos, en orden). Y lo que hacen sus botones.
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domShape, legacyDocument } from "../../../../test/dom-shape";
import { demoTanda, memoryStore } from "../../../../test/fixtures-pits";
import { oldPits } from "../../../../test/legacy-pits";
import { refreshSummary, show, uiStore } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import { createRuntime, type Runtime } from "../../../runtime";
import type { PistaStore } from "../../../storage";
import { RuntimeContext } from "../../runtime-context";
import { Pits } from "./Pits";

afterEach(cleanup);
beforeEach(() => {
  uiStore.setState({ screen: "home", summaryVersion: 0, homeVersion: 0, toast: null });
});

const fakeStore = memoryStore;

function mount(E: Engine | null, store: PistaStore | null = fakeStore()) {
  const rt: Runtime = createRuntime({ kv: memoryKV(), store });
  rt.session.rt.E = E;
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <Pits />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  // Lo que hace el runtime al entrar en boxes.
  const enter = () =>
    act(() => {
      show("pits");
      refreshSummary();
    });
  return { rt, $, enter };
}

// El botón de dos toques de React lleva type="button" (la de antes, ninguno).
const skipType = (el: Element, name: string) => el.tagName === "BUTTON" && name === "type";

describe("boxes: lo mismo que pintaba la app de antes", () => {
  it("una tanda recién rodada (grabando en el móvil)", async () => {
    const E = await demoTanda({ viewing: false });
    const old = oldPits(E, "off");
    const { $, enter } = mount(E);
    enter();
    expect(domShape($("pits"), skipType)).toEqual(
      domShape(old.getElementById("pits") as HTMLElement, skipType),
    );
    // Lo que se ve, por si acaso: 5 vueltas, la mejor marcada y el plan.
    expect($("p-laps").querySelectorAll("tr").length).toBe(5);
    expect($("p-sub").textContent).toMatch(/^5 vueltas completas · mejor 1:\d\d,\d\d/);
    expect($("p-store").textContent).toBe(
      "Tanda guardada en el móvil · conecta el garaje del Mac para tener copia.",
    );
    expect($("p-ideal").textContent).toMatch(/^Vuelta ideal \(tus mejores 4 sectores\): 1:/);
    expect($("p-brk-card").hidden).toBe(false);
    expect($("p-tips").querySelectorAll("li").length).toBeGreaterThan(1);
  });

  it("repasando una tanda guardada: solo mirar, con su nombre y «Cortar en dos»", async () => {
    const E = await demoTanda({ nombre: "Tanda 3" });
    const old = oldPits(E, "ok");
    const { $, enter } = mount(E);
    enter();
    // Diferencia a propósito: la de antes decía «Simulador: no se guarda.» de una tanda guardada (el repaso va con el
    // motor de la vuelta de ejemplo); ahora no dice nada.
    const oldStore = old.getElementById("p-store") as HTMLElement;
    expect(oldStore.textContent).toBe("Simulador: no se guarda.");
    oldStore.textContent = "";
    expect(domShape($("pits"), skipType)).toEqual(
      domShape(old.getElementById("pits") as HTMLElement, skipType),
    );
    expect($("p-title").textContent).toBe("Tanda 3");
    expect(($("p-nombre") as HTMLInputElement).value).toBe("Tanda 3");
    expect($("p-toolbar").hidden).toBe(false);
    expect($("p-main").hidden).toBe(true);
    expect($("p-cut").hidden).toBe(false);
    expect($("p-cut-lap").querySelectorAll("option").length).toBe(4);
  });

  it("sin análisis: las vueltas del cronómetro y «Sin análisis todavía»", async () => {
    const E = await demoTanda({ viewing: false });
    E.pitsAnalysis = null;
    const old = oldPits(E, "ok");
    const store = fakeStore();
    store.sync.state = "ok";
    const { $, enter } = mount(E, store);
    enter();
    expect(domShape($("pits"), skipType)).toEqual(
      domShape(old.getElementById("pits") as HTMLElement, skipType),
    );
    expect($("p-tips").textContent).toBe(
      "Sin análisis todavíaHaz al menos una vuelta completa pasando dos veces por meta.",
    );
  });

  it("antes de entrar, lo de index.html", () => {
    const old = legacyDocument("pits");
    const { $ } = mount(null);
    act(() => show("pits"));
    (old.getElementById("pits") as HTMLElement).hidden = false;
    expect(domShape($("pits"), skipType)).toEqual(
      domShape(old.getElementById("pits") as HTMLElement, skipType),
    );
  });
});

describe("boxes: lo que hacen los botones", () => {
  it("«Volver a pista» y «Terminar» con dos toques", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const E = await demoTanda({ viewing: false });
      const { rt, $, enter } = mount(E);
      const ride = vi.spyOn(rt.session, "enterRide").mockImplementation(() => {});
      const stop = vi.spyOn(rt.session, "stopAll").mockImplementation(() => {});
      enter();
      fireEvent.click($("resume"));
      expect(ride).toHaveBeenCalledTimes(1);
      fireEvent.click($("finish"));
      expect($("finish").textContent).toBe("¿Terminar? Toca otra vez");
      expect(stop).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(4000));
      expect($("finish").textContent).toBe("Terminar");
      fireEvent.click($("finish"));
      fireEvent.click($("finish"));
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("repasando: «Volver» y «Cerrar» cierran sin preguntar", async () => {
    const E = await demoTanda();
    const { rt, $, enter } = mount(E);
    const stop = vi.spyOn(rt.session, "stopAll").mockImplementation(() => {});
    enter();
    expect($("finish").textContent).toBe("Cerrar");
    fireEvent.click($("finish"));
    fireEvent.click($("p-back"));
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("«Tiempos del día» solo con el garaje del Mac, y lleva a los tiempos desde boxes", async () => {
    const E = await demoTanda({ viewing: false });
    const { rt, $, enter } = mount(E);
    const day = vi.spyOn(rt.nav, "showDay").mockImplementation(() => {});
    enter();
    expect($("pits-day").hidden).toBe(true);
    act(() => rt.settings.update({ garaje: { u: "https://garaje.ejemplo.net", k: "clave" } }));
    expect($("pits-day").hidden).toBe(false);
    fireEvent.click($("pits-day"));
    expect(day).toHaveBeenCalledWith("pits");
  });

  it("«Calibrar inclinación»: el botón y su nota mientras dura", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const E = await demoTanda({ viewing: false });
      // Parada (sin fijo en marcha): se puede calibrar.
      E.fix = null;
      const { $, enter } = mount(E);
      enter();
      fireEvent.click($("p-calib"));
      expect($("p-calib").textContent).toBe("Calibrando");
      expect($("p-calib-note").textContent).toBe("Moto derecha y quieta un segundo…");
      // Sin datos de los sensores, a los 4 s lo deja (y lo dice).
      act(() => vi.advanceTimersByTime(4200));
      expect($("p-calib").textContent).toBe("Calibrar");
      expect($("p-calib-note").textContent).toBe("No estaba quieto.");
      // Al volver a entrar en boxes, como al principio.
      enter();
      expect($("p-calib").textContent).toBe("Calibrar inclinación");
      expect($("p-calib-note").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("el nombre se guarda al acabar de escribirlo y va al título", async () => {
    const store = fakeStore();
    const E = await demoTanda({ nombre: "Tanda 3" });
    await store.putSession({ id: E.viewing?.id as string, estado: "terminada", nombre: "Tanda 3" });
    const { $, enter } = mount(E, store);
    enter();
    const input = $("p-nombre") as HTMLInputElement;
    input.value = "  Los Loros  ";
    fireEvent.change(input);
    await waitFor(() => expect($("p-title").textContent).toBe("Los Loros"));
    expect((await store.sessions())[0].nombre).toBe("Los Loros");
    expect(E.nombre).toBe("Los Loros");
    expect(uiStore.getState().toast?.text).toBe("Nombre guardado");
    input.value = "";
    fireEvent.change(input);
    await waitFor(() => expect($("p-title").textContent).toBe("Boxes"));
    expect(uiStore.getState().toast?.text).toBe("Nombre quitado");
  });
});
