// Repasar una grabación. Lo que se cuenta de una ruta o tanda guardada (el resumen al terminar, «Ver», la línea de la
// lista y la imagen para compartir) sale siempre de repasar su grabación con el mismo motor que en directo, deprisa,
// sin grabar, sin subir y sin avisos: así dicen todos lo mismo. En directo el fijo del GPS llega tarde y el motor lo ve
// después de los sensores de ese rato: sus números cambiaban algo (una frenada máxima de 0,75 g al terminar era de
// 0,59 g al abrirla luego). Mismo dato, mismo orden: mismo resultado, en cualquier móvil y como sea que esté girado.
import type { MergedSeriesSet } from "../core/formato";
import { applyCircuit } from "./circuit";
import { createEngine } from "./create";
import { onMotion } from "./motion";
import type { Engine, EngineHost, ViewingMeta } from "./state";
import { onFix } from "./track";
import { tramoFlush } from "./tramos";
import { norm3 } from "./vec";

export type ReplayMeta = ViewingMeta;

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

// stop(): true para pararlo (Cancelar, o se ha echado a rodar). Devuelve el motor con todo repasado.
export async function replayRecording(
  host: EngineHost,
  meta: ReplayMeta,
  S: MergedSeriesSet,
  stop: () => boolean,
  onProgress?: (f: number) => void,
  pause: () => Promise<void> = yieldNow,
): Promise<Engine> {
  const L = S.loc;
  if (!L) throw new Error("sin posiciones");
  const eng = createEngine(host, true, meta.tipo === "ruta");
  eng.t0 = 0;
  eng.viewing = meta;
  eng.viewEpoch = meta.epoch || null;
  eng.crash = null;
  eng.circTryAt = Infinity;
  eng.orientTried = true;
  eng.segment = meta.segmento && meta.segmento > 1 ? meta.segmento : 1;
  eng.crashLog = Array.isArray(meta.caidas) ? meta.caidas.slice() : [];
  // El giro de la pantalla de cuando se grabó, nunca el de ahora.
  eng.screenAngle =
    meta.montaje && Number.isFinite(meta.montaje.angulo)
      ? (meta.montaje.angulo as number)
      : Number.isFinite(meta.anguloPantalla)
        ? (meta.anguloPantalla as number)
        : 0;
  if (Array.isArray(meta.calibracionManual)) {
    eng.calib.manualU = norm3(meta.calibracionManual);
    eng.calib.manualVer++;
  }
  const A = S.acc;
  const G = S.grav;
  const W = S.gyro;
  const nA = A && G && W ? Math.min(A.t.length, G.t.length, W.t.length) : 0;
  // Grabaciones de antes de unificar los relojes: si los sensores empiezan lejos del GPS, se alinean.
  const shift = nA && A && Math.abs(A.t[0] - L.t[0]) > 60 ? L.t[0] - A.t[0] : 0;
  const total = nA + L.t.length;
  let iL = 0;
  let i = 0;
  let flushed = false;
  const feedFixes = (upTo: number) => {
    while (iL < L.t.length && L.t[iL] <= upTo) {
      eng.simT = L.t[iL];
      onFix(eng, L.t[iL], L.lat[iL], L.lon[iL], L.speed[iL] >= 0 ? L.speed[iL] : null, L.hacc[iL]);
      iL++;
    }
  };
  // Un trozo seguido: hasta 40 ms o 5.000 muestras.
  const batch = () => {
    // Ruta libre por un circuito: el suyo desde el principio (las vueltas salen igual que en directo).
    const c = meta.circuito;
    if (i === 0 && iL === 0 && eng.free && c && c.trazado)
      applyCircuit(eng, c.trazado, c.sentido === "inverso", !!c.guardado, c.forzadas);
    const tStart = performance.now();
    const i0 = i;
    if (A && G && W)
      while (i < nA) {
        const t = A.t[i] + shift;
        feedFixes(t);
        eng.simT = t;
        onMotion(
          eng,
          t,
          [A.x[i], A.y[i], A.z[i]],
          [G.x[i], G.y[i], G.z[i]],
          [W.x[i], W.y[i], W.z[i]],
        );
        i++;
        if (i - i0 >= 5000 || ((i & 255) === 0 && performance.now() - tStart > 40)) break;
      }
    if (i >= nA) {
      feedFixes(Infinity);
      if (eng.free && !flushed) {
        flushed = true;
        tramoFlush(eng, eng.simT);
      }
    }
  };
  for (;;) {
    if (stop()) throw new Error("cancelado");
    batch();
    if (onProgress) onProgress((i + iL) / Math.max(1, total));
    if (i >= nA && iL >= L.t.length) break;
    await pause();
  }
  return eng;
}
