// La tarjeta «Tramos» del resumen (sin la página): cada pasada por un tramo guardado con su tiempo y, si ya había otra,
// la comparación con la mejor (dónde se gana o se pierde y dónde se empieza a frenar); y si se ofrece guardar la ruta
// como tramo (o como dos, si es de ida y vuelta).
import type { Turnaround } from "../../../core/cortar";
import {
  brakePoints,
  delta,
  MARK,
  needsPath,
  type StoredPass,
  type Tramo,
} from "../../../core/tramos";
import type { Engine, TramoPassRecord } from "../../../engine";
import { fmt, fmtLap, fmtSigned, shortDate } from "../../../lib/format";
import { bestPass } from "../../../services/tramos-store";
import type { LegendItem } from "../../draw/mapa";

// Una pasada, la guardada o la recién medida (la vuelta de ejemplo no guarda nada).
export type PassLike = Pick<StoredPass, "tiempo" | "tiempos" | "frenos"> & { fecha?: string };

// Colores de las dos pasadas en la gráfica y en el mapa.
export const THIS_PASS = "#5aa5f0";
export const OTHER_PASS = "#a86ff0";

// Principios de frenada de dos pasadas (m desde la salida), medidos igual en las dos: con el acelerómetro si las dos
// lo tienen (pasadas en directo o repasadas), si no con la velocidad del GPS.
export function brakesPair(a: PassLike, b: PassLike): { acc: boolean; a: number[]; b: number[] } {
  const acc = !!(a.frenos && b.frenos);
  const of = (p: PassLike) =>
    acc && p.frenos ? p.frenos.map((x) => x[0]) : brakePoints(p.tiempos);
  return { acc, a: of(a), b: of(b) };
}

// Lo que dice la comparación de dos pasadas (a, la de ahora; b, con la que se compara): dónde se gana y se pierde (en 5
// trozos iguales) y dónde se empieza a frenar (las frenadas de a junto a las de b a menos de 80 m).
export function passInsights(a: PassLike, b: PassLike): string {
  const d = delta(a.tiempos, b.tiempos);
  const n = d.length;
  if (n < 10) return "";
  const parts: { km0: number; km1: number; dd: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const i0 = Math.floor((k * (n - 1)) / 5);
    const i1 = Math.floor(((k + 1) * (n - 1)) / 5);
    parts.push({ km0: (i0 * MARK) / 1000, km1: (i1 * MARK) / 1000, dd: d[i1] - d[i0] });
  }
  const loss = parts.reduce((x, y) => (y.dd > x.dd ? y : x));
  const gain = parts.reduce((x, y) => (y.dd < x.dd ? y : x));
  const out: string[] = [];
  const span = (p: { km0: number; km1: number }) =>
    "del km " + fmt(p.km0, 1) + " al " + fmt(p.km1, 1);
  if (loss.dd > 0.3)
    out.push("Donde más pierdes: " + span(loss) + " (" + fmtSigned(loss.dd, 1) + " s).");
  if (gain.dd < -0.3)
    out.push("Donde más ganas: " + span(gain) + " (" + fmtSigned(gain.dd, 1) + " s).");
  const bp = brakesPair(a, b);
  const diffs: { s: number; d: number }[] = [];
  for (const s of bp.a) {
    let best: number | null = null;
    for (const q of bp.b)
      if (Math.abs(q - s) <= 80 && (best === null || Math.abs(q - s) < Math.abs(best - s)))
        best = q;
    if (best !== null) diffs.push({ s, d: s - best });
  }
  if (diffs.length >= 3) {
    const m = diffs.reduce((x, y) => x + y.d, 0) / diffs.length;
    const how = bp.acc ? "con el acelerómetro" : "con el GPS del móvil, ±20 m";
    out.push(
      Math.abs(m) < 5
        ? "Empiezas a frenar en los mismos sitios (" +
            diffs.length +
            " frenadas comparadas, " +
            how +
            ")."
        : "Empiezas a frenar de media " +
            Math.round(Math.abs(m)) +
            " m " +
            (m > 0 ? "más tarde" : "antes") +
            " (" +
            diffs.length +
            " frenadas comparadas, " +
            how +
            ").",
    );
    // La que más cambia (más de 10 m), con dónde está.
    const big = diffs.reduce((x, y) => (Math.abs(y.d) > Math.abs(x.d) ? y : x));
    if (Math.abs(big.d) >= 10)
      out.push(
        "Donde más cambia: en el km " +
          fmt(big.s / 1000, 2) +
          " frenas " +
          Math.round(Math.abs(big.d)) +
          " m " +
          (big.d > 0 ? "más tarde" : "antes") +
          ".",
      );
  }
  return out.join(" ");
}

