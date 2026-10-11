// «Salir a pista» aún fuera de la pista (sin encajar en el trazado de Maspalomas): en vez de un panel vacío, el mapa con
// tu posición de verdad (siguiéndote, con tu marcha hacia arriba), por dónde has ido y el circuito, y a cuánto está.
// En cuanto se rueda por la pista, el panel de siempre.
import { MASPA_GEO, nearestOn } from "../../../core/maspalomas";
import { lagNow, type Engine } from "../../../engine";
import { fmtMeters } from "../../../lib/format";
import type { MapDrawOptions } from "../../draw/mapa";

// Hasta esta distancia del circuito (m), el mapa se abre lo justo para verlo; más lejos, tus alrededores (800 m).
const NEAR = 2500;
// Así de cerca del eje (m) se está en el circuito: boxes, pit lane o la pista.
const ON = 60;

export interface AwayMap {
  options: MapDrawOptions;
  label: string;
}

// null: no toca (ya en la pista, en la vuelta de ejemplo o con el mapa apagado en Ajustes).
export function awayMap(E: Engine, t: number, mapOn: boolean): AwayMap | null {
  if (!mapOn || E.track || E.sim || E.replay) return null;
  const C = MASPA_GEO.main;
  const pos = E.route.position(t, E.rideV ?? NaN, lagNow(E));
  if (!pos)
    return { options: { outline: C, width: 12, follow: false }, label: "Esperando el GPS…" };
  const d = nearestOn(C, pos.x, pos.y, 0, C.length - 1).dist;
  return {
    options: {
      outline: C,
      width: 12,
      trail: E.route.trail,
      pos,
      follow: true,
      span: d <= NEAR ? Math.min(6000, Math.max(700, 2.4 * d + 700)) : 800,
      colorBy: "fase",
    },
    label:
      d < ON
        ? "En el circuito: los tiempos empiezan al rodar por la pista"
        : "Circuito de Maspalomas a " + fmtMeters(d),
  };
}
