import { afterEach, describe, expect, it, vi } from "vitest";
import { circuitOutline, lapTrail, leanMarks, mountainTrail } from "../../../test/draw-fixtures";
import { asDocument, DrawLog, type LogEntry } from "../../../test/fake-canvas";
import { legacyDraw } from "../../../test/legacy-draw";
import * as C from "./compartir";
import { mapa } from "./mapa";

type Compartir = typeof C.compartir;

// La app de antes, tal cual (compartir.js con su mapa.js, en el mismo contexto).
const { mod: old, win } = legacyDraw<Compartir>("MaspaCompartir", "mapa.js", "compartir.js");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Made {
  log: LogEntry[];
  // Lo que ha salido: el blob (con el nombre del canvas que se sacó dentro) o el error.
  out: { type: string; text: string } | { error: string };
}

// Hace la imagen con una de las dos versiones, con un document de mentira que reparte los canvas.
async function make(
  impl: Compartir,
  run: (c: Compartir) => Promise<Blob>,
  blobFails: boolean,
): Promise<Made> {
  const log = new DrawLog({ blobFails });
  const doc = log.document();
  // Cada versión lo busca en su sitio: la de antes, en su window; la nueva, en el global.
  win.document = doc;
  vi.stubGlobal("document", asDocument(doc));
  const out = await run(impl).then(
    async (b): Promise<Made["out"]> => ({ type: b.type, text: await b.text() }),
    (e: unknown): Made["out"] => ({ error: String(e) }),
  );
  return { log: log.entries, out };
}

// La misma imagen con las dos: lo mismo apuntado, llamada a llamada, y lo mismo al final. Devuelve lo de la nueva.
async function same(run: (c: Compartir) => Promise<Blob>, blobFails = false): Promise<Made> {
  const mine = await make(C.compartir, run, blobFails);
  const theirs = await make(old, run, blobFails);
  expect(mine.log).toStrictEqual(theirs.log);
  expect(mine.out).toEqual(theirs.out);
  return mine;
}

function texts(log: LogEntry[]): unknown[] {
  return log.filter((e) => e[1] === "fillText").map((e) => e[2]);
}

const PIE = "ayozejesus.github.io/maspalomas-pista";
const trail = mountainTrail();
const marks = leanMarks(trail);
// Las 4 curvas más tumbadas, como routeShareData.
const top4 = marks
  .slice()
  .sort((a, b) => parseInt(b.text) - parseInt(a.text))
  .slice(0, 4);
const outline = circuitOutline();

// Como los de routeShareData (ruta libre, sin circuito): 9 casillas.
const routeStats: C.ShareStat[] = [
  ["Distancia", "5,6 km"],
  ["Tiempo", "4:12"],
  ["Punta", "97 km/h"],
  ["Incl. derecha", "52°"],
  ["Incl. izquierda", "49°"],
  ["Frenada máx.", "0,93 g"],
  ["Curvas", "41"],
  ["Frenadas", "17"],
  ["Caballitos", "1 · 64 m"],
];

// Como los de tandaShareData: 6 casillas, la última destacada (la mejor de siempre, batida hoy).
const tandaStats: C.ShareStat[] = [
  ["Punta", "142 km/h"],
  ["Incl. máx.", "47°"],
  ["Frenada máx.", "1,08 g"],
  ["Vueltas", "12"],
  ["Frente al objetivo", "+1,42 s"],
  ["Tu mejor vuelta", "1:31.4", true],
];

function laps(n: number, best: number): C.ShareLap[] {
  return Array.from({ length: n }, (_, i) => ({
    num: i + 1,
    time: "1:3" + ((i * 7) % 10) + "." + ((i * 3) % 10),
    valid: i % 5 !== 3,
    best: i === best,
  }));
}

