// Grabaciones de verdad (PISTA_DATA) convertidas en lo que lee la telemetría del circuito: los CSV de Sensor Logger
// que saca el garaje de los trozos de una tanda (formato.mergeChunks + csvFiles), como en garaje/server.js. Nunca
// se copian al repo (llevan la posición de quien graba).
import { csvFiles, mergeChunks, type CsvFile, type StoredSeriesSet } from "../src/core/formato";
import { realRide } from "./fixtures";

// Las grabaciones del 9 de octubre en vivo-datos/ (rutas por carretera: ninguna pasa por el circuito; la última,
// sin GPS).
export const REAL_RIDES = [
  "20261009-163105-bn2o.json",
  "20261009-170613-a0l8.json",
  "20261009-171527-csvc.json",
  "20261009-172312-eck7.json",
  "20261009-183824-woqw.json",
];

interface Recording {
  meta: { epoch: number };
  series: StoredSeriesSet;
}

function isRecording(x: unknown): x is Recording {
  if (!x || typeof x !== "object") return false;
  const r = x as { meta?: unknown; series?: unknown };
  const meta = r.meta as { epoch?: unknown } | undefined;
  return !!meta && typeof meta.epoch === "number" && !!r.series && typeof r.series === "object";
}

// Los CSV de una grabación (null si no está en este ordenador).
export function realCsv(file: string): CsvFile[] | null {
  const ride: unknown = realRide(file);
  if (ride === null) return null;
  if (!isRecording(ride)) throw new Error(file + ": no parece una grabación");
  const merged = mergeChunks([{ seq: 0, epoch: ride.meta.epoch, series: ride.series }]);
  return csvFiles(merged.series as Parameters<typeof csvFiles>[0], ride.meta.epoch);
}
