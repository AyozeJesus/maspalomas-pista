// «Cortar en dos» una tanda guardada entre dos vueltas (dos tandas que se grabaron seguidas): dónde se puede cortar.
import type { Engine } from "../../../engine";
import { fmtLap } from "../../../lib/format";
import { sessionIdOf } from "../../../services/naming";

export interface CutOption {
  // Segundos desde el principio de la grabación (un segundo después de acabar la vuelta).
  value: string;
  text: string;
}

export interface TandaCut {
  sid: string;
  options: CutOption[];
}

// Solo repasando una tanda guardada con al menos dos vueltas acabadas (null: no se ofrece).
export function tandaCut(eng: Engine, hasStore: boolean): TandaCut | null {
  const sid = sessionIdOf(eng);
  const laps = eng.laps.filter((l) => Number.isFinite(l.end));
  if (!(hasStore && sid && eng.viewing && laps.length >= 2)) return null;
  return {
    sid,
    options: laps.slice(0, -1).map((l) => ({
      value: String(l.end + 1),
      text: "después de la vuelta " + l.num + " (" + fmtLap(l.time) + ")",
    })),
  };
}
