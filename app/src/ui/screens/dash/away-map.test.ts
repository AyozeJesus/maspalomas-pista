import { describe, expect, it } from "vitest";
import { MASPA_GEO, toLocal } from "../../../core/maspalomas";
import type { Engine } from "../../../engine";
import { awayMap } from "./away-map";

// Un motor de pista con la posición del recorrido donde se diga (m locales del circuito) o sin ella.
function eng(pos: { x: number; y: number } | null, over: Record<string, unknown> = {}): Engine {
  return {
    track: null,
    sim: false,
    replay: null,
    rideV: 2,
    lag: 0.4,
    route: {
      trail: [{ x: 1, y: 2 }],
      position: () => (pos ? { ...pos, heading: 0.5 } : null),
    },
    ...over,
  } as unknown as Engine;
}

// Un punto a `d` m del eje del circuito, hacia fuera (al norte del punto más al norte del trazado).
function offTrack(d: number): { x: number; y: number } {
  const north = MASPA_GEO.main.reduce((a, p) => (p[1] < a[1] ? p : a));
  return { x: north[0], y: north[1] - d };
}

describe("«Salir a pista» lejos de la pista: tu posición en el mapa", () => {
  it("en la pista (ya encajado en el trazado), la vuelta de ejemplo o con el mapa apagado: nada", () => {
    expect(awayMap(eng(offTrack(10), { track: {} }), 5, true)).toBeNull();
    expect(awayMap(eng(offTrack(10), { sim: true }), 5, true)).toBeNull();
    expect(awayMap(eng(offTrack(10), { replay: {} }), 5, true)).toBeNull();
    expect(awayMap(eng(offTrack(10)), 5, false)).toBeNull();
  });

  it("sin GPS aún: el circuito entero y que se espera al GPS", () => {
    const m = awayMap(eng(null), 5, true);
    expect(m?.label).toBe("Esperando el GPS…");
    expect(m?.options.outline).toBe(MASPA_GEO.main);
    expect(m?.options.follow).toBe(false);
  });

  it("lejos (en Tenerife): tus alrededores, siguiéndote, y a cuánto está el circuito", () => {
    const [x, y] = toLocal(28.4874, -16.3159);
    const m = awayMap(eng({ x, y }), 5, true);
    expect(m?.options.follow).toBe(true);
    expect(m?.options.span).toBe(800);
    expect(m?.options.pos).toMatchObject({ x, y, heading: 0.5 });
    expect(m?.options.trail).toEqual([{ x: 1, y: 2 }]);
    expect(m?.label).toMatch(/^Circuito de Maspalomas a \d+,\d km$/);
    const km = Number(m?.label.replace(/[^\d,]/g, "").replace(",", "."));
    expect(km).toBeGreaterThan(80);
    expect(km).toBeLessThan(120);
  });

  it("cerca: el mapa se abre lo justo para ver también el circuito", () => {
    const m = awayMap(eng(offTrack(500)), 5, true);
    expect(m?.label).toBe("Circuito de Maspalomas a 500 m");
    expect(m?.options.span).toBeGreaterThan(2 * 500);
    expect(m?.options.outline).toBe(MASPA_GEO.main);
  });

  it("en el circuito (boxes, pit lane) pero sin rodar aún por la pista", () => {
    const m = awayMap(eng(offTrack(25)), 5, true);
    expect(m?.label).toBe("En el circuito: los tiempos empiezan al rodar por la pista");
    expect(m?.options.span).toBeGreaterThanOrEqual(700);
  });
});
