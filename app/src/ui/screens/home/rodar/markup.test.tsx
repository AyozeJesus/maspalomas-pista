// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { describeMarkup, legacyElement } from "../../../../../test/legacy-markup";
import { memoryKV } from "../../../../engine/kv";
import { createRuntime } from "../../../../runtime";
import { RuntimeContext } from "../../../runtime-context";
import { RodarTab } from "../RodarTab";

afterEach(cleanup);

describe("pestaña «Rodar» frente al index.html de antes", () => {
  it("los mismos elementos, atributos y textos, en el mismo orden", () => {
    const view = render(
      <RuntimeContext.Provider value={createRuntime({ kv: memoryKV(), store: null })}>
        <RodarTab hidden={false} />
      </RuntimeContext.Provider>,
    );
    const mine = view.container.querySelector("#tab-rodar");
    if (!mine) throw new Error("falta #tab-rodar");
    // Lo que pinta la app al abrir: si se ve el aviso de instalar y la línea de la mejor vuelta.
    const opts = { ignoreAttrs: ["hidden"], dynamic: ["st-best-t"] };
    const old = describeMarkup(legacyElement("tab-rodar"), opts);
    expect(old.length).toBeGreaterThan(50);
    expect(describeMarkup(mine, opts)).toEqual(old);
  });
});
