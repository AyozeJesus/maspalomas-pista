// Node solo resuelve un import relativo con la extensión escrita; la app los escribe sin ella («./types»), como los
// resuelve Vite. Esto los lleva al .ts (o al index.ts de la carpeta). main.ts lo carga antes que el resto.
//
// Y el garaje corre sin npm: en el checkout del Mac no hay node_modules, así que un paquete de npm (en el servidor o
// en lo que importa de app/src) fallaría allí aunque aquí, con node_modules, funcionara. Se para aquí mismo, con un
// mensaje claro, para que las pruebas lo vean.
import { isBuiltin, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveTs } from "./ts.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith("file:")) {
      const file = resolveTs(fileURLToPath(new URL(specifier, context.parentURL)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (!isBuiltin(specifier) && !/^(\.\.?\/|\/|file:)/.test(specifier))
      throw new Error(
        "El garaje no puede usar paquetes de npm («" +
          specifier +
          "», desde " +
          (context.parentURL || "?") +
          "): en el Mac no hay node_modules.",
      );
    return nextResolve(specifier, context);
  },
});
