// Página del garaje: código para emparejar el móvil, lista de tandas guardadas en este Mac, comparativa del día (la
// misma que pinta el móvil) y progreso entre días.
import { render as renderComparativa } from "../../app/src/ui/draw/comparativa";
import type { DiaGaraje, EstadoGaraje, ListaTandas, Progreso, TandaLista } from "../api";
import { $, el } from "./dom";
import { stateTag } from "./etiqueta";
import { fmt, fmtLap } from "./formato";
import { render as renderProgreso } from "./progreso";

let lastLink: string | null | undefined;

function fmtDate(id: string, iso: string | undefined): string {
  const d = iso
    ? new Date(iso)
    : new Date(
        Number(id.slice(0, 4)),
        Number(id.slice(4, 6)) - 1,
        Number(id.slice(6, 8)),
        Number(id.slice(9, 11)),
        Number(id.slice(11, 13)),
      );
  return d.toLocaleString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

// ---------- emparejar ----------
function drawQr(link: string | null): void {
  const box = $("qr");
  if (link === lastLink) return;
  lastLink = link;
  $<HTMLButtonElement>("copy-link").disabled = !link;
  box.textContent = "";
  if (!link) {
    box.textContent = "Sin código hasta que el túnel esté abierto.";
    return;
  }
  if (typeof window.qrcode !== "function") {
    // Sin internet para cargar el generador: el enlace a mano.
    box.textContent = "No se ha podido dibujar el código. Abre en el móvil este enlace: " + link;
    return;
  }
  const qr = window.qrcode(0, "M");
  qr.addData(link);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// Cómo se ve cada estado del túnel: clase del punto y texto.
const TUNEL: Record<string, [string, string]> = {
  listo: ["ok", "Túnel abierto: el móvil puede subir las tandas desde el circuito."],
  abriendo: ["wait", "Abriendo el túnel…"],
  caido: ["wait", "El túnel se ha caído; lo estoy abriendo otra vez (el código cambiará)."],
  "sin-cloudflared": [
    "bad",
    "Falta cloudflared. En Terminal: brew install cloudflared, y vuelve a abrir el garaje.",
  ],
  apagado: ["", "Túnel desactivado: solo se guardan las tandas que lleguen desde este Mac."],
};

async function refreshState(): Promise<number> {
  let st: EstadoGaraje;
  try {
    st = await getJson<EstadoGaraje>("/api/estado");
  } catch {
    $("tun-dot").className = "dot bad";
    $("tun-t").textContent = "El garaje se ha cerrado. Vuelve a abrir «Abrir garaje» en el Mac.";
    drawQr(null);
    return 5000;
  }
  $("folder").textContent = st.datos;
  const [cls, text] = TUNEL[st.tunelEstado] || TUNEL.abriendo;
  $("tun-dot").className = "dot " + cls;
  $("tun-t").textContent = text;
  drawQr(st.enlace);
  if (st.espacioLibre < 3 * 1024 ** 3)
    $("tun-note").textContent =
      "Queda poco espacio en el disco (" +
      fmt(st.espacioLibre / 1024 ** 3, 1) +
      " GB). Con menos de 1 GB el garaje deja de aceptar tandas.";
  return st.tunelEstado === "listo" ? 15000 : 3000;
}

// ---------- tandas ----------
async function refreshList(): Promise<number> {
  let data: ListaTandas;
  try {
    data = await getJson<ListaTandas>("/api/tandas");
  } catch {
    return 10000;
  }
  const rows = $("rows");
  rows.textContent = "";
  const list = data.tandas || [];
  $("empty").hidden = list.length > 0;
  let busy = false;
  // Mejor vuelta de cada piloto (sin contar el simulador).
  const pilotOf = (t: TandaLista) => (t.meta && t.meta.piloto) || "";
  const bestBy: Record<string, number> = {};
  for (const t of list)
    if (t.resumen && t.resumen.mejor && !(t.meta && t.meta.sim)) {
      const p = pilotOf(t);
      bestBy[p] = Math.min(bestBy[p] || Infinity, t.resumen.mejor);
    }
  for (const t of list) {
    const tr = el("tr", "", null, rows);
    const r = t.resumen;
    if (t.analizando) busy = true;
    el("td", "", fmtDate(t.id, t.meta ? t.meta.inicio : undefined), tr);
    el("td", "", pilotOf(t) || "—", tr);
    const tdState = el("td", "", null, tr);
    const [cls, label] = stateTag(t.meta, t.resumen);
    el("span", cls, label, tdState);
    const valid = r && r.vueltas ? r.vueltas.filter((v) => v.valid).length : null;
    el("td", "num", t.analizando ? "…" : valid === null ? "—" : String(valid), tr);
    const best = r ? r.mejor : null;
    el(
      "td",
      "num" + (best && best === bestBy[pilotOf(t)] ? " best" : ""),
      t.analizando ? "analizando…" : fmtLap(best),
      tr,
    );
    el("td", "num", r ? fmtLap(r.ideal) : "—", tr);
    el("td", "", r && r.sentido ? (r.sentido === "osm" ? "antihorario" : "horario") : "—", tr);
    el("td", "num", fmt(t.bytes / 1024 / 1024, 1) + " MB", tr);
    const act = el("td", "", null, tr);
    const box = el("div", "actions", null, act);
    // El análisis detallado es del circuito: para una ruta libre, sus datos van en el .zip del móvil.
    if (t.trozos && !(t.meta && t.meta.tipo === "ruta")) {
      const a = el("a", "btn primary", "Analizar", box);
      a.href = "/analisis?tanda=" + encodeURIComponent(t.id);
    }
    const b = el("button", "", "Ver en Finder", box);
    b.type = "button";
    b.addEventListener("click", () => post("/api/tandas/" + encodeURIComponent(t.id) + "/finder"));
    if (r && r.error) {
      const err = el("tr", "", null, rows);
      const td = el("td", "err", "No se ha podido analizar: " + r.error, err);
      td.colSpan = 9;
    }
  }
  return busy ? 3000 : 10000;
}

function poll(fn: () => Promise<number>): void {
  const run = async () => {
    const wait = await fn();
    setTimeout(run, wait);
  };
  run();
}

// Las acciones llevan la cabecera que pide el garaje (otra web no puede mandarla).
function post(url: string): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "X-Garaje": "1" } });
}

