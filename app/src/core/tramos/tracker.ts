// Pasadas por un tramo con camino (guardado de una ruta): se reconoce por la posición, con el tiempo de salida a meta y
// el tiempo a cada 20 m.
import { geometry, MARK, ON, project, type Geometry } from "./path";
import type { LocSeries, PassResult, PathTramo, TramoEstado } from "./types";

const OFF_S = 12; // s fuera del trazado (o sin GPS) y la pasada no vale
// Líneas de salida y de meta: 10 m dentro del trazado por cada lado. Un tramo guardado empieza donde se echó a rodar y
// acaba donde se paró, así que en esa misma grabación no hay posiciones antes del principio ni después del final:
// con las líneas en los extremos no se reconocía ni la pasada de la que salió.
export const GATE = 10;
// m desde la salida en los que estar parado no cuenta (se espera a echar a rodar).
const START_M = 30;

interface Run {
  t0: number;
  j: number;
  last: { t: number; s: number };
  seen: number;
  marks: number[];
  vMax: number;
}

export type TrackerEvent = { evento: "fin"; pasada: PassResult };

// Sigue una pasada por un tramo, fijo a fijo (t en s, del reloj que sea; v en m/s). fix() devuelve null, o
// { evento: "fin", pasada } al terminar el tramo. Las marcas de tiempo van cada 20 m desde la salida (la primera, 0).
export class Tracker {
  readonly tramo: PathTramo;
  readonly geo: Geometry;
  readonly s0: number;
  readonly s1: number;
  run: Run | null = null;
  private prev: { t: number; s: number } | null = null;

  constructor(tramo: PathTramo) {
    this.tramo = tramo;
    this.geo = geometry(tramo);
    this.s0 = Math.min(GATE, this.geo.L * 0.05);
    this.s1 = this.geo.L - this.s0;
  }

  reset(): void {
    this.run = null;
    this.prev = null;
  }

  fix(t: number, lat: number, lon: number, v: number): TrackerEvent | null {
    const geo = this.geo;
    const [x, y] = geo.toXY(lat, lon);
    const b = geo.box;
    // Lejos de todo el tramo (más de 300 m de su caja): nada que mirar.
    if (x < b.x0 - 300 || x > b.x1 + 300 || y < b.y0 - 300 || y > b.y1 + 300) {
      this.reset();
      return null;
    }
    const r = this.run;
    if (!r) {
      // Esperando la salida: cruzarla hacia delante cerca del trazado (en sus primeros 400 m).
      const p = project(geo, x, y, 0, 40);
      const prev = this.prev;
      this.prev = p && p.d < ON ? { t, s: p.s } : null;
      if (!p || p.d >= ON || !prev || !(prev.s < this.s0 && p.s >= this.s0 && p.s - prev.s < 200))
        return null;
      const t0 = prev.t + ((t - prev.t) * (this.s0 - prev.s)) / (p.s - prev.s);
      this.run = { t0, j: p.j, last: { t, s: p.s }, seen: t, marks: [0], vMax: v || 0 };
      this.mark(t0, this.s0, t, p.s);
      return null;
    }
    // En marcha: cerca del último segmento (y hacia delante). Parar en el tramo vale (cuenta en el tiempo); lo que no
    // vale es salirse de él o quedarse sin GPS más de OFF_S.
    const p = project(geo, x, y, r.j - 5, r.j + 60);
    if (!p || p.d >= ON || t - r.seen > OFF_S) {
      if (t - r.seen > OFF_S) this.reset();
      return null;
    }
    r.seen = t;
    if (p.s < r.last.s - 100) {
      // Media vuelta: la pasada no vale.
      this.reset();
      return null;
    }
    if (v > r.vMax) r.vMax = v;
    r.j = p.j;
    // Parado al poco de salir (en los primeros START_M): el reloj espera a que eche a rodar. En la subida de Los
    // Loros del 9 de octubre se esperaron 14 s a 20 m de la salida y la pasada los contaba (5:06,9 en vez de 4:52).
    if (!(v > 1) && p.s < this.s0 + START_M) {
      r.t0 = t;
      r.marks = [0];
      r.last = { t, s: Math.max(p.s, this.s0) };
      r.vMax = 0;
      return null;
    }
    if (p.s >= this.s1) {
      const t1 =
        r.last.t + ((t - r.last.t) * (this.s1 - r.last.s)) / Math.max(1e-6, p.s - r.last.s);
      this.mark(r.last.t, r.last.s, t1, this.s1);
      const pasada: PassResult = {
        t0: r.t0,
        t1,
        tiempo: Math.round((t1 - r.t0) * 1000) / 1000,
        tiempos: r.marks.map((m) => Math.round(m * 100) / 100),
        vMax: Math.round(r.vMax * 3.6),
      };
      this.reset();
      return { evento: "fin", pasada };
    }
    if (p.s > r.last.s) {
      this.mark(r.last.t, r.last.s, t, p.s);
      r.last = { t, s: p.s };
    }
    return null;
  }

  // Tiempo (desde la salida) en cada marca de 20 m (desde la salida, hasta la meta) entre (ta, sa) y (tb, sb).
  private mark(ta: number, sa: number, tb: number, sb: number): void {
    const r = this.run;
    if (!r) return;
    for (;;) {
      const s = this.s0 + r.marks.length * MARK;
      if (s > Math.min(sb, this.s1)) break;
      if (s < sa) {
        r.marks.push(ta - r.t0);
        continue;
      }
      const f = sb > sa ? (s - sa) / (sb - sa) : 0;
      r.marks.push(ta + (tb - ta) * f - r.t0);
    }
  }

  estado(t: number): TramoEstado {
    const r = this.run;
    if (!r) return { en: false };
    return {
      en: true,
      s: r.last.s - this.s0,
      t0: r.t0,
      tiempo: t - r.t0,
      // Tiempo en el último fijo (el que corresponde a s).
      tFix: r.last.t - r.t0,
      frac: Math.max(0, Math.min(1, (r.last.s - this.s0) / (this.s1 - this.s0))),
    };
  }
}

// Todas las pasadas completas por un tramo en una grabación (loc: series de posiciones).
export function findPasses(tramo: PathTramo, loc: LocSeries): PassResult[] {
  const tk = new Tracker(tramo);
  const out: PassResult[] = [];
  for (let i = 0; i < loc.t.length; i++) {
    if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
    const r = tk.fix(loc.t[i], loc.lat[i], loc.lon[i], loc.speed[i] >= 0 ? loc.speed[i] : 0);
    if (r && r.evento === "fin") out.push(r.pasada);
  }
  return out;
}
