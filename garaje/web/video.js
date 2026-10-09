// Vídeo con los datos encima, en el análisis del garaje: velocidad, tumbada, freno y gas, vuelta, diferencia con
// la mejor vuelta y mapa, sincronizados con la tanda. Un vídeo de GoPro trae su propio GPS y sensores (GPMF): se
// puede analizar como tanda (y guardar en el garaje) y entonces va sincronizado solo. Con otra cámara se marca
// a mano el cruce de meta de una vuelta. La vuelta se puede exportar con los datos encima.
(function (root) {
  "use strict";
  const G = 9.80665;
  const NF = [0, 1, 2].map(
    (d) =>
      new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }),
  );
  const fmt = (x, d) => (isFinite(x) ? NF[d].format(x) : "—");
  const fmtSigned = (x, d) =>
    isFinite(x) ? (x < 0 ? "−" : "+") + NF[d].format(Math.abs(x)) : "—";
  function fmtLap(t, d) {
    if (!isFinite(t)) return "—";
    const dec = d === undefined ? 1 : d;
    const f = Math.pow(10, dec);
    const tt = Math.floor(t * f) / f;
    const m = Math.floor(tt / 60);
    const s = tt - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + fmt(s, dec);
  }
  function el(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- datos de la tanda en un instante ----------
  function interp(ts, vs, t) {
    const n = ts.length;
    if (!n) return NaN;
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
    return vs[lo] + (vs[hi] - vs[lo]) * f;
  }
  // Tiempo con el que una rejilla de vuelta pasa por la distancia s (desde meta).
  function gridTimeAt(grid, s) {
    const n = grid.s.length;
    const step = grid.s[1] - grid.s[0];
    const x = Math.max(0, Math.min(n - 1, s / step));
    const i = Math.min(n - 2, Math.floor(x));
    return grid.t[i] + (grid.t[i + 1] - grid.t[i]) * (x - i) - grid.t[0];
  }
  // t: segundos de la tanda. Devuelve null fuera de la grabación.
  function dataAt(res, t) {
    const tl = res && res.timeline;
    if (!tl || !tl.t.length || t < tl.t[0] || t > tl.t[tl.t.length - 1])
      return null;
    const L = res.track.L;
    const out = {
      t,
      v: interp(tl.t, tl.v, t),
      a: interp(tl.t, tl.a, t) / G,
      lean: interp(tl.t, tl.lean, t),
      s: NaN,
      lap: null,
      lapT: NaN,
      delta: NaN,
    };
    const s = interp(tl.t, tl.s, t);
    if (isFinite(s)) out.s = s - Math.floor(s / L) * L;
    for (const l of res.laps)
      if (t >= l.t0 && t < l.t0 + l.time) {
        out.lap = l;
        break;
      }
    if (out.lap) {
      out.lapT = t - out.lap.t0;
      if (res.best && out.lap !== res.best && isFinite(out.s))
        out.delta = out.lapT - gridTimeAt(res.best.grid, out.s);
    }
    return out;
  }

  // ---------- dibujo ----------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Mapa del trazado (escala y centro calculados una vez por tanda).
  function mapOf(res) {
    const C = res.track.C;
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
    return {
      C,
      cs: res.track.cs,
      L: res.track.L,
      x0,
      y0,
      w: x1 - x0,
      h: y1 - y0,
    };
  }
  function pointOn(m, s) {
    const n = m.C.length;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (m.cs[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = m.C[lo % n];
    const b = m.C[(lo + 1) % n];
    const f = (s - m.cs[lo]) / (m.cs[lo + 1] - m.cs[lo] || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  // Los datos encima del vídeo, a escala del alto del cuadro.
  function drawOverlay(ctx, W, H, d, map) {
    if (!d) return;
    const u = H / 100;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    // Arriba a la izquierda: vuelta y diferencia con la mejor.
    if (d.lap) {
      roundRect(
        ctx,
        2 * u,
        2 * u,
        34 * u,
        isFinite(d.delta) ? 17 * u : 10 * u,
        1.5 * u,
      );
      ctx.fillStyle = "rgba(8, 11, 14, 0.62)";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 " + 3.4 * u + "px system-ui, sans-serif";
      ctx.fillText("Vuelta " + d.lap.num, 4 * u, 6.6 * u);
      ctx.font = "800 " + 4.6 * u + "px ui-monospace, Menlo, monospace";
      ctx.fillText(fmtLap(d.lapT, 1), 4 * u, 11.2 * u);
      if (isFinite(d.delta)) {
        ctx.fillStyle =
          d.delta > 0.02 ? "#ff8f84" : d.delta < -0.02 ? "#6df29b" : "#fff";
        ctx.font = "800 " + 4.6 * u + "px ui-monospace, Menlo, monospace";
        ctx.fillText(fmtSigned(d.delta, 2) + " s", 4 * u, 17 * u);
      }
    }
    // Abajo a la izquierda: velocidad, tumbada y g.
    const bx = 2 * u;
    // Por encima de la franja de abajo, donde el reproductor pone sus controles.
    const by = H - 36 * u;
    roundRect(ctx, bx, by, 38 * u, 24 * u, 1.5 * u);
    ctx.fillStyle = "rgba(8, 11, 14, 0.62)";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "800 " + 9 * u + "px system-ui, sans-serif";
    const vTxt = fmt(d.v * 3.6, 0);
    ctx.fillText(vTxt, bx + 2 * u, by + 10 * u);
    const vW = ctx.measureText(vTxt).width;
    ctx.font = "700 " + 3 * u + "px system-ui, sans-serif";
    ctx.fillText("km/h", bx + 2 * u + vW + 1.5 * u, by + 10 * u);
    // Tumbada: la moto como una barra que se inclina.
    const cx = bx + 30 * u;
    const cy = by + 11 * u;
    const lr = ((isFinite(d.lean) ? d.lean : 0) * Math.PI) / 180;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 0.4 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 * u, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(lr) * 6 * u, cy - Math.cos(lr) * 6 * u);
    ctx.stroke();
    ctx.font = "700 " + 3 * u + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      fmt(Math.abs(d.lean), 0) +
        "°" +
        (Math.abs(d.lean) < 3 ? "" : d.lean > 0 ? " der." : " izq."),
      cx,
      cy + 4.5 * u,
    );
    ctx.textAlign = "left";
    // Freno (rojo) y gas (verde) en g.
    const gy = by + 18 * u;
    const gw = 34 * u;
    const mid = bx + 2 * u + gw * 0.55;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(bx + 2 * u, gy, gw, 2.4 * u);
    if (isFinite(d.a)) {
      const ga = Math.max(-1.3, Math.min(0.8, d.a));
      ctx.fillStyle = ga < 0 ? "#ff6b5e" : "#4fdc8a";
      const len = ga < 0 ? (gw * 0.55 * -ga) / 1.3 : (gw * 0.45 * ga) / 0.8;
      ctx.fillRect(ga < 0 ? mid - len : mid, gy, len, 2.4 * u);
      ctx.fillStyle = "#fff";
      ctx.font = "700 " + 2.6 * u + "px ui-monospace, Menlo, monospace";
      ctx.fillText(fmtSigned(d.a, 2) + " g", bx + 2 * u, gy + 5.4 * u);
    }
    // Arriba a la derecha: el mapa con la posición.
    if (map) {
      const mw = 24 * u;
      const sc = Math.min(mw / map.w, mw / map.h);
      const ox = W - 2 * u - map.w * sc;
      const oy = 2 * u;
      roundRect(
        ctx,
        ox - 1.5 * u,
        oy - 1.5 * u,
        map.w * sc + 3 * u,
        map.h * sc + 3 * u,
        1.5 * u,
      );
      ctx.fillStyle = "rgba(8, 11, 14, 0.5)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 0.5 * u;
      ctx.beginPath();
      map.C.forEach(([x, y], i) => {
        const px = ox + (x - map.x0) * sc;
        const py = oy + (y - map.y0) * sc;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      if (isFinite(d.s)) {
        const p = pointOn(map, d.s);
        ctx.fillStyle = "#2b80dd";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 0.4 * u;
        ctx.beginPath();
        ctx.arc(
          ox + (p[0] - map.x0) * sc,
          oy + (p[1] - map.y0) * sc,
          1.3 * u,
          0,
          2 * Math.PI,
        );
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- interfaz ----------
  // hooks: result() (análisis actual), epoch() (inicio de la tanda del móvil en ms, o null), useSession(session,
  // info) (analizar la telemetría de la GoPro como tanda), save(session, info, piloto) → Promise (guardarla en el
  // garaje).
  function mount(container, hooks) {
    container.textContent = "";
    const top = el("div", "row", null, container);
    const pick = el("label", "btn", "Elegir vídeo", top);
    const file = el("input", "", null, top);
    file.type = "file";
    file.accept = "video/*,.mp4,.mov,.webm";
    file.hidden = true;
    pick.htmlFor = file.id = "vid-file";
    const info = el(
      "p",
      "caption",
      "El vídeo no se sube a ningún sitio: se lee en este Mac.",
      top,
    );
    const gp = el("div", "vid-gopro", null, container);
    gp.hidden = true;
    const gpText = el("p", "", "", gp);
    const gpRow = el("div", "row", null, gp);
    const useBtn = el(
      "button",
      "btn-primary",
      "Analizar con los datos de la GoPro",
      gpRow,
    );
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
    const video = el("video", "", null, stage);
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
      const b = el(
        "button",
        "",
        (d > 0 ? "+" : "−") + fmt(Math.abs(d), d % 1 ? 1 : 0) + " s",
        sync,
      );
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

    const st = {
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

    function setInfo(t) {
      info.textContent = t;
    }
    function laps() {
      const r = hooks.result();
      return r ? r.laps.filter((l) => l.valid) : [];
    }
    function fillLaps() {
      const list = laps();
      for (const sel of [lapSel, expSel]) {
        const prev = sel.value;
        sel.textContent = "";
        for (const l of list)
          el(
            "option",
            "",
            "Vuelta " + l.num + " · " + fmtLap(l.time, 2),
            sel,
          ).value = String(l.num);
        if (list.some((l) => String(l.num) === prev)) sel.value = prev;
      }
    }
    function syncLabel() {
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
    function current() {
      if (st.offset === null) return null;
      const r = hooks.result();
      if (!r) return null;
      if (st.mapOf !== r) {
        st.map = mapOf(r);
        st.mapOf = r;
      }
      return dataAt(r, video.currentTime + st.offset);
    }
    function redraw() {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      const d = current();
      st.last = d;
      drawOverlay(ctx, w, h, d, st.map);
    }
    function loop() {
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
      if (root.MaspaGPMF && /\.(mp4|mov|lrv)$/i.test(f.name)) {
        try {
          const data = await root.MaspaGPMF.extract(
            root.MaspaGPMF.fileReader(f),
          );
          st.gopro = data;
          st.session = root.MaspaGPMF.toSession(data);
          const hz =
            data.gps.t.length /
            Math.max(1, data.gps.t[data.gps.t.length - 1] - data.gps.t[0]);
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
          setInfo(
            f.name +
              (/GPS|GoPro|GPMF/.test(e.message) && !/MP4/.test(e.message)
                ? " · " + e.message
                : ""),
          );
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
        gpNote.textContent = "No se ha podido guardar: " + e.message;
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
    async function exportLap(l) {
      if (st.exporting || st.offset === null) return;
      if (!root.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        expMsg.textContent = "Este navegador no puede grabar vídeo.";
        return;
      }
      const start = Math.max(0, l.t0 - st.offset);
      const end = Math.min(video.duration || 0, l.t0 + l.time - st.offset);
      if (!(end - start > 0.5)) {
        expMsg.textContent =
          "Esa vuelta no está en el vídeo (revisa la sincronización).";
        return;
      }
      st.exporting = true;
      expBtn.disabled = true;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const w = Math.min(1920, vw);
      const h = Math.round((w * vh) / vw / 2) * 2;
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d");
      const stream = cv.captureStream(30);
      try {
        const vs = video.captureStream ? video.captureStream() : null;
        if (vs) for (const tr of vs.getAudioTracks()) stream.addTrack(tr);
      } catch (e) {
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
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined,
      );
      const parts = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) parts.push(ev.data);
      };
      const done = new Promise((res) => (rec.onstop = res));
      video.pause();
      video.currentTime = start;
      await new Promise((res) =>
        video.addEventListener("seeked", res, { once: true }),
      );
      rec.start(1000);
      await video.play();
      await new Promise((res) => {
        const step = () => {
          ctx.drawImage(video, 0, 0, w, h);
          drawOverlay(ctx, w, h, current(), st.map);
          expMsg.textContent =
            "Grabando… " +
            Math.round(((video.currentTime - start) / (end - start)) * 100) +
            " % (se graba en tiempo real: no cambies de pestaña hasta que acabe)";
          if (video.currentTime >= end || video.ended) res();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      video.pause();
      rec.stop();
      await done;
      const type = (mime || "video/webm").split(";")[0];
      const blob = new Blob(parts, { type });
      const a = el("a", "", "", exp);
      a.href = URL.createObjectURL(blob);
      a.download =
        "vuelta-" + l.num + (type === "video/mp4" ? ".mp4" : ".webm");
      a.textContent =
        "Descargar «" +
        a.download +
        "» (" +
        fmt(blob.size / 1048576, 1) +
        " MB)";
      expMsg.textContent = "Listo.";
      st.exporting = false;
      expBtn.disabled = false;
      st.lastExport = { size: blob.size, type, name: a.download };
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
  function readPilot() {
    try {
      return localStorage.getItem("maspa-garaje-piloto") || "";
    } catch (e) {
      return "";
    }
  }
  function writePilot(v) {
    try {
      localStorage.setItem("maspa-garaje-piloto", v);
    } catch (e) {
      /* sin almacenamiento: vale para esta visita */
    }
  }

  root.MaspaVideo = { mount, dataAt, drawOverlay };
})(typeof window !== "undefined" ? window : globalThis);
