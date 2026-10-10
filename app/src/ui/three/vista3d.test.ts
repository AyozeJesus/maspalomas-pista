// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLegacy } from "../../../test/legacy";
import {
  FakeRenderer,
  legacyVista3D,
  resourcesOf,
  summarizeCamera,
  summarizeScene,
} from "../../../test/legacy-three";
import * as V from "./vista3d";

type Frame = (P: readonly V.Vista3DPoint[], i: number) => { rx: number; ry: number; turn: number };

// MaspaAnalysis.frame de antes: las normales del trazado (como las de buildTrack) y el sentido de giro.
const frame = (loadLegacy("analysis.js").MaspaAnalysis as { frame: Frame }).frame;

const MODES: V.Vista3DMode[] = ["casco", "detras", "arriba"];

// Un circuito cerrado sintético de ~2,3 km (600 puntos a 1–6 m, con curvas a los dos lados) con lo que lee la vista:
// normales a la derecha, distancia acumulada y, si se pide, una trazada ideal que se separa hasta 5 m del eje.
function syntheticTrack(withFull: boolean): V.Vista3DTrack {
  const n = 600;
  const C = Array.from({ length: n }, (_, i): [number, number] => {
    const t = (2 * Math.PI * i) / n;
    return [400 * Math.cos(t) + 90 * Math.cos(3 * t), 230 * Math.sin(t) - 70 * Math.sin(2 * t)];
  });
  const N = C.map((_, i): [number, number] => {
    const f = frame(C, i);
    return [f.rx, f.ry];
  });
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const b = C[(i + 1) % n];
    cs[i + 1] = cs[i] + Math.hypot(b[0] - C[i][0], b[1] - C[i][1]);
  }
  const full = C.map((c, i): [number, number] => {
    const d = 5 * Math.sin((6 * Math.PI * i) / n);
    return [c[0] + N[i][0] * d, c[1] + N[i][1] * d];
  });
  return { C, N, cs, L: cs[n], full: withFull ? full : undefined };
}

const track = syntheticTrack(true);
const L = track.L;
// Curvas junto a la meta (los pianos dan la vuelta al índice), con índice decimal y sin índice (cuenta como 0).
const corners: V.Vista3DCorner[] = [
  { i: 2 },
  { i: 95.4 },
  { i: 300 },
  { i: 505.6 },
  { i: 597 },
  {},
];
const opts: V.Vista3DOptions = { corners, bounds: [L * 0.27, L * 0.61, L * 0.93, -5, L + 10] };
const brakes = [120, null, L * 0.5, undefined, L - 1, -20];

// Fotogramas: s antes de meta y pasada la vuelta, inclinación NaN, sin velocidad o parado, dt 0 o sin dt.
function poses(len: number): [V.Vista3DPose, number | undefined][] {
  return [
    [{ s: 0, lean: 0, v: 20 }, undefined],
    [{ s: 3.7, lean: 12.5, v: 31 }, 0.016],
    [{ s: 57.25, lean: -35, v: 0 }, 0.1],
    [{ s: 412.9, lean: NaN, v: 55 }, 0.033],
    [{ s: 980, lean: 48 }, 0],
    [{ s: -12.5, lean: -8, v: 80 }, 0.05],
    [{ s: len - 1.5, lean: 30, v: 12 }, 0.02],
    [{ s: len + 7, lean: -52, v: 64 }, 0.016],
  ];
}

interface FakeResizeObserver {
  callback: () => void;
  observed: unknown[];
  disconnected: number;
}

// Un ResizeObserver de mentira por vista (jsdom no lo tiene): apunta lo que observa y deja lanzar su aviso.
function resizeObservers(): {
  RO: new (callback: () => void) => FakeResizeObserver;
  made: FakeResizeObserver[];
} {
  const made: FakeResizeObserver[] = [];
  class RO implements FakeResizeObserver {
    callback: () => void;
    observed: unknown[] = [];
    disconnected = 0;
    constructor(callback: () => void) {
      this.callback = callback;
      made.push(this);
    }
    observe(target: unknown): void {
      this.observed.push(target);
    }
    disconnect(): void {
      this.disconnected++;
    }
  }
  return { RO, made };
}

interface Side {
  view: V.Vista3D;
  renderer: FakeRenderer;
  container: HTMLDivElement;
  observers: FakeResizeObserver[];
}

interface Env {
  size?: [number, number];
  dpr?: number;
  resizeObserver?: boolean;
}

function setSize(div: HTMLElement, size: [number, number]): void {
  Object.defineProperty(div, "clientWidth", { value: size[0], configurable: true });
  Object.defineProperty(div, "clientHeight", { value: size[1], configurable: true });
}

function box(env: Env): HTMLDivElement {
  const div = document.createElement("div");
  div.append(document.createElement("p"));
  if (env.size) setSize(div, env.size);
  return div;
}

