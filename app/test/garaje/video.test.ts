// @vitest-environment jsdom
// Exportar una vuelta del vídeo con los datos encima (garaje/web/video.ts) no se queda nunca a medias: si el vídeo no
// se deja reproducir, si se para a mitad (a mano, otro vídeo, un error) o si algo falla, el botón vuelve a valer y se
// dice qué ha pasado. Y de varias exportaciones queda solo el último enlace (el anterior se libera).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../../garaje/web/video";
import type { VideoControl } from "../../../garaje/web/tipos";
import { analyze, demoSession } from "../../src/core/maspalomas";
import type { AnalyzeResult } from "../../src/core/maspalomas/types";
import { DrawLog } from "../fake-canvas";

let RES: AnalyzeResult;
beforeAll(() => {
  RES = analyze(demoSession({ seed: 7 }).session, {});
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, max = 2000): Promise<void> {
  for (let i = 0; i < max && !cond(); i++) await tick();
}

// Un <video> de mentira: avanza 2 s por fotograma mientras se reproduce.
interface FakeVideo {
  time: number;
  playing: boolean;
  play: () => Promise<void>;
}

// La grabadora de mentira: guarda en qué estado está y entrega un trozo al parar.
class FakeRecorder {
  static isTypeSupported(t: string): boolean {
    return t === "video/webm";
  }
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((ev: { data: Blob | null }) => void) | null = null;
  onstop: (() => void) | null = null;
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    if (this.state === "inactive") throw new Error("InvalidStateError");
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["x".repeat(2048)]) });
      this.onstop?.();
    }, 0);
  }
}

let container: HTMLElement;
let ctl: VideoControl;
let vs: FakeVideo;
let video: HTMLVideoElement;
let urls: { created: string[]; revoked: string[] };

beforeEach(() => {
  document.body.innerHTML = '<div id="vid"></div>';
  container = document.getElementById("vid") as HTMLElement;
  const log = new DrawLog();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => log.canvas().getContext("2d") as unknown as CanvasRenderingContext2D,
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
    configurable: true,
    value: () => ({ addTrack: () => {} }),
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  urls = { created: [], revoked: [] };
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const u = "blob:prueba-" + (urls.created.length + 1);
    urls.created.push(u);
    return u;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => {
    urls.revoked.push(u);
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    setTimeout(() => {
      if (vs.playing) vs.time += 2;
      cb(0);
    }, 0);
    return 1;
  });

  ctl = mount(container, {
    result: () => RES,
    epoch: () => null,
    useSession: () => {},
    save: async () => "20261011-100000-abcd",
  });
  video = container.querySelector("video") as HTMLVideoElement;
  vs = { time: 0, playing: false, play: () => Promise.resolve() };
  Object.defineProperties(video, {
    videoWidth: { get: () => 1280 },
    videoHeight: { get: () => 720 },
    duration: { get: () => 5000 },
    currentTime: {
      get: () => vs.time,
      set: (v: number) => {
        vs.time = v;
        setTimeout(() => video.dispatchEvent(new Event("seeked")), 0);
      },
    },
    paused: { get: () => !vs.playing },
    ended: { get: () => vs.time >= 5000 },
    play: {
      value: () =>
        vs.play().then(() => {
          vs.playing = true;
        }),
    },
    pause: {
      value: () => {
        if (!vs.playing) return;
        vs.playing = false;
        video.dispatchEvent(new Event("pause"));
      },
    },
  });
  // Sincronizado a mano: el vídeo, en el cruce de meta de la primera vuelta.
  ctl.refresh();
  const mark = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Aquí cruzo meta",
  );
  mark?.click();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const expBtn = () =>
  [...container.querySelectorAll("button")].find((b) =>
    /^Exportar la vuelta/.test(b.textContent || ""),
  ) as HTMLButtonElement;
const expMsg = () => container.querySelector(".vid-export .caption")?.textContent || "";
const links = () =>
  [...container.querySelectorAll(".vid-export a[download]")] as HTMLAnchorElement[];

describe("garaje: exportar una vuelta del vídeo", () => {
  it("si el vídeo no se deja reproducir, lo dice y se puede volver a intentar", async () => {
    expect(ctl.state().offset).not.toBeNull();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vs.play = () => Promise.reject(new DOMException("play() failed", "NotAllowedError"));
    expBtn().click();
    await until(() => !expBtn().disabled);
    expect(expBtn().disabled).toBe(false);
    expect(expMsg()).toMatch(/^No se ha podido grabar la vuelta/);
    expect(expMsg()).not.toMatch(/NotAllowedError|play\(\)/);
    expect(links()).toHaveLength(0);
    // Ya no está bloqueado: la siguiente sale bien.
    vs.play = () => Promise.resolve();
    expBtn().click();
    await until(() => links().length > 0);
    expect(links()).toHaveLength(1);
    expect(ctl.state().lastExport?.name).toBe("vuelta-1.webm");
  });

  it("si dibujar un fotograma falla, lo dice y no se queda bloqueado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = new DrawLog();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      const ctx = log.canvas().getContext("2d") as object;
      return new Proxy(ctx, {
        get: (t, p) =>
          p === "drawImage"
            ? () => {
                throw new Error("roto");
              }
            : Reflect.get(t, p),
      }) as unknown as CanvasRenderingContext2D;
    });
    expBtn().click();
    await until(() => !expBtn().disabled && /^No se ha podido/.test(expMsg()));
    expect(expMsg()).toMatch(/^No se ha podido grabar la vuelta/);
    expect(links()).toHaveLength(0);
    expect(vs.playing).toBe(false);
  });

  it("si el vídeo se para a mitad, la exportación se corta y lo dice", async () => {
    expBtn().click();
    await until(() => /Grabando/.test(expMsg()));
    video.pause();
    await until(() => !expBtn().disabled);
    expect(expMsg()).toMatch(/^Exportación cortada/);
    expect(links()).toHaveLength(0);
    expect(ctl.state().lastExport).toBeNull();
  });

  it("de dos exportaciones queda un solo enlace, y el anterior se libera", async () => {
    expBtn().click();
    await until(() => links().length === 1 && !expBtn().disabled);
    const first = links()[0].href;
    expBtn().click();
    await until(() => urls.created.length === 2 && !expBtn().disabled);
    expect(links()).toHaveLength(1);
    expect(links()[0].href).not.toBe(first);
    expect(urls.revoked).toContain(first);
    expect(expMsg()).toBe("Listo.");
  });
});
