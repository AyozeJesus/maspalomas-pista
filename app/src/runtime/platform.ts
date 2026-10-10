// Lo del navegador que necesita la app en marcha: pantalla siempre encendida, pantalla completa, orientación fija,
// permisos de los sensores de movimiento, vibración y el sonido de la alarma.

export type WakeLockHandle = { release(): Promise<void> } | null;

export async function requestWakeLock(): Promise<WakeLockHandle> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> };
    };
    if (nav.wakeLock) return await nav.wakeLock.request("screen");
  } catch {
    /* sin permiso o sin la API */
  }
  return null;
}

export async function enterFullscreen(): Promise<void> {
  try {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: (o?: FullscreenOptions) => Promise<void>;
    };
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
  } catch {
    /* pantalla completa opcional */
  }
}

export function exitFullscreen(): void {
  if (document.fullscreenElement && document.exitFullscreen)
    document.exitFullscreen().catch(() => {});
}

type LockableOrientation = ScreenOrientation & {
  lock?: (o: string) => Promise<void>;
  unlock?: () => void;
};

function orientation(): LockableOrientation | null {
  return typeof screen !== "undefined" && screen.orientation
    ? (screen.orientation as LockableOrientation)
    : null;
}

export function screenAngle(): number {
  const o = orientation();
  if (o && typeof o.angle === "number") return o.angle;
  const w = window as unknown as { orientation?: unknown };
  return typeof w.orientation === "number" ? w.orientation : 0;
}

export function orientationType(): string | null {
  const o = orientation();
  return o ? o.type : null;
}

// Fija la orientación; true si se ha podido.
export async function lockOrientation(type: string): Promise<boolean> {
  const o = orientation();
  if (!o || !o.lock) return false;
  try {
    await o.lock(type);
    return true;
  } catch {
    /* sin pantalla completa o navegador sin bloqueo */
    return false;
  }
}

export function unlockOrientation(): void {
  try {
    const o = orientation();
    if (o && o.unlock) o.unlock();
  } catch {
    /* nada que desbloquear */
  }
}

// Ángulo de la pantalla cuando ha terminado de girar (lock() puede resolverse antes de que cambie).
export function settledAngle(): Promise<number> {
  return new Promise((res) => {
    const o = orientation();
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      if (o) o.removeEventListener("change", fin);
      res(screenAngle());
    };
    if (o) o.addEventListener("change", fin);
    setTimeout(fin, 600);
  });
}

// iPhone: los sensores de movimiento piden permiso, y solo se puede pedir justo al tocar un botón (antes de cualquier
// otra espera). En Android no hace falta.
export async function askMotion(): Promise<boolean> {
  const D = (
    window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }
  ).DeviceMotionEvent;
  if (!D || typeof D.requestPermission !== "function") return true;
  try {
    return (await D.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

// Navegadores que bloquean los sensores de movimiento (Brave lo hace por defecto, contra el rastreo; medido en un Pixel
// 10 Pro: acelerómetro y giroscopio «denied» y un solo evento vacío). Se detecta y se dice qué hacer.
export function isBrave(): boolean {
  const nav = navigator as Navigator & { brave?: { isBrave?: unknown } };
  return !!(nav.brave && nav.brave.isBrave);
}

export function sensorBlockText(): string {
  return isBrave()
    ? "Brave bloquea los sensores de movimiento (inclinación, g y caballitos). Ábrela en Chrome (recomendado) o, en Brave: Ajustes → Configuración de sitios → Sensores de movimiento → Permitir, y vuelve a abrirla."
    : "El navegador bloquea los sensores de movimiento (inclinación, g y caballitos): permítelos en los ajustes de este sitio y vuelve a abrirla.";
}

// Lo que manda son los datos: con el permiso «denied» hay navegadores que siguen enviándolos. Bloqueado = permiso
// negado y ningún dato de movimiento en 1,5 s.
let motionSeen = false;
export function markMotion(e: DeviceMotionEvent | null | undefined): void {
  const a = e && e.accelerationIncludingGravity;
  if (a && a.x !== null && a.x !== undefined) motionSeen = true;
}

export async function sensorsBlocked(): Promise<boolean> {
  if (motionSeen) return false;
  let denied: boolean;
  try {
    const st = await navigator.permissions.query({ name: "accelerometer" as PermissionName });
    denied = st.state === "denied";
  } catch {
    denied = false;
  }
  if (!denied) return false;
  window.addEventListener("devicemotion", markMotion);
  await new Promise((r) => setTimeout(r, 1500));
  window.removeEventListener("devicemotion", markMotion);
  return !motionSeen;
}

export function vibrate(p: number | number[]): void {
  try {
    if (navigator.vibrate) navigator.vibrate(p);
  } catch {
    /* sin vibración */
  }
}

// El sonido solo puede arrancar tras un toque: se prepara al pulsar «Ruta libre».
let alarmAudio: AudioContext | null = null;
export function prepareAlarmAudio(): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!alarmAudio) alarmAudio = new AC();
    if (alarmAudio.state === "suspended") alarmAudio.resume().catch(() => {});
  } catch {
    alarmAudio = null;
  }
}

export function tone(freq: number, dur: number): void {
  const a = alarmAudio;
  if (!a) return;
  try {
    if (a.state === "suspended") a.resume().catch(() => {});
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.value = 0.9;
    o.connect(g);
    g.connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  } catch {
    /* sin sonido */
  }
}
