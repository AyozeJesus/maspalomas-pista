// Tipos del lector de telemetría de GoPro (GPMF): el acceso a los bytes del vídeo, la telemetría en bruto que sale de
// él y la tanda para el análisis.

// Lo que devuelve una lectura: un Uint8Array, o algo con lo que hacer uno (un ArrayBuffer, una lista de bytes).
export type ReadBytes = Uint8Array | ArrayBuffer | ArrayLike<number>;

// Acceso a trozos del vídeo sin cargarlo entero: bufferReader, fileReader o uno propio (con o sin promesa).
export interface ByteReader {
  readonly size: number;
  read(offset: number, length: number): ReadBytes | PromiseLike<ReadBytes>;
}

export interface ExtractOptions {
  // Parte leída, de 0 a 1.
  onProgress?: (fraction: number) => void;
}

// Una serie de tres ejes de la cámara: acelerómetro (m/s², con la gravedad) o giroscopio (rad/s).
export interface ImuSeries {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

// Posiciones del GPS: lat/lon en grados, alt en m, speed (2D) en m/s, fix (0 sin fijo, 2 = 2D, 3 = 3D) y DOP.
export interface GpsSeries {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
  speed: Float64Array;
  fix: Float64Array;
  dop: Float64Array;
}

// Telemetría en bruto del vídeo, con t en segundos de la línea del vídeo (0 = primer fotograma).
export interface GpmfData {
  // Modelo (MINF del udta o DVNM del dispositivo).
  camera: string | null;
  // s
  duration: number;
  // ms UTC de creación del archivo (reloj de la cámara, a menudo en hora local), o null si no es creíble.
  created: number | null;
  // ms UTC del primer fijo, y su t en el vídeo.
  gpsStartUtc: number | null;
  gpsStartT: number;
  gps: GpsSeries;
  acc: ImuSeries | null;
  gyro: ImuSeries | null;
  // Orientación de los ejes del acelerómetro y del giroscopio (ORIN, p. ej. «ZXY»).
  orin: string | null;
  warnings: string[];
}

// Columnas sueltas de tres ejes (Float64Array o arrays normales).
export interface ImuLike {
  t: ArrayLike<number>;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
}

// Lo que convierte toSession: la salida de extract o datos montados a mano (sin fix, DOP ni velocidad también vale).
export interface SessionSource {
  gps?: {
    t?: ArrayLike<number>;
    lat?: ArrayLike<number>;
    lon?: ArrayLike<number>;
    speed?: ArrayLike<number>;
    fix?: ArrayLike<number>;
    dop?: ArrayLike<number>;
  } | null;
  acc?: ImuLike | null;
  gyro?: ImuLike | null;
  warnings?: readonly string[] | null;
  duration?: number;
  created?: number | null;
  gpsStartUtc?: number | null;
  gpsStartT?: number;
}

export interface ToSessionOptions {
  // Hz a los que se reduce el acelerómetro y el giroscopio (100 si no se dice; 0 o menos, sin reducir).
  imuHz?: number;
}

// Tanda como las del móvil, lista para el análisis.
export interface GoproSession {
  loc: {
    t: Float64Array;
    lat: Float64Array;
    lon: Float64Array;
    speed: Float64Array;
    // Precisión aproximada (m), sacada del DOP.
    hacc: Float64Array;
    bearing: null;
  };
  // Aceleración sin la gravedad, la gravedad y el giro (solo si el vídeo trae acelerómetro y giroscopio).
  acc?: ImuSeries;
  grav?: ImuSeries;
  gyro?: ImuSeries;
  warnings: string[];
  source: "gopro";
  videoDuration: number | undefined;
  // ms UTC del instante 0 del vídeo, o null.
  startUtc: number | null;
}
