// «Nuevo tramo con salida y meta»: comprobar lo escrito (coordenadas o enlaces de Google Maps), la posición que pone
// «Aquí», el tramo que se guarda y lo que se avisa mientras se busca en las rutas del móvil.
import { meters, parseCoords, type GateTramo, type LatLon } from "../../../../core/tramos";
import { freeName } from "../../../../engine";
import { fmtMeters } from "../../../../lib/format";
import { newTramoId } from "../../../../services/tramos-store";
import { mapsLink } from "./tramo-rows";

// Las dos casillas de coordenadas: la salida (a) y la meta (b).
export type End = "a" | "b";

// Lo que dice la nota debajo del dibujo (bad: en rojo).
export interface FormNote {
  text: string;
  bad: boolean;
}

export interface FormCheck extends FormNote {
  // Lo que se entiende de cada casilla (se dibuja aunque falte la otra).
  a: LatLon | null;
  b: LatLon | null;
  // Salida y meta que valen para guardar el tramo; si no, null (y la nota dice por qué).
  ok: { a: LatLon; b: LatLon } | null;
  // «Ver en Google Maps»: con las dos entendidas, aunque no valgan para un tramo (casi en el mismo sitio o lejos).
  maps: string | null;
}

export const LOCATING = "Buscando tu posición…";
export const NO_POSITION = "No se ha podido saber tu posición (¿GPS encendido y con permiso?).";

// La salida y la meta escritas: si valen, qué dice la nota y qué se enseña.
export function checkTramoForm(salida: string, meta: string): FormCheck {
  const ta = salida.trim();
  const tb = meta.trim();
  const a = parseCoords(ta);
  const b = parseCoords(tb);
  const result = (text: string, bad: boolean, ok: FormCheck["ok"] = null): FormCheck => ({
    a,
    b,
    ok,
    text,
    bad,
    maps: a && b ? mapsLink(a, b) : null,
  });
  const why = (what: string, txt: string) =>
    txt
      ? "No entiendo " +
        what +
        ": pega «28.355628, -16.418573» o un enlace de Google Maps con las coordenadas (los cortos, maps.app.goo.gl, no las llevan)."
      : "Falta " + what + ".";
  if (!ta && !tb) return result("", false);
  if (!a) return result(why("la salida", ta), !!ta);
  if (!b) return result(why("la meta", tb), !!tb);
  const d = meters(a, b);
  // Con menos de 60 m, los círculos de 30 m de la salida y de la meta se pisan.
  if (d < 60)
    return result(
      "La salida y la meta están casi en el mismo sitio (a menos de 60 m). Para una vuelta, márcala rodando con «Salida aquí» y «Meta aquí»: queda un circuito.",
      true,
    );
  if (d > 45000) return result("Demasiado lejos: más de 45 km en línea recta.", true);
  return result("De la salida a la meta, " + fmtMeters(d) + " en línea recta.", false, { a, b });
}

// El dibujo se ve con alguna de las dos entendida y el formulario abierto.
export function previewHidden(check: FormCheck, open: boolean): boolean {
  return !(check.a || check.b) || !open;
}

// La posición del GPS, como la escribe «Aquí» en la casilla.
export function hereText(lat: number, lon: number): string {
  return lat.toFixed(6) + ", " + lon.toFixed(6);
}

// El tramo nuevo: con el nombre escrito (40 letras como mucho) o, sin él, el primer «Crono N» libre.
export function newGateTramo(
  names: readonly string[],
  name: string,
  a: LatLon,
  b: LatLon,
  nowMs: number,
): GateTramo {
  return {
    id: newTramoId(nowMs),
    nombre: name.trim().slice(0, 40) || freeName("Crono", names),
    creado: new Date(nowMs).toISOString(),
    salida: a,
    meta: b,
    pasadas: [],
  };
}

// Recién guardado, mientras se busca en las rutas del móvil.
export function savingToast(nombre: string): string {
  return "«" + nombre + "» guardado: buscándolo en tus rutas…";
}

// Al acabar de buscar: cuántas pasadas tiene ya o que empieza a contar al pasar por la salida.
export function savedToast(nombre: string, added: number): string {
  return added
    ? "«" + nombre + "»: " + added + (added === 1 ? " pasada" : " pasadas") + " en tus rutas"
    : "«" + nombre + "» guardado: al pasar por la salida empieza a contar";
}
