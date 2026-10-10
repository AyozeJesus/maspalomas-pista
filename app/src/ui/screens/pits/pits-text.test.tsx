// @vitest-environment jsdom
// Las partes de boxes una a una frente a las funciones de antes (live.js), con casos que la tanda de ejemplo no tiene:
// GPS externo, retraso compensado, sin calibrar, una sola vuelta, la grabación que falla, cada estado de la subida y
// todo lo que puede decir el entrenador.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { domShape } from "../../../../test/dom-shape";
import { demoTanda } from "../../../../test/fixtures-pits";
import { oldCoach, oldPits, oldStoreLine } from "../../../../test/legacy-pits";
import type { CoachResult } from "../../../core/maspalomas";
import type { Engine } from "../../../engine";
import type { SyncStatus } from "../../../storage";
import { brakeRows } from "./brake-table";
import { planOf } from "./coach-plan";
import { lapTable, pitsSub } from "./lap-table";
import { storeLine } from "./store-line";
import { tandaCut } from "./tanda-cut";
import { TipsCard } from "./TipsCard";

afterEach(cleanup);

let E: Engine;
beforeAll(async () => {
  E = await demoTanda({ viewing: false });
});

// Cambia unos campos del motor mientras dura fn y los deja como estaban.
function withPatch(patch: Partial<Engine>, fn: () => void): void {
  const keys = Object.keys(patch) as (keyof Engine)[];
  const saved = keys.map((k) => [k, E[k]] as const);
  Object.assign(E, patch);
  try {
    fn();
  } finally {
    for (const [k, v] of saved) Object.assign(E, { [k]: v });
  }
}

const text = (doc: Document, id: string) => (doc.getElementById(id) as HTMLElement).textContent;

describe("la línea de debajo del título y la tabla de vueltas", () => {
  const CASES: [string, () => Partial<Engine>][] = [
    ["la tanda tal cual", () => ({})],
    ["GPS externo a 25 Hz", () => ({ extInfo: { fuente: "ble", nombre: "RaceBox", hz: 25 } })],
    ["GPS externo sin Hz", () => ({ extInfo: { fuente: "usb", nombre: null, hz: null } })],
    ["retraso compensado", () => ({ lagR2: 0.72, lag: 0.43 })],
    ["sin calibrar", () => ({ calib: { ...E.calib, f: null } })],
    ["sin mejor vuelta guardada", () => ({ best: null })],
    ["una sola vuelta", () => ({ laps: E.laps.filter((l) => l.valid).slice(0, 1) })],
    ["ninguna vuelta", () => ({ laps: [], pitsAnalysis: null })],
    ["sin análisis", () => ({ pitsAnalysis: null })],
  ];
  for (const [name, patch] of CASES)
    it(name, () => {
      withPatch(patch(), () => {
        const old = oldPits(E, "ok");
        const table = lapTable(E.laps, E.pitsAnalysis || null);
        expect(pitsSub(E, table.bestT)).toBe(text(old, "p-sub"));
        const rows = Array.from((old.getElementById("p-laps") as HTMLElement).children).map((tr) =>
          Array.from(tr.children).map((td) => ({
            text: td.textContent,
            best: td.className === "best",
          })),
        );
        expect(table.rows).toEqual(rows);
        expect(brakeRows(E).length).toBe(old.querySelectorAll("#p-brk tr").length);
      });
    });
});

describe("la línea de guardado (p-store)", () => {
  const STATES: SyncStatus[] = ["off", "busy", "ok", "offline", "auth"];
  const rec = () => E.rec as NonNullable<Engine["rec"]>;
  for (const state of STATES)
    for (const failed of [false, true])
      it(state + (failed ? ", sin poder guardar" : ""), () => {
        rec().failed = failed;
        try {
          const old = oldStoreLine(E, state);
          expect(storeLine(E, state)).toEqual({ text: old.textContent, cls: old.className });
        } finally {
          rec().failed = false;
        }
      });

  it("la vuelta de ejemplo: «Simulador: no se guarda.», con la clase normal", () => {
    withPatch({ rec: null, sim: true }, () => {
      // La de antes dejaba la clase de la tanda anterior (aquí, el aviso rojo).
      const old = oldStoreLine(E, "ok", "warnbox");
      expect(old.className).toBe("warnbox");
      expect(storeLine(E, "ok")).toEqual({ text: old.textContent, cls: "muted" });
      expect(old.textContent).toBe("Simulador: no se guarda.");
    });
  });

  it("repasando una guardada no dice nada (la de antes: «Simulador: no se guarda.»)", () => {
    withPatch({ rec: null, sim: true, viewing: { id: "x" } }, () => {
      expect(oldStoreLine(E, "ok").textContent).toBe("Simulador: no se guarda.");
      expect(storeLine(E, "ok")).toEqual({ text: "", cls: "muted" });
    });
  });
});

