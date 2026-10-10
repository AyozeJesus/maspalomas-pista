// Receptor GNSS externo por cable USB (p. ej. un u-blox M9/M10 con USB-C, como los de cronometraje): Chrome en
// Android habla con él directamente (WebUSB), sin apps intermedias, a sus 10–25 posiciones por segundo. Las frases
// NMEA (o tramas UBX/RaceBox) las lee el mismo lector que el Bluetooth (createParser de core/gnss).
// Chips: USB serie estándar (CDC-ACM, el USB nativo de u-blox), CH340/CH341 y CP210x. Lo que se exporta es lo mismo
// que tenía MaspaGNSSUSB.
import { createParser, type GnssFix, type GnssParser, type OnGnssFix } from "../../core/gnss";
import {
  errorField,
  serialNavigator,
  type GnssHandle,
  type GnssState,
  type GnssStatus,
} from "./receiver";
import type {
  USB,
  USBAlternateInterface,
  USBConnectionEvent,
  USBControlTransferParameters,
  USBDevice,
  USBDeviceFilter,
  USBInTransferResult,
  USBInterface,
} from "./web-serial-types";

const BAUD = 115200;
export const FILTERS: readonly USBDeviceFilter[] = [
  { vendorId: 0x1546 }, // u-blox
  { vendorId: 0x1a86 }, // WCH CH340/CH341
  { vendorId: 0x10c4 }, // Silicon Labs CP210x
  { classCode: 0x02 }, // CDC (comunicaciones)
  { classCode: 0x0a }, // CDC datos
];

export interface UsbConnectOptions {
  onFix?: OnGnssFix | null;
  onStatus?: ((s: GnssStatus) => void) | null;
  // Uno ya permitido, para reconectar sin preguntar.
  device?: USBDevice | null;
}

// Qué chip es, qué interfaz leer (y la de control, si la hay) y su punto de lectura (null: no tiene).
export interface UsbLayout {
  kind: "cdc" | "ch34x" | "cp210x";
  data: USBInterface;
  ctrl: USBInterface | null;
  ep: number | null;
}

export function supported(): boolean {
  const nav = serialNavigator();
  return !!(nav && nav.usb && nav.usb.requestDevice);
}

const le32 = (n: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);

// Qué chip es y qué interfaz/puntos de lectura usar.
export function layoutOf(dev: USBDevice): UsbLayout | null {
  const conf = dev.configuration;
  const ifaces = conf ? conf.interfaces : [];
  const alt = (i: USBInterface): USBAlternateInterface | null | undefined =>
    i.alternate || (i.alternates && i.alternates[0]);
  const bulkIn = (i: USBInterface): number | null => {
    const a = alt(i);
    const ep = a && a.endpoints.find((e) => e.direction === "in" && e.type === "bulk");
    return ep ? ep.endpointNumber : null;
  };
  // Un CH340 o un CP210x sin interfaces falla aquí (ifaces[0] no existe), como antes.
  if (dev.vendorId === 0x1a86)
    return { kind: "ch34x", data: ifaces[0], ctrl: null, ep: bulkIn(ifaces[0]) };
  if (dev.vendorId === 0x10c4)
    return { kind: "cp210x", data: ifaces[0], ctrl: null, ep: bulkIn(ifaces[0]) };
  const data = ifaces.find((i) => {
    const a = alt(i);
    return a && a.interfaceClass === 0x0a && bulkIn(i) !== null;
  });
  const ctrl =
    ifaces.find((i) => {
      const a = alt(i);
      return a && a.interfaceClass === 0x02;
    }) || null;
  if (data) return { kind: "cdc", data, ctrl, ep: bulkIn(data) };
  // Algunos receptores dan una sola interfaz con su punto de lectura.
  const any = ifaces.find((i) => bulkIn(i) !== null);
  return any ? { kind: "cdc", data: any, ctrl: null, ep: bulkIn(any) } : null;
}

