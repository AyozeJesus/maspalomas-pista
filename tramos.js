// Tramos de carretera guardados («Los Loros subida»): se reconocen por la posición cada vez que se pasa por ellos (en
// directo, al repasar una grabación o buscando en las guardadas), con el tiempo de principio a fin y el tiempo a cada
// 20 m, para comparar pasadas: dónde se gana o se pierde y dónde se empieza a frenar. Sin página: lo usa live.js y se
// prueba con Node.
(function (root) {
  "use strict";
  const STEP = 10; // m entre puntos del trazado guardado
  const MARK = 20; // m entre marcas de tiempo de cada pasada
  const ON = 40; // m: más lejos del trazado, fuera del tramo
  const OFF_S = 12; // s fuera del trazado (o sin GPS) y la pasada no vale

  function localizer(lat0, lon0) {
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * 110574];
  }

  // Trazado de un tramo a partir de las posiciones del GPS de una ruta (loc de la grabación), desde que echa a
  // rodar hasta que para: puntos cada 10 m siguiendo el camino. Devuelve { pts: [[lat, lon]], largo } o null.
  function fromLoc(loc, from, to) {
    const good = [];
    for (let i = 0; i < loc.t.length; i++) {
      if (from !== undefined && loc.t[i] < from) continue;
      if (to !== undefined && loc.t[i] > to) continue;
      if (!(loc.hacc[i] <= 25) || !Number.isFinite(loc.lat[i])) continue;
      good.push([loc.lat[i], loc.lon[i], loc.speed[i]]);
    }
    // Sin los ratos parado al principio y al final.
    let a = 0;
    while (a < good.length && !(good[a][2] > 2)) a++;
    let b = good.length - 1;
    while (b > a && !(good[b][2] > 2)) b--;
    const g = good.slice(a, b + 1);
    if (g.length < 10) return null;
    const toXY = localizer(g[0][0], g[0][1]);
    const xy = g.map((p) => toXY(p[0], p[1]));
    // Remuestreo cada STEP m a lo largo del camino.
    const out = [[g[0][0], g[0][1]]];
    let carry = 0;
    let total = 0;
    const kx = 111320 * Math.cos((g[0][0] * Math.PI) / 180);
    for (let i = 1; i < xy.length; i++) {
      const dx = xy[i][0] - xy[i - 1][0];
      const dy = xy[i][1] - xy[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      let u = STEP - carry;
      while (u <= len) {
        const x = xy[i - 1][0] + (dx * u) / len;
        const y = xy[i - 1][1] + (dy * u) / len;
        out.push([g[0][0] + y / 110574, g[0][1] + x / kx]);
        u += STEP;
      }
      carry = len - (u - STEP);
      total += len;
    }
    const last = g[g.length - 1];
    out.push([last[0], last[1]]);
    // Entre 300 m y 50 km (más largo serían más de 5.000 puntos guardados en el móvil por tramo).
    if (total < 300 || total > 50000) return null;
    return {
      pts: out.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]),
      largo: Math.round(total),
    };
  }

  // Geometría de trabajo de un tramo: metros locales, distancia acumulada y caja.
  function geometry(tramo) {
    const p0 = tramo.pts[0];
    const toXY = localizer(p0[0], p0[1]);
    const P = tramo.pts.map((p) => toXY(p[0], p[1]));
    const S = [0];
    for (let i = 1; i < P.length; i++)
      S.push(
        S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]),
      );
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of P) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { toXY, P, S, L: S[S.length - 1], box: { x0, y0, x1, y1 } };
  }

  // Proyección de (x, y) sobre los segmentos [j0, j1): { s, d, j }. El primero se alarga hacia atrás (s < 0, antes
  // del principio) y el último hacia delante (s > largo, pasado el final).
  function project(geo, x, y, j0, j1) {
    const { P, S } = geo;
    const n = P.length - 1;
    let best = null;
    for (let j = Math.max(0, j0); j < Math.min(n, j1); j++) {
      const ax = P[j][0];
      const ay = P[j][1];
      const dx = P[j + 1][0] - ax;
      const dy = P[j + 1][1] - ay;
      const len2 = dx * dx + dy * dy || 1;
      let u = ((x - ax) * dx + (y - ay) * dy) / len2;
      if (j > 0) u = Math.max(0, u);
      if (j < n - 1) u = Math.min(1, u);
      const px = ax + dx * u;
      const py = ay + dy * u;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) best = { s: S[j] + u * Math.sqrt(len2), d, j };
    }
    return best;
  }

  // Líneas de salida y de meta: 10 m dentro del trazado por cada lado. Un tramo guardado empieza donde se echó a
  // rodar y acaba donde se paró, así que en esa misma grabación no hay posiciones antes del principio ni después
  // del final: con las líneas en los extremos no se reconocía ni la pasada de la que salió.
  const GATE = 10;

  // Sigue una pasada por un tramo, fijo a fijo (t en s, del reloj que sea; v en m/s). Devuelve null, o
  // { evento: "fin", pasada } al terminar el tramo. estado(t): { en: bool, s, t0, tiempo, frac } para el panel.
  // Las marcas de tiempo van cada 20 m desde la salida (la primera, 0).
  function Tracker(tramo) {
    this.tramo = tramo;
    this.geo = geometry(tramo);
    this.s0 = Math.min(GATE, this.geo.L * 0.05);
    this.s1 = this.geo.L - this.s0;
    this.reset();
  }
  Tracker.prototype.reset = function () {
    this.run = null;
    this.prev = null;
  };
  Tracker.prototype.fix = function (t, lat, lon, v) {
    const geo = this.geo;
    const [x, y] = geo.toXY(lat, lon);
    const b = geo.box;
    // Lejos de todo el tramo (más de 300 m de su caja): nada que mirar.
    if (x < b.x0 - 300 || x > b.x1 + 300 || y < b.y0 - 300 || y > b.y1 + 300) {
      this.reset();
      return null;
    }
    const r = this.run;
    if (!r) {
      // Esperando la salida: cruzarla hacia delante cerca del trazado (en sus primeros 400 m).
      const p = project(geo, x, y, 0, 40);
      const prev = this.prev;
      this.prev = p && p.d < ON ? { t, s: p.s } : null;
      if (
        !p ||
        p.d >= ON ||
        !prev ||
        !(prev.s < this.s0 && p.s >= this.s0 && p.s - prev.s < 200)
      )
        return null;
      const t0 = prev.t + ((t - prev.t) * (this.s0 - prev.s)) / (p.s - prev.s);
      this.run = {
        t0,
        j: p.j,
        last: { t, s: p.s },
        seen: t,
        marks: [0],
        vMax: v || 0,
      };
      this.mark(t0, this.s0, t, p.s);
      return null;
    }
    // En marcha: cerca del último segmento (y hacia delante). Parar en el tramo vale (cuenta en el tiempo); lo que no
    // vale es salirse de él o quedarse sin GPS más de OFF_S.
    const p = project(geo, x, y, r.j - 5, r.j + 60);
    if (!p || p.d >= ON || t - r.seen > OFF_S) {
      if (t - r.seen > OFF_S) this.reset();
      return null;
    }
    r.seen = t;
    if (p.s < r.last.s - 100) {
      // Media vuelta: la pasada no vale.
      this.reset();
      return null;
    }
    if (v > r.vMax) r.vMax = v;
    r.j = p.j;
    if (p.s >= this.s1) {
      const t1 =
        r.last.t +
        ((t - r.last.t) * (this.s1 - r.last.s)) /
          Math.max(1e-6, p.s - r.last.s);
      this.mark(r.last.t, r.last.s, t1, this.s1);
      const pasada = {
        t0: r.t0,
        t1,
        tiempo: Math.round((t1 - r.t0) * 1000) / 1000,
        tiempos: r.marks.map((m) => Math.round(m * 100) / 100),
        vMax: Math.round(r.vMax * 3.6),
      };
      this.reset();
      return { evento: "fin", pasada };
    }
    if (p.s > r.last.s) {
      this.mark(r.last.t, r.last.s, t, p.s);
      r.last = { t, s: p.s };
    }
    return null;
  };
  // Tiempo (desde la salida) en cada marca de 20 m (desde la salida, hasta la meta) entre (ta, sa) y (tb, sb).
  Tracker.prototype.mark = function (ta, sa, tb, sb) {
    const r = this.run;
    for (;;) {
      const s = this.s0 + r.marks.length * MARK;
      if (s > Math.min(sb, this.s1)) break;
      if (s < sa) {
        r.marks.push(ta - r.t0);
        continue;
      }
      const f = sb > sa ? (s - sa) / (sb - sa) : 0;
      r.marks.push(ta + (tb - ta) * f - r.t0);
    }
  };
  Tracker.prototype.estado = function (t) {
    const r = this.run;
    if (!r) return { en: false };
    return {
      en: true,
      s: r.last.s - this.s0,
      t0: r.t0,
      tiempo: t - r.t0,
      // Tiempo en el último fijo (el que corresponde a s).
      tFix: r.last.t - r.t0,
      frac: Math.max(
        0,
        Math.min(1, (r.last.s - this.s0) / (this.s1 - this.s0)),
      ),
    };
  };

  // Todas las pasadas completas por un tramo en una grabación (loc: series de posiciones).
  function findPasses(tramo, loc) {
    const tk = new Tracker(tramo);
    const out = [];
    for (let i = 0; i < loc.t.length; i++) {
      if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
      const r = tk.fix(
        loc.t[i],
        loc.lat[i],
        loc.lon[i],
        loc.speed[i] >= 0 ? loc.speed[i] : 0,
      );
      if (r && r.evento === "fin") out.push(r.pasada);
    }
    return out;
  }

  // Velocidad (km/h) en cada tramo de 20 m de una pasada.
  function speeds(tiempos) {
    const v = [];
    for (let k = 1; k < tiempos.length; k++) {
      const dt = tiempos[k] - tiempos[k - 1];
      v.push(dt > 0 ? (MARK / dt) * 3.6 : NaN);
    }
    return v;
  }

  // Dónde se empieza a frenar (m desde el principio): un máximo de velocidad seguido de una bajada de al menos 15
  // km/h en los 150 m siguientes. Con el GPS del móvil (1 Hz) es aproximado (±20–30 m), pero igual en todas las
  // pasadas, así que sirve para compararlas.
  function brakePoints(tiempos) {
    const v = speeds(tiempos);
    const out = [];
    const win = Math.round(150 / MARK);
    for (let k = 1; k < v.length - 1; k++) {
      if (!(v[k] >= v[k - 1] && v[k] >= v[k + 1])) continue;
      let min = v[k];
      for (let j = k + 1; j <= Math.min(v.length - 1, k + win); j++)
        min = Math.min(min, v[j]);
      if (
        v[k] - min >= 15 &&
        (!out.length || k * MARK - out[out.length - 1] > 100)
      )
        out.push(k * MARK);
    }
    return out;
  }

  // Metros desde la salida (como las marcas) al instante tRel s de la pasada (desde su salida).
  function sAtTime(tiempos, tRel) {
    if (!(tRel >= 0)) return null;
    for (let k = 0; k < tiempos.length - 1; k++)
      if (tiempos[k + 1] >= tRel) {
        const dt = tiempos[k + 1] - tiempos[k];
        return (k + (dt > 0 ? (tRel - tiempos[k]) / dt : 0)) * MARK;
      }
    return null;
  }

  // [lat, lon] del punto del tramo a s m de su salida (para pintar en el mapa dónde se frena). La geometría se
  // guarda aparte (no en el tramo, que va entero al almacén del móvil).
  const geoCache = new WeakMap();
  function pointAt(tramo, s) {
    let geo = geoCache.get(tramo);
    if (!geo) {
      geo = geometry(tramo);
      geoCache.set(tramo, geo);
    }
    const S = geo.S;
    const sa = Math.min(GATE, geo.L * 0.05) + s;
    let j = 0;
    while (j < S.length - 2 && S[j + 1] < sa) j++;
    const f =
      S[j + 1] > S[j]
        ? Math.max(0, Math.min(1, (sa - S[j]) / (S[j + 1] - S[j])))
        : 0;
    const a = tramo.pts[j];
    const b = tramo.pts[j + 1] || a;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  // Diferencia de tiempo (s) a cada marca entre dos pasadas (a − b): negativo, a va por delante.
  function delta(a, b) {
    const n = Math.min(a.length, b.length);
    const out = [];
    for (let k = 0; k < n; k++) out.push(a[k] - b[k]);
    return out;
  }

  const api = {
    STEP,
    MARK,
    fromLoc,
    geometry,
    project,
    Tracker,
    findPasses,
    speeds,
    brakePoints,
    sAtTime,
    pointAt,
    delta,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaTramos = api;
})(typeof window !== "undefined" ? window : globalThis);
