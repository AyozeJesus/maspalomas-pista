// Entrenador: dónde está el tiempo de esta vuelta frente a la referencia elegida, en un plan de 3 cosas
// (con lo que ya hiciste mejor en otra vuelta) y curva a curva por fases.
import { coach } from "../../../app/src/core/maspalomas";
import type {
  AnalyzeResult,
  PhaseName,
  TelemetryLap,
} from "../../../app/src/core/maspalomas/types";
import { $, el } from "../dom";
import { state } from "./estado";
import { fmt, fmtLap, fmtSigned } from "./formato";
import type { RefView } from "./referencia";

const EXPLAINER = "https://claude.ai/artifact/1RrPnnyj8FkGL7NghJYFze";
type Pillar = 1 | 2 | 3 | 4;
const PILLARS: Record<Pillar, string> = {
  1: "Pilar 1 · salidas",
  2: "Pilar 2 · costeo",
  3: "Pilar 3 · frenada y mirada",
  4: "Pilar 4 · ancho",
};

// A qué pilar de «Maspalomas a fondo» corresponde cada consejo (para enlazar su explicación).
function pillarOf(phase: PhaseName, text: string): Pillar {
  if (/sin gas/.test(text)) return 2;
  if (/ancho/.test(text)) return 4;
  return phase === "entrada" ? 3 : 1;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderTips(r: AnalyzeResult, lap: TelemetryLap, ref: RefView): void {
  const list = $("tips");
  list.textContent = "";
  const c = coach(r, { lap, ref: ref.coach });
  state.coach = c;
  $("coach-h").textContent = "Plan: dónde está el tiempo de esta vuelta frente a " + ref.label;
  // Sin vueltas completas no hay plan, pero entonces el detalle ni se pinta.
  if (!c) return;
  for (const p of c.plan) {
    const li = el("li", "", null, list);
    const head = el("div", "tip-head", null, li);
    const colon = p.text.indexOf(":");
    el("strong", "", colon >= 0 ? p.text.slice(0, colon) : p.text, head);
    el("b", "", fmtSigned(-p.gain, 2) + " s por vuelta", head);
    const why =
      colon >= 0
        ? p.text
            .slice(colon + 1)
            .trim()
            .split("; ")
        : [];
    if (!why.length)
      el(
        "div",
        "tip-line",
        "Mismos puntos de frenada y de gas y misma velocidad mínima: el tiempo se va en cómo bajas o subes la velocidad, o en la trazada. Mira la gráfica de velocidad en esa zona.",
        li,
      );
    for (const w of why) {
      const line = el("div", "tip-line", null, li);
      const pil = pillarOf(p.phase, w);
      const a = el("a", "pill", PILLARS[pil], line);
      a.href = EXPLAINER + "#pilar-" + pil;
      a.target = "_blank";
      a.rel = "noopener";
      el("span", "", cap(w) + ".", line);
    }
    if (p.already)
      el(
        "div",
        "tip-line done",
        "Ya lo hiciste en la vuelta " +
          p.already.lapNum +
          ": " +
          fmt(p.already.gain, 2) +
          " s mejor que en tu mejor vuelta.",
        li,
      );
  }
  if (!c.plan.length)
    el(
      "li",
      "",
      "En esta vuelta no pierdes tiempo claro frente a " + ref.label + " en ninguna fase.",
      list,
    );
  // Tabla curva a curva: entrada, salida y recta (la recta que viene detrás de cada curva).
  const body = $("coach-phases");
  body.textContent = "";
  const byNum = c.lap.corners.slice().sort((a, b) => a.num - b.num);
  for (const k of byNum) {
    const tr = el("tr", "", null, body);
    el("td", "", "C" + k.num + " · " + k.name, tr).style.fontFamily = "var(--body)";
    for (const name of ["entrada", "salida", "recta"]) {
      const ph = k.phases.find((x) => x.phase === name);
      // Cada curva trae siempre sus tres fases: esto es solo para los tipos.
      if (!ph) continue;
      const td = el(
        "td",
        ph.loss > 0.03 ? "worse" : ph.loss < -0.03 ? "better" : "",
        fmtSigned(ph.loss, 2),
        tr,
      );
      if (ph.why.length) el("small", "", cap(ph.why[0]), td);
    }
    el("td", k.loss > 0.03 ? "worse" : k.loss < -0.03 ? "better" : "", fmtSigned(k.loss, 2), tr);
  }
  // Vuelta ideal (la fina solo con GPS rápido) y la curva menos regular.
  const notes: string[] = [];
  if (c.ideal.show !== null)
    notes.push("Vuelta ideal (tus mejores " + c.ideal.kind + "): " + fmtLap(c.ideal.show) + ".");
  const irr = c.consistency[0];
  if (irr && irr.sd >= 0.15)
    notes.push(
      "La curva menos regular es C" +
        irr.num +
        " · " +
        irr.name +
        ": varía ±" +
        fmt(irr.sd, 2) +
        " s de una vuelta a otra.",
    );
  notes.push(
    "Positivo, pierdes; negativo, ganas. Cada curva incluye la recta que viene detrás, que es donde se nota su salida.",
  );
  $("coach-note").textContent = notes.join(" ");
}
