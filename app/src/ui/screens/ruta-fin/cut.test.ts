// «Cortar en dos» del resumen, igual que live.js: el punto de la trazada en cada instante (con los metros hasta ahí),
// si se ofrece, dónde empieza la barra y lo que dice; y cómo va el botón de dos toques.
import { beforeAll, describe, expect, it } from "vitest";
import { demoSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { liveFunctions, loadLegacy } from "../../../../test/legacy";
import type { Turnaround } from "../../../core/cortar";
import type { TrailPoint } from "../../../core/recorrido";
import type { Engine } from "../../../engine";
import { CutError } from "../../../services/cut";
import type { SessionMeta } from "../../../storage";
import {
  cutAtText,
  cutButtonText,
  cutDoneText,
  cutDots,
  cutFailText,
  cutPoint,
  cutSetup,
  NO_CUT,
} from "./cut";
import { CUT_START, cutReducer, type CutState } from "./cut-state";
import { makePaint } from "./paint";
import { trailDistances } from "./phases";

interface Old {
  cutPoint: (eng: Engine, t: number) => ReturnType<typeof cutPoint>;
  trailDistances: typeof trailDistances;
  setupCut: (eng: Engine) => void;
}

// setupCut y renderCut de antes escriben en la página: aquí, en unos objetos.
function oldCut(o: { store: boolean; garaje: boolean; turn?: Turnaround | null }) {
  const els: Record<string, Record<string, unknown>> = {};
  const el = (id: string) => (els[id] = els[id] || { id });
  const text: Record<string, string> = {};
  const cortar = loadLegacy("cortar.js").MaspaCortar as { turnaround: unknown };
  const old = liveFunctions<Old>(
    [
      "setupCut",
      "renderCut",
      "cutPoint",
      "cutSessionId",
      "trailIndexAt",
      "trailDistances",
      "fmt",
      "fmtClock",
    ],
    {
      consts: ["NF"],
      globals: {
        $: el,
        setText: (id: string, t: string) => (text[id] = t),
        ST: o.store ? {} : null,
        settings: { garaje: o.garaje ? { u: "https://mac", k: "k" } : null },
        cutUi: null,
        MaspaCortar: o.turn === undefined ? cortar : { turnaround: () => o.turn },
      },
    },
  );
  return { old, els, text };
}

let eng: Engine;
let tr: TrailPoint[];

beforeAll(async () => {
  eng = await routeOf(demoSeries());
  tr = eng.route.trail;
});

describe("cortar en dos: lo mismo que antes", () => {
  it("el punto de la trazada en cada instante, con sus metros", () => {
    const { old } = oldCut({ store: true, garaje: false });
    for (const t of [-10, tr[0].t, 100.04, 250, 333.333, tr[tr.length - 1].t, 1e6])
      expect(cutPoint(tr, t)).toEqual(old.cutPoint(eng, t));
    expect(cutPoint([], 10)).toBeNull();
    // (Los Float64Array de antes son de otro contexto: se comparan sus números.)
    expect(Array.from(trailDistances(tr))).toEqual(Array.from(old.trailDistances(tr)));
    // Con huecos del GPS y saltos de reloj (ni huecos ni ratos de 5 s o más suman metros).
    const odd = tr
      .slice(0, 50)
      .map((p, i) => ({ ...p, gap: i % 9 === 4, t: p.t + (i > 30 ? 7 : 0) }));
    expect(Array.from(trailDistances(odd))).toEqual(Array.from(old.trailDistances(odd)));
  });

  const TURN: Turnaround = { t: 300.5, d: 6100, parada: true, lejos: 3000 };
  for (const [label, o] of [
    ["en medio", { store: true, garaje: false, turn: null }],
    ["en medio, con garaje", { store: true, garaje: true, turn: null }],
    ["ida y vuelta, donde paraste", { store: true, garaje: false, turn: TURN }],
    [
      "ida y vuelta sin parar, con garaje",
      { store: true, garaje: true, turn: { ...TURN, parada: false } },
    ],
    ["sin almacén", { store: false, garaje: false, turn: null }],
  ] as const)
    it("lo que ofrece y dice: " + label, () => {
      const { old, els, text } = oldCut(o);
      old.setupCut(eng);
      const mine = cutSetup(eng, o.store, o.turn, o.garaje);
      expect(!mine.ok).toBe(els["ruf-cut"].hidden);
      if (!mine.ok) {
        expect(mine).toEqual(NO_CUT);
        return;
      }
      expect(mine.note).toBe(text["ruf-cut-note"]);
      const input = els["ruf-cut-t"];
      expect([String(mine.min), String(mine.max), String(Math.round(mine.t))]).toEqual([
        input.min,
        input.max,
        input.value,
      ]);
      expect(cutAtText(tr, mine.t)).toBe(text["ruf-cut-at"]);
      expect(cutButtonText(false, false)).toBe(text["ruf-cut-go"]);
    });

  it("solo en una ruta de verdad, libre y de más de un minuto", () => {
    const sim = { ...eng, viewing: null, rec: null } as Engine;
    expect(cutSetup(sim, true, null, false).ok).toBe(false);
    expect(cutSetup({ ...eng, free: false } as Engine, true, null, false).ok).toBe(false);
    expect(cutSetup(eng, true, null, false).ok).toBe(true);
  });

  it("el punto rosa del corte en el mapa", () => {
    const p = cutPoint(tr, 200);
    expect(cutDots(tr, 200)).toEqual([{ x: p?.x, y: p?.y, color: "#ff5fd2", label: "corte" }]);
    expect(cutDots([], 200)).toEqual([]);
  });

  it("los avisos", () => {
    const parts = [{ recorrido: { distancia: 6312 } }, { recorrido: { distancia: 6249 } }];
    expect(cutDoneText(parts as unknown as SessionMeta[])).toBe("Cortada en dos: 6,3 km y 6,2 km");
    expect(cutFailText(new CutError("demasiado corta"))).toBe(
      "Así una de las dos quedaría casi vacía: corta más al medio",
    );
    expect(cutFailText(new CutError("no está"))).toBe(
      "No se ha podido cortar (la ruta sigue entera)",
    );
    expect(cutFailText("raro")).toBe("No se ha podido cortar (la ruta sigue entera)");
    expect([
      cutButtonText(true, false),
      cutButtonText(true, true),
      cutButtonText(false, true),
    ]).toEqual(["¿Cortar? Toca otra vez", "Cortando…", "Cortando…"]);
  });
});

describe("cortar en dos: el estado", () => {
  const setup = (t: number) => ({ ...NO_CUT, ok: true, sid: "s", min: 10, max: 900, t, note: "n" });

  it("otra ruta empieza cerrada y con la barra en su sitio; la misma, como estaba", async () => {
    const other = await routeOf(demoSeries(), { id: "20261010-090000-otra" });
    const p1 = makePaint(eng);
    let s: CutState = cutReducer(CUT_START, { type: "paint", paint: p1, setup: setup(450) });
    s = cutReducer(s, { type: "toggle", open: true });
    s = cutReducer(s, { type: "move", t: 300 });
    s = cutReducer(s, { type: "arm" });
    expect([s.t, s.open, s.armed]).toEqual([300, true, true]);
    // Repintada (otro color): la barra y lo abierto se quedan; el segundo toque, no.
    const p2 = makePaint(eng);
    s = cutReducer(s, { type: "paint", paint: p2, setup: setup(450) });
    expect([s.t, s.open, s.armed, s.paint]).toEqual([300, true, false, p2]);
    s = cutReducer(s, { type: "paint", paint: makePaint(other), setup: setup(500) });
    expect([s.t, s.open]).toEqual([500, false]);
  });

  it("el botón: armar, olvidarse, cortar, fallar y ya cortada", () => {
    let s = cutReducer(CUT_START, { type: "paint", paint: makePaint(eng), setup: setup(450) });
    s = cutReducer(s, { type: "arm" });
    s = cutReducer(s, { type: "move", t: 200 });
    expect(s.armed).toBe(false);
    s = cutReducer(cutReducer(s, { type: "arm" }), { type: "start" });
    // Cortando, el aviso de los 4 s no lo desarma.
    expect(cutReducer(s, { type: "disarm" })).toBe(s);
    const failed = cutReducer(s, { type: "fail" });
    expect([failed.busy, failed.armed]).toEqual([false, false]);
    const done = cutReducer(s, { type: "done" });
    expect(cutReducer(done, { type: "move", t: 600 }).t).toBe(200);
    // La misma ruta ya cortada no sigue donde estaba.
    const again = cutReducer(done, { type: "paint", paint: makePaint(eng), setup: setup(450) });
    expect([again.t, again.done, again.busy]).toEqual([450, false, false]);
  });

  it("sin corte, la barra no se mueve", () => {
    const s = cutReducer(CUT_START, { type: "paint", paint: makePaint(eng), setup: NO_CUT });
    expect(cutReducer(s, { type: "move", t: 33 })).toBe(s);
  });
});
