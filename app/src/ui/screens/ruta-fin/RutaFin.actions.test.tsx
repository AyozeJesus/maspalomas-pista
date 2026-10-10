// @vitest-environment jsdom
// Lo que se hace desde el resumen de la ruta: volver, compartir y exportar, el nombre, guardar como tramo (o ida y
// vuelta), guardar el circuito y cortar en dos (dos toques, 4 s para el segundo), con los avisos de siempre.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoSeries, EPOCH, lorosSeries, routeOf } from "../../../../test/fixtures-ruta-fin";
import { fakeCanvases } from "../../../../test/legacy-ruta-fin";
import { refreshSummary, show, uiStore } from "../../../app/ui-store";
import type { CircuitTrack, LapTimer } from "../../../core/circuito";
import type { MergedSeriesSet } from "../../../core/formato";
import type { Engine, ReplayMeta } from "../../../engine";
import { CIRCUITS_KEY } from "../../../engine";
import { memoryKV, type KeyValueStore } from "../../../engine/kv";
import { DEFAULT_SETTINGS, type Settings } from "../../../engine/settings";
import type { Runtime } from "../../../runtime";
import { CutError, cutSaved } from "../../../services/cut";
import { exportSession } from "../../../services/export";
import { shareImage } from "../../../services/share";
import { TRAMOS_KEY } from "../../../services/tramos-store";
import type { SessionMeta } from "../../../storage";
import { RuntimeContext } from "../../runtime-context";
import { RutaFin } from "./RutaFin";

vi.mock("../../../services/cut", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/cut")>()),
  cutSaved: vi.fn(),
}));
vi.mock("../../../services/share", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/share")>()),
  shareImage: vi.fn(),
}));
vi.mock("../../../services/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/export")>()),
  exportSession: vi.fn(() => Promise.resolve(true)),
}));

let demoCache: MergedSeriesSet | null = null;
function demo(): MergedSeriesSet {
  if (!demoCache) demoCache = demoSeries();
  return demoCache;
}

