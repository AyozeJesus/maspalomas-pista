import { describe, expect, it } from "vitest";
import { ISLAS } from "./subidas";
import { decodePolyline, trazado } from "./subidas-trazados";

// Metros entre dos puntos (lat, lon), a ras de suelo.
function meters(a: readonly [number, number], b: readonly [number, number]): number {
  const k = Math.PI / 180;
  const x = (b[1] - a[1]) * k * Math.cos(((a[0] + b[0]) / 2) * k);
  const y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * 6371000;
}

describe("la carretera de cada subida (para su vuelta de prueba)", () => {
  it("decodifica las polilíneas de Google (el ejemplo de su documentación)", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(decodePolyline("")).toEqual([]);
    // Cortada a medias: lo que se ha leído entero.
    expect(decodePolyline("_p~iF~ps|U_ulL")).toEqual([[38.5, -120.2]]);
  });

  for (const isla of ISLAS)
    for (const s of isla.subidas)
      it(`${isla.nombre}, ${s.nombre}: de su salida a su meta, sin saltos`, () => {
        const pts = trazado(s.id);
        if (!pts) throw new Error("sin trazado");
        expect(pts.length).toBeGreaterThan(40);
        expect(meters(pts[0], s.salida)).toBeLessThan(25);
        expect(meters(pts[pts.length - 1], s.meta)).toBeLessThan(25);
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
          const d = meters(pts[i - 1], pts[i]);
          // Las rectas largas van de un tirón (llegando a El Portillo, una de 774 m).
          expect(d).toBeLessThan(1000);
          len += d;
        }
        // Una carretera de montaña: más larga que la recta, pero sin vueltas de más.
        const straight = meters(s.salida, s.meta);
        expect(len / straight).toBeGreaterThan(1);
        expect(len / straight).toBeLessThan(4);
      });

  it("una subida que no está: null", () => {
    expect(trazado("no-existe")).toBeNull();
  });
});
