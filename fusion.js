// Posición y velocidad en la pista a 60 Hz: Kalman [s, v, sesgo] con acelerómetro y fijos GPS que llegan tarde.
// EXPERIMENTAL, la app no lo carga: probado en el panel no mejora a la proyección del último fijo (ver README,
// «Filtro de Kalman: probado y descartado»).
(function (root) {
  "use strict";

  // Por defecto; ajustados con las vueltas sintéticas de tfusion.js.
  const DEFAULTS = {
    accelSigma: 0.5, // ruido del acelerómetro ya suavizado (m/s²)
    biasSigma: 0.01, // deriva del sesgo del acelerómetro (m/s² por √s)
    sSigma: 3.5, // error del fijo a lo largo de la pista (m), GPS del móvil
    vSigma: 0.3, // error de su velocidad (m/s)
    history: 3, // segundos de historia para rebobinar
  };
  // La app suaviza el acelerómetro 0,2 s: el ruido queda correlacionado entre muestras y en la velocidad se
  // acumula como un ruido blanco de densidad 2·σ²·τ, bastante más que si cada muestra fuera independiente.
  const ACCEL_TAU = 0.2;
  // Sin acelerómetro la tercera variable pasa a ser la aceleración cambiada de signo (v' = −b), estimada con la
  // velocidad del GPS. Con velocidad constante no basta: el fijo llega ~1 s tarde y en una frenada de 11 m/s²
  // eso son ~10 m. Al extrapolar, esa aceleración se va apagando (modelo de Singer): una frenada o un gas duran
  // pocos segundos, así que lo prudente es no alargarlos a ciegas.
  const FREE_TAU = 3; // s
  const JERK_PSD = 40; // (m/s³)²/Hz: frenar o abrir gas cambia la aceleración de golpe
  const FREE_PSD = 0.3; // (m/s²)²/Hz, directo a la velocidad en ese modo
  // Una lectura vale como mucho medio segundo: si dejan de llegar (pestaña en segundo plano) la aceleración pasa
  // a ser desconocida y la incertidumbre crece para que el siguiente fijo mande.
  const HOLD = 0.5;
  const GAP_PSD = 10; // (m/s²)²/Hz
  const BIAS0 = 0.3; // σ inicial del sesgo (m/s²)
  const ACCEL0 = 5; // σ inicial de la aceleración sin acelerómetro (m/s²)
  const V0 = 10; // σ inicial de la velocidad si el primer fijo no la trae (m/s)
  // Fuera de max(4σ, 15 m) el fijo se descarta; tras 3 seguidos, el encaje en el mapa saltó de verdad y se sigue.
  const GATE_K = 4;
  const GATE_MIN = 15;
  const MAX_REJECTS = 3;
  // La velocidad del GPS no salta con el encaje: solo se descarta si es absurda.
  const V_GATE_K = 5;
  const V_GATE_MIN = 5;
  const COMPACT = 1024;

  function wrap(x, L) {
    let r = x % L;
    if (r < 0) r += L;
    return r >= L ? r - L : r;
  }

  function blank() {
    return { s: NaN, v: NaN, b: NaN, sSigma: NaN, ready: false, lap: NaN };
  }

  // Un instante de la historia: lo que trae (lectura del acelerómetro o fijo) y el estado tras aplicarlo.
  function Node(t) {
    this.t = t;
    this.inA = false;
    this.a = NaN; // lectura nueva (NaN: no hay acelerómetro)
    this.fix = false;
    this.fs = NaN;
    this.fv = NaN;
    this.rs = 0;
    this.rv = 0;
    this.u = NaN; // lectura vigente desde t
    this.s = NaN; // sin envolver: sigue sumando vuelta tras vuelta; NaN hasta el primer fijo
    this.v = NaN;
    this.b = NaN;
    this.pss = NaN;
    this.psv = NaN;
    this.psb = NaN;
    this.pvv = NaN;
    this.pvb = NaN;
    this.pbb = NaN;
    this.rej = 0; // fijos descartados seguidos
    this.ok = false; // resultado del fijo de este nodo
    this.nu = NaN;
  }

  function copyState(from, to) {
    to.u = from.u;
    to.s = from.s;
    to.v = from.v;
    to.b = from.b;
    to.pss = from.pss;
    to.psv = from.psv;
    to.psb = from.psb;
    to.pvv = from.pvv;
    to.pvb = from.pvb;
    to.pbb = from.pbb;
    to.rej = from.rej;
  }

  // Estado inicial a partir de una posición (ya envuelta) y una velocidad que puede faltar.
  function seed(x, s, v, rs, rv) {
    const vOk = v === v;
    x.s = s;
    x.v = vOk ? Math.max(0, v) : 0;
    x.b = 0;
    x.pss = rs;
    x.psv = 0;
    x.psb = 0;
    x.pvv = vOk ? rv : V0 * V0;
    x.pvb = 0;
    x.pbb = x.u === x.u ? BIAS0 * BIAS0 : ACCEL0 * ACCEL0;
    x.rej = 0;
  }

  // Lleva x dt segundos adelante con la lectura u mantenida (aceleración real = u − b).
  function propagate(kf, x, dt, u) {
    if (!(dt > 0)) return;
    const acc = u === u;
    const ae = (acc ? u : 0) - x.b;
    // h = ∂v/∂aceleración, m = ∂s/∂aceleración, e = cuánto queda de la aceleración (o del sesgo) al final.
    let h;
    let m;
    let e = 1;
    if (acc) {
      h = dt < HOLD ? dt : HOLD;
      m = h * dt - 0.5 * h * h;
    } else {
      e = Math.exp(-dt / FREE_TAU);
      h = -FREE_TAU * Math.expm1(-dt / FREE_TAU);
      m = FREE_TAU * (dt - h);
    }
    const v1 = x.v + ae * h;
    if (v1 < 0) {
      // Se para dentro del intervalo: no puede ir marcha atrás.
      x.s += (0.5 * x.v * x.v) / -ae;
      x.v = 0;
    } else {
      x.s += x.v * dt + ae * m;
      x.v = v1;
    }
    x.b *= e;
    // P ← F·P·Fᵀ + Q con F = [[1, dt, −m], [0, 1, −h], [0, 0, e]] (solo el triángulo superior). Q es la del
    // paseo aleatorio, que con pasos cortos coincide con la de Singer y nunca se queda corta.
    const pss = x.pss;
    const psv = x.psv;
    const psb = x.psb;
    const pvv = x.pvv;
    const pvb = x.pvb;
    const pbb = x.pbb;
    const r0 = pss + dt * psv - m * psb;
    const r1 = psv + dt * pvv - m * pvb;
    const r2 = psb + dt * pvb - m * pbb;
    const u1 = pvv - h * pvb;
    const u2 = pvb - h * pbb;
    const qa = acc ? kf._qa : FREE_PSD;
    const qb = acc ? kf._qb : JERK_PSD;
    const t2 = dt * dt;
    const t3 = t2 * dt;
    x.pss = r0 + dt * r1 - m * r2 + (qa * t3) / 3 + (qb * t3 * t2) / 20;
    x.psv = r1 - h * r2 + (qa * t2) / 2 + (qb * t2 * t2) / 8;
    x.psb = e * r2 - (qb * t3) / 6;
    x.pvv = u1 - h * u2 + qa * dt + (qb * t3) / 3;
    x.pvb = e * u2 - (qb * t2) / 2;
    x.pbb = e * e * pbb + qb * dt;
    if (dt > HOLD) {
      const g = dt - HOLD;
      x.pss += (GAP_PSD * g * g * g) / 3;
      x.psv += (GAP_PSD * g * g) / 2;
      x.pvv += GAP_PSD * g;
    }
  }

  // Corrección escalar con H = e_i en forma de Joseph, P' = (I − K·H)·P·(I − K·H)ᵀ + K·R·Kᵀ, desarrollada para
  // la parte superior: P'[r][c] = P[r][c] − K[r]·P[i][c] − K[c]·P[r][i] + K[r]·K[c]·S.
  function correct(x, i, nu, r) {
    const c0 = i === 0 ? x.pss : x.psv;
    const c1 = i === 0 ? x.psv : x.pvv;
    const c2 = i === 0 ? x.psb : x.pvb;
    const S = (i === 0 ? c0 : c1) + r;
    const k0 = c0 / S;
    const k1 = c1 / S;
    const k2 = c2 / S;
    x.s += k0 * nu;
    x.v += k1 * nu;
    x.b += k2 * nu;
    x.pss += -2 * k0 * c0 + k0 * k0 * S;
    x.psv += -k0 * c1 - k1 * c0 + k0 * k1 * S;
    x.psb += -k0 * c2 - k2 * c0 + k0 * k2 * S;
    x.pvv += -2 * k1 * c1 + k1 * k1 * S;
    x.pvb += -k1 * c2 - k2 * c1 + k1 * k2 * S;
    x.pbb += -2 * k2 * c2 + k2 * k2 * S;
    if (!(x.pss > 1e-9)) x.pss = 1e-9;
    if (!(x.pvv > 1e-12)) x.pvv = 1e-12;
    if (!(x.pbb > 1e-12)) x.pbb = 1e-12;
  }

  // Aplica el fijo del nodo. La puerta solo mira la posición: es el encaje en el mapa lo que salta cuando el GPS
  // rebota.
  function measure(kf, x) {
    if (x.fs === x.fs) {
      const L = kf.L;
      let nu = (x.fs - x.s) % L;
      if (nu > L / 2) nu -= L;
      else if (nu <= -L / 2) nu += L;
      x.nu = nu;
      const gate = Math.max(GATE_K * Math.sqrt(x.pss + x.rs), GATE_MIN);
      if (Math.abs(nu) <= gate || x.rej >= MAX_REJECTS) {
        // Tras tres descartes seguidos el salto es real: se abre la incertidumbre de la posición para que este
        // fijo mande, sin tocar velocidad ni sesgo.
        if (Math.abs(nu) > gate) x.pss += nu * nu;
        correct(x, 0, nu, x.rs);
        x.rej = 0;
        x.ok = true;
      } else {
        x.rej++;
      }
    }
    if (x.fv === x.fv) {
      const nu = x.fv - x.v;
      if (
        Math.abs(nu) <= Math.max(V_GATE_K * Math.sqrt(x.pvv + x.rv), V_GATE_MIN)
      ) {
        correct(x, 1, nu, x.rv);
        if (x.fs !== x.fs) x.ok = true;
      }
    }
    if (x.v < 0) x.v = 0;
  }

  // Cambia la lectura vigente. Si el acelerómetro aparece o desaparece, la tercera variable cambia de papel.
  function setInput(kf, x, a) {
    const had = x.u === x.u;
    const has = a === a;
    if (had && !has) {
      // Se pierde: pasa a ser −aceleración, empezando por la última leída.
      x.b -= x.u;
      x.pbb += kf._a2;
    } else if (!had && has) {
      // Llega (o vuelve): pasa a ser su sesgo, aún desconocido.
      x.b = 0;
      x.psb = 0;
      x.pvb = 0;
      x.pbb = BIAS0 * BIAS0;
    }
    x.u = a;
  }

  // Calcula el nodo n a partir del anterior: avanza hasta su instante y aplica lo que trae. El primer fijo con
  // posición en orden de tiempo hace nacer el estado, así que uno anterior que llegue tarde lo vuelve a hacer.
  function step(kf, prev, n) {
    copyState(prev, n);
    n.ok = false;
    n.nu = NaN;
    if (n.s === n.s) {
      propagate(kf, n, n.t - prev.t, prev.u);
      if (n.fix) measure(kf, n);
    } else if (n.fix && n.fs === n.fs) {
      seed(n, n.fs, n.fv, n.rs, n.rv);
      n.ok = true;
      n.nu = 0;
    }
    if (n.inA) setInput(kf, n, n.a);
  }

  function pick(v, def) {
    return Number.isFinite(v) && v > 0 ? v : def;
  }

  class TrackKalman {
    constructor(opts) {
      const o = opts || {};
      if (!(o.L > 0))
        throw new Error("TrackKalman: falta L, la longitud de la pista (m)");
      this.L = o.L;
      this.accelSigma = pick(o.accelSigma, DEFAULTS.accelSigma);
      this.biasSigma = pick(o.biasSigma, DEFAULTS.biasSigma);
      this.sSigma = pick(o.sSigma, DEFAULTS.sSigma);
      this.vSigma = pick(o.vSigma, DEFAULTS.vSigma);
      this.history = pick(o.history, DEFAULTS.history);
      this._a2 = this.accelSigma * this.accelSigma;
      this._qa = 2 * this._a2 * ACCEL_TAU;
      this._qb = this.biasSigma * this.biasSigma;
      this._tmp = new Node(0);
      this._clear();
    }

    _clear() {
      this._nodes = [];
      this._head = 0;
      this._lap = 0;
      this.lapCount = 0; // vueltas completadas (cruces de meta hacia delante) desde reset
      this.ready = false;
    }

    // t: segundos del reloj de la app (crecientes); a: aceleración longitudinal (m/s²) o NaN si aún no hay ejes.
    predict(t, a) {
      if (!Number.isFinite(t)) return;
      const n = new Node(t);
      n.inA = true;
      n.a = Number.isFinite(a) ? a : NaN;
      this._insert(n);
    }

    // tMeas: instante al que se refiere el fijo (llegada − retraso). Devuelve { accepted, innovation }.
    update(tMeas, sMeas, vMeas, opts) {
      const o = opts || {};
      const ss = pick(o.sSigma, this.sSigma);
      const vs = pick(o.vSigma, this.vSigma);
      const n = new Node(tMeas);
      n.fix = true;
      n.fs = Number.isFinite(sMeas) ? wrap(sMeas, this.L) : NaN;
      n.fv = Number.isFinite(vMeas) ? vMeas : NaN;
      if (!Number.isFinite(tMeas) || (n.fs !== n.fs && n.fv !== n.fv))
        return { accepted: false, innovation: NaN };
      n.rs = ss * ss;
      n.rv = vs * vs;
      this._insert(n);
      return { accepted: n.ok, innovation: n.nu };
    }

    // Estado en t (por defecto, el último predict) sin tocar el filtro. Antes del primer fijo, todo NaN.
    // lap: vuelta coherente con s (la de lapCount, salvo que t ya pase la meta).
    state(t) {
      const N = this._nodes;
      if (!this.ready) return blank();
      const last = N[N.length - 1];
      const tq = Number.isFinite(t) ? t : last.t;
      const base =
        tq >= last.t
          ? last
          : N[tq <= N[this._head].t ? this._head : this._find(tq)];
      const x = this._tmp;
      copyState(base, x);
      if (!(x.s === x.s)) return blank();
      propagate(this, x, tq - base.t, base.u);
      const L = this.L;
      let lap;
      let s;
      if (base === last) {
        // Coherente con lapCount: si una corrección echa atrás justo después de cruzar la meta, s se queda en 0
        // en vez de volver al final de la vuelta anterior.
        lap = this._lap;
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
        b: x.u === x.u ? x.b : NaN,
        sSigma: Math.sqrt(x.pss),
        ready: true,
        lap,
      };
    }

    reset(t, s, v) {
      const N = this._nodes;
      const u = N.length ? N[N.length - 1].u : NaN;
      this._clear();
      if (!Number.isFinite(t) || !Number.isFinite(s)) return;
      const n = new Node(t);
      n.u = u;
      seed(
        n,
        wrap(s, this.L),
        Number.isFinite(v) ? v : NaN,
        this.sSigma * this.sSigma,
        this.vSigma * this.vSigma,
      );
      this._nodes.push(n);
      this._settle();
    }

    // Último nodo con t ≤ tq (tq no anterior al más viejo).
    _find(tq) {
      const N = this._nodes;
      let lo = this._head;
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
    _insert(n) {
      const N = this._nodes;
      const last = N.length - 1;
      if (last < 0) {
        n.u = n.a;
        if (n.fix && n.fs === n.fs) {
          seed(n, n.fs, n.fv, n.rs, n.rv);
          n.ok = true;
          n.nu = 0;
        }
        N.push(n);
      } else if (n.t >= N[last].t) {
        N.push(n);
        step(this, N[last], n);
      } else {
        if (n.t < N[this._head].t) n.t = N[this._head].t;
        const j = this._find(n.t);
        N.splice(j + 1, 0, n);
        for (let k = j + 1; k < N.length; k++) step(this, N[k - 1], N[k]);
      }
      this._settle();
    }

    _settle() {
      const N = this._nodes;
      const last = N[N.length - 1];
      const cut = last.t - this.history;
      while (this._head < N.length - 1 && N[this._head + 1].t <= cut)
        this._head++;
      if (this._head >= COMPACT && this._head * 2 >= N.length) {
        N.splice(0, this._head);
        this._head = 0;
      }
      this.ready = last.s === last.s;
      if (this.ready) {
        // Las vueltas solo suben: un vaivén en la meta no cuenta dos veces.
        const k = Math.floor(last.s / this.L);
        if (k > this._lap) this._lap = k;
        this.lapCount = this._lap;
      }
    }
  }

  const api = { TrackKalman };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaFusion = api;
})(typeof window !== "undefined" ? window : globalThis);
