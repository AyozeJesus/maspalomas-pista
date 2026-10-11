// Lo que guarda el garaje y lo que contesta a sus páginas: los tipos que comparten el servidor (garaje/server) y las
// páginas (garaje/web). Solo tipos: nada de esto llega al navegador.
import type { DiaComparativa } from "../app/src/core/comparativa";
import type { CsvFile } from "../app/src/core/formato";
import type { CornerMetrics, Dir, LeanSource } from "../app/src/core/maspalomas/types";

// ---------- lo que manda el móvil ----------

// Lo que el móvil resume de una ruta libre (meta.recorrido): distancia, inclinaciones y frenadas. El informe de la IA
// usa las frenadas también en las tandas de circuito.
export interface RecorridoMeta {
  distancia?: number;
  inclDerecha?: number;
  inclIzquierda?: number;
  frenadas?: number;
  frenadaMax?: number;
  mordidaMejor?: number;
  hundimientoMax?: number;
  frenadaTumbadoMax?: number;
}

// Una ruta libre por un circuito cualquiera (meta.circuito): su nombre y sus vueltas.
export interface CircuitoMeta {
  nombre?: string;
  vueltas?: { valid?: boolean }[];
  mejor?: number | null;
}

// meta.json de una tanda: el resumen que manda el móvil (formato.checkMeta solo exige v, id, epoch y vueltas), con la
// hora a la que llegó. Lo demás puede faltar o venir de una versión vieja de la app: se lee comprobándolo.
export interface MetaTanda {
  v?: number;
  id?: string;
  epoch?: number;
  inicio?: string;
  fin?: string | null;
  // «grabando», «terminada» o «cortada».
  estado?: string;
  sim?: boolean;
  // «ruta» (ruta libre) o «pista» (circuito; las de antes no lo traen).
  tipo?: string;
  // «gopro»: importada en el Mac desde un vídeo; si no, del móvil.
  fuente?: string;
  piloto?: string | null;
  // Objetivo por vuelta del piloto (s).
  objetivo?: number | null;
  sentido?: string;
  mejor?: number | null;
  vueltas?: unknown[];
  // Línea de meta del móvil: índice del eje en cada sentido.
  meta?: { osm?: number; rev?: number } | null;
  recorrido?: RecorridoMeta | null;
  circuito?: CircuitoMeta | null;
  gps?: { fuente?: string; hz?: number } | null;
  recibido?: string;
  [campo: string]: unknown;
}

// ---------- lo que calcula el Mac ----------

// Línea de meta con que se analiza una tanda (índice del eje en cada sentido).
export interface Finish {
  osm: number;
  rev: number;
}

// Huella de lo recibido de una tanda: si cambia, su resumen se vuelve a calcular.
export interface Stamp {
  trozos: number;
  bytes: number;
  meta: string;
}

export interface ResumenVuelta {
  num: number;
  time: number;
  valid: boolean;
  sectors: number[];
  corners: CornerMetrics[];
  leanMax: number;
  vMax: number;
}

// resumen.json: el análisis de una tanda de circuito en el Mac (o por qué no se pudo).
export interface Resumen extends Stamp {
  v: number;
  calculado: string;
  duracion?: number;
  sentido?: Dir;
  inclinacion?: LeanSource;
  mejor?: number | null;
  ideal?: number | null;
  avisos?: string[];
  vueltas?: ResumenVuelta[];
  error?: string;
}

// El resumen que enseña la lista: el análisis del Mac (circuito) o, con tipo «ruta», lo que resumió el móvil de una
// ruta libre. Los dos con los campos sueltos: la lista mira los que tenga.
export interface ResumenLista extends Partial<Resumen>, RecorridoMeta {
  tipo?: "ruta";
}

// ---------- lo que contesta el garaje ----------

export type TunelEstado = "abriendo" | "listo" | "caido" | "sin-cloudflared" | "apagado";

// GET /api/estado
export interface EstadoGaraje {
  datos: string;
  tunel: string | null;
  tunelEstado: TunelEstado;
  enlace: string | null;
  espacioLibre: number;
}

// Una tanda de la lista (GET /api/tandas).
export interface TandaLista {
  id: string;
  meta: {
    inicio: string | undefined;
    fin: string | null | undefined;
    estado: string | undefined;
    sim: boolean | undefined;
    tipo: "ruta" | "pista";
    fuente: "gopro" | "movil";
    piloto: string | null;
    objetivo: number | null;
    sentido: string | undefined;
    mejor: number | null | undefined;
    vueltas: number;
    circuito?: CircuitoMeta | null;
    gps?: MetaTanda["gps"];
  } | null;
  trozos: number;
  bytes: number;
  resumen: ResumenLista | null;
  analizando: boolean;
}

export interface ListaTandas {
  tandas: TandaLista[];
}

// GET /api/tandas/<id>/archivos: los CSV de la tanda (como los de Sensor Logger) y su resumen del móvil.
export interface ArchivosTanda {
  meta: MetaTanda | null;
  epoch: number | null;
  files: CsvFile[];
}

// GET /api/dia (garaje): la comparativa del día y los días que hay.
export type DiaGaraje = DiaComparativa & { dias?: string[] };

// GET /api/progreso: por piloto, cada día rodado (todas sus tandas de circuito de ese día y sentido juntas).
export interface ProgresoCurva {
  num: number;
  nombre: string;
  vMin: number;
  frenada: number | null;
  muerto: number | null;
  tumbada: number;
}

export interface ProgresoDia {
  fecha: string;
  sentido: string;
  tandas: number;
  vueltas: number;
  mejor: number;
  media3: number;
  regularidad: number | null;
  punta: number;
  tumbada: number;
  objetivo: number | null;
  curvas: ProgresoCurva[];
}

export interface ProgresoPiloto {
  piloto: string;
  dias: ProgresoDia[];
}

export interface Progreso {
  pilotos: ProgresoPiloto[];
  // Tandas aún sin analizar (se están analizando).
  pendientes: number;
}

// GET/POST /api/ia: si hay clave de Anthropic (nunca se devuelve), de dónde sale y qué modelo.
export interface IaEstado {
  configurada: boolean;
  desde: "entorno" | "archivo" | null;
  modelo: string;
}

// informe.json: el informe de la IA de una tanda.
export interface Informe {
  texto: string;
  modelo: string;
  creado: string;
  uso: { entrada: number; salida: number } | null;
  cortado: boolean;
  huella: string;
  // Al devolverlo: la tanda ha recibido datos después del informe.
  viejo?: boolean;
}
