// Entrenamiento en 8: cuenta los ochos con el giroscopio (a la velocidad y con el radio de un 8 el GPS no da para
// tanto). Cada «vuelta» de un lado (lóbulo) es un giro sostenido hacia ese lado; dos seguidas de lados contrarios, de
// al menos MIN_TURN cada una, son un 8. Para cada uno: su tiempo, la inclinación máxima a cada lado y las
// velocidades. Sin página ni motor: recibe cada muestra (giro con signo, inclinación y velocidad).

// Giro (rad/s, en media de 0,3 s) a partir del que se está girando hacia un lado, y por debajo del que se va recto.
// 0,2 rad/s es un círculo de 25 m de radio a 18 km/h: los ochos grandes también cuentan.
export const YAW_IN = 0.2;
export const YAW_OUT = 0.08;
// Lo mínimo que hay que girar hacia un lado para que cuente como una vuelta del 8 (rad: 200°).
export const MIN_TURN = (200 * Math.PI) / 180;
// Menos que esto (rad: 45°) es un temblor o un zigzag: no cuenta para nada (tampoco corta el 8 empezado). Entre esto y
// MIN_TURN, una vuelta a medias: sí lo corta.
export const WIGGLE_TURN = (45 * Math.PI) / 180;
// Recto o parado más de esto: la vuelta se acaba (s).
const QUIET_S = 1.2;
// Entre las dos vueltas de un 8 cabe como mucho esto recto (s).
const PAIR_GAP_S = 4;
// Por debajo de esta velocidad no se cuenta como rodando (m/s: 4,3 km/h).
const MOVING = 1.2;

export type Side = 1 | -1; // 1: derecha, −1: izquierda

// Una vuelta hacia un lado: cuánto se ha girado (grados), la inclinación máxima en ella (grados), las velocidades (m/s)
// y si llega para ser medio 8.
export interface Lobe {
  dir: Side;
  t0: number;
  t1: number;
  turn: number;
  leanMax: number | null;
  vMin: number | null;
  vMax: number | null;
  valid: boolean;
}

// Un 8: sus dos vueltas, su tiempo (s) y lo de cada lado.
export interface Ocho {
  num: number;
  t0: number;
  t1: number;
  time: number;
  leanL: number | null;
  leanR: number | null;
  vMin: number | null;
  vMax: number | null;
  first: Lobe;
  second: Lobe;
}

// Lo que va pasando, para el panel.
export interface OchoState {
  count: number;
  // La vuelta en marcha: hacia dónde, cuánto se lleva girado (grados) y desde cuándo (s).
  lobe: { dir: Side; turn: number; elapsed: number } | null;
  // El 8 empezado (su primera vuelta ya hecha) y desde cuándo (s).
  open: { dir: Side; elapsed: number } | null;
  last: Ocho | null;
  best: number | null;
}

// Resumen de la sesión (va en el resumen de la grabación y en la lista).
export interface OchoSummary {
  n: number;
  mejor: number | null;
  media: number | null;
  desviacion: number | null;
  izq: number | null;
  der: number | null;
  vueltas: number;
}

interface OpenLobe {
  dir: Side;
  t0: number;
  turn: number;
  // Lo más tumbado hacia el lado del giro y hacia el otro (ver close).
  leanIn: number | null;
  leanOut: number | null;
  vMin: number | null;
  vMax: number | null;
  quiet: number;
  quietFrom: number;
}

const DEG = 180 / Math.PI;
const maxOf = (a: number | null, b: number) => (a === null || b > a ? b : a);
const minOf = (a: number | null, b: number) => (a === null || b < a ? b : a);
const maxN = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);
const minN = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);

export class OchoTracker {
  readonly lobes: Lobe[] = [];
  readonly ochos: Ocho[] = [];
  private lastT: number | null = null;
  private ySig = 0;
  private lobe: OpenLobe | null = null;
  // La primera vuelta de un 8 que aún no se ha cerrado con la segunda.
  private pending: Lobe | null = null;

