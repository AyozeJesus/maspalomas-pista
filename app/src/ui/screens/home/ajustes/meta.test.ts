import { describe, expect, it } from "vitest";
import { liveFunctions } from "../../../../../test/legacy";
import { MASPA_GEO, MaspaAnalysis, ring } from "../../../../core/maspalomas";
import { finishAt, finishMark, metaViewBox, nearestPoint, roadPath } from "./meta";

const C = MASPA_GEO.main;

interface FakeNode {
  tag: string;
  attrs: Record<string, string>;
  children: FakeNode[];
  textContent: string;
  setAttribute(k: string, v: unknown): void;
  appendChild(e: FakeNode): FakeNode;
}

function node(tag: string): FakeNode {
  return {
    tag,
    attrs: {},
    children: [],
    textContent: "",
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    appendChild(e) {
      this.children.push(e);
      return e;
    },
  };
}

// drawMetaMap de antes, con la meta en el punto osm: lo que dejaba en #meta-svg.
function oldMap(osm: number): FakeNode {
  const root = node("svg");
  const old = liveFunctions<{ drawMetaMap: () => void }>(["drawMetaMap"], {
    globals: {
      $: () => root,
      GEO: MASPA_GEO,
      MaspaAnalysis,
      settings: { finish: { osm, rev: 0 } },
      document: { createElementNS: (_ns: string, tag: string) => node(tag) },
    },
  });
  old.drawMetaMap();
  return root;
}

describe("línea de meta en el mapa", () => {
  it("el mismo dibujo que drawMetaMap: trazado, raya de meta y rótulo", () => {
    for (const osm of [0, 1, 57, 200, 333, C.length - 1]) {
      const old = oldMap(osm);
      const mark = finishMark(C, osm);
      expect(mark).not.toBeNull();
      if (!mark) continue;
      expect(old.attrs.viewBox).toBe(metaViewBox(C));
      expect(old.children.map((c) => c.tag)).toEqual(["path", "line", "text"]);
      const [path, line, text] = old.children;
      expect(path.attrs).toEqual({ d: roadPath(C), class: "m-road" });
      expect(line.attrs, "meta " + osm).toEqual({
        x1: String(mark.x1),
        y1: String(mark.y1),
        x2: String(mark.x2),
        y2: String(mark.y2),
        class: "m-finish",
      });
      expect(text.attrs).toEqual({ x: String(mark.tx), y: String(mark.ty), class: "m-text" });
      expect(text.textContent).toBe("Meta");
    }
  });

  it("una meta que no es del trazado (ajustes estropeados) se queda sin raya", () => {
    expect(finishMark(C, C.length)).toBeNull();
    expect(finishMark(C, -1)).toBeNull();
    expect(finishMark(C, NaN)).toBeNull();
  });

  it("el toque: el punto del trazado más cerca, si cae a menos de 25 de la pista", () => {
    for (const k of [0, 10, 250, C.length - 1]) {
      expect(nearestPoint(C, C[k][0], C[k][1])).toBe(k);
      expect(nearestPoint(C, C[k][0] + 0.3, C[k][1] - 0.2)).toBe(k);
    }
    // Lejos de la pista no hace nada.
    expect(nearestPoint(C, -1000, -1000)).toBeNull();
    // Por todo el mapa: el más cercano (el primero si empatan) o nada si el más cercano está a más de 25.
    let near = 0;
    let none = 0;
    for (let x = 20; x < 700; x += 9)
      for (let y = 20; y < 320; y += 9) {
        let best = 0;
        let bd = Infinity;
        C.forEach((p, i) => {
          const d = Math.hypot(p[0] - x, p[1] - y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        const want = bd > 25 ? null : best;
        expect(nearestPoint(C, x, y), x + "," + y).toBe(want);
        if (want === null) none++;
        else near++;
      }
    expect(near).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(100);
  });

  it("la meta en los dos sentidos: al revés, contada desde el final", () => {
    expect(finishAt(C, 0)).toEqual({ osm: 0, rev: 0 });
    expect(finishAt(C, 10)).toEqual({ osm: 10, rev: ring(C.length - 10, C.length) });
    expect(finishAt(C, 10).rev).toBe(C.length - 10);
  });
});
