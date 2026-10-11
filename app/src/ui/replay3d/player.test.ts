// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Vista3D, Vista3DMode, Vista3DPose } from "../three/vista3d";
import { createPlayer, type PlayerEls, type PlayerSync, type Vista3DModule } from "./player";
import type { Replay3dSource } from "./sources";

function els(): PlayerEls {
  const box = document.createElement("div");
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K) => {
    const e = document.createElement(tag);
    box.append(e);
    return e;
  };
  return {
    box,
    wait: mk("p"),
    main: mk("b"),
    side: mk("span"),
    sub: mk("small"),
    play: mk("button"),
    speed: mk("button"),
    range: Object.assign(mk("input"), { type: "range" }),
  };
}

// Una grabación de 0 a 10 s: la moto a 10 m/s; parada de 4 a 8 s (se salta).
function source(over: Partial<Replay3dSource> = {}): Replay3dSource {
  return {
    track: { C: [], N: [], cs: [], L: 100, closed: false },
    options: { style: "carretera", extras: true },
    brakes: [12, null],
    start: 0,
    end: 10,
    speeds: [1, 2, 4],
    frame: (t: number) => ({
      pose: { s: 10 * t, lean: t, v: 10, brake: t > 9 },
      ghost: t > 5 ? { s: 9 * t, lean: 0 } : null,
      hud: {
        main: "t=" + t.toFixed(2),
        side: t > 5 ? "+1" : "",
        sub: "sub",
        tone: t > 5 ? "bad" : "",
      },
    }),
    skipStop: (t: number) => (t > 4.1 && t < 7 ? 7 : t),
    ...over,
  };
}

interface FakeView extends Vista3D {
  updates: [Vista3DPose, number | undefined, unknown][];
  modes: Vista3DMode[];
  brakes: unknown[];
  disposed: number;
}

function fakeModule(opts: { fail?: boolean; noGL?: boolean } = {}) {
  const made: FakeView[] = [];
  const created: unknown[][] = [];
  const mod = {
    create: (box: HTMLElement, track: unknown, options: unknown) => {
      created.push([box, track, options]);
      if (opts.noGL) return null;
      const v: FakeView = {
        updates: [],
        modes: [],
        brakes: [],
        disposed: 0,
        update(pose, dt, ghost) {
          this.updates.push([pose, dt, ghost]);
        },
        resize() {},
        setMode(m) {
          this.modes.push(m);
        },
        setBrakes(list) {
          this.brakes.push(list);
        },
        dispose() {
          this.disposed++;
        },
        mode: "casco",
        debug: () => ({ pos: [], look: [], bike: [], fov: 0 }),
      };
      made.push(v);
      return v;
    },
  } as unknown as Vista3DModule;
  const load = opts.fail ? () => Promise.reject(new Error("sin red")) : () => Promise.resolve(mod);
  return { load, made, created };
}

// Fotogramas a mano: cada tick avanza el reloj ms milisegundos.
function frames() {
  let next: ((now: number) => void) | null = null;
  let now = 1000;
  return {
    frame: (cb: (n: number) => void) => {
      next = cb;
      return 1;
    },
    cancel: () => {
      next = null;
    },
    tick(ms = 16) {
      now += ms;
      const cb = next;
      next = null;
      cb?.(now);
    },
    pending: () => next !== null,
  };
}

