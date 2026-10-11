// Subidas de montaña: tramos de carretera ya puestos, por islas y en los dos sentidos. Las coordenadas van en el primer
// sentido de su isla (en Tenerife, dirección sur); el otro es el mismo tramo al revés. En la ruta libre se cronometran
// solas al pasar por ellas (lo de cada una se guarda en services/subidas-store; el seguimiento, en engine/tramos).
import type { LatLon } from "../core/tramos";

export interface Sentido {
  id: string;
  // «Dirección sur», para elegir; «sur», junto al nombre de la subida («Los Loros (sur)»).
  nombre: string;
  corto: string;
}

export interface Subida {
  id: string;
  nombre: string;
  // Desde dónde y hasta dónde, en cada sentido (null: el nombre lo dice todo).
  detalle: [string | null, string | null];
  // En el primer sentido de la isla.
  salida: LatLon;
  meta: LatLon;
}

export interface Isla {
  id: string;
  nombre: string;
  sentidos: [Sentido, Sentido];
  // En el orden en que se encuentran yendo en el primer sentido.
  subidas: Subida[];
}

export const ISLAS: Isla[] = [
  {
    id: "tenerife",
    nombre: "Tenerife",
    sentidos: [
      { id: "sur", nombre: "Dirección sur", corto: "sur" },
      { id: "santa-cruz", nombre: "Dirección Santa Cruz", corto: "Santa Cruz" },
    ],
    subidas: [
      {
        id: "carretera-vieja",
        nombre: "Carretera vieja",
        detalle: ["Primer tramo, hasta Fito", "Desde Fito"],
        salida: [28.40833, -16.335581],
        meta: [28.399976, -16.351154],
      },
      {
        id: "barranco-hondo",
        nombre: "Barranco Hondo",
        detalle: [
          "Desde el cruce de Barranco Hondo hasta Las Tablas",
          "Desde Las Tablas hasta el cruce de Barranco Hondo",
        ],
        salida: [28.395646, -16.350656],
        meta: [28.385561, -16.356137],
      },
      {
        id: "cuesta-las-tablas",
        nombre: "Cuesta de Las Tablas",
        detalle: [null, null],
        salida: [28.385448, -16.356212],
        meta: [28.38574, -16.364288],
      },
      {
        id: "araya",
        nombre: "Araya",
        detalle: [null, null],
        salida: [28.364215, -16.377704],
        meta: [28.363082, -16.391693],
      },
      {
        // La salida, en la carretera junto al bar (28°21'20.5"N 16°25'08.2"W): el punto del bar quedaba a 38 m de
        // ella y no se llegaba a pasar por su círculo ni al salir ni al volver.
        id: "los-loros",
        nombre: "Los Loros",
        detalle: ["Desde el bar de Los Loros", "Hasta el bar de Los Loros"],
        salida: [28.355694, -16.418944],
        meta: [28.372172, -16.427788],
      },
      {
        id: "la-esperanza",
        nombre: "La Esperanza",
        detalle: [
          "Desde Las Rosas hasta el cruce de Los Loros",
          "Desde el cruce de Los Loros hasta Las Rosas",
        ],
        salida: [28.439565, -16.373507],
        meta: [28.388911, -16.449141],
      },
      {
        id: "el-teide",
        nombre: "El Teide",
        detalle: [
          "Desde el cruce de Los Loros hasta El Portillo",
          "Desde El Portillo hasta el cruce de Los Loros",
        ],
        salida: [28.388666, -16.449377],
        meta: [28.3061, -16.56383],
      },
      {
        id: "el-escobonal",
        nombre: "El Escobonal",
        detalle: [null, null],
        salida: [28.243121, -16.404899],
        meta: [28.251077, -16.421172],
      },
      {
        id: "arico",
        nombre: "Arico",
        detalle: [
          "Desde el cruce del Escobonal hasta la gasolinera",
          "Desde la gasolinera hasta el cruce del Escobonal",
        ],
        salida: [28.258358, -16.43155],
        meta: [28.182621, -16.48018],
      },
      {
        id: "jama",
        nombre: "Jama",
        detalle: [null, null],
        salida: [28.096857, -16.636416],
        meta: [28.116826, -16.663297],
      },
      {
        id: "el-boqueron",
        nombre: "El Boquerón",
        detalle: [null, null],
        salida: [28.510652, -16.391261],
        meta: [28.502431, -16.380324],
      },
    ],
  },
];

// Una subida en un sentido, lista para cronometrar. id: el de lo que se guarda de ella; nombre: con el sentido (para el
// panel y los resúmenes); titulo: sin él (en la lista ya elegida).
export interface SubidaEnSentido {
  id: string;
  isla: string;
  subida: string;
  sentido: string;
  nombre: string;
  titulo: string;
  detalle: string | null;
  salida: LatLon;
  meta: LatLon;
}

const PREFIX = "subida:";

function enSentido(isla: Isla, s: Subida, k: 0 | 1): SubidaEnSentido {
  const sentido = isla.sentidos[k];
  return {
    id: PREFIX + isla.id + "/" + s.id + "/" + sentido.id,
    isla: isla.id,
    subida: s.id,
    sentido: sentido.id,
    nombre: s.nombre + " (" + sentido.corto + ")",
    titulo: s.nombre,
    detalle: s.detalle[k],
    salida: k === 0 ? s.salida : s.meta,
    meta: k === 0 ? s.meta : s.salida,
  };
}

// Las de una isla en un sentido, en el orden en que se encuentran yendo en él.
export function subidasEn(isla: Isla, k: 0 | 1): SubidaEnSentido[] {
  const list = isla.subidas.map((s) => enSentido(isla, s, k));
  return k === 0 ? list : list.reverse();
}

// Todas, de todas las islas y en los dos sentidos.
export function todasLasSubidas(): SubidaEnSentido[] {
  return ISLAS.flatMap((isla) => [...subidasEn(isla, 0), ...subidasEn(isla, 1)]);
}

// La misma subida en el otro sentido (null: no es una subida).
export function contraria(id: string): string | null {
  if (!id.startsWith(PREFIX)) return null;
  const [isla, subida, sentido] = id.slice(PREFIX.length).split("/");
  const i = ISLAS.find((x) => x.id === isla);
  if (!i || !subida) return null;
  const k = i.sentidos.findIndex((s) => s.id === sentido);
  if (k < 0) return null;
  return PREFIX + isla + "/" + subida + "/" + i.sentidos[1 - k].id;
}

export function isSubida(id: string): boolean {
  return id.startsWith(PREFIX);
}
