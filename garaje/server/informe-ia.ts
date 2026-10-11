// Informe con IA (Anthropic) de una tanda de circuito.
// La clave de la API va en ia.json (solo legible por tu usuario; aparte de config.json, que «Cambiar la clave»
// reescribe) o en la variable de entorno ANTHROPIC_API_KEY, y nunca sale de este Mac salvo hacia Anthropic. A la IA
// solo le llegan métricas de la tanda: ni posiciones ni el nombre del piloto.
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { analyze, coach, sessionFromCsv } from "../../app/src/core/maspalomas";
import type { IaEstado, Informe } from "../api";
import { isNum, readObject, writeAtomic } from "./archivos";
import { DATOS } from "./config";
import { httpError, type HttpError } from "./http";
import { log } from "./log";
import { filesOf, finishOf, readMeta, stampOf, tandaDir } from "./tandas";

const IA_FILE = join(DATOS, "ia.json");
const IA_URL = process.env.MASPA_IA_URL || "https://api.anthropic.com/v1/messages";
const IA_MODELO = "claude-opus-5-5";
const IA_TIEMPO_MS = Number(process.env.MASPA_IA_TIEMPO_MS) || 120000;
const IA_CLAVE_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

interface IaFile {
  clave?: unknown;
  modelo?: unknown;
}

interface IaConfig {
  key: string | null;
  from: IaEstado["desde"];
  model: string;
}

function iaConfig(): IaConfig {
  const file = readObject<IaFile>(IA_FILE) || {};
  const env = process.env.ANTHROPIC_API_KEY;
  const fileKey = typeof file.clave === "string" ? file.clave : null;
  return {
    key: env || fileKey,
    from: env ? "entorno" : fileKey ? "archivo" : null,
    model:
      process.env.MASPA_IA_MODELO || (typeof file.modelo === "string" && file.modelo) || IA_MODELO,
  };
}

// Lo que se enseña de la configuración (la clave nunca).
export function iaEstado(): IaEstado {
  const c = iaConfig();
  return { configurada: !!c.key, desde: c.from, modelo: c.model };
}

// Guarda la clave (o la borra con null o vacía).
export function iaSaveKey(clave: string | null): void {
  if (clave === null || clave === "") {
    try {
      unlinkSync(IA_FILE);
    } catch {
      /* no había */
    }
    return;
  }
  if (!IA_CLAVE_RE.test(clave))
    throw httpError(
      400,
      "Esa no parece una clave de la API de Anthropic: empieza por «sk-ant-». Cópiala entera de console.anthropic.com.",
    );
  const file = readObject<IaFile>(IA_FILE) || {};
  writeAtomic(IA_FILE, JSON.stringify(Object.assign(file, { clave }), null, 2) + "\n", 0o600);
}

