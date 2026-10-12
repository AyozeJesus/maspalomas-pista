// Las tablas del resumen (curvas, frenadas y caballitos): sus filas, su nota y el botón para verlas enteras.
import type { Curve, RideSummary, TrailPoint, Wheelie } from "../../../core/recorrido";
import { diveCell, trailCell, type Cell } from "../../../lib/brakes";
import { topCurves } from "../../../lib/curves";
import { fmt } from "../../../lib/format";
import { placeOf, type Place } from "../../../lib/maps";
import { homeZone } from "./home-zone";
import { curveSpans, type CurveSpan } from "./scrub";

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

// Dónde está lo de una fila en Google Maps, con el nombre de su enlace para el lector de pantalla; o, cerca de casa
// (home-zone.ts), solo de qué lado («Cerca de la salida»), sin coordenadas ni enlace.
export type RowPlace = (Place & { label: string }) | { near: string };

// La de curvas lleva además dónde está cada una: null sin trazada.
export interface CurvesTable extends Table {
  places: (RowPlace | null)[];
}

// Dónde está una curva: su punto más tumbado de la trazada (al que llevan «Curva anterior / siguiente», el mismo
// punto con el que se mueve el del mapa). Su vértice (donde fue más despacio) cae a veces en el borde de la curva, o
// ya en la siguiente: no sirve para encontrarla.
export function curvePlace(sp: CurveSpan, tr: readonly TrailPoint[]): RowPlace {
  const home = homeZone(tr, tr[sp.top], sp.top);
  if (home) return { near: "Cerca de la " + home };
  return { ...placeOf(tr[sp.top]), label: "Ver la curva " + sp.c.num + " en Google Maps" };
}

// Las 15 curvas más tumbadas: lado, tumbada, velocidad de entrada y mínima, frenada, rato sin gas y dónde está (en la
// trazada tr).
export function curvesTable(curves: readonly Curve[], tr: readonly TrailPoint[]): CurvesTable {
  const top = topCurves(curves, 15);
  const spans = tr.length ? curveSpans(tr, curves) : [];
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
    places: top.map((c) => {
      const sp = spans.find((s) => s.c === c);
      return sp ? curvePlace(sp, tr) : null;
    }),
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
