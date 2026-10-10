// Las vueltas al circuito en el resumen de la ruta libre (el que se ha reconocido o sacado de las vueltas) y guardarlo
// para reconocerlo la próxima vez.
import { compact } from "../../../core/circuito";
import { CIRCUITS_KEY, loadCircuits, type Engine } from "../../../engine";
import type { KeyValueStore } from "../../../engine/kv";
import { fmt, fmtLap, fmtSigned } from "../../../lib/format";
import { sessionIdOf } from "../../../services/naming";
import type { PistaStore } from "../../../storage";

export interface RouteLaps {
  rows: string[][];
  note: string;
  // Sacado de las vueltas y aún sin guardar: se ofrece guardarlo, con este nombre.
  canSave: boolean;
  name: string;
}

interface LapLike {
  num: number;
  time: number;
  valid: boolean;
}

// null: sin circuito (no sale la tabla).
export function routeLaps(eng: Engine): RouteLaps | null {
  // Repasando una ruta guardada por un circuito que no se guardó: las vueltas que se apuntaron entonces.
  const mc = !eng.circ && eng.viewing && eng.viewing.circuito ? eng.viewing.circuito : null;
  let laps: readonly LapLike[];
  let best: number | null;
  if (eng.circ) {
    laps = eng.circ.laps;
    best = eng.circ.best ? eng.circ.best.time : null;
  } else if (mc) {
    laps = (mc.vueltas || []).map((v) => ({ num: v.num, time: v.time, valid: v.valid }));
    best = mc.mejor ? mc.mejor : null;
  } else return null;
  const track = mc ? { name: mc.nombre, length: mc.longitud } : eng.circTrack;
  if (!track) return null;
  const rows = laps.map((l) => [
    String(l.num),
    fmtLap(l.time) + (l.valid ? "" : " *"),
    !l.valid || best === null ? "—" : l.time === best ? "mejor" : fmtSigned(l.time - best, 2),
  ]);
  const valid = laps.filter((l) => l.valid).length;
  const note =
    track.name +
    " · " +
    fmt(track.length, 0) +
    " m · " +
    (laps.length
      ? valid +
        " vueltas completas" +
        (laps.some((l) => !l.valid) ? " (* sin contar: paso por boxes o fuera del circuito)" : "")
      : "aún sin vueltas completas") +
    (mc
      ? "."
      : eng.circSaved
        ? ". Circuito guardado: se reconoce solo al pasar por él."
        : ". Sacado de tus vueltas: guárdalo para que la próxima vez cuente desde la primera.");
  // Sin el trazado (solo las vueltas apuntadas) no hay nada que guardar.
  return { rows, note, canSave: !mc && !eng.circSaved, name: track.name };
}

// «Guardar el circuito» con el nombre escrito (vacío: el que tenía). Si se está repasando una ruta grabada, la
// grabación lo apunta (al repasarla otra vez no lo vuelve a ofrecer). false si no había nada que guardar.
export function saveRouteCircuit(
  kv: KeyValueStore,
  store: PistaStore | null,
  eng: Engine,
  typed: string,
): boolean {
  if (!eng.circTrack || eng.circSaved) return false;
  const name = typed.trim() || eng.circTrack.name;
  const saved = compact({ ...eng.circTrack, name });
  const list = loadCircuits({ kv }).filter((c) => c.name !== name);
  list.push(saved);
  kv.store(CIRCUITS_KEY, list);
  eng.circTrack = saved;
  eng.circSaved = true;
  const sid = sessionIdOf(eng);
  const viewing = eng.viewing;
  const mc = viewing && viewing.circuito;
  if (store && sid && viewing && mc) {
    const circuito = { ...mc, nombre: name, guardado: true, trazado: saved };
    viewing.circuito = circuito;
    store.patchSession(sid, { circuito }).catch(() => {});
  }
  return true;
}
