// La vista 3D de antes (vista3d.js con three.min.js r128 y analysis.js, de la raíz del repo) en un contexto aparte,
// como en el navegador, y lo que hace falta para compararla con la nueva sin GPU: un renderizador de mentira en lugar
// de WebGLRenderer (en Node no hay WebGL) y un resumen de la escena y de la cámara que se puede comparar entre los dos
// contextos (cada uno tiene su THREE: nada de instanceof, solo propiedades).
// El lienzo del renderizador de mentira es un <canvas> de verdad: las pruebas que lo usan van con jsdom.
import type { Camera, Object3D, Scene } from "three";
import { loadLegacy } from "./legacy";

// Lo que la vista usa de WebGLRenderer, sin GPU. Al pintar hace con la escena lo mismo que el de verdad (r128:
// actualizar las matrices del mundo de la escena y de la cámara) y apunta lo que se le pide.
export class FakeRenderer {
  readonly params: unknown;
  readonly domElement: HTMLCanvasElement;
  // Lo que devuelve getContext(): null es un móvil sin WebGL.
  context: unknown = {};
  pixelRatio: number | null = null;
  sizes: [number, number, boolean | undefined][] = [];
  renders = 0;
  disposed = 0;
  scene: Scene | null = null;
  camera: Camera | null = null;

  constructor(params: unknown) {
    this.params = params;
    this.domElement = document.createElement("canvas");
  }

  getContext(): unknown {
    return this.context;
  }

  setPixelRatio(value: number): void {
    this.pixelRatio = value;
  }

  setSize(width: number, height: number, updateStyle?: boolean): void {
    this.sizes.push([width, height, updateStyle]);
  }

  render(scene: Object3D, camera: Camera): void {
    const s = scene as Scene;
    if (s.autoUpdate === true) s.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
    this.scene = s;
    this.camera = camera;
    this.renders++;
  }

  dispose(): void {
    this.disposed++;
  }
}

export interface LegacyVista3D<T> {
  // El MaspaVista3D de antes.
  V: T;
  // Su window: devicePixelRatio, ResizeObserver… se ponen aquí antes de crear la vista.
  win: Record<string, unknown>;
  // Los renderizadores que ha creado, en orden.
  renderers: FakeRenderer[];
}

// Carga la vista de antes con THREE.WebGLRenderer cambiado por `make` (por defecto, un FakeRenderer nuevo; si lanza,
// es como un móvil en el que WebGL no arranca). analysis.js va antes, como en la app (de ahí sale el sentido de giro
// de los pianos).
export function legacyVista3D<T>(
  make: (params: unknown) => FakeRenderer = (params) => new FakeRenderer(params),
): LegacyVista3D<T> {
  const win = loadLegacy("three.min.js", "analysis.js", "vista3d.js");
  const THREE = win.THREE as Record<string, unknown>;
  const renderers: FakeRenderer[] = [];
  // vista3d.js hace `new THREE.WebGLRenderer(…)`: una función que devuelve un objeto sirve de constructor.
  THREE.WebGLRenderer = function WebGLRenderer(params: unknown): FakeRenderer {
    const r = make(params);
    renderers.push(r);
    return r;
  };
  return { V: win.MaspaVista3D as T, win, renderers };
}

// ---------- resúmenes comparables ----------

export interface ArraySummary {
  count: number;
  itemSize: number;
  // Huella (FNV-1a de los bits en float32) de todos los valores y los primeros, para leer el fallo.
  hash: string;
  head: number[];
}

export interface GeometrySummary {
  // Orden en que aparece por primera vez en la escena (dos mallas con la misma geometría, el mismo número).
  ref: number;
  type: string;
  parameters: Record<string, unknown> | null;
  index: ArraySummary | null;
  attributes: Record<string, ArraySummary>;
  groups: number;
  drawRange: number[];
}

export interface MaterialSummary {
  ref: number;
  type: string;
  color: number | null;
  side: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  depthTest: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  vertexColors: boolean;
  fog: boolean;
  visible: boolean;
}

export interface LightSummary {
  color: number;
  groundColor: number | null;
  intensity: number;
  target: number[] | null;
}

export interface NodeSummary {
  type: string;
  name: string;
  visible: boolean;
  position: number[];
  rotation: (number | string)[];
  scale: number[];
  matrixWorld: number[];
  light?: LightSummary;
  geometry?: GeometrySummary;
  material?: MaterialSummary;
  children: NodeSummary[];
}

export interface SceneSummary {
  background: number | null;
  fog: { color: number; near: number; far: number } | null;
  root: NodeSummary;
}

export interface CameraSummary {
  type: string;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  zoom: number;
  position: number[];
  quaternion: number[];
  up: number[];
  matrixWorld: number[];
  projectionMatrix: number[];
}

