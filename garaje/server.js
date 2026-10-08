#!/usr/bin/env node
// Garaje de Modo pista: guarda en este Mac las tandas que sube el móvil y las deja ver y analizar aquí.
// Sin dependencias: Node y, para que el móvil llegue desde el circuito, cloudflared (túnel https gratuito).
//
// Dos puertas, las dos solo en 127.0.0.1:
//  - muelle (8737): lo único que sale a internet, por el túnel. Con la clave del móvil solo deja AÑADIR
//    trozos y resúmenes de tandas; no lee ni borra nada.
//  - garaje (8738): la página de este Mac con el código para emparejar, la lista de tandas y el análisis.
//    El túnel no llega aquí.
// Los datos quedan en ~/Maspalomas-telemetria hasta que tú borres la carpeta.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const WEB = path.join(__dirname, "web");
const F = require(path.join(REPO, "formato.js"));
const DATOS =
  process.env.GARAJE_DATOS || path.join(os.homedir(), "Maspalomas-telemetria");
const TANDAS = path.join(DATOS, "tandas");
const PUERTO_MUELLE = Number(process.env.GARAJE_PUERTO_MUELLE) || 8737;
const PUERTO = Number(process.env.GARAJE_PUERTO) || 8738;
const APP =
  process.env.GARAJE_APP || "https://ayozejesus.github.io/maspalomas-pista/";
const ORIGENES = new Set(
  ["https://ayozejesus.github.io"].concat(
    (process.env.GARAJE_ORIGENES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
);
const CON_TUNEL = process.env.GARAJE_SIN_TUNEL !== "1";
const ABRIR_NAVEGADOR = process.env.GARAJE_SIN_NAVEGADOR !== "1";
const MAX_TROZO = 16 * 1024 * 1024; // recibido
const MAX_JSON = 64 * 1024 * 1024; // descomprimido
const MAX_META = 2 * 1024 * 1024;
const MIN_LIBRE = 1024 * 1024 * 1024;

function hora() {
  return new Date().toLocaleTimeString("es-ES", { hour12: false });
}
function log(...a) {
  console.log(hora(), "·", ...a);
}

// ---------- datos ----------
function writeAtomic(file, data, mode) {
  const tmp =
    file +
    "." +
    process.pid +
    "." +
    crypto.randomBytes(4).toString("hex") +
    ".tmp";
  fs.writeFileSync(tmp, data, { mode: mode || 0o644 });
  fs.renameSync(tmp, file);
}

fs.mkdirSync(TANDAS, { recursive: true });

// La clave se crea la primera vez y se guarda en config.json (solo legible por tu usuario).
const CONFIG_FILE = path.join(DATOS, "config.json");
function newConfig() {
  const c = {
    clave: crypto.randomBytes(24).toString("base64url"),
    creado: new Date().toISOString(),
  };
  writeAtomic(CONFIG_FILE, JSON.stringify(c, null, 2) + "\n", 0o600);
  return c;
}
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (c && typeof c.clave === "string" && c.clave.length >= 32) return c;
  } catch (e) {
    /* primera vez */
  }
  return newConfig();
}
let CFG = loadConfig();
let AUTH = Buffer.from("Bearer " + CFG.clave);

// Clave nueva: los móviles emparejados dejan de poder subir hasta que escaneen el código otra vez
// (para cortar el acceso a un móvil prestado).
function rotateKey() {
  CFG = newConfig();
  AUTH = Buffer.from("Bearer " + CFG.clave);
  log("Clave cambiada: los móviles tienen que escanear el código nuevo.");
}

function authorized(req) {
  const h = Buffer.from(String(req.headers.authorization || ""));
  return h.length === AUTH.length && crypto.timingSafeEqual(h, AUTH);
}

function freeBytes() {
  try {
    const s = fs.statfsSync(DATOS);
    return s.bavail * s.bsize;
  } catch (e) {
    return Infinity;
  }
}

