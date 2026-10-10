// La prueba de sensores de la app de antes (sensorMotion, sensorFix, sensorZero y renderSensors de live.js) con sus
// relojes y su pantalla de mentira, para comparar con la nueva lectura a lectura. Su telemetría, la de antes
// (telemetry.js). Y las lecturas de las pruebas de la batería (tsens): girar como un volante, plano en horizontal, quieto
// sobre la mesa con sesgo del giroscopio.
import type { MotionReading } from "../src/runtime/sensor-test-state";
import { liveFunctions } from "./legacy";
import { legacyMaspalomas } from "./legacy-maspalomas";

export interface Clock {
  perf: number;
  date: number;
  angle: number;
}

// Lo que la de antes escribía en la pantalla: textos, clases y el giro del nivel, por id.
export interface Painted {
  text: Record<string, string>;
  cls: Record<string, string>;
  transform: string;
}

interface OldFns {
  sensorMotion(ev: MotionReading): void;
  sensorFix(pos: unknown): void;
  sensorZero(): void;
  renderSensors(): void;
  mountText(m: unknown): string;
}

export interface OldSensors {
  // El estado de antes (el mismo objeto que cambian sus funciones).
  S: Record<string, unknown>;
  fns: OldFns;
  painted: Painted;
}

export const BLOCK_TEXT = "bloqueados";

export function oldSensors(clock: Clock, opts: { motionDenied?: boolean; prior?: number } = {}) {
  const T = legacyMaspalomas().telemetry as unknown as {
    GyroAxes: new (prior: number) => unknown;
  };
  const painted: Painted = { text: {}, cls: {}, transform: "" };
  // Cada id de la pantalla, con lo que se le escriba.
  const els: Record<
    string,
    { textContent: string; className: string; style: { transform: string } }
  > = {};
  const $ = (id: string) => {
    if (!els[id]) {
      const el = {
        style: {
          set transform(v: string) {
            painted.transform = v;
          },
          get transform() {
            return painted.transform;
          },
        },
        get textContent() {
          return painted.text[id] ?? "";
        },
        set textContent(v: string) {
          painted.text[id] = v;
        },
        get className() {
          return painted.cls[id] ?? "";
        },
        set className(v: string) {
          painted.cls[id] = v;
        },
      };
      els[id] = el;
    }
    return els[id];
  };
  const S: Record<string, unknown> = {
    times: [],
    fixes: [],
    grav: null,
    lin: null,
    ref: null,
    leanG: NaN,
    leanW: 0,
    stillSince: null,
    gbias: [0, 0, 0],
    biasKey: null,
    stillG: 0,
    swing: 0,
    diff: 0,
    pitch: NaN,
    rot: NaN,
    hasGyro: false,
    last: null,
    speed: NaN,
    speedFrom: "",
    acc: NaN,
    lag: NaN,
    prevPos: null,
    gpsErr: "",
    started: clock.date,
    motionDenied: !!opts.motionDenied,
    axes: new T.GyroAxes(opts.prior || 0),
  };
  const fns = liveFunctions<OldFns>(
    [
      "fmt",
      "setText",
      "setCls",
      "mountText",
      "sensorRef",
      "sensorMotion",
      "sensorFix",
      "sensorZero",
      "note",
      "renderSensors",
    ],
    {
      consts: ["NF", "G", "dot3"],
      globals: {
        $,
        sensor: S,
        T: legacyMaspalomas().telemetry,
        screenAngle: () => clock.angle,
        markMotion: () => {},
        sensorBlockText: () => BLOCK_TEXT,
        performance: { now: () => clock.perf },
        Date: { now: () => clock.date },
      },
    },
  );
  return { S, fns, painted } as OldSensors;
}

// ---------- lecturas ----------
export interface Timed {
  dt: number;
  ev: MotionReading;
}

const G = 9.81;

function reading(
  g: [number, number, number],
  w: [number, number, number] | null,
  lin: [number, number, number] | null = [0, 0, 0],
): MotionReading {
  return {
    accelerationIncludingGravity: { x: g[0], y: g[1], z: g[2] },
    acceleration: lin ? { x: lin[0], y: lin[1], z: lin[2] } : null,
    rotationRate: w ? { alpha: w[0], beta: w[1], gamma: w[2] } : null,
  };
}

// Móvil de pie girando como un volante hasta 45° y vuelta, a 60 Hz; gain: lo que marca el giroscopio (1 bueno, 0,5 malo).
export function wheel(gain: number): Timed[] {
  const out: Timed[] = [];
  let th = 0;
  for (let i = 0; i < 180; i++) {
    const target = 45 * Math.sin((Math.PI * i) / 90);
    const w = (target - th) * 60;
    th = target;
    const r = (th * Math.PI) / 180;
    out.push({ dt: 16, ev: reading([G * Math.sin(r), G * Math.cos(r), 0.3], [0, 0, w * gain]) });
  }
  return out;
}

// Móvil plano (pantalla en horizontal): quieto y luego tumbando hasta `lean` y vuelta.
export function flat(lean: number): Timed[] {
  const out: Timed[] = [];
  let th = 0;
  for (let i = 0; i < 300; i++) {
    const target = i < 120 ? 0 : lean * Math.sin((Math.PI * (i - 120)) / 90);
    const w = (target - th) * 60;
    th = target;
    const r = (th * Math.PI) / 180;
    out.push({ dt: 16, ev: reading([0, G * Math.sin(r), G * Math.cos(r)], [w, 0, 0]) });
  }
  return out;
}

// Sobre la mesa, quieto 10 s, con un giroscopio con 2 °/s de sesgo en el eje adelante.
export function table(): Timed[] {
  const out: Timed[] = [];
  for (let i = 0; i < 600; i++)
    out.push({
      dt: 16,
      ev: reading(
        [0.02 * Math.sin(i), 0.02 * Math.cos(i * 1.3), G],
        [2 + 0.3 * Math.sin(i * 0.7), 0.2 * Math.cos(i), 0],
      ),
    });
  return out;
}

// Sin giroscopio ni aceleración separada (solo la total), a 20 Hz y de pie: luego apuntando al cielo.
export function plain(): Timed[] {
  const out: Timed[] = [];
  for (let i = 0; i < 80; i++) out.push({ dt: 50, ev: reading([0.3, G, 0.5], null, null) });
  for (let i = 0; i < 20; i++) out.push({ dt: 50, ev: reading([0, 0.2, G], null, null) });
  return out;
}
