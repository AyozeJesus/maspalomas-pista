// La clave del muelle: se crea la primera vez y se guarda en config.json (solo legible por tu usuario). El móvil la
// recibe al escanear el código y la manda en cada subida.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { writeAtomic } from "./archivos";
import { DATOS } from "./config";
import { log } from "./log";

const CONFIG_FILE = join(DATOS, "config.json");

interface Config {
  clave: string;
  creado?: string;
}

let cfg: Config | null = null;
let auth = Buffer.alloc(0);

function newConfig(): Config {
  const c = {
    clave: randomBytes(24).toString("base64url"),
    creado: new Date().toISOString(),
  };
  writeAtomic(CONFIG_FILE, JSON.stringify(c, null, 2) + "\n", 0o600);
  return c;
}

function loadConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config> | null;
    if (c && typeof c.clave === "string" && c.clave.length >= 32) return c as Config;
  } catch {
    /* primera vez */
  }
  return newConfig();
}

function setKey(c: Config): void {
  cfg = c;
  auth = Buffer.from("Bearer " + c.clave);
}

// Al arrancar, con la carpeta de datos ya creada.
export function initKey(): void {
  setKey(loadConfig());
}

export function currentKey(): string {
  if (!cfg) throw new Error("La clave del garaje aún no está cargada.");
  return cfg.clave;
}

// Clave nueva: los móviles emparejados dejan de poder subir hasta que escaneen el código otra vez (para cortar el
// acceso a un móvil prestado).
export function rotateKey(): void {
  setKey(newConfig());
  log("Clave cambiada: los móviles tienen que escanear el código nuevo.");
}

export function authorized(req: IncomingMessage): boolean {
  if (!cfg) return false;
  const h = Buffer.from(String(req.headers.authorization || ""));
  return h.length === auth.length && timingSafeEqual(h, auth);
}