function tandaDir(id) {
  return path.join(TANDAS, id);
}
function listIds() {
  try {
    return fs
      .readdirSync(TANDAS)
      .filter((n) => F.ID_RE.test(n))
      .sort()
      .reverse();
  } catch (e) {
    return [];
  }
}
function chunkFiles(id) {
  try {
    return fs
      .readdirSync(path.join(tandaDir(id), "trozos"))
      .filter((n) => /^\d{6}\.json\.gz$/.test(n))
      .sort();
  } catch (e) {
    return [];
  }
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}
function readChunks(id) {
  return chunkFiles(id).map((n) =>
    JSON.parse(
      zlib
        .gunzipSync(fs.readFileSync(path.join(tandaDir(id), "trozos", n)))
        .toString("utf8"),
    ),
  );
}
function filesOf(id) {
  const chunks = readChunks(id);
  if (!chunks.length) return null;
  const merged = F.mergeChunks(chunks);
  return {
    epoch: merged.epoch,
    files: F.csvFiles(merged.series, merged.epoch),
  };
}

// ---------- análisis en el Mac (el mismo código que la web) ----------
let telemetry = null;
function T() {
  if (telemetry) return telemetry;
  globalThis.window = globalThis;
  for (const f of ["track-data.js", "sim.js", "analysis.js", "telemetry.js"])
    require(path.join(REPO, f));
  telemetry = globalThis.MaspaTelemetry;
  return telemetry;
}

// Huella de lo recibido: si cambia, el resumen se vuelve a calcular.
function stampOf(id) {
  const files = chunkFiles(id);
  let bytes = 0;
  for (const n of files)
    bytes += fs.statSync(path.join(tandaDir(id), "trozos", n)).size;
  const meta = readJson(path.join(tandaDir(id), "meta.json"));
  return {
    trozos: files.length,
    bytes,
    meta: meta ? JSON.stringify(meta.meta || null) : "",
  };
}

function finishOf(meta) {
  const f = meta && meta.meta;
  return {
    osm: f && Number.isFinite(f.osm) ? f.osm : 0,
    rev: f && Number.isFinite(f.rev) ? f.rev : 0,
  };
}
function finishKey(f) {
  return f.osm + "-" + f.rev;
}

// Resumen de la tanda con su línea de meta (resumen.json) o, para comparar con otro móvil que la tiene en otro
// sitio, con otra (resumen-meta-<osm>-<rev>.json).
function analyzeTanda(id, finishOverride) {
  const stamp = stampOf(id);
  const meta = readJson(path.join(tandaDir(id), "meta.json"));
  const out = Object.assign({}, stamp, {
    v: RESUMEN_V,
    calculado: new Date().toISOString(),
  });
  const finish = finishOverride || finishOf(meta);
  try {
    const data = filesOf(id);
    if (!data) throw new Error("Sin datos todavía.");
    const session = T().sessionFromCsv(data.files);
    const a = T().analyze(session, { finish });
    const L = session.loc.t;
    Object.assign(out, {
      duracion: L.length ? L[L.length - 1] - L[0] : 0,
      sentido: a.dir,
      inclinacion: a.leanFrom,
      mejor: a.best ? a.best.time : null,
      ideal: a.ideal,
      avisos: a.warnings,
      vueltas: a.laps.map((l) => ({
        num: l.num,
        time: Math.round(l.time * 1000) / 1000,
        valid: l.valid,
        sectors: l.sectors,
        corners: l.corners,
        leanMax: Math.round(l.leanMax * 10) / 10,
        vMax: Math.round(l.vMax * 10) / 10,
      })),
    });
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
  }
  writeAtomic(
    path.join(
      tandaDir(id),
      finishOverride
        ? "resumen-meta-" + finishKey(finishOverride) + ".json"
        : "resumen.json",
    ),
    JSON.stringify(out, null, 2) + "\n",
  );
  return out;
}

// Si cambia lo que guarda el resumen, sube la versión y los resúmenes viejos se recalculan solos.
const RESUMEN_V = 3;
function isFresh(resumen, stamp) {
  return (
    !!resumen &&
    resumen.v === RESUMEN_V &&
    resumen.trozos === stamp.trozos &&
    resumen.bytes === stamp.bytes &&
    resumen.meta === stamp.meta
  );
}

