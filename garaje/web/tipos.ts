// Lo que se piden entre sí los módulos del análisis del garaje: el vídeo con datos (video.ts) y la vuelta en 3D
// (replay3d.ts) frente a la página del análisis. Solo tipos.
import type { GoproSession, GpmfData } from "../../app/src/core/gpmf/types";
import type { AnalyzeResult, Grid } from "../../app/src/core/maspalomas/types";
import type { Vista3DCorner, Vista3DTrack } from "../../app/src/ui/three/vista3d";

// ---------- vídeo con datos (video.ts) ----------

// Lo que el vídeo pide a la página del análisis.
export interface VideoHooks {
  // El análisis en pantalla (null si aún no hay ninguno).
  result(): AnalyzeResult | null;
  // ms UTC del inicio de la tanda (para sincronizar un vídeo de GoPro por su hora), o null si no se sabe.
  epoch(): number | null;
  // La telemetría del vídeo de GoPro pasa a ser la tanda analizada (y el vídeo queda sincronizado con ella).
  useSession(session: GoproSession, info: GpmfData | null): void;
  // Guarda esa telemetría en el garaje como una tanda más; devuelve su id.
  save(session: GoproSession, info: GpmfData | null, piloto: string): Promise<string>;
}

// Lo último exportado (para las pruebas).
export interface VideoExport {
  size: number;
  type: string;
  name: string;
}

// Estado del vídeo para las pruebas automáticas.
export interface VideoTestState {
  // s que hay que sumar a la hora del vídeo para tener la de la tanda (null: sin sincronizar).
  offset: number | null;
  // Cómo se sincronizó (por la hora de la GoPro, a mano…), o null.
  kind: string | null;
  gopro: boolean;
  // Los últimos datos dibujados encima del vídeo.
  last: unknown;
  lastExport: VideoExport | null;
}

// Lo que la página del análisis puede hacer con el vídeo montado.
export interface VideoControl {
  // La tanda ha cambiado (otra meta, otra tanda): se rellenan las vueltas y se redibuja.
  refresh(): void;
  // Otra tanda cargada: la sincronización anterior ya no vale.
  resetSync(): void;
  state(): VideoTestState;
}

// ---------- vuelta en 3D contra un fantasma (replay3d.ts) ----------

// Una vuelta para el 3D: su rejilla por distancia (con su tiempo), su tiempo total (s) y cómo se llama en pantalla.
export interface Replay3DLap {
  grid: Grid;
  time: number;
  label: string;
}

export interface Replay3DOptions {
  track: Vista3DTrack;
  corners?: readonly Vista3DCorner[] | null;
  bounds?: readonly number[] | null;
  lap: Replay3DLap;
  // El fantasma (tu mejor vuelta, la de otro piloto o el objetivo), o null.
  ref: Replay3DLap | null;
  // Si mientras carga se ha pedido otra, esta no dibuja nada.
  isCurrent?: () => boolean;
}

export interface Replay3DState {
  tau: number;
  playing: boolean;
  delta: string | null;
  ghost: boolean;
}

export interface Replay3DControl {
  close(): void;
  // Para las pruebas.
  state?: () => Replay3DState;
  seek?: (t: number) => void;
}
