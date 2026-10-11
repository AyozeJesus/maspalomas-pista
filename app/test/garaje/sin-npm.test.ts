// El servidor del garaje corre sin npm (en el checkout del Mac no hay node_modules). Aquí sí los hay, así que un import
// de un paquete funcionaría en las pruebas y fallaría en el Mac: el hook del garaje lo para en los dos sitios.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./servidor";

const HOOKS = join(REPO, "garaje", "server", "hooks.ts");

// Corre `code` (un módulo) con los hooks del garaje, desde app/ (donde node_modules sí tiene los paquetes).
function run(code: string) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "--import",
      HOOKS,
      "--input-type=module",
      "-e",
      code,
    ],
    { cwd: join(REPO, "app"), encoding: "utf8" },
  );
}

describe("garaje: sin paquetes de npm", () => {
  it("un import de npm se para con un mensaje claro, aunque el paquete esté instalado", () => {
    const r = run('await import("zod");');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/El garaje no puede usar paquetes de npm \(«zod»/);
  });

  it("los módulos de Node y los .ts de la app sin extensión, sí", () => {
    // Relativo a app/ (desde donde corre): como importa el garaje los cálculos de la app.
    const r = run(
      'const p = await import("node:path"); const f = await import("./src/core/formato");' +
        " console.log(typeof p.join, f.VERSION);",
    );
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("function 1");
  });
});
