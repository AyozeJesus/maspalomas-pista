// La app instalable y sin cobertura: el service worker propio (sw/sw.ts, con la lista de archivos de cada versión) y
// el mismo manifest de siempre (misma dirección, mismo start_url y scope): la app ya instalada en el móvil sigue
// siendo la misma y conserva sus datos.
import { VitePWA } from "vite-plugin-pwa";

export function pwa() {
  return VitePWA({
    strategies: "injectManifest",
    srcDir: "sw",
    filename: "sw.ts",
    // El registro lo hace la app (app/sw-register.ts), como antes: solo con https y recargando solo en la portada.
    injectRegister: false,
    manifestFilename: "manifest.webmanifest",
    manifest: {
      name: "Modo pista Maspalomas",
      short_name: "Pista",
      description:
        "Delta en directo, vueltas y sectores en el circuito de Maspalomas con el GPS del móvil.",
      lang: "es",
      start_url: "./",
      scope: "./",
      display: "fullscreen",
      orientation: "any",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    injectManifest: {
      // Todo lo de la versión, menos los mapas de código (solo para depurar).
      globPatterns: ["**/*.{js,css,html,png,webmanifest}"],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    devOptions: { enabled: false },
  });
}
