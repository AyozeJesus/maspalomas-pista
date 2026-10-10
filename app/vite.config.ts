import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { pwa } from "./pwa.config";

// La app se publica en https://ayozejesus.github.io/maspalomas-pista/ (misma dirección que la de siempre: así el
// móvil conserva sus rutas, tramos y ajustes, que viven en el almacenamiento de esa dirección). Rutas relativas («./»):
// vale igual ahí que servida desde cualquier carpeta (las pruebas de siempre la sirven en la raíz).
export default defineConfig({
  base: "./",
  plugins: [react(), pwa()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
