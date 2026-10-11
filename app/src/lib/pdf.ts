// Un PDF con una imagen JPEG por página, que la llena entera: lo mínimo que abren todos los visores (WhatsApp, Drive,
// el del móvil). Sin librerías: el JPEG va tal cual (DCTDecode) y el resto es texto con la tabla de dónde empieza cada
// objeto.

export interface PdfPage {
  jpeg: Uint8Array;
  // Píxeles de la imagen.
  width: number;
  height: number;
}

// Puntos (1/72 de pulgada).
export interface PdfSize {
  w: number;
  h: number;
}

export const A4: PdfSize = { w: 595.28, h: 841.89 };

// Un texto del diccionario de información (título…), en UTF-16 para que las tildes salgan bien: «<FEFF…>».
export function pdfText(s: string): string {
  let hex = "<FEFF";
  for (let i = 0; i < s.length; i++)
    hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return hex + ">";
}

// «(D:20261011090507)», en hora local.
export function pdfDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    "(D:" +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    ")"
  );
}

const num = (x: number) => String(Math.round(x * 100) / 100);

export function pdfFromJpegs(
  pages: readonly PdfPage[],
  info: { title: string; date?: Date; size?: PdfSize },
): Uint8Array {
  if (!pages.length) throw new Error("Un PDF necesita al menos una página");
  const size = info.size ?? A4;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  const put = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? enc.encode(b) : b;
    parts.push(bytes);
    at += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n - 1] = at;
    put(n + " 0 obj\n" + body + "\nendobj\n");
  };

  // 1 catálogo, 2 páginas, y por página: la página, su imagen y lo que dibuja; al final, la información.
  const pageObj = (i: number) => 3 + i * 3;
  const infoObj = 3 + pages.length * 3;
  // Cabecera, con 4 bytes altos en un comentario: así los programas lo tratan como binario.
  put("%PDF-1.4\n%");
  put(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]));
  put("\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(
    2,
    "<< /Type /Pages /Kids [" +
      pages.map((_, i) => pageObj(i) + " 0 R").join(" ") +
      "] /Count " +
      pages.length +
      " >>",
  );
  const box = num(size.w) + " " + num(size.h);
  pages.forEach((pg, i) => {
    const n = pageObj(i);
    obj(
      n,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
        box +
        "] /Resources << /XObject << /Im0 " +
        (n + 1) +
        " 0 R >> /ProcSet [/PDF /ImageC] >> /Contents " +
        (n + 2) +
        " 0 R >>",
    );
    offsets[n] = at;
    put(
      n +
        1 +
        " 0 obj\n<< /Type /XObject /Subtype /Image /Width " +
        pg.width +
        " /Height " +
        pg.height +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
        pg.jpeg.length +
        " >>\nstream\n",
    );
    put(pg.jpeg);
    put("\nendstream\nendobj\n");
    const draw = "q " + num(size.w) + " 0 0 " + num(size.h) + " 0 0 cm /Im0 Do Q";
    obj(n + 2, "<< /Length " + draw.length + " >>\nstream\n" + draw + "\nendstream");
  });
  obj(
    infoObj,
    "<< /Title " +
      pdfText(info.title) +
      " /Producer (poortelemetry) /CreationDate " +
      pdfDate(info.date ?? new Date()) +
      " >>",
  );

  const xrefAt = at;
  const size1 = infoObj + 1;
  put(
    "xref\n0 " +
      size1 +
      "\n0000000000 65535 f \n" +
      offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
      "trailer\n<< /Size " +
      size1 +
      " /Root 1 0 R /Info " +
      infoObj +
      " 0 R >>\nstartxref\n" +
      xrefAt +
      "\n%%EOF\n",
  );

  const out = new Uint8Array(at);
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}
