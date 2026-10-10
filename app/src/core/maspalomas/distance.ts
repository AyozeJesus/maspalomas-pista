// Distancia recorrida sobre el trazado: tramos seguidos en pista y fusión de la velocidad con el encaje del GPS.
import { interpAt, movingAvg } from "./numeric";
import type { Fix, Segment } from "./types";

// Tramos seguidos en pista. Un fijo suelto fuera del trazado, o con un salto sobre él que no cuadra con la
// velocidad (rebote del GPS, más frecuente en móviles de una sola frecuencia), se ignora (y se marca como
// outlier); el tramo solo se corta si pasan más de 3 s sin un fijo bueno.
export function segmentsOnTrack(fixes: Fix[], gpsT: ArrayLike<number>, L: number): Segment[] {
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  let last = -1;
  const close = () => {
    if (cur && cur.idx.length > 10) segs.push(cur);
    cur = null;
  };
  for (let k = 0; k < fixes.length; k++) {
    const f = fixes[k];
    if (!f.on) continue;
    if (cur && gpsT[k] - gpsT[last] > 3) close();
    if (cur) {
      const p = fixes[last];
      const dt = gpsT[k] - gpsT[last];
      let ds = f.s - p.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      const expected = ((f.speed + p.speed) / 2) * dt;
      if (Math.abs(ds - expected) > 25 + 10 * dt) {
        f.outlier = true;
        continue;
      }
    }
    if (!cur) cur = { a: k, b: k, idx: [] };
    cur.idx.push(k);
    cur.b = k;
    last = k;
  }
  close();
  return segs;
}

// Distancia del tramo en la rejilla tg (escribe en sF): integral de la velocidad corregida con el encaje GPS.
export function fuseDistance(
  seg: Segment,
  fixes: readonly Fix[],
  gpsT: ArrayLike<number>,
  tg: ArrayLike<number>,
  v: ArrayLike<number>,
  sF: Float64Array,
  L: number,
  hz: number,
): void {
  // Distancia encajada desenrollada (vueltas sumadas), solo con los fijos buenos del tramo.
  const sm: { t: number; s: number }[] = [];
  let laps = 0;
  let prev: number | null = null;
  for (const k of seg.idx) {
    const s = fixes[k].s;
    if (prev !== null) {
      if (s - prev < -L / 2) laps++;
      else if (s - prev > L / 2) laps--;
    }
    prev = s;
    sm.push({ t: gpsT[k], s: s + laps * L });
  }
  const ka = Math.max(0, Math.ceil((sm[0].t - tg[0]) * hz));
  const kb = Math.min(tg.length - 1, Math.floor((sm[sm.length - 1].t - tg[0]) * hz));
  if (kb <= ka) return;
  // Integral de la velocidad.
  const integ = new Float64Array(kb - ka + 1);
  for (let k = ka + 1; k <= kb; k++)
    integ[k - ka] = integ[k - ka - 1] + ((v[k] + v[k - 1]) / 2) * (tg[k] - tg[k - 1]);
  // Residuo encaje − integral en cada fijo, suavizado, y corrección interpolada.
  const resT: number[] = [];
  const resV: number[] = [];
  for (const p of sm) {
    const kk = (p.t - tg[ka]) * hz;
    if (kk < 0 || kk > kb - ka) continue;
    const k0 = Math.floor(kk);
    const fr = kk - k0;
    const iv = integ[k0] + (integ[Math.min(k0 + 1, kb - ka)] - integ[k0]) * fr;
    resT.push(p.t);
    resV.push(p.s - iv);
  }
  const resS = movingAvg(Float64Array.from(resV), 7);
  let j = 0;
  for (let k = ka; k <= kb; k++) {
    const r = interpAt(tg[k], resT, resS, j);
    j = r.j;
    sF[k] = integ[k - ka] + r.v;
  }
  // Monótona (la moto no va hacia atrás).
  for (let k = ka + 1; k <= kb; k++) if (sF[k] < sF[k - 1]) sF[k] = sF[k - 1];
}
