// La imagen para compartir de un entrenamiento en 8: sus casillas dicen lo mismo que la tarjeta «Ochos» de «Ver» (la
// inclinación de la imagen es la máxima, y lo pone: la tarjeta llama «sostenida» a la de casi siempre).
import { describe, expect, it } from "vitest";
import { demoSeries, routeOf } from "../../test/fixtures-ruta-fin";
import { routeShareData } from "./share";

describe("compartir un entrenamiento en 8", () => {
  it("la inclinación, como máxima y con los números de la sesión", async () => {
    const eng = await routeOf(demoSeries(), { modo: "ocho" });
    const tr = eng.ocho;
    expect(tr).toBeTruthy();
    const d = routeShareData(eng, "fase");
    const stats = Object.fromEntries(d.stats.map((s) => [s[0], s[1]]));
    expect(d.titulo).toBe("Entrenamiento en 8");
    expect(Object.keys(stats)).toContain("Incl. izq. máx.");
    expect(Object.keys(stats)).toContain("Incl. der. máx.");
    expect(Object.keys(stats)).not.toContain("Incl. izquierda");
    expect(stats.Ochos).toBe(String(tr ? tr.summary().n : -1));
  });
});
