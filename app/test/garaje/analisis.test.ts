// @vitest-environment jsdom
// La página del análisis del garaje (garaje/web/analisis.ts) al cambiar de tanda: lo de la tanda anterior no se queda
// pegado. Las otras tandas del día como referencia y la marca de «Guardada» eran de la anterior: con otra tanda (del
// garaje, un archivo, la de ejemplo o la de una GoPro) se quitan y se vuelve a comparar con el objetivo. Si la nueva no
// se puede leer, sigue la de antes tal cual; si se lee pero no se puede analizar, no se puede guardar un análisis viejo
// con su nombre. Y en «Tus tandas», un tiempo que no se pudo calcular sale «—», no 0:00,00.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ArchivosTanda, ListaTandas } from "../../../garaje/api";
import { csvFiles } from "../../src/core/formato";
import { demoSession } from "../../src/core/maspalomas";
import { REPO } from "./servidor";

const A = "20261011-100000-aaaa";
const B = "20261011-110000-bbbb";
const C = "20261011-120000-cccc";
const EPOCH = Date.UTC(2026, 9, 11, 9, 0);

function archivos(seed: number, piloto: string): ArchivosTanda {
  const s = demoSession({ seed }).session;
  return {
    meta: { v: 1, id: "x", epoch: EPOCH, piloto, objetivo: 65, meta: { osm: 0, rev: 0 } },
    epoch: EPOCH,
    files: csvFiles(s as unknown as Parameters<typeof csvFiles>[0], EPOCH),
  };
}

const DATA: Record<string, ArchivosTanda> = {};
const LISTA: ListaTandas = { tandas: [] };
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, max = 3000): Promise<void> {
  for (let i = 0; i < max && !cond(); i++) await tick();
}
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const status = () => $("status").textContent || "";
const extButtons = () => [...$("ref-mode").querySelectorAll("button.ext")] as HTMLButtonElement[];
const pressed = () =>
  ([...$("ref-mode").querySelectorAll("button")] as HTMLButtonElement[])
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.dataset.v);
const saveBtn = () => $("save-btn") as HTMLButtonElement;

// Espera al análisis de una tanda nueva (el estado pasa por «Procesando…»).
async function analysed(): Promise<void> {
  await until(() =>
    /vueltas? completas?|No he encontrado|No he podido|No encuentro/.test(status()),
  );
}

let carga: typeof import("../../../garaje/web/analisis/carga");
let videoHooks: typeof import("../../../garaje/web/analisis/estado");

