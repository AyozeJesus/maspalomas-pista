import { describe, expect, it } from "vitest";
import { toLatLon, toLocal } from "../core/maspalomas";
import { latLonText, mapsUrl, placeOf } from "./maps";

describe("un punto en Google Maps", () => {
  it("las coordenadas como las escribe Google Maps: con punto, 6 decimales y coma entre las dos", () => {
    expect(latLonText(28.3556941, -16.4189444)).toBe("28.355694, -16.418944");
    expect(latLonText(27.7651, -15.58)).toBe("27.765100, -15.580000");
  });

  it("el enlace que lo abre en Google Maps (la búsqueda de un punto, sin espacios)", () => {
    expect(mapsUrl(28.3556941, -16.4189444)).toBe(
      "https://www.google.com/maps/search/?api=1&query=28.355694,-16.418944",
    );
  });

  it("un punto de la ruta (metros locales): de vuelta a sus coordenadas, también en Tenerife", () => {
    for (const [lat, lon] of [
      [28.355694, -16.418944],
      [27.765, -15.58],
    ]) {
      const [x, y] = toLocal(lat, lon);
      expect(placeOf({ x, y })).toEqual({
        ll: latLonText(lat, lon),
        url: mapsUrl(lat, lon),
      });
    }
    const [lat, lon] = toLatLon(1234.5, -678.9);
    expect(placeOf({ x: 1234.5, y: -678.9 }).ll).toBe(lat.toFixed(6) + ", " + lon.toFixed(6));
  });
});
