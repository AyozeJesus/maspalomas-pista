import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// La app se publica en https://ayozejesus.github.io/maspalomas-pista/ (misma dirección que la de siempre: así el
// móvil conserva sus rutas, tramos y ajustes, que viven en el almacenamiento de esa dirección).
export default defineConfig({
  base: "/maspalomas-pista/",
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
