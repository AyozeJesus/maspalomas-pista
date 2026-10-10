// Relojes. El de la tanda es el de los sensores (timeOrigin + performance.now, el de event.timeStamp), en segundos;
// no el de pared (Date.now): en Android el de los sensores no cuenta el tiempo con el móvil dormido, así que con la
// página abierta desde antes los dos se separan, y el de pared salta si el móvil se pone en hora. Las horas del GPS
// (las del navegador o las del receptor externo) se traducen a este reloj con mapClock.

export interface ClockMap {
  off: number | null;
  at: number;
}

export function perfNow(): number {
  return (performance.timeOrigin + performance.now()) / 1000;
}

export function newClock(): ClockMap {
  return { off: null, at: 0 };
}

// Hora (ms) de un fijo en el reloj de los sensores. Su propia hora (srcMs: la del receptor o la que le pone el
// navegador) da los intervalos exactos; la llegada (rxMs, ya en ese reloj), solo el desfase entre los dos relojes:
// el menor de los recientes, el del fijo que menos tardó (el Bluetooth y el navegador los entregan con retraso
// variable). Sube como mucho 2 ms por segundo (deriva entre relojes) y, si de golpe es medio segundo mayor (un reloj
// se ha puesto en hora), se toma el nuevo. Sin hora propia, la de llegada.
export function mapClock(c: ClockMap, srcMs: number, rxMs: number): number {
  if (!Number.isFinite(srcMs)) {
    c.off = null;
    return rxMs;
  }
  const d = rxMs - srcMs;
  if (c.off === null || d < c.off || d - c.off > 500) c.off = d;
  else c.off = Math.min(d, c.off + (rxMs - c.at) * 0.002);
  c.at = rxMs;
  return srcMs + c.off;
}
