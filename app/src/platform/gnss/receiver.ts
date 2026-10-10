// Lo que comparten los receptores por Bluetooth y por USB: sus avisos de estado, lo que devuelve connect() y cómo se
// leen el navegador y los errores.
import type { SerialNavigator } from "./web-serial-types";

export type GnssState =
  "conectando" | "conectado" | "sin-fix" | "reconectando" | "desconectado" | "error";

// Aviso para el piloto: el estado y el texto que se enseña.
export interface GnssStatus {
  state: GnssState;
  text: string;
}

// Tipo de receptor: los del Bluetooth (se confirma con lo que llega) o «usb».
export type GnssProfile = "racebox" | "nus-nmea" | "bonogps" | "lns" | "usb";

// Lo que devuelve connect(): el nombre del aparato, su tipo, los fijos por segundo de los últimos 2 s y cortar.
export interface GnssHandle {
  readonly name: string;
  readonly profile: GnssProfile | "";
  rate(): number;
  disconnect(): void | Promise<void>;
}

// El navigator de la página, con Web Bluetooth y WebUSB si los tiene (undefined fuera del navegador).
export function serialNavigator(): SerialNavigator | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

// `e && e.name` (o .message…) de antes, para lo que sea que rechace una promesa: un error, otra cosa o nada.
export function errorField(e: unknown, key: "name" | "message" | "notReceiver"): unknown {
  if ((typeof e === "object" && e !== null) || typeof e === "function") return Reflect.get(e, key);
  return undefined;
}
