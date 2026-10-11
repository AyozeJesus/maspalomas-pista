// Lo que comparte la página del análisis: la tanda cargada y su análisis, lo elegido en pantalla, el vídeo montado y
// la línea de meta elegida (guardada en este navegador).
import type { Finish, IaEstado, TandaLista } from "../../api";
import type {
  AnalyzeResult,
  CoachResult,
  CornerMetrics,
  Grid,
  Session,
  TelemetryLap,
} from "../../../app/src/core/maspalomas/types";
import type { Replay3DControl, VideoControl } from "../tipos";

// Otra tanda de circuito del mismo día, con su mejor vuelta: se puede usar de referencia.
export type DayTanda = TandaLista & { meta: NonNullable<TandaLista["meta"]> & { mejor: number } };

// La mejor vuelta de otra tanda, ya analizada con esta misma meta; who: de quién es y a qué hora.
export interface ExtRef {
  grid: Grid;
  corners: CornerMetrics[];
  sectors: number[];
  time: number;
  who: string;
}

// Lo que se mira de la IA del garaje: si ya tiene la clave.
export type IaCfg = Pick<IaEstado, "configurada">;

interface PageState {
  session: Session | null;
  result: AnalyzeResult | null;
  source: "demo" | "file" | "gopro";
  fileName: string;
  lapIdx: number;
  // "obj" (objetivo), "best" (mi mejor vuelta) o "t:<id>" (la mejor vuelta de otra tanda del mismo día).
  refMode: string;
  target: number;
  cursorK: number | null;
  finish: Finish;
  tandaId: string | null;
  // Otras tandas del día (de cualquier piloto) y sus mejores vueltas ya analizadas con esta misma meta.
  dayList: DayTanda[];
  extRefs: Partial<Record<string, ExtRef>>;
  coach: CoachResult | null;
  // "fases" (freno y gas) o "minis" (minisectores).
  mapMode: string;
  // Inicio de la grabación (ms) o null: con él se sincroniza un vídeo de GoPro por su hora.
  epoch: number | null;
  iaCfg: IaCfg | null;
  // La vuelta en 3D: su control, si está abierta y el número de la última petición (solo dibuja esa).
  r3d: Replay3DControl | null;
  r3dOpen: boolean;
  r3dToken: number;
  // La tanda en pantalla ya está guardada en «Tus tandas».
  saved: boolean;
  // El vídeo con datos, una vez montado.
  videoCtl: VideoControl | null;
}

const FINISH_KEY = "maspa-telemetria-meta";

export const state: PageState = {
  session: null,
  result: null,
  source: "demo",
  fileName: "",
  lapIdx: 0,
  refMode: "obj",
  target: 65.0,
  cursorK: null,
  finish: readFinish(),
  tandaId: null,
  dayList: [],
  extRefs: {},
  coach: null,
  mapMode: "fases",
  epoch: null,
  iaCfg: null,
  r3d: null,
  r3dOpen: false,
  r3dToken: 0,
  saved: false,
  videoCtl: null,
};

// Línea de meta elegida por el piloto (índice del eje en cada sentido); comodidad de este navegador.
function readFinish(): Finish {
  try {
    const v = JSON.parse(localStorage.getItem(FINISH_KEY) || "null") as Finish | null;
    if (v && Number.isFinite(v.osm) && Number.isFinite(v.rev)) return v;
  } catch {
    /* sin almacenamiento: meta por defecto */
  }
  return { osm: 0, rev: 0 };
}

export function writeFinish(): void {
  try {
    localStorage.setItem(FINISH_KEY, JSON.stringify(state.finish));
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

// Las vueltas completas del análisis en pantalla (ninguna si aún no hay análisis).
export function validLaps(): TelemetryLap[] {
  return state.result ? state.result.laps.filter((l) => l.valid) : [];
}
