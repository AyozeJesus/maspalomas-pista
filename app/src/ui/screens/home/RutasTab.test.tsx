// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacy, legacyFile, liveFunctions } from "../../../../test/legacy";
import { refreshHome, uiStore } from "../../../app/ui-store";
import { BUILD } from "../../../app/version";
import type { LatLon, Tramo } from "../../../core/tramos";
import { memoryKV } from "../../../engine/kv";
import type { Runtime } from "../../../runtime";
import { createSettings } from "../../../runtime/settings";
import { TRAMOS_KEY } from "../../../services/tramos-store";
import type { StoredChunk, StoredSession } from "../../../storage";
import { RuntimeContext } from "../../runtime-context";
import { RutasTab } from "./RutasTab";

// ---------- datos ----------
const base = { inicio: "2026-10-09T15:31:05.000Z", fin: "2026-10-09T16:43:10.000Z" };
const SESSIONS: StoredSession[] = [
  {
    id: "20261009-163105-bn2o",
    ...base,
    tipo: "ruta",
    estado: "terminada",
    nombre: "Los Loros",
    recorrido: { distancia: 23456, duracion: 4325 },
    pend: 1,
  },
  { id: "20261009-150000-sim0", ...base, tipo: "pista", sim: true },
  { id: "20261009-140000-grab", ...base, tipo: "ruta", estado: "grabando" },
  {
    id: "20261008-120000-pist",
    ...base,
    tipo: "pista",
    estado: "terminada",
    vueltas: [{ valid: true }, { valid: false }, { valid: true }],
    mejor: 66.1,
  },
  {
    id: "20261007-120000-cort",
    epoch: 1760000000000,
    tipo: "ruta",
    estado: "cortada",
    recorrido: { distancia: 5600, duracion: 600 },
    circuito: { nombre: "Maspalomas", mejor: 65.426 },
  },
];

const path = (n: number): LatLon[] =>
  Array.from({ length: n }, (_, i) => [27.75 + i * 1e-4, -15.6 + i * 2e-5]);
const pass = (tiempo: number, fecha: string) => ({
  sesion: "s",
  fecha,
  tiempo,
  vMax: 90,
  tiempos: [0, tiempo],
});
const TRAMOS: Tramo[] = [
  {
    id: "tr-camino",
    nombre: "Los Loros · ida",
    largo: 6412,
    pts: path(20),
    pasadas: [pass(301.27, "2026-10-08T10:00:00.000Z"), pass(292.44, "2026-10-09T15:31:05.000Z")],
  },
  {
    id: "tr-puertas",
    nombre: "Crono 1",
    salida: [28.355628, -16.418573],
    meta: [28.374397, -16.427567],
    pasadas: [],
  },
  {
    id: "tr-aprendido",
    nombre: "Crono 2",
    salida: [27.75, -15.6],
    meta: [27.7519, -15.59962],
    largo: 290,
    pts: path(20),
    pasadas: [pass(30.5, "2026-10-07T09:00:00.000Z")],
  },
];

// ---------- la de antes: el marcado de index.html y lo que pintaba live.js ----------
function oldTab(sessions: StoredSession[], tramos: Tramo[]) {
  const html = readFileSync(legacyFile("index.html"), "utf8");
  const start = html.indexOf('<div class="tab-panel" id="tab-rutas"');
  const end = html.indexOf("<!-- Pestaña «Ajustes»", start);
  const root = document.createElement("div");
  root.innerHTML = html.slice(start, end);
  const store = new Map([[TRAMOS_KEY, JSON.stringify(tramos)]]);
  const fns = liveFunctions<{ renderHistory(): Promise<void>; renderTramosHome(): void }>(
    [
      "fmt",
      "fmtLap",
      "fmtClock",
      "fmtMeters",
      "shortDate",
      "load",
      "loadTramos",
      "isGateTramo",
      "bestPass",
      "mapsLink",
      "tramoEnds",
      "sessionDate",
      "sessionLine",
      "renderHistory",
      "renderTramosHome",
    ],
    {
      consts: ["NF", "TRAMOS_KEY"],
      globals: {
        document,
        $: (id: string) => root.querySelector("#" + id),
        localStorage: { getItem: (k: string) => store.get(k) ?? null },
        MaspaTramos: legacy("MaspaTramos", "tramos.js"),
        ST: { sessions: async () => sessions.slice() },
        settings: { garaje: null },
        setTimeout,
      },
    },
  );
  return { root, fns };
}

