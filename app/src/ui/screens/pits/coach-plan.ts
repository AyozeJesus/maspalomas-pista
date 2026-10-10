// Entrenador en boxes: las 3 cosas que más tiempo te dan para la próxima tanda (tu mejor vuelta frente al objetivo), lo
// que ya has hecho mejor en otra vuelta y la curva menos regular; y la vuelta ideal (la fina solo con GPS rápido).
import { coach, type AnalyzeResult, type CoachResult } from "../../../core/maspalomas";
import { fmt, fmtLap, fmtSigned } from "../../../lib/format";

export interface Tip {
  title: string;
  // «−0,42 s por vuelta» (lo que da), o null.
  loss: string | null;
  lines: string[];
  // «tip-self» en lo que ya sabes hacer y en la curva menos regular.
  cls: string;
}

export interface CoachPlan {
  tips: Tip[];
  // «Vuelta ideal (tus mejores 4 sectores): 1:06,10», o vacío.
  ideal: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + ".";

const tip = (title: string, gain: number | null, lines: string[], cls = ""): Tip => ({
  title,
  loss: gain !== null ? fmtSigned(-gain, 2) + " s por vuelta" : null,
  lines,
  cls,
});

export function coachPlan(analysis: AnalyzeResult | null, target: number): CoachPlan {
  return planOf(analysis && analysis.best ? coach(analysis) : null, target);
}

// Lo que dice el entrenador (coach), escrito para boxes. target: la vuelta objetivo (s).
export function planOf(c: CoachResult | null, target: number): CoachPlan {
  if (!c)
    return {
      tips: [
        tip("Sin análisis todavía", null, [
          "Haz al menos una vuelta completa pasando dos veces por meta.",
        ]),
      ],
      ideal: "",
    };
  const tips: Tip[] = [];
  for (const p of c.plan) {
    const colon = p.text.indexOf(":");
    const head = p.text.split(":")[0];
    const why = colon >= 0 ? p.text.slice(colon + 1).trim() : "";
    const lines = why
      ? why.split("; ").map(cap)
      : [
          "Mismos puntos de frenada y de gas y misma velocidad mínima: el tiempo se va en cómo bajas o subes la velocidad, o en la trazada.",
        ];
    if (p.already)
      lines.push(
        "Ya lo hiciste en la vuelta " +
          p.already.lapNum +
          ": " +
          fmt(p.already.gain, 2) +
          " s mejor que en tu mejor vuelta.",
      );
    tips.push(tip(head, p.gain, lines));
  }
  if (!c.plan.length)
    tips.push(
      tip("Frente a tu objetivo de " + fmtLap(target, 1), null, [
        "Tu mejor vuelta no pierde tiempo claro en ninguna curva.",
      ]),
    );
  // Lo que ya sabes hacer (otra vuelta lo hizo mejor que la mejor) y que no esté ya en el plan.
  const inPlan = (s: { k: number; phase: string }) =>
    c.plan.some((p) => p.k === s.k && (p.phase === "entrada") === (s.phase === "entrada"));
  for (const s of c.self.filter((s) => !inPlan(s)).slice(0, 2))
    tips.push(
      tip(
        "Ya lo has hecho: C" + s.num + " · " + s.name + " · " + s.phase,
        null,
        [
          "En la vuelta " +
            s.lapNum +
            " hiciste esa " +
            s.phase +
            " " +
            fmt(s.gain, 2) +
            " s más rápido que en tu mejor vuelta.",
        ],
        "tip-self",
      ),
    );
  const irr = c.consistency[0];
  if (irr && irr.sd >= 0.15)
    tips.push(
      tip(
        "Menos regular: C" + irr.num + " · " + irr.name,
        null,
        [
          "De una vuelta a otra varía ±" +
            fmt(irr.sd, 2) +
            " s: busca la misma referencia de frenada y de gas cada vuelta.",
        ],
        "tip-self",
      ),
    );
  const ideal =
    c.ideal.show !== null
      ? "Vuelta ideal (tus mejores " + c.ideal.kind + "): " + fmtLap(c.ideal.show)
      : "";
  return { tips, ideal };
}
