// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DIAS, legacyRender, realDay } from "../../test/fixtures-comparativa";
import * as C from "./comparativa";

// La comparativa de antes (comparativa.js de la raíz del repo) solo sabe pintar: lo que pinta se lee otra vez como
// bloques para compararlo con lo que calcula la nueva.
const oldRender = legacyRender();

// El texto de un elemento sin el de sus hijos (el de un <th> sin su <small>).
const own = (e: Element) =>
  Array.from(e.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("");
const small = (e: Element) => e.querySelector(":scope > small")?.textContent ?? null;
const text = (e: Element | undefined) => (e && e.textContent) ?? "";

function readBlocks(box: Element): C.Block[] {
  const out: C.Block[] = [];
  const kids = Array.from(box.children);
  for (let i = 0; i < kids.length; i++) {
    const e = kids[i];
    if (e.tagName === "P") {
      const kind =
        e.className === "cmp-empty" ? "empty" : e.className === "cmp-head" ? "head" : "note";
      out.push({ kind, text: text(e) });
    } else if (e.tagName === "H3" && kids[i + 1]?.className === "cmp-wrap") {
      const wrap = kids[++i];
      out.push({
        kind: "table",
        title: text(e),
        head: Array.from(wrap.querySelectorAll("thead th")).map((th) => ({
          text: own(th),
          cls: th.className,
          sub: small(th) ?? "",
        })),
        rows: Array.from(wrap.querySelectorAll("tbody tr")).map((tr) => {
          const [who, ...tds] = Array.from(tr.children);
          return {
            who: text(who),
            cells: tds.map((td) => ({
              main: text(td.querySelector("b") ?? undefined),
              sub: small(td) ?? "",
              top: td.classList.contains("top"),
            })),
          };
        }),
      });
    } else if (e.tagName === "H3") out.push({ kind: "title", text: text(e) });
    else if (e.className === "cmp-laps") {
      const [who, ...chips] = Array.from(e.children);
      out.push({
        kind: "laps",
        piloto: text(who),
        laps: chips.map((chip) => ({
          time: text(chip.querySelector("b") ?? undefined),
          top: chip.classList.contains("top"),
          sub: small(chip),
        })),
      });
    } else throw new Error("No se esperaba " + e.outerHTML);
  }
  return out;
}

function legacyBlocks(d: C.DiaComparativa | null | undefined): C.Block[] {
  const box = document.createElement("div");
  oldRender(box, d);
  return readBlocks(box);
}

const tables = (blocks: C.Block[]) => blocks.filter((b) => b.kind === "table");

describe("comparativa del día (igual que la de antes)", () => {
  for (const [label, d] of DIAS)
    it(label + ": lo mismo", () => {
      expect(C.comparativaBlocks(d)).toEqual(legacyBlocks(d));
    });

  it("lo que sale no es poca cosa", () => {
    const three = C.comparativaBlocks(DIAS.find(([l]) => l === "tres pilotos")?.[1]);
    expect(tables(three).map((t) => t.title)).toEqual([
      "Mejor vuelta",
      "Sectores (el mejor de cada uno)",
      "Máximos del día",
      "Curvas (lo mejor de cada uno)",
    ]);
    // Empates de menos de 5 milésimas: los dos son el mejor.
    const sectors = tables(three)[1];
    expect(sectors.kind === "table" && sectors.rows.map((r) => r.cells[1].top)).toEqual([
      true,
      true,
      false,
    ]);
    expect(three.filter((b) => b.kind === "laps")).toHaveLength(3);
    expect(C.comparativaBlocks(null)).toEqual([
      { kind: "empty", text: "Todavía no hay vueltas en el garaje." },
    ]);
  });

  it("tiempos y cifras con el formato de siempre", () => {
    expect(C.fmtLap(83.456789)).toBe("1:23,46");
    expect(C.fmtLap(59.996)).toBe("1:00,00");
    expect(C.fmtLap(9.5)).toBe("0:09,50");
    expect(C.fmtLap(null)).toBe("—");
    expect(C.fmt(1234.5, 1)).toBe(
      new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1 }).format(1234.5),
    );
    expect(C.fmt(undefined, 0)).toBe("—");
    expect(C.gap(0.004)).toBe("");
    expect(C.gap(0.0123)).toBe("+0,01");
    expect(C.dayLabel("20261009")).toBe("viernes, 9 de octubre");
  });

  const real = realDay();
  if (real)
    it("un día con números de las grabaciones de verdad: lo mismo", () => {
      const mine = C.comparativaBlocks(real);
      expect(mine).toEqual(legacyBlocks(real));
      expect(tables(mine)).toHaveLength(4);
      expect(real.pilotos.length).toBeGreaterThan(1);
    });
  else
    it.skip("un día con números de las grabaciones de verdad: sin PISTA_DATA en este ordenador", () => {});
});
