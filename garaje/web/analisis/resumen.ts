// Resumen de la tanda: las cifras (mejor vuelta, ideal, media, objetivo) y la tabla de vueltas con sus sectores; al
// tocar una vuelta, pasa a ser la del detalle.
import { $, el } from "../dom";
import { renderDetail } from "./detalle";
import { state, validLaps } from "./estado";
import { fmt, fmtLap, fmtSigned } from "./formato";

export function renderSummary(): void {
  const r = state.result;
  if (!r) return;
  const laps = validLaps();
  const tiles = $("tiles");
  tiles.textContent = "";
  const tile = (label: string, value: string, sub: string) => {
    const t = el("div", "tile", null, tiles);
    el("span", "", label, t);
    el("b", "", value, t);
    if (sub) el("small", "", sub, t);
  };
  const times = laps.map((l) => l.time);
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN;
  const sd =
    times.length > 1
      ? Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / (times.length - 1))
      : NaN;
  tile(
    "Mejor vuelta",
    r.best ? fmtLap(r.best.time) : "—",
    r.best ? "vuelta " + (laps.indexOf(r.best) + 1) : "",
  );
  tile("Vuelta ideal", r.ideal ? fmtLap(r.ideal) : "—", "tus mejores sectores juntos");
  tile("Media", fmtLap(mean), isFinite(sd) ? "± " + fmt(sd, 2) + " s de una vuelta a otra" : "");
  tile(
    "Objetivo",
    fmtLap(state.target, 1),
    r.best ? "te faltan " + fmt(Math.max(0, r.best.time - state.target), 2) + " s" : "",
  );
  const meta = [
    r.dir === "osm" ? "Sentido antihorario" : "Sentido horario",
    r.hasImu ? "GPS + sensores" : "solo GPS",
  ];
  if (r.fit) meta.push("encaje móvil-moto " + fmt(r.fit.r2 * 100, 0) + " %");
  $("sum-meta").textContent = meta.join(" · ");

  const head = $("laps-head");
  head.textContent = "";
  const hr = el("tr", "", null, head);
  for (const h of ["Vuelta", "Tiempo", "Δ mejor", "Δ objetivo"]) el("th", "", h, hr).scope = "col";
  for (const c of r.ref.corners) el("th", "", "S" + c.num + " · C" + c.num, hr).scope = "col";
  const body = $("laps-body");
  body.textContent = "";
  const bestSec = r.ref.corners.map((_, k) => Math.min(...laps.map((l) => l.sectors[k])));
  laps.forEach((lap, i) => {
    const tr = el("tr", i === state.lapIdx ? "sel" : "", null, body);
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(i === state.lapIdx));
    el("td", "", String(i + 1), tr);
    el("td", lap === r.best ? "best" : "", fmtLap(lap.time), tr);
    // Con vueltas completas siempre hay una mejor (!r.best no pasa nunca: solo para los tipos).
    el("td", "", lap === r.best || !r.best ? "—" : fmtSigned(lap.time - r.best.time, 2), tr);
    const dObj = lap.time - state.target;
    el("td", dObj > 0 ? "worse" : "better", fmtSigned(dObj, 2), tr);
    lap.sectors.forEach((s, k) =>
      el("td", Math.abs(s - bestSec[k]) < 1e-6 ? "best" : "", fmt(s, 2), tr),
    );
    const pick = () => {
      state.lapIdx = i;
      state.cursorK = null;
      renderSummary();
      renderDetail();
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        pick();
      }
    });
  });
}
