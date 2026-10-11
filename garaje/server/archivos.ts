// Escribir sin dejar nunca un archivo a medias (se escribe aparte y se renombra) y leer JSON sin romperse.
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export function writeAtomic(file: string, data: string | Buffer, mode?: number): void {
  const tmp = file + "." + process.pid + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, data, { mode: mode || 0o644 });
  renameSync(tmp, file);
}

// El JSON de un archivo, o null si falta o está roto.
export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Lo mismo, solo si es un objeto (lo que se espera de cada .json del garaje).
export function readObject<T extends object>(file: string): T | null {
  const v = readJson(file);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
}

// Número de verdad (ni NaN, ni infinito, ni otra cosa): Number.isFinite, pero que TypeScript lo entienda.
export function isNum(x: unknown): x is number {
  return Number.isFinite(x);
}
