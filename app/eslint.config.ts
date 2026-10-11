import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// También vale para el garaje del Mac (../garaje): `npm run lint` lo pasa desde la raíz del repo con esta misma
// configuración, porque ESLint no mira archivos fuera de la carpeta desde la que se lanza.
export default defineConfig([
  globalIgnores(["dist", "coverage", "dev-dist", ".vitest", "garaje/web/vendor"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Pruebas, configuración y scripts: corren en Node.
    files: ["test/**/*.ts", "**/*.test.{ts,tsx}", "*.config.{js,ts}", "scripts/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Los scripts (la paridad del motor…) cuentan por la consola lo que van comprobando.
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // El servidor del garaje corre en Node y cuenta lo que pasa en su ventana de Terminal.
    files: ["garaje/server/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
]);