const r1 = (x: number | null | undefined) => (isNum(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x: number | null | undefined) => (isNum(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x: number | null | undefined) => (isNum(x) ? Math.round(x * 1000) / 1000 : null);

// Lo que se le cuenta a la IA de una tanda de circuito: vueltas, sectores y curvas, lo que pierde la mejor vuelta
// frente al objetivo (con el porqué que ya calcula el entrenador), regularidad y frenadas.
function informeDatos(id: string) {
  const meta = readMeta(id) || {};
  if (meta.tipo === "ruta") throw httpError(400, "El informe es para tandas de circuito.");
  const data = filesOf(id);
  if (!data) throw httpError(404, "Esta tanda aún no tiene datos.");
  const session = sessionFromCsv(data.files);
  const objetivo = isNum(meta.objetivo) ? meta.objetivo : 65;
  const a = analyze(session, { finish: finishOf(meta), target: objetivo });
  const sinVuelta = "Hace falta al menos una vuelta completa para el informe.";
  if (!a.laps.some((l) => l.valid)) throw httpError(400, sinVuelta);
  const o = coach(a, { ref: "objetivo" });
  const best = coach(a, { ref: "mejor" });
  if (!o || !best) throw httpError(400, sinVuelta);
  const rec = meta.recorrido;
  const frenadas = rec
    ? {
        frenadas: rec.frenadas,
        frenada_max_g: r2(rec.frenadaMax),
        mordida_mejor_s: r2(rec.mordidaMejor),
        hundimiento_max_grados: r1(rec.hundimientoMax),
        frenando_tumbado_max_m: rec.frenadaTumbadoMax || null,
      }
    : null;
  return {
    circuito: {
      nombre: "Maspalomas",
      longitud_m: Math.round(a.track ? a.track.L : 2270),
      sentido: a.dir === "osm" ? "antihorario" : "horario",
    },
    fecha: meta.inicio ? String(meta.inicio).slice(0, 10) : null,
    objetivo_s: objetivo,
    gps: {
      posiciones_por_segundo: r1(a.gpsHz),
      receptor: meta.gps ? meta.gps.fuente : "GPS del móvil",
    },
    mejor_vuelta_s: r3(a.best ? a.best.time : null),
    vuelta_ideal: { s: r3(o.ideal.show), de: o.ideal.kind },
    vueltas: a.laps.map((l) => ({
      num: l.num,
      tiempo_s: r3(l.time),
      completa: l.valid,
      sectores_s: (l.sectors || []).map(r3),
      punta_kmh: r1(l.vMax),
      tumbada_max_grados: r1(l.leanMax),
      curvas: (l.corners || []).map((c) =>
        c
          ? {
              curva: c.num,
              nombre: c.name,
              frena_antes_del_vertice_m: r1(c.brakeBefore),
              frenada_max_g: r2(c.peakG),
              velocidad_min_kmh: r1(c.vMin),
              sin_gas_s: r2(c.dead),
              gas_a_fondo_tras_el_vertice_m: r1(c.fullAfter),
              velocidad_salida_kmh: r1(c.vExit),
              tumbada_max_grados: r1(c.leanMax),
            }
          : null,
      ),
    })),
    mejor_frente_al_objetivo: {
      objetivo_modelo_s: r3(o.refTime),
      vuelta: o.lap ? o.lap.num : null,
      por_curva: o.lap
        ? o.lap.corners.map((c) => ({
            curva: c.num,
            nombre: c.name,
            pierde_s: r2(c.loss),
            fases: c.phases.map((p) => ({
              fase: p.phase,
              pierde_s: r2(p.loss),
              por_que: p.why,
            })),
          }))
        : [],
      plan_del_entrenador: o.plan.map((p) => p.text),
    },
    regularidad_por_curva: (best.consistency || []).map((x) => ({
      curva: x.num,
      nombre: x.name,
      desviacion_s: r2(x.sd),
    })),
    frenadas,
  };
}

const IA_SISTEMA = [
  "Eres ingeniero de pista y entrenador de motociclismo. Escribes en castellano de España, claro y directo, para un",
  "piloto aficionado que rueda en el circuito de Maspalomas (Gran Canaria) y quiere bajar su tiempo por vuelta.",
  "Te paso en JSON la telemetría de una tanda medida con el móvil en la moto (o un receptor GPS): vueltas, sectores,",
  "métricas por curva, lo que pierde la mejor vuelta frente a un objetivo del modelo y el porqué, regularidad y",
  "frenadas. Básate solo en esos datos y cita números concretos; si algo no se puede saber con ellos, dilo. No",
  "inventes curvas, marchas ni reglajes. Ten en cuenta los límites: el GPS del móvil va a 1 posición por segundo",
  "(metros de error) y el móvil mide la deceleración total, no la presión de la maneta.",
  "",
  "Formato (Markdown sencillo, unas 350-450 palabras):",
  "## La tanda — 3 o 4 frases: ritmo, mejor vuelta, ideal y distancia al objetivo.",
  "## Dónde se va el tiempo — las 2 o 3 curvas que más pierden, con fase y porqué.",
  "## Para la próxima tanda — 3 cosas concretas y medibles, por orden de lo que dan.",
  "## Lo que ya va bien — 1 o 2 cosas.",
  "## Regularidad — qué curva varía más y qué hacer.",
  "Nada de pedir riesgos: mejoras progresivas, y la referencia de frenada es la pista, nunca la pantalla.",
].join("\n");

// Lo que contesta la API de Anthropic (solo lo que se usa).
interface IaRespuesta {
  error?: { message?: unknown };
  content?: { type?: string; text?: string }[];
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}

// Mensaje para el piloto según lo que conteste Anthropic (sin códigos ni nombres internos).
function iaError(status: number, body: IaRespuesta): HttpError {
  const msg = String((body && body.error && body.error.message) || "");
  if (status === 401 || status === 403)
    return httpError(
      400,
      "Anthropic no acepta la clave de la API: revisa que la copiaste entera (empieza por «sk-ant-»).",
    );
  if (/credit|balance|billing/i.test(msg))
    return httpError(
      400,
      "Tu cuenta de Anthropic no tiene saldo: añade crédito en console.anthropic.com y vuelve a pedirlo.",
    );
  if (status === 404 || /model/i.test(msg))
    return httpError(
      400,
      "El modelo de IA configurado no está disponible para tu cuenta de Anthropic.",
    );
  if (status === 429)
    return httpError(
      503,
      "Has llegado al límite de uso de tu cuenta de Anthropic: espera un poco y vuelve a pedirlo.",
    );
  if (status >= 500)
    return httpError(503, "Anthropic está saturado ahora mismo: prueba otra vez en unos minutos.");
  return httpError(502, "Anthropic no ha podido hacer el informe: prueba otra vez.");
}

function huella(id: string): string {
  const s = stampOf(id);
  return s.trozos + "/" + s.bytes + "/" + s.meta.length;
}

async function pedirInforme(id: string): Promise<Informe> {
  const cfg = iaConfig();
  if (!cfg.key)
    throw httpError(
      400,
      "Falta la clave de la API de Anthropic: pégala arriba (la sacas en console.anthropic.com).",
    );
  const datos = informeDatos(id);
  const stamp = huella(id);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), IA_TIEMPO_MS);
  let r: Response;
  let body: IaRespuesta;
  try {
    r = await fetch(IA_URL, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "x-api-key": cfg.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 2000,
        system: IA_SISTEMA,
        messages: [
          {
            role: "user",
            content:
              "Telemetría de la tanda (JSON):\n" +
              JSON.stringify(datos) +
              "\n\nEscribe el informe.",
          },
        ],
      }),
    });
    body = (await r.json().catch(() => ({}))) as IaRespuesta;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      throw httpError(
        504,
        "Anthropic no ha contestado en " + Math.round(IA_TIEMPO_MS / 1000) + " s: prueba otra vez.",
      );
    throw httpError(503, "Sin conexión con Anthropic: ¿tiene internet este Mac?");
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw iaError(r.status, body);
  const texto = (body.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!texto) throw httpError(502, "La IA ha devuelto un informe vacío: prueba otra vez.");
  const out: Informe = {
    texto,
    modelo: body.model || cfg.model,
    creado: new Date().toISOString(),
    uso: body.usage ? { entrada: body.usage.input_tokens, salida: body.usage.output_tokens } : null,
    cortado: body.stop_reason === "max_tokens",
    huella: stamp,
  };
  writeAtomic(join(tandaDir(id), "informe.json"), JSON.stringify(out, null, 2) + "\n");
  log("tanda", id, "· informe de la IA (" + out.modelo + ")");
  return out;
}

// El último informe de la tanda, avisando si la tanda ha recibido datos después.
export function informeGuardado(id: string): Informe | null {
  const inf = readObject<Informe>(join(tandaDir(id), "informe.json"));
  if (!inf) return null;
  return Object.assign({}, inf, { viejo: inf.huella !== huella(id) });
}

// Una sola petición a la vez por tanda: un segundo toque espera a la misma.
const iaEnCurso = new Map<string, Promise<Informe>>();

export function informe(id: string): Promise<Informe> {
  if (!existsSync(tandaDir(id))) throw httpError(404, "Esa tanda no está en el garaje.");
  let job = iaEnCurso.get(id);
  if (!job) {
    job = pedirInforme(id).finally(() => iaEnCurso.delete(id));
    iaEnCurso.set(id, job);
  }
  return job;
}
