// Los circuitos guardados (de la ruta libre) en Ajustes: cómo se nombran en la lista y quitar uno.
import type { CircuitTrack } from "../../../../core/circuito";
import type { KeyValueStore } from "../../../../engine/kv";
import { CIRCUITS_KEY, loadCircuits } from "../../../../engine";
import { fmt } from "../../../../lib/format";

// «Maspalomas (prueba) · 2,2 km».
export function circuitLine(c: Pick<CircuitTrack, "name" | "length">): string {
  return c.name + " · " + fmt((c.length || 0) / 1000, 1) + " km";
}

// Quita del móvil los circuitos con ese nombre.
export function deleteCircuit(kv: KeyValueStore, name: string): void {
  kv.store(
    CIRCUITS_KEY,
    loadCircuits({ kv }).filter((x) => x.name !== name),
  );
}
