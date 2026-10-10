// Recorrido en cualquier carretera (o en el circuito): la línea de trazada con su fase (frena, acelera, mantiene,
// tiempo muerto), las curvas que se van pasando y los máximos. Todo con lo que mide el móvil.
// Coordenadas en metros locales (T.toLocal). Inclinación en grados, + a derechas. Aceleración en g.
// Lo alimenta el motor del directo (y el repaso de una grabación) en orden de tiempo: onFix con cada fijo bueno del
// GPS y step con cada muestra de los sensores; al terminar, summary.
import { closeBrake } from "./brakes";
import { BRAKE_NOW, G, PH_HOLD, STEP, TRAIL_G, TRAIL_LEAN, YAW_IN, YAW_OUT } from "./constants";
import { closeCurve } from "./curves";
import { phaseOf } from "./phase";
import { summarize } from "./summary";
import type {
  Brake,
  BrakeCue,
  CourseFix,
  Curve,
  Estimate,
  Fix,
  OpenBrake,
  OpenCurve,
  OpenWheelie,
  Phase,
  Position,
  RideStats,
  RideSummary,
  StepInput,
  TrailPoint,
  Wheelie,
  WheelieLoss,
} from "./types";

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Recorrido {
  trail: TrailPoint[] = [];
  curves: Curve[] = [];
  curve: OpenCurve | null = null;
  fix: Fix | null = null;
  heading: number | null = null;
  yawS = 0;
  ySig = 0;
  quiet: number | null = null;
  brake: BrakeCue | null = null;
  lastT: number | null = null;
  lastPh: Phase = "mantiene";
  phCand: { ph: Phase; t: number } | null = null;
  wheelies: Wheelie[] = [];
  wheelie: OpenWheelie | null = null;
  brakes: Brake[] = [];
  bk: OpenBrake | null = null;
  // Velocidades del GPS de los últimos 20 s y frenadas por confirmar con ellas.
  vHist: [number, number][] = [];
  pendingBrk: Brake[] = [];
  lastBrk: Brake | null = null;
  pHist: [number, number][] = [];
  // Posición suavizada (giroscopio + GPS) y signo del giro comprobado con el rumbo del GPS.
  est: Estimate | null = null;
  useEst = false;
  yawSign = 1;
  yawVote = 0;
  hAccum = 0;
  prevCourse: number | null = null;
  cfix: CourseFix | null = null;
  // Receptor GPS externo (10–25 Hz, preciso): sus correcciones van en proporción al tiempo entre fijos y tiran
  // más de la línea (lo pone el panel según de dónde llegue cada fijo).
  fast = false;
  // Estimaciones de los últimos 4 s: [t, x, y, rumbo].
  hist: [number, number, number, number][] = [];
  corr: [number, number, number] = [0, 0, 0];
  lag = 0;
  lossOpen: WheelieLoss | null = null;
  aHist: [number, number][] = [];
  gapNext = false;
  stats: RideStats = {
    dist: 0,
    t0: null,
    t1: null,
    vMax: 0,
    leanR: 0,
    leanL: 0,
    brakeMax: 0,
    accMax: 0,
  };
  // Fase de los umbrales tal cual en el paso anterior (sin poner hasta el primer paso).
  rawPh?: Phase;
  // Al cerrar una curva, una frenada o un caballito (los pone el panel, para enseñar su resumen unos segundos).
  onCurve?: (c: Curve) => void;
  onBrake?: (b: Brake) => void;
  onWheelie?: (w: Wheelie) => void;

  // Posición del GPS (ya en metros locales). El rumbo sale del desplazamiento entre fijos separados al menos
  // 0,6 s: a 1 Hz son todos; con un receptor de 25 Hz, entre fijos seguidos hay 1–2 m y saldría del temblor.
  onFix(t: number, x: number, y: number, v: number): void {
    const f = this.fix;
    const gap = !!f && t - f.t > 4;
    if (gap) this.gapNext = true;
    const a = this.cfix;
    let course: number | null = null;
    let mid: number | null = null;
    if (!a || gap || t - a.t > 4) {
      this.cfix = { t, x, y };
      this.hAccum = 0;
      this.prevCourse = null;
      // Tras un corte, la línea vuelve a empezar con el primer rumbo nuevo (el de antes ya no vale).
      if (gap) this.est = null;
    } else if (t - a.t >= 0.6) {
      if (Math.hypot(x - a.x, y - a.y) > 2) {
        course = Math.atan2(y - a.y, x - a.x);
        mid = (a.t + t) / 2;
        this.heading = course;
      }
      // Signo del giro: lo girado por el giroscopio entre fijos tiene que ir hacia el mismo lado que el rumbo
      // del GPS (si un móvil lo da al revés, se corrige solo).
      if (course !== null && this.prevCourse !== null) {
        const dc = wrapAngle(course - this.prevCourse);
        if (Math.abs(dc) > 0.1 && Math.abs(this.hAccum) > 0.05) {
          this.yawVote = Math.max(-20, Math.min(20, this.yawVote + Math.sign(dc * this.hAccum)));
          if (this.yawVote <= -5) {
            this.yawSign = -this.yawSign;
            this.yawVote = 0;
          }
        }
      }
      this.hAccum = 0;
      if (course !== null) this.prevCourse = course;
      this.cfix = { t, x, y };
    }
    // Posición suavizada (giroscopio + velocidad) que el GPS corrige poco a poco. El fijo dice dónde estaba la
    // moto hace `lag` s y su rumbo es el medio entre los dos últimos fijos: se comparan con la estimación de
    // esos mismos instantes (historial), no con la de ahora; si no, en cada curva se torcería la línea.
    const e = this.est;
    const hp = e && !gap ? this.histAt(t - this.lag) : null;
    if (hp) {
      let ex = x - hp.x;
      let ey = y - hp.y;
      if (Math.hypot(ex, ey) > 60) this.est = null;
      else {
        // A 1 Hz se corrige el 35 % del error en cada fijo. Con un receptor rápido, en proporción al tiempo entre
        // fijos (sumar el 35 % 25 veces por segundo haría oscilar la línea) y más fuerte, que su GPS es mejor
        // que la estimación: ~0,5 s para alcanzarlo. (Con posición suavizada ya hubo un fijo antes: f no es null.)
        const k = this.fast
          ? Math.min(0.5, 1.5 * Math.max(0.02, Math.min(1, t - (f as Fix).t)))
          : 0.35;
        ex *= k;
        ey *= k;
        let dh = 0;
        if (course !== null && v > 3) {
          // mid va siempre con course.
          const hm = this.histAt((mid as number) - this.lag);
          if (hm) dh = wrapAngle(course - hm.h) * 0.3;
        }
        // No de golpe: la corrección se reparte en el medio segundo siguiente (sin quiebros en la línea).
        this.corr[0] += ex;
        this.corr[1] += ey;
        this.corr[2] += dh;
      }
    }
    const cur = this.est;
    if ((!cur || gap || !hp) && (course !== null || cur)) {
      const h = course !== null ? course : (cur as Estimate).h;
      this.est = {
        x: x + Math.cos(h) * v * this.lag,
        y: y + Math.sin(h) * v * this.lag,
        h,
      };
      this.hist = [];
      this.corr = [0, 0, 0];
    }
    this.fix = { t, x, y, v };
    if (v > this.stats.vMax) this.stats.vMax = v;
    this.vHist.push([t, v]);
    while (this.vHist.length && t - this.vHist[0][0] > 20) this.vHist.shift();
    this.checkBrakes(t);
  }

  // Velocidad del GPS en el instante t de la moto (el fijo de las t + lag lo describe), o null.
  vAt(t: number): number | null {
    const H = this.vHist;
    const tf = t + (this.lag || 0);
    if (!H.length || tf < H[0][0] || tf > H[H.length - 1][0]) return null;
    let k = 0;
    while (k < H.length - 2 && H[k + 1][0] <= tf) k++;
    const a = H[k];
    const b = H[k + 1] || a;
    if (b[0] - a[0] > 3) return null;
    const f = b[0] > a[0] ? (tf - a[0]) / (b[0] - a[0]) : 0;
    return a[1] + (b[1] - a[1]) * f;
  }

  // Una frenada del acelerómetro vale si el GPS la ve: la velocidad tiene que bajar al menos el 40 % de lo que
  // dice el acelerómetro (y 2 km/h). Con la vibración, alguna «frenada» de 0,3–0,4 g sin bajar la velocidad era
  // ruido o un bache (en 3 rutas de un Vivo Y33s, 8–20 %). Se mira cuando el GPS ya ha visto el final (medio
  // segundo después); sin GPS se queda como está.
  checkBrakes(tFix: number): void {
    const lag = this.lag || 0;
    this.pendingBrk = this.pendingBrk.filter((b) => {
      if (tFix - lag < b.endT + 0.5) return true;
      const v0 = this.vAt(b.t - 0.3);
      const v1 = this.vAt(b.endT + 0.3);
      if (v0 === null || v1 === null) return false;
      const drop = (v0 - v1) * 3.6;
      b.gps = drop >= Math.max(2, 0.4 * b.mean * G * b.dur * 3.6);
      return false;
    });
  }

  // Estimación guardada en el instante t (la más cercana del historial de 4 s).
  histAt(t: number): Estimate | null {
    const H = this.hist;
    if (!H.length || t < H[0][0] - 0.05 || t > H[H.length - 1][0] + 0.05) return null;
    let lo = 0;
    let hi = H.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (H[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    const r = Math.abs(H[lo][0] - t) <= Math.abs(H[hi][0] - t) ? H[lo] : H[hi];
    return { x: r[1], y: r[2], h: r[3] };
  }

  // Entre fijos la posición avanza con la velocidad y gira con el giroscopio (yawRate: rad/s, + a derechas
  // en el plano; NaN si aún no se sabe y entonces se sigue el GPS a secas).
  advance(t: number, dt: number, v: number, yawRate: number): void {
    const e = this.est;
    // Sin giro de verdad (NaN, o sin dato) no se estima: un undefined dejaba la posición en NaN y la trazada sin
    // puntos nuevos.
    this.useEst = !!e && Number.isFinite(yawRate);
    if (!e || !this.useEst) return;
    if (v > 1) {
      const dh = this.yawSign * yawRate * dt;
      e.h += dh;
      this.hAccum += dh;
      e.x += Math.cos(e.h) * v * dt;
      e.y += Math.sin(e.h) * v * dt;
    }
    const c = this.corr;
    if (c[0] || c[1] || c[2]) {
      const k = 1 - Math.exp(-dt / (this.fast ? 0.1 : 0.4));
      e.x += c[0] * k;
      e.y += c[1] * k;
      e.h += c[2] * k;
      c[0] -= c[0] * k;
      c[1] -= c[1] * k;
      c[2] -= c[2] * k;
    }
    this.hist.push([t, e.x, e.y, e.h]);
    while (this.hist.length && t - this.hist[0][0] > 4) this.hist.shift();
  }

  // Dónde está la moto ahora: la posición suavizada si hay giroscopio; si no, el último fijo (que describe
  // dónde estaba hace `lag` s) adelantado con la velocidad.
  position(t: number, v: number, lag?: number): Position | null {
    if (this.useEst && this.est) return { x: this.est.x, y: this.est.y, heading: this.est.h };
    const f = this.fix;
    if (!f) return null;
    const h = this.heading;
    const dt = Math.max(0, Math.min(2.5, t - (f.t - (lag || 0))));
    if (h === null) return { x: f.x, y: f.y, heading: null };
    const vv = !Number.isNaN(v) ? (f.v + v) / 2 : f.v;
    const d = vv * dt;
    return { x: f.x + Math.cos(h) * d, y: f.y + Math.sin(h) * d, heading: h };
  }

  // s: {a (g, NaN sin calibrar), lean (grados, NaN sin calibrar), v (m/s), yaw (rad/s, módulo), lag (s)…}: lo que
  // miden los sensores en t (todo en StepInput).
  step(t: number, s: StepInput): void {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(0.2, t - this.lastT));
    this.lastT = t;
    const st = this.stats;
    if (st.t0 === null) st.t0 = t;
    st.t1 = t;
    const moving = s.v > 3;
    // Dos fases: la de los umbrales tal cual (brk), para las frenadas y las curvas (cada frenada se valida aparte:
    // pico, duración), y la sostenida (ph), la que se ve en la trazada y en el panel.
    const brk = phaseOf(s.a, this.rawPh === "freno");
    this.rawPh = brk;
    const ph = this.phaseStep(t, s.a);
    // Distancia por la velocidad (sumar las posiciones del GPS añadiría su temblor).
    if (moving) st.dist += s.v * dt;
    if (moving && !Number.isNaN(s.a)) {
      if (-s.a > st.brakeMax) st.brakeMax = -s.a;
      if (s.a > st.accMax) st.accMax = s.a;
    }
    if (moving && !Number.isNaN(s.lean)) {
      if (s.lean > st.leanR) st.leanR = s.lean;
      if (-s.lean > st.leanL) st.leanL = -s.lean;
    }
    this.lag = s.lag || 0;
    this.advance(t, dt, s.v, s.yawRate);
    const pos = this.position(t, s.v, s.lag);

    // Frenada en curso (para la curva que venga): inicio, punto, velocidad de entrada, máximo, fin.
    if (brk === "freno" && moving) {
      if (!this.brake || this.brake.tEnd !== null) {
        this.brake = { t0: t, pos, v0: s.v, g: 0, tEnd: null };
      }
      this.brake.g = Math.max(this.brake.g, -s.a);
    } else if (this.brake && this.brake.tEnd === null) this.brake.tEnd = t;
    if (this.brake && this.brake.tEnd !== null && t - this.brake.tEnd > 6 && !this.curve)
      this.brake = null;

    this.brakeStep(t, s, brk, pos, dt);

    // Curvas: giro claro sostenido. Con signo (ySig), para partir las enlazadas: una izquierda seguida de una derecha
    // son dos curvas aunque entre medias el giro no llegue a pararse (en una carretera de montaña salían curvas de
    // 30–40 s, y con ellas tiempos muertos de 20–30 s).
    const ks = 1 - Math.exp(-dt / 0.3);
    this.yawS += ((s.yaw || 0) - this.yawS) * ks;
    if (!Number.isNaN(s.yawRate)) this.ySig += (s.yawRate - this.ySig) * ks;
    if (
      this.curve &&
      this.curve.dir &&
      Math.sign(this.ySig) === -this.curve.dir &&
      Math.abs(this.ySig) > YAW_IN
    )
      this.endCurve(t);
    const c = this.curve;
    if (!c && this.yawS > YAW_IN && moving) {
      const b = this.brake;
      // La frenada que acaba de terminar (hasta 6 s antes) es la de esta curva.
      const lb = this.lastBrk && t - this.lastBrk.endT < 6 ? this.lastBrk : null;
      this.lastBrk = null;
      this.curve = {
        brk: lb,
        num: this.curves.length + 1,
        t0: t,
        idx: this.trail.length,
        leanMax: 0,
        lean: NaN,
        vMin: s.v,
        apex: pos,
        vEntry: b ? b.v0 : s.v,
        brakeG: b ? b.g : 0,
        brakeAt: b ? b.pos : null,
        braking: !!(b && b.tEnd === null) || ph === "freno",
        // Para el tiempo muerto: cuándo se suelta el freno por primera vez (si se soltó antes de entrar, entonces;
        // entrando sin frenar, al entrar) y la primera vez que la fase pasa a «acelera» después.
        relT: b && b.tEnd !== null ? b.tEnd : b ? null : t,
        gasT: null,
        yawMax: this.yawS,
        dir: 0,
      };
      if (this.curve.braking) this.curve.relT = null;
      this.quiet = null;
    } else if (c) {
      if (!c.dir && Math.abs(this.ySig) > YAW_IN) c.dir = Math.sign(this.ySig);
      if (!Number.isNaN(s.lean) && Math.abs(s.lean) > c.leanMax) {
        c.leanMax = Math.abs(s.lean);
        c.lean = s.lean;
      }
      c.yawMax = Math.max(c.yawMax, this.yawS);
      if (s.v < c.vMin) {
        c.vMin = s.v;
        c.apex = pos;
      }
      if (ph === "freno") {
        c.brakeG = Math.max(c.brakeG, -s.a);
        c.braking = true;
        if (!c.brakeAt && pos) c.brakeAt = pos;
      } else if (c.braking) {
        c.braking = false;
        if (c.relT === null) c.relT = t;
      }
      // Gas: cuando la fase (la sostenida, la que pinta la trazada en verde) pasa a «acelera», con la misma regla que
      // la trazada. Volver a frenar después (para la curva siguiente) ya no lo borra: antes, una curva que acababa
      // frenando para la siguiente se contaba entera como tiempo muerto (2,4 s de media en Los Loros, cuando la
      // trazada pintaba en ámbar un 5 % del tiempo).
      if (c.relT !== null && c.gasT === null && ph === "gas") c.gasT = t;
      if (this.yawS < YAW_OUT || !moving) {
        if (this.quiet === null) this.quiet = t;
        if (t - this.quiet > 0.8 || !moving) this.endCurve(t);
      } else this.quiet = null;
    }

    this.wheelieStep(t, s, ph, pos, dt);

    // Trazada: un punto cada pocos metros, con la fase de ese momento.
    if (pos && moving) {
      const last: TrailPoint | undefined = this.trail[this.trail.length - 1];
      const d = last ? Math.hypot(pos.x - last.x, pos.y - last.y) : Infinity;
      if (d >= STEP || this.gapNext) {
        this.trail.push({
          x: pos.x,
          y: pos.y,
          t,
          v: s.v,
          lean: s.lean,
          ph,
          gap: this.gapNext,
          wh: !!this.wheelie,
        });
        this.gapNext = false;
      }
    }
  }

  // Fase de ahora (g): la que dicen los umbrales, si se sostiene PH_HOLD s.
  phaseStep(t: number, a: number): Phase {
    const cur = this.lastPh || "mantiene";
    const want = phaseOf(a, cur === "freno");
    if (want === cur || (want === "freno" && a < BRAKE_NOW)) {
      this.phCand = null;
      this.lastPh = want;
      return want;
    }
    if (!this.phCand || this.phCand.ph !== want) this.phCand = { ph: want, t };
    if (t - this.phCand.t >= PH_HOLD) {
      this.phCand = null;
      this.lastPh = want;
      return want;
    }
    return cur;
  }

  // Cierra la curva en marcha (solo se llama con una abierta) y, si lo era de verdad, la apunta (ver closeCurve).
  endCurve(t: number): Curve | null {
    const c = this.curve as OpenCurve;
    this.curve = null;
    this.quiet = null;
    const res = closeCurve(c, t, this.trail);
    if (!res) return null;
    this.curves.push(res);
    if (this.onCurve) this.onCurve(res);
    return res;
  }

  // Frenadas: g de cada instante, metros, velocidad, cabeceo (para el hundimiento) e inclinación (frenar
  // tumbado). Al soltar el freno se resume y, si es de verdad, queda en la lista.
  brakeStep(t: number, s: StepInput, ph: Phase, pos: Position | null, dt: number): void {
    // El cabeceo solo vale con la moto casi sin girar ni cambiar de lado (turn, rad/s): frenando mientras se pasa
    // de una curva a la siguiente, el cambio de lado lo movía ±6° y salían hundimientos de 11°.
    const pitchOk = !Number.isNaN(s.pitch) && !(s.turn > 0.08);
    if (pitchOk) this.pHist.push([t, s.pitch]);
    while (this.pHist.length && t - this.pHist[0][0] > 1.5) this.pHist.shift();
    let b = this.bk;
    if (ph === "freno" && s.v > 3 && !Number.isNaN(s.a)) {
      if (!b) {
        // Cabeceo de antes de frenar (mediana del último segundo, sin los 0,2 s en que ya empieza a hundirse).
        const ps = this.pHist
          .filter((x) => x[0] < t - 0.2)
          .map((x) => x[1])
          .sort((x, y) => x - y);
        b = this.bk = {
          t0: t,
          pos,
          v0: s.v,
          g: [],
          dist: 0,
          pRef: ps.length ? ps[ps.length >> 1] : NaN,
          pMin: Infinity,
          pMinLean: Infinity,
          trailDist: 0,
          leanMax: 0,
          gTurn: null,
        };
      }
      const g = -s.a;
      b.g.push([t, g]);
      b.dist += s.v * dt;
      const lean = Math.abs(s.lean);
      // El hundimiento se mide con la moto casi recta: tumbada, el cabeceo que da el móvil es menos fiable.
      // Si la frenada empieza ya tumbado (curvas enlazadas) y nunca se endereza, vale hasta 30°.
      if (pitchOk && !(lean > TRAIL_LEAN)) b.pMin = Math.min(b.pMin, s.pitch);
      if (pitchOk && !(lean > 30)) b.pMinLean = Math.min(b.pMinLean, s.pitch);
      if (!Number.isNaN(lean) && g >= TRAIL_G) b.leanMax = Math.max(b.leanMax, lean);
      if (lean > TRAIL_LEAN && g >= TRAIL_G) {
        b.trailDist += s.v * dt;
        if (b.gTurn === null) b.gTurn = g;
      }
    } else if (b) {
      this.bk = null;
      this.endBrake(t, b, s.v);
    }
  }

  // Resume la frenada `b` (ver closeBrake) y, si es de verdad, la apunta: en la lista, por confirmar con el GPS y en
  // la curva.
  endBrake(t: number, b: OpenBrake, vOut: number): Brake | null {
    const res = closeBrake(b, t, vOut, this.brakes.length + 1);
    if (!res) return null;
    this.brakes.push(res);
    this.pendingBrk.push(res);
    // A la curva en la que se suelta el freno o, si aún no ha empezado, a la siguiente.
    const c = this.curve;
    if (c) {
      if (!c.brk || res.peak > c.brk.peak) c.brk = res;
    } else this.lastBrk = res;
    if (this.onBrake) this.onBrake(res);
    return res;
  }

  // Caballitos: morro arriba más de 6° lanzado, con la moto derecha (menos de 15°), sin girar ni cambiar de lado
  // (turn: curva o balanceo, rad/s; ahí el cabeceo que da el móvil no es fiable) y sin frenar. El cabeceo es respecto
  // a como iba la moto justo antes (la sentadilla de acelerar ya no cuenta). Se acaba cuando baja de 3°; cuenta si
  // dura medio segundo y pasa de 7°. Lo que se pierde: mientras la rueda va en el aire se acelera
  // menos que justo antes (la mediana de 1,5 s antes de levantar); esa velocidad que falta se arrastra hasta la
  // siguiente frenada (o 8 s). Es una estimación.
  wheelieStep(t: number, s: StepInput, ph: Phase, pos: Position | null, dt: number): void {
    const aW = !Number.isNaN(s.aW) ? s.aW : s.a;
    if (!Number.isNaN(aW)) {
      this.aHist.push([t, aW]);
      while (this.aHist.length && t - this.aHist[0][0] > 1.5) this.aHist.shift();
    }
    const pitch = s.pitch;
    const wh = this.wheelie;
    if (
      !wh &&
      pitch > 6 &&
      s.v > 8 &&
      !(Math.abs(s.lean) > 15) &&
      !(s.turn > 0.08) &&
      ph !== "freno"
    ) {
      const sorted = this.aHist.map((x) => x[1]).sort((x, y) => x - y);
      this.wheelie = {
        t0: t,
        pos,
        v0: s.v,
        max: pitch,
        dist: 0,
        aRef: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
        dv: 0,
        lossIn: 0,
        below: null,
      };
    } else if (wh) {
      wh.max = Math.max(wh.max, !Number.isNaN(pitch) ? pitch : 0);
      wh.dist += s.v * dt;
      if (!Number.isNaN(aW)) wh.dv += Math.max(0, wh.aRef - aW) * G * dt;
      if (s.v > 1) wh.lossIn += (wh.dv / s.v) * dt;
      if (!(pitch > 3)) {
        if (wh.below === null) wh.below = t;
        if (t - wh.below > 0.15) this.endWheelie(t);
      } else wh.below = null;
    }
    const lo = this.lossOpen;
    if (lo) {
      if (ph === "freno" || t - lo.t0 > 8 || s.v < 3) {
        lo.w.lost = Math.round((lo.w.lossIn + lo.post) * 100) / 100;
        this.lossOpen = null;
        if (this.onWheelie) this.onWheelie(lo.w);
      } else if (s.v > 1) lo.post += (lo.dv / s.v) * dt;
    }
  }

  // Cierra el caballito en marcha (solo se llama con uno): si dura medio segundo y pasa de 7°, lo apunta y empieza a
  // contar lo que se sigue perdiendo después (cerrando lo del anterior, si aún contaba).
  endWheelie(t: number): Wheelie | null {
    const wh = this.wheelie as OpenWheelie;
    this.wheelie = null;
    const dur = t - wh.t0;
    if (dur < 0.5 || wh.max < 7) return null;
    if (this.lossOpen) {
      this.lossOpen.w.lost = Math.round((this.lossOpen.w.lossIn + this.lossOpen.post) * 100) / 100;
      this.lossOpen = null;
    }
    const res: Wheelie = {
      num: this.wheelies.length + 1,
      t: wh.t0,
      dur: Math.round(dur * 10) / 10,
      dist: Math.round(wh.dist),
      max: Math.round(wh.max * 10) / 10,
      v0: Math.round(wh.v0 * 3.6),
      lossIn: wh.lossIn,
      lost: Math.round(wh.lossIn * 100) / 100,
      pos: wh.pos,
    };
    this.wheelies.push(res);
    this.lossOpen = { w: res, dv: wh.dv, post: 0, t0: t };
    if (this.onWheelie) this.onWheelie(res);
    return res;
  }

  // Resumen para guardar con la tanda (sin la trazada).
  summary(): RideSummary {
    return summarize(this.stats, this.curves, this.brakes, this.wheelies);
  }
}