describe("reproductor 3D de lo grabado", () => {
  it("abre: aviso mientras carga, vista con su trazado, cámara y carteles, y el primer fotograma", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    const src = source();
    const opened = p.open(src, { at: 3, mode: "arriba" });
    expect(e.wait.hidden).toBe(false);
    expect(e.wait.textContent).toBe("Cargando la vista 3D…");
    expect(await opened).toBe("ok");
    expect(e.wait.hidden).toBe(true);
    expect(m.created).toEqual([[e.box, src.track, src.options]]);
    const v = m.made[0];
    expect(v.modes).toEqual(["arriba"]);
    expect(v.brakes).toEqual([[12, null]]);
    f.tick();
    expect(v.updates.length).toBe(1);
    expect(v.updates[0][0].s).toBe(30);
    expect(e.main.textContent).toBe("t=3.00");
    expect(e.range.min).toBe("0");
    expect(e.range.max).toBe("10");
    expect(e.range.value).toBe("3");
    expect(e.play.getAttribute("aria-label")).toBe("Reproducir");
    // Sin cambios, no se vuelve a pintar.
    f.tick();
    expect(v.updates.length).toBe(1);
    expect(p.isOpen()).toBe(true);
  });

  it("reproduce a la velocidad elegida, se salta las paradas y se para al final; otra vez, desde el principio", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    await p.open(source(), { at: 0 });
    f.tick();
    p.faster();
    expect(e.speed.textContent).toBe("×2");
    p.toggle();
    expect(e.play.getAttribute("aria-label")).toBe("Pausa");
    f.tick(16);
    f.tick(100);
    expect(p.time()).toBeCloseTo(0.2, 9);
    // Pasos de 0,1 s (lo más que cuenta un fotograma) a ×2: de 3,8 a 4,0, y la parada de 4 a 7 se salta.
    for (let k = 0; k < 18; k++) f.tick(100);
    expect(p.time()).toBeCloseTo(3.8, 9);
    f.tick(100);
    f.tick(100);
    expect(p.time()).toBe(7);
    for (let k = 0; k < 30; k++) f.tick(100);
    expect(p.time()).toBe(10);
    expect(p.playing()).toBe(false);
    expect(e.play.textContent).toBe("▶");
    const v = m.made[0];
    expect(v.updates[v.updates.length - 1][0].brake).toBe(true);
    expect(e.side.className).toBe("r3d-side bad");
    p.toggle();
    f.tick();
    expect(p.time()).toBe(0);
    // ×2 → ×4 → ×1.
    p.faster();
    p.faster();
    expect(e.speed.textContent).toBe("×1");
  });

  it("la velocidad elegida se queda si la siguiente grabación la tiene", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    await p.open(source());
    p.faster();
    p.faster();
    expect(p.speed()).toBe(4);
    await p.open(source({ speeds: [1, 2, 4, 8, 16] }));
    expect(p.speed()).toBe(4);
    await p.open(source({ speeds: [1, 2] }));
    expect(p.speed()).toBe(1);
    expect(e.speed.textContent).toBe("×1");
  });

  it("la barra lleva a cualquier momento (dentro de la grabación)", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    await p.open(source());
    f.tick();
    p.seek(6.5);
    f.tick();
    expect(m.made[0].updates.at(-1)?.[0].s).toBe(65);
    p.seek(99);
    expect(p.time()).toBe(10);
    p.seek(NaN);
    expect(p.time()).toBe(0);
  });

  it("a la par que el mapa: si se mueve allí salta aquí; reproduciendo lo lleva (como mucho cada 100 ms)", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    let key = 0;
    const writes: number[] = [];
    const sync: PlayerSync = {
      read: () => ({ key, t: key / 10 }),
      write: (t) => {
        writes.push(t);
        key = Math.round(t * 10);
        return key;
      },
    };
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    await p.open(source(), { at: 0, sync });
    f.tick();
    expect(writes).toEqual([]);
    // El dedo en el mapa: el punto 25.
    key = 25;
    f.tick();
    expect(p.time()).toBe(2.5);
    expect(m.made[0].updates.at(-1)?.[0].s).toBe(25);
    expect(writes).toEqual([]);
    p.toggle();
    f.tick(16);
    for (let k = 0; k < 10; k++) f.tick(40);
    // 0,4 s en pasos de 40 ms: lo de fuera se ha movido 3 o 4 veces, no 10.
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(writes.length).toBeLessThanOrEqual(4);
    expect(p.time()).toBeCloseTo(2.9, 9);
    // Al parar, justo donde la moto.
    p.toggle();
    expect(writes.at(-1)).toBeCloseTo(2.9, 9);
    // Lo que escribe él mismo no cuenta como un salto.
    const t = p.time();
    f.tick();
    expect(p.time()).toBe(t);
  });

  it("sin `at`, empieza donde esté lo de fuera (el punto del mapa)", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const sync: PlayerSync = { read: () => ({ key: 42, t: 4.2 }), write: () => 42 };
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    await p.open(source(), { sync });
    expect(p.time()).toBe(4.2);
    f.tick();
    // Ya estaba ahí: no cuenta como un salto ni se vuelve a escribir.
    expect(p.time()).toBe(4.2);
    expect(m.made[0].updates.length).toBe(1);
  });

  it("otra vuelta de la misma tanda (mismo trazado y escena): la misma vista, con sus carteles", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    const a = source();
    await p.open(a, { mode: "casco" });
    f.tick();
    p.toggle();
    const b = source({ track: a.track, brakes: [40], end: 8, options: { ...a.options } });
    expect(await p.open(b)).toBe("ok");
    expect(m.made.length).toBe(1);
    expect(m.made[0].disposed).toBe(0);
    expect(m.made[0].brakes).toEqual([[12, null], [40]]);
    expect(p.playing()).toBe(false);
    expect(e.range.max).toBe("8");
    f.tick();
    expect(m.made[0].updates.length).toBe(2);
    // Otro trazado: vista nueva.
    await p.open(source({ track: { C: [], N: [], cs: [], L: 50, closed: false } }));
    expect(m.made.length).toBe(2);
    expect(m.made[0].disposed).toBe(1);
  });

  it("sin red la primera vez, o sin WebGL: lo dice y no pinta", async () => {
    const e1 = els();
    const f = frames();
    const p1 = createPlayer(e1, {
      load: fakeModule({ fail: true }).load,
      frame: f.frame,
      cancel: f.cancel,
    });
    expect(await p1.open(source())).toBe("failed");
    expect(e1.wait.hidden).toBe(false);
    expect(e1.wait.textContent).toBe(
      "No se ha podido cargar la vista 3D (sin conexión la primera vez).",
    );
    expect(p1.isOpen()).toBe(false);
    const e2 = els();
    const p2 = createPlayer(e2, {
      load: fakeModule({ noGL: true }).load,
      frame: f.frame,
      cancel: f.cancel,
    });
    expect(await p2.open(source())).toBe("failed");
    expect(e2.wait.textContent).toBe("Este móvil no puede dibujar en 3D.");
    p2.toggle();
    expect(p2.playing()).toBe(false);
    expect(f.pending()).toBe(false);
  });

  it("cerrar mientras carga: no se crea nada; cerrar abierta: suelta la vista y deja de pintar", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    const pending = p.open(source());
    p.close();
    expect(await pending).toBe("stale");
    expect(m.created.length).toBe(0);
    await p.open(source());
    f.tick();
    const v = m.made[0];
    p.close();
    expect(v.disposed).toBe(1);
    expect(f.pending()).toBe(false);
    expect(p.isOpen()).toBe(false);
    // Abrir otra suelta la anterior.
    await p.open(source());
    await p.open(source());
    expect(m.made[1].disposed).toBe(1);
    expect(m.made[2].disposed).toBe(0);
  });

  it("fuera de la pantalla no pinta; al volver, sí (y con la cámara nueva)", async () => {
    const e = els();
    const m = fakeModule();
    const f = frames();
    const p = createPlayer(e, { load: m.load, frame: f.frame, cancel: f.cancel });
    await p.open(source());
    f.tick();
    const v = m.made[0];
    p.setVisible(false);
    p.seek(5);
    p.setMode("casco");
    f.tick();
    expect(v.updates.length).toBe(1);
    expect(v.modes).toEqual(["detras", "casco"]);
    p.setVisible(true);
    f.tick();
    expect(v.updates.length).toBe(2);
    expect(v.updates[1][0].s).toBe(50);
    p.invalidate();
    f.tick();
    expect(v.updates.length).toBe(3);
    vi.restoreAllMocks();
  });
});
