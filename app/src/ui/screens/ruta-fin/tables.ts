// Las tablas del resumen (curvas, frenadas y caballitos): sus filas, su nota y el botón para verlas enteras.
import type { Curve, RideSummary, Wheelie } from "../../../core/recorrido";
import { diveCell, trailCell, type Cell } from "../../../lib/brakes";
import { topCurves } from "../../../lib/curves";
import { fmt } from "../../../lib/format";

// Las 5 primeras filas a la vista y «Ver las N» para el resto (con las 40 frenadas, el resumen ocupaba siete
// pantallas).
export const FOLD_ROWS = 5;

export function foldText(n: number, all: boolean): string {
  return all ? "Ver menos" : "Ver las " + n;
}

export interface Table {
  note: string;
  rows: Cell[][];
}

// Las 15 curvas más tumbadas: lado, tumbada, velocidad de entrada y mínima, frenada y rato sin gas.
export function curvesTable(curves: readonly Curve[]): Table {
  const top = topCurves(curves, 15);
  return {
    note:
      curves.length > top.length
        ? "Las " + top.length + " curvas más tumbadas de " + curves.length + "."
        : curves.length
          ? ""
          : "No se ha detectado ninguna curva.",
    rows: top.map((c) => [
      c.num + ((c.lean ?? 0) > 0 ? " der." : " izq."),
      fmt(c.leanMax, 0) + "°",
      fmt(c.vEntry, 0) + " → " + fmt(c.vMin, 0),
      c.brakeG ? fmt(c.brakeG, 2) + " g" : "—",
      fmt(c.dead, 1) + " s",
    ]),
  };
}

// Las frenadas de la ruta (las más fuertes primero; el resumen guarda las 40 más fuertes).
export function brakesTable(s: RideSummary): Table {
  const list = s.listaFrenadas || [];
  return {
    note:
      (s.frenadas > list.length
        ? "Las " + list.length + " más fuertes de " + s.frenadas + ". "
        : "") +
      "«Llega»: lo que tardas en llegar al 80 % del pico (más corto, más decidido). «Hunde»: cuánto baja el morro; los mm son una estimación.",
    rows: list.map((b) => [
      String(b.num),
      fmt(b.peak, 2) + " g",
      fmt(b.bite, 2) + " s",
      b.vIn + " → " + b.vOut,
      diveCell(b),
      trailCell(b),
    ]),
  };
}

// Los caballitos: duración, metros, morro, desde qué velocidad y lo que se pierde.
export function wheelieRows(wheelies: readonly Wheelie[]): Cell[][] {
  return wheelies.map((w) => [
    String(w.num),
    fmt(w.dur, 1) + " s",
    w.dist + " m",
    fmt(w.max, 0) + "°",
    w.v0 + " km/h",
    "≈" + fmt(w.lost, 2) + " s",
  ]);
}
