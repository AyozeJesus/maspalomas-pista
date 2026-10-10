// «Pantalla en pista»: las cuatro maneras de llevar el móvil y cuál está elegida (un valor que no es ninguna de ellas
// cuenta como «Como el móvil»).
import type { Orientation } from "../../../../engine/settings";

export const ORIENT_CHOICES: readonly { value: Orientation; label: string }[] = [
  { value: "auto", label: "Como el móvil" },
  { value: "portrait-primary", label: "Vertical" },
  { value: "landscape-primary", label: "Horizontal" },
  { value: "landscape-secondary", label: "Horizontal girada" },
];

export function currentOrient(pantalla: string): Orientation {
  const c = ORIENT_CHOICES.find((o) => o.value === pantalla);
  return c ? c.value : "auto";
}
