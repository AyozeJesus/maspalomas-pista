// «Buscar» un tramo en todas las rutas y tandas guardadas en el móvil (y al guardar uno nuevo de salida y meta): sus
// pasadas, sin repetir las que ya tenía; la primera pasada le enseña el camino a un tramo de salida y meta.
import { SERIES } from "../../../../core/formato";
import {
  findGatePasses,
  findPasses,
  gatePass,
  learnPath,
  needsPath,
  type GateTramo,
  type LocSeries,
  type PathTramo,
} from "../../../../core/tramos";
import type { KeyValueStore } from "../../../../engine/kv";
import type { ListedSession } from "../../../../services/history";
import { isGateTramo, loadTramos, recordPass, saveTramos } from "../../../../services/tramos-store";
import type { PistaStore, StoredChunk } from "../../../../storage";

export interface ScanDeps {
  kv: KeyValueStore;
  store: Pick<PistaStore, "sessions" | "chunksOf"> | null;
}

type LocColumns = Record<(typeof SERIES.loc)[number], number[]>;

// Solo las posiciones de una grabación (sin juntar los sensores, que en una ruta larga son millones de datos), con
// NaN donde no hay dato.
export function locOf(chunks: readonly StoredChunk[]): LocSeries {
  const out: LocColumns = { t: [], lat: [], lon: [], speed: [], hacc: [] };
  for (const ch of chunks.slice().sort((a, b) => a.seq - b.seq)) {
    const s = ch.series && ch.series.loc;
    if (!s) continue;
    for (const c of SERIES.loc) {
      const col = s[c];
      for (let i = 0; i < col.length; i++) {
        const x = col[i];
        out[c].push(x === null ? NaN : x);
      }
    }
  }
  return out;
}

// Devuelve cuántas pasadas nuevas. onProgress(i, total): por qué grabación va (para el botón).
export async function scanTramo(
  deps: ScanDeps,
  id: string,
  onProgress?: (i: number, total: number) => void,
): Promise<number> {
  const { kv, store } = deps;
  const tr = loadTramos(kv).find((x) => x.id === id);
  if (!tr || !store) return 0;
  const before = (tr.pasadas || []).length;
  const list = (await store.sessions())
    .map((s) => s as ListedSession)
    .filter((s) => !s.sim && s.estado !== "grabando");
  for (let i = 0; i < list.length; i++) {
    if (onProgress) onProgress(i + 1, list.length);
    const s = list[i];
    const epoch = Number(s.epoch);
    let loc: LocSeries;
    try {
      loc = locOf(await store.chunksOf(s.id));
    } catch {
      continue;
    }
    if (!loc.t.length) continue;
    if (isGateTramo(tr)) {
      // De salida a meta: cada pasada; la primera enseña el camino al tramo (para la meta, las marcas y comparar).
      const now = loadTramos(kv).find((x) => x.id === id);
      if (!now) break;
      for (const w of findGatePasses(now as GateTramo, loc)) {
        const all = loadTramos(kv);
        const cur = all.find((x) => x.id === id);
        if (!cur) break;
        if (needsPath(cur)) {
          const g = learnPath(cur as GateTramo, loc, w.t0, w.t1);
          if (g) {
            cur.pts = g.pts;
            cur.largo = g.largo;
            saveTramos(kv, all);
          }
        }
        recordPass(kv, id, s.id, epoch, gatePass(cur as GateTramo, loc, w.t0, w.t1));
      }
    } else for (const p of findPasses(tr as PathTramo, loc)) recordPass(kv, id, s.id, epoch, p);
    // Entre grabación y grabación, la página respira (el botón dice por cuál va).
    await new Promise((r) => setTimeout(r, 0));
  }
  const after = loadTramos(kv).find((x) => x.id === id);
  return after ? (after.pasadas || []).length - before : 0;
}
