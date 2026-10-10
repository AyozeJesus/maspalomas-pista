// Tus tramos (localStorage «pista-tramos»): se leen al pintar la portada, otra vez cada vez que cambia `version`
// (homeVersion: el directo o el repaso han apuntado pasadas) y con reload() después de cambiarlos desde aquí.
import { useCallback, useState } from "react";
import type { Tramo } from "../../../../core/tramos";
import type { KeyValueStore } from "../../../../engine/kv";
import { loadTramos } from "../../../../services/tramos-store";

export function useTramos(
  kv: KeyValueStore,
  version: number,
): { tramos: Tramo[]; reload: () => void } {
  const [read, setRead] = useState(() => ({ at: version, list: loadTramos(kv) }));
  // Al cambiar `version`, se vuelven a leer ya en este pintado (el patrón de React para estado que sale de las props).
  if (read.at !== version) setRead({ at: version, list: loadTramos(kv) });
  const reload = useCallback(() => setRead((r) => ({ at: r.at, list: loadTramos(kv) })), [kv]);
  return { tramos: read.list, reload };
}