// ---------- comparativa del día ----------
// Todas las tandas de un día (sin el simulador), por piloto: mejor vuelta, ideal, mejores sectores, lo mejor de
// cada curva y la lista de vueltas. Si los móviles tienen la meta en sitios distintos, las tandas que no
// coinciden se reanalizan con la meta de la mayoría para que los sectores se puedan comparar.
function dayOf(id) {
  return id.slice(0, 8);
}
function realTandas() {
  return listIds()
    .map((id) => ({ id, meta: readJson(path.join(tandaDir(id), "meta.json")) }))
    .filter((t) => !(t.meta && t.meta.sim));
}
function daysAvailable() {
  return [...new Set(realTandas().map((t) => dayOf(t.id)))];
}

function computeDay(day) {
  const items = realTandas().filter((t) => dayOf(t.id) === day);
  let pendingAny = false;
  const withRes = [];
  for (const t of items) {
    const stamp = stampOf(t.id);
    if (!stamp.trozos) continue;
    const res = readJson(path.join(tandaDir(t.id), "resumen.json"));
    if (!isFresh(res, stamp)) {
      queueAnalysis(t.id);
      pendingAny = true;
      continue;
    }
    if (res.error || !res.sentido) continue;
    withRes.push(Object.assign(t, { stamp, res, finish: finishOf(t.meta) }));
  }
  // Sentido con más vueltas; los demás solo se cuentan.
  const lapsOf = (x) => (x.res.vueltas || []).filter((v) => v.valid).length;
  const bySense = {};
  for (const x of withRes)
    bySense[x.res.sentido] = (bySense[x.res.sentido] || 0) + lapsOf(x);
  const sense = Object.keys(bySense).sort((a, b) => bySense[b] - bySense[a])[0];
  const group = withRes.filter((x) => x.res.sentido === sense);
  // Meta común: la que usan más pilotos; si empatan, la puesta a mano (suele ser la del cronometraje oficial)
  // antes que la de por defecto; y si no, la de más vueltas.
  const pilotOf = (x) =>
    (x.meta &&
      typeof x.meta.piloto === "string" &&
      x.meta.piloto.slice(0, 30)) ||
    "Sin nombre";
  const byFinish = {};
  for (const x of group) {
    const k = finishKey(x.finish);
    const f = (byFinish[k] = byFinish[k] || { pilots: new Set(), laps: 0 });
    f.pilots.add(pilotOf(x));
    f.laps += lapsOf(x);
  }
  const mainKey = Object.keys(byFinish).sort(
    (a, b) =>
      byFinish[b].pilots.size - byFinish[a].pilots.size ||
      (a === "0-0") - (b === "0-0") ||
      byFinish[b].laps - byFinish[a].laps,
  )[0];
  const mainFinish = group.find((x) => finishKey(x.finish) === mainKey);
  let rebased = false;
  let budget = 6; // reanálisis como mucho por consulta (≈1 s cada uno)
  for (const x of group) {
    if (finishKey(x.finish) === mainKey) continue;
    const f = mainFinish.finish;
    const file = path.join(tandaDir(x.id), "resumen-meta-" + mainKey + ".json");
    let r = readJson(file);
    if (!isFresh(r, x.stamp)) {
      if (budget-- <= 0) {
        pendingAny = true;
        x.skip = true;
        continue;
      }
      r = analyzeTanda(x.id, f);
    }
    x.res = r;
    rebased = true;
  }
  const pilots = {};
  let names = null;
  for (const x of group) {
    if (x.skip || x.res.error) continue;
    const name = pilotOf(x);
    const p = (pilots[name] = pilots[name] || {
      piloto: name,
      tandas: 0,
      vueltas: [],
    });
    p.tandas++;
    for (const v of x.res.vueltas || []) {
      if (!v.valid || !Array.isArray(v.sectors)) continue;
      if (!names && Array.isArray(v.corners))
        names = v.corners.map((c) => ({ num: c.num, name: c.name }));
      p.vueltas.push({
        tanda: x.id,
        num: v.num,
        time: v.time,
        sectors: v.sectors,
        corners: v.corners || [],
        leanMax: Number.isFinite(v.leanMax) ? v.leanMax : null,
        vMax: Number.isFinite(v.vMax) ? v.vMax : null,
      });
    }
  }
  const out = [];
  for (const p of Object.values(pilots)) {
    if (!p.vueltas.length) continue;
    const times = p.vueltas.map((v) => v.time).sort((a, b) => a - b);
    const nSec = p.vueltas[0].sectors.length;
    const sectores = [];
    for (let k = 0; k < nSec; k++)
      sectores.push(Math.min(...p.vueltas.map((v) => v.sectors[k])));
    const best = (key, pick) => {
      const vals = [];
      for (const v of p.vueltas)
        for (const c of v.corners)
          if (Number.isFinite(c[key])) vals.push([c.name, c[key]]);
      const m = {};
      for (const [n, val] of vals)
        m[n] = m[n] === undefined ? val : pick(m[n], val);
      return m;
    };
    const vMin = best("vMin", Math.max);
    const lean = best("leanMax", Math.max);
    const brake = best("peakG", Math.max);
    const maxOf = (key) => {
      const vals = p.vueltas.map((v) => v[key]).filter(Number.isFinite);
      return vals.length ? Math.max(...vals) : null;
    };
    out.push({
      piloto: p.piloto,
      tandas: p.tandas,
      vueltas: p.vueltas.length,
      mejor: times[0],
      ideal: sectores.reduce((a, b) => a + b, 0),
      media3:
        times.slice(0, 3).reduce((a, b) => a + b, 0) /
        Math.min(3, times.length),
      sectores,
      curvas: (names || []).map((c) => ({
        name: c.name,
        vMin: vMin[c.name] ?? null,
        leanMax: lean[c.name] ?? null,
        peakG: brake[c.name] ?? null,
      })),
      // Máximos del día: inclinación y velocidad punta (de todas sus vueltas válidas).
      leanMax: maxOf("leanMax"),
      vMax: maxOf("vMax"),
      lista: p.vueltas.map((v) => ({
        time: v.time,
        leanMax: v.leanMax,
        vMax: v.vMax,
      })),
    });
  }
  out.sort((a, b) => a.mejor - b.mejor);
  const others = Object.entries(bySense)
    .filter(([s]) => s !== sense)
    .map(([s, n]) => ({ sentido: s, vueltas: n }));
  return {
    fecha: day,
    sentido: sense || null,
    curvas: names || [],
    pilotos: out,
    metaIgualada: rebased,
    // Pilotos cuya línea de meta se ha usado para todos (cuando no coincidían).
    metaDe: rebased && mainKey ? [...byFinish[mainKey].pilots] : null,
    otros: others,
    analizando: pendingAny,
    calculado: new Date().toISOString(),
  };
}