// Configura el chip (velocidad 115200 8N1 y líneas de control) según su tipo.
async function setup(dev: USBDevice, lay: UsbLayout): Promise<void> {
  const out = (o: USBControlTransferParameters, data?: BufferSource) =>
    dev.controlTransferOut(o, data);
  if (lay.kind === "cdc") {
    if (!lay.ctrl) return;
    const index = lay.ctrl.interfaceNumber;
    // SET_LINE_CODING: velocidad, 1 bit de parada, sin paridad, 8 bits (el USB nativo de u-blox lo ignora).
    const lc = new Uint8Array(7);
    lc.set(le32(BAUD), 0);
    lc[6] = 8;
    await out(
      {
        requestType: "class",
        recipient: "interface",
        request: 0x20,
        value: 0,
        index,
      },
      lc,
    ).catch(() => {});
    // SET_CONTROL_LINE_STATE: DTR y RTS (algunos no mandan datos sin ellas).
    await out({
      requestType: "class",
      recipient: "interface",
      request: 0x22,
      value: 0x03,
      index,
    }).catch(() => {});
  } else if (lay.kind === "ch34x") {
    // Como el driver de Linux (ch341.c): inicio, divisor de la velocidad, formato 8N1 y líneas de control.
    let factor = Math.floor(1532620800 / BAUD);
    let divisor = 3;
    while (factor > 0xfff0 && divisor) {
      factor >>= 3;
      divisor--;
    }
    factor = 0x10000 - factor;
    const v = (factor & 0xff00) | divisor;
    const vend = (request: number, value: number, index: number) =>
      out({
        requestType: "vendor",
        recipient: "device",
        request,
        value,
        index,
      });
    await vend(0xa1, 0, 0);
    await vend(0x9a, 0x1312, v);
    await vend(0x9a, 0x0f2c, factor & 0xff);
    await vend(0x9a, 0x2518, 0x00c3);
    await vend(0xa4, ~0x60 & 0xff, 0);
  } else if (lay.kind === "cp210x") {
    const index = lay.data.interfaceNumber;
    const vend = (request: number, value: number, data?: BufferSource) =>
      out(
        {
          requestType: "vendor",
          recipient: "interface",
          request,
          value,
          index,
        },
        data,
      );
    await vend(0x00, 0x0001); // IFC_ENABLE
    await vend(0x1e, 0, le32(BAUD)); // SET_BAUDRATE
    await vend(0x03, 0x0800); // SET_LINE_CTL: 8N1
    await vend(0x07, 0x0303); // SET_MHS: DTR y RTS
  }
}

// Por qué no se ha podido abrir, para el piloto (sin los mensajes técnicos del navegador).
function openErrorText(e: unknown): string {
  const name = errorField(e, "name");
  if (errorField(e, "notReceiver")) return "Ese aparato USB no parece un receptor GPS compatible.";
  if (name === "SecurityError" || name === "NotAllowedError")
    return "Chrome no tiene permiso para usar el receptor USB: desenchúfalo, vuelve a enchufarlo y pulsa «Conectar por USB».";
  if (name === "NetworkError" || name === "InvalidStateError")
    return "El receptor USB está ocupado (quizá lo usa otra app): ciérrala, o desenchufa y vuelve a enchufar el receptor.";
  return "No se ha podido abrir el receptor USB: desenchúfalo, vuelve a enchufarlo y prueba otra vez.";
}

type Say = (state: GnssState, text: string) => void;

// Cada estado se avisa una vez (no con cada fijo).
function statusOnce(o: UsbConnectOptions): Say {
  let shown = "";
  return (state, text) => {
    if (shown === state + text) return;
    shown = state + text;
    if (o.onStatus) o.onStatus({ state, text });
  };
}

// Un receptor USB ya elegido: lo abre, configura su chip y lee sin parar hasta que se desenchufa o se corta.
class UsbReceiver {
  private readonly usb: USB;
  private readonly dev: USBDevice;
  private readonly o: UsbConnectOptions;
  private readonly status: Say;
  private readonly name: string;
  private readonly ready: string;
  private readonly arrivals: number[] = [];
  private open = true;
  private noFix: number | null = null;
  private readonly parser: GnssParser;

  constructor(usb: USB, dev: USBDevice, o: UsbConnectOptions, status: Say) {
    this.usb = usb;
    this.dev = dev;
    this.o = o;
    this.status = status;
    this.name = dev.productName || "Receptor USB";
    this.ready = "Receptor USB conectado (" + this.name + ").";
    // Cuántos fijos llegan (para rate) y si tienen cobertura, como con el Bluetooth.
    this.parser = createParser((f) => this.gotFix(f));
  }