// Enlace para el móvil de otra persona (por WhatsApp): lleva la clave, que solo deja subir tandas.
$("copy-link").addEventListener("click", async () => {
  const btn = $("copy-link");
  if (!lastLink) return;
  try {
    await navigator.clipboard.writeText(lastLink);
    btn.textContent = "Enlace copiado";
  } catch {
    window.prompt("Copia este enlace:", lastLink);
  }
  setTimeout(() => (btn.textContent = "Copiar enlace para otro móvil"), 3000);
});

let keyArmed = false;
$("new-key").addEventListener("click", async () => {
  const btn = $("new-key");
  if (!keyArmed) {
    keyArmed = true;
    btn.textContent = "¿Seguro? Todos los móviles tendrán que volver a escanear";
    setTimeout(() => {
      keyArmed = false;
      btn.textContent = "Cambiar la clave";
    }, 5000);
    return;
  }
  keyArmed = false;
  const r = await post("/api/clave-nueva");
  btn.textContent = r.ok ? "Clave cambiada: escanea el código nuevo" : "No se ha podido cambiar";
  lastLink = undefined;
  refreshState();
});

// ---------- comparativa del día ----------
let cmpDay: string | null = null;
let cmpShown = "";
async function refreshCmp(): Promise<number> {
  let d: DiaGaraje;
  try {
    d = await getJson<DiaGaraje>("/api/dia" + (cmpDay ? "?fecha=" + cmpDay : ""));
  } catch {
    return 15000;
  }
  const sel = $<HTMLSelectElement>("cmp-day");
  const days = d.dias || [];
  if (sel.dataset.days !== days.join(",")) {
    sel.textContent = "";
    for (const f of days) {
      const day = new Date(Number(f.slice(0, 4)), Number(f.slice(4, 6)) - 1, Number(f.slice(6, 8)));
      const o = el(
        "option",
        "",
        day.toLocaleDateString("es-ES", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        sel,
      );
      o.value = f;
    }
    sel.dataset.days = days.join(",");
  }
  if (d.fecha) sel.value = d.fecha;
  if (sel.parentElement) sel.parentElement.hidden = days.length < 2;
  // Solo se repinta si algo ha cambiado (para no mover la página mientras se lee).
  const sig = JSON.stringify(Object.assign({}, d, { calculado: null }));
  if (sig !== cmpShown) {
    cmpShown = sig;
    renderComparativa($("cmp-body"), d);
  }
  return d.analizando ? 3000 : 15000;
}
$("cmp-day").addEventListener("change", () => {
  cmpDay = $<HTMLSelectElement>("cmp-day").value;
  refreshCmp();
});

$("open-folder").addEventListener("click", () => post("/api/finder"));

// Progreso entre días (por piloto: el que más días tiene, o el elegido).
let progPilot: string | null = null;
let progShown = "";
let progData: Progreso | null = null;
function drawProgress(): void {
  if (!progData) return;
  const sel = $<HTMLSelectElement>("prog-pilot");
  const names = (progData.pilotos || []).map((p) => p.piloto);
  if (sel.dataset.names !== names.join("|")) {
    sel.textContent = "";
    for (const n of names) el("option", "", n, sel).value = n;
    sel.dataset.names = names.join("|");
  }
  if (progPilot && names.includes(progPilot)) sel.value = progPilot;
  if (sel.parentElement) sel.parentElement.hidden = names.length < 2;
  renderProgreso($("prog-body"), progData, sel.value || null);
}
async function refreshProgress(): Promise<number> {
  let data: Progreso;
  try {
    data = await getJson<Progreso>("/api/progreso");
  } catch {
    return 30000;
  }
  progData = data;
  const sig = JSON.stringify(data);
  if (sig !== progShown) {
    progShown = sig;
    drawProgress();
  }
  return data.pendientes ? 3000 : 30000;
}
$("prog-pilot").addEventListener("change", () => {
  progPilot = $<HTMLSelectElement>("prog-pilot").value;
  drawProgress();
});

poll(refreshState);
poll(refreshList);
poll(refreshCmp);
poll(refreshProgress);
