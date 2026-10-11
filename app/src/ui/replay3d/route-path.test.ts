import { describe, expect, it } from "vitest";
import { LANE, routePath } from "./route-path";

type P = { x: number; y: number; gap: boolean };

const pt = (x: number, y: number, gap = false): P => ({ x, y, gap });

// Una recta hacia el este (x crece; y hacia el sur), un punto cada 3 m.
function eastLine(len: number, step = 3): P[] {
  const out: P[] = [];
  for (let x = 0; x <= len; x += step) out.push(pt(x, 0));
  return out;
}

// Una curva a derechas de radio r (en el plano con y hacia el sur, el rumbo crece), un punto cada `step` m.
function rightArc(r: number, deg: number, step = 3): P[] {
  const out: P[] = [];
  const n = Math.round(((deg * Math.PI) / 180) * (r / step));
  // Centro al sur del principio: rumbo inicial al este.
  for (let k = 0; k <= n; k++) {
    const a = -Math.PI / 2 + (k / n) * ((deg * Math.PI) / 180);
    out.push(pt(r * Math.cos(a), r + r * Math.sin(a)));
  }
  return out;
}

const len = (v: readonly [number, number]) => Math.hypot(v[0], v[1]);

describe("la carretera 3D de una ruta (route-path)", () => {
  it("menos de dos puntos distintos: no hay carretera", () => {
    expect(routePath([])).toBeNull();
    expect(routePath([pt(5, 5)])).toBeNull();
    expect(routePath([pt(5, 5), pt(5.01, 5), pt(5, 5.02)])).toBeNull();
  });

  it("una recta: la moto por el carril derecho y el eje de la carretera a su izquierda", () => {
    const r = routePath(eastLine(120));
    if (!r) throw new Error("sin carretera");
    const { track, at } = r;
    expect(track.closed).toBe(false);
    const n = track.C.length;
    expect(track.cs.length).toBe(n);
    expect(track.L).toBeCloseTo(120, 6);
    expect(track.cs[n - 1]).toBe(track.L);
    // Rumbo al este: la derecha es el sur (+y); el eje, al norte de la moto.
    for (let k = 0; k < n; k++) {
      expect(track.N[k][0]).toBeCloseTo(0, 9);
      expect(track.N[k][1]).toBeCloseTo(1, 9);
      expect(track.full?.[k][1]).toBeCloseTo(0, 9);
      expect(track.C[k][1]).toBeCloseTo(-LANE, 9);
    }
    // Cada punto de la trazada, a sus metros.
    expect(at.length).toBe(41);
    expect(at[0]).toBe(0);
    expect(at[40]).toBeCloseTo(120, 6);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
  });

  it("puntos repetidos (parado en el mismo sitio) cuentan como uno: mismos metros", () => {
    const tr = [pt(0, 0), pt(3, 0), pt(3, 0), pt(3.01, 0), pt(6, 0), pt(9, 0)];
    const r = routePath(tr);
    if (!r) throw new Error("sin carretera");
    expect(r.track.C.length).toBe(4);
    expect(r.at[1]).toBe(r.at[2]);
    expect(r.at[2]).toBe(r.at[3]);
    expect(r.at[5]).toBeCloseTo(9, 6);
  });

  it("curva a derechas: la derecha mira al centro y la carretera queda por fuera de la moto", () => {
    const R = 30;
    const r = routePath(rightArc(R, 120));
    if (!r) throw new Error("sin carretera");
    const { track } = r;
    const n = track.C.length;
    // Lejos de los extremos (allí el suavizado se acorta), la moto a R del centro (0, R) y el eje a R + carril.
    for (let k = 3; k < n - 3; k++) {
      const b = track.full?.[k] ?? [NaN, NaN];
      const c = track.C[k];
      const N = track.N[k];
      expect(len(N)).toBeCloseTo(1, 9);
      // La normal derecha apunta al centro de la curva.
      const toCenter: [number, number] = [0 - b[0], R - b[1]];
      expect((N[0] * toCenter[0] + N[1] * toCenter[1]) / len(toCenter)).toBeGreaterThan(0.99);
      expect(Math.hypot(b[0], b[1] - R)).toBeCloseTo(R, 0);
      expect(Math.hypot(c[0], c[1] - R)).toBeCloseTo(R + LANE, 0);
    }
  });

  it("una ida y vuelta con media vuelta cerrada: normales sin huecos ni números raros", () => {
    const out = eastLine(60);
    // Media vuelta de radio 5 m hacia el sur y de vuelta al oeste por 5 m más abajo... por el mismo sitio, casi.
    for (let k = 1; k < 6; k++) {
      const a = -Math.PI / 2 + (k / 6) * Math.PI;
      out.push(pt(60 + 5 * Math.cos(a), 5 + 5 * Math.sin(a)));
    }
    for (let x = 60; x >= 0; x -= 3) out.push(pt(x, 10));
    const r = routePath(out);
    if (!r) throw new Error("sin carretera");
    for (const N of r.track.N) {
      expect(Number.isFinite(N[0]) && Number.isFinite(N[1])).toBe(true);
      expect(len(N)).toBeCloseTo(1, 9);
    }
    for (let k = 1; k < r.track.C.length; k++) {
      const a = r.track.N[k - 1];
      const b = r.track.N[k];
      // Nunca da la vuelta de golpe de un punto al siguiente.
      expect(a[0] * b[0] + a[1] * b[1]).toBeGreaterThan(0);
    }
    // A la vuelta, rumbo al oeste: la derecha es el norte (−y).
    const last = r.track.N[r.track.N.length - 2];
    expect(last[1]).toBeCloseTo(-1, 6);
  });

  it("suaviza el temblor del GPS sin mover los extremos", () => {
    const noisy = eastLine(150).map((p, i) => pt(p.x, i % 2 ? 0.8 : -0.8));
    const r = routePath(noisy);
    if (!r) throw new Error("sin carretera");
    const B = r.track.full ?? [];
    for (let k = 2; k < B.length - 2; k++) expect(Math.abs(B[k][1])).toBeLessThan(0.25);
    expect(B[0]).toEqual([0, -0.8]);
    expect(B[B.length - 1]).toEqual([150, -0.8]);
  });

  it("un corte del GPS (gap) no se suaviza por encima: cada lado conserva su sitio", () => {
    const a = eastLine(30);
    const b = eastLine(30).map((p, i) => pt(p.x + 400, 200, i === 0));
    const r = routePath(a.concat(b));
    if (!r) throw new Error("sin carretera");
    const B = r.track.full ?? [];
    // El último antes del corte y el primero después, donde estaban.
    expect(B[10]).toEqual([30, 0]);
    expect(B[11]).toEqual([400, 200]);
    expect(B[12][1]).toBeCloseTo(200, 9);
    // El salto cuenta como camino (la moto lo cruza), y los metros siguen creciendo.
    expect(r.at[11] - r.at[10]).toBeGreaterThan(400);
  });
});
