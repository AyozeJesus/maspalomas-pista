// Vista 3D del circuito de Maspalomas para la vuelta de ejemplo: casco, detrás o desde arriba.
// Coordenadas del trazado en metros (x hacia el este, y hacia el sur) → mundo 3D (x, altura, z = y).
// three.js pesa mucho: este módulo solo se carga con import() al abrir la vista 3D (nadie más lo importa).
import * as THREE from "three";

// Cámaras: en el casco del piloto, detrás de la moto o desde arriba.
export type Vista3DMode = "casco" | "detras" | "arriba";

// Un punto o un vector del trazado: [x, y] en metros.
export type Vista3DPoint = readonly [number, number];

// Lo que la vista lee del trazado (el de buildTrack en telemetry.js): el eje cerrado (sin repetir el primer punto),
// la normal a la derecha en cada punto, la distancia acumulada (n + 1 valores), la longitud y, si la hay, la trazada
// ideal (alineada índice a índice con el eje). closed: false es un trazado abierto (una carretera, de la salida a la
// llegada): cs lleva entonces un valor por punto (el último es L) y más allá de los extremos se sigue en línea recta.
export interface Vista3DTrack {
  C: readonly Vista3DPoint[];
  N: readonly Vista3DPoint[];
  cs: ArrayLike<number>;
  L: number;
  full?: readonly Vista3DPoint[] | null;
  closed?: boolean;
}

// Una curva: índice de su vértice en el eje (lleva pianos por dentro y por fuera).
export interface Vista3DCorner {
  i?: number;
}

// Curvas y límites de sector (m desde meta, franjas amarillas). style «carretera»: dos carriles (7 m) con sus líneas,
// la discontinua del medio e hitos a los lados, sin pianos ni barreras (una ruta). extras: la moto lleva luz de freno
// y hace caballitos (pose.brake y pose.pitch, para repasar lo grabado). Sin ellos, el circuito de siempre.
export interface Vista3DOptions {
  corners?: readonly Vista3DCorner[] | null;
  bounds?: readonly number[] | null;
  style?: "circuito" | "carretera";
  extras?: boolean;
}

// s (m desde meta), lean (grados, + derecha) y v (m/s; aleja la mirada desde el casco). Con extras: brake (frenando:
// luz de freno) y pitch (grados, + morro arriba: el caballito).
export interface Vista3DPose {
  s: number;
  lean: number;
  v?: number;
  brake?: boolean;
  pitch?: number;
}

// La moto fantasma de otra vuelta: { s, lean }.
export interface Vista3DGhostPose {
  s: number;
  lean: number;
}

// Para pruebas: dónde está la cámara, hacia dónde mira y dónde está la moto (redondeado a 10 cm), y el ángulo de
// visión vertical.
export interface Vista3DDebug {
  pos: number[];
  look: number[];
  bike: number[];
  fov: number;
}

export interface Vista3D {
  // Pinta un fotograma con la moto en `pose` (dt: s desde el anterior) y, si se da, el fantasma.
  update(pose: Vista3DPose, dt?: number, ghostPose?: Vista3DGhostPose | null): void;
  // Ajusta el lienzo y la cámara al tamaño del contenedor.
  resize(): void;
  setMode(m: Vista3DMode): void;
  // Carteles de frenada (s en m desde meta); quita los que hubiera.
  setBrakes(list: readonly (number | null | undefined)[] | null | undefined): void;
  // Suelta geometrías, materiales y el lienzo.
  dispose(): void;
  readonly mode: Vista3DMode;
  debug(): Vista3DDebug;
}

// Lo que la vista usa del renderizador de three.js. Por defecto es un WebGLRenderer; las pruebas (en Node no hay
// WebGL) le pasan uno de mentira.
export interface Vista3DRenderer {
  readonly domElement: HTMLCanvasElement;
  // El contexto de WebGL (nulo si no se ha podido crear).
  getContext(): unknown;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  dispose(): void;
}

export type Vista3DRendererFactory = (params: THREE.WebGLRendererParameters) => Vista3DRenderer;

interface Bike {
  group: THREE.Group;
  tilt: THREE.Group;
  ring: THREE.Mesh;
  // Con extras: el giro sobre la rueda de atrás (caballito) y la luz de freno.
  pitch: THREE.Group | null;
  brake: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null;
}

