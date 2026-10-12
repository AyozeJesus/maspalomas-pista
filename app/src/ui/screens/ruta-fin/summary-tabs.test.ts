// Las pestañas del resumen sin pintar: cuál se ve, las teclas y dónde queda la página al cambiar. Cuáles salen en cada
// ruta, en RutaFin.tabs.test.tsx (con sus tarjetas).
import { describe, expect, it } from "vitest";
import { scrollForTab, shownTab, tabByKey, TAB_LABELS, type TabInfo } from "./summary-tabs";

const ALL: TabInfo[] = (["resumen", "tramos", "pilotaje", "3d", "opciones"] as const).map((id) => ({
  id,
  label: TAB_LABELS[id],
}));
const FEW = ALL.filter((t) => t.id !== "tramos" && t.id !== "3d");

describe("pestañas del resumen", () => {
  it("se ve la elegida si la ruta la tiene; si no, «Resumen»", () => {
    expect(shownTab(ALL, "3d")).toBe("3d");
    expect(shownTab(FEW, "3d")).toBe("resumen");
    expect(shownTab(FEW, "opciones")).toBe("opciones");
  });

  it("flechas (dando la vuelta, solo por las que salen), Inicio y Fin; otra tecla, nada", () => {
    expect(tabByKey(ALL, "resumen", "ArrowRight")).toBe("tramos");
    expect(tabByKey(ALL, "opciones", "ArrowRight")).toBe("resumen");
    expect(tabByKey(ALL, "resumen", "ArrowLeft")).toBe("opciones");
    expect(tabByKey(FEW, "pilotaje", "ArrowRight")).toBe("opciones");
    expect(tabByKey(FEW, "opciones", "ArrowLeft")).toBe("pilotaje");
    expect(tabByKey(ALL, "pilotaje", "Home")).toBe("resumen");
    expect(tabByKey(ALL, "pilotaje", "End")).toBe("opciones");
    expect(tabByKey(ALL, "pilotaje", "Enter")).toBeNull();
  });

  it("con la página bajada, al principio del panel nuevo (bajo las pestañas); si no, donde está", () => {
    // Los paneles empiezan a 1200 px del principio de la página; las pestañas acaban a 48 px de arriba.
    expect(scrollForTab(1200 - 2000, 2000, 48)).toBe(1152);
    expect(scrollForTab(1200 - 1153, 1153, 48)).toBe(1152);
    expect(scrollForTab(1200 - 1152, 1152, 48)).toBeNull();
    expect(scrollForTab(1200 - 300, 300, 48)).toBeNull();
    // Con el borde seguro de arriba (la cámara del móvil), las pestañas acaban más abajo.
    expect(scrollForTab(1200 - 2000, 2000, 48 + 30)).toBe(1122);
  });
});
