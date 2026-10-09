// Vuelta real en 3D contra un fantasma (tu mejor vuelta, la de otro piloto o el objetivo), a la misma hora de
// vuelta: ves dónde se te escapa o dónde le ganas. Usa la vista 3D de la app (three.js, cargado solo al abrirla).
(function (root) {
  "use strict";
  let ready = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("No se ha podido cargar " + src));
      document.head.appendChild(s);
    });
  }
  function ensure() {
    if (!ready)
      ready = loadScript("/lib/three.min.js").then(() =>
        loadScript("/lib/vista3d.js"),
      );
    return ready;
  }
  const NF = [0, 1, 2].map(
    (d) =>
      new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }),
  );
  const fmt = (x, d) => (isFinite(x) ? NF[d].format(x) : "—");
  function fmtLap(t) {
    if (!isFinite(t)) return "—";
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + fmt(Math.floor(s * 10) / 10, 1);
  }
  function el(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  // Dónde va una vuelta (rejilla por distancia con su tiempo) a una hora de vuelta: el tiempo crece con la
  // distancia, así que se busca por bisección.
  function poseAt(grid, tau) {
    const t = grid.t;
    const n = t.length;
    const target = t[0] + Math.max(0, tau);
    if (target >= t[n - 1])
      return {
        s: grid.s[n - 1],
        lean: grid.lean[n - 1],
        v: grid.v[n - 1],
        done: true,
      };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= target) lo = mid;
      else hi = mid;
    }
    const f = (target - t[lo]) / (t[hi] - t[lo] || 1);
    const at = (key) => grid[key][lo] + (grid[key][hi] - grid[key][lo]) * f;
    return { s: at("s"), lean: at("lean"), v: at("v"), done: false };
  }
  // Tiempo de vuelta con el que una rejilla pasa por la distancia s.
  function timeAtS(grid, s) {
    const n = grid.s.length;
    const step = grid.s[1] - grid.s[0];
    const x = Math.max(0, Math.min(n - 1, s / step));
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    return grid.t[i] + (grid.t[i + 1] - grid.t[i]) * f - grid.t[0];
  }

  // opts: { track, corners, bounds, lap: {grid, time, label}, ref: {grid, time, label} | null,
  //         isCurrent?: () => bool (si mientras carga se ha pedido otra, esta no dibuja nada) }
  // Devuelve el control, o null si ya no era la petición vigente.
  async function open(container, opts) {
    container.textContent = "";
    container.hidden = false;
    el("p", "r3d-wait", "Cargando el circuito en 3D…", container);
    try {
      await ensure();
    } catch (e) {
      if (opts.isCurrent && !opts.isCurrent()) return null;
      container.textContent = "";
      el("p", "r3d-wait", "No se ha podido cargar la vista 3D.", container);
      return { close() {} };
    }
    if (opts.isCurrent && !opts.isCurrent()) return null;
    container.textContent = "";
    const wait = el("p", "r3d-wait", "", container);
    const stage = el("div", "r3d-stage", null, container);
    const view = root.MaspaVista3D.create(stage, opts.track, {
      corners: opts.corners,
      bounds: opts.bounds,
    });
    if (!view) {
      wait.textContent = "Este navegador no puede dibujar en 3D.";
      return { close() {} };
    }
    wait.remove();
    const hud = el("div", "r3d-hud", null, stage);
    const hTime = el("b", "", "0:00,0", hud);
    const hSpeed = el("span", "", "", hud);
    const hDelta = el("span", "r3d-delta", "", hud);
    const bar = el("div", "r3d-bar", null, container);
    const play = el("button", "", "▶ Reproducir", bar);
    play.type = "button";
    const speedBtn = el("button", "", "×1", bar);
    speedBtn.type = "button";
    speedBtn.setAttribute("aria-label", "Velocidad de la reproducción");
    const cams = el("div", "seg", null, bar);
    for (const [v, txt] of [
      ["casco", "Casco"],
      ["detras", "Detrás"],
      ["arriba", "Arriba"],
    ]) {
      const b = el("button", "", txt, cams);
      b.type = "button";
      b.dataset.cam = v;
      b.setAttribute("aria-pressed", String(v === "detras"));
    }
    const range = el("input", "r3d-range", null, bar);
    range.type = "range";
    range.min = "0";
    range.max = String(opts.lap.time);
    range.step = "0.1";
    range.value = "0";
    range.setAttribute("aria-label", "Momento de la vuelta");
    el(
      "p",
      "caption",
      "Azul: " +
        opts.lap.label +
        (opts.ref
          ? ". Morado, transparente: " +
            opts.ref.label +
            ", a la misma hora de vuelta."
          : "."),
      container,
    );
    view.setMode("detras");
    const st = {
      tau: 0,
      playing: false,
      speed: 1,
      last: null,
      raf: 0,
      closed: false,
    };
    const L = opts.track.L;
    function frame(nowMs) {
      if (st.closed) return;
      const dt = st.last === null ? 0 : Math.min(0.1, (nowMs - st.last) / 1000);
      st.last = nowMs;
      if (st.playing) {
        st.tau += dt * st.speed;
        if (st.tau >= opts.lap.time) {
          st.tau = opts.lap.time;
          st.playing = false;
          play.textContent = "▶ Reproducir";
        }
        range.value = String(st.tau);
      }
      const pose = poseAt(opts.lap.grid, st.tau);
      const g = opts.ref ? poseAt(opts.ref.grid, st.tau) : null;
      view.update(pose, dt, g);
      hTime.textContent = fmtLap(st.tau);
      hSpeed.textContent =
        fmt(pose.v * 3.6, 0) +
        " km/h · " +
        fmt(Math.abs(pose.lean), 0) +
        "°" +
        (Math.abs(pose.lean) < 3 ? "" : pose.lean > 0 ? " der." : " izq.");
      if (g) {
        // + vas detrás del fantasma (llegas más tarde a donde estás); en metros, lo que os separa ahora.
        const d = st.tau - timeAtS(opts.ref.grid, pose.s);
        let gap = g.s - pose.s;
        if (gap > L / 2) gap -= L;
        if (gap < -L / 2) gap += L;
        hDelta.textContent =
          (d >= 0 ? "+" : "−") +
          fmt(Math.abs(d), 2) +
          " s · " +
          fmt(Math.abs(gap), 0) +
          " m " +
          (gap >= 0 ? "por detrás" : "por delante");
        hDelta.className =
          "r3d-delta " + (d > 0.02 ? "down" : d < -0.02 ? "up" : "");
      }
      st.raf = requestAnimationFrame(frame);
    }
    play.addEventListener("click", () => {
      if (st.tau >= opts.lap.time) st.tau = 0;
      st.playing = !st.playing;
      play.textContent = st.playing ? "❚❚ Pausa" : "▶ Reproducir";
    });
    speedBtn.addEventListener("click", () => {
      st.speed = st.speed >= 4 ? 1 : st.speed * 2;
      speedBtn.textContent = "×" + st.speed;
    });
    cams.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-cam]");
      if (!b) return;
      for (const x of cams.querySelectorAll("button"))
        x.setAttribute("aria-pressed", String(x === b));
      view.setMode(b.dataset.cam);
    });
    range.addEventListener("input", () => {
      st.tau = Number(range.value);
    });
    st.raf = requestAnimationFrame(frame);
    const ctl = {
      close() {
        st.closed = true;
        cancelAnimationFrame(st.raf);
        view.dispose();
        container.textContent = "";
        container.hidden = true;
      },
      // Para pruebas.
      state: () => ({
        tau: st.tau,
        playing: st.playing,
        delta: hDelta.textContent,
        ghost: !!opts.ref,
      }),
      seek(t) {
        st.tau = t;
      },
    };
    return ctl;
  }

  root.MaspaReplay3D = { open, poseAt, timeAtS };
})(typeof window !== "undefined" ? window : globalThis);
