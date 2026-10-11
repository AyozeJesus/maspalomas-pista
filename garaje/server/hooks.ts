// Node solo resuelve un import relativo con la extensión escrita; la app los escribe sin ella («./types»), como los
// resuelve Vite. Esto los lleva al .ts (o al index.ts de la carpeta). main.ts lo carga antes que el resto.
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveTs } from "./ts.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith("file:")) {
      const file = resolveTs(fileURLToPath(new URL(specifier, context.parentURL)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
