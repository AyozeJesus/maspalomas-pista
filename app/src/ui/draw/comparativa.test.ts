// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DIAS, legacyRender, type Render } from "../../../test/fixtures-comparativa";
import { render } from "./comparativa";

const oldRender = legacyRender();

// Pinta en una caja que ya tenía algo (se vacía antes).
function paint(fn: Render, d: Parameters<Render>[1]): HTMLDivElement {
  const box = document.createElement("div");
  box.innerHTML = "<p>de antes</p>";
  fn(box, d);
  return box;
}

describe("pintar la comparativa del día", () => {
  it("pinta lo mismo que la de antes", () => {
    for (const [label, d] of DIAS)
      expect(paint(render, d).innerHTML, label).toBe(paint(oldRender, d).innerHTML);
  });

  it("cabecera, tablas, vueltas y notas", () => {
    const three = DIAS.find(([l]) => l === "tres pilotos")?.[1];
    const box = paint(render, three);
    expect(box.querySelector(".cmp-head")?.textContent).toMatch(/ · antihorario · 3 pilotos$/);
    expect(box.querySelectorAll("table.cmp-table")).toHaveLength(4);
    expect(box.querySelectorAll(".cmp-laps .lap")).toHaveLength(7);
    expect(box.querySelector("td.num.top b")?.textContent).toBe("1:21,23");
    expect(box.querySelectorAll("p.cmp-note").length).toBeGreaterThan(3);
    expect(paint(render, null).textContent).toBe("Todavía no hay vueltas en el garaje.");
  });
});
