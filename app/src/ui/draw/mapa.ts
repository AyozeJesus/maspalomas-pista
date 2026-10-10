// Mapa 2D del recorrido en un canvas: la línea de trazada coloreada (fases o inclinación), la posición actual,
// el circuito si lo hay (con sectores y frenadas de la mejor vuelta) y marcas por curva.
// Coordenadas en metros locales (x hacia el este, y hacia el sur, como T.toLocal).

export const PHASE = {
  freno: "#ff5b4f",
  gas: "#22c35f",
  muerto: "#f2b300",
  mantiene: "#5aa5f0",
};
const WHEELIE = "#d08bff";
const SECTOR = {
  best: "#a86ff0",
  good: "#22c35f",
  bad: "#f2c230",
};

// Fases de la trazada y estados de un sector que tienen color.
export type Phase = keyof typeof PHASE;
export type SectorState = keyof typeof SECTOR;
// Color de la trazada: por fases (frena, acelera…) o por inclinación.
export type ColorBy = "fase" | "incl";

// Las mismas tablas, para buscar con un nombre cualquiera (uno sin color da undefined, como en la de antes).
const PHASE_BY_NAME: Readonly<Record<string, string | undefined>> = PHASE;
const SECTOR_BY_NAME: Readonly<Record<string, string | undefined>> = SECTOR;

// Un punto [x, y] en metros.
export type XY = readonly [number, number];

// Un punto de la trazada (los de Recorrido llevan además t y v, que el mapa no usa).
export interface MapTrailPoint {
  x: number;
  y: number;
  // Fase en ese punto (freno, gas, muerto, mantiene); otra o ninguna se pinta como «mantiene».
  ph?: string;
  // Inclinación en grados (+ derecha; NaN sin calibrar).
  lean?: number;
  // Con la rueda de delante en el aire (caballito).
  wh?: boolean;
  // Primer punto tras un hueco sin GPS: no se une con el anterior.
  gap?: boolean;
}

// Un sector del circuito: su trozo del trazado y cómo ha ido (sin estado, o con uno sin color, no se pinta).
export interface MapSector {
  pts: readonly XY[];
  state?: string | null;
}

// Marca con texto: la inclinación máxima de una curva…
export interface MapMark {
  x: number;
  y: number;
  text: string;
}

// Punto señalado: el corte de una ruta, dónde se empieza a frenar…
export interface MapDot {
  x: number;
  y: number;
  // Blanco si no lleva.
  color?: string;
  // Letra o palabra al lado.
  label?: string;
  // Radio en píxeles (7).
  r?: number;
  // Solo el aro, del color (para que se vea otro punto debajo).
  ring?: boolean;
}

// Dónde va la moto. heading: rumbo en radianes (como atan2(dy, dx)); null o sin él, aún sin rumbo.
export interface MapPos {
  x: number;
  y: number;
  heading?: number | null;
}

// Tamaño para pintar fuera de la pantalla (la imagen para compartir), en píxeles, y su densidad (1).
export interface MapSize {
  w: number;
  h: number;
  dpr?: number;
}

export interface MapDrawOptions {
  trail?: readonly MapTrailPoint[];
  // Trazado del circuito (se cierra solo) y su ancho de pista en m (12).
  outline?: readonly XY[];
  width?: number;
  // Sectores y frenadas de la mejor vuelta, sobre el trazado (sin trazado no se pintan).
  sectors?: readonly MapSector[];
  brakes?: readonly XY[];
  pos?: MapPos | null;
  // Siguiendo a la moto (centrada, la dirección de marcha hacia arriba), con `span` m en el lado corto (500).
  follow?: boolean;
  span?: number;
  colorBy?: ColorBy;
  marks?: readonly MapMark[];
  dots?: readonly MapDot[];
  // Fuera de la pantalla; sin él, el tamaño del canvas en pantalla con la densidad del móvil.
  size?: MapSize;
}

// La vista pintada: toPx(x, y) → [px, py] en el canvas y toWorld(px, py) → [x, y] (para saber qué se toca), y la
// escala (píxeles por metro) y densidad.
export interface MapView {
  scale: number;
  dpr: number;
  toPx: (x: number, y: number) => [number, number];
  toWorld: (px: number, py: number) => [number, number];
}

// Color de la inclinación (grados, con signo); sin dato, gris.
export function leanColor(l: number | undefined): string {
  // Number(): lo mismo que hace Math.abs con lo que le llega en la de antes (undefined → NaN).
  const a = Math.abs(Number(l));
  if (!(a >= 0)) return "#6c7880";
  if (a < 15) return "#8a969e";
  if (a < 30) return "#5aa5f0";
  if (a < 40) return "#22c35f";
  if (a < 50) return "#f2b300";
  return "#ff5b4f";
}

export function colorOf(p: MapTrailPoint, by?: ColorBy): string {
  if (by === "incl") return leanColor(p.lean);
  if (p.wh) return WHEELIE;
  return (p.ph !== undefined && PHASE_BY_NAME[p.ph]) || PHASE.mantiene;
}

