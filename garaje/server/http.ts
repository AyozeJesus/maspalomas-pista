// Lo común de las dos puertas: contestar, leer el cuerpo con límite y convertir los errores en respuestas.
import type { IncomingMessage, ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import { MAX_JSON } from "./config";
import { log } from "./log";

// Un error con su código HTTP y un mensaje para quien usa el garaje (sin nombres internos).
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function httpError(status: number, message: string): HttpError {
  return new HttpError(status, message);
}

export function send(
  res: ServerResponse,
  status: number,
  body?: string | Buffer,
  type?: string,
  extra?: Record<string, string>,
): void {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(body === undefined ? "" : body);
}

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  send(res, status, JSON.stringify(obj));
}

// Lee el cuerpo hasta `max` bytes. Si se pasa, lo sigue leyendo sin guardarlo para poder contestar 413 (cortar la
// conexión a medias lo vería el móvil como «sin red» y reintentaría siempre); con un envío desmesurado (4× el máximo)
// sí se corta.
export function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    let over = Number(req.headers["content-length"]) > max;
    req.on("data", (d: Buffer) => {
      size += d.length;
      if (size > max) over = true;
      if (!over) parts.push(d);
      else if (size > 4 * max) {
        req.destroy();
        reject(httpError(413, "demasiado grande"));
      }
    });
    req.on("end", () => {
      if (over) reject(httpError(413, "demasiado grande"));
      else resolve(Buffer.concat(parts));
    });
    req.on("error", reject);
  });
}

// El cuerpo como JSON (comprimido con gzip si lo dice la cabecera X-Gzip: 1).
export async function readJsonBody(req: IncomingMessage, max: number): Promise<unknown> {
  let buf = await readBody(req, max);
  if (req.headers["x-gzip"] === "1") {
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_JSON });
    } catch (e) {
      throw httpError(e instanceof RangeError ? 413 : 400, "no se puede descomprimir");
    }
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw httpError(400, "JSON no válido");
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

// Una puerta: lo que falle se contesta con su código (500 si no es un error conocido, que además va al registro).
export function handler(fn: Handler): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e: unknown) => {
        const status = e instanceof HttpError && e.status ? e.status : 500;
        if (status === 500) log("error:", e instanceof Error && e.stack ? e.stack : e);
        if (!res.headersSent && !res.destroyed)
          sendJson(res, status, {
            ok: false,
            error: (e instanceof Error && e.message) || "error",
          });
      });
  };
}
