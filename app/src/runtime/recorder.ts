// Grabación en el móvil: lo que mide el motor se guarda cada 10 s en trozos (IndexedDB, y de ahí al garaje del Mac) y,
// con cada cosa que pasa, el resumen de la grabación (vueltas, ruta, caídas…). Mismo formato que siempre: el garaje y
// las grabaciones ya guardadas lo entienden igual.
import { compact } from "../core/circuito";
import { VERSION, type Chunk, type StoredSeriesSet } from "../core/formato";
import { nowOf, sessionBest, type Engine } from "../engine";
import { target } from "../engine/settings";
import type { PistaStore } from "../storage";

export const APP_VERSION = 2;
export const REC_EVERY = 10; // segundos entre trozos guardados en el móvil

export function newRecId(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    "-" +
    rnd
  );
}

export function createRecorder(store: PistaStore | null) {
  function start(E: Engine, epochMs: number): void {
    if (!store) return;
    E.rec = {
      id: newRecId(),
      epoch: epochMs,
      seq: 0,
      idx: { loc: 0, acc: 0, gyro: 0, grav: 0, canal: 0 },
      lastT: 0,
      saved: 0,
      failed: false,
      queue: Promise.resolve(),
    };
    saveMeta(E, "grabando");
    store.closeStale(E.rec.id).catch(() => {});
  }

  // Guarda en el móvil lo grabado desde el último trozo (cada REC_EVERY s, o ya si `force`).
  function flush(E: Engine | null, force: boolean): void {
    if (!E || !E.rec || !store) return;
    const R = E.rec;
    const t = nowOf(E);
    if (!force && t - R.lastT < REC_EVERY) return;
    R.lastT = t;
    const series: StoredSeriesSet = {};
    let any = false;
    for (const key of ["loc", "acc", "gyro", "grav", "canal"] as const) {
      const s = E[key];
      const i0 = R.idx[key];
      if (s.n <= i0) continue;
      // Como siempre: columnas Float64Array en IndexedDB (al subirlas al Mac se pasan a listas, cleanChunk).
      const o: Record<string, Float64Array> = {};
      for (const c of s.cols) o[c] = s.d[c as keyof typeof s.d].slice(i0, s.n);
      (series as Record<string, unknown>)[key] = o;
      R.idx[key] = s.n;
      any = true;
    }
    if (!any) return;
    const chunk: Chunk = { v: VERSION, id: R.id, seq: R.seq++, epoch: R.epoch, series };
    const st = store;
    R.queue = R.queue
      .then(() => st.putChunk(chunk))
      .then(
        () => {
          R.saved++;
        },
        () => {
          R.failed = true;
        },
      );
  }

  function saveMeta(E: Engine | null, estado: "grabando" | "terminada"): void {
    if (!E || !E.rec || !store) return;
    const R = E.rec;
    const meta = buildMeta(E, estado);
    const st = store;
    R.queue = R.queue
      .then(() => st.putSession(meta))
      .catch(() => {
        R.failed = true;
      });
  }

  return { start, flush, saveMeta };
}

export type Recorder = ReturnType<typeof createRecorder>;

// El resumen de una grabación (lo que va a la lista y al garaje).
export function buildMeta(E: Engine, estado: "grabando" | "terminada") {
  const R = E.rec;
  if (!R) throw new Error("sin grabación");
  const settings = E.host.settings;
  return {
    v: VERSION,
    id: R.id,
    epoch: R.epoch,
    inicio: new Date(R.epoch).toISOString(),
    fin: estado === "grabando" ? null : new Date(E.host.wallNow()).toISOString(),
    estado,
    sim: !!E.sim,
    app: APP_VERSION,
    // «ruta»: ruta libre por cualquier carretera (sin vueltas); «pista»: el circuito.
    tipo: E.free ? "ruta" : "pista",
    recorrido: E.route.summary(),
    piloto: settings.piloto || null,
    objetivo: target(settings),
    sentido: E.dir,
    meta: settings.finish,
    // La mejor vuelta de esta tanda (E.best es la de siempre del piloto: un día sin batirla, la lista enseñaba la de
    // otro día).
    mejor: sessionBest(E),
    retrasoGps: E.lagR2 !== null ? E.lag : null,
    // Receptor GPS externo usado en la tanda ({fuente, nombre, hz}); null: solo el GPS del móvil.
    gps: E.extInfo ? { ...E.extInfo } : null,
    // Avisos de caída de la ruta libre (y si se pararon con «Estoy bien» o sonó la alarma).
    caidas: E.crashLog.length ? E.crashLog : null,
    // Ruta libre por un circuito (detectado o guardado): su nombre, largo y las vueltas.
    circuito:
      E.circ && E.circTrack
        ? {
            nombre: E.circTrack.name,
            longitud: Math.round(E.circTrack.length),
            guardado: E.circSaved,
            mejor: E.circ.best ? Math.round(E.circ.best.time * 1000) / 1000 : null,
            vueltas: E.circ.laps.map((l) => ({
              num: l.num,
              time: Math.round(l.time * 1000) / 1000,
              valid: l.valid,
            })),
            // El trazado y el sentido, para que al repasarla salgan las mismas vueltas aunque el circuito no se guardara
            // (o se borre después).
            trazado: compact(E.circTrack),
            sentido: E.circReverse ? "inverso" : "normal",
            // Circuito marcado a mano: los cruces de su primera vuelta (para repasarla igual).
            forzadas: E.circForced || null,
          }
        : null,
    // «Nuevo tramo»: el número de esta parte de la ruta (la primera, 1).
    segmento: E.segment || 1,
    // Giro de la pantalla al empezar (sin postura detectada, el repaso lo necesita igual).
    anguloPantalla: Number.isFinite(E.screenAngle) ? E.screenAngle : 0,
    calibrado: !!E.calib.f,
    // Postura del móvil al empezar (de pie / plano, pantalla vertical / horizontal) y orientación de la pantalla.
    montaje: E.mount ? { angulo: E.screenAngle, ...E.mount } : null,
    // Vertical de la moto puesta a mano con «Calibrar» (ejes del móvil), si se usó.
    calibracionManual: E.calib.manualU
      ? E.calib.manualU.map((x) => Math.round(x * 1e4) / 1e4)
      : null,
    vueltas: E.laps.map((l) => ({
      num: l.num,
      time: Math.round(l.time * 1000) / 1000,
      valid: l.valid,
      sectors: l.sectors || null,
      corners: l.corners || null,
    })),
    analisis: E.analysis,
  };
}

export type SessionMeta = ReturnType<typeof buildMeta>;
