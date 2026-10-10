// Resumen de un recorrido para guardar con la tanda (sin la trazada): máximos, curvas, caballitos y frenadas.
import type { Brake, BrakeTotals, Curve, RideStats, RideSummary, Wheelie } from "./types";

export function summarize(
  st: RideStats,
  cs: readonly Curve[],
  brakes: readonly Brake[],
  wheelies: readonly Wheelie[],
): RideSummary {
  const deads = cs.map((c) => c.dead).filter((x) => !Number.isNaN(x));
  return {
    distancia: Math.round(st.dist),
    // t1 se pone siempre junto con t0.
    duracion: st.t0 !== null ? Math.round((st.t1 as number) - st.t0) : 0,
    punta: Math.round(st.vMax * 3.6 * 10) / 10,
    inclDerecha: Math.round(st.leanR * 10) / 10,
    inclIzquierda: Math.round(st.leanL * 10) / 10,
    // La frenada más fuerte de las de verdad (un bache o un pico de ruido de un instante no cuenta).
    frenadaMax:
      Math.round(
        brakes.filter((b) => b.gps !== false).reduce((m, b) => Math.max(m, b.peak), 0) * 100,
      ) / 100,
    aceleracionMax: Math.round(st.accMax * 100) / 100,
    curvas: cs.length,
    caballitos: wheelies.length,
    caballitosMetros: wheelies.reduce((a, w) => a + w.dist, 0),
    caballitosSegundos: Math.round(wheelies.reduce((a, w) => a + w.dur, 0) * 10) / 10,
    caballitoMax: wheelies.reduce((a, w) => Math.max(a, w.max), 0) || null,
    caballitosPerdido: Math.round(wheelies.reduce((a, w) => a + (w.lost || 0), 0) * 100) / 100,
    listaCaballitos: wheelies.map((w) => ({
      num: w.num,
      dur: w.dur,
      dist: w.dist,
      max: w.max,
      v0: w.v0,
      lost: w.lost,
    })),
    tiempoMuertoMedio: deads.length
      ? Math.round((deads.reduce((a, b) => a + b, 0) / deads.length) * 10) / 10
      : null,
    listaCurvas: cs.map((c) => ({
      num: c.num,
      lean: c.lean === null ? null : Math.round(c.lean),
      vEntry: Math.round(c.vEntry),
      vMin: Math.round(c.vMin),
      brakeG: c.brakeG === null ? null : Math.round(c.brakeG * 100) / 100,
      dead: Math.round(c.dead * 10) / 10,
    })),
    // Las que el GPS no vio no cuentan (gps === false).
    ...brakeSummary(brakes.filter((b) => b.gps !== false)),
  };
}

// Lo de las frenadas para el resumen: cuántas, los mejores valores y las 40 más fuertes.
function brakeSummary(list: readonly Brake[]): BrakeTotals {
  const vals = (key: "bite" | "dive" | "diveMm" | "trail", from?: readonly Brake[]): number[] =>
    (from || list).map((b) => b[key]).filter((x): x is number => x !== null && !Number.isNaN(x));
  const hard = list.filter((b) => b.peak >= 0.6);
  const bites = vals("bite", hard.length ? hard : list);
  const dives = vals("dive");
  const mms = vals("diveMm");
  const trails = vals("trail");
  return {
    frenadas: list.length,
    mordidaMejor: bites.length ? Math.min(...bites) : null,
    hundimientoMax: dives.length ? Math.max(...dives) : null,
    hundimientoMaxMm: mms.length ? Math.max(...mms) : null,
    frenadaTumbadoMax: trails.length ? Math.max(...trails) : null,
    listaFrenadas: list
      .slice()
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 40)
      .map((b) => ({
        num: b.num,
        peak: b.peak,
        mean: b.mean,
        bite: b.bite,
        dur: b.dur,
        dist: b.dist,
        vIn: b.vIn,
        vOut: b.vOut,
        dive: b.dive,
        diveMm: b.diveMm,
        trail: b.trail,
        leanMax: b.leanMax,
      })),
  };
}
