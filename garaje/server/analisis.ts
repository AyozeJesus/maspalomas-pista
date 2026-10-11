// El análisis de cada tanda en el Mac, con el mismo código que el móvil (app/src/core/maspalomas): resumen.json con
// sus vueltas, sectores y curvas. Se calcula en segundo plano, una tanda cada vez, y se repite solo si cambia lo
// recibido o la versión del resumen.
import { join } from "node:path";
import { analyze, sessionFromCsv } from "../../app/src/core/maspalomas";
import type { CircuitoMeta, Finish, Resumen, ResumenLista, Stamp, TandaLista } from "../api";
import { isNum, readObject, writeAtomic } from "./archivos";
import { log } from "./log";
import { filesOf, finishKey, finishOf, readMeta, stampOf, tandaDir } from "./tandas";

// Si cambia lo que guarda el resumen, sube la versión y los resúmenes viejos se recalculan solos.
const RESUMEN_V = 3;

export function isFresh(resumen: Resumen | null, stamp: Stamp): resumen is Resumen {
  return (
    !!resumen &&
    resumen.v === RESUMEN_V &&
    resumen.trozos === stamp.trozos &&
    resumen.bytes === stamp.bytes &&
    resumen.meta === stamp.meta
  );
}

// El resumen guardado de una tanda: el de su línea de meta (resumen.json) o el calculado con otra
// (resumen-meta-<osm>-<rev>.json).
export function readResumen(id: string, finish?: Finish): Resumen | null {
  return readObject<Resumen>(join(tandaDir(id), resumenFile(finish)));
}

function resumenFile(finish?: Finish): string {
  return finish ? "resumen-meta-" + finishKey(finish) + ".json" : "resumen.json";
}

// Resumen de la tanda con su línea de meta (resumen.json) o, para comparar con otro móvil que la tiene en otro sitio,
// con otra (resumen-meta-<osm>-<rev>.json).
export function analyzeTanda(id: string, finishOverride?: Finish): Resumen {
  const stamp = stampOf(id);
  const meta = readMeta(id);
  const out: Resumen = Object.assign({}, stamp, {
    v: RESUMEN_V,
    calculado: new Date().toISOString(),
  });
  const finish = finishOverride || finishOf(meta);
  try {
    const data = filesOf(id);
    if (!data) throw new Error("Sin datos todavía.");
    const session = sessionFromCsv(data.files);
    const a = analyze(session, { finish });
    const L = session.loc.t;
    Object.assign(out, {
      duracion: L.length ? L[L.length - 1] - L[0] : 0,
      sentido: a.dir,
      inclinacion: a.leanFrom,
      mejor: a.best ? a.best.time : null,
      ideal: a.ideal,
      avisos: a.warnings,
      vueltas: a.laps.map((l) => ({
        num: l.num,
        time: Math.round(l.time * 1000) / 1000,
        valid: l.valid,
        sectors: l.sectors,
        corners: l.corners,
        leanMax: Math.round(l.leanMax * 10) / 10,
        vMax: Math.round(l.vMax * 10) / 10,
      })),
    });
  } catch (e) {
    out.error = e instanceof Error && e.message ? e.message : String(e);
  }
  writeAtomic(join(tandaDir(id), resumenFile(finishOverride)), JSON.stringify(out, null, 2) + "\n");
  return out;
}

// Una tanda cada vez, sin bloquear las subidas del móvil más de lo necesario.
const pending = new Set<string>();
let working = false;

export function queueAnalysis(id: string): void {
  pending.add(id);
  if (working) return;
  working = true;
  setTimeout(function next() {
    const nextId = pending.values().next().value;
    if (nextId === undefined) {
      working = false;
      return;
    }
    pending.delete(nextId);
    try {
      const r = analyzeTanda(nextId);
      log(
        "analizada",
        nextId,
        r.error
          ? "(" + r.error + ")"
          : (r.vueltas || []).filter((v) => v.valid).length + " vueltas",
      );
    } catch (e) {
      log("no se pudo analizar", nextId, e instanceof Error ? e.message : e);
    }
    setTimeout(next, 50);
  }, 1500);
}

// Lo que la lista cuenta de una ruta libre por un circuito: su nombre, sus vueltas (válidas o no) y la mejor; sin el
// trazado, que no le hace falta. Campo a campo, porque meta.json es lo que mandó el móvil.
function circuitoDe(c: unknown): CircuitoMeta | null {
  if (!c || typeof c !== "object") return null;
  const x = c as CircuitoMeta;
  if (typeof x.nombre !== "string") return null;
  return {
    nombre: x.nombre.slice(0, 60),
    mejor: isNum(x.mejor) ? x.mejor : null,
    vueltas: Array.isArray(x.vueltas) ? x.vueltas.map((v) => ({ valid: !!(v && v.valid) })) : [],
  };
}

// Una tanda para la lista: lo que dijo el móvil y su resumen, si está al día (si no, se pide en segundo plano).
export function summaryOf(id: string): TandaLista {
  const meta = readMeta(id);
  const stamp = stampOf(id);
  let resumen: ResumenLista | null;
  let fresh: boolean;
  if (meta && meta.tipo === "ruta") {
    // Ruta libre (cualquier carretera): no hay vueltas que analizar; el resumen es el del móvil.
    resumen = Object.assign({ tipo: "ruta" as const }, meta.recorrido || {});
    fresh = true;
  } else {
    const r = readResumen(id);
    resumen = r;
    fresh = isFresh(r, stamp);
  }
  if (!fresh && stamp.trozos) queueAnalysis(id);
  return {
    id,
    meta: meta
      ? {
          inicio: meta.inicio,
          fin: meta.fin,
          estado: meta.estado,
          sim: meta.sim,
          tipo: meta.tipo === "ruta" ? "ruta" : "pista",
          // De dónde vienen los datos: el móvil (por defecto) o un vídeo de GoPro importado en el Mac.
          fuente: meta.fuente === "gopro" ? "gopro" : "movil",
          piloto: typeof meta.piloto === "string" ? meta.piloto.slice(0, 30) : null,
          objetivo: isNum(meta.objetivo) ? meta.objetivo : null,
          sentido: meta.sentido,
          mejor: meta.mejor,
          vueltas: (meta.vueltas || []).length,
          // Para la etiqueta del estado: la ruta libre por un circuito (nombre, vueltas y la mejor) y el receptor GPS
          // externo (a cuántos Hz).
          circuito: circuitoDe(meta.circuito),
          gps: meta.gps && isNum(meta.gps.hz) ? { hz: meta.gps.hz } : null,
        }
      : null,
    trozos: stamp.trozos,
    bytes: stamp.bytes,
    resumen: fresh ? resumen : null,
    analizando: !fresh && stamp.trozos > 0,
  };
}
