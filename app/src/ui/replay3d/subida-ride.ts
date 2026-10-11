// La vuelta de prueba de una subida de montaña en un sentido, lista para el reproductor 3D. Va por tu camino de
// verdad si ya has pasado por ella (el aprendido en su primera pasada: el de este sentido o, al revés, el del otro) y,
// si no, por la carretera de OpenStreetMap (app/subidas-trazados, que solo se carga entonces).
import { needsPath, type LatLon } from "../../core/tramos";
import { routeSource, type RouteSource } from "./sources";
import { testRide } from "./test-ride";

// De dónde sale el trazado: tu camino aprendido o la carretera de OpenStreetMap.
export type Fuente = "rodado" | "osm";

export interface SubidaRide {
  source: RouteSource;
  fuente: Fuente;
}

interface Trazados {
  trazado(id: string): LatLon[] | null;
}

const loadTrazados = (): Promise<Trazados> => import("../../app/subidas-trazados");

// sub.subida: el id del catálogo; k: el sentido (0, el primero de la isla); own y other: lo guardado de este sentido y
// del otro (con su camino aprendido, si lo hay). null si no hay por dónde ir.
export async function subidaRide(
  sub: { subida: string },
  k: 0 | 1,
  own: { pts?: LatLon[] } | undefined,
  other: { pts?: LatLon[] } | undefined,
  load: () => Promise<Trazados> = loadTrazados,
): Promise<SubidaRide | null> {
  let pts: LatLon[] | null = null;
  let fuente: Fuente = "rodado";
  if (own && own.pts && !needsPath(own)) pts = own.pts;
  else if (other && other.pts && !needsPath(other)) pts = other.pts.slice().reverse();
  if (!pts) {
    const base = (await load()).trazado(sub.subida);
    pts = base ? (k === 0 ? base : base.slice().reverse()) : null;
    fuente = "osm";
  }
  if (!pts) return null;
  const source = routeSource({ route: { trail: testRide(pts) } });
  return source ? { source, fuente } : null;
}