beforeEach(() => {
  fakeCanvases(window);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  uiStore.setState({ screen: "home", summaryVersion: 0, homeVersion: 0, toast: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

interface Bench {
  eng: Engine;
  kv: KeyValueStore;
  patch: ReturnType<typeof vi.fn>;
  goHome: ReturnType<typeof vi.fn>;
  root: HTMLElement;
  // La sesión de mentira (lastE: la ruta del resumen).
  rt: { E: Engine | null; lastE: Engine | null };
}

async function bench(
  o: {
    series?: MergedSeriesSet;
    meta?: Partial<ReplayMeta>;
    settings?: Partial<Settings>;
    prepare?: (eng: Engine) => void;
    patch?: () => Promise<boolean>;
  } = {},
): Promise<Bench> {
  const kv = memoryKV();
  const eng = await routeOf(o.series ?? demo(), o.meta, kv);
  o.prepare?.(eng);
  const patch = vi.fn(o.patch ?? (() => Promise.resolve(true)));
  const goHome = vi.fn();
  const settings: Settings = { ...DEFAULT_SETTINGS, ...o.settings };
  const rt: Bench["rt"] = { E: null, lastE: eng };
  const runtime = {
    kv,
    store: { patchSession: patch },
    settings: { get: () => settings },
    session: { rt },
    nav: { goHome },
  } as unknown as Runtime;
  const { container } = render(
    <RuntimeContext.Provider value={runtime}>
      <RutaFin />
    </RuntimeContext.Provider>,
  );
  const root = container.querySelector<HTMLElement>("#ruta-fin");
  if (!root) throw new Error("sin #ruta-fin");
  act(() => {
    show("ruta-fin");
    refreshSummary();
  });
  return { eng, kv, patch, goHome, root, rt };
}

function byId<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T {
  const el = root.querySelector<T>("#" + id);
  if (!el) throw new Error("sin #" + id);
  return el;
}

const text = (root: ParentNode, id: string) => byId(root, id).textContent;
const toastText = () => uiStore.getState().toast?.text ?? "";
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe("resumen de la ruta: botones", () => {
  it("«Volver» (arriba y abajo) va a la portada", async () => {
    const b = await bench();
    fireEvent.click(byId(b.root, "ruf-back"));
    fireEvent.click(byId(b.root, "ruf-home"));
    expect(b.goHome).toHaveBeenCalledTimes(2);
  });

  it("«Compartir»: la imagen con el color del mapa, el botón quieto mientras, y los avisos", async () => {
    const b = await bench({ settings: { piloto: "Ayoze" } });
    let done: (r: string) => void = () => {};
    vi.mocked(shareImage).mockImplementationOnce(
      () => new Promise((r) => (done = r as (x: string) => void)),
    );
    fireEvent.click(byId(b.root, "ruf-color"));
    fireEvent.click(byId(b.root, "ruf-share"));
    expect(shareImage).toHaveBeenCalledWith("ruta", b.eng, {
      colorBy: "incl",
      settings: expect.objectContaining({ piloto: "Ayoze" }),
    });
    expect(byId<HTMLButtonElement>(b.root, "ruf-share").disabled).toBe(true);
    // Mientras se hace, otro toque no hace otra.
    fireEvent.click(byId(b.root, "ruf-share"));
    expect(shareImage).toHaveBeenCalledTimes(1);
    await act(async () => done("descargada"));
    expect(byId<HTMLButtonElement>(b.root, "ruf-share").disabled).toBe(false);
    expect(toastText()).toBe("Imagen guardada en Descargas");
    vi.mocked(shareImage).mockRejectedValueOnce(new Error("sin canvas"));
    fireEvent.click(byId(b.root, "ruf-share2"));
    await settle();
    expect(toastText()).toBe("No se ha podido hacer la imagen");
  });

  it("«Exportar la ruta (.zip)»", async () => {
    const b = await bench();
    fireEvent.click(byId(b.root, "ruf-export"));
    expect(exportSession).toHaveBeenCalledWith(b.eng);
  });
});

describe("resumen de la ruta: el nombre", () => {
  it("se guarda al acabar de escribirlo y lo lleva el título", async () => {
    const b = await bench();
    const input = byId<HTMLInputElement>(b.root, "ruf-nombre");
    expect(input.dataset.sid).toBe("20261009-172312-test");
    fireEvent.input(input, { target: { value: "  Los Loros  " } });
    // Escribiendo no se guarda nada.
    expect(b.patch).not.toHaveBeenCalled();
    fireEvent.change(input);
    await settle();
    expect(b.patch).toHaveBeenCalledWith("20261009-172312-test", { nombre: "Los Loros" });
    expect(b.eng.nombre).toBe("Los Loros");
    expect(text(b.root, "ruf-title")).toBe("Los Loros");
    expect(toastText()).toBe("Nombre guardado");
    expect(uiStore.getState().homeVersion).toBeGreaterThan(0);
    input.value = "";
    fireEvent.change(input);
    await settle();
    expect(b.patch).toHaveBeenLastCalledWith("20261009-172312-test", { nombre: undefined });
    expect(text(b.root, "ruf-title")).toBe("Tu ruta");
    expect(toastText()).toBe("Nombre quitado");
  });

  it("si no se puede guardar, lo dice (y si no está, nada)", async () => {
    const b = await bench({ patch: () => Promise.reject(new Error("IndexedDB")) });
    const input = byId<HTMLInputElement>(b.root, "ruf-nombre");
    input.value = "Otra";
    fireEvent.change(input);
    await settle();
    expect(toastText()).toBe("No se ha podido guardar el nombre");
    expect(text(b.root, "ruf-title")).toBe("Tu ruta");
    const c = await bench({ patch: () => Promise.resolve(false) });
    act(() => uiStore.setState({ toast: null }));
    const other = c.root.querySelector<HTMLInputElement>("#ruf-nombre");
    if (!other) throw new Error("sin campo");
    other.value = "Nada";
    fireEvent.change(other);
    await settle();
    expect(toastText()).toBe("");
  });

  it("el nombre guardado sale en el campo y en el título", async () => {
    const b = await bench({ meta: { nombre: "Subida a Ayacata" } });
    expect(byId<HTMLInputElement>(b.root, "ruf-nombre").value).toBe("Subida a Ayacata");
    expect(text(b.root, "ruf-title")).toBe("Subida a Ayacata");
  });
});

describe("resumen de la ruta: guardar como tramo", () => {
  it("sin nombre lo pide; con él, guarda el tramo con sus pasadas y ya no lo ofrece", async () => {
    const b = await bench();
    expect(byId(b.root, "ruf-tr-save").hidden).toBe(false);
    fireEvent.click(byId(b.root, "ruf-tr-go"));
    expect(toastText()).toBe("Ponle un nombre al tramo");
    expect(document.activeElement).toBe(byId(b.root, "ruf-tr-name"));
    expect(b.kv.load(TRAMOS_KEY, [])).toEqual([]);
    byId<HTMLInputElement>(b.root, "ruf-tr-name").value = "  Vuelta al circuito ";
    fireEvent.click(byId(b.root, "ruf-tr-go"));
    const saved = b.kv.load<{ nombre: string; pasadas: unknown[] }[]>(TRAMOS_KEY, []);
    expect(saved).toHaveLength(1);
    expect(saved[0].nombre).toBe("Vuelta al circuito");
    expect(saved[0].pasadas.length).toBeGreaterThan(0);
    expect(toastText()).toBe("Tramo «Vuelta al circuito» guardado");
    expect(b.eng.tramoSaved).toBe(true);
    expect(byId(b.root, "ruf-tr-save").hidden).toBe(true);
    expect(b.root.querySelectorAll("#ruf-tr-list .tr-item h3")[0].textContent).toMatch(
      /^Vuelta al circuito · \d+,\d km$/,
    );
  });

  it("sin camino que guardar (parado todo el rato) no vale como tramo", async () => {
    const b = await bench({
      prepare: (eng) => {
        // El GPS siempre a menos de 2 m/s: sin rato en marcha, no sale camino.
        eng.loc.d.speed.fill(0);
      },
    });
    byId<HTMLInputElement>(b.root, "ruf-tr-name").value = "Corto";
    fireEvent.click(byId(b.root, "ruf-tr-go"));
    expect(toastText()).toBe("Un tramo tiene que tener entre 300 m y 50 km");
    expect(b.eng.tramoSaved).toBeFalsy();
  });

  it.skipIf(!lorosSeries())(
    "Los Loros: «Guardar ida y vuelta» guarda los dos sentidos",
    async () => {
      const b = await bench({ series: lorosSeries() as MergedSeriesSet });
      expect(b.eng.tramoTurn).not.toBeNull();
      fireEvent.click(byId(b.root, "ruf-tr-two"));
      expect(toastText()).toBe("Ponle un nombre al tramo");
      byId<HTMLInputElement>(b.root, "ruf-tr-name").value = "Los Loros";
      fireEvent.click(byId(b.root, "ruf-tr-two"));
      const saved = b.kv.load<{ nombre: string; pasadas: unknown[] }[]>(TRAMOS_KEY, []);
      expect(saved.map((t) => t.nombre)).toEqual(["Los Loros · ida", "Los Loros · vuelta"]);
      expect(saved.every((t) => t.pasadas.length === 1)).toBe(true);
      expect(toastText()).toBe("Guardados «Los Loros · ida» y «Los Loros · vuelta»");
      expect(b.root.querySelectorAll("#ruf-tr-list .tr-item")).toHaveLength(2);
      expect(byId(b.root, "ruf-tr-save").hidden).toBe(true);
    },
  );
});

describe("resumen de la ruta: guardar el circuito", () => {
  function withCircuit(eng: Engine): void {
    eng.circ = {
      laps: [{ num: 1, time: 70.5, valid: true, t0: 0, t1: 70.5 }],
      best: { time: 70.5, grid: [], num: 1 },
    } as unknown as LapTimer;
    eng.circTrack = {
      name: "Circuito del 9 oct",
      origin: { lat: 27.77, lon: -15.52 },
      centerline: [
        [27.77, -15.52],
        [27.771, -15.521],
      ],
      length: 2184,
    } as CircuitTrack;
    eng.circSaved = false;
  }

  it("con el nombre escrito: queda en tus circuitos, la grabación lo apunta y ya no se ofrece", async () => {
    const circuito = {
      nombre: "Circuito del 9 oct",
      longitud: 2184,
      guardado: false,
      mejor: 70.5,
      vueltas: [{ num: 1, time: 70.5, valid: true }],
      trazado: null,
      sentido: "normal" as const,
      forzadas: null,
    };
    const b = await bench({ meta: { circuito }, prepare: withCircuit });
    expect(byId<HTMLInputElement>(b.root, "ruf-name").value).toBe("Circuito del 9 oct");
    byId<HTMLInputElement>(b.root, "ruf-name").value = "Maspalomas (prueba)";
    fireEvent.click(byId(b.root, "ruf-save"));
    const list = b.kv.load<CircuitTrack[]>(CIRCUITS_KEY, []);
    expect(list.map((c) => c.name)).toEqual(["Maspalomas (prueba)"]);
    expect(b.eng.circSaved).toBe(true);
    expect(text(b.root, "ruf-l-note")).toMatch(
      /^Maspalomas \(prueba\) · 2184 m · .*Circuito guardado/,
    );
    expect(byId(b.root, "ruf-save").hidden).toBe(true);
    expect(b.patch).toHaveBeenCalledWith("20261009-172312-test", {
      circuito: expect.objectContaining({ nombre: "Maspalomas (prueba)", guardado: true }),
    });
    expect(uiStore.getState().homeVersion).toBeGreaterThan(0);
  });
});

describe("resumen de la ruta: cortar en dos", () => {
  const PARTS = [
    { id: "a", recorrido: { distancia: 6312 } },
    { id: "b", recorrido: { distancia: 6250 } },
  ] as unknown as SessionMeta[];

  it("dos toques: corta donde dice la barra y va a la portada con las dos", async () => {
    const b = await bench();
    vi.mocked(cutSaved).mockResolvedValueOnce(PARTS);
    const go = byId(b.root, "ruf-cut-go");
    const bar = byId<HTMLInputElement>(b.root, "ruf-cut-t");
    act(() => {
      bar.value = "300";
      bar.dispatchEvent(new Event("input"));
    });
    fireEvent.click(go);
    expect(go.textContent).toBe("¿Cortar? Toca otra vez");
    expect(cutSaved).not.toHaveBeenCalled();
    fireEvent.click(go);
    expect(go.textContent).toBe("Cortando…");
    await settle();
    expect(cutSaved).toHaveBeenCalledWith(
      expect.objectContaining({ patchSession: b.patch }),
      "20261009-172312-test",
      300,
      b.eng,
    );
    expect(uiStore.getState().screen).toBe("home");
    expect(uiStore.getState().homeVersion).toBeGreaterThan(0);
    expect(toastText()).toBe("Cortada en dos: 6,3 km y 6,3 km");
  });

  it("el primer toque se olvida a los 4 s, y al mover la barra", async () => {
    const b = await bench();
    vi.useFakeTimers();
    const go = byId(b.root, "ruf-cut-go");
    fireEvent.click(go);
    expect(go.textContent).toBe("¿Cortar? Toca otra vez");
    act(() => vi.advanceTimersByTime(3900));
    expect(go.textContent).toBe("¿Cortar? Toca otra vez");
    act(() => vi.advanceTimersByTime(200));
    expect(go.textContent).toBe("Cortar aquí");
    fireEvent.click(go);
    const bar = byId<HTMLInputElement>(b.root, "ruf-cut-t");
    act(() => {
      bar.value = "400";
      bar.dispatchEvent(new Event("input"));
    });
    expect(go.textContent).toBe("Cortar aquí");
    expect(cutSaved).not.toHaveBeenCalled();
  });

  it("si no se puede, lo dice y la ruta sigue entera", async () => {
    const b = await bench();
    const go = byId(b.root, "ruf-cut-go");
    for (const [err, msg] of [
      [
        new CutError("demasiado corta"),
        "Así una de las dos quedaría casi vacía: corta más al medio",
      ],
      [new Error("QuotaExceededError"), "No se ha podido cortar (la ruta sigue entera)"],
    ] as const) {
      vi.mocked(cutSaved).mockRejectedValueOnce(err);
      fireEvent.click(go);
      fireEvent.click(go);
      await settle();
      expect(toastText()).toBe(msg);
      expect(go.textContent).toBe("Cortar aquí");
      expect(uiStore.getState().screen).toBe("ruta-fin");
    }
  });
});

describe("resumen de la ruta: cuándo se pinta", () => {
  it("con la pantalla a la vista: el aviso del runtime con ella oculta espera a que se vea", async () => {
    const eng = await routeOf(demo());
    const runtime = {
      kv: memoryKV(),
      store: null,
      settings: { get: () => DEFAULT_SETTINGS },
      session: { rt: { E: null, lastE: eng } },
      nav: { goHome: vi.fn() },
    } as unknown as Runtime;
    const { container } = render(
      <RuntimeContext.Provider value={runtime}>
        <RutaFin />
      </RuntimeContext.Provider>,
    );
    act(() => refreshSummary());
    expect(text(container, "ruf-sub")).toBe("");
    expect(byId(container, "ruta-fin").hidden).toBe(true);
    act(() => show("ruta-fin"));
    expect(byId(container, "ruta-fin").hidden).toBe(false);
    expect(text(container, "ruf-sub")).toMatch(/ km · /);
  });
});

describe("resumen de la ruta: repintar la misma ruta u otra", () => {
  it("la misma (color): «Cortar en dos» y el punto se quedan; otra: todo como al principio", async () => {
    const b = await bench();
    const cut = byId<HTMLDetailsElement>(b.root, "ruf-cut");
    const pos = byId<HTMLInputElement>(b.root, "ruf-pos");
    const bar = byId<HTMLInputElement>(b.root, "ruf-cut-t");
    fireEvent.click(byId(b.root, "ruf-c-more"));
    expect(text(b.root, "ruf-c-more")).toBe("Ver menos");
    act(() => {
      cut.open = true;
    });
    await settle();
    act(() => {
      bar.value = "250";
      bar.dispatchEvent(new Event("input"));
    });
    fireEvent.click(byId(b.root, "ruf-next"));
    const at = pos.value;
    expect(at).not.toBe("0");
    // El color repinta todo el resumen: las tablas se pliegan, lo demás sigue.
    fireEvent.click(byId(b.root, "ruf-color"));
    expect(text(b.root, "ruf-c-more")).toBe("Ver las 15");
    expect(cut.open).toBe(true);
    expect(bar.value).toBe("250");
    expect(pos.value).toBe(at);
    // Otra ruta.
    const other = await routeOf(demo(), { id: "20261010-090000-otra", epoch: EPOCH + 86400000 });
    act(() => {
      b.rt.lastE = other;
      refreshSummary();
    });
    await settle();
    expect(cut.open).toBe(false);
    expect(bar.value).not.toBe("250");
    expect(pos.value).toBe("0");
    expect(text(b.root, "ruf-sub")).toMatch(/^sábado, 10 de octubre/);
  });
});
