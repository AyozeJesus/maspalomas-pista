import { describe, expect, it } from "vitest";
import { newMapView, viewForSession, zoomIn, zoomOut } from "./map-view";

describe("mapa en directo del entrenamiento en 8", () => {
  it("empieza de cerca (60 m) y se acerca hasta 30 m; en una ruta, como siempre (600 m, hasta 150)", () => {
    const v = newMapView();
    expect([v.span, v.minSpan]).toEqual([600, 150]);
    viewForSession(v, true, false);
    expect([v.span, v.minSpan, v.follow]).toEqual([60, 30, true]);
    for (let i = 0; i < 5; i++) zoomIn(v);
    expect(v.span).toBe(30);
    zoomOut(v);
    expect(v.span).toBeCloseTo(48, 9);
    // La siguiente, una ruta libre: otra vez como siempre.
    viewForSession(v, false, true);
    expect([v.span, v.minSpan]).toEqual([600, 150]);
    for (let i = 0; i < 9; i++) zoomIn(v);
    expect(v.span).toBe(150);
  });

  it("entre rutas sin ochos no cambia lo que se haya acercado (como antes)", () => {
    const v = newMapView();
    zoomIn(v);
    const span = v.span;
    viewForSession(v, false, false);
    expect(v.span).toBe(span);
    expect(v.drawnAt).toBe(0);
  });
});
