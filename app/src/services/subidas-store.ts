// Lo guardado de las subidas de montaña (localStorage «pista-subidas», aparte de tus tramos): de cada una en cada
// sentido, el camino aprendido en su primera pasada y sus pasadas. La salida, la meta y el nombre salen siempre del
// catálogo (app/subidas): si una se corrige en otra versión, su camino aprendido se olvida (ya no va de salida a meta)
// y sus pasadas se quedan.
import { todasLasSubidas } from "../app/subidas";
import { isLatLon, needsPath, type LatLon, type StoredPass, type Tramo } from "../core/tramos";
import type { KeyValueStore } from "../engine/kv";
import { loadTramos, type TramoBook } from "./tramos-store";

export const SUBIDAS_KEY = "pista-subidas";

interface Guardada {
  id: string;
  salida?: LatLon;
  meta?: LatLon;
  pts?: LatLon[];
  largo?: number;
  pasadas?: StoredPass[];
}

// ¿El mismo punto? (a menos de 1 m)
const same = (a: unknown, b: LatLon) =>
  isLatLon(a) && Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;

function readSaved(kv: KeyValueStore): Map<string, Guardada> {
  const raw = kv.load<unknown>(SUBIDAS_KEY, []);
  const out = new Map<string, Guardada>();
  if (!Array.isArray(raw)) return out;
  for (const g of raw as Guardada[])
    if (g && typeof g === "object" && typeof g.id === "string") out.set(g.id, g);
  return out;
}

// Todas las subidas, en los dos sentidos, como tramos de salida y meta con lo suyo guardado.
export function loadSubidas(kv: KeyValueStore): Tramo[] {
  const saved = readSaved(kv);
  return todasLasSubidas().map((s) => {
    const g = saved.get(s.id);
    const tr: Tramo = {
      id: s.id,
      nombre: s.nombre,
      salida: s.salida,
      meta: s.meta,
      pasadas:
        g && Array.isArray(g.pasadas)
          ? g.pasadas.filter((p) => !!p && typeof p.tiempo === "number")
          : [],
    };
    if (g && same(g.salida, s.salida) && same(g.meta, s.meta) && !needsPath(g)) {
      tr.pts = g.pts;
      if (typeof g.largo === "number") tr.largo = g.largo;
    }
    return tr;
  });
}

// Guarda solo las que tienen algo (camino o pasadas), con su salida y su meta de ahora.
export function saveSubidas(kv: KeyValueStore, list: Tramo[]): void {
  const out: Guardada[] = [];
  for (const t of list) {
    if (!t.salida || !t.meta) continue;
    const hasPath = !needsPath(t);
    if (!hasPath && !(t.pasadas && t.pasadas.length)) continue;
    const g: Guardada = { id: t.id, salida: t.salida, meta: t.meta, pasadas: t.pasadas || [] };
    if (hasPath) {
      g.pts = t.pts;
      g.largo = t.largo;
    }
    out.push(g);
  }
  kv.store(SUBIDAS_KEY, out);
}

export const SUBIDAS_BOOK: TramoBook = { load: loadSubidas, save: saveSubidas };

// Tus tramos y las subidas: todo por lo que puede pasar una ruta (para su resumen).
export function allTramos(kv: KeyValueStore): Tramo[] {
  return [...loadTramos(kv), ...loadSubidas(kv)];
}
