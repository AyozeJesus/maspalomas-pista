// Boxes de la app de antes: su marcado (index.html) pintado por sus funciones de live.js (enterPits, pitsCoach,
// pitsBrakes, renderStoreLine…), con lo de fuera de la pantalla de mentira (el análisis ya hecho, grabar, la pantalla).
// Solo en pruebas con jsdom.
import { coach as newCoach } from "../src/core/maspalomas";
import type { Engine } from "../src/engine";
import { legacyDocument } from "./dom-shape";
import { liveFunctions } from "./legacy";

export interface OldPitsOptions {
  // Lo que contesta el entrenador (por defecto, el de verdad con el análisis de la tanda).
  coach?: (analysis: unknown) => unknown;
  target?: number;
}

const FNS = [
  "fmt",
  "fmtSigned",
  "fmtLap",
  "setText",
  "tableRow",
  "pitsBrakes",
  "pitsCoach",
  "enterPits",
  "renderStoreLine",
  "setupTandaCut",
  "setupNombre",
  "engName",
  "cutSessionId",
];

interface OldPitsFns {
  enterPits(): void;
  pitsCoach(analysis: unknown): void;
  renderStoreLine(): void;
}

function oldFns(doc: Document, E: Engine, syncState: string, opts: OldPitsOptions): OldPitsFns {
  const pits = doc.getElementById("pits") as HTMLElement;
  return liveFunctions<OldPitsFns>(FNS, {
    consts: ["NF", "$", "hasDive", "fmtDive", "diveCell", "trailCell"],
    globals: {
      document: doc,
      E,
      ST: { sync: { state: syncState } },
      T: { analyze: () => E.pitsAnalysis, coach: opts.coach || newCoach },
      settings: { finish: { osm: 0, rev: 0 } },
      target: () => opts.target || 65,
      sessionOf: () => null,
      compactAnalysis: () => E.analysis,
      recFlush: () => {},
      saveMeta: () => {},
      show: (w: string) => {
        pits.hidden = w !== "pits";
      },
    },
  });
}

// Boxes entero, como al entrar (enterPits).
export function oldPits(E: Engine, syncState = "off", opts: OldPitsOptions = {}): Document {
  const doc = legacyDocument("pits", "flash");
  oldFns(doc, E, syncState, opts).enterPits();
  return doc;
}

// Solo el entrenador (pitsCoach) con un análisis cualquiera.
export function oldCoach(analysis: unknown, opts: OldPitsOptions): Document {
  const doc = legacyDocument("pits");
  oldFns(doc, {} as Engine, "off", opts).pitsCoach(analysis);
  return doc;
}

// Solo la línea de guardado (renderStoreLine), con la clase que tuviera antes.
export function oldStoreLine(E: Engine, syncState: string, prevClass = "muted"): HTMLElement {
  const doc = legacyDocument("pits");
  const el = doc.getElementById("p-store") as HTMLElement;
  el.className = prevClass;
  oldFns(doc, E, syncState, {}).renderStoreLine();
  return el;
}
