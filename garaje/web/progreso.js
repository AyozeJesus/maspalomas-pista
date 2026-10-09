// Progreso de un piloto entre días: mejor vuelta y media de las 3 mejores en una gráfica, la tabla de días y, por
// curva, cómo han cambiado la velocidad mínima, el punto de frenada, el tiempo sin gas y la tumbada.
// Datos: /api/progreso del garaje (todas las tandas de circuito de cada día juntas).
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const NF = [0, 1, 2].map(
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
  function fmtSigned(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    const lim = 0.5 * Math.pow(10, -d);
    if (Math.abs(x) < lim) return NF[d].format(0);
    return (x < 0 ? "−" : "+") + NF[d].format(Math.abs(x));
  }
  function fmtLap(t) {
    if (t === null || t === undefined || !isFinite(t)) return "—";
    const tc = Math.round(t * 100) / 100;
    const m = Math.floor(tc / 60);
    const s = tc - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + fmt(s, 2);
  }
  function el(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function dayLabel(f, long) {
    const d = new Date(
      Number(f.slice(0, 4)),
      Number(f.slice(4, 6)) - 1,
      Number(f.slice(6, 8)),
    );
    return d.toLocaleDateString(
      "es-ES",
      long
        ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
        : { day: "numeric", month: "short" },
    );
  }
  const SENTIDO = { osm: "antihorario", rev: "horario" };

  // Mejor vuelta y media de las 3 mejores por día (arriba, más rápido), con el objetivo.
  function chart(parent, dias) {
    const W = 1000;
    const H = 220;
    const padL = 70;
    const padR = 20;
    const padT = 16;
    const padB = 30;
    const vals = [];
    for (const d of dias) {
      vals.push(d.mejor, d.media3);
      if (Number.isFinite(d.objetivo)) vals.push(d.objetivo);
    }
    let lo = Math.min(...vals) - 0.3;
    let hi = Math.max(...vals) + 0.3;
    if (hi - lo < 1) {
      const mid = (hi + lo) / 2;
      lo = mid - 0.5;
      hi = mid + 0.5;
    }
    const X = (i) =>
      dias.length === 1
        ? (padL + W - padR) / 2
        : padL + (i * (W - padL - padR)) / (dias.length - 1);
    const Y = (t) => padT + ((t - lo) / (hi - lo)) * (H - padT - padB);
    const s = svg(
      "svg",
      { viewBox: "0 0 " + W + " " + H, class: "prog-chart", role: "img" },
      parent,
    );
    s.setAttribute(
      "aria-label",
      "Mejor vuelta y media de las 3 mejores de cada día",
    );
    for (const t of [lo + 0.3, hi - 0.3]) {
      svg(
        "line",
        { x1: padL, x2: W - padR, y1: Y(t), y2: Y(t), class: "pg-grid" },
        s,
      );
      svg(
        "text",
        { x: padL - 8, y: Y(t) + 4, class: "pg-ylab" },
        s,
      ).textContent = fmtLap(t);
    }
    const obj = dias.map((d) => d.objetivo).filter(Number.isFinite);
    if (obj.length) {
      const o = obj[obj.length - 1];
      svg(
        "line",
        { x1: padL, x2: W - padR, y1: Y(o), y2: Y(o), class: "pg-obj" },
        s,
      );
      svg(
        "text",
        { x: W - padR, y: Y(o) - 6, class: "pg-objlab" },
        s,
      ).textContent = "objetivo " + fmtLap(o);
    }
    const line = (key, cls) => {
      if (dias.length > 1)
        svg(
          "path",
          {
            d:
              "M" +
              dias
                .map((d, i) => X(i).toFixed(1) + " " + Y(d[key]).toFixed(1))
                .join("L"),
            class: cls,
          },
          s,
        );
    };
    line("media3", "pg-mean");
    line("mejor", "pg-best");
    dias.forEach((d, i) => {
      const c = svg(
        "circle",
        { cx: X(i), cy: Y(d.mejor), r: 6, class: "pg-dot" },
        s,
      );
      svg("title", {}, c).textContent =
        dayLabel(d.fecha, true) +
        ": mejor " +
        fmtLap(d.mejor) +
        ", media de las 3 mejores " +
        fmtLap(d.media3);
      svg("text", { x: X(i), y: H - 8, class: "pg-xlab" }, s).textContent =
        dayLabel(d.fecha);
    });
  }

  // Cambio frente al primer día (con color: mejor en verde, peor en rojo). better: +1 si más es mejor, −1 si menos.
  function change(td, now, first, d, unit, better, thr, since) {
    if (!Number.isFinite(now) || !Number.isFinite(first)) return;
    const diff = now - first;
    const sm = el(
      "small",
      Math.abs(diff) < thr ? "" : diff * better > 0 ? "up" : "down",
      null,
      td,
    );
    sm.textContent = fmtSigned(diff, d) + unit + " desde el " + since;
  }

  // container: donde pintar; data: /api/progreso; piloto: el elegido (o el primero).
  function render(container, data, piloto) {
    container.textContent = "";
    const list = (data && data.pilotos) || [];
    if (!list.length) {
      el(
        "p",
        "cmp-empty",
        data && data.pendientes
          ? "Analizando las tandas…"
          : "Todavía no hay tandas de circuito con vueltas completas.",
        container,
      );
      return;
    }
    const p = list.find((x) => x.piloto === piloto) || list[0];
    // Las curvas dependen del sentido: se usa el más rodado.
    const count = {};
    for (const d of p.dias) count[d.sentido] = (count[d.sentido] || 0) + 1;
    const sentido = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const dias = p.dias.filter((d) => d.sentido === sentido);
    const first = dias[0];
    const last = dias[dias.length - 1];
    const head = el("p", "cmp-head", null, container);
    head.textContent =
      dias.length > 1
        ? "Mejor vuelta: " +
          fmtLap(first.mejor) +
          " el " +
          dayLabel(first.fecha) +
          " → " +
          fmtLap(last.mejor) +
          " el " +
          dayLabel(last.fecha) +
          " (" +
          fmtSigned(last.mejor - first.mejor, 2) +
          " s)"
        : "Un solo día: con el siguiente ya se verá el progreso.";
    chart(container, dias);
    el(
      "p",
      "muted pg-legend",
      "Línea llena: mejor vuelta del día. Discontinua: media de tus 3 mejores (lo que de verdad ruedas). Punteada: tu objetivo. Sentido " +
        SENTIDO[sentido] +
        ".",
      container,
    );

    el("h3", "cmp-title", "Día a día", container);
    const wrap = el("div", "cmp-wrap", null, container);
    const t = el("table", "cmp-table", null, wrap);
    const hr = el("tr", "", null, el("thead", "", null, t));
    for (const [h, num] of [
      ["Día", false],
      ["Vueltas", true],
      ["Mejor", true],
      ["Media 3 mejores", true],
      ["Regularidad", true],
      ["Punta", true],
      ["Tumbada", true],
    ])
      el("th", num ? "num" : "", h, hr).scope = "col";
    const tb = el("tbody", "", null, t);
    let prev = null;
    const best = Math.min(...dias.map((d) => d.mejor));
    for (const d of dias) {
      const tr = el("tr", "", null, tb);
      el("td", "", dayLabel(d.fecha, true), tr);
      el("td", "num", String(d.vueltas), tr);
      const tdB = el(
        "td",
        "num" + (d.mejor === best ? " best" : ""),
        fmtLap(d.mejor),
        tr,
      );
      if (prev)
        el(
          "small",
          d.mejor < prev.mejor ? "up" : "down",
          fmtSigned(d.mejor - prev.mejor, 2) + " s",
          tdB,
        );
      el("td", "num", fmtLap(d.media3), tr);
      el(
        "td",
        "num",
        d.regularidad === null ? "—" : "±" + fmt(d.regularidad, 2) + " s",
        tr,
      );
      el("td", "num", fmt(d.punta, 0) + " km/h", tr);
      el("td", "num", fmt(d.tumbada, 0) + "°", tr);
      prev = d;
    }

    if (!last.curvas.length) return;
    el(
      "h3",
      "cmp-title",
      "Curva a curva (" + dayLabel(last.fecha) + ")",
      container,
    );
    const wrap2 = el("div", "cmp-wrap", null, container);
    const t2 = el("table", "cmp-table", null, wrap2);
    const hr2 = el("tr", "", null, el("thead", "", null, t2));
    for (const [h, sub] of [
      ["Curva", ""],
      ["Mínima", "km/h, la mejor"],
      ["Frenas", "m antes del vértice"],
      ["Sin gas", "s entre freno y gas"],
      ["Tumbada", "máxima"],
    ]) {
      const th = el("th", h === "Curva" ? "" : "num", h, hr2);
      th.scope = "col";
      if (sub) el("small", "", sub, th);
    }
    const tb2 = el("tbody", "", null, t2);
    const since = dayLabel(first.fecha);
    for (const c of last.curvas) {
      const c0 =
        dias.length > 1 ? first.curvas.find((x) => x.num === c.num) : null;
      const tr = el("tr", "", null, tb2);
      el("td", "", "C" + c.num + " · " + c.nombre, tr);
      let td = el("td", "num", fmt(c.vMin, 0), tr);
      if (c0) change(td, c.vMin, c0.vMin, 0, " km/h", 1, 1, since);
      td = el(
        "td",
        "num",
        c.frenada === null ? "—" : fmt(c.frenada, 0) + " m",
        tr,
      );
      if (c0) change(td, c.frenada, c0.frenada, 0, " m", -1, 4, since);
      td = el(
        "td",
        "num",
        c.muerto === null ? "—" : fmt(c.muerto, 1) + " s",
        tr,
      );
      if (c0) change(td, c.muerto, c0.muerto, 1, " s", -1, 0.1, since);
      td = el("td", "num", fmt(c.tumbada, 0) + "°", tr);
      if (c0) change(td, c.tumbada, c0.tumbada, 0, "°", 1, 1, since);
    }
    el(
      "p",
      "muted pg-legend",
      "Frenada y tiempo sin gas: la mediana de tus 3 mejores vueltas de ese día (una vuelta suelta con el GPS del móvil tiene unos metros de ruido). Frenar más cerca del vértice y menos tiempo sin gas, en verde.",
      container,
    );
  }

  root.MaspaProgreso = { render };
})(typeof window !== "undefined" ? window : globalThis);
