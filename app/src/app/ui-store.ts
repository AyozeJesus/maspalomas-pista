// Estado de la interfaz (qué pantalla y pestaña se ven, avisos, capas encima): un almacén de zustand que pueden leer
// los componentes (con su hook) y el runtime (sin React).
import { createStore, useStore } from "zustand";

export type Screen = "home" | "dash" | "pits" | "dia" | "sensores" | "ruta" | "ruta-fin";
export type HomeTab = "rodar" | "rutas" | "ajustes";
export const TABS: readonly HomeTab[] = ["rodar", "rutas", "ajustes"];
// Las pestañas del resumen de la ruta, en su orden (las que no tienen nada en una ruta, no salen).
export type SummaryTab = "resumen" | "tramos" | "pilotaje" | "3d" | "opciones";
export const SUMMARY_TABS: readonly SummaryTab[] = [
  "resumen",
  "tramos",
  "pilotaje",
  "3d",
  "opciones",
];

export interface LapFlash {
  kind: "lap";
  time: number;
  isBest: boolean;
  prevBest: number | null;
}
export interface BrakeFlash {
  kind: "brake";
}

export interface ReplayingState {
  text: string;
  progress: number;
}

export interface CrashUiState {
  // Cuenta atrás (s que faltan) o alarma.
  alarm: boolean;
  count: string;
  title: string;
  text: string;
  where: string;
  // Teléfono de emergencia de Ajustes (solo cifras y «+», para el enlace) y el texto de su botón.
  tel: string;
  telText: string;
  shareText: string;
}

export interface UiState {
  screen: Screen;
  homeTab: HomeTab;
  // La pestaña del resumen de la ruta (cada ruta que se abre empieza en «Resumen»).
  summaryTab: SummaryTab;
  // De dónde se fue a «Tiempos del día» (para volver ahí).
  dayFrom: "home" | "pits";
  toast: { text: string; id: number } | null;
  flash: LapFlash | BrakeFlash | null;
  replaying: ReplayingState | null;
  crash: CrashUiState | null;
  // Cambia cada vez que hay que volver a pintar la portada (lista, tramos, garaje…).
  homeVersion: number;
  // Cambia cada vez que el resumen de la ruta o boxes tienen que volver a pintarse.
  summaryVersion: number;
  // Cambia con cada novedad del receptor GPS externo (y cada segundo con la portada a la vista, por su ritmo): solo se
  // repinta su línea de Ajustes, no la portada entera (que lee IndexedDB).
  extVersion: number;
  // «Salir a pista»: el selector del circuito a la vista.
  circuitPicker: boolean;
  // «Subidas de montaña»: la hoja a la vista (null: cerrada) y lo elegido en ella (isla y luego sentido: 0, el primero
  // de la isla; 1, el otro). ver: la subida (id en su sentido) cuya vuelta de prueba se ve en 3D.
  subidas: { isla: string | null; sentido: 0 | 1 | null; ver?: string | null } | null;
}

export const uiStore = createStore<UiState>(() => ({
  screen: "home",
  homeTab: "rodar",
  summaryTab: "resumen",
  dayFrom: "home",
  toast: null,
  flash: null,
  replaying: null,
  crash: null,
  homeVersion: 0,
  summaryVersion: 0,
  extVersion: 0,
  circuitPicker: false,
  subidas: null,
}));

export function useUi<T>(select: (s: UiState) => T): T {
  return useStore(uiStore, select);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;

// Mensaje corto abajo (2,5 s si no se dice).
export function toast(text: string, ms?: number): void {
  const id = ++toastId;
  uiStore.setState({ toast: { text, id } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (uiStore.getState().toast?.id === id) uiStore.setState({ toast: null });
  }, ms || 2500);
}

export function hideToast(): void {
  clearTimeout(toastTimer);
  uiStore.setState({ toast: null });
}

// Otra pantalla empieza arriba (como otra pestaña de la portada): si no, la nueva salía a la altura de la de antes (de
// un resumen bajado hasta el mapa, «Mis rutas» a media lista).
export function show(screen: Screen): void {
  const changed = screen !== uiStore.getState().screen;
  uiStore.setState({ screen });
  if (changed && typeof window !== "undefined") window.scrollTo(0, 0);
}

export function setTab(tab: HomeTab): void {
  if (!TABS.includes(tab)) return;
  const changed = tab !== uiStore.getState().homeTab;
  uiStore.setState({ homeTab: tab });
  if (changed && typeof window !== "undefined") window.scrollTo(0, 0);
}

// La pestaña del resumen de la ruta (dónde queda la página al cambiarla lo decide la pantalla: SummaryTabs).
export function setSummaryTab(tab: SummaryTab): void {
  if (SUMMARY_TABS.includes(tab)) uiStore.setState({ summaryTab: tab });
}

export function refreshHome(): void {
  uiStore.setState((s) => ({ homeVersion: s.homeVersion + 1 }));
}

export function refreshSummary(): void {
  uiStore.setState((s) => ({ summaryVersion: s.summaryVersion + 1 }));
}

export function refreshExt(): void {
  uiStore.setState((s) => ({ extVersion: s.extVersion + 1 }));
}

export function openCircuitPicker(): void {
  uiStore.setState({ circuitPicker: true });
}

export function closeCircuitPicker(): void {
  uiStore.setState({ circuitPicker: false });
}

export function openSubidas(): void {
  uiStore.setState({ subidas: { isla: null, sentido: null } });
}

export function closeSubidas(): void {
  uiStore.setState({ subidas: null });
}

export function pickIsla(isla: string): void {
  uiStore.setState({ subidas: { isla, sentido: null } });
}

export function pickSentido(sentido: 0 | 1): void {
  const s = uiStore.getState().subidas;
  if (s && s.isla) uiStore.setState({ subidas: { isla: s.isla, sentido } });
}

// La vuelta de prueba en 3D de una subida de la lista (id en su sentido); null, de vuelta a la lista.
export function verSubida(id: string | null): void {
  const s = uiStore.getState().subidas;
  if (s && s.isla && s.sentido !== null)
    uiStore.setState({ subidas: { isla: s.isla, sentido: s.sentido, ver: id } });
}

// Un paso atrás en la hoja de las subidas (del 3D a la lista, de la lista al sentido, del sentido a la isla); en la
// isla, se cierra.
export function subidasBack(): void {
  const s = uiStore.getState().subidas;
  if (!s) return;
  if (s.ver) uiStore.setState({ subidas: { isla: s.isla, sentido: s.sentido, ver: null } });
  else if (s.sentido !== null) uiStore.setState({ subidas: { isla: s.isla, sentido: null } });
  else if (s.isla !== null) uiStore.setState({ subidas: { isla: null, sentido: null } });
  else closeSubidas();
}
