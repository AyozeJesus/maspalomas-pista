// Lo que cargan las páginas del garaje, pedido como lo pide el navegador: cada módulo llega sin tipos, como JavaScript,
// y sus imports solo llevan a archivos del repo o a lo que trae el import map de la página (three). El garaje no
// construye nada ni tiene npm: si algo de app/src que usa el garaje empieza a importar React, un paquete de npm, un
// .tsx o sintaxis que Node no sabe quitar, esta prueba falla aquí y no en el Mac el día de rodar.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirGaraje, REPO, type GarajePrueba } from "./servidor";

let g: GarajePrueba;
beforeAll(async () => {
  g = await abrirGaraje();
});
afterAll(async () => {
  await g?.stop();
});

interface Grafo {
  // Dirección pedida → dirección final (tras redirigir una carpeta a su index.ts).
  modulos: Map<string, string>;
  problemas: string[];
}

// Recorre los módulos de una página desde sus <script type="module">, como el navegador.
async function grafo(pagina: string): Promise<Grafo> {
  const base = g.garaje + pagina;
  const html = await (await fetch(base)).text();
  const mapa = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  const imports = (mapa ? JSON.parse(mapa[1]) : { imports: {} }).imports as Record<string, string>;
  const cola = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(
    (m) => new URL(m[1], base).href,
  );
  const modulos = new Map<string, string>();
  const problemas: string[] = [];
  while (cola.length) {
    const url = cola.shift() as string;
    if (modulos.has(url)) continue;
    const r = await fetch(url);
    modulos.set(url, r.url);
    if (r.status !== 200) {
      problemas.push(url + " → " + r.status);
      continue;
    }
    if (!/^text\/javascript/.test(r.headers.get("content-type") || ""))
      problemas.push(url + " no llega como JavaScript");
    const js = await r.text();
    for (const f of ts.preProcessFile(js, true, true).importedFiles) {
      const spec = f.fileName;
      if (/^\.\.?\//.test(spec) || spec.startsWith("/")) cola.push(new URL(spec, r.url).href);
      else if (imports[spec]) cola.push(new URL(imports[spec], base).href);
      else
        problemas.push(
          r.url.replace(g.garaje, "") + " importa «" + spec + "», que el garaje no tiene",
        );
    }
  }
  return { modulos, problemas };
}

describe("garaje: los módulos de sus páginas", () => {
  for (const pagina of ["/", "/analisis"])
    it("«" + pagina + "» carga solo archivos del repo y los del import map", async () => {
      const { modulos, problemas } = await grafo(pagina);
      expect(problemas).toEqual([]);
      // La página y lo que usa de la app.
      expect(modulos.size).toBeGreaterThan(pagina === "/" ? 3 : 10);
      // Cada archivo, con una sola dirección: con dos, el navegador lo cargaría dos veces (dos copias de su estado).
      const porArchivo = new Map<string, string[]>();
      for (const [pedida, final] of modulos) {
        const archivo = final.replace(/(\/index)?(\.ts)?$/, "");
        porArchivo.set(archivo, [...(porArchivo.get(archivo) || []), pedida]);
      }
      const repetidos = [...porArchivo.values()].filter((v) => v.length > 1);
      expect(repetidos).toEqual([]);
    });

  it("cada módulo llega sin tipos y con las mismas líneas que el .ts", async () => {
    const r = await fetch(g.garaje + "/garaje/web/garaje.ts");
    const js = await r.text();
    const src = readFileSync(join(REPO, "garaje", "web", "garaje.ts"), "utf8");
    expect(js.split("\n")).toHaveLength(src.split("\n").length);
    expect(js).not.toMatch(/import type|: Promise<number>/);
  });

  it("three y JSZip son los mismos que instala npm (si cambia la versión, se vuelven a copiar)", () => {
    const same = (vendor: string, npm: string) =>
      readFileSync(join(REPO, "garaje", "web", "vendor", vendor)).equals(
        readFileSync(join(REPO, "app", "node_modules", npm)),
      );
    expect(same("three.module.js", "three/build/three.module.js")).toBe(true);
    expect(same("jszip.min.js", "jszip/dist/jszip.min.js")).toBe(true);
  });
});
