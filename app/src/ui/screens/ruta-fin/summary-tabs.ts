// Las pestañas del resumen de la ruta: cuáles salen en esta ruta (una sin nada que enseñar, no) y con qué nombre, cuál
// se ve, adónde llevan las teclas y dónde queda la página al cambiar de pestaña. Lo que hay en cada una lo dicen las
// mismas reglas que sus tarjetas (tramoCardShown, routeLaps, has3d).
import type { SummaryTab } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { routeLaps } from "./laps";
import type { Paint } from "./paint";
import { tramoCardShown } from "./tramos";

export interface TabInfo {
  id: SummaryTab;
  label: string;
}

export const TAB_LABELS: Readonly<Record<SummaryTab, string>> = {
  resumen: "Resumen",
  tramos: "Tramos",
  pilotaje: "Pilotaje",
  "3d": "3D",
  opciones: "Opciones",
};

// Con menos puntos de trazada (unos metros, o parado) no hay ruta que ver en 3D.
const MIN_3D_POINTS = 10;

export function has3d(eng: Engine | null): boolean {
  return !!eng && eng.route.trail.length >= MIN_3D_POINTS;
}

// «Resumen», «Pilotaje» (aunque sea para decir que no hay curvas) y «Opciones», siempre. «Tramos» con pasadas por
// tramos o la ruta para guardar como tramo, o con las vueltas a un circuito (solo con ellas, se llama «Vueltas»). «3D»
// con trazada.
export function summaryTabs(paint: Paint | null): TabInfo[] {
  const eng = paint ? paint.eng : null;
  const tramos = !!eng && tramoCardShown(eng);
  const laps = !!eng && routeLaps(eng) !== null;
  const out: TabInfo[] = [{ id: "resumen", label: TAB_LABELS.resumen }];
  if (tramos || laps) out.push({ id: "tramos", label: tramos ? TAB_LABELS.tramos : "Vueltas" });
  out.push({ id: "pilotaje", label: TAB_LABELS.pilotaje });
  if (has3d(eng)) out.push({ id: "3d", label: TAB_LABELS["3d"] });
  out.push({ id: "opciones", label: TAB_LABELS.opciones });
  return out;
}

// La que se ve: la elegida, si esta ruta la tiene; si no, «Resumen».
export function shownTab(tabs: readonly TabInfo[], want: SummaryTab): SummaryTab {
  return tabs.some((t) => t.id === want) ? want : "resumen";
}

// Con el teclado (como en la portada): flechas a la de al lado (dando la vuelta), Inicio y Fin a la primera y la
// última. null: otra tecla.
export function tabByKey(
  tabs: readonly TabInfo[],
  current: SummaryTab,
  key: string,
): SummaryTab | null {
  const ids = tabs.map((t) => t.id);
  const n = ids.length;
  const k = Math.max(0, ids.indexOf(current));
  if (key === "ArrowRight") return ids[(k + 1) % n];
  if (key === "ArrowLeft") return ids[(k + n - 1) % n];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[n - 1];
  return null;
}

// Dónde dejar la página al cambiar de pestaña. Con la página bajada más allá del principio de los paneles (la pestaña
// de antes se leía por la mitad), al principio del panel nuevo, justo debajo de las pestañas pegadas arriba (barBottom:
// dónde acaban en la pantalla); sin bajar tanto, donde está (null). panelsTop: dónde empiezan los paneles en la
// pantalla.
export function scrollForTab(panelsTop: number, scrollY: number, barBottom: number): number | null {
  const y = Math.max(0, Math.round(panelsTop + scrollY - barBottom));
  return scrollY > y ? y : null;
}
