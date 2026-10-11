// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiStore } from "../app/ui-store";
import type { OchoTracker } from "../core/ocho";
import { memoryKV } from "../engine/kv";
import type { Engine } from "../engine/state";
import { createSession, type SessionHooks } from "./session";
import { createSettings } from "./settings";

// Salir a pista con el GPS de mentira: cuántos seguimientos se abren y se cierran, y un fijo a la velocidad que se
// quiera (m/s) para el seguimiento abierto.
function fakeGps() {
  let onPos: PositionCallback | null = null;
  const watches = {
    opened: [] as number[],
    cleared: [] as number[],
    fix(speed: number) {
      if (!onPos) return;
      onPos({
        timestamp: Date.now(),
        coords: { latitude: 27.75, longitude: -15.57, speed, accuracy: 4 },
      } as GeolocationPosition);
    },
  };
  let next = 1;
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: {
      watchPosition: (cb: PositionCallback) => {
        onPos = cb;
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

// Sin almacén no se crea la grabación: se le pone una de mentira (la que se borraría al terminar).
function recording(E: Engine | null, id: string): Engine {
  const eng = E as Engine;
  eng.rec = {
    id,
    epoch: 0,
    seq: 0,
    idx: { loc: 0, acc: 0, gyro: 0, grav: 0, canal: 0 },
    lastT: 0,
    saved: 0,
    failed: false,
    queue: Promise.resolve(),
  };
  return eng;
}

function session(over: Partial<SessionHooks> = {}) {
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
    ...over,
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

describe("terminar sin haberse movido", () => {
  function discards() {
    const gone: string[] = [];
    const s = session({
      discard: async (eng) => void gone.push(eng.rec ? eng.rec.id : "?"),
    });
    return { s, gone };
  }

  it("una ruta sin moverse no se guarda; unos ochos lentos sí (el recorrido solo suma desde 3 m/s)", async () => {
    fakeGps();
    const { s, gone } = discards();
    await s.startReal(true);
    recording(s.rt.E, "parado");
    s.stopAll();
    expect(gone).toEqual(["parado"]);

    await s.startReal(true, { ocho: true });
    const E = recording(s.rt.E, "ochos-lentos");
    // 30 s a 2 m/s (60 m) sin llegar a contar ningún 8.
    const tr = E.ocho as OchoTracker;
    for (let i = 0; i <= 1800; i++) tr.step(i / 60, 0, 0, 2);
    expect(E.route.stats.dist).toBe(0);
    s.stopAll();
    expect(gone).toEqual(["parado"]);
  });

  it("en el entrenamiento en 8 basta un 8 (aunque no llegue a 50 m); tocado sin querer, no se guarda", async () => {
    fakeGps();
    const { s, gone } = discards();
    await s.startReal(true, { ocho: true });
    const E = recording(s.rt.E, "un-ocho");
    const tr = E.ocho as OchoTracker;
    // Un 8 muy cerrado (2,5 m de radio a 2 m/s, unos 29 m) y parado.
    let t = 0;
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 400; i++) tr.step((t += 1 / 60), dir * 0.8, dir * 20, 2);
      for (let i = 0; i < 30; i++) tr.step((t += 1 / 60), 0, 0, 2);
    }
    for (let i = 0; i < 120; i++) tr.step((t += 1 / 60), 0, 0, 0);
    expect(tr.ochos.length).toBe(1);
    expect(tr.dist).toBeLessThan(50);
    s.stopAll();
    expect(gone).toEqual([]);

    await s.startReal(true, { ocho: true });
    recording(s.rt.E, "sin-querer");
    s.stopAll();
    expect(gone).toEqual(["sin-querer"]);
  });
});

describe("pantalla fija al echar a rodar", () => {
  it("en una ruta, desde 4 m/s; en el entrenamiento en 8, ya desde 2 m/s (los ochos lentos no llegan a 4)", async () => {
    const gps = fakeGps();
    const s = session();
    await s.startReal(true);
    gps.fix(3);
    expect(s.rt.E && s.rt.E.orientTried).toBe(false);
    gps.fix(4.5);
    expect(s.rt.E && s.rt.E.orientTried).toBe(true);
    s.stopAll();

    await s.startReal(true, { ocho: true });
    gps.fix(1.5);
    expect(s.rt.E && s.rt.E.orientTried).toBe(false);
    gps.fix(2.5);
    expect(s.rt.E && s.rt.E.orientTried).toBe(true);
    s.stopAll();
  });
});
