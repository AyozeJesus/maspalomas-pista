import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../../test/legacy";
import { currentOrient, ORIENT_CHOICES } from "./orient";

// renderOrient de antes con los cuatro botones del marcado: cuál queda marcado.
function oldChecked(pantalla: unknown): string[] {
  const settings = { pantalla };
  const buttons = ORIENT_CHOICES.map((o) => ({
    dataset: { orient: o.value },
    checked: "",
    setAttribute(_name: string, v: string) {
      this.checked = v;
    },
  }));
  const old = liveFunctions<{ renderOrient: () => void; ORIENTS: string[] }>(["renderOrient"], {
    consts: ["ORIENTS"],
    globals: { settings, document: { querySelectorAll: () => buttons } },
  });
  old.renderOrient();
  return buttons.filter((b) => b.checked === "true").map((b) => b.dataset.orient);
}

describe("pantalla en pista", () => {
  it("las mismas cuatro de antes, en el mismo orden", () => {
    const old = liveFunctions<{ ORIENTS: string[] }>([], { consts: ["ORIENTS"] });
    expect(ORIENT_CHOICES.map((o) => o.value)).toEqual([...old.ORIENTS]);
  });

  it("la marcada, como renderOrient (lo desconocido cuenta como «Como el móvil»)", () => {
    for (const p of [
      "auto",
      "portrait-primary",
      "landscape-primary",
      "landscape-secondary",
      "portrait-secondary",
      "",
      undefined,
      null,
      "Horizontal",
    ])
      expect([currentOrient(p as string)], String(p)).toEqual(oldChecked(p));
  });
});
