// El reproductor 3D de lo grabado: la vista 3D (three.js, que solo se carga al abrirlo) dentro de su recuadro, el
// marcador, reproducir y pausa, la velocidad (×1, ×2…), la barra para ir a cualquier momento y la cámara. Se pinta en
// cada fotograma sin pasar por React, y solo cuando algo cambia. Con `sync` va a la par que otra cosa (el punto que se
// mueve por el mapa del resumen): si se mueve allí, salta aquí, y reproduciendo lo lleva consigo.
import { setCls, setHidden, setText } from "../dom";
import type { Vista3D, Vista3DMode } from "../three/vista3d";
import type { Replay3dSource } from "./sources";

export type Vista3DModule = typeof import("../three/vista3d");

export interface PlayerEls {
  // El recuadro (el lienzo va delante de lo que tiene) y su aviso de mientras carga.
  box: HTMLElement;
  wait: HTMLElement;
  // El marcador.
  main: HTMLElement;
  side: HTMLElement;
  sub: HTMLElement;
  play: HTMLButtonElement;
  speed: HTMLButtonElement;
  range: HTMLInputElement;
}

// Lo de fuera que va a la par: dónde está (key cambia cuando lo mueve otro, t es su instante) y llevarlo a un instante
// (devuelve su key nueva).
export interface PlayerSync {
  read(): { key: number; t: number } | null;
  write(t: number): number | null;
}

export interface PlayerDeps {
  load?: () => Promise<Vista3DModule>;
  frame?: (cb: (nowMs: number) => void) => number;
  cancel?: (id: number) => void;
}

export interface OpenOptions {
  at?: number;
  sync?: PlayerSync | null;
  mode?: Vista3DMode;
}

// Reproduciendo, lo de fuera se mueve como mucho cada tanto (ms): el mapa no se repinta en cada fotograma.
const SYNC_MS = 100;

const loadVista3D = (): Promise<Vista3DModule> => import("../three/vista3d");

// La cámara elegida se queda para el siguiente repaso (mientras la app siga abierta): desde detrás se ve la moto.
let remembered: Vista3DMode = "detras";

export function rememberedMode(): Vista3DMode {
  return remembered;
}

