// Entrenamiento en 8: cuenta los ochos con el giroscopio (a la velocidad y con el radio de un 8 el GPS no da para
// tanto). Cada «vuelta» de un lado (lóbulo) es un giro sostenido hacia ese lado; dos seguidas de lados contrarios, de
// MIN_TURN a MAX_TURN cada una, son un 8. Para cada uno: su tiempo, la inclinación a cada lado y las velocidades del
// GPS. Sin página ni motor: recibe cada muestra (giro con signo, inclinación y velocidades).

// Giro (rad/s, en media de 0,3 s) a partir del que se está girando hacia un lado, y por debajo del que se va recto.
// 0,2 rad/s es un círculo de 25 m de radio a 18 km/h: los ochos grandes también cuentan.
export const YAW_IN = 0.2;
export const YAW_OUT = 0.08;
// Lo mínimo que hay que girar hacia un lado para que cuente como una vuelta del 8 (rad: 200°). Una S, dos medias vueltas
// de 180°, no llega.
export const MIN_TURN = (200 * Math.PI) / 180;
// Lo máximo (rad: 420°). Una vuelta de un 8 gira 180° más dos veces el ángulo del cruce: hasta 360°, el 8 de dos
// círculos que se tocan (más lo que se pase el giroscopio, un 3 %, y el cambio de lado). Más son círculos al mismo
// lado, no la mitad de un 8 (12-oct: 4 círculos y luego una vuelta al otro lado contaban como un 8 de 31 s).
export const MAX_TURN = (420 * Math.PI) / 180;
// Entre una vuelta entera y MAX_TURN, un bucle se nota en que tarda mucho más que las vueltas de antes (12-oct: una de
// 401° en 12,7 s, con las demás en 5,3): más de LOOP_SLOW veces su mediana (con al menos LOOP_HISTORY vueltas que valgan).
const FULL_TURN = 2 * Math.PI;
const LOOP_SLOW = 1.5;
const LOOP_HISTORY = 4;
// Media corta del giro (s) para saber desde cuándo se gira hacia un lado: la vuelta se cuenta desde ahí, no desde que
// la media de 0,3 s pasa de YAW_IN, y hasta lo más girado (antes de que se note el cambio de lado). Así no se pierden
// los 30–60° del principio y del final de cada vuelta (12-oct: vueltas de 230° salían de 170–190° y el 8 no contaba).
const FAST_S = 0.1;
// Menos que esto (rad: 45°) es un temblor o un zigzag: no cuenta para nada (tampoco corta el 8 empezado). Entre esto y
// MIN_TURN, una vuelta a medias: sí lo corta.
export const WIGGLE_TURN = (45 * Math.PI) / 180;
// Recto o parado más de esto: la vuelta se acaba (s).
const QUIET_S = 1.2;
// Entre las dos vueltas de un 8 cabe como mucho esto recto (s).
const PAIR_GAP_S = 4;
// Por debajo de esta velocidad no se cuenta como rodando (m/s: 4,3 km/h).
const MOVING = 1.2;
// El GPS del Vivo da velocidad 0 en uno o dos fijos al ir despacio (por debajo de ~9 km/h; el 12-oct, casi siempre al
// cambiar de lado): girando como gira una moto y rodando hace menos de esto (s), se sigue rodando (esos ceros cortaban
// vueltas por la mitad).
const GPS_ZERO_S = 3;
// Lo más que gira una moto en un 8 (rad/s, en media de 0,3 s; el 12-oct, como mucho 1,6). Más, con el GPS parado, es el
// móvil en la mano (2,5–3 rad/s): ya no se espera a que vuelva a rodar. Tampoco si, con el GPS parado, la moto deja de
// girar STOP_S: se ha parado, y lo que se gire después (el móvil en la mano, más despacio) no es de la vuelta.
const BIKE_YAW_MAX = 2;
const STOP_S = 0.3;
// La inclinación sostenida de una vuelta: la mediana mientras gira al menos esta parte de lo más que gira en ella (sin
// la entrada ni la salida; vale igual en un 8 cerrado a 1,5 rad/s que en uno grande a 0,25).
const HOLD_FRAC = 0.6;

export type Side = 1 | -1; // 1: derecha, −1: izquierda

