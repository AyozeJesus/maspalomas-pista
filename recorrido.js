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
  const YAW_IN = 0.15; // rad/s: giro claro → empieza una curva
  const YAW_OUT = 0.08; // rad/s: por debajo un rato → se acaba
  const STEP = 3; // m entre puntos de la trazada

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
    this.quiet = null;
    this.brake = null;
    this.lastT = null;
    this.wheelies = [];
    this.wheelie = null;
    // Posición suavizada (giroscopio + GPS) y signo del giro comprobado con el rumbo del GPS.
    this.est = null;
    this.useEst = false;
    this.yawSign = 1;
    this.yawVote = 0;
    this.hAccum = 0;
    this.prevCourse = null;
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

  // Posición del GPS (ya en metros locales). El rumbo sale del desplazamiento entre fijos.
  Recorrido.prototype.onFix = function (t, x, y, v) {
    const f = this.fix;
    let course = null;
    if (f && Math.hypot(x - f.x, y - f.y) > 2) {
      course = Math.atan2(y - f.y, x - f.x);
      this.heading = course;
    }
    const gap = !!f && t - f.t > 4;
    if (gap) this.gapNext = true;
    // Signo del giro: lo girado por el giroscopio entre fijos tiene que ir hacia el mismo lado que el rumbo
    // del GPS (si un móvil lo da al revés, se corrige solo).
    if (course !== null && this.prevCourse !== null && !gap) {
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
        ex *= 0.35;
        ey *= 0.35;
        let dh = 0;
        if (course !== null && v > 3 && f) {
          const hm = this.histAt((f.t + t) / 2 - this.lag);
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
      const k = 1 - Math.exp(-dt / 0.4);
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
    const ph = phaseOf(s.a, this.lastPh === "freno");
    this.lastPh = ph;
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
    if (ph === "freno" && moving) {
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

    // Curvas: giro claro sostenido.
    this.yawS += ((s.yaw || 0) - this.yawS) * (1 - Math.exp(-dt / 0.3));
    const c = this.curve;
    if (!c && this.yawS > YAW_IN && moving) {
      const b = this.brake;
      this.curve = {
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
      };
      this.quiet = null;
    } else if (c) {
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
      endT: t,
    };
    this.curves.push(res);
    if (this.onCurve) this.onCurve(res);
    return res;
  };

  // Caballitos: morro arriba más de 5,5° lanzado (y sin ir tumbado). Se acaba cuando baja de 3°. Lo que se
  // pierde: mientras la rueda va en el aire se acelera menos que justo antes (la mediana de 1,5 s antes de
  // levantar); esa velocidad que falta se arrastra hasta la siguiente frenada (o 8 s). Es una estimación.
  Recorrido.prototype.wheelieStep = function (t, s, ph, pos, dt) {
    const aW = s.aW === s.aW ? s.aW : s.a;
    if (aW === aW) {
      this.aHist.push([t, aW]);
      while (this.aHist.length && t - this.aHist[0][0] > 1.5)
        this.aHist.shift();
    }
    const pitch = s.pitch;
    const wh = this.wheelie;
    if (!wh && pitch > 5.5 && s.v > 8 && !(Math.abs(s.lean) > 25)) {
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
    if (dur < 0.4 || wh.max < 6.5) return null;
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
    };
  };

  root.MaspaRecorrido = { Recorrido, phaseOf, BRAKE, GAS };
})(typeof window !== "undefined" ? window : globalThis);
