// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiStore } from "../app/ui-store";
import { memoryKV } from "../engine/kv";
import { createSession, type SessionHooks } from "./session";
import { createSettings } from "./settings";

// Salir a pista con el GPS de mentira: cuántos seguimientos se abren y se cierran.
function fakeGps() {
  const watches = { opened: [] as number[], cleared: [] as number[] };
  let next = 1;
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      watchPosition: () => {
        const id = next++;
        watches.opened.push(id);
        return id;
      },
      clearWatch: (id: number) => void watches.cleared.push(id),
    },
    permissions: { query: async () => ({ state: "granted" }) },
  });
  return watches;
}

function session() {
  const hooks: SessionHooks = {
    finishRide: () => {},
    showRouteSummary: () => {},
    discard: async () => {},
    extFresh: () => false,
    crashActive: () => false,
    crashStart: () => {},
    buildCircuit: async () => ({ id: 0, track: null }),
    warmCircuit: () => {},
    close3D: () => {},
  };
  return createSession({
    kv: memoryKV(),
    store: null,
    settings: createSettings(memoryKV()),
    hooks,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  uiStore.setState({ screen: "home" });
});

describe("salir a pista", () => {
  it("un doble toque arranca una sola vez (un solo seguimiento del GPS, que se para al terminar)", async () => {
    const watches = fakeGps();
    const s = session();
    await Promise.all([s.startReal(), s.startReal()]);
    expect(watches.opened).toEqual([1]);
    const first = s.rt.E;
    expect(first).not.toBeNull();
    expect(uiStore.getState().screen).toBe("dash");
    // Ya en marcha, otro toque (no debería poder, pero por si acaso) tampoco cambia nada.
    await s.startReal(true);
    expect(s.rt.E).toBe(first);
    expect(watches.opened).toEqual([1]);
    s.stopAll();
    expect(watches.cleared).toEqual([1]);
    expect(s.rt.E).toBeNull();
    expect(uiStore.getState().screen).toBe("home");
  });

  it("después de terminar se puede volver a salir", async () => {
    const watches = fakeGps();
    const s = session();
    await s.startReal(true);
    s.stopAll();
    await s.startReal();
    s.stopAll();
    expect(watches.opened).toEqual([1, 2]);
    expect(watches.cleared).toEqual([1, 2]);
  });
});
