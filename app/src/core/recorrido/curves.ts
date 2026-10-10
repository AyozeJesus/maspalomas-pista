// Curvas: el resumen de cada una al cerrarla, con su tiempo muerto.
import type { Curve, OpenCurve, TrailPoint } from "./types";

// Cierra la curva `c` en t: tiempo muerto = el rato sin freno ni gas («mantiene») desde que se suelta el freno (o se
// entra sin frenar) hasta volver a dar gas. Se cuenta sobre la trazada, que ese mismo rato se pinta en ámbar (sus
// puntos pasan a «muerto»): el número y el color dicen siempre lo mismo. null si no llega a curva: menos de 1 s, o
// poco tumbada (sin inclinación, poco giro).
export function closeCurve(c: OpenCurve, t: number, tr: TrailPoint[]): Curve | null {
  const dur = t - c.t0;
  const leanOk = c.leanMax > 8 || (Number.isNaN(c.lean) && c.yawMax > 0.25);
  if (dur < 1 || !leanOk) return null;
  const from = c.relT !== null ? c.relT : t;
  const to = c.gasT !== null ? c.gasT : t;
  let dead = 0;
  let i0 = Math.min(c.idx, tr.length);
  while (i0 > 0 && tr[i0 - 1].t >= from) i0--;
  for (let i = Math.max(1, i0); i < tr.length; i++) {
    const p = tr[i];
    if (p.t < from || p.t > to || p.ph !== "mantiene" || p.gap) continue;
    const dt = p.t - tr[i - 1].t;
    if (dt > 0 && dt < 5) dead += dt;
    p.ph = "muerto";
  }
  return {
    num: c.num,
    t: c.t0,
    dur,
    lean: !Number.isNaN(c.lean) ? c.lean : null,
    leanMax: c.leanMax || null,
    vEntry: c.vEntry * 3.6,
    vMin: c.vMin * 3.6,
    brakeG: c.brakeG > 0.08 ? c.brakeG : null,
    dead,
    apex: c.apex,
    brakeAt: c.brakeAt,
    brk: c.brk || null,
    endT: t,
  };
}
