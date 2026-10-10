// Un valor que solo se vuelve a calcular cuando cambia `key` (un aviso del runtime: summaryVersion, homeVersion…) y si
// no, se queda el de la vez anterior. Para lo que sale del motor, que cambia sin que React se entere: se lee cuando el
// runtime avisa y la pantalla se queda con eso (como la de antes, que se pintaba en ese momento y luego solo se
// ocultaba). Es el patrón de React de «guardar información de renders anteriores».
import { useState } from "react";

export function useSnapshot<T>(key: string | number, compute: (prev: T) => T, initial: T): T {
  const [snap, setSnap] = useState<{ key: string | number | null; value: T }>({
    key: null,
    value: initial,
  });
  if (snap.key === key) return snap.value;
  const value = compute(snap.value);
  setSnap({ key, value });
  return value;
}