// Una tanda cada vez, sin bloquear las subidas del móvil más de lo necesario.
const pending = new Set();
let working = false;
function queueAnalysis(id) {
  pending.add(id);
  if (working) return;
  working = true;
  setTimeout(function next() {
    const nextId = pending.values().next().value;
    if (nextId === undefined) {
      working = false;
      return;
    }
    pending.delete(nextId);
    try {
      const r = analyzeTanda(nextId);
      log(
        "analizada",
        nextId,
        r.error
          ? "(" + r.error + ")"
          : (r.vueltas || []).filter((v) => v.valid).length + " vueltas",
      );
    } catch (e) {
      log("no se pudo analizar", nextId, e.message);
    }
    setTimeout(next, 50);
  }, 1500);
}

function summaryOf(id) {
  const dir = tandaDir(id);
  const meta = readJson(path.join(dir, "meta.json"));
  const stamp = stampOf(id);
  let resumen = readJson(path.join(dir, "resumen.json"));
  const fresh = isFresh(resumen, stamp);
  if (!fresh && stamp.trozos) queueAnalysis(id);
  return {
    id,
    meta: meta
      ? {
          inicio: meta.inicio,
          fin: meta.fin,
          estado: meta.estado,
          sim: meta.sim,
          piloto:
            typeof meta.piloto === "string" ? meta.piloto.slice(0, 30) : null,
          objetivo: Number.isFinite(meta.objetivo) ? meta.objetivo : null,
          sentido: meta.sentido,
          mejor: meta.mejor,
          vueltas: (meta.vueltas || []).length,
        }
      : null,
    trozos: stamp.trozos,
    bytes: stamp.bytes,
    resumen: fresh ? resumen : null,
    analizando: !fresh && stamp.trozos > 0,
  };
}

