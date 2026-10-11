// Muelle: lo que llega del móvil por el túnel. Con la clave solo deja saludar, ver los tiempos del último día y AÑADIR
// trozos y resúmenes de tandas; no lee ni borra grabaciones.
import type { IncomingMessage, ServerResponse } from "node:http";
import { VERSION } from "../../app/src/core/formato";
import { authorized } from "./clave";
import { ORIGENES } from "./config";
import { computeDay } from "./dia";
import { send, sendJson } from "./http";
import { receiveChunk, receiveMeta } from "./recibir";
import { daysAvailable, listIds } from "./tandas";

export async function dock(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = req.headers.origin;
  if (origin && ORIGENES.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-gzip");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return send(res, 204);
  if (!authorized(req)) return sendJson(res, 401, { ok: false });
  const p = new URL(req.url || "/", "http://muelle").pathname;
  if (req.method === "GET" && p === "/api/hola")
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      tandas: listIds().length,
    });
  // Tiempos del último día rodado, para verlos en el móvil en boxes. Solo resúmenes (nombres, tiempos, sectores y lo
  // mejor de cada curva): ni grabaciones ni otros días.
  if (req.method === "GET" && p === "/api/dia") {
    const day = daysAvailable()[0];
    return sendJson(res, 200, day ? computeDay(day) : { fecha: null, pilotos: [] });
  }
  let m = /^\/api\/tandas\/([^/]+)\/trozos\/(\d{1,6})$/.exec(p);
  if (req.method === "PUT" && m) return receiveChunk(req, res, m[1], Number(m[2]));
  m = /^\/api\/tandas\/([^/]+)\/meta$/.exec(p);
  if (req.method === "PUT" && m) return receiveMeta(req, res, m[1]);
  sendJson(res, 404, { ok: false });
}
