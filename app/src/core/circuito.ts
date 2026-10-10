// Cronómetro para cualquier circuito (en la ruta libre): con el trazado que saca el constructor de las propias vueltas,
// o con uno guardado, cuenta las vueltas por la línea de meta, la mejor y la diferencia con ella por distancia
// recorrida. No depende de nada de Maspalomas.

const DEG = Math.PI / 180;
const ON_M = 25; // m al eje para contar como en el circuito (pista + error del GPS del móvil)
const GRID_M = 4; // m de la rejilla de la vuelta (como la del panel de Maspalomas)
const OFF_S = 3; // s fuera del circuito que anulan la vuelta (boxes, salida de pista)

// Un circuito: su eje [[lat, lon]] (índice 0 = meta) y lo que añade el constructor.
export interface CircuitTrack {
  name: string;
  origin: { lat: number; lon: number };
  centerline: [number, number][];
  length: number;
  direction?: unknown;
  corners?: unknown;
  sectorBounds?: unknown;
}

export interface Lap {
  num: number;
  time: number;
  valid: boolean;
  t0: number;
  t1: number;
  prevBest?: number | null;
  isBest?: boolean;
}

type XY = [number, number];

function ring(i: number, n: number): number {
  return ((i % n) + n) % n;
}

// Metros locales alrededor del origen del circuito (x al este, y al norte): en unos kilómetros, error de milímetros
// por metro, y el mismo para la vuelta de referencia y la de ahora.
function projector(origin: { lat: number; lon: number }): (lat: number, lon: number) => XY {
  const kx = Math.cos(origin.lat * DEG) * 111320;
  const ky = 110574;
  return (lat, lon) => [(lon - origin.lon) * kx, (lat - origin.lat) * ky];
}

function nearestOn(C: XY[], x: number, y: number, from: number, to: number) {
  const n = C.length;
  let best = Infinity;
  let bi = 0;
  let bf = 0;
  for (let k = from; k <= to; k++) {
    const i = ring(k, n);
    const a = C[i];
    const b = C[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    const d = Math.hypot(x - a[0] - dx * f, y - a[1] - dy * f);
    if (d < best) {
      best = d;
      bi = i;
      bf = f;
    }
  }
  return { i: bi, f: bf, dist: best };
}

interface CircuitGeometry {
  xy: (lat: number, lon: number) => XY;
  C: XY[];
  cs: Float64Array;
  n: number;
  L: number;
}

// Eje en metros (cerrado, sin repetir el primer punto), al revés si se rueda en el otro sentido (la meta sigue en el
// punto 0), y su distancia acumulada.
function geometry(track: CircuitTrack, reverse: boolean): CircuitGeometry {
  const xy = projector(track.origin);
  let C: XY[] = track.centerline.map((p) => xy(p[0], p[1]));
  const last = C[C.length - 1];
  if (C.length > 2 && Math.hypot(last[0] - C[0][0], last[1] - C[0][1]) < 0.5) C = C.slice(0, -1);
  if (reverse) C = [C[0]].concat(C.slice(1).reverse());
  const n = C.length;
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const b = C[(i + 1) % n];
    cs[i + 1] = cs[i] + Math.hypot(b[0] - C[i][0], b[1] - C[i][1]);
  }
  return { xy, C, cs, n, L: cs[n] };
}

function gridOf(samples: { s: number; tl: number }[], L: number, time: number): number[] {
  const pts = samples.concat([{ s: L, tl: time }]);
  const m = Math.floor(L / GRID_M) + 1;
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const s = Math.min(k * GRID_M, L);
    while (j < pts.length - 2 && pts[j + 1].s < s) j++;
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const f = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
    out.push(a.tl + (b.tl - a.tl) * f);
  }
  return out;
}

export function gridAt(grid: readonly number[], s: number): number {
  const k = Math.max(0, Math.min(grid.length - 2, Math.floor(s / GRID_M)));
  const f = Math.max(0, Math.min(1, (s - k * GRID_M) / GRID_M));
  return grid[k] + (grid[k + 1] - grid[k]) * f;
}