beforeAll(async () => {
  DATA[A] = archivos(7, "Ayoze");
  DATA[B] = archivos(11, "Amigo");
  DATA[C] = archivos(13, "Ayoze");
  const meta = (id: string, piloto: string, mejor: number) => ({
    id,
    meta: {
      inicio: undefined,
      fin: undefined,
      estado: "terminada",
      sim: false,
      tipo: "pista" as const,
      fuente: "movil" as const,
      piloto,
      objetivo: 65,
      sentido: "osm",
      mejor,
      vueltas: 0,
    },
    trozos: 10,
    bytes: 1000,
    resumen: null,
    analizando: false,
  });
  LISTA.tandas = [meta(A, "Ayoze", 67.2), meta(B, "Amigo", 66.9), meta(C, "Ayoze", 67.0)];
  vi.stubGlobal("fetch", async (url: string) => {
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (url === "/api/ia")
      return json({ configurada: false, desde: null, modelo: "claude-opus-5-5" });
    if (url === "/api/tandas") return json(LISTA);
    let m = /^\/api\/tandas\/([^/]+)\/archivos$/.exec(url);
    if (m && DATA[m[1]]) return json(DATA[m[1]]);
    m = /^\/api\/tandas\/([^/]+)\/informe$/.exec(url);
    if (m) return json({ informe: null });
    return json({ ok: false }, 404);
  });
  const html = readFileSync(join(REPO, "garaje", "web", "analisis.html"), "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  window.history.replaceState({}, "", "/analisis?tanda=" + A);
  await import("../../../garaje/web/analisis");
  carga = await import("../../../garaje/web/analisis/carga");
  videoHooks = await import("../../../garaje/web/analisis/estado");
  await analysed();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("garaje, análisis: al cambiar de tanda no se queda nada de la anterior", () => {
  it("la tanda del garaje trae las otras del día como referencia", async () => {
    await until(() => extButtons().length === 2);
    expect(extButtons().map((b) => b.dataset.v)).toEqual(["t:" + B, "t:" + C]);
    extButtons()[0].click();
    await until(() => /Comparando con la mejor vuelta de Amigo/.test(status()));
    expect(pressed()).toEqual(["t:" + B]);
    saveBtn().click();
    await until(() => saveBtn().textContent === "Guardada");
    expect(saveBtn().disabled).toBe(true);
  });

  it("otra tanda del garaje: sus referencias, comparar con el objetivo y sin «Guardada»", async () => {
    await carga.loadFromGarage(B);
    await analysed();
    await until(() => extButtons().length === 2);
    expect(extButtons().map((b) => b.dataset.v)).toEqual(["t:" + A, "t:" + C]);
    expect(pressed()).toEqual(["obj"]);
    expect(videoHooks.state.extRefs).toEqual({});
    expect(saveBtn().textContent).toBe("Guardar esta tanda");
    expect(saveBtn().disabled).toBe(false);
    saveBtn().click();
    await until(() => saveBtn().textContent === "Guardada");
  });

  it("un archivo que no se puede leer no cambia nada: sigue la de antes, ya guardada", async () => {
    const input = $("file") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      configurable: true,
      get: () => [new File(["hola"], "notas.txt", { type: "text/plain" })],
    });
    input.dispatchEvent(new Event("change"));
    await until(() => /No hay archivos CSV/.test(status()));
    expect(saveBtn().textContent).toBe("Guardada");
    expect(saveBtn().disabled).toBe(true);
    expect(extButtons()).toHaveLength(2);
  });

  it("un archivo que se lee pero no se puede analizar no deja guardar el análisis de antes", async () => {
    const input = $("file") as HTMLInputElement;
    const csv =
      "time,seconds_elapsed,horizontalAccuracy,speed,longitude,latitude\n" +
      "1760173200000000000,0.0000,3,20,-15.6,27.75\n";
    Object.defineProperty(input, "files", {
      configurable: true,
      get: () => [new File([csv], "Location.csv", { type: "text/csv" })],
    });
    input.dispatchEvent(new Event("change"));
    await until(() => !/^(Leyendo|Procesando)/.test(status()) && status() !== "");
    expect(status()).not.toMatch(/vueltas completas/);
    expect(videoHooks.state.result).toBeNull();
    expect(saveBtn().disabled).toBe(true);
    expect(extButtons()).toHaveLength(0);
    expect(pressed()).toEqual(["obj"]);
  });

  it("la tanda de ejemplo: sin referencias de otras tandas ni «Guardada»", async () => {
    await carga.loadFromGarage(A);
    await analysed();
    await until(() => extButtons().length === 2);
    extButtons()[1].click();
    await until(() => /Comparando con la mejor vuelta de Ayoze/.test(status()));
    ($("demo-btn") as HTMLButtonElement).click();
    await until(() => /^Ejemplo:/.test(status()));
    expect(extButtons()).toHaveLength(0);
    expect(pressed()).toEqual(["obj"]);
    expect(videoHooks.state.dayList).toEqual([]);
    expect(saveBtn().textContent).toBe("Guardar esta tanda");
  });
});

describe("garaje, análisis: «Tus tandas»", () => {
  it("un tiempo guardado como null sale «—» y no cuenta en la gráfica", async () => {
    const docs = JSON.parse(localStorage.getItem("maspa-telemetria-tandas") || "[]") as {
      best: number | null;
      ideal: number | null;
      savedAt: string;
    }[];
    expect(docs.length).toBeGreaterThanOrEqual(2);
    docs[0].best = null;
    docs[0].ideal = null;
    docs[0].savedAt = "2099-01-01T00:00:00.000Z";
    localStorage.setItem("maspa-telemetria-tandas", JSON.stringify(docs));
    const historial = await import("../../../garaje/web/analisis/historial");
    await historial.initStore();
    const first = $("hist-list").querySelector("li") as HTMLElement;
    expect(first.querySelector("b")?.textContent).toBe("—");
    expect(first.textContent).toMatch(/ideal —/);
    expect(first.textContent).not.toMatch(/0:00,00/);
    // Una marca por tanda con tiempo: la de null no se dibuja.
    const marks = $("hist-svg").querySelectorAll("line.l-lap");
    expect(marks).toHaveLength(docs.length - 1);
  });
});

describe("garaje, análisis: el objetivo escrito a mano", () => {
  const target = () => $("target") as HTMLInputElement;
  const write = (text: string) => {
    target().value = text;
    target().dispatchEvent(new Event("change"));
  };

  it("vale lo mismo que en el móvil (de 40 s a 3:20), redondeado a la décima", async () => {
    write("1:45,0");
    await analysed();
    expect(videoHooks.state.target).toBe(105);
    expect(target().value).toBe("1:45,0");
    write("1:05,25");
    await analysed();
    expect(videoHooks.state.target).toBe(65.3);
    expect(target().value).toBe("1:05,3");
  });

  it("si no vale, lo dice y el campo vuelve al que vale", async () => {
    write("0:30");
    await until(() => /objetivo/.test(status()));
    expect(status()).toMatch(/entre 0:40 y 3:20/);
    expect(videoHooks.state.target).toBe(65.3);
    expect(target().value).toBe("1:05,3");
  });
});

describe("garaje, análisis: una tanda del garaje sin hora de inicio", () => {
  it("no sale del 1 de enero de 1970", async () => {
    const D = "20261011-130000-dddd";
    DATA[D] = { ...archivos(7, "Ayoze"), epoch: null };
    await carga.loadFromGarage(D);
    await analysed();
    expect($("source-badge").textContent).toBe("Tanda guardada · Ayoze");
    expect(videoHooks.state.epoch).toBeNull();
  });
});
