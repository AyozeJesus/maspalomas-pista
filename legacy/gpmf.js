// Telemetría de una GoPro (HERO5…HERO13): GPS, acelerómetro y giroscopio del MP4, leído a trozos, como tanda para el análisis.
(function (root) {
  "use strict";
  // Ninguna lectura pasa de 8 MB: el vídeo puede pesar varios GB y el navegador del móvil no lo aguantaría.
  const MAX_READ = 8 * 1024 * 1024;
  const MAX_MOOV = 256 * 1024 * 1024;
  const MAX_PAYLOAD = 4 * 1024 * 1024;
  // La telemetría va repartida por el archivo entre trozos de vídeo: se juntan las muestras que caen cerca y
  // se dejan varias lecturas en vuelo, que en el navegador cada una tarda lo suyo.
  const BATCH_BYTES = 1024 * 1024;
  const BATCH_GAP = 64 * 1024;
  const PREFETCH = 4;
  const MAC_EPOCH_S = 2082844800; // de 1904-01-01 (reloj de los MP4) a 1970-01-01
  const GPS_EPOCH_MS = Date.UTC(2000, 0, 1);
  const SANE_FROM = Date.UTC(2005, 0, 1);
  const SANE_TO = Date.UTC(2100, 0, 1);
  const GRAV_TAU = 1;
  const MSG = {
    notMp4: "No parece un vídeo MP4 de GoPro.",
    noGpmf: "Este vídeo no lleva telemetría de GoPro (GPMF).",
    noGps:
      "Este vídeo no tiene posiciones GPS (¿GPS apagado o GoPro sin GPS, como la HERO12?).",
    noImu:
      "Este vídeo no trae acelerómetro o giroscopio: análisis solo con GPS.",
    unreadable:
      "No se ha podido leer el vídeo (¿se ha movido o borrado el archivo?).",
  };
  // Bytes de cada tipo de dato de GPMF.
  const TSIZE = {
    b: 1,
    B: 1,
    c: 1,
    s: 2,
    S: 2,
    l: 4,
    L: 4,
    f: 4,
    q: 4,
    F: 4,
    d: 8,
    j: 8,
    J: 8,
    Q: 8,
    U: 16,
    G: 16,
  };
  // Claves de datos que se usan y cuántos campos trae como mínimo cada muestra.
  const DATA = { GPS5: 5, GPS9: 9, ACCL: 3, GYRO: 3 };
  const GPS_COLS = ["t", "lat", "lon", "alt", "speed", "fix", "dop", "utc"];
  const IMU_COLS = ["t", "x", "y", "z"];

  // ---------- lectores ----------
  // Sobre un Uint8Array ya en memoria (Node y pruebas).
  function bufferReader(u8) {
    return {
      size: u8.length,
      read(offset, length) {
        const a = Math.max(0, Math.min(u8.length, offset));
        const b = Math.max(a, Math.min(u8.length, offset + length));
        return Promise.resolve(u8.subarray(a, b));
      },
    };
  }

  // Sobre un File del navegador: cada lectura es un slice(), así nunca se carga el vídeo entero.
  function fileReader(blob) {
    return {
      size: blob.size,
      read(offset, length) {
        const a = Math.max(0, Math.min(blob.size, offset));
        const b = Math.max(a, Math.min(blob.size, offset + length));
        return blob
          .slice(a, b)
          .arrayBuffer()
          .then((buf) => new Uint8Array(buf));
      },
    };
  }

  function read(reader, offset, length) {
    return Promise.resolve()
      .then(() => reader.read(offset, length))
      .then(
        (u8) => (u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)),
        (e) => {
          throw new Error(MSG.unreadable, { cause: e });
        },
      );
  }

  async function readFull(reader, offset, length) {
    if (length <= MAX_READ) return read(reader, offset, length);
    const out = new Uint8Array(length);
    let got = 0;
    while (got < length) {
      const part = await read(
        reader,
        offset + got,
        Math.min(MAX_READ, length - got),
      );
      if (!part.length) break;
      out.set(part, got);
      got += part.length;
    }
    return got < length ? out.subarray(0, got) : out;
  }

  // ---------- bytes (todo en big-endian) ----------
  function u16(b, o) {
    return (b[o] << 8) | b[o + 1];
  }
  function u32(b, o) {
    return b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  }
  function i32(b, o) {
    return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  }
  // 64 bits como dos mitades de 32: los desplazamientos de un vídeo de varios GB caben de sobra en un double.
  function u64(b, o) {
    return u32(b, o) * 4294967296 + u32(b, o + 4);
  }
  function i64(b, o) {
    return i32(b, o) * 4294967296 + u32(b, o + 4);
  }
  function fourcc(b, o) {
    return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  }
  function printable(b, o, n) {
    for (let i = o; i < o + n; i++)
      if (b[i] < 0x20 || b[i] > 0x7e) return false;
    return true;
  }

  // ---------- MP4 ----------
  // Cajas de primer nivel leyendo solo sus cabeceras: el «moov» (el índice) suele ir al final, detrás de un
  // «mdat» de varios GB que no hace falta tocar.
  async function readMoov(reader) {
    let pos = 0;
    for (let n = 0; n < 100000 && pos + 8 <= reader.size; n++) {
      const h = await read(reader, pos, 16);
      if (h.length < 8 || !printable(h, 4, 4)) return null;
      let size = u32(h, 0);
      let hdr = 8;
      if (size === 1) {
        if (h.length < 16) return null;
        size = u64(h, 8);
        hdr = 16;
      } else if (size === 0) size = reader.size - pos;
      if (size < hdr) return null;
      if (fourcc(h, 4) === "moov") {
        if (pos + size > reader.size || size > MAX_MOOV) return null;
        const b = await readFull(reader, pos + hdr, size - hdr);
        return b.length === size - hdr ? b : null;
      }
      pos += size;
    }
    return null;
  }

  // Cajas hijas dentro de [start, end) de un buffer ya leído; una caja rota corta la lista ahí.
  function children(b, start, end) {
    const out = [];
    let p = start;
    while (p + 8 <= end) {
      let size = u32(b, p);
      let hdr = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        size = u64(b, p + 8);
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type: fourcc(b, p + 4), start: p + hdr, end: p + size });
      p += size;
    }
    return out;
  }
  function child(b, box, type) {
    if (!box) return null;
    for (const c of children(b, box.start, box.end))
      if (c.type === type) return c;
    return null;
  }

  // mvhd y mdhd empiezan igual: la versión 1 lleva los tiempos en 64 bits y la 0 en 32.
  function timeHeader(b, box) {
    if (!box) return null;
    const p = box.start + 4;
    if (b[box.start] === 1) {
      if (box.end - box.start < 32) return null;
      return {
        created: u64(b, p),
        timescale: u32(b, p + 16),
        duration: u64(b, p + 20),
      };
    }
    if (box.end - box.start < 20) return null;
    return {
      created: u32(b, p),
      timescale: u32(b, p + 8),
      duration: u32(b, p + 12),
    };
  }

  function parseMovie(b) {
    const top = { start: 0, end: b.length };
    const mv = timeHeader(b, child(b, top, "mvhd")) || {
      created: 0,
      timescale: 0,
      duration: 0,
    };
    const tracks = [];
    for (const trak of children(b, 0, b.length)) {
      if (trak.type !== "trak") continue;
      const mdia = child(b, trak, "mdia");
      const md = timeHeader(b, child(b, mdia, "mdhd"));
      const stbl = child(b, child(b, mdia, "minf"), "stbl");
      const stsd = child(b, stbl, "stsd");
      // La pista de telemetría se reconoce por su tipo de muestra «gpmd» (su hdlr es un «meta» genérico).
      tracks.push({
        formats: stsd
          ? children(b, stsd.start + 8, stsd.end).map((c) => c.type)
          : [],
        timescale: md ? md.timescale : 0,
        duration: md ? md.duration : 0,
        stbl,
        elst: child(b, child(b, trak, "edts"), "elst"),
      });
    }
    // Las GoPro dejan en udta un bloque GPMF con el modelo (MINF), que el DVNM de las antiguas no dice.
    const gpmf = child(b, child(b, top, "udta"), "GPMF");
    // La hora de creación es la del reloj de la cámara (a menudo hora local): solo sirve si no hay GPS.
    const created = (mv.created - MAC_EPOCH_S) * 1000;
    return {
      timescale: mv.timescale,
      duration: mv.duration,
      created:
        mv.created && created >= SANE_FROM && created < SANE_TO
          ? created
          : null,
      tracks,
      model: gpmf ? findText(b, gpmf.start, gpmf.end, "MINF", 0) : null,
    };
  }

  // Lista de edición del propio track: un hueco inicial (media_time −1) retrasa la telemetría y un
  // media_time positivo la adelanta. Así sus tiempos caen en la misma línea que lo que enseña el reproductor.
  function editShift(b, elst, movieScale, trackScale) {
    if (!elst || !movieScale || !trackScale) return 0;
    const v1 = b[elst.start] === 1;
    const w = v1 ? 20 : 12;
    const n = u32(b, elst.start + 4);
    let empty = 0;
    for (let i = 0, p = elst.start + 8; i < n && p + w <= elst.end; i++) {
      const dur = v1 ? u64(b, p) : u32(b, p);
      const mt = v1 ? i64(b, p + 8) : i32(b, p + 4);
      if (mt !== -1) return empty / movieScale - mt / trackScale;
      empty += dur;
      p += w;
    }
    return 0;
  }

  // Índice del track (stsz, stts, stsc, stco/co64): posición, tamaño, inicio y duración de cada muestra.
  function sampleTable(b, track) {
    const box = (t) => child(b, track.stbl, t);
    const stsz = box("stsz");
    const stts = box("stts");
    const stsc = box("stsc");
    const co64 = box("co64");
    const stco = co64 || box("stco");
    if (!stsz || !stts || !stsc || !stco || !track.timescale) return { n: 0 };
    // Entradas que declara la caja, sin pasar de las que caben en ella.
    const entries = (bx, at, w) =>
      Math.max(
        0,
        Math.min(
          u32(b, bx.start + at),
          Math.floor((bx.end - bx.start - at - 4) / w),
        ),
      );
    const fixed = u32(b, stsz.start + 4);
    let n = Math.min(
      fixed ? u32(b, stsz.start + 8) : entries(stsz, 8, 4),
      10000000,
    );
    const size = new Float64Array(n);
    for (let i = 0; i < n; i++)
      size[i] = fixed || u32(b, stsz.start + 12 + 4 * i);
    const start = new Float64Array(n);
    const dur = new Float64Array(n);
    let k = 0;
    let tick = 0;
    const nt = entries(stts, 4, 8);
    for (let e = 0; e < nt && k < n; e++) {
      const p = stts.start + 8 + 8 * e;
      const cnt = u32(b, p);
      const d = u32(b, p + 4);
      for (let j = 0; j < cnt && k < n; j++, k++) {
        start[k] = tick;
        dur[k] = d;
        tick += d;
      }
    }
    n = k;
    const w = co64 ? 8 : 4;
    const nc = entries(stco, 4, w);
    const nr = entries(stsc, 4, 12);
    const off = new Float64Array(n);
    let s = 0;
    for (let r = 0; r < nr && s < n; r++) {
      const p = stsc.start + 8 + 12 * r;
      const first = Math.max(1, u32(b, p));
      const per = u32(b, p + 4);
      const next = r + 1 < nr ? u32(b, p + 12) : nc + 1;
      for (let c = first; c < next && c <= nc && s < n; c++) {
        const q = stco.start + 8 + w * (c - 1);
        let o = co64 ? u64(b, q) : u32(b, q);
        for (let j = 0; j < per && s < n; j++, s++) {
          off[s] = o;
          o += size[s];
        }
      }
    }
    return { n: s, off, size, start, dur, scale: track.timescale };
  }

  // ---------- GPMF ----------
  // KLV: clave de 4 letras, tipo, tamaño de estructura y repeticiones; los datos van rellenos a 4 bytes.
  // Si algo no cuadra (trozo cortado o dañado) devuelve lo leído hasta ahí y «broken».
  function klv(b, start, end) {
    const items = [];
    let p = start;
    while (p + 8 <= end) {
      // Ceros donde tocaría una clave: relleno hasta el final de la muestra.
      if (!(b[p] | b[p + 1] | b[p + 2] | b[p + 3]))
        return { items, broken: false };
      const type = b[p + 4];
      if (!printable(b, p, 4) || (type && (type < 0x20 || type > 0x7e)))
        return { items, broken: true };
      const ss = b[p + 5];
      const rep = u16(b, p + 6);
      const s = p + 8;
      const e = s + ss * rep;
      const it = {
        key: fourcc(b, p),
        type: String.fromCharCode(type),
        nest: !type,
        ss,
        rep,
        start: s,
        end: Math.min(e, end),
      };
      if (e > end) {
        // Un contenedor cortado aún tiene dentro, enteros, los sensores grabados antes del corte.
        if (it.nest) items.push(it);
        return { items, broken: true };
      }
      items.push(it);
      p = s + ((ss * rep + 3) & ~3);
    }
    for (let i = p; i < end; i++) if (b[i]) return { items, broken: true };
    return { items, broken: false };
  }

  function num(dv, o, t) {
    switch (t) {
      case "b":
        return dv.getInt8(o);
      case "B":
        return dv.getUint8(o);
      case "s":
        return dv.getInt16(o);
      case "S":
        return dv.getUint16(o);
      case "l":
        return dv.getInt32(o);
      case "L":
        return dv.getUint32(o);
      case "f":
        return dv.getFloat32(o);
      case "d":
        return dv.getFloat64(o);
      case "q":
        return dv.getInt32(o) / 65536;
      case "Q":
        return dv.getInt32(o) + dv.getUint32(o + 4) / 4294967296;
      case "j":
        return dv.getInt32(o) * 4294967296 + dv.getUint32(o + 4);
      case "J":
        return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);
      default:
        return NaN;
    }
  }

  function numbers(dv, it) {
    const sz = TSIZE[it.type];
    if (!sz || it.nest || "cUFG".indexOf(it.type) >= 0) return [];
    const out = [];
    for (let p = it.start; p + sz <= it.end; p += sz)
      out.push(num(dv, p, it.type));
    return out;
  }

  function text(b, it) {
    let s = "";
    for (let i = it.start; i < it.end && b[i]; i++)
      s += String.fromCharCode(b[i]);
    return s.trim();
  }

  function findText(b, start, end, key, depth) {
    if (depth > 4) return null;
    for (const it of klv(b, start, end).items) {
      if (it.key === key && it.type === "c") return text(b, it) || null;
      if (it.nest) {
        const r = findText(b, it.start, it.end, key, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  // GPSU: «aammddhhmmss.sss» en UTC.
  function parseUtc(s) {
    const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d(?:\.\d+)?)/.exec(s);
    if (!m) return null;
    const mo = +m[2];
    const day = +m[3];
    if (mo < 1 || mo > 12 || day < 1 || day > 31 || +m[4] > 23 || +m[5] > 59)
      return null;
    const ms =
      Date.UTC(2000 + +m[1], mo - 1, day, +m[4], +m[5]) +
      Math.round(parseFloat(m[6]) * 1000);
    return ms >= SANE_FROM && ms < SANE_TO ? ms : null;
  }

  // Campos de una muestra: un tipo simple repetido, o la lista de TYPE en los complejos («?», p. ej. GPS9).
  function layout(it, typeStr) {
    if (it.type === "?") {
      const f = [];
      const s = typeStr || "";
      for (let i = 0; i < s.length; i++) {
        if (!TSIZE[s[i]]) return null;
        // «f[3]» son tres «f» seguidos.
        const m = /^\[(\d+)\]/.exec(s.slice(i + 1));
        const reps = m ? +m[1] : 1;
        for (let k = 0; k < reps; k++) f.push(s[i]);
        if (m) i += m[0].length;
      }
      let size = 0;
      for (const c of f) size += TSIZE[c];
      return f.length && size === it.ss ? f : null;
    }
    const sz = TSIZE[it.type];
    if (!sz || !it.ss || it.ss % sz || "cUFG".indexOf(it.type) >= 0)
      return null;
    return new Array(it.ss / sz).fill(it.type);
  }

  // Columnas Float64Array que crecen doblando su tamaño: cientos de miles de muestras sin arrays de objetos.
  function Series(names) {
    this.names = names;
    this.n = 0;
    this.cols = names.map(() => new Float64Array(1024));
  }
  Series.prototype.add = function () {
    if (this.n === this.cols[0].length)
      this.cols = this.cols.map((c) => {
        const d = new Float64Array(c.length * 2);
        d.set(c);
        return d;
      });
    for (let k = 0; k < this.cols.length; k++)
      this.cols[k][this.n] = arguments[k];
    this.n++;
  };
  Series.prototype.out = function () {
    const o = {};
    for (let k = 0; k < this.names.length; k++)
      o[this.names[k]] = this.cols[k].slice(0, this.n);
    return o;
  };

  // Una muestra de telemetría: DEVC (dispositivo) → STRM (un sensor cada uno). Devuelve false si estaba
  // dañada; lo leído antes del daño se queda.
  function parsePayload(b, t0, dur, st) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const blocks = [];
    const top = klv(b, 0, b.length);
    let whole = !top.broken;
    for (const dev of top.items) {
      if (dev.key !== "DEVC" || !dev.nest) continue;
      if (!parseDevice(b, dv, dev, blocks, st)) {
        whole = false;
        break;
      }
    }
    placeBlocks(blocks, t0, dur, st);
    return whole;
  }

  function parseDevice(b, dv, dev, blocks, st) {
    const r = klv(b, dev.start, dev.end);
    let id = "";
    for (const it of r.items) {
      if (it.key === "DVID") id = b.subarray(it.start, it.end).join(".");
      else if (it.key === "DVNM") {
        if (!st.dvnm) st.dvnm = text(b, it) || null;
      } else if (
        it.key === "STRM" &&
        it.nest &&
        !parseStream(b, dv, it, id, blocks, st)
      )
        return false;
    }
    return !r.broken;
  }

  // Dentro de un STRM las claves «pegajosas» (SCAL, TYPE, ORIN…) van antes del dato y se le aplican; las del
  // GPS (GPSF, GPSP, GPSU) valen para todo el STRM.
  function parseStream(b, dv, strm, dev, blocks, st) {
    const r = klv(b, strm.start, strm.end);
    let scal = null;
    let type = null;
    let orin = null;
    const gps = { fix: null, dop: null, utc: null };
    const found = [];
    for (const it of r.items) {
      if (it.key === "SCAL") scal = numbers(dv, it);
      else if (it.key === "TYPE") type = text(b, it);
      else if (it.key === "ORIN") orin = text(b, it);
      else if (it.key === "GPSF") gps.fix = first(numbers(dv, it));
      else if (it.key === "GPSP") gps.dop = first(numbers(dv, it));
      else if (it.key === "GPSU") gps.utc = parseUtc(text(b, it));
      else if (DATA[it.key] && !it.nest) found.push({ it, scal, type, orin });
    }
    for (const d of found) addBlock(dv, d, gps, dev, blocks, st);
    return !r.broken;
  }

  function first(a) {
    return a.length ? a[0] : null;
  }

  function addBlock(dv, d, gps, dev, blocks, st) {
    const key = d.it.key;
    // Un solo dispositivo por sensor: si hubiera otro (un accesorio), sus datos no se mezclan.
    if (!(key in st.owner)) st.owner[key] = dev;
    else if (st.owner[key] !== dev) return;
    // Por si un trozo no repite SCAL/TYPE/GPSF/GPSP, valen los del anterior del mismo sensor.
    const memo = st.memo[key] || (st.memo[key] = {});
    if (d.scal) memo.scal = d.scal;
    if (d.type) memo.type = d.type;
    if (gps.fix !== null) memo.fix = gps.fix;
    if (gps.dop !== null) memo.dop = gps.dop;
    const fields = layout(d.it, memo.type);
    if (!fields || fields.length < DATA[key]) return;
    const f = fields.length;
    const n = d.it.rep;
    const scal = memo.scal || [];
    const div = fields.map(
      (_, k) => (scal.length === 1 ? scal[0] : scal[k]) || 1,
    );
    const rows = new Float64Array(n * f);
    let p = d.it.start;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < f; k++) {
        rows[i * f + k] = num(dv, p, fields[k]) / div[k];
        p += TSIZE[fields[k]];
      }
    if ((key === "ACCL" || key === "GYRO") && d.orin && !st.orin)
      st.orin = d.orin;
    blocks.push({
      key,
      n,
      f,
      rows,
      fix: memo.fix === undefined ? 0 : memo.fix,
      dop: memo.dop === undefined ? NaN : memo.dop / 100,
      utc: gps.utc,
    });
  }

  // Las N muestras de un sensor dentro de una muestra de telemetría (inicio t0, duración d) van repartidas
  // por igual: t_i = t0 + d·i/N.
  function placeBlocks(blocks, t0, dur, st) {
    const total = {};
    for (const bl of blocks) total[bl.key] = (total[bl.key] || 0) + bl.n;
    const done = {};
    for (const bl of blocks) {
      const N = total[bl.key];
      const i0 = done[bl.key] || 0;
      done[bl.key] = i0 + bl.n;
      const r = bl.rows;
      for (let i = 0; i < bl.n; i++) {
        const t = t0 + (dur * (i0 + i)) / N;
        const o = i * bl.f;
        if (bl.key === "ACCL") st.acc.add(t, r[o], r[o + 1], r[o + 2]);
        else if (bl.key === "GYRO") st.gyro.add(t, r[o], r[o + 1], r[o + 2]);
        else if (bl.key === "GPS5") {
          // GPSU es la hora de la primera muestra del trozo; GPSF y GPSP valen para todo el trozo.
          if (!i && bl.fix >= 2 && bl.utc !== null)
            st.anchors.push([t, bl.utc]);
          // Sin hora por muestra: la columna «utc» queda en NaN.
          st.gps5.add(t, r[o], r[o + 1], r[o + 2], r[o + 3], bl.fix, bl.dop);
        } else {
          // GPS9 trae en cada muestra días desde 2000-01-01, segundos desde medianoche, DOP y fijo.
          const utc =
            r[o + 5] > 0
              ? GPS_EPOCH_MS + (r[o + 5] * 86400 + r[o + 6]) * 1000
              : NaN;
          st.gps9.add(
            t,
            r[o],
            r[o + 1],
            r[o + 2],
            r[o + 3],
            r[o + 8],
            r[o + 7],
            utc,
          );
        }
      }
    }
  }

  // Lee las muestras de telemetría por lotes, con unas cuantas lecturas en vuelo, y las entrega en orden.
  async function eachPayload(reader, sm, onPayload, onBad, progress) {
    const groups = [];
    let g = null;
    for (let i = 0; i < sm.n; i++) {
      const off = sm.off[i];
      const size = sm.size[i];
      if (!size) continue;
      if (size > MAX_PAYLOAD || off >= reader.size) {
        onBad(i);
        continue;
      }
      if (
        g &&
        off >= g.end &&
        off - g.end <= BATCH_GAP &&
        off + size - g.off <= BATCH_BYTES
      ) {
        g.end = off + size;
        g.idx.push(i);
      } else {
        g = { off, end: off + size, idx: [i] };
        groups.push(g);
      }
    }
    const pending = [];
    let next = 0;
    let done = 0;
    const launch = () => {
      while (pending.length < PREFETCH && next < groups.length) {
        const gr = groups[next++];
        pending.push(
          read(reader, gr.off, gr.end - gr.off).then(
            (buf) => ({ gr, buf }),
            (err) => ({ gr, err }),
          ),
        );
      }
    };
    launch();
    while (pending.length) {
      const got = await pending.shift();
      if (got.err) throw got.err;
      launch();
      for (const i of got.gr.idx) {
        const a = sm.off[i] - got.gr.off;
        onPayload(
          i,
          got.buf.subarray(a, Math.min(got.buf.length, a + sm.size[i])),
        );
      }
      done += got.gr.idx.length;
      progress(Math.min(1, done / sm.n));
    }
  }

  function firstFix(g) {
    for (let i = 0; i < g.t.length; i++) if (g.fix[i] >= 2) return i;
    return -1;
  }

  // Lee el MP4 y devuelve la telemetría en bruto, con t en segundos de la línea del vídeo (0 = primer fotograma).
  async function extract(reader, opts) {
    const o = opts || {};
    const progress =
      typeof o.onProgress === "function" ? o.onProgress : function () {};
    const moov = await readMoov(reader);
    if (!moov) throw new Error(MSG.notMp4);
    const movie = parseMovie(moov);
    let track = null;
    for (const tr of movie.tracks)
      if (!track && tr.formats.indexOf("gpmd") >= 0) track = tr;
    if (!track) throw new Error(MSG.noGpmf);
    const sm = sampleTable(moov, track);
    // GoPro guarda la telemetría en una pista «gpmd» aparte del vídeo: sus muestras van en el mismo reloj que
    // el vídeo, salvo lo que mueva su lista de edición.
    const shift = editShift(moov, track.elst, movie.timescale, track.timescale);
    const st = {
      gps5: new Series(GPS_COLS),
      gps9: new Series(GPS_COLS),
      acc: new Series(IMU_COLS),
      gyro: new Series(IMU_COLS),
      anchors: [],
      memo: {},
      owner: {},
      dvnm: null,
      orin: null,
      broken: 0,
      brokenAt: Infinity,
    };
    const startT = (i) => sm.start[i] / sm.scale + shift;
    // Una muestra con duración 0 en stts apilaría todo su segundo en un instante: vale la de la anterior.
    const durT = (i) => (sm.dur[i] || (i ? sm.dur[i - 1] : 0)) / sm.scale;
    const bad = (i) => {
      st.broken++;
      st.brokenAt = Math.min(st.brokenAt, startT(i));
    };
    progress(0);
    await eachPayload(
      reader,
      sm,
      (i, payload) => {
        const whole = parsePayload(payload, startT(i), durT(i), st);
        if (!whole || payload.length < sm.size[i]) bad(i);
      },
      bad,
      progress,
    );
    // HERO11+ graba GPS9 (fijo, DOP y hora en cada muestra) además de GPS5: se usa GPS9 si tiene fijos.
    let gs = st.gps9.out();
    let i0 = firstFix(gs);
    const use9 = i0 >= 0;
    if (!use9) {
      gs = st.gps5.out();
      i0 = firstFix(gs);
    }
    if (i0 < 0) throw new Error(MSG.noGps);
    // Hora UTC del primer fijo: GPS9 la lleva en cada muestra y GPS5 solo al principio de cada trozo (GPSU);
    // si justo ese fijo no la trae, se lleva hacia atrás la del siguiente con el reloj del vídeo.
    const t0 = gs.t[i0];
    let utc0 = null;
    if (use9)
      for (let i = i0; i < gs.t.length && utc0 === null; i++)
        if (gs.fix[i] >= 2 && gs.utc[i] >= SANE_FROM && gs.utc[i] < SANE_TO)
          utc0 = gs.utc[i] - (gs.t[i] - t0) * 1000;
    if (utc0 === null && st.anchors.length)
      utc0 = st.anchors[0][1] - (st.anchors[0][0] - t0) * 1000;
    const warnings = [];
    if (st.broken) {
      const at = Math.max(0, Math.floor(st.brokenAt));
      warnings.push(
        st.broken === 1
          ? "Un trozo de la telemetría está dañado o cortado (hacia el segundo " +
              at +
              " del vídeo): se ha usado lo que se podía leer."
          : st.broken +
              " trozos de la telemetría están dañados o cortados (el primero hacia el segundo " +
              at +
              " del vídeo): se ha usado lo que se podía leer.",
      );
    }
    progress(1);
    return {
      camera: movie.model || st.dvnm || null,
      duration: movie.timescale
        ? movie.duration / movie.timescale
        : track.duration / track.timescale || 0,
      created: movie.created,
      gpsStartUtc: utc0 === null ? null : Math.round(utc0),
      // Segundos del vídeo en que llega ese primer fijo (para pasar su hora al instante 0).
      gpsStartT: t0,
      gps: {
        t: gs.t,
        lat: gs.lat,
        lon: gs.lon,
        alt: gs.alt,
        speed: gs.speed,
        fix: gs.fix,
        dop: gs.dop,
      },
      acc: st.acc.n ? st.acc.out() : null,
      gyro: st.gyro.n ? st.gyro.out() : null,
      orin: st.orin,
      warnings,
    };
  }

  // ---------- tanda ----------
  // Media de los primeros (dir 1) o últimos (dir −1) «span» segundos: arranque del filtro sin transitorio.
  function edgeMean(t, x, dir, span) {
    const n = x.length;
    let i = dir > 0 ? 0 : n - 1;
    const t0 = t[i];
    let s = 0;
    let c = 0;
    for (; i >= 0 && i < n && Math.abs(t[i] - t0) <= span; i += dir) {
      s += x[i];
      c++;
    }
    return s / c;
  }

  // Gravedad: paso bajo de primer orden (τ ≈ 1 s) hacia delante y luego hacia atrás, para que no llegue tarde
  // a los cambios de postura.
  function lowPass(t, x, tau) {
    const n = x.length;
    const y = new Float64Array(n);
    if (!n) return y;
    let v = edgeMean(t, x, 1, tau);
    for (let i = 0; i < n; i++) {
      const dt = i ? t[i] - t[i - 1] : 0;
      if (dt > 0) v += (1 - Math.exp(-dt / tau)) * (x[i] - v);
      y[i] = v;
    }
    v = edgeMean(t, x, -1, tau);
    for (let i = n - 1; i >= 0; i--) {
      const dt = i < n - 1 ? t[i + 1] - t[i] : 0;
      if (dt > 0) v += (1 - Math.exp(-dt / tau)) * (y[i] - v);
      y[i] = v;
    }
    return y;
  }

  // Media por cajones de 1/hz s: el análisis remuestrea a 50 Hz, así que con 100 Hz sobra y ocupa la mitad.
  function downsample(s, hz) {
    const n = s.t.length;
    const span = n > 1 ? s.t[n - 1] - s.t[0] : 0;
    if (!(hz > 0) || !(span > 0) || (n - 1) / span <= hz * 1.05)
      return {
        t: Float64Array.from(s.t),
        x: Float64Array.from(s.x),
        y: Float64Array.from(s.y),
        z: Float64Array.from(s.z),
      };
    const w = 1 / hz;
    const out = IMU_COLS.map(() => new Float64Array(n));
    const sum = [0, 0, 0, 0];
    let k = 0;
    let c = 0;
    let bin = NaN;
    for (let i = 0; i <= n; i++) {
      const b = i < n ? Math.floor((s.t[i] - s.t[0]) / w) : NaN;
      if (c && b !== bin) {
        for (let j = 0; j < 4; j++) {
          out[j][k] = sum[j] / c;
          sum[j] = 0;
        }
        k++;
        c = 0;
      }
      if (i === n) break;
      bin = b;
      sum[0] += s.t[i];
      sum[1] += s.x[i];
      sum[2] += s.y[i];
      sum[3] += s.z[i];
      c++;
    }
    return {
      t: out[0].slice(0, k),
      x: out[1].slice(0, k),
      y: out[2].slice(0, k),
      z: out[3].slice(0, k),
    };
  }

  function minus(a, b) {
    return Float64Array.from(a, (v, i) => v - b[i]);
  }

  // GoPro no da la precisión en metros, solo el DOP: con ~2,5 m por unidad de DOP (el error típico de un GPS
  // de consumo) sale una precisión aproximada, acotada a 1–50 m. Sin DOP, 5 m como en el análisis.
  function haccOf(dop) {
    return Number.isFinite(dop) ? Math.min(50, Math.max(1, dop * 2.5)) : 5;
  }

  // Hora UTC del instante 0 del vídeo, como el «epoch» de las tandas del móvil: la del primer fijo menos su
  // tiempo en el vídeo; sin GPS con hora, la de creación del archivo (reloj de la cámara).
  function startOf(data) {
    if (data.gpsStartUtc)
      return Number.isFinite(data.gpsStartT)
        ? Math.round(data.gpsStartUtc - data.gpsStartT * 1000)
        : data.gpsStartUtc;
    return data.created || null;
  }

  // Telemetría en bruto → tanda como las del móvil (loc, acc lineal, grav, gyro), lista para analyze().
  function toSession(data, opts) {
    const o = opts || {};
    const hz = o.imuHz === undefined ? 100 : o.imuHz;
    const g = data.gps || {};
    const keep = [];
    if (g.t && g.lat && g.lon)
      for (let i = 0; i < g.t.length; i++)
        if (
          (!g.fix || g.fix[i] >= 2) &&
          Number.isFinite(g.lat[i]) &&
          Number.isFinite(g.lon[i])
        )
          keep.push(i);
    // Sin columna (datos montados a mano): NaN, y el análisis saca la velocidad de las posiciones.
    const pick = (a) => Float64Array.from(keep, (i) => (a ? a[i] : NaN));
    const session = {
      loc: {
        t: pick(g.t),
        lat: pick(g.lat),
        lon: pick(g.lon),
        speed: pick(g.speed),
        hacc: Float64Array.from(keep, (i) => haccOf(g.dop ? g.dop[i] : NaN)),
        bearing: null,
      },
    };
    const warnings = (data.warnings || []).slice();
    if (data.acc && data.gyro && data.acc.t.length && data.gyro.t.length) {
      const a = downsample(data.acc, hz);
      const grav = {
        t: a.t.slice(),
        x: lowPass(a.t, a.x, GRAV_TAU),
        y: lowPass(a.t, a.y, GRAV_TAU),
        z: lowPass(a.t, a.z, GRAV_TAU),
      };
      session.acc = {
        t: a.t,
        x: minus(a.x, grav.x),
        y: minus(a.y, grav.y),
        z: minus(a.z, grav.z),
      };
      session.grav = grav;
      session.gyro = downsample(data.gyro, hz);
    } else warnings.push(MSG.noImu);
    session.warnings = warnings;
    session.source = "gopro";
    session.videoDuration = data.duration;
    session.startUtc = startOf(data);
    return session;
  }

  const api = {
    bufferReader,
    fileReader,
    extract,
    toSession,
    MSG,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaGPMF = api;
})(typeof window !== "undefined" ? window : globalThis);
