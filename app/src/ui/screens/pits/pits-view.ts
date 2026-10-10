// Todo lo que enseña boxes al entrar, sacado del motor y de su análisis completo (el de E.pitsAnalysis): lo que antes
// pintaba enterPits de una vez. Repasando una tanda guardada (E.viewing), boxes es solo para mirar.
import type { Engine } from "../../../engine";
import { target, type Settings } from "../../../engine/settings";
import type { Cell } from "../../../lib/brakes";
import { canName, engName, sessionIdOf } from "../../../services/naming";
import type { PistaStore } from "../../../storage";
import { brakeRows } from "./brake-table";
import { coachPlan, type Tip } from "./coach-plan";
import { lapTable, pitsSub, type LapCell } from "./lap-table";
import { tandaCut, type TandaCut } from "./tanda-cut";

export interface PitsView {
  // Cada entrada en boxes es una: lo que se toca en la pantalla (calibrar, cortar, el nombre) empieza de nuevo.
  entry: number;
  viewing: boolean;
  title: string;
  sub: string;
  laps: LapCell[][];
  ideal: string;
  tips: Tip[];
  brakes: Cell[][];
  // Ponerle nombre (repasando una tanda guardada): su grabación y el nombre que tiene. null: no se ofrece.
  name: { sid: string; value: string } | null;
  cut: TandaCut | null;
}

export function pitsView(
  E: Engine,
  settings: Settings,
  store: PistaStore | null,
  entry: number,
): PitsView {
  const viewing = !!E.viewing;
  const analysis = E.pitsAnalysis || null;
  const table = lapTable(E.laps, analysis);
  const plan = coachPlan(analysis, target(settings));
  const sid = sessionIdOf(E);
  return {
    entry,
    viewing,
    title: (viewing && engName(E)) || "Boxes",
    sub: pitsSub(E, table.bestT),
    laps: table.rows,
    ideal: plan.ideal,
    tips: plan.tips,
    brakes: brakeRows(E),
    name: viewing && sid && canName(store, E) ? { sid, value: engName(E) } : null,
    cut: tandaCut(E, !!store),
  };
}
