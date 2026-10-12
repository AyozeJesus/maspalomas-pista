// La zona de casa: una ruta suele empezar y acabar en casa, así que a 300 m o menos (en línea recta) de su salida o de
// su llegada no se dan coordenadas ni enlace a Google Maps (ni al pasar por ahí a mitad de ruta). La salida y la
// llegada son las de la trazada, las mismas del mapa; una ruta cortada en dos es dos grabaciones nuevas (la entera se
// borra), y cada una protege las suyas. El límite cuenta como dentro (300 m justos, sin coordenadas).
export const HOME_ZONE_M = 300;

export type HomeEnd = "salida" | "llegada";

interface XY {
  x: number;
  y: number;
}

// De qué lado de casa está p, el punto i de la trazada, o null si está lejos. Cerca de las dos (una vuelta que acaba
// donde empezó), la de su mitad de la ruta: la última curva de la vuelta está «cerca de la llegada». Sin trazada,
// ninguno.
export function homeZone(tr: readonly XY[], p: XY, i: number): HomeEnd | null {
  if (!tr.length) return null;
  const a = tr[0];
  const z = tr[tr.length - 1];
  const nearA = Math.hypot(p.x - a.x, p.y - a.y) <= HOME_ZONE_M;
  const nearZ = Math.hypot(p.x - z.x, p.y - z.y) <= HOME_ZONE_M;
  if (nearA && nearZ) return i > (tr.length - 1) / 2 ? "llegada" : "salida";
  return nearA ? "salida" : nearZ ? "llegada" : null;
}
