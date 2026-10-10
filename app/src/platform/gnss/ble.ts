// Receptor GNSS externo por Bluetooth (RaceBox, BonoGPS, puente NMEA o GPS del perfil estándar): hasta 25 posiciones
// por segundo en vez de 1. Aquí va la conexión con Web Bluetooth (elegir el aparato, sus servicios, reconectar); los
// bytes los lee el lector de core/gnss. Lo que se exporta es lo mismo que tenía MaspaGNSS.
import {
  createParser,
  decodeLocationSpeed,
  looksLikeText,
  type GnssFix,
  type GnssParser,
  type OnGnssFix,
  type OnParserInfo,
} from "../../core/gnss";
import {
  errorField,
  serialNavigator,
  type GnssHandle,
  type GnssState,
  type GnssStatus,
} from "./receiver";
import type {
  BluetoothDevice,
  BluetoothRemoteGATTCharacteristic,
  BluetoothRemoteGATTService,
  CharacteristicValueChangedEvent,
} from "./web-serial-types";

export { BUFFER_CAP, createParser, decodeLocationSpeed, RB_FIELDS } from "../../core/gnss";

// Nordic UART Service: el «cable serie» por Bluetooth del RaceBox y de los puentes ESP32/u-blox.
export const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // receptor → móvil (notificaciones)
export const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // móvil → receptor (escritura)
// Perfil estándar «Location and Navigation» (0x1819) y su característica «Location and Speed» (0x2A67).
// El BonoGPS no manda ahí el binario de la norma sino frases NMEA en texto, una por notificación.
export const LNS = "00001819-0000-1000-8000-00805f9b34fb";
export const LNS_LS = "00002a67-0000-1000-8000-00805f9b34fb";

export type BleProfile = "racebox" | "nus-nmea" | "bonogps" | "lns";

// Cómo se nombra cada tipo de receptor en los avisos.
const PROFILE_NAME: Readonly<Record<BleProfile, string>> = {
  racebox: "RaceBox",
  "nus-nmea": "receptor NMEA",
  bonogps: "BonoGPS",
  lns: "GPS Bluetooth estándar",
};

const RATE_WINDOW_MS = 2000;
const NOFIX_MS = 3000;
const BACKOFF_MAX_MS = 10000;

// schedule(fn, ms) → función que lo cancela.
export type Schedule = (fn: () => void, ms: number) => () => void;

export interface BleConnectOptions {
  onFix?: OnGnssFix | null;
  onStatus?: ((s: GnssStatus) => void) | null;
  // Contadores del lector.
  onInfo?: OnParserInfo | null;
  // GANCHO (ver open()): orden que se escribe al receptor nada más activar las notificaciones.
  startCommand?: BufferSource | null;
  // Solo para las pruebas: reloj en ms (por defecto performance.now) y temporizador (por defecto setTimeout).
  now?: (() => number) | null;
  schedule?: Schedule | null;
}

// Las opciones ya resueltas: se leen al llamar a connect(), como antes.
interface BleSettings {
  onFix: OnGnssFix;
  now: () => number;
  schedule: Schedule;
  startCommand: BufferSource | null;
  onInfo: OnParserInfo | null | undefined;
}

function noop(): void {}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

function chooserText(e: unknown): string {
  const name = errorField(e, "name");
  if (name === "NotFoundError" && /adapter/i.test(String(errorField(e, "message"))))
    return "El Bluetooth del móvil está apagado: enciéndelo y vuelve a intentarlo.";
  if (name === "NotFoundError") return "No se ha elegido ningún receptor.";
  if (name === "SecurityError" || name === "NotAllowedError")
    return "Chrome no ha dejado buscar el receptor: pulsa el botón de conectar y permite el Bluetooth si lo pregunta.";
  return "No se ha podido buscar el receptor: comprueba que el Bluetooth del móvil está encendido.";
}

export function supported(): boolean {
  const nav = serialNavigator();
  return !!(nav && nav.bluetooth && nav.bluetooth.requestDevice);
}

