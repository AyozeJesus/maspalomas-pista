// La prueba de sensores calcula lo mismo que la de antes (live.js), lectura a lectura: las dos inclinaciones, el morro,
// la postura de referencia, el sesgo del giroscopio y el GPS; y la pantalla dice lo mismo (sensorReadout frente a su
// renderSensors). Con las lecturas de la batería (tsens) y otras que ella no tiene.
import { describe, expect, it } from "vitest";
import {
  BLOCK_TEXT,
  flat,
  oldSensors,
  plain,
  table,
  wheel,
  type Clock,
  type OldSensors,
  type Timed,
} from "../../test/legacy-sensors";
import { sensorReadout } from "../ui/screens/sensores/sensor-readout";
import {
  newSensorState,
  sensorFix,
  sensorMotion,
  sensorZero,
  type FixReading,
  type SensorState,
} from "./sensor-test-state";

const KEYS = [
  "leanG",
  "leanW",
  "pitch",
  "swing",
  "diff",
  "maxDiff",
  "stillG",
  "stillSince",
  "rot",
  "hasGyro",
  "gbias",
  "biasKey",
  "grav",
  "lin",
  "gravS",
  "gravN",
  "times",
  "fixes",
  "speed",
  "speedFrom",
  "acc",
  "lag",
  "prevPos",
  "gpsErr",
] as const;

// Lo que se compara de un estado (de antes o nuevo), con la referencia y los ejes del giroscopio.
function digest(S: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) out[k] = S[k] === undefined ? null : S[k];
  // La de antes los creaba al primer uso (sin valor, contaban como 0).
  out.maxDiff = S.maxDiff ?? 0;
  out.gravN = S.gravN ?? 0;
  const ref = S.ref as Record<string, unknown> | null;
  out.ref = ref
    ? {
        f: Array.from(ref.f as number[]),
        u: Array.from(ref.u as number[]),
        l: Array.from(ref.l as number[]),
        tilt: ref.tilt,
        posture: ref.posture,
        screen: ref.screen,
        angle: ref.angle,
      }
    : null;
  const axes = S.axes as { choice: number; sign: number; r2: number | null; checked: boolean };
  out.axes = [axes.choice, axes.sign, axes.r2, axes.checked];
  return JSON.parse(JSON.stringify(out));
}

interface Pair {
  clock: Clock;
  old: OldSensors;
  S: SensorState;
}

function pair(opts: { motionDenied?: boolean; prior?: number } = {}): Pair {
  const clock: Clock = { perf: 1000, date: 1.79e12, angle: 0 };
  return {
    clock,
    old: oldSensors(clock, opts),
    S: newSensorState(clock.date, !!opts.motionDenied, opts.prior || 0),
  };
}

function feed(p: Pair, list: readonly Timed[], each?: (i: number) => void): void {
  list.forEach((x, i) => {
    p.clock.perf += x.dt;
    p.clock.date += x.dt;
    p.old.fns.sensorMotion(x.ev);
    sensorMotion(p.S, x.ev, p.clock.perf, () => p.clock.angle);
    if (each) each(i);
  });
}

function fix(p: Pair, pos: FixReading, after: number): void {
  p.clock.perf += after;
  p.clock.date += after;
  p.old.fns.sensorFix(pos);
  sensorFix(p.S, pos, p.clock.date);
}

function zero(p: Pair): void {
  p.old.fns.sensorZero();
  sensorZero(p.S, p.clock.perf, p.clock.angle);
}

// Lo que pinta cada una: la de antes (renderSensors) y la nueva (sensorReadout).
function screens(p: Pair) {
  p.old.fns.renderSensors();
  const r = sensorReadout(p.S, p.clock.perf, p.clock.date, BLOCK_TEXT);
  // Lo no escrito nunca está vacío (como en la pantalla).
  const t = (id: string) => p.old.painted.text[id] ?? "";
  const n = (id: string) => ({ text: t(id), cls: p.old.painted.cls[id] ?? "" });
  const old = {
    tiltG: t("sen-tilt-g"),
    tiltW: t("sen-tilt-w"),
    pitch: t("sen-pitch"),
    level: p.old.painted.transform,
    mount: t("sen-mount"),
    tiltNote: n("sen-tilt-note"),
    speed: t("sen-speed"),
    acc: t("sen-acc"),
    hz: t("sen-hz"),
    lag: t("sen-lag"),
    gpsNote: n("sen-gps-note"),
    mhz: t("sen-mhz"),
    g: t("sen-g"),
    rot: t("sen-rot"),
    imuNote: n("sen-imu-note"),
  };
  return { old, mine: { ...r, level: "rotate(" + r.level + "deg)" } };
}