describe("imagen para compartir (igual que la de antes)", () => {
  it("ruta por fases con sus 4 marcas y 9 datos (mapa más bajo)", async () => {
    const r = await same((c) =>
      c.routeImage({
        titulo: "Ruta libre",
        subtitulo: "Sábado, 10 de octubre · 5,6 km · 4:12",
        trail,
        marks: top4,
        colorBy: "fase",
        stats: routeStats,
        pie: PIE,
        name: "maspalomas-ruta-20261010-1830.png",
        text: "Ruta libre · sábado, 10 de octubre · 5,6 km · punta 97 km/h",
      }),
    );
    // Sale la imagen grande (canvas1), con el mapa pintado en el suyo (canvas2) y pegado.
    expect(r.out).toEqual({ type: "image/png", text: "canvas1" });
    expect(r.log).toContainEqual(["canvas2", "height=", 600]);
    expect(r.log).toContainEqual(["canvas1", "drawImage", "canvas2", 48, 226]);
    expect(r.log.filter((e) => e[0] === "canvas2" && e[1] === "lineTo").length).toBeGreaterThan(
      100,
    );
    const t = texts(r.log);
    for (const s of ["frena", "caballito", "Caballitos", "1 · 64 m", PIE]) expect(t).toContain(s);
    // La leyenda de fases no cabe en una fila: «caballito» va en la segunda, 40 px más abajo.
    const yOf = (s: string) => r.log.find((e) => e[1] === "fillText" && e[2] === s)?.[4];
    expect(yOf("caballito")).toBe(Number(yOf("frena")) + 40);
  });

  it("ruta por inclinación con trazado, puntos, título largo, un dato muy largo y 6 datos, sin pie", async () => {
    const r = await same((c) =>
      c.routeImage({
        titulo:
          "Ruta libre · tramo 2 · Los Loros, subida y bajada por la carretera vieja de Ayacata",
        subtitulo:
          "Sábado, 10 de octubre · 5,6 km · 4:12 · con parada en el mirador y vuelta por Cueva Grande",
        trail,
        outline,
        marks,
        dots: [
          { x: trail[200].x, y: trail[200].y, color: "#ff5fd2", label: "corte" },
          { x: trail[40].x, y: trail[40].y, color: "#38d0ff", r: 5, ring: true, label: "M" },
        ],
        colorBy: "incl",
        stats: [
          ["Distancia", "5,6 km"],
          ["Tiempo", "4:12"],
          ["Mejor vuelta", "1:31.4", true],
          ["Inclinación máxima en la curva más cerrada de toda la ruta", "52°"],
          ["Caballitos", "12 · 1.240 m en total sin bajar la rueda"],
          ["Frenadas", "17"],
        ],
      }),
    );
    expect(r.log).toContainEqual(["canvas2", "height=", 660]);
    const t = texts(r.log);
    // Recortados con «…» para que quepan, y el dato largo en letra pequeña (28 px).
    expect(t.filter((s) => String(s).endsWith("…")).length).toBeGreaterThanOrEqual(3);
    expect(r.log).toContainEqual([
      "canvas1",
      "font=",
      '800 28px Roboto, "Google Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    ]);
    expect(r.log.filter((e) => e[0] === "canvas2" && e[1] === "strokeText")).toHaveLength(2);
    expect(t).toContain("50°+");
  });

  it("ruta sin nada en el mapa ni datos, sin color dicho (por fases)", async () => {
    const r = await same((c) =>
      c.routeImage({
        titulo: "Ruta libre",
        subtitulo: "Hoy · 0,0 km · 0:00",
        trail: [],
        stats: [],
      }),
    );
    // El mapa solo prepara su canvas; la leyenda, la de fases.
    expect(r.log.filter((e) => e[0] === "canvas2").map((e) => e[1])).toEqual([
      "width=",
      "height=",
      "getContext",
      "setTransform",
      "clearRect",
    ]);
    expect(texts(r.log)).toContain("frena");
  });

  it("tanda: 14 vueltas (caben 12), la mejor, no válidas, el circuito con la vuelta y 6 datos", async () => {
    const r = await same((c) =>
      c.tandaImage({
        titulo: "Circuito de Maspalomas",
        subtitulo: "Sábado, 10 de octubre · 11 vueltas",
        mejor: "1:31.4",
        mejorNota: "Vuelta 7 · objetivo 1:30.0",
        vueltas: laps(14, 6),
        outline,
        trail: lapTrail(outline),
        stats: tandaStats,
        pie: PIE,
        name: "maspalomas-tanda-20261010-1830.png",
        text: "Maspalomas · sábado, 10 de octubre · mejor vuelta 1:31.4",
      }),
    );
    expect(r.out).toEqual({ type: "image/png", text: "canvas1" });
    const t = texts(r.log);
    for (const s of ["MEJOR VUELTA", "1:31.4", "Vuelta 12", "Vuelta 4 *", "Vuelta 7"])
      expect(t).toContain(s);
    expect(t).not.toContain("Vuelta 13");
    expect(r.log).toContainEqual(["canvas1", "fillStyle=", "#7b3fc4"]);
    // El circuito en su recuadro, a la derecha.
    expect(r.log).toContainEqual(["canvas2", "width=", 408]);
    expect(r.log).toContainEqual(["canvas1", "drawImage", "canvas2", 624, 226]);
  });

  it("tanda sin vueltas ni mejor («—», sin nota), solo el circuito, sin pie", async () => {
    const r = await same((c) =>
      c.tandaImage({
        titulo: "Circuito de Maspalomas",
        subtitulo: "Sábado, 10 de octubre · 0 vueltas",
        outline,
        stats: tandaStats.slice(0, 4),
      }),
    );
    const t = texts(r.log);
    expect(t).toContain("—");
    expect(t.some((s) => /^Vuelta \d/.test(String(s)))).toBe(false);
  });

  it("tanda de 3 vueltas con una nota larga (recortada) y media vuelta de trazada", async () => {
    const r = await same((c) =>
      c.tandaImage({
        titulo: "Circuito de Maspalomas",
        subtitulo: "Domingo, 11 de octubre · 3 vueltas",
        mejor: "1:29.87",
        mejorNota:
          "Vuelta 2 · objetivo 1:30.0 · nuevo récord personal en el circuito de Maspalomas con la moto nueva",
        vueltas: laps(3, 1),
        outline,
        trail: lapTrail(outline).slice(0, 150),
        stats: tandaStats,
        pie: PIE,
      }),
    );
    // La nota, recortada (y la etiqueta «Frente al objetivo», que tampoco cabe).
    const cut = texts(r.log).filter((s) => String(s).endsWith("…"));
    expect(cut).toHaveLength(2);
    // 520 px a 0,6 × 28 px por carácter: caben 30.
    expect(cut[0]).toBe("Vuelta 2 · objetivo 1:30.0 · …");
  });

  it("si el navegador no saca la imagen (toBlob da null), falla igual", async () => {
    const d = { titulo: "Ruta libre", subtitulo: "Hoy", trail, stats: routeStats };
    const r = await same((c) => c.routeImage(d), true);
    expect(r.out).toEqual({ error: "Error: sin imagen" });
    await same(
      (c) => c.tandaImage({ titulo: "Circuito", subtitulo: "Hoy", outline, stats: [] }),
      true,
    );
  });

  it("mismo tamaño y mismas funciones a la vista", () => {
    expect([C.W, C.H]).toEqual([old.W, old.H]);
    expect([C.compartir.W, C.compartir.H]).toEqual([1080, 1350]);
    expect(Object.keys(C.compartir).sort()).toEqual(Object.keys(old).sort());
  });

  it("se llama a través de los registros: un espía en compartir o en mapa se usa", async () => {
    vi.stubGlobal("document", asDocument(new DrawLog().document()));
    const draw = vi.spyOn(mapa, "draw");
    const d: C.RouteImageData = {
      titulo: "Ruta libre",
      subtitulo: "Hoy",
      trail,
      stats: routeStats,
    };
    await C.compartir.routeImage(d);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][1]).toEqual({
      trail,
      outline: undefined,
      marks: undefined,
      dots: undefined,
      colorBy: "fase",
      follow: false,
      size: { w: 984, h: 600, dpr: 2.6 },
    });
    const image = vi.spyOn(C.compartir, "routeImage").mockResolvedValue(new Blob(["espía"]));
    expect(await (await C.compartir.routeImage(d)).text()).toBe("espía");
    expect(image).toHaveBeenCalledWith(d);
  });
});

