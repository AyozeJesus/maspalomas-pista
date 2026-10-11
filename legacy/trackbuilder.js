// Trazado de un circuito cualquiera a partir de unas vueltas grabadas con el GPS: eje, meta, curvas y sectores.
(function (root) {
  "use strict";

  const DEFAULTS = { minLaps: 2, spacing: 2, name: "Circuito nuevo" };
  const DEG = Math.PI / 180;

  // ---------- fijos y vueltas ----------
  const MOVING = 8; // m/s: más despacio es boxes, la salida de boxes o una parada
  const STOP_S = 8; // s seguidos por debajo de MOVING: parada (boxes, caída, bandera roja)
  const MAX_HACC = 30; // m: un fijo con más error que esto no ayuda a dibujar nada
  const GATE_HALF = 20; // m: medio ancho de la línea que cuenta las pasadas (pista + error del GPS)
  const GATE_COS = Math.cos(40 * DEG); // misma dirección de marcha que la línea (±40°)
  const CROSS_V = 5; // m/s mínimos al cruzar una línea
  const MIN_LOOP = 150; // m: menos que esto no es una vuelta, ni en un kart
  const LAP_TOL = 0.06; // misma longitud (±6 %): fuera atajos, salidas de pista y vueltas con paso por boxes
  const SLOW_PASS = 0.5; // pasada por la línea a menos de la mitad de la velocidad típica: calle de boxes
  const MAX_FOLDS = 6; // grupos de vueltas para elegir el suavizado (validación cruzada)

  // ---------- eje ----------
  const ORDER = 2; // segundas diferencias (curvatura): una recta sale gratis, como en un spline cúbico
  const BW_MIN = 1; // m: ancho de banda equivalente del suavizado (con la densidad media de fijos), del más fino…
  const BW_MAX = 120; // m: …al más fuerte
  const DENS_WIN = 10; // m a cada lado para medir la densidad de fijos
  const DENS_POW = 3; // peso ∝ 1/densidad³: ancho de banda ∝ distancia entre fijos
  const DENS_FLOOR = 0.05; // densidad mínima (fracción de la media): un hueco sin fijos no se suaviza sin límite
  const HP_M = 100; // m: escala de la deriva del GPS que no cuenta al elegir el suavizado
  const MAX_SPREAD = 15; // m: más dispersión es que las vueltas no son el mismo recorrido
  const MIN_LEN = 200; // m: un kart pequeño
  const MAX_LEN = 25000; // m: el Nordschleife
  const CROSS_COS = Math.cos(30 * DEG); // un cruce a distinto nivel (puente) corta en ángulo franco
  const CROSS_GAP = 150; // m de eje entre los dos pasos de un cruce de verdad

  // ---------- curvas, rectas y sectores ----------
  const CORNER_R = 150; // m: radio mínimo por debajo del cual hay que frenar o cortar gas
  const STRAIGHT_R = 300; // m: por encima, recta a efectos de trazado
  const MIN_TURN = 40 * DEG; // giro total: menos es un quiebro que se pasa sin cambiar de dirección
  const MERGE_M = 60; // m entre vértices: una sola curva (chicane, doble vértice)
  const SECTOR_GAP = 40; // m de recta entre dos curvas para cortar sector entre ellas

  function ring(i, n) {
    return ((i % n) + n) % n;
  }
  function num(v) {
    return v === null || v === undefined || v === "" ? NaN : Number(v);
  }
  function median(a) {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((p, q) => p - q);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function wrapLon(lon) {
    return ((((lon + 540) % 360) + 360) % 360) - 180;
  }

  // ---------- proyección local ----------
  // Metros locales (x al este, y al norte) con los radios del elipsoide WGS84 en la latitud del circuito:
  // en unos kilómetros el error es de milímetros, en cualquier punto del planeta.
  function projection(lat0, lon0) {
    const p = lat0 * DEG;
    const e2 = 6.69437999014e-3;
    const w = 1 - e2 * Math.sin(p) * Math.sin(p);
    const ky = (DEG * 6378137 * (1 - e2)) / Math.pow(w, 1.5);
    const kx = (DEG * 6378137 * Math.cos(p)) / Math.sqrt(w);
    return {
      lat0,
      lon0,
      xy: (lat, lon) => [wrapLon(lon - lon0) * kx, (lat - lat0) * ky],
      ll: (x, y) => [lat0 + y / ky, wrapLon(lon0 + x / kx)],
    };
  }

  function meanLatLon(lat, lon) {
    let sa = 0;
    let so = 0;
    const ref = lon[0];
    for (let k = 0; k < lat.length; k++) {
      sa += lat[k];
      so += wrapLon(lon[k] - ref);
    }
    return [sa / lat.length, wrapLon(ref + so / lat.length)];
  }

  // ---------- fijos ----------
  // Acepta la lista [{t, lat, lon, speed, hacc}] o las columnas de Location.csv ({t: [...], lat: [...], ...}).
  function cleanFixes(fixes) {
    const t = [];
    const lat = [];
    const lon = [];
    const spd = [];
    const acc = [];
    let get = null;
    let count = 0;
    if (Array.isArray(fixes)) {
      count = fixes.length;
      get = (k) => fixes[k] || {};
    } else if (fixes && fixes.t && fixes.lat && fixes.lon) {
      count = fixes.t.length;
      get = (k) => ({
        t: fixes.t[k],
        lat: fixes.lat[k],
        lon: fixes.lon[k],
        speed: fixes.speed ? fixes.speed[k] : NaN,
        hacc: fixes.hacc ? fixes.hacc[k] : NaN,
      });
    }
    let last = -Infinity;
    for (let k = 0; k < count; k++) {
      const f = get(k);
      const ft = num(f.t);
      const la = num(f.lat);
      const lo = num(f.lon);
      if (!Number.isFinite(ft) || !Number.isFinite(la) || !Number.isFinite(lo))
        continue;
      // 0,0 es el fijo vacío de algunos registradores
      if (Math.abs(la) > 85 || Math.abs(lo) > 180 || (la === 0 && lo === 0))
        continue;
      if (ft <= last) continue;
      const h = num(f.hacc);
      if (Number.isFinite(h) && h > MAX_HACC) continue;
      const v = num(f.speed);
      t.push(ft);
      lat.push(la);
      lon.push(lo);
      spd.push(Number.isFinite(v) && v >= 0 ? v : NaN);
      acc.push(Number.isFinite(h) && h > 0 ? h : NaN);
      last = ft;
    }
    return { t, lat, lon, spd, acc, n: t.length };
  }

  // Media en una ventana de ±half segundos: quita el temblor de un GPS de 10-25 Hz sin mezclar tramos
  // separados por un corte de señal. A 1 Hz la ventana solo contiene el propio fijo.
  function timeSmooth(t, v, half) {
    const n = v.length;
    const out = new Float64Array(n);
    let a = 0;
    let b = 0;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      while (b < n && t[b] <= t[k] + half) sum += v[b++];
      while (t[a] < t[k] - half) sum -= v[a++];
      out[k] = sum / (b - a);
    }
    return out;
  }

  // Trayectoria en metros: posición cruda (para el ajuste), suavizada (para pasadas y distancias), rumbo,
  // velocidad y tramos en marcha (`run`, -1 en boxes o parado).
  function trajectory(c, proj) {
    const n = c.n;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const p = proj.xy(c.lat[k], c.lon[k]);
      x[k] = p[0];
      y[k] = p[1];
    }
    const dts = [];
    for (let k = 1; k < n; k++) dts.push(c.t[k] - c.t[k - 1]);
    const dt = median(dts) || 1;
    const gap = Math.max(4, 5 * dt);
    const xs = timeSmooth(c.t, x, 0.25);
    const ys = timeSmooth(c.t, y, 0.25);
    const hx = new Float64Array(n);
    const hy = new Float64Array(n);
    const v = new Float64Array(n);
    let a = 0;
    let b = 0;
    for (let k = 0; k < n; k++) {
      while (a < k - 1 && c.t[a] < c.t[k] - 0.5) a++;
      if (b < k + 1) b = Math.min(n - 1, k + 1);
      while (b + 1 < n && c.t[b + 1] <= c.t[k] + 0.5) b++;
      const i0 = Math.max(0, Math.min(a, k - 1));
      const dx = xs[b] - xs[i0];
      const dy = ys[b] - ys[i0];
      const d = Math.hypot(dx, dy);
      hx[k] = d > 0 ? dx / d : 0;
      hy[k] = d > 0 ? dy / d : 0;
      const span = c.t[b] - c.t[i0];
      v[k] = Number.isFinite(c.spd[k]) ? c.spd[k] : span > 0 ? d / span : 0;
    }
    // Paradas: tramos lentos largos y los extremos lentos de la grabación (boxes antes y después).
    const keep = new Uint8Array(n).fill(1);
    for (let i = 0; i < n;) {
      if (v[i] >= MOVING) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < n && v[j + 1] < MOVING && c.t[j + 1] - c.t[j] <= gap) j++;
      if (i === 0 || j === n - 1 || c.t[j] - c.t[i] >= STOP_S)
        keep.fill(0, i, j + 1);
      i = j + 1;
    }
    const run = new Int32Array(n).fill(-1);
    let id = -1;
    for (let k = 0; k < n; k++) {
      if (!keep[k]) continue;
      if (k === 0 || !keep[k - 1] || c.t[k] - c.t[k - 1] > gap) id++;
      run[k] = id;
    }
    // Boxes: donde el piloto ha estado parado (al empezar, al acabar y en las paradas). Sin velocidad del GPS,
    // parado es moverse menos de 1,5 m/s en ±3 s: a 1 Hz el temblor de un fijo a otro ya parece 3 m/s.
    const sx = [];
    const sy = [];
    let p0 = 0;
    let p1 = 0;
    for (let k = 0; k < n; k++) {
      while (c.t[p0] < c.t[k] - 3) p0++;
      while (p1 + 1 < n && c.t[p1 + 1] <= c.t[k] + 3) p1++;
      const span = c.t[p1] - c.t[p0];
      const still = Number.isFinite(c.spd[k])
        ? c.spd[k] < 2
        : span > 0 && Math.hypot(xs[p1] - xs[p0], ys[p1] - ys[p0]) < 1.5 * span;
      if (still) {
        sx.push(xs[k]);
        sy.push(ys[k]);
      }
    }
    const pit = sx.length >= 5 ? [median(sx), median(sy)] : null;
    // Distancia recorrida sobre la posición suavizada y solo en marcha: el temblor parado no suma metros.
    const cum = new Float64Array(n);
    for (let k = 1; k < n; k++) {
      const moving = v[k] >= 3 && c.t[k] - c.t[k - 1] <= gap;
      cum[k] =
        cum[k - 1] +
        (moving ? Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]) : 0);
    }
    return {
      n,
      t: c.t,
      acc: c.acc,
      x,
      y,
      xs,
      ys,
      hx,
      hy,
      v,
      run,
      cum,
      gap,
      pit,
    };
  }

  // ---------- vueltas por cierre del recorrido ----------
  // Pasadas por una línea perpendicular a la marcha en (gx, gy) con dirección (ux, uy).
  function gateCrossings(tr, gx, gy, ux, uy, minGap, sameRun) {
    const out = [];
    let last = null;
    for (let k = 0; k + 1 < tr.n; k++) {
      if (sameRun) {
        if (tr.run[k] < 0 || tr.run[k] !== tr.run[k + 1]) continue;
      } else if (tr.t[k + 1] - tr.t[k] > tr.gap) continue;
      // Parado en la línea (parrilla, boxes) el temblor del GPS la cruza: solo cuenta pasar rodando.
      if (tr.v[k] < CROSS_V || tr.v[k + 1] < CROSS_V) continue;
      const a0 = (tr.xs[k] - gx) * ux + (tr.ys[k] - gy) * uy;
      const a1 = (tr.xs[k + 1] - gx) * ux + (tr.ys[k + 1] - gy) * uy;
      if (!(a0 < 0 && a1 >= 0)) continue;
      const f = a0 / (a0 - a1);
      const cx = tr.xs[k] + (tr.xs[k + 1] - tr.xs[k]) * f;
      const cy = tr.ys[k] + (tr.ys[k + 1] - tr.ys[k]) * f;
      if (Math.abs((cy - gy) * ux - (cx - gx) * uy) > GATE_HALF) continue;
      const mx = tr.hx[k] + tr.hx[k + 1];
      const my = tr.hy[k] + tr.hy[k + 1];
      const ml = Math.hypot(mx, my);
      if (!(ml > 0) || (mx * ux + my * uy) / ml < GATE_COS) continue;
      const d = tr.cum[k] + (tr.cum[k + 1] - tr.cum[k]) * f;
      const run = sameRun ? tr.run[k] : 0;
      if (last && last.run === run && d - last.d < minGap) continue;
      last = {
        k,
        f,
        t: tr.t[k] + (tr.t[k + 1] - tr.t[k]) * f,
        d,
        run,
        v: tr.v[k] + (tr.v[k + 1] - tr.v[k]) * f,
      };
      out.push(last);
    }
    return out;
  }

  // Vueltas vistas desde una línea: las de longitud parecida a la más repetida (las demás son vueltas
  // con atajo, con paso por boxes o con una pasada perdida por un corte de GPS). La línea está en un punto rápido:
  // una pasada mucho más lenta que las demás es la calle de boxes al lado (salida o entrada) y esa vuelta no sirve.
  function lapsThrough(tr, k) {
    const cr = gateCrossings(
      tr,
      tr.xs[k],
      tr.ys[k],
      tr.hx[k],
      tr.hy[k],
      MIN_LOOP,
      true,
    );
    const slow = SLOW_PASS * median(cr.map((c) => c.v));
    const laps = [];
    for (let j = 0; j + 1 < cr.length; j++)
      if (cr[j].run === cr[j + 1].run && cr[j].v >= slow && cr[j + 1].v >= slow)
        laps.push({ a: cr[j], b: cr[j + 1], len: cr[j + 1].d - cr[j].d });
    if (!laps.length) return { clean: [], spread: Infinity };
    let best = null;
    for (const l of laps) {
      const near = laps.filter(
        (q) => Math.abs(q.len - l.len) <= LAP_TOL * l.len,
      );
      if (!best || near.length > best.length) best = near;
    }
    const m = median(best.map((l) => l.len));
    const clean = laps.filter((l) => Math.abs(l.len - m) <= LAP_TOL * m);
    let s2 = 0;
    for (const l of clean) s2 += (l.len / m - 1) ** 2;
    return { clean, len: m, spread: Math.sqrt(s2 / clean.length) };
  }

  // La línea de referencia se prueba en varios puntos rápidos repartidos por la tanda (rectas, bien dentro
  // de la sesión) y se queda la que ve más vueltas iguales.
  function detectLaps(tr) {
    const idx = [];
    for (let k = 1; k + 1 < tr.n; k++)
      if (tr.run[k] >= 0 && tr.v[k] >= MOVING) idx.push(k);
    if (idx.length < 20) return null;
    const parts = 9;
    let best = null;
    for (let p = 0; p < parts; p++) {
      const lo = Math.floor((idx.length * p) / parts);
      const hi = Math.floor((idx.length * (p + 1)) / parts);
      let k = -1;
      for (let q = lo; q < hi; q++)
        if (k < 0 || tr.v[idx[q]] > tr.v[k]) k = idx[q];
      if (k < 0) continue;
      const r = lapsThrough(tr, k);
      if (
        !best ||
        r.clean.length > best.clean.length ||
        (r.clean.length === best.clean.length && r.spread < best.spread)
      )
        best = r;
    }
    return best;
  }

  // Puntos de las vueltas buenas con su fracción de vuelta u ∈ [0, 1) y su peso (1/error²).
  function lapPoints(tr, laps) {
    const x = [];
    const y = [];
    const u = [];
    const w = [];
    const fold = [];
    const lapStart = [];
    const folds = Math.min(MAX_FOLDS, laps.length);
    laps.forEach((l, j) => {
      lapStart.push(x.length);
      for (let k = l.a.k + 1; k <= l.b.k; k++) {
        const f = (tr.cum[k] - l.a.d) / (l.b.d - l.a.d);
        if (!(f >= 0 && f < 1)) continue;
        x.push(tr.x[k]);
        y.push(tr.y[k]);
        u.push(f);
        const h = tr.acc[k];
        w.push(Number.isFinite(h) ? 1 / Math.max(2, h) ** 2 : NaN);
        fold.push(j % folds);
      }
    });
    // Sin precisión declarada pesan como la mediana; la declarada solo reparte dentro de un margen.
    const finite = w.filter(Number.isFinite);
    const wm = finite.length ? median(finite) : 1;
    for (let i = 0; i < w.length; i++)
      w[i] = Number.isFinite(w[i]) ? Math.min(3, Math.max(0.1, w[i] / wm)) : 1;
    return {
      n: x.length,
      x: Float64Array.from(x),
      y: Float64Array.from(y),
      u: Float64Array.from(u),
      w: Float64Array.from(w),
      fold: Int32Array.from(fold),
      folds,
      lapStart: Int32Array.from(lapStart.concat([x.length])),
    };
  }

  // ---------- álgebra de banda (simétrica; se guarda la mitad inferior) ----------
  // a[i * W + k] = A[i][i - k], k = 0..b, W = b + 1. LDLᵀ en el sitio.
  function ldl(a, n, b) {
    const W = b + 1;
    for (let i = 0; i < n; i++) {
      const j0 = i - b > 0 ? i - b : 0;
      for (let j = j0; j < i; j++) {
        let s = a[i * W + (i - j)];
        for (let k = j0; k < j; k++)
          s -= a[i * W + (i - k)] * a[k * W] * a[j * W + (j - k)];
        a[i * W + (i - j)] = s / a[j * W];
      }
      let d = a[i * W];
      for (let k = j0; k < i; k++) {
        const l = a[i * W + (i - k)];
        d -= l * l * a[k * W];
      }
      a[i * W] = d > 1e-300 ? d : 1e-300;
    }
  }

  function ldlSolve(a, n, b, r) {
    const W = b + 1;
    const x = Float64Array.from(r);
    for (let i = 0; i < n; i++) {
      let s = x[i];
      for (let k = i - b > 0 ? i - b : 0; k < i; k++)
        s -= a[i * W + (i - k)] * x[k];
      x[i] = s;
    }
    for (let i = 0; i < n; i++) x[i] /= a[i * W];
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i];
      const k1 = i + b < n - 1 ? i + b : n - 1;
      for (let k = i + 1; k <= k1; k++) s -= a[k * W + (k - i)] * x[k];
      x[i] = s;
    }
    return x;
  }

  const DIFF = { 2: [1, -2, 1], 3: [-1, 3, -3, 1] };
  // Penalización ΣᵣPᵣ·(Δᵈc)ᵣ² en banda; rowW da el peso de cada fila (suavizado local), 1 si falta.
  function penaltyBand(n, d, rowW) {
    const W = d + 1;
    const c = DIFF[d];
    const P = new Float64Array(n * W);
    for (let r = 0; r + d < n; r++) {
      const lr = rowW ? rowW[r] : 1;
      for (let p = 0; p <= d; p++)
        for (let q = 0; q <= p; q++)
          P[(r + p) * W + (p - q)] += lr * c[p] * c[q];
    }
    return P;
  }

  // ---------- ajuste de una curva cerrada ----------
  // Nodos equiespaciados en u con interpolación lineal y penalización de las diferencias de orden ORDER
  // (suavizador de Whittaker). Para cerrar la vuelta sin un sistema cíclico se extiende la rejilla E nodos por
  // cada lado con copias de los puntos: lejos de los extremos la solución es la de la curva cerrada.
  function fitSystem(P, u, w, M, h) {
    const d = ORDER;
    const E = Math.min(M, Math.max(Math.ceil(M / 4), 120));
    const N = M + 2 * E;
    const W = d + 1;
    const A = [];
    const RX = [];
    const RY = [];
    for (let j = 0; j < P.folds; j++) {
      A.push(new Float64Array(N * W));
      RX.push(new Float64Array(N));
      RY.push(new Float64Array(N));
    }
    let wsum = 0;
    for (let i = 0; i < P.n; i++) {
      const wi = w[i];
      if (!(wi > 0)) continue;
      wsum += wi;
      const a = A[P.fold[i]];
      const rx = RX[P.fold[i]];
      const ry = RY[P.fold[i]];
      const g = u[i] * M;
      for (let r = -1; r <= 1; r++) {
        const ge = g + r * M + E;
        if (ge < 0 || ge >= N - 1) continue;
        const j = Math.floor(ge);
        const f = ge - j;
        const w0 = wi * (1 - f);
        const w1 = wi * f;
        a[j * W] += w0 * (1 - f);
        a[(j + 1) * W] += w1 * f;
        a[(j + 1) * W + 1] += w0 * f;
        rx[j] += w0 * P.x[i];
        rx[j + 1] += w1 * P.x[i];
        ry[j] += w0 * P.y[i];
        ry[j + 1] += w1 * P.y[i];
      }
    }
    const At = new Float64Array(N * W);
    const Rxt = new Float64Array(N);
    const Ryt = new Float64Array(N);
    for (let j = 0; j < P.folds; j++) {
      for (let q = 0; q < N * W; q++) At[q] += A[j][q];
      for (let q = 0; q < N; q++) {
        Rxt[q] += RX[j][q];
        Ryt[q] += RY[j][q];
      }
    }
    // Suavizado local según la densidad de fijos (peso por metro en ±DENS_WIN): el piloto va despacio donde la
    // pista gira y deprisa en las rectas, así que suavizar en proporción a la distancia entre fijos afina las
    // horquillas y deja rectas las rectas, donde a 1 Hz hay un fijo cada 50-70 m por vuelta.
    const rad = Math.max(1, Math.round(DENS_WIN / h));
    const dens = new Float64Array(N);
    let run = 0;
    for (let j = -rad; j < N + rad; j++) {
      if (j + rad < N) run += At[Math.max(0, j + rad) * W];
      if (j - rad - 1 >= 0) run -= At[(j - rad - 1) * W];
      if (j >= 0 && j < N) dens[j] = run / (2 * rad + 1);
    }
    const mean = wsum / M;
    const rowW = new Float64Array(N - d);
    for (let r = 0; r < N - d; r++) {
      const q = Math.max(dens[r + (d >> 1)], DENS_FLOOR * mean);
      rowW[r] = Math.pow(mean / q, DENS_POW);
    }
    return {
      M,
      E,
      N,
      d,
      W,
      h,
      A,
      RX,
      RY,
      At,
      Rxt,
      Ryt,
      pen: penaltyBand(N, d, rowW),
      rho: mean,
    };
  }

  function solveFit(S, pen, scale, skip) {
    const { N, W, d } = S;
    const a = new Float64Array(N * W);
    const rx = new Float64Array(N);
    const ry = new Float64Array(N);
    const As = skip >= 0 ? S.A[skip] : null;
    for (let q = 0; q < N * W; q++)
      a[q] = S.At[q] + scale * pen[q] - (As ? As[q] : 0);
    for (let q = 0; q < N; q++) {
      rx[q] = S.Rxt[q] - (As ? S.RX[skip][q] : 0);
      ry[q] = S.Ryt[q] - (As ? S.RY[skip][q] : 0);
      a[q * W] += 1e-9 * S.rho; // nodos sin datos: que no quede indeterminado
    }
    ldl(a, N, d);
    return { cx: ldlSolve(a, N, d, rx), cy: ldlSolve(a, N, d, ry) };
  }

  function curveAt(c, S, u) {
    const ge = u * S.M + S.E;
    const j = Math.floor(ge);
    const f = ge - j;
    return [
      c.cx[j] + (c.cx[j + 1] - c.cx[j]) * f,
      c.cy[j] + (c.cy[j + 1] - c.cy[j]) * f,
    ];
  }

  // Error de una vuelta sin su desvío lento: a cada residuo se le resta la media de los de esa misma vuelta a ±HP_M
  // metros. El GPS de un móvil deriva metros durante decenas de segundos; esa deriva no la quita ningún suavizado y,
  // si cuenta, decide la elección al azar (con cinco vueltas pesa más que todo lo demás).
  function highPass(idx, rx, ry, w, u, L) {
    const n = idx.length;
    let a = 0;
    let b = 0;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let e = 0;
    for (let q = 0; q < n; q++) {
      const s = u[idx[q]] * L;
      while (b < n && u[idx[b]] * L <= s + HP_M) {
        const i = idx[b++];
        sw += w[i];
        sx += w[i] * rx[i];
        sy += w[i] * ry[i];
      }
      while (u[idx[a]] * L < s - HP_M) {
        const i = idx[a++];
        sw -= w[i];
        sx -= w[i] * rx[i];
        sy -= w[i] * ry[i];
      }
      const i = idx[q];
      e += w[i] * ((rx[i] - sx / sw) ** 2 + (ry[i] - sy / sw) ** 2);
    }
    return e;
  }

  // Nivel de suavizado elegido dejando fuera cada grupo de vueltas y midiendo cómo lo predicen las demás (sin la
  // deriva lenta de cada vuelta, ver highPass). La forma local del suavizado ya viene en S.pen (densidad de fijos);
  // aquí solo se busca la escala global. La curva de error suele ser muy plana cerca del mínimo y el mínimo exacto
  // lo decide el ruido: se toma el suavizado más fuerte que no es peor que el mínimo en más de un error típico
  // (comparando vuelta a vuelta). Un eje que sigue el ruido además se retroalimenta al reproyectar los puntos.
  function chooseSmoothing(S, P, u, w) {
    const d = S.d;
    const scaleOf = (lb) => S.rho * Math.exp(2 * d * lb);
    if (P.folds < 2) return { scale: scaleOf(Math.log(6 / S.h)), bw: 6 };
    // Puntos de cada vuelta en orden de recorrido, agrupados por grupo de validación.
    const lapsOfFold = Array.from({ length: P.folds }, () => []);
    for (let q = 0; q + 1 < P.lapStart.length; q++) {
      const idx = [];
      for (let i = P.lapStart[q]; i < P.lapStart[q + 1]; i++)
        if (w[i] > 0) idx.push(i);
      idx.sort((a, b) => u[a] - u[b]);
      if (idx.length) lapsOfFold[P.fold[idx[0]]].push(idx);
    }
    const L = S.M * S.h;
    const rx = new Float64Array(P.n);
    const ry = new Float64Array(P.n);
    const cache = new Map();
    const cv = (lb) => {
      const key = Math.round(lb * 1e6);
      if (cache.has(key)) return cache.get(key);
      const per = new Float64Array(P.folds);
      for (let j = 0; j < P.folds; j++) {
        const c = solveFit(S, S.pen, scaleOf(lb), j);
        for (const idx of lapsOfFold[j]) {
          for (const i of idx) {
            const p = curveAt(c, S, u[i]);
            rx[i] = P.x[i] - p[0];
            ry[i] = P.y[i] - p[1];
          }
          per[j] += highPass(idx, rx, ry, w, u, L);
        }
      }
      let total = 0;
      for (const e of per) total += e;
      const r = { per, total };
      cache.set(key, r);
      return r;
    };
    // Ancho de banda equivalente (donde la densidad de fijos es la media) de BW_MIN a BW_MAX, en escala logarítmica.
    const lo = Math.log(BW_MIN / S.h);
    const hi = Math.log(BW_MAX / S.h);
    const steps = 12;
    const at = (s) => lo + ((hi - lo) * s) / steps;
    let bi = 0;
    for (let s = 1; s <= steps; s++)
      if (cv(at(s)).total < cv(at(bi)).total) bi = s;
    let a = at(Math.max(0, bi - 1));
    let b = at(Math.min(steps, bi + 1));
    const g = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 6; it++) {
      const c1 = b - g * (b - a);
      const c2 = a + g * (b - a);
      if (cv(c1).total <= cv(c2).total) b = c2;
      else a = c1;
    }
    const best = (a + b) / 2;
    const ref = cv(best);
    let pick = best;
    for (let lb = best + 0.1; lb <= hi; lb += 0.1) {
      const r = cv(lb);
      let m = 0;
      let m2 = 0;
      for (let j = 0; j < P.folds; j++) {
        const dj = r.per[j] - ref.per[j];
        m += dj;
        m2 += dj * dj;
      }
      const F = P.folds;
      const se = Math.sqrt(Math.max(0, m2 / F - (m / F) ** 2) / (F - 1)) * F;
      if (m > se) break;
      pick = lb;
    }
    return { scale: scaleOf(pick), bw: Math.exp(pick) * S.h };
  }

  // Proyección de cada punto sobre la curva (polígono cerrado de M nodos), buscando cerca de su u anterior.
  // Devuelve la nueva u como fracción de longitud de arco: así la siguiente rejilla queda equiespaciada en metros
  // y desaparece el sesgo de la velocidad (más fijos donde se va despacio).
  function projectPoints(cx, cy, M, P, u, win) {
    const S = new Float64Array(M + 1);
    for (let j = 0; j < M; j++) {
      const j1 = j + 1 < M ? j + 1 : 0;
      S[j + 1] = S[j] + Math.hypot(cx[j1] - cx[j], cy[j1] - cy[j]);
    }
    const L = S[M];
    const nu = new Float64Array(P.n);
    const dist = new Float64Array(P.n);
    for (let i = 0; i < P.n; i++) {
      const g0 = Math.floor(u[i] * M);
      let best = Infinity;
      let bs = 0;
      for (let q = -win; q <= win; q++) {
        const j = ring(g0 + q, M);
        const j1 = j + 1 < M ? j + 1 : 0;
        const dx = cx[j1] - cx[j];
        const dy = cy[j1] - cy[j];
        const l2 = dx * dx + dy * dy || 1e-12;
        let f = ((P.x[i] - cx[j]) * dx + (P.y[i] - cy[j]) * dy) / l2;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const ex = cx[j] + dx * f - P.x[i];
        const ey = cy[j] + dy * f - P.y[i];
        const e2 = ex * ex + ey * ey;
        if (e2 < best) {
          best = e2;
          bs = S[j] + (S[j + 1] - S[j]) * f;
        }
      }
      const nuI = bs / L;
      nu[i] = nuI >= 1 ? nuI - 1 : nuI;
      dist[i] = Math.sqrt(best);
    }
    return { u: nu, dist, L };
  }

  // Pesos robustos: un punto lejos del resto (salida de pista, rebote del GPS) pierde peso hasta no contar. La
  // distancia al eje es la componente perpendicular del error: su mediana es 0,6745 σ.
  function robustWeights(w0, dist) {
    const used = [];
    for (let i = 0; i < dist.length; i++) if (w0[i] > 0) used.push(dist[i]);
    const sigma = Math.max(0.5, median(used) / 0.6745);
    const w = new Float64Array(w0.length);
    for (let i = 0; i < w.length; i++) {
      const z = dist[i] / sigma;
      w[i] = z <= 2.5 ? w0[i] : z <= 4.5 ? (w0[i] * 2.5) / z : 0;
    }
    return w;
  }

  // Ajuste → reproyección → ajuste: la primera u (fracción de la distancia de cada vuelta) desalinea las vueltas
  // unos metros a lo largo de la pista; tras cada ajuste cada punto toma la u de su pie sobre la curva (fracción de
  // longitud de arco) y la rejilla se rehace equiespaciada en metros. Se para cuando los puntos ya no se mueven.
  function fitLoop(P, L0) {
    let L = L0;
    let u = Float64Array.from(P.u);
    let w = Float64Array.from(P.w);
    let out = null;
    for (let it = 0; it < 6; it++) {
      const M = Math.max(64, Math.round(L / (L <= 4000 ? 1 : L / 4000)));
      const S = fitSystem(P, u, w, M, L / M);
      const sm = chooseSmoothing(S, P, u, w);
      const c = solveFit(S, S.pen, sm.scale, -1);
      const cx = c.cx.slice(S.E, S.E + M);
      const cy = c.cy.slice(S.E, S.E + M);
      const pr = projectPoints(
        cx,
        cy,
        M,
        P,
        u,
        Math.ceil((it === 0 ? 60 : 25) / S.h),
      );
      let shift = 0;
      for (let i = 0; i < P.n; i++) {
        let du = pr.u[i] - u[i];
        if (du > 0.5) du -= 1;
        if (du < -0.5) du += 1;
        shift += Math.abs(du);
      }
      shift = (shift / P.n) * pr.L;
      out = { cx, cy, dist: pr.dist };
      u = pr.u;
      L = pr.L;
      w = robustWeights(P.w, pr.dist);
      if (it >= 2 && shift < 0.15) break;
    }
    return out;
  }

  // ---------- geometría del eje ----------
  function resampleClosed(X, Y, spacing) {
    const n = X.length;
    const S = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const i1 = i + 1 < n ? i + 1 : 0;
      S[i + 1] = S[i] + Math.hypot(X[i1] - X[i], Y[i1] - Y[i]);
    }
    const L = S[n];
    const m = Math.max(16, Math.round(L / spacing));
    const P = [];
    let j = 0;
    for (let k = 0; k < m; k++) {
      const s = (k * L) / m;
      while (j < n - 1 && S[j + 1] <= s) j++;
      const seg = S[j + 1] - S[j];
      const f = seg > 0 ? (s - S[j]) / seg : 0;
      const j1 = j + 1 < n ? j + 1 : 0;
      P.push([X[j] + (X[j1] - X[j]) * f, Y[j] + (Y[j1] - Y[j]) * f]);
    }
    return { P, L };
  }

  // Curvatura con signo (+ a izquierdas, x al este e y al norte): giro entre las cuerdas de ±w puntos.
  function curvature(P, w) {
    const n = P.length;
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = P[ring(i - w, n)];
      const b = P[i];
      const c = P[(i + w) % n];
      const ax = b[0] - a[0];
      const ay = b[1] - a[1];
      const bx = c[0] - b[0];
      const by = c[1] - b[1];
      const ang = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      k[i] = ang / ((Math.hypot(ax, ay) + Math.hypot(bx, by)) / 2 || 1);
    }
    return k;
  }

  // Tramos cíclicos donde test(i) se cumple: [{a, len}] (índices a..a+len-1 módulo n).
  function cyclicRuns(n, test) {
    let start = -1;
    for (let i = 0; i < n; i++)
      if (!test(i)) {
        start = i;
        break;
      }
    if (start < 0) return [{ a: 0, len: n, all: true }];
    const out = [];
    let cur = null;
    for (let q = 1; q <= n; q++) {
      const i = (start + q) % n;
      if (test(i)) {
        if (cur) cur.len++;
        else cur = { a: i, len: 1 };
      } else if (cur) {
        out.push(cur);
        cur = null;
      }
    }
    return out;
  }

  function segCross(p, q, r, s) {
    const o = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = o(r, s, p);
    const d2 = o(r, s, q);
    const d3 = o(p, q, r);
    const d4 = o(p, q, s);
    return (
      ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
  }

  // Cruces del eje consigo mismo. Un puente (ocho) cruza en ángulo franco entre tramos lejanos y se admite;
  // cualquier otro cruce es un trazado enredado.
  function badCrossings(P, h) {
    const n = P.length;
    const cell = Math.max(8, 4 * h);
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const a = P[i];
      const b = P[(i + 1) % n];
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
      const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
      const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = (gx + 1e5) * 3e5 + (gy + 1e5);
          const list = grid.get(key);
          if (list) list.push(i);
          else grid.set(key, [i]);
        }
    }
    const seen = new Set();
    let bad = 0;
    for (const list of grid.values())
      for (let p = 0; p < list.length; p++)
        for (let q = p + 1; q < list.length; q++) {
          const i = Math.min(list[p], list[q]);
          const j = Math.max(list[p], list[q]);
          const gapIdx = Math.min(j - i, n - (j - i));
          if (gapIdx <= 1 || seen.has(i * n + j)) continue;
          seen.add(i * n + j);
          const a = P[i];
          const b = P[(i + 1) % n];
          const c = P[j];
          const d = P[(j + 1) % n];
          if (!segCross(a, b, c, d)) continue;
          const ux = b[0] - a[0];
          const uy = b[1] - a[1];
          const vx = d[0] - c[0];
          const vy = d[1] - c[1];
          const cos =
            Math.abs(ux * vx + uy * vy) /
            (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
          if (cos > CROSS_COS || gapIdx * h < CROSS_GAP) bad++;
        }
    return bad;
  }

  // Curvas: zonas de giro continuo hacia el mismo lado (curvatura con cuerdas de 12 m, radio < STRAIGHT_R). Cuentan
  // las que giran al menos MIN_TURN en total (un quiebro de pocos grados no es una curva aunque sea cerrado) y cuyo
  // radio baja de CORNER_R. Vértice: donde va hecha la mitad del giro (en un radio constante, el centro del arco; y
  // el mismo punto en los dos sentidos de marcha). Radio: metros que se tarda en girar la mitad central del giro
  // (del 25 % al 75 %) entre ese ángulo; exacto en un arco, y ni un quiebro pegado a la curva ni una ondulación del
  // GPS lo falsean, como pasaría con la curvatura máxima.
  function findCorners(k, h) {
    const n = k.length;
    const lo = 1 / STRAIGHT_R;
    let corners = [];
    for (const side of [1, -1])
      for (const r of cyclicRuns(n, (i) => k[i] * side >= lo)) {
        let turn = 0;
        for (let q = 0; q < r.len; q++) turn += k[(r.a + q) % n] * side * h;
        if (turn < MIN_TURN) continue;
        let acc = 0;
        let qa = -1;
        let s25 = 0;
        let s75 = 0;
        for (let q = 0; q < r.len; q++) {
          const step = k[(r.a + q) % n] * side * h;
          // posición (en metros) donde el giro acumulado pasa por un nivel, interpolada dentro del paso
          const cross = (lv) => (q + (lv - acc) / step) * h;
          if (acc < 0.25 * turn && acc + step >= 0.25 * turn)
            s25 = cross(0.25 * turn);
          if (acc < 0.75 * turn && acc + step >= 0.75 * turn)
            s75 = cross(0.75 * turn);
          acc += step;
          if (qa < 0 && acc >= 0.5 * turn) qa = q;
        }
        const peak = (0.5 * turn) / Math.max(h, s75 - s25);
        if (!(peak > 1 / CORNER_R)) continue;
        corners.push({
          i: (r.a + qa) % n,
          side,
          kappa: peak,
          turn,
          a: r.a,
          len: r.len,
        });
      }
    corners.sort((p, q) => p.i - q.i);
    // Vértices demasiado juntos: se queda la curva más cerrada y abarca la zona de las dos.
    for (let again = true; again && corners.length > 1;) {
      again = false;
      for (let c = 0; c < corners.length; c++) {
        const A = corners[c];
        const B = corners[(c + 1) % corners.length];
        if (ring(B.i - A.i, n) * h >= MERGE_M) continue;
        const keep = A.kappa >= B.kappa ? A : B;
        const span = ring(B.a + B.len - A.a, n);
        const both = Object.assign({}, keep, {
          a: A.a,
          len: span >= Math.max(A.len, B.len) ? span : n,
        });
        corners = corners.filter((x) => x !== A && x !== B);
        corners.push(both);
        corners.sort((p, q) => p.i - q.i);
        again = true;
        break;
      }
    }
    return corners;
  }

  // Sectores: cada uno va de la mitad de la recta anterior a la mitad de la siguiente, como en Maspalomas. Las
  // curvas sin recta de verdad entre ellas (chicane, enlazadas) forman un grupo y comparten sector.
  function sectorBoundsOf(corners, h, n) {
    const L = n * h;
    const m = corners.length;
    if (!m) return [0, L / 3, (2 * L) / 3];
    const bounds = [];
    for (let k = 0; k < m; k++) {
      const A = corners[k];
      const B = corners[(k + 1) % m];
      const endA = A.a + A.len - 1;
      let startB = B.a;
      while (startB <= endA) startB += n;
      if (m === 1) startB = A.a + n;
      const gap = (startB - endA - 1) * h;
      if (gap >= SECTOR_GAP) bounds.push(ring((endA + startB) / 2, n) * h);
    }
    if (bounds.length < Math.min(2, m)) {
      // Sin rectas que separen: la regla de la app, punto medio entre vértices consecutivos.
      bounds.length = 0;
      for (let k = 0; k < m; k++) {
        const A = corners[ring(k - 1, m)];
        const B = corners[k];
        bounds.push(
          ring(A.i + ring(B.i - A.i, n) / 2 + (m === 1 ? n / 2 : 0), n) * h,
        );
      }
    }
    return bounds.sort((p, q) => p - q);
  }

  // Meta por defecto: mitad de la recta más larga (radio > STRAIGHT_R). La curvatura se mide con cuerdas largas
  // para que las ondulaciones del GPS no corten la recta, y los repuntes de menos de 20 m tampoco. Si se sabe
  // dónde estaban los boxes (donde el piloto estuvo parado), gana la recta larga que pasa junto a ellos: la meta
  // de un circuito casi siempre está en la recta de boxes.
  function startFinish(P, h, pit) {
    const n = P.length;
    const L = n * h;
    const chord = Math.min(30, Math.max(10, L / 20));
    const k = curvature(P, Math.max(1, Math.round(chord / h)));
    const flat = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      flat[i] = Math.abs(k[i]) < 1 / STRAIGHT_R ? 1 : 0;
    for (const r of cyclicRuns(n, (i) => !flat[i])) {
      let small = r.len * h < 20;
      for (let q = 0; q < r.len && small; q++)
        if (Math.abs(k[(r.a + q) % n]) >= 1 / CORNER_R) small = false;
      if (small) for (let q = 0; q < r.len; q++) flat[(r.a + q) % n] = 1;
    }
    const runs = cyclicRuns(n, (i) => flat[i] === 1);
    if (!runs.length) {
      let sf = 0;
      for (let i = 1; i < n; i++) if (Math.abs(k[i]) < Math.abs(k[sf])) sf = i;
      return sf;
    }
    let pick = runs.reduce((p, q) => (q.len > p.len ? q : p));
    if (pick.all) return 0;
    if (pit) {
      let best = null;
      let bd = 150;
      for (const r of runs) {
        if (r.len < 0.6 * pick.len) continue;
        for (let q = 0; q < r.len; q++) {
          const p = P[(r.a + q) % n];
          const d = Math.hypot(p[0] - pit[0], p[1] - pit[1]);
          if (d < bd) {
            bd = d;
            best = r;
          }
        }
      }
      if (best) pick = best;
    }
    return ring(pick.a + Math.floor(pick.len / 2), n);
  }

  function round(v, d) {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  // Eje cerrado (metros locales) → circuito: comprobaciones, meta en la mitad de la recta más larga, curvas,
  // sectores y coordenadas.
  function assemble(P0, proj, o, extra) {
    const n = P0.length;
    let L = 0;
    for (let i = 0; i < n; i++) {
      const b = P0[(i + 1) % n];
      L += Math.hypot(b[0] - P0[i][0], b[1] - P0[i][1]);
    }
    if (!(L >= MIN_LEN && L <= MAX_LEN))
      throw new Error(
        "El recorrido mide " +
          (L >= 1000
            ? (L / 1000).toFixed(1).replace(".", ",") + " km"
            : Math.round(L) + " m") +
          " y no parece un circuito: un circuito mide entre 200 m y 25 km.",
      );
    const h = L / n;
    const close = Math.hypot(P0[n - 1][0] - P0[0][0], P0[n - 1][1] - P0[0][1]);
    if (close > 1.5 * h + 0.01)
      throw new Error(
        "El trazado no cierra la vuelta. Prueba con otra tanda con más vueltas.",
      );
    if (badCrossings(P0, h))
      throw new Error(
        extra.fromGps
          ? "El trazado calculado se cruza consigo mismo: el GPS no ha sido lo bastante preciso. Prueba con otra tanda o con más vueltas."
          : "El trazado se cruza consigo mismo: revisa el dibujo del circuito.",
      );
    const sf = startFinish(P0, h, extra.pit);
    const P = P0.map((_, i) => P0[(i + sf) % n]);
    const found = findCorners(curvature(P, Math.max(1, Math.round(12 / h))), h);
    const bounds = orderBounds(
      sectorBoundsOf(found, h, n),
      found.map((c) => c.i * h),
      L,
    );
    let area = 0;
    for (let i = 0; i < n; i++) {
      const b = P[(i + 1) % n];
      area += P[i][0] * b[1] - b[0] * P[i][1];
    }
    const centerline = P.map((p) => {
      const ll = proj.ll(p[0], p[1]);
      return [round(ll[0], 7), round(ll[1], 7)];
    });
    const mean = meanLatLon(
      centerline.map((p) => p[0]),
      centerline.map((p) => p[1]),
    );
    const corners = found.map((c) => {
      const s = c.i * h;
      return {
        i: c.i,
        s: round(s, 2),
        side: c.side > 0 ? "izquierda" : "derecha",
        radius: round(1 / c.kappa, 1),
        turn: Math.round(c.turn / DEG),
        sector: sectorOf(bounds, s, L),
      };
    });
    return {
      name: o.name,
      origin: { lat: round(mean[0], 7), lon: round(mean[1], 7) },
      centerline,
      length: round(L, 2),
      direction: area > 0 ? "antihorario" : "horario",
      startIndex: 0,
      corners,
      sectorBounds: bounds.map((b) => round(b, 2)),
      laps: extra.laps,
      quality: { spread: round(extra.spread, 2) },
    };
  }

  // Sector de un punto: el del límite que tiene detrás más cerca (como sectorAt de la app).
  function sectorOf(bounds, s, L) {
    let best = 0;
    let bd = Infinity;
    bounds.forEach((b, k) => {
      const d = ring(s - b, L);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  }

  // Límites en el orden de las curvas, como T.sectorBounds de la app: el k-ésimo es donde empieza el sector de la
  // k-ésima curva (o grupo) contando desde meta, así que el primero puede caer al final de la vuelta, antes de meta.
  function orderBounds(bounds, cornerS, L) {
    const sorted = bounds.slice().sort((p, q) => p - q);
    if (!cornerS.length) return sorted;
    const first = Math.min(...cornerS);
    const k0 = sectorOf(sorted, first, L);
    return sorted.slice(k0).concat(sorted.slice(0, k0));
  }

  function lapsMessage(k) {
    return k === 1
      ? "Hace falta al menos 1 vuelta completa al circuito para crear el trazado."
      : "Hacen falta al menos " +
          k +
          " vueltas completas al circuito para crear el trazado.";
  }

  // ---------- API ----------
  function options(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    o.minLaps = Math.max(1, Math.round(Number(o.minLaps) || DEFAULTS.minLaps));
    o.spacing = Math.min(
      20,
      Math.max(0.5, Number(o.spacing) || DEFAULTS.spacing),
    );
    o.name = o.name ? String(o.name) : DEFAULTS.name;
    return o;
  }

  // Circuito desde una tanda: fixes [{t (s), lat, lon, speed (m/s), hacc (m)}] en orden de tiempo (o las columnas
  // de Location.csv); opts {minLaps: 2, spacing: 2 m, name}. Devuelve {name, origin {lat, lon}, centerline
  // [[lat, lon]] (cerrado, sentido de marcha, cada `spacing` m, índice 0 = meta), length (m), direction
  // ("horario"|"antihorario"), startIndex 0, corners [{i, s, side, radius, turn (°), sector}] por s, sectorBounds
  // [s] (el k-ésimo abre el sector de la k-ésima curva o grupo), laps, quality {spread (m)}}. Lanza un Error con un
  // mensaje para el piloto si no puede.
  function buildTrack(fixes, opts) {
    const o = options(opts);
    const c = cleanFixes(fixes);
    if (c.n < 30)
      throw new Error(
        "La grabación tiene muy pocas posiciones de GPS para crear el trazado: graba una tanda con la ubicación activada.",
      );
    const mean = meanLatLon(c.lat, c.lon);
    const proj = projection(mean[0], mean[1]);
    const tr = trajectory(c, proj);
    const det = detectLaps(tr);
    if (!det || det.clean.length < o.minLaps)
      throw new Error(lapsMessage(o.minLaps));
    const P = lapPoints(tr, det.clean);
    const fit = fitLoop(P, det.len);
    let s2 = 0;
    for (let i = 0; i < P.n; i++) s2 += fit.dist[i] * fit.dist[i];
    const spread = Math.sqrt(s2 / P.n);
    if (!(spread <= MAX_SPREAD))
      throw new Error(
        "Las vueltas no coinciden entre sí lo bastante para dibujar el circuito (GPS con mucho error o recorrido distinto cada vez). Prueba con otra tanda.",
      );
    const R = resampleClosed(fit.cx, fit.cy, o.spacing);
    const track = assemble(R.P, proj, o, {
      laps: det.clean.length,
      spread,
      pit: tr.pit,
      fromGps: true,
    });
    return track;
  }

  // Circuito a partir de un eje ya conocido ([[lat, lon], ...] en el sentido de marcha, cerrado): mismas reglas
  // de meta, curvas y sectores que buildTrack (sirve para un trazado dibujado o importado).
  function trackFromCenterline(points, opts) {
    const o = options(opts);
    const ll = (points || []).map((p) =>
      Array.isArray(p) ? [num(p[0]), num(p[1])] : [num(p.lat), num(p.lon)],
    );
    const ok = ll.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (ok.length < 8)
      throw new Error("El trazado necesita al menos 8 puntos.");
    const mean = meanLatLon(
      ok.map((p) => p[0]),
      ok.map((p) => p[1]),
    );
    const proj = projection(mean[0], mean[1]);
    const xy = ok.map((p) => proj.xy(p[0], p[1]));
    const last = xy[xy.length - 1];
    if (Math.hypot(last[0] - xy[0][0], last[1] - xy[0][1]) < 0.01) xy.pop();
    const R = resampleClosed(
      xy.map((p) => p[0]),
      xy.map((p) => p[1]),
      o.spacing,
    );
    return assemble(R.P, proj, o, { laps: 0, spread: 0 });
  }

  // Vueltas cronometradas en un circuito construido: pasadas por la línea de meta (índice 0 del eje) en el
  // sentido de marcha, con el instante interpolado entre los dos fijos que la cruzan.
  function lapsOf(fixes, track) {
    if (!track || !track.centerline || track.centerline.length < 8) return [];
    const proj = projection(track.origin.lat, track.origin.lon);
    const C = track.centerline.map((p) => proj.xy(p[0], p[1]));
    const n = C.length;
    const q = Math.max(1, Math.min(3, n >> 3));
    let ux = C[q][0] - C[n - q][0];
    let uy = C[q][1] - C[n - q][1];
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const c = cleanFixes(fixes);
    if (c.n < 2) return [];
    const tr = trajectory(c, proj);
    const L = track.length;
    const cr = gateCrossings(tr, C[0][0], C[0][1], ux, uy, 0.5 * L, false);
    // Una pasada mucho más lenta que las demás es la calle de boxes junto a la meta: ni empieza ni acaba vuelta.
    const slow = SLOW_PASS * median(cr.map((x) => x.v));
    const laps = [];
    for (let j = 0; j + 1 < cr.length; j++) {
      const dist = cr[j + 1].d - cr[j].d;
      if (dist < 0.75 * L || dist > 1.5 * L) continue;
      if (cr[j].v < slow || cr[j + 1].v < slow) continue;
      laps.push({
        t0: cr[j].t,
        t1: cr[j + 1].t,
        time: cr[j + 1].t - cr[j].t,
        dist: round(dist, 1),
      });
    }
    return laps;
  }

  // Mueve la meta al punto `newIndex` del eje: reordena el eje y desplaza curvas y sectores.
  function rotateStart(track, newIndex) {
    const n = track.centerline.length;
    const k = ring(Math.round(Number(newIndex) || 0), n);
    const L = track.length;
    const ds = (k * L) / n;
    const shift = (s) => round(ring(s - ds, L), 2);
    const moved = track.corners
      .map((c) => Object.assign({}, c, { i: ring(c.i - k, n), s: shift(c.s) }))
      .sort((p, q) => p.s - q.s);
    const bounds = orderBounds(
      track.sectorBounds.map(shift),
      moved.map((c) => c.s),
      L,
    );
    const corners = moved.map((c) =>
      Object.assign(c, { sector: sectorOf(bounds, c.s, L) }),
    );
    return Object.assign({}, track, {
      centerline: track.centerline
        .slice(k)
        .concat(track.centerline.slice(0, k)),
      startIndex: 0,
      corners,
      sectorBounds: bounds,
    });
  }

  const api = { buildTrack, lapsOf, rotateStart, trackFromCenterline };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaTrackBuilder = api;
})(typeof window !== "undefined" ? window : globalThis);
