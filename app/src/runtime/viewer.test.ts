// Lo que el repaso deja guardado en el resumen de cada grabación (keepResult): lo de siempre y, en las rutas libres,
// sus pasadas por tramos (para la línea de «Mis rutas»); y nada si ya estaba así.
import { describe, expect, it, vi } from "vitest";
import { BUILD } from "../app/version";
import type { Engine } from "../engine";
import type { PistaStore } from "../storage";
import type { Session } from "./session";
import { createViewer } from "./viewer";

function setup() {
  const patchSession = vi.fn((_id: string, _patch: Record<string, unknown>) =>
    Promise.resolve(true),
  );
  const store = { patchSession } as unknown as PistaStore;
  const viewer = createViewer({ rt: { E: null, lastE: null } } as unknown as Session, store);
  return { viewer, patchSession };
}

function route(passes: { id: string; nombre: string; tiempo: number }[]): Engine {
  return {
    free: true,
    ocho: null,
    route: { summary: () => ({ distancia: 6150, duracion: 540 }) },
    tramoPasses: passes.map((p, k) => ({
      id: p.id,
      nombre: p.nombre,
      t0: k * 100,
      t1: k * 100 + p.tiempo,
      lag: 0,
      pasada: { tiempo: p.tiempo, tiempos: [], vMax: 0 },
    })),
  } as unknown as Engine;
}

const META = { v: 1, id: "r1", epoch: 0, tipo: "ruta" } as const;

describe("lo que queda guardado de una ruta repasada", () => {
  it("su resumen, la versión que lo calculó y sus pasadas por tramos, en orden", async () => {
    const { viewer, patchSession } = setup();
    const eng = route([
      { id: "subida:tenerife/barranco-hondo/sur", nombre: "Barranco Hondo (sur)", tiempo: 103.748 },
      {
        id: "subida:tenerife/cuesta-las-tablas/sur",
        nombre: "Cuesta de Las Tablas (sur)",
        tiempo: 64.679,
      },
    ]);
    expect(await viewer.keepResult({ ...META }, eng)).toBe(true);
    expect(patchSession).toHaveBeenCalledWith("r1", {
      recorrido: { distancia: 6150, duracion: 540 },
      calculo: BUILD,
      tramos: [
        {
          id: "subida:tenerife/barranco-hondo/sur",
          nombre: "Barranco Hondo (sur)",
          tiempo: 103.748,
        },
        {
          id: "subida:tenerife/cuesta-las-tablas/sur",
          nombre: "Cuesta de Las Tablas (sur)",
          tiempo: 64.679,
        },
      ],
    });
  });

  it("sin pasadas, la lista vacía (así se borran las de un repaso anterior)", async () => {
    const { viewer, patchSession } = setup();
    await viewer.keepResult({ ...META }, route([]));
    expect(patchSession.mock.calls[0][1]).toMatchObject({ tramos: [] });
  });

  it("ya estaba así (otra vez «Ver»): no se guarda nada", async () => {
    const { viewer, patchSession } = setup();
    const eng = route([{ id: "a", nombre: "A", tiempo: 60 }]);
    const meta = {
      ...META,
      calculo: BUILD,
      recorrido: { distancia: 6150, duracion: 540 },
      tramos: [{ id: "a", nombre: "A", tiempo: 60 }],
    };
    expect(await viewer.keepResult(meta, eng)).toBe(true);
    expect(patchSession).not.toHaveBeenCalled();
    // Pero si las pasadas cambian (un tramo nuevo), sí.
    await viewer.keepResult({ ...meta, tramos: [] }, eng);
    expect(patchSession).toHaveBeenCalledTimes(1);
  });

  it("la vuelta de ejemplo no guarda nada", async () => {
    const { viewer, patchSession } = setup();
    expect(await viewer.keepResult({ ...META, sim: true }, route([]))).toBe(false);
    expect(patchSession).not.toHaveBeenCalled();
  });
});