// ---------- http ----------
function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body === undefined ? "" : body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj));
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Lee el cuerpo hasta `max` bytes. Si se pasa, lo sigue leyendo sin guardarlo para poder contestar 413
// (cortar la conexión a medias lo vería el móvil como «sin red» y reintentaría siempre); con un envío
// desmesurado (4× el máximo) sí se corta.
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    let over = Number(req.headers["content-length"]) > max;
    req.on("data", (d) => {
      size += d.length;
      if (size > max) over = true;
      if (!over) parts.push(d);
      else if (size > 4 * max) {
        req.destroy();
        reject(httpError(413, "demasiado grande"));
      }
    });
    req.on("end", () => {
      if (over) reject(httpError(413, "demasiado grande"));
      else resolve(Buffer.concat(parts));
    });
    req.on("error", reject);
  });
}

async function readJsonBody(req, max) {
  let buf = await readBody(req, max);
  if (req.headers["x-gzip"] === "1") {
    try {
      buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_JSON });
    } catch (e) {
      throw httpError(
        e instanceof RangeError ? 413 : 400,
        "no se puede descomprimir",
      );
    }
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    throw httpError(400, "JSON no válido");
  }
}

async function receiveChunk(req, res, id, seq) {
  if (!F.ID_RE.test(id)) throw httpError(400, "id no válido");
  if (freeBytes() < MIN_LIBRE) throw httpError(507, "disco casi lleno");
  const obj = await readJsonBody(req, MAX_TROZO);
  const err = F.checkChunk(obj, id, seq);
  if (err) throw httpError(400, err);
  const dir = path.join(tandaDir(id), "trozos");
  fs.mkdirSync(dir, { recursive: true });
  const data = zlib.gzipSync(JSON.stringify(F.cleanChunk(obj)));
  writeAtomic(path.join(dir, String(seq).padStart(6, "0") + ".json.gz"), data);
  log(
    "tanda",
    id,
    "· trozo",
    seq,
    "(" + Math.round(data.length / 1024) + " KB)",
  );
  sendJson(res, 200, { ok: true });
}

async function receiveMeta(req, res, id) {
  if (!F.ID_RE.test(id)) throw httpError(400, "id no válido");
  const obj = await readJsonBody(req, MAX_META);
  const err = F.checkMeta(obj, id);
  if (err) throw httpError(400, err);
  fs.mkdirSync(tandaDir(id), { recursive: true });
  obj.recibido = new Date().toISOString();
  writeAtomic(
    path.join(tandaDir(id), "meta.json"),
    JSON.stringify(obj, null, 2) + "\n",
  );
  log("tanda", id, "· resumen (" + (obj.estado || "?") + ")");
  sendJson(res, 200, { ok: true });
}

// Muelle: lo que llega del móvil por el túnel.
async function dock(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGENES.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "authorization, content-type, x-gzip",
    );
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return send(res, 204);
  if (!authorized(req)) return sendJson(res, 401, { ok: false });
  const p = new URL(req.url, "http://muelle").pathname;
  if (req.method === "GET" && p === "/api/hola")
    return sendJson(res, 200, {
      ok: true,
      version: F.VERSION,
      tandas: listIds().length,
    });
  // Tiempos del último día rodado, para verlos en el móvil en boxes. Solo resúmenes (nombres, tiempos,
  // sectores y lo mejor de cada curva): ni grabaciones ni otros días.
  if (req.method === "GET" && p === "/api/dia") {
    const day = daysAvailable()[0];
    return sendJson(
      res,
      200,
      day ? computeDay(day) : { fecha: null, pilotos: [] },
    );
  }
  let m = /^\/api\/tandas\/([^/]+)\/trozos\/(\d{1,6})$/.exec(p);
  if (req.method === "PUT" && m)
    return receiveChunk(req, res, m[1], Number(m[2]));
  m = /^\/api\/tandas\/([^/]+)\/meta$/.exec(p);
  if (req.method === "PUT" && m) return receiveMeta(req, res, m[1]);
  sendJson(res, 404, { ok: false });
}

