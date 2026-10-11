// El vídeo con datos (video.ts) en la página del análisis: dibuja la tanda en pantalla encima del vídeo, y la
// telemetría de un vídeo de GoPro puede pasar a ser la tanda analizada o guardarse en el garaje como una más.
import type { GoproSession, GpmfData, ImuSeries } from "../../../app/src/core/gpmf/types";
import { mount } from "../video";
import { runAnalysis } from "./analizar";
import { state } from "./estado";

export function mountVideo(): void {
  const box = document.getElementById("vid");
  if (!box) return;
  state.videoCtl = mount(box, {
    result: () => state.result,
    epoch: () => state.epoch || null,
    // La telemetría del vídeo pasa a ser la tanda analizada (y el vídeo queda sincronizado con ella).
    useSession(session, info) {
      state.session = session;
      state.source = "gopro";
      state.tandaId = null;
      state.epoch = session.startUtc || null;
      state.extRefs = {};
      state.fileName =
        "Vídeo de " +
        ((info && info.camera) || "GoPro") +
        (session.startUtc
          ? " del " +
            new Date(session.startUtc).toLocaleString("es-ES", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "");
      runAnalysis();
    },
    save: saveGoPro,
  });
  // Acceso para pruebas automáticas (no afecta al uso normal).
  window.MaspaGarajeVideo = state.videoCtl;
}

// Guarda la telemetría de un vídeo de GoPro en el garaje, en trozos de 60 s como los del móvil.
async function saveGoPro(
  session: GoproSession,
  info: GpmfData | null,
  piloto: string,
): Promise<string> {
  const epoch = session.startUtc || Date.now();
  const d = new Date(epoch);
  const p2 = (x: number) => String(x).padStart(2, "0");
  const id =
    d.getFullYear() +
    p2(d.getMonth() + 1) +
    p2(d.getDate()) +
    "-" +
    p2(d.getHours()) +
    p2(d.getMinutes()) +
    p2(d.getSeconds()) +
    "-" +
    Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "X-Garaje": "1", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = "el garaje ha respondido " + r.status;
      try {
        msg = ((await r.json()) as { error?: string }).error || msg;
      } catch {
        /* sin detalle */
      }
      throw new Error(msg);
    }
  };
  // Las series que se guardan con sus columnas, en el orden de las del móvil (sin el rumbo; las que el vídeo no trae,
  // sin nada).
  const xyz = (s: ImuSeries | undefined) => s && { t: s.t, x: s.x, y: s.y, z: s.z };
  const loc = session.loc;
  const cols: Record<string, Record<string, Float64Array> | undefined> = {
    loc: { t: loc.t, lat: loc.lat, lon: loc.lon, speed: loc.speed, hacc: loc.hacc },
    acc: xyz(session.acc),
    gyro: xyz(session.gyro),
    grav: xyz(session.grav),
  };
  const tEnd = session.loc.t[session.loc.t.length - 1];
  let seq = 0;
  for (let a = Math.floor(session.loc.t[0]); a <= tEnd; a += 60) {
    const series: Record<string, Record<string, (number | null)[]>> = {};
    for (const key in cols) {
      const s = cols[key];
      if (!s) continue;
      const idx: number[] = [];
      for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] < a + 60) idx.push(i);
      if (!idx.length) continue;
      const o: Record<string, (number | null)[]> = {};
      for (const c in s)
        o[c] = idx.map((i) => {
          const v = s[c][i];
          return Number.isFinite(v) ? v : null;
        });
      series[key] = o;
    }
    if (!Object.keys(series).length) continue;
    await post("/api/importar/" + id + "/trozos/" + seq, {
      v: 1,
      id,
      seq,
      epoch,
      series,
    });
    seq++;
  }
  await post("/api/importar/" + id + "/meta", {
    v: 1,
    id,
    epoch,
    inicio: new Date(epoch).toISOString(),
    fin: new Date(epoch + tEnd * 1000).toISOString(),
    estado: "terminada",
    sim: false,
    tipo: "pista",
    fuente: "gopro",
    camara: (info && info.camera) || null,
    piloto: piloto || null,
    objetivo: state.target,
    meta: { osm: state.finish.osm, rev: state.finish.rev },
    vueltas: [],
  });
  return id;
}
