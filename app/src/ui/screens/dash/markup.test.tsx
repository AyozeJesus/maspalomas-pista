// @vitest-environment jsdom
// El marcado de los dos paneles es el de index.html: mismas etiquetas en el mismo orden, mismos ids, clases,
// atributos (hidden, aria-*, role, data-*) y textos. Solo cambia el type="button" que pone ConfirmButton a «Terminar»
// y «Nuevo tramo» (sin formulario alrededor, no cambia nada).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { oldPanelHtml } from "../../../../test/legacy-panel";
import { uiStore } from "../../../app/ui-store";
import { memoryKV } from "../../../engine/kv";
import { DEFAULT_SETTINGS } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { RuntimeContext } from "../../runtime-context";
import { Ruta } from "../ruta/Ruta";
import { Dash } from "./Dash";

// Un elemento y lo que tiene dentro, en una línea por elemento (sin los espacios entre etiquetas).
function outline(el: Element, depth = 0, out: string[] = []): string[] {
  const attrs = Array.from(el.attributes)
    .filter((a) => !(a.name === "type" && a.value === "button"))
    .map((a) => a.name + "=" + JSON.stringify(a.value))
    .sort();
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === n.TEXT_NODE)
    .map((n) => (n.nodeValue || "").trim())
    .filter(Boolean)
    .join("|");
  out.push(
    "  ".repeat(depth) + el.tagName.toLowerCase() + " " + attrs.join(" ") + " «" + text + "»",
  );
  for (const c of Array.from(el.children)) outline(c, depth + 1, out);
  return out;
}

afterEach(() => cleanup());

describe("marcado de los paneles", () => {
  it("igual que el de index.html", () => {
    uiStore.setState({ screen: "home" });
    const rt = {
      session: { rt: { E: null, sim: { speed: 1 } } },
      settings: { get: () => DEFAULT_SETTINGS },
      ext: { hzText: () => "" },
      view3d: { close: null, view: null },
      kv: memoryKV(),
    } as unknown as Runtime;
    const { container } = render(
      <RuntimeContext.Provider value={rt}>
        <Dash />
        <Ruta />
      </RuntimeContext.Provider>,
    );
    const old = document.implementation.createHTMLDocument("antes");
    old.body.innerHTML = oldPanelHtml();
    for (const id of ["dash", "ruta"]) {
      const a = old.getElementById(id);
      const b = container.querySelector("#" + id);
      expect(a && b, id).toBeTruthy();
      if (a && b) expect(outline(b).join("\n")).toBe(outline(a).join("\n"));
    }
  });
});