interface Prepared {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
}

// Ajusta el canvas a su tamaño en pantalla (con la densidad del móvil) y devuelve su contexto. size: {w, h, dpr}
// para pintar fuera de la pantalla (la imagen para compartir), en píxeles.
function prepare(canvas: HTMLCanvasElement, size: MapSize | undefined): Prepared {
  const dpr = size ? size.dpr || 1 : Math.min(3, window.devicePixelRatio || 1);
  const w = size ? size.w : Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = size ? size.h : Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  if (!g) throw new Error("El canvas del mapa no tiene contexto 2D");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h, dpr };
}

// Un punto como objeto {x, y} (la trazada) o como par [x, y] (el trazado del circuito).
interface AnyPoint {
  readonly x?: number;
  readonly y?: number;
  readonly 0?: number;
  readonly 1?: number;
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bboxOf(lists: readonly (readonly AnyPoint[])[]): BBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const pts of lists)
    for (const p of pts) {
      const x = p.x !== undefined ? p.x : p[0];
      const y = p.y !== undefined ? p.y : p[1];
      // Sin coordenada (undefined) no cuenta: en la de antes, la comparación con undefined daba false.
      if (x !== undefined && x < x0) x0 = x;
      if (y !== undefined && y < y0) y0 = y;
      if (x !== undefined && x > x1) x1 = x;
      if (y !== undefined && y > y1) y1 = y;
    }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

