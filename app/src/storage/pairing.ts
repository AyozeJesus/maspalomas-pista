// Emparejar el móvil con el garaje del Mac: el código que enseña el Mac abre la app con el enlace
// #garaje=<base64url de {"u": url, "k": clave}>.
import type { GarageConfig } from "./types";

// El garaje del enlace, o null si no lo es (o no es válido: solo https, o http en el propio Mac).
export function parsePairing(hash: string | null | undefined): GarageConfig | null {
  const m = /^#garaje=([A-Za-z0-9_-]+)$/.exec(hash || "");
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const o: { u?: unknown; k?: unknown } = JSON.parse(
      atob(b64 + "===".slice((b64.length + 3) % 4)),
    );
    const u = String(o.u || "").replace(/\/+$/, "");
    const k = String(o.k || "");
    const url = new URL(u);
    const local = /^(127\.0\.0\.1|localhost)$/.test(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(k)) return null;
    return { u: url.origin, k };
  } catch {
    return null;
  }
}
