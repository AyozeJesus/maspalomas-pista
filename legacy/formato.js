// Formato de las tandas guardadas: trozos de grabación (móvil → garaje del Mac) y CSV como los de Sensor Logger.
// Lo usan el móvil (navegador) y el garaje (Node), así que no depende de nada más.
(function (root) {
  "use strict";
  const VERSION = 1;
  // Columnas de cada serie, en el orden en que se guardan.
  const SERIES = {
    loc: ["t", "lat", "lon", "speed", "hacc"],
    acc: ["t", "x", "y", "z"],
    gyro: ["t", "x", "y", "z"],
    grav: ["t", "x", "y", "z"],
    // Lo que calcula el móvil en directo: distancia en la vuelta (m), velocidad (m/s), aceleración
    // longitudinal (g), inclinación (grados, + derecha) y número de vuelta.
    canal: ["t", "s", "v", "a", "lean", "lap"],
  };
  const ID_RE = /^\d{8}-\d{6}-[a-z0-9]{4}$/;
  const MAX_ROWS = 200000;

  function isNum(x) {
    return typeof x === "number" || x === null;
  }

  // Comprueba un trozo recibido; devuelve un mensaje de error o null si vale.
  function checkChunk(c, id, seq) {
    if (!c || typeof c !== "object") return "trozo vacío";
    if (c.v !== VERSION) return "versión desconocida";
    if (c.id !== id || c.seq !== seq)
      return "id o número de trozo no coinciden";
    if (!Number.isFinite(c.epoch) || c.epoch < 1.5e12 || c.epoch > 4e12)
      return "hora de inicio no válida";
    if (!c.series || typeof c.series !== "object") return "sin series";
    for (const key in c.series) {
      const cols = SERIES[key];
      if (!cols) return "serie desconocida: " + key;
      const s = c.series[key];
      if (!s || typeof s !== "object") return "serie vacía: " + key;
      const n = Array.isArray(s.t) ? s.t.length : -1;
      if (n < 0 || n > MAX_ROWS)
        return "serie sin tiempo o demasiado larga: " + key;
      for (const col of cols) {
        const a = s[col];
        if (!Array.isArray(a) || a.length !== n)
          return "columna mal formada: " + key + "." + col;
        for (let i = 0; i < n; i++)
          if (!isNum(a[i])) return "valor no numérico en " + key + "." + col;
      }
    }
    return null;
  }

  // Solo las columnas conocidas, como arrays normales (JSON.stringify convierte NaN en null).
  function cleanChunk(c) {
    const series = {};
    for (const key in c.series) {
      const out = {};
      for (const col of SERIES[key]) out[col] = Array.from(c.series[key][col]);
      series[key] = out;
    }
    return { v: VERSION, id: c.id, seq: c.seq, epoch: c.epoch, series };
  }

  // Une los trozos de una tanda (en cualquier orden) en una serie por sensor, ordenada por tiempo.
  function mergeChunks(chunks) {
    const sorted = chunks.slice().sort((a, b) => a.seq - b.seq);
    const out = { epoch: sorted.length ? sorted[0].epoch : null, series: {} };
    for (const key in SERIES) {
      const cols = SERIES[key];
      let n = 0;
      for (const c of sorted) if (c.series[key]) n += c.series[key].t.length;
      if (!n) continue;
      const s = {};
      for (const col of cols) s[col] = new Float64Array(n);
      let o = 0;
      for (const c of sorted) {
        const src = c.series[key];
        if (!src) continue;
        for (const col of cols) {
          const a = src[col];
          for (let i = 0; i < a.length; i++)
            s[col][o + i] = a[i] === null ? NaN : a[i];
        }
        o += src.t.length;
      }
      out.series[key] = s;
    }
    return out;
  }

  // CSV con las columnas de Sensor Logger (time en ns de época y seconds_elapsed).
  function csvFiles(series, epochMs) {
    const ns = (t) => String(Math.round(epochMs + t * 1000)) + "000000";
    const num = (x) => (x === null || Number.isNaN(x) ? "" : String(x));
    const csv = (header, s, cols) => {
      const lines = [header];
      const n = s.t.length;
      for (let i = 0; i < n; i++) {
        let line = ns(s.t[i]) + "," + s.t[i].toFixed(4);
        for (const c of cols) line += "," + num(s[c][i]);
        lines.push(line);
      }
      return lines.join("\n") + "\n";
    };
    const files = [];
    if (series.loc && series.loc.t.length)
      files.push({
        name: "Location.csv",
        text: csv(
          "time,seconds_elapsed,horizontalAccuracy,speed,longitude,latitude",
          series.loc,
          ["hacc", "speed", "lon", "lat"],
        ),
      });
    const imu = [
      ["acc", "Accelerometer.csv"],
      ["gyro", "Gyroscope.csv"],
      ["grav", "Gravity.csv"],
    ];
    for (const [key, name] of imu)
      if (series[key] && series[key].t.length)
        files.push({
          name,
          text: csv("time,seconds_elapsed,z,y,x", series[key], ["z", "y", "x"]),
        });
    if (series.canal && series.canal.t.length)
      files.push({
        name: "Canales.csv",
        text: csv(
          "time,seconds_elapsed,distancia_m,velocidad_ms,aceleracion_g,inclinacion_grados,vuelta",
          series.canal,
          ["s", "v", "a", "lean", "lap"],
        ),
      });
    return files;
  }

  // Resumen de una tanda (lo que manda el móvil): solo tipos simples y tamaño acotado.
  function checkMeta(m, id) {
    if (!m || typeof m !== "object") return "resumen vacío";
    if (m.v !== VERSION) return "versión desconocida";
    if (m.id !== id) return "id no coincide";
    if (!Number.isFinite(m.epoch)) return "hora de inicio no válida";
    if (!Array.isArray(m.vueltas) || m.vueltas.length > 500)
      return "lista de vueltas no válida";
    return null;
  }

  const api = {
    VERSION,
    SERIES,
    ID_RE,
    checkChunk,
    cleanChunk,
    mergeChunks,
    csvFiles,
    checkMeta,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaFormato = api;
})(typeof window !== "undefined" ? window : globalThis);
