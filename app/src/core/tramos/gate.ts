// Tramos de salida y meta: puestos solo con su salida y su meta (coordenadas pegadas de Google Maps o la posición de
// ese momento), sin camino: al pasar por la salida empieza a contar y al llegar a la meta para. La primera pasada le
// enseña el camino (pts) y desde ahí sirve también para comparar pasadas.
import { localizer, type ToXY } from "./coords";
import { fromLoc, geometry, MARK, needsPath, ON, project, type Geometry } from "./path";
import type { GateTramo, LatLon, LocSeries, PassResult, TramoEstado } from "./types";

export const GATE_R = 30; // m alrededor de la salida y de la meta
const GATE_MAX_S = 7200; // s: más de 2 h desde la salida, esa pasada ya no vale
const GATE_TIGHT = 15; // m
const GATE_DONE = 0.75; // parte del camino hecha para que la meta valga
const GATE_STALL_S = 300; // s sin avanzar por el camino

// Protecciones (`guard`) de las subidas de montaña, que van en los dos sentidos: al acabar una se sale por la salida de
// la contraria, y una pasada así (que no va hacia su meta) ni se enseña ni puede contar.
const AWAY = 1500; // m más lejos de la meta que al salir: se fue por otro lado
const BACK = 150; // m: alejarse de la salida más que esto y volver a ella sin haber avanzado es dar la vuelta
const OUT = 100; // m: el trozo de la salida que se guarda para reconocer la vuelta por la misma carretera
const RETRACE = 10; // m: tan cerca de ese trozo, es la misma carretera (una herradura de otra altura va a 20–30 m)
const OK_PATH = 100; // m por el camino aprendido: ya va por el tramo
const OK_NEAR = 150; // m más cerca de la meta que al salir (sin camino): ya va hacia ella
const OFF_PATH_S = 120; // s sin empezar a avanzar por el camino aprendido: sigue como si no lo tuviera
// Para el panel basta menos: 10 s en marcha y haber estado 30 m más cerca de la meta que al salir (una carretera que
// sale de lado tarda en acercarse 150 m, y puede alejarse luego un rato; la contraria de una que acaba nunca se acerca).
const SHOW_S = 10;
const SHOW_NEAR = 30;

interface GateRun {
  t0: number;
  dA0: number;
  atB: { t: number; d: number } | null;
  dB: number;
  j: number;
  s: number;
  tS: number;
  // Con guard: la distancia a la meta al salir y la menor desde entonces, lo más lejos de la salida, el trozo de la
  // salida (m locales), si ya va por el tramo y si sigue sin el camino aprendido (no le cuadra).
  dB0: number;
  dBmin: number;
  aMax: number;
  out: [number, number][];
  ok: boolean;
  off: boolean;
}

interface Fix {
  t: number;
  x: number;
  y: number;
  v: number;
}

export interface GateOptions {
  guard?: boolean;
}

// sinCamino: con guard, la pasada no siguió el camino aprendido (hay que volver a aprenderlo de ella).
export type GateEvent = { evento: "fin"; t0: number; t1: number; sinCamino?: true };

// Distancia de (x, y) a la polilínea `line`.
function lineDist(line: readonly [number, number][], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = i + 1 < line.length ? line[i + 1] : line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * u - x, ay + dy * u - y));
  }
  return best;
}