// Un elemento como texto comparable: etiqueta, atributos en orden (sin el value de las casillas, que React pone
// también como atributo) y sus hijos, sin los espacios entre etiquetas del HTML.
function shape(el: Element): string {
  const attrs = Array.from(el.attributes)
    .filter((a) => a.name !== "value")
    .map((a) => a.name + '="' + a.value + '"')
    .sort();
  const kids = Array.from(el.childNodes)
    .map((n) =>
      n.nodeType === Node.ELEMENT_NODE
        ? shape(n as Element)
        : n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()
          ? JSON.stringify(n.textContent)
          : "",
    )
    .join("");
  const tag = el.tagName.toLowerCase();
  return "<" + [tag, ...attrs].join(" ") + ">" + kids + "</" + tag + ">";
}

// ---------- la nueva: la pestaña con un runtime de mentira ----------
function setup(opts: { sessions?: StoredSession[]; tramos?: Tramo[]; garaje?: boolean } = {}) {
  const sessions = (opts.sessions ?? SESSIONS).slice();
  const kv = memoryKV({ [TRAMOS_KEY]: opts.tramos ?? TRAMOS });
  const settings = createSettings(kv);
  if (opts.garaje) settings.update({ garaje: { u: "https://mac.local:8443", k: "clave" } });
  const chunks = new Map<string, StoredChunk[]>();
  const store = {
    sessions: vi.fn(async () => sessions.slice()),
    chunksOf: vi.fn(async (id: string) => chunks.get(id) ?? []),
    deleteSession: vi.fn(async (id: string) => {
      const i = sessions.findIndex((s) => s.id === id);
      if (i >= 0) sessions.splice(i, 1);
    }),
  };
  const viewer = { viewSaved: vi.fn(async () => {}), refreshStored: vi.fn(async () => {}) };
  const nav = { showDay: vi.fn() };
  const rt = { kv, store, settings, viewer, nav } as unknown as Runtime;
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <RutasTab hidden={false} />
    </RuntimeContext.Provider>,
  );
  const $ = <T extends Element = HTMLElement>(sel: string) => {
    const el = view.container.querySelector<T & Element>(sel);
    if (!el) throw new Error("no está: " + sel);
    return el;
  };
  const $$ = (sel: string) => Array.from(view.container.querySelectorAll<HTMLElement>(sel));
  return { kv, store, settings, viewer, nav, chunks, view, $, $$ };
}

const storedTramos = (kv: ReturnType<typeof memoryKV>) =>
  JSON.parse(kv.getRaw(TRAMOS_KEY) ?? "[]") as Tramo[];

