import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../test/legacy";
import { sessionDate, sessionLine, type ListedSession } from "./history";

// La fecha y la línea de cada grabación en «Mis rutas», como las escribía el live.js de antes.
interface Old {
  sessionDate(s: ListedSession): string;
  sessionLine(s: ListedSession): string;
}
const old = liveFunctions<Old>(["fmt", "fmtLap", "fmtClock", "sessionDate", "sessionLine"], {
  consts: ["NF"],
});

const base = { id: "20261009-163105-bn2o", inicio: "2026-10-09T15:31:05.000Z" };
const CASES: ListedSession[] = [
  {
    ...base,
    tipo: "ruta",
    fin: "2026-10-09T16:43:10.000Z",
    recorrido: { distancia: 23456, duracion: 4325 },
  },
  { ...base, tipo: "ruta", fin: "2026-10-09T16:43:10.000Z", recorrido: { distancia: 812 } },
  { ...base, tipo: "ruta", recorrido: null },
  {
    ...base,
    tipo: "ruta",
    recorrido: { distancia: 5600, duracion: 600 },
    circuito: { nombre: "Maspalomas (prueba)", mejor: 65.426 },
  },
  { ...base, tipo: "ruta", recorrido: { distancia: NaN, duracion: 0 }, estado: "cortada" },
  {
    ...base,
    tipo: "pista",
    fin: "2026-10-09T15:55:00.000Z",
    vueltas: [{ valid: true }, { valid: false }, { valid: true }],
    mejor: 66.1,
  },
  { ...base, tipo: "pista", vueltas: [{ valid: true }] },
  { ...base, tipo: "pista", fin: "no es fecha" },
  { id: "x", epoch: 1760000000000 },
  { id: "y" },
];

describe("línea de un entrenamiento en 8", () => {
  it("cuántos ochos, el mejor y el tiempo", () => {
    const s: ListedSession = {
      ...base,
      tipo: "ruta",
      modo: "ocho",
      recorrido: { distancia: 3200, duracion: 920 },
      ochos: { n: 12, mejor: 7.416 },
    };
    expect(sessionLine(s)).toBe("Entrenamiento en 8 · 12 ochos · mejor 7,42 s · 15:20");
    expect(sessionLine({ ...s, ochos: { n: 1, mejor: 9 } })).toBe(
      "Entrenamiento en 8 · 1 ocho · mejor 9,00 s · 15:20",
    );
    expect(sessionLine({ ...s, ochos: null })).toBe("Entrenamiento en 8 · 0 ochos · 15:20");
  });
});

describe("línea de una ruta que pasó por tramos (subidas o los tuyos)", () => {
  const s: ListedSession = {
    ...base,
    tipo: "ruta",
    recorrido: { distancia: 6150, duracion: 540 },
  };
  it("cada tramo con su tiempo, en el orden en que se pasó, tras lo de siempre", () => {
    expect(
      sessionLine({
        ...s,
        tramos: [
          { id: "a", nombre: "Barranco Hondo (sur)", tiempo: 103.748 },
          { id: "b", nombre: "Cuesta de Las Tablas (sur)", tiempo: 64.679 },
        ],
      }),
    ).toBe(
      "Ruta libre · 6,2 km · 9:00 · Barranco Hondo (sur) 1:43,7 · Cuesta de Las Tablas (sur) 1:04,7",
    );
  });
  it("con muchos, los tres primeros y cuántos más; sin ninguno, como siempre", () => {
    const tramos = ["A", "B", "C", "D", "E"].map((n, k) => ({ id: n, nombre: n, tiempo: 60 + k }));
    expect(sessionLine({ ...s, tramos })).toBe(
      "Ruta libre · 6,2 km · 9:00 · A 1:00,0 · B 1:01,0 · C 1:02,0 · y 2 tramos más",
    );
    expect(sessionLine({ ...s, tramos: [] })).toBe("Ruta libre · 6,2 km · 9:00");
    expect(sessionLine({ ...s, tramos: null })).toBe("Ruta libre · 6,2 km · 9:00");
  });
});

describe("línea de cada grabación en «Mis rutas»", () => {
  it("la fecha, como antes", () => {
    expect(CASES.map(sessionDate)).toEqual(CASES.map(old.sessionDate));
  });
  it("lo esencial, como antes", () => {
    const mine = CASES.map(sessionLine);
    expect(mine).toEqual(CASES.map(old.sessionLine));
    expect(mine[0]).toBe("Ruta libre · 23,5 km · 1:12:05");
    expect(mine[5]).toBe("Circuito · 2 vueltas · mejor 1:06,10 · 23:55");
  });
});
