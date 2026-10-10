// Estado de la interfaz (qué pantalla y pestaña se ven, avisos, capas encima): un almacén de zustand que pueden leer
// los componentes (con su hook) y el runtime (sin React).
import { createStore, useStore } from "zustand";

export type Screen = "home" | "dash" | "pits" | "dia" | "sensores" | "ruta" | "ruta-fin";
export type HomeTab = "rodar" | "rutas" | "ajustes";
export const TABS: readonly HomeTab[] = ["rodar", "rutas", "ajustes"];

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
  tel: string;
  shareText: string;
}

export interface UiState {
  screen: Screen;
  homeTab: HomeTab;
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
}

export const uiStore = createStore<UiState>(() => ({
  screen: "home",
  homeTab: "rodar",
  dayFrom: "home",
  toast: null,
  flash: null,
  replaying: null,
  crash: null,
  homeVersion: 0,
  summaryVersion: 0,
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

export function show(screen: Screen): void {
  uiStore.setState({ screen });
}

export function setTab(tab: HomeTab): void {
  if (!TABS.includes(tab)) return;
  const changed = tab !== uiStore.getState().homeTab;
  uiStore.setState({ homeTab: tab });
  if (changed && typeof window !== "undefined") window.scrollTo(0, 0);
}

export function refreshHome(): void {
  uiStore.setState((s) => ({ homeVersion: s.homeVersion + 1 }));
}

export function refreshSummary(): void {
  uiStore.setState((s) => ({ summaryVersion: s.summaryVersion + 1 }));
}
