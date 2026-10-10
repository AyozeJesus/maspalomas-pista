// El último valor no nulo: una capa que se oculta (aviso, destello…) sigue con lo que decía, como en la app de siempre
// (se oculta, no se vacía).
import { useState } from "react";

export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  // Guardar lo de la vez anterior al cambiar (el patrón de React para «estado que sale de las props»).
  if (value !== null && value !== last) setLast(value);
  return value !== null ? value : last;
}
