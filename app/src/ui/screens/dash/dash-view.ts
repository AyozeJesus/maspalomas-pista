// Panel del circuito: los textos y clases de cada fotograma (lo que calculaba render() de live.js), sin DOM.
import { gridAt, type CornerResult, type Engine } from "../../../engine";
import { ring } from "../../../engine/vec";
import type { Settings } from "../../../engine/settings";
import { brakeLine } from "../../../lib/brakes";
import { fmt, fmtLap, fmtSigned } from "../../../lib/format";

// Dónde cree el panel que está la moto (m desde meta) y a qué velocidad (m/s): predicted() del motor.
export interface Predicted {
  s: number;
  v: number;
}

export function lapLabel(E: Engine): string {
  return E.lapNum
    ? "Vuelta " + E.lapNum
    : E.track
      ? "Hacia meta"
      : E.far
        ? "Fuera del circuito"
        : "Buscando la pista";
}

// km/h: la prevista en el trazado o, fuera de él, la del último fijo.
export function speedText(E: Engine, p: Predicted | null): string {
  return fmt((p ? p.v : E.fix ? E.fix.v : 0) * 3.6, 0);
}

// La diferencia con la mejor vuelta en el mismo punto (suavizada), su texto pequeño y el color del panel; cue: toca el
// aviso de frenada (prueba: una vez por curva y vuelta, solo lanzado). Cambia en el motor lo que cambiaba render():
// la diferencia suavizada y por dónde va el aviso de frenada.
export interface DeltaView {
  main: string;
  sub: string;
  cls: "" | "good" | "bad";
  cue: boolean;
}

export function stepDelta(
  E: Engine,
  t: number,
  p: Predicted | null,
  s: Pick<Settings, "cue" | "lead">,
): DeltaView {
  const out: DeltaView = {
    main: "—",
    sub: E.track
      ? E.lapStart === null
        ? "esperando meta"
        : "primera vuelta: sin referencia"
      : E.far
        ? "Sin tiempos fuera del circuito · velocidad, g e inclinación sí (se calibran en marcha)"
        : "detectando el sentido de marcha",
    cls: "",
    cue: false,
  };
  const best = E.best;
  if (!p || E.lapStart === null || !best) return out;
  const d = t - E.lapStart - gridAt(best.grid, p.s);
  const ema = E.deltaEma === null ? d : E.deltaEma + (d - E.deltaEma) * 0.15;
  E.deltaEma = ema;
  out.main = fmtSigned(ema, 2);
  out.sub = "frente a " + fmtLap(best.time);
  out.cls = ema < -0.05 ? "good" : ema > 0.05 ? "bad" : "";
  if (s.cue && best.brakeS && p.v > 25) {
    best.brakeS.forEach((bs, k) => {
      if (bs === null || E.cueDone.has(k)) return;
      const target = bs - s.lead;
      if (E.prevCueS !== null && E.prevCueS < target && p.s >= target) {
        E.cueDone.add(k);
        out.cue = true;
      }
    });
  }
  E.prevCueS = p.s;
  return out;
}

export function dashClass(E: Engine, cls: DeltaView["cls"]): string {
  return "dash" + (E.replay ? " replay" : "") + (cls ? " " + cls : "");
}

// Tiempo de la vuelta en curso.
export function lapClock(E: Engine, t: number): string {
  return E.lapStart !== null ? fmtLap(t - E.lapStart, 1) : "—";
}

// «Mejor 1:05,42» y «Última 1:06,10» (la última vuelta válida).
export function infoLines(E: Engine): [best: string, last: string] {
  let last = null;
  for (let i = E.laps.length - 1; i >= 0 && !last; i--) if (E.laps[i].valid) last = E.laps[i];
  return [
    "Mejor " + (E.best ? fmtLap(E.best.time) : "—"),
    "Última " + (last ? fmtLap(last.time) : "—"),
  ];
}

export function sectorClass(state: Engine["sectorState"][number]): string {
  return state ? "s-" + state : "";
}

// ---------- la última curva ----------
// Un dato de la curva con su diferencia con la mejor vuelta en esa misma curva (en color solo si pasa del ruido del
// móvil).
export interface RecapCell {
  text: string;
  diff: string;
  diffCls: string;
}

export interface DashRecap {
  cls: string;
  name: string;
  dt: string;
  dtCls: string;
  lean: RecapCell;
  g: RecapCell;
  v: RecapCell;
  // Punto de frenada frente a la mejor vuelta: + es más tarde (más cerca de la curva).
  bp: string;
  bpCls: string;
  brk: string;
}

function cell(
  val: number | null,
  refVal: number | null | undefined,
  hasRef: boolean,
  digits: number,
  unit: string,
  higherIsBetter: boolean | null,
  thr: number,
): RecapCell {
  let diff = "";
  let cls = "";
  if (val !== null && hasRef && refVal !== null && refVal !== undefined) {
    const d = val - refVal;
    diff = Math.abs(d) < 0.5 * Math.pow(10, -digits) ? "=" : fmtSigned(d, digits);
    if (higherIsBetter !== null && Math.abs(d) >= thr)
      cls = d > 0 === higherIsBetter ? "up" : "down";
  }
  return { text: val === null ? "—" : fmt(val, digits) + unit, diff, diffCls: "num " + cls };
}

function brakePoint(r: CornerResult, L: number | null): { bp: string; bpCls: string } {
  const ref = r.ref;
  if (r.brakeS === null || !ref || ref.brakeS === null || ref.brakeS === undefined || L === null)
    return { bp: "—", bpCls: "num " };
  const d = ring(r.brakeS - ref.brakeS + L / 2, L) - L / 2;
  return {
    bp: (d > 0 ? "+" : d < 0 ? "−" : "") + fmt(Math.abs(d), 0) + " m",
    bpCls: "num " + (d >= 3 ? "up" : d <= -3 ? "down" : ""),
  };
}

// El resumen de la última curva (null: no hay); recién salido de ella, marcado unos segundos.
export function dashRecap(E: Engine, t: number): DashRecap | null {
  const r = E.recap;
  if (!r) return null;
  const ref = r.ref;
  const has = !!ref;
  return {
    cls: "recap" + (t - E.recapT < 3 ? " fresh" : ""),
    name: "C" + r.num + " · " + r.name,
    dt: r.dt === null ? "" : fmtSigned(r.dt, 2) + " s",
    dtCls: "num " + (r.dt === null ? "" : r.dt < -0.03 ? "up" : r.dt > 0.03 ? "down" : ""),
    lean: cell(r.leanMax, ref && ref.leanMax, has, 0, "°", null, 0),
    g: cell(r.gMax, ref && ref.gMax, has, 2, " g", true, 0.04),
    v: cell(r.vMin, ref && ref.vMin, has, 0, "", true, 1.5),
    ...brakePoint(r, E.track ? E.track.L : null),
    brk: brakeLine(r.brk),
  };
}