// La misma vista con el código de antes y con el nuevo, cada una con su renderizador de mentira y su contenedor.
function pair(t: V.Vista3DTrack, o: V.Vista3DOptions, env: Env = {}): { mine: Side; theirs: Side } {
  const old = legacyVista3D<typeof V>();
  const mineRO = resizeObservers();
  const theirRO = resizeObservers();
  if (env.dpr !== undefined) {
    vi.stubGlobal("devicePixelRatio", env.dpr);
    old.win.devicePixelRatio = env.dpr;
  }
  if (env.resizeObserver) {
    vi.stubGlobal("ResizeObserver", mineRO.RO);
    old.win.ResizeObserver = theirRO.RO;
  }
  const made: FakeRenderer[] = [];
  const mineBox = box(env);
  const theirBox = box(env);
  const mine = V.create(mineBox, t, o, (params) => {
    const r = new FakeRenderer(params);
    made.push(r);
    return r;
  });
  const theirs = old.V.create(theirBox, t, o);
  if (!mine || !theirs) throw new Error("no se ha creado la vista");
  expect(made.length).toBe(1);
  expect(old.renderers.length).toBe(1);
  return {
    mine: { view: mine, renderer: made[0], container: mineBox, observers: mineRO.made },
    theirs: {
      view: theirs,
      renderer: old.renderers[0],
      container: theirBox,
      observers: theirRO.made,
    },
  };
}

// Todo lo que se ve de una vista: su depuración, el modo, lo pedido al renderizador, la cámara y la escena entera.
function state(side: Side) {
  const r = side.renderer;
  return {
    debug: side.view.debug(),
    mode: side.view.mode,
    pixelRatio: r.pixelRatio,
    sizes: r.sizes,
    renders: r.renders,
    camera: r.camera ? summarizeCamera(r.camera) : null,
    scene: r.scene ? summarizeScene(r.scene) : null,
  };
}

function step(
  p: { mine: Side; theirs: Side },
  pose: V.Vista3DPose,
  dt?: number,
  ghost?: V.Vista3DGhostPose | null,
): ReturnType<typeof state> {
  p.mine.view.update(pose, dt, ghost);
  p.theirs.view.update(pose, dt, ghost);
  const mine = state(p.mine);
  expect(mine, `s=${pose.s} lean=${pose.lean}`).toEqual(state(p.theirs));
  return mine;
}

