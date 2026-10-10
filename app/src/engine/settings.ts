// Ajustes del piloto que usa el motor (y la interfaz). Se guardan en localStorage «pista-ajustes»; aquí, su forma y
// los valores de partida (los mismos de siempre: un móvil con ajustes de antes los conserva).

export type Orientation = "auto" | "portrait-primary" | "landscape-primary" | "landscape-secondary";

export interface Settings {
  // Aviso de frenada (prueba) y cuántos metros antes.
  cue: boolean;
  lead: number;
  // Línea de meta elegida en cada sentido del circuito.
  finish: { osm: number; rev: number };
  // Emparejamiento con el garaje del Mac: dirección (u) y clave (k), como en el enlace del QR.
  garaje: { u: string; k: string } | null;
  piloto: string;
  // Vuelta objetivo (s).
  objetivo: number;
  mapa: boolean;
  // «Pantalla en pista»: "auto" (como esté el móvil) o la orientación que se fija al salir.
  pantalla: Orientation | string;
  // Aviso de caída en la ruta libre y teléfono de emergencia (opcional).
  caida: boolean;
  emergencia: string;
  // Receptor GPS externo que se usó la última vez ("ble" | "usb").
  receptor?: "ble" | "usb" | null;
}

export const DEFAULT_SETTINGS: Settings = {
  cue: false,
  lead: 20,
  finish: { osm: 0, rev: 0 },
  garaje: null,
  piloto: "",
  objetivo: 65.0,
  mapa: true,
  pantalla: "auto",
  caida: true,
  emergencia: "",
};

// Vuelta objetivo válida (40–200 s) o la de partida.
export function target(s: Settings): number {
  const t = Number(s.objetivo);
  return t >= 40 && t <= 200 ? t : 65.0;
}

// Cada piloto tiene su mejor vuelta (si dos comparten móvil, no se mezclan). Sin nombre, la clave de siempre.
export function pilotSlug(s: Settings): string {
  return s.piloto ? "-" + encodeURIComponent(s.piloto.toLowerCase()) : "";
}

export function bestKey(s: Settings, dir: "osm" | "rev"): string {
  return "pista-mejor-" + dir + "-" + s.finish[dir] + pilotSlug(s);
}