interface ViewState {
  mode: Vista3DMode;
  init: boolean;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  roll: number;
}

// Los carteles de frenada.
type Board = THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
// Cualquier malla de la escena (ninguna lleva lista de materiales).
type AnyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

const WIDTH = 12;
// Carretera: dos carriles de 3,5 m; discontinua del medio de 3 m cada 12 m; un hito a cada lado cada 50 m.
const ROAD_WIDTH = 7;
const DASH = 3;
const DASH_EVERY = 12;
const POST_EVERY = 50;
// Un trazado abierto va en trozos de tantos puntos (≈ 1 km): three.js no dibuja los que quedan fuera de la cámara.
const CHUNK = 300;
// Luz de freno: apagada y encendida.
const BRAKE_OFF = 0x5a1414;
const BRAKE_ON = 0xff2a1f;
// Ángulo vertical mínimo y ángulo horizontal deseado por cámara: con el móvil de pie
// el vertical crece (hasta 95°) para no ver la pista por una rendija.
const FOV: Record<Vista3DMode, number> = { casco: 74, detras: 58, arriba: 45 };
const HFOV: Record<Vista3DMode, number> = { casco: 105, detras: 85, arriba: 70 };
const fovFor = (mode: Vista3DMode, aspect: number): number => {
  const t = Math.tan((HFOV[mode] * Math.PI) / 360) / (aspect || 1);
  const v = (Math.atan(t) * 360) / Math.PI;
  return Math.round(Math.max(FOV[mode], Math.min(95, v)));
};

function ring(i: number, n: number): number {
  return ((i % n) + n) % n;
}

// Sentido de giro del eje en el punto i (+1 derecha, -1 izquierda), con los puntos 3 antes y 3 después: el `turn`
// de MaspaAnalysis.frame (analysis.js), que la app de antes cargaba siempre antes que esta vista.
function turnAt(P: readonly Vista3DPoint[], i: number): number {
  const n = P.length;
  const k = 3;
  const a = P[ring(i - k, n)];
  const b = P[i];
  const c = P[ring(i + k, n)];
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  return cross >= 0 ? 1 : -1;
}

