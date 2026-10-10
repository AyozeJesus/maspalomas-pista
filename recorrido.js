// Recorrido en cualquier carretera (o en el circuito): la línea de trazada con su fase (frena, acelera, mantiene,
// tiempo muerto), las curvas que se van pasando y los máximos. Todo con lo que mide el móvil.
// Coordenadas en metros locales (T.toLocal). Inclinación en grados, + a derechas. Aceleración en g.
(function (root) {
  "use strict";
  // Frenar con margen: empieza por debajo de −0,15 g y acaba por encima de −0,10 g. Rodando sin gas (freno
  // motor, viento) se decelera algo, y eso es tiempo muerto, no frenada.
  const BRAKE = -0.15; // g
  const BRAKE_END = -0.1; // g
  const GAS = 0.05; // g: por encima, acelerando
  // Una fase nueva cuenta si dura 0,25 s (el acelerómetro lleva ±0,1 g de ruido aun suavizado: sin esto la fase
  // cambiaba una vez por segundo); una frenada fuerte (−0,3 g) entra en el momento.
  const PH_HOLD = 0.25; // s
  const BRAKE_NOW = -0.3; // g
  const YAW_IN = 0.15; // rad/s: giro claro → empieza una curva
  const YAW_OUT = 0.08; // rad/s: por debajo un rato → se acaba
  const STEP = 3; // m entre puntos de la trazada
  // Frenada de verdad (no soltar gas): más de 0,3 g de pico, 0,4 s y entrando a más de 20 km/h.
  const BRK_MIN_G = 0.3;
  // Frenando tumbado: más de 0,25 g (el freno motor y el roce de la rueda tumbada no llegan) con más de 12°.
  const TRAIL_LEAN = 12;
  const TRAIL_G = 0.25;
  // Hundimiento: el móvil mide el cabeceo del chasis. Batalla × tan(cabeceo) es la diferencia de altura
  // entre ejes; la horquilla se lleva ~80 % (el resto es la trasera estirándose, y la inclinación de la
  // horquilla lo compensa en parte). Es una estimación para comparar frenadas, no una medida del recorrido.
  const WHEELBASE_MM = 1440;
  const FORK_SHARE = 0.8;
  const G = 9.80665;

  // braking: si ya se estaba frenando (para el margen).
  function phaseOf(a, braking) {
    if (!(a === a)) return "mantiene";
    if (a < (braking ? BRAKE_END : BRAKE)) return "freno";
    if (a > GAS) return "gas";
    return "mantiene";
  }

  function Recorrido() {
    this.trail = [];
    this.curves = [];
    this.curve = null;
    this.fix = null;
    this.heading = null;
    this.yawS = 0;
    this.ySig = 0;
    this.quiet = null;
    this.brake = null;
    this.lastT = null;
    this.lastPh = "mantiene";
    this.phCand = null;
    this.wheelies = [];
    this.wheelie = null;
    this.brakes = [];
    this.bk = null;
    // Velocidades del GPS de los últimos 20 s y frenadas por confirmar con ellas.
    this.vHist = [];
    this.pendingBrk = [];
    this.lastBrk = null;
    this.pHist = [];
    // Posición suavizada (giroscopio + GPS) y signo del giro comprobado con el rumbo del GPS.
    this.est = null;
    this.useEst = false;
    this.yawSign = 1;
    this.yawVote = 0;
    this.hAccum = 0;
    this.prevCourse = null;
    this.cfix = null;
    // Receptor GPS externo (10–25 Hz, preciso): sus correcciones van en proporción al tiempo entre fijos y tiran
    // más de la línea (lo pone el panel según de dónde llegue cada fijo).
    this.fast = false;
    this.hist = [];
    this.corr = [0, 0, 0];
    this.lag = 0;
    this.lossOpen = null;
    this.aHist = [];
    this.gapNext = false;
    this.stats = {
      dist: 0,
      t0: null,
      t1: null,
      vMax: 0,
      leanR: 0,
      leanL: 0,
      brakeMax: 0,
      accMax: 0,
    };
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  // Posición del GPS (ya en metros locales). El rumbo sale del desplazamiento entre fijos separados al menos
  // 0,6 s: a 1 Hz son todos; con un receptor de 25 Hz, entre fijos seguidos hay 1–2 m y saldría del temblor.
  Recorrido.prototype.onFix = function (t, x, y, v) {
    const f = this.fix;
    const gap = !!f && t - f.t > 4;
    if (gap) this.gapNext = true;
    const a = this.cfix;
    let course = null;
    let mid = null;
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
          this.yawVote = Math.max(
            -20,
            Math.min(20, this.yawVote + Math.sign(dc * this.hAccum)),
          );
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
        // que la estimación: ~0,5 s para alcanzarlo.
        const k = this.fast
          ? Math.min(0.5, 1.5 * Math.max(0.02, Math.min(1, t - f.t)))
          : 0.35;
        ex *= k;
        ey *= k;
        let dh = 0;
        if (course !== null && v > 3) {
          const hm = this.histAt(mid - this.lag);
          if (hm) dh = wrapAngle(course - hm.h) * 0.3;
        }
        // No de golpe: la corrección se reparte en el medio segundo siguiente (sin quiebros en la línea).
        this.corr[0] += ex;
        this.corr[1] += ey;
        this.corr[2] += dh;
      }
    }
    if ((!this.est || gap || !hp) && (course !== null || this.est)) {
      const h = course !== null ? course : this.est.h;
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
  };

  // Velocidad del GPS en el instante t de la moto (el fijo de las t + lag lo describe), o null.
  Recorrido.prototype.vAt = function (t) {
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
  };

  // Una frenada del acelerómetro vale si el GPS la ve: la velocidad tiene que bajar al menos el 40 % de lo que
  // dice el acelerómetro (y 2 km/h). Con la vibración, alguna «frenada» de 0,3–0,4 g sin bajar la velocidad era
  // ruido o un bache (en 3 rutas de un Vivo Y33s, 8–20 %). Se mira cuando el GPS ya ha visto el final (medio
  // segundo después); sin GPS se queda como está.
  Recorrido.prototype.checkBrakes = function (tFix) {
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
  };

  // Estimación guardada en el instante t (la más cercana del historial de 4 s).
  Recorrido.prototype.histAt = function (t) {
    const H = this.hist;
    if (!H.length || t < H[0][0] - 0.05 || t > H[H.length - 1][0] + 0.05)
      return null;
    let lo = 0;
    let hi = H.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (H[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    const r = Math.abs(H[lo][0] - t) <= Math.abs(H[hi][0] - t) ? H[lo] : H[hi];
    return { x: r[1], y: r[2], h: r[3] };
  };

  // Entre fijos la posición avanza con la velocidad y gira con el giroscopio (yawRate: rad/s, + a derechas
  // en el plano; NaN si aún no se sabe y entonces se sigue el GPS a secas).
  Recorrido.prototype.advance = function (t, dt, v, yawRate) {
    const e = this.est;
    this.useEst = !!e && yawRate === yawRate;
    if (!this.useEst) return;
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
  };

  // Dónde está la moto ahora: la posición suavizada si hay giroscopio; si no, el último fijo (que describe
  // dónde estaba hace `lag` s) adelantado con la velocidad.
  Recorrido.prototype.position = function (t, v, lag) {
    if (this.useEst && this.est)
      return { x: this.est.x, y: this.est.y, heading: this.est.h };
    const f = this.fix;
    if (!f) return null;
    const h = this.heading;
    const dt = Math.max(0, Math.min(2.5, t - (f.t - (lag || 0))));
    if (h === null) return { x: f.x, y: f.y, heading: null };
    const vv = v === v ? (f.v + v) / 2 : f.v;
    const d = vv * dt;
    return { x: f.x + Math.cos(h) * d, y: f.y + Math.sin(h) * d, heading: h };
  };

  // s: {a (g, NaN sin calibrar), lean (grados, NaN sin calibrar), v (m/s), yaw (rad/s, módulo), lag (s)}
  Recorrido.prototype.step = function (t, s) {
    const dt =
      this.lastT === null ? 0 : Math.max(0, Math.min(0.2, t - this.lastT));
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
    if (moving && s.a === s.a) {
      if (-s.a > st.brakeMax) st.brakeMax = -s.a;
      if (s.a > st.accMax) st.accMax = s.a;
    }
    if (moving && s.lean === s.lean) {
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
    if (
      this.brake &&
      this.brake.tEnd !== null &&
      t - this.brake.tEnd > 6 &&
      !this.curve
    )
      this.brake = null;

    this.brakeStep(t, s, brk, pos, dt);

    // Curvas: giro claro sostenido. Con signo (ySig), para partir las enlazadas: una izquierda seguida de una derecha
    // son dos curvas aunque entre medias el giro no llegue a pararse (en una carretera de montaña salían curvas de
    // 30–40 s, y con ellas tiempos muertos de 20–30 s).
    const ks = 1 - Math.exp(-dt / 0.3);
    this.yawS += ((s.yaw || 0) - this.yawS) * ks;
    if (s.yawRate === s.yawRate) this.ySig += (s.yawRate - this.ySig) * ks;
    if (
      this.curve &&
      this.curve.dir &&
      Math.sign(this.ySig) === -this.curve.dir &&
      Math.abs(this.ySig) > YAW_IN
    )
      this.endCurve(t, s);
    const c = this.curve;
    if (!c && this.yawS > YAW_IN && moving) {
      const b = this.brake;
      // La frenada que acaba de terminar (hasta 6 s antes) es la de esta curva.
      const lb =
        this.lastBrk && t - this.lastBrk.endT < 6 ? this.lastBrk : null;
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
        brakeEnd: b ? b.tEnd : null,
        braking: !!(b && b.tEnd === null),
        gasT: null,
        gasCand: null,
        yawMax: this.yawS,
        dir: 0,
      };
      this.quiet = null;
    } else if (c) {
      if (!c.dir && Math.abs(this.ySig) > YAW_IN) c.dir = Math.sign(this.ySig);
      if (s.lean === s.lean && Math.abs(s.lean) > c.leanMax) {
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
        c.brakeEnd = null;
        if (!c.brakeAt && pos) c.brakeAt = pos;
        c.gasT = null;
      } else if (c.braking && c.brakeEnd === null) {
        c.brakeEnd = t;
        c.braking = false;
      }
      // Gas de verdad: más de 0,1 g sostenido 0,3 s (un repunte al soltar el freno no cuenta).
      if (c.gasT === null && !c.braking) {
        if (s.a > 0.1) {
          if (c.gasCand === null) c.gasCand = t;
          if (t - c.gasCand >= 0.3) c.gasT = c.gasCand;
        } else if (!(s.a > GAS)) c.gasCand = null;
      }
      if (this.yawS < YAW_OUT || !moving) {
        if (this.quiet === null) this.quiet = t;
        if (t - this.quiet > 0.8 || !moving) this.endCurve(t, s);
      } else this.quiet = null;
    }

    this.wheelieStep(t, s, ph, pos, dt);

    // Trazada: un punto cada pocos metros, con la fase de ese momento.
    if (pos && moving) {
      const last = this.trail[this.trail.length - 1];
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
  };

  // Fase de ahora (g): la que dicen los umbrales, si se sostiene PH_HOLD s.
  Recorrido.prototype.phaseStep = function (t, a) {
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
  };

  // Cierra la curva: tiempo muerto = de soltar el freno (o de entrar sin frenar) a volver a dar gas.
  Recorrido.prototype.endCurve = function (t, s) {
    const c = this.curve;
    this.curve = null;
    this.quiet = null;
    const dur = t - c.t0;
    const leanOk = c.leanMax > 8 || (!(c.lean === c.lean) && c.yawMax > 0.25);
    if (dur < 1 || !leanOk) return null;
    const from = c.brakeEnd !== null ? c.brakeEnd : c.t0;
    const to = c.gasT !== null ? c.gasT : t;
    const dead = Math.max(0, to - from);
    // La trazada de ese tramo sin freno ni gas se marca como tiempo muerto.
    for (let i = c.idx; i < this.trail.length; i++) {
      const p = this.trail[i];
      if (p.t >= from && p.t <= to && p.ph === "mantiene") p.ph = "muerto";
    }
    const res = {
      num: c.num,
      t: c.t0,
      dur,
      lean: c.lean === c.lean ? c.lean : null,
      leanMax: c.leanMax || null,
      vEntry: c.vEntry * 3.6,
      vMin: c.vMin * 3.6,
      brakeG: c.brakeG > 0.08 ? c.brakeG : null,
      dead,
      apex: c.apex,
      brakeAt: c.brakeAt,
      brk: c.brk || null,
      endT: t,
    };
    this.curves.push(res);
    if (this.onCurve) this.onCurve(res);
    return res;
  };

  // Frenadas: g de cada instante, metros, velocidad, cabeceo (para el hundimiento) e inclinación (frenar
  // tumbado). Al soltar el freno se resume y, si es de verdad, queda en la lista.
  Recorrido.prototype.brakeStep = function (t, s, ph, pos, dt) {
    // El cabeceo solo vale con la moto casi sin girar ni cambiar de lado (turn, rad/s): frenando mientras se pasa
    // de una curva a la siguiente, el cambio de lado lo movía ±6° y salían hundimientos de 11°.
    const pitchOk = s.pitch === s.pitch && !(s.turn > 0.08);
    if (pitchOk) this.pHist.push([t, s.pitch]);
    while (this.pHist.length && t - this.pHist[0][0] > 1.5) this.pHist.shift();
    let b = this.bk;
    if (ph === "freno" && s.v > 3 && s.a === s.a) {
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
      if (lean === lean && g >= TRAIL_G) b.leanMax = Math.max(b.leanMax, lean);
      if (lean > TRAIL_LEAN && g >= TRAIL_G) {
        b.trailDist += s.v * dt;
        if (b.gTurn === null) b.gTurn = g;
      }
    } else if (b) {
      this.bk = null;
      this.endBrake(t, b, s.v);
    }
  };

  Recorrido.prototype.endBrake = function (t, b, vOut) {
    const dur = t - b.t0;
    let peak = 0;
    let sum = 0;
    for (const x of b.g) {
      sum += x[1];
      if (x[1] > peak) peak = x[1];
    }
    if (peak < BRK_MIN_G || dur < 0.4 || b.v0 < 20 / 3.6) return null;
    const t80 = b.g.find((x) => x[1] >= 0.8 * peak)[0];
    const pMin = isFinite(b.pMin) ? b.pMin : b.pMinLean;
    const dive =
      b.pRef === b.pRef && isFinite(pMin) ? Math.max(0, b.pRef - pMin) : null;
    const r1 = (x) => Math.round(x * 10) / 10;
    const r2 = (x) => Math.round(x * 100) / 100;
    const res = {
      num: this.brakes.length + 1,
      t: b.t0,
      endT: t,
      pos: b.pos,
      dur: r2(dur),
      dist: Math.round(b.dist),
      vIn: Math.round(b.v0 * 3.6),
      vOut: Math.round(vOut * 3.6),
      peak: r2(peak),
      mean: r2(sum / b.g.length),
      bite: r2(t80 - b.t0),
      dive: dive === null ? null : r1(dive),
      diveMm:
        dive === null
          ? null
          : Math.round(
              WHEELBASE_MM * Math.tan((dive * Math.PI) / 180) * FORK_SHARE,
            ),
      trail: Math.round(b.trailDist),
      leanMax: b.leanMax ? r1(b.leanMax) : null,
      gTurn: b.gTurn === null ? null : r2(b.gTurn),
    };
    this.brakes.push(res);
    this.pendingBrk.push(res);
    // A la curva en la que se suelta el freno o, si aún no ha empezado, a la siguiente.
    const c = this.curve;
    if (c) {
      if (!c.brk || res.peak > c.brk.peak) c.brk = res;
    } else this.lastBrk = res;
    if (this.onBrake) this.onBrake(res);
    return res;
  };

  // Caballitos: morro arriba más de 6° lanzado, con la moto derecha (menos de 15°), sin girar ni cambiar de lado
  // (turn: curva o balanceo, rad/s; ahí el cabeceo que da el móvil no es fiable) y sin frenar. El cabeceo es respecto
  // a como iba la moto justo antes (la sentadilla de acelerar ya no cuenta). Se acaba cuando baja de 3°; cuenta si
  // dura medio segundo y pasa de 7°. Lo que se pierde: mientras la rueda va en el aire se acelera
  // menos que justo antes (la mediana de 1,5 s antes de levantar); esa velocidad que falta se arrastra hasta la
  // siguiente frenada (o 8 s). Es una estimación.
  Recorrido.prototype.wheelieStep = function (t, s, ph, pos, dt) {
    const aW = s.aW === s.aW ? s.aW : s.a;
    if (aW === aW) {
      this.aHist.push([t, aW]);
      while (this.aHist.length && t - this.aHist[0][0] > 1.5)
        this.aHist.shift();
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
      const as = this.aHist.map((x) => x[1]).sort((x, y) => x - y);
      this.wheelie = {
        t0: t,
        pos,
        v0: s.v,
        max: pitch,
        dist: 0,
        aRef: as.length ? as[Math.floor(as.length / 2)] : 0,
        dv: 0,
        lossIn: 0,
        below: null,
      };
    } else if (wh) {
      wh.max = Math.max(wh.max, pitch === pitch ? pitch : 0);
      wh.dist += s.v * dt;
      if (aW === aW) wh.dv += Math.max(0, wh.aRef - aW) * 9.80665 * dt;
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
  };

  Recorrido.prototype.endWheelie = function (t) {
    const wh = this.wheelie;
    this.wheelie = null;
    const dur = t - wh.t0;
    if (dur < 0.5 || wh.max < 7) return null;
    if (this.lossOpen) {
      this.lossOpen.w.lost =
        Math.round((this.lossOpen.w.lossIn + this.lossOpen.post) * 100) / 100;
      this.lossOpen = null;
    }
    const res = {
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
  };

  // Resumen para guardar con la tanda (sin la trazada).
  Recorrido.prototype.summary = function () {
    const st = this.stats;
    const cs = this.curves;
    const deads = cs.map((c) => c.dead).filter((x) => x === x);
    return {
      distancia: Math.round(st.dist),
      duracion: st.t0 !== null ? Math.round(st.t1 - st.t0) : 0,
      punta: Math.round(st.vMax * 3.6 * 10) / 10,
      inclDerecha: Math.round(st.leanR * 10) / 10,
      inclIzquierda: Math.round(st.leanL * 10) / 10,
      frenadaMax: Math.round(st.brakeMax * 100) / 100,
      aceleracionMax: Math.round(st.accMax * 100) / 100,
      curvas: cs.length,
      caballitos: this.wheelies.length,
      caballitosMetros: this.wheelies.reduce((a, w) => a + w.dist, 0),
      caballitosSegundos:
        Math.round(this.wheelies.reduce((a, w) => a + w.dur, 0) * 10) / 10,
      caballitoMax:
        this.wheelies.reduce((a, w) => Math.max(a, w.max), 0) || null,
      caballitosPerdido:
        Math.round(this.wheelies.reduce((a, w) => a + (w.lost || 0), 0) * 100) /
        100,
      listaCaballitos: this.wheelies.map((w) => ({
        num: w.num,
        dur: w.dur,
        dist: w.dist,
        max: w.max,
        v0: w.v0,
        lost: w.lost,
      })),
      tiempoMuertoMedio: deads.length
        ? Math.round((deads.reduce((a, b) => a + b, 0) / deads.length) * 10) /
          10
        : null,
      listaCurvas: cs.map((c) => ({
        num: c.num,
        lean: c.lean === null ? null : Math.round(c.lean),
        vEntry: Math.round(c.vEntry),
        vMin: Math.round(c.vMin),
        brakeG: c.brakeG === null ? null : Math.round(c.brakeG * 100) / 100,
        dead: Math.round(c.dead * 10) / 10,
      })),
      // Las que el GPS no vio no cuentan (gps === false).
      ...brakeSummary(this.brakes.filter((b) => b.gps !== false)),
    };
  };

  // Lo de las frenadas para el resumen: cuántas, los mejores valores y las 40 más fuertes.
  function brakeSummary(list) {
    const vals = (key, from) =>
      (from || list).map((b) => b[key]).filter((x) => x !== null && x === x);
    const hard = list.filter((b) => b.peak >= 0.6);
    const bites = vals("bite", hard.length ? hard : list);
    const dives = vals("dive");
    const mms = vals("diveMm");
    const trails = vals("trail");
    return {
      frenadas: list.length,
      mordidaMejor: bites.length ? Math.min(...bites) : null,
      hundimientoMax: dives.length ? Math.max(...dives) : null,
      hundimientoMaxMm: mms.length ? Math.max(...mms) : null,
      frenadaTumbadoMax: trails.length ? Math.max(...trails) : null,
      listaFrenadas: list
        .slice()
        .sort((a, b) => b.peak - a.peak)
        .slice(0, 40)
        .map((b) => ({
          num: b.num,
          peak: b.peak,
          mean: b.mean,
          bite: b.bite,
          dur: b.dur,
          dist: b.dist,
          vIn: b.vIn,
          vOut: b.vOut,
          dive: b.dive,
          diveMm: b.diveMm,
          trail: b.trail,
          leanMax: b.leanMax,
        })),
    };
  }

  root.MaspaRecorrido = { Recorrido, phaseOf, BRAKE, GAS };
})(typeof window !== "undefined" ? window : globalThis);