// ---------- túnel ----------
const tunnel = {
  url: null,
  estado: CON_TUNEL ? "abriendo" : "apagado",
  proc: null,
  intentos: 0,
};
let closing = false;

function findCloudflared() {
  for (const p of [
    process.env.CLOUDFLARED,
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
  ])
    if (p && fs.existsSync(p)) return p;
  try {
    return (
      execFileSync("/usr/bin/which", ["cloudflared"]).toString().trim() || null
    );
  } catch (e) {
    return null;
  }
}

function openTunnel() {
  const bin = findCloudflared();
  if (!bin) {
    tunnel.estado = "sin-cloudflared";
    log(
      "Falta cloudflared: instálalo con «brew install cloudflared» y vuelve a abrir el garaje.",
    );
    return;
  }
  tunnel.estado = "abriendo";
  tunnel.url = null;
  const p = spawn(
    bin,
    ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:" + PUERTO_MUELLE],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  tunnel.proc = p;
  const onData = (d) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
    if (m && !tunnel.url) {
      tunnel.url = m[0];
      tunnel.estado = "listo";
      tunnel.intentos = 0;
      log("Túnel abierto:", tunnel.url);
      log("Escanea con el móvil el código de la página del garaje.");
    }
  };
  p.stdout.on("data", onData);
  p.stderr.on("data", onData);
  p.on("error", () => {});
  p.on("exit", () => {
    tunnel.proc = null;
    tunnel.url = null;
    if (closing) return;
    tunnel.estado = "caido";
    tunnel.intentos++;
    const wait = Math.min(60000, 5000 * tunnel.intentos);
    log("El túnel se ha cerrado; lo vuelvo a abrir en", wait / 1000, "s.");
    setTimeout(openTunnel, wait);
  });
}

function pairingLink() {
  if (!tunnel.url) return null;
  const payload = Buffer.from(
    JSON.stringify({ u: tunnel.url, k: CFG.clave }),
  ).toString("base64url");
  return APP + "#garaje=" + payload;
}

