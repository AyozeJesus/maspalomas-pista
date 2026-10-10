// Cómo se escribe una frenada en las tablas (boxes y resumen de la ruta) y en el resumen de la última curva del panel.
import type { BrakeBrief } from "../core/recorrido";
import { fmt } from "./format";

// Lo que hace falta de una frenada (la entera o su resumen).
export type BrakeLike = Pick<BrakeBrief, "bite" | "dive" | "diveMm" | "trail" | "leanMax">;

// Una celda: un texto, o un texto con su nota debajo (pequeña).
export type Cell = string | readonly [main: string, note: string];

export function hasDive(b: Pick<BrakeLike, "dive">): boolean {
  return b.dive !== null && b.dive !== undefined;
}

// «4,1° ≈95 mm».
export function fmtDive(b: Pick<BrakeLike, "dive" | "diveMm">): string {
  return hasDive(b) ? fmt(b.dive, 1) + "° ≈" + b.diveMm + " mm" : "—";
}

export function diveCell(b: Pick<BrakeLike, "dive" | "diveMm">): Cell {
  return hasDive(b) ? [fmt(b.dive, 1) + "°", "≈" + b.diveMm + " mm"] : "—";
}

export function trailCell(b: Pick<BrakeLike, "trail" | "leanMax">): Cell {
  return b.trail > 0 ? [b.trail + " m", b.leanMax ? fmt(b.leanMax, 0) + "°" : ""] : "—";
}

// «Llega 0,35 s · hunde 4,1° ≈95 mm · tumbado 14 m (22°)» (lo que se sepa).
export function brakeLine(b: BrakeLike | null | undefined): string {
  if (!b) return "";
  const parts = ["Llega " + fmt(b.bite, 2) + " s"];
  if (b.dive !== null && b.dive !== undefined) parts.push("hunde " + fmtDive(b));
  if (b.trail > 0)
    parts.push("tumbado " + b.trail + " m" + (b.leanMax ? " (" + fmt(b.leanMax, 0) + "°)" : ""));
  return parts.join(" · ");
}
