// Tipos de lo que guarda el móvil (IndexedDB «pista») y de la subida al garaje del Mac.
import type { Chunk, ColumnOf, SeriesKey } from "../core/formato";

// Marcas de la cola de subida en cada registro guardado.
export interface QueueMarks {
  // 1 mientras falta subirlo al Mac. Solo los pendientes la tienen: el índice «pend» es la cola.
  pend?: 1;
  // Código con que el Mac no lo aceptó (400, 413): se queda en el móvil y no se vuelve a subir.
  rechazo?: number;
}

// Resumen de una tanda (lo escribe el directo: inicio, vueltas, análisis…). Al almacén solo le importan el id y el
// estado; lo demás se guarda y se sube tal cual.
export interface SessionMeta {
  id: string;
  // «grabando», «terminada» o «cortada» (la página se cerró grabando).
  estado?: string;
  [field: string]: unknown;
}

// Una tanda guardada.
export type StoredSession = SessionMeta & QueueMarks;

// Campos que cambiar en una tanda guardada (undefined: se quita).
export type SessionPatch = Partial<SessionMeta>;

// Las columnas de un trozo como las guarda el móvil: Float64Array (lo grabado en directo) o arrays (lo importado o
// recortado), con null donde no hay dato.
export type RecordedSeries = { [K in SeriesKey]?: Record<ColumnOf<K>, ArrayLike<number | null>> };

// Un trozo de grabación (formato.ts) tal como lo guarda el móvil.
export type RecordedChunk = Omit<Chunk, "series"> & { series: RecordedSeries };

// Un trozo guardado.
export type StoredChunk = RecordedChunk & QueueMarks;

export interface PendingCounts {
  trozos: number;
  sesiones: number;
}

// La cola de subida: lo pendiente, por orden, y marcar lo ya subido.
export interface UploadQueue {
  // El primer trozo pendiente (por tanda y número de trozo), o undefined si no queda ninguno.
  nextChunk(): Promise<StoredChunk | undefined>;
  // Los resúmenes pendientes, por id.
  pendingSessions(): Promise<StoredSession[]>;
  session(id: string): Promise<StoredSession | undefined>;
  // Lo guarda sin la marca de pendiente (con el código, si el Mac no lo quiso).
  markChunkDone(rec: StoredChunk, status?: number): Promise<void>;
  markSessionDone(rec: StoredSession, status?: number): Promise<void>;
}

// El garaje del Mac emparejado: su dirección (https, o http en el propio Mac) y la clave de este móvil.
export interface GarageConfig {
  u: string;
  k: string;
}

// off: sin garaje · busy: conectando · ok · offline: no contesta o falla (se reintenta) · auth: clave no válida.
export type SyncStatus = "off" | "ok" | "offline" | "auth" | "busy";

// Estado de la subida: siempre el mismo objeto (la interfaz lo lee y pone onChange para enterarse de cada cambio).
export interface SyncState {
  cfg: GarageConfig | null;
  state: SyncStatus;
  // Cuándo se habló bien con el Mac por última vez (ms de época).
  lastOk: number | null;
  // Por qué no se puede subir, en palabras del piloto.
  lastError: string;
  running: boolean;
  // Espera tras un fallo (ms: se dobla en cada uno, hasta 5 min) y cuándo vuelve a probar el bucle.
  wait: number;
  nextTry: number;
  onChange: (() => void) | null;
}

// Temporizadores (como setTimeout y setInterval): cada uno devuelve con qué cancelarlo.
export interface Timers {
  after(ms: number, fn: () => void): () => void;
  every(ms: number, fn: () => void): () => void;
}

// Lo que se usa de navigator.storage (en navegadores viejos falta, o le faltan métodos).
export interface StorageLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

// Lo que el almacén toma del navegador (en las pruebas, falsos).
export interface StoreDeps {
  // window.indexedDB; sin ella, open() falla («sin IndexedDB»).
  indexedDB: IDBFactory | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  timers: Timers;
  // Reloj (ms de época), como Date.now.
  now: () => number;
  // Para mandar comprimido (gzip); sin él, el JSON va tal cual.
  compression: typeof CompressionStream | undefined;
  storage: StorageLike | undefined;
}