// Mallas de la escena con un color de material dado.
function meshesOf(s: ReturnType<typeof state>, color: number): number {
  let count = 0;
  const walk = (n: NonNullable<typeof s.scene>["root"]): void => {
    if (n.material && n.material.color === color) count++;
    n.children.forEach(walk);
  };
  if (s.scene) walk(s.scene.root);
  return count;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vista 3D (igual que la de antes)", () => {
  it("monta la misma escena: asfalto, líneas, pianos, barreras, meta, sectores y motos", () => {
    const p = pair(track, opts, { dpr: 3 });
    // Pianos a los dos lados: hay curvas a derechas y a izquierdas.
    const turns = new Set(corners.map((c) => frame(track.C, Math.round(c.i ?? 0)).turn));
    expect([...turns].sort()).toEqual([-1, 1]);
    const s = step(p, { s: 10, lean: 5, v: 30 }, 0.016);
    expect(p.mine.renderer.params).toEqual(p.theirs.renderer.params);
    expect(p.mine.renderer.params).toEqual({ antialias: true, powerPreference: "low-power" });
    expect(s.pixelRatio).toBe(2);
    // Sin tamaño, 400 × 300.
    expect(s.sizes).toEqual([[400, 300, false]]);
    for (const side of [p.mine, p.theirs]) {
      expect(side.container.firstChild).toBe(side.renderer.domElement);
      expect(side.renderer.domElement.className).toBe("v3d-canvas");
    }
    // Lo que se compara no está vacío: luces, suelo, asfalto, dos líneas, dos pianos por curva, dos barreras, meta,
    // una franja por sector, los carteles y las dos motos (cuerpo, casco y halo del color de cada una).
    const bounds = opts.bounds?.length ?? 0;
    expect(s.scene?.root.children.length).toBe(
      2 + 1 + 1 + 2 + corners.length * 2 + 2 + 1 + bounds + 1 + 2,
    );
    expect(meshesOf(s, 0xf2c230)).toBe(bounds);
    expect(meshesOf(s, 0x2b80dd)).toBe(3);
    expect(meshesOf(s, 0xa35ce0)).toBe(3);
  });

  for (const mode of MODES) {
    it(`cámara «${mode}»: igual fotograma a fotograma`, () => {
      const p = pair(track, opts);
      p.mine.view.setMode(mode);
      p.theirs.view.setMode(mode);
      p.mine.view.setBrakes(brakes);
      p.theirs.view.setBrakes(brakes);
      let last = null;
      for (const [pose, dt] of poses(L)) last = step(p, pose, dt);
      expect(last?.mode).toBe(mode);
      expect(last?.renders).toBe(poses(L).length);
    });

    it(`fantasma con la cámara «${mode}»: igual`, () => {
      const p = pair(track, opts);
      p.mine.view.setMode(mode);
      p.theirs.view.setMode(mode);
      for (const [pose, dt] of poses(L))
        step(p, pose, dt, { s: pose.s - 15, lean: pose.lean * 0.8 });
      // Sin fantasma, desaparece.
      step(p, { s: 200, lean: 10, v: 40 }, 0.016, null);
      step(p, { s: 210, lean: NaN, v: 40 }, 0.016, { s: 199, lean: NaN });
    });
  }

  it("cambiar de cámara a media vuelta (vuelve a empezar el suavizado del horizonte): igual", () => {
    const p = pair(track, opts, { size: [390, 844] });
    const list = poses(L);
    for (let k = 0; k < 12; k++) {
      const mode = MODES[k % MODES.length];
      if (k % 2 === 0) {
        p.mine.view.setMode(mode);
        p.theirs.view.setMode(mode);
      }
      const [pose, dt] = list[k % list.length];
      step(p, pose, dt);
    }
  });

  it("carteles de frenada: igual, y los anteriores se sueltan", () => {
    const p = pair(track, opts);
    p.mine.view.setBrakes(brakes);
    p.theirs.view.setBrakes(brakes);
    let s = step(p, { s: 100, lean: 0, v: 50 }, 0.016);
    expect(meshesOf(s, 0xd2382d)).toBe(brakes.filter((b) => b !== null && b !== undefined).length);
    const old = [p.mine, p.theirs].map((side) => {
      const boards = side.renderer.scene?.children.find(
        (o) => o.type === "Group" && o.children.length === 4,
      );
      const meshes = boards ? resourcesOf(boards) : [];
      return meshes.map((r) => vi.spyOn(r, "dispose"));
    });
    // Cuatro carteles: geometría y material de cada uno, en las dos vistas.
    expect(old.map((spies) => spies.length)).toEqual([8, 8]);
    p.mine.view.setBrakes([L * 0.75, 33]);
    p.theirs.view.setBrakes([L * 0.75, 33]);
    for (const spies of old) for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    s = step(p, { s: 101, lean: 0, v: 50 }, 0.016);
    expect(meshesOf(s, 0xd2382d)).toBe(2);
    p.mine.view.setBrakes(null);
    p.theirs.view.setBrakes(null);
    s = step(p, { s: 102, lean: 0, v: 50 }, 0.016);
    expect(meshesOf(s, 0xd2382d)).toBe(0);
  });

  it("tamaño y ángulo de visión por cámara (móvil de pie y tumbado): igual", () => {
    for (const size of [
      [390, 844],
      [1280, 400],
      [600, 600],
      [0, 500],
    ] as [number, number][]) {
      const p = pair(track, opts, { size });
      for (const mode of [...MODES, "casco"] as V.Vista3DMode[]) {
        p.mine.view.setMode(mode);
        p.theirs.view.setMode(mode);
        step(p, { s: 640, lean: 20, v: 45 }, 0.016);
      }
      // Un modo desconocido (de quien no use los tipos) se queda en el casco.
      p.mine.view.setMode("otro" as V.Vista3DMode);
      p.theirs.view.setMode("otro" as V.Vista3DMode);
      expect(step(p, { s: 650, lean: 20, v: 45 }, 0.016).mode).toBe("casco");
    }
  });

  it("al cambiar el tamaño del contenedor (ResizeObserver): igual", () => {
    const p = pair(track, opts, { size: [390, 844], resizeObserver: true });
    for (const side of [p.mine, p.theirs]) {
      expect(side.observers.length).toBe(1);
      expect(side.observers[0].observed).toEqual([side.container]);
    }
    p.mine.view.setMode("detras");
    p.theirs.view.setMode("detras");
    step(p, { s: 300, lean: -20, v: 40 }, 0.016);
    for (const side of [p.mine, p.theirs]) {
      setSize(side.container, [844, 390]);
      side.observers[0].callback();
    }
    const s = step(p, { s: 310, lean: -20, v: 40 }, 0.016);
    expect(s.sizes).toEqual([
      [390, 844, false],
      [844, 390, false],
    ]);
  });

  it("sin trazada ideal (va por el eje): igual", () => {
    const p = pair(syntheticTrack(false), { corners: [{ i: 120 }], bounds: null });
    for (const mode of MODES) {
      p.mine.view.setMode(mode);
      p.theirs.view.setMode(mode);
      for (const [pose, dt] of poses(L).slice(0, 4)) step(p, pose, dt, { s: pose.s + 3, lean: 0 });
    }
  });

  it("sin curvas ni sectores: igual", () => {
    const p = pair(track, {});
    step(p, { s: 0, lean: 0 });
  });

  it("dispose suelta todas las geometrías y materiales, el renderizador, el lienzo y el ResizeObserver", () => {
    const p = pair(track, opts, { resizeObserver: true });
    p.mine.view.setBrakes(brakes);
    p.theirs.view.setBrakes(brakes);
    step(p, { s: 500, lean: 15, v: 40 }, 0.016, { s: 490, lean: 10 });
    const counts = [p.mine, p.theirs].map((side) => {
      const scene = side.renderer.scene;
      if (!scene) throw new Error("sin escena");
      const spies = resourcesOf(scene).map((r) => vi.spyOn(r, "dispose"));
      const canvas = side.renderer.domElement;
      expect(canvas.parentNode).toBe(side.container);
      side.view.dispose();
      expect(side.renderer.disposed).toBe(1);
      expect(canvas.parentNode).toBeNull();
      expect(side.container.childNodes.length).toBe(1);
      expect(side.observers[0].disconnected).toBe(1);
      for (const spy of spies) expect(spy).toHaveBeenCalled();
      return spies.map((spy) => spy.mock.calls.length);
    });
    expect(counts[0]).toEqual(counts[1]);
    // La geometría y el material de las ruedas los comparten las dos ruedas: se sueltan dos veces (como antes).
    expect(counts[0].filter((c) => c === 2).length).toBe(4);
  });

  it("sin contenedor o sin WebGL: null, como antes", () => {
    const old = legacyVista3D<typeof V>();
    expect(V.create(null, track, opts, (params) => new FakeRenderer(params))).toBeNull();
    expect(old.V.create(null, track, opts)).toBeNull();
    // WebGLRenderer lanza (no hay WebGL).
    const broken = legacyVista3D<typeof V>(() => {
      throw new Error("Error creating WebGL context.");
    });
    const boom = (): FakeRenderer => {
      throw new Error("Error creating WebGL context.");
    };
    expect(V.create(box({}), track, opts, boom)).toBeNull();
    expect(broken.V.create(box({}), track, opts)).toBeNull();
    // El renderizador sale, pero sin contexto: tampoco, y no se pone el lienzo.
    const noContext = (params: unknown): FakeRenderer => {
      const r = new FakeRenderer(params);
      r.context = null;
      return r;
    };
    const lost = legacyVista3D<typeof V>(noContext);
    const mineBox = box({});
    const theirBox = box({});
    expect(V.create(mineBox, track, opts, noContext)).toBeNull();
    expect(lost.V.create(theirBox, track, opts)).toBeNull();
    expect(mineBox.childNodes.length).toBe(1);
    expect(theirBox.childNodes.length).toBe(1);
  });
});

