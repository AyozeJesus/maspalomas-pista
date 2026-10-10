// Cambiar tus tramos desde la portada (localStorage «pista-tramos»): guardar uno nuevo de salida y meta, cambiarle el
// nombre a uno o borrarlo. Al leer y volver a guardar la lista, los que no valen se quedan fuera (como antes).
import type { GateTramo, LatLon } from "../../../../core/tramos";
import type { KeyValueStore } from "../../../../engine/kv";
import { loadTramos, saveTramos } from "../../../../services/tramos-store";
import { newGateTramo } from "./tramo-form";

export function createGateTramo(
  kv: KeyValueStore,
  name: string,
  a: LatLon,
  b: LatLon,
  nowMs: number,
): GateTramo {
  const list = loadTramos(kv);
  const tr = newGateTramo(
    list.map((q) => q.nombre),
    name,
    a,
    b,
    nowMs,
  );
  list.push(tr);
  saveTramos(kv, list);
  return tr;
}

// El nombre que se ha escrito en la ventanita (sin espacios de más, 40 letras como mucho); "" si nada.
export function cleanName(answer: string | null): string {
  return (answer || "").trim().slice(0, 40);
}

// false si ya no está.
export function renameTramo(kv: KeyValueStore, id: string, nombre: string): boolean {
  const list = loadTramos(kv);
  const x = list.find((q) => q.id === id);
  if (!x) return false;
  x.nombre = nombre;
  saveTramos(kv, list);
  return true;
}

export function deleteTramo(kv: KeyValueStore, id: string): void {
  saveTramos(
    kv,
    loadTramos(kv).filter((x) => x.id !== id),
  );
}
