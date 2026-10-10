// @vitest-environment jsdom
// La pantalla «Tiempos del día»: el marcado de siempre; al abrirla, lo guardado y lo que contesta el Mac pintado como en
// el garaje; «Actualizar» y «Volver» (a donde se vino).
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { domShape, legacyDocument } from "../../../../test/dom-shape";
import { DIAS, legacyRender } from "../../../../test/fixtures-comparativa";
import { memoryStore } from "../../../../test/fixtures-pits";
import { show, uiStore } from "../../../app/ui-store";
import type { DiaComparativa } from "../../../core/comparativa";
import { memoryKV } from "../../../engine/kv";
import { createRuntime, type Runtime } from "../../../runtime";
import { RuntimeContext } from "../../runtime-context";
import { DAY_KEY } from "./day-loader";
import { Dia } from "./Dia";

afterEach(cleanup);
beforeEach(() => {
  uiStore.setState({ screen: "home", summaryVersion: 0, homeVersion: 0, toast: null });
});

const day = (label: string) => (DIAS.find(([l]) => l === label) || DIAS[0])[1] as DiaComparativa;
const DAY = day("tres pilotos");
const OTHER = day("un piloto");
const CFG = { u: "https://garaje.ejemplo.net", k: "clave" };

function mount(reply: () => Promise<Response>) {
  const kv = memoryKV();
  const store = memoryStore(() => reply());
  store.configure(CFG);
  const rt: Runtime = createRuntime({ kv, store });
  rt.settings.update({ garaje: CFG });
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <Dia />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => {
    const el = view.container.querySelector<HTMLElement>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  return { rt, kv, $ };
}

const json = (d: unknown) => Promise.resolve(new Response(JSON.stringify(d), { status: 200 }));

// La comparativa de antes pintada en una caja (para comparar con la de la pantalla).
function oldBody(d: unknown): string {
  const box = document.createElement("section");
  legacyRender()(box, d as DiaComparativa);
  return box.innerHTML;
}

describe("tiempos del día", () => {
  it("el marcado de siempre", () => {
    // (Sin abrirla: al abrirla ya empieza a pedir los tiempos.)
    const old = legacyDocument("dia");
    const { $ } = mount(() => json(DAY));
    expect(domShape($("dia"))).toEqual(domShape(old.getElementById("dia") as HTMLElement));
    act(() => show("dia"));
    expect($("dia").hidden).toBe(false);
  });

  it("al abrir: lo guardado y luego lo del Mac; «Actualizar» y «Volver»", async () => {
    let reply: unknown = DAY;
    const { rt, kv, $ } = mount(() =>
      reply instanceof Error ? Promise.reject(reply) : json(reply),
    );
    kv.store(DAY_KEY, { at: Date.now() - 600000, data: OTHER });
    act(() => rt.nav.showDay("home"));
    expect(uiStore.getState().screen).toBe("dia");
    // Lo guardado al momento (y ya pidiendo).
    expect($("dia-body").innerHTML).toBe(oldBody(OTHER));
    expect($("dia-status").textContent).toBe("Pidiendo los tiempos al Mac…");
    await waitFor(() =>
      expect($("dia-status").textContent).toMatch(/^Actualizado a las \d\d:\d\d$/),
    );
    expect($("dia-body").innerHTML).toBe(oldBody(DAY));
    expect(kv.load<{ data: unknown } | null>(DAY_KEY, null)?.data).toEqual(DAY);
    // Sin conexión: se quedan los de antes.
    reply = new TypeError("Failed to fetch");
    fireEvent.click($("dia-refresh"));
    await waitFor(() =>
      expect($("dia-status").textContent).toMatch(
        /^Sin conexión con el Mac \(no hay red o el garaje está cerrado\)\. Abajo, los tiempos de las \d\d:\d\d\.$/,
      ),
    );
    expect($("dia-body").innerHTML).toBe(oldBody(DAY));
    fireEvent.click($("dia-back"));
    expect(uiStore.getState().screen).toBe("home");
  });

  it("sin garaje lo dice", () => {
    const { rt, $ } = mount(() => json(DAY));
    act(() => rt.settings.update({ garaje: null }));
    act(() => rt.nav.showDay("pits"));
    expect($("dia-status").textContent).toBe(
      "Conecta el garaje del Mac para ver los tiempos de todos.",
    );
    expect($("dia-body").textContent).toBe("");
  });
});
