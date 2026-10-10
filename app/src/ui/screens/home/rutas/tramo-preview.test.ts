import { describe, expect, it } from "vitest";
import { asCanvas, DrawLog, type FakeCanvas } from "../../../../../test/fake-canvas";
import { liveFunctions } from "../../../../../test/legacy";
import type { LatLon } from "../../../../core/tramos";
import { drawTramoPreview } from "./tramo-preview";

// drawTramoPrev de antes pinta en $("trs-prev") con la densidad de su window: aquí, el lienzo de mentira de cada
// prueba y una copia de la función por densidad.
type OldDraw = (a: LatLon | null, b: LatLon | null) => void;
const win: { canvas: FakeCanvas | null } = { canvas: null };
const copies = new Map<number | undefined, OldDraw>();
function oldDraw(dpr: number | undefined): OldDraw {
  let fn = copies.get(dpr);
  if (!fn) {
    fn = liveFunctions<{ drawTramoPrev: OldDraw }>(["drawTramoPrev"], {
      globals: { $: () => win.canvas, devicePixelRatio: dpr },
    }).drawTramoPrev;
    copies.set(dpr, fn);
  }
  return fn;
}

const A: LatLon = [28.355628, -16.418573];
const B: LatLon = [28.374397, -16.427567];
// Casi en el mismo sitio (el dibujo abarca al menos 100 m) y uno al sur del ecuador.
const NEAR: LatLon = [28.3557, -16.4186];
const SOUTH: LatLon = [-33.9, 18.42];

const CASES: [string, LatLon | null, LatLon | null][] = [
  ["las dos", A, B],
  ["solo la salida", A, null],
  ["solo la meta", null, B],
  ["ninguna", null, null],
  ["casi en el mismo sitio", A, NEAR],
  ["al sur", SOUTH, [-33.95, 18.5]],
];

describe("el dibujo de la salida y la meta", () => {
  for (const dpr of [undefined, 1, 2.625, 4])
    for (const [label, a, b] of CASES)
      it(label + " (densidad " + dpr + ")", () => {
        const size = { clientWidth: 380, clientHeight: 200 };
        const mine = new DrawLog();
        drawTramoPreview(asCanvas(mine.canvas(size)), a, b, dpr);
        const theirs = new DrawLog();
        win.canvas = theirs.canvas(size);
        oldDraw(dpr)(a, b);
        expect(mine.entries).toStrictEqual(theirs.entries);
        if (a || b) expect(mine.entries.some((e) => e[1] === "fillText")).toBe(true);
      });

  it("un lienzo aún sin tamaño en pantalla: 1 × 1, como antes", () => {
    const mine = new DrawLog();
    drawTramoPreview(asCanvas(mine.canvas()), A, B, 2);
    const theirs = new DrawLog();
    win.canvas = theirs.canvas();
    oldDraw(2)(A, B);
    expect(mine.entries).toStrictEqual(theirs.entries);
    expect(mine.entries.slice(0, 2)).toStrictEqual([
      ["canvas1", "width=", 1],
      ["canvas1", "height=", 1],
    ]);
  });
});
