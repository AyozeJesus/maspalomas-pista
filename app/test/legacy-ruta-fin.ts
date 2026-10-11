// El resumen de la ruta de la app de antes (showRouteSummary y todo lo que usa, de live.js), en una página aparte
// (otro documento del jsdom de la prueba, con el marcado de index.html) y con sus módulos de antes (mapa.js,
// tramos.js, cortar.js…), para comparar con la versión nueva lo que sale en la página. Para pruebas con
// «@vitest-environment jsdom». Los lienzos no pintan (jsdom no sabe): su contexto 2D lo acepta todo.
// Las funciones se copian de live.js como en liveFunctions (legacy.ts), pero aquí el contexto queda a mano: sus
// variables (summaryColor, cutUi…) se leen y se cambian, y lo que hacían los botones (wire) se hace igual.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { Engine } from "../src/engine";
import type { KeyValueStore } from "../src/engine/kv";
import { legacyFile, loadLegacy } from "./legacy";
import { renameLegacyMarkup } from "./renames";

// Lo de live.js que pinta el resumen (las funciones y las constantes que usan).
const FUNCTIONS = [
  "showRouteSummary",
  "foldTable",
  "tableRow",
  "routeBrakes",
  "renderRouteLaps",
  "saveCircuit",
  "loadCircuits",
  "load",
  "store",
  "setupNombre",
  "engName",
  "cutSessionId",
  "setupCut",
  "renderCut",
  "cutPoint",
  "trailDistances",
  "trailIndexAt",
  "summaryMapDots",
  "topCurves",
  "curveMarks",
  "drawSummaryMap",
  "canvasCopy",
  "renderPhaseChart",
  "setupScrub",
  "curveSpans",
  "spanAt",
  "brakeAt",
  "scrubTo",
  "drawScrubMap",
  "drawScrubChart",
  "fmtMeters",
  "scrubInfo",
  "jumpCurve",
  "trailPick",
  "renderTramoCard",
  "loadTramos",
  "bestPass",
  "shortDate",
  "passInsights",
  "brakesPair",
  "drawTramoChart",
  "drawTramoMap",
  "tramoCoverage",
  "saveTramoFrom",
  "saveTramos",
  "newTramoId",
  "recordPass",
  "passBrakes",
  "engDate",
  "fmt",
  "fmtSigned",
  "fmtLap",
  "fmtClock",
  "setText",
] as const;
const CONSTS = [
  "NF",
  "FOLD_ROWS",
  "hasDive",
  "fmtDive",
  "diveCell",
  "trailCell",
  "scrub",
  "PHASE_NAME",
  "$",
  "TRAMOS_KEY",
  "T",
] as const;

type Fn = (...args: never[]) => unknown;
export type OldSummary = Record<(typeof FUNCTIONS)[number], Fn> & {
  scrub: { eng: Engine | null; i: number };
};

// Las variables de live.js que cambian (let) y las que pone el resumen.
export interface OldVars {
  summaryColor: string;
  cutUi: { eng: Engine; t: number; armed: boolean } | null;
}

// Copia las funciones y constantes de live.js (como liveFunctions) en un contexto con `globals`.
function liveSandbox(globals: Record<string, unknown>): { fns: OldSummary; win: OldVars } {
  const src = readFileSync(legacyFile("live.js"), "utf8");
  const pieces: string[] = [];
  for (const c of CONSTS) {
    const start = src.indexOf("\n  const " + c + " =");
    pieces.push(src.slice(start, src.indexOf(";\n", start) + 1));
  }
  for (const n of FUNCTIONS) {
    const start = src.indexOf("\n  function " + n + "(");
    if (start < 0) throw new Error("live.js no define la función " + n);
    pieces.push(src.slice(start, src.indexOf("\n  }\n", start) + 4));
  }
  const sandbox: Record<string, unknown> = { ...globals };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const all = [...FUNCTIONS, ...CONSTS].join(", ");
  vm.runInContext(pieces.join("\n") + "\nwindow.__fns = { " + all + " };", sandbox, {
    filename: "live.js",
  });
  return { fns: sandbox.__fns as OldSummary, win: sandbox as unknown as OldVars };
}

// El marcado del resumen de antes (index.html, <main id="ruta-fin">…</main>), con los cambios hechos a propósito desde
// entonces (renames.ts).
export function oldMarkup(): string {
  const html = readFileSync(legacyFile("index.html"), "utf8");
  const a = html.indexOf('<main class="page" id="ruta-fin"');
  const raw = html.slice(a, html.indexOf("</main>", a) + "</main>".length);
  const doc = new DOMParser().parseFromString("<body>" + raw + "</body>", "text/html");
  renameLegacyMarkup(doc);
  return (doc.getElementById("ruta-fin") as HTMLElement).outerHTML;
}

// Un contexto 2D que lo acepta todo (y mide los textos con 6 px por letra).
export function anyContext(canvas: unknown): unknown {
  const target: Record<string | symbol, unknown> = { canvas };
  return new Proxy(target, {
    get: (t, p) =>
      p in t
        ? t[p]
        : p === "measureText"
          ? (s: string) => ({ width: 6 * String(s).length })
          : () => undefined,
    set: (t, p, v) => {
      t[p] = v;
      return true;
    },
  });
}