// Sigue una pasada de salida a meta. Cuenta desde el momento en que se pasa más cerca de la salida (a menos de GATE_R;
// parado allí, desde que se echa a rodar) hasta el momento en que se pasa más cerca de la meta, entre fijos (en línea
// recta: a 80 km/h hay 22 m de uno a otro). En una carretera de montaña, una curva de otra altura puede pasar a
// 20–30 m de la salida o de la meta: la salida es la pasada más cerca (si luego se pasa más cerca aún, antes de la
// meta, se empieza ahí; parándose en ella, también), y la meta solo vale con el camino casi hecho (GATE_DONE, ya
// aprendido) o, sin camino aún, pasando a menos de GATE_TIGHT (o parando dentro del círculo): en la subida de Los
// Loros, una herradura de abajo pasa a 25 m de un punto de arriba. Acaba al salir del círculo de la meta o al pararse
// en él.
//
// Con `guard` (las subidas de montaña): una pasada que se aleja de su meta 1,5 km más que al salir se deshace; la que
// vuelve a pasar por la salida sin haber avanzado (por la misma carretera, si aún no hay camino: dio la vuelta) vuelve
// a empezar allí; la que no sigue el camino aprendido en 2 min sigue como sin él y avisa al acabar (sinCamino); y el
// panel dice si ya va de verdad por el tramo (ok).
export class GateTracker {
  readonly tramo: GateTramo;
  readonly toXY: ToXY;
  readonly B: [number, number];
  // Más lejos que esto de la meta (3 veces la distancia en línea recta y 2 km), ya no se va hacia ella.
  readonly far: number;
  // Con el camino ya aprendido, por dónde va (para la meta y la diferencia con la mejor pasada en el panel).
  readonly geo: Geometry | null;
  readonly guard: boolean;
  run: GateRun | null = null;
  private vis: { t: number; d: number; x: number; y: number } | null = null;
  private prev: Fix | null = null;

  constructor(tramo: GateTramo, opts: GateOptions = {}) {
    this.tramo = tramo;
    this.toXY = localizer(tramo.salida[0], tramo.salida[1]);
    this.B = this.toXY(tramo.meta[0], tramo.meta[1]);
    this.far = 3 * Math.hypot(this.B[0], this.B[1]) + 2000;
    this.geo = needsPath(tramo) ? null : geometry(tramo as GateTramo & { pts: LatLon[] });
    this.guard = !!opts.guard;
  }

  reset(): void {
    this.run = null;
    this.vis = null;
  }

  fix(t: number, lat: number, lon: number, v: number): GateEvent | null {
    const [x, y] = this.toXY(lat, lon);
    const cur: Fix = { t, x, y, v: v > 0 ? v : 0 };
    const prev = this.prev && t - this.prev.t <= 5 ? this.prev : null;
    this.prev = cur;
    const moving = cur.v > 1;
    // Lo más cerca de (px, py) desde el fijo anterior hasta este: { d, t } y dónde. Si en este se ha parado, llegó
    // frenando (en el doble de lo que se tarda a la velocidad del anterior), no en este fijo.
    const near = (px: number, py: number) => {
      if (!prev) return { d: Math.hypot(x - px, y - py), t, x, y };
      const dx = x - prev.x;
      const dy = y - prev.y;
      const l2 = dx * dx + dy * dy;
      const u =
        l2 > 0 ? Math.max(0, Math.min(1, ((px - prev.x) * dx + (py - prev.y) * dy) / l2)) : 1;
      const d = Math.hypot(prev.x + dx * u - px, prev.y + dy * u - py);
      const tu =
        !moving && prev.v > 1
          ? Math.min(t, prev.t + (2 * u * Math.sqrt(l2)) / prev.v)
          : prev.t + (t - prev.t) * u;
      return { d, t: tu, x: prev.x + dx * u, y: prev.y + dy * u };
    };
    const a = near(0, 0);
    const b = near(this.B[0], this.B[1]);
    const dB = Math.hypot(x - this.B[0], y - this.B[1]);
    let r = this.run;
    if (a.d < GATE_R && !(r && r.atB)) {
      // Parado en la salida, o pasando más cerca que donde empezó: la salida es ahora. Con guard, también si dio la
      // vuelta (lo de antes no era esta pasada).
      if (r && (!moving || a.d < r.dA0 || this.turnedBack(r, a.x, a.y))) this.run = r = null;
      if (!r) {
        if (!moving) this.vis = { t, d: Math.hypot(x, y), x, y };
        else if (!this.vis || a.d <= this.vis.d) this.vis = { t: a.t, d: a.d, x: a.x, y: a.y };
        return null;
      }
    } else if (this.vis && !r) {
      // Deja el círculo de la salida: empieza la pasada.
      const vis = this.vis;
      this.run = r = {
        t0: vis.t,
        dA0: vis.d,
        atB: null,
        dB,
        j: 0,
        s: 0,
        tS: vis.t,
        dB0: dB,
        dBmin: dB,
        aMax: 0,
        out: [[vis.x, vis.y]],
        ok: false,
        off: false,
      };
      this.vis = null;
    }
    if (!r) return null;
    r.dB = dB;
    const geo = r.off ? null : this.geo;
    if (geo) {
      const [gx, gy] = geo.toXY(lat, lon);
      const p = project(geo, gx, gy, r.j - 5, r.j + 60);
      if (p && p.d < ON && p.s > r.s) {
        r.s = p.s;
        r.j = p.j;
        r.tS = t;
      }
    }
    if (this.guard) this.check(r, t, x, y, !!geo);
    // Se fue por otro lado: muy lejos de la meta, o (con camino) 5 min sin avanzar por él. La pasada no vale. Con
    // guard, también 1,5 km más lejos de la meta que al salir.
    if (
      t - r.t0 > GATE_MAX_S ||
      dB > this.far ||
      (geo && t - r.tS > GATE_STALL_S) ||
      (this.guard && dB > r.dB0 + AWAY)
    ) {
      this.reset();
      return null;
    }
    const done = geo ? r.s >= GATE_DONE * geo.L : true;
    if (b.d < GATE_R && done) {
      if ((b.d < (geo ? GATE_R : GATE_TIGHT) || !moving) && (!r.atB || b.d < r.atB.d))
        r.atB = { t: b.t, d: b.d };
      // Parado en la meta: ha llegado.
      return !moving && r.atB ? this.finish() : null;
    }
    // Fuera ya del círculo de la meta después de pasar por ella: la pasada acabó en el momento más cerca.
    return r.atB ? this.finish() : null;
  }

