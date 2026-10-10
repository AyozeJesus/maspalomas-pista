// Carga módulos de la app de antes (los .js de la raíz del repo, tal cual se sirven al móvil) para comparar la
// versión nueva con ellos: mismos datos de entrada, misma salida. Se ejecutan en un contexto aparte, como scripts del
// navegador: cada uno se cuelga de `window` (MaspaTramos, MaspaTelemetry…).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const ROOT = resolve(import.meta.dirname, "../..");

export function legacyFile(file: string): string {
  return resolve(ROOT, file);
}

// Ejecuta los archivos en orden en un mismo contexto y devuelve su `window`.
export function loadLegacy(...files: string[]): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    console,
    performance,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) vm.runInContext(readFileSync(legacyFile(f), "utf8"), ctx, { filename: f });
  return sandbox;
}

// Un módulo concreto de esa `window`, con el tipo que le da quien lo pide.
export function legacy<T>(global: string, ...files: string[]): T {
  const w = loadLegacy(...files);
  if (!(global in w)) throw new Error("El módulo de antes no define " + global);
  return w[global] as T;
}
