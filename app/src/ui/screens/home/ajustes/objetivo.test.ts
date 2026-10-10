import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../../test/legacy";
import { DEFAULT_SETTINGS, type Settings } from "../../../../engine/settings";
import { commitTarget, targetText } from "./objetivo";

// El «change» de #objetivo de antes (wire), con sus funciones: lo que guarda y lo que deja escrito en el campo.
function oldCommit(raw: string, objetivo: number): { saved: number; text: string } {
  const settings = { objetivo };
  const field = { value: raw };
  const old = liveFunctions<{
    parseLap: (t: string) => number;
    target: () => number;
    fmtLap: (t: number, d?: number) => string;
  }>(["fmt", "fmtLap", "parseLap", "target"], { consts: ["NF"], globals: { settings } });
  // Las líneas del manejador, tal cual (live.js, wire: $("objetivo").addEventListener("change", …)).
  const t = old.parseLap(field.value);
  if (t >= 40 && t <= 200) settings.objetivo = Math.round(t * 10) / 10;
  field.value = old.fmtLap(old.target(), 1);
  return { saved: settings.objetivo, text: field.value };
}

function newCommit(raw: string, objetivo: number): { saved: number; text: string } {
  const s: Settings = { ...DEFAULT_SETTINGS, objetivo };
  const r = commitTarget(raw, s);
  return { saved: r.objetivo === null ? objetivo : r.objetivo, text: r.text };
}

describe("objetivo por vuelta", () => {
  it("lo que se guarda y lo que queda en el campo, como antes", () => {
    const inputs = [
      "1:12,5",
      "1:05",
      "1.05",
      "65",
      "65,5",
      "65,55",
      " 1 : 04 , 5 ",
      "1:4",
      "rapidísimo",
      "",
      "39",
      "40",
      "200",
      "201",
      "3:20,0",
      "0:59,99",
      "1'02.3",
    ];
    for (const objetivo of [65, 72.5, 10, NaN])
      for (const raw of inputs)
        expect(newCommit(raw, objetivo), raw + " con " + objetivo).toEqual(
          oldCommit(raw, objetivo),
        );
  });

  it("lo de la batería: 1:12,5 vale; lo mal escrito no cambia nada", () => {
    expect(commitTarget("1:12,5", DEFAULT_SETTINGS)).toEqual({ objetivo: 72.5, text: "1:12,5" });
    expect(commitTarget("rapidísimo", { ...DEFAULT_SETTINGS, objetivo: 72.5 })).toEqual({
      objetivo: null,
      text: "1:12,5",
    });
    expect(targetText(DEFAULT_SETTINGS)).toBe("1:05,0");
  });
});
