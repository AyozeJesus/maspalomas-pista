// El punto que se mueve por la ruta en el resumen (sin dibujar): en qué curva o frenada cae cada punto de la trazada,
// lo que se dice de él, a qué curva saltan «Curva anterior / siguiente» y qué punto se toca con el dedo en el mapa o
// en la gráfica.
import type { Brake, Curve, TrailPoint } from "../../../core/recorrido";
import { fmt, fmtClock, fmtMeters } from "../../../lib/format";

// Cada curva en la trazada: sus puntos (i0…i1) y el más tumbado (top).
export interface CurveSpan {
  c: Curve;
  i0: number;
  i1: number;
  top: number;
}

// Lo que se escribe bajo el mapa para un punto: arriba (y para el lector de pantalla, con comas), la curva o la
// frenada en la que está, y si hay curva antes o después (para los botones).
export interface ScrubText {
  at: string;
  aria: string;
  sub: string;
  hasPrev: boolean;
  hasNext: boolean;
}

const PHASE_NAME: Readonly<Record<string, string | undefined>> = {
  freno: "frenando",
  gas: "acelerando",
  muerto: "sin gas en curva",
  mantiene: "manteniendo",
};

// Primer punto de la trazada en el instante t o después (el último si no hay).
export function trailIndexAt(tr: readonly Pick<TrailPoint, "t">[], t: number): number {
  let lo = 0;
  let hi = tr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (tr[m].t < t) lo = m + 1;
    else hi = m;
  }
  return Math.min(lo, tr.length - 1);
}

// Las curvas en la trazada (con al menos un punto).
export function curveSpans(tr: readonly TrailPoint[], curves: readonly Curve[]): CurveSpan[] {
  return curves.map((c) => {
    const i0 = trailIndexAt(tr, c.t);
    let i1 = trailIndexAt(tr, c.endT);
    if (tr[i1].t > c.endT && i1 > i0) i1--;
    i1 = Math.max(i0, i1);
    let top = i0;
    let best = -1;
    for (let i = i0; i <= i1; i++) {
      const l = Math.abs(tr[i].lean);
      if (l > best) {
        best = l;
        top = i;
      }
    }
    if (best < 0) top = (i0 + i1) >> 1;
    return { c, i0, i1, top };
  });
}

