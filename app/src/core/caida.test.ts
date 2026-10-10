import { describe, expect, it } from "vitest";
import { recordingSamples, scene, type Sample, type Scene } from "../../test/fixtures-imu";
import { REAL_FILES, realRecording } from "../../test/fixtures-recording";
import { legacy } from "../../test/legacy";
import * as C from "./caida";

// La app de antes, tal cual (caida.js de la raíz del repo).
const old = legacy<typeof C>("MaspaCaida", "caida.js");

// Todo lo que lleva dentro el aviso (también lo privado), copiado: para comparar el de antes y el nuevo paso a paso.
type State = Record<string, unknown>;
function snapshot(det: object): State {
  return structuredClone(det) as State;
}

interface TraceOptions {
  up?: number[] | null;
  // Cada cuántas muestras se copia el estado (además de en cada fijo).
  every?: number;
  // «Estoy bien» a los tantos s de saltar (con el t de esa muestra, o sin él: el de la última recibida).
  dismissAfter?: number;
  dismissWithT?: boolean;
}

// Muestra a muestra: las caídas que salta (con el número de muestra) y el estado.
function trace(det: C.CrashDetector, samples: Sample[], opts: TraceOptions = {}) {
  const every = opts.every ?? 10;
  const events: { i: number; ev: C.CrashEvent }[] = [];
  const snaps: State[] = [];
  let dismissAt: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (dismissAt !== null && s.t >= dismissAt) {
      det.dismiss(opts.dismissWithT ? s.t : undefined);
      dismissAt = null;
      snaps.push(snapshot(det));
    }
    const ev = s.kind === "motion" ? det.motion(s.t, s.lin, s.grav, opts.up) : det.fix(s.t, s.v);
    if (ev) {
      events.push({ i, ev });
      if (opts.dismissAfter !== undefined) dismissAt = s.t + opts.dismissAfter;
    }
    if (s.kind === "fix" || i % every === 0) snaps.push(snapshot(det));
  }
  return { events, snaps };
}

function both(
  samples: Sample[],
  opts: TraceOptions = {},
  detOpts?: Partial<C.CrashOptions> | null,
  before?: (det: C.CrashDetector) => void,
) {
  const mineDet = new C.CrashDetector(detOpts);
  const oldDet = new old.CrashDetector(detOpts);
  before?.(mineDet);
  before?.(oldDet);
  const mine = trace(mineDet, samples, opts);
  const theirs = trace(oldDet, samples, opts);
  expect(mine.events).toEqual(theirs.events);
  expect(mine.snaps).toEqual(theirs.snaps);
  return mine;
}

// Rodando a 15 m/s (54 km/h) por curvas a los dos lados, y en t = 30 s lo que diga la escena.
const ride15: [number, number][] = [
  [0, 0],
  [4, 15],
  [30, 15],
];
const crashScene = (extra: Partial<Scene> = {}): Scene => ({
  speed: [...ride15, [31.5, 0], [60, 0]],
  lean: [
    [0, 0],
    [30.1, 0],
    [30.7, 80],
  ],
  impacts: [[30.05, 4.6]],
  tEnd: 60,
  ...extra,
});
const UP = [0, 0.6, 0.8];
const candOf = (s: State) => s.cand as C.CrashCandidate | null;

