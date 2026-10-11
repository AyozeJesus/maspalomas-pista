// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSubidas, setTab, show, uiStore } from "../../app/ui-store";
import { memoryKV, type KeyValueStore } from "../../engine/kv";
import { createRuntime, type Runtime } from "../../runtime";
import { SUBIDAS_BOOK } from "../../services/subidas-store";
import { recordPass } from "../../services/tramos-store";
import { RuntimeContext } from "../runtime-context";
import { SubidasSheet } from "./SubidasSheet";

afterEach(() => {
  cleanup();
  uiStore.setState({ subidas: null, screen: "home", homeTab: "rodar", toast: null });
});

function mount(kv: KeyValueStore = memoryKV()) {
  const rt: Runtime = createRuntime({ kv, store: null });
  const start = vi.spyOn(rt.session, "startReal").mockResolvedValue(undefined);
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <button id="subidas">Subidas de montaña</button>
      <SubidasSheet />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  const rows = () =>
    [...view.container.querySelectorAll("#subida-list .hist-row")].map((r) => ({
      name: r.querySelector("b")?.textContent,
      det: r.querySelector(".sub-det")?.textContent ?? null,
      line: r.querySelector(".sub-line")?.textContent,
      map: r.querySelector("a")?.getAttribute("href"),
    }));
  return { rt, start, $, rows };
}

const open = () => act(() => openSubidas());
const state = () => uiStore.getState().subidas;

describe("«Subidas de montaña»: isla, dirección y todas las de esa dirección", () => {
  it("primero la isla, luego hacia dónde y salen todas en el orden en que se encuentran", () => {
    const { $, rows } = mount();
    expect($("pick-subida").hidden).toBe(true);
    open();
    expect($("pick-subida").hidden).toBe(false);
    expect($("subida-h").textContent).toBe("Subidas de montaña");
    const isla = $("subida-isla-tenerife");
    expect(isla.textContent).toBe("Tenerife11 subidas");
    expect(document.activeElement).toBe(isla);
    expect($("subida-back").hidden).toBe(true);
    fireEvent.click(isla);
    expect($("subida-h").textContent).toBe("Tenerife");
    expect($("subida-sentido-sur").textContent).toBe("Dirección sur");
    expect($("subida-sentido-santa-cruz").textContent).toBe("Dirección Santa Cruz");
    fireEvent.click($("subida-sentido-sur"));
    expect($("subida-h").textContent).toBe("Tenerife · Dirección sur");
    const sur = rows();
    expect(sur.map((r) => r.name)).toEqual([
      "Carretera vieja",
      "Barranco Hondo",
      "Cuesta de Las Tablas",
      "Araya",
      "Los Loros",
      "La Esperanza",
      "El Teide",
      "El Escobonal",
      "Arico",
      "Jama",
      "El Boquerón",
    ]);
    const loros = sur[4];
    expect(loros.det).toBe("Desde el bar de Los Loros");
    expect(loros.line).toBe("2,0 km en línea recta · sin pasadas");
    expect(loros.map).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=28.355694,-16.418944&destination=28.372172,-16.427788&travelmode=driving",
    );
    expect(sur[2].det).toBeNull();
  });

  it("dirección Santa Cruz: al revés (de El Boquerón a la carretera vieja), con la salida y la meta cambiadas", () => {
    const { $, rows } = mount();
    open();
    fireEvent.click($("subida-isla-tenerife"));
    fireEvent.click($("subida-sentido-santa-cruz"));
    const sc = rows();
    expect(sc[0].name).toBe("El Boquerón");
    expect(sc[sc.length - 1].name).toBe("Carretera vieja");
    const teide = sc.find((r) => r.name === "El Teide");
    expect(teide?.det).toBe("Desde El Portillo hasta el cruce de Los Loros");
    expect(teide?.map).toContain("origin=28.3061,-16.56383&destination=28.388666,-16.449377");
  });

  it("con pasadas guardadas, su mejor tiempo", () => {
    const kv = memoryKV();
    recordPass(
      kv,
      "subida:tenerife/los-loros/sur",
      "s",
      Date.UTC(2026, 9, 9, 16, 23),
      { t0: 19, t1: 298.4, tiempo: 279.4, tiempos: [], vMax: 131 },
      SUBIDAS_BOOK,
    );
    const { $, rows } = mount(kv);
    open();
    fireEvent.click($("subida-isla-tenerife"));
    fireEvent.click($("subida-sentido-sur"));
    expect(rows()[4].line).toMatch(/^2,0 km en línea recta · 1 pasada · mejor 4:39,4 \(/);
    // En la otra dirección, nada.
    fireEvent.click($("subida-back"));
    fireEvent.click($("subida-sentido-santa-cruz"));
    expect(rows().find((r) => r.name === "Los Loros")?.line).toMatch(/sin pasadas$/);
  });

  it("«Salir en ruta libre» echa a rodar en ese toque (una ruta libre: ahí se cronometran) y cierra", () => {
    const { $, start } = mount();
    open();
    fireEvent.click($("subida-isla-tenerife"));
    fireEvent.click($("subida-sentido-sur"));
    fireEvent.click($("subida-go"));
    expect(start.mock.calls).toEqual([[true]]);
    expect(state()).toBeNull();
  });

  it("«Atrás» vuelve un paso; «Cerrar», tocar fuera o Escape cierran sin salir", () => {
    const { $, start } = mount();
    open();
    fireEvent.click($("subida-isla-tenerife"));
    fireEvent.click($("subida-sentido-sur"));
    fireEvent.click($("subida-back"));
    expect(state()).toEqual({ isla: "tenerife", sentido: null });
    fireEvent.click($("subida-back"));
    expect(state()).toEqual({ isla: null, sentido: null });
    fireEvent.click($("pick-subida").querySelector(".sheet") as HTMLElement);
    expect(state()).not.toBeNull();
    fireEvent.click($("subida-cancel"));
    expect(state()).toBeNull();
    expect(document.activeElement).toBe($("subidas"));
    open();
    fireEvent.click($("pick-subida"));
    expect(state()).toBeNull();
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state()).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("el atrás del móvil vuelve un paso y, al principio, cierra (sin aviso de salir)", () => {
    const { rt, $ } = mount();
    open();
    fireEvent.click($("subida-isla-tenerife"));
    fireEvent.click($("subida-sentido-sur"));
    act(() => rt.nav.onBack());
    expect(state()).toEqual({ isla: "tenerife", sentido: null });
    act(() => rt.nav.onBack());
    act(() => rt.nav.onBack());
    expect(state()).toBeNull();
    expect(uiStore.getState().toast).toBeNull();
  });

  it("se cierra solo si se deja «Rodar»", () => {
    mount();
    open();
    act(() => setTab("rutas"));
    expect(state()).toBeNull();
    act(() => setTab("rodar"));
    open();
    act(() => show("sensores"));
    expect(state()).toBeNull();
  });
});
