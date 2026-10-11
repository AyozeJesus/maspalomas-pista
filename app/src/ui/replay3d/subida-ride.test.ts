import { describe, expect, it, vi } from "vitest";
import { toLatLon } from "../../core/maspalomas";
import type { LatLon } from "../../core/tramos";
import { subidaRide } from "./subida-ride";

// Una carretera recta de len m hacia el este desde (x0, 0), un punto cada 10 m (como el camino aprendido).
function line(x0: number, len: number): LatLon[] {
  const out: LatLon[] = [];
  for (let d = 0; d <= len; d += 10) out.push(toLatLon(x0 + d, 0));
  return out;
}

const osm = (pts: LatLon[] | null) => vi.fn(async () => ({ trazado: () => pts }));

describe("la vuelta de prueba de una subida (subida-ride)", () => {
  it("con camino aprendido en este sentido: por él, sin cargar OpenStreetMap", async () => {
    const load = osm(line(0, 3000));
    const r = await subidaRide({ subida: "los-loros" }, 0, { pts: line(0, 800) }, undefined, load);
    expect(r?.fuente).toBe("rodado");
    expect(r?.source.track.L).toBeCloseTo(800, -1);
    expect(load).not.toHaveBeenCalled();
  });

  it("con el camino del otro sentido: el mismo, al revés", async () => {
    const r = await subidaRide(
      { subida: "los-loros" },
      1,
      undefined,
      { pts: line(0, 600) },
      osm(null),
    );
    expect(r?.fuente).toBe("rodado");
    // Empieza donde acababa el otro (al este) y va hacia el oeste.
    const first = r?.source.frame(r.source.start);
    const later = r?.source.frame(r.source.start + 10);
    expect(first?.pose.s).toBe(0);
    expect((later?.pose.s ?? 0) > 0).toBe(true);
    const C = r?.source.track.full ?? [];
    expect(C[0][0]).toBeGreaterThan(C[C.length - 1][0]);
  });

  it("sin camino aprendido (o con uno corto): la carretera de OpenStreetMap, al revés en el otro sentido", async () => {
    const pts = line(0, 1500);
    const a = await subidaRide({ subida: "araya" }, 0, { pts: line(0, 50) }, undefined, osm(pts));
    expect(a?.fuente).toBe("osm");
    const ca = a?.source.track.full ?? [];
    expect(ca[0][0]).toBeLessThan(ca[ca.length - 1][0]);
    const b = await subidaRide({ subida: "araya" }, 1, undefined, undefined, osm(pts));
    const cb = b?.source.track.full ?? [];
    expect(cb[0][0]).toBeGreaterThan(cb[cb.length - 1][0]);
    // Sin tocar la del módulo (al revés sobre una copia).
    expect(pts[0][1]).toBeLessThan(pts[pts.length - 1][1]);
  });

  it("una subida sin carretera: nada", async () => {
    expect(
      await subidaRide({ subida: "no-existe" }, 0, undefined, undefined, osm(null)),
    ).toBeNull();
  });

  it("con la carretera de verdad del catálogo (Los Loros, los dos sentidos)", async () => {
    for (const k of [0, 1] as const) {
      const r = await subidaRide({ subida: "los-loros" }, k, undefined, undefined);
      if (!r) throw new Error("sin vuelta de prueba");
      expect(r.fuente).toBe("osm");
      expect(r.source.track.L).toBeGreaterThan(5500);
      // A unos 50 km/h de media por sus curvas, sin pasar de 90 ni de 35°.
      const avg = (r.source.track.L / (r.source.end - r.source.start)) * 3.6;
      expect(avg).toBeGreaterThan(35);
      expect(avg).toBeLessThan(75);
      for (let t = r.source.start; t <= r.source.end; t += 2) {
        const f = r.source.frame(t);
        expect((f.pose.v ?? 0) * 3.6).toBeLessThanOrEqual(90 + 1e-6);
        expect(Math.abs(f.pose.lean)).toBeLessThanOrEqual(35 + 1e-6);
      }
    }
  });
});