  // Una muestra: t (s), giro con signo alrededor de la vertical (rad/s, + a derechas), inclinación (grados, + a
  // derechas) y velocidad (m/s). Devuelve el 8 que acaba de cerrarse, si alguno.
  step(t: number, yawRate: number, lean: number, v: number): Ocho | null {
    const dt = this.lastT === null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (!Number.isFinite(yawRate)) return null;
    this.ySig += (yawRate - this.ySig) * (1 - Math.exp(-dt / 0.3));
    const moving = v > MOVING;
    let done: Ocho | null = null;
    const L = this.lobe;
    if (L) {
      L.turn += yawRate * dt * L.dir;
      if (moving) {
        // La inclinación cuenta mientras se gira hacia el lado de la vuelta: al cambiar de vuelta, la moto ya va
        // tumbada hacia el otro lado antes de que se note el cambio de giro en la media.
        if (Number.isFinite(lean) && yawRate * L.dir > 0) {
          L.leanIn = maxOf(L.leanIn, lean * L.dir);
          L.leanOut = maxOf(L.leanOut, -lean * L.dir);
        }
        if (Number.isFinite(v)) {
          L.vMin = minOf(L.vMin, v);
          L.vMax = maxOf(L.vMax, v);
        }
      }
      const reversed = moving && Math.sign(this.ySig) === -L.dir && Math.abs(this.ySig) > YAW_IN;
      if (!moving || Math.abs(this.ySig) < YAW_OUT) {
        if (L.quiet === 0) L.quietFrom = t;
        L.quiet += dt;
      } else L.quiet = 0;
      if (reversed) done = this.close(t);
      else if (L.quiet > QUIET_S) done = this.close(L.quietFrom);
    }
    if (!this.lobe && moving && Math.abs(this.ySig) > YAW_IN)
      this.lobe = {
        dir: this.ySig > 0 ? 1 : -1,
        t0: t,
        turn: 0,
        leanIn: null,
        leanOut: null,
        vMin: null,
        vMax: null,
        quiet: 0,
        quietFrom: t,
      };
    return done;
  }

  // Al terminar: la vuelta en marcha se cierra (si era la segunda de un 8, el 8 cuenta).
  finish(t: number): Ocho | null {
    return this.lobe ? this.close(t) : null;
  }

  private close(t1: number): Ocho | null {
    const L = this.lobe as OpenLobe;
    this.lobe = null;
    // Un temblor del soporte o un zigzag en el cruce del 8: ni se apunta ni corta el 8 empezado.
    if (L.turn < WIGGLE_TURN) return null;
    // Lo más tumbado en la vuelta: en un 8 se va tumbado hacia dentro, hacia el lado del giro. Si lo de hacia fuera
    // domina, es que los signos del giro y de la inclinación aún no cuadran (el giro se comprueba con el GPS): vale
    // ese. Así tampoco se cuela el principio de la vuelta siguiente (ya tumbado hacia el otro lado).
    const leanMax = (L.leanIn ?? -Infinity) >= (L.leanOut ?? -Infinity) ? L.leanIn : L.leanOut;
    const lobe: Lobe = {
      dir: L.dir,
      t0: L.t0,
      t1,
      turn: L.turn * DEG,
      leanMax,
      vMin: L.vMin,
      vMax: L.vMax,
      valid: L.turn >= MIN_TURN,
    };
    this.lobes.push(lobe);
    if (!lobe.valid) {
      // Media vuelta o un zigzag: el 8 empezado no sigue.
      this.pending = null;
      return null;
    }
    const p = this.pending;
    if (p && p.dir === -lobe.dir && lobe.t0 - p.t1 <= PAIR_GAP_S) {
      this.pending = null;
      const left = p.dir === -1 ? p : lobe;
      const right = p.dir === 1 ? p : lobe;
      const ocho: Ocho = {
        num: this.ochos.length + 1,
        t0: p.t0,
        t1: lobe.t1,
        time: lobe.t1 - p.t0,
        leanL: left.leanMax,
        leanR: right.leanMax,
        vMin: minN(p.vMin, lobe.vMin),
        vMax: maxN(p.vMax, lobe.vMax),
        first: p,
        second: lobe,
      };
      this.ochos.push(ocho);
      return ocho;
    }
    this.pending = lobe;
    return null;
  }

  state(t: number): OchoState {
    const L = this.lobe;
    const p = this.pending;
    return {
      count: this.ochos.length,
      lobe: L ? { dir: L.dir, turn: L.turn * DEG, elapsed: t - L.t0 } : null,
      open: p ? { dir: p.dir, elapsed: t - p.t0 } : null,
      last: this.ochos.length ? this.ochos[this.ochos.length - 1] : null,
      best: this.best(),
    };
  }

  best(): number | null {
    let b: number | null = null;
    for (const o of this.ochos) b = minOf(b, o.time);
    return b;
  }

  summary(): OchoSummary {
    const times = this.ochos.map((o) => o.time);
    const n = times.length;
    const media = n ? times.reduce((a, b) => a + b, 0) / n : null;
    const desviacion =
      n > 1 && media !== null
        ? Math.sqrt(times.reduce((a, b) => a + (b - media) * (b - media), 0) / (n - 1))
        : null;
    let izq: number | null = null;
    let der: number | null = null;
    for (const o of this.ochos) {
      izq = maxN(izq, o.leanL);
      der = maxN(der, o.leanR);
    }
    return {
      n,
      mejor: this.best(),
      media,
      desviacion,
      izq,
      der,
      vueltas: this.lobes.filter((l) => l.valid).length,
    };
  }
}