interface LegacyTelemetry {
  buildTrack(dir: string, start: number): V.Vista3DTrack;
  reference(
    t: V.Vista3DTrack,
    targetTime: number,
    power: number,
  ): { corners: (V.Vista3DCorner & { sApex: number })[] };
  sectorBounds(c: readonly { sApex: number }[], len: number): number[];
}

describe("vista 3D con el circuito de Maspalomas de verdad (trazado de antes, track-data.js)", () => {
  const w = loadLegacy("track-data.js", "sim.js", "analysis.js", "telemetry.js");
  const T = w.MaspaTelemetry as LegacyTelemetry;
  const power = (w.MaspaSim as { MAPS: { repro: { power: number } } }).MAPS.repro.power;
  for (const dir of ["osm", "rev"]) {
    it(`sentido «${dir}»: misma escena y mismas cámaras en toda la vuelta`, () => {
      // Como live.js: el trazado, sus curvas (simulación de 65 s) y los límites de sector.
      const real = T.buildTrack(dir, 0);
      const ref = T.reference(real, 65.0, power);
      expect(ref.corners.length).toBe(4);
      const p = pair(real, { corners: ref.corners, bounds: T.sectorBounds(ref.corners, real.L) });
      p.mine.view.setBrakes([150, 700, 1250, 1790]);
      p.theirs.view.setBrakes([150, 700, 1250, 1790]);
      for (const mode of MODES) {
        p.mine.view.setMode(mode);
        p.theirs.view.setMode(mode);
        for (let k = 0; k <= 24; k++) {
          const s = (real.L * k) / 24 + 0.37;
          step(p, { s, lean: 50 * Math.sin(k * 1.3), v: 20 + k * 2.5 }, 0.016 + (k % 3) * 0.02);
        }
      }
    });
  }
});
