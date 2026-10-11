// Los controles de la página: subir una tanda o ver la de ejemplo, el objetivo, «Comparar con», el modo del mapa y su
// línea de meta, guardar la tanda, el informe de la IA, la vuelta en 3D y el cursor de las gráficas.
import { $ } from "../dom";
import { runAnalysis } from "./analizar";
import { setStatus, showError } from "./avisos";
import { loadDemo, loadFiles } from "./carga";
import { renderDetail } from "./detalle";
import { state, validLaps, writeFinish } from "./estado";
import { parseLap } from "./formato";
import { wireCursor } from "./graficas";
import { saveCurrent } from "./historial";
import { askIa, saveIaKey } from "./informe-ia";
import { loadExtRef, resetExtRefs } from "./otras-tandas";
import { closeReplay, openReplay } from "./vuelta3d";

// El botón con data-v en el que se ha pulsado (dentro de un grupo de botones), o null.
function pickedButton(ev: Event): HTMLButtonElement | null {
  return ev.target instanceof Element
    ? ev.target.closest<HTMLButtonElement>("button[data-v]")
    : null;
}

export function wire(): void {
  const file = $<HTMLInputElement>("file");
  // Al cargar otra tanda, la «Guardada» y las referencias de otras tandas se olvidan en carga.ts, y solo si entra de
  // verdad: si no se puede leer, sigue la de antes tal cual.
  file.addEventListener("change", () => {
    loadFiles(file.files);
    file.value = "";
  });
  const drop = $("drop");
  drop.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (ev) => {
    ev.preventDefault();
    drop.classList.remove("over");
    loadFiles(ev.dataTransfer && ev.dataTransfer.files);
  });
  $("demo-btn").addEventListener("click", () => loadDemo());
  $("target").addEventListener("change", () => {
    const t = parseLap($<HTMLInputElement>("target").value);
    if (!(t > 50 && t < 100)) {
      setStatus("Escribe el objetivo como 1:05,0 (minutos:segundos,décimas).", true);
      return;
    }
    state.target = t;
    if (state.session) runAnalysis();
  });
  const seg = $("ref-mode");
  seg.addEventListener("click", async (ev) => {
    const b = pickedButton(ev);
    if (!b || !state.result) return;
    const v = b.dataset.v;
    // El selector pide data-v: esto es solo para los tipos.
    if (v === undefined) return;
    // La vuelta de otra tanda se analiza la primera vez que se elige.
    if (v.indexOf("t:") === 0 && !state.extRefs[v.slice(2)]) {
      b.disabled = true;
      try {
        await loadExtRef(v.slice(2));
      } catch (e) {
        showError(e);
        return;
      } finally {
        b.disabled = false;
      }
    }
    for (const x of seg.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    state.refMode = v;
    if (validLaps().length) renderDetail();
  });
  const mm = $("map-mode");
  mm.addEventListener("click", (ev) => {
    const b = pickedButton(ev);
    if (!b) return;
    const v = b.dataset.v;
    // El selector pide data-v: esto es solo para los tipos.
    if (v === undefined) return;
    for (const x of mm.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    state.mapMode = v;
    $("map-legend-fases").hidden = state.mapMode !== "fases";
    $("map-legend-minis").hidden = state.mapMode !== "minis";
    if (state.result && validLaps().length) renderDetail();
  });
  $("save-btn").addEventListener("click", saveCurrent);
  $("ia-go").addEventListener("click", askIa);
  $("ia-save").addEventListener("click", saveIaKey);
  $("ia-clave").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") saveIaKey();
  });
  $("r3d-open").addEventListener("click", () => {
    if (state.r3dOpen) closeReplay();
    else openReplay();
  });
  wireCursor();
  // Tocar la pista en el mapa mueve la línea de meta a ese punto.
  $("map").addEventListener("click", (ev) => {
    const r = state.result;
    // #map es un <svg>: $ (dom.ts) solo sabe de elementos HTML.
    const root = $<SVGSVGElement>("map");
    const ctm = r && root.getScreenCTM();
    if (!r || !ctm) return;
    const pt = root.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    let best = 0;
    let bd = Infinity;
    r.track.C.forEach((c, i) => {
      const d = Math.hypot(c[0] - p.x, c[1] - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (bd > 25) return;
    state.finish[r.dir] = (r.track.start + best) % r.track.n;
    writeFinish();
    state.saved = false;
    resetExtRefs();
    runAnalysis();
  });
  $("finish-reset").addEventListener("click", () => {
    state.finish = { osm: 0, rev: 0 };
    writeFinish();
    state.saved = false;
    resetExtRefs();
    if (state.session) runAnalysis();
  });
}
