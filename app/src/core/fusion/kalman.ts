// Posición y velocidad en la pista a 60 Hz: Kalman [s, v, sesgo] con acelerómetro y fijos GPS que llegan tarde.
// Guarda unos segundos de historia: un fijo atrasado se aplica en su instante y se repasa lo que vino después.
import {
  copyState,
  filterParams,
  HistoryNode,
  propagate,
  seed,
  step,
  type FilterParams,
} from "./model";
import type { FixOptions, FixResult, TrackKalmanOptions, TrackState } from "./types";

// Por defecto; ajustados con las vueltas sintéticas de tfusion.js.
const DEFAULTS = {
  accelSigma: 0.5, // ruido del acelerómetro ya suavizado (m/s²)
  biasSigma: 0.01, // deriva del sesgo del acelerómetro (m/s² por √s)
  sSigma: 3.5, // error del fijo a lo largo de la pista (m), GPS del móvil
  vSigma: 0.3, // error de su velocidad (m/s)
  history: 3, // segundos de historia para rebobinar
};
// Nodos ya fuera de la historia que se dejan acumular antes de quitarlos de golpe.
const COMPACT = 1024;

function wrap(x: number, L: number): number {
  let r = x % L;
  if (r < 0) r += L;
  return r >= L ? r - L : r;
}

function blank(): TrackState {
  return { s: NaN, v: NaN, b: NaN, sSigma: NaN, ready: false, lap: NaN };
}

// El valor si es un número finito y positivo; si no, el de por defecto.
function pick(v: number | undefined, def: number): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : def;
}

export class TrackKalman {
  readonly L: number;
  readonly accelSigma: number;
  readonly biasSigma: number;
  readonly sSigma: number;
  readonly vSigma: number;
  readonly history: number;
  private readonly params: FilterParams;
  private readonly tmp = new HistoryNode(0);
  private nodes: HistoryNode[] = [];
  private head = 0;
  private laps = 0;
  private isReady = false;

  constructor(opts: TrackKalmanOptions) {
    if (!(opts.L > 0)) throw new Error("TrackKalman: falta L, la longitud de la pista (m)");
    this.L = opts.L;
    this.accelSigma = pick(opts.accelSigma, DEFAULTS.accelSigma);
    this.biasSigma = pick(opts.biasSigma, DEFAULTS.biasSigma);
    this.sSigma = pick(opts.sSigma, DEFAULTS.sSigma);
    this.vSigma = pick(opts.vSigma, DEFAULTS.vSigma);
    this.history = pick(opts.history, DEFAULTS.history);
    this.params = filterParams(this.L, this.accelSigma, this.biasSigma);
  }

  // Vueltas completadas (cruces de meta hacia delante) desde reset.
  get lapCount(): number {
    return this.laps;
  }

  // Hay estado (ya llegó el primer fijo con posición).
  get ready(): boolean {
    return this.isReady;
  }

  private clear(): void {
    this.nodes = [];
    this.head = 0;
    this.laps = 0;
    this.isReady = false;
  }

  // t: segundos del reloj de la app (crecientes); a: aceleración longitudinal (m/s²) o NaN si aún no hay ejes.
  predict(t: number, a: number): void {
    if (!Number.isFinite(t)) return;
    const n = new HistoryNode(t);
    n.inA = true;
    n.a = Number.isFinite(a) ? a : NaN;
    this.insert(n);
  }

  // tMeas: instante al que se refiere el fijo (llegada − retraso). Devuelve { accepted, innovation }.
  // sMeas o vMeas a NaN: el fijo no los trae.
  update(tMeas: number, sMeas: number, vMeas: number, opts?: FixOptions): FixResult {
    const o = opts || {};
    const ss = pick(o.sSigma, this.sSigma);
    const vs = pick(o.vSigma, this.vSigma);
    const n = new HistoryNode(tMeas);
    n.fix = true;
    n.fs = Number.isFinite(sMeas) ? wrap(sMeas, this.L) : NaN;
    n.fv = Number.isFinite(vMeas) ? vMeas : NaN;
    if (!Number.isFinite(tMeas) || (Number.isNaN(n.fs) && Number.isNaN(n.fv)))
      return { accepted: false, innovation: NaN };
    n.rs = ss * ss;
    n.rv = vs * vs;
    this.insert(n);
    return { accepted: n.ok, innovation: n.nu };
  }

