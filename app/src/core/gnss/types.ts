// Lo que sale del lector de los receptores GNSS externos (RaceBox, NMEA o el perfil Bluetooth estándar).

// De dónde sale el fijo: trama del RaceBox, frases NMEA o el binario de «Location and Speed» (0x2A67).
export type GnssSource = "racebox" | "nmea" | "lns";

// 0 sin posición, 2 = 2D, 3 = 3D.
export type FixQuality = 0 | 2 | 3;

// Un fijo del receptor. NaN (o null) en lo que el receptor no da.
export interface GnssFix {
  source: GnssSource;
  // Hora UTC en ms (con decimales), o null si no la da o no tiene sentido.
  utcMs: number | null;
  lat: number; // grados
  lon: number; // grados
  speed: number; // m/s
  heading: number; // grados, [0, 360)
  hacc: number; // m
  fix: FixQuality;
  sats: number;
  altitude: number; // m sobre el nivel del mar
  gforce: [number, number, number] | null; // g (RaceBox)
  gyro: [number, number, number] | null; // grados/s (RaceBox)
  battery: number | null; // % (RaceBox)
  // performance.now() de su llegada al móvil, si se pasó a push().
  recvMs?: number;
}

// Contadores del lector: tramas leídas, sumas de control que no cuadran y tramas saltadas (otros mensajes).
export interface ParserInfo {
  frames: number;
  badChecksum: number;
  skipped: number;
}

// Lo mismo y los bytes que esperan a que llegue el resto de su trama.
export interface ParserStats extends ParserInfo {
  buffered: number;
}

// Bytes tal como llegan (BLE, USB) o como los da una prueba.
export type BytesLike = ArrayBufferView | ArrayBuffer | ArrayLike<number>;
