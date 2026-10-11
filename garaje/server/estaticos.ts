// Lo que el garaje sirve al navegador de este Mac: sus dos páginas, el icono y los módulos que cargan.
// Un módulo se pide por su ruta en el repo (/garaje/web/garaje.ts, /app/src/core/formato…), así que sus imports
// relativos funcionan igual en el navegador que en el repo. Los .ts van sin tipos, como JavaScript (ts.ts); las
// librerías de fuera (three, JSZip), tal cual desde garaje/web/vendor/. Nada más: ni datos, ni otros archivos.
import { readFileSync, realpathSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { REPO } from "./config";
import { browserModule, resolveTs } from "./ts";

const WEB = join(REPO, "garaje", "web");

const PAGES: Record<string, string> = {
  "/": join(WEB, "index.html"),
  "/analisis": join(WEB, "analisis.html"),
  "/icon.png": join(REPO, "app", "public", "icon-192.png"),
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

// Las carpetas de las que se sirven módulos: las páginas del garaje y el código de la app que comparten (cálculos,
// dibujos y la vista 3D).
const ROOTS = ["garaje/web/", "app/src/"];
const VENDOR = "garaje/web/vendor/";
const REAL_ROOTS = ROOTS.map((r) => realpathSync(join(REPO, r)) + sep);

// Dentro de esas carpetas de verdad (un enlace simbólico no saca de ellas).
function inside(file: string): boolean {
  try {
    const real = realpathSync(file);
    return REAL_ROOTS.some((r) => real.startsWith(r));
  } catch {
    return false;
  }
}

export type Static = { body: string | Buffer; type: string } | { redirect: string };

// Lo que hay que contestar a un GET de esa ruta, o null si no es nada que el garaje sirva.
export function staticFile(pathname: string): Static | null {
  const page = PAGES[pathname];
  if (page) return { body: readFileSync(page), type: TYPES[extname(page)] };
  // Solo rutas sencillas (letras, números, «_», «-», «.» y «/»), sin «//» ni nada que empiece por punto (ni «..»).
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(pathname) || /\/\.|\/\//.test(pathname)) return null;
  const rel = pathname.slice(1);
  if (!ROOTS.some((r) => rel.startsWith(r))) return null;
  const abs = join(REPO, rel);
  if (rel.startsWith(VENDOR) && rel.endsWith(".js"))
    return inside(abs) ? { body: readFileSync(abs), type: TYPES[".js"] } : null;
  if (/\.(test|d)\.ts$/.test(rel)) return null;
  const file = resolveTs(abs);
  if (!file || !inside(file)) return null;
  // Una carpeta («../maspalomas»): a su index.ts, para que sus imports relativos partan de la carpeta.
  if (file !== abs && file !== abs + ".ts")
    return { redirect: "/" + relative(REPO, file).split(sep).join("/") };
  return { body: browserModule(file), type: TYPES[".js"] };
}
