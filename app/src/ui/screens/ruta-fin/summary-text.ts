// Lo que dice el resumen de la ruta arriba: el título, la fecha con los km y el tiempo, y los números de «Resumen»
// (lo mismo que lleva la imagen para compartir) y de «Más datos».
import type { RideSummary } from "../../../core/recorrido";
import type { CrashRecord, Engine } from "../../../engine";
import { fmt, fmtClock } from "../../../lib/format";
import { engName } from "../../../services/naming";
import type { ColorBy } from "../../draw/mapa";

// Un número del resumen; more: va en «Más datos».
export interface Readout {
  label: string;
  value: string;
  more: boolean;
}

// El nombre que se le ha puesto («Los Loros») o «Tu ruta».
export function summaryTitle(eng: Engine): string {
  return engName(eng) || "Tu ruta";
}

// «sábado, 10 de octubre · 12,5 km · 10:25». La fecha, la de la grabación (o la de la que se repasa); la vuelta de
// ejemplo, la de ahora (nowMs).
export function summarySub(eng: Engine, s: RideSummary, nowMs: number): string {
  const d = new Date(eng.rec ? eng.rec.epoch : eng.viewEpoch || nowMs);
  return (
    d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) +
    " · " +
    fmt(s.distancia / 1000, 1) +
    " km · " +
    fmtClock(s.duracion)
  );
}

export function colorText(by: ColorBy): string {
  return "Color: " + (by === "fase" ? "fases" : "inclinación");
}

export function summaryReadouts(s: RideSummary, crashLog: readonly CrashRecord[]): Readout[] {
  const out: Readout[] = [];
  const add = (label: string, value: string, more = false) => out.push({ label, value, more });
  const known = (x: number | null | undefined): x is number => x !== null && x !== undefined;
  add("Distancia", fmt(s.distancia / 1000, 1) + " km");
  add("Tiempo", fmtClock(s.duracion));
  add("Punta", fmt(s.punta, 0) + " km/h");
  add("Incl. derecha", s.inclDerecha ? fmt(s.inclDerecha, 0) + "°" : "—");
  add("Incl. izquierda", s.inclIzquierda ? fmt(s.inclIzquierda, 0) + "°" : "—");
  add("Frenada máx.", s.frenadaMax ? fmt(s.frenadaMax, 2) + " g" : "—");
  add("Curvas", String(s.curvas));
  add("Frenadas", String(s.frenadas || 0));
  add(
    "Caballitos",
    s.caballitos
      ? s.caballitos + " · " + s.caballitosMetros + " m · ≈" + fmt(s.caballitosPerdido, 2) + " s"
      : "ninguno",
  );
  add("Mejor mordida", known(s.mordidaMejor) ? fmt(s.mordidaMejor, 2) + " s" : "—", true);
  add(
    "Hundimiento máx.",
    known(s.hundimientoMax) ? fmt(s.hundimientoMax, 1) + "° ≈" + s.hundimientoMaxMm + " mm" : "—",
    true,
  );
  add("Frenando tumbado", s.frenadaTumbadoMax ? s.frenadaTumbadoMax + " m (máx.)" : "—", true);
  add("Aceleración máx.", s.aceleracionMax ? fmt(s.aceleracionMax, 2) + " g" : "—", true);
  if (crashLog.length) add("Avisos de caída", crashLog.map(crashText).join("; "), true);
  add(
    "Sin gas en curva (media)",
    s.tiempoMuertoMedio !== null ? fmt(s.tiempoMuertoMedio, 1) + " s" : "—",
    true,
  );
  return out;
}

// «17:23 · «Estoy bien» a los 12 s» o «17:40 · sonó la alarma».
function crashText(c: CrashRecord): string {
  return (
    new Date(c.hora).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) +
    (c.alarma
      ? " · sonó la alarma"
      : c.paradoA !== null
        ? " · «Estoy bien» a los " + c.paradoA + " s"
        : "")
  );
}
