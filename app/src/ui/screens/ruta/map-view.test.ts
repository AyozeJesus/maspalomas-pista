// El mapa de la ruta libre: los puntos de la salida marcada y de los tramos (como liveDots de live.js), los botones
// (como los de wire() de antes) y la lista de tramos leída como mucho cada 2 s.
import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../test/legacy";
import { oldMapButtons, type OldMapView } from "../../../../test/legacy-panel";
import { toLocal } from "../../../core/maspalomas";
import { isLatLon, type Tramo } from "../../../core/tramos";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import { TRAMOS_KEY } from "../../../services/tramos-store";
import {
  liveDots,
  newMapView,
  toggleColor,
  toggleFollow,
  tramosCache,
  zoomIn,
  zoomOut,
  type MapView,
} from "./map-view";

const TRAMOS: Tramo[] = [
  { id: "a", nombre: "Gate", salida: [27.771, -15.519], meta: [27.773, -15.522], pasadas: [] },
  {
    id: "b",
    nombre: "Camino",
    pts: Array.from({ length: 12 }, (_, k): [number, number] => [27.77 + k * 1e-4, -15.52]),
    pasadas: [],
  },
  { id: "c", nombre: "Otro", salida: [27.78, -15.51], meta: [27.781, -15.509], pasadas: [] },
];

describe("mapa de la ruta libre", () => {
  it("puntos: la salida marcada y salida y meta de los tramos que las tienen, como antes", () => {
    for (const mark of [null, { t: 3, lat: 27.7712, lon: -15.5233, dist0: 120 }]) {
      const E = { mark } as unknown as Engine;
      const old = liveFunctions<{ liveDots(): unknown }>(["liveDots", "isGateTramo"], {
        globals: {
          E,
          T: { toLocal },
          MaspaTramos: { isLatLon },
          loadTramosCached: () => TRAMOS,
        },
      });
      expect(JSON.stringify(liveDots(E, TRAMOS))).toBe(JSON.stringify(old.liveDots()));
    }
    expect(liveDots({ mark: null } as unknown as Engine, TRAMOS).map((d) => d.label)).toEqual([
      "S",
      "M",
      "S",
      "M",
    ]);
  });

  it("los botones: color, toda o seguir, acercar y alejar (con sus topes)", () => {
    const mine = newMapView();
    const old: OldMapView = { ...mine, miniAt: 0 };
    const ops: [keyof typeof oldMapButtons, (v: MapView) => void][] = [
      ["color", toggleColor],
      ["fit", toggleFollow],
      ["zoomIn", zoomIn],
      ["zoomIn", zoomIn],
      ["zoomIn", zoomIn],
      ["zoomIn", zoomIn],
      ["fit", toggleFollow],
      ["zoomOut", zoomOut],
      ["color", toggleColor],
    ];
    for (let i = 0; i < 12; i++) ops.push(["zoomOut", zoomOut]);
    for (const [k, fn] of ops) {
      mine.drawnAt = 5;
      old.drawnAt = 5;
      fn(mine);
      oldMapButtons[k](old);
      const { miniAt: _miniAt, ...rest } = old;
      expect(mine, k).toEqual(rest);
    }
    expect(mine.span).toBe(8000);
  });

  it("la lista de tramos, leída de nuevo como mucho cada 2 s", () => {
    const kv = memoryKV({ [TRAMOS_KEY]: TRAMOS.slice(0, 1) });
    const list = tramosCache(kv);
    expect(list(1000).map((t) => t.id)).toEqual(["a"]);
    kv.store(TRAMOS_KEY, TRAMOS);
    expect(list(2999).map((t) => t.id)).toEqual(["a"]);
    expect(list(3001).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});
