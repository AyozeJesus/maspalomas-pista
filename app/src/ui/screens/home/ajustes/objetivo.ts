// «Objetivo» (vuelta objetivo del piloto): lo escrito («1:05», «1.05», «65,5»…) vale si es una vuelta posible (40–200
// s) y se guarda redondeado a la décima; si no, se queda el de antes. El campo dice siempre el que vale («1:05,0»).
import { target, type Settings } from "../../../../engine/settings";
import { fmtLap, parseLap } from "../../../../lib/format";

export function targetText(s: Settings): string {
  return fmtLap(target(s), 1);
}

// El objetivo nuevo (null si lo escrito no vale) y lo que tiene que decir el campo.
export function commitTarget(raw: string, s: Settings): { objetivo: number | null; text: string } {
  const t = parseLap(raw);
  const objetivo = t >= 40 && t <= 200 ? Math.round(t * 10) / 10 : null;
  return { objetivo, text: targetText(objetivo === null ? s : { ...s, objetivo }) };
}
