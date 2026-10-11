import { describe, expect, it } from "vitest";
import { A4, pdfDate, pdfFromJpegs, pdfText } from "./pdf";

// Un «JPEG» de mentira: el PDF lo mete tal cual (DCTDecode), no lo mira.
const jpeg = (n: number, fill: number) => new Uint8Array(n).fill(fill);

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

// Lo que dice la tabla xref: cada objeto en su byte.
function xref(s: string): number[] {
  const at = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
  const table = s.slice(at);
  expect(table.startsWith("xref\n")).toBe(true);
  const [, , count] = /^xref\n(\d+) (\d+)\n/.exec(table) ?? [];
  const rows = table.split("\n").slice(2, 2 + Number(count));
  // Cada fila, 20 bytes justos («0000000123 00000 n \n»).
  for (const r of rows) expect((r + "\n").length).toBe(20);
  return rows.slice(1).map((r) => Number(r.slice(0, 10)));
}

describe("pdfFromJpegs", () => {
  it("una página por imagen, que la llena entera, con la tabla de objetos bien", () => {
    const pages = [
      { jpeg: jpeg(300, 0x11), width: 1240, height: 1754 },
      { jpeg: jpeg(500, 0x22), width: 1240, height: 1754 },
    ];
    const bytes = pdfFromJpegs(pages, { title: "Ruta libre" });
    const s = latin1(bytes);
    expect(s.startsWith("%PDF-1.4\n")).toBe(true);
    expect(s.endsWith("%%EOF\n")).toBe(true);
    const offsets = xref(s);
    offsets.forEach((o, i) =>
      expect(s.slice(o, o + 12)).toMatch(new RegExp("^" + (i + 1) + " 0 obj\n")),
    );
    expect(s).toContain("/Type /Pages /Kids [3 0 R 6 0 R] /Count 2");
    expect(s.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(s).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(s).toContain("/Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8");
    expect(s).toContain("/Filter /DCTDecode /Length 300");
    expect(s).toContain("/Filter /DCTDecode /Length 500");
    // La imagen va entera en su stream.
    expect(s).toContain("stream\n" + "\x11".repeat(300) + "\nendstream");
    expect(s).toContain("q 595.28 0 0 841.89 0 0 cm /Im0 Do Q");
    expect(s).toMatch(/trailer\n<< \/Size 10 \/Root 1 0 R \/Info 9 0 R >>/);
  });

  it("el título, con tildes, en UTF-16 (como lo leen los visores)", () => {
    const s = latin1(
      pdfFromJpegs([{ jpeg: jpeg(4, 1), width: 10, height: 10 }], { title: "Subida · Araya" }),
    );
    expect(s).toContain("/Title <FEFF" + pdfText("Subida · Araya").slice(5));
    expect(pdfText("Aé")).toBe("<FEFF004100E9>");
    // Fuera del plano básico (un emoji), con sus dos mitades.
    expect(pdfText("🏍")).toBe("<FEFFD83CDFCD>");
    expect(s).toContain("/Producer (poortelemetry)");
  });

  it("otro tamaño de página, y la fecha como la piden los PDF", () => {
    const s = latin1(
      pdfFromJpegs([{ jpeg: jpeg(4, 1), width: 10, height: 10 }], {
        title: "x",
        size: { w: 100, h: 200 },
      }),
    );
    expect(s).toContain("/MediaBox [0 0 100 200]");
    expect(A4).toEqual({ w: 595.28, h: 841.89 });
    expect(pdfDate(new Date(2026, 9, 11, 9, 5, 7))).toBe("(D:20261011090507)");
  });

  it("sin páginas no hay PDF", () => {
    expect(() => pdfFromJpegs([], { title: "x" })).toThrow();
  });
});
