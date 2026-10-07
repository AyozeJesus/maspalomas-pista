// Telemetría de Maspalomas: lectura de Sensor Logger (Android), fusión GPS + IMU sobre el trazado real,
// corte de vueltas y métricas por horquilla según los cuatro pilares.
(function (root) {
  "use strict";
  const S = root.MaspaSim;
  const A = root.MaspaAnalysis;
  const GEO = root.MASPA_GEO;
  const G = 9.80665;
  // Misma proyección que el trazado (metros locales, x hacia el este, y hacia el sur).
  const PROJ = {
    kx: 98494.19835761702,
    ky: 110540,
    lon0: -15.52,
    lat0: 27.775,
    ox: 980.7643328406798,
    oy: 1158.9717346684154,
  };
  const GRID_HZ = 50;
  const STEP_M = 2;
  // Distancia máxima al eje para dar un fijo por «en pista»: medio ancho (6 m) + trazada por fuera en los
  // cruces + lo que se desvía un GPS de móvil de una frecuencia durante varios segundos. Un fijo que salta
  // lo descarta además la comprobación de avance (segmentsOnTrack).
  const ON_TRACK_M = 20;
  const OBJ = { exit: 1, coast: 0, width: 1 };

  function toLocal(lat, lon) {
    return [
      (lon - PROJ.lon0) * PROJ.kx - PROJ.ox,
      PROJ.oy - (lat - PROJ.lat0) * PROJ.ky,
    ];
  }
  function toLatLon(x, y) {
    return [
      (PROJ.oy - y) / PROJ.ky + PROJ.lat0,
      (x + PROJ.ox) / PROJ.kx + PROJ.lon0,
    ];
  }
  function ring(i, n) {
    return ((i % n) + n) % n;
  }
  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  // ---------- lectura de archivos ----------
  function parseCsv(text) {
    let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    let nl = text.indexOf("\n", start);
    if (nl < 0) nl = text.length;
    const header = text
      .slice(start, nl)
      .replace(/\r$/, "")
      .split(",")
      .map((h) => h.trim().replace(/^"|"$/g, ""));
    const body = text.slice(nl + 1).split("\n");
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    const n = body.length;
    const cols = {};
    for (const h of header) cols[h] = new Float64Array(n);
    const arr = header.map((h) => cols[h]);
    for (let r = 0; r < n; r++) {
      const parts = body[r].split(",");
      for (let c = 0; c < arr.length; c++) {
        const s = parts[c];
        arr[c][r] = s === undefined || s === "" ? NaN : Number(s);
      }
    }
    return { header, cols, n };
  }

  const FILES = {
    loc: /(^|\/)location\.csv$/i,
    acc: /(^|\/)accelerometer\.csv$/i,
    gyro: /(^|\/)gyroscope\.csv$/i,
    grav: /(^|\/)gravity\.csv$/i,
  };

  // files: [{name, text}] → sesión con arrays por sensor (t en segundos desde el inicio de la grabación).
  function sessionFromCsv(files) {
    const found = {};
    for (const f of files) {
      for (const key in FILES)
        if (FILES[key].test(f.name) && !found[key])
          found[key] = parseCsv(f.text);
    }
    if (!found.loc)
      throw new Error(
        "No encuentro Location.csv: activa Location en Sensor Logger.",
      );
    const timeOf = (p) => {
      if (p.cols.seconds_elapsed) return p.cols.seconds_elapsed;
      if (p.cols.time) return Float64Array.from(p.cols.time, (x) => x / 1e9);
      throw new Error("Falta la columna de tiempo (seconds_elapsed).");
    };
    // Si solo hay `time` (ns de época), todas se refieren al mismo origen.
    let t0 = 0;
    if (!found.loc.cols.seconds_elapsed) {
      t0 = Infinity;
      for (const k in found) t0 = Math.min(t0, timeOf(found[k])[0]);
    }
    const shift = (t) => (t0 ? t.map((x) => x - t0) : t);
    const L = found.loc.cols;
    const need = ["latitude", "longitude"];
    for (const c of need)
      if (!L[c]) throw new Error("Location.csv sin columna «" + c + "».");
    const session = {
      loc: {
        t: shift(timeOf(found.loc)),
        lat: L.latitude,
        lon: L.longitude,
        speed: L.speed || new Float64Array(found.loc.n).fill(NaN),
        hacc: L.horizontalAccuracy || new Float64Array(found.loc.n).fill(5),
        bearing: L.bearing || null,
      },
      warnings: [],
    };
    for (const key of ["acc", "gyro", "grav"]) {
      const p = found[key];
      if (!p) continue;
      if (!p.cols.x || !p.cols.y || !p.cols.z) continue;
      session[key] = {
        t: shift(timeOf(p)),
        x: p.cols.x,
        y: p.cols.y,
        z: p.cols.z,
      };
    }
    if (!session.acc || !session.gyro || !session.grav) {
      session.warnings.push(
        "Faltan Accelerometer, Gyroscope o Gravity: análisis solo con GPS (frenadas e inclinación aproximadas).",
      );
    }
    return session;
  }

  // ---------- trazado y referencia ----------
  // Trazado en el sentido de marcha, girado para que el punto 0 sea la línea de meta (`start`, índice del eje).
  function buildTrack(dir, start) {
    const base = dir === "osm" ? GEO.main : A.reverseTrack(GEO.main);
    const n = base.length;
    const s0 = ring(Math.round(start || 0), n);
    const C = base.map((_, i) => base[(i + s0) % n]);
    const N = C.map((_, i) => {
      const f = A.frame(C, i);
      return [f.rx, f.ry];
    });
    const cs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++)
      cs[i + 1] =
        cs[i] +
        Math.hypot(C[(i + 1) % n][0] - C[i][0], C[(i + 1) % n][1] - C[i][1]);
    const offsets = GEO.lines[dir].map((_, i) => GEO.lines[dir][(i + s0) % n]);
    const full = C.map((c, i) => [
      c[0] + N[i][0] * offsets[i],
      c[1] + N[i][1] * offsets[i],
    ]);
    return { dir, start: s0, C, N, cs, L: cs[n], n, offsets, full };
  }

  function lineWithWidth(track, w, mask) {
    return track.C.map((c, i) => {
      const k = 1 - (1 - w) * (mask ? mask[i] : 1);
      return [
        c[0] + track.N[i][0] * track.offsets[i] * k,
        c[1] + track.N[i][1] * track.offsets[i] * k,
      ];
    });
  }

  // Objetivo del modelo para un tiempo dado y las horquillas del trazado.
  function reference(track, targetTime, power) {
    const lt = (r) => S.simulate(track.full, r, { power }).lapTime;
    const o = S.calibrate(lt, OBJ, targetTime);
    const rider = S.riderFrom(Object.assign({}, OBJ, { conf: o.conf }));
    const sim = S.simulate(track.full, rider, { power });
    const corners = A.findCorners(track.full, sim);
    const n = track.n;
    const mask = track.C.map((_, i) => {
      let near = Infinity;
      for (const c of corners)
        near = Math.min(near, Math.abs(ring(i - c.i + n / 2, n) - n / 2));
      const t = clamp((near - 15) / 10, 0, 1);
      return 1 - t * t * (3 - 2 * t);
    });
    for (const c of corners) c.sApex = track.cs[c.i];
    // Perfil del objetivo en la rejilla de distancia, alineado con el eje.
    const turn = track.C.map((_, i) => A.frame(track.C, i).turn);
    const prof = {
      s: Array.from({ length: n + 1 }, (_, i) => track.cs[i]),
      t: Array.from({ length: n + 1 }, (_, i) => sim.t[i]),
      v: Array.from({ length: n + 1 }, (_, i) => sim.v[i % n]),
      a: Array.from({ length: n + 1 }, (_, i) => sim.acc[i % n]),
      lean: Array.from(
        { length: n + 1 },
        (_, i) =>
          ((Math.atan((sim.v[i % n] ** 2 * sim.kappa[i % n]) / G) * 180) /
            Math.PI) *
          turn[i % n],
      ),
      R: Array.from(
        { length: n + 1 },
        (_, i) => 1 / Math.max(1e-6, sim.kappa[i % n]),
      ),
    };
    const grid = toGrid(prof, track.L);
    // La curvatura del eje tiene algo de ruido que a 200 km/h se vería como inclinación en recta:
    // se suaviza en 18 m, igual que se suaviza el giro medido en las vueltas reales.
    grid.lean = movingAvg(grid.lean, 9);
    grid.R = movingAvg(grid.R, 9);
    return {
      rider,
      sim,
      corners,
      mask,
      grid,
      lapTime: sim.lapTime,
      clamped: o.clamped,
    };
  }

  // Remuestrea un perfil {s, t, v, a, lean, R} (s creciente) a la rejilla fija de STEP_M metros.
  function toGrid(p, L) {
    const m = Math.floor(L / STEP_M);
    const out = {
      s: new Float64Array(m + 1),
      t: new Float64Array(m + 1),
      v: new Float64Array(m + 1),
      a: new Float64Array(m + 1),
      lean: new Float64Array(m + 1),
      R: new Float64Array(m + 1),
    };
    let j = 0;
    for (let k = 0; k <= m; k++) {
      const s = Math.min(k * STEP_M, L);
      while (j < p.s.length - 2 && p.s[j + 1] < s) j++;
      const span = p.s[j + 1] - p.s[j];
      const f = span > 0 ? clamp((s - p.s[j]) / span, 0, 1) : 0;
      out.s[k] = s;
      for (const key of ["t", "v", "a", "lean", "R"])
        out[key][k] = p[key][j] + (p[key][j + 1] - p[key][j]) * f;
    }
    return out;
  }

  // ---------- encaje sobre el trazado ----------
  function nearestOn(C, x, y, from, to) {
    const n = C.length;
    let best = Infinity;
    let bi = 0;
    let bf = 0;
    for (let k = from; k <= to; k++) {
      const i = ring(k, n);
      const a = C[i];
      const b = C[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const f = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1);
      const px = a[0] + dx * f;
      const py = a[1] + dy * f;
      const d = Math.hypot(x - px, y - py);
      if (d < best) {
        best = d;
        bi = i;
        bf = f;
      }
    }
    return { i: bi, f: bf, dist: best };
  }

  function matchFixes(track, xs, ys) {
    const n = track.n;
    const out = [];
    let prev = null;
    for (let k = 0; k < xs.length; k++) {
      let m = prev
        ? nearestOn(track.C, xs[k], ys[k], prev.i - 6, prev.i + 45)
        : null;
      if (!m || m.dist > ON_TRACK_M)
        m = nearestOn(track.C, xs[k], ys[k], 0, n - 1);
      const s = track.cs[m.i] + (track.cs[m.i + 1] - track.cs[m.i]) * m.f;
      out.push({ i: m.i, s, dist: m.dist });
      prev = m.dist < ON_TRACK_M ? m : null;
    }
    return out;
  }

  function detectDirection(xs, ys, onIdx) {
    const C = GEO.main;
    const n = C.length;
    let score = 0;
    let prev = null;
    for (const k of onIdx) {
      const m = nearestOn(C, xs[k], ys[k], 0, n - 1);
      if (m.dist > 15) {
        prev = null;
        continue;
      }
      if (prev !== null) {
        const d = ring(m.i - prev + n / 2, n) - n / 2;
        if (Math.abs(d) < n / 4) score += d;
      }
      prev = m.i;
    }
    return score >= 0 ? "osm" : "rev";
  }

  // ---------- utilidades numéricas ----------
  function interpAt(t, ts, vs, j0) {
    let j = j0 || 0;
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const span = ts[j + 1] - ts[j];
    const f = span > 0 ? clamp((t - ts[j]) / span, 0, 1) : 0;
    return { v: vs[j] + (vs[j + 1] - vs[j]) * f, j };
  }

  function resampleTo(grid, ts, vs) {
    const out = new Float64Array(grid.length);
    let j = 0;
    for (let k = 0; k < grid.length; k++) {
      const r = interpAt(grid[k], ts, vs, j);
      out[k] = r.v;
      j = r.j;
    }
    return out;
  }

  function movingAvg(a, w) {
    const n = a.length;
    const out = new Float64Array(n);
    const h = Math.floor(w / 2);
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < Math.min(n, h); i++) {
      sum += a[i];
      cnt++;
    }
    for (let i = 0; i < n; i++) {
      const add = i + h;
      if (add < n) {
        sum += a[add];
        cnt++;
      }
      const rem = i - h - 1;
      if (rem >= 0) {
        sum -= a[rem];
        cnt--;
      }
      out[i] = sum / cnt;
    }
    return out;
  }

  function norm3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function solve3(M, y) {
    const [a, b, c] = M;
    const det =
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    if (Math.abs(det) < 1e-12) return null;
    const rep = (k) =>
      M.map((row, r) => row.map((x, cc) => (cc === k ? y[r] : x)));
    const d = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    return [d(rep(0)) / det, d(rep(1)) / det, d(rep(2)) / det];
  }

  // ---------- inclinación con el giroscopio ----------
  // Ángulo de la moto (+ a derechas) a partir solo del giroscopio del móvil, en sus ejes fijos sobre la moto:
  // f (hacia delante) y u (vertical con la moto derecha). En curva la moto gira alrededor de la vertical del
  // mundo, y vista desde la moto tumbada ese giro se reparte entre su vertical (cos φ) y su eje lateral (sen φ):
  // tan φ = ω·izquierda / ω·vertical. Con giro suave (curva rápida, recta) esa división es ruido, y se usa
  // sen φ = −v·(ω·vertical)/g, que tampoco ve el cabeceo de la horquilla (gira alrededor del eje lateral).
  // La gravedad no sirve en curva (en un giro equilibrado apunta al suelo de la moto), así que solo fija u
  // en recta. Entre medias se integra el balanceo (ω·f). Parado, se aprende el sesgo del giroscopio.
  function LeanEstimator() {
    this.f = null;
    this.u = null;
    this.l = null;
    this.phi = 0;
    this.wu = 0;
    this.wl = 0;
    this.bias = [0, 0, 0];
  }
  LeanEstimator.prototype.setAxes = function (f, u) {
    const uu = norm3(u);
    const fu = dot3(f, uu);
    this.u = uu;
    this.f = norm3([f[0] - fu * uu[0], f[1] - fu * uu[1], f[2] - fu * uu[2]]);
    this.l = cross3(this.u, this.f);
  };
  // w: giro en rad/s en ejes del móvil; v: velocidad en m/s (NaN si no se sabe). Devuelve grados.
  LeanEstimator.prototype.step = function (dt, w0, v) {
    const h = clamp(dt, 0, 0.1);
    const b = this.bias;
    // Parado y quieto: lo que marque el giroscopio es su sesgo.
    if (
      v < 0.3 &&
      Math.hypot(w0[0] - b[0], w0[1] - b[1], w0[2] - b[2]) < 0.08
    ) {
      const kb = 1 - Math.exp(-h / 2);
      for (let i = 0; i < 3; i++) b[i] += (w0[i] - b[i]) * kb;
    }
    if (!this.f) return NaN;
    const w = [w0[0] - b[0], w0[1] - b[1], w0[2] - b[2]];
    const wf = dot3(w, this.f);
    const lp = 1 - Math.exp(-h / 0.15);
    this.wu += (dot3(w, this.u) - this.wu) * lp;
    this.wl += (dot3(w, this.l) - this.wl) * lp;
    this.phi += wf * h;
    const yu = Math.abs(this.wu);
    // Giro claro alrededor de la vertical de la moto: medida directa del ángulo.
    const kr = clamp((yu - 0.1) / 0.2, 0, 1);
    if (kr > 0) {
      const meas = Math.atan2(this.wl * Math.sign(this.wu), yu);
      this.phi += (meas - this.phi) * kr * (1 - Math.exp(-h / 0.3));
    }
    if (kr < 1) {
      // Giro suave: por la velocidad si se sabe; si no, en recta sin giro la moto va derecha.
      if (v > 5) {
        const meas = Math.asin(clamp((-v * this.wu) / G, -0.95, 0.95));
        this.phi += (meas - this.phi) * (1 - kr) * (1 - Math.exp(-h / 0.4));
      } else if (Math.hypot(this.wu, this.wl) < 0.06 && !(v < 3)) {
        this.phi -= this.phi * (1 - Math.exp(-h / 1.0));
      }
    }
    this.phi = clamp(this.phi, -1.3, 1.3);
    return (this.phi * 180) / Math.PI;
  };

  // Vertical de la moto derecha en ejes del móvil: media de la gravedad en recta lanzada sin giro (en caballete
  // lateral la moto está tumbada, así que parado solo vale si no hay rectas).
  function uprightAxis(gx, gy, gz, wx, wy, wz, v, hz) {
    const sums = { straight: [0, 0, 0, 0], still: [0, 0, 0, 0] };
    for (let k = 0; k < gx.length; k++) {
      const key =
        v[k] > 15 && Math.hypot(wx[k], wy[k], wz[k]) < 0.06
          ? "straight"
          : v[k] < 0.5
            ? "still"
            : null;
      if (!key) continue;
      const s = sums[key];
      s[0] += gx[k];
      s[1] += gy[k];
      s[2] += gz[k];
      s[3]++;
    }
    for (const key of ["straight", "still"]) {
      const s = sums[key];
      if (s[3] >= hz * 2) return { u: norm3(s), from: key };
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < gx.length; k++) {
      sx += gx[k];
      sy += gy[k];
      sz += gz[k];
    }
    return { u: norm3([sx, sy, sz]), from: "all" };
  }

  // ---------- análisis ----------
  // Devuelve la tanda procesada: línea de tiempo fusionada, vueltas, métricas por curva y referencia.
  function analyze(session, opts) {
    const o = opts || {};
    const power = o.power || S.MAPS.repro.power;
    const warnings = (session.warnings || []).slice();
    const L0 = session.loc;
    // Fijos válidos del GPS.
    const fixes = [];
    for (let k = 0; k < L0.t.length; k++) {
      const lat = L0.lat[k];
      const lon = L0.lon[k];
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0))
        continue;
      const hacc = L0.hacc ? L0.hacc[k] : 5;
      if (isFinite(hacc) && hacc > 25) continue;
      const [x, y] = toLocal(lat, lon);
      const sp = L0.speed ? L0.speed[k] : NaN;
      fixes.push({
        t: L0.t[k],
        x,
        y,
        speed: isFinite(sp) && sp >= 0 ? sp : NaN,
        hacc: isFinite(hacc) ? hacc : 5,
      });
    }
    if (fixes.length < 30)
      throw new Error("Hay muy pocas posiciones GPS válidas en la grabación.");
    // Velocidad desde posiciones donde el GPS no la dé.
    for (let k = 1; k < fixes.length - 1; k++) {
      if (!isNaN(fixes[k].speed)) continue;
      const a = fixes[k - 1];
      const b = fixes[k + 1];
      fixes[k].speed =
        Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.2, b.t - a.t);
    }
    fixes[0].speed = isNaN(fixes[0].speed) ? 0 : fixes[0].speed;
    fixes[fixes.length - 1].speed = isNaN(fixes[fixes.length - 1].speed)
      ? 0
      : fixes[fixes.length - 1].speed;
    // Cerca del circuito y moviéndose.
    const near = fixes.map(
      (f) => nearestOn(GEO.main, f.x, f.y, 0, GEO.main.length - 1).dist,
    );
    const onIdx = [];
    fixes.forEach((f, k) => {
      if (near[k] < 15 && f.speed > 5) onIdx.push(k);
    });
    if (onIdx.length < 20)
      throw new Error(
        "La grabación no pasa por el circuito de Maspalomas (o el GPS no tenía cobertura).",
      );
    const dir =
      o.dir ||
      detectDirection(
        fixes.map((f) => f.x),
        fixes.map((f) => f.y),
        onIdx,
      );
    const track = buildTrack(dir, o.finish ? o.finish[dir] : 0);
    const matches = matchFixes(
      track,
      fixes.map((f) => f.x),
      fixes.map((f) => f.y),
    );
    fixes.forEach((f, k) => {
      f.s = matches[k].s;
      f.idx = matches[k].i;
      f.on = matches[k].dist < ON_TRACK_M && f.speed > 4;
    });

    const hasImu = !!(session.acc && session.gyro && session.grav);
    // Rejilla de tiempo común.
    const tStart = Math.max(
      fixes[0].t,
      hasImu
        ? Math.max(session.acc.t[0], session.gyro.t[0], session.grav.t[0])
        : -Infinity,
    );
    const tEnd = Math.min(
      fixes[fixes.length - 1].t,
      hasImu
        ? Math.min(
            session.acc.t[session.acc.t.length - 1],
            session.gyro.t[session.gyro.t.length - 1],
            session.grav.t[session.grav.t.length - 1],
          )
        : Infinity,
    );
    const hz = hasImu ? GRID_HZ : 10;
    const m = Math.max(2, Math.floor((tEnd - tStart) * hz));
    const tg = new Float64Array(m);
    for (let k = 0; k < m; k++) tg[k] = tStart + k / hz;
    const ft = fixes.map((f) => f.t);
    const fv = fixes.map((f) => f.speed);

    let aLong;
    let yaw; // rad/s, + giro a derechas
    let lag = 0;
    let fit = null;
    let gyroW = null;
    let axes = null;
    if (hasImu) {
      // Remuestreo a 50 Hz y filtrado: la vibración del motor se va con medias de 0,3 s (acelerómetro).
      const ax = movingAvg(resampleTo(tg, session.acc.t, session.acc.x), 15);
      const ay = movingAvg(resampleTo(tg, session.acc.t, session.acc.y), 15);
      const az = movingAvg(resampleTo(tg, session.acc.t, session.acc.z), 15);
      const wx = movingAvg(resampleTo(tg, session.gyro.t, session.gyro.x), 8);
      const wy = movingAvg(resampleTo(tg, session.gyro.t, session.gyro.y), 8);
      const wz = movingAvg(resampleTo(tg, session.gyro.t, session.gyro.z), 8);
      const gx = movingAvg(resampleTo(tg, session.grav.t, session.grav.x), 25);
      const gy = movingAvg(resampleTo(tg, session.grav.t, session.grav.y), 25);
      const gz = movingAvg(resampleTo(tg, session.grav.t, session.grav.z), 25);
      // Vertical de la moto recta: media de la gravedad en recta (sin giro) o, si no hay, parado.
      const vg = resampleTo(tg, ft, fv);
      const upright = uprightAxis(gx, gy, gz, wx, wy, wz, vg, hz);
      if (upright.from === "all")
        warnings.push(
          "No hay tramos parados ni rectos claros para calibrar: la inclinación puede ir algo desviada.",
        );
      const u0 = upright.u;
      gyroW = [wx, wy, wz];
      // Eje longitudinal: el que mejor explica la aceleración que mide el GPS (con su retardo).
      const fitAt = (lagS) => {
        const M = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        const yv = [0, 0, 0];
        let yy = 0;
        let used = 0;
        const samples = [];
        for (let k = 1; k < fixes.length - 1; k++) {
          const a = fixes[k - 1];
          const b = fixes[k + 1];
          if (!fixes[k].on || b.t - a.t > 3 || isNaN(a.speed) || isNaN(b.speed))
            continue;
          const ta = a.t - lagS;
          const tb = b.t - lagS;
          if (ta < tStart || tb > tEnd) continue;
          const ka = Math.floor((ta - tStart) * hz);
          const kb = Math.floor((tb - tStart) * hz);
          if (kb - ka < 2) continue;
          let mx = 0;
          let my = 0;
          let mz = 0;
          for (let q = ka; q < kb; q++) {
            mx += ax[q];
            my += ay[q];
            mz += az[q];
          }
          const c = kb - ka;
          const X = [mx / c, my / c, mz / c];
          const Y = (b.speed - a.speed) / (b.t - a.t);
          for (let r = 0; r < 3; r++) {
            for (let cc = 0; cc < 3; cc++) M[r][cc] += X[r] * X[cc];
            yv[r] += X[r] * Y;
          }
          yy += Y * Y;
          used++;
          samples.push([X, Y]);
        }
        const w = used > 20 ? solve3(M, yv) : null;
        if (!w) return null;
        let res = 0;
        for (const [X, Y] of samples) res += (Y - dot3(w, X)) ** 2;
        return { w, r2: 1 - res / (yy || 1), used };
      };
      let best = null;
      for (let l = -1.0; l <= 1.0001; l += 0.1) {
        const r = fitAt(l);
        if (r && (!best || r.r2 > best.r2)) best = Object.assign(r, { lag: l });
      }
      if (!best)
        throw new Error(
          "No he podido orientar el móvil respecto a la moto: ¿iba bien sujeto?",
        );
      lag = best.lag;
      fit = best;
      if (best.r2 < 0.5)
        warnings.push(
          "La aceleración del móvil casi no cuadra con la del GPS: ¿iba suelto en la bolsa? Las frenadas pueden salir mal.",
        );
      const wv = best.w;
      const f = norm3([
        wv[0] - dot3(wv, u0) * u0[0],
        wv[1] - dot3(wv, u0) * u0[1],
        wv[2] - dot3(wv, u0) * u0[2],
      ]);
      axes = { f, u: u0, upFrom: upright.from };
      aLong = new Float64Array(m);
      yaw = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        aLong[k] = ax[k] * f[0] + ay[k] * f[1] + az[k] * f[2];
        const w = [wx[k], wy[k], wz[k]];
        const wf = dot3(w, f);
        const perp = [w[0] - wf * f[0], w[1] - wf * f[1], w[2] - wf * f[2]];
        // Giro alrededor de la vertical del mundo: + a izquierdas (regla de la mano derecha con la vertical arriba).
        yaw[k] =
          -Math.sign(dot3(w, u0)) * Math.hypot(perp[0], perp[1], perp[2]);
      }
      // Comprobación del signo con el rumbo GPS: + debe ser giro a derechas.
      let corr = 0;
      for (let k = 1; k < fixes.length - 1; k++) {
        if (!fixes[k].on) continue;
        const a = fixes[k - 1];
        const b = fixes[k + 1];
        const h1 = Math.atan2(fixes[k].y - a.y, fixes[k].x - a.x);
        const h2 = Math.atan2(b.y - fixes[k].y, b.x - fixes[k].x);
        let dh = h2 - h1;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        const kk = Math.floor((fixes[k].t - lag - tStart) * hz);
        if (kk >= 0 && kk < m) corr += dh * yaw[kk];
      }
      // En coordenadas de pantalla (y hacia el sur) un giro a derechas aumenta el ángulo.
      if (corr < 0) for (let k = 0; k < m; k++) yaw[k] = -yaw[k];
    }

    // Velocidad fusionada: Kalman (velocidad, sesgo) con la aceleración y suavizado hacia atrás.
    const gpsT = fixes.map((f) => f.t - lag);
    let v;
    if (hasImu) {
      v = kalmanSpeed(tg, aLong, gpsT, fv, hz);
    } else {
      v = movingAvg(resampleTo(tg, gpsT, fv), 7);
      aLong = new Float64Array(m);
      for (let k = 1; k < m - 1; k++)
        aLong[k] = ((v[k + 1] - v[k - 1]) * hz) / 2;
      aLong = movingAvg(aLong, 7);
      yaw = new Float64Array(m);
      const ss = resampleTo(
        tg,
        gpsT,
        fixes.map((f) => f.idx),
      );
      for (let k = 1; k < m - 1; k++) {
        const i = ring(Math.round(ss[k]), track.n);
        const fr = A.frame(track.C, i);
        yaw[k] = fr.turn * v[k] * curvAt(track, i);
      }
    }

    // Distancia sobre el trazado: integral de la velocidad corregida con el encaje GPS, por tramos en pista.
    const segs = segmentsOnTrack(fixes, gpsT, track.L);
    const sF = new Float64Array(m).fill(NaN);
    for (const seg of segs)
      fuseDistance(seg, fixes, gpsT, tg, v, sF, track.L, hz);

    // Inclinación: con giroscopio, la que mide el móvil (ángulo real de la moto); sin él, por física
    // (v·giro/g). Radio de la trazada con el giro suavizado medio segundo para que un pico de ruido
    // no pase por inclinación máxima.
    const yawS = movingAvg(yaw, Math.round(hz / 2));
    const lean = new Float64Array(m);
    const R = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      lean[k] = (Math.atan((v[k] * yawS[k]) / G) * 180) / Math.PI;
      R[k] = Math.abs(yawS[k]) > 0.02 ? v[k] / Math.abs(yawS[k]) : Infinity;
    }
    let leanFrom = "física";
    if (axes && gyroW) {
      const est = new LeanEstimator();
      est.setAxes(axes.f, axes.u);
      const [wx, wy, wz] = gyroW;
      for (let k = 0; k < m; k++)
        lean[k] = est.step(1 / hz, [wx[k], wy[k], wz[k]], v[k]);
      leanFrom = "giroscopio";
      // Lado: el giro ya está comprobado con el rumbo del GPS (+ a derechas); si la inclinación va al revés,
      // el móvil da los sensores con el signo cambiado (pasa en iPhone).
      let agree = 0;
      for (let k = 0; k < m; k++) agree += lean[k] * yawS[k];
      if (agree < 0) for (let k = 0; k < m; k++) lean[k] = -lean[k];
    }

    const ref = reference(track, o.target || 65.0, power);
    const laps = cutLaps(tg, sF, v, aLong, lean, R, track, segs, hz);
    for (const lap of laps) {
      lap.corners = cornerMetrics(lap.grid, ref.corners, track);
      // Máximos de la vuelta: inclinación (a cualquier lado, grados) y velocidad punta (km/h).
      let lm = 0;
      let vm = 0;
      for (let i = 0; i < lap.grid.v.length; i++) {
        const l = Math.abs(lap.grid.lean[i]);
        if (l > lm) lm = l;
        if (lap.grid.v[i] > vm) vm = lap.grid.v[i];
      }
      lap.leanMax = lm;
      lap.vMax = vm * 3.6;
    }
    const refCorners = cornerMetrics(ref.grid, ref.corners, track);
    const sectorsRef = sectorTimes(ref.grid, ref.corners, track);
    for (const lap of laps)
      lap.sectors = sectorTimes(lap.grid, ref.corners, track);
    const valid = laps.filter((l) => l.valid);
    const best = valid.length
      ? valid.reduce((a, b) => (a.time <= b.time ? a : b))
      : null;
    const ideal = valid.length
      ? ref.corners.map((_, k) => Math.min(...valid.map((l) => l.sectors[k])))
      : null;
    return {
      dir,
      track,
      hasImu,
      lag,
      fit: fit ? { r2: fit.r2, used: fit.used } : null,
      axes,
      leanFrom,
      warnings,
      timeline: { t: tg, v, a: aLong, lean, s: sF },
      fixes,
      laps,
      best,
      ideal: ideal ? ideal.reduce((x, y) => x + y, 0) : null,
      idealSectors: ideal,
      ref: {
        lapTime: ref.lapTime,
        grid: ref.grid,
        corners: ref.corners,
        metrics: refCorners,
        sectors: sectorsRef,
        rider: ref.rider,
        clamped: ref.clamped,
      },
    };
  }

  function curvAt(track, i) {
    const n = track.n;
    const a = track.C[ring(i - 3, n)];
    const b = track.C[i];
    const c = track.C[ring(i + 3, n)];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cr = Math.abs(
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    );
    return ab * bc * ca > 0 ? (2 * cr) / (ab * bc * ca) : 0;
  }

  function kalmanSpeed(tg, a, gpsT, gpsV, hz) {
    const m = tg.length;
    const dt = 1 / hz;
    const qa = (0.9 * dt) ** 2;
    const qb = 0.003 ** 2;
    const Rm = 0.3 ** 2;
    const xs = new Float64Array(m * 2);
    const Ps = new Float64Array(m * 4);
    const xp = new Float64Array(m * 2);
    const Pp = new Float64Array(m * 4);
    let x0 = gpsV.find((s) => !isNaN(s)) || 0;
    let x1 = 0;
    let P = [4, 0, 0, 0.25];
    let g = 0;
    for (let k = 0; k < m; k++) {
      // Predicción: v += (a - b)·dt.
      if (k > 0) {
        x0 = x0 + (a[k - 1] - x1) * dt;
        const p00 = P[0] - dt * (P[2] + P[1]) + dt * dt * P[3] + qa;
        const p01 = P[1] - dt * P[3];
        const p10 = P[2] - dt * P[3];
        const p11 = P[3] + qb;
        P = [p00, p01, p10, p11];
      }
      xp[2 * k] = x0;
      xp[2 * k + 1] = x1;
      Pp.set(P, 4 * k);
      // Corrección con cada velocidad GPS que cae en este paso.
      while (g < gpsT.length && gpsT[g] < tg[k] + dt / 2) {
        if (gpsT[g] >= tg[k] - dt / 2 && !isNaN(gpsV[g])) {
          const y = gpsV[g] - x0;
          const Sv = P[0] + Rm;
          const K0 = P[0] / Sv;
          const K1 = P[2] / Sv;
          x0 += K0 * y;
          x1 += K1 * y;
          P = [
            (1 - K0) * P[0],
            (1 - K0) * P[1],
            P[2] - K1 * P[0],
            P[3] - K1 * P[1],
          ];
        }
        g++;
      }
      xs[2 * k] = x0;
      xs[2 * k + 1] = x1;
      Ps.set(P, 4 * k);
    }
    // Suavizado Rauch-Tung-Striebel hacia atrás.
    const v = new Float64Array(m);
    let sx0 = xs[2 * (m - 1)];
    let sx1 = xs[2 * (m - 1) + 1];
    v[m - 1] = sx0;
    for (let k = m - 2; k >= 0; k--) {
      const P0 = Ps.subarray(4 * k, 4 * k + 4);
      const Pn = Pp.subarray(4 * (k + 1), 4 * (k + 1) + 4);
      // F = [[1, -dt], [0, 1]]; C = P·Fᵀ·Pn⁻¹
      const PF00 = P0[0] - dt * P0[1];
      const PF01 = P0[1];
      const PF10 = P0[2] - dt * P0[3];
      const PF11 = P0[3];
      const det = Pn[0] * Pn[3] - Pn[1] * Pn[2] || 1e-12;
      const i00 = Pn[3] / det;
      const i01 = -Pn[1] / det;
      const i10 = -Pn[2] / det;
      const i11 = Pn[0] / det;
      const C00 = PF00 * i00 + PF01 * i10;
      const C01 = PF00 * i01 + PF01 * i11;
      const C10 = PF10 * i00 + PF11 * i10;
      const C11 = PF10 * i01 + PF11 * i11;
      const d0 = sx0 - xp[2 * (k + 1)];
      const d1 = sx1 - xp[2 * (k + 1) + 1];
      const n0 = xs[2 * k] + C00 * d0 + C01 * d1;
      const n1 = xs[2 * k + 1] + C10 * d0 + C11 * d1;
      sx0 = n0;
      sx1 = n1;
      v[k] = Math.max(0, sx0);
    }
    return v;
  }

  // Tramos continuos en pista (sin cortes de GPS de más de 3 s).
  // Tramos seguidos en pista. Un fijo suelto fuera del trazado, o con un salto sobre él que no cuadra con la
  // velocidad (rebote del GPS, más frecuente en móviles de una sola frecuencia), se ignora; el tramo solo se
  // corta si pasan más de 3 s sin un fijo bueno.
  function segmentsOnTrack(fixes, gpsT, L) {
    const segs = [];
    let cur = null;
    let last = -1;
    const close = () => {
      if (cur && cur.idx.length > 10) segs.push(cur);
      cur = null;
    };
    for (let k = 0; k < fixes.length; k++) {
      const f = fixes[k];
      if (!f.on) continue;
      if (cur && gpsT[k] - gpsT[last] > 3) close();
      if (cur) {
        const p = fixes[last];
        const dt = gpsT[k] - gpsT[last];
        let ds = f.s - p.s;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        const expected = ((f.speed + p.speed) / 2) * dt;
        if (Math.abs(ds - expected) > 25 + 10 * dt) {
          f.outlier = true;
          continue;
        }
      }
      if (!cur) cur = { a: k, b: k, idx: [] };
      cur.idx.push(k);
      cur.b = k;
      last = k;
    }
    close();
    return segs;
  }

  function fuseDistance(seg, fixes, gpsT, tg, v, sF, L, hz) {
    // Distancia encajada desenrollada (vueltas sumadas), solo con los fijos buenos del tramo.
    const sm = [];
    let laps = 0;
    let prev = null;
    for (const k of seg.idx) {
      let s = fixes[k].s;
      if (prev !== null) {
        if (s - prev < -L / 2) laps++;
        else if (s - prev > L / 2) laps--;
      }
      prev = s;
      sm.push({ t: gpsT[k], s: s + laps * L });
    }
    const ka = Math.max(0, Math.ceil((sm[0].t - tg[0]) * hz));
    const kb = Math.min(
      tg.length - 1,
      Math.floor((sm[sm.length - 1].t - tg[0]) * hz),
    );
    if (kb <= ka) return;
    // Integral de la velocidad.
    const integ = new Float64Array(kb - ka + 1);
    for (let k = ka + 1; k <= kb; k++)
      integ[k - ka] =
        integ[k - ka - 1] + ((v[k] + v[k - 1]) / 2) * (tg[k] - tg[k - 1]);
    // Residuo encaje − integral en cada fijo, suavizado, y corrección interpolada.
    const resT = [];
    const resV = [];
    for (const p of sm) {
      const kk = (p.t - tg[ka]) * hz;
      if (kk < 0 || kk > kb - ka) continue;
      const k0 = Math.floor(kk);
      const fr = kk - k0;
      const iv =
        integ[k0] + (integ[Math.min(k0 + 1, kb - ka)] - integ[k0]) * fr;
      resT.push(p.t);
      resV.push(p.s - iv);
    }
    const resS = movingAvg(Float64Array.from(resV), 7);
    let j = 0;
    for (let k = ka; k <= kb; k++) {
      const r = interpAt(tg[k], resT, resS, j);
      j = r.j;
      sF[k] = integ[k - ka] + r.v;
    }
    // Monótona (la moto no va hacia atrás).
    for (let k = ka + 1; k <= kb; k++) if (sF[k] < sF[k - 1]) sF[k] = sF[k - 1];
  }

  function cutLaps(tg, sF, v, a, lean, R, track, segs, hz) {
    const L = track.L;
    const laps = [];
    // Cruces de meta: sF pasa por un múltiplo de L.
    const crosses = [];
    for (let k = 1; k < tg.length; k++) {
      if (isNaN(sF[k]) || isNaN(sF[k - 1])) continue;
      const m0 = Math.floor(sF[k - 1] / L);
      const m1 = Math.floor(sF[k] / L);
      if (m1 > m0) {
        const target = m1 * L;
        const fr = (target - sF[k - 1]) / (sF[k] - sF[k - 1] || 1);
        crosses.push({ k, t: tg[k - 1] + fr / hz, m: m1 });
      }
    }
    for (let c = 0; c + 1 < crosses.length; c++) {
      const A0 = crosses[c];
      const B0 = crosses[c + 1];
      if (B0.m !== A0.m + 1) continue;
      let gap = false;
      for (let k = A0.k; k < B0.k; k++) if (isNaN(sF[k])) gap = true;
      if (gap) continue;
      const time = B0.t - A0.t;
      // Perfil de esta vuelta en función de la distancia.
      const p = { s: [], t: [], v: [], a: [], lean: [], R: [] };
      for (let k = A0.k - 1; k <= B0.k; k++) {
        p.s.push(sF[k] - A0.m * L);
        p.t.push(tg[k] - A0.t);
        p.v.push(v[k]);
        p.a.push(a[k]);
        p.lean.push(lean[k]);
        p.R.push(Math.min(R[k], 5000));
      }
      const grid = toGrid(p, L);
      laps.push({
        num: laps.length + 1,
        time,
        t0: A0.t,
        grid,
        valid: time > 45 && time < 150,
      });
    }
    return laps;
  }

  // ---------- métricas por horquilla ----------
  function idxOf(grid, s, L) {
    const m = grid.s.length - 1;
    return clamp(Math.round(ring(s, L) / STEP_M), 0, m);
  }

  function cornerMetrics(grid, corners, track) {
    const L = track.L;
    const m = grid.s.length - 1;
    const at = (s) => idxOf(grid, s, L);
    const valAt = (key, s) => grid[key][at(s)];
    return corners.map((c) => {
      const sa = c.sApex;
      // Punto más lento cerca del vértice.
      let iMin = at(sa);
      for (let d = -50; d <= 50; d += STEP_M) {
        const i = at(sa + d);
        if (grid.v[i] < grid.v[iMin]) iMin = i;
      }
      const sMin = grid.s[iMin];
      const rel = (s) => {
        let d = s - sa;
        if (d > L / 2) d -= L;
        if (d < -L / 2) d += L;
        return d;
      };
      // Frenada: hacia atrás desde el más lento hasta encontrar frenada fuerte y luego su inicio.
      let k = 0;
      let deep = null;
      for (k = 0; k < 140; k++) {
        const s = sMin - k * STEP_M;
        if (valAt("a", s) < -0.3 * G) {
          deep = s;
          break;
        }
      }
      let brakeS = null;
      let peak = 0;
      if (deep !== null) {
        let s = deep;
        for (let q = 0; q < 160; q++) {
          if (valAt("a", s - STEP_M) > -0.12 * G) break;
          s -= STEP_M;
        }
        brakeS = s;
        for (let q = 0; q * STEP_M <= ring(sMin - brakeS, L); q++)
          peak = Math.min(peak, valAt("a", brakeS + q * STEP_M));
      }
      // Fin de la frenada y primer gas de verdad.
      let brakeEnd = null;
      let throttle = null;
      if (deep !== null) {
        let s = deep;
        for (let q = 0; q < 120 && valAt("a", s) < -0.15 * G; q++) s += STEP_M;
        brakeEnd = s;
        for (let q = 0; q < 150; q++) {
          const ss = brakeEnd + q * STEP_M;
          if (
            valAt("a", ss) > 0.12 * G &&
            valAt("a", ss + STEP_M) > 0.12 * G &&
            valAt("a", ss + 2 * STEP_M) > 0.12 * G
          ) {
            throttle = ss;
            break;
          }
        }
      }
      let full = null;
      for (let q = 0; q < 120; q++) {
        const ss = sMin + q * STEP_M;
        if (valAt("a", ss) > 0.3 * G && valAt("a", ss + STEP_M) > 0.3 * G) {
          full = ss;
          break;
        }
      }
      const tOf = (s) => {
        const i = at(s);
        return grid.t[i];
      };
      // Tiempo muerto: de soltar el freno al primer gas que acelera de verdad. Si el tramo cruza la
      // línea de meta, la diferencia sale negativa y se le suma la vuelta.
      let dead = null;
      if (brakeEnd !== null && throttle !== null) {
        const dt = tOf(throttle) - tOf(brakeEnd);
        dead = Math.max(0, dt < 0 ? dt + (grid.t[m] - grid.t[0]) : dt);
      }
      let leanMax = 0;
      for (let d = -60; d <= 60; d += STEP_M) {
        const l = Math.abs(valAt("lean", sa + d));
        if (l > leanMax) leanMax = l;
      }
      const rs = [];
      for (let d = -6; d <= 6; d += STEP_M) rs.push(valAt("R", sMin + d));
      rs.sort((x, y) => x - y);
      return {
        name: c.name,
        num: c.num,
        brakeBefore: brakeS !== null ? -rel(brakeS) : null,
        peakG: deep !== null ? -peak / G : null,
        vMin: grid.v[iMin] * 3.6,
        minAt: rel(sMin),
        dead,
        fullAfter: full !== null ? rel(full) : null,
        vExit: valAt("v", sa + 60) * 3.6,
        leanMax,
        radius: rs[Math.floor(rs.length / 2)],
      };
    });
  }

  // Tiempos por sector: cada sector va de la mitad de la recta anterior a la mitad de la siguiente.
  function sectorBounds(corners, L) {
    const ss = corners.map((c) => c.sApex).sort((a, b) => a - b);
    return ss.map((s, k) => {
      const prev = ss[(k - 1 + ss.length) % ss.length];
      let mid = (prev + s) / 2;
      if (k === 0) mid = ((prev - L + s) / 2 + L) % L;
      return mid;
    });
  }

  function sectorTimes(grid, corners, track) {
    const L = track.L;
    const bounds = sectorBounds(corners, L);
    const m = grid.s.length - 1;
    const tAt = (s) => grid.t[idxOf(grid, s, L)];
    const total = grid.t[m] - grid.t[0];
    const order = corners.map((c) => c.sApex);
    const sortedApex = order.slice().sort((a, b) => a - b);
    return corners.map((c) => {
      const k = sortedApex.indexOf(c.sApex);
      const a = bounds[k];
      const b = bounds[(k + 1) % bounds.length];
      let d = tAt(b) - tAt(a);
      if (d < 0) d += total;
      return d;
    });
  }

  // ---------- puntos de mejora ----------
  // Puntos de mejora por curva frente a una referencia (tu mejor vuelta o el objetivo del modelo).
  // Cada diferencia se puntúa contra un umbral; salen las que lo superan, y si ninguna lo hace, la mayor.
  function insights(lap, refMetrics, refSectors, labels) {
    const n1 = (x, d) => x.toFixed(d).replace(".", ",");
    const out = [];
    lap.corners.forEach((c, k) => {
      const r = refMetrics[k];
      const loss = lap.sectors[k] - refSectors[k];
      const cand = [];
      const add = (pillar, dev, thr, text) => {
        if (dev > 0) cand.push({ pillar, sev: dev / thr, text });
      };
      if (c.brakeBefore !== null && r.brakeBefore !== null) {
        const d = c.brakeBefore - r.brakeBefore;
        add(3, d, 6, "frenas " + Math.round(d) + " m antes que " + labels.ref);
      }
      if (c.peakG !== null && r.peakG !== null) {
        add(
          3,
          r.peakG - c.peakG,
          0.06,
          "deceleras con " +
            n1(c.peakG, 2) +
            " g y " +
            labels.ref +
            " con " +
            n1(r.peakG, 2) +
            " g",
        );
      }
      if (c.dead !== null && r.dead !== null) {
        add(
          2,
          c.dead - r.dead,
          0.2,
          n1(c.dead - r.dead, 1) +
            " s más de tiempo muerto entre soltar el freno y abrir gas",
        );
      }
      if (c.fullAfter !== null && r.fullAfter !== null) {
        add(
          1,
          c.fullAfter - r.fullAfter,
          5,
          "abres a fondo " +
            Math.round(c.fullAfter - r.fullAfter) +
            " m más tarde",
        );
      }
      add(
        1,
        r.vExit - c.vExit,
        2,
        "sales " +
          Math.round(r.vExit - c.vExit) +
          " km/h más lento (60 m después del vértice)",
      );
      if (isFinite(c.radius) && isFinite(r.radius) && r.radius > 0) {
        add(
          4,
          (r.radius - c.radius) / r.radius,
          0.08,
          "radio en el vértice de " +
            Math.round(c.radius) +
            " m frente a " +
            Math.round(r.radius) +
            " m: usa más ancho",
        );
      }
      add(
        3,
        r.leanMax - c.leanMax,
        3,
        "tumbas " +
          Math.round(c.leanMax) +
          "° frente a " +
          Math.round(r.leanMax) +
          "°",
      );
      cand.sort((a, b) => b.sev - a.sev);
      let tips = cand.filter((t) => t.sev >= 1);
      if (!tips.length && cand.length && cand[0].sev >= 0.5) tips = [cand[0]];
      out.push({ corner: c, loss, tips: tips.slice(0, 3) });
    });
    out.sort((a, b) => b.loss - a.loss);
    return out;
  }

  // ---------- tanda de ejemplo ----------
  function gauss(rand) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // Genera una grabación como la de Sensor Logger: parado 8 s, vuelta de salida y vueltas lanzadas.
  function demoSession(opts) {
    const o = opts || {};
    const rand = rng(o.seed || 7);
    const power = o.power || S.MAPS.repro.power;
    const track = buildTrack("osm");
    const ref = reference(track, 65.0, power);
    const n = track.n;
    // Nivel de 1:08–1:10 como el tuyo: vuelta de salida, cinco lanzadas que varían y vuelta de entrada.
    const plan = o.laps || [
      { conf: 0.12, coast: 1.6, exit: 0.3, width: 0.5 },
      { conf: 0.29, coast: 1.3, exit: 0.45, width: 0.6 },
      { conf: 0.31, coast: 1.2, exit: 0.5, width: 0.6 },
      { conf: 0.33, coast: 1.0, exit: 0.55, width: 0.65 },
      { conf: 0.3, coast: 1.4, exit: 0.4, width: 0.55 },
      { conf: 0.34, coast: 0.9, exit: 0.6, width: 0.7 },
      { conf: 0.15, coast: 1.5, exit: 0.3, width: 0.5 },
    ];
    // Concatenar vueltas punto a punto.
    const X = [];
    const Y = [];
    const V = [];
    const truth = [];
    for (const p of plan) {
      const line = lineWithWidth(track, p.width, ref.mask);
      const sim = S.simulate(line, S.riderFrom(p), { power });
      truth.push(sim.lapTime);
      for (let i = 0; i < n; i++) {
        X.push(line[i][0]);
        Y.push(line[i][1]);
        V.push(sim.v[i]);
      }
    }
    X.push(X[0]);
    Y.push(Y[0]);
    V.push(V[V.length - 1]);
    // Arranque desde parado y empalmes suaves entre vueltas.
    const N = X.length;
    const ds = new Float64Array(N);
    for (let i = 0; i < N - 1; i++)
      ds[i] = Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]);
    let vStart = 0;
    for (let i = 0; i < N && V[i] > vStart; i++) {
      V[i] = vStart;
      vStart = Math.sqrt(vStart * vStart + 2 * 6.5 * ds[i]);
    }
    for (let lp = 1; lp < plan.length; lp++) {
      const j = lp * n;
      const dv = V[j - 1] - V[j];
      for (let q = 0; q < 25; q++) V[j + q] += dv * (1 - q / 25);
    }
    V[N - 1] = Math.max(0, V[N - 2]);
    const T = new Float64Array(N);
    const still = 8;
    T[0] = still;
    for (let i = 0; i < N - 1; i++)
      T[i + 1] = T[i] + ds[i] / Math.max(0.5, (V[i] + V[i + 1]) / 2);
    // Curvatura con signo (+ derechas en pantalla) y rumbo.
    const KS = new Float64Array(N);
    const PSI = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = [X[Math.max(0, i - 3)], Y[Math.max(0, i - 3)]];
      const b = [X[i], Y[i]];
      const c = [X[Math.min(N - 1, i + 3)], Y[Math.min(N - 1, i + 3)]];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      KS[i] = ab * bc * ca > 1e-9 ? (2 * cr) / (ab * bc * ca) : 0;
      PSI[i] = Math.atan2(-(c[1] - a[1]), c[0] - a[0]);
    }
    const KSs = movingAvg(KS, 9);
    const tEnd = T[N - 1] + 3;
    // Muestreo de la trayectoria verdadera en cualquier instante.
    let jj = 0;
    const stateAt = (t) => {
      if (t <= T[0]) return { x: X[0], y: Y[0], v: 0, a: 0, k: 0, psi: PSI[0] };
      if (t >= T[N - 1])
        return { x: X[N - 1], y: Y[N - 1], v: 0, a: 0, k: 0, psi: PSI[N - 1] };
      while (jj > 0 && T[jj] > t) jj--;
      while (jj < N - 2 && T[jj + 1] < t) jj++;
      const f = (t - T[jj]) / (T[jj + 1] - T[jj] || 1);
      const v = V[jj] + (V[jj + 1] - V[jj]) * f;
      const a =
        ds[jj] > 0 ? (V[jj + 1] * V[jj + 1] - V[jj] * V[jj]) / (2 * ds[jj]) : 0;
      // Curvatura y rumbo continuos entre vértices: una moto no cambia de inclinación a saltos.
      let dpsi = PSI[jj + 1] - PSI[jj];
      if (dpsi > Math.PI) dpsi -= 2 * Math.PI;
      if (dpsi < -Math.PI) dpsi += 2 * Math.PI;
      return {
        x: X[jj] + (X[jj + 1] - X[jj]) * f,
        y: Y[jj] + (Y[jj + 1] - Y[jj]) * f,
        v,
        a,
        k: KSs[jj] + (KSs[jj + 1] - KSs[jj]) * f,
        psi: PSI[jj] + dpsi * f,
      };
    };
    // Sensores del móvil (Android): móvil en bolsa sobre el depósito, pantalla arriba inclinada 25° hacia el piloto.
    const hz = 100;
    const cnt = Math.floor(tEnd * hz);
    const acc = {
      t: new Float64Array(cnt),
      x: new Float64Array(cnt),
      y: new Float64Array(cnt),
      z: new Float64Array(cnt),
    };
    const gyro = {
      t: new Float64Array(cnt),
      x: new Float64Array(cnt),
      y: new Float64Array(cnt),
      z: new Float64Array(cnt),
    };
    const grav = {
      t: new Float64Array(cnt),
      x: new Float64Array(cnt),
      y: new Float64Array(cnt),
      z: new Float64Array(cnt),
    };
    const tilt = (25 * Math.PI) / 180;
    // Giroscopio real: un pequeño sesgo por eje y el cabeceo de la horquilla al frenar (unos 4° por g,
    // con 0,15 s de retraso), que gira la moto alrededor de su eje lateral.
    const bias = [0.006, -0.004, 0.008];
    let prevLean = 0;
    let pitch = 0;
    let prevPitch = 0;
    for (let q = 0; q < cnt; q++) {
      const t = q / hz;
      const st = stateAt(t);
      const lean = Math.atan((st.v * st.v * st.k) / G);
      const dLean = q ? (lean - prevLean) * hz : 0;
      prevLean = lean;
      const pitchTarget = (clamp(-st.a / G, -0.6, 1.3) * 4 * Math.PI) / 180;
      pitch += (pitchTarget - pitch) * (1 - Math.exp(-1 / hz / 0.15));
      const dPitch = q ? (pitch - prevPitch) * hz : 0;
      prevPitch = pitch;
      const yawRate = -st.v * st.k;
      const f = [Math.cos(st.psi), Math.sin(st.psi), 0];
      const r = [Math.sin(st.psi), -Math.cos(st.psi), 0];
      const Z = [0, 0, 1];
      const ub = [
        Math.cos(lean) * Z[0] + Math.sin(lean) * r[0],
        Math.cos(lean) * Z[1] + Math.sin(lean) * r[1],
        Math.cos(lean),
      ];
      const rb = [
        Math.cos(lean) * r[0] - Math.sin(lean) * Z[0],
        Math.cos(lean) * r[1] - Math.sin(lean) * Z[1],
        -Math.sin(lean),
      ];
      const xp = rb;
      const yp = [
        Math.cos(tilt) * f[0] + Math.sin(tilt) * ub[0],
        Math.cos(tilt) * f[1] + Math.sin(tilt) * ub[1],
        Math.cos(tilt) * f[2] + Math.sin(tilt) * ub[2],
      ];
      const zp = [
        Math.cos(tilt) * ub[0] - Math.sin(tilt) * f[0],
        Math.cos(tilt) * ub[1] - Math.sin(tilt) * f[1],
        Math.cos(tilt) * ub[2] - Math.sin(tilt) * f[2],
      ];
      const aw = [
        st.a * f[0] + st.v * st.v * st.k * r[0],
        st.a * f[1] + st.v * st.v * st.k * r[1],
        0,
      ];
      const gw = [0, 0, G];
      // Morro abajo = giro positivo alrededor del eje izquierdo de la moto (−rb).
      const ww = [
        dLean * f[0] - dPitch * rb[0],
        dLean * f[1] - dPitch * rb[1],
        yawRate + dLean * f[2] - dPitch * rb[2],
      ];
      const vib = st.v > 1 ? 1.2 : 0.05;
      const P = (vec) => [dot3(vec, xp), dot3(vec, yp), dot3(vec, zp)];
      const A1 = P(aw);
      const G1 = P(gw);
      const W1 = P(ww);
      acc.t[q] = gyro.t[q] = grav.t[q] = t;
      acc.x[q] = A1[0] + vib * gauss(rand);
      acc.y[q] = A1[1] + vib * gauss(rand);
      acc.z[q] = A1[2] + vib * gauss(rand);
      gyro.x[q] = W1[0] + bias[0] + 0.03 * gauss(rand);
      gyro.y[q] = W1[1] + bias[1] + 0.03 * gauss(rand);
      gyro.z[q] = W1[2] + bias[2] + 0.03 * gauss(rand);
      grav.x[q] = G1[0] + 0.03 * gauss(rand);
      grav.y[q] = G1[1] + 0.03 * gauss(rand);
      grav.z[q] = G1[2] + 0.03 * gauss(rand);
    }
    // GPS a 1 Hz, con 0,25 s de retardo y unos 2 m de error.
    const gn = Math.floor(tEnd);
    const loc = {
      t: new Float64Array(gn),
      lat: new Float64Array(gn),
      lon: new Float64Array(gn),
      speed: new Float64Array(gn),
      hacc: new Float64Array(gn),
      bearing: null,
    };
    for (let q = 0; q < gn; q++) {
      const t = q + 0.5;
      const st = stateAt(t - 0.25);
      const [lat, lon] = toLatLon(
        st.x + 1.6 * gauss(rand),
        st.y + 1.6 * gauss(rand),
      );
      loc.t[q] = t;
      loc.lat[q] = lat;
      loc.lon[q] = lon;
      loc.speed[q] = Math.max(0, st.v + 0.25 * gauss(rand));
      loc.hacc[q] = 3;
    }
    // Tiempos de vuelta verdaderos entre pasos por meta (índice 0 de cada vuelta).
    const crossT = [];
    for (let lp = 0; lp <= plan.length; lp++)
      crossT.push(T[Math.min(N - 1, lp * n)]);
    return {
      session: { loc, acc, gyro, grav, warnings: [] },
      truth: {
        lapTimes: truth,
        crossings: crossT,
        // Inclinación verdadera (grados, + a derechas) en el instante t, para comprobar la medida.
        leanAt: (t) => {
          const st = stateAt(t);
          return (Math.atan((st.v * st.v * st.k) / G) * 180) / Math.PI;
        },
      },
    };
  }

  root.MaspaTelemetry = {
    parseCsv,
    sessionFromCsv,
    analyze,
    insights,
    demoSession,
    buildTrack,
    reference,
    nearestOn,
    sectorBounds,
    toLocal,
    toLatLon,
    LeanEstimator,
    STEP_M,
    ON_TRACK_M,
    G,
  };
})(typeof window !== "undefined" ? window : globalThis);