// Pinta el mapa. Devuelve la vista (MapView); nada si no había qué pintar.
export function draw(canvas: HTMLCanvasElement, o: MapDrawOptions): MapView | undefined {
  const { g, w, h, dpr } = prepare(canvas, o.size);
  const pad = 14 * dpr;
  // Vista: siguiendo (centrada en la moto, la dirección de marcha hacia arriba) o el recorrido entero.
  let scale: number;
  let cx: number;
  let cy: number;
  let rot = 0;
  if (o.follow && o.pos) {
    scale = (Math.min(w, h) - 2 * pad) / (o.span || 500);
    cx = o.pos.x;
    cy = o.pos.y;
    // Sin rumbo todavía (parado al empezar): norte arriba.
    rot = typeof o.pos.heading === "number" ? -o.pos.heading - Math.PI / 2 : 0;
  } else {
    const b = bboxOf([o.outline || [], o.trail || []]);
    if (!b) return undefined;
    const bw = Math.max(50, b.x1 - b.x0);
    const bh = Math.max(50, b.y1 - b.y0);
    scale = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
    cx = (b.x0 + b.x1) / 2;
    cy = (b.y0 + b.y1) / 2;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const oy = o.follow && o.pos ? h * 0.62 : h / 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const view: MapView = {
    scale,
    dpr,
    toPx: (x, y) => {
      const dx = (x - cx) * scale;
      const dy = (y - cy) * scale;
      return [dx * cr - dy * sr + w / 2, dx * sr + dy * cr + oy];
    },
    toWorld: (px, py) => {
      const rx = px - w / 2;
      const ry = py - oy;
      return [(rx * cr + ry * sr) / scale + cx, (-rx * sr + ry * cr) / scale + cy];
    },
  };
  g.translate(w / 2, oy);
  g.rotate(rot);
  g.scale(scale, scale);
  g.translate(-cx, -cy);
  const px = 1 / scale; // un píxel de pantalla en metros
  g.lineCap = "round";
  g.lineJoin = "round";
  // Visible: lo que cae cerca del centro (en modo seguir no hace falta pintar toda la isla).
  const reach = o.follow ? (Math.hypot(w, h) / scale) * 0.75 : Infinity;
  const near = (x: number, y: number) => Math.abs(x - cx) < reach && Math.abs(y - cy) < reach;

  if (o.outline && o.outline.length > 1) {
    g.strokeStyle = "rgba(255,255,255,0.13)";
    g.lineWidth = Math.max((o.width || 12) * 1, 7 * px * dpr);
    g.beginPath();
    o.outline.forEach((p, i) => {
      if (i) g.lineTo(p[0], p[1]);
      else g.moveTo(p[0], p[1]);
    });
    g.closePath();
    g.stroke();
    for (const s of o.sectors || []) {
      const color = s.state && SECTOR_BY_NAME[s.state];
      if (!color) continue;
      g.strokeStyle = color;
      g.globalAlpha = 0.55;
      g.lineWidth = 3 * px * dpr;
      g.beginPath();
      s.pts.forEach((p, i) => {
        if (i) g.lineTo(p[0], p[1]);
        else g.moveTo(p[0], p[1]);
      });
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const b of o.brakes || []) {
      g.fillStyle = PHASE.freno;
      g.beginPath();
      g.arc(b[0], b[1], 4 * px * dpr, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Línea de trazada: tramos seguidos del mismo color en un solo trazo.
  const tr = o.trail || [];
  g.lineWidth = 3.2 * px * dpr;
  let cur: string | null = null;
  let open = false;
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1];
    const b = tr[i];
    if (b.gap || !(near(a.x, a.y) || near(b.x, b.y))) {
      if (open) g.stroke();
      open = false;
      cur = null;
      continue;
    }
    const c = colorOf(b, o.colorBy);
    if (c !== cur || !open) {
      if (open) g.stroke();
      g.strokeStyle = c;
      g.beginPath();
      g.moveTo(a.x, a.y);
      cur = c;
      open = true;
    }
    g.lineTo(b.x, b.y);
  }
  if (open) g.stroke();

  // Marcas (inclinación máxima de cada curva…), por orden de importancia: una que caería encima de otra ya
  // pintada no se pinta (en curvas seguidas salían «4452°»).
  g.font = "bold " + 12 * px * dpr + "px Roboto, system-ui, sans-serif";
  const placed: [number, number, number, number][] = [];
  for (const m of o.marks || []) {
    if (!near(m.x, m.y)) continue;
    const [sx, sy] = view.toPx(m.x, m.y);
    const bw = g.measureText(m.text).width / px + 10 * dpr;
    const box: [number, number, number, number] = [
      sx - bw / 2,
      sy - 19 * dpr,
      sx + bw / 2,
      sy - 2 * dpr,
    ];
    if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]))
      continue;
    placed.push(box);
    g.save();
    g.translate(m.x, m.y);
    g.rotate(-rot);
    g.fillStyle = "rgba(5,6,7,0.8)";
    const tw = g.measureText(m.text).width + 8 * px * dpr;
    g.fillRect(-tw / 2, -18 * px * dpr, tw, 15 * px * dpr);
    g.fillStyle = "#f3f5f6";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(m.text, 0, -10.5 * px * dpr);
    g.restore();
  }

  // Puntos señalados (el corte de una ruta, dónde se empieza a frenar…): círculo con borde y su letra al lado. r:
  // radio en píxeles (7); ring: solo el aro, del color (para que se vea otro punto debajo).
  for (const d of o.dots || []) {
    g.save();
    g.translate(d.x, d.y);
    g.rotate(-rot);
    const r = (d.r || 7) * px * dpr;
    g.fillStyle = d.color || "#ffffff";
    g.strokeStyle = d.ring ? d.color || "#ffffff" : "#050607";
    g.lineWidth = (d.ring ? 2 : 2.5) * px * dpr;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    if (!d.ring) g.fill();
    g.stroke();
    if (d.label) {
      g.font = "bold " + 13 * px * dpr + "px Roboto, system-ui, sans-serif";
      g.textBaseline = "middle";
      g.lineWidth = 4 * px * dpr;
      // Borde oscuro a la letra (el de un aro es de su color).
      g.strokeStyle = "#050607";
      g.strokeText(d.label, r * 1.6, 0);
      g.fillStyle = "#f3f5f6";
      g.fillText(d.label, r * 1.6, 0);
    }
    g.restore();
  }

  // Posición: flecha en el sentido de marcha.
  if (o.pos) {
    g.save();
    g.translate(o.pos.x, o.pos.y);
    g.rotate((o.pos.heading || 0) + Math.PI / 2);
    const s = 9 * px * dpr;
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#050607";
    g.lineWidth = 2 * px * dpr;
    g.beginPath();
    g.moveTo(0, -s * 1.3);
    g.lineTo(s * 0.85, s);
    g.lineTo(0, s * 0.45);
    g.lineTo(-s * 0.85, s);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  return view;
}

// Una entrada de la leyenda: [texto, color].
export type LegendItem = [text: string, color: string];

// Los colores de la leyenda para el modo de color elegido.
export function legendItems(by?: ColorBy): LegendItem[] {
  return by === "incl"
    ? [
        ["< 15°", "#8a969e"],
        ["15–30°", "#5aa5f0"],
        ["30–40°", "#22c35f"],
        ["40–50°", "#f2b300"],
        ["50°+", "#ff5b4f"],
      ]
    : [
        ["frena", PHASE.freno],
        ["acelera", PHASE.gas],
        ["sin gas en curva", PHASE.muerto],
        ["mantiene", PHASE.mantiene],
        ["caballito", WHEELIE],
      ];
}

// Leyenda en HTML (texto y color) para el modo de color elegido.
export function legend(el: HTMLElement, by?: ColorBy): void {
  el.textContent = "";
  for (const [text, c] of legendItems(by)) {
    const s = document.createElement("span");
    s.textContent = text;
    s.style.setProperty("--c", c);
    el.appendChild(s);
  }
}

// Lo que la app cuelga de window.MaspaMapa, como la de antes. Es un objeto que se puede cambiar (las pruebas de
// siempre cambian funciones por espías) y compartir.ts llama a través de él, como hacía la de antes.
export const mapa = { draw, legend, legendItems, PHASE, leanColor, colorOf };