describe("compartir la imagen (igual que la de antes)", () => {
  type Mode = "comparte" | "cancela" | "falla" | "no-puede" | "sin-api";
  const blob = new Blob(["png"], { type: "image/png" });

  // Comparte con una de las dos versiones en un navegador de mentira que apunta lo que pasa (File, canShare, share,
  // la URL del blob y el temporizador que la suelta) y, en el registro, el enlace de descarga.
  async function shareWith(impl: Compartir, mode: Mode, fresh: boolean) {
    const events: unknown[][] = [];
    const log = new DrawLog();
    const doc = log.document();
    const timers: (() => void)[] = [];
    class FakeFile {
      readonly name: string;
      constructor(parts: unknown[], name: string, opts: { type: string }) {
        events.push(["File", parts.length, name, opts.type]);
        this.name = name;
      }
    }
    const names = (d: { files: FakeFile[] }) => Array.from(d.files, (f) => f.name);
    const nav =
      mode === "sin-api"
        ? {}
        : {
            canShare: (d: { files: FakeFile[] }) => {
              events.push(["canShare", names(d)]);
              return mode !== "no-puede";
            },
            share: async (d: { files: FakeFile[]; text?: string }) => {
              events.push(["share", names(d), d.text]);
              if (mode === "cancela") throw new DOMException("Share canceled", "AbortError");
              if (mode === "falla") throw new DOMException("Permission denied", "NotAllowedError");
            },
          };
    const createObjectURL = (b: unknown) => {
      events.push(["createObjectURL", b === blob]);
      return "blob:pista/1";
    };
    const revokeObjectURL = (u: unknown) => {
      events.push(["revokeObjectURL", u]);
    };
    const later = (fn: () => void, ms: number) => {
      events.push(["setTimeout", ms]);
      timers.push(fn);
      return 0;
    };
    if (fresh) {
      vi.stubGlobal("navigator", nav);
      vi.stubGlobal("File", FakeFile);
      vi.stubGlobal("document", asDocument(doc));
      vi.stubGlobal("setTimeout", later);
      vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    } else
      Object.assign(win, {
        navigator: nav,
        File: FakeFile,
        document: doc,
        setTimeout: later,
        URL: { createObjectURL, revokeObjectURL },
      });
    let result: string;
    try {
      result = await impl.share(blob, "maspalomas-ruta-20261010-1830.png", "Ruta libre · 5,6 km");
    } finally {
      vi.unstubAllGlobals();
    }
    // Pasados los 10 s, la URL del blob se suelta.
    for (const fn of timers.splice(0)) fn();
    vi.restoreAllMocks();
    return { result, events, log: log.entries };
  }

  const expected: Record<Mode, string> = {
    comparte: "compartida",
    cancela: "cancelada",
    falla: "descargada",
    "no-puede": "descargada",
    "sin-api": "descargada",
  };
  for (const mode of Object.keys(expected) as Mode[])
    it(mode + ": " + expected[mode], async () => {
      const mine = await shareWith(C.compartir, mode, true);
      expect(mine).toStrictEqual(await shareWith(old, mode, false));
      expect(mine.result).toBe(expected[mode]);
      if (mine.result === "descargada") {
        expect(mine.events.slice(-2)).toEqual([
          ["setTimeout", 10000],
          ["revokeObjectURL", "blob:pista/1"],
        ]);
        expect(mine.log).toContainEqual(["a1", "click"]);
      }
    });
});
