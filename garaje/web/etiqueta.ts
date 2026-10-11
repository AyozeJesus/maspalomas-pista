// La etiqueta del estado de una tanda en la lista del garaje: grabando, cortada, ruta libre (con sus kilómetros y la
// tumbada, o el circuito por el que fue), vídeo de GoPro, simulador o terminada (con el GPS externo, si lo llevaba).
// Devuelve la clase y el texto.
import type { ResumenLista, TandaLista } from "../api";
import { fmt, fmtLap } from "./formato";

export function stateTag(meta: TandaLista["meta"], r: ResumenLista | null): [string, string] {
  if (!meta) return ["tag", "sin resumen"];
  if (meta.estado === "grabando") return ["tag live", "grabando"];
  if (meta.estado === "cortada") return ["tag cut", "cortada"];
  // Ruta libre por un circuito cualquiera: su nombre, las vueltas y la mejor.
  if (meta.tipo === "ruta" && meta.circuito) {
    const c = meta.circuito;
    const n = (c.vueltas || []).filter((v) => v.valid).length;
    return [
      "tag",
      c.nombre +
        " · " +
        n +
        (n === 1 ? " vuelta" : " vueltas") +
        (c.mejor ? " · mejor " + fmtLap(c.mejor) : ""),
    ];
  }
  // Ruta libre: kilómetros y tumbada máxima en la etiqueta (no hay vueltas).
  if (meta.tipo === "ruta")
    return [
      "tag",
      "ruta libre" +
        (r && r.distancia ? " · " + fmt(r.distancia / 1000, 1) + " km" : "") +
        (r && (r.inclDerecha || r.inclIzquierda)
          ? " · máx " + fmt(Math.max(r.inclDerecha || 0, r.inclIzquierda || 0), 0) + "°"
          : ""),
    ];
  if (meta.fuente === "gopro") return ["tag", "vídeo GoPro"];
  // Con receptor GPS externo, a cuántos Hz (las del móvil van a 1).
  const gps = meta.gps && meta.gps.hz ? " · GPS " + meta.gps.hz + " Hz" : "";
  return ["tag", (meta.sim ? "simulador" : "terminada") + gps];
}
