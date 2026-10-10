// Constantes de la telemetría del circuito.
import type { Pillars } from "./types";

// Gravedad estándar (la del modelo de vuelta, MaspaSim.G, es 9,81).
export const G = 9.80665;
// Rejilla de tiempo del análisis con sensores del móvil (Hz).
export const GRID_HZ = 50;
// Rejilla de distancia de las vueltas (m).
export const STEP_M = 2;
// Distancia máxima al eje para dar un fijo por «en pista»: medio ancho (6 m) + trazada por fuera en los
// cruces + lo que se desvía un GPS de móvil de una frecuencia durante varios segundos. Un fijo que salta
// lo descarta además la comprobación de avance (segmentsOnTrack).
export const ON_TRACK_M = 20;
// Pilares del objetivo del modelo (la confianza se calibra para el tiempo pedido).
export const OBJ: Omit<Pillars, "conf"> = { exit: 1, coast: 0, width: 1 };