// Qué parte del rato rodando de una grabación (del primer al último fijo en marcha) cubren sus pasadas por tramos.
export function tramoCoverage(eng: Engine): number {
  const l = eng.loc.view();
  let a: number | null = null;
  let z: number | null = null;
  for (let i = 0; i < l.t.length; i++)
    if (l.speed[i] > 2) {
      if (a === null) a = l.t[i];
      z = l.t[i];
    }
  if (a === null || z === null || !(z > a)) return 0;
  const iv = eng.tramoPasses.map((p) => [p.t0, p.t1]).sort((p, q) => p[0] - q[0]);
  let sum = 0;
  let end = -Infinity;
  for (const [p0, p1] of iv) {
    const s = Math.max(p0, end);
    if (p1 > s) sum += p1 - s;
    end = Math.max(end, p1);
  }
  return sum / (z - a);
}

// La comparación de una pasada con la mejor (o con la anterior mejor, si esta la ha batido).
export interface PassCompare {
  text: string;
  legend: LegendItem[];
  a: PassLike;
  b: PassLike;
  tp: TramoPassRecord;
  // El tramo, con su camino.
  tr: Tramo;
}

export interface TramoItem {
  title: string;
  time: string;
  // La diferencia con la mejor (clase y texto).
  cls: string;
  diff: string;
  compare: PassCompare | null;
}

export interface TramoCard {
  // Ni pasadas ni nada que guardar: la tarjeta no sale.
  hidden: boolean;
  items: TramoItem[];
  // «Guardar como tramo» (una vez por resumen).
  showSave: boolean;
  // La vuelta atrás de una ida y vuelta, para «Guardar ida y vuelta» (null: no sale).
  turn: Turnaround | null;
  note: string;
}

// Una pasada sin otra con la que compararla punto a punto.
export const NEXT_TIME = "La próxima vez que pases por aquí en este sentido, se compara con esta.";

// Cada pasada de esta ruta por un tramo guardado (tramos: los guardados ahora). turn: la ida y vuelta de la ruta.
export function tramoCard(
  eng: Engine,
  tramos: readonly Tramo[],
  turn: Turnaround | null,
): TramoCard {
  // Un entrenamiento en 8 no es un tramo (ni pasa por ninguno: en ese modo no se buscan).
  const canSave = !eng.ocho && !!((eng.viewing || !eng.sim) && eng.loc.n > 20);
  const hidden = !canSave && !eng.tramoPasses.length;
  if (hidden) return { hidden, items: [], showSave: false, turn: null, note: "" };
  const items: TramoItem[] = [];
  for (const tp of eng.tramoPasses) {
    const tr = tramos.find((x) => x.id === tp.id);
    if (tr) items.push(tramoItem(tp, tr));
  }
  const showSave = canSave && !eng.tramoSaved;
  // Ya cronometrada casi entera por tus tramos (la subida y la bajada marcadas): sin «ida y vuelta».
  const sug = showSave && turn && tramoCoverage(eng) <= 0.8 ? turn : null;
  return {
    hidden,
    items,
    showSave,
    turn: sug,
    note: showSave
      ? (eng.tramoPasses.length ? "¿Otro tramo? " : "") +
        "Guarda esta ruta como tramo: la próxima vez que pases por ella en el mismo sentido, se cronometra sola y se compara con esta (también en las rutas que ya tienes guardadas)." +
        (sug
          ? " Es de ida y vuelta: «Guardar ida y vuelta» la guarda como dos tramos, uno por sentido."
          : "")
      : "",
  };
}

function tramoItem(tp: TramoPassRecord, tr: Tramo): TramoItem {
  const fecha = (tp.pasada as PassLike).fecha;
  const mine: PassLike = (tr.pasadas || []).find((q) => q.fecha === fecha) || tp.pasada;
  const other = bestPass(tr, mine as StoredPass);
  const beat = !!other && mine.tiempo <= other.tiempo;
  const item: TramoItem = {
    title: tp.nombre + (tr.largo ? " · " + fmt(tr.largo / 1000, 1) + " km" : ""),
    time: fmtLap(mine.tiempo, 1),
    cls: other ? (beat ? "up" : "down") : "",
    diff: other
      ? beat
        ? "tu mejor (" + fmtSigned(mine.tiempo - other.tiempo, 1) + " s)"
        : fmtSigned(mine.tiempo - other.tiempo, 1) + " s"
      : "primera pasada",
    compare: null,
  };
  // La comparación punto a punto necesita las marcas cada 20 m de las dos (un tramo de salida y meta las tiene desde
  // que aprende el camino).
  const marks = (q: PassLike) => Array.isArray(q.tiempos) && q.tiempos.length > 2;
  if (other && marks(mine) && marks(other) && !needsPath(tr))
    item.compare = {
      text:
        (beat ? "Frente a la anterior mejor (" : "Frente a tu mejor (") +
        shortDate(other.fecha) +
        ", " +
        fmtLap(other.tiempo, 1) +
        "). " +
        passInsights(mine, other),
      // Leyenda de la gráfica (fuera del dibujo: dentro se montaba con los triángulos). Sin color: texto sin marca.
      legend: [
        ["esta pasada", THIS_PASS],
        [beat ? "la anterior mejor" : "tu mejor", OTHER_PASS],
        ["▼ y ● (mapa): empieza a frenar", ""],
        ["por delante", "#22c35f"],
        ["por detrás", "#ff5b4f"],
      ],
      a: mine,
      b: other,
      tp,
      tr,
    };
  return item;
}
