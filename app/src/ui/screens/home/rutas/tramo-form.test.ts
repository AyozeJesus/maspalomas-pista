import { describe, expect, it } from "vitest";
import { legacy, liveFunctions } from "../../../../../test/legacy";
import type { LatLon } from "../../../../core/tramos";
import { memoryKV } from "../../../../engine/kv";
import { loadTramos, TRAMOS_KEY } from "../../../../services/tramos-store";
import { createGateTramo, cleanName, deleteTramo, renameTramo } from "./tramo-actions";
import {
  checkTramoForm,
  hereText,
  newGateTramo,
  previewHidden,
  savedToast,
  savingToast,
} from "./tramo-form";

// tramoFormCheck de antes lee las casillas y escribe la nota, el enlace y el dibujo en la página: aquí, en elementos
// de mentira con lo que tocaba.
interface Els {
  "trs-a": { value: string };
  "trs-b": { value: string };
  "trs-maps": { hidden: boolean; href: string };
  "trs-prev": { hidden: boolean };
  "trs-new": { open: boolean };
  "trs-note": { textContent: string; className: string };
}
const els: Els = {
  "trs-a": { value: "" },
  "trs-b": { value: "" },
  "trs-maps": { hidden: true, href: "" },
  "trs-prev": { hidden: true },
  "trs-new": { open: true },
  "trs-note": { textContent: "", className: "muted" },
};
const draws: unknown[] = [];
const old = liveFunctions<{ tramoFormCheck(): { a: LatLon; b: LatLon } | null }>(
  ["fmt", "fmtMeters", "setText", "mapsLink", "tramoFormNote", "tramoFormCheck"],
  {
    consts: ["NF"],
    globals: {
      $: (id: keyof Els) => els[id],
      MaspaTramos: legacy("MaspaTramos", "tramos.js"),
      drawTramoPrev: (a: unknown, b: unknown) => draws.push(JSON.parse(JSON.stringify([a, b]))),
    },
  },
);

const A = "28.355628, -16.418573";
const B_LINK =
  "https://www.google.com/maps/place/Curva/@28.374397,-16.427567,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d28.374397!4d-16.427567";
const CASES: [string, string][] = [
  ["", ""],
  ["  ", "   "],
  ["hola", ""],
  ["", "hola"],
  ["", A],
  [A, ""],
  [A, "xx"],
  [A, B_LINK],
  ["  " + A + "  ", "28.374397 -16.427567"],
  [A, A],
  [A, "28.3558, -16.4186"],
  [A, "28.9, -16.0"],
  ["0, 0", A],
  ["27°55'24.4\"N 15°34'04.4\"W", "geo:27.95,-15.6?z=17"],
  ["https://maps.app.goo.gl/AbCdEf123", A],
  ["27,923456; -15,567890", "https://maps.google.com/?q=27.95,-15.60"],
];

describe("«Nuevo tramo con salida y meta»: comprobar lo escrito", () => {
  for (const open of [true, false])
    for (const [ta, tb] of CASES)
      it(
        "«" + ta.slice(0, 30) + "» → «" + tb.slice(0, 30) + "»" + (open ? "" : " (cerrado)"),
        () => {
          // Lo de antes: el enlace solo cambia con las dos; si no, se queda el de la vez anterior (oculto).
          els["trs-a"].value = ta;
          els["trs-b"].value = tb;
          els["trs-new"].open = open;
          els["trs-maps"].href = "";
          draws.length = 0;
          const okOld = old.tramoFormCheck();
          const c = checkTramoForm(ta, tb);
          expect(JSON.parse(JSON.stringify(c.ok))).toEqual(JSON.parse(JSON.stringify(okOld)));
          expect(c.text).toBe(els["trs-note"].textContent);
          expect(c.bad ? "muted bad" : "muted").toBe(els["trs-note"].className);
          expect(!c.maps).toBe(els["trs-maps"].hidden);
          expect(c.maps ?? "").toBe(els["trs-maps"].href);
          const hidden = previewHidden(c, open);
          expect(hidden).toBe(els["trs-prev"].hidden);
          // Se dibuja lo mismo (la salida y la meta entendidas) cuando se ve.
          expect(hidden ? [] : [[c.a, c.b]]).toEqual(draws);
        },
      );

  it("los textos de la nota", () => {
    expect(checkTramoForm("", "").text).toBe("");
    expect(checkTramoForm(A, "").text).toBe("Falta la meta.");
    expect(checkTramoForm("hola", "").text).toBe(
      "No entiendo la salida: pega «28.355628, -16.418573» o un enlace de Google Maps con las coordenadas (los cortos, maps.app.goo.gl, no las llevan).",
    );
    expect(checkTramoForm(A, B_LINK).text).toBe("De la salida a la meta, 2,3 km en línea recta.");
    expect(checkTramoForm(A, "28.9, -16.0").text).toBe(
      "Demasiado lejos: más de 45 km en línea recta.",
    );
  });
});

