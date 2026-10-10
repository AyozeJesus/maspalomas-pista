// La app de antes del circuito de Maspalomas (track-data.js, sim.js, analysis.js y telemetry.js de la raíz del repo),
// cargada en el orden del navegador, para comparar con la versión nueva número a número.
// - Sus arrays tipados y sus errores son de otro contexto: toEqual daría por distintos dos Float64Array con los
//   mismos números, así que `plain` lo pasa todo a arrays y objetos normales antes de comparar.
// - telemetry.js no publicaba sus funciones internas (movingAvg, kalmanSpeed, cutLaps…): `legacyInternals` las
//   cuelga de `window` añadiendo una línea al código antes de ejecutarlo (los archivos no se tocan).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import type * as Analysis from "../src/core/maspalomas/analysis";
import type * as Coach from "../src/core/maspalomas/coach";
import type * as Demo from "../src/core/maspalomas/demo";
import type * as Distance from "../src/core/maspalomas/distance";
import type * as Grid from "../src/core/maspalomas/grid";
import type * as Kalman from "../src/core/maspalomas/kalman";
import type * as Laps from "../src/core/maspalomas/laps";
import type * as Metrics from "../src/core/maspalomas/metrics";
import type * as Numeric from "../src/core/maspalomas/numeric";
import type * as Sim from "../src/core/maspalomas/sim";
import type * as Telemetry from "../src/core/maspalomas/telemetry";
import type * as TrackM from "../src/core/maspalomas/track";
import type { MaspaGeo } from "../src/core/maspalomas/types";
import type * as Vec from "../src/core/maspalomas/vec3";
import { legacyFile, loadLegacy } from "./legacy";

export const LEGACY_FILES = ["track-data.js", "sim.js", "analysis.js", "telemetry.js"];

export interface LegacyMaspalomas {
  geo: MaspaGeo;
  sim: typeof Sim;
  analysis: typeof Analysis;
  telemetry: typeof Telemetry;
}

let loaded: LegacyMaspalomas | null = null;

// Los cuatro módulos de antes, cargados una vez por archivo de pruebas.
export function legacyMaspalomas(): LegacyMaspalomas {
  if (loaded) return loaded;
  const w = loadLegacy(...LEGACY_FILES);
  for (const g of ["MASPA_GEO", "MaspaSim", "MaspaAnalysis", "MaspaTelemetry"])
    if (!(g in w)) throw new Error("La app de antes no define " + g);
  loaded = {
    geo: w.MASPA_GEO as MaspaGeo,
    sim: w.MaspaSim as typeof Sim,
    analysis: w.MaspaAnalysis as typeof Analysis,
    telemetry: w.MaspaTelemetry as typeof Telemetry,
  };
  return loaded;
}

// Funciones internas de telemetry.js que se comparan una a una con las nuevas.
const INTERNALS = [
  "ring",
  "clamp",
  "interpAt",
  "resampleTo",
  "movingAvg",
  "norm3",
  "dot3",
  "cross3",
  "lineWithWidth",
  "matchFixes",
  "detectDirection",
  "curvAt",
  "toGrid",
  "idxOf",
  "gridAt",
  "kalmanSpeed",
  "segmentsOnTrack",
  "fuseDistance",
  "cutLaps",
  "cornerMetrics",
  "sectorTimes",
  "timeBetween",
  "maxBetween",
  "phaseBounds",
  "phasesOf",
  "whyOf",
  "lapVsRef",
  "gauss",
  "rng",
] as const;

export type LegacyInternals = Pick<
  typeof Numeric,
  "ring" | "clamp" | "interpAt" | "resampleTo" | "movingAvg"
> &
  Pick<typeof Vec, "norm3" | "dot3" | "cross3"> &
  Pick<typeof TrackM, "lineWithWidth" | "matchFixes" | "detectDirection" | "curvAt"> &
  Pick<typeof Grid, "toGrid" | "idxOf" | "gridAt"> &
  Pick<typeof Kalman, "kalmanSpeed"> &
  Pick<typeof Distance, "segmentsOnTrack" | "fuseDistance"> &
  Pick<typeof Laps, "cutLaps"> &
  Pick<typeof Metrics, "cornerMetrics" | "sectorTimes"> &
  Pick<
    typeof Coach,
    "timeBetween" | "maxBetween" | "phaseBounds" | "phasesOf" | "whyOf" | "lapVsRef"
  > &
  Pick<typeof Demo, "gauss" | "rng">;

let internals: LegacyInternals | null = null;

// Las mismas funciones de antes, también las que telemetry.js no publicaba.
export function legacyInternals(): LegacyInternals {
  if (internals) return internals;
  const sandbox: Record<string, unknown> = { console, performance, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of LEGACY_FILES) {
    let code = readFileSync(legacyFile(f), "utf8");
    if (f === "telemetry.js") {
      const at = code.indexOf("root.MaspaTelemetry = {");
      if (at < 0) throw new Error("telemetry.js ha cambiado: no encuentro dónde publica el módulo");
      code =
        code.slice(0, at) +
        "root.__internas = { " +
        INTERNALS.join(", ") +
        " };\n" +
        code.slice(at);
    }
    vm.runInContext(code, ctx, { filename: f });
  }
  internals = sandbox.__internas as LegacyInternals;
  return internals;
}

// Copia «normal» de un resultado para compararlo con toEqual: arrays tipados → arrays, objetos (también los de
// clases) → sus propiedades, funciones → una marca (no se pueden comparar; se prueban llamándolas).
export function plain(x: unknown): unknown {
  if (typeof x === "function") return "[función]";
  if (x === null || typeof x !== "object") return x;
  if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>);
  if (Array.isArray(x)) return x.map(plain);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x)) out[k] = plain((x as Record<string, unknown>)[k]);
  return out;
}

// Resultado o error (con su clase y mensaje) de una llamada, para comparar también los fallos.
export function outcome(fn: () => unknown): { ok: unknown } | { error: string } {
  try {
    return { ok: plain(fn()) };
  } catch (e) {
    if (e && typeof e === "object" && "message" in e)
      return { error: String("name" in e ? e.name : "Error") + ": " + String(e.message) };
    return { error: String(e) };
  }
}
