// El mapa de la ruta libre: cómo se mira (siguiendo a la moto o la ruta entera, cuánto se ve, el color de la trazada)
// y lo que se pinta (la trazada, dónde vas, la inclinación de las últimas curvas, la salida marcada y las de los tramos).
// mapView, liveDots y lo de dibujar de renderRoute de live.js.
import { toLocal } from "../../../core/maspalomas";
import type { Tramo } from "../../../core/tramos";
import { lagNow, type Engine } from "../../../engine";
import type { KeyValueStore } from "../../../engine/kv";
import { curveMarks } from "../../../lib/curves";
import { isGateTramo, loadTramos } from "../../../services/tramos-store";
import type { ColorBy, MapDot, MapDrawOptions } from "../../draw/mapa";

export interface MapView {
  follow: boolean;
  // Metros en el lado corto siguiendo a la moto, y hasta dónde se puede acercar.
  span: number;
  minSpan: number;
  colorBy: ColorBy;
  // Cuándo se pintó (performance.now): 0, otra vez en el próximo fotograma.
  drawnAt: number;
  // Con qué color está puesta la leyenda.
  legendBy: ColorBy | null;
}

const SPAN = 600;
const MIN_SPAN = 150;
// Entrenamiento en 8: un 8 de dos círculos de 8 m cabe entero en 60 m, y se puede acercar hasta 30.
const OCHO_SPAN = 60;
const OCHO_MIN_SPAN = 30;

export function newMapView(): MapView {
  return {
    follow: true,
    span: SPAN,
    minSpan: MIN_SPAN,
    colorBy: "fase",
    drawnAt: 0,
    legendBy: null,
  };
}

// Al empezar otra sesión: en el entrenamiento en 8, de cerca; al volver a una ruta después de uno, como siempre.
export function viewForSession(v: MapView, ocho: boolean, wasOcho: boolean): void {
  if (ocho) {
    v.span = OCHO_SPAN;
    v.minSpan = OCHO_MIN_SPAN;
    v.follow = true;
  } else if (wasOcho) {
    v.span = SPAN;
    v.minSpan = MIN_SPAN;
  }
  v.drawnAt = 0;
}

// Los botones del mapa: «Fases»/«Incl.», «Toda»/«Seguir», + y −.
export function toggleColor(v: MapView): void {
  v.colorBy = v.colorBy === "fase" ? "incl" : "fase";
  v.drawnAt = 0;
}
export function toggleFollow(v: MapView): void {
  v.follow = !v.follow;
  v.drawnAt = 0;
}
export function zoomIn(v: MapView): void {
  v.span = Math.max(v.minSpan, v.span / 1.6);
  v.follow = true;
  v.drawnAt = 0;
}
export function zoomOut(v: MapView): void {
  v.span = Math.min(8000, v.span * 1.6);
  v.follow = true;
  v.drawnAt = 0;
}

const SALIDA = "#38d0ff";

// Puntos del mapa en directo: la salida marcada a mano y la salida y la meta de los tramos que las tienen.
export function liveDots(E: Engine, tramos: readonly Tramo[]): MapDot[] {
  const out: MapDot[] = [];
  if (E.mark) {
    const [x, y] = toLocal(E.mark.lat, E.mark.lon);
    out.push({ x, y, color: SALIDA, label: "salida" });
  }
  for (const tr of tramos)
    if (isGateTramo(tr)) {
      const [ax, ay] = toLocal(tr.salida[0], tr.salida[1]);
      const [bx, by] = toLocal(tr.meta[0], tr.meta[1]);
      out.push({ x: ax, y: ay, color: SALIDA, r: 5, label: "S" });
      out.push({ x: bx, y: by, color: SALIDA, r: 5, ring: true, label: "M" });
    }
  return out;
}

// Lo que se pinta; v: la velocidad del panel (m/s).
export function routeMapOptions(
  E: Engine,
  t: number,
  v: number,
  view: MapView,
  tramos: readonly Tramo[],
): MapDrawOptions {
  const pos = E.route.position(t, v, lagNow(E));
  return {
    trail: E.route.trail,
    pos,
    follow: view.follow && !!pos,
    span: view.span,
    colorBy: view.colorBy,
    // La más reciente primero: si dos marcas se pisan, queda la de la curva que acabas de pasar.
    marks: curveMarks(E.route.curves).reverse(),
    dots: liveDots(E, tramos),
  };
}

// La lista de tramos para el mapa (cada fotograma), leída de nuevo como mucho cada 2 s.
export function tramosCache(kv: KeyValueStore): (nowMs: number) => Tramo[] {
  let at = -Infinity;
  let list: Tramo[] = [];
  return (nowMs) => {
    if (nowMs - at > 2000) {
      at = nowMs;
      list = loadTramos(kv);
    }
    return list;
  };
}
