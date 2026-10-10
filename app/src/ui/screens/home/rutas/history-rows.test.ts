import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../../test/legacy";
import { BUILD } from "../../../../app/version";
import type { ListedSession } from "../../../../services/history";
import type { StoredSession } from "../../../../storage";
import { deleteArmedLabel, historyRow, savedSessions, staleRoutes } from "./history-rows";

// La fecha y la línea de cada grabación, como las juntaba renderHistory en el live.js de antes.
const old = liveFunctions<{
  sessionDate(s: ListedSession): string;
  sessionLine(s: ListedSession): string;
}>(["fmt", "fmtLap", "fmtClock", "sessionDate", "sessionLine"], { consts: ["NF"] });

const base = { inicio: "2026-10-09T15:31:05.000Z", fin: "2026-10-09T16:43:10.000Z" };
const SESSIONS: StoredSession[] = [
  {
    id: "20261009-163105-bn2o",
    ...base,
    tipo: "ruta",
    nombre: "Los Loros",
    recorrido: { distancia: 23456, duracion: 4325 },
    pend: 1,
  },
  { id: "20261009-150000-sim0", ...base, tipo: "pista", sim: true },
  { id: "20261009-140000-grab", ...base, tipo: "ruta", estado: "grabando" },
  {
    id: "20261008-120000-pist",
    ...base,
    tipo: "pista",
    estado: "terminada",
    vueltas: [{ valid: true }, { valid: true }],
    mejor: 66.1,
  },
  { id: "20261007-120000-cort", epoch: 1760000000000, tipo: "ruta", estado: "cortada" },
];

describe("«Rutas y tandas»: qué sale en la lista", () => {
  it("sin la vuelta de ejemplo ni la que se está grabando, en el mismo orden", async () => {
    const list = await savedSessions({ sessions: async () => SESSIONS });
    expect(list.map((s) => s.id)).toEqual([
      "20261009-163105-bn2o",
      "20261008-120000-pist",
      "20261007-120000-cort",
    ]);
  });

  it("sin almacén, o si el navegador no deja leerlo: ninguna", async () => {
    expect(await savedSessions(null)).toEqual([]);
    expect(
      await savedSessions({
        sessions: () => Promise.reject(new Error("sin IndexedDB")),
      }),
    ).toEqual([]);
  });

  it("cada fila: el nombre arriba y la fecha con la línea abajo; sin nombre, la fecha arriba", async () => {
    const list = await savedSessions({ sessions: async () => SESSIONS });
    for (const s of list) {
      const want = {
        title: s.nombre || old.sessionDate(s),
        line: (s.nombre ? old.sessionDate(s) + " · " : "") + old.sessionLine(s),
      };
      expect(historyRow(s)).toEqual(want);
    }
    expect(historyRow(list[0]).title).toBe("Los Loros");
    expect(historyRow(list[0]).line).toMatch(/ · Ruta libre · 23,5 km · 1:12:05$/);
    expect(historyRow(list[2]).line).toBe("Ruta libre · cortada");
  });

  it("las rutas por poner al día: las de otra versión o sin repasar (las tandas no)", async () => {
    const list = await savedSessions({ sessions: async () => SESSIONS });
    expect(staleRoutes(list)).toBe("20261009-163105-bn2o 20261007-120000-cort");
    const done = list.map((s) => (s.tipo === "ruta" ? { ...s, calculo: BUILD } : s));
    expect(staleRoutes(done)).toBe("");
    expect(staleRoutes([{ ...list[0], calculo: BUILD - 1 }])).toBe("20261009-163105-bn2o");
  });

  it("«Borrar»: sin subir al Mac emparejado, lo avisa", () => {
    const [pend, , , done] = SESSIONS as ListedSession[];
    expect(deleteArmedLabel(pend, true)).toBe("¿Sin subir? Otra vez");
    expect(deleteArmedLabel(pend, false)).toBe("¿Seguro? Otra vez");
    expect(deleteArmedLabel(done, true)).toBe("¿Seguro? Otra vez");
  });
});