describe("aviso de caída (igual que el de antes)", () => {
  it("golpe, parada y tumbada: salta igual", () => {
    const r = both(scene(crashScene()));
    expect(r.events).toHaveLength(1);
    expect(r.events[0].ev.por).toBe("golpe");
    expect(r.events[0].ev.tumbada).toBeGreaterThan(55);
  });

  it("dos golpes seguidos (el segundo, más fuerte, dentro y fuera de los 2 s): igual", () => {
    for (const impacts of [
      [
        [30.05, 4],
        [31, 5.5],
      ],
      [
        [30.05, 4],
        [33, 5],
      ],
    ] as [number, number][][]) {
      const r = both(scene(crashScene({ impacts })));
      expect(r.events).toHaveLength(1);
    }
  });

  it("frenazo hasta parar y tumbada: igual", () => {
    const r = both(
      scene({
        speed: [...ride15, [32, 0], [60, 0]],
        lean: [
          [0, 0],
          [31.5, 0],
          [32.2, 75],
        ],
        tEnd: 60,
      }),
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].ev.por).toBe("frenazo");
    expect(r.events[0].ev.g).toBeNull();
  });

  it("frenada de emergencia con la moto derecha: no salta, igual", () => {
    const r = both(scene({ speed: [...ride15, [32, 0], [60, 0]], tEnd: 60 }));
    expect(r.events).toHaveLength(0);
    // Hubo candidata (y caducó a los 20 s).
    expect(r.snaps.some((s) => candOf(s)?.por === "frenazo")).toBe(true);
    expect(candOf(r.snaps[r.snaps.length - 1])).toBeNull();
  });

  it("golpe de más de 6 g sin tumbar (el móvil, plano en el suelo): salta igual", () => {
    const r = both(
      scene(
        crashScene({
          impacts: [[30.05, 7.5]],
          lean: [
            [0, 0],
            [30.1, 0],
            [30.6, 37],
          ],
        }),
      ),
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].ev.tumbada).toBeLessThan(55);
  });

  it("un bache rodando: no salta, igual", () => {
    const r = both(
      scene({
        speed: [
          [0, 0],
          [4, 15],
          [60, 15],
        ],
        impacts: [[20.05, 4.2]],
        tEnd: 60,
      }),
    );
    expect(r.events).toHaveLength(0);
    expect(r.snaps.some((s) => candOf(s)?.por === "golpe")).toBe(true);
  });

  it("el móvil que se cae con la moto parada: no salta, igual (con y sin vertical calibrada)", () => {
    const s = scene({
      speed: [[0, 0]],
      lean: [
        [0, 0],
        [10.1, 0],
        [10.5, 90],
      ],
      impacts: [[10.05, 5]],
      tEnd: 30,
    });
    expect(both(s).events).toHaveLength(0);
    const r = both(s, { up: UP });
    expect(r.events).toHaveLength(0);
    expect(r.snaps.some((x) => (x.angle as number) > 80)).toBe(true);
  });

  it("aparcada en la pata de cabra (~12°): no salta, igual", () => {
    const r = both(
      scene({
        speed: [...ride15, [36, 0], [70, 0]],
        lean: [
          [0, 0],
          [40, 0],
          [41, 12],
        ],
        tEnd: 70,
      }),
    );
    expect(r.events).toHaveLength(0);
  });

  it("el GPS calla tras la caída: la parada sale del móvil quieto, igual", () => {
    for (const hz of [50, 100]) {
      const samples = scene(crashScene({ gpsOff: [[30.5, 60]], hz }));
      const r = both(samples);
      expect(r.events).toHaveLength(1);
      expect(samples[r.events[0].i].kind).toBe("motion");
    }
  });

  it("con la vertical calibrada (y una que no vale): igual", () => {
    expect(both(scene(crashScene()), { up: UP }).events).toHaveLength(1);
    expect(both(scene(crashScene()), { up: [0, 0, 0] }).events).toHaveLength(1);
  });

  it("«Estoy bien»: un minuto sin avisar y luego otra vez, igual (con y sin la hora)", () => {
    const crash = (t: number): [number, number][] => [
      [t + 0.1, 0],
      [t + 0.7, 80],
      [t + 10, 80],
      [t + 11, 0],
    ];
    const s = scene({
      speed: [
        ...ride15,
        [31.5, 0],
        [45, 0],
        [49, 15],
        [75, 15],
        [76.5, 0],
        [95, 0],
        [99, 15],
        [130, 15],
        [131.5, 0],
        [160, 0],
      ],
      lean: [[0, 0], ...crash(30), ...crash(75), ...crash(130)],
      impacts: [
        [30.05, 4.6],
        [75.05, 4.6],
        [130.05, 4.6],
      ],
      tEnd: 160,
    });
    for (const dismissWithT of [true, false]) {
      const r = both(s, { dismissAfter: 3, dismissWithT });
      // La segunda caída, dentro del minuto, no avisa.
      expect(r.events.map((e) => Math.floor(e.ev.t0))).toEqual([30, 130]);
    }
  });

  it("«Estoy bien» antes de ninguna muestra, y con otros ajustes: igual", () => {
    expect(both(scene(crashScene()), {}, null, (d) => d.dismiss()).events).toHaveLength(1);
    // Callado hasta t = 65: la caída de t = 30 no avisa.
    expect(both(scene(crashScene()), {}, null, (d) => d.dismiss(5)).events).toHaveLength(0);
    expect(both(scene(crashScene()), {}, { stopS: 2, lieS: 1 }).events).toHaveLength(1);
    // El golpe de 4,6 g ya no cuenta, pero parar de 54 km/h en 1,5 s es un frenazo.
    const r = both(scene(crashScene()), {}, { impactG: 5 });
    expect(r.events.map((e) => e.ev.por)).toEqual(["frenazo"]);
  });

  it("los ajustes de siempre", () => {
    expect(C.DEFAULTS).toEqual(old.DEFAULTS);
    expect(new C.CrashDetector().o).toEqual(new old.CrashDetector().o);
    expect(new C.CrashDetector().vMaxSince(0)).toBe(0);
  });

  // Rutas de verdad (sin caídas): golpes y candidatas que no llegan a nada; con umbrales más sensibles, alguna salta.
  const sensitive = {
    impactG: 1.6,
    hardG: 2.2,
    vBefore: 4,
    vBrake: 6,
    lieDeg: 25,
    lieS: 1,
    stopS: 2,
  };
  const recs = REAL_FILES.map((file) => ({ file, rec: realRecording(file) }));
  for (const { file, rec } of recs) {
    if (!rec) {
      it.skip(file + " de verdad: sin PISTA_DATA en este ordenador", () => {});
      continue;
    }
    it(file + " de verdad: muestra a muestra, igual", () => {
      const samples = recordingSamples(rec);
      const runs: [TraceOptions, Partial<C.CrashOptions> | null][] = [
        [{ every: 50 }, null],
        [{ every: 50, up: rec.meta.calibracionManual ?? null }, null],
        [{ every: 50 }, sensitive],
      ];
      for (const [opts, detOpts] of runs) {
        const r = both(samples, opts, detOpts);
        // Con GPS, rodando hay golpes que dejan candidatas (y no llegan a nada).
        if (rec.series.loc) expect(r.snaps.some((s) => candOf(s) !== null)).toBe(true);
      }
    });
  }
  const available = recs.filter((r) => r.rec);
  if (available.length)
    it("con umbrales sensibles, alguna ruta de verdad da una caída", () => {
      const fired = available.some(({ rec }) => {
        const det = new C.CrashDetector(sensitive);
        return rec && trace(det, recordingSamples(rec), { every: 1e9 }).events.length > 0;
      });
      expect(fired).toBe(true);
    });
});
