// Un garaje de verdad para las pruebas: el servidor de garaje/server arrancado como lo arranca «Abrir garaje.command»
// (Node quitando los tipos), con puertos libres, una carpeta de datos temporal, sin túnel ni navegador.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { SERIES, type SeriesKey } from "../../src/core/formato";
import type { SensorSession } from "../../src/core/maspalomas/types";

export const REPO = resolve(import.meta.dirname, "../../..");
const MAIN = join(REPO, "garaje", "server", "main.ts");
// El origen de una app permitida (además del de GitHub Pages).
export const ORIGEN = "http://127.0.0.1:18766";

export interface GarajePrueba {
  datos: string;
  // http://127.0.0.1:<puerto> de cada puerta.
  muelle: string;
  garaje: string;
  puertoGaraje: number;
  clave(): string;
  log(): string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => res(port));
    });
  });
}

function waitOpen(p: ChildProcess, out: () => string): Promise<void> {
  return new Promise((res, rej) => {
    const t = setInterval(() => {
      if (/Garaje abierto/.test(out())) {
        clearInterval(t);
        res();
      }
    }, 50);
    p.once("exit", (code) => {
      clearInterval(t);
      rej(new Error("el garaje ha salido (" + code + "): " + out()));
    });
  });
}

// Abre un garaje (en `datos` si se da, para probar un reinicio con los mismos datos).
export async function abrirGaraje(
  opts: { datos?: string; env?: Record<string, string | undefined> } = {},
): Promise<GarajePrueba> {
  const datos = opts.datos ?? mkdtempSync(join(tmpdir(), "garaje-prueba-"));
  const pm = await freePort();
  const pg = await freePort();
  const env: Record<string, string | undefined> = {
    ...process.env,
    GARAJE_DATOS: datos,
    GARAJE_SIN_TUNEL: "1",
    GARAJE_SIN_NAVEGADOR: "1",
    GARAJE_PUERTO_MUELLE: String(pm),
    GARAJE_PUERTO: String(pg),
    GARAJE_ORIGENES: ORIGEN,
    ...opts.env,
  };
  const p = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", MAIN],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  p.stdout?.on("data", (d: Buffer) => (out += d));
  p.stderr?.on("data", (d: Buffer) => (out += d));
  await waitOpen(p, () => out);
  return {
    datos,
    muelle: "http://127.0.0.1:" + pm,
    garaje: "http://127.0.0.1:" + pg,
    puertoGaraje: pg,
    clave: () =>
      (JSON.parse(readFileSync(join(datos, "config.json"), "utf8")) as { clave: string }).clave,
    log: () => out,
    stop: () =>
      new Promise<void>((res) => {
        if (p.exitCode !== null) return res();
        p.once("exit", () => res());
        p.kill("SIGINT");
      }),
  };
}

type Columnas = Record<string, (number | null)[]>;

export interface Trozo {
  v: number;
  id: string;
  seq: number;
  epoch: number;
  series: Partial<Record<SeriesKey, Columnas>>;
}

// Los trozos que mandaría el móvil de una tanda: cada `every` s de grabación, sus series (como formato.SERIES).
export function chunksOf(
  session: SensorSession,
  id: string,
  epoch: number,
  every: number,
): Trozo[] {
  const tEnd = session.loc.t[session.loc.t.length - 1];
  const out: Trozo[] = [];
  let seq = 0;
  for (let a = -1; a <= tEnd + every; a += every) {
    const series: Trozo["series"] = {};
    for (const key of ["loc", "acc", "gyro", "grav"] as const) {
      const s = session[key] as unknown as Record<string, ArrayLike<number>> | undefined;
      if (!s) continue;
      const idx: number[] = [];
      for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] < a + every) idx.push(i);
      if (!idx.length) continue;
      const o: Columnas = {};
      for (const c of SERIES[key]) o[c] = idx.map((i) => s[c][i]);
      series[key] = o;
    }
    if (Object.keys(series).length) out.push({ v: 1, id, seq: seq++, epoch, series });
  }
  return out;
}

// PUT al muelle con la clave (comprimido con gzip si se pide, o un cuerpo crudo).
export function put(
  url: string,
  obj: unknown,
  opts: { key: string; gzip?: boolean; raw?: string | Buffer },
): Promise<Response> {
  let body: string | Buffer = JSON.stringify(obj);
  const headers: Record<string, string> = { Authorization: "Bearer " + opts.key, Origin: ORIGEN };
  if (opts.gzip) {
    body = gzipSync(body);
    headers["X-Gzip"] = "1";
    headers["Content-Type"] = "application/octet-stream";
  } else headers["Content-Type"] = "application/json";
  if (opts.raw !== undefined) body = opts.raw;
  return fetch(url, { method: "PUT", headers, body: new Uint8Array(Buffer.from(body)) });
}

// Lo que el móvil manda de una tanda de circuito al terminar.
export function metaOf(id: string, epoch: number, extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    id,
    epoch,
    inicio: new Date(epoch).toISOString(),
    fin: null,
    estado: "terminada",
    sim: false,
    meta: { osm: 0, rev: 0 },
    vueltas: [],
    ...extra,
  };
}

// Sube una tanda entera (trozos de 30 s comprimidos y su resumen) por el muelle.
export async function upload(
  g: GarajePrueba,
  id: string,
  epoch: number,
  session: SensorSession,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const key = g.clave();
  for (const c of chunksOf(session, id, epoch, 30)) {
    const r = await put(g.muelle + "/api/tandas/" + id + "/trozos/" + c.seq, c, {
      key,
      gzip: true,
    });
    if (r.status !== 200) throw new Error("trozo → " + r.status);
  }
  const r = await put(g.muelle + "/api/tandas/" + id + "/meta", metaOf(id, epoch, extra), {
    key,
    gzip: true,
  });
  if (r.status !== 200) throw new Error("meta → " + r.status);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Espera (hasta `ms`) a que la condición se cumpla con lo que devuelve `get`.
export async function until<T>(
  get: () => Promise<T>,
  ok: (x: T) => boolean,
  ms = 60000,
): Promise<T> {
  const end = Date.now() + ms;
  let x = await get();
  while (!ok(x) && Date.now() < end) {
    await sleep(250);
    x = await get();
  }
  return x;
}
