// «Salida aquí» / «Meta aquí»: un toque pone la salida; con ella puesta, dos toques (en 4 s) ponen la meta o, sin
// haberse movido aún, la quitan. Los textos de antes; lo que hace el motor al marcar (markSalida, markMetaKind,
// markMeta) se prueba con el motor y en tmeta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../../../engine";
import { newMarkArm, tapMark } from "./mark";

const next = vi.hoisted(() => ({ kind: "quitar" as "quitar" | "meta" | null }));

vi.mock("../../../engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../engine")>();
  return {
    ...real,
    markSalida: vi.fn((E: Engine) => {
      E.mark = { t: 1, lat: 27.77, lon: -15.52, dist0: 0 };
    }),
    markMetaKind: vi.fn(() => next.kind),
    markMeta: vi.fn((E: Engine) => {
      E.mark = null;
    }),
  };
});

const engine = await import("../../../engine");

function eng(over: Record<string, unknown> = {}): Engine {
  return { rec: { id: "x" }, sim: false, circ: null, mark: null, ...over } as unknown as Engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  next.kind = "quitar";
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("«Salida aquí» y «Meta aquí»", () => {
  it("solo grabando de verdad y sin circuito", () => {
    const toast = vi.fn();
    for (const E of [null, eng({ rec: null }), eng({ sim: true }), eng({ circ: {} })])
      expect(tapMark(E, newMarkArm(), toast)).toBeNull();
    expect(engine.markSalida).not.toHaveBeenCalled();
  });

  it("sin salida: un toque la pone", () => {
    const E = eng();
    expect(tapMark(E, newMarkArm(), vi.fn())).toBeNull();
    expect(engine.markSalida).toHaveBeenCalledTimes(1);
    expect(E.mark).not.toBeNull();
  });

  it("sin moverse de la salida: dos toques la quitan", () => {
    const E = eng({ mark: { t: 1, lat: 0, lon: 0, dist0: 0 } });
    const arm = newMarkArm();
    const toast = vi.fn();
    expect(tapMark(E, arm, toast)).toBe("¿Quitar la salida? Otra vez");
    expect(arm.kind).toBe("quitar");
    expect(tapMark(E, arm, toast)).toBeNull();
    expect(E.mark).toBeNull();
    expect(toast).toHaveBeenCalledWith("Salida quitada");
    expect(arm.kind).toBeNull();
  });

  it("lejos de la salida: dos toques ponen la meta", () => {
    next.kind = "meta";
    const E = eng({ mark: { t: 1, lat: 0, lon: 0, dist0: 0 } });
    const arm = newMarkArm();
    expect(tapMark(E, arm, vi.fn())).toBe("¿Meta aquí? Otra vez");
    expect(engine.markMeta).not.toHaveBeenCalled();
    expect(tapMark(E, arm, vi.fn())).toBeNull();
    expect(engine.markMeta).toHaveBeenCalledTimes(1);
  });

  it("el segundo toque vale 4 s; si cambia lo que haría, vuelve a pedirlo", () => {
    const E = eng({ mark: { t: 1, lat: 0, lon: 0, dist0: 0 } });
    const arm = newMarkArm();
    expect(tapMark(E, arm, vi.fn())).toBe("¿Quitar la salida? Otra vez");
    vi.advanceTimersByTime(4000);
    expect(arm.kind).toBeNull();
    expect(tapMark(E, arm, vi.fn())).toBe("¿Quitar la salida? Otra vez");
    next.kind = "meta";
    expect(tapMark(E, arm, vi.fn())).toBe("¿Meta aquí? Otra vez");
    expect(E.mark).not.toBeNull();
    // Sin GPS reciente (el motor avisa): nada.
    next.kind = null;
    expect(tapMark(E, newMarkArm(), vi.fn())).toBeNull();
  });
});
