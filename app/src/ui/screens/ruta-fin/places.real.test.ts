// Dónde está cada curva y cada punto de las rutas de verdad (si están en este ordenador: PISTA_DATA), repasadas con
// el mismo motor que «Ver»: las coordenadas que se enseñan (las de la tabla de curvas, en el punto más tumbado de
// cada una, y las del punto que se mueve, en cada punto de la trazada) caen en la carretera, a pocos metros del camino
// que marcan los fijos del GPS de la grabación; y en el punto más tumbado de una curva, la tabla y el punto dicen lo
// mismo. A 300 m o menos de la salida o de la llegada (casa), ni coordenadas ni enlace.
import { describe, expect, it } from "vitest";
import { realSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { toLocal } from "../../../core/maspalomas";
import { trailDistances } from "./phases";
import { curveSpans, scrubText } from "./scrub";
import { curvePlace, curvesTable } from "./tables";

const RIDES = [
  "20261009-163105-bn2o.json",
  "20261009-170613-a0l8.json",
  "20261009-171527-csvc.json",
  "20261009-172312-eck7.json",
];
// Lo que se puede separar del camino de los fijos (metros). La trazada es la del motor: entre fijo y fijo (1 Hz) sigue
// en línea recta por el rumbo del último, y en curva rápida se sale hasta 20 m del camino de los fijos (Los Loros, a
// 85–120 km/h; el 99 % de los puntos, a menos de 14 m). El vértice que se usaba antes caía a 48 m (Los Loros) y a 305 m
// (csvc) del punto más tumbado de su curva.
const NEAR_CURVE = 20;
const NEAR_POINT = 25;
const NEAR_P99 = 15;
const CELL = 30;

// El camino de los fijos, en trozos repartidos en casillas de CELL m: la distancia de un punto se mira solo en los
// trozos de su casilla y las de alrededor (más lejos que CELL ya no cuenta).
function pathIndex(path: readonly [number, number][]) {
  const cells = new Map<string, number[]>();
  const key = (cx: number, cy: number) => cx + ":" + cy;
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = path[k - 1];
    const [bx, by] = path[k];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / CELL));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      const kk = key(Math.floor(x / CELL), Math.floor(y / CELL));
      const list = cells.get(kk) ?? [];
      if (list[list.length - 1] !== k) list.push(k);
      cells.set(kk, list);
    }
  }
  return (x: number, y: number): number => {
    let best = Infinity;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const k of cells.get(key(cx + i, cy + j)) ?? []) {
          const [ax, ay] = path[k - 1];
          const [bx, by] = path[k];
          const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
          const f =
            L2 > 0
              ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2))
              : 0;
          best = Math.min(best, Math.hypot(x - (ax + f * (bx - ax)), y - (ay + f * (by - ay))));
        }
    return best;
  };
}

// «28.355694, -16.418944» → sus metros locales.
const local = (ll: string) => toLocal(...(ll.split(", ").map(Number) as [number, number]));

describe("dónde está cada curva y cada punto, en las rutas de verdad", () => {
  for (const file of RIDES) {
    const S = realSeries(file);
    it.skipIf(!S)(file + ": todo en la carretera; la tabla y el punto, lo mismo", async () => {
      if (!S || !S.loc) return;
      const eng = await routeOf(S);
      const { lat, lon } = S.loc;
      const path: [number, number][] = [];
      for (let k = 0; k < lat.length; k++)
        if (lat[k] === lat[k] && lon[k] === lon[k]) path.push(toLocal(lat[k], lon[k]));
      const away = pathIndex(path);
      const tr = eng.route.trail;
      const curves = eng.route.curves;
      const spans = curveSpans(tr, curves);
      const d = trailDistances(tr);
      expect(spans.length).toBeGreaterThan(10);
      // Cada curva: su sitio, en su punto más tumbado, en la carretera; y el punto que se mueve, llevado ahí (como
      // con «Curva siguiente»), dice las mismas coordenadas a menos de 1 m de ese punto de la trazada.
      const bad: string[] = [];
      // Cerca de casa: a 300 m o menos de la salida o de la llegada de la trazada (las del mapa).
      const [a, z] = [tr[0], tr[tr.length - 1]];
      // Cerca de las dos (una vuelta), la de su mitad de la ruta (i: su punto de la trazada).
      const home = (x: number, y: number, i: number) => {
        const nearA = Math.hypot(x - a.x, y - a.y) <= 300;
        const nearZ = Math.hypot(x - z.x, y - z.y) <= 300;
        if (nearA && nearZ) return i > (tr.length - 1) / 2 ? "llegada" : "salida";
        return nearA ? "salida" : nearZ ? "llegada" : null;
      };
      let hidden = 0;
      for (const sp of spans) {
        const p = curvePlace(sp, tr);
        const at = scrubText(tr, curves, eng.route.brakes, d, spans, sp.top);
        const zone = home(tr[sp.top].x, tr[sp.top].y, sp.top);
        if (zone) {
          expect(p, "curva " + sp.c.num).toEqual({ near: "Cerca de la " + zone });
          expect([at.place, at.ll, at.url]).toEqual([
            "Curva " + sp.c.num + ", cerca de la " + zone,
            "",
            "",
          ]);
          hidden++;
          continue;
        }
        if (!("ll" in p)) throw new Error("curva " + sp.c.num + " sin coordenadas");
        const [x, y] = local(p.ll);
        if (away(x, y) > NEAR_CURVE)
          bad.push("curva " + sp.c.num + ": " + away(x, y).toFixed(1) + " m");
        expect(at.ll, "curva " + sp.c.num).toBe(p.ll);
        expect(Math.hypot(x - tr[sp.top].x, y - tr[sp.top].y)).toBeLessThan(1);
        expect(p.url).toBe(
          "https://www.google.com/maps/search/?api=1&query=" + p.ll.replace(", ", ","),
        );
      }
      expect(bad, "curvas lejos del camino del GPS").toEqual([]);
      // La tabla: sus 15 (o menos), las de esos mismos puntos.
      const table = curvesTable(curves, tr);
      expect(table.places.every((p) => p !== null)).toBe(true);
      // Cada punto de la trazada: en casa, nada; fuera, en la carretera. Ninguna coordenada que se enseña cae a 300 m
      // o menos de la salida o de la llegada.
      const far: number[] = [];
      for (let i = 0; i < tr.length; i++) {
        const at = scrubText(tr, curves, eng.route.brakes, d, spans, i);
        const zone = home(tr[i].x, tr[i].y, i);
        if (zone) {
          expect([at.ll, at.url], "punto " + i).toEqual(["", ""]);
          expect(at.place).toMatch(new RegExp("^(Curva \\d+, c|C)erca de la " + zone + "$"));
          hidden++;
          continue;
        }
        const [x, y] = local(at.ll);
        expect(home(x, y, i), "punto " + i).toBeNull();
        far.push(away(x, y));
      }
      expect(hidden).toBeGreaterThan(10);
      far.sort((p, q) => q - p);
      expect(far[0], "el punto más lejos del camino del GPS").toBeLessThan(NEAR_POINT);
      expect(far[Math.floor(far.length / 100)], "el 99 % de los puntos").toBeLessThan(NEAR_P99);
    });
  }
});
