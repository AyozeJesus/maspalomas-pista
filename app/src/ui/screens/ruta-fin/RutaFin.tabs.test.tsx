// @vitest-environment jsdom
// El resumen de la ruta en pestañas: «Resumen» (los números, «Por tramos» y el mapa), «Tramos» (las pasadas y las
// vueltas), «Pilotaje» (fases, curvas, frenadas y caballitos), «3D» y «Opciones». Cada tarjeta en la suya, una pestaña
// sin nada que enseñar no sale, cada ruta nueva empieza en «Resumen», el teclado y el atrás del móvil, la vista 3D
// solo en su pestaña y el PDF con todas.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoSeries, EPOCH, routeOf } from "../../../../test/fixtures-ruta-fin";
import { fakeCanvases } from "../../../../test/legacy-ruta-fin";
import { refreshSummary, show, uiStore } from "../../../app/ui-store";
import type { CircuitTrack, LapTimer } from "../../../core/circuito";
import type { MergedSeriesSet } from "../../../core/formato";
import type { Engine, ReplayMeta } from "../../../engine";
import { memoryKV, type KeyValueStore } from "../../../engine/kv";
import { DEFAULT_SETTINGS } from "../../../engine/settings";
import { createRuntime, type Runtime } from "../../../runtime";
import { prepareClone } from "../../pdf/captura";
import { RuntimeContext } from "../../runtime-context";
import { RutaFin } from "./RutaFin";
import { saveTramoFrom } from "./tramo-save";

// El reproductor 3D de verdad necesita WebGL: aquí basta saber si está abierto (active).
vi.mock("../../replay3d/Replay3dPlayer", () => ({
  Replay3dPlayer: (p: { active: boolean }) => (
    <div id="ruf-3d-player" data-active={String(p.active)} />
  ),
}));
// Sin subidas de montaña, como el resto de pruebas del resumen.
vi.mock("../../../app/subidas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/subidas")>()),
  todasLasSubidas: () => [],
}));

let demoCache: MergedSeriesSet | null = null;
function demo(): MergedSeriesSet {
  if (!demoCache) demoCache = demoSeries();
  return demoCache;
}