export interface LapState {
  lapNum: number;
  lapTime: number | null;
  best: number | null;
  last: Lap | null;
  delta: number | null;
}

export class LapTimer {
  readonly track: CircuitTrack;
  readonly reverse: boolean;
  readonly xy: CircuitGeometry["xy"];
  readonly C: XY[];
  readonly cs: Float64Array;
  readonly n: number;
  readonly L: number;
  // Ventana a cada lado de la meta para reconocer el cruce (en un kart de 300 m, no media vuelta).
  readonly win: number;
  prev: { t: number; s: number; on: boolean } | null = null;
  prevI: number | null = null;
  lapStart: number | null = null;
  lapNum = 0;
  samples: { s: number; tl: number }[] = [];
  lapOk = true;
  lastOn: number | null = null;
  laps: Lap[] = [];
  best: { time: number; grid: number[]; num: number } | null = null;
  fix: { t: number; s: number; v: number; on: boolean } | null = null;
  // Cruces de meta puestos a mano (s del reloj de la tanda): un circuito marcado con «Salida aquí» y «Meta aquí»
  // empieza parado en la línea (sin pasar lanzado por ella), así que su primera vuelta va entre esos dos momentos.
  forced: number[] = [];
  // Dos cruces más seguidos que esto no son una vuelta (el cruce a mano y el de verdad, o el GPS rebotando en la
  // línea): el segundo no cuenta.
  readonly minLap: number;

  constructor(track: CircuitTrack, reverse?: boolean) {
    this.track = track;
    this.reverse = !!reverse;
    const g = geometry(track, this.reverse);
    this.xy = g.xy;
    this.C = g.C;
    this.cs = g.cs;
    this.n = g.n;
    this.L = g.L;
    this.win = Math.min(200, this.L / 4);
    this.minLap = Math.max(5, this.L / 60);
  }

  // Fijo del GPS (t en s, el reloj de la tanda). Devuelve la vuelta si con él se ha cerrado una.
  onFix(t: number, lat: number, lon: number, v: number): Lap | null {
    let forcedLap: Lap | null = null;
    while (this.forced.length && t >= this.forced[0])
      forcedLap = this.cross(this.forced.shift() as number) || forcedLap;
    const [x, y] = this.xy(lat, lon);
    let m = this.prevI !== null ? nearestOn(this.C, x, y, this.prevI - 10, this.prevI + 60) : null;
    if (!m || m.dist > ON_M) m = nearestOn(this.C, x, y, 0, this.n - 1);
    const s = this.cs[m.i] + (this.cs[m.i + 1] - this.cs[m.i]) * m.f;
    const on = m.dist < ON_M && v > 4;
    const prev = this.prev;
    let done: Lap | null = null;
    if (on) this.lastOn = t;
    else if (this.lapStart !== null && this.lastOn !== null && t - this.lastOn > OFF_S)
      this.lapOk = false;
    if (prev && prev.on && on && t - prev.t < 3 && t > prev.t) {
      const L = this.L;
      if (prev.s > L - this.win && s < this.win) {
        const span = s + L - prev.s;
        if (span > 0 && span < this.win * 1.3) {
          const tc = prev.t + ((L - prev.s) / span) * (t - prev.t);
          done = this.cross(tc);
          this.samples.push({ s, tl: t - (this.lapStart as number) });
        }
      } else if (this.lapStart !== null && s > prev.s && s - prev.s < this.win) {
        this.samples.push({ s, tl: t - this.lapStart });
      }
    }
    this.prev = { t, s, on };
    this.prevI = on ? m.i : null;
    this.fix = { t, s, v, on };
    return done || forcedLap;
  }

