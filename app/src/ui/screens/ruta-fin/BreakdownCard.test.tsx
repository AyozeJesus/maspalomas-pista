// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import type { Runtime } from "../../../runtime";
import { RuntimeContext } from "../../runtime-context";
import { BreakdownCard } from "./BreakdownCard";
import type { Paint } from "./paint";

afterEach(cleanup);

function paintOf(passes: { id: string; nombre: string; t0: number; t1: number }[]): Paint {
  const t = Array.from({ length: 601 }, (_, i) => i);
  const eng = {
    loc: {
      view: () => ({ t, speed: t.map((i) => (i >= 5 && i <= 595 ? 10 : 0)), hacc: t.map(() => 4) }),
    },
    tramoPasses: passes.map((p) => ({
      ...p,
      lag: 0,
      pasada: { tiempo: p.t1 - p.t0, tiempos: [], vMax: 0 },
    })),
  } as unknown as Engine;
  return { eng, s: {} as Paint["s"], turn: null, now: 0 };
}

function mount(paint: Paint | null) {
  const rt = { kv: memoryKV() } as unknown as Runtime;
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <BreakdownCard paint={paint} />
    </RuntimeContext.Provider>,
  );
  const $ = (id: string) => view.container.querySelector<HTMLElement>("#" + id);
  return { $, view };
}

describe("«Por tramos» en el resumen de la ruta", () => {
  it("con pasadas: cada trozo en orden en la tabla, la nota y la barra", () => {
    const { $, view } = mount(
      paintOf([
        {
          id: "subida:tenerife/barranco-hondo/sur",
          nombre: "Barranco Hondo (sur)",
          t0: 100,
          t1: 204,
        },
        {
          id: "subida:tenerife/cuesta-las-tablas/sur",
          nombre: "Cuesta de Las Tablas (sur)",
          t0: 205,
          t1: 270,
        },
      ]),
    );
    expect($("ruf-bd-box")?.hasAttribute("data-empty")).toBe(false);
    const rows = [...view.container.querySelectorAll("#ruf-bd-list tr")].map(
      (tr) => tr.querySelector("td")?.firstChild?.textContent,
    );
    expect(rows).toEqual([
      "Fuera de tramo",
      "Barranco Hondo (sur)",
      "Cuesta de Las Tablas (sur)",
      "Fuera de tramo",
    ]);
    expect($("ruf-bd-note")?.textContent).toBe(
      "En tramos, 2:49 de 9:50 rodando (29 %): 2 pasadas.",
    );
    expect($("ruf-bd-bar")).not.toBeNull();
  });

  it("sin pasadas (o sin pintar aún): la caja va vacía y la tarjeta no sale", () => {
    for (const paint of [null, paintOf([])]) {
      const { $ } = mount(paint);
      expect($("ruf-bd")).not.toBeNull();
      expect($("ruf-bd-box")?.hasAttribute("data-empty")).toBe(true);
      expect($("ruf-bd-list")).toBeNull();
      cleanup();
    }
  });
});
