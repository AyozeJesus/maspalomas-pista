// «Ochos» del resumen (entrenamiento en 8), sin React: los números de la sesión y una fila por cada 8.
import type { Ocho, OchoSummary } from "../../../core/ocho";
import type { Cell } from "../../../lib/brakes";
import { fmt, fmtSigned } from "../../../lib/format";

const deg = (x: number | null) => (x === null ? "—" : fmt(x, 0) + "°");
const secs = (x: number | null) => (x === null ? "—" : fmt(x, 2) + " s");
const kmh = (v: number | null) => (v === null ? "—" : fmt(v * 3.6, 0));

export interface Readout {
  label: string;
  value: string;
}

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
    { label: "Izquierda máx.", value: deg(s.izq) },
    { label: "Derecha máx.", value: deg(s.der) },
  ];
}

// #, tiempo, inclinación máxima a la izquierda y a la derecha, velocidad mínima (km/h) y frente al mejor («mejor»; «=»
// si empata con él a la centésima).
export function ochoRows(ochos: readonly Ocho[], best: number | null): Cell[][] {
  return ochos.map((o) => [
    String(o.num),
    secs(o.time),
    deg(o.leanL),
    deg(o.leanR),
    kmh(o.vMin),
    best === null
      ? "—"
      : o.time === best
        ? "mejor"
        : Math.abs(o.time - best) < 0.005
          ? "="
          : fmtSigned(o.time - best, 2),
  ]);
}

export function ochoNote(s: OchoSummary): string {
  return s.n
    ? "Cada 8: dos vueltas seguidas, una a cada lado; su tiempo, del principio del primer giro al final del segundo. La inclinación, la máxima hacia el lado de cada vuelta."
    : "No ha salido ningún 8 entero: cada 8 son dos vueltas seguidas, una a cada lado, de más de 200° cada una." +
        (s.vueltas ? " Vueltas sueltas: " + s.vueltas + "." : "");
}