// Avisa con onStatus solo cuando cambian el estado o el texto.
class StatusLine {
  state: GnssState | "" = "";
  text = "";
  private readonly onStatus: (s: GnssStatus) => void;

  constructor(onStatus: (s: GnssStatus) => void) {
    // Se llama sin `this`, como antes.
    this.onStatus = (s) => onStatus(s);
  }

  set(s: GnssState, t: string): void {
    if (s === this.state && t === this.text) return;
    this.state = s;
    this.text = t;
    this.onStatus({ state: s, text: t });
  }
}

// Un receptor ya elegido en la lista: abre su servicio, lee lo que manda y se reconecta si se pierde.
class BleReceiver {
  private readonly device: BluetoothDevice;
  private readonly line: StatusLine;
  private readonly onFix: OnGnssFix;
  private readonly now: () => number;
  private readonly schedule: Schedule;
  private readonly startCommand: BufferSource | null;
  private readonly parser: GnssParser;
  private readonly arrivals: number[] = []; // recvMs de los fijos de los últimos 2 s
  private readonly name: string;
  private link: "nus" | "lns" | "" = "";
  private profile: BleProfile | "" = "";
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private stopped = false;
  private busy = false;
  private retries = 0;
  private cancelRetry: (() => void) | null = null;
  private linkAt = 0;
  private shownAt = -Infinity;
  private badSince: number | null = null;

  constructor(device: BluetoothDevice, o: BleSettings, line: StatusLine) {
    this.device = device;
    this.line = line;
    // Lo que da quien llama se llama sin `this`, como antes.
    const { onFix, now, schedule } = o;
    this.onFix = (f) => onFix(f);
    this.now = () => now();
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.startCommand = o.startCommand;
    this.parser = createParser((f) => this.gotFix(f), o.onInfo);
    this.name = device.name || "";
  }

  // Fijos por segundo en los últimos 2 s; baja sola si dejan de llegar.
  rate(): number {
    const t = this.now();
    this.trim(t);
    const span = this.arrivals.length ? t - this.arrivals[0] : 0;
    if (this.arrivals.length < 2 || span < 250) return 0;
    return ((this.arrivals.length - 1) * 1000) / span;
  }

  disconnect(): void {
    if (this.stopped) return;
    this.stopped = true;
    const cancel = this.cancelRetry;
    if (cancel) cancel();
    this.cancelRetry = null;
    this.device.removeEventListener("gattserverdisconnected", this.lost);
    this.closeGatt();
    this.line.set("desconectado", "Receptor desconectado.");
  }

  // Lo que devuelve connect(): el perfil se lee en cada momento (se confirma con lo que llega).
  handle(): GnssHandle {
    const profile = (): BleProfile | "" => this.profile;
    return {
      name: this.name || "Receptor",
      get profile() {
        return profile();
      },
      disconnect: () => this.disconnect(),
      rate: () => this.rate(),
    };
  }

  // Android falla a veces el primer intento de conexión sin motivo: hasta 3 intentos antes de rendirse.
  async start(): Promise<GnssHandle> {
    this.line.set("conectando", "Conectando con " + (this.name || "el receptor") + "…");
    for (let k = 0; ; k++) {
      try {
        await this.open();
        break;
      } catch (e) {
        this.closeGatt();
        const alien = errorField(e, "name") === "NotFoundError"; // no tiene ningún servicio conocido
        if (alien || k === 2) {
          this.line.set(
            "error",
            alien
              ? "Ese aparato no es un receptor compatible."
              : "No se ha podido conectar con el receptor: acércalo al móvil y vuelve a intentarlo.",
          );
          throw e;
        }
        await new Promise<void>((r) => this.schedule(r, 1000 * 2 ** k));
      }
    }
    this.device.addEventListener("gattserverdisconnected", this.lost);
    this.line.set("conectado", this.linkText("esperando posiciones…"));
    return this.handle();
  }