// Una vuelta hacia un lado: cuánto se ha girado (grados), la inclinación máxima y la sostenida (grados), las
// velocidades del GPS (m/s) y si llega para ser medio 8.
export interface Lobe {
  dir: Side;
  t0: number;
  t1: number;
  turn: number;
  leanMax: number | null;
  leanHold: number | null;
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
  holdL: number | null;
  holdR: number | null;
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

// Resumen de la sesión (va en el resumen de la grabación y en la lista). izq/der: lo más tumbado de toda la sesión;
// izqTipica/derTipica: la inclinación sostenida de las vueltas (mediana de los ochos). vueltaIzq/vueltaDer: lo que
// tarda una vuelta a cada lado (mediana, s). circulos: las veces que se dieron vueltas de más al mismo lado (más de
// una vuelta entera que no valen: no cuentan como 8).
export interface OchoSummary {
  n: number;
  mejor: number | null;
  media: number | null;
  desviacion: number | null;
  izq: number | null;
  der: number | null;
  izqTipica: number | null;
  derTipica: number | null;
  vueltaIzq: number | null;
  vueltaDer: number | null;
  vueltas: number;
  circulos: number;
}

interface OpenLobe {
  dir: Side;
  t0: number;
  turn: number;
  // Lo más girado hasta ahora (al cambiar de lado, el giro ya resta antes de que se note).
  peak: number;
  // Lo más tumbado hacia el lado del giro y hacia el otro (ver close), y cada muestra girando hacia su lado: el giro
  // (media de 0,3 s) y la inclinación, los dos hacia ese lado.
  leanIn: number | null;
  leanOut: number | null;
  holdYaw: number[];
  holdLean: number[];
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
function median(xs: readonly (number | null)[]): number | null {
  const s = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class OchoTracker {
  readonly lobes: Lobe[] = [];
  readonly ochos: Ocho[] = [];
  // Lo rodado (m) desde MOVING: los ochos lentos no llegan a los 3 m/s desde los que suma el recorrido.
  dist = 0;
  private lastT: number | null = null;
  private ySig = 0;
  // Media corta del giro y lo girado desde que pasa de YAW_OUT hacia el lado de runDir (0: recto).
  private yFast = 0;
  private run = 0;
  private runDir: Side | 0 = 0;
  // La última vez (s) que se dijo rodando, y cuánto lleva la moto sin girar con el GPS parado (s).
  private rodandoT = -Infinity;
  private stillT = 0;
  private lobe: OpenLobe | null = null;
  // La primera vuelta de un 8 que aún no se ha cerrado con la segunda.
  private pending: Lobe | null = null;

  // Una muestra: t (s), giro con signo alrededor de la vertical (rad/s, + a derechas), inclinación (grados, + a
  // derechas), velocidad del motor (m/s, la del GPS adelantada con el acelerómetro) y la del último fijo del GPS (la de
  // las velocidades de cada 8; sin ella, la del motor). Devuelve el 8 que acaba de cerrarse, si alguno.
  step(t: number, yawRate: number, lean: number, v: number, vGps: number = v): Ocho | null {
    const dt = this.lastT === null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (v > MOVING) this.dist += v * dt;
    if (!Number.isFinite(yawRate)) return null;
    this.ySig += (yawRate - this.ySig) * (1 - Math.exp(-dt / 0.3));
    this.yFast += (yawRate - this.yFast) * (1 - Math.exp(-dt / FAST_S));
    const aw = Math.abs(this.ySig);
    if (v > MOVING) {
      this.rodandoT = t;
      this.stillT = 0;
    } else {
      // Con el GPS parado, un giro que no es de moto (el móvil en la mano) o la moto un rato sin girar: parado de
      // verdad, ya no se espera a que vuelva a rodar.
      this.stillT = aw < YAW_OUT ? this.stillT + dt : 0;
      if (aw >= BIKE_YAW_MAX || this.stillT >= STOP_S) this.rodandoT = -Infinity;
    }
    const moving =
      v > MOVING || (t - this.rodandoT < GPS_ZERO_S && aw > YAW_IN && aw < BIKE_YAW_MAX);
    // Parado no cuenta: lo girado en el sitio no es de ninguna vuelta.
    const fast: Side | 0 = !moving || Math.abs(this.yFast) < YAW_OUT ? 0 : this.yFast > 0 ? 1 : -1;
    if (fast !== this.runDir) this.run = 0;
    this.runDir = fast;
    if (fast) this.run += yawRate * dt * fast;
    let done: Ocho | null = null;
    const L = this.lobe;
    if (L) {
      if (moving) {
        L.turn += yawRate * dt * L.dir;
        L.peak = Math.max(L.peak, L.turn);
        // La inclinación cuenta mientras se gira hacia el lado de la vuelta: al cambiar de vuelta, la moto ya va
        // tumbada hacia el otro lado antes de que se note el cambio de giro en la media.
        if (Number.isFinite(lean) && yawRate * L.dir > 0) {
          L.leanIn = maxOf(L.leanIn, lean * L.dir);
          L.leanOut = maxOf(L.leanOut, -lean * L.dir);
          if (this.ySig * L.dir > YAW_IN) {
            L.holdYaw.push(this.ySig * L.dir);
            L.holdLean.push(lean * L.dir);
          }
        }
        // Las velocidades, las del GPS rodando (sus ceros sueltos no lo son).
        if (Number.isFinite(vGps) && vGps > MOVING) {
          L.vMin = minOf(L.vMin, vGps);
          L.vMax = maxOf(L.vMax, vGps);
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
    if (!this.lobe && moving && Math.abs(this.ySig) > YAW_IN) {
      const dir: Side = this.ySig > 0 ? 1 : -1;
      // Lo ya girado hacia ese lado antes de que la media lo notara.
      const pre = this.runDir === dir ? this.run : 0;
      this.lobe = {
        dir,
        t0: t,
        turn: pre,
        peak: pre,
        leanIn: null,
        leanOut: null,
        holdYaw: [],
        holdLean: [],
        vMin: null,
        vMax: null,
        quiet: 0,
        quietFrom: t,
      };
    }
    return done;
  }

  // Al terminar: la vuelta en marcha se cierra (si era la segunda de un 8, el 8 cuenta).
  finish(t: number): Ocho | null {
    return this.lobe ? this.close(t) : null;
  }

  private close(t1: number): Ocho | null {
    const L = this.lobe as OpenLobe;
    this.lobe = null;
    // Lo girado en la vuelta: lo más que se llegó a girar hacia su lado.
    const turn = L.peak;
    // Un temblor del soporte o un zigzag en el cruce del 8: ni se apunta ni corta el 8 empezado.
    if (turn < WIGGLE_TURN) return null;
    // Lo más tumbado en la vuelta: en un 8 se va tumbado hacia dentro, hacia el lado del giro. Si lo de hacia fuera
    // domina, es que los signos del giro y de la inclinación aún no cuadran (el giro se comprueba con el GPS): vale
    // ese. Así tampoco se cuela el principio de la vuelta siguiente (ya tumbado hacia el otro lado).
    const inward = (L.leanIn ?? -Infinity) >= (L.leanOut ?? -Infinity);
    const leanMax = inward ? L.leanIn : L.leanOut;
    const top = L.holdYaw.reduce((a, b) => Math.max(a, b), 0);
    const hold = median(L.holdLean.filter((_, i) => L.holdYaw[i] >= top * HOLD_FRAC));
    // Un bucle: más de una vuelta entera y mucho más lento que las vueltas que valieron antes.
    const before = this.lobes
      .filter((l) => l.valid)
      .slice(-20)
      .map((l) => l.t1 - l.t0);
    const usual = before.length >= LOOP_HISTORY ? median(before) : null;
    const loop = turn > FULL_TURN && usual !== null && t1 - L.t0 > LOOP_SLOW * usual;
    const lobe: Lobe = {
      dir: L.dir,
      t0: L.t0,
      t1,
      turn: turn * DEG,
      leanMax,
      leanHold: hold === null ? null : inward ? hold : -hold,
      vMin: L.vMin,
      vMax: L.vMax,
      // Y que el GPS la haya visto rodando alguna vez: con el GPS parado toda la vuelta, el giro es del móvil en la mano.
      valid: turn >= MIN_TURN && turn <= MAX_TURN && !loop && L.vMax !== null,
    };
    this.lobes.push(lobe);
    if (!lobe.valid) {
      // Media vuelta, un zigzag, un bucle o círculos al mismo lado: el 8 empezado no sigue.
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
        holdL: left.leanHold,
        holdR: right.leanHold,
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
    const inOchos = this.ochos.flatMap((o) => [o.first, o.second]);
    const vuelta = (side: Side) =>
      median(inOchos.filter((l) => l.dir === side).map((l) => l.t1 - l.t0));
    return {
      n,
      mejor: this.best(),
      media,
      desviacion,
      izq,
      der,
      izqTipica: median(this.ochos.map((o) => o.holdL)),
      derTipica: median(this.ochos.map((o) => o.holdR)),
      vueltaIzq: vuelta(-1),
      vueltaDer: vuelta(1),
      vueltas: this.lobes.filter((l) => l.valid).length,
      circulos: this.lobes.filter((l) => !l.valid && l.turn > 360).length,
    };
  }
}
