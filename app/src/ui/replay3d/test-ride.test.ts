import { describe, expect, it } from "vitest";
import { toLatLon } from "../../core/maspalomas";
import type { LatLon } from "../../core/tramos";
import { RIDE, testRide } from "./test-ride";

// Puntos (lat, lon) de una carretera dibujada en metros locales (x al este, y al sur), uno cada `step` m.
function road(parts: ({ go: number } | { turn: number; r: number })[], step = 5): LatLon[] {
  let x = 0;
  let y = 0;
  let h = 0;
  const out: LatLon[] = [toLatLon(x, y)];
  const move = () => {
    x += step * Math.cos(h);
    y += step * Math.sin(h);
    out.push(toLatLon(x, y));
  };
  for (const p of parts) {
    if ("go" in p) for (let d = 0; d < p.go; d += step) move();
    else {
      const n = Math.max(1, Math.round(((Math.abs(p.turn) * Math.PI) / 180) * (p.r / step)));
      for (let k = 0; k < n; k++) {
        h += (p.turn * Math.PI) / 180 / n;
        move();
      }
    }
  }
  return out;
}

describe("la vuelta de prueba de una carretera (test-ride)", () => {
  it("sin carretera (menos de dos puntos distintos): nada", () => {
    expect(testRide([])).toEqual([]);
    expect(testRide([[28.3, -16.4]])).toEqual([]);
    expect(
      testRide([
        [28.3, -16.4],
        [28.3, -16.4],
      ]),
    ).toEqual([]);
  });

  it("una recta: acelera con suavidad hasta la máxima, derecha, y la hora siempre crece", () => {
    const tr = testRide(road([{ go: 1500 }]));
    expect(tr.length).toBeGreaterThan(450);
    for (let i = 1; i < tr.length; i++) {
      const d = Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
      expect(d).toBeGreaterThan(2.5);
      expect(d).toBeLessThan(3.5);
      expect(tr[i].t).toBeGreaterThan(tr[i - 1].t);
      // Nunca acelera más de lo que deja (con un poco de margen por los 3 m).
      const a = (tr[i].v ** 2 - tr[i - 1].v ** 2) / (2 * d);
      expect(a).toBeLessThan(RIDE.acc + 0.01);
    }
    expect(tr[0].v).toBe(RIDE.vStart);
    expect(tr[0].ph).toBe("gas");
    expect(Math.max(...tr.map((p) => p.v))).toBeCloseTo(RIDE.vMax, 6);
    expect(tr[tr.length - 1].ph).toBe("mantiene");
    for (const p of tr) {
      expect(Math.abs(p.lean)).toBeLessThan(0.5);
      expect(p.gap).toBe(false);
      expect(p.wh).toBe(false);
    }
  });

  it("una horquilla a derechas: frena antes, la toma tumbado a derechas y no pasa de la inclinación máxima", () => {
    const tr = testRide(road([{ go: 600 }, { turn: 180, r: 15 }, { go: 600 }]));
    // Lo más lento pasada la salida (que va a 8 m/s): en la horquilla.
    const vMin = Math.min(...tr.slice(50).map((p) => p.v));
    // En la horquilla, lo que deja la inclinación máxima en 15 m de radio (el suavizado lo abre un poco).
    const vCurve = Math.sqrt(RIDE.g * Math.tan((RIDE.leanMax * Math.PI) / 180) * 15);
    expect(vMin).toBeGreaterThan(vCurve * 0.85);
    expect(vMin).toBeLessThan(vCurve * 1.25);
    const leanMax = Math.max(...tr.map((p) => p.lean));
    expect(leanMax).toBeGreaterThan(RIDE.leanMax - 4);
    expect(leanMax).toBeLessThanOrEqual(RIDE.leanMax + 1e-6);
    expect(Math.min(...tr.map((p) => p.lean))).toBeGreaterThan(-1);
    // Frena antes de la curva (y no más fuerte de lo que deja).
    const k = tr.findIndex((p) => p.ph === "freno");
    expect(k).toBeGreaterThan(0);
    const apex = tr.findIndex((p) => p.v === vMin);
    expect(k).toBeLessThan(apex);
    for (let i = 1; i < tr.length; i++) {
      const d = Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
      expect((tr[i - 1].v ** 2 - tr[i].v ** 2) / (2 * d)).toBeLessThan(RIDE.brake + 0.01);
    }
  });

  it("a izquierdas, tumbado a izquierdas", () => {
    const tr = testRide(road([{ go: 300 }, { turn: -90, r: 40 }, { go: 300 }]));
    expect(Math.min(...tr.map((p) => p.lean))).toBeLessThan(-15);
    expect(Math.max(...tr.map((p) => p.lean))).toBeLessThan(1);
  });

  it("empieza en la salida y acaba en la meta", () => {
    const pts = road([{ go: 200 }, { turn: 60, r: 80 }, { go: 200 }]);
    const tr = testRide(pts);
    const [lat0, lon0] = toLatLon(tr[0].x, tr[0].y);
    const [lat1, lon1] = toLatLon(tr[tr.length - 1].x, tr[tr.length - 1].y);
    expect(lat0).toBeCloseTo(pts[0][0], 6);
    expect(lon0).toBeCloseTo(pts[0][1], 6);
    expect(lat1).toBeCloseTo(pts[pts.length - 1][0], 6);
    expect(lon1).toBeCloseTo(pts[pts.length - 1][1], 6);
  });
});
