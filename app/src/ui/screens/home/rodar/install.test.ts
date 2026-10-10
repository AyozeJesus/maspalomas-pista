import { describe, expect, it, vi } from "vitest";
import { liveFunctions } from "../../../../../test/legacy";
import { createInstallPrompt, installed, installHow } from "./install";

const HOW_CHROME =
  "Menú ⋮ de Chrome → «Añadir a pantalla de inicio» (o «Instalar aplicación»), con internet. Después, ábrela siempre desde su icono.";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 13; V2111) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36";

interface Browser {
  standalone?: boolean;
  fullscreen: boolean;
  ua: string;
  offered: boolean;
}

// Lo que pintaba renderInstall de antes (con installed()) en un navegador así.
function oldInstall(b: Browser) {
  const el = {
    install: { hidden: true },
    "install-btn": { hidden: true },
    "install-how": { textContent: HOW_CHROME },
  };
  const old = liveFunctions<{ renderInstall: () => void; installed: () => boolean }>(
    ["installed", "renderInstall"],
    {
      globals: {
        $: (id: keyof typeof el) => el[id],
        navigator: { standalone: b.standalone, userAgent: b.ua },
        matchMedia: (q: string) => ({
          matches: b.fullscreen && /display-mode: fullscreen/.test(q),
        }),
        installEvt: b.offered ? {} : null,
      },
    },
  );
  old.renderInstall();
  return {
    card: !el.install.hidden,
    btn: !el["install-btn"].hidden,
    how: el["install-how"].textContent,
  };
}

function newInstall(b: Browser) {
  const win = {
    navigator: { standalone: b.standalone, userAgent: b.ua },
    matchMedia: (q: string) => ({ matches: b.fullscreen && /display-mode: fullscreen/.test(q) }),
  } as unknown as Window;
  return { card: !installed(win), btn: b.offered, how: installHow(b.ua) };
}

describe("instalar la app", () => {
  it("el aviso y cómo se instala, como renderInstall de antes", () => {
    const cases: Browser[] = [
      { fullscreen: false, ua: ANDROID, offered: false },
      { fullscreen: false, ua: ANDROID, offered: true },
      { fullscreen: true, ua: ANDROID, offered: false },
      { standalone: true, fullscreen: false, ua: IPHONE, offered: false },
      { fullscreen: false, ua: IPHONE, offered: false },
      { fullscreen: false, ua: "", offered: false },
    ];
    for (const b of cases) expect(newInstall(b), JSON.stringify(b)).toEqual(oldInstall(b));
    expect(installHow(IPHONE)).toMatch(/^En Safari: botón Compartir/);
  });

  it("sin matchMedia (un navegador viejo o las pruebas) no se da por instalada", () => {
    expect(installed({ navigator: {} } as unknown as Window)).toBe(false);
  });

  it("el aviso de Chrome se guarda para el botón, se usa una vez y se olvida al instalarla", async () => {
    const win = new EventTarget() as unknown as Window;
    const p = createInstallPrompt(win);
    const seen = vi.fn();
    const stop = p.subscribe(seen);
    expect(p.available()).toBe(false);
    const prompt = vi.fn(async () => {});
    const offer = () => {
      const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      win.dispatchEvent(e);
      return e;
    };
    const e = offer();
    // Sin el aviso propio de Chrome: el botón es el que lo lanza.
    expect(e.defaultPrevented).toBe(true);
    expect(p.available()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    await p.prompt();
    await p.prompt();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(p.available()).toBe(false);
    offer();
    expect(p.available()).toBe(true);
    win.dispatchEvent(new Event("appinstalled"));
    expect(p.available()).toBe(false);
    stop();
    offer();
    // Se sigue escuchando aunque nadie mire (Chrome lo manda una vez).
    expect(p.available()).toBe(true);
  });
});
