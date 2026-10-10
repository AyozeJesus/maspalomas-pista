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
// ideal (alineada índice a índice con el eje).
export interface Vista3DTrack {
  C: readonly Vista3DPoint[];
  N: readonly Vista3DPoint[];
  cs: ArrayLike<number>;
  L: number;
  full?: readonly Vista3DPoint[] | null;
}

// Una curva: índice de su vértice en el eje (lleva pianos por dentro y por fuera).
export interface Vista3DCorner {
  i?: number;
}

// Curvas y límites de sector (m desde meta, franjas amarillas).
export interface Vista3DOptions {
  corners?: readonly Vista3DCorner[] | null;
  bounds?: readonly number[] | null;
}

// s (m desde meta), lean (grados, + derecha) y v (m/s; aleja la mirada desde el casco).
export interface Vista3DPose {
  s: number;
  lean: number;
  v?: number;
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
  // Centro del circuito como origen (números pequeños para la GPU).
  let cx = 0;
  let cy = 0;
  for (const p of C) {
    cx += p[0] / n;
    cy += p[1] / n;
  }
  const W = (x: number, y: number): [number, number] => [x - cx, y - cy];

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
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshLambertMaterial({ color: 0xd9cba8 }),
  );
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (colorAt) geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }
  const loop: number[] = [];
  for (let i = 0; i <= n; i++) loop.push(i % n);
  const half = WIDTH / 2;
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
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = W(C[i][0] + N[i][0] * d, C[i][1] + N[i][1] * d);
      const b = W(C[j][0] + N[j][0] * d, C[j][1] + N[j][1] * d);
      pos.push(a[0], 0, a[1], b[0], 0, b[1], a[0], 0.9, a[1]);
      pos.push(a[0], 0.9, a[1], b[0], 0, b[1], b[0], 0.9, b[1]);
    }
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

  // Puntos sobre el trazado por distancia s (eje o trazada ideal).
  function pointAt(P: readonly Vista3DPoint[], s: number): { x: number; y: number; i: number } {
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
  // Línea de meta y de sectores (franjas a lo ancho). Nadie pasa `w` y la escala ya es 1: esa línea no hace nada
  // (venía así de antes).
  function gate(s: number, color: number, w?: number): void {
    const p = pointAt(C, s);
    const i = p.i;
    const j = (i + 1) % n;
    const g = new THREE.Mesh(ribbon(C, N, [i, j], -half, half, 0.04, null), flat(color));
    if (w) g.scale.set(1, 1, 1);
    scene.add(g);
  }
  gate(0, 0xffffff);
  for (const b of opts.bounds || []) gate(b, 0xf2c230);
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
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 0.62), mat(color));
    body.position.set(0, 0.85, 0);
    tilt.add(body);
    const rider = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.5), mat(0xf4f6f7));
    rider.position.set(-0.25, 1.45, 0);
    tilt.add(rider);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat(color));
    head.position.set(0.25, 1.85, 0);
    tilt.add(head);
    const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18);
    const wheelMat = mat(0x1a1d20);
    for (const x of [-0.78, 0.78]) {
      const w = new THREE.Mesh(wheel, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.33, 0);
      tilt.add(w);
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
    return { group, tilt, ring };
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
