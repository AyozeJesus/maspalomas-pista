// Vídeo con los datos encima, en el análisis del garaje: velocidad, tumbada, freno y gas, vuelta, diferencia con
// la mejor vuelta y mapa, sincronizados con la tanda. Un vídeo de GoPro trae su propio GPS y sensores (GPMF): se
// puede analizar como tanda (y guardar en el garaje) y entonces va sincronizado solo. Con otra cámara se marca
// a mano el cruce de meta de una vuelta. La vuelta se puede exportar con los datos encima.
import { extract, fileReader, toSession } from "../../app/src/core/gpmf";
import type { GoproSession, GpmfData } from "../../app/src/core/gpmf/types";
import type { AnalyzeResult, TelemetryLap } from "../../app/src/core/maspalomas/types";
import { el } from "./dom";
import type { VideoControl, VideoExport, VideoHooks } from "./tipos";
import { dataAt, type OverlayData } from "./video/datos";
import { drawOverlay, mapOf, type TrackMap } from "./video/dibujo";
import { fmt, fmtLap, fmtSigned } from "./video/formato";

export { dataAt, drawOverlay };
export type { OverlayData, TrackMap };

// Cómo se sincronizó el vídeo con la tanda: con la telemetría de la propia GoPro, por la hora de la GoPro y del
// móvil, o a mano.
type SyncKind = "gopro" | "utc" | "manual";

interface VideoState {
  // URL del vídeo elegido (createObjectURL).
  url: string | null;
  // Telemetría de la GoPro leída del vídeo, y la tanda que sale de ella.
  gopro: GpmfData | null;
  session: GoproSession | null;
  // s que hay que sumar a la hora del vídeo para tener la de la tanda (null: sin sincronizar).
  offset: number | null;
  kind: SyncKind | null;
  // El mapa del trazado y el análisis para el que se calculó.
  map: TrackMap | null;
  mapOf: AnalyzeResult | null;
  raf: number;
  exporting: boolean;
  last: OverlayData | null;
  lastExport?: VideoExport;
}

// El <video> con captureStream(), que lleva el sonido a la vuelta exportada: no lo tienen todos los navegadores (ni
// los tipos del DOM).
interface CapturableVideo extends HTMLVideoElement {
  captureStream?(): MediaStream;
}

// El contexto 2D de un canvas (uno nuevo siempre lo tiene).
function ctx2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("El canvas no tiene contexto 2D");
  return ctx;
}

