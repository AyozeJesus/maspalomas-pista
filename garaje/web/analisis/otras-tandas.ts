// Las otras tandas de circuito del mismo día como referencia: sus botones en «Comparar con» y su mejor vuelta,
// analizada con la misma meta y en el mismo sentido que la tanda en pantalla.
import type { ArchivosTanda, ListaTandas } from "../../api";
import { analyze, sessionFromCsv } from "../../../app/src/core/maspalomas";
import { $, el } from "../dom";
import { setStatus, userError } from "./avisos";
import { state, type DayTanda } from "./estado";
import { fmtLap } from "./formato";

// Las otras tandas de circuito del mismo día (tuyas o de otro piloto): se pueden usar de referencia.
export async function loadDayRefs(id: string): Promise<void> {
  try {
    const r = await fetch("/api/tandas", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as ListaTandas;
    const day = id.slice(0, 8);
    state.dayList = (j.tandas || []).filter(
      (t): t is DayTanda =>
        t.id !== id &&
        t.id.slice(0, 8) === day &&
        !!t.meta &&
        t.meta.tipo === "pista" &&
        Number.isFinite(t.meta.mejor),
    );
    renderRefButtons();
  } catch {
    /* sin garaje (archivo subido a mano): solo objetivo y mejor vuelta */
  }
}

function refWho(t: DayTanda): string {
  const hora = t.id.slice(9, 11) + ":" + t.id.slice(11, 13);
  return (t.meta.piloto || "Tanda") + " " + hora;
}

function renderRefButtons(): void {
  const seg = $("ref-mode");
  for (const b of seg.querySelectorAll("button.ext")) b.remove();
  for (const t of state.dayList) {
    const b = el("button", "ext", refWho(t) + " · " + fmtLap(t.meta.mejor), seg);
    b.type = "button";
    b.dataset.v = "t:" + t.id;
    b.setAttribute("aria-pressed", String(state.refMode === b.dataset.v));
  }
}

// Otra tanda en pantalla: las otras tandas del día y sus mejores vueltas eran de la anterior (otro día, otra meta u
// otro sentido), así que se quitan y se vuelve a comparar con el objetivo; y la nueva aún no está en «Tus tandas».
export function forgetDayRefs(): void {
  state.dayList = [];
  renderRefButtons();
  resetExtRefs();
  state.saved = false;
}

// Con otra línea de meta, las vueltas de las otras tandas ya analizadas no sirven: se vuelve al objetivo.
export function resetExtRefs(): void {
  state.extRefs = {};
  if (state.refMode.indexOf("t:") === 0) {
    state.refMode = "obj";
    for (const x of $("ref-mode").querySelectorAll("button"))
      x.setAttribute("aria-pressed", String(x.dataset.v === "obj"));
  }
}

// La mejor vuelta de otra tanda, analizada con la misma meta y el mismo sentido (si no, no se pueden comparar).
export async function loadExtRef(id: string): Promise<void> {
  const t = state.dayList.find((x) => x.id === id);
  const who = t ? refWho(t) : "otra tanda";
  setStatus("Cargando la mejor vuelta de " + who + "…");
  const r = await fetch("/api/tandas/" + encodeURIComponent(id) + "/archivos", {
    cache: "no-store",
  });
  if (!r.ok) throw userError("No se ha podido leer la tanda de " + who + ".");
  const data = (await r.json()) as ArchivosTanda;
  const res = analyze(sessionFromCsv(data.files), {
    target: state.target,
    finish: state.finish,
    dir: state.result?.dir,
  });
  if (!res.best)
    throw userError("La tanda de " + who + " no tiene ninguna vuelta completa en este sentido.");
  state.extRefs[id] = {
    grid: res.best.grid,
    corners: res.best.corners,
    sectors: res.best.sectors,
    time: res.best.time,
    who,
  };
  setStatus("Comparando con la mejor vuelta de " + who + " (" + fmtLap(res.best.time) + ").");
}
