// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PISTA_CIRCUITS } from "../../app/circuits";
import { openCircuitPicker, setTab, show, uiStore } from "../../app/ui-store";
import { memoryKV } from "../../engine/kv";
import { createRuntime, type Runtime } from "../../runtime";
import { RuntimeContext } from "../runtime-context";
import { CircuitPicker } from "./CircuitPicker";

afterEach(() => {
  cleanup();
  uiStore.setState({ circuitPicker: false, screen: "home", homeTab: "rodar", toast: null });
});

function mount() {
  const rt: Runtime = createRuntime({ kv: memoryKV(), store: null });
  const start = vi.spyOn(rt.session, "startReal").mockResolvedValue(undefined);
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <button id="go">Salir a pista</button>
      <CircuitPicker />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  return { rt, start, $ };
}

const open = () => act(() => openCircuitPicker());
const isOpen = () => uiStore.getState().circuitPicker;

describe("«Salir a pista»: en qué circuito", () => {
  it("cerrado hasta tocar «Salir a pista»; luego los circuitos con modo pista (de momento, Maspalomas)", () => {
    const { $ } = mount();
    expect($("pick-circuit").hidden).toBe(true);
    open();
    expect($("pick-circuit").hidden).toBe(false);
    expect(PISTA_CIRCUITS.map((c) => c.id)).toEqual(["maspalomas"]);
    const opt = $("go-maspalomas");
    expect(opt.textContent).toBe("MaspalomasGran Canaria");
    expect(opt.dataset.circuito).toBe("maspalomas");
    expect(document.activeElement).toBe(opt);
    expect($("pick-circuit").querySelector("[role=dialog]")?.getAttribute("aria-modal")).toBe(
      "true",
    );
  });

  it("elegir uno echa a rodar en ese mismo toque (pista, no ruta libre) y cierra", () => {
    const { $, start } = mount();
    open();
    fireEvent.click($("go-maspalomas"));
    expect(start.mock.calls).toEqual([[]]);
    expect(isOpen()).toBe(false);
  });

  it("«Cancelar», tocar fuera o Escape lo cierran sin salir; tocar dentro no", () => {
    const { $, start } = mount();
    open();
    fireEvent.click($("pick-circuit").querySelector(".sheet") as HTMLElement);
    expect(isOpen()).toBe(true);
    fireEvent.click($("pick-cancel"));
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe($("go"));
    open();
    fireEvent.click($("pick-circuit"));
    expect(isOpen()).toBe(false);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("se cierra solo si se deja «Rodar» (otra pestaña, otra pantalla)", () => {
    mount();
    open();
    act(() => setTab("ajustes"));
    expect(isOpen()).toBe(false);
    act(() => setTab("rodar"));
    open();
    act(() => show("sensores"));
    expect(isOpen()).toBe(false);
  });

  it("el atrás del móvil lo cierra (sin el aviso de «Pulsa atrás otra vez para salir»)", () => {
    const { rt } = mount();
    open();
    act(() => rt.nav.onBack());
    expect(isOpen()).toBe(false);
    expect(uiStore.getState().toast).toBeNull();
  });
});
