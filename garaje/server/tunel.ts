// El túnel https (cloudflared, gratuito) que lleva el muelle a internet para que el móvil suba desde el circuito. Su
// dirección cambia cada vez que se abre: por eso el código para emparejar se escanea antes de salir.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { TunelEstado } from "../api";
import { currentKey } from "./clave";
import { APP, CON_TUNEL, PUERTO_MUELLE } from "./config";
import { log } from "./log";

export const tunnel: {
  url: string | null;
  estado: TunelEstado;
  proc: ChildProcess | null;
  intentos: number;
} = {
  url: null,
  estado: CON_TUNEL ? "abriendo" : "apagado",
  proc: null,
  intentos: 0,
};
let closing = false;

function findCloudflared(): string | null {
  for (const p of [
    process.env.CLOUDFLARED,
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
  ])
    if (p && existsSync(p)) return p;
  try {
    return execFileSync("/usr/bin/which", ["cloudflared"]).toString().trim() || null;
  } catch {
    return null;
  }
}

export function openTunnel(): void {
  const bin = findCloudflared();
  if (!bin) {
    tunnel.estado = "sin-cloudflared";
    log("Falta cloudflared: instálalo con «brew install cloudflared» y vuelve a abrir el garaje.");
    return;
  }
  tunnel.estado = "abriendo";
  tunnel.url = null;
  const p = spawn(
    bin,
    ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:" + PUERTO_MUELLE],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  tunnel.proc = p;
  const onData = (d: Buffer) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
    if (m && !tunnel.url) {
      tunnel.url = m[0];
      tunnel.estado = "listo";
      tunnel.intentos = 0;
      log("Túnel abierto:", tunnel.url);
      log("Escanea con el móvil el código de la página del garaje.");
    }
  };
  p.stdout.on("data", onData);
  p.stderr.on("data", onData);
  p.on("error", () => {});
  p.on("exit", () => {
    tunnel.proc = null;
    tunnel.url = null;
    if (closing) return;
    tunnel.estado = "caido";
    tunnel.intentos++;
    const wait = Math.min(60000, 5000 * tunnel.intentos);
    log("El túnel se ha cerrado; lo vuelvo a abrir en", wait / 1000, "s.");
    setTimeout(openTunnel, wait);
  });
}

// Al cerrar el garaje: el túnel se cierra con él y no se vuelve a abrir.
export function closeTunnel(): void {
  closing = true;
  if (tunnel.proc) tunnel.proc.kill();
}

// El enlace que abre la app del móvil emparejada con este garaje (dirección del túnel y clave).
export function pairingLink(): string | null {
  if (!tunnel.url) return null;
  const payload = Buffer.from(JSON.stringify({ u: tunnel.url, k: currentKey() })).toString(
    "base64url",
  );
  return APP + "#garaje=" + payload;
}