// Lo que se lee de los objetos de three.js (de cualquiera de los dos contextos).
interface Hex {
  getHex(): number;
}
interface Vec {
  x: number;
  y: number;
  z: number;
}
interface Attr {
  array: ArrayLike<number>;
  count: number;
  itemSize: number;
}
interface Geo {
  type: string;
  parameters?: Record<string, unknown>;
  index: Attr | null;
  attributes: Record<string, Attr>;
  groups: unknown[];
  drawRange: { start: number; count: number };
  dispose(): void;
}
interface Mat {
  dispose(): void;
  type: string;
  color?: Hex;
  side: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  depthTest: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
  vertexColors: boolean;
  fog?: boolean;
  visible: boolean;
}
interface Obj {
  type: string;
  name: string;
  visible: boolean;
  position: Vec;
  rotation: Vec & { order: string };
  scale: Vec;
  matrixWorld: { elements: ArrayLike<number> };
  children: Obj[];
  isLight?: boolean;
  color?: Hex;
  groundColor?: Hex;
  intensity?: number;
  target?: { position: Vec };
  geometry?: Geo;
  material?: Mat;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function hash(a: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) {
    f32[0] = a[i];
    h = Math.imul(h ^ u32[0], 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function arraySummary(a: Attr): ArraySummary {
  return {
    count: a.count,
    itemSize: a.itemSize,
    hash: hash(a.array),
    head: Array.from({ length: Math.min(9, a.array.length) }, (_, i) => a.array[i]),
  };
}

const vec = (v: Vec): number[] => [v.x, v.y, v.z];

// Escena entera: fondo, niebla y el árbol de objetos con sus geometrías y materiales.
export function summarizeScene(scene: Scene): SceneSummary {
  const geos = new Map<unknown, number>();
  const mats = new Map<unknown, number>();
  const refOf = (m: Map<unknown, number>, o: unknown): number => {
    if (!m.has(o)) m.set(o, m.size);
    return m.get(o) as number;
  };
  const node = (o: Obj): NodeSummary => {
    const out: NodeSummary = {
      type: o.type,
      name: o.name,
      visible: o.visible,
      position: vec(o.position),
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.order],
      scale: vec(o.scale),
      matrixWorld: Array.from(o.matrixWorld.elements),
      children: o.children.map(node),
    };
    if (o.isLight) {
      out.light = {
        color: (o.color as Hex).getHex(),
        groundColor: o.groundColor ? o.groundColor.getHex() : null,
        intensity: o.intensity as number,
        target: o.target ? vec(o.target.position) : null,
      };
    }
    const g = o.geometry;
    if (g) {
      const attributes: Record<string, ArraySummary> = {};
      for (const k of Object.keys(g.attributes).sort())
        attributes[k] = arraySummary(g.attributes[k]);
      out.geometry = {
        ref: refOf(geos, g),
        type: g.type,
        parameters: g.parameters ? { ...g.parameters } : null,
        index: g.index ? arraySummary(g.index) : null,
        attributes,
        groups: g.groups.length,
        drawRange: [g.drawRange.start, g.drawRange.count],
      };
    }
    const m = o.material;
    if (m) {
      out.material = {
        ref: refOf(mats, m),
        type: m.type,
        color: m.color ? m.color.getHex() : null,
        side: m.side,
        transparent: m.transparent,
        opacity: m.opacity,
        depthWrite: m.depthWrite,
        depthTest: m.depthTest,
        polygonOffset: m.polygonOffset,
        polygonOffsetFactor: m.polygonOffsetFactor,
        polygonOffsetUnits: m.polygonOffsetUnits,
        vertexColors: m.vertexColors,
        fog: m.fog === true,
        visible: m.visible,
      };
    }
    return out;
  };
  const s = scene as unknown as Obj & {
    background: Hex | null;
    fog: { color: Hex; near: number; far: number } | null;
  };
  return {
    background: s.background ? s.background.getHex() : null,
    fog: s.fog ? { color: s.fog.color.getHex(), near: s.fog.near, far: s.fog.far } : null,
    root: node(s),
  };
}

export function summarizeCamera(camera: Camera): CameraSummary {
  const c = camera as Camera & {
    fov: number;
    aspect: number;
    near: number;
    far: number;
    zoom: number;
  };
  return {
    type: c.type,
    fov: c.fov,
    aspect: c.aspect,
    near: c.near,
    far: c.far,
    zoom: c.zoom,
    position: vec(c.position),
    quaternion: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w],
    up: vec(c.up),
    matrixWorld: Array.from(c.matrixWorld.elements),
    projectionMatrix: Array.from(c.projectionMatrix.elements),
  };
}

// Todas las geometrías y materiales de un objeto y lo que cuelga de él, una vez cada uno (para ver si se sueltan).
export function resourcesOf(root: Object3D): { dispose(): void }[] {
  const out = new Set<Geo | Mat>();
  const walk = (o: Obj): void => {
    if (o.geometry) out.add(o.geometry);
    if (o.material) out.add(o.material);
    o.children.forEach(walk);
  };
  walk(root as unknown as Obj);
  return [...out];
}