// ---------- garaje (solo este Mac) ----------
const STATIC = {
  "/": [WEB, "index.html"],
  "/garaje.js": [WEB, "garaje.js"],
  "/analisis": [WEB, "analisis.html"],
  "/tel-app.js": [WEB, "tel-app.js"],
  "/lib/telemetry.js": [REPO, "telemetry.js"],
  "/lib/analysis.js": [REPO, "analysis.js"],
  "/lib/sim.js": [REPO, "sim.js"],
  "/lib/track-data.js": [REPO, "track-data.js"],
  "/lib/jszip.min.js": [REPO, "jszip.min.js"],
  "/lib/formato.js": [REPO, "formato.js"],
  "/lib/comparativa.js": [REPO, "comparativa.js"],
  "/icon.png": [REPO, "icon-192.png"],
};
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function garage(req, res) {
  // Solo por 127.0.0.1/localhost: una web de fuera no puede hacerse pasar por el garaje.
  const host = String(req.headers.host || "");
  if (host !== "127.0.0.1:" + PUERTO && host !== "localhost:" + PUERTO)
    return send(res, 403, "", "text/plain");
  const p = new URL(req.url, "http://garaje").pathname;
  if (req.method === "GET" && STATIC[p]) {
    const [dir, name] = STATIC[p];
    const file = path.join(dir, name);
    return send(
      res,
      200,
      fs.readFileSync(file),
      TYPES[path.extname(name)] || "application/octet-stream",
    );
  }
  if (req.method === "GET" && p === "/api/estado")
    return sendJson(res, 200, {
      datos: DATOS,
      tunel: tunnel.url,
      tunelEstado: tunnel.estado,
      enlace: pairingLink(),
      espacioLibre: freeBytes(),
    });
  if (req.method === "GET" && p === "/api/tandas")
    return sendJson(res, 200, { tandas: listIds().map(summaryOf) });
  if (req.method === "GET" && p === "/api/dia") {
    const days = daysAvailable();
    const asked = new URL(req.url, "http://garaje").searchParams.get("fecha");
    const day = days.includes(asked) ? asked : days[0];
    return sendJson(
      res,
      200,
      Object.assign(day ? computeDay(day) : { fecha: null, pilotos: [] }, {
        dias: days,
      }),
    );
  }
  let m = /^\/api\/tandas\/([^/]+)\/archivos$/.exec(p);
  if (req.method === "GET" && m) {
    if (!F.ID_RE.test(m[1])) throw httpError(400, "id no válido");
    const data = filesOf(m[1]);
    if (!data) throw httpError(404, "sin datos");
    const meta = readJson(path.join(tandaDir(m[1]), "meta.json"));
    return sendJson(res, 200, Object.assign({ meta }, data));
  }
  // Las acciones piden una cabecera propia: otra web abierta en este Mac no puede mandarla sin permiso CORS.
  if (req.method === "POST" && req.headers["x-garaje"] !== "1")
    return sendJson(res, 403, { ok: false });
  if (req.method === "POST" && p === "/api/clave-nueva") {
    rotateKey();
    return sendJson(res, 200, { ok: true });
  }
  m = /^\/api\/tandas\/([^/]+)\/finder$/.exec(p);
  if (req.method === "POST" && (m || p === "/api/finder")) {
    const target = m ? tandaDir(m[1]) : DATOS;
    if (m && !F.ID_RE.test(m[1])) throw httpError(400, "id no válido");
    spawn("open", m ? ["-R", target] : [target], { stdio: "ignore" }).on(
      "error",
      () => {},
    );
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { ok: false });
}

function handler(fn) {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        const status = e && e.status ? e.status : 500;
        if (status === 500) log("error:", e && e.stack ? e.stack : e);
        if (!res.headersSent && !res.destroyed)
          sendJson(res, status, { ok: false, error: e.message || "error" });
      });
  };
}

// ---------- arranque ----------
const dockServer = http.createServer(handler(dock));
const garageServer = http.createServer(handler(garage));

function shutdown() {
  if (closing) return;
  closing = true;
  if (tunnel.proc) tunnel.proc.kill();
  log("Garaje cerrado.");
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, shutdown);

garageServer.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    log("El garaje ya está abierto en otra ventana.");
    if (ABRIR_NAVEGADOR)
      spawn("open", ["http://127.0.0.1:" + PUERTO + "/"], { stdio: "ignore" });
    process.exit(0);
  }
  throw e;
});
dockServer.on("error", (e) => {
  log("No puedo abrir el puerto", PUERTO_MUELLE + ":", e.message);
  process.exit(1);
});

garageServer.listen(PUERTO, "127.0.0.1", () => {
  dockServer.listen(PUERTO_MUELLE, "127.0.0.1", () => {
    log("Garaje abierto. Tus tandas se guardan en", DATOS);
    log("Página del garaje: http://127.0.0.1:" + PUERTO + "/");
    log("Para cerrarlo: Ctrl+C o cierra esta ventana.");
    // El Mac no se duerme mientras el garaje esté abierto (enchufado y con la tapa abierta).
    spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], {
      stdio: "ignore",
    }).on("error", () => {});
    if (CON_TUNEL) openTunnel();
    if (ABRIR_NAVEGADOR)
      spawn("open", ["http://127.0.0.1:" + PUERTO + "/"], {
        stdio: "ignore",
      }).on("error", () => {});
    // Tandas que llegaron con el garaje cerrado o a medias: resumen al día.
    for (const id of listIds()) summaryOf(id);
  });
});
