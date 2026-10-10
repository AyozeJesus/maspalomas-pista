import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Pruebas en Node por defecto (el núcleo no toca el DOM); un componente pide jsdom con
// «// @vitest-environment jsdom» en la primera línea de su prueba. Las que comparan con la app de antes analizan tandas
// enteras dos veces (la de antes y la nueva): en el Mac tardan 1-2 s, pero en GitHub Actions pasaban de los 5 s de
// límite, así que el límite es de 30 s.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts", "sw/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
      testTimeout: 30_000,
    },
  }),
);
