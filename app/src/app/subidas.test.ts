import { describe, expect, it } from "vitest";
import { meters } from "../core/tramos";
import { contraria, ISLAS, subidasEn, todasLasSubidas } from "./subidas";

const tenerife = ISLAS.find((i) => i.id === "tenerife");

describe("subidas de montaña", () => {
  it("Tenerife, con sus dos sentidos y las once subidas en el orden en que se dieron", () => {
    expect(tenerife).toBeDefined();
    if (!tenerife) return;
    expect(tenerife.sentidos.map((s) => s.nombre)).toEqual([
      "Dirección sur",
      "Dirección Santa Cruz",
    ]);
    expect(tenerife.subidas.map((s) => s.nombre)).toEqual([
      "Carretera vieja",
      "Barranco Hondo",
      "Cuesta de Las Tablas",
      "Araya",
      "Los Loros",
      "La Esperanza",
      "El Teide",
      "El Escobonal",
      "Arico",
      "Jama",
      "El Boquerón",
    ]);
  });

  it("cada punto en Tenerife (una errata en una coordenada lo sacaría), y salida y meta separadas", () => {
    for (const isla of ISLAS)
      for (const s of isla.subidas) {
        for (const [lat, lon] of [s.salida, s.meta]) {
          expect(lat).toBeGreaterThan(27.99);
          expect(lat).toBeLessThan(28.62);
          expect(lon).toBeGreaterThan(-16.93);
          expect(lon).toBeLessThan(-16.1);
        }
        expect(meters(s.salida, s.meta)).toBeGreaterThan(300);
      }
  });

  it("Arico sale de 28.258358 (en el mensaje ponía 8.258358) y Los Loros, del punto bajando del bar", () => {
    const s = (id: string) => tenerife?.subidas.find((x) => x.id === id);
    expect(s("arico")?.salida).toEqual([28.258358, -16.43155]);
    // 28°21'20.5"N 16°25'08.2"W
    expect(s("los-loros")?.salida).toEqual([28.355694, -16.418944]);
    expect(s("jama")?.salida).toEqual([28.096857, -16.636416]);
    expect(s("jama")?.meta).toEqual([28.116826, -16.663297]);
    expect(s("el-boqueron")?.salida).toEqual([28.510652, -16.391261]);
    expect(s("el-boqueron")?.meta).toEqual([28.502431, -16.380324]);
  });

  it("dirección sur: como se dieron; dirección Santa Cruz: al revés, en orden inverso y con el detalle dado la vuelta", () => {
    if (!tenerife) return;
    const sur = subidasEn(tenerife, 0);
    const sc = subidasEn(tenerife, 1);
    expect(sur.map((s) => s.titulo)).toEqual(tenerife.subidas.map((s) => s.nombre));
    expect(sc.map((s) => s.titulo)).toEqual(tenerife.subidas.map((s) => s.nombre).reverse());
    const loros = sur.find((s) => s.subida === "los-loros");
    const lorosSc = sc.find((s) => s.subida === "los-loros");
    expect(loros?.nombre).toBe("Los Loros (sur)");
    expect(lorosSc?.nombre).toBe("Los Loros (Santa Cruz)");
    expect(loros?.detalle).toBe("Desde el bar de Los Loros");
    expect(lorosSc?.detalle).toBe("Hasta el bar de Los Loros");
    expect(lorosSc?.salida).toEqual(loros?.meta);
    expect(lorosSc?.meta).toEqual(loros?.salida);
    const teide = sc.find((s) => s.subida === "el-teide");
    expect(teide?.detalle).toBe("Desde El Portillo hasta el cruce de Los Loros");
  });

  it("veintidós (once en cada sentido), con ids distintos, y cada una sabe cuál es su contraria", () => {
    const all = todasLasSubidas();
    expect(all.length).toBe(22);
    expect(new Set(all.map((s) => s.id)).size).toBe(22);
    for (const s of all) {
      const c = all.find((x) => x.id === contraria(s.id));
      expect(c).toBeDefined();
      expect(c?.subida).toBe(s.subida);
      expect(c?.sentido).not.toBe(s.sentido);
      expect(contraria(contraria(s.id) ?? "")).toBe(s.id);
    }
    expect(all[0].id).toBe("subida:tenerife/carretera-vieja/sur");
    expect(contraria("tr-abc")).toBeNull();
  });
});
