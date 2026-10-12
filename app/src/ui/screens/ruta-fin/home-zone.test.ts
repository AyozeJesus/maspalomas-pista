// La zona de casa: a 300 m o menos (en línea recta) de la salida o de la llegada de la ruta no se dan coordenadas. Los
// casos de los bordes: sin trazada, un solo punto, ida y vuelta al mismo sitio, pasar cerca de la salida a mitad de
// ruta y justo a 300 m.
import { describe, expect, it } from "vitest";
import { HOME_ZONE_M, homeZone } from "./home-zone";

// Una trazada por esos puntos (metros locales).
const trail = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x, y }));

describe("zona de casa", () => {
  it("300 m, con el límite dentro: a 300 m justos no se dan coordenadas; a 300,5 m, sí", () => {
    expect(HOME_ZONE_M).toBe(300);
    const tr = trail([0, 0], [1000, 0], [2000, 0], [5000, 0]);
    expect(homeZone(tr, { x: 300, y: 0 }, 1)).toBe("salida");
    expect(homeZone(tr, { x: 0, y: -300 }, 1)).toBe("salida");
    expect(homeZone(tr, { x: 300.5, y: 0 }, 1)).toBeNull();
    expect(homeZone(tr, { x: 4700, y: 0 }, 2)).toBe("llegada");
    expect(homeZone(tr, { x: 4699.5, y: 0 }, 2)).toBeNull();
    expect(homeZone(tr, { x: 2000, y: 0 }, 2)).toBeNull();
  });

  it("sin trazada, ninguna zona; con un solo punto, ese punto es la salida", () => {
    expect(homeZone([], { x: 0, y: 0 }, 0)).toBeNull();
    expect(homeZone(trail([10, 10]), { x: 10, y: 10 }, 0)).toBe("salida");
    expect(homeZone(trail([10, 10]), { x: 2000, y: 10 }, 0)).toBeNull();
  });

  it("ida y vuelta al mismo sitio: cerca de los dos, según por dónde vaya de la ruta (la primera mitad, «salida»)", () => {
    const loop = trail([0, 0], [3000, 0], [3000, 3000], [20, 5]);
    expect(homeZone(loop, loop[0], 0)).toBe("salida");
    expect(homeZone(loop, loop[3], 3)).toBe("llegada");
    expect(homeZone(loop, { x: 20, y: 250 }, 1)).toBe("salida");
    expect(homeZone(loop, { x: 20, y: 250 }, 2)).toBe("llegada");
    expect(homeZone(loop, { x: 3000, y: 1500 }, 2)).toBeNull();
  });

  it("pasar cerca de la salida a mitad de ruta también es la zona", () => {
    const tr = trail([0, 0], [2000, 0], [150, 80], [0, 4000]);
    expect(homeZone(tr, tr[2], 2)).toBe("salida");
    expect(homeZone(tr, tr[1], 1)).toBeNull();
  });

  it("una ruta entera dentro de 300 m: todo en la zona (salida la primera mitad, llegada la segunda)", () => {
    const tr = trail([0, 0], [100, 50], [220, 120], [150, 200]);
    expect(tr.map((p, i) => homeZone(tr, p, i))).toEqual([
      "salida",
      "salida",
      "llegada",
      "llegada",
    ]);
  });
});
