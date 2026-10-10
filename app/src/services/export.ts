// Exportar una tanda o ruta: los mismos CSV que Sensor Logger (más Canales.csv con lo calculado en directo), en un .zip
// que se descarga.
import JSZip from "jszip";
import { csvFiles, mergeChunks, type CsvFile } from "../core/formato";
import { engDate, type Engine } from "../engine";
import type { PistaStore } from "../storage";

// «maspalomas-20261009-1631.zip» (con «-simulador» si es la vuelta de ejemplo).
export function zipName(epochMs: number, isSim: boolean): string {
  const d = new Date(epochMs);
  const p = (x: number) => String(x).padStart(2, "0");
  return (
    "maspalomas-" +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    (isSim ? "-simulador" : "") +
    ".zip"
  );
}

export async function downloadZip(
  files: readonly CsvFile[],
  epochMs: number,
  isSim: boolean,
): Promise<boolean> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.text);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName(epochMs, isSim);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

// Lo grabado por un motor (en directo, acabado o repasando una grabación).
export async function exportSession(eng: Engine | null): Promise<boolean> {
  if (!eng) return false;
  const ms0 = engDate(eng).getTime();
  const series: Parameters<typeof csvFiles>[0] = {};
  for (const key of ["loc", "acc", "gyro", "grav", "canal"] as const)
    if (eng[key].n) (series as Record<string, unknown>)[key] = eng[key].view();
  return downloadZip(csvFiles(series, ms0), ms0, !!eng.sim);
}

// La última tanda guardada en el móvil (vale también después de cerrar la página). «nada»: no hay ninguna.
export async function exportStored(store: PistaStore): Promise<"exportada" | "nada" | "error"> {
  try {
    const list = await store.sessions();
    const s = list.find((x) => !x.sim) || list[0];
    if (!s) return "nada";
    const epoch = s.epoch as number;
    const merged = mergeChunks(await store.chunksOf(s.id));
    return (await downloadZip(csvFiles(merged.series, epoch), epoch, !!s.sim))
      ? "exportada"
      : "nada";
  } catch {
    return "error";
  }
}
