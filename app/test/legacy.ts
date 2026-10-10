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

// Funciones sueltas del live.js de antes (no se publicaban en `window`): se copia su texto, desde «  function nombre(»
// hasta su «  }», y se ejecutan en un contexto aparte. consts: las constantes que usan («NF»…), copiadas igual hasta
// su «;». globals: lo que esperan encontrar en `window` (localStorage, MaspaTramos…).
export function liveFunctions<T>(
  names: string[],
  opts: { consts?: string[]; globals?: Record<string, unknown> } = {},
): T {
  const src = readFileSync(legacyFile("live.js"), "utf8");
  const pieces: string[] = [];
  for (const c of opts.consts || []) {
    const start = src.indexOf("\n  const " + c + " =");
    if (start < 0) throw new Error("live.js no define la constante " + c);
    pieces.push(src.slice(start, src.indexOf(";\n", start) + 1));
  }
  for (const n of names) {
    const start = src.indexOf("\n  function " + n + "(");
    if (start < 0) throw new Error("live.js no define la función " + n);
    pieces.push(src.slice(start, src.indexOf("\n  }\n", start) + 4));
  }
  const sandbox: Record<string, unknown> = { ...opts.globals };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Las constantes también se pueden pedir (las hay que son funciones: «const fmtDive = (b) => …»).
  const all = names.concat(opts.consts || []);
  vm.runInContext(pieces.join("\n") + "\nwindow.__fns = { " + all.join(", ") + " };", sandbox, {
    filename: "live.js",
  });
  return sandbox.__fns as T;
}

// Un módulo concreto de esa `window`, con el tipo que le da quien lo pide.
export function legacy<T>(global: string, ...files: string[]): T {
  const w = loadLegacy(...files);
  if (!(global in w)) throw new Error("El módulo de antes no define " + global);
  return w[global] as T;
}
