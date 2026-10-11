// Rutas acabadas para probar el resumen de la ruta (src/ui/screens/ruta-fin): la vuelta de ejemplo repasada como ruta
// libre y, si está en este ordenador (PISTA_DATA), la ruta de verdad de Los Loros (subida y bajada), repasadas con el
// mismo motor que la app («Ver» una grabación guardada).
import { SERIES, type MergedSeriesSet } from "../src/core/formato";
import { demoSession } from "../src/core/maspalomas";
import { replayRecording, type Engine, type EngineHost, type ReplayMeta } from "../src/engine";
import { memoryKV, type KeyValueStore } from "../src/engine/kv";
import { DEFAULT_SETTINGS } from "../src/engine/settings";
import { realRide } from "./fixtures";

// La hora de la grabación de las pruebas (viernes, 9 de octubre de 2026).
export const EPOCH = Date.UTC(2026, 9, 9, 15, 23, 12);
export const LOROS = "20261009-172312-eck7.json";

export function testHost(kv: KeyValueStore = memoryKV()): EngineHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    kv,
    wallNow: () => EPOCH + 3600000,
    perfNow: () => 0,
    isCurrent: () => true,
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: {},
  };
}

type Raw = Record<string, Record<string, ArrayLike<number | null> | null | undefined> | undefined>;

// Las columnas de una grabación como las une la app (Float64Array, NaN donde no hay dato).
function merged(raw: Raw): MergedSeriesSet {
  const out: Record<string, Record<string, Float64Array>> = {};
  for (const key of ["loc", "acc", "gyro", "grav"] as const) {
    const s = raw[key];
    if (!s) continue;
    const o: Record<string, Float64Array> = {};
    for (const c of SERIES[key]) {
      const col = s[c];
      o[c] = col
        ? Float64Array.from(col, (x) => (typeof x === "number" ? x : NaN))
        : new Float64Array(0);
    }
    out[key] = o;
  }
  return out as MergedSeriesSet;
}

export function demoSeries(): MergedSeriesSet {
  return merged(demoSession({ seed: 7 }).session as unknown as Raw);
}

// Los Loros (null si no está en este ordenador).
export function lorosSeries(): MergedSeriesSet | null {
  return realSeries(LOROS);
}

// Una ruta de verdad de vivo-datos/ (null si no está en este ordenador).
export function realSeries(file: string): MergedSeriesSet | null {
  const r = realRide(file) as { series: Raw } | null;
  return r ? merged(r.series) : null;
}

// La ruta repasada («Ver»), con su resumen guardado (meta) y su almacén de tramos y circuitos (kv).
export function routeOf(
  series: MergedSeriesSet,
  meta: Partial<ReplayMeta> = {},
  kv: KeyValueStore = memoryKV(),
): Promise<Engine> {
  return replayRecording(
    testHost(kv),
    { v: 1, id: "20261009-172312-test", epoch: EPOCH, tipo: "ruta", ...meta },
    series,
    () => false,
    undefined,
    () => Promise.resolve(),
  );
}
