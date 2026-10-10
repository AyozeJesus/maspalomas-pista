// El modelo del filtro sobre un instante de la historia: el estado [s, v, sesgo] con su covarianza, cómo avanza con
// la lectura del acelerómetro (o sin ella), cómo lo corrige un fijo y qué pasa cuando el acelerómetro aparece o se
// pierde.

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

// Lo que el modelo necesita del filtro: la longitud de la pista y los ruidos que salen de sus sigmas.
export interface FilterParams {
  readonly L: number;
  // σ² del acelerómetro: lo que se suma a la incertidumbre de la aceleración cuando se pierde.
  readonly a2: number;
  // Densidad del ruido del acelerómetro en la velocidad (2·σ²·τ).
  readonly qa: number;
  // Densidad de la deriva del sesgo.
  readonly qb: number;
}

export function filterParams(L: number, accelSigma: number, biasSigma: number): FilterParams {
  const a2 = accelSigma * accelSigma;
  return { L, a2, qa: 2 * a2 * ACCEL_TAU, qb: biasSigma * biasSigma };
}

// Un instante de la historia: lo que trae (lectura del acelerómetro o fijo) y el estado tras aplicarlo.
export class HistoryNode {
  t: number;
  inA = false;
  a = NaN; // lectura nueva (NaN: no hay acelerómetro)
  fix = false;
  fs = NaN;
  fv = NaN;
  rs = 0;
  rv = 0;
  u = NaN; // lectura vigente desde t
  s = NaN; // sin envolver: sigue sumando vuelta tras vuelta; NaN hasta el primer fijo
  v = NaN;
  b = NaN;
  pss = NaN;
  psv = NaN;
  psb = NaN;
  pvv = NaN;
  pvb = NaN;
  pbb = NaN;
  rej = 0; // fijos descartados seguidos
  ok = false; // resultado del fijo de este nodo
  nu = NaN;

  constructor(t: number) {
    this.t = t;
  }
}

export function copyState(from: HistoryNode, to: HistoryNode): void {
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
export function seed(x: HistoryNode, s: number, v: number, rs: number, rv: number): void {
  const vOk = !Number.isNaN(v);
  x.s = s;
  x.v = vOk ? Math.max(0, v) : 0;
  x.b = 0;
  x.pss = rs;
  x.psv = 0;
  x.psb = 0;
  x.pvv = vOk ? rv : V0 * V0;
  x.pvb = 0;
  x.pbb = !Number.isNaN(x.u) ? BIAS0 * BIAS0 : ACCEL0 * ACCEL0;
  x.rej = 0;
}

// Lleva x dt segundos adelante con la lectura u mantenida (aceleración real = u − b).
export function propagate(kf: FilterParams, x: HistoryNode, dt: number, u: number): void {
  if (!(dt > 0)) return;
  const acc = !Number.isNaN(u);
  const ae = (acc ? u : 0) - x.b;
  // h = ∂v/∂aceleración, m = ∂s/∂aceleración, e = cuánto queda de la aceleración (o del sesgo) al final.
  let h: number;
  let m: number;
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
  const qa = acc ? kf.qa : FREE_PSD;
  const qb = acc ? kf.qb : JERK_PSD;
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
function correct(x: HistoryNode, i: 0 | 1, nu: number, r: number): void {
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
function measure(kf: FilterParams, x: HistoryNode): void {
  if (!Number.isNaN(x.fs)) {
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
  if (!Number.isNaN(x.fv)) {
    const nu = x.fv - x.v;
    if (Math.abs(nu) <= Math.max(V_GATE_K * Math.sqrt(x.pvv + x.rv), V_GATE_MIN)) {
      correct(x, 1, nu, x.rv);
      if (Number.isNaN(x.fs)) x.ok = true;
    }
  }
  if (x.v < 0) x.v = 0;
}

// Cambia la lectura vigente. Si el acelerómetro aparece o desaparece, la tercera variable cambia de papel.
function setInput(kf: FilterParams, x: HistoryNode, a: number): void {
  const had = !Number.isNaN(x.u);
  const has = !Number.isNaN(a);
  if (had && !has) {
    // Se pierde: pasa a ser −aceleración, empezando por la última leída.
    x.b -= x.u;
    x.pbb += kf.a2;
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
export function step(kf: FilterParams, prev: HistoryNode, n: HistoryNode): void {
  copyState(prev, n);
  n.ok = false;
  n.nu = NaN;
  if (!Number.isNaN(n.s)) {
    propagate(kf, n, n.t - prev.t, prev.u);
    if (n.fix) measure(kf, n);
  } else if (n.fix && !Number.isNaN(n.fs)) {
    seed(n, n.fs, n.fv, n.rs, n.rv);
    n.ok = true;
    n.nu = 0;
  }
  if (n.inA) setInput(kf, n, n.a);
}
