// «Mejor vuelta guardada de Ayoze: antihorario 1:08,50 · horario —»: la de cada sentido del piloto de ahora (con la
// meta elegida), y el punto en verde si hay alguna. Lo que pintaba renderHome en st-best.
import type { KeyValueStore } from "../../../../engine/kv";
import { bestKey, type Settings } from "../../../../engine/settings";
import { fmtLap } from "../../../../lib/format";
import type { StatusLineData } from "../../../components/StatusLine";

const DIRS = ["osm", "rev"] as const;

export function bestStatus(s: Settings, kv: KeyValueStore): StatusLineData {
  let any = false;
  const parts = DIRS.map((dir) => {
    const b = kv.load<{ time: number } | null>(bestKey(s, dir), null);
    if (b) any = true;
    return (dir === "osm" ? "antihorario " : "horario ") + (b ? fmtLap(b.time) : "—");
  });
  return {
    state: any ? "ok" : "",
    text: "Mejor vuelta guardada" + (s.piloto ? " de " + s.piloto : "") + ": " + parts.join(" · "),
  };
}

// «Borrar mejor vuelta guardada»: las dos del piloto de ahora (con la meta elegida). El almacén no tiene «quitar»: se
// guarda vacía (null), que al leerla es lo mismo que no tenerla.
export function forgetBest(s: Settings, kv: KeyValueStore): void {
  for (const dir of DIRS) kv.store(bestKey(s, dir), null);
}