beforeEach(() => {
  uiStore.setState({ screen: "home", homeTab: "rutas", homeVersion: 0, toast: null });
  // jsdom no pinta en canvas: sin contexto, el dibujo no hace nada (y no avisa por la consola).
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("«Mis rutas» frente a la de antes", () => {
  it("el mismo DOM: cabecera, lista de grabaciones, tramos y formulario", async () => {
    const old = oldTab(SESSIONS, TRAMOS);
    await old.fns.renderHistory();
    old.fns.renderTramosHome();
    const { $, $$ } = setup();
    await waitFor(() => expect($$("#hist-list .hist-row")).toHaveLength(3));
    const mine = $("#tab-rutas");
    const theirs = old.root.querySelector("#tab-rutas");
    if (!theirs) throw new Error("sin #tab-rutas en index.html");
    // La de antes empieza oculta (la pestaña de partida es «Rodar»).
    theirs.removeAttribute("hidden");
    // Que la de antes haya pintado sus filas (si no, la comparación no diría nada).
    expect(theirs.querySelectorAll("#hist-list .hist-row")).toHaveLength(3);
    expect(theirs.querySelectorAll("#trs-list .hist-row")).toHaveLength(3);
    expect(shape(mine)).toBe(shape(theirs));
    expect(shape(mine)).toContain('"Buscar"');
  });

  it("sin nada guardado ni tramos: los dos avisos, como antes", async () => {
    const old = oldTab([], []);
    await old.fns.renderHistory();
    old.fns.renderTramosHome();
    const { $, store } = setup({ sessions: [], tramos: [] });
    await waitFor(() => expect(store.sessions).toHaveBeenCalled());
    const theirs = old.root.querySelector("#tab-rutas");
    if (!theirs) throw new Error("sin #tab-rutas en index.html");
    theirs.removeAttribute("hidden");
    expect(shape($("#tab-rutas"))).toBe(shape(theirs));
    expect($("#hist-empty").hidden).toBe(false);
    expect($("#trs-empty").hidden).toBe(false);
  });
});

describe("«Rutas y tandas»", () => {
  it("«Ver» repasa esa grabación", async () => {
    const { $$, viewer } = setup();
    await waitFor(() => expect($$("#hist-list .hist-row")).toHaveLength(3));
    fireEvent.click($$("#hist-list .hist-row")[1].querySelectorAll("button")[0]);
    expect(viewer.viewSaved).toHaveBeenCalledWith("20261008-120000-pist");
  });

  it("«Borrar»: un toque pide confirmar (sin subir al Mac, lo dice) y el segundo la quita", async () => {
    const { $$, store } = setup({ garaje: true });
    await waitFor(() => expect($$("#hist-list .hist-row")).toHaveLength(3));
    const del = () => $$("#hist-list .hist-row")[0].querySelector("button.danger") as HTMLElement;
    fireEvent.click(del());
    expect(del().textContent).toBe("¿Sin subir? Otra vez");
    expect(store.deleteSession).not.toHaveBeenCalled();
    // Otra grabación ya subida: «¿Seguro?».
    const other = $$("#hist-list .hist-row")[1].querySelector("button.danger") as HTMLElement;
    fireEvent.click(other);
    expect(other.textContent).toBe("¿Seguro? Otra vez");
    fireEvent.click(del());
    await waitFor(() => expect($$("#hist-list .hist-row")).toHaveLength(2));
    expect(store.deleteSession).toHaveBeenCalledWith("20261009-163105-bn2o");
    // La que estaba a medio confirmar sigue igual.
    expect(
      ($$("#hist-list .hist-row")[0].querySelector("button.danger") as HTMLElement).textContent,
    ).toBe("¿Seguro? Otra vez");
  });

  it("se vuelve a leer cada vez que se repinta la portada", async () => {
    const sessions = SESSIONS.slice(0, 1);
    const { $$, store } = setup({ sessions });
    await waitFor(() => expect($$("#hist-list .hist-row")).toHaveLength(1));
    const calls = store.sessions.mock.calls.length;
    act(() => refreshHome());
    await waitFor(() => expect(store.sessions.mock.calls.length).toBe(calls + 1));
  });
});

describe("«Tus tramos»", () => {
  it("«Nombre» le cambia el nombre (40 letras como mucho)", () => {
    const { $$, kv } = setup();
    vi.spyOn(window, "prompt").mockReturnValue("  Los Loros subida  ");
    fireEvent.click($$("#trs-list .hist-row")[0].querySelectorAll("button")[1]);
    expect(window.prompt).toHaveBeenCalledWith("Nombre del tramo", "Los Loros · ida");
    expect(storedTramos(kv)[0].nombre).toBe("Los Loros subida");
    expect($$("#trs-list b")[0].textContent).toBe("Los Loros subida");
  });

  it("«Nombre» cancelado o igual: no cambia nada", () => {
    const { $$, kv } = setup();
    const before = kv.getRaw(TRAMOS_KEY);
    vi.spyOn(window, "prompt").mockReturnValueOnce(null).mockReturnValueOnce("Los Loros · ida");
    fireEvent.click($$("#trs-list .hist-row")[0].querySelectorAll("button")[1]);
    fireEvent.click($$("#trs-list .hist-row")[0].querySelectorAll("button")[1]);
    expect(kv.getRaw(TRAMOS_KEY)).toBe(before);
  });

  it("«Borrar» de dos toques; sin ninguno, el aviso de que aún no hay", () => {
    const { $, $$, kv } = setup({ tramos: TRAMOS.slice(0, 1) });
    const del = () => $$("#trs-list .hist-row button.danger")[0];
    fireEvent.click(del());
    expect(del().textContent).toBe("¿Seguro? Otra vez");
    expect(storedTramos(kv)).toHaveLength(1);
    fireEvent.click(del());
    expect(storedTramos(kv)).toEqual([]);
    expect($$("#trs-list .hist-row")).toHaveLength(0);
    expect($("#trs-empty").hidden).toBe(false);
  });

  it("«Buscar»: desactivado y diciendo por qué grabación va; al acabar, lo que ha encontrado", async () => {
    const { $$, store } = setup();
    let release = () => {};
    store.chunksOf.mockImplementationOnce(
      () =>
        new Promise<StoredChunk[]>((r) => {
          release = () => r([]);
        }),
    );
    const find = () => $$("#trs-list .hist-row")[0].querySelectorAll("button")[0];
    fireEvent.click(find());
    await waitFor(() => expect(find().textContent).toBe("1/3"));
    expect(find()).toHaveProperty("disabled", true);
    act(() => release());
    await waitFor(() => expect(find().textContent).toBe("Buscar"));
    expect(find()).toHaveProperty("disabled", false);
    expect(uiStore.getState().toast?.text).toBe("Ninguna pasada nueva");
  });

  it("«Mapa» abre su salida y su meta en Google Maps", () => {
    const { $$ } = setup();
    const links = $$("#trs-list a.btn").map((a) => a.getAttribute("href"));
    expect(links[1]).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=28.355628,-16.418573&destination=28.374397,-16.427567&travelmode=driving",
    );
  });

  it("una pasada apuntada en directo o al repasar sale al repintar la portada", () => {
    const { $$, kv } = setup();
    const line = () => $$("#trs-list .hist-row span")[1].textContent;
    expect(line()).toMatch(/· 0 pasadas$/);
    const list = storedTramos(kv);
    list[1].pasadas.push(pass(301.4, "2026-10-10T09:00:00.000Z"));
    kv.store(TRAMOS_KEY, list);
    // Sin avisar, la lista no lo sabe; con refreshHome(), sí.
    expect(line()).toMatch(/· 0 pasadas$/);
    act(() => refreshHome());
    expect(line()).toMatch(/· 1 pasada · mejor 5:01,4 \(/);
  });
});

describe("«Nuevo tramo con salida y meta»", () => {
  const A = "28.355628, -16.418573";
  const B = "28.374397, -16.427567";
  const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
  const toggle = (details: HTMLDetailsElement, open: boolean) => {
    details.open = open;
    fireEvent(details, new Event("toggle"));
  };

  it("comprueba al escribir: la nota, el dibujo (abierto) y «Ver en Google Maps»", () => {
    const { $ } = setup();
    const note = $("#trs-note");
    toggle($<HTMLDetailsElement>("#trs-new"), true);
    type($("#trs-a"), "hola");
    expect(note.textContent).toMatch(/^No entiendo la salida/);
    expect(note.className).toBe("muted bad");
    expect($("#trs-prev").hidden).toBe(true);
    type($("#trs-a"), A);
    expect(note.textContent).toBe("Falta la meta.");
    expect(note.className).toBe("muted");
    expect($("#trs-prev").hidden).toBe(false);
    expect($("#trs-maps").hidden).toBe(true);
    type($("#trs-b"), B);
    expect(note.textContent).toBe("De la salida a la meta, 2,3 km en línea recta.");
    expect($("#trs-maps").hidden).toBe(false);
    expect($("#trs-maps").getAttribute("href")).toContain("origin=28.355628,-16.418573");
    // Cerrado, sin dibujo; el enlace se queda con el último (oculto) al borrar la meta.
    toggle($<HTMLDetailsElement>("#trs-new"), false);
    expect($("#trs-prev").hidden).toBe(true);
    type($("#trs-b"), "");
    expect($("#trs-maps").hidden).toBe(true);
    expect($("#trs-maps").getAttribute("href")).toContain("destination=28.374397,-16.427567");
  });

  it("abierto y escribiendo antes de que llegue el «toggle»: el dibujo se ve igual (mira la página)", () => {
    const { $ } = setup();
    const details = $<HTMLDetailsElement>("#trs-new");
    // Como al tocar «Nuevo tramo…»: se abre ya, pero el aviso llega después.
    details.open = true;
    type($("#trs-a"), A);
    expect($("#trs-prev").hidden).toBe(false);
    expect($("#trs-note").textContent).toBe("Falta la meta.");
    // Y el aviso, cuando llega, no cambia nada.
    fireEvent(details, new Event("toggle"));
    expect($("#trs-prev").hidden).toBe(false);
    expect(details.open).toBe(true);
  });

  it("«Aquí» pone la posición del GPS; si no se puede, lo dice", async () => {
    const { $ } = setup();
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    fireEvent.click($("#trs-b-here"));
    expect($("#trs-note").textContent).toBe("Buscando tu posición…");
    expect($("#trs-b-here")).toHaveProperty("disabled", true);
    const [ok] = getCurrentPosition.mock.calls[0] as [(p: unknown) => void];
    act(() => ok({ coords: { latitude: 28.3743971234, longitude: -16.427567 } }));
    expect($<HTMLInputElement>("#trs-b").value).toBe("28.374397, -16.427567");
    expect($("#trs-note").textContent).toBe("Falta la salida.");
    expect($("#trs-b-here")).toHaveProperty("disabled", false);
    fireEvent.click($("#trs-a-here"));
    const [, fail] = getCurrentPosition.mock.calls[1] as [unknown, () => void];
    act(() => fail());
    expect($("#trs-note").textContent).toBe(
      "No se ha podido saber tu posición (¿GPS encendido y con permiso?).",
    );
    expect($("#trs-note").className).toBe("muted bad");
  });

  it("guardar: el tramo, el formulario vacío y cerrado, y lo que encuentra en tus rutas", async () => {
    const { $, $$, kv } = setup();
    const details = $<HTMLDetailsElement>("#trs-new");
    toggle(details, true);
    type($("#trs-name"), "  Los Loros medio  ");
    type($("#trs-a"), A);
    type($("#trs-b"), B);
    const toasts: string[] = [];
    const unsub = uiStore.subscribe((s) => {
      if (s.toast && toasts[toasts.length - 1] !== s.toast.text) toasts.push(s.toast.text);
    });
    fireEvent.click($("#trs-save"));
    await waitFor(() => expect(toasts).toHaveLength(2));
    unsub();
    expect(toasts).toEqual([
      "«Los Loros medio» guardado: buscándolo en tus rutas…",
      "«Los Loros medio» guardado: al pasar por la salida empieza a contar",
    ]);
    const saved = storedTramos(kv);
    expect(saved).toHaveLength(4);
    expect(saved[3]).toMatchObject({
      nombre: "Los Loros medio",
      salida: [28.355628, -16.418573],
      meta: [28.374397, -16.427567],
      pasadas: [],
    });
    expect($$("#trs-list .hist-row b").map((b) => b.textContent)).toContain("Los Loros medio");
    expect(details.open).toBe(false);
    expect($<HTMLInputElement>("#trs-a").value).toBe("");
    expect($<HTMLInputElement>("#trs-name").value).toBe("");
    expect($("#trs-note").textContent).toBe("");
  });

  it("guardar sin la meta no guarda nada", () => {
    const { $, kv } = setup();
    const before = kv.getRaw(TRAMOS_KEY);
    type($("#trs-a"), A);
    fireEvent.click($("#trs-save"));
    expect(kv.getRaw(TRAMOS_KEY)).toBe(before);
    expect($("#trs-note").textContent).toBe("Falta la meta.");
  });
});

describe("«Tiempos del día» y los resúmenes al día", () => {
  it("«Tiempos del día» solo con el garaje emparejado, y lleva allí", () => {
    const a = setup();
    expect(a.$("#garage-day").hidden).toBe(true);
    cleanup();
    const b = setup({ garaje: true });
    expect(b.$("#garage-day").hidden).toBe(false);
    fireEvent.click(b.$("#garage-day"));
    expect(b.nav.showDay).toHaveBeenCalledWith("home");
  });

  // Lo que dura leer la lista (promesas) con el reloj de mentira.
  const settle = () => act(async () => {});
  const tick = async (ms: number, repaint = false) => {
    act(() => {
      vi.advanceTimersByTime(ms);
      if (repaint) refreshHome();
    });
    await settle();
  };

  it("rutas de otra versión: a los 1,5 s se ponen al día, sin que lo retrasen los repintados de cada segundo", async () => {
    vi.useFakeTimers();
    const { viewer } = setup();
    await settle();
    // Cada segundo, como el ritmo del receptor externo en la portada.
    await tick(1000, true);
    expect(viewer.refreshStored).not.toHaveBeenCalled();
    await tick(600);
    expect(viewer.refreshStored).toHaveBeenCalledTimes(1);
    await tick(1000, true);
    await tick(1000, true);
    expect(viewer.refreshStored).toHaveBeenCalledTimes(1);
  });

  it("fuera de la portada no; al volver a ella, otra vez", async () => {
    vi.useFakeTimers();
    const { viewer } = setup();
    await settle();
    act(() => uiStore.setState({ screen: "ruta" }));
    await tick(3000);
    expect(viewer.refreshStored).not.toHaveBeenCalled();
    act(() => uiStore.setState({ screen: "home" }));
    await tick(1600);
    expect(viewer.refreshStored).toHaveBeenCalledTimes(1);
  });

  it("todas al día (o solo tandas): nada que repasar", async () => {
    vi.useFakeTimers();
    const sessions = SESSIONS.map((s) => (s.tipo === "ruta" ? { ...s, calculo: BUILD } : s));
    const { viewer, $$ } = setup({ sessions });
    await settle();
    expect($$("#hist-list .hist-row")).toHaveLength(3);
    await tick(5000, true);
    expect(viewer.refreshStored).not.toHaveBeenCalled();
  });
});