// La curva en la que cae el punto i (o null).
export function spanAt(spans: readonly CurveSpan[], i: number): CurveSpan | null {
  let lo = 0;
  let hi = spans.length - 1;
  let k = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (spans[m].i0 <= i) {
      k = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return k >= 0 && i <= spans[k].i1 ? spans[k] : null;
}

// La frenada de verdad (la que vio el GPS) en marcha en el instante t, o null.
export function brakeAt(brakes: readonly Brake[], t: number): Brake | null {
  for (const b of brakes) if (b.gps !== false && b.t <= t && t <= b.endT) return b;
  return null;
}

// Lo que pasaba en el punto i: km, tiempo, velocidad, inclinación y fase; la curva (con sus datos) o la frenada, o lo
// que falta para la siguiente curva.
export function scrubText(
  tr: readonly TrailPoint[],
  curves: readonly Curve[],
  brakes: readonly Brake[],
  d: ArrayLike<number>,
  spans: readonly CurveSpan[],
  i: number,
): ScrubText {
  const p = tr[i];
  const lean = Math.abs(p.lean);
  const head = ["km " + fmt(d[i] / 1000, 1), fmtClock(p.t - tr[0].t), fmt(p.v * 3.6, 0) + " km/h"];
  if (lean === lean)
    head.push(lean >= 3 ? fmt(lean, 0) + "° " + (p.lean > 0 ? "der." : "izq.") : "recto");
  head.push(p.gap ? "sin GPS" : p.wh ? "caballito" : PHASE_NAME[p.ph] || "manteniendo");
  const parts: string[] = [];
  const sp = spanAt(spans, i);
  if (sp) parts.push(curveText(sp.c, curves.length));
  const b = brakeAt(brakes, p.t);
  if (b) parts.push(brakeText(b));
  if (!sp && !b) {
    const next = spans.find((s) => s.i0 > i);
    if (!next) parts.push("Recta");
    else {
      const gap = d[next.i0] - d[i];
      parts.push(
        gap < 10
          ? "Aquí empieza la curva " + next.c.num
          : "Recta: la curva " + next.c.num + " está a " + fmtMeters(gap),
      );
    }
  }
  return {
    at: head.join(" · "),
    aria: head.join(", "),
    sub: parts.join(". ") + ".",
    hasPrev: spans.some((s) => s.top < i),
    hasNext: spans.some((s) => s.top > i),
  };
}

// «Curva 12 de 85 (derecha): tumbado 38°, entra a 74 y baja a 51 km/h, frena 0,62 g, 0,8 s sin gas».
function curveText(c: Curve, total: number): string {
  return (
    "Curva " +
    c.num +
    " de " +
    total +
    (c.lean ? (c.lean > 0 ? " (derecha)" : " (izquierda)") : "") +
    (c.leanMax ? ": tumbado " + fmt(c.leanMax, 0) + "°" : ": inclinación aún sin medir") +
    ", entra a " +
    fmt(c.vEntry, 0) +
    " y baja a " +
    fmt(c.vMin, 0) +
    " km/h, " +
    (c.brakeG ? "frena " + fmt(c.brakeG, 2) + " g" : "sin frenar") +
    ", " +
    (c.dead >= 0.05 ? fmt(c.dead, 1) + " s sin gas" : "gas sin esperar")
  );
}

// «Frenada: pico 0,85 g, de 92 a 48 km/h en 61 m, hunde ≈84 mm».
function brakeText(b: Brake): string {
  return (
    "Frenada: pico " +
    fmt(b.peak, 2) +
    " g, de " +
    b.vIn +
    " a " +
    b.vOut +
    " km/h en " +
    b.dist +
    " m" +
    (b.diveMm ? ", hunde ≈" + b.diveMm + " mm" : "")
  );
}

// El punto al que va «Curva siguiente» (dir 1) o «anterior» (−1): el más tumbado de esa curva; null si no hay.
export function jumpTarget(spans: readonly CurveSpan[], i: number, dir: 1 | -1): number | null {
  if (dir > 0) {
    const to = spans.find((s) => s.top > i);
    return to ? to.top : null;
  }
  for (let k = spans.length - 1; k >= 0; k--) if (spans[k].top < i) return spans[k].top;
  return null;
}

// El punto de la trazada que se toca en el mapa (x, y en metros; tol: lo que el dedo no distingue, en metros). El más
// cerca del dedo; si hay varias pasadas igual de cerca (una ida y vuelta por la misma carretera pasa dos veces por el
// mismo sitio), la más cercana en el recorrido al punto de ahora (cur): arrastrando no salta al otro sentido. −1 si
// la trazada está vacía.
export function trailPick(
  tr: readonly Pick<TrailPoint, "x" | "y">[],
  x: number,
  y: number,
  cur: number,
  tol: number,
): number {
  const ds = new Float64Array(tr.length);
  let bestD = Infinity;
  for (let i = 0; i < tr.length; i++) {
    ds[i] = Math.hypot(tr[i].x - x, tr[i].y - y);
    if (ds[i] < bestD) bestD = ds[i];
  }
  // Las pasadas que caen bajo el dedo (puntos seguidos de la trazada) y, de cada una, el punto más cercano.
  let pick = -1;
  let pickK = Infinity;
  let run: { last: number; i: number; d: number; k: number } | null = null;
  const close = (r: typeof run) => {
    if (r && r.k < pickK) {
      pickK = r.k;
      pick = r.i;
    }
  };
  for (let i = 0; i < tr.length; i++) {
    if (ds[i] > bestD + tol) continue;
    if (!run || i - run.last > 5) {
      close(run);
      run = { last: i, i, d: ds[i], k: Math.abs(i - cur) };
    } else {
      run.last = i;
      run.k = Math.min(run.k, Math.abs(i - cur));
      if (ds[i] < run.d) {
        run.d = ds[i];
        run.i = i;
      }
    }
  }
  close(run);
  return pick;
}

// El punto de la trazada a s metros del principio (el más cercano), con los metros de cada punto en d.
export function indexAtDistance(d: ArrayLike<number>, s: number): number {
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && s - d[lo - 1] < d[lo] - s) lo--;
  return lo;
}
