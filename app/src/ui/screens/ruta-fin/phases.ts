// La ruta a lo largo de los km: metros recorridos hasta cada punto de la trazada y cuánto rato se fue frenando, dando
// gas, sin gas en curva, manteniendo o en caballito (la nota de la gráfica de fases).
import type { Curve, TrailPoint } from "../../../core/recorrido";
import { fmt } from "../../../lib/format";

// Con menos puntos de trazada no hay gráfica de fases.
export const PHASE_CHART_MIN = 20;

// Lo que hace falta de cada punto de la trazada para medir (tiempo, velocidad y si viene tras un hueco del GPS).
export type TrailStep = Pick<TrailPoint, "t" | "v" | "gap">;

// Metros recorridos hasta cada punto de la trazada, por la velocidad (como la distancia del resumen: sumar los
// puntos de la trazada salía un 10 % más) y sin contar los huecos sin GPS.
export function trailDistances(tr: readonly TrailStep[]): Float64Array {
  const d = new Float64Array(tr.length);
  for (let i = 1; i < tr.length; i++) {
    const dt = tr[i].t - tr[i - 1].t;
    d[i] = d[i - 1] + (!tr[i].gap && dt > 0 && dt < 5 ? ((tr[i].v + tr[i - 1].v) / 2) * dt : 0);
  }
  return d;
}

// Segundos en cada fase (en este orden: el total se suma así, como antes).
export interface PhaseTimes {
  freno: number;
  gas: number;
  muerto: number;
  mantiene: number;
  caballito: number;
}

export function phaseTimes(tr: readonly Pick<TrailPoint, "t" | "gap" | "wh" | "ph">[]): PhaseTimes {
  const tm: PhaseTimes = { freno: 0, gas: 0, muerto: 0, mantiene: 0, caballito: 0 };
  for (let i = 1; i < tr.length; i++) {
    const dt = tr[i].t - tr[i - 1].t;
    if (!tr[i].gap && dt > 0 && dt < 5) tm[tr[i].wh ? "caballito" : phaseKey(tr[i].ph)] += dt;
  }
  return tm;
}

function phaseKey(ph: string): keyof PhaseTimes {
  return ph === "freno" || ph === "gas" || ph === "muerto" || ph === "mantiene" ? ph : "mantiene";
}

// «Del tiempo en marcha: frenando 21 %, acelerando 34 %, sin gas en curva 9 %, manteniendo 36 %. Sin gas en curva:
// 0,8 s de media en 41 curvas (3 con más de 2 s).»
export function phaseNote(tm: PhaseTimes, curves: readonly Pick<Curve, "dead">[]): string {
  const tot = Object.values(tm).reduce((a: number, b: number) => a + b, 0) || 1;
  // Espacio que no se parte: «43 %» no se queda con el «%» en la línea de abajo.
  const pc = (k: keyof PhaseTimes) => Math.round((100 * tm[k]) / tot) + "\u{a0}%";
  const deads = curves.map((c) => c.dead).filter((x) => x === x);
  return (
    "Del tiempo en marcha: frenando " +
    pc("freno") +
    ", acelerando " +
    pc("gas") +
    ", sin gas en curva " +
    pc("muerto") +
    ", manteniendo " +
    pc("mantiene") +
    (tm.caballito ? ", en caballito " + pc("caballito") : "") +
    "." +
    (deads.length
      ? " Sin gas en curva: " +
        fmt(deads.reduce((a, b) => a + b, 0) / deads.length, 1) +
        " s de media en " +
        deads.length +
        " curvas (" +
        deads.filter((x) => x > 2).length +
        " con más de 2 s)."
      : "")
  );
}