describe("«Aquí» y el tramo que se guarda", () => {
  it("«Aquí» escribe la posición con 6 decimales", () => {
    expect(hereText(28.3556281234, -16.4185729)).toBe("28.355628, -16.418573");
    expect(hereText(-0.5, 3)).toBe("-0.500000, 3.000000");
  });

  it("el tramo nuevo: con el nombre escrito (40 letras) o el primer «Crono N» libre", () => {
    const a: LatLon = [28.355628, -16.418573];
    const b: LatLon = [28.374397, -16.427567];
    const now = Date.UTC(2026, 9, 10, 12, 0, 0);
    const tr = newGateTramo(["Crono 1", "Crono 3"], "   ", a, b, now);
    expect(Object.keys(tr)).toEqual(["id", "nombre", "creado", "salida", "meta", "pasadas"]);
    expect(tr.nombre).toBe("Crono 2");
    expect(tr.id.startsWith("tr-" + now.toString(36))).toBe(true);
    expect(tr.creado).toBe("2026-10-10T12:00:00.000Z");
    expect(tr).toMatchObject({ salida: a, meta: b, pasadas: [] });
    expect(newGateTramo([], "  Los Loros medio ", a, b, now).nombre).toBe("Los Loros medio");
    expect(newGateTramo([], "x".repeat(50), a, b, now).nombre).toBe("x".repeat(40));
  });

  it("guardarlo, cambiarle el nombre y borrarlo (los que no valen se quedan fuera, como antes)", () => {
    const kv = memoryKV({
      [TRAMOS_KEY]: [{ id: "malo", nombre: "Sin camino", pts: [[1, 2]], pasadas: [] }],
    });
    const tr = createGateTramo(kv, "", [28.35, -16.41], [28.37, -16.42], Date.now());
    expect(tr.nombre).toBe("Crono 1");
    expect(loadTramos(kv).map((t) => t.id)).toEqual([tr.id]);
    expect(JSON.parse(kv.getRaw(TRAMOS_KEY) ?? "[]")).toHaveLength(1);
    expect(renameTramo(kv, tr.id, "Subida")).toBe(true);
    expect(loadTramos(kv)[0].nombre).toBe("Subida");
    expect(renameTramo(kv, "no-está", "Otro")).toBe(false);
    deleteTramo(kv, tr.id);
    expect(loadTramos(kv)).toEqual([]);
  });

  it("el nombre de la ventanita: sin espacios de más y 40 letras como mucho", () => {
    expect(cleanName(null)).toBe("");
    expect(cleanName("  Los Loros subida  ")).toBe("Los Loros subida");
    expect(cleanName("y".repeat(45))).toBe("y".repeat(40));
  });

  it("los avisos al guardar", () => {
    expect(savingToast("Los Loros medio")).toBe(
      "«Los Loros medio» guardado: buscándolo en tus rutas…",
    );
    expect(savedToast("Los Loros medio", 1)).toBe("«Los Loros medio»: 1 pasada en tus rutas");
    expect(savedToast("Los Loros medio", 2)).toBe("«Los Loros medio»: 2 pasadas en tus rutas");
    expect(savedToast("Crono 1", 0)).toBe(
      "«Crono 1» guardado: al pasar por la salida empieza a contar",
    );
  });
});
