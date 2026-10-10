// Fijos del GPS que sirven para dibujar: con hora, en orden de tiempo, sin el fijo vacío (0, 0) y con el error
// acotado.
import { MAX_HACC } from "./constants";
import type { FixColumns, FixesInput, FixRecord } from "./types";
import { num } from "./util";

export interface CleanFixes {
  t: number[];
  lat: number[];
  lon: number[];
  // m/s (NaN: sin velocidad del GPS)
  spd: number[];
  // m (NaN: sin precisión declarada)
  acc: number[];
  n: number;
}

function isFixList(fixes: FixesInput): fixes is readonly (FixRecord | null | undefined)[] {
  return Array.isArray(fixes);
}

// Acepta la lista [{t, lat, lon, speed, hacc}] o las columnas de Location.csv ({t: [...], lat: [...], ...}).
export function cleanFixes(fixes: FixesInput): CleanFixes {
  const t: number[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  const spd: number[] = [];
  const acc: number[] = [];
  // Sin lista ni columnas no hay ningún fijo que leer (count se queda en 0).
  let get: (k: number) => FixRecord = () => ({});
  let count = 0;
  if (isFixList(fixes)) {
    const list = fixes;
    count = list.length;
    get = (k) => list[k] || {};
  } else if (fixes && fixes.t && fixes.lat && fixes.lon) {
    const cols: FixColumns = fixes;
    count = cols.t.length;
    get = (k) => ({
      t: cols.t[k],
      lat: cols.lat[k],
      lon: cols.lon[k],
      speed: cols.speed ? cols.speed[k] : NaN,
      hacc: cols.hacc ? cols.hacc[k] : NaN,
    });
  }
  let last = -Infinity;
  for (let k = 0; k < count; k++) {
    const f = get(k);
    const ft = num(f.t);
    const la = num(f.lat);
    const lo = num(f.lon);
    if (!Number.isFinite(ft) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    // 0,0 es el fijo vacío de algunos registradores
    if (Math.abs(la) > 85 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) continue;
    if (ft <= last) continue;
    const h = num(f.hacc);
    if (Number.isFinite(h) && h > MAX_HACC) continue;
    const v = num(f.speed);
    t.push(ft);
    lat.push(la);
    lon.push(lo);
    spd.push(Number.isFinite(v) && v >= 0 ? v : NaN);
    acc.push(Number.isFinite(h) && h > 0 ? h : NaN);
    last = ft;
  }
  return { t, lat, lon, spd, acc, n: t.length };
}