  // Estado en t (por defecto, el último predict) sin tocar el filtro. Antes del primer fijo, todo NaN.
  // lap: vuelta coherente con s (la de lapCount, salvo que t ya pase la meta).
  state(t?: number): TrackState {
    const N = this.nodes;
    if (!this.isReady) return blank();
    const last = N[N.length - 1];
    const tq = t !== undefined && Number.isFinite(t) ? t : last.t;
    const base = tq >= last.t ? last : N[tq <= N[this.head].t ? this.head : this.find(tq)];
    const x = this.tmp;
    copyState(base, x);
    if (Number.isNaN(x.s)) return blank();
    propagate(this.params, x, tq - base.t, base.u);
    const L = this.L;
    let lap: number;
    let s: number;
    if (base === last) {
      // Coherente con lapCount: si una corrección echa atrás justo después de cruzar la meta, s se queda en 0
      // en vez de volver al final de la vuelta anterior.
      lap = this.laps;
      s = x.s - lap * L;
      if (s < 0) s = 0;
      else if (s >= L) {
        const k = Math.floor(s / L);
        lap += k;
        s = wrap(s - k * L, L);
      }
    } else {
      lap = Math.floor(x.s / L);
      s = wrap(x.s, L);
    }
    return {
      s,
      v: x.v,
      b: !Number.isNaN(x.u) ? x.b : NaN,
      sSigma: Math.sqrt(x.pss),
      ready: true,
      lap,
    };
  }

  // Sin argumentos (o sin t o s válidos), vacía el filtro; con ellos, además lo hace nacer ahí (v puede faltar). La
  // lectura del acelerómetro vigente se conserva.
  reset(t?: number, s?: number, v?: number): void {
    const N = this.nodes;
    const u = N.length ? N[N.length - 1].u : NaN;
    this.clear();
    if (t === undefined || s === undefined || !Number.isFinite(t) || !Number.isFinite(s)) return;
    const n = new HistoryNode(t);
    n.u = u;
    seed(
      n,
      wrap(s, this.L),
      v !== undefined && Number.isFinite(v) ? v : NaN,
      this.sSigma * this.sSigma,
      this.vSigma * this.vSigma,
    );
    this.nodes.push(n);
    this.settle();
  }

  // Último nodo con t ≤ tq (tq no anterior al más viejo).
  private find(tq: number): number {
    const N = this.nodes;
    let lo = this.head;
    let hi = N.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (N[mid].t <= tq) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Mete el nodo en su sitio de la historia y repasa lo posterior. Lo normal (lecturas en orden) es añadir al
  // final: O(1). Un fijo atrasado rebobina hasta su instante, se aplica ahí y se repiten las lecturas siguientes.
  // Si es más viejo que toda la historia, se aplica en la entrada más antigua.
  private insert(n: HistoryNode): void {
    const N = this.nodes;
    const last = N.length - 1;
    if (last < 0) {
      n.u = n.a;
      if (n.fix && !Number.isNaN(n.fs)) {
        seed(n, n.fs, n.fv, n.rs, n.rv);
        n.ok = true;
        n.nu = 0;
      }
      N.push(n);
    } else if (n.t >= N[last].t) {
      N.push(n);
      step(this.params, N[last], n);
    } else {
      if (n.t < N[this.head].t) n.t = N[this.head].t;
      const j = this.find(n.t);
      N.splice(j + 1, 0, n);
      for (let k = j + 1; k < N.length; k++) step(this.params, N[k - 1], N[k]);
    }
    this.settle();
  }

  private settle(): void {
    const N = this.nodes;
    const last = N[N.length - 1];
    const cut = last.t - this.history;
    while (this.head < N.length - 1 && N[this.head + 1].t <= cut) this.head++;
    if (this.head >= COMPACT && this.head * 2 >= N.length) {
      N.splice(0, this.head);
      this.head = 0;
    }
    this.isReady = !Number.isNaN(last.s);
    if (this.isReady) {
      // Las vueltas solo suben: un vaivén en la meta no cuenta dos veces.
      const k = Math.floor(last.s / this.L);
      if (k > this.laps) this.laps = k;
    }
  }
}
