// ---------- entrenador ----------
// Dónde está el tiempo de una vuelta frente a una referencia (el objetivo del modelo, tu mejor vuelta o la de
// otro piloto): curva a curva y por fases, que juntas cubren la vuelta entera (así lo que se reparte suma
// exactamente la diferencia): «entrada» (de un poco antes de la frenada más temprana hasta el vértice),
// «salida» (del vértice hasta tener gas a fondo) y «recta» (hasta la entrada de la curva siguiente).
import { STEP_M } from "./constants";
import { gridAt } from "./grid";
import { ring } from "./numeric";
import type {
  AnalyzeResult,
  CoachOptions,
  CoachRef,
  CoachResult,
  Consistency,
  CornerLoss,
  CornerMetrics,
  Grid,
  GridKey,
  LapVsRef,
  Minis,
  PhaseBound,
  PhaseName,
  PhaseResult,
  PhaseSpan,
  PlanItem,
  SelfBest,
  TelemetryLap,
  TrackCorner,
} from "./types";

const MINI_M = 50;

// Tiempo entre dos distancias de la vuelta (si el tramo cruza meta, se parte en dos).
export function timeBetween(grid: Grid, a: number, b: number): number {
  const t0 = grid.t[0];
  const tEnd = grid.t[grid.t.length - 1];
  const tA = gridAt(grid, "t", a);
  const tB = gridAt(grid, "t", b);
  return b >= a ? tB - tA : tEnd - tA + (tB - t0);
}

export function maxBetween(grid: Grid, key: GridKey, a: number, b: number, L: number): number {
  let best = -Infinity;
  const len = b >= a ? b - a : L - a + b;
  for (let d = 0; d <= len; d += STEP_M) best = Math.max(best, gridAt(grid, key, ring(a + d, L)));
  return best;
}

// Límites de las fases, comunes a todas las vueltas y a la referencia (si no, no se podrían comparar): la
// entrada empieza 20 m antes de la frenada más temprana de todas; la salida acaba 20 m después del gas a fondo
// más tardío. Entre dos curvas siempre quedan al menos 10 m de recta.
export function phaseBounds(
  corners: readonly TrackCorner[],
  L: number,
  metricSets: readonly (readonly CornerMetrics[] | null | undefined)[],
): PhaseBound[] {
  const order = corners.map((c, k) => ({ c, k })).sort((a, b) => a.c.sApex - b.c.sApex);
  const n = order.length;
  const want = order.map(({ k }) => {
    let bb = 0;
    let fa = 0;
    for (const ms of metricSets) {
      const m = ms && ms[k];
      if (!m) continue;
      bb = Math.max(bb, m.brakeBefore !== null ? m.brakeBefore : 60);
      fa = Math.max(fa, m.fullAfter !== null ? m.fullAfter : 40);
    }
    return { entry: bb + 20, exit: Math.max(20, fa + 20) };
  });
  for (let j = 0; j < n; j++) {
    const next = (j + 1) % n;
    const gap = ring(order[next].c.sApex - order[j].c.sApex, L) || L;
    const room = gap - 10;
    const need = want[j].exit + want[next].entry;
    if (need > room) {
      const f = room / need;
      want[j].exit *= f;
      want[next].entry *= f;
    }
  }
  return order.map(({ c, k }, j) => {
    const next = order[(j + 1) % n];
    return {
      k,
      num: c.num,
      name: c.name,
      apex: c.sApex,
      entry: ring(c.sApex - want[j].entry, L),
      exitEnd: ring(c.sApex + want[j].exit, L),
      nextEntry: ring(next.c.sApex - want[(j + 1) % n].entry, L),
    };
  });
}

// Las fases en orden de la vuelta: [a, b) en metros desde meta.
export function phasesOf(bounds: readonly PhaseBound[]): PhaseSpan[] {
  const out: PhaseSpan[] = [];
  bounds.forEach((b, j) => {
    out.push({
      k: b.k,
      num: b.num,
      name: b.name,
      phase: "entrada",
      a: b.entry,
      b: b.apex,
      // La curva anterior: de su salida viene la velocidad con la que se llega a esta frenada.
      prevNum: bounds[(j - 1 + bounds.length) % bounds.length].num,
    });
    out.push({
      k: b.k,
      num: b.num,
      name: b.name,
      phase: "salida",
      a: b.apex,
      b: b.exitEnd,
    });
    out.push({
      k: b.k,
      num: b.num,
      name: b.name,
      phase: "recta",
      a: b.exitEnd,
      b: b.nextEntry,
    });
  });
  return out;
}

