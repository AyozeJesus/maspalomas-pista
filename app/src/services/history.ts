// «Mis rutas»: cómo se cuenta cada grabación guardada en la lista (su fecha y una línea con lo esencial).
import { fmt, fmtClock, fmtLap } from "../lib/format";
import type { StoredSession } from "../storage";

// Lo que la lista lee del resumen guardado (lo escribe recorder.buildMeta; las de versiones viejas pueden no tenerlo).
export interface ListedSession extends StoredSession {
  inicio?: string;
  fin?: string | null;
  epoch?: number;
  sim?: boolean;
  tipo?: "ruta" | "pista";
  nombre?: string;
  recorrido?: { distancia?: number; duracion?: number } | null;
  circuito?: { nombre: string; mejor: number | null } | null;
  vueltas?: { valid: boolean }[];
  mejor?: number | null;
  calculo?: number;
  // Entrenamiento en 8.
  modo?: "ocho";
  ochos?: { n: number; mejor: number | null } | null;
  // Ruta libre: sus pasadas por tramos (los tuyos y las subidas), en orden (las guarda el repaso: viewer.keepResult).
  tramos?: { id: string; nombre: string; tiempo: number }[] | null;
}

// Tramos que se nombran en la línea; del resto, cuántos.
const TRAMOS_SHOWN = 3;

// «vie, 9 oct, 16:31».
export function sessionDate(s: ListedSession): string {
  const d = new Date(s.inicio || s.epoch || 0);
  return d.toLocaleString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// «Ruta libre · 23,4 km · 1:12:05», «Circuito · 8 vueltas · mejor 1:09,32» o «Entrenamiento en 8 · 12 ochos…».
export function sessionLine(s: ListedSession): string {
  // La ruta lleva su tiempo en el resumen; si no, del principio al final de la grabación.
  const rd = s.recorrido ? s.recorrido.duracion : undefined;
  const dur =
    rd !== undefined && Number.isFinite(rd) && rd > 0
      ? rd
      : s.inicio && s.fin
        ? (new Date(s.fin).getTime() - new Date(s.inicio).getTime()) / 1000
        : null;
  const parts: string[] = [];
  if (s.modo === "ocho") {
    // «Entrenamiento en 8 · 12 ochos · mejor 7,42 s · 15:20».
    parts.push("Entrenamiento en 8");
    const n = s.ochos ? s.ochos.n : 0;
    parts.push(n + (n === 1 ? " ocho" : " ochos"));
    if (s.ochos && s.ochos.mejor !== null) parts.push("mejor " + fmt(s.ochos.mejor, 2) + " s");
  } else if (s.tipo === "ruta") {
    parts.push("Ruta libre");
    const km = s.recorrido ? s.recorrido.distancia : null;
    if (km !== null && km !== undefined && Number.isFinite(km))
      parts.push(fmt(km / 1000, 1) + " km");
    if (s.circuito)
      parts.push(
        s.circuito.nombre + (s.circuito.mejor ? " · mejor " + fmtLap(s.circuito.mejor) : ""),
      );
  } else {
    parts.push("Circuito");
    const n = (s.vueltas || []).filter((v) => v.valid).length;
    parts.push(n + (n === 1 ? " vuelta" : " vueltas"));
    if (s.mejor) parts.push("mejor " + fmtLap(s.mejor));
  }
  if (dur !== null && dur > 0) parts.push(fmtClock(dur));
  // «… · Barranco Hondo (sur) 1:43,7 · Cuesta de Las Tablas (sur) 1:04,7».
  const tramos = s.modo !== "ocho" && s.tipo === "ruta" && Array.isArray(s.tramos) ? s.tramos : [];
  for (const p of tramos.slice(0, TRAMOS_SHOWN)) parts.push(p.nombre + " " + fmtLap(p.tiempo, 1));
  const more = tramos.length - TRAMOS_SHOWN;
  if (more > 0) parts.push("y " + more + (more === 1 ? " tramo más" : " tramos más"));
  if (s.estado === "cortada") parts.push("cortada");
  return parts.join(" · ");
}
