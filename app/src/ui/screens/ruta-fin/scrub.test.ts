// El punto que se mueve por la ruta (sin dibujar), igual que en live.js: en qué curva y frenada cae cada punto, lo
// que se dice de él, a qué curva saltan los botones y qué punto se toca con el dedo.
import { beforeAll, describe, expect, it } from "vitest";
import { demoSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { liveFunctions } from "../../../../test/legacy";
import type { TrailPoint } from "../../../core/recorrido";
import type { Engine } from "../../../engine";
import { trailDistances } from "./phases";
import * as S from "./scrub";

interface OldScrub {
  eng: Engine | null;
  i: number;
  d: Float64Array | null;
  spans: S.CurveSpan[];
}
interface Old {
  trailIndexAt: typeof S.trailIndexAt;
  curveSpans: (eng: Engine) => S.CurveSpan[];
  spanAt: (i: number) => S.CurveSpan | null;
  brakeAt: (eng: Engine, t: number) => unknown;
  trailPick: typeof S.trailPick;
  scrubInfo: () => void;
  jumpCurve: (dir: number) => void;
  scrub: OldScrub;
}

// Lo que escribe scrubInfo de antes (setText y los botones) y adónde manda jumpCurve.
const written: Record<string, string> = {};
const buttons: Record<string, { disabled: boolean }> = {
  "ruf-prev": { disabled: false },
  "ruf-next": { disabled: false },
};
const jumps: number[] = [];
const old = liveFunctions<Old>(
  [
    "trailIndexAt",
    "curveSpans",
    "spanAt",
    "brakeAt",
    "trailPick",
    "scrubInfo",
    "jumpCurve",
    "fmt",
    "fmtClock",
    "fmtMeters",
  ],
  {
    consts: ["NF", "scrub", "PHASE_NAME"],
    globals: {
      setText: (id: string, text: string) => (written[id] = text),
      $: (id: string) =>
        buttons[id] ?? { setAttribute: (_k: string, v: string) => (written[id + ":aria"] = v) },
      scrubTo: (i: number) => jumps.push(i),
    },
  },
);

let eng: Engine;
let tr: TrailPoint[];
let spans: S.CurveSpan[];
let d: Float64Array;

beforeAll(async () => {
  eng = await routeOf(demoSeries());
  tr = eng.route.trail;
  spans = S.curveSpans(tr, eng.route.curves);
  d = trailDistances(tr);
  old.scrub.eng = eng;
  old.scrub.d = d;
  old.scrub.spans = old.curveSpans(eng);
});

// Unos puntos repartidos por la ruta (y los de los bordes).
function samples(n: number, k = 97): number[] {
  const out = [0, 1, n - 2, n - 1];
  for (let i = 0; i < n; i += k) out.push(i);
  return out;
}

describe("el punto que se mueve: lo mismo que antes", () => {
  it("cada curva en la trazada (puntos y el más tumbado) y la curva de cada punto", () => {
    expect(spans.length).toBe(eng.route.curves.length);
    expect(spans).toEqual(old.scrub.spans);
    // La misma curva (por su sitio en la lista: las de antes son otros objetos iguales).
    const at = (list: S.CurveSpan[], sp: S.CurveSpan | null) => (sp ? list.indexOf(sp) : -1);
    let inCurve = 0;
    for (let i = 0; i < tr.length; i += 3) {
      const k = at(spans, S.spanAt(spans, i));
      expect(k, "punto " + i).toBe(at(old.scrub.spans, old.spanAt(i)));
      if (k >= 0) inCurve++;
    }
    expect(inCurve).toBeGreaterThan(10);
  });

  it("el punto de cada instante y la frenada en marcha", () => {
    for (const t of [-5, tr[0].t, tr[0].t + 0.01, 33.3, 120, 300.5, tr[tr.length - 1].t, 1e9])
      expect(S.trailIndexAt(tr, t)).toBe(old.trailIndexAt(tr, t));
    for (let i = 0; i < tr.length; i += 7)
      expect(S.brakeAt(eng.route.brakes, tr[i].t)).toBe(old.brakeAt(eng, tr[i].t));
    expect(eng.route.brakes.some((b) => S.brakeAt(eng.route.brakes, b.t) === b)).toBe(true);
  });

  it("lo que dice de cada punto (y los botones de curva)", () => {
    for (const i of samples(tr.length)) {
      old.scrub.i = i;
      old.scrubInfo();
      const mine = S.scrubText(tr, eng.route.curves, eng.route.brakes, d, spans, i);
      expect(mine.at, "punto " + i).toBe(written["ruf-at"]);
      expect(mine.aria).toBe(written["ruf-pos:aria"]);
      expect(mine.sub, "punto " + i).toBe(written["ruf-at-c"]);
      expect(!mine.hasPrev).toBe(buttons["ruf-prev"].disabled);
      expect(!mine.hasNext).toBe(buttons["ruf-next"].disabled);
    }
    // Los casos: una curva con sus datos, una frenada, una recta antes de una curva y el final.
    const all = samples(tr.length, 1).map(
      (i) => S.scrubText(tr, eng.route.curves, eng.route.brakes, d, spans, i).sub,
    );
    expect(all.some((s) => /^Curva \d+ de \d+ \((derecha|izquierda)\): tumbado \d+°/.test(s))).toBe(
      true,
    );
    expect(all.some((s) => /Frenada: pico \d,\d\d g, de \d+ a \d+ km\/h en \d+ m/.test(s))).toBe(
      true,
    );
    expect(all.some((s) => /^Recta: la curva \d+ está a \d+ m\.$/.test(s))).toBe(true);
    expect(all.some((s) => /^Aquí empieza la curva \d+\.$/.test(s))).toBe(true);
  });

  it("«Curva anterior / siguiente»: al punto más tumbado de la curva de al lado", () => {
    for (const i of samples(tr.length, 31))
      for (const dir of [1, -1] as const) {
        jumps.length = 0;
        old.scrub.i = i;
        old.jumpCurve(dir);
        expect(S.jumpTarget(spans, i, dir)).toBe(jumps.length ? jumps[0] : null);
      }
  });

  it("el punto que se toca en el mapa (también en una ida y vuelta por la misma carretera)", () => {
    // Ida por y = 0 y vuelta por y = 4 m: bajo el dedo caen las dos pasadas.
    const back: Pick<TrailPoint, "x" | "y">[] = [];
    for (let k = 0; k <= 100; k++) back.push({ x: k * 10, y: 0 });
    for (let k = 100; k >= 0; k--) back.push({ x: k * 10 + 3, y: 4 });
    for (const [x, y, cur, tol] of [
      [500, 2, 40, 10],
      [500, 2, 160, 10],
      [500, 2, 101, 10],
      [0, 0, 0, 1],
      [1003, 4, 0, 5],
      [-50, 30, 70, 2],
    ])
      expect(S.trailPick(back, x, y, cur, tol)).toBe(
        old.trailPick(back as TrailPoint[], x, y, cur, tol),
      );
    for (let i = 0; i < tr.length; i += 53) {
      const p = tr[i];
      for (const [dx, cur, tol] of [
        [0, i, 20],
        [15, 0, 40],
        [-30, tr.length - 1, 8],
      ])
        expect(S.trailPick(tr, p.x + dx, p.y - dx, cur, tol)).toBe(
          old.trailPick(tr, p.x + dx, p.y - dx, cur, tol),
        );
    }
    expect(S.trailPick([], 0, 0, 0, 10)).toBe(-1);
  });

  it("el punto a unos metros (tocando la gráfica): el más cercano", () => {
    const L = d[d.length - 1];
    for (const s of [-10, 0, 0.4, 1234.5, L / 4, L / 2, L - 0.1, L, L + 50]) {
      const i = S.indexAtDistance(d, s);
      let best = 0;
      for (let k = 1; k < d.length; k++) if (Math.abs(d[k] - s) < Math.abs(d[best] - s)) best = k;
      // El más cercano (en un empate, cualquiera de los dos).
      expect(Math.abs(d[i] - s)).toBeCloseTo(Math.abs(d[best] - s), 9);
    }
  });
});
