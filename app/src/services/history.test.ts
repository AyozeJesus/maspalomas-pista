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
