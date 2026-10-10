// El panel en marcha de la app de antes (render, renderLive, renderRoute… de live.js, tal cual) sobre su marcado de
// siempre (#dash y #ruta de index.html) en un documento aparte, para compararlo con el de ahora con el mismo motor:
// mismos textos, clases y lo que se ve, y cuántas veces se escribe en el DOM en cada fotograma.
import { readFileSync } from "node:fs";
import { toLocal } from "../src/core/maspalomas";
import { diveMm } from "../src/core/recorrido";
import { isLatLon, MARK, type Tramo } from "../src/core/tramos";
import type { Engine } from "../src/engine";
import type { Settings } from "../src/engine/settings";
import { legacyFile, liveFunctions } from "./legacy";

const FNS = [
  "render",
  "renderLive",
  "renderCalib",
  "calibUi",
  "calibBtnText",
  "isStopped",
  "showHz",
  "renderMiniMap",
  "trackPoint",
  "sectorPaths",
  "renderWheelie",
  "wheelieText",
  "brakeFlash",
  "predicted",
  "lagNow",
  "gridAt",
  "now",
  "perfNow",
  "fmt",
  "fmtSigned",
  "fmtLap",
  "ring",
  "brakeLine",
  "setText",
  "setCls",
  "renderRoute",
  "renderCircuit",
  "renderTramoStrip",
  "passTimeAt",
  "liveDots",
  "isGateTramo",
  "fmtClock",
  "curveMarks",
  "fmtMeters",
];
const CONSTS = ["NF", "G", "EXT_LAG", "mapView", "hasDive", "fmtDive"];

// #dash y #ruta (y el destello) de la página de antes.
export function oldPanelHtml(): string {
  const html = readFileSync(legacyFile("index.html"), "utf8");
  const a = html.indexOf("<!-- En pista -->");
  const b = html.indexOf("<!-- Resumen de la ruta -->");
  if (a < 0 || b < a) throw new Error("index.html sin el marcado de los paneles");
  return html.slice(a, b) + '<div class="flash" id="flash" hidden></div>';
}

export interface OldPanelOptions {
  settings: Settings;
  // Hz del receptor externo con fijos frescos (0 o sin poner: ninguno).
  hz?: number;
  // Los tramos guardados que lee el mapa de la ruta.
  tramos?: Tramo[];
}

export interface OldPanel {
  doc: Document;
  dash: HTMLElement;
  ruta: HTMLElement;
  flash: HTMLElement;
  // Un fotograma del panel del circuito (render) o del de la ruta libre (renderRoute).
  render(): void;
  renderRoute(): void;
  // Lo que se ha mandado pintar a los mapas (MaspaMapa.draw, en JSON, y MaspaMapa.legend).
  draws: string[];
  legends: string[];
  // Cómo se mira el mapa de la ruta (lo que cambiaban los botones del mapa).
  mapView: OldMapView;
}

export interface OldMapView {
  follow: boolean;
  span: number;
  colorBy: string;
  drawnAt: number;
  miniAt: number;
  legendBy: string | null;
}

// Los botones del mapa de la ruta, como los de wire() de antes.
export const oldMapButtons = {
  color(v: OldMapView): void {
    v.colorBy = v.colorBy === "fase" ? "incl" : "fase";
    v.drawnAt = 0;
  },
  fit(v: OldMapView): void {
    v.follow = !v.follow;
    v.drawnAt = 0;
  },
  zoomIn(v: OldMapView): void {
    v.span = Math.max(150, v.span / 1.6);
    v.follow = true;
    v.drawnAt = 0;
  },
  zoomOut(v: OldMapView): void {
    v.span = Math.min(8000, v.span * 1.6);
    v.follow = true;
    v.drawnAt = 0;
  },
};

function byId(doc: Document, id: string): HTMLElement {
  const el = doc.getElementById(id);
  if (!el) throw new Error("Falta #" + id);
  return el;
}

// Un sandbox por motor: las funciones de antes leen E, settings… como variables sueltas.
export function oldPanel(E: Engine, opts: OldPanelOptions): OldPanel {
  const doc = document.implementation.createHTMLDocument("antes");
  doc.body.innerHTML = oldPanelHtml();
  byId(doc, "ruta").hidden = false;
  const draws: string[] = [];
  const legends: string[] = [];
  const hz = opts.hz ?? 0;
  const fns = liveFunctions<{ render(): void; renderRoute(): void; mapView: OldMapView }>(FNS, {
    consts: CONSTS,
    globals: {
      E,
      // El reloj de la vuelta de ejemplo (now() de antes: sim.t).
      sim: {
        get t() {
          return E.simT;
        },
      },
      settings: opts.settings,
      document: doc,
      $: (id: string) => doc.getElementById(id),
      performance,
      CALIB_STOPPED: 2,
      extFresh: () => hz > 0,
      extRate: () => hz,
      render3D: () => {},
      markArmed: null,
      loadTramosCached: () => opts.tramos ?? [],
      T: { toLocal },
      MaspaTramos: { MARK, isLatLon },
      MaspaRecorrido: { diveMm },
      MaspaMapa: {
        draw: (_cv: unknown, o: unknown) => draws.push(JSON.stringify(o)),
        legend: (_el: unknown, by: string) => legends.push(by),
      },
    },
  });
  return {
    doc,
    dash: byId(doc, "dash"),
    ruta: byId(doc, "ruta"),
    flash: byId(doc, "flash"),
    render: () => fns.render(),
    renderRoute: () => fns.renderRoute(),
    draws,
    legends,
    mapView: fns.mapView,
  };
}

// Lo que se ve de cada elemento con id de un panel (y de las casillas de los sectores): texto, clase y si está oculto.
// De la pantalla misma, solo la clase (lo que se ve lo decide quién la enseña).
export interface ElState {
  text: string;
  cls: string;
  hidden: boolean;
}

// El texto de un elemento: el suyo entero si no tiene otros dentro; si los tiene, solo sus trozos de texto propios
// (sin los espacios entre etiquetas del HTML escrito a mano, que React no pone).
function textOf(el: HTMLElement): string {
  if (!el.children.length) return el.textContent || "";
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === n.TEXT_NODE)
    .map((n) => (n.nodeValue || "").trim())
    .filter(Boolean)
    .join("|");
}

export function panelState(root: HTMLElement): Record<string, ElState | string> {
  const out: Record<string, ElState | string> = { [root.id]: root.className };
  for (const el of root.querySelectorAll<HTMLElement>("[id]"))
    out[el.id] = { text: textOf(el), cls: el.className, hidden: el.hidden !== false };
  const sectors = root.querySelector("#d-sectors");
  if (sectors)
    Array.from(sectors.children).forEach((c, k) => {
      out["sector-" + k] = c.className;
    });
  return out;
}

// Cuenta las escrituras en el DOM (cambien algo o no: textos, atributos, nodos) de un trozo de página.
export function writeCounter(root: Node): { take(): number; stop(): void } {
  const mo = new MutationObserver(() => {});
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  return { take: () => mo.takeRecords().length, stop: () => mo.disconnect() };
}