// Un WebGLRenderer (o el que se pase); null si no se puede crear (sin WebGL).
function newRenderer(make: Vista3DRendererFactory): Vista3DRenderer | null {
  try {
    return make({
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
}

// Monta la vista dentro de `container` (el lienzo va delante de lo que ya tenga). null si no hay contenedor o si el
// móvil no puede dibujar en 3D.
export function create(
  container: HTMLElement | null | undefined,
  track: Vista3DTrack,
  opts: Vista3DOptions,
  makeRenderer: Vista3DRendererFactory = (params) => new THREE.WebGLRenderer(params),
): Vista3D | null {
  if (!container) return null;
  const renderer = newRenderer(makeRenderer);
  if (!renderer || !renderer.getContext()) return null;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = "v3d-canvas";
  container.prepend(renderer.domElement);
  return build(container, renderer, track, opts);
}

// La escena, la cámara y lo que se hace con ellas en cada fotograma (con el lienzo ya puesto en el contenedor).
function build(
  container: HTMLElement,
  renderer: Vista3DRenderer,
  track: Vista3DTrack,
  opts: Vista3DOptions,
): Vista3D {
  const C = track.C;
  const n = C.length;
  // Trazado abierto (una ruta): de la salida a la llegada, sin dar la vuelta. Carretera: dos carriles e hitos.
  const open = track.closed === false;
  const road = opts.style === "carretera";
  // Centro del circuito como origen (números pequeños para la GPU).
  let cx = 0;
  let cy = 0;
  for (const p of C) {
    cx += p[0] / n;
    cy += p[1] / n;
  }
  const W = (x: number, y: number): [number, number] => [x - cx, y - cy];
  // El suelo mide 6 km de lado; en una ruta, lo que haga falta para que llegue a toda ella (la niebla tapa el borde).
  let groundSize = 6000;
  if (open)
    for (const p of C)
      groundSize = Math.max(
        groundSize,
        2 * Math.max(Math.abs(p[0] - cx), Math.abs(p[1] - cy)) + 4000,
      );

  const scene = new THREE.Scene();
  const sky = new THREE.Color(0xbcd7ea);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 900, 2600);
  // Plano cercano a 0,4 m y lejano a 4 km: con un búfer de profundidad de 16 bits (algunos móviles y el
  // dibujado por software) un plano cercano muy pequeño deja sin precisión a 50 m y el suelo tapaba el asfalto.
  const camera = new THREE.PerspectiveCamera(FOV.casco, 16 / 9, 0.4, 4000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f7a, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5);
  sun.position.set(-300, 600, 250);
  scene.add(sun);
  // El suelo es lo primero que se dibuja y no apunta profundidad: debajo de él no hay nada que tapar. Un plano de
  // kilómetros con solo dos triángulos pierde precisión de profundidad y aun así tapaba trozos de asfalto (visto el
  // 11-oct en el km 0,3 de El Teide, y en Los Loros).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshLambertMaterial({ color: 0xd9cba8, depthWrite: false }),
  );
  ground.renderOrder = -1;
  ground.rotation.x = -Math.PI / 2;
  // El suelo, bien por debajo del asfalto (5 cm no bastaban para la precisión de profundidad de lejos).
  ground.position.y = -0.4;
  scene.add(ground);

  const N = track.N;
  // Cinta entre dos desplazamientos laterales para los índices dados (con color por tramo opcional).
  function ribbon(
    P: readonly Vista3DPoint[],
    NN: readonly Vista3DPoint[],
    idx: readonly number[],
    d0: number,
    d1: number,
    y: number,
    colorAt: ((k: number) => THREE.Color) | null,
  ): THREE.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    ribbonInto(pos, col, P, NN, idx, d0, d1, y, colorAt);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (colorAt) geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }
  // Los triángulos de una cinta, añadidos a pos (y sus colores a col).
  function ribbonInto(
    pos: number[],
    col: number[],
    P: readonly Vista3DPoint[],
    NN: readonly Vista3DPoint[],
    idx: readonly number[],
    d0: number,
    d1: number,
    y: number,
    colorAt: ((k: number) => THREE.Color) | null,
  ): void {
    for (let k = 0; k < idx.length - 1; k++) {
      const i = idx[k];
      const j = idx[k + 1];
      const a0 = W(P[i][0] + NN[i][0] * d0, P[i][1] + NN[i][1] * d0);
      const a1 = W(P[i][0] + NN[i][0] * d1, P[i][1] + NN[i][1] * d1);
      const b0 = W(P[j][0] + NN[j][0] * d0, P[j][1] + NN[j][1] * d0);
      const b1 = W(P[j][0] + NN[j][0] * d1, P[j][1] + NN[j][1] * d1);
      pos.push(a0[0], y, a0[1], b0[0], y, b0[1], a1[0], y, a1[1]);
      pos.push(a1[0], y, a1[1], b0[0], y, b0[1], b1[0], y, b1[1]);
      if (colorAt) {
        const c = colorAt(k);
        for (let r = 0; r < 6; r++) col.push(c.r, c.g, c.b);
      }
    }
  }
  const half = (road ? ROAD_WIDTH : WIDTH) / 2;
  // Lo pintado sobre el asfalto (líneas, pianos, meta) se adelanta en profundidad en vez de subirlo unos
  // milímetros: así no parpadea ni desaparece de lejos.
  const flat = (
    color: number,
    extra?: THREE.MeshBasicMaterialParameters,
  ): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial(
      Object.assign(
        {
          color,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        },
        extra || {},
      ),
    );
  if (open) buildOpen();
  else buildClosed();

  // El circuito (cerrado): asfalto y líneas de una pieza, pianos en las curvas y barreras.
  function buildClosed(): void {
    const loop: number[] = [];
    for (let i = 0; i <= n; i++) loop.push(i % n);
    scene.add(
      new THREE.Mesh(
        ribbon(C, N, loop, -half, half, 0, null),
        new THREE.MeshLambertMaterial({
          color: 0x353c42,
          side: THREE.DoubleSide,
        }),
      ),
    );
    for (const d of [-half + 0.25, half - 0.55])
      scene.add(new THREE.Mesh(ribbon(C, N, loop, d, d + 0.3, 0.02, null), flat(0xf4f6f7)));
    // Pianos en las curvas: por dentro y por fuera, rojo y blanco.
    const red = new THREE.Color(0xd2382d);
    const white = new THREE.Color(0xffffff);
    for (const c of opts.corners || []) {
      const ci = Math.round(c.i !== undefined ? c.i : 0);
      const turn = turnAt(C, ci);
      for (const [span, side] of [
        [10, -1],
        [5, 1],
      ] as const) {
        const idx: number[] = [];
        for (let j = ci - span; j <= ci + span; j++) idx.push(((j % n) + n) % n);
        const s = side * turn;
        const d0 = s > 0 ? half : -half - 1.4;
        const d1 = s > 0 ? half + 1.4 : -half;
        scene.add(
          new THREE.Mesh(
            ribbon(C, N, idx, d0, d1, 0.03, (k) => (k % 2 ? white : red)),
            flat(0xffffff, { vertexColors: true }),
          ),
        );
      }
    }
    // Barreras de neumáticos a los lados (dan referencia de profundidad desde el casco).
    for (const d of [-half - 3.5, half + 3.5]) {
      const pos: number[] = [];
      for (let i = 0; i < n; i++) barrierInto(pos, i, (i + 1) % n, d);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      scene.add(
        new THREE.Mesh(
          geo,
          new THREE.MeshLambertMaterial({
            color: 0x3a3f44,
            side: THREE.DoubleSide,
          }),
        ),
      );
    }
  }

  // Un trozo de barrera (0,9 m de alto) entre los puntos i y j, a d metros del eje.
  function barrierInto(pos: number[], i: number, j: number, d: number): void {
    const a = W(C[i][0] + N[i][0] * d, C[i][1] + N[i][1] * d);
    const b = W(C[j][0] + N[j][0] * d, C[j][1] + N[j][1] * d);
    pos.push(a[0], 0, a[1], b[0], 0, b[1], a[0], 0.9, a[1]);
    pos.push(a[0], 0.9, a[1], b[0], 0, b[1], b[0], 0.9, b[1]);
  }

  // Una ruta (abierta), en trozos de CHUNK puntos: asfalto; líneas (y en carretera, la discontinua del medio); hitos en
  // carretera o barreras en el circuito. Los materiales son de todos los trozos.
  function buildOpen(): void {
    const asphalt = new THREE.MeshLambertMaterial({ color: 0x353c42, side: THREE.DoubleSide });
    const marks = flat(0xf4f6f7);
    const sides = new THREE.MeshLambertMaterial({
      color: road ? 0xe8ebe6 : 0x3a3f44,
      side: THREE.DoubleSide,
    });
    const lineW = road ? 0.15 : 0.3;
    const lines = road ? [-half + 0.15, half - 0.3] : [-half + 0.25, half - 0.55];
    const cs = track.cs;
    for (let a = 0; a < n - 1; a += CHUNK) {
      const b = Math.min(n - 1, a + CHUNK);
      const idx: number[] = [];
      for (let i = a; i <= b; i++) idx.push(i);
      part(ribbon(C, N, idx, -half, half, 0, null), asphalt, "asfalto");
      const m: number[] = [];
      for (const d of lines) ribbonInto(m, [], C, N, idx, d, d + lineW, 0.02, null);
      const side: number[] = [];
      if (road) {
        // La discontinua: cada raya empieza en su trozo.
        for (let k = Math.ceil(cs[a] / DASH_EVERY); k * DASH_EVERY < cs[b]; k++) {
          const s0 = k * DASH_EVERY;
          const s1 = Math.min(s0 + DASH, track.L);
          if (s1 - s0 > 0.5) stripInto(m, s0, s1, -0.06, 0.06, 0.02);
        }
        for (let k = Math.ceil(cs[a] / POST_EVERY); k * POST_EVERY < cs[b]; k++) {
          const p = pointAt(C, k * POST_EVERY);
          const nn = N[p.i];
          for (const sg of [-1, 1]) {
            const w = W(p.x + nn[0] * sg * (half + 1.2), p.y + nn[1] * sg * (half + 1.2));
            boxInto(side, w[0], 0.45, w[1], 0.14, 0.9, 0.14);
          }
        }
      } else
        for (const d of [-half - 3.5, half + 3.5])
          for (let i = a; i < b; i++) barrierInto(side, i, i + 1, d);
      part(geometryOf(m), marks, "marcas");
      if (side.length) part(geometryOf(side), sides, road ? "hitos" : "barreras");
    }
  }

  function part(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): void {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    scene.add(m);
  }

  function geometryOf(pos: number[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // Una franja recta sobre el asfalto de s0 a s1 (m), entre d0 y d1 del eje.
  function stripInto(
    pos: number[],
    s0: number,
    s1: number,
    d0: number,
    d1: number,
    y: number,
  ): void {
    const p = pointAt(C, s0);
    const q = pointAt(C, s1);
    const np = N[p.i];
    const nq = N[q.i];
    const a0 = W(p.x + np[0] * d0, p.y + np[1] * d0);
    const a1 = W(p.x + np[0] * d1, p.y + np[1] * d1);
    const b0 = W(q.x + nq[0] * d0, q.y + nq[1] * d0);
    const b1 = W(q.x + nq[0] * d1, q.y + nq[1] * d1);
    pos.push(a0[0], y, a0[1], b0[0], y, b0[1], a1[0], y, a1[1]);
    pos.push(a1[0], y, a1[1], b0[0], y, b0[1], b1[0], y, b1[1]);
  }

  // Una caja (sin la cara de abajo) centrada en x, y, z del mundo, de sx × sy × sz.
  function boxInto(
    pos: number[],
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    const [x0, x1, y0, y1, z0, z1] = [
      x - sx / 2,
      x + sx / 2,
      y - sy / 2,
      y + sy / 2,
      z - sz / 2,
      z + sz / 2,
    ];
    pos.push(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z0, x1, y1, z1, x1, y0, z1);
    pos.push(x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z1, x0, y1, z0, x0, y0, z0);
    pos.push(x1, y0, z1, x1, y1, z1, x0, y1, z1, x1, y0, z1, x0, y1, z1, x0, y0, z1);
    pos.push(x0, y0, z0, x0, y1, z0, x1, y1, z0, x0, y0, z0, x1, y1, z0, x1, y0, z0);
    pos.push(x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0);
  }

  // Un punto de una ruta (abierta) a s metros de la salida: antes de la salida y después de la llegada sigue en
  // línea recta (las cámaras van por delante y por detrás de la moto).
  function openPointAt(
    P: readonly Vista3DPoint[],
    s0: number,
  ): { x: number; y: number; i: number } {
    const L = track.L;
    const cs = track.cs;
    const s = Number.isFinite(s0) ? s0 : 0;
    if (s <= 0 || s >= L) {
      const [i, j, d] = s <= 0 ? [0, 1, -s] : [n - 1, n - 2, s - L];
      const a = P[i];
      const b = P[j];
      const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      return {
        x: a[0] + ((a[0] - b[0]) / len) * d,
        y: a[1] + ((a[1] - b[1]) / len) * d,
        i: Math.min(i, j),
      };
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cs[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = P[lo];
    const b = P[lo + 1];
    const f = (s - cs[lo]) / (cs[lo + 1] - cs[lo] || 1);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, i: lo };
  }

  // Puntos sobre el trazado por distancia s (eje o trazada ideal).
  function pointAt(P: readonly Vista3DPoint[], s: number): { x: number; y: number; i: number } {
    if (open) return openPointAt(P, s);
    const L = track.L;
    const ss = ((s % L) + L) % L;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track.cs[mid] <= ss) lo = mid;
      else hi = mid;
    }
    const a = P[lo];
    const b = P[(lo + 1) % n];
    const f = (ss - track.cs[lo]) / (track.cs[lo + 1] - track.cs[lo] || 1);
    return {
      x: a[0] + (b[0] - a[0]) * f,
      y: a[1] + (b[1] - a[1]) * f,
      i: lo,
    };
  }
  // Línea de meta y de sectores (franjas a lo ancho); en una ruta, la salida y la llegada.
  function gate(s: number, color: number, name = ""): void {
    const p = pointAt(C, s);
    const i = p.i;
    const j = open ? Math.min(i + 1, n - 1) : (i + 1) % n;
    const g = new THREE.Mesh(ribbon(C, N, [i, j], -half, half, 0.04, null), flat(color));
    g.name = name;
    scene.add(g);
  }
  if (open) {
    gate(0, 0xffffff, "salida");
    gate(track.L, 0xffffff, "llegada");
  } else {
    gate(0, 0xffffff);
    for (const b of opts.bounds || []) gate(b, 0xf2c230);
  }
  // Carteles de frenada (de la mejor vuelta): tablero rojo a la derecha de la pista.
  const boards = new THREE.Group();
  scene.add(boards);
  function setBrakes(list: readonly (number | null | undefined)[] | null | undefined): void {
    while (boards.children.length) {
      const o = boards.children.pop() as Board;
      o.geometry.dispose();
      o.material.dispose();
    }
    for (const s of list || []) {
      if (s === null || s === undefined) continue;
      const p = pointAt(C, s);
      const nn = N[p.i];
      const w = W(p.x + nn[0] * (half + 2.2), p.y + nn[1] * (half + 2.2));
      const m: Board = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 1.6, 1.6),
        new THREE.MeshBasicMaterial({ color: 0xd2382d }),
      );
      m.position.set(w[0], 1.6, w[1]);
      const a = Math.atan2(nn[1], nn[0]);
      m.rotation.y = -a;
      boards.add(m);
    }
  }

  // Moto (para las cámaras de detrás y de arriba) y, si se pide, el fantasma de otra vuelta: la misma moto en
  // morado y medio transparente.
  function makeBike(color: number, opacity: number): Bike {
    const mat = (c: number): THREE.MeshLambertMaterial =>
      new THREE.MeshLambertMaterial(
        opacity < 1 ? { color: c, transparent: true, opacity, depthWrite: false } : { color: c },
      );
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    // Con extras, las piezas cuelgan del eje de la rueda de atrás (dx más adelante que él): el caballito gira ahí.
    let parent: THREE.Group = tilt;
    let pitch: THREE.Group | null = null;
    const dx = opts.extras ? 0.78 : 0;
    if (opts.extras) {
      pitch = new THREE.Group();
      pitch.name = "cabeceo";
      pitch.position.set(-dx, 0, 0);
      tilt.add(pitch);
      parent = pitch;
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 0.62), mat(color));
    body.position.set(0 + dx, 0.85, 0);
    parent.add(body);
    const rider = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.5), mat(0xf4f6f7));
    rider.position.set(-0.25 + dx, 1.45, 0);
    parent.add(rider);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat(color));
    head.position.set(0.25 + dx, 1.85, 0);
    parent.add(head);
    const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18);
    const wheelMat = mat(0x1a1d20);
    for (const x of [-0.78, 0.78]) {
      const w = new THREE.Mesh(wheel, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(x + dx, 0.33, 0);
      parent.add(w);
    }
    // Luz de freno, detrás del colín.
    let brake: Bike["brake"] = null;
    if (opts.extras) {
      brake = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.14, 0.36),
        new THREE.MeshBasicMaterial(
          opacity < 1
            ? { color: BRAKE_OFF, transparent: true, opacity, depthWrite: false }
            : { color: BRAKE_OFF },
        ),
      );
      brake.name = "luz-freno";
      brake.position.set(-1.03 + dx, 1.0, 0);
      parent.add(brake);
    }
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.1, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55 * opacity,
      }),
    );
    ring.position.y = 0.06;
    group.add(ring);
    scene.add(group);
    return { group, tilt, ring, pitch, brake };
  }
  const main = makeBike(0x2b80dd, 1);
  const bike = main.group;
  const halo = main.ring;
  const ghost = makeBike(0xa35ce0, 0.45);
  ghost.group.visible = false;
  // Pone una moto en su sitio de la trazada; devuelve el rumbo.
  function placeBike(b: Bike, s: number, leanDeg: number, side: number): number {
    const P = track.full || C;
    const p = pointAt(P, s);
    const q = pointAt(P, s + 4);
    const heading = Math.atan2(q.y - p.y, q.x - p.x);
    const w = W(p.x, p.y);
    // El fantasma va un poco desplazado a un lado para que no se monten cuando van juntos.
    b.group.position.set(w[0] - Math.sin(heading) * side, 0, w[1] + Math.cos(heading) * side);
    b.group.rotation.y = -heading;
    b.tilt.rotation.x = ((Number.isNaN(leanDeg) ? 0 : leanDeg) * Math.PI) / 180;
    return heading;
  }

  const view: ViewState = {
    mode: "casco",
    init: false,
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    roll: 0,
  };

  // pose: { s (m desde meta), lean (grados, + derecha), v }. Se va por la trazada ideal.
  // ghostPose (opcional): { s, lean } de la moto fantasma (otra vuelta a la misma hora de vuelta).
  function update(pose: Vista3DPose, dt?: number, ghostPose?: Vista3DGhostPose | null): void {
    const P = track.full || C;
    const p = pointAt(P, pose.s);
    const heading = placeBike(main, pose.s, pose.lean, 0);
    // Con extras: el caballito (sobre la rueda de atrás) y la luz de freno.
    if (main.pitch)
      main.pitch.rotation.z =
        ((Number.isFinite(pose.pitch) ? (pose.pitch as number) : 0) * Math.PI) / 180;
    if (main.brake) main.brake.material.color.setHex(pose.brake ? BRAKE_ON : BRAKE_OFF);
    const w = W(p.x, p.y);
    const leanRad = ((Number.isNaN(pose.lean) ? 0 : pose.lean) * Math.PI) / 180;
    halo.visible = view.mode === "arriba";
    bike.visible = view.mode !== "casco";
    ghost.group.visible = !!ghostPose;
    if (ghostPose) {
      placeBike(ghost, ghostPose.s, ghostPose.lean, 1.2);
      ghost.ring.visible = view.mode === "arriba";
    }
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    // Las cámaras van atadas a puntos del trazado (no persiguen a la moto con retraso):
    // a ×4 un seguimiento suavizado se quedaba 40 m atrás y cruzaba las barreras.
    const along = (ds: number, y: number): THREE.Vector3 => {
      const q2 = pointAt(P, pose.s + ds);
      const a = W(q2.x, q2.y);
      return new THREE.Vector3(a[0], y, a[1]);
    };
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    let roll = 0;
    if (view.mode === "arriba") {
      pos = along(-90, 230);
      look = along(45, 0);
    } else if (view.mode === "detras") {
      pos = along(-13, 5);
      look = along(24, 1);
    } else {
      // Casco: la cabeza se desplaza hacia dentro de la curva y mira hacia donde va la moto.
      const rx = -fz;
      const rz = fx;
      const side = Math.sin(leanRad) * 1.05;
      const up = 0.45 + Math.cos(leanRad) * 1.05;
      pos = new THREE.Vector3(w[0] + fx * 0.25 + rx * side, up, w[1] + fz * 0.25 + rz * side);
      look = along(Math.max(18, (pose.v || 20) * 0.9), 0.9);
      // El piloto endereza algo la cabeza: el horizonte gira menos que la moto.
      roll = -leanRad * 0.55;
    }
    // Solo se suaviza el giro del horizonte; posición y mirada siguen exactas a la moto.
    const k = 1 - Math.exp(-(dt || 0.016) / 0.12);
    view.pos.copy(pos);
    view.look.copy(look);
    view.roll = view.init ? view.roll + (roll - view.roll) * k : roll;
    view.init = true;
    camera.position.copy(view.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(view.look);
    if (view.mode === "casco") camera.rotateZ(view.roll);
    renderer.render(scene, camera);
  }

  function resize(): void {
    const w = container.clientWidth || 400;
    const h = container.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fovFor(view.mode, camera.aspect);
    camera.updateProjectionMatrix();
  }
  // Un modo desconocido (de quien no use los tipos) se queda en el casco.
  function setMode(m: Vista3DMode): void {
    view.mode = FOV[m] ? m : "casco";
    view.init = false;
    camera.fov = fovFor(view.mode, camera.aspect);
    camera.updateProjectionMatrix();
  }
  function dispose(): void {
    scene.traverse((o) => {
      // Solo las mallas tienen geometría y material.
      const m = o as AnyMesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  }
  let ro: ResizeObserver | null = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  }
  resize();
  return {
    update,
    resize,
    setMode,
    setBrakes,
    dispose: () => {
      if (ro) ro.disconnect();
      dispose();
    },
    get mode() {
      return view.mode;
    },
    // Para pruebas: dónde está la cámara y hacia dónde mira.
    debug: () => ({
      pos: camera.position.toArray().map((x) => Math.round(x * 10) / 10),
      look: view.look.toArray().map((x) => Math.round(x * 10) / 10),
      bike: bike.position.toArray().map((x) => Math.round(x * 10) / 10),
      fov: camera.fov,
    }),
  };
}
