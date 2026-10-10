// Aviso de caída (ruta libre): el motor apunta lo que ha saltado (va a la grabación) y avisa a la interfaz, que lleva la
// cuenta atrás, la alarma y «Estoy bien». Mientras hay una alarma en pantalla no se apunta otra.
import type { CrashEvent } from "../core/caida";
import type { CrashRecord, Engine } from "./state";

export function crashAlarm(E: Engine, ev: CrashEvent): void {
  if (E.host.events.crashActive?.()) return;
  const rec: CrashRecord = {
    hora: new Date(E.host.wallNow()).toISOString(),
    t: Math.round(ev.t * 10) / 10,
    por: ev.por,
    g: ev.g ? Math.round(ev.g * 10) / 10 : null,
    kmhAntes: Math.round(ev.vAntes * 3.6),
    tumbada: ev.tumbada,
    paradoA: null,
    alarma: false,
  };
  E.crashLog.push(rec);
  E.host.events.crash?.(E, ev, rec);
  E.host.events.meta?.(E, "grabando");
}
