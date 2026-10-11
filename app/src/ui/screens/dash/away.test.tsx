// @vitest-environment jsdom
// «Salir a pista» lejos de la pista, con el motor de verdad: en vez del panel vacío, el mapa con tu posición y a cuánto
// está el circuito; con el mapa apagado en Ajustes, como antes.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testHost } from "../../../../test/fixtures-ruta-fin";
import { createEngine, onFix, type Engine } from "../../../engine";
import { DEFAULT_SETTINGS, type Settings } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { mapa, type MapDrawOptions } from "../../draw/mapa";
import { RuntimeContext } from "../../runtime-context";
import { Dash } from "./Dash";
import { createDashPainter } from "./dash-painter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(E: Engine, settings: Settings) {
  const rt = {
    session: { rt: { E, sim: { speed: 1 } }, enterPits: () => {}, stopAll: () => {} },
    settings: { get: () => settings },
    ext: { hzText: () => "" },
    view3d: { close: null, view: null },
    kv: E.host.kv,
  } as unknown as Runtime;
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <Dash />
    </RuntimeContext.Provider>,
  );
  const root = view.container.querySelector<HTMLElement>("#dash") as HTMLElement;
  return { root, painter: createDashPainter(root, rt) };
}

// Un motor de pista (de verdad, no la vuelta de ejemplo) con unos fijos en La Laguna, andando hacia el norte.
function farEngine(): Engine {
  const E = createEngine(testHost(), false);
  E.t0 = -6;
  for (let i = 1; i <= 5; i++) onFix(E, i, 28.4874 + i * 0.00005, -16.3159, 5.5, 5);
  return E;
}

describe("panel de pista lejos de la pista", () => {
  it("el mapa con tu posición (siguiéndote) y a cuánto está el circuito, con el delta encima, pequeño", () => {
    const draws: MapDrawOptions[] = [];
    vi.spyOn(mapa, "draw").mockImplementation((_cv, o) => {
      draws.push(o);
      return undefined;
    });
    const E = farEngine();
    const { root, painter } = mount(E, { ...DEFAULT_SETTINGS });
    painter.paint();
    expect(E.track).toBeNull();
    const away = root.querySelector<HTMLElement>("#d-away");
    expect(away?.hidden).toBe(false);
    expect(root.querySelector("#d-away-l")?.textContent).toMatch(
      /^Circuito de Maspalomas a \d+,\d km$/,
    );
    expect(root.classList.contains("away")).toBe(true);
    const last = draws[draws.length - 1];
    expect(last.follow).toBe(true);
    expect(last.span).toBe(800);
    expect(last.pos).toBeTruthy();
    // El mapa pequeño del circuito, sin trazado aún, sigue oculto.
    expect(root.querySelector<HTMLElement>("#d-map")?.hidden).toBe(true);
  });

  it("con el mapa apagado en Ajustes, el panel de siempre", () => {
    const E = farEngine();
    const { root, painter } = mount(E, { ...DEFAULT_SETTINGS, mapa: false });
    painter.paint();
    expect(root.querySelector<HTMLElement>("#d-away")?.hidden).toBe(true);
    expect(root.classList.contains("away")).toBe(false);
  });
});
