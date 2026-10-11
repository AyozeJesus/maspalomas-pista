// Informe con IA (solo tandas del garaje: el informe lo pide el Mac), con la clave de Anthropic que se guarda en él.
import type { IaEstado, Informe } from "../../api";
import { $ } from "../dom";
import { state, type IaCfg } from "./estado";

// Markdown sencillo (## títulos, listas con - o 1., **negrita**) a nodos: el texto de la IA nunca va como HTML.
function mdInto(box: HTMLElement, text: string): void {
  let list: HTMLElement | null = null;
  let para: HTMLElement | null = null;
  const inline = (el: HTMLElement, s: string) => {
    s.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement("strong");
        b.textContent = part.slice(2, -2);
        el.appendChild(b);
      } else if (part) el.appendChild(document.createTextNode(part));
    });
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) {
      list = null;
      para = null;
    } else if (h) {
      list = null;
      para = null;
      const el = document.createElement("h3");
      inline(el, h[1]);
      box.appendChild(el);
    } else if (li) {
      para = null;
      const ordered = /^\d/.test(line);
      if (!list || list.tagName !== (ordered ? "OL" : "UL")) {
        list = document.createElement(ordered ? "ol" : "ul");
        box.appendChild(list);
      }
      const el = document.createElement("li");
      inline(el, li[1]);
      list.appendChild(el);
    } else {
      list = null;
      if (!para) {
        para = document.createElement("p");
        box.appendChild(para);
      } else para.appendChild(document.createTextNode(" "));
      inline(para, line);
    }
  }
}

function renderIa(inf: Informe | null, cfg: IaCfg): void {
  const box = $("ia-text");
  box.textContent = "";
  $("ia-key").hidden = !!cfg.configurada;
  $<HTMLButtonElement>("ia-go").disabled = !cfg.configurada;
  if (inf) {
    mdInto(box, inf.texto);
    $("ia-go").textContent = "Pedir otro informe";
    $("ia-status").textContent =
      "Informe del " +
      new Date(inf.creado).toLocaleString("es-ES", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }) +
      (inf.cortado ? " · salió cortado: pide otro" : "") +
      (inf.viejo ? " · la tanda ha recibido datos nuevos desde entonces: pide otro" : "");
  } else {
    $("ia-go").textContent = "Pedir el informe";
    $("ia-status").textContent = cfg.configurada
      ? "Aún no hay informe de esta tanda: tarda medio minuto, más o menos."
      : "Para el informe hace falta tu clave de la API de Anthropic (console.anthropic.com → API Keys).";
  }
}

export async function loadIa(): Promise<void> {
  const id = state.tandaId;
  $("ia-sec").hidden = !id;
  if (!id) return;
  let cfg: IaCfg = { configurada: false };
  let inf: Informe | null = null;
  try {
    cfg = (await (await fetch("/api/ia", { cache: "no-store" })).json()) as IaEstado;
    const r = await fetch("/api/tandas/" + encodeURIComponent(id) + "/informe", {
      cache: "no-store",
    });
    if (r.ok) inf = ((await r.json()) as { informe: Informe | null }).informe;
  } catch {
    /* garaje cerrado: sin informe */
  }
  if (state.tandaId !== id) return;
  state.iaCfg = cfg;
  renderIa(inf, cfg);
}

export async function askIa(): Promise<void> {
  const id = state.tandaId;
  if (!id) return;
  const btn = $<HTMLButtonElement>("ia-go");
  btn.disabled = true;
  $("ia-status").textContent = "Escribiendo el informe… (medio minuto, más o menos)";
  try {
    const r = await fetch("/api/tandas/" + encodeURIComponent(id) + "/informe", {
      method: "POST",
      headers: { "X-Garaje": "1" },
    });
    const j = (await r.json().catch(() => ({}))) as { informe?: Informe | null; error?: string };
    if (state.tandaId !== id) return;
    if (!r.ok || !j.informe) {
      $("ia-status").textContent = j.error || "No se ha podido hacer el informe: prueba otra vez.";
      btn.disabled = false;
      return;
    }
    renderIa(j.informe, state.iaCfg || { configurada: true });
  } catch {
    if (state.tandaId !== id) return;
    $("ia-status").textContent = "Sin conexión con el garaje: ¿sigue abierto?";
    btn.disabled = false;
  }
}

export async function saveIaKey(): Promise<void> {
  const clave = $<HTMLInputElement>("ia-clave").value.trim();
  if (!clave) return;
  try {
    const r = await fetch("/api/ia", {
      method: "POST",
      headers: { "X-Garaje": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ clave }),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      $("ia-status").textContent = j.error || "No se ha podido guardar la clave.";
      return;
    }
    $<HTMLInputElement>("ia-clave").value = "";
    loadIa();
  } catch {
    $("ia-status").textContent = "Sin conexión con el garaje: ¿sigue abierto?";
  }
}