  // Con guard, cada fijo de una pasada: el trozo de la salida, si ya va de verdad por el tramo (avanzando por el camino
  // o acercándose a la meta) y, con camino, si en 2 min no ha empezado a seguirlo (sigue sin él).
  private check(r: GateRun, t: number, x: number, y: number, withPath: boolean): void {
    const dA = Math.hypot(x, y);
    if (r.aMax <= OUT && r.out.length < 50) r.out.push([x, y]);
    r.aMax = Math.max(r.aMax, dA);
    r.dBmin = Math.min(r.dBmin, r.dB);
    if (!r.ok)
      r.ok = withPath
        ? r.s >= OK_PATH
        : r.dB0 - r.dBmin >= Math.min(OK_NEAR, Math.max(30, 0.25 * r.dB0));
    if (withPath && !r.ok && t - r.t0 > OFF_PATH_S) r.off = true;
  }

  // ¿Vuelve a pasar por la salida después de dar la vuelta? Lejos ya (más de BACK) sin haber avanzado por el tramo y,
  // sin camino que lo diga, por la misma carretera por la que salió (una herradura de otra altura va a 20–30 m).
  private turnedBack(r: GateRun, px: number, py: number): boolean {
    if (!this.guard || r.ok || r.aMax <= BACK) return false;
    return (!!this.geo && !r.off) || lineDist(r.out, px, py) < RETRACE;
  }

  private finish(): GateEvent {
    const r = this.run as GateRun & { atB: { t: number; d: number } };
    const out: GateEvent = { evento: "fin", t0: r.t0, t1: r.atB.t };
    if (this.guard && r.off) out.sinCamino = true;
    this.reset();
    return out;
  }

  // La grabación se acaba dentro aún del círculo de la meta (ya pasada por ella): la pasada está hecha.
  flush(): GateEvent | null {
    return this.run && this.run.atB ? this.finish() : null;
  }

