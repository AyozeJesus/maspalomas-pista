// Lo que enseña la prueba de sensores en cada repaso (cada 100 ms): las dos inclinaciones (+ a derechas, como en la
// moto), el morro, la postura del móvil, el GPS y las lecturas por segundo, cada cosa con su nota (bien, mal o qué
// hacer).
import { fmt } from "../../../lib/format";
import { G } from "../../../engine/vec";
import type { SensorRef, SensorState } from "../../../runtime/sensor-test-state";

// Una nota con su clase («muted», «muted note-bad» o «muted note-ok»).
export interface Note {
  text: string;
  cls: string;
}

export interface SensorReadout {
  tiltG: string;
  tiltW: string;
  pitch: string;
  // Giro del nivel (grados).
  level: number;
  mount: string;
  tiltNote: Note;
  speed: string;
  acc: string;
  hz: string;
  lag: string;
  gpsNote: Note;
  mhz: string;
  g: string;
  rot: string;
  imuNote: Note;
}

const note = (text: string, cls?: string): Note => ({
  text,
  cls: "muted" + (cls ? " " + cls : ""),
});

// «Móvil plano, pantalla en horizontal: hacia delante, la parte de arriba de la pantalla».
export function mountText(m: Pick<SensorRef, "posture" | "screen">): string {
  return (
    "Móvil " +
    m.posture +
    ", pantalla en " +
    m.screen +
    ": hacia delante, " +
    (m.posture === "de pie"
      ? "la espalda del móvil."
      : m.posture === "plano"
        ? "la parte de arriba de la pantalla."
        : "la parte de arriba de la pantalla (y la espalda del móvil).")
  );
}

// «12° der.», «0°».
const side = (deg: number) =>
  Math.abs(deg) < 1 ? "0°" : fmt(Math.abs(deg), 0) + "° " + (deg > 0 ? "der." : "izq.");

// Lecturas por segundo de una lista de horas (ms), o null con menos de dos.
function rate(ts: readonly number[]): number | null {
  return ts.length > 1 ? (ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000) : null;
}

function tiltNote(S: SensorState, perfNow: number, blockText: string): Note {
  const ref = S.ref;
  if (S.motionDenied) return note(blockText, "note-bad");
  if (!S.grav || !ref) return note("Esperando a los sensores…");
  if (!Number.isFinite(S.leanG))
    return note(
      "Así no se puede medir: el móvil apunta hacia el cielo o hacia el suelo. Colócalo como irá en la moto y pulsa «Calibrar».",
    );
  if (!S.hasGyro)
    return note("Este móvil no tiene giroscopio: no habrá inclinación en la moto.", "note-bad");
  // Girado a mano el móvil también cabecea, y eso separa algo las dos medidas (hasta 9° medido en un Pixel 10 Pro con
  // giroscopio bueno). Un giroscopio malo o «virtual» se separa mucho más.
  if (S.swing > 30 && S.maxDiff > Math.max(15, 0.25 * S.swing))
    return note(
      "El giroscopio se separa de la gravedad (hasta " +
        fmt(S.maxDiff, 0) +
        "°): puede ser un giroscopio poco fiable.",
      "note-bad",
    );
  if (S.swing > 30)
    return note(
      "Giroscopio y gravedad van juntos: bien." +
        (S.axes.checked
          ? " Ejes comprobados (" + fmt((S.axes.r2 ?? 0) * 100, 0) + " % de acuerdo)."
          : ""),
      "note-ok",
    );
  return note(
    (S.zeroAt && perfNow - S.zeroAt < 3000 ? "Calibrado: así es 0°. " : "") +
      (ref.posture === "plano"
        ? "Inclínalo a un lado y a otro como tumbaría la moto (girando sobre el eje que apunta hacia delante), unos 45°."
        : "Gíralo como un volante, a un lado y a otro, unos 45°."),
  );
}

function gpsNote(S: SensorState, hz: number | null, now: number): Note {
  // Bajo techo llega una posición cada 5–6 s: perdida solo si pasan más de 10 s sin ninguna.
  const fresh = S.fixes.length && now - S.fixes[S.fixes.length - 1] < 10000;
  if (S.gpsErr) return note(S.gpsErr, "note-bad");
  if (!S.fixes.length) return note("Buscando señal… (mejor al aire libre)");
  if (!fresh) return note("Se ha perdido la señal.", "note-bad");
  if (S.acc > 15)
    return note("Precisión baja: al aire libre y lejos de edificios mejora.", "note-bad");
  // En casa o bajo techo el móvil da una posición cada varios segundos (medido: cada 5–6 s en un Pixel 10 Pro).
  if (now - S.started > 10000 && (hz === null || hz < 0.8))
    return note(
      "Menos de una posición por segundo" +
        (S.acc > 10 ? " (bajo techo es normal: prueba al aire libre)" : "") +
        ". Al aire libre, si sigue igual, activa «Forzar mediciones GNSS completas» en Opciones para desarrolladores.",
      "note-bad",
    );
  return S.speedFrom === "posiciones"
    ? note("Este GPS no da la velocidad: la calculo con las posiciones (menos fina).")
    : note("GPS bien.", "note-ok");
}

function imuNote(S: SensorState, mhz: number | null): Note {
  if (!S.grav) return note("");
  if (mhz !== null && mhz < 30)
    return note(
      "Pocas lecturas por segundo (" +
        fmt(mhz, 0) +
        "): la frenada y la inclinación saldrán más bastas.",
      "note-bad",
    );
  if (!S.lin)
    return note("Sin aceleración separada de la gravedad: la calculo con un filtro (menos fina).");
  return note("Sensores bien.", "note-ok");
}

// perfNow: performance.now(); now: Date.now(); blockText: qué hacer si el navegador bloquea los sensores.
export function sensorReadout(
  S: SensorState,
  perfNow: number,
  now: number,
  blockText: string,
): SensorReadout {
  const ref = S.ref;
  const hz = rate(S.fixes);
  const mhz = rate(S.times);
  return {
    tiltG: Number.isFinite(S.leanG) ? side(S.leanG) : "—",
    tiltW: S.hasGyro && ref ? side(((S.leanW + 540) % 360) - 180) : "—",
    pitch:
      ref && Number.isFinite(S.pitch)
        ? fmt(Math.abs(S.pitch), 0) +
          "°" +
          (Math.abs(S.pitch) < 1 ? "" : S.pitch > 0 ? " arriba" : " abajo")
        : "—",
    level: Number.isFinite(S.leanG) ? S.leanG : 0,
    mount: ref ? mountText(ref) : "",
    tiltNote: tiltNote(S, perfNow, blockText),
    speed: Number.isFinite(S.speed) ? fmt(S.speed * 3.6, 0) + " km/h" : "—",
    acc: Number.isFinite(S.acc) ? "±" + fmt(S.acc, 0) + " m" : "—",
    hz: hz ? fmt(hz, 1) : "—",
    lag: Number.isFinite(S.lag) ? fmt(S.lag / 1000, 1) + " s" : "—",
    gpsNote: gpsNote(S, hz, now),
    mhz: mhz ? fmt(mhz, 0) : "—",
    g: S.lin ? fmt(Math.hypot(S.lin[0], S.lin[1], S.lin[2]) / G, 2) + " g" : "—",
    rot: S.hasGyro && Number.isFinite(S.rot) ? fmt(S.rot, 0) + " °/s" : "—",
    imuNote: imuNote(S, mhz),
  };
}
