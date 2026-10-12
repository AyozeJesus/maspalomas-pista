// «Ochos» del resumen (entrenamiento en 8), sin React: los números de la sesión, lo de cada lado, los tiempos de cada 8
// para su gráfica y una fila por cada 8.
import type { Ocho, OchoSummary } from "../../../core/ocho";
import type { Cell } from "../../../lib/brakes";
import { fmt, fmtSigned } from "../../../lib/format";
import type { LapPoint } from "../../charts/lap-times";

const deg = (x: number | null) => (x === null ? "—" : fmt(x, 0) + "°");
const secs = (x: number | null) => (x === null ? "—" : fmt(x, 2) + " s");
const secs1 = (x: number | null) => (x === null ? "—" : fmt(x, 1) + " s");
const kmh = (v: number | null) => (v === null ? "—" : fmt(v * 3.6, 0));

export interface Readout {
  label: string;
  value: string;
}

// Las casillas: lo de los tiempos.
export function ochoReadouts(s: OchoSummary): Readout[] {
  return [
    { label: "Ochos", value: String(s.n) },
    { label: "Mejor", value: secs(s.mejor) },
    { label: "Media", value: secs(s.media) },
    // Cuánto se separan los tiempos de su media: cuanto menos, más regular.
    {
      label: "Regularidad",
      value: s.desviacion === null ? "—" : "±" + fmt(s.desviacion, 2) + " s",
    },
  ];
}

export interface SideRow {
  label: string;
  izq: string;
  der: string;
}

// Cada lado, en columnas (se compara de un vistazo): lo que va tumbada la moto durante la vuelta (la mediana de los
// ochos), lo más tumbado de la sesión y lo que tarda la vuelta (con su parte del cruce: las dos suman el 8).
export function ochoSides(s: OchoSummary): SideRow[] {
  return [
    { label: "Sostenida", izq: deg(s.izqTipica), der: deg(s.derTipica) },
    { label: "Máxima", izq: deg(s.izq), der: deg(s.der) },
    { label: "Cada vuelta", izq: secs1(s.vueltaIzq), der: secs1(s.vueltaDer) },
  ];
}

// Los tiempos de cada 8, para su gráfica (el mejor, marcado).
export function ochoPoints(ochos: readonly Ocho[], best: number | null): LapPoint[] {
  return ochos.map((o) => ({ num: o.num, time: o.time, best: o.time === best }));
}

// #, tiempo, inclinación máxima a la izquierda y a la derecha, punta (km/h, la del GPS) y frente al mejor («mejor»;
// «=» si empata con él a la centésima). La punta y no la mínima: por debajo de ~9 km/h el GPS del Vivo da 0.
export function ochoRows(ochos: readonly Ocho[], best: number | null): Cell[][] {
  return ochos.map((o) => [
    String(o.num),
    secs(o.time),
    deg(o.leanL),
    deg(o.leanR),
    kmh(o.vMax),
    best === null
      ? "—"
      : o.time === best
        ? "mejor"
        : Math.abs(o.time - best) < 0.005
          ? "="
          : fmtSigned(o.time - best, 2),
  ]);
}

// A partir de esta diferencia (s) entre lo que tarda la vuelta de cada lado se dice cuál tarda más. (La diferencia de
// inclinación entre lados no se afirma: un par de grados de calibración la cambian y no hay con qué descontarlos; está
// en la tablita.)
const TIME_GAP = 0.3;

// Qué vuelta tarda más, si se nota.
function timeNote(s: OchoSummary): string {
  if (s.vueltaIzq === null || s.vueltaDer === null) return "";
  const d = s.vueltaDer - s.vueltaIzq;
  if (Math.abs(d) < TIME_GAP) return "";
  const [mas, menos] = d > 0 ? ["derecha", "izquierda"] : ["izquierda", "derecha"];
  return (
    "La vuelta a la " +
    mas +
    " tarda unos " +
    fmt(Math.abs(d), 1) +
    " s más que la de la " +
    menos +
    ". "
  );
}

const circulosNote = (s: OchoSummary) =>
  s.circulos
    ? "Vueltas de más al mismo lado (no cuentan como 8): " +
      s.circulos +
      (s.circulos === 1 ? " vez. " : " veces. ")
    : "";

// Primero lo que se puede trabajar (qué vuelta tarda más, las vueltas de más); después, qué es cada cosa. Sin
// inclinación (sin calibrar, en una explanada sin rectas no llega a salir), lo que hay que hacer en vez de explicarla.
export function ochoNote(s: OchoSummary): string {
  if (!s.n)
    return (
      "No ha salido ningún 8 entero: cada 8 son dos vueltas seguidas, una a cada lado, de algo más de media vuelta a una vuelta entera, sin parar entre una y otra." +
      (s.vueltas ? " Vueltas sueltas: " + s.vueltas + "." : "") +
      (s.circulos ? " " + circulosNote(s).trim() : "")
    );
  const noLean = s.izq === null && s.der === null && s.izqTipica === null && s.derTipica === null;
  return (
    (noLean ? "Sin inclinación: antes de empezar, «Calibrar» parado y con la moto recta. " : "") +
    timeNote(s) +
    circulosNote(s) +
    "Cada 8: dos vueltas seguidas, una a cada lado; su tiempo, del principio del primer giro al final del segundo." +
    (noLean
      ? ""
      : " «Sostenida»: lo que va tumbada la moto durante la vuelta; «máxima», lo más (en la tabla de abajo, lo más de cada 8). Es la moto: con contrapeso, el cuerpo va más derecho.")
  );
}