  estado(t: number): TramoEstado {
    const r = this.run;
    if (!r) return { en: false };
    const geo = r.off ? null : this.geo;
    return {
      en: true,
      gate: true,
      t0: r.t0,
      tiempo: t - r.t0,
      dMeta: r.dB,
      // Con camino: por dónde va (m desde la salida) y el tiempo en el último fijo que avanzó.
      s: geo ? r.s : null,
      tFix: r.tS - r.t0,
      frac: geo ? Math.max(0, Math.min(1, r.s / geo.L)) : null,
      ...(this.guard ? { ok: r.ok || (t - r.t0 >= SHOW_S && r.dB0 - r.dBmin >= SHOW_NEAR) } : {}),
    };
  }
}

// Pasadas de salida a meta en las posiciones de una grabación: [{t0, t1}]. open: la que va en marcha al final cuenta
// hasta el último fijo (al tocar «Meta aquí» se está en la meta aunque no se haya parado aún).
export function findGatePasses(
  tramo: GateTramo,
  loc: LocSeries,
  open?: boolean,
  opts?: GateOptions,
): { t0: number; t1: number }[] {
  const tk = new GateTracker(tramo, opts);
  const out: { t0: number; t1: number }[] = [];
  let last: number | null = null;
  for (let i = 0; i < loc.t.length; i++) {
    if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
    const r = tk.fix(loc.t[i], loc.lat[i], loc.lon[i], loc.speed[i] >= 0 ? loc.speed[i] : 0);
    last = loc.t[i];
    if (r) out.push({ t0: r.t0, t1: r.t1 });
  }
  if (open && tk.run && last !== null && last > tk.run.t0)
    out.push({ t0: tk.run.t0, t1: tk.run.atB ? tk.run.atB.t : last });
  return out;
}

// Una vuelta que vuelve a su salida (circuito marcado con «Salida aquí» y «Meta aquí»): tras rodar al menos LOOP_MIN
// m desde t0, la primera vez que se pasa a menos de LOOP_R de la salida en el mismo sentido que al salir (en un
// circuito pequeño, otra parte de la pista pasa cerca, pero en otro sentido), el momento en que se está más cerca
// (entre dos fijos, en línea recta; si se para allí, al llegar). after: m rodados desde entonces hasta tEnd (se toca
// «Meta aquí» un poco después de pasar); pending: aún llegando (lo más cerca es el último fijo y va en marcha: la
// vuelta la cerrará el cronómetro al cruzar la línea).
const LOOP_MIN = 300;
const LOOP_R = 50;

export interface LoopEnd {
  t: number;
  d: number;
  after: number;
  pending: boolean;
}

export function loopEnd(loc: LocSeries, salida: LatLon, t0: number, tEnd: number): LoopEnd | null {
  const toXY = localizer(salida[0], salida[1]);
  const F: Fix[] = [];
  for (let i = 0; i < loc.t.length; i++) {
    const t = loc.t[i];
    if (t < t0 || t > tEnd) continue;
    if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
    const [x, y] = toXY(loc.lat[i], loc.lon[i]);
    F.push({ t, x, y, v: loc.speed[i] >= 0 ? loc.speed[i] : 0 });
  }
  // Distancia rodada hasta cada fijo (los ratos parados no suman: el GPS baila).
  const cum = [0];
  for (let i = 1; i < F.length; i++)
    cum.push(
      cum[i - 1] +
        (F[i].v > 2 || F[i - 1].v > 2 ? Math.hypot(F[i].x - F[i - 1].x, F[i].y - F[i - 1].y) : 0),
    );
  // Hacia dónde se sale: de la salida al primer fijo a más de 20 m.
  const out = F.find((f) => Math.hypot(f.x, f.y) > 20);
  const hd = out ? Math.hypot(out.x, out.y) : 0;
  // ¿Llega a i yendo hacia allí? (parado, con lo último que se movió: el GPS parado baila hacia cualquier lado)
  const sameWay = (i: number) => {
    if (!out) return true;
    for (let j = i; j > 0; j--) {
      if (!(F[j].v > 2 || F[j - 1].v > 2)) continue;
      const dx = F[j].x - F[j - 1].x;
      const dy = F[j].y - F[j - 1].y;
      const l = Math.hypot(dx, dy);
      if (l >= 1) return (dx * out.x + dy * out.y) / (l * hd) > 0.5;
    }
    return true;
  };
  let k = -1;
  for (let i = 1; i < F.length && k < 0; i++)
    if (cum[i] >= LOOP_MIN && Math.hypot(F[i].x, F[i].y) < LOOP_R && sameWay(i)) k = i;
  if (k < 0) return null;
  let best: { i: number; u: number; d: number; t: number } | null = null;
  for (let i = k - 1; i < F.length - 1; i++) {
    const a = F[i];
    const b = F[i + 1];
    if (i >= k && Math.hypot(a.x, a.y) >= LOOP_R) break;
    if (!(a.v > 2)) break;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
    const d = Math.hypot(a.x + dx * u, a.y + dy * u);
    // Parando en b: llega frenando (a ritmo constante, en el doble de lo que tardaría a la velocidad de a), no en b.
    const t = b.v > 2 ? a.t + (b.t - a.t) * u : Math.min(b.t, a.t + (2 * u * Math.sqrt(l2)) / a.v);
    if (!best || d < best.d) best = { i, u, d, t };
  }
  if (!best) best = { i: k, u: 0, d: Math.hypot(F[k].x, F[k].y), t: F[k].t };
  const n = F.length - 1;
  const at = best.i < n ? cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.u : cum[n];
  const lastAt = best.i === n || (best.i === n - 1 && best.u >= 1);
  return { t: best.t, d: best.d, after: cum[n] - at, pending: lastAt && F[n].v > 2 };
}

