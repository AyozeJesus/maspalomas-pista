// Modo pista: cronómetro, sectores y delta en directo para Maspalomas con el GPS y los sensores del móvil.
(function () {
  "use strict";
  const T = window.MaspaTelemetry;
  const S = window.MaspaSim;
  const GEO = window.MASPA_GEO;
  const G = 9.80665;
  const $ = (id) => document.getElementById(id);

  // ---------- formato ----------
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
    if (t === null || !isFinite(t)) return "—";
    const dec = d === undefined ? 2 : d;
    const f = Math.pow(10, dec);
    const tc = Math.round(t * f) / f;
    const m = Math.floor(tc / 60);
    const s = tc - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + fmt(s, dec);
  }
  function ring(i, n) {
    return ((i % n) + n) % n;
  }

  // ---------- ajustes y mejor vuelta (este navegador) ----------
  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  const settings = Object.assign(
    { cue: false, lead: 20, finish: { osm: 0, rev: 0 } },
    load("pista-ajustes", {}),
  );
  function saveSettings() {
    store("pista-ajustes", settings);
  }
  function bestKey(dir) {
    return "pista-mejor-" + dir + "-" + settings.finish[dir];
  }

  // ---------- series que crecen ----------
  class Series {
    constructor(cols) {
      this.cols = cols;
      this.n = 0;
      this.cap = 4096;
      this.d = {};
      for (const c of cols) this.d[c] = new Float64Array(this.cap);
    }
    push(row) {
      if (this.n === this.cap) {
        this.cap *= 2;
        for (const c of this.cols) {
          const a = new Float64Array(this.cap);
          a.set(this.d[c]);
          this.d[c] = a;
        }
      }
      for (const c of this.cols) this.d[c][this.n] = row[c];
      this.n++;
    }
    view() {
      const o = {};
      for (const c of this.cols) o[c] = this.d[c].subarray(0, this.n);
      return o;
    }
  }

  // ---------- álgebra mínima ----------
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function norm3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function solve3(M, y) {
    const d = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const det = d(M);
    if (Math.abs(det) < 1e-9) return null;
    const rep = (k) =>
      M.map((row, r) => row.map((x, c) => (c === k ? y[r] : x)));
    return [d(rep(0)) / det, d(rep(1)) / det, d(rep(2)) / det];
  }

  // ---------- motor ----------
  let E = null;
  let lastE = null;

  function newEngine(sim) {
    return {
      sim,
      t0: null,
      loc: new Series(["t", "lat", "lon", "speed", "hacc"]),
      acc: new Series(["t", "x", "y", "z"]),
      gyro: new Series(["t", "x", "y", "z"]),
      grav: new Series(["t", "x", "y", "z"]),
      dir: null,
      votes: 0,
      prevRaw: null,
      track: null,
      corners: null,
      bounds: null,
      fix: null,
      lastFixT: null,
      gpsBad: false,
      lapStart: null,
      lapNum: 0,
      lapSamples: [],
      lapSpeeds: [],
      lapOk: true,
      lastOn: null,
      laps: [],
      best: null,
      bestSectors: [Infinity, Infinity, Infinity, Infinity],
      lastBound: null,
      lastBoundT: null,
      sectorState: [null, null, null, null],
      cueDone: new Set(),
      prevCueS: null,
      deltaEma: null,
      calib: {
        M: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        y: [0, 0, 0],
        count: 0,
        up: [0, 0, 0],
        upN: 0,
        f: null,
        sum: [0, 0, 0],
        n: 0,
      },
      aEma: 0,
      aLast: null,
      aLong: new Series(["t", "a"]),
      slowSince: null,
      lag: 0,
      lagR2: null,
      mode: "ride",
      flashUntil: 0,
    };
  }

  function now() {
    return E.sim ? sim.t : Date.now() / 1000 - E.t0;
  }

  function setupTrack(dir) {
    E.dir = dir;
    E.track = T.buildTrack(dir, settings.finish[dir]);
    const ref = T.reference(E.track, 65.0, S.MAPS.repro.power);
    E.corners = ref.corners;
    E.bounds = T.sectorBounds(ref.corners, E.track.L);
    if (!E.sim) {
      const b = load(bestKey(dir), null);
      if (
        b &&
        Array.isArray(b.grid) &&
        b.grid.length === Math.floor(E.track.L / 4) + 2
      )
        E.best = b;
      if (E.best && Array.isArray(E.best.sectors))
        E.bestSectors = E.best.sectors.slice();
    }
  }

  // Sentido de marcha: hacia dónde avanzan los primeros fijos sobre el eje.
  function detectDir(x, y, v) {
    const C = GEO.main;
    const n = C.length;
    const m = T.nearestOn(C, x, y, 0, n - 1);
    if (m.dist > 15 || v < 8) return;
    if (E.prevRaw !== null) {
      const d = ring(m.i - E.prevRaw + n / 2, n) - n / 2;
      if (d !== 0 && Math.abs(d) < n / 4) E.votes += Math.sign(d);
    }
    E.prevRaw = m.i;
    if (Math.abs(E.votes) >= 5) setupTrack(E.votes > 0 ? "osm" : "rev");
  }

  function onFix(t, lat, lon, speed, hacc) {
    E.loc.push({
      t,
      lat,
      lon,
      speed: speed !== null && speed >= 0 ? speed : -1,
      hacc: isFinite(hacc) ? hacc : 99,
    });
    E.lastFixT = t;
    E.gpsBad = !(hacc <= 25);
    if (E.gpsBad) return;
    const [x, y] = T.toLocal(lat, lon);
    let v = speed !== null && speed >= 0 ? speed : null;
    if (v === null && E.fix)
      v = Math.hypot(x - E.fix.x, y - E.fix.y) / Math.max(0.2, t - E.fix.t);
    if (v === null) v = 0;
    if (!E.track) {
      detectDir(x, y, v);
      if (!E.track) {
        E.fix = { t, x, y, v, s: null, i: null, on: false };
        pitsCheck(t, v, false);
        return;
      }
    }
    const tr = E.track;
    let m =
      E.fix && E.fix.on
        ? T.nearestOn(tr.C, x, y, E.fix.i - 6, E.fix.i + 45)
        : null;
    if (!m || m.dist > 15) m = T.nearestOn(tr.C, x, y, 0, tr.n - 1);
    const s = tr.cs[m.i] + (tr.cs[m.i + 1] - tr.cs[m.i]) * m.f;
    const on = m.dist < 14 && v > 4;
    const prev = E.fix;
    const fix = { t, x, y, v, s, i: m.i, on };
    calibPair(prev, fix);
    if (on) E.lastOn = t;
    let crossed = false;
    if (prev && prev.on && on && prev.s !== null) {
      const L = tr.L;
      if (prev.s > L - 200 && s < 200) {
        const span = s + L - prev.s;
        if (span > 0 && span < 260) {
          const tc = prev.t + ((L - prev.s) / span) * (t - prev.t);
          checkBounds(prev, fix, prev.s, L);
          crossFinish(tc);
          checkBounds(prev, fix, 0, s, L - prev.s);
          crossed = true;
        }
      } else if (s > prev.s && s - prev.s < 200) {
        checkBounds(prev, fix, prev.s, s);
      }
    }
    if (E.lapStart !== null && on) {
      const last = E.lapSamples[E.lapSamples.length - 1];
      if (crossed || !last || s > last.s) {
        E.lapSamples.push({ s, tl: t - E.lapStart });
        E.lapSpeeds.push({ s, v });
      }
    }
    if (E.lapStart !== null && !on && E.lastOn !== null && t - E.lastOn > 3)
      E.lapOk = false;
    E.fix = fix;
    pitsCheck(t, v, on);
  }

  // Cruce de los límites de sector entre dos fijos (offset: metros ya recorridos antes de meta en este intervalo).
  function checkBounds(prev, fix, a, b, offset) {
    const L = E.track.L;
    const total = fix.s >= prev.s ? fix.s - prev.s : fix.s + L - prev.s;
    E.bounds.forEach((bs, k) => {
      if (bs > a && bs <= b) {
        const dist = (offset || 0) + (bs - a);
        const tb = prev.t + (dist / (total || 1)) * (fix.t - prev.t);
        if (E.lastBound !== null && ring(E.lastBound + 1, 4) === k && E.lapOk) {
          const sec = E.lastBound;
          const time = tb - E.lastBoundT;
          if (time > 5 && time < 60) {
            const refSec =
              E.best && E.best.sectors ? E.best.sectors[sec] : null;
            if (time < E.bestSectors[sec]) {
              E.bestSectors[sec] = time;
              E.sectorState[sec] = "best";
            } else
              E.sectorState[sec] =
                refSec !== null && time < refSec ? "good" : "bad";
          }
        }
        E.lastBound = k;
        E.lastBoundT = tb;
      }
    });
  }

  function crossFinish(tc) {
    if (E.lapStart !== null) finishLap(tc);
    E.lapStart = tc;
    E.lapNum += 1;
    E.lapSamples = [{ s: 0, tl: 0 }];
    E.lapSpeeds = [];
    E.lapOk = true;
    E.cueDone.clear();
    E.prevCueS = null;
  }

  function gridOf(samples, L, time) {
    const pts = samples.concat([{ s: L, tl: time }]);
    const m = Math.floor(L / 4) + 1;
    const out = [];
    let j = 0;
    for (let k = 0; k <= m; k++) {
      const s = Math.min(k * 4, L);
      while (j < pts.length - 2 && pts[j + 1].s < s) j++;
      const a = pts[j];
      const b = pts[Math.min(j + 1, pts.length - 1)];
      const f =
        b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
      out.push(Math.round((a.tl + (b.tl - a.tl) * f) * 1000) / 1000);
    }
    return out;
  }

  function gridAt(grid, s) {
    const k = Math.max(0, Math.min(grid.length - 2, Math.floor(s / 4)));
    const f = Math.max(0, Math.min(1, (s - k * 4) / 4));
    return grid[k] + (grid[k + 1] - grid[k]) * f;
  }

  function sectorsOf(grid, time) {
    const B = E.bounds;
    return B.map((a, k) => {
      const b = B[(k + 1) % B.length];
      let d = gridAt(grid, b) - gridAt(grid, a);
      if (d < 0) d += time;
      return Math.round(d * 1000) / 1000;
    });
  }

  // Dónde empezaste a frenar en cada curva: con el acelerómetro si ya está calibrado; si no, con el GPS.
  function brakePoints(lapStart, lapEnd, samples, speeds) {
    const L = E.track.L;
    const sOfT = (t) => {
      const tl = t - lapStart;
      let j = 0;
      while (j < samples.length - 2 && samples[j + 1].tl < tl) j++;
      const a = samples[j];
      const b = samples[Math.min(j + 1, samples.length - 1)];
      const f =
        b.tl > a.tl ? Math.max(0, Math.min(1, (tl - a.tl) / (b.tl - a.tl))) : 0;
      return a.s + (b.s - a.s) * f;
    };
    const al = E.aLong.view();
    return E.corners.map((c) => {
      const sa = c.sApex;
      if (sa < 260 || sa > L - 10) return null;
      if (E.calib.f && al.t.length) {
        const pts = [];
        for (let i = 0; i < al.t.length; i++) {
          if (al.t[i] < lapStart || al.t[i] > lapEnd) continue;
          const s = sOfT(al.t[i]);
          if (s > sa - 300 && s < sa + 10) pts.push({ s, a: al.a[i] });
        }
        const deep = pts.findIndex((p) => p.a < -0.3 * G);
        if (deep > 0) {
          let k = deep;
          while (k > 0 && pts[k - 1].a < -0.1 * G) k--;
          return Math.round(pts[k].s);
        }
      }
      let best = null;
      for (const p of speeds)
        if (p.s > sa - 320 && p.s < sa - 20 && (!best || p.v > best.v))
          best = p;
      return best ? Math.round(best.s) : null;
    });
  }

  function finishLap(tc) {
    const L = E.track.L;
    const time = tc - E.lapStart;
    const valid =
      E.lapOk && time > 45 && time < 150 && E.lapSamples.length > 20;
    const lap = { num: E.lapNum, time, valid };
    E.laps.push(lap);
    if (!valid) return;
    lap.grid = gridOf(E.lapSamples, L, time);
    lap.sectors = sectorsOf(lap.grid, time);
    lap.brakeS = brakePoints(E.lapStart, tc, E.lapSamples, E.lapSpeeds);
    const prevBest = E.best ? E.best.time : null;
    const isBest = prevBest === null || time < prevBest;
    if (isBest) {
      E.best = {
        time: Math.round(time * 1000) / 1000,
        grid: lap.grid,
        sectors: lap.sectors,
        brakeS: lap.brakeS,
        date: new Date().toISOString(),
      };
      if (!E.sim) store(bestKey(E.dir), E.best);
    }
    showLapFlash(time, isBest, prevBest);
    estimateLag();
  }

  // ---------- sensores ----------
  function calibPair(prev, fix) {
    const c = E.calib;
    if (
      prev &&
      prev.on &&
      fix.on &&
      c.n > 5 &&
      fix.t - prev.t < 2.5 &&
      fix.t > prev.t
    ) {
      const X = [c.sum[0] / c.n, c.sum[1] / c.n, c.sum[2] / c.n];
      const Y = (fix.v - prev.v) / (fix.t - prev.t);
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 3; k++) c.M[r][k] += X[r] * X[k];
        c.y[r] += X[r] * Y;
      }
      c.count++;
      if (c.count >= 30 && c.count % 10 === 0 && c.upN > 50) {
        const w = solve3(c.M, c.y);
        if (w) {
          const u = norm3(c.up);
          const wu = dot3(w, u);
          c.f = norm3([w[0] - wu * u[0], w[1] - wu * u[1], w[2] - wu * u[2]]);
        }
      }
    }
    c.sum = [0, 0, 0];
    c.n = 0;
  }

  function onMotion(t, lin, grav, gyro) {
    E.acc.push({ t, x: lin[0], y: lin[1], z: lin[2] });
    E.grav.push({ t, x: grav[0], y: grav[1], z: grav[2] });
    E.gyro.push({ t, x: gyro[0], y: gyro[1], z: gyro[2] });
    const c = E.calib;
    c.sum[0] += lin[0];
    c.sum[1] += lin[1];
    c.sum[2] += lin[2];
    c.n++;
    const v = E.fix ? E.fix.v : 0;
    if (v < 0.5 || (v > 15 && Math.hypot(gyro[0], gyro[1], gyro[2]) < 0.06)) {
      c.up[0] += grav[0];
      c.up[1] += grav[1];
      c.up[2] += grav[2];
      c.upN++;
    }
    if (c.f) {
      const a = dot3(lin, c.f);
      const dt =
        E.aLast === null ? 0.02 : Math.max(0.001, Math.min(0.1, t - E.aLast));
      E.aLast = t;
      E.aEma += (a - E.aEma) * (1 - Math.exp(-dt / 0.2));
      E.aLong.push({ t, a: E.aEma });
    }
  }

  // ---------- boxes ----------
  function pitsCheck(t, v, on) {
    if (v < 4 || !on) {
      if (E.slowSince === null) E.slowSince = t;
      else if (t - E.slowSince > 5 && E.mode === "ride" && E.lapNum > 0)
        enterPits();
    } else {
      E.slowSince = null;
      if (E.mode === "pits" && v > 8) enterRide();
    }
  }

  function sessionOf(eng) {
    const l = eng.loc.view();
    return {
      loc: {
        t: l.t,
        lat: l.lat,
        lon: l.lon,
        speed: l.speed,
        hacc: l.hacc,
        bearing: null,
      },
      acc: eng.acc.n > 100 ? eng.acc.view() : undefined,
      gyro: eng.gyro.n > 100 ? eng.gyro.view() : undefined,
      grav: eng.grav.n > 100 ? eng.grav.view() : undefined,
      warnings: [],
    };
  }

  function enterPits() {
    E.mode = "pits";
    show("pits");
    const valid = E.laps.filter((l) => l.valid);
    $("p-sub").textContent =
      (valid.length
        ? valid.length +
          (valid.length === 1 ? " vuelta completa" : " vueltas completas") +
          (E.best ? " · mejor " + fmtLap(E.best.time) : "")
        : "Aún no hay ninguna vuelta completa.") +
      (E.calib.f ? " · sensores calibrados" : " · sensores aún sin calibrar") +
      (E.lagR2 !== null
        ? " · retraso del GPS " + fmt(E.lag, 1) + " s (compensado)"
        : "");
    const body = $("p-laps");
    body.textContent = "";
    let analysis = null;
    try {
      analysis = T.analyze(sessionOf(E), { finish: settings.finish });
    } catch (e) {
      analysis = null;
    }
    const laps = analysis ? analysis.laps.filter((l) => l.valid) : valid;
    const bestT = laps.length ? Math.min(...laps.map((l) => l.time)) : null;
    laps.forEach((l, i) => {
      const tr = document.createElement("tr");
      const cells = [
        String(i + 1),
        fmtLap(l.time),
        l.time === bestT ? "—" : fmtSigned(l.time - bestT, 2),
      ];
      cells.forEach((txt, k) => {
        const td = document.createElement("td");
        td.textContent = txt;
        if (k === 1 && l.time === bestT) td.className = "best";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $("p-ideal").textContent =
      analysis && analysis.ideal
        ? "Vuelta ideal (tus mejores sectores): " + fmtLap(analysis.ideal)
        : "";
    // Con el análisis completo, la mejor vuelta del resumen es la suya (más precisa que la del directo).
    if (bestT !== null)
      $("p-sub").textContent = $("p-sub").textContent.replace(
        /mejor \d+:\d\d,\d\d/,
        "mejor " + fmtLap(bestT),
      );
    const tips = $("p-tips");
    tips.textContent = "";
    const addTip = (title, loss, lines) => {
      const li = document.createElement("li");
      const st = document.createElement("strong");
      st.textContent = title;
      li.appendChild(st);
      if (loss !== null) {
        const b = document.createElement("span");
        b.className = "loss";
        b.textContent = fmtSigned(-loss, 2) + " s en ese tramo";
        li.appendChild(b);
      }
      for (const t of lines) {
        const p = document.createElement("span");
        p.textContent = t;
        li.appendChild(p);
      }
      tips.appendChild(li);
    };
    if (!analysis || !analysis.best) {
      addTip("Sin análisis todavía", null, [
        "Haz al menos una vuelta completa pasando dos veces por meta.",
      ]);
      return;
    }
    const last = laps[laps.length - 1];
    const isBest = last === analysis.best;
    const res = isBest
      ? T.insights(last, analysis.ref.metrics, analysis.ref.sectors, {
          ref: "el objetivo de 1:05",
        })
      : T.insights(last, analysis.best.corners, analysis.best.sectors, {
          ref: "tu mejor vuelta",
        });
    const top = res.filter((x) => x.loss > 0.03).slice(0, 3);
    if (!top.length)
      addTip(
        isBest ? "Tu última vuelta es la mejor" : "Última vuelta muy pareja",
        null,
        ["No pierdes tiempo claro en ninguna horquilla."],
      );
    for (const x of top) {
      const lines = x.tips.map(
        (t) => t.text.charAt(0).toUpperCase() + t.text.slice(1) + ".",
      );
      addTip(
        "C" + x.corner.num + " · " + x.corner.name,
        x.loss,
        lines.length ? lines : ["Pierdes un poco en toda la curva."],
      );
    }
  }

  function enterRide() {
    E.mode = "ride";
    show("dash");
  }

  // ---------- pantalla ----------
  function show(which) {
    for (const id of ["home", "dash", "pits"]) $(id).hidden = id !== which;
  }

  function showLapFlash(time, isBest, prevBest) {
    const fl = $("flash");
    fl.className = "flash lap num" + (isBest ? " best" : "");
    fl.textContent = fmtLap(time);
    const sm = document.createElement("small");
    sm.textContent = isBest
      ? prevBest === null
        ? "primera referencia"
        : "¡mejor vuelta! " + fmtSigned(time - prevBest, 2)
      : fmtSigned(time - prevBest, 2) + " vs mejor";
    fl.appendChild(sm);
    fl.hidden = E.mode !== "ride";
    E.flashUntil = now() + 5;
  }

  function brakeFlash() {
    const fl = $("flash");
    fl.className = "flash brake";
    fl.textContent = "";
    fl.hidden = false;
    E.flashUntil = now() + 0.5;
  }

  // Retraso del GPS respecto a los sensores: el que mejor hace cuadrar la aceleración que mide el GPS
  // con la del acelerómetro (lo mismo que hace el análisis completo). Se recalcula en cada vuelta.
  function estimateLag() {
    const l = E.loc.view();
    const a = E.acc.view();
    const n = a.t.length;
    if (n < 600 || l.t.length < 40) return;
    const pre = [
      new Float64Array(n + 1),
      new Float64Array(n + 1),
      new Float64Array(n + 1),
    ];
    for (let i = 0; i < n; i++) {
      pre[0][i + 1] = pre[0][i] + a.x[i];
      pre[1][i + 1] = pre[1][i] + a.y[i];
      pre[2][i + 1] = pre[2][i] + a.z[i];
    }
    const idx = (t) => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (a.t[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    let best = null;
    for (let lag = 0; lag <= 1.2001; lag += 0.1) {
      const M = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const yv = [0, 0, 0];
      const rows = [];
      for (let k = 1; k < l.t.length - 1; k++) {
        const v0 = l.speed[k - 1];
        const v1 = l.speed[k + 1];
        const dt = l.t[k + 1] - l.t[k - 1];
        if (!(v0 > 5 && v1 > 5) || dt <= 0 || dt > 3 || l.hacc[k] > 25)
          continue;
        const i0 = idx(l.t[k - 1] - lag);
        const i1 = idx(l.t[k + 1] - lag);
        if (i1 - i0 < 5 || i1 > n) continue;
        const c = i1 - i0;
        const X = [
          (pre[0][i1] - pre[0][i0]) / c,
          (pre[1][i1] - pre[1][i0]) / c,
          (pre[2][i1] - pre[2][i0]) / c,
        ];
        const Y = (v1 - v0) / dt;
        for (let r = 0; r < 3; r++) {
          for (let q = 0; q < 3; q++) M[r][q] += X[r] * X[q];
          yv[r] += X[r] * Y;
        }
        rows.push([X, Y]);
      }
      if (rows.length < 40) continue;
      const w = solve3(M, yv);
      if (!w) continue;
      let res = 0;
      let tot = 0;
      for (const [X, Y] of rows) {
        res += (Y - dot3(w, X)) ** 2;
        tot += Y * Y;
      }
      const r2 = 1 - res / (tot || 1);
      if (!best || r2 > best.r2) best = { lag, r2 };
    }
    if (best && best.r2 > 0.5) {
      E.lag = Math.round(best.lag * 10) / 10;
      E.lagR2 = best.r2;
    }
  }

  function predicted(t) {
    const f = E.fix;
    if (!f || f.s === null) return null;
    // El fijo describe dónde estabas hace `lag` segundos: se proyecta desde entonces.
    const dt = Math.max(0, Math.min(2.5, t - (f.t - E.lag)));
    const a = E.calib.f ? E.aEma : 0;
    const v = Math.max(0, f.v + a * dt);
    const s = Math.min(E.track.L, f.s + f.v * dt + 0.5 * a * dt * dt);
    return { s, v };
  }

  function render() {
    if (!E || E.mode !== "ride") return;
    const t = now();
    const fl = $("flash");
    if (!fl.hidden && t > E.flashUntil) fl.hidden = true;
    const fresh = E.lastFixT !== null && t - E.lastFixT < 2.5 && !E.gpsBad;
    $("d-gps").className =
      "dot " + (fresh ? "ok" : E.lastFixT === null ? "wait" : "bad");
    const p = E.track && E.fix && E.fix.on ? predicted(t) : null;
    $("d-speed").textContent = fmt((p ? p.v : E.fix ? E.fix.v : 0) * 3.6, 0);
    $("d-lap").textContent = E.lapNum
      ? "Vuelta " + E.lapNum
      : E.track
        ? "Hacia meta"
        : "Buscando la pista";
    const dash = $("dash");
    let cls = "";
    const deltaEl = $("d-delta");
    let main = "—";
    let sub = E.track
      ? E.lapStart === null
        ? "esperando meta"
        : "primera vuelta: sin referencia"
      : "detectando el sentido de marcha";
    if (p && E.lapStart !== null && E.best) {
      const d = t - E.lapStart - gridAt(E.best.grid, p.s);
      E.deltaEma =
        E.deltaEma === null ? d : E.deltaEma + (d - E.deltaEma) * 0.15;
      main = fmtSigned(E.deltaEma, 2);
      sub = "frente a " + fmtLap(E.best.time);
      cls = E.deltaEma < -0.05 ? "good" : E.deltaEma > 0.05 ? "bad" : "";
      // Aviso de frenada (prueba): una vez por curva y vuelta, solo lanzado.
      if (settings.cue && E.best.brakeS && p.v > 25) {
        E.best.brakeS.forEach((bs, k) => {
          if (bs === null || E.cueDone.has(k)) return;
          const target = bs - settings.lead;
          if (E.prevCueS !== null && E.prevCueS < target && p.s >= target) {
            E.cueDone.add(k);
            brakeFlash();
          }
        });
      }
      E.prevCueS = p.s;
    }
    dash.className = "dash " + cls;
    if (deltaEl.firstChild.nodeValue !== main)
      deltaEl.firstChild.nodeValue = main;
    $("d-delta-sub").textContent = sub;
    $("d-time").textContent =
      E.lapStart !== null ? fmtLap(t - E.lapStart, 1) : "—";
    const lastValid = E.laps.filter((l) => l.valid).slice(-1)[0];
    $("d-info").textContent = "";
    $("d-info").append(
      "Mejor " + (E.best ? fmtLap(E.best.time) : "—"),
      document.createElement("br"),
      "Última " + (lastValid ? fmtLap(lastValid.time) : "—"),
    );
    const boxes = $("d-sectors").children;
    for (let k = 0; k < 4; k++)
      boxes[k].className = E.sectorState[k] ? "s-" + E.sectorState[k] : "";
  }

  function loop() {
    if (E && E.sim) simStep();
    render();
    requestAnimationFrame(loop);
  }

  // ---------- simulador ----------
  const sim = { t: 0, data: null, iL: 0, iM: 0, last: null, speed: 1 };

  function simStep() {
    const nowMs = performance.now();
    const dt = sim.last === null ? 0 : Math.min(0.1, (nowMs - sim.last) / 1000);
    sim.last = nowMs;
    sim.t += dt * sim.speed;
    const d = sim.data;
    while (sim.iM < d.acc.t.length && d.acc.t[sim.iM] <= sim.t) {
      const i = sim.iM++;
      onMotion(
        d.acc.t[i],
        [d.acc.x[i], d.acc.y[i], d.acc.z[i]],
        [d.grav.x[i], d.grav.y[i], d.grav.z[i]],
        [d.gyro.x[i], d.gyro.y[i], d.gyro.z[i]],
      );
    }
    while (sim.iL < d.loc.t.length && d.loc.t[sim.iL] <= sim.t) {
      const i = sim.iL++;
      onFix(
        d.loc.t[i],
        d.loc.lat[i],
        d.loc.lon[i],
        d.loc.speed[i],
        d.loc.hacc[i],
      );
    }
    if (sim.iL >= d.loc.t.length && E.mode === "ride") enterPits();
  }

  function startSim(speedFactor) {
    E = newEngine(true);
    E.t0 = 0;
    sim.data = T.demoSession({ seed: 7 }).session;
    sim.t = 0;
    sim.iL = 0;
    sim.iM = 0;
    sim.last = null;
    sim.speed = speedFactor || 1;
    show("dash");
  }

  // ---------- en pista de verdad ----------
  let watchId = null;
  let wakeLock = null;

  async function keepAwake() {
    try {
      if ("wakeLock" in navigator)
        wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      wakeLock = null;
    }
    setStatus(
      "st-imu",
      wakeLock ? "ok" : "wait",
      wakeLock
        ? "Pantalla: siempre encendida"
        : "Pantalla: desactiva el apagado automático en Ajustes del móvil",
    );
  }

  function setStatus(id, state, text) {
    $(id).className = "dot " + state;
    $(id + "-t").textContent = text;
  }

  function onMotionEvent(ev) {
    if (!E || E.sim) return;
    const t = (performance.timeOrigin + ev.timeStamp) / 1000 - E.t0;
    const g = ev.accelerationIncludingGravity;
    const a = ev.acceleration;
    const r = ev.rotationRate;
    if (!g || g.x === null) return;
    let lin;
    let grav;
    if (a && a.x !== null) {
      lin = [a.x, a.y, a.z];
      grav = [g.x - a.x, g.y - a.y, g.z - a.z];
    } else {
      // Sin aceleración lineal: gravedad por filtro paso bajo de la total.
      E.lp = E.lp || [g.x, g.y, g.z];
      for (let k = 0; k < 3; k++)
        E.lp[k] += ([g.x, g.y, g.z][k] - E.lp[k]) * 0.02;
      grav = E.lp.slice();
      lin = [g.x - grav[0], g.y - grav[1], g.z - grav[2]];
    }
    const DEG = Math.PI / 180;
    const gyro =
      r && r.alpha !== null
        ? [r.beta * DEG, r.gamma * DEG, r.alpha * DEG]
        : [0, 0, 0];
    onMotion(t, lin, grav, gyro);
  }

  async function startReal() {
    if (!("geolocation" in navigator)) {
      setStatus("st-gps", "bad", "Este navegador no da acceso al GPS.");
      return;
    }
    E = newEngine(false);
    E.t0 = Date.now() / 1000;
    try {
      if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen({
          navigationUI: "hide",
        });
    } catch (e) {
      /* pantalla completa opcional */
    }
    await keepAwake();
    window.addEventListener("devicemotion", onMotionEvent);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!E || E.sim) return;
        const c = pos.coords;
        onFix(
          pos.timestamp / 1000 - E.t0,
          c.latitude,
          c.longitude,
          c.speed,
          c.accuracy,
        );
      },
      (err) => {
        const msg =
          err.code === 1
            ? "GPS: permiso denegado. Actívalo para esta web en los ajustes de Chrome."
            : "GPS: sin señal todavía…";
        setStatus("st-gps", err.code === 1 ? "bad" : "wait", msg);
        if (err.code === 1) stopAll();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    setStatus("st-gps", "wait", "GPS: buscando señal…");
    show("dash");
  }

  function stopAll() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener("devicemotion", onMotionEvent);
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    if (document.fullscreenElement && document.exitFullscreen)
      document.exitFullscreen().catch(() => {});
    lastE = E;
    E = null;
    show("home");
    renderHome();
  }

  // ---------- exportar ----------
  async function exportSession(eng) {
    if (!eng || !window.JSZip) return;
    const btn = $("export");
    const ms0 = Math.round((eng.sim ? Date.now() / 1000 : eng.t0) * 1000);
    const ns = (t) => String(ms0 + Math.round(t * 1000)) + "000000";
    const csv = (header, series, cols) => {
      const v = series.view();
      const lines = [header];
      for (let i = 0; i < series.n; i++)
        lines.push(
          [ns(v.t[i]), v.t[i].toFixed(4)]
            .concat(cols.map((c) => v[c][i]))
            .join(","),
        );
      return lines.join("\n") + "\n";
    };
    const zip = new window.JSZip();
    zip.file(
      "Location.csv",
      csv(
        "time,seconds_elapsed,horizontalAccuracy,speed,longitude,latitude",
        eng.loc,
        ["hacc", "speed", "lon", "lat"],
      ),
    );
    if (eng.acc.n)
      zip.file(
        "Accelerometer.csv",
        csv("time,seconds_elapsed,z,y,x", eng.acc, ["z", "y", "x"]),
      );
    if (eng.gyro.n)
      zip.file(
        "Gyroscope.csv",
        csv("time,seconds_elapsed,z,y,x", eng.gyro, ["z", "y", "x"]),
      );
    if (eng.grav.n)
      zip.file(
        "Gravity.csv",
        csv("time,seconds_elapsed,z,y,x", eng.grav, ["z", "y", "x"]),
      );
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
    const d = new Date();
    const name =
      "maspalomas-" +
      d.toISOString().slice(0, 16).replace(/[-:T]/g, "") +
      (eng.sim ? "-simulador" : "") +
      ".zip";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (btn) btn.textContent = "Exportada";
  }

  // ---------- inicio ----------
  function renderHome() {
    let any = false;
    const parts = ["osm", "rev"].map((dir) => {
      const b = load(bestKey(dir), null);
      if (b) any = true;
      return (
        (dir === "osm" ? "antihorario " : "horario ") +
        (b ? fmtLap(b.time) : "—")
      );
    });
    setStatus(
      "st-best",
      any ? "ok" : "",
      "Mejor vuelta guardada: " + parts.join(" · "),
    );
    $("cue").checked = !!settings.cue;
    $("cue-opts").hidden = !settings.cue;
    $("lead").value = settings.lead;
    $("lead-v").textContent = settings.lead;
    drawMetaMap();
    const exp = $("home-export");
    if (exp) exp.hidden = !lastE;
  }

  function drawMetaMap() {
    const root = $("meta-svg");
    root.textContent = "";
    const C = GEO.main;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of C) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const pad = 30;
    root.setAttribute(
      "viewBox",
      [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].join(" "),
    );
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      root.appendChild(e);
      return e;
    };
    mk("path", {
      d:
        "M" +
        C.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") +
        "Z",
      class: "m-road",
    });
    const i = settings.finish.osm;
    const f = window.MaspaAnalysis.frame(C, i);
    const p = C[i];
    mk("line", {
      x1: p[0] - f.rx * 9,
      y1: p[1] - f.ry * 9,
      x2: p[0] + f.rx * 9,
      y2: p[1] + f.ry * 9,
      class: "m-finish",
    });
    mk("text", {
      x: p[0] + f.rx * 22,
      y: p[1] + f.ry * 22 + 4,
      class: "m-text",
    }).textContent = "Meta";
  }

  function wire() {
    $("go").addEventListener("click", startReal);
    $("sim").addEventListener("click", () => startSim(1));
    $("stop").addEventListener("click", () => {
      if (E && E.lapNum > 0) enterPits();
      else stopAll();
    });
    $("resume").addEventListener("click", enterRide);
    $("export").addEventListener("click", () => exportSession(E || lastE));
    $("home-export").addEventListener("click", () => exportSession(lastE));
    let confirmArmed = false;
    $("finish").addEventListener("click", () => {
      if (!confirmArmed) {
        confirmArmed = true;
        $("finish").textContent = "¿Terminar? Toca otra vez";
        setTimeout(() => {
          confirmArmed = false;
          $("finish").textContent = "Terminar";
        }, 4000);
        return;
      }
      confirmArmed = false;
      $("finish").textContent = "Terminar";
      stopAll();
    });
    $("cue").addEventListener("change", () => {
      settings.cue = $("cue").checked;
      saveSettings();
      $("cue-opts").hidden = !settings.cue;
    });
    $("lead").addEventListener("input", () => {
      settings.lead = Number($("lead").value);
      $("lead-v").textContent = settings.lead;
      saveSettings();
    });
    $("meta-svg").addEventListener("click", (ev) => {
      const root = $("meta-svg");
      const m = root.getScreenCTM();
      if (!m) return;
      const pt = root.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const q = pt.matrixTransform(m.inverse());
      const C = GEO.main;
      let best = 0;
      let bd = Infinity;
      C.forEach((c, i) => {
        const d = Math.hypot(c[0] - q.x, c[1] - q.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (bd > 25) return;
      settings.finish = { osm: best, rev: ring(C.length - best, C.length) };
      saveSettings();
      renderHome();
    });
    $("meta-reset").addEventListener("click", () => {
      settings.finish = { osm: 0, rev: 0 };
      saveSettings();
      renderHome();
    });
    let bestArmed = false;
    $("best-reset").addEventListener("click", () => {
      if (!bestArmed) {
        bestArmed = true;
        $("best-reset").textContent = "¿Seguro? Toca otra vez";
        setTimeout(() => {
          bestArmed = false;
          $("best-reset").textContent = "Borrar mejor vuelta guardada";
        }, 4000);
        return;
      }
      bestArmed = false;
      $("best-reset").textContent = "Borrar mejor vuelta guardada";
      for (const dir of ["osm", "rev"]) {
        try {
          localStorage.removeItem(bestKey(dir));
        } catch (e) {
          /* nada que borrar */
        }
      }
      renderHome();
    });
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        E &&
        !E.sim &&
        watchId !== null
      )
        keepAwake();
    });
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // Acceso para pruebas automáticas del simulador (no afecta al uso normal).
  window.MaspaPista = {
    startSim,
    get engine() {
      return E;
    },
    sim,
  };
  wire();
  renderHome();
  requestAnimationFrame(loop);
})();
