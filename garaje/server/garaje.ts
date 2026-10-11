// La puerta del garaje (solo este Mac): las páginas, la lista de tandas, su análisis, el progreso, la comparativa del
// día, el informe de la IA y las acciones (importar un vídeo de GoPro, cambiar la clave, abrir en el Finder).
import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ID_RE } from "../../app/src/core/formato";
import type { ArchivosTanda, EstadoGaraje } from "../api";
import { summaryOf } from "./analisis";
import { rotateKey } from "./clave";
import { DATOS, PUERTO } from "./config";
import { computeDay } from "./dia";
import { staticFile } from "./estaticos";
import { httpError, readJsonBody, send, sendJson } from "./http";
import { iaEstado, iaSaveKey, informe, informeGuardado } from "./informe-ia";
import { computeProgress } from "./progreso";
import { receiveChunk, receiveMeta } from "./recibir";
import { daysAvailable, filesOf, freeBytes, listIds, readMeta, tandaDir } from "./tandas";
import { pairingLink, tunnel } from "./tunel";

function checkId(id: string): void {
  if (!ID_RE.test(id)) throw httpError(400, "id no válido");
}

export async function garage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Solo por 127.0.0.1/localhost: una web de fuera no puede hacerse pasar por el garaje.
  const host = String(req.headers.host || "");
  if (host !== "127.0.0.1:" + PUERTO && host !== "localhost:" + PUERTO)
    return send(res, 403, "", "text/plain");
  const url = new URL(req.url || "/", "http://garaje");
  const p = url.pathname;
  if (req.method === "GET") {
    const s = staticFile(p);
    if (s && "redirect" in s) return send(res, 302, "", "text/plain", { Location: s.redirect });
    if (s) return send(res, 200, s.body, s.type);
  }
  if (req.method === "GET" && p === "/api/estado") {
    const estado: EstadoGaraje = {
      datos: DATOS,
      tunel: tunnel.url,
      tunelEstado: tunnel.estado,
      enlace: pairingLink(),
      espacioLibre: freeBytes(),
    };
    return sendJson(res, 200, estado);
  }
  if (req.method === "GET" && p === "/api/tandas")
    return sendJson(res, 200, { tandas: listIds().map(summaryOf) });
  if (req.method === "GET" && p === "/api/progreso") return sendJson(res, 200, computeProgress());
  if (req.method === "GET" && p === "/api/dia") {
    const days = daysAvailable();
    const asked = url.searchParams.get("fecha");
    const day = asked !== null && days.includes(asked) ? asked : days[0];
    return sendJson(
      res,
      200,
      Object.assign(day ? computeDay(day) : { fecha: null, pilotos: [] }, {
        dias: days,
      }),
    );
  }
  let m = /^\/api\/tandas\/([^/]+)\/archivos$/.exec(p);
  if (req.method === "GET" && m) {
    checkId(m[1]);
    const data = filesOf(m[1]);
    if (!data) throw httpError(404, "sin datos");
    const out: ArchivosTanda = Object.assign({ meta: readMeta(m[1]) }, data);
    return sendJson(res, 200, out);
  }
  // Informe con IA: si hay clave (nunca se devuelve) y el último informe de la tanda.
  if (req.method === "GET" && p === "/api/ia") return sendJson(res, 200, iaEstado());
  m = /^\/api\/tandas\/([^/]+)\/informe$/.exec(p);
  if (req.method === "GET" && m) {
    checkId(m[1]);
    return sendJson(res, 200, { informe: informeGuardado(m[1]) });
  }
  // Las acciones piden una cabecera propia: otra web abierta en este Mac no puede mandarla sin permiso CORS.
  if (req.method === "POST" && req.headers["x-garaje"] !== "1")
    return sendJson(res, 403, { ok: false });
  // Importar una tanda desde este Mac (p. ej. la telemetría de un vídeo de GoPro): mismos trozos y resumen que manda
  // el móvil, con las mismas comprobaciones.
  m = /^\/api\/importar\/([^/]+)\/trozos\/(\d{1,6})$/.exec(p);
  if (req.method === "POST" && m) return receiveChunk(req, res, m[1], Number(m[2]));
  m = /^\/api\/importar\/([^/]+)\/meta$/.exec(p);
  if (req.method === "POST" && m) return receiveMeta(req, res, m[1]);
  if (req.method === "POST" && p === "/api/clave-nueva") {
    rotateKey();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/ia") {
    const body = (await readJsonBody(req, 4096)) as { clave?: unknown } | null;
    iaSaveKey(body && typeof body.clave === "string" ? body.clave.trim() : null);
    return sendJson(res, 200, { ok: true, ...iaEstado() });
  }
  // Una sola petición a la vez por tanda: un segundo toque espera a la misma.
  m = /^\/api\/tandas\/([^/]+)\/informe$/.exec(p);
  if (req.method === "POST" && m) {
    checkId(m[1]);
    return sendJson(res, 200, { ok: true, informe: await informe(m[1]) });
  }
  m = /^\/api\/tandas\/([^/]+)\/finder$/.exec(p);
  if (req.method === "POST" && (m || p === "/api/finder")) {
    if (m) checkId(m[1]);
    const target = m ? tandaDir(m[1]) : DATOS;
    spawn("open", m ? ["-R", target] : [target], { stdio: "ignore" }).on("error", () => {});
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { ok: false });
}
