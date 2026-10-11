// Guardar lo que llega de una tanda: trozos de grabación y su resumen, con las mismas comprobaciones venga del móvil
// (por el muelle) o de este Mac (un vídeo de GoPro importado en la página del garaje).
import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  checkChunk,
  checkMeta,
  cleanChunk,
  ID_RE,
  type ChunkLike,
} from "../../app/src/core/formato";
import type { MetaTanda } from "../api";
import { writeAtomic } from "./archivos";
import { MAX_META, MAX_TROZO, MIN_LIBRE } from "./config";
import { httpError, readJsonBody, sendJson } from "./http";
import { log } from "./log";
import { freeBytes, tandaDir } from "./tandas";

export async function receiveChunk(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  seq: number,
): Promise<void> {
  if (!ID_RE.test(id)) throw httpError(400, "id no válido");
  if (freeBytes() < MIN_LIBRE) throw httpError(507, "disco casi lleno");
  const obj = await readJsonBody(req, MAX_TROZO);
  const err = checkChunk(obj, id, seq);
  if (err) throw httpError(400, err);
  const dir = join(tandaDir(id), "trozos");
  mkdirSync(dir, { recursive: true });
  // checkChunk ya ha comprobado que es un trozo bien formado.
  const data = gzipSync(JSON.stringify(cleanChunk(obj as ChunkLike & { id: string })));
  writeAtomic(join(dir, String(seq).padStart(6, "0") + ".json.gz"), data);
  log("tanda", id, "· trozo", seq, "(" + Math.round(data.length / 1024) + " KB)");
  sendJson(res, 200, { ok: true });
}

export async function receiveMeta(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (!ID_RE.test(id)) throw httpError(400, "id no válido");
  const obj = await readJsonBody(req, MAX_META);
  const err = checkMeta(obj, id);
  if (err) throw httpError(400, err);
  // checkMeta ya ha comprobado que es un objeto con v, id, epoch y vueltas.
  const meta = obj as MetaTanda;
  mkdirSync(tandaDir(id), { recursive: true });
  meta.recibido = new Date().toISOString();
  writeAtomic(join(tandaDir(id), "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  log("tanda", id, "· resumen (" + (meta.estado || "?") + ")");
  sendJson(res, 200, { ok: true });
}
