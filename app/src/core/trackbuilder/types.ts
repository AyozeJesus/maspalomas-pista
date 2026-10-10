// Tipos del constructor de circuitos: las posiciones que recibe, el circuito que devuelve y los mensajes de su worker.

// Un valor de una posición tal como llega: número, texto (de un CSV), null (un NaN guardado en JSON) o nada.
export type FixValue = number | string | null | undefined;

// Una posición del GPS: t (s), lat, lon, speed (m/s) y hacc (m).
export interface FixRecord {
  t?: FixValue;
  lat?: FixValue;
  lon?: FixValue;
  speed?: FixValue;
  hacc?: FixValue;
}

// Las mismas posiciones en columnas (la serie «loc» de una grabación o Location.csv); speed y hacc pueden faltar.
export interface FixColumns {
  t: ArrayLike<FixValue>;
  lat: ArrayLike<FixValue>;
  lon: ArrayLike<FixValue>;
  speed?: ArrayLike<FixValue> | null;
  hacc?: ArrayLike<FixValue> | null;
}

// Lo que acepta el constructor: la lista de posiciones, en orden de tiempo, o sus columnas (cualquier otra cosa
// cuenta como ninguna posición).
export type FixesInput = readonly (FixRecord | null | undefined)[] | FixColumns | null | undefined;

export type LatLon = [number, number];

// Un punto de un eje dibujado o importado: [lat, lon] o {lat, lon}.
export type CenterlinePoint = readonly FixValue[] | { lat?: FixValue; lon?: FixValue };

// minLaps: vueltas iguales que hacen falta (2); spacing: metros entre puntos del eje (2, de 0,5 a 20); name: nombre
// del circuito («Circuito nuevo»).
export interface BuildOptions {
  minLaps?: number | null;
  spacing?: number | null;
  name?: string | null;
}

export type CornerSide = "izquierda" | "derecha";
export type Direction = "antihorario" | "horario";

// Una curva: su vértice (punto i del eje, a s m de meta), hacia dónde gira, su radio (m), el giro total (°) y su
// sector.
export interface TrackCorner {
  i: number;
  s: number;
  side: CornerSide;
  radius: number;
  turn: number;
  sector: number;
}

// Un circuito construido: eje [[lat, lon]] (cerrado, en el sentido de marcha, cada `spacing` m, índice 0 = meta),
// longitud (m), sentido, curvas por s, límites de sector (el k-ésimo abre el sector de la k-ésima curva o grupo), las
// vueltas con que se ha dibujado y la dispersión de sus puntos alrededor del eje (m).
export interface Track {
  name: string;
  origin: { lat: number; lon: number };
  centerline: LatLon[];
  length: number;
  direction: Direction;
  startIndex: number;
  corners: TrackCorner[];
  sectorBounds: number[];
  laps: number;
  quality: { spread: number };
}

// Lo que hace falta de un circuito para cronometrar sus vueltas (vale también uno guardado).
export interface TrackShape {
  origin: { lat: number; lon: number };
  centerline: readonly (readonly [number, number])[];
  length: number;
}

// Lo que hace falta de un circuito para moverle la meta.
export interface RotatableTrack {
  centerline: LatLon[];
  length: number;
  corners: TrackCorner[];
  sectorBounds: number[];
}

// Una vuelta cronometrada: de t0 a t1 (s, el reloj de las posiciones), su tiempo y los metros recorridos.
export interface TimedLap {
  t0: number;
  t1: number;
  time: number;
  dist: number;
}

// Mensajes del worker: se le pide {id, fixes, name} y responde {id, track} o {id, error} (el mensaje para el piloto).
export interface BuildRequest {
  id: number;
  fixes: FixesInput;
  name?: string;
}

export type BuildResponse = { id?: number; track: Track } | { id?: number; error: string };
