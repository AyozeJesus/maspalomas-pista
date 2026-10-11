// Receptor GNSS externo por Bluetooth (RaceBox, BonoGPS, puente NMEA o GPS del perfil estándar): hasta 25 posiciones por segundo en vez de 1.
(function (root) {
  "use strict";

  // Nordic UART Service: el «cable serie» por Bluetooth del RaceBox y de los puentes ESP32/u-blox.
  const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // receptor → móvil (notificaciones)
  const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // móvil → receptor (escritura)
  // Perfil estándar «Location and Navigation» (0x1819) y su característica «Location and Speed» (0x2A67).
  // El BonoGPS no manda ahí el binario de la norma sino frases NMEA en texto, una por notificación.
  const LNS = "00001819-0000-1000-8000-00805f9b34fb";
  const LNS_LS = "00002a67-0000-1000-8000-00805f9b34fb";
  // Cómo se nombra cada tipo de receptor en los avisos.
  const PROFILE_NAME = {
    racebox: "RaceBox",
    "nus-nmea": "receptor NMEA",
    bonogps: "BonoGPS",
    lns: "GPS Bluetooth estándar",
  };

  // Mensaje de datos del RaceBox Mini/Mini S/Micro: trama tipo UBX (B5 62, clase 0xFF, id 0x01, longitud 80 en
  // 2 bytes LE, datos y suma Fletcher de 8 bits) con los datos en little-endian. Sacado de la documentación del
  // protocolo BLE de RaceBox y sin comprobar aún con un aparato: si un campo no cuadra, se corrige aquí y solo aquí.
  // [desplazamiento, tipo, divisor para pasar a la unidad del fijo]
  const RB_FIELDS = {
    iTOW: [0, "u32", 1], // ms de la semana GPS (no se usa)
    year: [4, "u16", 1],
    month: [6, "u8", 1],
    day: [7, "u8", 1],
    hour: [8, "u8", 1],
    minute: [9, "u8", 1],
    second: [10, "u8", 1],
    validity: [11, "u8", 1], // bit0 fecha válida, bit1 hora válida, bit2 hora totalmente resuelta
    timeAcc: [12, "u32", 1], // ns
    nano: [16, "i32", 1], // ns que se suman a la hora; puede ser negativo
    fixStatus: [20, "u8", 1], // 0 sin fijo, 2 = 2D, 3 = 3D
    fixFlags: [21, "u8", 1], // bit0 gnssFixOK: fijo dentro de las máscaras de precisión
    dateTimeFlags: [22, "u8", 1],
    numSV: [23, "u8", 1],
    lon: [24, "i32", 1e7], // grados
    lat: [28, "i32", 1e7], // grados
    altWgs: [32, "i32", 1000], // m sobre el elipsoide
    altMsl: [36, "i32", 1000], // m sobre el nivel del mar (la altitud del fijo, como en el NMEA)
    hAcc: [40, "u32", 1000], // m
    vAcc: [44, "u32", 1000], // m
    speed: [48, "i32", 1000], // m/s
    heading: [52, "i32", 1e5], // grados
    speedAcc: [56, "u32", 1000], // m/s
    headingAcc: [60, "u32", 1e5], // grados
    pdop: [64, "u16", 100],
    latLonFlags: [66, "u8", 1],
    battery: [67, "u8", 1], // bit7 cargando, bits 0-6 % (Mini y Mini S)
    gX: [68, "i16", 1000], // g
    gY: [70, "i16", 1000],
    gZ: [72, "i16", 1000],
    rotX: [74, "i16", 100], // grados/s
    rotY: [76, "i16", 100],
    rotZ: [78, "i16", 100],
  };
  const RB_CLASS = 0xff;
  const RB_ID = 0x01;
  const RB_LEN = 80;
  const SYNC1 = 0xb5;
  const SYNC2 = 0x62;
  const DOLLAR = 0x24;
  const STAR = 0x2a;
  // Ningún mensaje del RaceBox se acerca a esto: una longitud mayor es basura con pinta de cabecera, y así una
  // cabecera falsa retiene como mucho medio kilobyte antes de descartarse.
  const MAX_UBX = 512;
  // NMEA: 82 caracteres según la norma, con margen para receptores que alargan las frases.
  const MAX_LINE = 160;
  // Memoria fija: tras cada trozo solo queda pendiente, como mucho, una trama a medias.
  const BUFFER_CAP = 4096;
  const KNOT = 1852 / 3600; // m/s
  // El NMEA no da la precisión en metros: HDOP × 2,5 m (error típico de un receptor de una frecuencia) es una
  // aproximación, no una medida.
  const HDOP_M = 2.5;
  const NMEA_RMC = 1;
  const NMEA_GGA = 2;
  const RATE_WINDOW_MS = 2000;
  const NOFIX_MS = 3000;
  const BACKOFF_MAX_MS = 10000;

  const READ = {
    u8: (dv, at) => dv.getUint8(at),
    u16: (dv, at) => dv.getUint16(at, true),
    i16: (dv, at) => dv.getInt16(at, true),
    u32: (dv, at) => dv.getUint32(at, true),
    i32: (dv, at) => dv.getInt32(at, true),
  };

  function noop() {}

  function wrap360(d) {
    return ((d % 360) + 360) % 360;
  }

  function asBytes(b) {
    if (b instanceof Uint8Array) return b;
    if (ArrayBuffer.isView(b))
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    return Uint8Array.from(b || []);
  }

  // Hora UTC en ms (con decimales), o null si la fecha no tiene sentido (p. ej. año 0 = desconocido).
  function utcOf(y, mo, d, h, mi, s, extraMs) {
    if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (h > 23 || mi > 59 || s > 60) return null;
    return Date.UTC(y, mo - 1, d, h, mi, s) + extraMs;
  }

  // ---------- RaceBox ----------
  function rbField(dv, p, name) {
    const [off, type, div] = RB_FIELDS[name];
    return READ[type](dv, p + off) / div;
  }

  // Datos de un mensaje del RaceBox (p = primer byte de los datos) → fijo.
  function decodeRacebox(dv, p) {
    const v = (name) => rbField(dv, p, name);
    const status = v("fixStatus");
    // Sin gnssFixOK la posición no vale aunque diga 3D; 4 (GNSS + estima, como en u-blox) cuenta como 3D.
    let fix = 0;
    if (v("fixFlags") & 1)
      fix = status === 3 || status === 4 ? 3 : status === 2 ? 2 : 0;
    // Solo con fecha y hora válidas (bits 0 y 1); los nanosegundos afinan dentro del segundo.
    const timeOk = (v("validity") & 3) === 3;
    return {
      source: "racebox",
      utcMs: timeOk
        ? utcOf(
            v("year"),
            v("month"),
            v("day"),
            v("hour"),
            v("minute"),
            v("second"),
            v("nano") / 1e6,
          )
        : null,
      lat: v("lat"),
      lon: v("lon"),
      speed: v("speed"),
      heading: wrap360(v("heading")),
      hacc: v("hAcc"),
      fix,
      sats: v("numSV"),
      altitude: v("altMsl"),
      gforce: [v("gX"), v("gY"), v("gZ")],
      gyro: [v("rotX"), v("rotY"), v("rotZ")],
      battery: v("battery") & 0x7f,
    };
  }

  // ---------- NMEA ----------
  function num(s) {
    return s === undefined || s === "" ? NaN : Number(s);
  }

  // «hhmmss.ss» → ms desde las 00:00 UTC; NaN si no hay hora.
  function nmeaTime(s) {
    if (!/^\d{6}(\.\d+)?$/.test(s || "")) return NaN;
    const h = +s.slice(0, 2);
    const m = +s.slice(2, 4);
    const sec = +s.slice(4);
    if (h > 23 || m > 59 || sec >= 61) return NaN;
    return (h * 3600 + m * 60) * 1000 + Math.round(sec * 1000);
  }

  // «ddmmyy» → ms de las 00:00 UTC de ese día; null si no hay fecha.
  function nmeaDate(s) {
    if (!/^\d{6}$/.test(s || "")) return null;
    const d = +s.slice(0, 2);
    const mo = +s.slice(2, 4);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    return Date.UTC(2000 + +s.slice(4), mo - 1, d);
  }

  // «ddmm.mmmm» / «dddmm.mmmm» y su hemisferio → grados con signo (sur y oeste, negativos).
  function nmeaDeg(s, hemi, max) {
    if (!/^\d{2,5}(\.\d+)?$/.test(s || "")) return NaN;
    const dot = s.indexOf(".");
    const cut = (dot < 0 ? s.length : dot) - 2;
    const min = +s.slice(cut);
    const deg = +s.slice(0, cut) + min / 60;
    if (min >= 60 || deg > max) return NaN;
    if (hemi === "S" || hemi === "W") return -deg;
    return hemi === "N" || hemi === "E" ? deg : NaN;
  }

  function parseRmc(f) {
    if (f.length < 10) return null;
    const mode = f[12] || "";
    return {
      tod: nmeaTime(f[1]),
      // Modo (NMEA 2.3+): E estimada, N no válida, M manual y S simulada no son posiciones medidas.
      valid: f[2] === "A" && !(mode !== "" && "ENMS".includes(mode[0])),
      lat: nmeaDeg(f[3], f[4], 90),
      lon: nmeaDeg(f[5], f[6], 180),
      speed: num(f[7]) * KNOT,
      course: wrap360(num(f[8])),
      date: nmeaDate(f[9]),
    };
  }

  function parseGga(f) {
    if (f.length < 10) return null;
    const q = num(f[6]);
    return {
      tod: nmeaTime(f[1]),
      // Calidad 1 GPS, 2 DGPS, 3 PPS, 4/5 RTK; 6 (estimada), 7 (manual) y 8 (simulador) no son medidas.
      ok: q >= 1 && q <= 5,
      lat: nmeaDeg(f[2], f[3], 90),
      lon: nmeaDeg(f[4], f[5], 180),
      sats: num(f[7]),
      hdop: num(f[8]),
      alt: num(f[9]),
    };
  }

  // RMC y GGA de la misma hora (puede faltar una de las dos) → fijo. Con RMC válida y sin GGA no se sabe
  // si es 3D: se da 2.
  function nmeaFix(r, g) {
    const pos = r || g;
    let fix = (r ? r.valid : g.ok) ? 2 : 0;
    if (fix && g && g.ok && g.sats >= 4) fix = 3;
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) fix = 0;
    return {
      source: "nmea",
      utcMs:
        r && r.date !== null && Number.isFinite(r.tod) ? r.date + r.tod : null,
      lat: pos.lat,
      lon: pos.lon,
      speed: r ? r.speed : NaN,
      heading: r ? r.course : NaN,
      hacc: g ? g.hdop * HDOP_M : NaN,
      fix,
      sats: g ? g.sats : NaN,
      altitude: g ? g.alt : NaN,
      gforce: null,
      gyro: null,
      battery: null,
    };
  }

  // ---------- Location and Speed (0x2A67) en binario ----------
  // Formato del Bluetooth SIG (little-endian): banderas de 16 bits y luego, en este orden, solo los campos que
  // las banderas anuncian. null si el paquete es más corto de lo que anuncia.
  function decodeLocationSpeed(bytes) {
    const b = asBytes(bytes);
    if (b.length < 2) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const flags = dv.getUint16(0, true);
    const f = {
      source: "lns",
      utcMs: null,
      lat: NaN,
      lon: NaN,
      speed: NaN,
      heading: NaN,
      hacc: NaN, // la norma no da la precisión
      fix: 0,
      sats: NaN,
      altitude: NaN,
      gforce: null,
      gyro: null,
      battery: null,
    };
    let p = 2;
    const room = (n) => p + n <= b.length;
    if (flags & 0x0001) {
      if (!room(2)) return null;
      f.speed = dv.getUint16(p, true) / 100;
      p += 2;
    }
    if (flags & 0x0002) {
      if (!room(3)) return null;
      p += 3; // distancia total: no se usa
    }
    if (flags & 0x0004) {
      if (!room(8)) return null;
      f.lat = dv.getInt32(p, true) / 1e7;
      f.lon = dv.getInt32(p + 4, true) / 1e7;
      p += 8;
    }
    if (flags & 0x0008) {
      if (!room(3)) return null;
      const e = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
      f.altitude = (e & 0x800000 ? e - 0x1000000 : e) / 100;
      p += 3;
    }
    if (flags & 0x0010) {
      if (!room(2)) return null;
      f.heading = wrap360(dv.getUint16(p, true) / 100);
      p += 2;
    }
    if (flags & 0x0020) {
      if (!room(1)) return null;
      p += 1; // tiempo rodando: no se usa
    }
    if (flags & 0x0040) {
      if (!room(7)) return null;
      const y = dv.getUint16(p, true);
      f.utcMs = utcOf(y, b[p + 2], b[p + 3], b[p + 4], b[p + 5], b[p + 6], 0);
    }
    // Estado de la posición (bits 7-8): 0 sin posición, 1 buena, 2 estimada, 3 la última conocida.
    const status = (flags >> 7) & 3;
    if (Number.isFinite(f.lat) && Number.isFinite(f.lon))
      f.fix = status === 1 ? 3 : status === 0 ? 0 : 2;
    return f;
  }

  // ¿Texto (frases NMEA) o binario? El binario de la norma nunca es todo ASCII imprimible: sus banderas llevan
  // el estado de la posición en el bit 7 o un byte alto por debajo de 0x20.
  function looksLikeText(b) {
    if (!b.length) return false;
    for (let k = 0; k < b.length; k++) {
      const c = b[k];
      if ((c < 0x20 || c > 0x7e) && c !== 0x0a && c !== 0x0d) return false;
    }
    return true;
  }

  // ---------- lector de bytes ----------
  // Lee los bytes tal como llegan por BLE: trozos de cualquier tamaño, tramas partidas, basura y los dos
  // protocolos (RaceBox y NMEA) mezclados. onFix(fijo); onInfo({ frames, badChecksum, skipped }) cada 50 tramas.
  // push(bytes, recvMs?): con recvMs, cada fijo lo lleva (en NMEA, el de la primera frase de su época).
  function createParser(onFix, onInfo) {
    const emit = onFix || noop;
    const buf = new Uint8Array(BUFFER_CAP);
    const dv = new DataView(buf.buffer);
    const count = { frames: 0, badChecksum: 0, skipped: 0 };
    const out = [];
    let len = 0;
    let stamp;
    let infoDue = false;
    // NMEA: las frases con la misma hora (RMC y GGA) forman una «época» que sale como un solo fijo. Sale en cuanto
    // trae las frases que traían las dos épocas anteriores (el orden RMC/GGA cambia según el receptor) y, si no,
    // al empezar la siguiente; con su recvMs de llegada, el retraso no descoloca el fijo.
    let ep = null;
    let lastTod = NaN;
    let prevTypes = 0;
    let expect = 0;

    function tally(key) {
      count[key]++;
      if (key !== "badChecksum" && (count.frames + count.skipped) % 50 === 0)
        infoDue = true;
    }

    function stamped(f, t) {
      if (t !== undefined) f.recvMs = t;
      return f;
    }

    function latin(a, b) {
      return String.fromCharCode.apply(null, buf.subarray(a, b));
    }

    function closeEpoch() {
      if (!ep) return;
      if (!ep.sent) out.push(stamped(nmeaFix(ep.rmc, ep.gga), ep.stamp));
      expect = prevTypes | ep.types;
      prevTypes = ep.types;
      lastTod = ep.tod;
      ep = null;
    }

    function addToEpoch(kind, d) {
      if (!Number.isFinite(d.tod)) {
        // Sin hora no se puede juntar con nada: sale sola.
        closeEpoch();
        const r = kind === NMEA_RMC ? d : null;
        out.push(stamped(nmeaFix(r, r ? null : d), stamp));
        return;
      }
      if (ep && ep.tod !== d.tod) closeEpoch();
      if (!ep) {
        if (d.tod === lastTod) return; // repetida de una época que ya salió
        ep = { tod: d.tod, rmc: null, gga: null, types: 0, sent: false, stamp };
      }
      ep.types |= kind;
      if (kind === NMEA_RMC && !ep.rmc) ep.rmc = d;
      if (kind === NMEA_GGA && !ep.gga) ep.gga = d;
      if (!ep.sent && expect && (ep.types & expect) === expect) {
        ep.sent = true;
        out.push(stamped(nmeaFix(ep.rmc, ep.gga), ep.stamp));
      }
    }

    function sentence(f) {
      const addr = f[0];
      let kind = 0;
      if (addr.length === 5 && addr.endsWith("RMC")) kind = NMEA_RMC;
      if (addr.length === 5 && addr.endsWith("GGA")) kind = NMEA_GGA;
      const d =
        kind === NMEA_RMC
          ? parseRmc(f)
          : kind === NMEA_GGA
            ? parseGga(f)
            : null;
      if (!d) {
        tally("skipped"); // otras frases (VTG, GSA, GSV, ZDA…) o incompletas
        return;
      }
      tally("frames");
      addToEpoch(kind, d);
    }

    // Trama tipo UBX en i: bytes que ocupa, 0 si aún falta por llegar, -1 si no vale.
    function ubx(i) {
      if (len - i < 2) return 0;
      if (buf[i + 1] !== SYNC2) return -1;
      if (len - i < 6) return 0;
      const n = buf[i + 4] | (buf[i + 5] << 8);
      if (n > MAX_UBX) return -1;
      if (len - i < n + 8) return 0;
      let a = 0;
      let b = 0;
      for (let k = i + 2; k < i + 6 + n; k++) {
        a = (a + buf[k]) & 0xff;
        b = (b + a) & 0xff;
      }
      if (a !== buf[i + 6 + n] || b !== buf[i + 7 + n]) {
        tally("badChecksum");
        return -1;
      }
      if (buf[i + 2] === RB_CLASS && buf[i + 3] === RB_ID && n === RB_LEN) {
        tally("frames");
        out.push(stamped(decodeRacebox(dv, i + 6), stamp));
      } else tally("skipped"); // otro mensaje: se salta entero gracias a su longitud
      return n + 8;
    }

    // Frase NMEA en i: igual que ubx().
    function nmea(i) {
      const lim = Math.min(len, i + MAX_LINE);
      let k = i + 1;
      for (; k < lim; k++) {
        const c = buf[k];
        if (c === 0x0d || c === 0x0a) break;
        // Un byte raro o un «$» dentro: se perdió el final de esta frase; se busca la siguiente.
        if (c < 0x20 || c > 0x7e || c === DOLLAR) return -1;
      }
      if (k === lim) return lim - i >= MAX_LINE ? -1 : 0;
      let star = k;
      for (let j = i + 1; j < k; j++) {
        if (buf[j] === STAR) {
          star = j;
          break;
        }
      }
      const text = latin(i + 1, star);
      if (!/^[A-Z][A-Z0-9]{3,7},/.test(text)) return -1;
      if (star < k) {
        // «*HH» es opcional, pero si viene tiene que cuadrar: XOR de todo lo que hay entre «$» y «*».
        let x = 0;
        for (let j = i + 1; j < star; j++) x ^= buf[j];
        const hh = latin(star + 1, k);
        if (!/^[0-9A-Fa-f]{2}$/.test(hh) || parseInt(hh, 16) !== x) {
          tally("badChecksum");
          return -1;
        }
      }
      sentence(text.split(","));
      return k + 1 - i;
    }

    function scan() {
      let i = 0;
      try {
        while (i < len) {
          const c = buf[i];
          if (c !== SYNC1 && c !== DOLLAR) {
            // Basura: hasta el siguiente posible comienzo de trama.
            i++;
            while (i < len && buf[i] !== SYNC1 && buf[i] !== DOLLAR) i++;
            continue;
          }
          const r = c === SYNC1 ? ubx(i) : nmea(i);
          if (r === 0) break; // trama a medias: espera al siguiente trozo
          i += r > 0 ? r : 1; // trama mala: un byte más allá se busca la siguiente
        }
      } finally {
        if (i > 0) {
          buf.copyWithin(0, i, len);
          len -= i;
        }
      }
    }

    function stats() {
      return {
        frames: count.frames,
        badChecksum: count.badChecksum,
        skipped: count.skipped,
        buffered: len,
      };
    }

    function push(bytes, recvMs) {
      const src = asBytes(bytes);
      stamp = recvMs;
      for (let off = 0; off < src.length;) {
        if (len === BUFFER_CAP) {
          // No debería pasar (lo pendiente nunca pasa de una trama), pero la memoria no crece aunque pase.
          buf.copyWithin(0, 1, len);
          len--;
        }
        const n = Math.min(src.length - off, BUFFER_CAP - len);
        buf.set(src.subarray(off, off + n), len);
        len += n;
        off += n;
        scan();
      }
      // Se entregan al final y de uno en uno: si onFix falla, lo leído sigue en orden y no se repite.
      while (out.length) emit(out.shift());
      if (infoDue && onInfo) {
        infoDue = false;
        onInfo({
          frames: count.frames,
          badChecksum: count.badChecksum,
          skipped: count.skipped,
        });
      }
    }

    function reset() {
      len = 0;
      out.length = 0;
      ep = null;
      lastTod = NaN;
      prevTypes = 0;
      expect = 0;
    }

    return { push, reset, stats };
  }

  // ---------- conexión por Web Bluetooth ----------
  function supported() {
    return !!(
      typeof navigator !== "undefined" &&
      navigator.bluetooth &&
      navigator.bluetooth.requestDevice
    );
  }

  function defaultSchedule(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  }

  function chooserText(e) {
    const name = e && e.name;
    if (name === "NotFoundError" && /adapter/i.test(String(e.message)))
      return "El Bluetooth del móvil está apagado: enciéndelo y vuelve a intentarlo.";
    if (name === "NotFoundError") return "No se ha elegido ningún receptor.";
    if (name === "SecurityError" || name === "NotAllowedError")
      return "Chrome no ha dejado buscar el receptor: pulsa el botón de conectar y permite el Bluetooth si lo pregunta.";
    return "No se ha podido buscar el receptor: comprueba que el Bluetooth del móvil está encendido.";
  }

  // Conecta con el receptor y pasa a onFix cada fijo con recvMs (performance.now() de su llegada al móvil, para
  // colocarlo en el reloj de la app). Hay que llamarlo desde el toque de un botón: Chrome solo abre la lista de
  // aparatos Bluetooth como respuesta directa a un gesto del usuario.
  // Opciones: onFix, onStatus({ state, text }), onInfo (contadores del lector) y startCommand (ver GANCHO).
  // Solo para las pruebas: now() (reloj en ms; por defecto performance.now) y schedule(fn, ms) → función que
  // lo cancela (por defecto setTimeout).
  // Devuelve { name, profile, disconnect(), rate() }; si no conecta, avisa con estado "error" y rechaza.
  async function connect(opts) {
    const o = opts || {};
    const onFix = o.onFix || noop;
    const onStatus = o.onStatus || noop;
    const now = o.now || (() => performance.now());
    const schedule = o.schedule || defaultSchedule;
    const startCommand = o.startCommand || null;
    const parser = createParser(gotFix, o.onInfo);
    const arrivals = []; // recvMs de los fijos de los últimos 2 s
    let state = "";
    let text = "";
    let device = null;
    let name = "";
    let link = ""; // "nus" o "lns"
    let profile = "";
    let tx = null;
    let stopped = false;
    let busy = false;
    let retries = 0;
    let cancelRetry = null;
    let linkAt = 0;
    let shownAt = -Infinity;
    let badSince = null;

    function status(s, t) {
      if (s === state && t === text) return;
      state = s;
      text = t;
      onStatus({ state: s, text: t });
    }

    function trim(t) {
      while (arrivals.length && arrivals[0] <= t - RATE_WINDOW_MS)
        arrivals.shift();
    }

    // Fijos por segundo en los últimos 2 s; baja sola si dejan de llegar.
    function rate() {
      const t = now();
      trim(t);
      const span = arrivals.length ? t - arrivals[0] : 0;
      if (arrivals.length < 2 || span < 250) return 0;
      return ((arrivals.length - 1) * 1000) / span;
    }

    function linkText(rest) {
      return "Receptor conectado (" + PROFILE_NAME[profile] + "): " + rest;
    }

    function rateText() {
      const r = Math.round(rate());
      if (r < 1) return linkText("esperando posiciones…");
      return linkText(
        r + (r === 1 ? " posición por segundo" : " posiciones por segundo"),
      );
    }

    function gotFix(f) {
      const t = f.recvMs;
      arrivals.push(t);
      trim(t);
      // El tipo se confirma con lo que llega, por si el nombre del aparato engaña.
      if (f.source === "racebox" || f.source === "lns") profile = f.source;
      else profile = link === "lns" ? "bonogps" : "nus-nmea";
      // El Micro va a la batería de la moto: su byte de batería es la tensión ×10, no un porcentaje.
      if (f.source === "racebox" && /micro/i.test(name)) f.battery = null;
      if (f.fix < 2) {
        if (badSince === null) badSince = t;
        else if (t - badSince > NOFIX_MS && state === "conectado")
          status(
            "sin-fix",
            "Receptor sin cobertura todavía: déjalo a cielo abierto y espera un poco.",
          );
      } else {
        badSince = null;
        // El ritmo se enseña con al menos 1 s de datos y se renueva como mucho una vez por segundo.
        const due = t - shownAt >= 1000 && t - linkAt >= 1000;
        if (state === "sin-fix" || (state === "conectado" && due)) {
          shownAt = t;
          status("conectado", rateText());
        }
      }
      onFix(f);
    }

    function onValue(e) {
      if (stopped) return;
      const v = e.target.value;
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const t = now();
      // En 0x2A67 el BonoGPS manda texto NMEA; un GPS que siga la norma, el binario.
      if (link === "lns" && !looksLikeText(bytes)) {
        const f = decodeLocationSpeed(bytes);
        if (f) {
          f.recvMs = t;
          gotFix(f);
        }
        return;
      }
      parser.push(bytes, t);
    }

    function detach() {
      if (tx) tx.removeEventListener("characteristicvaluechanged", onValue);
      tx = null;
    }

    // Aunque no esté conectado: disconnect() también corta un connect() en marcha (en Android puede tardar
    // 30 s en rendirse) y entonces no avisa con "gattserverdisconnected".
    function closeGatt() {
      detach();
      try {
        device.gatt.disconnect();
      } catch (e) {
        /* ya estaba cerrado */
      }
    }

    async function open() {
      const server = await device.gatt.connect();
      // Primero NUS (RaceBox y puentes); si el aparato no lo tiene, el perfil estándar (BonoGPS y otros).
      let service = null;
      let ch = null;
      let kind = "nus";
      try {
        service = await server.getPrimaryService(NUS);
        ch = await service.getCharacteristic(NUS_TX);
      } catch (e) {
        if (!e || e.name !== "NotFoundError") throw e;
        kind = "lns";
        service = await server.getPrimaryService(LNS);
        ch = await service.getCharacteristic(LNS_LS);
      }
      detach();
      parser.reset();
      link = kind;
      if (!profile) {
        if (kind === "nus")
          profile = /^racebox/i.test(name) ? "racebox" : "nus-nmea";
        else profile = /^bonogps/i.test(name) ? "bonogps" : "lns";
      }
      ch.addEventListener("characteristicvaluechanged", onValue);
      tx = ch;
      await ch.startNotifications();
      // GANCHO: orden que se escribe en RX (móvil → receptor) nada más activar las notificaciones, para
      // receptores que no empiecen a mandar datos solos. El RaceBox empieza solo al activarlas (así lo cuenta su
      // documentación; sin comprobar con un aparato) y el BonoGPS y los puentes mandan siempre, así que por
      // defecto no se escribe nada: connect({ startCommand: Uint8Array }). Solo hay RX en NUS.
      if (startCommand && kind === "nus") {
        const rx = await service.getCharacteristic(NUS_RX);
        if (rx.writeValueWithResponse)
          await rx.writeValueWithResponse(startCommand);
        else await rx.writeValue(startCommand);
      }
      if (!device.gatt.connected)
        throw new Error("Se cortó la conexión al empezar");
      linkAt = now();
      shownAt = -Infinity;
      badSince = null;
    }

    function retryLater() {
      // 1 s, 2 s, 4 s, 8 s y luego cada 10 s, hasta que se llame a disconnect().
      const ms = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** retries);
      retries++;
      cancelRetry = schedule(retry, ms);
    }

    async function retry() {
      cancelRetry = null;
      if (stopped) return;
      busy = true;
      let up = false;
      try {
        await open();
        up = true;
      } catch (e) {
        closeGatt();
      }
      busy = false;
      if (stopped) {
        if (up) closeGatt();
        return;
      }
      if (!up) {
        if (!cancelRetry) retryLater();
        return;
      }
      retries = 0;
      status("conectado", linkText("esperando posiciones…"));
    }

    // Chrome avisa con "gattserverdisconnected" al perder el aparato (fuera de alcance, apagado…).
    function lost() {
      if (stopped) return;
      detach();
      status("reconectando", "Se ha perdido el receptor: reconectando…");
      if (!busy && !cancelRetry) retryLater();
    }

    function disconnect() {
      if (stopped) return;
      stopped = true;
      if (cancelRetry) cancelRetry();
      cancelRetry = null;
      device.removeEventListener("gattserverdisconnected", lost);
      closeGatt();
      status("desconectado", "Receptor desconectado.");
    }

    const bt = typeof navigator !== "undefined" ? navigator.bluetooth : null;
    if (!bt || !bt.requestDevice) {
      status(
        "error",
        "Este navegador no puede usar receptores Bluetooth: abre la página con Chrome en Android.",
      );
      throw new Error("Web Bluetooth no disponible");
    }
    status("conectando", "Elige el receptor en la lista…");
    try {
      device = await bt.requestDevice({
        filters: [
          { namePrefix: "RaceBox" },
          { namePrefix: "BonoGPS" },
          { services: [NUS] },
          { services: [LNS] },
        ],
        optionalServices: [NUS, LNS],
      });
    } catch (e) {
      status("error", chooserText(e));
      throw e;
    }
    name = device.name || "";
    status("conectando", "Conectando con " + (name || "el receptor") + "…");
    // Android falla a veces el primer intento de conexión sin motivo: hasta 3 intentos antes de rendirse.
    for (let k = 0; ; k++) {
      try {
        await open();
        break;
      } catch (e) {
        closeGatt();
        const alien = e && e.name === "NotFoundError"; // no tiene ningún servicio conocido
        if (alien || k === 2) {
          status(
            "error",
            alien
              ? "Ese aparato no es un receptor compatible."
              : "No se ha podido conectar con el receptor: acércalo al móvil y vuelve a intentarlo.",
          );
          throw e;
        }
        await new Promise((r) => schedule(r, 1000 * 2 ** k));
      }
    }
    device.addEventListener("gattserverdisconnected", lost);
    status("conectado", linkText("esperando posiciones…"));
    return {
      name: name || "Receptor",
      get profile() {
        return profile;
      },
      disconnect,
      rate,
    };
  }

  const api = {
    NUS,
    NUS_TX,
    NUS_RX,
    LNS,
    LNS_LS,
    RB_FIELDS,
    BUFFER_CAP,
    createParser,
    decodeLocationSpeed,
    supported,
    connect,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaGNSS = api;
})(typeof window !== "undefined" ? window : globalThis);
