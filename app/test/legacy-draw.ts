// Como legacy.ts, para los módulos de antes que pintan o tocan el navegador (mapa.js, compartir.js…): el contexto
// lleva además lo del navegador que piden (document, devicePixelRatio, navigator, File, URL…). El código de antes lo
// busca en `window` cada vez que lo usa, así que cada prueba le pone lo suyo antes de llamarlo
// (win.document = …, win.devicePixelRatio = …).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { legacyFile } from "./legacy";

// Ejecuta los archivos en orden en un mismo contexto, con `globals` en su `window`, y devuelve esa `window`.
export function loadLegacyDraw(
  globals: Record<string, unknown>,
  ...files: string[]
): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    ...globals,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) vm.runInContext(readFileSync(legacyFile(f), "utf8"), ctx, { filename: f });
  return sandbox;
}

// Un módulo concreto de esa `window` (con el tipo que le da quien lo pide) y la `window`, para ponerle lo del
// navegador en cada prueba.
export function legacyDraw<T>(
  global: string,
  ...files: string[]
): { mod: T; win: Record<string, unknown> } {
  const win = loadLegacyDraw({}, ...files);
  if (!(global in win)) throw new Error("El módulo de antes no define " + global);
  return { mod: win[global] as T, win };
}
