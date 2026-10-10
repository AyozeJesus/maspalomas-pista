import { describe, expect, it } from "vitest";
import { legacy, liveFunctions } from "../../../../../test/legacy";
import type { LatLon, Tramo } from "../../../../core/tramos";
import { fmtLap, shortDate } from "../../../../lib/format";
import { mapsLink, searchToast, tramoEnds, tramoLine } from "./tramo-rows";

// Los enlaces y los extremos de un tramo, como en el live.js de antes.
interface Old {
  mapsLink(a: LatLon, b: LatLon): string;
  tramoEnds(tr: Tramo): [LatLon, LatLon];
}
const old = liveFunctions<Old>(["isGateTramo", "mapsLink", "tramoEnds"], {
  globals: { MaspaTramos: legacy("MaspaTramos", "tramos.js") },
});

const path = (n: number): LatLon[] =>
  Array.from({ length: n }, (_, i) => [27.75 + i * 1e-4, -15.6 + i * 2e-5]);

const GATE: Tramo = {
  id: "g",
  nombre: "Puertas",
  salida: [28.355628, -16.418573],
  meta: [28.374397, -16.427567],
  pasadas: [],
};
const CAMINO: Tramo = { id: "c", nombre: "Camino", largo: 6412, pts: path(20), pasadas: [] };
// Uno de salida y meta que ya aprendió su camino: sus extremos siguen siendo la salida y la meta.
const APRENDIDO: Tramo = { ...GATE, id: "a", largo: 5950, pts: path(30) };

describe("«Tus tramos»: enlaces y extremos", () => {
  it("el enlace de Google Maps, como antes (negativos, muchos decimales, enteros)", () => {
    const pairs: [LatLon, LatLon][] = [
      [GATE.salida as LatLon, GATE.meta as LatLon],
      [
        [-33.123456, 151.5],
        [0.000001, -0.5],
      ],
      [
        [27, -15],
        [27.9234567, -15.5678901],
      ],
    ];
    for (const [a, b] of pairs) expect(mapsLink(a, b)).toBe(old.mapsLink(a, b));
    expect(mapsLink([28.355628, -16.418573], [28.374397, -16.427567])).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=28.355628,-16.418573&destination=28.374397,-16.427567&travelmode=driving",
    );
  });

  it("la salida y la meta: las suyas, o el principio y el final del camino", () => {
    for (const tr of [GATE, CAMINO, APRENDIDO])
      expect(tramoEnds(tr)).toEqual(JSON.parse(JSON.stringify(old.tramoEnds(tr))));
    expect(tramoEnds(CAMINO)).toEqual([path(20)[0], path(20)[19]]);
    expect(tramoEnds(APRENDIDO)).toEqual([GATE.salida, GATE.meta]);
  });
});

describe("«Tus tramos»: la línea de cada uno", () => {
  const pass = (tiempo: number, fecha: string) => ({
    sesion: "s",
    fecha,
    tiempo,
    vMax: 90,
    tiempos: [0, tiempo],
  });

  it("largo, pasadas y la mejor (con su fecha)", () => {
    const fecha = "2026-10-09T15:31:05.000Z";
    const tr: Tramo = {
      ...CAMINO,
      pasadas: [pass(301.27, "2026-10-08T10:00:00.000Z"), pass(292.44, fecha)],
    };
    expect(tramoLine(tr)).toBe(
      "6,4 km · 2 pasadas · mejor " + fmtLap(292.44, 1) + " (" + shortDate(fecha) + ")",
    );
    expect(tramoLine({ ...CAMINO, pasadas: [pass(65, fecha)] })).toMatch(/^6,4 km · 1 pasada · /);
  });

  it("sin camino aún: la distancia en línea recta entre la salida y la meta", () => {
    expect(tramoLine(GATE)).toBe("Salida y meta, 2,3 km en línea recta · 0 pasadas");
  });

  it("un tramo con camino pero sin largo (de una versión vieja) no rompe la lista", () => {
    const viejo: Tramo = { id: "v", nombre: "Viejo", pts: path(20), pasadas: [] };
    expect(tramoLine(viejo)).toMatch(/^Salida y meta, \d+ m en línea recta · 0 pasadas$/);
  });
});

describe("«Buscar»: lo que avisa al acabar", () => {
  it("una, varias o ninguna", () => {
    expect(searchToast(1)).toBe("1 pasada nueva");
    expect(searchToast(3)).toBe("3 pasadas nuevas");
    expect(searchToast(0)).toBe("Ninguna pasada nueva");
  });
});
