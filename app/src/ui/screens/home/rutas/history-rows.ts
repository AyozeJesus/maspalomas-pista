// «Rutas y tandas»: qué grabaciones salen en la lista y lo que dice cada fila (el nombre o la fecha arriba y la línea
// con lo esencial abajo), cómo pide confirmar «Borrar» y cuáles hay que poner al día.
import { BUILD } from "../../../../app/version";
import { sessionDate, sessionLine, type ListedSession } from "../../../../services/history";
import type { PistaStore } from "../../../../storage";

// Las guardadas en el móvil, de la más nueva a la más vieja, sin la vuelta de ejemplo ni la que se está grabando. Si el
// navegador no deja leerlas, ninguna.
export async function savedSessions(
  store: Pick<PistaStore, "sessions"> | null,
): Promise<ListedSession[]> {
  try {
    if (!store) return [];
    return (await store.sessions())
      .map((s) => s as ListedSession)
      .filter((s) => !s.sim && s.estado !== "grabando");
  } catch {
    return [];
  }
}

// Con nombre puesto, el nombre arriba y la fecha en la línea de abajo.
export function historyRow(s: ListedSession): { title: string; line: string } {
  return {
    title: s.nombre || sessionDate(s),
    line: (s.nombre ? sessionDate(s) + " · " : "") + sessionLine(s),
  };
}

// El segundo toque de «Borrar»: si aún no se ha subido al Mac emparejado, lo avisa.
export function deleteArmedLabel(s: ListedSession, paired: boolean): string {
  return s.pend && paired ? "¿Sin subir? Otra vez" : "¿Seguro? Otra vez";
}

// Las rutas de la lista con el resumen de otra versión de la app (o sin el repaso del final): las que se repasan solas
// en la portada (el mismo filtro que viewer.refreshStored). Sus ids juntos, para saber cuándo cambian; "" si ninguna.
export function staleRoutes(list: readonly ListedSession[]): string {
  return list
    .filter((s) => s.tipo === "ruta" && s.calculo !== BUILD)
    .map((s) => s.id)
    .join(" ");
}