// Que los canvas de una ventana (la de jsdom de verdad o la global de las pruebas) tengan ese contexto.
export function fakeCanvases(win: { HTMLCanvasElement: { prototype: object } }): void {
  Object.defineProperty(win.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function (this: unknown) {
      return anyContext(this);
    },
  });
}

export interface OldWorld {
  doc: Document;
  old: OldSummary;
  win: OldVars;
  // Los fotogramas pendientes (requestAnimationFrame de antes).
  frames: (() => void)[];
  // El mapa de antes (MaspaMapa de mapa.js), para espiar lo que pinta.
  mapa: { draw: (...args: unknown[]) => unknown };
}

export interface OldOptions {
  kv: KeyValueStore;
  // El almacén del móvil (solo hace falta que esté; patchSession para guardar el circuito o el nombre).
  store?: unknown;
  garaje?: boolean;
  dpr?: number;
  // El color del mapa («fase» o «incl»).
  color?: string;
}

export function oldWorld(o: OldOptions): OldWorld {
  fakeCanvases(window);
  const doc = document.implementation.createHTMLDocument("antes");
  doc.body.innerHTML = oldMarkup();
  const mods = loadLegacy(
    "track-data.js",
    "sim.js",
    "analysis.js",
    "telemetry.js",
    "tramos.js",
    "cortar.js",
    "circuito.js",
  );
  const mapaWin = loadLegacy("mapa.js");
  mapaWin.document = doc;
  mapaWin.devicePixelRatio = o.dpr ?? 1;
  const frames: (() => void)[] = [];
  // localStorage de antes sobre el almacén de las pruebas (el mismo que el de la versión nueva).
  const localStorage = {
    getItem: (k: string) => o.kv.getRaw(k),
    setItem: (k: string, v: string) => o.kv.setRaw(k, v),
  };
  const globals: Record<string, unknown> = {
    document: doc,
    devicePixelRatio: o.dpr ?? 1,
    localStorage,
    requestAnimationFrame: (cb: () => void) => frames.push(cb),
    show: (which: string) => {
      const el = doc.getElementById("ruta-fin");
      if (el) el.hidden = which !== "ruta-fin";
    },
    ST: o.store ?? null,
    settings: { garaje: o.garaje ? { u: "https://mac", k: "k" } : null },
    summaryColor: o.color ?? "fase",
    cutUi: null,
    lastE: null,
    E: null,
    MaspaMapa: mapaWin.MaspaMapa,
    MaspaTelemetry: mods.MaspaTelemetry,
    MaspaTramos: mods.MaspaTramos,
    MaspaCortar: mods.MaspaCortar,
    MaspaCircuito: mods.MaspaCircuito,
  };
  const { fns, win } = liveSandbox(globals);
  return {
    doc,
    old: fns,
    win,
    frames,
    mapa: mapaWin.MaspaMapa as OldWorld["mapa"],
  };
}

// Ejecuta los fotogramas pendientes (el punto que se mueve se pinta en el siguiente).
export function runFrames(frames: (() => void)[]): void {
  while (frames.length) (frames.shift() as () => void)();
}

// Lo que hacían en live.js (wire) la barra de «Cortar en dos» y abrir o cerrar «Cortar en dos».
export function oldCutInput(w: OldWorld, value: number): void {
  const input = w.doc.getElementById("ruf-cut-t") as HTMLInputElement;
  input.value = String(value);
  const ui = w.win.cutUi;
  if (!ui) return;
  ui.t = Number(input.value);
  ui.armed = false;
  w.old.renderCut();
  w.old.drawSummaryMap(ui.eng as never);
}

export function oldCutToggle(w: OldWorld, open: boolean): void {
  (w.doc.getElementById("ruf-cut") as HTMLDetailsElement).open = open;
  const ui = w.win.cutUi;
  if (ui && !(w.doc.getElementById("ruta-fin") as HTMLElement).hidden)
    w.old.drawSummaryMap(ui.eng as never);
}

// Lo que se ve de un trozo de página, para comparar dos: etiquetas, atributos (en orden alfabético), textos (los
// seguidos, juntos; sin los espacios de sangría del marcado de antes) y lo que no está en los atributos: el valor de
// los campos, si un <details> está abierto y el tamaño de los lienzos.
export type Tree = string | { tag: string; attrs: string[]; props: string[]; kids: Tree[] };

export function domTree(n: Node): Tree {
  if (n.nodeType !== 1) return n.nodeValue ?? "";
  const el = n as Element;
  const kids: Tree[] = [];
  let text = "";
  const flush = () => {
    if (text.trim()) kids.push(text);
    text = "";
  };
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) text += c.nodeValue ?? "";
    else if (c.nodeType === 1) {
      flush();
      kids.push(domTree(c));
    }
  }
  flush();
  const props: string[] = [];
  if (el.tagName === "INPUT") props.push("value=" + (el as HTMLInputElement).value);
  if (el.tagName === "DETAILS") props.push("open=" + (el as HTMLDetailsElement).open);
  return {
    tag: el.tagName.toLowerCase(),
    attrs: Array.from(el.attributes, (a) => a.name + "=" + a.value).sort(),
    props,
    kids,
  };
}
