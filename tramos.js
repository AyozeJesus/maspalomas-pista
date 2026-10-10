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
  // m desde la salida en los que estar parado no cuenta (se espera a echar a rodar).
  const START_M = 30;

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
    // Parado al poco de salir (en los primeros START_M): el reloj espera a que eche a rodar. En la subida de Los
    // Loros del 9 de octubre se esperaron 14 s a 20 m de la salida y la pasada los contaba (5:06,9 en vez de 4:52).
    if (!(v > 1) && p.s < this.s0 + START_M) {
      r.t0 = t;
      r.marks = [0];
      r.last = { t, s: Math.max(p.s, this.s0) };
      r.vMax = 0;
      return null;
    }
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

  // ---------- tramos de salida y meta ----------
  // Un tramo también se puede poner solo con su salida y su meta (coordenadas pegadas de Google Maps o la posición de
  // ese momento), sin camino: al pasar por la salida empieza a contar y al llegar a la meta para. La primera pasada
  // le enseña el camino (pts) y desde ahí es un tramo como los demás (marcas cada 20 m, comparar pasadas).
  const GATE_R = 30; // m alrededor de la salida y de la meta
  const GATE_MAX_S = 7200; // s: más de 2 h desde la salida, esa pasada ya no vale

  function isLatLon(p) {
    return (
      Array.isArray(p) &&
      p.length === 2 &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      Math.abs(p[0]) <= 90 &&
      Math.abs(p[1]) <= 180
    );
  }
  // ¿Le falta el camino? (puesto solo con salida y meta, aún sin ninguna pasada)
  function needsPath(tramo) {
    return !(Array.isArray(tramo.pts) && tramo.pts.length > 10);
  }
  // Metros entre dos [lat, lon] (cerca: plano local).
  function meters(a, b) {
    const toXY = localizer(a[0], a[1]);
    const [x, y] = toXY(b[0], b[1]);
    return Math.hypot(x, y);
  }

  // Coordenadas de un texto: «27.923456, -15.567890» (como las copia Google Maps), un enlace de Google Maps
  // (…/@27.92,-15.56,17z · ?q=27.92,-15.56 · ll= · query= · destination= · !3d27.92!4d-15.56), «geo:27.92,-15.56» o en
  // grados («27°55'24.4"N 15°34'04.4"W», con O de oeste también). [lat, lon] (6 decimales, ~10 cm) o null. Los enlaces
  // cortos (maps.app.goo.gl) no llevan las coordenadas: hace falta internet para abrirlos, así que no valen.
  function parseCoords(text) {
    if (typeof text !== "string") return null;
    let s = text.trim();
    if (!s) return null;
    try {
      s = decodeURIComponent(s);
    } catch (e) {
      /* tal cual */
    }
    const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
    const ok = (a, b) => {
      const lat = Number(String(a).replace(",", "."));
      const lon = Number(String(b).replace(",", "."));
      if (!isLatLon([lat, lon]) || (lat === 0 && lon === 0)) return null;
      return [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6];
    };
    let m = new RegExp("!3d" + num + "!4d" + num).exec(s);
    if (m) return ok(m[1], m[2]);
    m = new RegExp(
      "[?&](?:q|ll|query|destination|daddr|saddr|origin|center|sll)=(?:loc:)?" +
        num +
        "\\s*,\\s*" +
        num,
    ).exec(s);
    if (m) return ok(m[1], m[2]);
    m = new RegExp("@" + num + "," + num).exec(s);
    if (m) return ok(m[1], m[2]);
    m = new RegExp("geo:" + num + "," + num).exec(s);
    if (m) return ok(m[1], m[2]);
    // Grados, minutos y segundos.
    const part =
      "(\\d{1,3}(?:[.,]\\d+)?)\\s*°\\s*(?:(\\d{1,2}(?:[.,]\\d+)?)\\s*['′’]\\s*)?(?:(\\d{1,2}(?:[.,]\\d+)?)\\s*(?:[\"″”]|'')\\s*)?";
    m = new RegExp(part + "([NSns])[\\s,;]+" + part + "([EOWeow])").exec(s);
    if (m) {
      const deg = (d, mi, se) =>
        Number(d.replace(",", ".")) +
        (mi ? Number(mi.replace(",", ".")) / 60 : 0) +
        (se ? Number(se.replace(",", ".")) / 3600 : 0);
      const lat = deg(m[1], m[2], m[3]) * (/[Ss]/.test(m[4]) ? -1 : 1);
      const lon = deg(m[5], m[6], m[7]) * (/[WwOo]/.test(m[8]) ? -1 : 1);
      return ok(lat, lon);
    }
    // Dos números sueltos: «27.92, -15.56», «27.92 -15.56» o con coma decimal «27,92; -15,56».
    m = /(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/.exec(s);
    if (m) return ok(m[1], m[2]);
    m = /(-?\d{1,3},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)/.exec(s);
    if (m) return ok(m[1], m[2]);
    return null;
  }

  // Sigue una pasada de salida a meta (tramo puesto con coordenadas o marcado rodando). Cuenta desde el momento en que
  // se pasa más cerca de la salida (a menos de GATE_R; parado allí, desde que se echa a rodar) hasta el momento en que
  // se pasa más cerca de la meta, entre fijos (en línea recta: a 80 km/h hay 22 m de uno a otro). En una carretera de
  // montaña, una curva de otra altura puede pasar a 20–30 m de la salida o de la meta: la salida es la pasada más
  // cerca (si luego se pasa más cerca aún, antes de la meta, se empieza ahí; parándose en ella, también), y la meta solo
  // vale con el camino casi hecho (GATE_DONE, ya aprendido) o, sin camino aún, pasando a menos de GATE_TIGHT (o
  // parando dentro del círculo): en la subida de Los Loros, una herradura de abajo pasa a 25 m de un punto de arriba.
  // Acaba al salir del círculo de la meta o al pararse en él. fix() devuelve null o { evento: "fin", t0, t1 }.
  // estado(t): { en, tiempo, dMeta } para el panel.
  const GATE_TIGHT = 15; // m
  const GATE_DONE = 0.75; // parte del camino hecha para que la meta valga
  const GATE_STALL_S = 300; // s sin avanzar por el camino
  function GateTracker(tramo) {
    this.tramo = tramo;
    this.toXY = localizer(tramo.salida[0], tramo.salida[1]);
    this.B = this.toXY(tramo.meta[0], tramo.meta[1]);
    // Más lejos que esto de la meta (3 veces la distancia en línea recta y 2 km), ya no se va hacia ella.
    this.far = 3 * Math.hypot(this.B[0], this.B[1]) + 2000;
    // Con el camino ya aprendido, por dónde va (para la meta y la diferencia con la mejor pasada en el panel).
    this.geo = needsPath(tramo) ? null : geometry(tramo);
    this.prev = null;
    this.reset();
  }
  GateTracker.prototype.reset = function () {
    this.run = null;
    this.vis = null;
  };
  GateTracker.prototype.fix = function (t, lat, lon, v) {
    const [x, y] = this.toXY(lat, lon);
    const cur = { t, x, y, v: v > 0 ? v : 0 };
    const prev = this.prev && t - this.prev.t <= 5 ? this.prev : null;
    this.prev = cur;
    const moving = cur.v > 1;
    // Lo más cerca de (px, py) desde el fijo anterior hasta este: { d, t }. Si en este se ha parado, llegó frenando
    // (en el doble de lo que se tarda a la velocidad del anterior), no en este fijo.
    const near = (px, py) => {
      if (!prev) return { d: Math.hypot(x - px, y - py), t };
      const dx = x - prev.x;
      const dy = y - prev.y;
      const l2 = dx * dx + dy * dy;
      const u =
        l2 > 0
          ? Math.max(
              0,
              Math.min(1, ((px - prev.x) * dx + (py - prev.y) * dy) / l2),
            )
          : 1;
      const d = Math.hypot(prev.x + dx * u - px, prev.y + dy * u - py);
      const tu =
        !moving && prev.v > 1
          ? Math.min(t, prev.t + (2 * u * Math.sqrt(l2)) / prev.v)
          : prev.t + (t - prev.t) * u;
      return { d, t: tu };
    };
    const a = near(0, 0);
    const b = near(this.B[0], this.B[1]);
    const dB = Math.hypot(x - this.B[0], y - this.B[1]);
    let r = this.run;
    if (a.d < GATE_R && !(r && r.atB)) {
      // Parado en la salida, o pasando más cerca que donde empezó: la salida es ahora.
      if (r && (!moving || a.d < r.dA0)) this.run = r = null;
      if (!r) {
        if (!moving) this.vis = { t, d: Math.hypot(x, y) };
        else if (!this.vis || a.d <= this.vis.d) this.vis = { t: a.t, d: a.d };
        return null;
      }
    } else if (this.vis && !r) {
      // Deja el círculo de la salida: empieza la pasada.
      this.run = r = {
        t0: this.vis.t,
        dA0: this.vis.d,
        atB: null,
        dB,
        j: 0,
        s: 0,
        tS: this.vis.t,
      };
      this.vis = null;
    }
    if (!r) return null;
    r.dB = dB;
    if (this.geo) {
      const [gx, gy] = this.geo.toXY(lat, lon);
      const p = project(this.geo, gx, gy, r.j - 5, r.j + 60);
      if (p && p.d < ON && p.s > r.s) {
        r.s = p.s;
        r.j = p.j;
        r.tS = t;
      }
    }
    // Se fue por otro lado: muy lejos de la meta, o (con camino) 5 min sin avanzar por él. La pasada no vale.
    if (
      t - r.t0 > GATE_MAX_S ||
      dB > this.far ||
      (this.geo && t - r.tS > GATE_STALL_S)
    ) {
      this.reset();
      return null;
    }
    const done = this.geo ? r.s >= GATE_DONE * this.geo.L : true;
    if (b.d < GATE_R && done) {
      if (
        (b.d < (this.geo ? GATE_R : GATE_TIGHT) || !moving) &&
        (!r.atB || b.d < r.atB.d)
      )
        r.atB = { t: b.t, d: b.d };
      // Parado en la meta: ha llegado.
      return !moving && r.atB ? this.finish() : null;
    }
    // Fuera ya del círculo de la meta después de pasar por ella: la pasada acabó en el momento más cerca.
    return r.atB ? this.finish() : null;
  };
  GateTracker.prototype.finish = function () {
    const out = { evento: "fin", t0: this.run.t0, t1: this.run.atB.t };
    this.reset();
    return out;
  };
  // La grabación se acaba dentro aún del círculo de la meta (ya pasada por ella): la pasada está hecha.
  GateTracker.prototype.flush = function () {
    return this.run && this.run.atB ? this.finish() : null;
  };
  GateTracker.prototype.estado = function (t) {
    const r = this.run;
    if (!r) return { en: false };
    return {
      en: true,
      gate: true,
      t0: r.t0,
      tiempo: t - r.t0,
      dMeta: r.dB,
      // Con camino: por dónde va (m desde la salida) y el tiempo en el último fijo que avanzó.
      s: this.geo ? r.s : null,
      tFix: r.tS - r.t0,
      frac: this.geo ? Math.max(0, Math.min(1, r.s / this.geo.L)) : null,
    };
  };

  // Pasadas de salida a meta en las posiciones de una grabación: [{t0, t1}]. open: la que va en marcha al final cuenta
  // hasta el último fijo (al tocar «Meta aquí» se está en la meta aunque no se haya parado aún).
  function findGatePasses(tramo, loc, open) {
    const tk = new GateTracker(tramo);
    const out = [];
    let last = null;
    for (let i = 0; i < loc.t.length; i++) {
      if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
      const r = tk.fix(
        loc.t[i],
        loc.lat[i],
        loc.lon[i],
        loc.speed[i] >= 0 ? loc.speed[i] : 0,
      );
      last = loc.t[i];
      if (r) out.push({ t0: r.t0, t1: r.t1 });
    }
    if (open && tk.run && last !== null && last > tk.run.t0)
      out.push({
        t0: tk.run.t0,
        t1: tk.run.atB ? tk.run.atB.t : last,
      });
    return out;
  }

  // Una vuelta que vuelve a su salida (circuito marcado con «Salida aquí» y «Meta aquí»): tras rodar al menos LOOP_MIN
  // m desde t0, la primera vez que se pasa a menos de LOOP_R de la salida en el mismo sentido que al salir (en un
  // circuito pequeño, otra parte de la pista pasa cerca, pero en otro sentido), el momento en que se está más cerca
  // (entre dos fijos, en línea recta; si se para allí, al llegar). { t, d, after, pending } o null. after: m rodados
  // desde entonces hasta tEnd (se toca «Meta aquí» un poco después de pasar); pending: aún llegando (lo más cerca es el
  // último fijo y va en marcha: la vuelta la cerrará el cronómetro al cruzar la línea).
  const LOOP_MIN = 300;
  const LOOP_R = 50;
  function loopEnd(loc, salida, t0, tEnd) {
    const toXY = localizer(salida[0], salida[1]);
    const F = [];
    for (let i = 0; i < loc.t.length; i++) {
      const t = loc.t[i];
      if (t < t0 || t > tEnd) continue;
      if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
      const [x, y] = toXY(loc.lat[i], loc.lon[i]);
      F.push({ t, x, y, v: loc.speed[i] >= 0 ? loc.speed[i] : 0 });
    }
    // Distancia rodada hasta cada fijo (los ratos parados no suman: el GPS baila).
    const cum = [0];
    for (let i = 1; i < F.length; i++)
      cum.push(
        cum[i - 1] +
          (F[i].v > 2 || F[i - 1].v > 2
            ? Math.hypot(F[i].x - F[i - 1].x, F[i].y - F[i - 1].y)
            : 0),
      );
    // Hacia dónde se sale: de la salida al primer fijo a más de 20 m.
    const out = F.find((f) => Math.hypot(f.x, f.y) > 20);
    const hd = out ? Math.hypot(out.x, out.y) : 0;
    // ¿Llega a i yendo hacia allí? (parado, con lo último que se movió: el GPS parado baila hacia cualquier lado)
    const sameWay = (i) => {
      if (!out) return true;
      for (let j = i; j > 0; j--) {
        if (!(F[j].v > 2 || F[j - 1].v > 2)) continue;
        const dx = F[j].x - F[j - 1].x;
        const dy = F[j].y - F[j - 1].y;
        const l = Math.hypot(dx, dy);
        if (l >= 1) return (dx * out.x + dy * out.y) / (l * hd) > 0.5;
      }
      return true;
    };
    let k = -1;
    for (let i = 1; i < F.length && k < 0; i++)
      if (
        cum[i] >= LOOP_MIN &&
        Math.hypot(F[i].x, F[i].y) < LOOP_R &&
        sameWay(i)
      )
        k = i;
    if (k < 0) return null;
    let best = null;
    for (let i = k - 1; i < F.length - 1; i++) {
      const a = F[i];
      const b = F[i + 1];
      if (i >= k && Math.hypot(a.x, a.y) >= LOOP_R) break;
      if (!(a.v > 2)) break;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const u =
        l2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
      const d = Math.hypot(a.x + dx * u, a.y + dy * u);
      // Parando en b: llega frenando (a ritmo constante, en el doble de lo que tardaría a la velocidad de a), no en b.
      const t =
        b.v > 2
          ? a.t + (b.t - a.t) * u
          : Math.min(b.t, a.t + (2 * u * Math.sqrt(l2)) / a.v);
      if (!best || d < best.d) best = { i, u, d, t };
    }
    if (!best) best = { i: k, u: 0, d: Math.hypot(F[k].x, F[k].y), t: F[k].t };
    const n = F.length - 1;
    const at =
      best.i < n
        ? cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.u
        : cum[n];
    const lastAt = best.i === n || (best.i === n - 1 && best.u >= 1);
    return {
      t: best.t,
      d: best.d,
      after: cum[n] - at,
      pending: lastAt && F[n].v > 2,
    };
  }

  // El camino de un tramo de salida y meta, sacado de una pasada (de t0 a t1, en s de la grabación): de donde se echó a
  // rodar a donde se pasó más cerca de la meta. Es para dibujarlo y comparar pasadas; el tiempo lo siguen dando la
  // salida y la meta (con su margen: un día se arranca 15 m más adelante o se para antes de la meta). {pts, largo} o
  // null (menos de 300 m o más de 50 km).
  function learnPath(tramo, loc, t0, t1) {
    return fromLoc(loc, t0, t1);
  }

  // Una pasada de salida a meta (de t0 a t1) con sus marcas cada 20 m a lo largo del camino del tramo (si lo tiene):
  // las posiciones de entre medias, llevadas al camino y siempre hacia delante, desde 0 (salida) hasta el final (meta).
  function gatePass(tramo, loc, t0, t1) {
    const pas = {
      t0,
      t1,
      tiempo: Math.round((t1 - t0) * 1000) / 1000,
      tiempos: [],
      vMax: 0,
    };
    let vMax = 0;
    for (let i = 0; i < loc.t.length; i++)
      if (loc.t[i] >= t0 && loc.t[i] <= t1 && loc.speed[i] > vMax)
        vMax = loc.speed[i];
    pas.vMax = Math.round(vMax * 3.6);
    if (needsPath(tramo)) return pas;
    const geo = geometry(tramo);
    const L = geo.L;
    const smp = [{ t: t0, s: 0 }];
    let j = 0;
    for (let i = 0; i < loc.t.length; i++) {
      const t = loc.t[i];
      if (t <= t0 || t >= t1) continue;
      if (!(loc.hacc[i] <= 30) || !Number.isFinite(loc.lat[i])) continue;
      const [x, y] = geo.toXY(loc.lat[i], loc.lon[i]);
      const p = project(geo, x, y, j - 5, j + 60);
      if (!p || p.d >= ON) continue;
      j = p.j;
      if (p.s > smp[smp.length - 1].s && p.s < L) smp.push({ t, s: p.s });
    }
    smp.push({ t: t1, s: L });
    let k = 0;
    for (let s = 0; s <= L; s += MARK) {
      while (k < smp.length - 2 && smp[k + 1].s < s) k++;
      const a = smp[k];
      const b = smp[k + 1];
      const f =
        b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
      pas.tiempos.push(Math.round((a.t + (b.t - a.t) * f - t0) * 100) / 100);
    }
    return pas;
  }

  const api = {
    STEP,
    MARK,
    GATE_R,
    fromLoc,
    geometry,
    project,
    Tracker,
    findPasses,
    GateTracker,
    findGatePasses,
    loopEnd,
    learnPath,
    gatePass,
    needsPath,
    isLatLon,
    meters,
    parseCoords,
    speeds,
    brakePoints,
    sAtTime,
    pointAt,
    delta,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaTramos = api;
})(typeof window !== "undefined" ? window : globalThis);