  private trim(t: number): void {
    while (this.arrivals.length && this.arrivals[0] <= t - RATE_WINDOW_MS) this.arrivals.shift();
  }

  private linkText(rest: string): string {
    // open() ya ha puesto el perfil; sin él saldría «undefined», como antes.
    const kind = this.profile === "" ? undefined : PROFILE_NAME[this.profile];
    return "Receptor conectado (" + kind + "): " + rest;
  }

  private rateText(): string {
    const r = Math.round(this.rate());
    if (r < 1) return this.linkText("esperando posiciones…");
    return this.linkText(r + (r === 1 ? " posición por segundo" : " posiciones por segundo"));
  }

  private gotFix(f: GnssFix): void {
    // Siempre llega con recvMs (push(bytes, now())); sin ella, NaN haría lo mismo que el undefined de antes.
    const t = f.recvMs ?? NaN;
    this.arrivals.push(t);
    this.trim(t);
    // El tipo se confirma con lo que llega, por si el nombre del aparato engaña.
    if (f.source === "racebox" || f.source === "lns") this.profile = f.source;
    else this.profile = this.link === "lns" ? "bonogps" : "nus-nmea";
    // El Micro va a la batería de la moto: su byte de batería es la tensión ×10, no un porcentaje.
    if (f.source === "racebox" && /micro/i.test(this.name)) f.battery = null;
    if (f.fix < 2) {
      if (this.badSince === null) this.badSince = t;
      else if (t - this.badSince > NOFIX_MS && this.line.state === "conectado")
        this.line.set(
          "sin-fix",
          "Receptor sin cobertura todavía: déjalo a cielo abierto y espera un poco.",
        );
    } else {
      this.badSince = null;
      // El ritmo se enseña con al menos 1 s de datos y se renueva como mucho una vez por segundo.
      const due = t - this.shownAt >= 1000 && t - this.linkAt >= 1000;
      if (this.line.state === "sin-fix" || (this.line.state === "conectado" && due)) {
        this.shownAt = t;
        this.line.set("conectado", this.rateText());
      }
    }
    this.onFix(f);
  }

  private readonly onValue = (e: CharacteristicValueChangedEvent): void => {
    if (this.stopped) return;
    const v = e.target.value;
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const t = this.now();
    // En 0x2A67 el BonoGPS manda texto NMEA; un GPS que siga la norma, el binario.
    if (this.link === "lns" && !looksLikeText(bytes)) {
      const f = decodeLocationSpeed(bytes);
      if (f) {
        f.recvMs = t;
        this.gotFix(f);
      }
      return;
    }
    this.parser.push(bytes, t);
  };

  private detach(): void {
    if (this.tx) this.tx.removeEventListener("characteristicvaluechanged", this.onValue);
    this.tx = null;
  }

  // Aunque no esté conectado: disconnect() también corta un connect() en marcha (en Android puede tardar
  // 30 s en rendirse) y entonces no avisa con "gattserverdisconnected".
  private closeGatt(): void {
    this.detach();
    try {
      this.device.gatt.disconnect();
    } catch {
      /* ya estaba cerrado */
    }
  }