export function createPlayer(els: PlayerEls, deps: PlayerDeps = {}) {
  const load = deps.load ?? loadVista3D;
  const frame = deps.frame ?? ((cb: (nowMs: number) => void) => requestAnimationFrame(cb));
  const cancel = deps.cancel ?? ((id: number) => cancelAnimationFrame(id));
  let src: Replay3dSource | null = null;
  let view: Vista3D | null = null;
  // Cada apertura es una: lo que llega tarde de otra (el import de three.js) no pinta nada.
  let token = 0;
  let t = 0;
  let playing = false;
  let speed = 1;
  let mode: Vista3DMode = remembered;
  let id = 0;
  let last: number | null = null;
  let dirty = false;
  let visible = true;
  let sync: PlayerSync | null = null;
  let syncKey: number | null = null;
  let syncAt = -Infinity;

  const clamp = (x: number) =>
    src ? Math.max(src.start, Math.min(src.end, Number.isFinite(x) ? x : src.start)) : 0;

  function say(text: string | null): void {
    setText(els.wait, text ?? "");
    setHidden(els.wait, text === null);
  }

  function showPlaying(on: boolean): void {
    playing = on;
    setText(els.play, on ? "❚❚" : "▶");
    els.play.setAttribute("aria-label", on ? "Pausa" : "Reproducir");
  }

  function showSpeed(): void {
    setText(els.speed, "×" + speed);
  }

  // Otra grabación con el mismo trazado y la misma escena (otra vuelta de la misma tanda): se sigue con la misma vista.
  function sameScene(a: Replay3dSource, b: Replay3dSource): boolean {
    const x = a.options;
    const y = b.options;
    return (
      a.track === b.track &&
      x.style === y.style &&
      !!x.extras === !!y.extras &&
      x.corners === y.corners &&
      x.bounds === y.bounds
    );
  }

  // Lo de cada grabación: la velocidad (la elegida se queda si esta la tiene), parado, la barra y por dónde se empieza
  // (at; si no, donde esté lo de fuera; si no, el principio).
  function start(source: Replay3dSource, opts: OpenOptions): void {
    src = source;
    sync = opts.sync ?? null;
    syncKey = null;
    if (opts.mode) mode = opts.mode;
    if (!source.speeds.includes(speed)) speed = 1;
    showSpeed();
    showPlaying(false);
    t = clamp(opts.at ?? sync?.read()?.t ?? source.start);
    els.range.min = String(source.start);
    els.range.max = String(source.end);
    els.range.step = "0.1";
    els.range.value = String(t);
  }

  async function open(
    source: Replay3dSource,
    opts: OpenOptions = {},
  ): Promise<"ok" | "failed" | "stale"> {
    if (view && src && sameScene(src, source)) {
      token++;
      start(source, opts);
      view.setMode(mode);
      view.setBrakes(source.brakes);
      if (sync) syncKey = sync.read()?.key ?? null;
      dirty = true;
      last = null;
      if (!id) id = frame(tick);
      return "ok";
    }
    close();
    const my = ++token;
    start(source, opts);
    say("Cargando la vista 3D…");
    let mod: Vista3DModule;
    try {
      mod = await load();
    } catch {
      if (my !== token) return "stale";
      say("No se ha podido cargar la vista 3D (sin conexión la primera vez).");
      return "failed";
    }
    if (my !== token) return "stale";
    const v = mod.create(els.box, source.track, source.options);
    if (!v) {
      say("Este móvil no puede dibujar en 3D.");
      return "failed";
    }
    view = v;
    v.setMode(mode);
    v.setBrakes(source.brakes);
    say(null);
    // Lo de fuera ya está donde se empieza (si no, la primera lectura lo tomaría por un salto).
    if (sync) syncKey = sync.read()?.key ?? null;
    dirty = true;
    last = null;
    id = frame(tick);
    return "ok";
  }

  function close(): void {
    token++;
    if (id) cancel(id);
    id = 0;
    if (view) view.dispose();
    view = null;
    src = null;
    sync = null;
    showPlaying(false);
  }

  function writeSync(now: number, force: boolean): void {
    if (!sync || (!force && now - syncAt < SYNC_MS)) return;
    syncAt = now;
    const key = sync.write(t);
    if (key !== null) syncKey = key;
  }

  function tick(now: number): void {
    id = 0;
    if (!view || !src) return;
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    // Lo de fuera se ha movido (el dedo en el mapa): aquí también.
    const ext = sync ? sync.read() : null;
    if (ext && ext.key !== syncKey) {
      syncKey = ext.key;
      t = clamp(ext.t);
      dirty = true;
    } else if (playing) {
      let nt = src.skipStop(t + dt * speed);
      if (nt >= src.end) {
        nt = src.end;
        showPlaying(false);
      }
      if (nt !== t) {
        t = nt;
        dirty = true;
        writeSync(now, !playing);
      }
    }
    if (dirty && visible) {
      dirty = false;
      const f = src.frame(t);
      view.update(f.pose, dt, f.ghost);
      setText(els.main, f.hud.main);
      setText(els.side, f.hud.side);
      setCls(els.side, "r3d-side" + (f.hud.tone ? " " + f.hud.tone : ""));
      setText(els.sub, f.hud.sub);
      if (+els.range.value !== t) els.range.value = String(t);
    }
    id = frame(tick);
  }

  // Reproducir o parar; al final, otra vez desde el principio.
  function toggle(): void {
    if (!src || !view) return;
    if (!playing && t >= src.end) {
      t = src.start;
      dirty = true;
    }
    showPlaying(!playing);
    last = null;
    // Al parar, lo de fuera se queda justo donde la moto.
    if (!playing) writeSync(performance.now(), true);
  }

  function seek(x: number): void {
    if (!src) return;
    t = clamp(x);
    dirty = true;
    writeSync(performance.now(), true);
  }

  // ×1 → ×2 → … → ×1 (las de esta grabación).
  function faster(): void {
    if (!src) return;
    const list = src.speeds;
    const k = list.indexOf(speed);
    speed = list[(k + 1) % list.length];
    showSpeed();
  }

  function setMode(m: Vista3DMode): void {
    mode = m;
    remembered = m;
    if (view) {
      view.setMode(m);
      dirty = true;
    }
  }

  // Fuera de la pantalla (o con la página oculta) no se pinta; al volver, sí.
  function setVisible(on: boolean): void {
    visible = on;
    if (on) dirty = true;
  }

  // El recuadro ha cambiado de tamaño (el lienzo se borra): pintar otra vez.
  function invalidate(): void {
    dirty = true;
  }

  return {
    open,
    close,
    toggle,
    seek,
    faster,
    setMode,
    setVisible,
    invalidate,
    isOpen: () => view !== null,
    time: () => t,
    playing: () => playing,
    speed: () => speed,
  };
}

export type Player = ReturnType<typeof createPlayer>;