  // Fijos por segundo en los últimos 2 s (intervalos entre llegadas, como con el Bluetooth).
  rate(): number {
    const now = performance.now();
    while (this.arrivals.length && now - this.arrivals[0] > 2000) this.arrivals.shift();
    const span = this.arrivals.length ? now - this.arrivals[0] : 0;
    if (this.arrivals.length < 2 || span < 250) return 0;
    return ((this.arrivals.length - 1) * 1000) / span;
  }

  async disconnect(): Promise<void> {
    this.finish("desconectado", "Receptor USB desconectado.");
    try {
      await this.dev.close();
    } catch {
      /* ya cerrado */
    }
  }

  async start(): Promise<GnssHandle> {
    const handle: GnssHandle = {
      name: this.name,
      profile: "usb",
      rate: () => this.rate(),
      disconnect: () => this.disconnect(),
    };
    this.usb.addEventListener("disconnect", this.onGone);
    try {
      await this.dev.open();
      if (!this.dev.configuration) await this.dev.selectConfiguration(1);
      const lay = layoutOf(this.dev);
      if (!lay || lay.ep === null)
        throw Object.assign(new Error("sin punto de lectura"), { notReceiver: true });
      if (lay.ctrl) await this.dev.claimInterface(lay.ctrl.interfaceNumber).catch(() => {});
      await this.dev.claimInterface(lay.data.interfaceNumber);
      await setup(this.dev, lay);
      this.status("conectado", this.ready);
      void this.read(lay.ep);
    } catch (e) {
      this.finish("error", openErrorText(e));
      this.dev.close().catch(() => {});
      throw e;
    }
    return handle;
  }

  private gotFix(f: GnssFix): void {
    const t = f.recvMs || performance.now();
    this.arrivals.push(t);
    if (f.fix >= 2) {
      this.noFix = null;
      this.status("conectado", this.ready);
    } else if (this.noFix === null) this.noFix = t;
    else if (t - this.noFix > 3000)
      this.status(
        "sin-fix",
        "Receptor USB sin cobertura todavía: déjalo a cielo abierto y espera un poco.",
      );
    if (this.o.onFix) this.o.onFix(f);
  }

  // Fin de la conexión (desenchufado, fallo de lectura o a mano), una sola vez.
  private finish(state: GnssState, text: string): void {
    if (!this.open) return;
    this.open = false;
    this.usb.removeEventListener("disconnect", this.onGone);
    this.status(state, text);
  }

  private readonly onGone = (ev: USBConnectionEvent): void => {
    if (ev.device === this.dev) this.finish("desconectado", "Se ha desenchufado el receptor USB.");
  };

  // Lee sin parar mientras siga abierto.
  private async read(ep: number): Promise<void> {
    while (this.open) {
      let r: USBInTransferResult;
      try {
        r = await this.dev.transferIn(ep, 512);
      } catch {
        this.finish("desconectado", "Se ha perdido el receptor USB: desenchúfalo.");
        break;
      }
      if (r.status === "stall") {
        await this.dev.clearHalt("in", ep).catch(() => {});
        continue;
      }
      if (r.data && r.data.byteLength)
        this.parser.push(
          new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength),
          performance.now(),
        );
    }
  }
}

// Abre el receptor y lee sin parar. connect debe llamarse desde un toque (Chrome pide permiso la primera vez).
// opts: { onFix(fix) (con recvMs), onStatus({state, text}), device? (uno ya permitido, para reconectar) }.
export async function connect(opts?: UsbConnectOptions | null): Promise<GnssHandle> {
  const o = opts || {};
  const status = statusOnce(o);
  const nav = serialNavigator();
  const usb = nav ? nav.usb : undefined;
  if (!usb || !usb.requestDevice) {
    status("error", "Este navegador no puede usar receptores USB (hace falta Chrome en Android).");
    throw new Error("sin WebUSB");
  }
  let dev = o.device || null;
  if (!dev) {
    try {
      dev = await usb.requestDevice({ filters: FILTERS });
    } catch (e) {
      status("error", "No se ha elegido ningún receptor USB.");
      throw e;
    }
  }
  status("conectando", "Conectando con el receptor USB…");
  return new UsbReceiver(usb, dev, o, status).start();
}