// Por qué se pierde en una fase: diferencias con la referencia puntuadas contra un umbral (como insights).
export function whyOf(
  ph: PhaseSpan,
  m: CornerMetrics | null | undefined,
  rm: CornerMetrics | null | undefined,
  grid: Grid,
  refGrid: Grid,
  L: number,
): { texts: string[]; carry: boolean } {
  const n1 = (x: number, d: number) => x.toFixed(d).replace(".", ",");
  const cand: { sev: number; text: string; carry: boolean }[] = [];
  const add = (dev: number, thr: number, text: string, carry?: boolean) => {
    if (dev > 0) cand.push({ sev: dev / thr, text, carry: !!carry });
  };
  if (!m || !rm) return { texts: [], carry: false };
  if (ph.phase === "entrada") {
    if (m.brakeBefore !== null && rm.brakeBefore !== null)
      add(
        m.brakeBefore - rm.brakeBefore,
        6,
        "frenas " + Math.round(m.brakeBefore - rm.brakeBefore) + " m antes",
      );
    if (m.peakG !== null && rm.peakG !== null)
      add(
        rm.peakG - m.peakG,
        0.06,
        "frenas con " + n1(m.peakG, 2) + " g (la referencia, " + n1(rm.peakG, 2) + " g)",
      );
    const sB = ring(ph.b - (rm.brakeBefore !== null ? rm.brakeBefore : 60), L);
    const vL = gridAt(grid, "v", sB) * 3.6;
    const vR = gridAt(refGrid, "v", sB) * 3.6;
    // Llegar más lento no es cosa de la frenada sino de la salida anterior: pesa la mitad que lo que sí se
    // hace en esta curva y se dice de dónde viene.
    add(
      vR - vL,
      6,
      "llegas a la frenada " +
        Math.round(vR - vL) +
        " km/h más lento (viene de la salida de C" +
        ph.prevNum +
        ")",
      true,
    );
    add(
      rm.vMin - m.vMin,
      2,
      "pasas por el vértice " + Math.round(rm.vMin - m.vMin) + " km/h más lento",
    );
  } else if (ph.phase === "salida") {
    if (m.dead !== null && rm.dead !== null)
      add(
        m.dead - rm.dead,
        0.2,
        n1(m.dead - rm.dead, 1) + " s más sin gas entre soltar el freno y abrir",
      );
    if (m.fullAfter !== null && rm.fullAfter !== null)
      add(
        m.fullAfter - rm.fullAfter,
        8,
        "abres a fondo " + Math.round(m.fullAfter - rm.fullAfter) + " m más tarde",
      );
    add(rm.vExit - m.vExit, 2, "sales " + Math.round(rm.vExit - m.vExit) + " km/h más lento");
    if (isFinite(m.radius) && isFinite(rm.radius) && rm.radius > 0)
      add(
        (rm.radius - m.radius) / rm.radius,
        0.1,
        "trazada más cerrada (radio " +
          Math.round(m.radius) +
          " m frente a " +
          Math.round(rm.radius) +
          " m): usa más ancho",
      );
  } else {
    add(
      rm.vExit - m.vExit,
      2,
      "arrastras " + Math.round(rm.vExit - m.vExit) + " km/h de la salida",
    );
    const top = maxBetween(grid, "v", ph.a, ph.b, L) * 3.6;
    const topR = maxBetween(refGrid, "v", ph.a, ph.b, L) * 3.6;
    add(topR - top, 3, Math.round(topR - top) + " km/h menos de punta");
  }
  cand.sort((a, b) => b.sev - a.sev);
  let out = cand.filter((x) => x.sev >= 1);
  if (!out.length && cand.length && cand[0].sev >= 0.5) out = [cand[0]];
  // carry: lo principal es llegar más lento (la culpa es de la salida anterior, no de esta frenada).
  return {
    texts: out.slice(0, 2).map((x) => x.text),
    carry: !!(out.length && out[0].carry),
  };
}

// Una vuelta frente a la referencia, fase a fase y agrupada por curvas (cada curva: su entrada, su salida y la
// recta que viene después, que es donde se nota la salida).
export function lapVsRef(
  lap: Pick<TelemetryLap, "num" | "time" | "grid"> & { corners?: readonly CornerMetrics[] },
  ref: CoachRef,
  phases: readonly PhaseSpan[],
  L: number,
): LapVsRef {
  const delta = (s: number) =>
    gridAt(lap.grid, "t", s) - lap.grid.t[0] - (gridAt(ref.grid, "t", s) - ref.grid.t[0]);
  const dEnd = delta(L);
  const loss = (a: number, b: number) =>
    b >= a ? delta(b) - delta(a) : dEnd - delta(a) + delta(b);
  const out = phases.map((ph): PhaseResult => {
    const l = loss(ph.a, ph.b);
    const w =
      l > 0.02
        ? whyOf(
            ph,
            lap.corners && lap.corners[ph.k],
            ref.metrics && ref.metrics[ph.k],
            lap.grid,
            ref.grid,
            L,
          )
        : { texts: [], carry: false };
    return Object.assign({}, ph, { loss: l, why: w.texts, carry: w.carry });
  });
  const corners: CornerLoss[] = [];
  for (const ph of out) {
    let c = corners.find((x) => x.k === ph.k);
    if (!c) {
      c = { k: ph.k, num: ph.num, name: ph.name, loss: 0, phases: [] };
      corners.push(c);
    }
    c.loss += ph.loss;
    c.phases.push({ phase: ph.phase, loss: ph.loss, why: ph.why });
  }
  corners.sort((a, b) => b.loss - a.loss);
  return { num: lap.num, time: lap.time, phases: out, corners };
}

