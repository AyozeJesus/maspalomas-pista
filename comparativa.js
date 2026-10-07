// Comparativa del día entre pilotos: mejor vuelta, sectores, curvas y todas las vueltas.
// La pintan el móvil (boxes) y el garaje del Mac con los datos que calcula el garaje (/api/dia).
(function (root) {
  "use strict";
  const NF = [0, 1, 2, 3].map(
    (d) =>
      new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }),
  );
  function fmt(x, d) {
    return x === null || x === undefined || !isFinite(x)
      ? "—"
      : NF[d].format(x);
  }
  function fmtLap(t) {
    if (t === null || t === undefined || !isFinite(t)) return "—";
    const tc = Math.round(t * 100) / 100;
    const m = Math.floor(tc / 60);
    const s = tc - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + fmt(s, 2);
  }
  function gap(d) {
    return d >= 0.005 ? "+" + fmt(d, 2) : "";
  }
  function el(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function dayLabel(f) {
    const d = new Date(
      Number(f.slice(0, 4)),
      Number(f.slice(4, 6)) - 1,
      Number(f.slice(6, 8)),
    );
    return d.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  function table(parent, title, head) {
    el("h3", "cmp-title", title, parent);
    const wrap = el("div", "cmp-wrap", null, parent);
    const t = el("table", "cmp-table", null, wrap);
    const tr = el("tr", "", null, el("thead", "", null, t));
    for (const h of head) {
      const th = el("th", h.cls || "", h.text, tr);
      if (h.sub) el("small", "", h.sub, th);
    }
    return el("tbody", "", null, t);
  }
  // Celda con valor y, debajo, la diferencia con el mejor (o la marca de mejor).
  function cell(tr, main, sub, top) {
    const td = el("td", "num" + (top ? " top" : ""), null, tr);
    el("b", "", main, td);
    if (sub) el("small", "", sub, td);
    return td;
  }

  function render(box, d) {
    box.textContent = "";
    const P = (d && d.pilotos) || [];
    if (!d || !d.fecha || !P.length) {
      el(
        "p",
        "cmp-empty",
        d && d.analizando
          ? "El Mac está analizando las últimas tandas…"
          : "Todavía no hay vueltas en el garaje.",
        box,
      );
      return;
    }
    const many = P.length > 1;
    el(
      "p",
      "cmp-head",
      dayLabel(d.fecha) +
        " · " +
        (d.sentido === "osm" ? "antihorario" : "horario") +
        " · " +
        P.length +
        (P.length === 1 ? " piloto" : " pilotos") +
        (d.analizando ? " · actualizando…" : ""),
      box,
    );

    // 1. Mejor vuelta
    let tb = table(box, "Mejor vuelta", [
      { text: "Piloto" },
      { text: "Mejor", cls: "num" },
      { text: "Ideal", cls: "num" },
      { text: "Media", cls: "num" },
      { text: "Vueltas", cls: "num" },
    ]);
    P.forEach((p, i) => {
      const tr = el("tr", "", null, tb);
      el("td", "who", p.piloto, tr);
      cell(
        tr,
        fmtLap(p.mejor),
        i ? gap(p.mejor - P[0].mejor) : many ? "el más rápido" : "",
        many && !i,
      );
      cell(tr, fmtLap(p.ideal), "", false);
      cell(tr, fmtLap(p.media3), "", false);
      cell(
        tr,
        String(p.vueltas),
        p.tandas + (p.tandas === 1 ? " tanda" : " tandas"),
        false,
      );
    });
    el(
      "p",
      "cmp-note",
      "Ideal: la suma de los mejores sectores de cada uno. Media: de sus tres mejores vueltas.",
      box,
    );

    // 2. Sectores
    const nSec = P[0].sectores.length;
    const curv = d.curvas || [];
    const bestSec = [];
    for (let k = 0; k < nSec; k++)
      bestSec.push(Math.min(...P.map((p) => p.sectores[k])));
    tb = table(
      box,
      "Sectores (el mejor de cada uno)",
      [{ text: "Piloto" }].concat(
        bestSec.map((_, k) => ({
          text: "S" + (k + 1),
          cls: "num",
          sub: curv[k] ? curv[k].name : "",
        })),
      ),
    );
    for (const p of P) {
      const tr = el("tr", "", null, tb);
      el("td", "who", p.piloto, tr);
      p.sectores.forEach((s, k) => {
        const top = many && s - bestSec[k] < 0.005;
        cell(tr, fmt(s, 2), top ? "" : gap(s - bestSec[k]), top);
      });
    }
    if (many) {
      const wins = bestSec.map((b, k) => {
        const w = P.filter((p) => p.sectores[k] - b < 0.005).map(
          (p) => p.piloto,
        );
        return "S" + (k + 1) + " " + w.join(" y ");
      });
      el(
        "p",
        "cmp-note",
        "Más rápido en cada sector: " + wins.join(" · ") + ".",
        box,
      );
    }

    // Máximos del día
    if (P.some((p) => Number.isFinite(p.leanMax) || Number.isFinite(p.vMax))) {
      tb = table(box, "Máximos del día", [
        { text: "Piloto" },
        { text: "Inclinación", cls: "num" },
        { text: "Velocidad punta", cls: "num" },
      ]);
      const top = (key) =>
        Math.max(...P.map((p) => p[key]).filter(Number.isFinite));
      const topLean = top("leanMax");
      const topV = top("vMax");
      for (const p of P) {
        const tr = el("tr", "", null, tb);
        el("td", "who", p.piloto, tr);
        cell(
          tr,
          Number.isFinite(p.leanMax) ? fmt(p.leanMax, 0) + "°" : "—",
          "",
          many && p.leanMax === topLean,
        );
        cell(
          tr,
          Number.isFinite(p.vMax) ? fmt(p.vMax, 0) + " km/h" : "—",
          "",
          many && p.vMax === topV,
        );
      }
    }

    // 3. Curvas
    tb = table(
      box,
      "Curvas (lo mejor de cada uno)",
      [{ text: "Curva" }].concat(
        P.map((p) => ({ text: p.piloto, cls: "num" })),
      ),
    );
    curv.forEach((c, k) => {
      const tr = el("tr", "", null, tb);
      el("td", "who", "C" + (k + 1) + " " + c.name, tr);
      const vs = P.map((p) => (p.curvas[k] ? p.curvas[k].vMin : null));
      const top = Math.max(...vs.filter((v) => v !== null));
      P.forEach((p, i) => {
        const cc = p.curvas[k] || {};
        cell(
          tr,
          vs[i] === null ? "—" : fmt(vs[i], 0) + " km/h",
          (cc.leanMax !== null && cc.leanMax !== undefined
            ? fmt(cc.leanMax, 0) + "° · "
            : "") +
            (cc.peakG !== null && cc.peakG !== undefined
              ? fmt(cc.peakG, 2) + " g"
              : ""),
          many && vs[i] !== null && vs[i] === top,
        );
      });
    });
    el(
      "p",
      "cmp-note",
      "Velocidad mínima en la curva (marcada la más alta), tumbada máxima y frenada máxima.",
      box,
    );

    // 4. Todas las vueltas, cada una con su inclinación máxima y su velocidad punta
    el("h3", "cmp-title", "Todas las vueltas", box);
    for (const p of P) {
      const row = el("div", "cmp-laps", null, box);
      el("span", "who", p.piloto, row);
      for (const raw of p.lista) {
        const v = typeof raw === "number" ? { time: raw } : raw;
        const chip = el(
          "span",
          "lap" + (v.time === p.mejor ? " top" : ""),
          null,
          row,
        );
        el("b", "", fmtLap(v.time), chip);
        if (Number.isFinite(v.leanMax) || Number.isFinite(v.vMax))
          el(
            "small",
            "",
            (Number.isFinite(v.leanMax) ? fmt(v.leanMax, 0) + "°" : "—") +
              " · " +
              (Number.isFinite(v.vMax) ? fmt(v.vMax, 0) : "—"),
            chip,
          );
      }
    }
    el(
      "p",
      "cmp-note",
      "Debajo de cada vuelta: inclinación máxima y velocidad punta (km/h).",
      box,
    );
    if (d.metaIgualada)
      el(
        "p",
        "cmp-note",
        "Los móviles tenían la línea de meta en sitios distintos: vueltas y sectores se han medido para todos con la " +
          (d.metaDe && d.metaDe.length
            ? "de " + d.metaDe.join(" y ")
            : "misma") +
          ". Para que coincida siempre, poned la meta en el mismo sitio en Ajustes.",
        box,
      );
    for (const o of d.otros || [])
      el(
        "p",
        "cmp-note",
        "Hay además " +
          o.vueltas +
          " vueltas en sentido " +
          (o.sentido === "osm" ? "antihorario" : "horario") +
          " que no entran en la comparativa.",
        box,
      );
  }

  root.MaspaComparativa = { render };
})(typeof window !== "undefined" ? window : globalThis);
