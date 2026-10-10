// Instalar la app. En una pestaña del navegador sin internet su barra no se quita (Vivo Y33s, Chrome 146: el aviso de
// «sin conexión» la deja fija aun en pantalla completa); instalada se abre a pantalla completa de verdad. Chrome ofrece
// instalarla (con internet) con «beforeinstallprompt»: se guarda ese aviso para el botón «Instalar la app» en vez del
// suyo propio.

// El aviso de Chrome (no está en los tipos del DOM).
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<unknown>;
}

// ¿Abierta como app instalada (a pantalla completa o como app suelta)?
export function installed(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof win.matchMedia === "function" &&
      win.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches)
  );
}

// Cómo se instala a mano: en el iPhone, desde Safari; en lo demás, desde el menú de Chrome.
export function installHow(userAgent: string): string {
  return /iPhone|iPad|iPod/.test(userAgent || "")
    ? "En Safari: botón Compartir → «Añadir a pantalla de inicio». Después, ábrela siempre desde su icono."
    : "Menú ⋮ de Chrome → «Añadir a pantalla de inicio» (o «Instalar aplicación»), con internet. Después, ábrela siempre desde su icono.";
}

// El aviso guardado, para useSyncExternalStore: se escucha desde la primera suscripción y ya no se deja de escuchar
// (Chrome lo manda una vez).
export function createInstallPrompt(win: Window) {
  let saved: InstallPromptEvent | null = null;
  let wired = false;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((fn) => fn());

  function wire(): void {
    if (wired) return;
    wired = true;
    win.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      saved = e as InstallPromptEvent;
      emit();
    });
    win.addEventListener("appinstalled", () => {
      saved = null;
      emit();
    });
  }

  return {
    subscribe(fn: () => void): () => void {
      wire();
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    // Chrome ofrece instalarla ahora.
    available: (): boolean => saved !== null,
    // El botón: el aviso de Chrome, una sola vez (después ya no vale).
    async prompt(): Promise<void> {
      const e = saved;
      if (!e) return;
      saved = null;
      emit();
      try {
        await e.prompt();
        await e.userChoice;
      } catch {
        /* ya usado o rechazado */
      }
      emit();
    },
  };
}

export type InstallPrompt = ReturnType<typeof createInstallPrompt>;

// El de la página (se crea al usarlo por primera vez).
let pagePrompt: InstallPrompt | null = null;
export function installPrompt(): InstallPrompt {
  if (!pagePrompt) pagePrompt = createInstallPrompt(window);
  return pagePrompt;
}