beforeEach(() => {
  fakeCanvases(window);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  uiStore.setState({ screen: "home", summaryVersion: 0, summaryTab: "resumen", toast: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

interface Bench {
  eng: Engine;
  root: HTMLElement;
  rt: { E: Engine | null; lastE: Engine | null };
}

async function bench(
  o: {
    series?: MergedSeriesSet;
    meta?: Partial<ReplayMeta>;
    prepare?: (e: Engine) => void;
    kv?: KeyValueStore;
  } = {},
): Promise<Bench> {
  const kv = o.kv ?? memoryKV();
  const eng = await routeOf(o.series ?? demo(), o.meta, kv);
  o.prepare?.(eng);
  const rt: Bench["rt"] = { E: null, lastE: eng };
  const runtime = {
    kv,
    store: { patchSession: vi.fn(() => Promise.resolve(true)) },
    settings: { get: () => DEFAULT_SETTINGS },
    session: { rt },
    nav: { goHome: vi.fn() },
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
  return { eng, root, rt };
}

function byId<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T {
  const el = root.querySelector<T>("#" + id);
  if (!el) throw new Error("sin #" + id);
  return el;
}

const tabs = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]'));
// Las pestañas que salen y la elegida.
const shown = (root: ParentNode) => tabs(root).filter((t) => !t.hidden);
const selected = (root: ParentNode) =>
  tabs(root).filter((t) => t.getAttribute("aria-selected") === "true");
// La pestaña (su panel) en la que está una tarjeta (null: fuera de las pestañas).
const panelOf = (root: ParentNode, sel: string) => {
  const el = root.querySelector(sel);
  if (!el) throw new Error("sin " + sel);
  return el.closest('[role="tabpanel"]')?.id ?? null;
};

// Lo que enseña de verdad un panel: alguna tarjeta que no esté oculta ni vacía (una tarjeta que es solo su gráfica o
// el 3D, sin datos, no salen: data-empty en su caja, con CSS).
function hasContent(panel: HTMLElement): boolean {
  return Array.from(panel.children).some(
    (c) =>
      !(c as HTMLElement).hidden &&
      !(c.matches(".ch-card, .r3d-card") && c.querySelector(":scope > [data-empty]")),
  );
}

// Los primeros segundos de una grabación (una ruta casi sin trazada).
function firstSeconds(S: MergedSeriesSet, s: number): MergedSeriesSet {
  const out: Record<string, Record<string, Float64Array>> = {};
  for (const [key, cols] of Object.entries(S)) {
    if (!cols) continue;
    const t = (cols as Record<string, Float64Array>).t;
    const n = t.findIndex((x) => x > t[0] + s);
    const o: Record<string, Float64Array> = {};
    for (const [c, v] of Object.entries(cols as Record<string, Float64Array>)) o[c] = v.slice(0, n);
    out[key] = o;
  }
  return out as MergedSeriesSet;
}

function withCircuit(eng: Engine): void {
  eng.circ = {
    laps: [{ num: 1, time: 70.5, valid: true, t0: 0, t1: 70.5 }],
    best: { time: 70.5, grid: [], num: 1 },
  } as unknown as LapTimer;
  eng.circTrack = {
    name: "Circuito del 9 oct",
    origin: { lat: 27.77, lon: -15.52 },
    centerline: [],
    length: 2184,
  } as CircuitTrack;
  eng.circSaved = false;
}

describe("resumen de la ruta en pestañas", () => {
  it("cada tarjeta en su pestaña; la cabecera, la nota y «Volver», fuera", async () => {
    const b = await bench();
    expect(tabs(b.root).map((t) => [t.id, t.textContent])).toEqual([
      ["ruf-tb-resumen", "Resumen"],
      ["ruf-tb-tramos", "Tramos"],
      ["ruf-tb-pilotaje", "Pilotaje"],
      ["ruf-tb-3d", "3D"],
      ["ruf-tb-opciones", "Opciones"],
    ]);
    const where: [string, string | null][] = [
      ["#ruf-ochos", "ruf-tab-resumen"],
      ['[aria-labelledby="ruf-sum-h"]', "ruf-tab-resumen"],
      ["#ruf-bd", "ruf-tab-resumen"],
      ['[aria-labelledby="ruf-map-h"]', "ruf-tab-resumen"],
      ["#ruf-tr", "ruf-tab-tramos"],
      ["#ruf-l", "ruf-tab-tramos"],
      ["#ruf-ph", "ruf-tab-pilotaje"],
      ['[aria-labelledby="ruf-c-h"]', "ruf-tab-pilotaje"],
      ["#ruf-b", "ruf-tab-pilotaje"],
      ["#ruf-w", "ruf-tab-pilotaje"],
      ["#ruf-3d", "ruf-tab-3d"],
      ['[aria-labelledby="ruf-opt-h"]', "ruf-tab-opciones"],
      ["#ruf-title", null],
      ["#ruf-back", null],
      ["#ruf-share", null],
      ["#ruf-home", null],
    ];
    for (const [sel, panel] of where) expect(panelOf(b.root, sel), sel).toBe(panel);
    // En «Resumen», en este orden: «Ochos» (solo en el entrenamiento en 8), los números, «Por tramos» y el mapa.
    expect(
      Array.from(
        byId(b.root, "ruf-tab-resumen").children,
        (c) => c.id || c.getAttribute("aria-labelledby"),
      ),
    ).toEqual(["ruf-ochos", "ruf-sum-h", "ruf-bd", "ruf-map-h"]);
    // Las pestañas, entre la cabecera y los paneles; la nota de seguridad y «Volver», detrás de todos.
    const kids = Array.from(b.root.children);
    const bar = kids.findIndex(
      (c) => c.querySelector('[role="tablist"]') || c.matches('[role="tablist"]'),
    );
    expect(bar).toBeGreaterThan(kids.findIndex((c) => c.matches("header.page-head")));
    expect(kids.findIndex((c) => c.querySelector("#ruf-home"))).toBe(kids.length - 1);
  });

  it("si pasó por algún tramo o subida, «Por tramos» va antes que los números (también en el PDF)", async () => {
    const kv = memoryKV();
    const first = await routeOf(demo(), {}, kv);
    expect(saveTramoFrom(kv, first, "Recta y horquilla", 60, 140, EPOCH)).not.toBeNull();
    const b = await bench({ kv, meta: { id: "20261010-100000-otra", epoch: EPOCH + 86400000 } });
    expect(b.eng.tramoPasses.length).toBeGreaterThan(0);
    const order = (root: ParentNode) =>
      Array.from(root.children)
        .filter((c) => c.tagName === "SECTION")
        .map((c) => c.id || c.getAttribute("aria-labelledby"));
    expect(order(byId(b.root, "ruf-tab-resumen"))).toEqual([
      "ruf-ochos",
      "ruf-bd",
      "ruf-sum-h",
      "ruf-map-h",
    ]);
    expect(byId(b.root, "ruf-bd-box").hasAttribute("data-empty")).toBe(false);
    expect(order(prepareClone(b.root, () => null)).slice(0, 4)).toEqual([
      "ruf-ochos",
      "ruf-bd",
      "ruf-sum-h",
      "ruf-map-h",
    ]);
  });

  it("al abrir, «Resumen»; con los papeles de pestaña, panel y quién controla a quién", async () => {
    const b = await bench();
    const list = b.root.querySelector('[role="tablist"]') as HTMLElement;
    expect(list.getAttribute("aria-label")).toBe("Partes del resumen");
    for (const t of tabs(b.root)) {
      const name = t.id.replace("ruf-tb-", "");
      const panel = byId(b.root, "ruf-tab-" + name);
      expect(t.tagName).toBe("BUTTON");
      expect(t.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(t.id);
      const on = name === "resumen";
      expect(t.getAttribute("aria-selected")).toBe(String(on));
      expect(t.tabIndex).toBe(on ? 0 : -1);
      expect(panel.hidden).toBe(!on);
    }
  });

  it("tocar una pestaña la enseña (y oculta las demás)", async () => {
    const b = await bench();
    fireEvent.click(byId(b.root, "ruf-tb-pilotaje"));
    expect(selected(b.root).map((t) => t.id)).toEqual(["ruf-tb-pilotaje"]);
    expect(byId(b.root, "ruf-tab-pilotaje").hidden).toBe(false);
    expect(byId(b.root, "ruf-tab-resumen").hidden).toBe(true);
    expect(uiStore.getState().summaryTab).toBe("pilotaje");
    fireEvent.click(byId(b.root, "ruf-tb-opciones"));
    expect(byId(b.root, "ruf-tab-opciones").hidden).toBe(false);
    expect(byId(b.root, "ruf-tab-pilotaje").hidden).toBe(true);
  });

  it("con el teclado: flechas (dando la vuelta), Inicio y Fin, y el foco va con la pestaña", async () => {
    const b = await bench();
    const key = (k: string) => {
      const el = document.activeElement as HTMLElement;
      fireEvent.keyDown(el, { key: k });
    };
    byId(b.root, "ruf-tb-resumen").focus();
    key("ArrowRight");
    expect(document.activeElement?.id).toBe("ruf-tb-tramos");
    expect(selected(b.root)[0].id).toBe("ruf-tb-tramos");
    key("End");
    expect(document.activeElement?.id).toBe("ruf-tb-opciones");
    key("ArrowRight");
    expect(document.activeElement?.id).toBe("ruf-tb-resumen");
    key("ArrowLeft");
    expect(document.activeElement?.id).toBe("ruf-tb-opciones");
    key("Home");
    expect(selected(b.root)[0].id).toBe("ruf-tb-resumen");
    // Otra tecla no hace nada.
    key("a");
    expect(selected(b.root)[0].id).toBe("ruf-tb-resumen");
  });

  it("una pestaña sale solo si tiene algo que enseñar (y las flechas se la saltan)", async () => {
    const cases: [string, Parameters<typeof bench>[0], string[]][] = [
      ["ruta guardada", {}, ["resumen", "tramos", "pilotaje", "3d", "opciones"]],
      [
        "la vuelta de ejemplo sin grabación",
        { prepare: (e) => (e.viewing = null) },
        ["resumen", "pilotaje", "3d", "opciones"],
      ],
      // («Pilotaje» siempre: aunque sea para decir que no hay curvas.)
      ["unos segundos", { series: firstSeconds(demo(), 3) }, ["resumen", "pilotaje", "opciones"]],
    ];
    for (const [what, o, want] of cases) {
      const b = await bench(o);
      expect(
        shown(b.root).map((t) => t.id.replace("ruf-tb-", "")),
        what,
      ).toEqual(want);
      for (const t of tabs(b.root)) {
        const panel = byId(b.root, t.getAttribute("aria-controls") ?? "");
        expect(hasContent(panel), what + ": " + t.id).toBe(!t.hidden);
      }
      cleanup();
    }
    // Sin tramos pero con las vueltas de un circuito: la pestaña se llama «Vueltas».
    const c = await bench({
      prepare: (e) => {
        e.viewing = null;
        withCircuit(e);
      },
    });
    expect(byId(c.root, "ruf-tb-tramos").hidden).toBe(false);
    expect(byId(c.root, "ruf-tb-tramos").textContent).toBe("Vueltas");
    expect(byId(c.root, "ruf-tr").hidden).toBe(true);
    expect(byId(c.root, "ruf-l").hidden).toBe(false);
    cleanup();
    // Las flechas solo pasan por las que salen (sin 3D: de «Opciones» a «Pilotaje»).
    const s = await bench({ series: firstSeconds(demo(), 3) });
    fireEvent.keyDown(byId(s.root, "ruf-tb-resumen"), { key: "ArrowLeft" });
    expect(document.activeElement?.id).toBe("ruf-tb-opciones");
    fireEvent.keyDown(byId(s.root, "ruf-tb-opciones"), { key: "ArrowLeft" });
    expect(document.activeElement?.id).toBe("ruf-tb-pilotaje");
  });

  it("otra ruta empieza en «Resumen»; la misma repintada (el color del mapa) sigue en su pestaña", async () => {
    const b = await bench();
    fireEvent.click(byId(b.root, "ruf-tb-pilotaje"));
    fireEvent.click(byId(b.root, "ruf-color"));
    expect(selected(b.root)[0].id).toBe("ruf-tb-pilotaje");
    const other = await routeOf(demo(), { id: "20261010-090000-otra", epoch: EPOCH + 86400000 });
    act(() => {
      b.rt.lastE = other;
      refreshSummary();
    });
    expect(selected(b.root)[0].id).toBe("ruf-tb-resumen");
    expect(byId(b.root, "ruf-tab-resumen").hidden).toBe(false);
    expect(uiStore.getState().summaryTab).toBe("resumen");
  });

  it("la pestaña elegida que esta ruta no tiene: «Resumen»", async () => {
    uiStore.setState({ summaryTab: "3d" });
    const b = await bench({ series: firstSeconds(demo(), 3) });
    act(() => uiStore.setState({ summaryTab: "3d" }));
    expect(selected(b.root).map((t) => t.id)).toEqual(["ruf-tb-resumen"]);
    expect(byId(b.root, "ruf-tab-resumen").hidden).toBe(false);
    expect(byId(b.root, "ruf-tab-3d").hidden).toBe(true);
  });

  it("la vista 3D solo está abierta con su pestaña a la vista", async () => {
    const b = await bench();
    fireEvent.click(byId(b.root, "ruf-tb-3d"));
    fireEvent.click(byId(b.root, "ruf-3d-open"));
    expect(byId(b.root, "ruf-3d-player").dataset.active).toBe("true");
    fireEvent.click(byId(b.root, "ruf-tb-resumen"));
    expect(byId(b.root, "ruf-3d-player").dataset.active).toBe("false");
    fireEvent.click(byId(b.root, "ruf-tb-3d"));
    expect(byId(b.root, "ruf-3d-player").dataset.active).toBe("true");
  });

  it("al cambiar de pestaña con la página bajada, el panel nuevo empieza arriba (bajo las pestañas)", async () => {
    const b = await bench();
    const panels = byId(b.root, "ruf-tab-resumen").parentElement as HTMLElement;
    const scroll = vi.fn();
    vi.stubGlobal("scrollTo", scroll);
    // Las pestañas (48 px) pegadas arriba y los paneles empezando 1200 px más abajo del principio de la página.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2000 });
    panels.getBoundingClientRect = () => ({ top: -752 }) as DOMRect;
    Object.defineProperty(b.root.querySelector('[role="tablist"]'), "offsetHeight", {
      configurable: true,
      value: 48,
    });
    fireEvent.click(byId(b.root, "ruf-tb-pilotaje"));
    expect(scroll).toHaveBeenCalledWith(0, 1200);
    // Sin bajar tanto, la página se queda donde está.
    scroll.mockClear();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
    panels.getBoundingClientRect = () => ({ top: 948 }) as DOMRect;
    fireEvent.click(byId(b.root, "ruf-tb-resumen"));
    expect(scroll).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("el PDF lleva todas las pestañas, sin la barra, con cada tarjeta suelta como antes", async () => {
    const b = await bench({ prepare: withCircuit });
    fireEvent.click(byId(b.root, "ruf-tb-pilotaje"));
    const clone = prepareClone(b.root, () => null);
    expect(clone.querySelector('[role="tablist"]')).toBeNull();
    expect(clone.querySelector('[role="tabpanel"]')).toBeNull();
    const cards = Array.from(clone.children)
      .filter((c) => c.tagName === "SECTION")
      .map((c) => c.id || c.getAttribute("aria-labelledby"));
    // (Sin el 3D ni las opciones, como siempre.)
    expect(cards).toEqual([
      "ruf-ochos",
      "ruf-sum-h",
      "ruf-bd",
      "ruf-map-h",
      "ruf-tr",
      "ruf-l",
      "ruf-ph",
      "ruf-c-h",
      "ruf-b",
      "ruf-w",
    ]);
    // Nada oculto por ser de otra pestaña.
    expect(clone.querySelector("#ruf-l")?.hasAttribute("hidden")).toBe(false);
    // Y la pantalla, como estaba.
    expect(byId(b.root, "ruf-tab-pilotaje").hidden).toBe(false);
    expect(byId(b.root, "ruf-tab-resumen").hidden).toBe(true);
  });
});

describe("resumen de la ruta: al cambiar de pantalla, la página arriba", () => {
  // Un scrollTo que mueve la página (el de jsdom no la mueve), y lo que se le pide.
  function fakeScroll(from: number): [number, number][] {
    const calls: [number, number][] = [];
    const at = (y: number) =>
      Object.defineProperty(window, "scrollY", { configurable: true, value: y });
    at(from);
    vi.stubGlobal("scrollTo", (x: number, y: number) => {
      calls.push([x, y]);
      at(y);
    });
    return calls;
  }
  afterEach(() => Object.defineProperty(window, "scrollY", { configurable: true, value: 0 }));

  it("al salir del resumen bajado, la portada empieza arriba; sin cambiar de pantalla, nada", () => {
    act(() => uiStore.setState({ screen: "ruta-fin" }));
    const calls = fakeScroll(1500);
    act(() => show("home"));
    expect(calls).toEqual([[0, 0]]);
    act(() => show("home"));
    expect(calls).toEqual([[0, 0]]);
  });

  it("otra ruta abierta desde «Mis rutas» bajada empieza arriba, con el título (venga de «Pilotaje» o de «Resumen»)", async () => {
    for (const prev of ["pilotaje", "resumen"] as const) {
      const b = await bench();
      fireEvent.click(byId(b.root, "ruf-tb-" + prev));
      expect(uiStore.getState().summaryTab).toBe(prev);
      act(() => show("home"));
      const calls = fakeScroll(1500);
      const other = await routeOf(demo(), { id: "20261010-090000-otra", epoch: EPOCH + 86400000 });
      act(() => {
        b.rt.lastE = other;
        show("ruta-fin");
        refreshSummary();
      });
      expect(selected(b.root)[0].id, prev).toBe("ruf-tb-resumen");
      expect(calls[0], prev).toEqual([0, 0]);
      expect(window.scrollY, prev).toBe(0);
      cleanup();
      vi.unstubAllGlobals();
      vi.stubGlobal("requestAnimationFrame", () => 1);
    }
  });
});

describe("resumen de la ruta: el atrás del móvil", () => {
  it("con la página bajada, «Resumen» empieza arriba (bajo las pestañas), como al tocarla", async () => {
    const b = await bench();
    fireEvent.click(byId(b.root, "ruf-tb-pilotaje"));
    const panels = byId(b.root, "ruf-tab-resumen").parentElement as HTMLElement;
    const scroll = vi.fn();
    vi.stubGlobal("scrollTo", scroll);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 2000 });
    panels.getBoundingClientRect = () => ({ top: -752 }) as DOMRect;
    Object.defineProperty(b.root.querySelector('[role="tablist"]'), "offsetHeight", {
      configurable: true,
      value: 48,
    });
    const rt = createRuntime({ kv: memoryKV(), store: null });
    act(() => rt.nav.onBack());
    expect(uiStore.getState().summaryTab).toBe("resumen");
    expect(byId(b.root, "ruf-tab-resumen").hidden).toBe(false);
    expect(scroll).toHaveBeenCalledWith(0, 1200);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("al ir atrás, el navegador no recoloca la página (lo hace la app: si no, la deja donde se apuntó la entrada)", () => {
    const rt = createRuntime({ kv: memoryKV(), store: null });
    history.scrollRestoration = "auto";
    const off = rt.nav.wire();
    expect(history.scrollRestoration).toBe("manual");
    off();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("en una entrada de antes (otra versión, recargada) también: «manual» antes de ir atrás y de apuntar otra", () => {
    const rt = createRuntime({ kv: memoryKV(), store: null });
    const off = rt.nav.wire();
    const modes: string[] = [];
    const push = vi
      .spyOn(history, "pushState")
      .mockImplementation(() => modes.push(history.scrollRestoration));
    // La entrada en la que está la página, de la versión de antes: «auto» (y sin la marca de las nuestras).
    history.replaceState(null, "");
    history.scrollRestoration = "auto";
    act(() => uiStore.setState({ screen: "ruta-fin", summaryTab: "pilotaje" }));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(uiStore.getState().summaryTab).toBe("resumen");
    expect(modes).toEqual(["manual"]);
    // Y al tocar la pantalla en otra así, la que se apunta ya es «manual».
    history.scrollRestoration = "auto";
    document.dispatchEvent(new Event("pointerdown"));
    expect(modes).toEqual(["manual", "manual"]);
    push.mockRestore();
    off();
  });

  it("en otra pestaña vuelve a «Resumen»; en «Resumen», a la portada", () => {
    const rt = createRuntime({ kv: memoryKV(), store: null });
    act(() => uiStore.setState({ screen: "ruta-fin", summaryTab: "pilotaje" }));
    act(() => rt.nav.onBack());
    expect(uiStore.getState().screen).toBe("ruta-fin");
    expect(uiStore.getState().summaryTab).toBe("resumen");
    act(() => rt.nav.onBack());
    expect(uiStore.getState().screen).toBe("home");
  });
});