// opts.ref: "objetivo" (por defecto), "mejor", o {grid, corners, time, label} (la mejor vuelta de otro piloto,
// analizada en el mismo trazado y con la misma meta). opts.lap: la vuelta a explicar (por defecto, la mejor).
export function coach(result: AnalyzeResult, opts?: CoachOptions): CoachResult | null {
  const o = opts || {};
  const laps = result.laps.filter((l) => l.valid);
  const bestLap = result.best;
  if (!laps.length || !bestLap) return null;
  const L = result.track.L;
  let ref: CoachRef;
  if (o.ref && typeof o.ref === "object")
    ref = {
      grid: o.ref.grid,
      metrics: o.ref.corners,
      time: o.ref.time,
      label: o.ref.label || "referencia",
    };
  else if (o.ref === "mejor")
    ref = {
      grid: bestLap.grid,
      metrics: bestLap.corners,
      time: bestLap.time,
      label: "mejor",
    };
  else
    ref = {
      grid: result.ref.grid,
      metrics: result.ref.metrics,
      time: result.ref.lapTime,
      label: "objetivo",
    };
  const bounds = phaseBounds(
    result.ref.corners,
    L,
    [ref.metrics].concat(laps.map((l) => l.corners)),
  );
  const phases = phasesOf(bounds);
  const lapsOut = laps.map((l) => lapVsRef(l, ref, phases, L));
  const best = lapsOut.find((x) => x.num === bestLap.num);
  const lapOpt = o.lap;
  const target = lapOpt ? lapsOut.find((x) => x.num === lapOpt.num) || best : best;
  // Con un resultado de analyze, la mejor siempre está entre las válidas (la app de antes fallaba aquí sin ella).
  if (!target) throw new TypeError("La mejor vuelta no está entre las vueltas válidas.");

  // Con el GPS del móvil, un par de metros de error en un vértice lento (20 m/s) son ±0,07 s en el límite de
  // una fase: por debajo de 0,1 s no se puede afirmar que una vuelta hizo una fase mejor que otra. Con GPS
  // rápido (5 Hz o más), sí desde 0,05 s.
  const fast = result.gpsHz >= 5;
  const minSelf = fast ? 0.05 : 0.1;
  const minPlan = fast ? 0.04 : 0.08;

  // Lo que ya has hecho: en cada fase, la mejor de tus vueltas frente a tu mejor vuelta.
  const times = laps.map((l) => phases.map((ph) => timeBetween(l.grid, ph.a, ph.b)));
  const bi = laps.indexOf(bestLap);
  const self: SelfBest[] = [];
  phases.forEach((ph, p) => {
    let jm = 0;
    for (let j = 1; j < laps.length; j++) if (times[j][p] < times[jm][p]) jm = j;
    const gain = times[bi][p] - times[jm][p];
    if (gain >= minSelf)
      self.push({
        k: ph.k,
        num: ph.num,
        name: ph.name,
        phase: ph.phase,
        gain,
        lapNum: laps[jm].num,
      });
  });
  self.sort((a, b) => b.gain - a.gain);
  // Vuelta ideal por tramos (las fases de todas las curvas, ~12 en Maspalomas): tus mejores tramos juntos.
  const tramos = phases.reduce((acc, _, p) => acc + Math.min(...times.map((t) => t[p])), 0);

  // Regularidad: dispersión del tiempo de cada curva (sus tres fases) entre vueltas.
  const consistency: Consistency[] = [];
  if (laps.length >= 3) {
    for (const b of bounds) {
      const ps = phases.map((ph, p) => (ph.k === b.k ? p : -1)).filter((p) => p >= 0);
      const ct = times.map((t) => ps.reduce((a, p) => a + t[p], 0));
      const mean = ct.reduce((a, x) => a + x, 0) / ct.length;
      const sd = Math.sqrt(ct.reduce((a, x) => a + (x - mean) ** 2, 0) / (ct.length - 1));
      consistency.push({ k: b.k, num: b.num, name: b.name, sd });
    }
    consistency.sort((a, b) => b.sd - a.sd);
  }

  // Minisectores de 50 m: con el GPS del móvil (1 posición por segundo, unos metros de error), quedarse con el
  // mínimo de cada uno entre varias vueltas elige siempre a favor del ruido (en la tanda de ejemplo, 0,2–0,3 s
  // de más con 5 vueltas). Por eso la ideal de 50 m solo se da con GPS rápido (5 Hz o más); con el del móvil
  // sirven para el mapa de dónde pierdes, no como tiempo.
  const nM = Math.max(1, Math.round(L / MINI_M));
  const mBounds = Array.from({ length: nM }, (_, i) => (i * L) / nM);
  const mTimes = laps.map((l) =>
    mBounds.map((a, i) => timeBetween(l.grid, a, i + 1 < nM ? mBounds[i + 1] : L)),
  );
  const mBest = mBounds.map((_, i) => Math.min(...mTimes.map((t) => t[i])));
  const minis: Minis = {
    bounds: mBounds,
    best: mBest,
    lap: (num) => {
      const j = laps.findIndex((l) => l.num === num);
      return j < 0 ? null : mTimes[j].map((t, i) => t - mBest[i]);
    },
  };

  // Plan para la próxima tanda, en acciones que dependen de ti: la frenada de cada curva (su entrada) y su
  // salida (salida + recta, más la entrada de la curva siguiente cuando ahí se pierde por llegar más lento, que
  // viene de esta salida). Con su porqué y, si alguna otra vuelta lo hizo mejor, cuál (eso ya sabes hacerlo).
  const actions: {
    k: number;
    num: number;
    name: string;
    phase: PhaseName;
    gain: number;
    why: string[];
  }[] = [];
  const ph = target.phases;
  const nC = ph.length / 3;
  for (let j = 0; j < nC; j++) {
    const en = ph[3 * j];
    const sa = ph[3 * j + 1];
    const re = ph[3 * j + 2];
    const nextEn = ph[(3 * (j + 1)) % ph.length];
    if (!en.carry)
      actions.push({
        k: en.k,
        num: en.num,
        name: en.name,
        phase: "entrada",
        gain: en.loss,
        why: en.why,
      });
    const reWhy = re.why.filter(
      (w) => !(/^arrastras/.test(w) && sa.why.some((x) => /^sales/.test(x))),
    );
    actions.push({
      k: sa.k,
      num: sa.num,
      name: sa.name,
      phase: "salida",
      gain: sa.loss + re.loss + (nextEn.carry ? nextEn.loss : 0),
      why: sa.why
        .concat(reWhy)
        .slice(0, 2)
        .concat(nextEn.carry ? ["se nota hasta la frenada de C" + nextEn.num] : []),
    });
  }
  const plan: PlanItem[] = [];
  for (const a of actions
    .filter((x) => x.gain >= minPlan)
    .sort((x, y) => y.gain - x.gain)
    .slice(0, 3)) {
    const mine = self.filter(
      (s) => s.k === a.k && (a.phase === "entrada" ? s.phase === "entrada" : s.phase !== "entrada"),
    );
    const already = mine.length ? mine.reduce((x, y) => (x.gain >= y.gain ? x : y)) : null;
    plan.push({
      k: a.k,
      num: a.num,
      phase: a.phase,
      gain: a.gain,
      text:
        "C" +
        a.num +
        " · " +
        a.name +
        " · " +
        a.phase +
        (a.why.length ? ": " + a.why.join("; ") : ""),
      already: already ? { lapNum: already.lapNum, gain: already.gain } : null,
    });
  }
  // Sin pérdidas frente a la referencia (p. ej. tu mejor vuelta frente a sí misma): lo que ya has hecho mejor.
  if (!plan.length)
    for (const s of self.slice(0, 3))
      plan.push({
        k: s.k,
        num: s.num,
        phase: s.phase,
        gain: s.gain,
        text:
          "C" +
          s.num +
          " · " +
          s.name +
          " · " +
          s.phase +
          ": en la vuelta " +
          s.lapNum +
          " lo hiciste " +
          s.gain.toFixed(2).replace(".", ",") +
          " s mejor",
        already: { lapNum: s.lapNum, gain: s.gain },
      });

  return {
    ref: ref.label,
    refTime: ref.time,
    phases,
    laps: lapsOut,
    best,
    lap: target,
    self,
    consistency,
    ideal: {
      tramos,
      sectors: result.ideal,
      minis: fast ? mBest.reduce((a, x) => a + x, 0) : null,
      // La que se enseña: con GPS rápido, la de 50 m; con el del móvil, la de 4 sectores (límites a mitad de
      // recta y pocos tramos: sin el sesgo del ruido; la de tramos, en la tanda de ejemplo, salía 0,14 s baja).
      show: fast ? mBest.reduce((a, x) => a + x, 0) : result.ideal,
      kind: fast ? "minisectores de 50 m" : "4 sectores",
    },
    minis,
    plan,
  };
}
