// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiStore } from "../app/ui-store";
import { createSensorTest } from "./sensor-test";
import type { Session } from "./session";

// La prueba de sensores con el GPS de mentira: cuántos seguimientos se abren y se cierran.
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

function fakeSession(): Session {
  return { rt: { E: null, wakeLock: null }, keepAwake: async () => {} } as unknown as Session;
}

afterEach(() => {
  vi.unstubAllGlobals();
  uiStore.setState({ screen: "home" });
});

describe("prueba de sensores", () => {
  it("un doble toque no abre dos seguimientos del GPS (el segundo no se pararía nunca)", async () => {
    const watches = fakeGps();
    const test = createSensorTest(fakeSession());
    await Promise.all([test.start(), test.start()]);
    await test.start();
    expect(watches.opened).toEqual([1]);
    expect(uiStore.getState().screen).toBe("sensores");
    test.stop();
    expect(watches.cleared).toEqual([1]);
    expect(test.active()).toBe(false);
    expect(uiStore.getState().screen).toBe("home");
  });

  it("parar sin haber empezado no hace nada; y se puede volver a empezar", async () => {
    const watches = fakeGps();
    const test = createSensorTest(fakeSession());
    test.stop();
    expect(watches.cleared).toEqual([]);
    await test.start();
    test.stop();
    await test.start();
    test.stop();
    expect(watches.opened).toEqual([1, 2]);
    expect(watches.cleared).toEqual([1, 2]);
  });
});
