// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { describeMarkup, legacyElement } from "../../../../../test/legacy-markup";
import { memoryKV } from "../../../../engine/kv";
import { createRuntime } from "../../../../runtime";
import { RuntimeContext } from "../../../runtime-context";
import { AjustesTab } from "../AjustesTab";

afterEach(cleanup);

describe("pestaña «Ajustes» frente al index.html de antes", () => {
  it("los mismos elementos, atributos y textos, en el mismo orden", () => {
    const view = render(
      <RuntimeContext.Provider value={createRuntime({ kv: memoryKV(), store: null })}>
        <AjustesTab hidden={false} />
      </RuntimeContext.Provider>,
    );
    const mine = view.container.querySelector("#tab-ajustes");
    if (!mine) throw new Error("falta #tab-ajustes");
    const opts = {
      // Lo que pone la app al pintar: qué se ve, qué está marcado, el valor de la distancia y el encuadre del mapa.
      ignoreAttrs: ["hidden", "aria-checked", "checked", "value", "viewBox"],
      // El estado del receptor (en jsdom no hay Bluetooth ni USB), el mapa, la lista de circuitos y la versión.
      dynamic: ["st-ext-t", "meta-svg", "circ-list", "home-build"],
    };
    const old = describeMarkup(legacyElement("tab-ajustes"), opts);
    expect(old.length).toBeGreaterThan(100);
    expect(describeMarkup(mine, opts)).toEqual(old);
  });
});
