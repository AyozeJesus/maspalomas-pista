// Ruta libre: los textos del panel en cada fotograma (título, velocidad, morro, la última curva y los totales), lo que
// calculaba renderRoute de live.js, sin DOM.
import { diveMm, type Curve } from "../../../core/recorrido";
import type { Engine } from "../../../engine";
import { brakeLine } from "../../../lib/brakes";
import { fmt, fmtClock, fmtSigned } from "../../../lib/format";
import type { Reading } from "../dash/live-view";

// El circuito en marcha, «Tramo 2» tras «Nuevo tramo» o «Ruta libre».
export function routeTitle(E: Engine): string {
  if (E.ocho) return "Entrenamiento en 8";
  if (E.circ && E.circTrack) return E.circTrack.name;
  return E.segment !== undefined && E.segment > 1 ? "Tramo " + E.segment : "Ruta libre";
}

// Velocidad del panel (m/s): la de los sensores con el GPS o, mientras no la haya, la del último fijo. (La app de antes
// solo miraba si era NaN: sin ningún dato de los sensores aún, undefined, el panel decía «—».)
export function rideSpeedOf(E: Engine): number {
  const v = E.rideV;
  return v !== undefined && !Number.isNaN(v) ? v : E.fix ? E.fix.v : 0;
}

// Morro: frenando (con la moto casi recta, donde el cabeceo vale), cuánto se hunde la horquilla en mm; al soltar, 4 s
// con lo que se hundió; si no, el cabeceo en grados (también parada: tras «Calibrar», 0; sin «+0» ni «−0»).
export function pitchReading(E: Engine, t: number): Reading {
  const dr = E.diveRecap && E.diveT !== undefined && t - E.diveT < 4 ? E.diveRecap : null;
  if (E.route.bk && E.pitchDeg < -0.5 && !(E.turn !== undefined && E.turn > 0.08))
    return { label: "hunde", value: "≈" + diveMm(-E.pitchDeg) + " mm" };
  if (dr) return { label: "hundió", value: dr.diveMm + " mm" };
  return {
    label: "morro",
    value: !isFinite(E.pitchDeg)
      ? "—"
      : Math.abs(E.pitchDeg) < 0.5
        ? "0°"
        : fmtSigned(E.pitchDeg, 0) + "°",
  };
}

// La última curva: nombre y lado, tiempo en curva, tumbada, frenada, velocidad de entrada → mínima y tiempo sin gas
// (en color: mucho, rojo; poco, verde) y la frenada.
export interface CurveRecapView {
  cls: string;
  name: string;
  dur: string;
  lean: string;
  g: string;
  v: string;
  dead: string;
  deadCls: string;
  brk: string;
}

export function curveRecap(E: Engine, t: number): CurveRecapView | null {
  const c = E.curveRecap as Curve | null;
  if (!c) return null;
  return {
    cls: "recap" + (t - E.curveT < 3 ? " fresh" : ""),
    name: "Curva " + c.num + (c.lean === null ? "" : c.lean > 0 ? " · derecha" : " · izquierda"),
    dur: fmt(c.dur, 1) + " s en curva",
    lean: c.leanMax ? fmt(c.leanMax, 0) + "°" : "—",
    g: c.brakeG ? fmt(c.brakeG, 2) + " g" : "sin freno",
    v: fmt(c.vEntry, 0) + "→" + fmt(c.vMin, 0),
    dead: fmt(c.dead, 1) + " s",
    deadCls: "num " + (c.dead > 1.5 ? "down" : c.dead < 0.6 ? "up" : ""),
    brk: brakeLine(c.brk),
  };
}

// Los totales de abajo: distancia, tiempo, inclinación máxima y punta.
export function rideStats(E: Engine): { dist: string; time: string; lean: string; top: string } {
  const st = E.route.stats;
  const lm = Math.max(st.leanL, st.leanR);
  return {
    dist: fmt(st.dist / 1000, 1) + " km",
    time: st.t0 !== null && st.t1 !== null ? fmtClock(st.t1 - st.t0) : "0:00",
    lean: "máx " + (lm ? fmt(lm, 0) + "°" : "—"),
    top: "punta " + (st.vMax ? fmt(st.vMax * 3.6, 0) : "—"),
  };
}

// «Salida aquí» y, con la salida puesta, «Meta aquí».
export function markLabel(E: Engine): string {
  return E.mark ? "Meta aquí" : "Salida aquí";
}
