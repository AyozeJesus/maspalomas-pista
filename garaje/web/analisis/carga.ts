// Cargar una tanda: el .zip o los CSV de Sensor Logger, una tanda guardada en el garaje de este Mac o la de ejemplo.
import type { ArchivosTanda } from "../../api";
import type { CsvFile } from "../../../app/src/core/formato";
import { demoSession, sessionFromCsv } from "../../../app/src/core/maspalomas";
import { $ } from "../dom";
import { runAnalysis } from "./analizar";
import { setStatus, showError, userError } from "./avisos";
import { state } from "./estado";
import { fmtLap } from "./formato";
import { loadDayRefs } from "./otras-tandas";

// Number.isFinite, que además le dice a TypeScript que es un número.
const isNum = (x: unknown): x is number => Number.isFinite(x);

export async function loadFiles(list: FileList | null | undefined): Promise<void> {
  const files = Array.from(list || []);
  if (!files.length) return;
  setStatus("Leyendo " + files.map((f) => f.name).join(", ") + "…");
  try {
    const texts: CsvFile[] = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        if (!window.JSZip)
          throw userError(
            "No se ha podido cargar el lector de .zip. Descomprime el archivo en el móvil y sube los CSV.",
          );
        const zip = await window.JSZip.loadAsync(f);
        for (const name of Object.keys(zip.files)) {
          if (/\.csv$/i.test(name) && !zip.files[name].dir)
            texts.push({ name, text: await zip.files[name].async("string") });
        }
      } else if (/\.csv$/i.test(f.name)) {
        texts.push({ name: f.name, text: await f.text() });
      }
    }
    if (!texts.length)
      throw userError(
        "No hay archivos CSV en lo que has subido. Exporta la grabación como «Zipped CSV».",
      );
    state.session = sessionFromCsv(texts);
    state.epoch = null;
    if (state.videoCtl) state.videoCtl.resetSync();
    state.source = "file";
    state.tandaId = null;
    state.fileName = files.length === 1 ? files[0].name : files.length + " archivos";
    runAnalysis();
  } catch (e) {
    showError(e);
  }
}

// Tanda guardada en el garaje de este Mac (?tanda=<id>), con la línea de meta que tenía el móvil.
export async function loadFromGarage(id: string): Promise<void> {
  setStatus("Leyendo la tanda guardada…");
  try {
    const r = await fetch("/api/tandas/" + encodeURIComponent(id) + "/archivos", {
      cache: "no-store",
    });
    if (!r.ok)
      throw userError(
        r.status === 404
          ? "Esa tanda todavía no tiene datos en el garaje."
          : "El garaje no ha podido leer esa tanda.",
      );
    const data = (await r.json()) as ArchivosTanda;
    const fin = data.meta && data.meta.meta;
    if (fin && isNum(fin.osm) && isNum(fin.rev)) state.finish = { osm: fin.osm, rev: fin.rev };
    // El objetivo de quien rodó (cada piloto pone el suyo en el móvil).
    const obj = data.meta && data.meta.objetivo;
    if (isNum(obj) && obj >= 40 && obj <= 200) {
      state.target = obj;
      $<HTMLInputElement>("target").value = fmtLap(obj, 1);
    }
    state.session = sessionFromCsv(data.files);
    state.source = "file";
    state.tandaId = id;
    // Inicio de la grabación (ms): con él se sincroniza un vídeo de GoPro por su hora.
    state.epoch = isNum(data.epoch) ? data.epoch : null;
    if (state.videoCtl) state.videoCtl.resetSync();
    loadDayRefs(id);
    state.fileName =
      "Tanda del " +
      new Date(Number(data.epoch)).toLocaleString("es-ES", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }) +
      (data.meta && data.meta.piloto ? " · " + data.meta.piloto : "");
    runAnalysis();
  } catch (e) {
    showError(e);
  }
}

export function loadDemo(): void {
  state.session = demoSession({ seed: 7 }).session;
  state.source = "demo";
  state.tandaId = null;
  state.fileName = "Ejemplo";
  state.epoch = null;
  if (state.videoCtl) state.videoCtl.resetSync();
  runAnalysis();
}
