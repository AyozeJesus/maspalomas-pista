// Las tandas guardadas en este Mac: una carpeta por tanda (el id del móvil) con sus trozos (trozos/*.json.gz),
// meta.json (el resumen que manda el móvil), resumen.json (el análisis del Mac) e informe.json (el de la IA).
import { readdirSync, readFileSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  csvFiles,
  ID_RE,
  mergeChunks,
  type ChunkLike,
  type CsvFile,
} from "../../app/src/core/formato";
import type { Finish, MetaTanda, Stamp } from "../api";
import { isNum, readObject } from "./archivos";
import { DATOS, TANDAS } from "./config";

export function tandaDir(id: string): string {
  return join(TANDAS, id);
}

// Las tandas, de la más nueva a la más vieja (el id empieza por la fecha y la hora).
export function listIds(): string[] {
  try {
    return readdirSync(TANDAS)
      .filter((n) => ID_RE.test(n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function chunkFiles(id: string): string[] {
  try {
    return readdirSync(join(tandaDir(id), "trozos"))
      .filter((n) => /^\d{6}\.json\.gz$/.test(n))
      .sort();
  } catch {
    return [];
  }
}

function readChunks(id: string): ChunkLike[] {
  return chunkFiles(id).map(
    (n) =>
      JSON.parse(
        gunzipSync(readFileSync(join(tandaDir(id), "trozos", n))).toString("utf8"),
      ) as ChunkLike,
  );
}

// Los CSV de una tanda (como los de Sensor Logger) y la hora de su inicio; null si aún no tiene trozos.
export function filesOf(id: string): { epoch: number; files: CsvFile[] } | null {
  const chunks = readChunks(id);
  if (!chunks.length) return null;
  const merged = mergeChunks(chunks);
  if (merged.epoch === null) return null;
  return {
    epoch: merged.epoch,
    files: csvFiles(merged.series, merged.epoch),
  };
}

export function readMeta(id: string): MetaTanda | null {
  return readObject<MetaTanda>(join(tandaDir(id), "meta.json"));
}

// Huella de lo recibido: si cambia, el resumen se vuelve a calcular.
export function stampOf(id: string): Stamp {
  const files = chunkFiles(id);
  let bytes = 0;
  for (const n of files) bytes += statSync(join(tandaDir(id), "trozos", n)).size;
  const meta = readMeta(id);
  return {
    trozos: files.length,
    bytes,
    meta: meta ? JSON.stringify(meta.meta || null) : "",
  };
}

// La línea de meta que tenía el móvil (la de por defecto si no la manda).
export function finishOf(meta: MetaTanda | null): Finish {
  const f = meta && meta.meta;
  return {
    osm: f && isNum(f.osm) ? f.osm : 0,
    rev: f && isNum(f.rev) ? f.rev : 0,
  };
}

export function finishKey(f: Finish): string {
  return f.osm + "-" + f.rev;
}

export function freeBytes(): number {
  try {
    const s = statfsSync(DATOS);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

// El día de una tanda (AAAAMMDD, del id).
export function dayOf(id: string): string {
  return id.slice(0, 8);
}

export interface TandaReal {
  id: string;
  meta: MetaTanda | null;
}

// Las tandas de circuito de verdad: sin el simulador ni las rutas libres.
export function realTandas(): TandaReal[] {
  return listIds()
    .map((id) => ({ id, meta: readMeta(id) }))
    .filter((t) => !(t.meta && (t.meta.sim || t.meta.tipo === "ruta")));
}

// Los días con tandas de circuito, del más nuevo al más viejo.
export function daysAvailable(): string[] {
  return [...new Set(realTandas().map((t) => dayOf(t.id)))];
}

// El nombre del piloto de una tanda (30 letras como mucho), o el de por defecto.
export function pilotOf(meta: MetaTanda | null, trim: boolean): string {
  const p = meta && typeof meta.piloto === "string" ? meta.piloto : null;
  return (p !== null && (trim ? p.trim() : p).slice(0, 30)) || "Sin nombre";
}
