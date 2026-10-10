// Tipos de los tramos de carretera (localStorage «pista-tramos») y de las posiciones de una grabación.

export type LatLon = [number, number];

// Posiciones del GPS de una grabación (columnas de la serie «loc»).
export interface LocSeries {
  t: ArrayLike<number>;
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
  speed: ArrayLike<number>;
  hacc: ArrayLike<number>;
}

// Una pasada recién medida (en el reloj de la grabación).
export interface PassResult {
  t0: number;
  t1: number;
  tiempo: number;
  // Tiempo desde la salida en cada marca de 20 m (la primera, 0).
  tiempos: number[];
  // km/h
  vMax: number;
  // Dónde empieza cada frenada (m desde la salida) y su pico (g), del acelerómetro.
  frenos?: [number, number][];
}

// Una pasada guardada en su tramo.
export interface StoredPass {
  sesion: string | null;
  fecha: string;
  tiempo: number;
  vMax: number;
  tiempos: number[];
  frenos?: [number, number][];
}

export interface Tramo {
  id: string;
  nombre: string;
  creado?: string;
  // Camino (de una ruta guardada como tramo, o aprendido en la primera pasada de uno de salida y meta).
  largo?: number;
  pts?: LatLon[];
  // Salida y meta (tramos puestos con coordenadas o marcados rodando).
  salida?: LatLon;
  meta?: LatLon;
  pasadas: StoredPass[];
}

// Un tramo con camino.
export type PathTramo = Tramo & { pts: LatLon[] };
// Un tramo de salida y meta.
export type GateTramo = Tramo & { salida: LatLon; meta: LatLon };

// Lo que enseña el panel de un tramo en marcha.
export type TramoEstado =
  | { en: false }
  | {
      en: true;
      gate?: true;
      t0: number;
      tiempo: number;
      // m desde la salida (null: tramo de salida y meta aún sin camino).
      s: number | null;
      tFix: number;
      frac: number | null;
      // m a la meta en línea recta (tramos de salida y meta).
      dMeta?: number;
    };