  // Cruce de meta en tc: cierra la vuelta en curso (si la había) y empieza otra.
  cross(tc: number): Lap | null {
    if (this.lapStart !== null && tc - this.lapStart < this.minLap) return null;
    let lap: Lap | null = null;
    if (this.lapStart !== null) {
      const time = tc - this.lapStart;
      const covered = this.samples.length ? this.samples[this.samples.length - 1].s : 0;
      const valid =
        this.lapOk &&
        this.samples.length > 8 &&
        covered > 0.8 * this.L &&
        time > 0 &&
        (this.best === null || time < this.best.time * 1.6);
      lap = { num: this.lapNum, time, valid, t0: this.lapStart, t1: tc };
      this.laps.push(lap);
      if (valid) {
        const prevBest = this.best ? this.best.time : null;
        lap.prevBest = prevBest;
        lap.isBest = prevBest === null || time < prevBest;
        if (lap.isBest)
          this.best = { time, grid: gridOf(this.samples, this.L, time), num: this.lapNum };
      }
    }
    this.lapStart = tc;
    this.lapNum += 1;
    this.samples = [{ s: 0, tl: 0 }];
    this.lapOk = true;
    return lap;
  }

  // Lo que enseña el panel en t: vuelta en curso, su tiempo y la diferencia con la mejor por distancia (con el último
  // fijo adelantado con su velocidad; lag: lo que ese fijo describe el pasado).
  state(t: number, lag?: number): LapState {
    const f = this.fix;
    const out: LapState = {
      lapNum: this.lapNum,
      lapTime: this.lapStart !== null ? t - this.lapStart : null,
      best: this.best ? this.best.time : null,
      last: this.laps.length ? this.laps[this.laps.length - 1] : null,
      delta: null,
    };
    if (this.best && this.lapStart !== null && f && f.on) {
      const dt = Math.max(0, Math.min(2.5, t - (f.t - (lag || 0))));
      const s = Math.min(this.L, f.s + f.v * dt);
      out.delta = t - this.lapStart - gridAt(this.best.grid, s);
    }
    return out;
  }
}

export interface RecentFix {
  t: number;
  lat: number;
  lon: number;
  v: number;
}

// ¿Va por un circuito guardado? recent: fijos de los últimos segundos. Hace falta que todos estén a menos de ON_M del
// eje y que avancen ≥ 60 m en un sentido durante ≥ 5 s: entonces {track, reverse}.
export function matchSaved(
  list: readonly CircuitTrack[] | null | undefined,
  recent: readonly RecentFix[],
): { track: CircuitTrack; reverse: boolean } | null {
  if (!recent.length || recent[recent.length - 1].t - recent[0].t < 5) return null;
  for (const track of list || []) {
    let g: CircuitGeometry;
    try {
      g = geometry(track, false);
    } catch {
      continue;
    }
    let ok = true;
    let adv = 0;
    let prevS: number | null = null;
    for (const p of recent) {
      const [x, y] = g.xy(p.lat, p.lon);
      const m = nearestOn(g.C, x, y, 0, g.n - 1);
      if (m.dist > ON_M) {
        ok = false;
        break;
      }
      const s = g.cs[m.i] + (g.cs[m.i + 1] - g.cs[m.i]) * m.f;
      if (prevS !== null) {
        let ds = s - prevS;
        if (ds > g.L / 2) ds -= g.L;
        if (ds < -g.L / 2) ds += g.L;
        adv += ds;
      }
      prevS = s;
    }
    if (ok && Math.abs(adv) >= 60) return { track, reverse: adv < 0 };
  }
  return null;
}

// Para guardar: el eje cada ~4 m (un circuito de 5 km, ~1.250 puntos) y redondeado a ~1 cm.
export function compact(track: CircuitTrack): CircuitTrack {
  const n = track.centerline.length;
  const step = Math.max(1, Math.round(4 / Math.max(0.5, track.length / n)));
  const centerline: [number, number][] = [];
  for (let i = 0; i < n; i += step)
    centerline.push([+track.centerline[i][0].toFixed(7), +track.centerline[i][1].toFixed(7)]);
  return {
    name: track.name,
    origin: track.origin,
    centerline,
    length: track.length,
    direction: track.direction,
    corners: track.corners,
    sectorBounds: track.sectorBounds,
  };
}
