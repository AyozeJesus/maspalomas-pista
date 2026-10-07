// Interfaz de «Telemetría Maspalomas».
(function () {
  "use strict";
  const T = window.MaspaTelemetry;
  const NS = "http://www.w3.org/2000/svg";
  const EXPLAINER = "https://claude.ai/artifact/1RrPnnyj8FkGL7NghJYFze";
  const LS_KEY = "maspa-telemetria-tandas";
  const PILLARS = {
    1: "Pilar 1 · salidas",
    2: "Pilar 2 · costeo",
    3: "Pilar 3 · frenada y mirada",
    4: "Pilar 4 · ancho",
  };

  const state = {
    session: null,
    result: null,
    source: "demo",
    fileName: "",
    lapIdx: 0,
    refMode: "obj",
    target: 65.0,
    cursorK: null,
    finish: readFinish(),
  };
  const store = { kind: null, col: null, docs: [], unsub: null };

  // Línea de meta elegida por el piloto (índice del eje en cada sentido); comodidad de este navegador.
  function readFinish() {
    try {
      const v = JSON.parse(
        localStorage.getItem("maspa-telemetria-meta") || "null",
      );
      if (v && Number.isFinite(v.osm) && Number.isFinite(v.rev)) return v;
    } catch (e) {
      /* sin almacenamiento: meta por defecto */
    }
    return { osm: 0, rev: 0 };
  }
  function writeFinish() {
    try {
      localStorage.setItem(
        "maspa-telemetria-meta",
        JSON.stringify(state.finish),
      );
    } catch (e) {
      /* sin almacenamiento: vale para esta visita */
    }
  }

  // ---------- utilidades ----------
  const $ = (id) => document.getElementById(id);
  const NF = [0, 1, 2, 3].map(
    (d) =>
      new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }),
  );
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    const lim = 0.5 * Math.pow(10, -d);
    return NF[d].format(Math.abs(x) < lim ? 0 : x);
  }
  function fmtSigned(x, d) {
    if (x === null || !isFinite(x)) return "—";
    return (x < 0 ? "−" : "+") + fmt(Math.abs(x), d);
  }
  function fmtLap(t, d) {
    if (!isFinite(t)) return "—";
    const dec = d === undefined ? 2 : d;
    const f = Math.pow(10, dec);
    const tc = Math.round(t * f) / f;
    const m = Math.floor(tc / 60);
    const s = tc - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + fmt(s, dec);
  }
  function parseLap(text) {
    const t = String(text || "")
      .trim()
      .replace(/\s+/g, "");
    let m = t.match(/^(\d{1,2})[:.'](\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (m && m[2].length === 2)
      return (
        Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number("0." + m[3]) : 0)
      );
    m = t.match(/^(\d{2,3})(?:[.,](\d{1,3}))?$/);
    if (m) return Number(m[1]) + (m[2] ? Number("0." + m[2]) : 0);
    return NaN;
  }
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function el(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function pathOf(xs, ys) {
    let d = "";
    for (let i = 0; i < xs.length; i++) {
      if (!isFinite(ys[i])) continue;
      d += (d ? "L" : "M") + xs[i].toFixed(1) + " " + ys[i].toFixed(1);
    }
    return d;
  }
  function setStatus(text, isErr) {
    const s = $("status");
    s.textContent = text;
    s.classList.toggle("err", !!isErr);
  }

  // ---------- carga ----------
  async function loadFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    setStatus("Leyendo " + files.map((f) => f.name).join(", ") + "…");
    try {
      const texts = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          if (!window.JSZip)
            throw userError(
              "No se ha podido cargar el lector de .zip. Descomprime el archivo en el móvil y sube los CSV.",
            );
          const zip = await window.JSZip.loadAsync(f);
          for (const name of Object.keys(zip.files)) {
            if (/\.csv$/i.test(name) && !zip.files[name].dir)
              texts.push({ name, text: await zip.files[name].async("string") });
          }
        } else if (/\.csv$/i.test(f.name)) {
          texts.push({ name: f.name, text: await f.text() });
        }
      }
      if (!texts.length)
        throw userError(
          "No hay archivos CSV en lo que has subido. Exporta la grabación como «Zipped CSV».",
        );
      state.session = T.sessionFromCsv(texts);
      state.source = "file";
      state.fileName =
        files.length === 1 ? files[0].name : files.length + " archivos";
      runAnalysis();
    } catch (e) {
      showError(e);
    }
  }

  function userError(msg) {
    const e = new Error(msg);
    e.user = true;
    return e;
  }

  // Los errores del análisis están escritos para el piloto; los demás son fallos del programa.
  function showError(e) {
    const known =
      e &&
      (e.user ||
        (e instanceof Error &&
          !(e instanceof TypeError) &&
          !(e instanceof RangeError) &&
          !(e instanceof ReferenceError)));
    if (!known) console.error(e);
    setStatus(
      known
        ? e.message
        : "No he podido procesar este archivo. Comprueba que es la exportación «Zipped CSV» de Sensor Logger.",
      true,
    );
  }

  // Tanda guardada en el garaje de este Mac (?tanda=<id>), con la línea de meta que tenía el móvil.
  async function loadFromGarage(id) {
    setStatus("Leyendo la tanda guardada…");
    try {
      const r = await fetch(
        "/api/tandas/" + encodeURIComponent(id) + "/archivos",
        {
          cache: "no-store",
        },
      );
      if (!r.ok)
        throw userError(
          r.status === 404
            ? "Esa tanda todavía no tiene datos en el garaje."
            : "El garaje no ha podido leer esa tanda.",
        );
      const data = await r.json();
      const fin = data.meta && data.meta.meta;
      if (fin && Number.isFinite(fin.osm) && Number.isFinite(fin.rev))
        state.finish = { osm: fin.osm, rev: fin.rev };
      state.session = T.sessionFromCsv(data.files);
      state.source = "file";
      state.fileName =
        "Tanda del " +
        new Date(data.epoch).toLocaleString("es-ES", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
      runAnalysis();
    } catch (e) {
      showError(e);
    }
  }

  function loadDemo() {
    state.session = T.demoSession({ seed: 7 }).session;
    state.source = "demo";
    state.fileName = "Ejemplo";
    runAnalysis();
  }

  function runAnalysis() {
    setStatus("Procesando la tanda…");
    setTimeout(() => {
      try {
        state.result = T.analyze(state.session, {
          target: state.target,
          finish: state.finish,
        });
        const laps = validLaps();
        state.lapIdx = laps.length ? laps.indexOf(state.result.best) : 0;
        state.cursorK = null;
        renderAll();
        const n = laps.length;
        setStatus(
          (state.source === "demo" ? "Ejemplo: " : "") +
            (n
              ? n +
                (n === 1 ? " vuelta completa" : " vueltas completas") +
                " · mejor " +
                fmtLap(state.result.best.time)
              : "No he encontrado ninguna vuelta completa: ¿pasaste por meta al menos dos veces seguidas?"),
          !n,
        );
      } catch (e) {
        showError(e);
      }
    }, 30);
  }

  function validLaps() {
    return state.result ? state.result.laps.filter((l) => l.valid) : [];
  }

  // ---------- render ----------
  function renderAll() {
    const r = state.result;
    const badge = $("source-badge");
    badge.textContent =
      state.source === "demo"
        ? "Ejemplo generado con el modelo: no son datos tuyos"
        : state.fileName;
    badge.classList.toggle("demo", state.source === "demo");
    const w = $("warnings");
    w.textContent = "";
    for (const msg of r.warnings) el("li", "", msg, w);
    w.hidden = !r.warnings.length;
    renderSummary();
    const has = validLaps().length > 0;
    for (const id of ["detail", "detail-grid", "corners-sec"])
      $(id).hidden = !has;
    if (has) renderDetail();
    renderSaveState();
  }

  function renderSummary() {
    const r = state.result;
    const laps = validLaps();
    const tiles = $("tiles");
    tiles.textContent = "";
    const tile = (label, value, sub) => {
      const t = el("div", "tile", null, tiles);
      el("span", "", label, t);
      el("b", "", value, t);
      if (sub) el("small", "", sub, t);
    };
    const times = laps.map((l) => l.time);
    const mean = times.length
      ? times.reduce((a, b) => a + b, 0) / times.length
      : NaN;
    const sd =
      times.length > 1
        ? Math.sqrt(
            times.reduce((a, b) => a + (b - mean) ** 2, 0) / (times.length - 1),
          )
        : NaN;
    tile(
      "Mejor vuelta",
      r.best ? fmtLap(r.best.time) : "—",
      r.best ? "vuelta " + (laps.indexOf(r.best) + 1) : "",
    );
    tile(
      "Vuelta ideal",
      r.ideal ? fmtLap(r.ideal) : "—",
      "tus mejores sectores juntos",
    );
    tile(
      "Media",
      fmtLap(mean),
      isFinite(sd) ? "± " + fmt(sd, 2) + " s de una vuelta a otra" : "",
    );
    tile(
      "Objetivo",
      fmtLap(state.target, 1),
      r.best
        ? "te faltan " + fmt(Math.max(0, r.best.time - state.target), 2) + " s"
        : "",
    );
    const meta = [
      r.dir === "osm" ? "Sentido antihorario" : "Sentido horario",
      r.hasImu ? "GPS + sensores" : "solo GPS",
    ];
    if (r.fit) meta.push("encaje móvil-moto " + fmt(r.fit.r2 * 100, 0) + " %");
    $("sum-meta").textContent = meta.join(" · ");

    const head = $("laps-head");
    head.textContent = "";
    const hr = el("tr", "", null, head);
    for (const h of ["Vuelta", "Tiempo", "Δ mejor", "Δ objetivo"])
      el("th", "", h, hr).scope = "col";
    for (const c of r.ref.corners)
      el("th", "", "S" + c.num + " · C" + c.num, hr).scope = "col";
    const body = $("laps-body");
    body.textContent = "";
    const bestSec = r.ref.corners.map((_, k) =>
      Math.min(...laps.map((l) => l.sectors[k])),
    );
    laps.forEach((lap, i) => {
      const tr = el("tr", i === state.lapIdx ? "sel" : "", null, body);
      tr.tabIndex = 0;
      tr.setAttribute("aria-selected", String(i === state.lapIdx));
      el("td", "", String(i + 1), tr);
      el("td", lap === r.best ? "best" : "", fmtLap(lap.time), tr);
      el(
        "td",
        "",
        lap === r.best ? "—" : fmtSigned(lap.time - r.best.time, 2),
        tr,
      );
      const dObj = lap.time - state.target;
      el("td", dObj > 0 ? "worse" : "better", fmtSigned(dObj, 2), tr);
      lap.sectors.forEach((s, k) =>
        el("td", Math.abs(s - bestSec[k]) < 1e-6 ? "best" : "", fmt(s, 2), tr),
      );
      const pick = () => {
        state.lapIdx = i;
        state.cursorK = null;
        renderSummary();
        renderDetail();
      };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          pick();
        }
      });
    });
  }

  function currentRef() {
    const r = state.result;
    const lap = validLaps()[state.lapIdx];
    if (state.refMode === "best" && r.best && r.best !== lap) {
      return {
        grid: r.best.grid,
        corners: r.best.corners,
        sectors: r.best.sectors,
        label: "tu mejor vuelta",
        name: "Mi mejor vuelta (" + fmtLap(r.best.time) + ")",
      };
    }
    return {
      grid: r.ref.grid,
      corners: r.ref.metrics,
      sectors: r.ref.sectors,
      label: "el objetivo",
      name: "Objetivo " + fmtLap(state.target, 1),
    };
  }

  function renderDetail() {
    const r = state.result;
    const laps = validLaps();
    const lap = laps[state.lapIdx] || r.best;
    const ref = currentRef();
    $("det-lap").textContent = laps.indexOf(lap) + 1 + " · " + fmtLap(lap.time);
    $("ref-name").textContent = ref.name;
    $("cor-ref").textContent = ref.label;
    renderTips(lap, ref);
    renderCharts(lap, ref);
    renderMap(lap);
    renderCorners(lap, ref);
    setCursor(
      state.cursorK === null
        ? Math.round(lap.grid.s.length * 0.2)
        : state.cursorK,
    );
  }

  function renderTips(lap, ref) {
    const list = $("tips");
    list.textContent = "";
    const res = T.insights(lap, ref.corners, ref.sectors, { ref: ref.label });
    const losing = res.filter((x) => x.loss > 0.03);
    if (state.refMode === "best" && lap === state.result.best) {
      el(
        "li",
        "",
        "Esta es tu mejor vuelta. Compárala con el objetivo para ver qué le falta.",
        list,
      );
      return;
    }
    if (!losing.length) {
      el(
        "li",
        "",
        "En esta vuelta no pierdes tiempo frente a " +
          ref.label +
          " en ninguna horquilla.",
        list,
      );
      return;
    }
    for (const x of losing.slice(0, 3)) {
      const li = el("li", "", null, list);
      const head = el("div", "tip-head", null, li);
      el("strong", "", "C" + x.corner.num + " · " + x.corner.name, head);
      el("b", "", fmtSigned(-x.loss, 2) + " s en el sector", head);
      if (!x.tips.length)
        el(
          "div",
          "tip-line",
          "Pierdes poco en cada cosa: el tiempo se va repartido por toda la curva.",
          li,
        );
      for (const t of x.tips) {
        const line = el("div", "tip-line", null, li);
        const a = el("a", "pill", PILLARS[t.pillar], line);
        a.href = EXPLAINER + "#pilar-" + t.pillar;
        a.target = "_blank";
        a.rel = "noopener";
        el(
          "span",
          "",
          t.text.charAt(0).toUpperCase() + t.text.slice(1) + ".",
          line,
        );
      }
    }
  }

  // ---------- gráficas ----------
  const charts = {};

  function chartSetup(id, h, lo, hi) {
    const root = $(id);
    root.textContent = "";
    const r = state.result;
    const L = r.track.L;
    const Y = (v) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
    for (const c of r.ref.corners) {
      const x = (c.sApex / L) * 1000;
      svg(
        "line",
        {
          x1: x,
          x2: x,
          y1: 0,
          y2: h,
          class: "l-corner",
          "vector-effect": "non-scaling-stroke",
        },
        root,
      );
    }
    if (lo < 0 && hi > 0)
      svg(
        "line",
        {
          x1: 0,
          x2: 1000,
          y1: Y(0),
          y2: Y(0),
          class: "l-zero",
          "vector-effect": "non-scaling-stroke",
        },
        root,
      );
    return { root, Y, h };
  }

  function renderCharts(lap, ref) {
    const r = state.result;
    const L = r.track.L;
    const g = lap.grid;
    const xs = Array.from(g.s, (s) => (s / L) * 1000);
    const kmh = (a) => Array.from(a, (v) => v * 3.6);
    // Velocidad
    const vMax = Math.max(250, ...kmh(g.v));
    let c = chartSetup("c-v", 140, 0, vMax);
    svg(
      "path",
      {
        d: pathOf(xs, kmh(ref.grid.v).map(c.Y)),
        class: "l-ref",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    svg(
      "path",
      {
        d: pathOf(xs, kmh(g.v).map(c.Y)),
        class: "l-lap",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    charts.v = c;
    // Diferencia acumulada de tiempo (+ pierdes)
    const d = Array.from(g.t, (t, k) => t - ref.grid.t[k]);
    const dm = Math.max(0.5, ...d.map((x) => Math.abs(x)));
    c = chartSetup("c-d", 96, -dm, dm);
    const zero = c.Y(0);
    let areaPos = "M0 " + zero.toFixed(1);
    let areaNeg = "M0 " + zero.toFixed(1);
    for (let k = 0; k < d.length; k++) {
      areaPos +=
        "L" + xs[k].toFixed(1) + " " + c.Y(Math.max(0, d[k])).toFixed(1);
      areaNeg +=
        "L" + xs[k].toFixed(1) + " " + c.Y(Math.min(0, d[k])).toFixed(1);
    }
    areaPos += "L1000 " + zero.toFixed(1) + "Z";
    areaNeg += "L1000 " + zero.toFixed(1) + "Z";
    svg("path", { d: areaPos, class: "a-loss" }, c.root);
    svg("path", { d: areaNeg, class: "a-gain" }, c.root);
    svg(
      "path",
      {
        d: pathOf(xs, d.map(c.Y)),
        class: "l-lap",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    charts.d = Object.assign(c, { data: d });
    // Aceleración longitudinal en g
    const G = T.G;
    c = chartSetup("c-a", 96, -1.4, 1.0);
    svg(
      "path",
      {
        d: pathOf(
          xs,
          Array.from(ref.grid.a, (a) => c.Y(clampV(a / G, -1.4, 1))),
        ),
        class: "l-ref",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    svg(
      "path",
      {
        d: pathOf(
          xs,
          Array.from(g.a, (a) => c.Y(clampV(a / G, -1.4, 1))),
        ),
        class: "l-lap",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    charts.a = c;
    // Inclinación
    c = chartSetup("c-l", 96, -60, 60);
    svg(
      "path",
      {
        d: pathOf(
          xs,
          Array.from(ref.grid.lean, (v) => c.Y(clampV(v, -60, 60))),
        ),
        class: "l-ref",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    svg(
      "path",
      {
        d: pathOf(
          xs,
          Array.from(g.lean, (v) => c.Y(clampV(v, -60, 60))),
        ),
        class: "l-lap",
        "vector-effect": "non-scaling-stroke",
      },
      c.root,
    );
    charts.l = c;
    for (const key of ["v", "d", "a", "l"]) {
      charts[key].cursor = svg(
        "line",
        {
          x1: 0,
          x2: 0,
          y1: 0,
          y2: charts[key].h,
          class: "l-cursor",
          "vector-effect": "non-scaling-stroke",
        },
        charts[key].root,
      );
    }
    const axis = $("corner-axis");
    axis.textContent = "";
    for (const cc of r.ref.corners) {
      const s = el("span", "", "C" + cc.num, axis);
      s.style.left = ((cc.sApex / L) * 100).toFixed(2) + "%";
    }
    charts.lap = lap;
    charts.ref = ref;
  }

  function clampV(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function setCursor(k) {
    if (!charts.lap) return;
    const g = charts.lap.grid;
    const rg = charts.ref.grid;
    const kk = Math.max(0, Math.min(g.s.length - 1, k));
    state.cursorK = kk;
    const L = state.result.track.L;
    const x = ((g.s[kk] / L) * 1000).toFixed(1);
    for (const key of ["v", "d", "a", "l"]) {
      charts[key].cursor.setAttribute("x1", x);
      charts[key].cursor.setAttribute("x2", x);
    }
    const G = T.G;
    $("r-v").textContent = fmt(g.v[kk] * 3.6, 0) + " km/h";
    $("r-v2").textContent = fmt(rg.v[kk] * 3.6, 0) + " ref.";
    $("r-d").textContent = fmtSigned(charts.d.data[kk], 2) + " s";
    $("r-a").textContent = fmtSigned(g.a[kk] / G, 2) + " g";
    $("r-a2").textContent = fmtSigned(rg.a[kk] / G, 2) + " ref.";
    $("r-l").textContent = fmt(Math.abs(g.lean[kk]), 0) + "°";
    $("r-l2").textContent = fmt(Math.abs(rg.lean[kk]), 0) + "° ref.";
    // Curva más cercana para situar el cursor.
    let near = null;
    for (const c of state.result.ref.corners) {
      let dd = g.s[kk] - c.sApex;
      if (dd > L / 2) dd -= L;
      if (dd < -L / 2) dd += L;
      if (!near || Math.abs(dd) < Math.abs(near.dd)) near = { c, dd };
    }
    $("cursor-read").textContent =
      "a " +
      fmt(g.s[kk], 0) +
      " m de meta · " +
      (near
        ? fmt(Math.abs(near.dd), 0) +
          " m " +
          (near.dd < 0 ? "antes de" : "después de") +
          " C" +
          near.c.num
        : "");
    if (mapEls.dot) {
      const p = pointAt(g.s[kk]);
      mapEls.dot.setAttribute("cx", p[0].toFixed(1));
      mapEls.dot.setAttribute("cy", p[1].toFixed(1));
    }
  }

  function wireCursor() {
    const box = $("charts");
    const move = (ev) => {
      if (!charts.lap) return;
      const rect = $("c-v").getBoundingClientRect();
      const f = (ev.clientX - rect.left) / rect.width;
      if (f < 0 || f > 1) return;
      setCursor(Math.round(f * (charts.lap.grid.s.length - 1)));
    };
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerdown", move);
  }

  // ---------- mapa ----------
  const mapEls = {};

  function pointAt(s) {
    const tr = state.result.track;
    const cs = tr.cs;
    let lo = 0;
    let hi = tr.n;
    const ss = ((s % tr.L) + tr.L) % tr.L;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cs[mid] <= ss) lo = mid;
      else hi = mid;
    }
    const a = tr.C[lo % tr.n];
    const b = tr.C[(lo + 1) % tr.n];
    const f = (ss - cs[lo]) / (cs[lo + 1] - cs[lo] || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  function renderMap(lap) {
    const root = $("map");
    root.textContent = "";
    const tr = state.result.track;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of tr.C) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const pad = 30;
    const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
    root.setAttribute("viewBox", vb.map((v) => v.toFixed(1)).join(" "));
    root.style.aspectRatio = vb[2].toFixed(1) + " / " + vb[3].toFixed(1);
    const d =
      "M" +
      tr.C.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") +
      "Z";
    svg("path", { d, class: "m-edge" }, root);
    svg("path", { d, class: "m-road" }, root);
    // Fases de esta vuelta, por distancia.
    const g = lap.grid;
    const G = T.G;
    const phaseOf = (k) => {
      const a = g.a[k] / G;
      if (a <= -0.15) return "brake";
      if (a >= 0.1) return "gas";
      return Math.abs(g.lean[k]) >= 15 ? "coast" : "gas";
    };
    let start = 0;
    let ph = phaseOf(0);
    for (let k = 1; k <= g.s.length; k++) {
      const p2 = k < g.s.length ? phaseOf(k) : null;
      if (p2 !== ph) {
        const pts = [];
        for (let q = start; q <= Math.min(k, g.s.length - 1); q++)
          pts.push(pointAt(g.s[q]));
        svg(
          "path",
          {
            d:
              "M" +
              pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L"),
            class: "m-ph m-" + ph,
          },
          root,
        );
        start = k;
        ph = p2;
      }
    }
    for (const c of state.result.ref.corners) {
      const gg = svg("g", {}, root);
      svg(
        "circle",
        { cx: c.badge.x, cy: c.badge.y, r: 11, class: "m-badge" },
        gg,
      );
      svg(
        "text",
        { x: c.badge.x, y: c.badge.y, class: "m-label" },
        gg,
      ).textContent = "C" + c.num;
    }
    // Línea de meta: el punto 0 del trazado girado.
    const f0 = tr.C[0];
    const nn = tr.N[0];
    const fx1 = f0[0] - nn[0] * 8;
    const fy1 = f0[1] - nn[1] * 8;
    const fx2 = f0[0] + nn[0] * 8;
    const fy2 = f0[1] + nn[1] * 8;
    svg(
      "line",
      { x1: fx1, y1: fy1, x2: fx2, y2: fy2, class: "m-finish-w" },
      root,
    );
    svg(
      "line",
      { x1: fx1, y1: fy1, x2: fx2, y2: fy2, class: "m-finish-k" },
      root,
    );
    svg(
      "text",
      { x: f0[0] + nn[0] * 20, y: f0[1] + nn[1] * 20 + 4, class: "m-finish-t" },
      root,
    ).textContent = "Meta";
    mapEls.dot = svg("circle", { r: 7, class: "m-dot" }, root);
    mapEls.root = root;
  }

  // ---------- horquillas ----------
  const ROWS = [
    ["Empiezas a frenar", "brakeBefore", "m antes", 0, -1],
    ["Deceleración máxima", "peakG", "g", 2, 1],
    ["Velocidad mínima", "vMin", "km/h", 0, 1],
    ["Tiempo muerto", "dead", "s", 1, -1],
    ["Gas a fondo", "fullAfter", "m después", 0, -1],
    ["Velocidad 60 m después", "vExit", "km/h", 0, 1],
    ["Inclinación máxima", "leanMax", "°", 0, 1],
    ["Radio en el vértice", "radius", "m", 0, 1],
  ];

  function renderCorners(lap, ref) {
    const box = $("corners");
    box.textContent = "";
    lap.corners.forEach((c, k) => {
      const rc = ref.corners[k];
      const card = el("div", "corner", null, box);
      el("h3", "", "C" + c.num + " · " + c.name, card);
      const tbl = el("table", "", null, card);
      const thead = el("thead", "", null, tbl);
      const hr = el("tr", "", null, thead);
      for (const h of ["", "Vuelta", "Ref.", "Δ"])
        el("th", "", h, hr).scope = "col";
      const tb = el("tbody", "", null, tbl);
      const row = (label, a, b, unit, dec, better) => {
        const tr = el("tr", "", null, tb);
        el("td", "", label + (unit ? " (" + unit + ")" : ""), tr);
        el("td", "", fmt(a, dec), tr);
        el("td", "", fmt(b, dec), tr);
        const diff =
          isFinite(a) && isFinite(b) && a !== null && b !== null ? a - b : NaN;
        const good = isFinite(diff) && diff * better > 0;
        const bad = isFinite(diff) && diff * better < 0;
        el(
          "td",
          good ? "better" : bad ? "worse" : "",
          isFinite(diff) ? fmtSigned(diff, dec) : "—",
          tr,
        );
      };
      for (const [label, key, unit, dec, better] of ROWS)
        row(label, c[key], rc[key], unit, dec, better);
      row("Sector", lap.sectors[k], ref.sectors[k], "s", 2, -1);
    });
  }

  // ---------- historial ----------
  async function initStore() {
    let db = null;
    let uid = null;
    try {
      db = window.claude ? await window.claude.use("db") : null;
      const user = window.claude ? await window.claude.use("user") : null;
      uid = user ? await user.id() : null;
    } catch (e) {
      db = null;
    }
    if (db && uid) {
      store.kind = "db";
      store.col = db.collection("data/users/" + uid);
      $("hist-where").textContent =
        "Se guardan en tu espacio privado de esta página: solo los ves tú.";
      store.unsub = store.col.onSnapshot(
        (snap) => {
          store.docs = snap.docs
            .map((d) => Object.assign({ id: d.id }, d.data()))
            .filter((d) => d.kind === "maspa-tanda");
          renderHistory();
        },
        () => {
          $("hist-where").textContent =
            "No se puede leer el historial en este momento.";
        },
      );
    } else {
      store.kind = "local";
      $("hist-where").textContent =
        "Sin sesión iniciada: se guardan solo en este navegador.";
      store.docs = readLocal();
      renderHistory();
    }
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function writeLocal(list) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function summaryDoc() {
    const r = state.result;
    const laps = validLaps();
    const round = (x, d) =>
      x === null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
    return {
      kind: "maspa-tanda",
      savedAt: new Date().toISOString(),
      label: state.fileName,
      dir: r.dir,
      finish: r.track.start,
      target: state.target,
      best: round(r.best.time, 3),
      ideal: round(r.ideal, 3),
      laps: laps.map((l) => round(l.time, 3)),
      sectors: laps.map((l) => l.sectors.map((s) => round(s, 3))),
      corners: r.best.corners.map((c) => ({
        num: c.num,
        name: c.name,
        brakeBefore: round(c.brakeBefore, 0),
        peakG: round(c.peakG, 2),
        vMin: round(c.vMin, 0),
        dead: round(c.dead, 2),
        fullAfter: round(c.fullAfter, 0),
        vExit: round(c.vExit, 0),
        leanMax: round(c.leanMax, 0),
      })),
    };
  }

  function renderSaveState() {
    const btn = $("save-btn");
    const ok =
      state.source === "file" &&
      state.result &&
      state.result.best &&
      !state.saved;
    btn.disabled = !ok;
    btn.textContent = state.saved ? "Guardada" : "Guardar esta tanda";
    btn.title =
      state.source === "demo" ? "Sube una tanda tuya para guardarla" : "";
  }

  async function saveCurrent() {
    if (
      !(state.source === "file" && state.result && state.result.best) ||
      state.saved
    )
      return;
    const doc = summaryDoc();
    const btn = $("save-btn");
    btn.disabled = true;
    try {
      if (store.kind === "db") {
        await store.col.doc("t" + Date.now().toString(36)).set(doc);
      } else {
        const list = readLocal();
        list.unshift(Object.assign({ id: "t" + Date.now().toString(36) }, doc));
        if (!writeLocal(list))
          throw userError(
            "El navegador no deja guardar aquí (modo privado o almacenamiento bloqueado).",
          );
        store.docs = list;
        renderHistory();
      }
      state.saved = true;
      renderSaveState();
    } catch (e) {
      btn.disabled = false;
      $("hist-where").textContent =
        e && e.code === "quota_exceeded"
          ? "No queda espacio para más tandas: borra alguna antigua."
          : e && e.user
            ? e.message
            : "No se ha podido guardar la tanda. Inténtalo de nuevo.";
    }
  }

  async function removeDoc(id) {
    try {
      if (store.kind === "db") await store.col.doc(id).delete();
      else {
        const list = readLocal().filter((d) => d.id !== id);
        writeLocal(list);
        store.docs = list;
        renderHistory();
      }
    } catch (e) {
      $("hist-where").textContent =
        "No se ha podido borrar la tanda. Inténtalo de nuevo.";
    }
  }

  function renderHistory() {
    const list = $("hist-list");
    list.textContent = "";
    const docs = store.docs
      .slice()
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    if (!docs.length) {
      el(
        "li",
        "",
        "Aún no has guardado ninguna tanda. Sube una grabación y pulsa «Guardar esta tanda».",
        list,
      );
    }
    for (const d of docs) {
      const li = el("li", "", null, list);
      const info = el("div", "", null, li);
      const date = new Date(d.savedAt);
      el(
        "div",
        "",
        isNaN(date)
          ? "Tanda"
          : date.toLocaleDateString("es-ES", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }) +
              " · " +
              (d.label || "tanda"),
        info,
      );
      const sub = el("div", "caption", null, info);
      sub.textContent =
        (d.laps ? d.laps.length : 0) +
        " vueltas · ideal " +
        fmtLap(d.ideal) +
        (d.dir === "rev" ? " · horario" : "");
      el("b", "", fmtLap(d.best), li);
      const actions = el("div", "", null, li);
      const del = el("button", "", "Borrar", actions);
      del.type = "button";
      del.addEventListener("click", () => {
        actions.textContent = "";
        const c = el("span", "confirm", "¿Borrar?", actions);
        const yes = el("button", "", "Sí", c);
        const no = el("button", "", "No", c);
        yes.type = no.type = "button";
        yes.addEventListener("click", () => removeDoc(d.id));
        no.addEventListener("click", renderHistory);
      });
    }
    renderHistoryChart(docs.slice().reverse());
  }

  function renderHistoryChart(docs) {
    const root = $("hist-svg");
    root.textContent = "";
    const pts = docs.filter((d) => isFinite(d.best));
    const vals = pts.map((d) => d.best).concat([state.target]);
    const lo = Math.min(...vals) - 0.5;
    const hi = Math.max(...vals) + 0.5;
    const Y = (v) => 112 - ((v - lo) / (hi - lo || 1)) * 104;
    const yT = Y(state.target);
    svg(
      "line",
      {
        x1: 0,
        x2: 1000,
        y1: yT,
        y2: yT,
        class: "l-ref",
        "vector-effect": "non-scaling-stroke",
      },
      root,
    );
    if (pts.length < 1) return;
    const xs = pts.map((_, i) =>
      pts.length === 1 ? 500 : 20 + (i / (pts.length - 1)) * 960,
    );
    svg(
      "path",
      {
        d: pathOf(
          xs,
          pts.map((d) => Y(d.best)),
        ),
        class: "l-lap",
        "vector-effect": "non-scaling-stroke",
      },
      root,
    );
    // Un trazo corto por tanda (los círculos se deformarían con el escalado libre de la gráfica).
    pts.forEach((d, i) =>
      svg(
        "line",
        {
          x1: xs[i],
          x2: xs[i],
          y1: Y(d.best) - 6,
          y2: Y(d.best) + 6,
          class: "l-lap",
          "vector-effect": "non-scaling-stroke",
        },
        root,
      ),
    );
  }

  // ---------- montaje ----------
  function wire() {
    $("file").addEventListener("change", (ev) => {
      state.saved = false;
      loadFiles(ev.target.files);
      ev.target.value = "";
    });
    const drop = $("drop");
    drop.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      drop.classList.remove("over");
      state.saved = false;
      loadFiles(ev.dataTransfer.files);
    });
    $("demo-btn").addEventListener("click", () => {
      state.saved = false;
      loadDemo();
    });
    $("target").addEventListener("change", () => {
      const t = parseLap($("target").value);
      if (!(t > 50 && t < 100)) {
        setStatus(
          "Escribe el objetivo como 1:05,0 (minutos:segundos,décimas).",
          true,
        );
        return;
      }
      state.target = t;
      if (state.session) runAnalysis();
    });
    const seg = $("ref-mode");
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-v]");
      if (!b) return;
      for (const x of seg.querySelectorAll("button"))
        x.setAttribute("aria-pressed", String(x === b));
      state.refMode = b.dataset.v;
      if (state.result && validLaps().length) renderDetail();
    });
    $("save-btn").addEventListener("click", saveCurrent);
    wireCursor();
    // Tocar la pista en el mapa mueve la línea de meta a ese punto.
    $("map").addEventListener("click", (ev) => {
      const r = state.result;
      const root = $("map");
      if (!r || !root.getScreenCTM()) return;
      const pt = root.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const p = pt.matrixTransform(root.getScreenCTM().inverse());
      let best = 0;
      let bd = Infinity;
      r.track.C.forEach((c, i) => {
        const d = Math.hypot(c[0] - p.x, c[1] - p.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (bd > 25) return;
      state.finish[r.dir] = (r.track.start + best) % r.track.n;
      writeFinish();
      state.saved = false;
      runAnalysis();
    });
    $("finish-reset").addEventListener("click", () => {
      state.finish = { osm: 0, rev: 0 };
      writeFinish();
      state.saved = false;
      if (state.session) runAnalysis();
    });
  }

  wire();
  const tanda = new URLSearchParams(location.search).get("tanda");
  if (tanda) loadFromGarage(tanda);
  else loadDemo();
  initStore();
})();