// El mensaje de un error capturado (lo que se lanza aquí es siempre un Error).
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------- interfaz ----------
// hooks: result() (análisis actual), epoch() (inicio de la tanda del móvil en ms, o null), useSession(session,
// info) (analizar la telemetría de la GoPro como tanda), save(session, info, piloto) → Promise (guardarla en el
// garaje).
export function mount(container: HTMLElement, hooks: VideoHooks): VideoControl {
  container.textContent = "";
  const top = el("div", "row", null, container);
  const pick = el("label", "btn", "Elegir vídeo", top);
  const file = el("input", "", null, top);
  file.type = "file";
  file.accept = "video/*,.mp4,.mov,.webm";
  file.hidden = true;
  pick.htmlFor = file.id = "vid-file";
  const info = el("p", "caption", "El vídeo no se sube a ningún sitio: se lee en este Mac.", top);
  const gp = el("div", "vid-gopro", null, container);
  gp.hidden = true;
  const gpText = el("p", "", "", gp);
  const gpRow = el("div", "row", null, gp);
  const useBtn = el("button", "btn-primary", "Analizar con los datos de la GoPro", gpRow);
  useBtn.type = "button";
  const pilotLab = el("label", "caption", "Piloto ", gpRow);
  const pilot = el("input", "", null, pilotLab);
  pilot.type = "text";
  pilot.maxLength = 30;
  pilot.value = readPilot();
  const saveBtn = el("button", "", "Guardar en el garaje", gpRow);
  saveBtn.type = "button";
  const gpNote = el("p", "caption", "", gp);
  const stage = el("div", "vid-stage", null, container);
  stage.hidden = true;
  const video: CapturableVideo = el("video", "", null, stage);
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  const canvas = el("canvas", "vid-ov", null, stage);
  const sync = el("div", "row vid-sync", null, container);
  sync.hidden = true;
  const syncTxt = el("span", "caption", "", sync);
  const lapSel = el("select", "", null, sync);
  lapSel.setAttribute("aria-label", "Vuelta");
  const mark = el("button", "", "Aquí cruzo meta", sync);
  mark.type = "button";
  const nudges = [-1, -0.1, 0.1, 1].map((d) => {
    const b = el("button", "", (d > 0 ? "+" : "−") + fmt(Math.abs(d), d % 1 ? 1 : 0) + " s", sync);
    b.type = "button";
    b.dataset.d = String(d);
    return b;
  });
  const exp = el("div", "row vid-export", null, container);
  exp.hidden = true;
  const expSel = el("select", "", null, exp);
  expSel.setAttribute("aria-label", "Vuelta que exportar");
  const expBtn = el("button", "", "Exportar la vuelta con los datos", exp);
  expBtn.type = "button";
  const expMsg = el("span", "caption", "", exp);

  const st: VideoState = {
    url: null,
    gopro: null,
    session: null,
    offset: null,
    kind: null,
    map: null,
    mapOf: null,
    raf: 0,
    exporting: false,
    last: null,
  };

  function setInfo(t: string): void {
    info.textContent = t;
  }
  function laps(): TelemetryLap[] {
    const r = hooks.result();
    return r ? r.laps.filter((l) => l.valid) : [];
  }
  function fillLaps(): void {
    const list = laps();
    for (const sel of [lapSel, expSel]) {
      const prev = sel.value;
      sel.textContent = "";
      for (const l of list)
        el("option", "", "Vuelta " + l.num + " · " + fmtLap(l.time, 2), sel).value = String(l.num);
      if (list.some((l) => String(l.num) === prev)) sel.value = prev;
    }
  }
  function syncLabel(): void {
    syncTxt.textContent =
      st.offset === null
        ? "Sin sincronizar: pon el vídeo en el momento de cruzar meta y elige esa vuelta."
        : (st.kind === "gopro"
            ? "Sincronizado con la telemetría de la GoPro."
            : st.kind === "utc"
              ? "Sincronizado por la hora de la GoPro y del móvil."
              : "Sincronizado a mano.") +
          " Desfase " +
          fmtSigned(st.offset, 1) +
          " s.";
    exp.hidden = st.offset === null || !laps().length;
  }
  // Hora de la tanda que corresponde al vídeo ahora.
  function current(): OverlayData | null {
    if (st.offset === null) return null;
    const r = hooks.result();
    if (!r) return null;
    if (st.mapOf !== r) {
      st.map = mapOf(r);
      st.mapOf = r;
    }
    return dataAt(r, video.currentTime + st.offset);
  }
  function redraw(): void {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = ctx2d(canvas);
    ctx.clearRect(0, 0, w, h);
    const d = current();
    st.last = d;
    drawOverlay(ctx, w, h, d, st.map);
  }
  function loop(): void {
    redraw();
    st.raf = video.paused || video.ended ? 0 : requestAnimationFrame(loop);
  }
  video.addEventListener("play", () => {
    if (!st.raf) st.raf = requestAnimationFrame(loop);
  });
  for (const ev of ["seeked", "loadeddata", "pause", "timeupdate"])
    video.addEventListener(ev, redraw);
  video.addEventListener("error", () => {
    setInfo(
      st.gopro
        ? "Este navegador no puede reproducir el vídeo (formato), pero sus datos sí se han leído."
        : "Este navegador no puede reproducir este vídeo.",
    );
  });

  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (!f) return;
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(f);
    st.gopro = null;
    st.session = null;
    st.offset = null;
    st.kind = null;
    gp.hidden = true;
    stage.hidden = false;
    sync.hidden = false;
    video.src = st.url;
    setInfo(f.name + " · leyendo si trae datos de GoPro…");
    fillLaps();
    syncLabel();
    // ¿Trae telemetría de GoPro?
    if (/\.(mp4|mov|lrv)$/i.test(f.name)) {
      try {
        const data = await extract(fileReader(f));
        st.gopro = data;
        st.session = toSession(data);
        const hz =
          data.gps.t.length / Math.max(1, data.gps.t[data.gps.t.length - 1] - data.gps.t[0]);
        gpText.textContent =
          "Este vídeo trae GPS y sensores de " +
          (data.camera || "GoPro") +
          ": " +
          fmt(hz, 0) +
          " posiciones por segundo durante " +
          fmtLap(data.duration, 0) +
          ".";
        gp.hidden = false;
        gpNote.textContent = "";
        // Si la tanda abierta es del móvil, se sincroniza por la hora (la GoPro la toma del GPS).
        const ep = hooks.epoch();
        if (ep && st.session.startUtc) {
          st.offset = (st.session.startUtc - ep) / 1000;
          st.kind = "utc";
        }
        setInfo(f.name);
      } catch (e) {
        const msg = messageOf(e);
        setInfo(f.name + (/GPS|GoPro|GPMF/.test(msg) && !/MP4/.test(msg) ? " · " + msg : ""));
      }
    } else setInfo(f.name);
    syncLabel();
  });
  useBtn.addEventListener("click", () => {
    if (!st.session) return;
    hooks.useSession(st.session, st.gopro);
    st.offset = 0;
    st.kind = "gopro";
    syncLabel();
  });
  saveBtn.addEventListener("click", async () => {
    if (!st.session) return;
    writePilot(pilot.value.trim());
    saveBtn.disabled = true;
    gpNote.textContent = "Guardando en el garaje…";
    try {
      const id = await hooks.save(st.session, st.gopro, pilot.value.trim());
      gpNote.textContent =
        "Guardada en el garaje como tanda " +
        id +
        ": sale en la lista, el progreso y las comparativas.";
    } catch (e) {
      gpNote.textContent = "No se ha podido guardar: " + messageOf(e);
    } finally {
      saveBtn.disabled = false;
    }
  });
  mark.addEventListener("click", () => {
    const l = laps().find((x) => String(x.num) === lapSel.value);
    if (!l) return;
    st.offset = l.t0 - video.currentTime;
    st.kind = "manual";
    syncLabel();
    redraw();
  });
  for (const b of nudges)
    b.addEventListener("click", () => {
      if (st.offset === null) return;
      st.offset += Number(b.dataset.d);
      if (st.kind !== "manual") st.kind = "manual";
      syncLabel();
      redraw();
    });
  expBtn.addEventListener("click", () => {
    const l = laps().find((x) => String(x.num) === expSel.value);
    if (l) exportLap(l);
  });

  // Exporta un tramo del vídeo (la vuelta) con los datos dibujados encima, en tiempo real.
  async function exportLap(l: TelemetryLap): Promise<void> {
    if (st.exporting || st.offset === null) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      expMsg.textContent = "Este navegador no puede grabar vídeo.";
      return;
    }
    const start = Math.max(0, l.t0 - st.offset);
    const end = Math.min(video.duration || 0, l.t0 + l.time - st.offset);
    if (!(end - start > 0.5)) {
      expMsg.textContent = "Esa vuelta no está en el vídeo (revisa la sincronización).";
      return;
    }
    st.exporting = true;
    expBtn.disabled = true;
    let rec: MediaRecorder | null = null;
    // Pase lo que pase (el vídeo no se deja reproducir, se para a mitad, falla la grabadora), el botón vuelve a valer.
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const w = Math.min(1920, vw);
      const h = Math.round((w * vh) / vw / 2) * 2;
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = ctx2d(cv);
      const stream = cv.captureStream(30);
      try {
        const vs = video.captureStream ? video.captureStream() : null;
        if (vs) for (const tr of vs.getAudioTracks()) stream.addTrack(tr);
      } catch {
        /* sin sonido */
      }
      const types = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined,
      );
      rec = recorder;
      const parts: Blob[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) parts.push(ev.data);
      };
      const done = new Promise((res) => (recorder.onstop = res));
      video.pause();
      video.currentTime = start;
      await seeked();
      recorder.start(1000);
      await video.play();
      const fin = await recordUntil(end, () => {
        ctx.drawImage(video, 0, 0, w, h);
        drawOverlay(ctx, w, h, current(), st.map);
        expMsg.textContent =
          "Grabando… " +
          Math.round(((video.currentTime - start) / (end - start)) * 100) +
          " % (se graba en tiempo real: no cambies de pestaña hasta que acabe)";
      });
      video.pause();
      recorder.stop();
      await done;
      if (!fin) {
        expMsg.textContent =
          "Exportación cortada: el vídeo se paró antes de acabar la vuelta. Vuelve a pulsar «Exportar» y deja que llegue al final.";
        return;
      }
      const type = (mime || "video/webm").split(";")[0];
      const blob = new Blob(parts, { type });
      // Un solo enlace: el de la exportación anterior se quita y su vídeo se libera de la memoria.
      for (const old of exp.querySelectorAll("a[download]")) {
        URL.revokeObjectURL((old as HTMLAnchorElement).href);
        old.remove();
      }
      const a = el("a", "", "", exp);
      a.href = URL.createObjectURL(blob);
      a.download = "vuelta-" + l.num + (type === "video/mp4" ? ".mp4" : ".webm");
      a.textContent = "Descargar «" + a.download + "» (" + fmt(blob.size / 1048576, 1) + " MB)";
      expMsg.textContent = "Listo.";
      st.lastExport = { size: blob.size, type, name: a.download };
    } catch (e) {
      // El detalle, a la consola; al piloto, qué hacer.
      console.warn("No se ha podido exportar la vuelta", e);
      if (rec && rec.state !== "inactive") rec.stop();
      video.pause();
      expMsg.textContent =
        "No se ha podido grabar la vuelta: el navegador no ha dejado reproducir o grabar el vídeo. Prueba otra vez (si sigue, con Chrome).";
    } finally {
      st.exporting = false;
      expBtn.disabled = false;
    }
  }

  // Espera a que el vídeo acabe de colocarse donde se le ha pedido (10 s como mucho: si no, no se deja).
  function seeked(): Promise<void> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        video.removeEventListener("seeked", ok);
        rej(new Error("el vídeo no se coloca en el principio de la vuelta"));
      }, 10000);
      const ok = () => {
        clearTimeout(timer);
        res();
      };
      video.addEventListener("seeked", ok, { once: true });
    });
  }

  // Dibuja cada fotograma (frame) hasta que el vídeo llega a `end`: true. false si se para antes (a mano, otro vídeo
  // o un error del vídeo), en vez de esperar para siempre; y si dibujar falla, el error.
  function recordUntil(end: number, frame: () => void): Promise<boolean> {
    return new Promise((res, rej) => {
      let over = false;
      const stop = () => {
        over = true;
        for (const ev of ["pause", "error", "emptied"]) video.removeEventListener(ev, cut);
      };
      const finish = (ok: boolean) => {
        if (over) return;
        stop();
        res(ok);
      };
      // Al acabar el archivo el navegador también avisa «pause»: eso no es cortar.
      const cut = () => finish(video.ended || video.currentTime >= end - 0.05);
      for (const ev of ["pause", "error", "emptied"]) video.addEventListener(ev, cut);
      const step = () => {
        if (over) return;
        try {
          frame();
        } catch (e) {
          stop();
          rej(e);
          return;
        }
        if (video.currentTime >= end || video.ended) finish(true);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  return {
    // La tanda ha cambiado (otra meta, otra tanda): se rellenan las vueltas y se redibuja.
    refresh() {
      fillLaps();
      syncLabel();
      redraw();
    },
    // Otra tanda cargada: la sincronización anterior ya no vale.
    resetSync() {
      st.offset = null;
      st.kind = null;
      syncLabel();
      redraw();
    },
    // Para pruebas.
    state: () => ({
      offset: st.offset,
      kind: st.kind,
      gopro: !!st.gopro,
      last: st.last,
      lastExport: st.lastExport || null,
    }),
  };
}
function readPilot(): string {
  try {
    return localStorage.getItem("maspa-garaje-piloto") || "";
  } catch {
    return "";
  }
}
function writePilot(v: string): void {
  try {
    localStorage.setItem("maspa-garaje-piloto", v);
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}
