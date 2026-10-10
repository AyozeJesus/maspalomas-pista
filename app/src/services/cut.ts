// Cortar una grabación guardada en dos (una ruta que fue subida y bajada, dos tramos seguidos sin «Nuevo tramo», o dos
// tandas del circuito grabadas seguidas): se escriben las dos nuevas (trozos y resumen), se comprueba que están y se
// borra la entera. En el Mac, si ya se subió, queda también la entera.
import { chunksOf, idAt, lightSummary, splitSeries } from "../core/cortar";
import { VERSION, mergeChunks } from "../core/formato";
import type { Engine } from "../engine";
import type { PistaStore, RecordedChunk, SessionMeta } from "../storage";

export class CutError extends Error {}

// tCut: s desde el principio de la grabación. justFinished: el motor de la que acaba de terminar (se espera a que lo
// grabado esté guardado). Devuelve los resúmenes de las dos partes. Lanza CutError("demasiado corta") si una parte se
// quedaría casi vacía.
export async function cutSaved(
  store: PistaStore,
  sid: string,
  tCut: number,
  justFinished: Engine | null,
): Promise<SessionMeta[]> {
  if (justFinished && justFinished.rec && justFinished.rec.id === sid)
    await justFinished.rec.queue.catch(() => {});
  const meta = (await store.sessions()).find((s) => s.id === sid);
  if (!meta) throw new CutError("no está");
  const S = mergeChunks(await store.chunksOf(sid)).series;
  const A0 = S.acc;
  const L0 = S.loc;
  // Grabaciones de antes de unificar los relojes: los sensores iban con otro cero.
  const shift =
    A0 && L0 && A0.t.length && L0.t.length && Math.abs(A0.t[0] - L0.t[0]) > 60
      ? L0.t[0] - A0.t[0]
      : 0;
  const [A, B] = splitSeries(S, tCut, shift);
  if (!A.loc || !B.loc || A.loc.t.length < 10 || B.loc.t.length < 10)
    throw new CutError("demasiado corta");
  const epoch0 = meta.epoch as number;
  const epochB = epoch0 + Math.round(tCut * 1000);
  const sides: [typeof A, number, 1 | 2][] = [
    [A, epoch0, 1],
    [B, epochB, 2],
  ];
  const parts = sides.map(([series, epoch, parte]) => {
    const id = idAt(epoch);
    const rs = lightSummary(series);
    const m: SessionMeta = {
      ...meta,
      id,
      epoch,
      inicio: new Date(epoch).toISOString(),
      fin: new Date(epoch + rs.duracion * 1000).toISOString(),
      estado: "terminada",
      recorrido: rs,
      // Las vueltas y avisos de la entera no son de una parte: al verla se sacan otra vez.
      circuito: null,
      vueltas: [],
      caidas: null,
      analisis: null,
      corte: { de: meta.id, parte },
    };
    delete (m as { pend?: unknown }).pend;
    if (typeof meta.nombre === "string" && meta.nombre)
      m.nombre = meta.nombre.slice(0, 36) + " · " + parte;
    const chunks = chunksOf(series, id, epoch, VERSION) as unknown as RecordedChunk[];
    return { meta: m, chunks };
  });
  // Una parte sin trozos (un tiempo sin número al final de la grabación) no se guardaría: la entera se queda.
  if (parts.some((p) => !p.chunks.length)) throw new CutError("no se han guardado bien");
  try {
    for (const p of parts) {
      for (const c of p.chunks) await store.putChunk(c);
      await store.putSession(p.meta);
    }
    for (const p of parts)
      if ((await store.chunksOf(p.meta.id)).length !== p.chunks.length)
        throw new CutError("no se han guardado bien");
  } catch (e) {
    // A medias no se queda nada: se quitan las partes y la entera sigue como estaba.
    for (const p of parts) await store.deleteSession(p.meta.id).catch(() => {});
    throw e;
  }
  await store.deleteSession(sid);
  return parts.map((p) => p.meta);
}