// El camino de un tramo de salida y meta, sacado de una pasada (de t0 a t1, en s de la grabación): de donde se echó a
// rodar a donde se pasó más cerca de la meta. Es para dibujarlo y comparar pasadas; el tiempo lo siguen dando la
// salida y la meta. {pts, largo} o null (menos de 300 m o más de 50 km).
export function learnPath(
  _tramo: GateTramo,
  loc: LocSeries,
  t0: number,
  t1: number,
): { pts: LatLon[]; largo: number } | null {
  return fromLoc(loc, t0, t1);
}

// Una pasada de salida a meta (de t0 a t1) con sus marcas cada 20 m a lo largo del camino del tramo (si lo tiene):
// las posiciones de entre medias, llevadas al camino y siempre hacia delante, desde 0 (salida) hasta el final (meta).
export function gatePass(tramo: GateTramo, loc: LocSeries, t0: number, t1: number): PassResult {
  const pas: PassResult = {
    t0,
    t1,
    tiempo: Math.round((t1 - t0) * 1000) / 1000,
    tiempos: [],
    vMax: 0,
  };
  let vMax = 0;
  for (let i = 0; i < loc.t.length; i++)
    if (loc.t[i] >= t0 && loc.t[i] <= t1 && loc.speed[i] > vMax) vMax = loc.speed[i];
  pas.vMax = Math.round(vMax * 3.6);
  if (needsPath(tramo)) return pas;
  const geo = geometry(tramo as GateTramo & { pts: LatLon[] });
  const L = geo.L;
  const smp = [{ t: t0, s: 0 }];
  let j = 0;
  for (let i = 0; i < loc.t.length; i++) {
    const t = loc.t[i];
    if (t <= t0 || t >= t1) continue;
    if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
    const [x, y] = geo.toXY(loc.lat[i], loc.lon[i]);
    const p = project(geo, x, y, j - 5, j + 60);
    if (!p || p.d >= ON) continue;
    j = p.j;
    if (p.s > smp[smp.length - 1].s && p.s < L) smp.push({ t, s: p.s });
  }
  smp.push({ t: t1, s: L });
  let k = 0;
  for (let s = 0; s <= L; s += MARK) {
    while (k < smp.length - 2 && smp[k + 1].s < s) k++;
    const a = smp[k];
    const b = smp[k + 1];
    const f = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
    pas.tiempos.push(Math.round((a.t + (b.t - a.t) * f - t0) * 100) / 100);
  }
  return pas;
}
