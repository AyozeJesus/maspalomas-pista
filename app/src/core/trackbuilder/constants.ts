// Constantes del constructor de circuitos (las mismas que trackbuilder.js).

export const DEFAULTS: Readonly<{ minLaps: number; spacing: number; name: string }> = {
  minLaps: 2,
  spacing: 2,
  name: "Circuito nuevo",
};
export const DEG = Math.PI / 180;

// ---------- fijos y vueltas ----------
export const MOVING = 8; // m/s: más despacio es boxes, la salida de boxes o una parada
export const STOP_S = 8; // s seguidos por debajo de MOVING: parada (boxes, caída, bandera roja)
export const MAX_HACC = 30; // m: un fijo con más error que esto no ayuda a dibujar nada
export const GATE_HALF = 20; // m: medio ancho de la línea que cuenta las pasadas (pista + error del GPS)
export const GATE_COS = Math.cos(40 * DEG); // misma dirección de marcha que la línea (±40°)
export const CROSS_V = 5; // m/s mínimos al cruzar una línea
export const MIN_LOOP = 150; // m: menos que esto no es una vuelta, ni en un kart
export const LAP_TOL = 0.06; // misma longitud (±6 %): fuera atajos, salidas de pista y vueltas con paso por boxes
export const SLOW_PASS = 0.5; // pasada por la línea a menos de la mitad de la velocidad típica: calle de boxes
export const MAX_FOLDS = 6; // grupos de vueltas para elegir el suavizado (validación cruzada)

// ---------- eje ----------
export const ORDER = 2; // segundas diferencias (curvatura): una recta sale gratis, como en un spline cúbico
export const BW_MIN = 1; // m: ancho de banda equivalente del suavizado (con la densidad media de fijos), del más fino…
export const BW_MAX = 120; // m: …al más fuerte
export const DENS_WIN = 10; // m a cada lado para medir la densidad de fijos
export const DENS_POW = 3; // peso ∝ 1/densidad³: ancho de banda ∝ distancia entre fijos
export const DENS_FLOOR = 0.05; // densidad mínima (fracción de la media): un hueco sin fijos no se suaviza sin límite
export const HP_M = 100; // m: escala de la deriva del GPS que no cuenta al elegir el suavizado
export const MAX_SPREAD = 15; // m: más dispersión es que las vueltas no son el mismo recorrido
export const MIN_LEN = 200; // m: un kart pequeño
export const MAX_LEN = 25000; // m: el Nordschleife
export const CROSS_COS = Math.cos(30 * DEG); // un cruce a distinto nivel (puente) corta en ángulo franco
export const CROSS_GAP = 150; // m de eje entre los dos pasos de un cruce de verdad

// ---------- curvas, rectas y sectores ----------
export const CORNER_R = 150; // m: radio mínimo por debajo del cual hay que frenar o cortar gas
export const STRAIGHT_R = 300; // m: por encima, recta a efectos de trazado
export const MIN_TURN = 40 * DEG; // giro total: menos es un quiebro que se pasa sin cambiar de dirección
export const MERGE_M = 60; // m entre vértices: una sola curva (chicane, doble vértice)
export const SECTOR_GAP = 40; // m de recta entre dos curvas para cortar sector entre ellas
