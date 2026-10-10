// Grabaciones de verdad enteras (el resumen y todas las series, no solo las posiciones), solo si están en este
// ordenador (PISTA_DATA, como realRide). Nunca se copian al repo: llevan la posición de quien graba.
import { realRide, type Loc } from "./fixtures";

// Una serie de tres ejes del móvil: aceleración sin la gravedad (acc), giro (gyro) o gravedad (grav).
export interface Axes {
  t: number[];
  x: (number | null)[];
  y: (number | null)[];
  z: (number | null)[];
}

// Una curva del resumen de una ruta (lo que calcula el móvil al terminarla).
export interface RouteCorner {
  num: number;
  lean: number | null;
  vEntry: number | null;
  vMin: number | null;
  brakeG: number | null;
  dead: number | null;
}

export interface Recording {
  meta: {
    id: string;
    epoch: number;
    tipo?: string;
    // Vertical de la moto puesta con «Calibrar» (ejes del móvil), si se calibró a mano.
    calibracionManual?: number[] | null;
    recorrido?: {
      distancia: number;
      duracion: number;
      punta: number;
      inclDerecha: number;
      inclIzquierda: number;
      listaCurvas?: RouteCorner[];
    } | null;
  };
  series: {
    loc?: Loc;
    acc?: Axes;
    gyro?: Axes;
    grav?: Axes;
    canal?: Record<string, (number | null)[]>;
  };
}

// Las grabaciones de verdad del 9 de octubre (vivo-datos/): cuatro rutas y una sin GPS.
export const REAL_FILES = [
  "20261009-163105-bn2o.json",
  "20261009-170613-a0l8.json",
  "20261009-171527-csvc.json",
  "20261009-172312-eck7.json",
  "20261009-183824-woqw.json",
];

// Leída una sola vez por archivo de pruebas (las hay de 15 MB).
const cache = new Map<string, Recording | null>();

export function realRecording(file: string): Recording | null {
  let r = cache.get(file);
  if (r === undefined) {
    r = realRide(file) as Recording | null;
    cache.set(file, r);
  }
  return r;
}
