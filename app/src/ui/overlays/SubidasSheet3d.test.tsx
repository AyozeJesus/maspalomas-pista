// @vitest-environment jsdom
// La vuelta de prueba en 3D de cada subida, dentro de su hoja: el botón «3D» de cada fila, el visor y cómo se vuelve a
// la lista («Atrás» y el atrás del móvil).
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  openSubidas,
  pickIsla,
  pickSentido,
  subidasBack,
  uiStore,
  verSubida,
} from "../../app/ui-store";
import { memoryKV } from "../../engine/kv";
import { createRuntime } from "../../runtime";
import { RuntimeContext } from "../runtime-context";
import { SubidasSheet } from "./SubidasSheet";

afterEach(() => {
  cleanup();
  uiStore.setState({ subidas: null, screen: "home", homeTab: "rodar", toast: null });
});

function mount() {
  const rt = createRuntime({ kv: memoryKV(), store: null });
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <button id="subidas">Subidas de montaña</button>
      <SubidasSheet />
    </RuntimeContext.Provider>,
  );
  const q = (sel: string) => view.container.querySelector<HTMLElement>(sel);
  return { q, view };
}

function toList() {
  act(() => {
    openSubidas();
    pickIsla("tenerife");
    pickSentido(0);
  });
}

describe("«Subidas de montaña»: la vuelta de prueba en 3D", () => {
  it("cada subida de la lista tiene su «3D», junto a «Mapa»", () => {
    const { q, view } = mount();
    toList();
    const rows = [...view.container.querySelectorAll("#subida-list .hist-row")];
    expect(rows.length).toBe(11);
    for (const r of rows) {
      const b = r.querySelector<HTMLButtonElement>(".hist-act button");
      expect(b?.textContent).toBe("3D");
      expect(b?.getAttribute("aria-label")).toBe(
        "Vuelta de prueba en 3D: " + r.querySelector("b")?.textContent,
      );
      expect(r.querySelector(".hist-act a")?.textContent).toBe("Mapa");
    }
    expect(q("#sub-3d")).toBeNull();
  });

  it("«3D» abre su vuelta de prueba en la hoja (por la carretera de OpenStreetMap); «Atrás», a la lista", async () => {
    const { q } = mount();
    toList();
    fireEvent.click(q('[data-sub3d="los-loros"]') as HTMLElement);
    expect(uiStore.getState().subidas?.ver).toBe("subida:tenerife/los-loros/sur");
    expect(q("#subida-h")?.textContent).toBe("Los Loros (sur)");
    expect(q("#subida-list")).toBeNull();
    expect(q("#subida-go")).toBeNull();
    expect(q("#sub-3d")?.textContent).toBe("Preparando la vuelta de prueba…");
    await waitFor(() => expect(q("#sub-3d-player")).not.toBeNull());
    expect(q("#sub-3d")?.textContent).toMatch(/© colaboradores de OpenStreetMap/);
    expect(q("#sub-3d-speed")?.textContent).toBe("×1");
    fireEvent.click(q("#subida-back") as HTMLElement);
    expect(uiStore.getState().subidas).toEqual({ isla: "tenerife", sentido: 0, ver: null });
    expect(q("#sub-3d")).toBeNull();
    expect(q("#subida-list")).not.toBeNull();
  });

  it("el atrás del móvil cierra antes el 3D; y sin lista elegida, «3D» no hace nada", () => {
    act(() => {
      openSubidas();
      verSubida("subida:tenerife/araya/sur");
    });
    // Aún sin isla ni sentido: nada que ver.
    expect(uiStore.getState().subidas).toEqual({ isla: null, sentido: null });
    act(() => {
      pickIsla("tenerife");
      pickSentido(1);
      verSubida("subida:tenerife/araya/santa-cruz");
    });
    act(() => subidasBack());
    expect(uiStore.getState().subidas).toEqual({ isla: "tenerife", sentido: 1, ver: null });
    act(() => subidasBack());
    expect(uiStore.getState().subidas).toEqual({ isla: "tenerife", sentido: null });
  });

  it("una subida de otro sentido en `ver` (no está en esta lista): se queda en la lista", () => {
    const { q } = mount();
    toList();
    act(() => verSubida("subida:tenerife/los-loros/santa-cruz"));
    expect(q("#sub-3d")).toBeNull();
    expect(q("#subida-list")).not.toBeNull();
  });
});
