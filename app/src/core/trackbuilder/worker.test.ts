import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ride, switchbacks } from "../../../test/fixtures";
import {
  CLUB,
  legacyCircuitWorker,
  realRecordings,
  repeatLaps,
} from "../../../test/fixtures-trackbuilder";

// El worker de antes (circuito-worker.js, que carga trackbuilder.js), tal cual.
const theirs = legacyCircuitWorker();

// El nuevo, con un `self` de mentira que guarda lo que responde.
const posted: unknown[] = [];
const scope: {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: (m: unknown) => void;
} = {
  onmessage: null,
  postMessage: (m) => {
    posted.push(m);
  },
};

function mine(data: unknown): unknown[] {
  const handler = scope.onmessage;
  if (!handler) throw new Error("el worker no ha puesto su onmessage");
  posted.length = 0;
  handler({ data });
  return posted.slice();
}

beforeAll(async () => {
  vi.stubGlobal("self", scope);
  await import("./worker");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Unas posiciones que lanzan `what` al leerlas: lo que responde el worker con algo lanzado que no es un Error.
const throwing = (what: unknown) => ({
  t: {
    get length(): number {
      throw what;
    },
  },
  lat: [],
  lon: [],
});

describe("worker del constructor (los mismos mensajes que circuito-worker.js)", () => {
  it("responde {id, track} con el circuito", () => {
    const fixes = ride(repeatLaps(CLUB, 3), { v: 25, wait: 6, waitEnd: 4, noise: 1 });
    for (const data of [
      { id: 1, fixes, name: "Circuito del 9 oct" },
      { id: 2, fixes },
      { id: 3, fixes, name: "" },
    ]) {
      const got = mine(data);
      expect(got).toEqual(theirs(data));
      expect(got).toHaveLength(1);
      expect(got[0]).toHaveProperty("track");
    }
  });

  it("responde {id, error} con el mensaje para el piloto, o con lo lanzado como texto", () => {
    const cases: unknown[] = [
      { id: 4, fixes: ride(switchbacks()) },
      { id: 5 },
      {},
      null,
      undefined,
      { id: 6, fixes: throwing("boom") },
      { id: 7, fixes: throwing(new Error("")) },
      { id: 8, fixes: throwing(null) },
      { id: 9, fixes: throwing(0) },
      { id: 10, fixes: throwing(new RangeError("fuera de rango")) },
    ];
    for (const data of cases) {
      const got = mine(data);
      expect(got).toEqual(theirs(data));
      expect(got).toHaveLength(1);
      expect(got[0]).toHaveProperty("error");
    }
  });

  describe("con las grabaciones de verdad (PISTA_DATA)", () => {
    const reals = realRecordings();
    if (!reals.length) {
      it.skip("sin PISTA_DATA en este ordenador", () => {});
      return;
    }
    it("la misma respuesta con cada una", () => {
      reals.forEach(({ loc }, k) => {
        const data = { id: 100 + k, fixes: loc, name: "Circuito del 9 oct." };
        expect(mine(data)).toEqual(theirs(data));
      });
    });
  });
});
