import { describe, expect, it } from "vitest";
import { memoryKV } from "../../../../engine/kv";
import { DEFAULT_SETTINGS, type Settings } from "../../../../engine/settings";
import { bestStatus, forgetBest } from "./best";

const LAP = { time: 68.5, grid: [], sectors: [1, 2, 3, 4] };
const settingsWith = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("mejor vuelta guardada (st-best)", () => {
  it("sin ninguna: los dos sentidos con raya y el punto gris", () => {
    expect(bestStatus(DEFAULT_SETTINGS, memoryKV())).toEqual({
      state: "",
      text: "Mejor vuelta guardada: antihorario — · horario —",
    });
  });

  it("la del piloto de ahora, en su sentido (como la batería: «de Ayoze: antihorario 1:08,50»)", () => {
    const kv = memoryKV({ "pista-mejor-osm-0-ayoze": LAP, "pista-mejor-rev-0": { time: 70 } });
    expect(bestStatus(settingsWith({ piloto: "Ayoze" }), kv)).toEqual({
      state: "ok",
      text: "Mejor vuelta guardada de Ayoze: antihorario 1:08,50 · horario —",
    });
    // Otro piloto en el mismo móvil no ve la de Ayoze; sin nombre, la de siempre (sin piloto).
    expect(bestStatus(settingsWith({ piloto: "Amigo" }), kv).text).toBe(
      "Mejor vuelta guardada de Amigo: antihorario — · horario —",
    );
    expect(bestStatus(DEFAULT_SETTINGS, kv)).toEqual({
      state: "ok",
      text: "Mejor vuelta guardada: antihorario — · horario 1:10,00",
    });
  });

  it("con la meta en otro sitio, la de esa meta", () => {
    const kv = memoryKV({ "pista-mejor-osm-0": LAP, "pista-mejor-rev-12": { time: 66.123 } });
    expect(bestStatus(settingsWith({ finish: { osm: 40, rev: 12 } }), kv).text).toBe(
      "Mejor vuelta guardada: antihorario — · horario 1:06,12",
    );
  });

  it("borrarla quita las dos del piloto (y solo las suyas)", () => {
    const kv = memoryKV({
      "pista-mejor-osm-0-ayoze": LAP,
      "pista-mejor-rev-0-ayoze": LAP,
      "pista-mejor-osm-0": LAP,
    });
    const s = settingsWith({ piloto: "Ayoze" });
    forgetBest(s, kv);
    expect(bestStatus(s, kv)).toEqual({
      state: "",
      text: "Mejor vuelta guardada de Ayoze: antihorario — · horario —",
    });
    expect(kv.load("pista-mejor-osm-0", null)).toEqual(LAP);
  });
});