  private async open(): Promise<void> {
    const server = await this.device.gatt.connect();
    // Primero NUS (RaceBox y puentes); si el aparato no lo tiene, el perfil estándar (BonoGPS y otros).
    let service: BluetoothRemoteGATTService;
    let ch: BluetoothRemoteGATTCharacteristic;
    let kind: "nus" | "lns" = "nus";
    try {
      service = await server.getPrimaryService(NUS);
      ch = await service.getCharacteristic(NUS_TX);
    } catch (e) {
      if (errorField(e, "name") !== "NotFoundError") throw e;
      kind = "lns";
      service = await server.getPrimaryService(LNS);
      ch = await service.getCharacteristic(LNS_LS);
    }
    this.detach();
    this.parser.reset();
    this.link = kind;
    if (!this.profile) {
      if (kind === "nus") this.profile = /^racebox/i.test(this.name) ? "racebox" : "nus-nmea";
      else this.profile = /^bonogps/i.test(this.name) ? "bonogps" : "lns";
    }
    ch.addEventListener("characteristicvaluechanged", this.onValue);
    this.tx = ch;
    await ch.startNotifications();
    // GANCHO: orden que se escribe en RX (móvil → receptor) nada más activar las notificaciones, para
    // receptores que no empiecen a mandar datos solos. El RaceBox empieza solo al activarlas (así lo cuenta su
    // documentación; sin comprobar con un aparato) y el BonoGPS y los puentes mandan siempre, así que por
    // defecto no se escribe nada: connect({ startCommand: Uint8Array }). Solo hay RX en NUS.
    const startCommand = this.startCommand;
    if (startCommand && kind === "nus") {
      const rx = await service.getCharacteristic(NUS_RX);
      if (rx.writeValueWithResponse) await rx.writeValueWithResponse(startCommand);
      else await rx.writeValue(startCommand);
    }
    if (!this.device.gatt.connected) throw new Error("Se cortó la conexión al empezar");
    this.linkAt = this.now();
    this.shownAt = -Infinity;
    this.badSince = null;
  }

  private retryLater(): void {
    // 1 s, 2 s, 4 s, 8 s y luego cada 10 s, hasta que se llame a disconnect().
    const ms = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** this.retries);
    this.retries++;
    this.cancelRetry = this.schedule(this.retry, ms);
  }

  private readonly retry = async (): Promise<void> => {
    this.cancelRetry = null;
    if (this.stopped) return;
    this.busy = true;
    let up = false;
    try {
      await this.open();
      up = true;
    } catch {
      this.closeGatt();
    }
    this.busy = false;
    if (this.stopped) {
      if (up) this.closeGatt();
      return;
    }
    if (!up) {
      if (!this.cancelRetry) this.retryLater();
      return;
    }
    this.retries = 0;
    this.line.set("conectado", this.linkText("esperando posiciones…"));
  };

  // Chrome avisa con "gattserverdisconnected" al perder el aparato (fuera de alcance, apagado…).
  private readonly lost = (): void => {
    if (this.stopped) return;
    this.detach();
    this.line.set("reconectando", "Se ha perdido el receptor: reconectando…");
    if (!this.busy && !this.cancelRetry) this.retryLater();
  };
}

// Conecta con el receptor y pasa a onFix cada fijo con recvMs (performance.now() de su llegada al móvil, para
// colocarlo en el reloj de la app). Hay que llamarlo desde el toque de un botón: Chrome solo abre la lista de
// aparatos Bluetooth como respuesta directa a un gesto del usuario.
// Devuelve { name, profile, disconnect(), rate() }; si no conecta, avisa con estado "error" y rechaza.
export async function connect(opts?: BleConnectOptions | null): Promise<GnssHandle> {
  const o = opts || {};
  const onFix = o.onFix || noop;
  const line = new StatusLine(o.onStatus || noop);
  const now = o.now || (() => performance.now());
  const schedule = o.schedule || defaultSchedule;
  const startCommand = o.startCommand || null;
  const settings: BleSettings = { onFix, now, schedule, startCommand, onInfo: o.onInfo };
  const nav = serialNavigator();
  const bt = nav ? nav.bluetooth : null;
  if (!bt || !bt.requestDevice) {
    line.set(
      "error",
      "Este navegador no puede usar receptores Bluetooth: abre la página con Chrome en Android.",
    );
    throw new Error("Web Bluetooth no disponible");
  }
  line.set("conectando", "Elige el receptor en la lista…");
  let device: BluetoothDevice;
  try {
    device = await bt.requestDevice({
      filters: [
        { namePrefix: "RaceBox" },
        { namePrefix: "BonoGPS" },
        { services: [NUS] },
        { services: [LNS] },
      ],
      optionalServices: [NUS, LNS],
    });
  } catch (e) {
    line.set("error", chooserText(e));
    throw e;
  }
  return new BleReceiver(device, settings, line).start();
}
