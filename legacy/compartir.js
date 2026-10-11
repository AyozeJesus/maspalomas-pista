// Imagen para compartir (WhatsApp y demás) de una ruta o una tanda: se pinta al momento en un canvas, sin red, con
// el mapa de la trazada, lo más importante y la leyenda. 1080 × 1350 (4:5), lo que WhatsApp enseña entero en el chat.
(function (root) {
  "use strict";
  const W = 1080;
  const H = 1350;
  const PAD = 48;
  const C = {
    bg: "#050607",
    card: "#0f1316",
    map: "#0a0d10",
    line: "#232b31",
    ink: "#f3f5f6",
    ink2: "#c4ccd2",
    muted: "#949fa7",
    best: "#d7b8f7",
    kerb: "#d2382d",
  };
  const FONT =
    'Roboto, "Google Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

  function font(weight, size) {
    return weight + " " + size + "px " + FONT;
  }

  // Texto recortado con «…» para que quepa en maxW.
  function fit(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && g.measureText(t + "…").width > maxW)
      t = t.slice(0, -1);
    return t + "…";
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Cabecera: marca, título y subtítulo. Devuelve la y donde acaba.
  function header(g, titulo, subtitulo) {
    // Bordillo rojo y blanco, como en la portada.
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? "#ffffff" : C.kerb;
      g.fillRect(PAD + i * 15, PAD + 6, 15, 8);
    }
    g.fillStyle = C.ink2;
    g.font = font(700, 26);
    g.textBaseline = "middle";
    g.fillText("MODO PISTA · MASPALOMAS", PAD + 76, PAD + 10);
    g.fillStyle = C.ink;
    g.font = font(800, 64);
    g.textBaseline = "alphabetic";
    g.fillText(fit(g, titulo, W - 2 * PAD), PAD, PAD + 96);
    g.fillStyle = C.muted;
    g.font = font(600, 30);
    g.fillText(fit(g, subtitulo, W - 2 * PAD), PAD, PAD + 142);
    return PAD + 170;
  }

  // Leyenda de colores en una fila (o dos si no cabe).
  function legendRow(g, items, y) {
    g.font = font(600, 26);
    g.textBaseline = "middle";
    let x = PAD;
    for (const [text, color] of items) {
      const w = 26 + 10 + g.measureText(text).width + 28;
      if (x + w > W - PAD) {
        x = PAD;
        y += 40;
      }
      g.fillStyle = color;
      roundRect(g, x, y - 4, 26, 8, 4);
      g.fill();
      g.fillStyle = C.ink2;
      g.fillText(text, x + 36, y);
      x += w;
    }
    return y + 30;
  }

  // Rejilla de datos: [etiqueta, valor] en casillas de `cols` columnas, desde y hasta como mucho yMax (casillas de
  // hasta chMax de alto).
  function statsGrid(g, stats, y, yMax, cols, chMax) {
    const gap = 16;
    const n = stats.length;
    const rows = Math.ceil(n / cols);
    const cw = (W - 2 * PAD - gap * (cols - 1)) / cols;
    const ch = Math.min(chMax || 150, (yMax - y - gap * (rows - 1)) / rows);
    stats.forEach(([label, value, hl], i) => {
      const cx = PAD + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + gap);
      g.fillStyle = C.card;
      roundRect(g, cx, cy, cw, ch, 18);
      g.fill();
      g.strokeStyle = C.line;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = C.muted;
      g.font = font(600, 26);
      g.textBaseline = "top";
      g.fillText(fit(g, label, cw - 40), cx + 20, cy + 18);
      g.fillStyle = hl ? C.best : C.ink;
      let size = 52;
      g.font = font(800, size);
      while (size > 28 && g.measureText(value).width > cw - 40) {
        size -= 2;
        g.font = font(800, size);
      }
      g.textBaseline = "alphabetic";
      g.fillText(value, cx + 20, cy + ch - 24);
    });
    return y + rows * ch + (rows - 1) * gap;
  }

  function footer(g, text) {
    g.fillStyle = C.muted;
    g.font = font(600, 24);
    g.textBaseline = "alphabetic";
    g.textAlign = "right";
    g.fillText(text, W - PAD, H - 28);
    g.textAlign = "left";
  }

  function newCanvas() {
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    return { cv, g };
  }

  // Mapa (MaspaMapa) en su propio canvas, pegado en la imagen con las esquinas redondeadas.
  function mapBox(g, x, y, w, h, opts) {
    g.fillStyle = C.map;
    roundRect(g, x, y, w, h, 24);
    g.fill();
    if (!root.MaspaMapa) return;
    const mc = document.createElement("canvas");
    // Densidad 2,6: líneas y textos del mapa algo más gruesos que en el móvil (la imagen se ve más pequeña).
    root.MaspaMapa.draw(
      mc,
      Object.assign({}, opts, { size: { w, h, dpr: 2.6 } }),
    );
    g.save();
    roundRect(g, x, y, w, h, 24);
    g.clip();
    g.drawImage(mc, x, y);
    g.restore();
  }

  function toBlob(cv) {
    return new Promise((resolve, reject) =>
      cv.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("sin imagen"))),
        "image/png",
      ),
    );
  }

  // Ruta libre (o un tramo): d = { titulo, subtitulo, trail, outline?, marks?, dots?, colorBy, stats:[[etiqueta,
  // valor, destacado?]], pie }.
  function routeImage(d) {
    const { cv, g } = newCanvas();
    let y = header(g, d.titulo, d.subtitulo) + 8;
    const mapH = d.stats.length > 6 ? 600 : 660;
    mapBox(g, PAD, y, W - 2 * PAD, mapH, {
      trail: d.trail,
      outline: d.outline,
      marks: d.marks,
      dots: d.dots,
      colorBy: d.colorBy || "fase",
      follow: false,
    });
    y += mapH + 34;
    if (root.MaspaMapa)
      y = legendRow(g, root.MaspaMapa.legendItems(d.colorBy || "fase"), y);
    statsGrid(g, d.stats, y + 14, H - 70, 3);
    footer(g, d.pie || "");
    return toBlob(cv);
  }

  // Tanda en el circuito: d = { titulo, subtitulo, mejor, vueltas:[{num, time, valid, best}], outline, stats, pie }.
  function tandaImage(d) {
    const { cv, g } = newCanvas();
    let y = header(g, d.titulo, d.subtitulo) + 8;
    // Arriba: la mejor vuelta en grande y el circuito al lado.
    const boxH = 340;
    g.fillStyle = C.card;
    roundRect(g, PAD, y, 560, boxH, 24);
    g.fill();
    g.fillStyle = C.muted;
    g.font = font(700, 28);
    g.textBaseline = "top";
    g.fillText("MEJOR VUELTA", PAD + 28, y + 32);
    g.fillStyle = C.best;
    g.font = font(900, 112);
    g.textBaseline = "alphabetic";
    g.fillText(d.mejor || "—", PAD + 24, y + 206);
    g.fillStyle = C.ink2;
    g.font = font(600, 28);
    g.fillText(fit(g, d.mejorNota || "", 520), PAD + 28, y + 282);
    mapBox(g, PAD + 576, y, W - 2 * PAD - 576, boxH, {
      outline: d.outline,
      trail: d.trail || [],
      width: 10,
      follow: false,
    });
    y += boxH + 24;
    // Las vueltas (las 12 primeras) en una rejilla de 4.
    const vs = (d.vueltas || []).slice(0, 12);
    const cols = 4;
    const gap = 12;
    const cw = (W - 2 * PAD - gap * (cols - 1)) / cols;
    const ch = 100;
    vs.forEach((v, i) => {
      const cx = PAD + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + gap);
      g.fillStyle = v.best ? "#7b3fc4" : C.card;
      roundRect(g, cx, cy, cw, ch, 16);
      g.fill();
      g.fillStyle = v.best ? "#ece2f8" : C.muted;
      g.font = font(700, 22);
      g.textBaseline = "top";
      g.fillText("Vuelta " + v.num + (v.valid ? "" : " *"), cx + 16, cy + 12);
      g.fillStyle = v.best ? "#ffffff" : C.ink;
      g.font = font(800, 36);
      g.textBaseline = "alphabetic";
      g.fillText(v.time, cx + 16, cy + ch - 16);
    });
    if (vs.length) y += Math.ceil(vs.length / cols) * (ch + gap) + 10;
    statsGrid(g, d.stats, y, H - 70, 3, 175);
    footer(g, d.pie || "");
    return toBlob(cv);
  }

  // Comparte la imagen (WhatsApp, Telegram… lo que ofrezca el móvil). Sin «compartir archivos» (navegador de
  // ordenador, algunos móviles), se descarga. Devuelve "compartida", "cancelada" o "descargada".
  async function share(blob, name, text) {
    const file = new File([blob], name, { type: "image/png" });
    const data = { files: [file], text };
    if (
      navigator.canShare &&
      navigator.share &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share(data);
        return "compartida";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelada";
        // Otro fallo (permiso, tamaño…): se descarga.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return "descargada";
  }

  root.MaspaCompartir = { routeImage, tandaImage, share, W, H };
})(typeof window !== "undefined" ? window : globalThis);
