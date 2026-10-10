// Las grabaciones de la lista, leídas otra vez del móvil cada vez que cambia `version` (homeVersion: se repinta la
// portada). Si llegan dos lecturas cruzadas, vale la última.
import { useEffect, useState } from "react";
import type { ListedSession } from "../../../../services/history";
import type { PistaStore } from "../../../../storage";
import { savedSessions } from "./history-rows";

export function useHistory(store: PistaStore | null, version: number): ListedSession[] {
  const [list, setList] = useState<ListedSession[]>([]);
  useEffect(() => {
    let current = true;
    void savedSessions(store).then((l) => {
      if (current) setList(l);
    });
    return () => {
      current = false;
    };
  }, [store, version]);
  return list;
}