function same(p: Pair): void {
  expect(digest(p.S as unknown as Record<string, unknown>)).toEqual(digest(p.old.S));
  const { old, mine } = screens(p);
  expect(mine).toEqual(old);
}

const pos = (lat: number, lon: number, speed: number | null, accuracy: number, t: number) => ({
  coords: { latitude: lat, longitude: lon, speed, accuracy },
  timestamp: t,
});

describe("prueba de sensores: lo mismo que antes, lectura a lectura", () => {
  it("de pie girando como un volante (giroscopio bueno y malo)", () => {
    const p = pair();
    same(p);
    zero(p);
    feed(p, wheel(1), (i) => {
      if (i % 10 === 0) same(p);
    });
    same(p);
    expect(screens(p).mine.tiltNote.text).toMatch(/van juntos/);
    zero(p);
    feed(p, wheel(0.5), (i) => {
      if (i % 10 === 0) same(p);
    });
    same(p);
    expect(screens(p).mine.tiltNote.text).toMatch(/se separa/);
  });

  it("plano con la pantalla en horizontal, sobre la mesa con sesgo y otra vez tumbado", () => {
    const p = pair();
    p.clock.angle = 90;
    for (const list of [flat(0), flat(45), table(), flat(45)])
      feed(p, list, (i) => {
        if (i % 15 === 0) same(p);
      });
    same(p);
    expect(screens(p).mine.mount).toMatch(/plano, pantalla en horizontal/);
  });

  it("sin giroscopio ni aceleración separada, y apuntando al cielo", () => {
    const p = pair({ prior: 1 });
    feed(p, plain(), () => same(p));
  });

  it("sensores bloqueados por el navegador", () => {
    const p = pair({ motionDenied: true });
    feed(p, wheel(1).slice(0, 40));
    same(p);
    expect(screens(p).mine.tiltNote).toEqual({ text: BLOCK_TEXT, cls: "muted note-bad" });
  });

  it("el GPS: sin señal, con velocidad, sin ella (por las posiciones), poco preciso, perdido y lento", () => {
    const p = pair();
    same(p);
    let t = p.clock.date - 300;
    for (let k = 0; k < 6; k++) {
      t += 1000;
      fix(p, pos(27.77 + k * 1e-4, -15.52, 12.5, 4, t), 1000);
      same(p);
    }
    // Sin velocidad: con las posiciones.
    for (let k = 0; k < 3; k++) {
      t += 1000;
      fix(p, pos(27.771 + k * 2e-4, -15.52, null, 9, t), 1000);
      same(p);
    }
    // Poco preciso.
    t += 1000;
    fix(p, pos(27.772, -15.52, 3, 22, t), 1000);
    same(p);
    // Perdido (más de 10 s sin nada).
    p.clock.perf += 12000;
    p.clock.date += 12000;
    same(p);
    // Lento (una cada 5 s) y con algo de precisión baja.
    for (let k = 0; k < 4; k++) {
      t += 5000;
      fix(p, pos(27.773, -15.52, 0, 12, t), 5000);
      same(p);
    }
    expect(screens(p).mine.gpsNote.text).toMatch(/^Menos de una posición por segundo \(bajo techo/);
    p.old.S.gpsErr = "GPS sin señal todavía…";
    p.S.gpsErr = "GPS sin señal todavía…";
    same(p);
  });

  it("«Calibrar» sin ningún dato todavía, y el aviso de calibrado unos segundos", () => {
    const p = pair();
    zero(p);
    same(p);
    feed(p, flat(0).slice(0, 60));
    zero(p);
    same(p);
    expect(screens(p).mine.tiltNote.text).toMatch(/^Calibrado: así es 0°\. /);
    p.clock.perf += 3500;
    same(p);
  });
});
