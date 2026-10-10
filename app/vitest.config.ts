import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Pruebas en Node por defecto (el núcleo no toca el DOM); un componente pide jsdom con
// «// @vitest-environment jsdom» en la primera línea de su prueba.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  }),
);
