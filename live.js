// Modo pista: cronómetro, sectores y delta en directo para Maspalomas con el GPS y los sensores del móvil.
(function () {
  "use strict";
  const T = window.MaspaTelemetry;
  const S = window.MaspaSim;
  const GEO = window.MASPA_GEO;
  const F = window.MaspaFormato;
  const ST = window.PistaStore;
  const APP_VERSION = 2;
  // Versión publicada (la misma que la copia de sw.js, «pista-vN»): se ve en la portada.
  const BUILD = 23;
  const G = 9.80665;
  const REC_EVERY = 10; // segundos entre trozos guardados en el móvil
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
  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
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
    {
      cue: false,
      lead: 20,
      finish: { osm: 0, rev: 0 },
      garaje: null,
      piloto: "",
      objetivo: 65.0,
      mapa: true,
      // «Pantalla en pista»: "auto" (como esté el móvil) o la orientación que se fija al salir.
      pantalla: "auto",
      // Aviso de caída en la ruta libre y teléfono de emergencia (opcional).
      caida: true,
      emergencia: "",
    },
    load("pista-ajustes", {}),
  );
  function saveSettings() {
    store("pista-ajustes", settings);
  }
  // Cada piloto tiene su mejor vuelta (si dos comparten móvil, no se mezclan). Sin nombre, la clave de siempre.
  function pilotSlug() {
    return settings.piloto
      ? "-" + encodeURIComponent(settings.piloto.toLowerCase())
      : "";
  }
  function bestKey(dir) {
    return "pista-mejor-" + dir + "-" + settings.finish[dir] + pilotSlug();
  }

  // «1:05,0», «1.05», «65» o «65,5» → segundos (NaN si no se entiende).
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
  function target() {
    const t = Number(settings.objetivo);
    return t >= 40 && t <= 200 ? t : 65.0;
  }

  // La primera vez que se pone nombre, la mejor vuelta guardada sin nombre pasa a ser de ese piloto.
  function setPilot(name) {
    const clean = String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 30);
    const first = !settings.piloto && clean;
    settings.piloto = clean;
    saveSettings();
    if (!first) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^pista-mejor-(osm|rev)-\d+$/.test(k)) keys.push(k);
      }
      for (const k of keys) {
        const nk = k + pilotSlug();
        if (localStorage.getItem(nk) === null)
          localStorage.setItem(nk, localStorage.getItem(k));
      }
    } catch (e) {
      /* sin almacenamiento: empieza de cero */
    }
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

  // Orden de partida de alpha, beta, gamma: Chrome en Android los da en x, y, z (medido en un Pixel 10 Pro);
  // Safari en iPhone, según la norma, en z, x, y. Luego se comprueba con los datos (T.GyroAxes).
  function axesPrior() {
    const ua = navigator.userAgent || "";
    const ios =
      /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return ios ? 1 : 0;
  }

  // free: ruta libre (cualquier carretera, sin circuito ni vueltas).
  function newEngine(sim, free) {
    const route = new window.MaspaRecorrido.Recorrido();
    // Al cerrar una curva o un caballito, el panel enseña su resumen unos segundos.
    route.onCurve = (c) => {
      if (E && E.route === route) {
        E.curveRecap = c;
        E.curveT = now();
      }
    };
    route.onWheelie = (w) => {
      if (E && E.route === route) {
        E.wheelieRecap = w;
        E.wheelieT = now();
      }
    };
    return {
      sim,
      free: !!free,
      // Trazada, curvas, caballitos y máximos (en ruta libre y en el circuito).
      route,
      pitch: new T.PitchEstimator(),
      pitchAxes: 0,
      pitchDeg: NaN,
      aW: NaN,
      aGps: NaN,
      lapTrail: 0,
      curveRecap: null,
      curveT: -Infinity,
      wheelieRecap: null,
      wheelieT: -Infinity,
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
      calib: newCalib(),
      // Aceleración adelante (m/s²): la del acelerómetro en bruto suavizada (aRaw) menos lo que mide de más respecto
      // al GPS (aBias: la pendiente de la carretera, que el acelerómetro ve como aceleración). aEma = aRaw − aBias.
      aEma: 0,
      aRaw: 0,
      aBias: 0,
      // Últimos 6 s de la fuerza específica en sumas acumuladas [t, Σx, Σy, Σz] (medias entre dos instantes).
      sfHist: [],
      sfHead: 0,
      aLast: null,
      aLong: new Series(["t", "a"]),
      // Inclinación con el giroscopio (grados, + derecha) y lo que calcula el móvil, a 10 Hz.
      lean: new T.LeanEstimator(),
      // Orden de los ejes del giro: el simulador ya los da en x, y, z; el navegador, según cuál sea.
      axes: new T.GyroAxes(sim ? 0 : axesPrior()),
      leanDeg: NaN,
      // Ejes de la inclinación: 0 sin ejes; el número de calibración del GPS; o «montaje»/«curvas» mientras
      // tanto (eje adelante por la postura del móvil y la orientación de la pantalla, comprobado en las curvas).
      leanAxes: 0,
      leanKey: null,
      axesVer: 0,
      // «Calibrar»: petición en curso (gravedad de ~1 s quieto) y lo que enseña el botón.
      calReq: null,
      calUi: null,
      calibManual: false,
      screenAngle: screenAngle(),
      mount: null,
      mountChk: null,
      // Lado de la inclinación comprobado con el rumbo del GPS (algunos móviles, como el iPhone, dan los
      // sensores con el signo al revés): +1 normal, −1 al revés.
      leanSign: 1,
      leanVote: 0,
      head: null,
      headFix: null,
      // Último fijo usado para calibrar (a 25 Hz se calibra con fijos separados al menos 0,5 s).
      calPrev: null,
      // Receptor GPS externo: de qué tipo es el último fijo («ble:bonogps», «usb»…; null, el del móvil), si se ha
      // usado en la tanda y qué aparato era (para la grabación).
      extGps: null,
      extUsed: false,
      extInfo: null,
      // Traducción de la hora de los fijos del GPS del móvil al reloj de la tanda, y la hora de pared al empezar
      // (para la fecha de la grabación).
      phoneClock: newClock(),
      wall0: null,
      // Ruta libre por un circuito cualquiera: cronómetro (circuito.js) con el trazado detectado o guardado.
      circ: null,
      circTrack: null,
      circSaved: false,
      circList: free ? loadCircuits() : [],
      circRecent: [],
      circMatchAt: -Infinity,
      circTryAt: -Infinity,
      circBusy: false,
      // Aviso de caída (caida.js), solo en la ruta libre, y lo que ha saltado (para la grabación).
      crash:
        free && settings.caida !== false && window.MaspaCaida
          ? new window.MaspaCaida.CrashDetector()
          : null,
      crashLog: [],
      hasGyro: false,
      moved: false,
      canal: new Series(["t", "s", "v", "a", "lean", "lap"]),
      canalT: -Infinity,
      // Curva en curso, curvas de esta vuelta y resumen de la última curva.
      cw: null,
      lapCorners: [],
      recap: null,
      recapT: -Infinity,
      rec: null,
      analysis: null,
      slowSince: null,
      lag: 0,
      lagR2: null,
      // Último cálculo del retraso del GPS en ruta libre (cada minuto).
      lagAt: -Infinity,
      mode: "ride",
      flashUntil: 0,
    };
  }

  function newCalib() {
    return {
      // Sumas para el eje adelante: aceleración del GPS (y) frente a la fuerza específica media del móvil (X) en
      // cada par de fijos: Σ X·Xᵀ, Σ X·y, Σ X, Σ y y cuántos.
      M: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      y: [0, 0, 0],
      sx: [0, 0, 0],
      sy: 0,
      count: 0,
      // Gravedad con la moto parada (puede estar en el caballete, tumbada: solo si no hay otra cosa).
      up: [0, 0, 0],
      upN: 0,
      // Vertical de la moto rodando (media de la fuerza específica).
      upS: [0, 0, 0],
      upSN: 0,
      f: null,
      fVer: 0,
      gain: null,
      // Eje adelante afinado con el balanceo (alignStep): sumas, eje resultante y su versión.
      al: null,
      fAl: null,
      alVer: 0,
      // «Calibrar»: vertical de la moto parada y derecha (manda sobre la de las rectas, que la comprueba).
      manualU: null,
      manualVer: 0,
      manualChecked: false,
    };
  }

  // El móvil se ha movido en su soporte (o se ha cogido con la mano): se vuelven a aprender sus ejes.
  function resetCalib() {
    const bias = E.lean.bias.slice();
    E.calib = newCalib();
    E.lean = new T.LeanEstimator();
    E.lean.bias = bias;
    E.leanAxes = 0;
    E.leanKey = null;
    E.mountChk = null;
    E.leanDeg = NaN;
    E.aEma = 0;
    E.aRaw = 0;
    E.aBias = 0;
    E.wLp = null;
    E.moved = false;
  }

  // Reloj de la tanda: el de los sensores (timeOrigin + performance.now, el de event.timeStamp), en segundos. No el
  // de pared (Date.now): en Android el de los sensores no cuenta el tiempo con el móvil dormido, así que con la
  // página abierta desde antes los dos se separan, y el de pared salta si el móvil se pone en hora. Las horas del
  // GPS (las del navegador o las del receptor externo) se traducen a este reloj con mapClock.
  function perfNow() {
    return (performance.timeOrigin + performance.now()) / 1000;
  }

  function now() {
    return E.sim ? sim.t : perfNow() - E.t0;
  }

  function newClock() {
    return { off: null, at: 0 };
  }

  // Hora (ms) de un fijo en el reloj de los sensores. Su propia hora (srcMs: la del receptor o la que le pone el
  // navegador) da los intervalos exactos; la llegada (rxMs, ya en ese reloj), solo el desfase entre los dos relojes:
  // el menor de los recientes, el del fijo que menos tardó (el Bluetooth y el navegador los entregan con retraso
  // variable). Sube como mucho 2 ms por segundo (deriva entre relojes) y, si de golpe es medio segundo mayor (un
  // reloj se ha puesto en hora), se toma el nuevo. Sin hora propia, la de llegada.
  function mapClock(c, srcMs, rxMs) {
    if (!Number.isFinite(srcMs)) {
      c.off = null;
      return rxMs;
    }
    const d = rxMs - srcMs;
    if (c.off === null || d < c.off || d - c.off > 500) c.off = d;
    else c.off = Math.min(d, c.off + (rxMs - c.at) * 0.002);
    c.at = rxMs;
    return srcMs + c.off;
  }

  function setupTrack(dir) {
    E.dir = dir;
    E.track = T.buildTrack(dir, settings.finish[dir]);
    const ref = T.reference(E.track, 65.0, S.MAPS.repro.power);
    E.corners = ref.corners;
    E.bounds = T.sectorBounds(ref.corners, E.track.L);
    // El sector k (S1…S4) contiene la k-ésima curva en orden de paso desde meta.
    E.cornerBySector = ref.corners.slice().sort((a, b) => a.sApex - b.sApex);
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

  // Fijo bueno (ya sin rebotes): aceleración según el GPS (referencia del cabeceo) y trazada del recorrido.
  function acceptFix(prev, fix) {
    if (prev && fix.t > prev.t && fix.t - prev.t < 3) {
      const dt = fix.t - prev.t;
      const inst = (fix.v - prev.v) / dt;
      // Media que olvida la mitad por segundo (a 1 Hz, la mitad por fijo; a 25 Hz, cada fijo cuenta poco).
      const k = 1 - Math.pow(0.5, dt);
      E.aGps = E.aGps === E.aGps ? E.aGps + (inst - E.aGps) * k : inst;
    }
    E.route.fast = !!E.extGps;
    E.route.onFix(fix.t, fix.x, fix.y, fix.v);
  }

  function onFix(t, lat, lon, speed, hacc) {
    // Un fijo que no es posterior al anterior (al cambiar entre el receptor externo y el GPS del móvil, que van con
    // relojes y retrasos distintos) desordenaría la grabación y el cronómetro: se descarta.
    if (E.lastFixT !== null && !(t > E.lastFixT)) return;
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
      // En ruta libre no se busca el circuito: cualquier carretera vale.
      if (!E.free) detectDir(x, y, v);
      if (!E.track) {
        const fix = { t, x, y, v, s: null, i: null, on: false };
        acceptFix(E.fix, fix);
        calibStep(fix);
        E.fix = fix;
        // Lejos del circuito (prueba en coche o por la calle): el panel lo dice en vez de «buscando la pista».
        E.far =
          E.free ||
          T.nearestOn(GEO.main, x, y, 0, GEO.main.length - 1).dist > 300;
        if (!E.free) pitsCheck(t, v, false);
        else {
          // Sin vueltas que lo pidan: el retraso del GPS se recalcula cada minuto.
          if (!(t - E.lagAt < 60)) {
            E.lagAt = t;
            estimateLag();
          }
          circStep(t, lat, lon, v);
          if (E.crash) {
            const ev = E.crash.fix(t, v);
            if (ev) crashAlarm(ev);
          }
        }
        return;
      }
    }
    const tr = E.track;
    let m =
      E.fix && E.fix.on
        ? T.nearestOn(tr.C, x, y, E.fix.i - 6, E.fix.i + 45)
        : null;
    if (!m || m.dist > T.ON_TRACK_M) m = T.nearestOn(tr.C, x, y, 0, tr.n - 1);
    const s = tr.cs[m.i] + (tr.cs[m.i + 1] - tr.cs[m.i]) * m.f;
    const on = m.dist < T.ON_TRACK_M && v > 4;
    const prev = E.fix;
    // Rebote del GPS: un fijo suelto fuera del trazado, o que salta más de lo que permite la velocidad, se
    // ignora (queda en la grabación, pero no mueve el cronómetro ni corta la vuelta). Si dura más de 3 s,
    // es de verdad (entrada a boxes, GPS perdido) y se acepta.
    if (prev && prev.on && t - prev.t < 3) {
      let bounce = !on && v > 4;
      if (on) {
        const L = tr.L;
        let ds = s - prev.s;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        const dt = t - prev.t;
        if (Math.abs(ds - ((v + prev.v) / 2) * dt) > 25 + 10 * dt)
          bounce = true;
      }
      if (bounce) {
        E.bounces = (E.bounces || 0) + 1;
        return;
      }
    }
    const fix = { t, x, y, v, s, i: m.i, on };
    acceptFix(prev, fix);
    // Lado de la inclinación: en una curva a derechas (en el plano, con y hacia el sur, el rumbo crece) la moto
    // va tumbada a derechas (+). Si los votos dicen lo contrario, el móvil da los sensores con el signo al revés.
    // Rumbos entre fijos separados al menos 0,7 s: a 1 Hz son todos; a 25 Hz, entre fijos seguidos hay 1–2 m.
    if (prev && prev.on && on && t - prev.t < 2.5) {
      let a = E.headFix;
      if (!a || t - a.t > 2.5) {
        a = prev;
        E.headFix = prev;
        E.head = null;
      }
      if (t - a.t >= 0.7) {
        const h = Math.atan2(y - a.y, x - a.x);
        if (E.head !== null && Math.hypot(x - a.x, y - a.y) > 5) {
          let dh = h - E.head;
          while (dh > Math.PI) dh -= 2 * Math.PI;
          while (dh < -Math.PI) dh += 2 * Math.PI;
          if (Math.abs(dh) > 0.12 && Math.abs(E.leanDeg) > 10) {
            E.leanVote = clamp(
              E.leanVote + Math.sign(dh) * Math.sign(E.leanDeg),
              -20,
              20,
            );
            if (E.leanVote <= -6) {
              E.leanSign = -E.leanSign;
              E.leanVote = 0;
            }
          }
        }
        E.head = h;
        E.headFix = fix;
      }
    } else {
      E.head = null;
      E.headFix = null;
    }
    calibStep(fix);
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
    E.crossings = E.crossings || [];
    E.crossings.push(tc);
    if (E.lapStart !== null) finishLap(tc);
    E.lapStart = tc;
    E.lapNum += 1;
    E.lapSamples = [{ s: 0, tl: 0 }];
    E.lapSpeeds = [];
    E.lapOk = true;
    E.lapCorners = [];
    E.lapTrail = E.route.trail.length;
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
    // Los instantes se piden en orden: se sigue desde donde se quedó (con 25 fijos por segundo, empezar cada vez
    // desde el principio de la vuelta serían millones de pasos).
    let j = 0;
    const sOfT = (t) => {
      const tl = t - lapStart;
      if (j > 0 && samples[j].tl > tl) j = 0;
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
    // Lo medido curva a curva en esta vuelta (sin la comparación, que solo vale para el directo).
    const corners = E.bounds.map((_, k) => {
      const c = E.lapCorners[k];
      return c
        ? {
            num: c.num,
            leanMax: c.leanMax,
            gMax: c.gMax,
            vMin: c.vMin,
            brakeS: c.brakeS,
            brk: c.brk,
            time: c.time,
          }
        : null;
    });
    const lap = { num: E.lapNum, time, valid, corners };
    E.laps.push(lap);
    if (!valid) {
      saveMeta("grabando");
      return;
    }
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
        corners,
        date: new Date().toISOString(),
      };
      if (!E.sim) store(bestKey(E.dir), E.best);
    }
    showLapFlash(time, isBest, prevBest);
    estimateLag();
    saveMeta("grabando");
  }

  // ---------- sensores ----------
  // Fuerza específica de los últimos 6 s en sumas acumuladas: la media entre dos instantes cualesquiera sale de
  // restar dos sumas (para compararla con el GPS en el mismo tramo de tiempo, ya descontado su retraso).
  function sfPush(t, sf) {
    const H = E.sfHist;
    const last = H.length > E.sfHead ? H[H.length - 1] : null;
    H.push(
      last
        ? [t, last[1] + sf[0], last[2] + sf[1], last[3] + sf[2]]
        : [t, sf[0], sf[1], sf[2]],
    );
    while (H.length - E.sfHead > 2 && t - H[E.sfHead][0] > 6) E.sfHead++;
    if (E.sfHead > 2000) {
      E.sfHist = H.slice(E.sfHead);
      E.sfHead = 0;
    }
  }
  // Media de la fuerza específica (m/s², ejes del móvil) entre ta y tb (s), o null si no hay suficiente historial.
  function sfMean(ta, tb) {
    const H = E.sfHist;
    const at = (tt) => {
      let lo = E.sfHead - 1;
      let hi = H.length - 1;
      if (hi < 0 || H[E.sfHead][0] > tt) return -1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (H[mid][0] <= tt) lo = mid;
        else hi = mid;
      }
      return H[hi][0] <= tt ? hi : lo;
    };
    const i0 = at(ta);
    const i1 = at(tb);
    if (i0 < E.sfHead || i1 - i0 < 5) return null;
    const n = i1 - i0;
    return [
      (H[i1][1] - H[i0][1]) / n,
      (H[i1][2] - H[i0][2]) / n,
      (H[i1][3] - H[i0][3]) / n,
    ];
  }

  // Pares de fijos para calibrar separados al menos 0,5 s: a 1 Hz son todos; a 25 Hz, la diferencia de velocidad
  // entre fijos seguidos sería casi todo ruido.
  function calibStep(fix) {
    const prev = E.calPrev;
    if (prev && fix.t > prev.t && fix.t - prev.t < 0.5) return;
    calibPair(prev, fix);
    E.calPrev = fix;
  }

  // Vertical de referencia de la moto: la de «Calibrar» o la de rodar (con al menos 5 s de datos).
  function upRefOf(cal) {
    return cal.manualU || (cal.upSN >= 300 ? cal.upS : null);
  }
  // Adelante para la inclinación y el cabeceo: el afinado con el balanceo si ya lo hay (y apunta hacia el mismo lado
  // que el del GPS); si no, el del GPS.
  function forwardOf(cal) {
    return cal.fAl && dot3(cal.fAl, cal.f) > 0.5 ? cal.fAl : cal.f;
  }
  // Qué ejes hay puestos: cambia con cada eje nuevo del GPS, de «Calibrar» o del afinado.
  function gpsKeyOf(cal) {
    return "gps:" + cal.fVer + ":" + cal.manualVer + ":" + cal.alVer;
  }

  // Eje adelante afinado con el balanceo. El del GPS (la dirección en la que el acelerómetro mejor explica la
  // aceleración) puede salir girado alrededor de la vertical: en 4 rutas de un Vivo Y33s, hasta 30°, y la
  // aceleración apenas lo nota (es casi igual de parecida a la del GPS con 30° de error). El cabeceo sí: con el eje
  // girado un ángulo β, el balanceo (ω·f) se cuela en el cabeceo como β·ω·f, y al cambiar de lado en unas curvas
  // enlazadas (1–2 rad/s de balanceo) el morro «subía» 10–20° (caballitos falsos). El balanceo y el cabeceo de
  // verdad no tienen nada que ver, así que el eje bueno es el que deja la suma Σ cabeceo·balanceo en 0. Con
  // medias de 0,1 s rodando a más de 8 m/s, en una base fija (e1, e2) perpendicular a la vertical: con
  // f = cos α·e1 + sen α·e2 y l = u × f = cos α·e2 − sen α·e1, la suma es
  // sen α·cos α·(A22 − A11) + (cos²α − sen²α)·A12 − cos α·B1 − sen α·B2 (A, productos del giro en el plano por
  // cos φ; B, del giro vertical por sen φ). Se toma la raíz más cercana al eje que ya se usa. En esas rutas, a
  // partir del primer medio minuto ya no se movía más de 1–2°.
  // w: giro sin sesgo (rad/s, ejes del móvil); phi: inclinación en los ejes del estimador (rad).
  function alignStep(t, w, phi) {
    const c = E.calib;
    const L = E.lean;
    let a = c.al;
    // La base se fija con la vertical de ese momento; si la vertical cambia más de 3°, se empieza de nuevo.
    if (!a || dot3(a.u, L.u) < 0.9986) {
      a = c.al = {
        u: L.u.slice(),
        e1: L.f.slice(),
        e2: L.l.slice(),
        A11: 0,
        A12: 0,
        A22: 0,
        B1: 0,
        B2: 0,
        n: 0,
        m: [0, 0, 0],
        phi: 0,
        k: 0,
        t0: t,
      };
    }
    a.m[0] += dot3(w, a.e1);
    a.m[1] += dot3(w, a.e2);
    a.m[2] += dot3(w, a.u);
    a.phi += phi;
    a.k++;
    if (t - a.t0 < 0.1) return;
    const m1 = a.m[0] / a.k;
    const m2 = a.m[1] / a.k;
    const mu = a.m[2] / a.k;
    const ph = a.phi / a.k;
    a.m = [0, 0, 0];
    a.phi = 0;
    a.k = 0;
    a.t0 = t;
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    a.A11 += m1 * m1 * cp;
    a.A12 += m1 * m2 * cp;
    a.A22 += m2 * m2 * cp;
    a.B1 += mu * sp * m1;
    a.B2 += mu * sp * m2;
    a.n++;
    // Con poco giro en el plano (menos de ~0,05 rad/s de media) no hay nada que comparar: la suma sería 0 con
    // cualquier eje.
    if (a.n < 300 || a.n % 100 || (a.A11 + a.A22) / a.n < 0.002) return;
    const g = (al) => {
      const s = Math.sin(al);
      const co = Math.cos(al);
      return (
        s * co * (a.A22 - a.A11) +
        (co * co - s * s) * a.A12 -
        co * a.B1 -
        s * a.B2
      );
    };
    // Ángulo del eje en uso dentro de la base, y la raíz más cercana (±60°) buscando cambios de signo.
    const a0 = Math.atan2(dot3(L.f, a.e2), dot3(L.f, a.e1));
    let best = null;
    const STEP = Math.PI / 360;
    for (let x = a0 - Math.PI / 3; x < a0 + Math.PI / 3; x += STEP) {
      const g0 = g(x);
      const g1 = g(x + STEP);
      if (g0 === 0 || g0 * g1 < 0) {
        const r = x + (STEP * g0) / (g0 - g1);
        if (best === null || Math.abs(r - a0) < Math.abs(best - a0)) best = r;
      }
    }
    if (best === null) return;
    const f = norm3([
      Math.cos(best) * a.e1[0] + Math.sin(best) * a.e2[0],
      Math.cos(best) * a.e1[1] + Math.sin(best) * a.e2[1],
      Math.cos(best) * a.e1[2] + Math.sin(best) * a.e2[2],
    ]);
    // Solo si cambia algo (más de medio grado): cada cambio rehace los ejes.
    if (c.fAl && dot3(f, c.fAl) > 0.99996) return;
    c.fAl = f;
    c.alVer++;
  }

  function calibPair(prev, fix) {
    const c = E.calib;
    // Vale cualquier tramo en marcha con buen GPS (circuito, carretera o en coche), no solo el trazado. El fijo dice
    // la velocidad de hace `lag` s: el acelerómetro se toma en ese mismo tramo.
    if (
      !prev ||
      !(prev.v > 4 && fix.v > 4) ||
      !(fix.t > prev.t && fix.t - prev.t < 2.5)
    )
      return;
    const lag = lagNow();
    const X = sfMean(prev.t - lag, fix.t - lag);
    if (!X) return;
    const Y = (fix.v - prev.v) / (fix.t - prev.t);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) c.M[r][k] += X[r] * X[k];
      c.y[r] += X[r] * Y;
      c.sx[r] += X[r];
    }
    c.sy += Y;
    c.count++;
    // Lo que el acelerómetro mide de más respecto al GPS, en media lenta (15 s): sobre todo la pendiente de la
    // carretera (la gravedad a lo largo de la cuesta: subiendo, el acelerómetro lo cuenta como acelerar; bajando,
    // como frenar). Lenta, porque cada par de fijos trae el ruido del retraso del GPS.
    if (c.f) {
      const k = 1 - Math.exp(-(fix.t - prev.t) / 15);
      E.aBias += (dot3(X, c.f) - Y - E.aBias) * k;
    }
    if (c.count >= 30 && c.count % 10 === 0) solveForward(c);
  }

  // Eje adelante: la dirección, perpendicular a la vertical, en la que el acelerómetro mejor explica la aceleración
  // del GPS. Con término independiente (la fuerza específica lleva la gravedad, que no cambia con la aceleración).
  function solveForward(c) {
    const ref = upRefOf(c) || (c.upN > 50 ? c.up : null);
    if (!ref) return;
    const u = norm3(ref);
    // Base del plano perpendicular a u: el eje del móvil más tumbado respecto a u, y u × ese.
    const ax = [0, 1, 2].sort((a, b) => Math.abs(u[a]) - Math.abs(u[b]))[0];
    const e = [0, 0, 0];
    e[ax] = 1;
    const e1 = norm3([
      e[0] - u[ax] * u[0],
      e[1] - u[ax] * u[1],
      e[2] - u[ax] * u[2],
    ]);
    const e2 = [
      u[1] * e1[2] - u[2] * e1[1],
      u[2] * e1[0] - u[0] * e1[2],
      u[0] * e1[1] - u[1] * e1[0],
    ];
    const Me = (a, b) =>
      dot3(a, [dot3(c.M[0], b), dot3(c.M[1], b), dot3(c.M[2], b)]);
    // Un poco de regularización: con poca aceleración en un eje la matriz queda casi singular.
    const lam = 1e-3 * (Me(e1, e1) + Me(e2, e2) || 1);
    const A = [
      [Me(e1, e1) + lam, Me(e1, e2), dot3(e1, c.sx)],
      [Me(e2, e1), Me(e2, e2) + lam, dot3(e2, c.sx)],
      [dot3(e1, c.sx), dot3(e2, c.sx), c.count],
    ];
    const w = solve3(A, [dot3(e1, c.y), dot3(e2, c.y), c.sy]);
    if (!w || !(Math.hypot(w[0], w[1]) > 0)) return;
    const f = norm3([
      w[0] * e1[0] + w[1] * e2[0],
      w[0] * e1[1] + w[1] * e2[1],
      w[0] * e1[2] + w[1] * e2[2],
    ]);
    // Un eje nuevo muy distinto deja de valer la pendiente aprendida con el anterior.
    if (c.f && dot3(c.f, f) < 0.9) E.aBias = 0;
    c.f = f;
    c.gain = Math.hypot(w[0], w[1]);
    c.fVer++;
  }

  // gyroRaw: giro en rad/s en el orden que da el navegador (se graba así; el análisis también lo comprueba).
  function onMotion(t, lin, grav, gyroRaw) {
    E.acc.push({ t, x: lin[0], y: lin[1], z: lin[2] });
    E.grav.push({ t, x: grav[0], y: grav[1], z: grav[2] });
    E.gyro.push({ t, x: gyroRaw[0], y: gyroRaw[1], z: gyroRaw[2] });
    if (gyroRaw[0] || gyroRaw[1] || gyroRaw[2]) E.hasGyro = true;
    const before = E.axes.choice * 2 + E.axes.sign;
    E.axes.add(t, grav, gyroRaw);
    if (E.axes.choice * 2 + E.axes.sign !== before) {
      // Ejes corregidos: la inclinación vuelve a empezar con los buenos.
      E.lean = new T.LeanEstimator();
      E.leanAxes = 0;
      E.leanKey = null;
    }
    const gyro = E.axes.map(gyroRaw);
    const c = E.calib;
    // Lo que mide de verdad el acelerómetro (fuerza específica: aceleración + gravedad). La aceleración «lineal» y la
    // gravedad que separa Android salen de una fusión que la vibración de la moto estropea (medido en un Vivo Y33s:
    // su gravedad se desvía hasta 11° de la real y su aceleración adelante apenas se parece a la del GPS, r 0,4–0,8,
    // frente a r 0,75–0,9 de la suma).
    const sf = [lin[0] + grav[0], lin[1] + grav[1], lin[2] + grav[2]];
    sfPush(t, sf);
    const v = E.fix ? E.fix.v : 0;
    const spin = Math.hypot(gyro[0], gyro[1], gyro[2]);
    // Vertical de la moto: la media de la fuerza específica rodando. En un giro equilibrado apunta al suelo de la
    // moto, así que curvas y rectas valen igual, y la vibración se va en la media (con el soporte vibrando, buscar
    // rectas sin giro no funcionaba: casi ninguna muestra bajaba de 0,06 rad/s). Acelerando o frenando, la media se
    // inclina hacia adelante o atrás (saliendo de boxes a fondo, 12° en los primeros segundos): con eje adelante se le
    // quita a cada muestra la aceleración que mide el acelerómetro; sin él, solo valen las de aceleración suave según
    // el GPS (menos de 0,1 g; en un circuito, pocas).
    if (v > 5 && (c.f || Math.abs(E.aGps) < 1)) {
      const a = c.f ? E.aEma : 0;
      c.upS[0] += sf[0] - a * (c.f ? c.f[0] : 0);
      c.upS[1] += sf[1] - a * (c.f ? c.f[1] : 0);
      c.upS[2] += sf[2] - a * (c.f ? c.f[2] : 0);
      c.upSN++;
    }
    if (v < 0.5) {
      c.up[0] += grav[0];
      c.up[1] += grav[1];
      c.up[2] += grav[2];
      c.upN++;
    }
    // Parado, un giro brusco es el móvil en la mano o recolocado: ejes nuevos al volver a rodar.
    if (v < 2 && spin > 1.5) E.moved = true;
    else if (E.moved && v > 8) resetCalib();
    const dt =
      E.aLast === null ? 0.02 : Math.max(0.001, Math.min(0.1, t - E.aLast));
    E.aLast = t;
    if (E.calib.f) {
      // Media de 0,2 s: con la vibración, una muestra suelta lleva ±1 g de ruido (la fase la sostiene recorrido.js).
      E.aRaw += (dot3(sf, E.calib.f) - E.aRaw) * (1 - Math.exp(-dt / 0.2));
      E.aEma = E.aRaw - E.aBias;
      E.aLong.push({ t, a: E.aEma });
    }
    const cal = E.calib;
    // Vertical de la moto: la de «Calibrar» (parada y derecha) o, si no, la de rodar.
    const upRef = upRefOf(cal);
    if (E.crash) {
      const ev = E.crash.motion(t, lin, grav, upRef);
      if (ev) crashAlarm(ev);
    }
    if (E.calReq) calibCollect(t, grav, gyro);
    const gpsKey = gpsKeyOf(cal);
    if (E.hasGyro && cal.f && upRef && E.leanKey !== gpsKey) {
      E.lean.setAxes(forwardOf(cal), upRef);
      E.leanAxes = cal.fVer;
      E.leanKey = gpsKey;
      E.axesVer++;
      E.mountChk = null;
    } else if (E.hasGyro && !cal.f && !E.leanAxes && upRef) {
      // Mientras el GPS no calibra (hace falta acelerar y frenar): desde «Calibrar» o la primera recta, el eje
      // adelante que dicen la postura del móvil y la orientación de la pantalla (plano en horizontal, de pie…).
      const m = mountOf(upRef);
      if (m) {
        E.lean.setAxes(m.f, m.u);
        E.leanAxes = "montaje";
        E.leanKey = "montaje";
        E.axesVer++;
        E.mount = { postura: m.posture, pantalla: m.screen };
        E.mountChk = { uu: 0, fu: 0, lu: 0 };
      }
    }
    checkManualCalib();
    const p = E.track && E.fix && E.fix.on ? predicted(t) : null;
    const vNow = p ? p.v : E.fix ? E.fix.v : NaN;
    // La inclinación sale de la velocidad de ahora: la del último fijo (de hace `lag` s) adelantada con la
    // aceleración (frenando fuerte, en 1 s cambia 10 m/s).
    const vLean = p || !E.fix ? vNow : rideSpeed(t);
    E.leanDeg = E.hasGyro
      ? E.leanSign * E.lean.step(dt, gyro, vLean, grav)
      : NaN;
    cornerTrack(t, p);
    rideStep(t, dt, gyro, lin, grav, p, vNow);
    if (t - E.canalT >= 0.1) {
      E.canalT = t;
      E.canal.push({
        t,
        s: p ? p.s : NaN,
        v: vNow,
        a: cal.f ? E.aEma / G : NaN,
        lean: E.leanDeg,
        lap: E.lapNum,
      });
    }
  }

  // Comprueba con las curvas el eje adelante del montaje. En curva la moto gira sobre la vertical del mundo, que
  // vista desde la moto tumbada cae en su vertical y en su eje lateral, y siempre hacia el mismo lado: a
  // derechas (giro −Ω, tumbada φ > 0) ω·l = −Ω·sen φ; a izquierdas (+Ω, φ < 0) ω·l = Ω·sen φ: negativo en las
  // dos. Sobre el eje adelante solo cae el balanceo, que se anula (se tumba y se levanta). Si el giro de las
  // curvas cae sobre el «adelante» supuesto (giro automático de la pantalla desactivado, móvil al revés…), el
  // eje lateral de verdad es el que lo explica: se corrige con él.
  // w: giro sin sesgo (rad/s, ejes del móvil); v: velocidad (m/s).
  function mountCheck(w, v, dt) {
    const k = E.mountChk;
    const L = E.lean;
    if (!L.f || !(v > 8)) return;
    const wu = Math.abs(dot3(w, L.u));
    if (wu < 0.15) return;
    k.uu += wu * wu * dt;
    k.fu += dot3(w, L.f) * wu * dt;
    k.lu += dot3(w, L.l) * wu * dt;
    // Unas cuantas curvas (una de 3 s a 0,4 rad/s da ~0,5).
    if (k.uu < 1) return;
    E.mountChk = { uu: 0, fu: 0, lu: 0 };
    // Puntuación de cada eje lateral posible (−Σ ω·l·|ω·u| / Σ ω·u²): con el bueno sale tan φ de media (0,5–1
    // en la tanda de ejemplo); con los otros, solo el balanceo, que en un par de curvas aún no se anula (±0,7).
    // Por eso no se busca un ángulo fino: el montaje solo puede equivocarse en saltos de 90° (la orientación
    // de la pantalla), y se cambia solo si el eje actual no lo explica y otro claramente sí.
    const sl = -k.lu / k.uu;
    if (sl > 0.3) return;
    const cands = [
      [-sl, L.l.map((x) => -x)],
      [-k.fu / k.uu, L.f],
      [k.fu / k.uu, L.f.map((x) => -x)],
    ];
    cands.sort((a, b) => b[0] - a[0]);
    if (cands[0][0] < 0.45) return;
    const lt = cands[0][1];
    const u = L.u;
    // adelante = lateral × vertical (con l = u × f).
    L.setAxes(
      [
        lt[1] * u[2] - lt[2] * u[1],
        lt[2] * u[0] - lt[0] * u[2],
        lt[0] * u[1] - lt[1] * u[0],
      ],
      u,
    );
    E.leanAxes = "curvas";
    E.axesVer++;
    // Los ejes ya están bien por la física de las curvas: lo que hubiera votado el GPS sobre el signo
    // (pensando en estos ejes girados) ya no vale.
    E.leanSign = 1;
    E.leanVote = 0;
  }

  // ---------- «Calibrar»: la moto parada y derecha es el cero ----------
  // Para un móvil que no queda recto en su hueco: con la moto parada y derecha (sentado en ella o en el caballete
  // de taller) y el móvil ya en el soporte, la gravedad media de ~1 s con el móvil quieto es la vertical de la
  // moto. Tumbada y morro quedan a 0 y la inclinación sale desde ya, sin esperar a rodar.
  const CALIB_STOPPED = 2; // m/s: por encima no se ofrece (rodando, nada de tocar el móvil)
  // Ejes del montaje para una vertical dada en cualquier escala (suma de muestras o vector unidad): mountAxes
  // espera m/s² y descarta lo que no llega a 3 como ruido.
  function mountOf(up) {
    return T.mountAxes(
      norm3(up).map((x) => x * G),
      E.screenAngle,
    );
  }
  function isStopped() {
    return !E.fix || !(E.fix.v >= CALIB_STOPPED);
  }
  // Devuelve false si no se puede ahora (y por qué en E.calUi).
  function startCalib() {
    if (!E || E.sim) return false;
    const nowMs = performance.now();
    if (E.calReq) return false;
    if (!isStopped()) {
      E.calUi = {
        state: "fail",
        why: "para la moto",
        until: nowMs + 4000,
      };
      return false;
    }
    E.calReq = { t0: null, n: 0, sum: [0, 0, 0], started: nowMs };
    E.calUi = { state: "busy", why: "", until: Infinity };
    // Si en 4 s no ha habido 1 s quieto (o no llegan datos), se deja.
    setTimeout(() => {
      if (!E || !E.calReq) return;
      E.calReq = null;
      E.calUi = {
        state: "fail",
        why: E.hasGyro ? "no estaba quieto" : "sin sensores",
        until: performance.now() + 5000,
      };
    }, 4000);
    return true;
  }
  function calibCollect(t, grav, gyro) {
    const q = E.calReq;
    const b = E.lean.bias;
    const spin = Math.hypot(gyro[0] - b[0], gyro[1] - b[1], gyro[2] - b[2]);
    // Se mueve (o se está colocando): vuelta a empezar.
    if (spin > 0.1 || !isStopped()) {
      q.t0 = null;
      q.n = 0;
      q.sum = [0, 0, 0];
      return;
    }
    if (q.t0 === null) q.t0 = t;
    for (let i = 0; i < 3; i++) q.sum[i] += grav[i];
    q.n++;
    if (q.n >= 40 && t - q.t0 >= 0.8) {
      E.calReq = null;
      applyManualCalib(q.sum);
      E.calUi = { state: "ok", why: "", until: performance.now() + 2500 };
    }
  }
  function applyManualCalib(sum) {
    const cal = E.calib;
    const u = norm3(sum);
    cal.manualU = u;
    cal.manualVer++;
    cal.manualChecked = false;
    // El móvil ya está en su sitio: lo que se hiciera antes para colocarlo no debe borrar esta calibración al
    // echar a rodar.
    E.moved = false;
    E.screenAngle = screenAngle();
    // Adelante: el del GPS si ya lo hay; si no, el que ya se usaba; si no, el del montaje.
    let f = cal.f ? forwardOf(cal) : E.lean.f;
    if (!f) {
      const m = mountOf(u);
      if (m) {
        f = m.f;
        E.mount = { postura: m.posture, pantalla: m.screen };
      }
    }
    if (!f || !E.hasGyro) return;
    E.lean.setAxes(f, u);
    E.lean.phi = 0;
    if (cal.f) {
      E.leanAxes = cal.fVer;
      E.leanKey = gpsKeyOf(cal);
    } else {
      if (!E.leanAxes) {
        E.leanAxes = "montaje";
        E.mountChk = { uu: 0, fu: 0, lu: 0 };
      }
      E.leanKey = "montaje";
    }
    E.axesVer++;
    E.pitch.setAxes(E.lean.f, E.lean.u);
    E.pitch.theta = 0;
    E.pitchAxes = E.axesVer;
    E.leanDeg = 0;
    E.calibManual = true;
  }
  // Si se calibró con la moto tumbada (en la pata de cabra), rodar lo delata: de media, la moto va derecha. Con
  // 1200 muestras rodando suave (20 s a 60 Hz; con la vibración, la media de menos tiembla 2–3°), si la vertical de
  // «Calibrar» se separa más de 5° hacia un lado de la de rodar, se corrige ese lado (el cero del morro se respeta)
  // y se avisa.
  function checkManualCalib() {
    const cal = E.calib;
    const L = E.lean;
    if (!cal.manualU || cal.manualChecked || cal.upSN < 1200 || !L.l) return;
    cal.manualChecked = true;
    const up = norm3(cal.upS);
    const d = Math.atan2(dot3(up, L.l), dot3(up, L.u));
    if (Math.abs(d) < (5 * Math.PI) / 180) return;
    const c = Math.cos(d);
    const s = Math.sin(d);
    cal.manualU = norm3([
      c * L.u[0] + s * L.l[0],
      c * L.u[1] + s * L.l[1],
      c * L.u[2] + s * L.l[2],
    ]);
    cal.manualVer++;
    L.setAxes(L.f, cal.manualU);
    E.leanKey = cal.f ? gpsKeyOf(cal) : "montaje";
    E.axesVer++;
    E.calUi = {
      state: "note",
      why:
        "corregida en recta (" +
        Math.round((Math.abs(d) * 180) / Math.PI) +
        "°)",
      until: performance.now() + 8000,
    };
  }
  function calibUi() {
    return E && E.calUi && E.calUi.until > performance.now() ? E.calUi : null;
  }
  function calibBtnText(ui) {
    return ui && ui.state === "busy"
      ? "Calibrando"
      : ui && ui.state === "ok"
        ? "Hecho ✓"
        : "Calibrar";
  }
  // Botón de «Calibrar» en el panel (circuito o ruta libre): solo parado y nunca en la vuelta de ejemplo; ocupa el
  // sitio de hideId. Lo que haya pasado se cuenta en el texto pequeño de la casilla de inclinación (labelId), que el
  // panel ya ha puesto antes en este fotograma.
  function renderCalib(btnId, hideId, labelId) {
    const ui = calibUi();
    const show = !E.sim && (isStopped() || (ui && ui.state === "busy"));
    $(btnId).hidden = !show;
    $(hideId).hidden = show;
    setText(btnId, calibBtnText(ui));
    if (ui && ui.why) setText(labelId, ui.why);
  }
  // En boxes (pantalla quieta): el botón y su nota se refrescan mientras dura la calibración.
  function pitsCalib() {
    startCalib();
    const tick = () => {
      if (!E || E.mode !== "pits") return;
      const ui = calibUi();
      setText("p-calib", calibBtnText(ui) + (ui ? "" : " inclinación"));
      setText(
        "p-calib-note",
        ui && ui.state === "ok"
          ? "Calibrado: con la moto así, inclinación y morro marcan 0."
          : ui && ui.why
            ? ui.why.charAt(0).toUpperCase() + ui.why.slice(1) + "."
            : ui && ui.state === "busy"
              ? "Moto derecha y quieta un segundo…"
              : "",
      );
      if (ui) setTimeout(tick, 200);
    };
    tick();
  }

  // Velocidad ahora fuera del circuito: la del último fijo (que describe dónde estaba la moto hace `lag` s)
  // adelantada con la aceleración.
  function rideSpeed(t) {
    const lagDt = Math.max(0, Math.min(2.5, t - (E.fix.t - lagNow())));
    return Math.max(0, E.fix.v + (E.calib.f ? E.aEma : 0) * lagDt);
  }

  // ---------- recorrido: trazada, curvas de cualquier carretera, cabeceo y caballitos ----------
  function rideStep(t, dt, gyro, lin, grav, p, vNow) {
    const cal = E.calib;
    if (E.leanAxes && E.pitchAxes !== E.axesVer) {
      E.pitch.setAxes(E.lean.f, E.lean.u);
      E.pitchAxes = E.axesVer;
    }
    const b = E.lean.bias;
    const w = [gyro[0] - b[0], gyro[1] - b[1], gyro[2] - b[2]];
    if (E.mountChk) mountCheck(w, vNow, dt);
    const sf = [lin[0] + grav[0], lin[1] + grav[1], lin[2] + grav[2]];
    // Velocidad ahora: en el circuito, la del encaje; fuera, la del GPS adelantada con el acelerómetro.
    const v = !p && E.fix ? rideSpeed(t) : vNow;
    // Giro alrededor de la vertical (para las curvas), sin la parte de balanceo, en media de 0,3 s: el soporte
    // vibra con 0,3–0,5 rad/s de ruido por muestra y el módulo de cada muestra suelta nunca bajaba del umbral
    // de fin de curva (las curvas no se acababan).
    const kw = 1 - Math.exp(-dt / 0.3);
    const wl = E.wLp || (E.wLp = w.slice());
    for (let i = 0; i < 3; i++) wl[i] += (w[i] - wl[i]) * kw;
    let yaw;
    if (E.leanAxes && E.lean.u) yaw = Math.hypot(E.lean.wu, E.lean.wl);
    else if (cal.f) {
      const wf = dot3(wl, cal.f);
      yaw = Math.hypot(
        wl[0] - wf * cal.f[0],
        wl[1] - wf * cal.f[1],
        wl[2] - wf * cal.f[2],
      );
    } else yaw = Math.hypot(wl[0], wl[1], wl[2]);
    // Balanceo (rad/s, media de 0,3 s): al cambiar de lado en curvas enlazadas pasa de 1 rad/s.
    E.roll = E.lean.f ? dot3(wl, E.lean.f) : 0;
    if (
      typeof E.leanAxes === "number" &&
      E.lean.u &&
      v > 8 &&
      isFinite(E.leanDeg)
    )
      alignStep(t, w, (E.leanDeg * E.leanSign * Math.PI) / 180);
    // Para el cabeceo cuenta como «girando» tanto la curva como el cambio de lado (un balanceo de 0,25 rad/s pesa
    // como una curva de 0,12 rad/s).
    E.turn = Math.max(yaw, Math.abs(E.roll) / 2);
    const pr = E.hasGyro ? E.pitch.step(dt, w, sf, E.leanDeg, E.turn) : null;
    E.pitchDeg = pr ? pr.pitch : NaN;
    E.aW = pr ? pr.a / G : NaN;
    // Giro con signo alrededor de la vertical del mundo, para que la trazada siga la curva entre fijos del
    // GPS: ω_z = ω·u·cos φ + ω·l·sen φ (φ, la inclinación en los ejes del estimador). En el plano (y hacia el
    // sur) el rumbo crece al girar a derechas: rumbo' = −ω_z. El recorrido comprueba el signo con el GPS.
    let yawRate = NaN;
    if (E.leanAxes && E.lean.u && isFinite(E.leanDeg)) {
      const phi = (E.leanDeg * E.leanSign * Math.PI) / 180;
      yawRate = -(
        dot3(w, E.lean.u) * Math.cos(phi) +
        dot3(w, E.lean.l) * Math.sin(phi)
      );
    } else if (E.hasGyro) {
      // Antes de calibrar: giro alrededor de la gravedad que da el móvil (tumbado mide algo menos; el GPS
      // lo va corrigiendo), mejor que seguir solo al GPS, que va a saltos.
      const gn = Math.hypot(grav[0], grav[1], grav[2]);
      if (gn > 5) yawRate = -dot3(w, grav) / gn;
    }
    E.rideV = v;
    E.route.step(t, {
      a: cal.f ? E.aEma / G : E.aGps === E.aGps ? E.aGps / G : NaN,
      aW: E.aW,
      lean: E.leanDeg,
      v,
      yaw: E.hasGyro ? yaw : 0,
      turn: E.hasGyro ? E.turn : NaN,
      yawRate,
      lag: lagNow(),
      pitch: E.pitchDeg,
    });
  }

  // ---------- curva a curva ----------
  // Cada curva va de la mitad de la recta anterior (límite de sector) hasta 80 m después de su vértice.
  // Mientras tanto se apunta lo que mide el móvil; al salir queda el resumen, que el panel enseña en la recta.
  function sectorAt(s) {
    const B = E.bounds;
    const L = E.track.L;
    let best = 0;
    let bd = Infinity;
    B.forEach((b, k) => {
      const d = ring(s - b, L);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  }

  // Lo que se guarda y se enseña de una frenada.
  function brakeBrief(b) {
    return {
      peak: b.peak,
      bite: b.bite,
      dist: b.dist,
      dive: b.dive,
      diveMm: b.diveMm,
      trail: b.trail,
      leanMax: b.leanMax,
    };
  }
  // «Llega 0,35 s · hunde 4,1° ≈95 mm · tumbado 14 m (22°)» (lo que se sepa).
  function brakeLine(b) {
    if (!b) return "";
    const parts = ["Llega " + fmt(b.bite, 2) + " s"];
    if (b.dive !== null && b.dive !== undefined)
      parts.push("hunde " + fmtDive(b));
    if (b.trail > 0)
      parts.push(
        "tumbado " +
          b.trail +
          " m" +
          (b.leanMax ? " (" + fmt(b.leanMax, 0) + "°)" : ""),
      );
    return parts.join(" · ");
  }

  function cornerTrack(t, p) {
    if (!p || E.lapStart === null || !E.bounds) return;
    const L = E.track.L;
    const n = E.bounds.length;
    const k = sectorAt(p.s);
    let w = E.cw;
    if (!w || w.k !== k) {
      // Solo se avanza a la curva siguiente; un salto atrás del GPS no reinicia nada.
      const stale = !w || t - w.tLast > 5;
      if (!stale && k !== (w.k + 1) % n) return;
      w = E.cw = {
        k,
        t0: t,
        s0: p.s,
        tLast: t,
        leanMax: 0,
        gMax: null,
        vMin: Infinity,
        brakeS: null,
        brakeCand: null,
        done: false,
      };
    }
    w.tLast = t;
    if (w.done) return;
    const corner = E.cornerBySector[k];
    const rel = (s) => ring(s - E.bounds[k], L);
    const secLen = rel(E.bounds[(k + 1) % n]) || L;
    const exitRel = Math.min(rel(corner.sApex + 80), secLen - 10);
    const r = rel(p.s);
    if (isFinite(E.leanDeg))
      w.leanMax = Math.max(w.leanMax, Math.abs(E.leanDeg));
    if (E.calib.f) {
      const a = E.aEma;
      w.gMax = Math.max(w.gMax || 0, -a / G);
      if (a < -0.1 * G) {
        if (w.brakeCand === null) w.brakeCand = p.s;
        if (a < -0.3 * G && w.brakeS === null) w.brakeS = w.brakeCand;
      } else if (a > -0.05 * G) w.brakeCand = null;
    }
    if (r > rel(corner.sApex) - 60) w.vMin = Math.min(w.vMin, p.v);
    if (r < exitRel) return;
    w.done = true;
    // La frenada de esta curva: la más fuerte de las que empiezan dentro de su tramo.
    let brk = null;
    for (const b of E.route.brakes)
      if (
        b.gps !== false &&
        b.t >= w.t0 &&
        b.t <= t &&
        (!brk || b.peak > brk.peak)
      )
        brk = b;
    const res = {
      k,
      num: corner.num,
      name: corner.name,
      leanMax: E.hasGyro && E.leanAxes ? Math.round(w.leanMax * 10) / 10 : null,
      gMax: w.gMax !== null ? Math.round(w.gMax * 100) / 100 : null,
      vMin: isFinite(w.vMin) ? Math.round(w.vMin * 36) / 10 : null,
      brakeS: w.brakeS !== null ? Math.round(w.brakeS) : null,
      brk: brk ? brakeBrief(brk) : null,
      time: Math.round((t - w.t0) * 1000) / 1000,
      dt: null,
      ref: null,
    };
    if (E.best) {
      let tb = gridAt(E.best.grid, p.s) - gridAt(E.best.grid, w.s0);
      if (tb < 0) tb += E.best.time;
      res.dt = Math.round((t - w.t0 - tb) * 1000) / 1000;
      res.ref = E.best.corners ? E.best.corners[k] || null : null;
    }
    E.lapCorners[k] = res;
    E.recap = res;
    E.recapT = t;
  }

  // ---------- boxes ----------
  function pitsCheck(t, v, on) {
    // Repasando una grabación guardada: boxes al final, no a mitad.
    if (E.viewing) return;
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

  // Frenadas por curva en la tanda: el pico más alto, la mordida más rápida, el mayor hundimiento y lo más
  // que se ha frenado tumbado, de todas las vueltas.
  function pitsBrakes() {
    const rows = E.bounds
      ? E.bounds.map((_, k) => {
          const bs = E.laps
            .map((l) => l.corners && l.corners[k] && l.corners[k].brk)
            .filter(Boolean);
          if (!bs.length) return null;
          const c = E.cornerBySector[k];
          const top = (key, better) =>
            bs.reduce(
              (best, b) =>
                b[key] !== null &&
                b[key] !== undefined &&
                (best === null || better(b[key], best[key]))
                  ? b
                  : best,
              null,
            );
          return {
            name: "C" + c.num,
            peak: top("peak", (a, b) => a > b),
            bite: top("bite", (a, b) => a < b),
            dive: top("dive", (a, b) => a > b),
            trail: top("trail", (a, b) => a > b),
            n: bs.length,
          };
        })
      : [];
    const tb = $("p-brk");
    tb.textContent = "";
    const list = rows.filter(Boolean);
    $("p-brk-card").hidden = !list.length;
    for (const r of list)
      tb.appendChild(
        tableRow([
          r.name,
          fmt(r.peak.peak, 2) + " g",
          fmt(r.bite.bite, 2) + " s",
          r.dive ? diveCell(r.dive) : "—",
          trailCell(r.trail),
        ]),
      );
    setText(
      "p-brk-note",
      "Lo mejor de cada curva en esta tanda. «Llega»: lo que tardas en llegar al 80 % del pico de frenada. «Hunde»: cuánto baja el morro (los mm son una estimación). «Tumbado»: metros frenando con más de 12° de inclinación.",
    );
  }

  function enterPits() {
    E.mode = "pits";
    // El aviso de vuelta terminada solo se quita desde el panel: en boxes se quedaría tapándolo todo.
    $("flash").hidden = true;
    setText("p-calib", "Calibrar inclinación");
    setText("p-calib-note", "");
    // Una tanda guardada que se está repasando: solo mirar (ni volver a pista ni calibrar) y «Cerrar».
    const viewing = !!E.viewing;
    $("resume").hidden = viewing;
    $("p-calib").hidden = viewing;
    $("p-toolbar").hidden = !viewing;
    setText("finish", viewing ? "Cerrar" : "Terminar");
    show("pits");
    const valid = E.laps.filter((l) => l.valid);
    $("p-sub").textContent =
      (valid.length
        ? valid.length +
          (valid.length === 1 ? " vuelta completa" : " vueltas completas") +
          (E.best ? " · mejor " + fmtLap(E.best.time) : "")
        : "Aún no hay ninguna vuelta completa.") +
      (E.calib.f ? " · sensores calibrados" : " · sensores aún sin calibrar") +
      (E.extInfo
        ? " · GPS externo" + (E.extInfo.hz ? " a " + E.extInfo.hz + " Hz" : "")
        : E.lagR2 !== null
          ? " · retraso del GPS " + fmt(E.lag, 1) + " s (compensado)"
          : "");
    const body = $("p-laps");
    body.textContent = "";
    let analysis = null;
    try {
      analysis = T.analyze(sessionOf(E), {
        finish: settings.finish,
        target: target(),
      });
    } catch (e) {
      analysis = null;
    }
    E.analysis = analysis ? compactAnalysis(analysis) : null;
    recFlush(true);
    saveMeta("grabando");
    renderStoreLine();
    const laps = analysis ? analysis.laps.filter((l) => l.valid) : valid;
    const bestT = laps.length ? Math.min(...laps.map((l) => l.time)) : null;
    // Máximos de la tanda (inclinación y punta), marcados como la mejor vuelta.
    const maxOf = (key) => {
      const vals = laps.map((l) => l[key]).filter(Number.isFinite);
      return vals.length ? Math.max(...vals) : null;
    };
    const topLean = maxOf("leanMax");
    const topV = maxOf("vMax");
    laps.forEach((l, i) => {
      const tr = document.createElement("tr");
      const cells = [
        [String(i + 1), false],
        [fmtLap(l.time), l.time === bestT],
        [l.time === bestT ? "—" : fmtSigned(l.time - bestT, 2), false],
        [
          Number.isFinite(l.leanMax) ? fmt(l.leanMax, 0) + "°" : "—",
          l.leanMax === topLean && laps.length > 1,
        ],
        [
          Number.isFinite(l.vMax) ? fmt(l.vMax, 0) : "—",
          l.vMax === topV && laps.length > 1,
        ],
      ];
      for (const [txt, top] of cells) {
        const td = document.createElement("td");
        td.textContent = txt;
        if (top) td.className = "best";
        tr.appendChild(td);
      }
      body.appendChild(tr);
    });
    // La vuelta ideal la pone el entrenador (la fina solo con GPS rápido).
    $("p-ideal").textContent = "";
    pitsBrakes();
    // Con el análisis completo, la mejor vuelta del resumen es la suya (más precisa que la del directo).
    if (bestT !== null)
      $("p-sub").textContent = $("p-sub").textContent.replace(
        /mejor \d+:\d\d,\d\d/,
        "mejor " + fmtLap(bestT),
      );
    pitsCoach(analysis);
  }

  // Entrenador en boxes: las 3 cosas que más tiempo te dan para la próxima tanda (tu mejor vuelta frente al
  // objetivo), lo que ya has hecho mejor en otra vuelta y la curva menos regular.
  function pitsCoach(analysis) {
    const tips = $("p-tips");
    tips.textContent = "";
    const addTip = (title, loss, lines, cls) => {
      const li = document.createElement("li");
      if (cls) li.className = cls;
      const st = document.createElement("strong");
      st.textContent = title;
      li.appendChild(st);
      if (loss !== null) {
        const b = document.createElement("span");
        b.className = "loss";
        b.textContent = fmtSigned(-loss, 2) + " s por vuelta";
        li.appendChild(b);
      }
      for (const t of lines) {
        const p = document.createElement("span");
        p.textContent = t;
        li.appendChild(p);
      }
      tips.appendChild(li);
    };
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1) + ".";
    const c = analysis && analysis.best ? T.coach(analysis) : null;
    if (!c) {
      addTip("Sin análisis todavía", null, [
        "Haz al menos una vuelta completa pasando dos veces por meta.",
      ]);
      return;
    }
    for (const p of c.plan) {
      const head = p.text.split(":")[0];
      const why =
        p.text.indexOf(":") >= 0
          ? p.text.slice(p.text.indexOf(":") + 1).trim()
          : "";
      const lines = why
        ? why.split("; ").map(cap)
        : [
            "Mismos puntos de frenada y de gas y misma velocidad mínima: el tiempo se va en cómo bajas o subes la velocidad, o en la trazada.",
          ];
      if (p.already)
        lines.push(
          "Ya lo hiciste en la vuelta " +
            p.already.lapNum +
            ": " +
            fmt(p.already.gain, 2) +
            " s mejor que en tu mejor vuelta.",
        );
      addTip(head, p.gain, lines);
    }
    if (!c.plan.length)
      addTip("Frente a tu objetivo de " + fmtLap(target(), 1), null, [
        "Tu mejor vuelta no pierde tiempo claro en ninguna curva.",
      ]);
    // Lo que ya sabes hacer (otra vuelta lo hizo mejor que la mejor) y que no esté ya en el plan.
    const inPlan = (s) =>
      c.plan.some(
        (p) =>
          p.k === s.k && (p.phase === "entrada") === (s.phase === "entrada"),
      );
    for (const s of c.self.filter((s) => !inPlan(s)).slice(0, 2))
      addTip(
        "Ya lo has hecho: C" + s.num + " · " + s.name + " · " + s.phase,
        null,
        [
          "En la vuelta " +
            s.lapNum +
            " hiciste esa " +
            s.phase +
            " " +
            fmt(s.gain, 2) +
            " s más rápido que en tu mejor vuelta.",
        ],
        "tip-self",
      );
    const irr = c.consistency[0];
    if (irr && irr.sd >= 0.15)
      addTip(
        "Menos regular: C" + irr.num + " · " + irr.name,
        null,
        [
          "De una vuelta a otra varía ±" +
            fmt(irr.sd, 2) +
            " s: busca la misma referencia de frenada y de gas cada vuelta.",
        ],
        "tip-self",
      );
    $("p-ideal").textContent =
      c.ideal.show !== null
        ? "Vuelta ideal (tus mejores " +
          c.ideal.kind +
          "): " +
          fmtLap(c.ideal.show)
        : "";
  }

  function enterRide() {
    E.mode = "ride";
    show("dash");
  }

  // Lo esencial del análisis completo para el resumen de la tanda (sin las series, que ya van en los trozos).
  function compactAnalysis(a) {
    return {
      sentido: a.dir,
      inclinacion: a.leanFrom,
      ideal: a.ideal,
      mejor: a.best ? a.best.time : null,
      avisos: a.warnings,
      vueltas: a.laps.map((l) => ({
        num: l.num,
        time: Math.round(l.time * 1000) / 1000,
        valid: l.valid,
        sectors: l.sectors,
        corners: l.corners,
      })),
    };
  }

  // ---------- grabación en el móvil ----------
  function newRecId() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    const rnd = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      "-" +
      p(d.getHours()) +
      p(d.getMinutes()) +
      p(d.getSeconds()) +
      "-" +
      rnd
    );
  }

  function recStart(epochMs) {
    if (!ST) return;
    E.rec = {
      id: newRecId(),
      epoch: epochMs,
      seq: 0,
      idx: { loc: 0, acc: 0, gyro: 0, grav: 0, canal: 0 },
      lastT: 0,
      saved: 0,
      failed: false,
      queue: Promise.resolve(),
    };
    saveMeta("grabando");
    ST.closeStale(E.rec.id).catch(() => {});
  }

  // Guarda en el móvil lo grabado desde el último trozo (cada REC_EVERY s, o ya si `force`).
  function recFlush(force) {
    const eng = E;
    if (!eng || !eng.rec) return;
    const R = eng.rec;
    const t = now();
    if (!force && t - R.lastT < REC_EVERY) return;
    R.lastT = t;
    const series = {};
    let any = false;
    for (const key of ["loc", "acc", "gyro", "grav", "canal"]) {
      const s = eng[key];
      const i0 = R.idx[key];
      if (s.n <= i0) continue;
      const o = {};
      for (const c of s.cols) o[c] = s.d[c].slice(i0, s.n);
      series[key] = o;
      R.idx[key] = s.n;
      any = true;
    }
    if (!any) return;
    const chunk = {
      v: F.VERSION,
      id: R.id,
      seq: R.seq++,
      epoch: R.epoch,
      series,
    };
    R.queue = R.queue
      .then(() => ST.putChunk(chunk))
      .then(
        () => {
          R.saved++;
        },
        () => {
          R.failed = true;
        },
      );
  }

  function saveMeta(estado) {
    const eng = E;
    if (!eng || !eng.rec) return;
    const R = eng.rec;
    const meta = {
      v: F.VERSION,
      id: R.id,
      epoch: R.epoch,
      inicio: new Date(R.epoch).toISOString(),
      fin: estado === "grabando" ? null : new Date().toISOString(),
      estado,
      sim: !!eng.sim,
      app: APP_VERSION,
      // «ruta»: ruta libre por cualquier carretera (sin vueltas); «pista»: el circuito.
      tipo: eng.free ? "ruta" : "pista",
      recorrido: eng.route.summary(),
      piloto: settings.piloto || null,
      objetivo: target(),
      sentido: eng.dir,
      meta: settings.finish,
      mejor: eng.best ? eng.best.time : null,
      retrasoGps: eng.lagR2 !== null ? eng.lag : null,
      // Receptor GPS externo usado en la tanda ({fuente, nombre, hz}); null: solo el GPS del móvil.
      gps: eng.extInfo ? Object.assign({}, eng.extInfo) : null,
      // Avisos de caída de la ruta libre (y si se pararon con «Estoy bien» o sonó la alarma).
      caidas: eng.crashLog.length ? eng.crashLog : null,
      // Ruta libre por un circuito (detectado o guardado): su nombre, largo y las vueltas.
      circuito: eng.circ
        ? {
            nombre: eng.circTrack.name,
            longitud: Math.round(eng.circTrack.length),
            guardado: eng.circSaved,
            mejor: eng.circ.best
              ? Math.round(eng.circ.best.time * 1000) / 1000
              : null,
            vueltas: eng.circ.laps.map((l) => ({
              num: l.num,
              time: Math.round(l.time * 1000) / 1000,
              valid: l.valid,
            })),
          }
        : null,
      calibrado: !!eng.calib.f,
      // Postura del móvil al empezar (de pie / plano, pantalla vertical / horizontal) y orientación de la pantalla.
      montaje: eng.mount
        ? Object.assign({ angulo: eng.screenAngle }, eng.mount)
        : null,
      // Vertical de la moto puesta a mano con «Calibrar» (ejes del móvil), si se usó.
      calibracionManual: eng.calib.manualU
        ? eng.calib.manualU.map((x) => Math.round(x * 1e4) / 1e4)
        : null,
      vueltas: eng.laps.map((l) => ({
        num: l.num,
        time: Math.round(l.time * 1000) / 1000,
        valid: l.valid,
        sectors: l.sectors || null,
        corners: l.corners || null,
      })),
      analisis: eng.analysis,
    };
    R.queue = R.queue
      .then(() => ST.putSession(meta))
      .catch(() => {
        R.failed = true;
      });
  }

  function renderStoreLine() {
    const el = $("p-store");
    if (!el || !E) return;
    if (!E.rec) {
      el.textContent = E.sim ? "Simulador: no se guarda." : "";
      return;
    }
    const s = ST.sync;
    const mac =
      s.state === "ok"
        ? "se sube sola a tu Mac"
        : s.state === "off"
          ? "conecta el garaje del Mac para tener copia"
          : "se subirá a tu Mac cuando haya conexión";
    el.textContent = E.rec.failed
      ? "No se ha podido guardar en el móvil: exporta la tanda antes de cerrar."
      : "Tanda guardada en el móvil · " + mac + ".";
    el.className = E.rec.failed ? "warnbox" : "muted";
  }

  // ---------- pantalla ----------
  function show(which) {
    for (const id of [
      "home",
      "dash",
      "pits",
      "dia",
      "sensores",
      "ruta",
      "ruta-fin",
    ])
      $(id).hidden = id !== which;
  }

  // ---------- atrás (el botón o el gesto del móvil) ----------
  // Instalada, la app se cerraba con el atrás del móvil desde cualquier pantalla. Ahora lleva una entrada propia en
  // el historial y atrás vuelve dentro de la app: el resumen de la ruta y la prueba de sensores, a la portada;
  // repasando una grabación, la cierra; rodando no para nada (avisa de cómo terminar); en la portada, la primera vez
  // avisa y la segunda sale. La entrada se pone al tocar la pantalla: al ir atrás, Chrome se salta las que una
  // página añade sin que nadie la haya tocado.
  function backArm() {
    if (!(history.state && history.state.pista))
      history.pushState({ pista: 1 }, "");
  }
  let toastTimer = 0;
  function toast(text, ms) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, ms || 2500);
  }
  function onBack() {
    // La alarma de caída no se quita con atrás: para eso está «Estoy bien».
    if (!$("crash").hidden) return backArm();
    if (viewJob) {
      cancelView();
      return backArm();
    }
    if (!$("ruta").hidden || !$("dash").hidden) {
      toast(
        E && E.sim
          ? "Para salir de la vuelta de ejemplo, «Boxes»"
          : E && E.free
            ? "Sigue grabando: para acabar, «Terminar»"
            : "Sigue grabando: para parar, «Boxes»",
      );
      return backArm();
    }
    if (!$("pits").hidden) {
      if (E && E.viewing) stopAll();
      else toast("Para seguir, «Volver a pista»; para acabar, «Terminar»");
      return backArm();
    }
    if (!$("ruta-fin").hidden) {
      show("home");
      renderHome();
      return backArm();
    }
    if (!$("sensores").hidden) {
      stopSensors();
      return backArm();
    }
    if (!$("dia").hidden) {
      leaveDay();
      return backArm();
    }
    // En la portada: sin entrada propia, el siguiente atrás ya sale (de eso se encarga el móvil).
    toast("Pulsa atrás otra vez para salir");
  }

  // ---------- prueba de sensores (en cualquier sitio, con el móvil de verdad) ----------
  // La inclinación que mediría en la moto: el giro alrededor del eje adelante de la postura del móvil (de pie,
  // inclinado o plano; con la pantalla en vertical u horizontal: T.mountAxes), por la gravedad y por el
  // giroscopio. Si no van juntas, el giroscopio no sirve. La postura de referencia se toma al empezar, con
  // «Calibrar» y cuando el móvil se deja quieto en otra postura: cabeceado (de pie ↔ plano) o, plano, con
  // la pantalla girada. Tumbarlo (lo que se prueba) no cambia la referencia aunque se quede quieto.
  let sensor = null;
  function screenAngle() {
    const o = screen.orientation;
    if (o && typeof o.angle === "number") return o.angle;
    return typeof window.orientation === "number" ? window.orientation : 0;
  }
  // «Móvil plano, pantalla en horizontal: hacia delante, la parte de arriba de la pantalla».
  function mountText(m) {
    return (
      "Móvil " +
      m.posture +
      ", pantalla en " +
      m.screen +
      ": hacia delante, " +
      (m.posture === "de pie"
        ? "la espalda del móvil."
        : m.posture === "plano"
          ? "la parte de arriba de la pantalla."
          : "la parte de arriba de la pantalla (y la espalda del móvil).")
    );
  }
  function sensorRef(S, grav) {
    const angle = screenAngle();
    const m = T.mountAxes(grav, angle);
    if (!m) return;
    S.ref = Object.assign(m, { angle });
    S.leanW = 0;
    S.swing = 0;
    S.diff = 0;
    S.maxDiff = 0;
  }
  function sensorMotion(ev) {
    markMotion(ev);
    const S = sensor;
    if (!S) return;
    const now = performance.now();
    const g = ev.accelerationIncludingGravity;
    const a = ev.acceleration;
    const r = ev.rotationRate;
    if (!g || g.x === null) return;
    S.times.push(now);
    while (S.times.length && now - S.times[0] > 2000) S.times.shift();
    const grav =
      a && a.x !== null ? [g.x - a.x, g.y - a.y, g.z - a.z] : [g.x, g.y, g.z];
    S.grav = grav;
    S.lin = a && a.x !== null ? [a.x, a.y, a.z] : null;
    const dt = S.last === null ? 0 : Math.min(0.1, (now - S.last) / 1000);
    S.last = now;
    // Gravedad media (0,25 s): la referencia sale de ella, no de una lectura suelta con su ruido.
    if (!S.gravS) {
      S.gravS = grav.slice();
      S.gravN = 0;
    }
    const kg = 1 - Math.exp(-dt / 0.25);
    for (let i = 0; i < 3; i++) S.gravS[i] += (grav[i] - S.gravS[i]) * kg;
    S.gravN++;
    if (!S.ref && S.gravN >= 30) sensorRef(S, S.gravS);
    if (!S.ref) return;
    let leanG = T.mountLean(grav, S.ref);
    // Morro arriba (+) / abajo respecto a la referencia, como cabecearía la moto.
    let pitch =
      (Math.atan2(dot3(grav, S.ref.f), dot3(grav, S.ref.u)) * 180) / Math.PI;
    // Quieto 1,5 s en otra postura: esa es la nueva referencia.
    const spin =
      r && r.alpha !== null ? Math.hypot(r.alpha, r.beta, r.gamma) : 0;
    if (spin > 8) S.stillSince = null;
    else if (S.stillSince === null) S.stillSince = now;
    if (S.stillSince !== null && now - S.stillSince > 1500) {
      const cur = T.mountAxes(grav, screenAngle());
      const turned =
        cur &&
        cur.tilt < 20 &&
        screenAngle() !== S.ref.angle &&
        Math.abs(leanG) < 15;
      if (cur && (Math.abs(pitch) > 25 || turned)) {
        sensorRef(S, S.gravS);
        leanG = T.mountLean(grav, S.ref);
        pitch =
          (Math.atan2(dot3(grav, S.ref.f), dot3(grav, S.ref.u)) * 180) /
          Math.PI;
      }
    }
    S.leanG = leanG;
    S.pitch = pitch;
    if (r && r.alpha !== null) {
      S.hasGyro = true;
      S.rot = spin;
      const DEG = Math.PI / 180;
      S.axes.add(now / 1000, grav, [
        r.alpha * DEG,
        r.beta * DEG,
        r.gamma * DEG,
      ]);
      // Giro (°/s) con el orden de ejes ya comprobado y sin el sesgo del giroscopio.
      const wm = S.axes.map([r.alpha, r.beta, r.gamma]);
      const axesKey = S.axes.choice * 2 + S.axes.sign;
      if (S.biasKey !== axesKey) {
        S.gbias = [0, 0, 0];
        S.biasKey = axesKey;
      }
      const gb = S.gbias;
      const wc = [wm[0] - gb[0], wm[1] - gb[1], wm[2] - gb[2]];
      // Quieto (sobre la mesa): lo que marque el giroscopio es su sesgo, que se aprende y se resta; y su tumbada
      // se va alineando con la de la gravedad. Si no, el sesgo la haría derivar grados por minuto sin moverlo.
      S.stillG = Math.hypot(wc[0], wc[1], wc[2]) < 5 ? (S.stillG || 0) + dt : 0;
      if (S.stillG > 0.5) {
        const kb = 1 - Math.exp(-dt / 2);
        for (let i = 0; i < 3; i++) gb[i] += (wm[i] - gb[i]) * kb;
        if (Number.isFinite(leanG))
          S.leanW += (leanG - S.leanW) * (1 - Math.exp(-dt / 0.5));
      }
      // Giro alrededor del eje adelante: tumbar a derechas es positivo.
      S.leanW += dot3(wc, S.ref.f) * dt;
      if (Number.isFinite(leanG)) {
        let d = S.leanW - leanG;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        S.diff = d;
        // La mayor separación durante el giro: al volver al centro un giroscopio malo también vuelve a cero.
        S.maxDiff = Math.max(S.maxDiff || 0, Math.abs(d));
        S.swing = Math.max(S.swing, Math.abs(leanG));
      }
    }
  }
  function sensorFix(pos) {
    const S = sensor;
    if (!S) return;
    const now = Date.now();
    S.fixes.push(now);
    while (S.fixes.length && now - S.fixes[0] > 10000) S.fixes.shift();
    const c = pos.coords;
    S.acc = c.accuracy;
    S.lag = now - pos.timestamp;
    if (c.speed !== null && c.speed >= 0) {
      S.speed = c.speed;
      S.speedFrom = "gps";
    } else if (S.prevPos) {
      const [x0, y0] = T.toLocal(S.prevPos.lat, S.prevPos.lon);
      const [x1, y1] = T.toLocal(c.latitude, c.longitude);
      S.speed =
        Math.hypot(x1 - x0, y1 - y0) /
        Math.max(0.2, (pos.timestamp - S.prevPos.t) / 1000);
      S.speedFrom = "posiciones";
    }
    S.prevPos = { lat: c.latitude, lon: c.longitude, t: pos.timestamp };
    S.gpsErr = "";
  }
  // La postura de ahora es la de la moto derecha (la del primer dato, si aún no ha llegado ninguno).
  function sensorZero() {
    if (!sensor) return;
    sensor.ref = null;
    sensor.stillSince = null;
    if (sensor.gravS) sensorRef(sensor, sensor.gravS);
    sensor.zeroAt = performance.now();
  }
  function note(id, text, cls) {
    setText(id, text);
    setCls(id, "muted" + (cls ? " " + cls : ""));
  }
  function renderSensors() {
    const S = sensor;
    if (!S) return;
    // Como en la moto: + a derechas.
    const side = (deg) =>
      Math.abs(deg) < 1
        ? "0°"
        : fmt(Math.abs(deg), 0) + "° " + (deg > 0 ? "der." : "izq.");
    const ref = S.ref;
    setText("sen-tilt-g", Number.isFinite(S.leanG) ? side(S.leanG) : "—");
    setText(
      "sen-tilt-w",
      S.hasGyro && ref ? side(((S.leanW + 540) % 360) - 180) : "—",
    );
    setText(
      "sen-pitch",
      ref && Number.isFinite(S.pitch)
        ? fmt(Math.abs(S.pitch), 0) +
            "°" +
            (Math.abs(S.pitch) < 1 ? "" : S.pitch > 0 ? " arriba" : " abajo")
        : "—",
    );
    $("sen-level").style.transform =
      "rotate(" + (Number.isFinite(S.leanG) ? S.leanG : 0) + "deg)";
    setText("sen-mount", ref ? mountText(ref) : "");
    if (S.motionDenied) note("sen-tilt-note", sensorBlockText(), "note-bad");
    else if (!S.grav || !ref)
      note("sen-tilt-note", "Esperando a los sensores…");
    else if (!Number.isFinite(S.leanG))
      note(
        "sen-tilt-note",
        "Así no se puede medir: el móvil apunta hacia el cielo o hacia el suelo. Colócalo como irá en la moto y pulsa «Calibrar».",
      );
    else if (!S.hasGyro)
      note(
        "sen-tilt-note",
        "Este móvil no tiene giroscopio: no habrá inclinación en la moto.",
        "note-bad",
      );
    // Girado a mano el móvil también cabecea, y eso separa algo las dos medidas (hasta 9° medido en un Pixel
    // 10 Pro con giroscopio bueno). Un giroscopio malo o «virtual» se separa mucho más.
    else if (S.swing > 30 && S.maxDiff > Math.max(15, 0.25 * S.swing))
      note(
        "sen-tilt-note",
        "El giroscopio se separa de la gravedad (hasta " +
          fmt(S.maxDiff, 0) +
          "°): puede ser un giroscopio poco fiable.",
        "note-bad",
      );
    else if (S.swing > 30)
      note(
        "sen-tilt-note",
        "Giroscopio y gravedad van juntos: bien." +
          (S.axes.checked
            ? " Ejes comprobados (" +
              fmt(S.axes.r2 * 100, 0) +
              " % de acuerdo)."
            : ""),
        "note-ok",
      );
    else
      note(
        "sen-tilt-note",
        (S.zeroAt && performance.now() - S.zeroAt < 3000
          ? "Calibrado: así es 0°. "
          : "") +
          (ref.posture === "plano"
            ? "Inclínalo a un lado y a otro como tumbaría la moto (girando sobre el eje que apunta hacia delante), unos 45°."
            : "Gíralo como un volante, a un lado y a otro, unos 45°."),
      );
    // GPS
    const hz =
      S.fixes.length > 1
        ? (S.fixes.length - 1) /
          ((S.fixes[S.fixes.length - 1] - S.fixes[0]) / 1000)
        : null;
    setText(
      "sen-speed",
      Number.isFinite(S.speed) ? fmt(S.speed * 3.6, 0) + " km/h" : "—",
    );
    setText(
      "sen-acc",
      Number.isFinite(S.acc) ? "±" + fmt(S.acc, 0) + " m" : "—",
    );
    setText("sen-hz", hz ? fmt(hz, 1) : "—");
    setText(
      "sen-lag",
      Number.isFinite(S.lag) ? fmt(S.lag / 1000, 1) + " s" : "—",
    );
    // Bajo techo llega una posición cada 5–6 s: perdida solo si pasan más de 10 s sin ninguna.
    const fresh =
      S.fixes.length && Date.now() - S.fixes[S.fixes.length - 1] < 10000;
    if (S.gpsErr) note("sen-gps-note", S.gpsErr, "note-bad");
    else if (!S.fixes.length)
      note("sen-gps-note", "Buscando señal… (mejor al aire libre)");
    else if (!fresh)
      note("sen-gps-note", "Se ha perdido la señal.", "note-bad");
    else if (S.acc > 15)
      note(
        "sen-gps-note",
        "Precisión baja: al aire libre y lejos de edificios mejora.",
        "note-bad",
      );
    else if (Date.now() - S.started > 10000 && (hz === null || hz < 0.8))
      // En casa o bajo techo el móvil da una posición cada varios segundos (medido: cada 5–6 s en un Pixel 10 Pro).
      note(
        "sen-gps-note",
        "Menos de una posición por segundo" +
          (S.acc > 10 ? " (bajo techo es normal: prueba al aire libre)" : "") +
          ". Al aire libre, si sigue igual, activa «Forzar mediciones GNSS completas» en Opciones para desarrolladores.",
        "note-bad",
      );
    else
      note(
        "sen-gps-note",
        S.speedFrom === "posiciones"
          ? "Este GPS no da la velocidad: la calculo con las posiciones (menos fina)."
          : "GPS bien.",
        S.speedFrom === "posiciones" ? "" : "note-ok",
      );
    // Movimiento
    const mhz =
      S.times.length > 1
        ? (S.times.length - 1) /
          ((S.times[S.times.length - 1] - S.times[0]) / 1000)
        : null;
    setText("sen-mhz", mhz ? fmt(mhz, 0) : "—");
    setText(
      "sen-g",
      S.lin ? fmt(Math.hypot(S.lin[0], S.lin[1], S.lin[2]) / G, 2) + " g" : "—",
    );
    setText(
      "sen-rot",
      S.hasGyro && Number.isFinite(S.rot) ? fmt(S.rot, 0) + " °/s" : "—",
    );
    if (!S.grav) note("sen-imu-note", "");
    else if (mhz !== null && mhz < 30)
      note(
        "sen-imu-note",
        "Pocas lecturas por segundo (" +
          fmt(mhz, 0) +
          "): la frenada y la inclinación saldrán más bastas.",
        "note-bad",
      );
    else if (!S.lin)
      note(
        "sen-imu-note",
        "Sin aceleración separada de la gravedad: la calculo con un filtro (menos fina).",
      );
    else note("sen-imu-note", "Sensores bien.", "note-ok");
  }
  async function startSensors() {
    const motionOk = await askMotion();
    sensor = {
      times: [],
      fixes: [],
      grav: null,
      lin: null,
      ref: null,
      leanG: NaN,
      leanW: 0,
      stillSince: null,
      gbias: [0, 0, 0],
      biasKey: null,
      stillG: 0,
      swing: 0,
      diff: 0,
      pitch: NaN,
      rot: NaN,
      hasGyro: false,
      last: null,
      speed: NaN,
      speedFrom: "",
      acc: NaN,
      lag: NaN,
      prevPos: null,
      gpsErr: "",
      started: Date.now(),
      motionDenied: !motionOk,
      axes: new T.GyroAxes(axesPrior()),
    };
    sensorsBlocked().then((b) => {
      if (b && sensor) sensor.motionDenied = true;
    });
    show("sensores");
    window.addEventListener("devicemotion", sensorMotion);
    if ("geolocation" in navigator)
      sensor.watch = navigator.geolocation.watchPosition(
        sensorFix,
        (err) => {
          if (sensor)
            sensor.gpsErr =
              err.code === 1
                ? "Sin permiso de ubicación: actívalo para esta web en los ajustes de Chrome."
                : "GPS sin señal todavía…";
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    else sensor.gpsErr = "Este navegador no da acceso al GPS.";
    sensor.timer = setInterval(renderSensors, 100);
    keepAwake();
  }
  function stopSensors() {
    if (!sensor) return;
    window.removeEventListener("devicemotion", sensorMotion);
    if (sensor.watch !== undefined)
      navigator.geolocation.clearWatch(sensor.watch);
    clearInterval(sensor.timer);
    sensor = null;
    if (!E && wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
    show("home");
    renderHome();
  }

  // ---------- tiempos del día (todos los pilotos del garaje) ----------
  let dayFrom = "home";
  let dayTimer = null;
  function hhmm(ms) {
    return new Date(ms).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  function paintDay(data, at, saved) {
    window.MaspaComparativa.render($("dia-body"), data);
    $("dia-status").textContent =
      (saved ? "Guardados a las " : "Actualizado a las ") +
      hhmm(at) +
      (data.analizando ? " · el Mac aún está analizando alguna tanda" : "");
  }
  async function refreshDay() {
    if (!ST || !settings.garaje) {
      $("dia-status").textContent =
        "Conecta el garaje del Mac para ver los tiempos de todos.";
      return;
    }
    $("dia-status").textContent = "Pidiendo los tiempos al Mac…";
    // Primero lo que falte por subir de este móvil, para que salgan tus últimas vueltas.
    await ST.syncNow(200);
    try {
      const data = await ST.fetchDay();
      store("pista-dia", { at: Date.now(), data });
      paintDay(data, Date.now(), false);
    } catch (e) {
      const cached = load("pista-dia", null);
      $("dia-status").textContent =
        "Sin conexión con el Mac (" +
        ST.reason(e) +
        ")" +
        (cached ? ". Abajo, los tiempos de las " + hhmm(cached.at) + "." : ".");
    }
  }
  function showDay(from) {
    dayFrom = from;
    show("dia");
    const cached = load("pista-dia", null);
    if (cached && cached.data) paintDay(cached.data, cached.at, true);
    else $("dia-body").textContent = "";
    refreshDay();
    clearInterval(dayTimer);
    // Mientras se mira, se actualiza solo (las tandas del otro van llegando).
    dayTimer = setInterval(() => {
      if ($("dia").hidden) clearInterval(dayTimer);
      else refreshDay();
    }, 20000);
  }
  function leaveDay() {
    clearInterval(dayTimer);
    if (dayFrom === "pits" && E && E.mode === "pits") show("pits");
    else if (E && E.mode === "ride") show("dash");
    else show("home");
  }

  function showLapFlash(time, isBest, prevBest) {
    if (E.viewing) return;
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

  // Cuánto describe el pasado el último fijo: el del receptor externo, casi nada; el del móvil, lo estimado.
  function lagNow() {
    return E.extGps ? EXT_LAG : E.lag;
  }

  // Retraso del GPS respecto a los sensores: el que mejor hace cuadrar la aceleración que mide el GPS
  // con la del acelerómetro (lo mismo que hace el análisis completo). Se recalcula en cada vuelta (y en ruta libre,
  // cada minuto), con los últimos 20 minutos. Con la fuerza específica (acc + grav) y con término independiente (la
  // gravedad): la aceleración «lineal» de Android, con la vibración de la moto, casi nunca llegaba al R² de 0,5 y el
  // retraso se quedaba en 0. Con el receptor externo en la tanda no se calcula: sus fijos mezclados con los del
  // móvil lo falsearían, y el suyo es fijo.
  function estimateLag() {
    if (E.extUsed) return;
    const l = E.loc.view();
    const a = E.acc.view();
    const g = E.grav.view();
    const nAll = Math.min(a.t.length, g.t.length);
    if (nAll < 600 || l.t.length < 40) return;
    let from = 0;
    while (from < nAll && a.t[from] < a.t[nAll - 1] - 1200) from++;
    const n = nAll - from;
    const pre = [
      new Float64Array(n + 1),
      new Float64Array(n + 1),
      new Float64Array(n + 1),
    ];
    for (let i = 0; i < n; i++) {
      const j = from + i;
      pre[0][i + 1] = pre[0][i] + a.x[j] + g.x[j];
      pre[1][i + 1] = pre[1][i] + a.y[j] + g.y[j];
      pre[2][i + 1] = pre[2][i] + a.z[j] + g.z[j];
    }
    const at = a.t.subarray(from, nAll);
    const idx = (t) => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (at[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    let best = null;
    for (let lag = 0; lag <= 1.2001; lag += 0.1) {
      const rows = [];
      for (let k = 1; k < l.t.length - 1; k++) {
        const v0 = l.speed[k - 1];
        const v1 = l.speed[k + 1];
        const dt = l.t[k + 1] - l.t[k - 1];
        if (!(v0 > 5 && v1 > 5) || dt <= 0 || dt > 3 || l.hacc[k] > 25)
          continue;
        const i0 = idx(l.t[k - 1] - lag);
        const i1 = idx(l.t[k + 1] - lag);
        if (i0 < 1 || i1 - i0 < 5 || i1 > n) continue;
        const c = i1 - i0;
        const X = [
          (pre[0][i1] - pre[0][i0]) / c,
          (pre[1][i1] - pre[1][i0]) / c,
          (pre[2][i1] - pre[2][i0]) / c,
        ];
        rows.push([X, (v1 - v0) / dt]);
      }
      if (rows.length < 40) continue;
      // Regresión con término independiente: se resta la media de X y de Y.
      const mx = [0, 0, 0];
      let my = 0;
      for (const [X, Y] of rows) {
        for (let r = 0; r < 3; r++) mx[r] += X[r] / rows.length;
        my += Y / rows.length;
      }
      const M = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const yv = [0, 0, 0];
      for (const [X, Y] of rows) {
        for (let r = 0; r < 3; r++) {
          for (let q = 0; q < 3; q++)
            M[r][q] += (X[r] - mx[r]) * (X[q] - mx[q]);
          yv[r] += (X[r] - mx[r]) * (Y - my);
        }
      }
      const lam = 1e-3 * ((M[0][0] + M[1][1] + M[2][2]) / 3 || 1);
      for (let r = 0; r < 3; r++) M[r][r] += lam;
      const w = solve3(M, yv);
      if (!w) continue;
      let res = 0;
      let tot = 0;
      for (const [X, Y] of rows) {
        const Xc = [X[0] - mx[0], X[1] - mx[1], X[2] - mx[2]];
        res += (Y - my - dot3(w, Xc)) ** 2;
        tot += (Y - my) ** 2;
      }
      const r2 = 1 - res / (tot || 1);
      if (!best || r2 > best.r2) best = { lag, r2 };
    }
    if (best && best.r2 > 0.5) {
      E.lag = Math.round(best.lag * 10) / 10;
      E.lagR2 = best.r2;
    }
  }

  // Dónde está la moto ahora en la pista (s) y a qué velocidad: el último fijo proyectado con su velocidad y la
  // aceleración. (Se probó un filtro de Kalman, fusion.js, y no mejora: ver el README.)
  function predicted(t) {
    const f = E.fix;
    if (!f || f.s === null) return null;
    // El fijo describe dónde estabas hace `lag` segundos: se proyecta desde entonces.
    const dt = Math.max(0, Math.min(2.5, t - (f.t - lagNow())));
    const a = E.calib.f ? E.aEma : 0;
    const v = Math.max(0, f.v + a * dt);
    const s = Math.min(E.track.L, f.s + f.v * dt + 0.5 * a * dt * dt);
    return { s, v };
  }

  function render() {
    if (!E || E.mode !== "ride" || E.viewing) return;
    const t = now();
    const fl = $("flash");
    if (!fl.hidden && t > E.flashUntil) fl.hidden = true;
    const fresh = E.lastFixT !== null && t - E.lastFixT < 2.5 && !E.gpsBad;
    $("d-gps").className =
      "dot " + (fresh ? "ok" : E.lastFixT === null ? "wait" : "bad");
    showHz("d-hz");
    const p = E.track && E.fix && E.fix.on ? predicted(t) : null;
    $("d-speed").textContent = fmt((p ? p.v : E.fix ? E.fix.v : 0) * 3.6, 0);
    $("d-lap").textContent = E.lapNum
      ? "Vuelta " + E.lapNum
      : E.track
        ? "Hacia meta"
        : E.far
          ? "Fuera del circuito"
          : "Buscando la pista";
    const dash = $("dash");
    let cls = "";
    const deltaEl = $("d-delta");
    let main = "—";
    let sub = E.track
      ? E.lapStart === null
        ? "esperando meta"
        : "primera vuelta: sin referencia"
      : E.far
        ? "Sin tiempos fuera del circuito · velocidad, g e inclinación sí (se calibran en marcha)"
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
    dash.className =
      "dash" + (E.replay ? " replay" : "") + (cls ? " " + cls : "");
    if (E.replay) render3D(t);
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
    renderLive(t);
    renderMiniMap(t);
    renderWheelie("d-wh", t);
  }

  function setText(id, text) {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }
  function setCls(id, cls) {
    const el = $(id);
    if (el.className !== cls) el.className = cls;
  }

  // Lo que mide el móvil ahora mismo (inclinación y g) y el resumen de la última curva.
  function renderLive(t) {
    const moving = E.fix && E.fix.v > 3;
    const lean = E.leanDeg;
    if (E.motionDenied) {
      setText("d-lean", "—");
      setText("d-lean-l", "sensores sin permiso");
    } else if (!E.hasGyro) {
      setText("d-lean", "—");
      setText("d-lean-l", "sin giroscopio");
    } else if (!isFinite(lean)) {
      setText("d-lean", "—");
      setText("d-lean-l", E.leanAxes ? "inclinación" : "calibrando…");
    } else {
      // También parada: entonces sale de la gravedad (sujeta derecha, 0; en la pata de cabra, ~12°).
      setText("d-lean", fmt(Math.abs(lean), 0) + "°");
      setText(
        "d-lean-l",
        Math.abs(lean) < 3 ? "recto" : lean > 0 ? "derecha" : "izquierda",
      );
    }
    renderCalib("d-calib", "d-lap", "d-lean-l");
    if (E.calib.f && moving) {
      const g = E.aEma / G;
      setText("d-g", fmtSigned(g, 2));
      setText("d-g-l", g < -0.15 ? "g freno" : g > 0.1 ? "g gas" : "g");
    } else {
      setText("d-g", "—");
      setText(
        "d-g-l",
        E.motionDenied ? "sin permiso" : E.calib.f ? "g" : "calibrando…",
      );
    }
    const r = E.recap;
    const box = $("d-recap");
    if (!r) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    // Recién salido de la curva: el resumen se marca unos segundos.
    setCls("d-recap", "recap" + (t - E.recapT < 3 ? " fresh" : ""));
    setText("r-name", "C" + r.num + " · " + r.name);
    setText("r-dt", r.dt === null ? "" : fmtSigned(r.dt, 2) + " s");
    setCls(
      "r-dt",
      "num " +
        (r.dt === null ? "" : r.dt < -0.03 ? "up" : r.dt > 0.03 ? "down" : ""),
    );
    const ref = r.ref;
    // Diferencia con la mejor vuelta en esa curva; solo lleva color si pasa de `thr` (ruido del móvil).
    const cmp = (id, val, refVal, digits, unit, higherIsBetter, thr) => {
      setText(id, val === null ? "—" : fmt(val, digits) + unit);
      let d = "";
      let cls = "";
      if (val !== null && ref && refVal !== null && refVal !== undefined) {
        const diff = val - refVal;
        d =
          Math.abs(diff) < 0.5 * Math.pow(10, -digits)
            ? "="
            : fmtSigned(diff, digits);
        if (higherIsBetter !== null && Math.abs(diff) >= thr)
          cls = diff > 0 === higherIsBetter ? "up" : "down";
      }
      setText(id + "-d", d);
      setCls(id + "-d", "num " + cls);
    };
    cmp("r-lean", r.leanMax, ref && ref.leanMax, 0, "°", null, 0);
    cmp("r-g", r.gMax, ref && ref.gMax, 2, " g", true, 0.04);
    cmp("r-v", r.vMin, ref && ref.vMin, 0, "", true, 1.5);
    // Punto de frenada frente a la mejor vuelta: + es más tarde (más cerca de la curva).
    let bp = "—";
    let bpCls = "";
    if (
      r.brakeS !== null &&
      ref &&
      ref.brakeS !== null &&
      ref.brakeS !== undefined
    ) {
      const L = E.track.L;
      const d = ring(r.brakeS - ref.brakeS + L / 2, L) - L / 2;
      bp = (d > 0 ? "+" : d < 0 ? "−" : "") + fmt(Math.abs(d), 0) + " m";
      bpCls = d >= 3 ? "up" : d <= -3 ? "down" : "";
    }
    setText("r-bp", bp);
    setCls("r-bp", "num " + bpCls);
    const bl = brakeLine(r.brk);
    $("r-brk").hidden = !bl;
    setText("r-brk", bl);
  }

  // ---------- mapas: circuito en el panel y ruta libre ----------
  const mapView = {
    follow: true,
    span: 600,
    colorBy: "fase",
    drawnAt: 0,
    miniAt: 0,
    legendBy: null,
  };
  let summaryColor = "fase";

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(r).padStart(2, "0");
  }
  function curveMarks(curves) {
    return curves
      .slice(-60)
      .filter((c) => c.apex && c.leanMax)
      .map((c) => ({
        x: c.apex.x,
        y: c.apex.y,
        text: fmt(c.leanMax, 0) + "°",
      }));
  }
  function wheelieText(w) {
    return (
      "Caballito · " +
      fmt(w.dur, 1) +
      " s · " +
      w.dist +
      " m · " +
      fmt(w.max, 0) +
      "° · ≈" +
      fmt(w.lost, 2) +
      " s perdidos"
    );
  }
  // Aviso de caballito: 8 s después de bajar la rueda.
  function renderWheelie(id, t) {
    const w = E.wheelieRecap;
    const on = !!w && t - E.wheelieT < 8;
    if ($(id).hidden === on) $(id).hidden = !on;
    if (on) setText(id, wheelieText(w));
  }

  // Punto del eje del circuito a una distancia s de meta, con su rumbo.
  function trackPoint(tr, s) {
    const L = tr.L;
    const ss = ((s % L) + L) % L;
    let lo = 0;
    let hi = tr.n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tr.cs[mid] <= ss) lo = mid;
      else hi = mid;
    }
    const a = tr.C[lo];
    const b = tr.C[(lo + 1) % tr.n];
    const f = (ss - tr.cs[lo]) / (tr.cs[lo + 1] - tr.cs[lo] || 1);
    return {
      x: a[0] + (b[0] - a[0]) * f,
      y: a[1] + (b[1] - a[1]) * f,
      heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
    };
  }
  function sectorPaths(tr, bounds) {
    return bounds.map((b0, k) => {
      const b1 = bounds[(k + 1) % bounds.length];
      const len = (((b1 - b0) % tr.L) + tr.L) % tr.L;
      const pts = [];
      for (let d = 0; d <= len; d += 8) {
        const p = trackPoint(tr, b0 + d);
        pts.push([p.x, p.y]);
      }
      return pts;
    });
  }

  // Circuito en el panel: tu trazada de esta vuelta, sectores, frenadas de la mejor vuelta y dónde vas.
  function renderMiniMap(t) {
    const cv = $("d-map");
    const want = settings.mapa !== false && !!E.track;
    if (cv.hidden === want) cv.hidden = !want;
    if (!want) return;
    const nowMs = performance.now();
    if (nowMs - mapView.miniAt < 200) return;
    mapView.miniAt = nowMs;
    const tr = E.track;
    if (!E.mapSectors || E.mapSectorsFor !== tr) {
      E.mapSectors = sectorPaths(tr, E.bounds);
      E.mapSectorsFor = tr;
    }
    const p = E.fix && E.fix.on ? predicted(t) : null;
    const brakes =
      E.best && E.best.brakeS
        ? E.best.brakeS
            .filter((s) => s !== null)
            .map((s) => {
              const q = trackPoint(tr, s);
              return [q.x, q.y];
            })
        : [];
    window.MaspaMapa.draw(cv, {
      outline: tr.C,
      width: 12,
      sectors: E.mapSectors.map((pts, k) => ({ pts, state: E.sectorState[k] })),
      brakes,
      trail: E.route.trail.slice(E.lapTrail),
      pos: p ? trackPoint(tr, p.s) : E.route.position(t, E.rideV, lagNow()),
      follow: false,
      colorBy: "fase",
    });
  }

  // ---------- aviso de caída (ruta libre) ----------
  // Cuenta atrás con pitidos; si nadie toca «Estoy bien», sirena, la posición en grande (sin SIM, al 112 no le
  // llega sola) y el 112 a mano para quien te encuentre. La cuenta va con el reloj de verdad, no con el de la tanda.
  const ALARM_S = 30;
  let crashUi = null;
  let alarmAudio = null;

  // El sonido solo puede arrancar tras un toque: se prepara al pulsar «Ruta libre».
  function prepareAlarmAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!alarmAudio) alarmAudio = new AC();
      if (alarmAudio.state === "suspended") alarmAudio.resume().catch(() => {});
    } catch (e) {
      alarmAudio = null;
    }
  }

  function tone(freq, dur) {
    const a = alarmAudio;
    if (!a) return;
    try {
      if (a.state === "suspended") a.resume().catch(() => {});
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "square";
      o.frequency.value = freq;
      g.gain.value = 0.9;
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch (e) {
      /* sin sonido */
    }
  }

  function vibrate(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch (e) {
      /* sin vibración */
    }
  }

  // Última posición buena del GPS (para dictarla al 112).
  function lastPosition(eng) {
    const l = eng ? eng.loc.view() : null;
    if (!l) return null;
    for (let i = l.t.length - 1; i >= 0; i--)
      if (l.hacc[i] <= 50) return { lat: l.lat[i], lon: l.lon[i] };
    return null;
  }

  function posText(p) {
    const f = (x) => Math.abs(x).toFixed(5).replace(".", ",");
    return (
      f(p.lat) +
      "° " +
      (p.lat >= 0 ? "N" : "S") +
      "   " +
      f(p.lon) +
      "° " +
      (p.lon >= 0 ? "E" : "O")
    );
  }

  function crashAlarm(ev) {
    if (crashUi || !E) return;
    const rec = {
      hora: new Date().toISOString(),
      t: Math.round(ev.t * 10) / 10,
      por: ev.por,
      g: ev.g ? Math.round(ev.g * 10) / 10 : null,
      kmhAntes: Math.round(ev.vAntes * 3.6),
      tumbada: ev.tumbada,
      paradoA: null,
      alarma: false,
    };
    E.crashLog.push(rec);
    crashUi = {
      eng: E,
      rec,
      t0: performance.now() / 1000,
      alarm: false,
      last: -1,
      timer: setInterval(crashTick, 200),
    };
    const pos = lastPosition(E);
    setText("crash-h", "¿Estás bien?");
    setText(
      "crash-t",
      "Parece una caída. Si no tocas «Estoy bien», suena la alarma para que te encuentren.",
    );
    setText("crash-where", pos ? posText(pos) : "Sin posición del GPS");
    const tel = (settings.emergencia || "").replace(/[^\d+]/g, "");
    $("crash-tel").hidden = !tel;
    if (tel) {
      $("crash-tel").href = "tel:" + tel;
      setText("crash-tel", "Llamar al " + settings.emergencia.trim());
    }
    $("crash-help").hidden = true;
    $("crash").classList.remove("alarm");
    $("crash").hidden = false;
    vibrate([500, 250, 500, 250, 500]);
    crashTick();
    saveMeta("grabando");
  }

  function crashTick() {
    const u = crashUi;
    if (!u) return;
    const el = performance.now() / 1000 - u.t0;
    if (!u.alarm) {
      const left = Math.max(0, ALARM_S - el);
      setText("crash-count", String(Math.ceil(left)));
      const sec = Math.floor(el);
      if (sec !== u.last) {
        u.last = sec;
        tone(sec % 2 ? 880 : 1100, 0.18);
      }
      if (left > 0) return;
      u.alarm = true;
      u.rec.alarma = true;
      u.last = -1;
      setText("crash-h", "Posible accidente");
      setText("crash-count", "");
      setText(
        "crash-t",
        "Si el piloto no responde: llama al 112 (desde aquí o desde tu móvil) y diles esta posición.",
      );
      $("crash-help").hidden = false;
      $("crash").classList.add("alarm");
      vibrate(1500);
      if (u.eng === E) saveMeta("grabando");
    }
    // Sirena: dos tonos que se alternan cada medio segundo; vibración cada 2 s.
    const half = Math.floor(el * 2);
    if (half !== u.last) {
      u.last = half;
      tone(half % 2 ? 1500 : 1000, 0.45);
      if (half % 4 === 0) vibrate(1200);
    }
  }

  function crashDismiss() {
    const u = crashUi;
    if (!u) return;
    clearInterval(u.timer);
    crashUi = null;
    vibrate(0);
    u.rec.paradoA = Math.round(performance.now() / 1000 - u.t0);
    if (u.eng.crash) u.eng.crash.dismiss();
    $("crash").hidden = true;
    $("crash").classList.remove("alarm");
    if (u.eng === E) saveMeta("grabando");
  }

  // Sin red el mensaje se queda en la app de mensajería hasta que haya; si no se puede compartir, se copia.
  async function crashShare() {
    const p = lastPosition(crashUi ? crashUi.eng : E);
    const url = p
      ? "https://maps.google.com/?q=" +
        p.lat.toFixed(6) +
        "," +
        p.lon.toFixed(6)
      : "";
    const text =
      "Posible accidente de moto" +
      (p ? " en " + url + " (" + posText(p) + ")" : "") +
      ", a las " +
      new Date().toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }) +
      ".";
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      /* cancelado o sin compartir: se copia */
    }
    try {
      await navigator.clipboard.writeText(text);
      setText("crash-share", "Copiado: pégalo en un mensaje");
    } catch (e) {
      setText("crash-where", text);
    }
  }

  // ---------- circuito cualquiera (en la ruta libre) ----------
  function loadCircuits() {
    const list = load("pista-circuitos", []);
    return Array.isArray(list) ? list.filter((c) => c && c.centerline) : [];
  }

  // Con cada fijo de la ruta libre: el cronómetro si ya hay circuito; si no, ¿pasa por uno guardado (cada 2 s)?, y
  // cada 30 s, con más de 1 km rodado, se intenta sacar el trazado de lo grabado (necesita 2 vueltas).
  function circStep(t, lat, lon, v) {
    const C = window.MaspaCircuito;
    if (!C) return;
    if (E.circ) {
      const lap = E.circ.onFix(t, lat, lon, v);
      if (lap) {
        if (lap.valid) showLapFlash(lap.time, lap.isBest, lap.prevBest);
        saveMeta("grabando");
      }
      return;
    }
    const R = E.circRecent;
    if (!R.length || t - R[R.length - 1].t >= 0.5) R.push({ t, lat, lon, v });
    while (R.length && t - R[0].t > 8) R.shift();
    if (E.circList.length && v > 4 && t - E.circMatchAt >= 2) {
      E.circMatchAt = t;
      const m = C.matchSaved(E.circList, R);
      if (m) {
        useCircuit(m.track, m.reverse, true);
        return;
      }
    }
    if (!E.circBusy && t - E.circTryAt >= 30 && E.route.stats.dist > 1000)
      tryBuildCircuit(t);
  }

  let circWorkerObj = null;
  let circReq = 0;
  const circWaiting = new Map();
  function circWorker() {
    if (circWorkerObj === false) return null;
    if (!circWorkerObj) {
      try {
        circWorkerObj = new Worker("circuito-worker.js");
        circWorkerObj.onmessage = (e) => {
          const d = e.data || {};
          const done = circWaiting.get(d.id);
          circWaiting.delete(d.id);
          if (done) done(d);
        };
        circWorkerObj.onerror = () => {
          for (const done of circWaiting.values()) done({ error: "worker" });
          circWaiting.clear();
        };
      } catch (e) {
        circWorkerObj = false;
        return null;
      }
    }
    return circWorkerObj;
  }

  // Trazado a partir de lo grabado (la última media hora, a 5 Hz como mucho), en el worker.
  function tryBuildCircuit(t) {
    E.circTryAt = t;
    const w = circWorker();
    if (!w) return;
    const l = E.loc.view();
    const cols = { t: [], lat: [], lon: [], speed: [], hacc: [] };
    let last = -Infinity;
    for (let i = 0; i < l.t.length; i++) {
      if (l.t[i] < t - 1800 || l.t[i] - last < 0.2) continue;
      last = l.t[i];
      cols.t.push(l.t[i]);
      cols.lat.push(l.lat[i]);
      cols.lon.push(l.lon[i]);
      cols.speed.push(l.speed[i] >= 0 ? l.speed[i] : NaN);
      cols.hacc.push(l.hacc[i]);
    }
    const eng = E;
    const id = ++circReq;
    eng.circBusy = true;
    circWaiting.set(id, (d) => {
      eng.circBusy = false;
      if (E !== eng || eng.circ || !d.track) return;
      useCircuit(d.track, false, false);
    });
    const day = new Date(eng.wall0 || Date.now()).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
    });
    w.postMessage({ id, fixes: cols, name: "Circuito del " + day });
  }

  // A partir de ahora, cronómetro en ese circuito; lo ya rodado por él cuenta (las vueltas con que se ha detectado).
  function useCircuit(track, reverse, saved) {
    const timer = new window.MaspaCircuito.LapTimer(track, reverse);
    const l = E.loc.view();
    for (let i = 0; i < l.t.length; i++)
      if (l.hacc[i] <= 25)
        timer.onFix(
          l.t[i],
          l.lat[i],
          l.lon[i],
          l.speed[i] >= 0 ? l.speed[i] : 0,
        );
    E.circ = timer;
    E.circTrack = track;
    E.circSaved = saved;
    saveMeta("grabando");
  }

  function renderCircuit(t) {
    const c = E.circ;
    $("ru-laps").hidden = !c;
    if (!c) return;
    const st = c.state(t, lagNow());
    setText(
      "ru-lap",
      (st.lapNum ? "Vuelta " + st.lapNum : "Hacia meta") +
        (st.lapTime !== null ? " · " + fmtLap(st.lapTime, 1) : ""),
    );
    setText("ru-best", "Mejor " + (st.best !== null ? fmtLap(st.best) : "—"));
    setText("ru-delta", st.delta === null ? "—" : fmtSigned(st.delta, 2));
    setCls(
      "ru-delta",
      "num" +
        (st.delta === null
          ? ""
          : st.delta < -0.05
            ? " up"
            : st.delta > 0.05
              ? " down"
              : ""),
    );
  }

  // Ruta libre: mapa que sigue a la moto, lo que mide el móvil, la última curva y los totales.
  function renderRoute() {
    if (!E || $("ruta").hidden) return;
    const t = now();
    const fl = $("flash");
    if (!fl.hidden && t > E.flashUntil) fl.hidden = true;
    renderCircuit(t);
    setText(
      "ru-title",
      E.circ
        ? E.circTrack.name
        : E.segment > 1
          ? "Tramo " + E.segment
          : "Ruta libre",
    );
    const fresh = E.lastFixT !== null && t - E.lastFixT < 2.5 && !E.gpsBad;
    setCls(
      "ru-gps",
      "dot " + (fresh ? "ok" : E.lastFixT === null ? "wait" : "bad"),
    );
    showHz("ru-hz");
    const v = E.rideV === E.rideV ? E.rideV : E.fix ? E.fix.v : 0;
    setText("ru-speed", fmt(v * 3.6, 0));
    const moving = v > 3;
    const lean = E.leanDeg;
    if (E.motionDenied) {
      setText("ru-lean", "—");
      setText("ru-lean-l", "sin permiso");
    } else if (!isFinite(lean)) {
      setText("ru-lean", "—");
      setText("ru-lean-l", E.leanAxes ? "inclinación" : "calibrando…");
    } else {
      setText("ru-lean", fmt(Math.abs(lean), 0) + "°");
      setText(
        "ru-lean-l",
        Math.abs(lean) < 3 ? "recto" : lean > 0 ? "derecha" : "izquierda",
      );
    }
    renderCalib("ru-calib", "ru-title", "ru-lean-l");
    // «Nuevo tramo» va con «Calibrar»: solo con la moto parada (y grabando).
    $("ru-seg").hidden = $("ru-calib").hidden || !E.rec;
    if (E.calib.f && moving) {
      const g = E.aEma / G;
      setText("ru-g", fmtSigned(g, 2));
      setText("ru-g-l", g < -0.15 ? "g freno" : g > 0.1 ? "g gas" : "g");
    } else {
      setText("ru-g", "—");
      setText("ru-g-l", E.calib.f ? "g" : "calibrando…");
    }
    setText(
      "ru-pitch",
      // También parada (tras «Calibrar», 0; sin «+0» ni «−0»).
      !isFinite(E.pitchDeg)
        ? "—"
        : Math.abs(E.pitchDeg) < 0.5
          ? "0°"
          : fmtSigned(E.pitchDeg, 0) + "°",
    );
    const c = E.curveRecap;
    $("ru-recap").hidden = !c;
    if (c) {
      setCls("ru-recap", "recap" + (t - E.curveT < 3 ? " fresh" : ""));
      setText(
        "ru-name",
        "Curva " +
          c.num +
          (c.lean === null ? "" : c.lean > 0 ? " · derecha" : " · izquierda"),
      );
      setText("ru-dead", fmt(c.dur, 1) + " s en curva");
      setText("ru-c-lean", c.leanMax ? fmt(c.leanMax, 0) + "°" : "—");
      setText("ru-c-g", c.brakeG ? fmt(c.brakeG, 2) + " g" : "sin freno");
      setText("ru-c-v", fmt(c.vEntry, 0) + "→" + fmt(c.vMin, 0));
      setText("ru-c-dead", fmt(c.dead, 1) + " s");
      setCls(
        "ru-c-dead",
        "num " + (c.dead > 1.5 ? "down" : c.dead < 0.6 ? "up" : ""),
      );
      const bl = brakeLine(c.brk);
      $("ru-brk").hidden = !bl;
      setText("ru-brk", bl);
    }
    renderWheelie("ru-wh", t);
    const st = E.route.stats;
    setText("rs-dist", fmt(st.dist / 1000, 1) + " km");
    setText("rs-time", st.t0 !== null ? fmtClock(st.t1 - st.t0) : "0:00");
    const lm = Math.max(st.leanL, st.leanR);
    setText("rs-lean", "máx " + (lm ? fmt(lm, 0) + "°" : "—"));
    setText("rs-top", "punta " + (st.vMax ? fmt(st.vMax * 3.6, 0) : "—"));
    const nowMs = performance.now();
    if (nowMs - mapView.drawnAt < 160) return;
    mapView.drawnAt = nowMs;
    const pos = E.route.position(t, v, lagNow());
    window.MaspaMapa.draw($("ru-map"), {
      trail: E.route.trail,
      pos,
      follow: mapView.follow && !!pos,
      span: mapView.span,
      colorBy: mapView.colorBy,
      marks: curveMarks(E.route.curves),
    });
    if (mapView.legendBy !== mapView.colorBy) {
      window.MaspaMapa.legend($("ru-legend"), mapView.colorBy);
      mapView.legendBy = mapView.colorBy;
    }
    setText("ru-color", mapView.colorBy === "fase" ? "Fases" : "Incl.");
    setText("ru-fit", mapView.follow ? "Toda" : "Seguir");
  }

  // Fila de tabla: la primera celda es texto y el resto números. Una celda [valor, detalle] lleva el detalle
  // debajo, en pequeño (para que la tabla quepa en vertical).
  function tableRow(cells) {
    const tr = document.createElement("tr");
    cells.forEach((cell, k) => {
      const td = document.createElement("td");
      if (k) td.className = "num";
      if (Array.isArray(cell)) {
        td.textContent = cell[0];
        if (cell[1]) {
          const sm = document.createElement("small");
          sm.textContent = cell[1];
          td.appendChild(sm);
        }
      } else td.textContent = cell;
      tr.appendChild(td);
    });
    return tr;
  }
  const hasDive = (b) => b.dive !== null && b.dive !== undefined;
  const fmtDive = (b) =>
    hasDive(b) ? fmt(b.dive, 1) + "° ≈" + b.diveMm + " mm" : "—";
  const diveCell = (b) =>
    hasDive(b) ? [fmt(b.dive, 1) + "°", "≈" + b.diveMm + " mm"] : "—";
  const trailCell = (b) =>
    b.trail > 0
      ? [b.trail + " m", b.leanMax ? fmt(b.leanMax, 0) + "°" : ""]
      : "—";

  // Las frenadas de la ruta (las más fuertes primero).
  function routeBrakes(s) {
    const list = s.listaFrenadas || [];
    $("ruf-b").hidden = !list.length;
    setText(
      "ruf-b-note",
      (s.frenadas > list.length
        ? "Las " + list.length + " más fuertes de " + s.frenadas + ". "
        : "") +
        "«Llega»: lo que tardas en llegar al 80 % del pico (más corto, más decidido). «Hunde»: cuánto baja el morro; los mm son una estimación.",
    );
    const tb = $("ruf-brk");
    tb.textContent = "";
    for (const b of list)
      tb.appendChild(
        tableRow([
          String(b.num),
          fmt(b.peak, 2) + " g",
          fmt(b.bite, 2) + " s",
          b.vIn + " → " + b.vOut,
          diveCell(b),
          trailCell(b),
        ]),
      );
  }

  // Resumen al terminar la ruta: mapa entero, totales, las curvas más tumbadas y los caballitos.
  // Vueltas del circuito en el resumen de la ruta libre, y guardarlo para reconocerlo la próxima vez.
  function renderRouteLaps(eng) {
    // Repasando una ruta guardada por un circuito que no se guardó: las vueltas que se apuntaron entonces.
    const mc =
      !eng.circ && eng.viewing && eng.viewing.circuito
        ? eng.viewing.circuito
        : null;
    const c = eng.circ
      ? eng.circ
      : mc
        ? {
            laps: (mc.vueltas || []).map((v) => ({
              num: v.num,
              time: v.time,
              valid: v.valid,
            })),
            best: mc.mejor ? { time: mc.mejor } : null,
          }
        : null;
    $("ruf-l").hidden = !c;
    if (!c) return;
    const body = $("ruf-laps");
    body.textContent = "";
    const best = c.best ? c.best.time : null;
    for (const l of c.laps) {
      const tr = document.createElement("tr");
      const cells = [
        String(l.num),
        fmtLap(l.time) + (l.valid ? "" : " *"),
        !l.valid || best === null
          ? "—"
          : l.time === best
            ? "mejor"
            : fmtSigned(l.time - best, 2),
      ];
      cells.forEach((txt, k) => {
        const td = document.createElement("td");
        if (k) td.className = "num";
        td.textContent = txt;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    const track = mc ? { name: mc.nombre, length: mc.longitud } : eng.circTrack;
    // Sin el trazado (solo las vueltas apuntadas) no hay nada que guardar.
    const canSave = !mc && !eng.circSaved;
    setText(
      "ruf-l-note",
      track.name +
        " · " +
        fmt(track.length, 0) +
        " m · " +
        (c.laps.length
          ? c.laps.filter((l) => l.valid).length +
            " vueltas completas" +
            (c.laps.some((l) => !l.valid)
              ? " (* sin contar: paso por boxes o fuera del circuito)"
              : "")
          : "aún sin vueltas completas") +
        (mc
          ? "."
          : eng.circSaved
            ? ". Circuito guardado: se reconoce solo al pasar por él."
            : ". Sacado de tus vueltas: guárdalo para que la próxima vez cuente desde la primera."),
    );
    $("ruf-save-box").hidden = !canSave;
    $("ruf-save").hidden = !canSave;
    if (canSave) $("ruf-name").value = track.name;
  }

  function saveCircuit() {
    const eng = lastE;
    if (!eng || !eng.circTrack || eng.circSaved) return;
    const name = $("ruf-name").value.trim() || eng.circTrack.name;
    const saved = window.MaspaCircuito.compact(
      Object.assign({}, eng.circTrack, { name }),
    );
    const list = loadCircuits().filter((c) => c.name !== name);
    list.push(saved);
    store("pista-circuitos", list);
    eng.circTrack = saved;
    eng.circSaved = true;
    renderRouteLaps(eng);
  }

  function showRouteSummary(eng) {
    show("ruta-fin");
    renderRouteLaps(eng);
    const r = eng.route;
    const s = r.summary();
    const d = new Date(eng.rec ? eng.rec.epoch : eng.viewEpoch || Date.now());
    setText(
      "ruf-sub",
      d.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }) +
        " · " +
        fmt(s.distancia / 1000, 1) +
        " km · " +
        fmtClock(s.duracion),
    );
    window.MaspaMapa.draw($("ruf-map"), {
      trail: r.trail,
      follow: false,
      colorBy: summaryColor,
      marks: curveMarks(r.curves),
    });
    window.MaspaMapa.legend($("ruf-legend"), summaryColor);
    setText(
      "ruf-color",
      "Color: " + (summaryColor === "fase" ? "fases" : "inclinación"),
    );
    const box = $("ruf-stats");
    box.textContent = "";
    const add = (label, value) => {
      const div = document.createElement("div");
      const sm = document.createElement("small");
      sm.textContent = label;
      const b = document.createElement("b");
      b.className = "num";
      b.textContent = value;
      div.append(sm, b);
      box.appendChild(div);
    };
    add("Distancia", fmt(s.distancia / 1000, 1) + " km");
    add("Tiempo", fmtClock(s.duracion));
    add("Punta", fmt(s.punta, 0) + " km/h");
    add("Incl. derecha", s.inclDerecha ? fmt(s.inclDerecha, 0) + "°" : "—");
    add(
      "Incl. izquierda",
      s.inclIzquierda ? fmt(s.inclIzquierda, 0) + "°" : "—",
    );
    add("Frenada máx.", s.frenadaMax ? fmt(s.frenadaMax, 2) + " g" : "—");
    add("Frenadas", String(s.frenadas || 0));
    add(
      "Mejor mordida",
      s.mordidaMejor !== null && s.mordidaMejor !== undefined
        ? fmt(s.mordidaMejor, 2) + " s"
        : "—",
    );
    add(
      "Hundimiento máx.",
      s.hundimientoMax !== null && s.hundimientoMax !== undefined
        ? fmt(s.hundimientoMax, 1) + "° ≈" + s.hundimientoMaxMm + " mm"
        : "—",
    );
    add(
      "Frenando tumbado",
      s.frenadaTumbadoMax ? s.frenadaTumbadoMax + " m (máx.)" : "—",
    );
    add(
      "Aceleración máx.",
      s.aceleracionMax ? fmt(s.aceleracionMax, 2) + " g" : "—",
    );
    add("Curvas", String(s.curvas));
    if (eng.crashLog.length)
      add(
        "Avisos de caída",
        eng.crashLog
          .map(
            (c) =>
              new Date(c.hora).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
              }) +
              (c.alarma
                ? " · sonó la alarma"
                : c.paradoA !== null
                  ? " · «Estoy bien» a los " + c.paradoA + " s"
                  : ""),
          )
          .join("; "),
      );
    add(
      "Sin gas en curva (media)",
      s.tiempoMuertoMedio !== null ? fmt(s.tiempoMuertoMedio, 1) + " s" : "—",
    );
    add(
      "Caballitos",
      s.caballitos
        ? s.caballitos +
            " · " +
            s.caballitosMetros +
            " m · ≈" +
            fmt(s.caballitosPerdido, 2) +
            " s"
        : "ninguno",
    );
    const top = r.curves
      .filter((c) => c.leanMax)
      .slice()
      .sort((a, b) => b.leanMax - a.leanMax)
      .slice(0, 15);
    setText(
      "ruf-c-note",
      r.curves.length > top.length
        ? "Las " +
            top.length +
            " curvas más tumbadas de " +
            r.curves.length +
            "."
        : r.curves.length
          ? ""
          : "No se ha detectado ninguna curva.",
    );
    const tb = $("ruf-curves");
    tb.textContent = "";
    const row = tableRow;
    for (const c of top)
      tb.appendChild(
        row([
          c.num + (c.lean > 0 ? " der." : " izq."),
          fmt(c.leanMax, 0) + "°",
          fmt(c.vEntry, 0) + " → " + fmt(c.vMin, 0),
          c.brakeG ? fmt(c.brakeG, 2) + " g" : "—",
          fmt(c.dead, 1) + " s",
        ]),
      );
    routeBrakes(s);
    const wb = $("ruf-wh");
    wb.textContent = "";
    $("ruf-w").hidden = !r.wheelies.length;
    for (const w of r.wheelies)
      wb.appendChild(
        row([
          String(w.num),
          fmt(w.dur, 1) + " s",
          w.dist + " m",
          fmt(w.max, 0) + "°",
          w.v0 + " km/h",
          "≈" + fmt(w.lost, 2) + " s",
        ]),
      );
  }

  function loop() {
    // Repasando una tanda guardada, el motor lo mueve viewSaved (no el simulador) y no hay panel que pintar.
    if (E && E.viewing) {
      requestAnimationFrame(loop);
      return;
    }
    if (E && E.sim) simStep();
    if (E && E.free) renderRoute();
    else render();
    if (E) recFlush(false);
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
    if (sim.iL >= d.loc.t.length && E.mode === "ride") {
      if (E.free) stopAll();
      else enterPits();
    }
  }

  // Solo para pruebas automáticas: opts.grabar guarda la tanda simulada como una de verdad y opts.session
  // reproduce otra grabación (por ejemplo, con un GPS peor).
  function startSim(speedFactor, opts) {
    E = newEngine(true, opts && opts.free);
    E.t0 = 0;
    sim.data =
      opts && opts.session ? opts.session : T.demoSession({ seed: 7 }).session;
    sim.t = 0;
    sim.iL = 0;
    sim.iM = 0;
    sim.last = null;
    sim.speed = speedFactor || 1;
    if (opts && opts.grabar) recStart(Date.now());
    // La vuelta de ejemplo se ve en 3D (casco, detrás o arriba) con todas las métricas del panel.
    E.replay = !E.free && !(opts && opts.no3d);
    $("d-3d").hidden = !E.replay;
    $("d-speedx").textContent = "×" + sim.speed;
    if (E.replay) prepare3D();
    show(E.free ? "ruta" : "dash");
  }

  // ---------- vuelta de ejemplo en 3D ----------
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src])
      loaded[src] = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = res;
        s.onerror = () => {
          delete loaded[src];
          rej(new Error("no se ha podido cargar " + src));
        };
        document.head.appendChild(s);
      });
    return loaded[src];
  }
  let view3d = null;
  let view3dCam = "casco";
  async function prepare3D() {
    setText("d-3d-wait", "Cargando el circuito en 3D…");
    $("d-3d-wait").hidden = false;
    try {
      await loadScript("three.min.js");
      await loadScript("vista3d.js");
    } catch (e) {
      setText(
        "d-3d-wait",
        "No se ha podido cargar la vista 3D (sin conexión la primera vez).",
      );
    }
  }
  // Se crea cuando ya se sabe el sentido de marcha (el trazado depende de él) y se pinta en cada fotograma.
  function render3D(t) {
    if (!window.MaspaVista3D || !E.track) return;
    if (view3d && view3d.failed) return;
    if (!view3d || view3d.track !== E.track) {
      if (view3d) view3d.v.dispose();
      view3d = null;
      const v = window.MaspaVista3D.create($("d-3d"), E.track, {
        corners: E.corners,
        bounds: E.bounds,
      });
      if (!v) {
        // Un solo intento: sin WebGL no se vuelve a probar en cada fotograma.
        view3d = { failed: true };
        setText("d-3d-wait", "Este móvil no puede dibujar en 3D.");
        return;
      }
      v.setMode(view3dCam);
      view3d = { v, track: E.track, brakes: null, last: null };
      $("d-3d-wait").hidden = true;
    }
    const brakes = E.best ? E.best.brakeS : null;
    if (view3d.brakes !== brakes) {
      view3d.v.setBrakes(brakes || []);
      view3d.brakes = brakes;
    }
    const p = E.fix && E.fix.on ? predicted(t) : null;
    if (!p) return;
    const nowMs = performance.now();
    const dt =
      view3d.last === null
        ? 0.016
        : Math.min(0.1, (nowMs - view3d.last) / 1000);
    view3d.last = nowMs;
    view3d.v.update({ s: p.s, lean: E.leanDeg, v: p.v }, dt);
  }
  function close3D() {
    if (view3d && view3d.v) view3d.v.dispose();
    view3d = null;
    $("d-3d").hidden = true;
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
    markMotion(ev);
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
    // Giro tal cual lo da el navegador (alpha, beta, gamma en °/s → rad/s); a qué eje corresponde cada uno lo
    // decide E.axes comprobándolo con la gravedad.
    const DEG = Math.PI / 180;
    const gyro =
      r && r.alpha !== null
        ? [r.alpha * DEG, r.beta * DEG, r.gamma * DEG]
        : [0, 0, 0];
    onMotion(t, lin, grav, gyro);
  }

  // Navegadores que bloquean los sensores de movimiento (Brave lo hace por defecto, contra el rastreo; medido
  // en un Pixel 10 Pro: acelerómetro y giroscopio «denied» y un solo evento vacío). Se detecta y se dice qué hacer.
  function isBrave() {
    return !!(navigator.brave && navigator.brave.isBrave);
  }
  function sensorBlockText() {
    return isBrave()
      ? "Brave bloquea los sensores de movimiento (inclinación, g y caballitos). Ábrela en Chrome (recomendado) o, en Brave: Ajustes → Configuración de sitios → Sensores de movimiento → Permitir, y vuelve a abrirla."
      : "El navegador bloquea los sensores de movimiento (inclinación, g y caballitos): permítelos en los ajustes de este sitio y vuelve a abrirla.";
  }
  // Lo que manda son los datos: con el permiso «denied» hay navegadores que siguen enviándolos.
  // Bloqueado = permiso negado y ningún dato de movimiento en 1,5 s.
  let motionSeen = false;
  function markMotion(e) {
    const a = e && e.accelerationIncludingGravity;
    if (a && a.x !== null && a.x !== undefined) motionSeen = true;
  }
  async function sensorsBlocked() {
    if (motionSeen) return false;
    let denied = false;
    try {
      const st = await navigator.permissions.query({ name: "accelerometer" });
      denied = st.state === "denied";
    } catch (e) {
      denied = false;
    }
    if (!denied) return false;
    window.addEventListener("devicemotion", markMotion);
    await new Promise((r) => setTimeout(r, 1500));
    window.removeEventListener("devicemotion", markMotion);
    return !motionSeen;
  }
  async function checkSensorBlock() {
    const blocked = await sensorsBlocked();
    const el = $("sensor-block");
    el.hidden = !blocked;
    if (blocked) el.textContent = sensorBlockText();
    return blocked;
  }

  // iPhone: los sensores de movimiento piden permiso, y solo se puede pedir justo al tocar un botón
  // (antes de cualquier otra espera). En Android no hace falta.
  async function askMotion() {
    const D = window.DeviceMotionEvent;
    if (!D || typeof D.requestPermission !== "function") return true;
    try {
      return (await D.requestPermission()) === "granted";
    } catch (e) {
      return false;
    }
  }

  // Al echar a rodar, la orientación de la pantalla se queda fija: al tumbar en curva, el giro automático de
  // Android podría cambiar el panel de vertical a horizontal a mitad de curva. No al pulsar «Salir»: el móvil
  // aún puede ir en la mano y luego colocarse plano y en horizontal. Esa orientación es también la que dice
  // hacia dónde está adelante con el móvil plano (T.mountAxes).
  // Con «Pantalla en pista» elegida en Ajustes, se fija esa en vez de la que haya.
  async function lockOrientation() {
    E.orientTried = true;
    const want = forcedOrient();
    if (want) return forceOrientation();
    E.screenAngle = screenAngle();
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock(screen.orientation.type);
        if (E) E.orientLock = screen.orientation.type;
      }
    } catch (e) {
      /* sin pantalla completa o navegador sin bloqueo: queda el giro automático */
    }
  }

  const ORIENTS = [
    "auto",
    "portrait-primary",
    "landscape-primary",
    "landscape-secondary",
  ];
  function forcedOrient() {
    const w = settings.pantalla;
    return ORIENTS.includes(w) && w !== "auto" ? w : null;
  }

  // Ángulo de la pantalla cuando ha terminado de girar (lock() puede resolverse antes de que cambie).
  function settledAngle() {
    return new Promise((res) => {
      const o = screen.orientation;
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        if (o) o.removeEventListener("change", fin);
        res(screenAngle());
      };
      if (o) o.addEventListener("change", fin);
      setTimeout(fin, 600);
    });
  }

  // «Pantalla en pista» (Ajustes): con el giro automático apagado, el panel saldría como esté la pantalla aunque
  // el móvil vaya de lado. Al salir (ya en pantalla completa, que es lo que permite fijarla) se pone la elegida,
  // y con ella se sabe desde el principio hacia dónde está adelante con el móvil plano. En el Vivo Y33s, el aviso
  // de permiso de ubicación de la primera vez la deshace: se vuelve a poner con el primer fijo (ver startReal).
  async function forceOrientation() {
    const want = forcedOrient();
    if (!want || !screen.orientation || !screen.orientation.lock) return;
    const turning = screen.orientation.type !== want;
    try {
      await screen.orientation.lock(want);
      if (E) E.orientLock = want;
    } catch (e) {
      /* sin pantalla completa o navegador sin bloqueo: queda como esté */
      return;
    }
    const ang = turning ? await settledAngle() : screenAngle();
    if (E) E.screenAngle = ang;
  }

  function renderOrient() {
    const cur = ORIENTS.includes(settings.pantalla)
      ? settings.pantalla
      : "auto";
    for (const b of document.querySelectorAll(".choice [data-orient]"))
      b.setAttribute("aria-checked", String(b.dataset.orient === cur));
  }

  // ---------- receptor GPS externo (Bluetooth o USB) ----------
  // Retraso que queda en sus fijos una vez puestos en el reloj del móvil (ver extTime): el del fijo que menos tarda.
  const EXT_LAG = 0.03;
  // Sin fijos buenos del receptor en este tiempo, vuelve a mandar el GPS del móvil.
  const EXT_STALE_MS = 1500;
  const ext = {
    kind: null, // "ble" o "usb"
    handle: null,
    state: "",
    text: "",
    busy: false,
    // USB: volver a abrirlo solo al enchufarlo otra vez (hasta que se pulse «Desconectar»).
    auto: false,
    last: null,
    lastMs: null,
    clock: newClock(),
  };

  function extFresh() {
    return ext.lastMs !== null && performance.now() - ext.lastMs < EXT_STALE_MS;
  }

  // Hora del fijo en el reloj del móvil (ms, como performance.now): la del receptor, exacta (a 25 Hz, una cada
  // 40 ms), traducida con mapClock. Sin hora del receptor, la de llegada.
  function extTime(f) {
    const rx = Number.isFinite(f.recvMs) ? f.recvMs : performance.now();
    return mapClock(ext.clock, f.utcMs, rx);
  }

  function onExtFix(f) {
    if (!(f.fix >= 2) || !Number.isFinite(f.lat) || !Number.isFinite(f.lon))
      return;
    const tp = extTime(f);
    ext.last = f;
    ext.lastMs = performance.now();
    if (!E || E.sim) return;
    E.extGps =
      ext.kind +
      (ext.handle && ext.handle.profile ? ":" + ext.handle.profile : "");
    if (!E.extUsed) {
      E.extUsed = true;
      E.extInfo = {
        fuente: E.extGps,
        nombre: ext.handle ? ext.handle.name : null,
        hz: null,
      };
    }
    const speed = Number.isFinite(f.speed) ? f.speed : null;
    // El Bluetooth estándar no da la precisión: un receptor con posición buena va sobrado.
    const hacc = Number.isFinite(f.hacc) ? f.hacc : 2;
    onFix(
      (performance.timeOrigin + tp) / 1000 - E.t0,
      f.lat,
      f.lon,
      speed,
      hacc,
    );
    if (E && !E.orientTried && speed !== null && speed > 4) lockOrientation();
  }

  function extStatus(s) {
    ext.state = s.state;
    ext.text = s.text;
    // Un USB desenchufado ya no vale: al enchufarlo otra vez se abre de nuevo (ext.auto).
    if (
      ext.kind === "usb" &&
      (s.state === "desconectado" || s.state === "error")
    )
      ext.handle = null;
    renderExt();
  }

  // Hay que llamarlo desde el toque de un botón (Chrome solo enseña la lista de aparatos así), salvo un USB ya
  // permitido (device).
  async function connectExt(kind, device) {
    if (ext.busy || ext.handle) return;
    const lib = kind === "usb" ? window.MaspaGNSSUSB : window.MaspaGNSS;
    if (!lib) return;
    ext.busy = true;
    ext.kind = kind;
    ext.last = null;
    ext.lastMs = null;
    ext.clock = newClock();
    renderExt();
    try {
      ext.handle = await lib.connect({
        device,
        onFix: onExtFix,
        onStatus: extStatus,
      });
      ext.auto = kind === "usb";
      settings.receptor = kind;
      saveSettings();
    } catch (e) {
      // El motivo ya lo ha dado el propio receptor con su estado ("error").
      ext.handle = null;
    }
    ext.busy = false;
    renderExt();
  }

  function disconnectExt() {
    const h = ext.handle;
    ext.handle = null;
    ext.auto = false;
    ext.last = null;
    ext.lastMs = null;
    ext.clock = newClock();
    settings.receptor = null;
    saveSettings();
    if (h) Promise.resolve(h.disconnect()).catch(() => {});
    renderExt();
  }

  function extRate() {
    return ext.handle ? Math.round(ext.handle.rate()) : 0;
  }

  // «25 Hz» junto al punto del GPS del panel mientras manda el receptor externo.
  function showHz(id) {
    const r = E.extGps && extFresh() ? extRate() : 0;
    const txt = r >= 1 ? r + " Hz" : "";
    const el = $(id);
    if (el.textContent !== txt) el.textContent = txt;
    el.hidden = !txt;
  }

  function renderExt() {
    const ble = !!(window.MaspaGNSS && window.MaspaGNSS.supported());
    const usb = !!(window.MaspaGNSSUSB && window.MaspaGNSSUSB.supported());
    const on = !!ext.handle;
    $("ext-ble").hidden = on || !ble;
    $("ext-usb").hidden = on || !usb;
    $("ext-ble").disabled = ext.busy;
    $("ext-usb").disabled = ext.busy;
    $("ext-off").hidden = !on;
    let dot = "";
    let text =
      "Sin receptor: se usa el GPS del móvil (1 posición por segundo).";
    if (!ble && !usb)
      text =
        "Este navegador no puede usar receptores externos: hace falta Chrome en Android.";
    else if (on && ext.state === "conectado" && extFresh()) {
      const f = ext.last;
      const r = extRate();
      dot = "ok";
      text =
        (ext.kind === "usb" ? "USB" : "Bluetooth") +
        " · " +
        ext.handle.name +
        ": " +
        (r >= 1 ? r + " posiciones por segundo" : "recibiendo posiciones") +
        (Number.isFinite(f.sats) ? " · " + f.sats + " satélites" : "") +
        (Number.isFinite(f.battery) ? " · batería " + f.battery + " %" : "") +
        ".";
    } else if (on || ext.busy || ext.state === "error") {
      dot = ext.state === "error" ? "bad" : "wait";
      text = ext.text || "Conectando con el receptor…";
      if (on && ext.state === "conectado")
        text = "Receptor conectado: esperando posiciones con cobertura…";
    } else if (ext.auto && ext.state === "desconectado")
      text = ext.text + " Se conecta solo al volver a enchufarlo.";
    setStatus("st-ext", dot, text);
  }

  // Cada segundo: el ritmo del receptor en la portada y el máximo de la tanda (para la grabación).
  function tickExt() {
    if (E && E.extInfo && extFresh()) {
      const r = extRate();
      if (r > (E.extInfo.hz || 0)) E.extInfo.hz = r;
    }
    if (!$("home").hidden) renderExt();
  }

  function wireExt() {
    $("ext-ble").addEventListener("click", () => connectExt("ble"));
    $("ext-usb").addEventListener("click", () => connectExt("usb"));
    $("ext-off").addEventListener("click", disconnectExt);
    renderExt();
    setInterval(tickExt, 1000);
    const usb = window.navigator.usb;
    if (!usb || !window.MaspaGNSSUSB) return;
    // Un USB ya permitido se abre solo: al enchufarlo (si no se desconectó a mano) y al abrir la página.
    usb.addEventListener("connect", (ev) => {
      if (ext.auto || settings.receptor === "usb") connectExt("usb", ev.device);
    });
    if (settings.receptor === "usb" && usb.getDevices)
      usb
        .getDevices()
        .then((list) => {
          if (list.length) connectExt("usb", list[0]);
        })
        .catch(() => {});
  }

  // free: ruta libre por cualquier carretera (sin circuito).
  async function startReal(free) {
    const motionOk = await askMotion();
    if (!("geolocation" in navigator)) {
      setStatus("st-gps", "bad", "Este navegador no da acceso al GPS.");
      return;
    }
    E = newEngine(false, free === true);
    E.t0 = perfNow();
    E.wall0 = Date.now();
    E.motionDenied = !motionOk;
    sensorsBlocked().then((b) => {
      if (b && E) E.motionDenied = true;
    });
    recStart(E.wall0);
    if (ST) ST.persist();
    try {
      if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen({
          navigationUI: "hide",
        });
    } catch (e) {
      /* pantalla completa opcional */
    }
    E.orientLock = null;
    E.orientTried = false;
    await forceOrientation();
    await keepAwake();
    window.addEventListener("devicemotion", onMotionEvent);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!E || E.sim) return;
        // El primer fijo llega después del aviso de permiso, que puede haber deshecho la orientación elegida.
        if (!E.orientChecked) {
          E.orientChecked = true;
          const w = forcedOrient();
          if (w && screen.orientation && screen.orientation.type !== w)
            forceOrientation();
        }
        // Con el receptor externo dando posiciones, las del móvil (peores y con otro retraso) no se usan.
        // Hora del fijo en el reloj de la tanda (la del navegador es la de pared; ver perfNow).
        const tf =
          mapClock(
            E.phoneClock,
            pos.timestamp,
            performance.timeOrigin + performance.now(),
          ) /
            1000 -
          E.t0;
        if (extFresh()) return;
        E.extGps = null;
        const c = pos.coords;
        onFix(tf, c.latitude, c.longitude, c.speed, c.accuracy);
        const v =
          c.speed !== null && c.speed >= 0 ? c.speed : E.fix ? E.fix.v : 0;
        if (E && !E.orientTried && v > 4) lockOrientation();
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
    show(E.free ? "ruta" : "dash");
    // El worker que saca el trazado de un circuito arranca ya, parado: en el Vivo Y33s su arranque paró el panel
    // medio segundo, que rodando se notaría. Y el sonido del aviso de caída solo puede prepararse tras un toque.
    if (E.free) {
      circWorker();
      if (E.crash) prepareAlarmAudio();
    }
  }

  // «Nuevo tramo» (ruta libre, con la moto parada): cierra la grabación de ahora (queda en «Tus rutas y tandas» y se
  // sube como siempre) y empieza otra en el momento, sin parar los sensores ni el GPS y sin perder lo aprendido.
  // Antes había que terminar y volver a salir, y la ruta nueva tenía que aprenderlo todo otra vez (en una de las del
  // 9 de octubre no llegó a haber inclinación). Lo que no depende del reloj de la grabación pasa al tramo nuevo.
  const SEGMENT_CARRY = [
    // Ejes, calibración, inclinación y cabeceo (con el sesgo del giroscopio y el orden de sus ejes).
    "calib",
    "lean",
    "pitch",
    "pitchAxes",
    "axes",
    "leanAxes",
    "leanKey",
    "axesVer",
    "leanSign",
    "leanVote",
    "mount",
    "mountChk",
    "screenAngle",
    "calibManual",
    "hasGyro",
    "motionDenied",
    "moved",
    // Aceleración (y la pendiente que se le quita), retraso del GPS y traducción de su reloj.
    "aRaw",
    "aBias",
    "aEma",
    "wLp",
    "lag",
    "lagR2",
    "phoneClock",
    // Receptor externo y orientación de la pantalla.
    "extGps",
    "extUsed",
    "extInfo",
    "orientLock",
    "orientTried",
    "orientChecked",
  ];
  async function newSegment() {
    if (!E || E.sim || E.viewing || !E.free || !E.rec) return false;
    const old = E;
    recFlush(true);
    saveMeta("terminada");
    const saved = old.rec.queue;
    const eng = newEngine(false, true);
    for (const k of SEGMENT_CARRY) eng[k] = old[k];
    eng.segment = (old.segment || 1) + 1;
    eng.t0 = perfNow();
    eng.wall0 = Date.now();
    // Los sensores pasan ya al tramo nuevo (se guardan en memoria hasta que tenga su grabación).
    E = eng;
    lastE = old;
    mapView.drawnAt = 0;
    toast("Tramo " + eng.segment + ": el anterior queda guardado");
    // La grabación nueva cierra como «cortada» lo que quede a medias: primero, que el anterior quede terminado.
    await saved.catch(() => {});
    if (E === eng) recStart(eng.wall0);
    return true;
  }

  function stopAll() {
    if (E) {
      recFlush(true);
      saveMeta("terminada");
    }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener("devicemotion", onMotionEvent);
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    try {
      if (screen.orientation && screen.orientation.unlock)
        screen.orientation.unlock();
    } catch (e) {
      /* nada que desbloquear */
    }
    if (document.fullscreenElement && document.exitFullscreen)
      document.exitFullscreen().catch(() => {});
    close3D();
    lastE = E;
    E = null;
    // Al terminar una ruta libre, su resumen con el mapa entero.
    if (lastE && lastE.free) showRouteSummary(lastE);
    else {
      show("home");
      renderHome();
    }
  }

  // ---------- exportar ----------
  // Mismos CSV que Sensor Logger (más Canales.csv con lo calculado en directo), en un .zip.
  async function downloadZip(files, epochMs, isSim) {
    if (!window.JSZip) return false;
    const zip = new window.JSZip();
    for (const f of files) zip.file(f.name, f.text);
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
    const d = new Date(epochMs);
    const p = (x) => String(x).padStart(2, "0");
    const name =
      "maspalomas-" +
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      "-" +
      p(d.getHours()) +
      p(d.getMinutes()) +
      (isSim ? "-simulador" : "") +
      ".zip";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  async function exportSession(eng) {
    if (!eng) return;
    const ms0 = eng.rec
      ? eng.rec.epoch
      : eng.viewEpoch
        ? eng.viewEpoch
        : eng.sim || !eng.wall0
          ? Date.now()
          : eng.wall0;
    const series = {};
    for (const key of ["loc", "acc", "gyro", "grav", "canal"])
      if (eng[key].n) series[key] = eng[key].view();
    if (await downloadZip(F.csvFiles(series, ms0), ms0, eng.sim))
      $("export").textContent = "Exportada";
  }

  // La última tanda guardada en el móvil (vale también después de cerrar la página).
  async function exportStored() {
    const btn = $("home-export");
    try {
      const list = await ST.sessions();
      const s = list.find((x) => !x.sim) || list[0];
      if (!s) return;
      const merged = F.mergeChunks(await ST.chunksOf(s.id));
      if (await downloadZip(F.csvFiles(merged.series, s.epoch), s.epoch, s.sim))
        btn.textContent = "Exportada";
    } catch (e) {
      btn.textContent = "No se ha podido leer la tanda guardada";
    }
  }

  // ---------- inicio ----------
  // ---------- instalar la app ----------
  // En una pestaña del navegador sin internet su barra no se quita (Vivo Y33s, Chrome 146: el aviso de «sin
  // conexión» la deja fija aun en pantalla completa); instalada se abre a pantalla completa de verdad.
  let installEvt = null;
  function installed() {
    return (
      navigator.standalone === true ||
      matchMedia("(display-mode: fullscreen), (display-mode: standalone)")
        .matches
    );
  }
  function renderInstall() {
    $("install").hidden = installed();
    $("install-btn").hidden = !installEvt;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent || ""))
      $("install-how").textContent =
        "En Safari: botón Compartir → «Añadir a pantalla de inicio». Después, ábrela siempre desde su icono.";
  }
  function wireInstall() {
    // Chrome ofrece instalarla (con internet): se guarda para el botón en vez de su aviso propio.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      installEvt = e;
      renderInstall();
    });
    window.addEventListener("appinstalled", () => {
      installEvt = null;
      renderInstall();
    });
    $("install-btn").addEventListener("click", async () => {
      const e = installEvt;
      if (!e) return;
      installEvt = null;
      try {
        await e.prompt();
        await e.userChoice;
      } catch (err) {
        /* ya usado o rechazado */
      }
      renderInstall();
    });
    renderInstall();
  }

  // Circuitos guardados (de la ruta libre), con «Borrar» de dos toques.
  function renderCircuits() {
    const list = loadCircuits();
    $("circ-group").hidden = !list.length;
    const box = $("circ-list");
    box.textContent = "";
    for (const c of list) {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent =
        c.name + " · " + fmt((c.length || 0) / 1000, 1) + " km";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Borrar";
      let armed = false;
      del.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          del.textContent = "¿Borrar? Otra vez";
          setTimeout(() => {
            armed = false;
            del.textContent = "Borrar";
          }, 4000);
          return;
        }
        store(
          "pista-circuitos",
          loadCircuits().filter((x) => x.name !== c.name),
        );
        renderCircuits();
      });
      row.append(name, del);
      box.appendChild(row);
    }
  }

  // ---------- tus rutas y tandas (guardadas en este móvil) ----------
  let viewJob = null;

  function sessionDate(s) {
    const d = new Date(s.inicio || s.epoch || 0);
    return d.toLocaleString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // «Ruta libre · 23,4 km · 1:12:05» o «Circuito · 8 vueltas · mejor 1:09,32».
  function sessionLine(s) {
    // La ruta lleva su tiempo en el resumen; si no, del principio al final de la grabación.
    const dur =
      s.recorrido &&
      Number.isFinite(s.recorrido.duracion) &&
      s.recorrido.duracion > 0
        ? s.recorrido.duracion
        : s.inicio && s.fin
          ? (new Date(s.fin) - new Date(s.inicio)) / 1000
          : null;
    const parts = [];
    if (s.tipo === "ruta") {
      parts.push("Ruta libre");
      const km = s.recorrido ? s.recorrido.distancia : null;
      if (Number.isFinite(km)) parts.push(fmt(km / 1000, 1) + " km");
      if (s.circuito)
        parts.push(
          s.circuito.nombre +
            (s.circuito.mejor ? " · mejor " + fmtLap(s.circuito.mejor) : ""),
        );
    } else {
      parts.push("Circuito");
      const n = (s.vueltas || []).filter((v) => v.valid).length;
      parts.push(n + (n === 1 ? " vuelta" : " vueltas"));
      if (s.mejor) parts.push("mejor " + fmtLap(s.mejor));
    }
    if (dur !== null && dur > 0) parts.push(fmtClock(dur));
    if (s.estado === "cortada") parts.push("cortada");
    return parts.join(" · ");
  }

  async function renderHistory() {
    let list = [];
    try {
      if (ST)
        list = (await ST.sessions()).filter(
          (s) => !s.sim && s.estado !== "grabando",
        );
    } catch (e) {
      list = [];
    }
    $("hist-card").hidden = !list.length;
    const box = $("hist-list");
    box.textContent = "";
    for (const s of list) {
      const row = document.createElement("div");
      row.className = "hist-row";
      const txt = document.createElement("div");
      txt.className = "hist-txt";
      const b = document.createElement("b");
      b.textContent = sessionDate(s);
      const sp = document.createElement("span");
      sp.textContent = sessionLine(s);
      txt.append(b, sp);
      const act = document.createElement("div");
      act.className = "hist-act";
      const ver = document.createElement("button");
      ver.type = "button";
      ver.textContent = "Ver";
      ver.addEventListener("click", () => viewSaved(s.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Borrar";
      let armed = false;
      del.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          del.textContent =
            s.pend && settings.garaje
              ? "¿Sin subir? Otra vez"
              : "¿Seguro? Otra vez";
          setTimeout(() => {
            armed = false;
            del.textContent = "Borrar";
          }, 4000);
          return;
        }
        try {
          await ST.deleteSession(s.id);
        } catch (e) {
          /* se queda en la lista */
        }
        renderHistory();
        renderGarage();
      });
      act.append(ver, del);
      row.append(txt, act);
      box.appendChild(row);
    }
  }

  // Ver una tanda guardada: se repasa la grabación con el mismo motor que en directo (deprisa, sin grabar, sin
  // subir, sin avisos) y se enseña lo de siempre al terminar: la ruta con su mapa o el análisis de boxes.
  async function viewSaved(id) {
    if (viewJob || E || !ST) return;
    const job = { cancelled: false };
    viewJob = job;
    const box = $("replaying");
    const bar = $("replaying-bar");
    setText("replaying-t", "Abriendo la grabación…");
    bar.style.width = "0%";
    box.hidden = false;
    const fail = (msg) => {
      setText("replaying-t", msg);
      setTimeout(() => {
        if (viewJob === job || viewJob === null) box.hidden = true;
      }, 2500);
    };
    let eng = null;
    try {
      const meta = (await ST.sessions()).find((s) => s.id === id);
      const chunks = await ST.chunksOf(id);
      if (!meta || !chunks.length) {
        viewJob = null;
        return fail("Esta grabación está vacía.");
      }
      const S = F.mergeChunks(chunks).series;
      const L = S.loc;
      if (!L || !L.t.length) {
        viewJob = null;
        return fail("Esta grabación no tiene posiciones del GPS.");
      }
      eng = newEngine(true, meta.tipo === "ruta");
      eng.t0 = 0;
      eng.viewing = meta;
      eng.viewEpoch = meta.epoch || null;
      eng.crash = null;
      eng.circTryAt = Infinity;
      eng.orientTried = true;
      eng.crashLog = Array.isArray(meta.caidas) ? meta.caidas.slice() : [];
      if (meta.montaje && Number.isFinite(meta.montaje.angulo))
        eng.screenAngle = meta.montaje.angulo;
      E = eng;
      if (Array.isArray(meta.calibracionManual)) {
        eng.calib.manualU = norm3(meta.calibracionManual);
        eng.calib.manualVer++;
      }
      setText("replaying-t", "Repasando la grabación…");
      const A = S.acc;
      const G = S.grav;
      const W = S.gyro;
      const nA = A && G && W ? Math.min(A.t.length, G.t.length, W.t.length) : 0;
      // Grabaciones de antes de unificar los relojes: si los sensores empiezan lejos del GPS, se alinean.
      const shift = nA && Math.abs(A.t[0] - L.t[0]) > 60 ? L.t[0] - A.t[0] : 0;
      let iL = 0;
      const feedFixes = (upTo) => {
        while (iL < L.t.length && L.t[iL] <= upTo) {
          sim.t = L.t[iL];
          onFix(
            L.t[iL],
            L.lat[iL],
            L.lon[iL],
            L.speed[iL] >= 0 ? L.speed[iL] : null,
            L.hacc[iL],
          );
          iL++;
        }
      };
      const total = nA + L.t.length;
      let lastYield = performance.now();
      let lastI = 0;
      for (let i = 0; i < nA; i++) {
        const t = A.t[i] + shift;
        feedFixes(t);
        sim.t = t;
        onMotion(
          t,
          [A.x[i], A.y[i], A.z[i]],
          [G.x[i], G.y[i], G.z[i]],
          [W.x[i], W.y[i], W.z[i]],
        );
        // Cada 40 ms (o cada 5.000 muestras) se deja respirar a la página: barra de avance y «Cancelar».
        if (performance.now() - lastYield > 40 || i - lastI >= 5000) {
          bar.style.width = Math.round(((i + iL) / total) * 100) + "%";
          await new Promise((r) => setTimeout(r, 0));
          lastYield = performance.now();
          lastI = i;
          if (job.cancelled || E !== eng) throw new Error("cancelado");
        }
      }
      feedFixes(Infinity);
      bar.style.width = "100%";
      if (job.cancelled || E !== eng) throw new Error("cancelado");
      if (eng.free) {
        E = null;
        lastE = eng;
        showRouteSummary(eng);
      } else enterPits();
      viewJob = null;
      box.hidden = true;
    } catch (e) {
      if (E === eng) E = null;
      viewJob = null;
      if (job.cancelled || (e && e.message === "cancelado")) box.hidden = true;
      else fail("No se ha podido abrir esta grabación.");
    }
  }

  function cancelView() {
    if (viewJob) viewJob.cancelled = true;
    $("replaying").hidden = true;
  }

  function renderHome() {
    checkSensorBlock();
    renderHistory();
    renderInstall();
    renderCircuits();
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
      "Mejor vuelta guardada" +
        (settings.piloto ? " de " + settings.piloto : "") +
        ": " +
        parts.join(" · "),
    );
    if (document.activeElement !== $("piloto"))
      $("piloto").value = settings.piloto || "";
    if (document.activeElement !== $("objetivo"))
      $("objetivo").value = fmtLap(target(), 1);
    $("cue").checked = !!settings.cue;
    $("mapopt").checked = settings.mapa !== false;
    $("caidaopt").checked = settings.caida !== false;
    if (document.activeElement !== $("emergencia"))
      $("emergencia").value = settings.emergencia || "";
    $("cue-opts").hidden = !settings.cue;
    $("lead").value = settings.lead;
    $("lead-v").textContent = settings.lead;
    renderOrient();
    drawMetaMap();
    $("home-export").hidden = !lastE;
    renderGarage();
  }

  // ---------- garaje (el Mac) ----------
  let garageQueued = false;
  function renderGarage() {
    // Varias notificaciones seguidas de la cola se pintan una sola vez.
    if (garageQueued) return;
    garageQueued = true;
    setTimeout(() => {
      garageQueued = false;
      paintGarage();
    }, 50);
  }

  async function paintGarage() {
    if (!ST) return;
    const s = ST.sync;
    let pend = { trozos: 0, sesiones: 0 };
    let stored = [];
    try {
      pend = await ST.pendingCounts();
      stored = await ST.sessions();
    } catch (e) {
      setStatus(
        "st-cola",
        "bad",
        "Este navegador no deja guardar las tandas en el móvil: exporta cada tanda al terminar.",
      );
    }
    const real = stored.filter((x) => !x.sim);
    if (stored.length) {
      setStatus(
        "st-cola",
        pend.trozos ? "wait" : "ok",
        "Tandas guardadas en el móvil: " +
          real.length +
          (pend.trozos
            ? " · faltan " + pend.trozos + " trozos por subir al Mac"
            : s.state === "ok"
              ? " · todo subido al Mac"
              : ""),
      );
    } else setStatus("st-cola", "", "Tandas guardadas en el móvil: ninguna");
    const texts = {
      off: [
        "",
        "Mac sin conectar. Abre «Abrir garaje» en el Mac y escanea con la cámara el código que sale en pantalla.",
      ],
      busy: ["wait", "Conectando con el Mac…"],
      ok: ["ok", "Mac conectado: las tandas se suben solas."],
      offline: [
        "wait",
        "Sin conexión con el Mac (" +
          (s.lastError || "no contesta") +
          "). Todo queda en el móvil y se sube solo al volver. Si has vuelto a abrir el garaje, escanea su código nuevo.",
      ],
      auth: [
        "bad",
        "El Mac no reconoce este móvil: escanea otra vez el código del garaje.",
      ],
    };
    const [state, text] = texts[s.state] || texts.off;
    setStatus("st-mac", state, text);
    $("garage-sync").hidden = !settings.garaje;
    $("garage-day").hidden = !settings.garaje;
    $("pits-day").hidden = !settings.garaje;
    $("garage-forget").hidden = !settings.garaje;
    $("home-export").hidden = !lastE && !stored.length;
    if (E) renderStoreLine();
  }

  function applyPairing() {
    if (!ST) return false;
    const cfg = ST.parsePairing(location.hash);
    if (!location.hash.startsWith("#garaje=")) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (!cfg) {
      setStatus(
        "st-mac",
        "bad",
        "El código escaneado no es válido: vuelve a escanear el del garaje.",
      );
      return false;
    }
    settings.garaje = cfg;
    saveSettings();
    ST.configure(cfg);
    ST.persist();
    return true;
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
    $("free").addEventListener("click", () => startReal(true));
    wireExt();
    wireInstall();
    for (const b of document.querySelectorAll(".choice [data-orient]"))
      b.addEventListener("click", () => {
        settings.pantalla = b.dataset.orient;
        saveSettings();
        renderOrient();
      });
    $("mapopt").addEventListener("change", () => {
      settings.mapa = $("mapopt").checked;
      saveSettings();
    });
    let rideArmed = false;
    $("ru-stop").addEventListener("click", () => {
      const btn = $("ru-stop");
      if (!rideArmed) {
        rideArmed = true;
        btn.textContent = "¿Terminar? Otra vez";
        setTimeout(() => {
          rideArmed = false;
          btn.textContent = "Terminar";
        }, 4000);
        return;
      }
      rideArmed = false;
      btn.textContent = "Terminar";
      stopAll();
    });
    let segArmed = false;
    $("ru-seg").addEventListener("click", () => {
      const btn = $("ru-seg");
      if (!segArmed) {
        segArmed = true;
        btn.textContent = "¿Nuevo tramo? Otra vez";
        setTimeout(() => {
          segArmed = false;
          btn.textContent = "Nuevo tramo";
        }, 4000);
        return;
      }
      segArmed = false;
      btn.textContent = "Nuevo tramo";
      newSegment();
    });
    $("ru-color").addEventListener("click", () => {
      mapView.colorBy = mapView.colorBy === "fase" ? "incl" : "fase";
      mapView.drawnAt = 0;
    });
    $("ru-fit").addEventListener("click", () => {
      mapView.follow = !mapView.follow;
      mapView.drawnAt = 0;
    });
    $("ru-zin").addEventListener("click", () => {
      mapView.span = Math.max(150, mapView.span / 1.6);
      mapView.follow = true;
      mapView.drawnAt = 0;
    });
    $("ru-zout").addEventListener("click", () => {
      mapView.span = Math.min(8000, mapView.span * 1.6);
      mapView.follow = true;
      mapView.drawnAt = 0;
    });
    $("ruf-color").addEventListener("click", () => {
      summaryColor = summaryColor === "fase" ? "incl" : "fase";
      if (lastE) showRouteSummary(lastE);
    });
    $("ruf-home").addEventListener("click", () => {
      show("home");
      renderHome();
    });
    $("ruf-back").addEventListener("click", () => {
      show("home");
      renderHome();
    });
    // Repasando una tanda guardada (boxes solo para mirar): cerrar.
    $("p-back").addEventListener("click", () => {
      if (E && E.viewing) stopAll();
    });
    // Atrás del móvil (ver onBack) y su entrada en el historial, que se pone al tocar la pantalla.
    window.addEventListener("popstate", (ev) => {
      if (!(ev.state && ev.state.pista)) onBack();
    });
    document.addEventListener("pointerdown", backArm, {
      capture: true,
      passive: true,
    });
    $("ruf-export").addEventListener("click", () => exportSession(lastE));
    $("ruf-save").addEventListener("click", saveCircuit);
    $("crash-ok").addEventListener("click", crashDismiss);
    $("replaying-cancel").addEventListener("click", cancelView);
    $("crash-share").addEventListener("click", crashShare);
    $("caidaopt").addEventListener("change", () => {
      settings.caida = $("caidaopt").checked;
      saveSettings();
    });
    $("emergencia").addEventListener("change", () => {
      settings.emergencia = $("emergencia").value.trim().slice(0, 20);
      saveSettings();
    });
    $("sim").addEventListener("click", () => startSim(1));
    // Cámaras y velocidad de la vuelta de ejemplo en 3D.
    for (const b of document.querySelectorAll(".v3d-ctl [data-cam]"))
      b.addEventListener("click", () => {
        view3dCam = b.dataset.cam;
        for (const x of document.querySelectorAll(".v3d-ctl [data-cam]"))
          x.setAttribute("aria-pressed", String(x === b));
        if (view3d && view3d.v) view3d.v.setMode(view3dCam);
      });
    $("d-speedx").addEventListener("click", () => {
      sim.speed = sim.speed >= 4 ? 1 : sim.speed * 2;
      $("d-speedx").textContent = "×" + sim.speed;
    });
    $("sensors").addEventListener("click", startSensors);
    $("sen-back").addEventListener("click", stopSensors);
    $("sen-zero").addEventListener("click", sensorZero);
    $("d-calib").addEventListener("click", startCalib);
    $("ru-calib").addEventListener("click", startCalib);
    $("p-calib").addEventListener("click", pitsCalib);
    $("stop").addEventListener("click", () => {
      if (E && E.lapNum > 0) enterPits();
      else stopAll();
    });
    $("resume").addEventListener("click", enterRide);
    $("export").addEventListener("click", () => exportSession(E || lastE));
    $("home-export").addEventListener("click", () =>
      lastE ? exportSession(lastE) : exportStored(),
    );
    $("garage-day").addEventListener("click", () => showDay("home"));
    $("pits-day").addEventListener("click", () => showDay("pits"));
    $("dia-back").addEventListener("click", leaveDay);
    $("dia-refresh").addEventListener("click", refreshDay);
    $("garage-sync").addEventListener("click", () => {
      if (settings.garaje) ST.configure(settings.garaje);
    });
    let forgetArmed = false;
    $("garage-forget").addEventListener("click", () => {
      const btn = $("garage-forget");
      if (!forgetArmed) {
        forgetArmed = true;
        btn.textContent = "¿Desconectar? Toca otra vez";
        setTimeout(() => {
          forgetArmed = false;
          btn.textContent = "Desconectar el Mac";
        }, 4000);
        return;
      }
      forgetArmed = false;
      btn.textContent = "Desconectar el Mac";
      settings.garaje = null;
      saveSettings();
      ST.configure(null);
      renderGarage();
    });
    window.addEventListener("hashchange", () => {
      if (applyPairing()) renderGarage();
    });
    // Al salir de la página (o si Android la congela) se guarda lo grabado hasta ese momento.
    const saveNow = () => {
      if (!E || !E.rec) return;
      recFlush(true);
      saveMeta("grabando");
    };
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveNow();
    });
    let confirmArmed = false;
    $("finish").addEventListener("click", () => {
      // Repasando una tanda guardada no hay nada que terminar: se cierra sin más.
      if (E && E.viewing) {
        stopAll();
        return;
      }
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
    $("piloto").addEventListener("change", () => {
      setPilot($("piloto").value);
      renderHome();
    });
    $("objetivo").addEventListener("change", () => {
      const t = parseLap($("objetivo").value);
      if (t >= 40 && t <= 200) {
        settings.objetivo = Math.round(t * 10) / 10;
        saveSettings();
      }
      $("objetivo").value = fmtLap(target(), 1);
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
    // Si llega una versión nueva mientras la página está abierta (en otra pestaña se recargó, o al volver a
    // abrirla), se recarga sola, pero solo en la portada o en la prueba de sensores: nunca rodando ni con un
    // receptor externo conectado (se perdería la conexión).
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (
        hadController &&
        !E &&
        !ext.handle &&
        ($("home").hidden === false || $("sensores").hidden === false)
      )
        location.reload();
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  setText("home-build", "Versión " + BUILD);
  // Acceso para pruebas automáticas del simulador (no afecta al uso normal).
  window.MaspaPista = {
    startSim,
    stopAll,
    get engine() {
      return E;
    },
    sim,
    onMotion: (...a) => onMotion(...a),
    onFix: (...a) => onFix(...a),
    // Aviso de caída en marcha (null si no hay).
    get crash() {
      return crashUi
        ? { alarm: crashUi.alarm, rec: Object.assign({}, crashUi.rec) }
        : null;
    },
    // Cronómetro del circuito de la ruta libre (null si no hay).
    get circuit() {
      return E && E.circ;
    },
    // Dónde cree el panel que está la moto en el instante t (null fuera del trazado).
    predicted: (t) => (E && E.track && E.fix && E.fix.on ? predicted(t) : null),
    get view3d() {
      return view3d && view3d.v;
    },
  };
  wire();
  if (ST) {
    ST.sync.onChange = renderGarage;
    // Una tanda que quedó «grabando» (la página se cerró en pista) se da por cortada y se sube igual.
    ST.closeStale(null)
      .then(renderGarage)
      .catch(() => {});
    if (!applyPairing()) ST.configure(settings.garaje);
    // En pista se sube poco a poco (un trozo cada 20 s) para no quitarle tiempo al panel.
    ST.startLoop(10000, () => (E && E.mode === "ride" ? 20000 : 0));
  }
  renderHome();
  requestAnimationFrame(loop);
})();
