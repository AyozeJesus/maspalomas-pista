// El TypeScript del garaje corre sin compilar: Node le quita los tipos al cargarlo (el servidor) y al servirlo al
// navegador (las páginas del garaje), así que el Mac no necesita npm ni construir nada.
// Los imports de la app van sin extensión («./types», «../maspalomas»), como los resuelve Vite; aquí se resuelven
// igual: al .ts, o al index.ts si es una carpeta.
import { readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// El archivo de un import relativo ya convertido en ruta absoluta: tal cual si acaba en .ts; si no, <ruta>.ts o
// <ruta>/index.ts. null si no hay ninguno.
export function resolveTs(path: string): string | null {
  if (path.endsWith(".ts")) return isFile(path) ? path : null;
  if (isFile(path + ".ts")) return path + ".ts";
  const index = join(path, "index.ts");
  return isFile(index) ? index : null;
}

// Un .ts como módulo para el navegador: los tipos cambiados por espacios, así que cada línea y columna es la misma que
// en el .ts (un error en la consola señala la línea buena). Se guarda mientras el archivo no cambie.
const cache = new Map<string, { mtimeMs: number; size: number; js: string }>();

export function browserModule(file: string): string {
  const st = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.js;
  const js = stripTypeScriptTypes(readFileSync(file, "utf8"), {
    mode: "strip",
  });
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, js });
  return js;
}