describe("«Cortar en dos»", () => {
  it("solo repasando una guardada, con al menos dos vueltas acabadas", () => {
    expect(tandaCut(E, true)).toBeNull();
    withPatch({ viewing: { id: "20261001-120000-dmop" } }, () => {
      expect(tandaCut(E, false)).toBeNull();
      const cut = tandaCut(E, true);
      const ended = E.laps.filter((l) => Number.isFinite(l.end));
      expect(cut && cut.sid).toBe("20261001-120000-dmop");
      expect(cut && cut.options.length).toBe(ended.length - 1);
      expect(cut && cut.options[0].text).toMatch(/^después de la vuelta \d+ \(1:\d\d,\d\d\)$/);
      expect(cut && cut.options[0].value).toBe(String(ended[0].end + 1));
      withPatch({ laps: ended.slice(0, 1) }, () => expect(tandaCut(E, true)).toBeNull());
    });
  });
});

describe("el plan para la próxima tanda", () => {
  const phase = (p: string) => p as "entrada" | "salida";
  const base = {
    plan: [],
    self: [],
    consistency: [],
    ideal: { show: null, kind: "sectores" },
  };
  const CASES: [string, Record<string, unknown>][] = [
    ["sin nada que mejorar", base],
    [
      "plan con porqués, sin porqué y ya hecho en otra vuelta",
      {
        ...base,
        plan: [
          {
            k: 2,
            num: 3,
            phase: phase("entrada"),
            gain: 0.4234,
            text: "C3 · La Horquilla · entrada: frenas antes; entras más despacio",
            already: { lapNum: 4, gain: 0.215 },
          },
          {
            k: 5,
            num: 6,
            phase: phase("salida"),
            gain: 0.1,
            text: "C6 · La Curva · salida",
            already: null,
          },
        ],
        self: [
          { k: 2, num: 3, name: "La Horquilla", phase: phase("entrada"), gain: 0.3, lapNum: 4 },
          { k: 2, num: 3, name: "La Horquilla", phase: phase("salida"), gain: 0.25, lapNum: 2 },
          { k: 1, num: 2, name: "Recta", phase: phase("salida"), gain: 0.2, lapNum: 3 },
          { k: 0, num: 1, name: "Uno", phase: phase("entrada"), gain: 0.1, lapNum: 1 },
        ],
        consistency: [{ k: 4, num: 5, name: "La Rápida", sd: 0.234 }],
        ideal: { show: 66.123, kind: "4 sectores" },
      },
    ],
    [
      "curva poco irregular (no se dice)",
      { ...base, consistency: [{ k: 4, num: 5, name: "La Rápida", sd: 0.149 }] },
    ],
  ];
  for (const [name, c] of CASES)
    it(name, () => {
      const old = oldCoach({ best: {} }, { coach: () => c, target: 64.5 });
      const plan = planOf(c as unknown as CoachResult, 64.5);
      const view = render(<TipsCard tips={plan.tips} />);
      const tips = view.container.querySelector("#p-tips") as HTMLElement;
      expect(domShape(tips)).toEqual(domShape(old.getElementById("p-tips") as HTMLElement));
      expect(plan.ideal).toBe(text(old, "p-ideal"));
    });

  it("sin análisis (o sin mejor vuelta)", () => {
    const old = oldCoach(null, {});
    const plan = planOf(null, 65);
    const view = render(<TipsCard tips={plan.tips} />);
    expect(domShape(view.container.querySelector("#p-tips") as HTMLElement)).toEqual(
      domShape(old.getElementById("p-tips") as HTMLElement),
    );
    expect(plan.ideal).toBe("");
  });
});
