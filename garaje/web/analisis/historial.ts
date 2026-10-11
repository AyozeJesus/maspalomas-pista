// Tus tandas: el resumen de cada tanda guardada, su lista y la gráfica de la mejor vuelta de cada una. Se guardan en
// tu espacio de la página si se abre como Artifact de claude.ai (window.claude); si no (el garaje), en este navegador.
import type { AnalyzeResult, TelemetryLap } from "../../../app/src/core/maspalomas/types";
import { $, el, svg } from "../dom";
import { userError, type Thrown } from "./avisos";
import { state, validLaps } from "./estado";
import { fmtLap, pathOf } from "./formato";

const LS_KEY = "maspa-telemetria-tandas";

// Lo que se guarda de una tanda (summaryDoc) y, ya guardado, con el id de su documento.
type TandaDoc = ReturnType<typeof summaryDoc>;
type SavedDoc = TandaDoc & { id: string };

// Lo que se usa de la base de datos de claude.ai: una colección por usuario, que avisa de cada cambio.
interface DbCollection {
  doc(id: string): { set(data: TandaDoc): Promise<unknown>; delete(): Promise<unknown> };
  onSnapshot(
    next: (snap: { docs: { id: string; data(): TandaDoc }[] }) => void,
    error: () => void,
  ): unknown;
}
interface Db {
  collection(path: string): DbCollection;
}
interface DbUser {
  id(): Promise<string>;
}

// Dónde se guardan: aún no se sabe (null), en este navegador o en la base de datos (unsub: lo que devuelve
// onSnapshot).
type Store =
  | { kind: null; docs: SavedDoc[] }
  | { kind: "local"; docs: SavedDoc[] }
  | { kind: "db"; col: DbCollection; docs: SavedDoc[]; unsub: unknown };

let store: Store = { kind: null, docs: [] };

export async function initStore(): Promise<void> {
  let db: Db | null;
  let uid: string | null = null;
  try {
    db = window.claude ? ((await window.claude.use("db")) as Db | null) : null;
    const user = window.claude ? ((await window.claude.use("user")) as DbUser | null) : null;
    uid = user ? await user.id() : null;
  } catch {
    db = null;
  }
  if (db && uid) {
    const col = db.collection("data/users/" + uid);
    store = { kind: "db", col, docs: store.docs, unsub: null };
    $("hist-where").textContent =
      "Se guardan en tu espacio privado de esta página: solo los ves tú.";
    store.unsub = col.onSnapshot(
      (snap) => {
        store.docs = snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((d) => d.kind === "maspa-tanda");
        renderHistory();
      },
      () => {
        $("hist-where").textContent = "No se puede leer el historial en este momento.";
      },
    );
  } else {
    store = { kind: "local", docs: store.docs };
    $("hist-where").textContent = "Sin sesión iniciada: se guardan solo en este navegador.";
    store.docs = readLocal();
    renderHistory();
  }
}

function readLocal(): SavedDoc[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as SavedDoc[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: SavedDoc[]): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function summaryDoc(r: AnalyzeResult, best: TelemetryLap) {
  const laps = validLaps();
  const round = (x: number | null, d: number) =>
    x === null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
  return {
    kind: "maspa-tanda",
    savedAt: new Date().toISOString(),
    label: state.fileName,
    dir: r.dir,
    finish: r.track.start,
    target: state.target,
    best: round(best.time, 3),
    ideal: round(r.ideal, 3),
    laps: laps.map((l) => round(l.time, 3)),
    sectors: laps.map((l) => l.sectors.map((s) => round(s, 3))),
    corners: best.corners.map((c) => ({
      num: c.num,
      name: c.name,
      brakeBefore: round(c.brakeBefore, 0),
      peakG: round(c.peakG, 2),
      vMin: round(c.vMin, 0),
      dead: round(c.dead, 2),
      fullAfter: round(c.fullAfter, 0),
      vExit: round(c.vExit, 0),
      leanMax: round(c.leanMax, 0),
    })),
  };
}

export function renderSaveState(): void {
  const btn = $<HTMLButtonElement>("save-btn");
  const ok = state.source === "file" && state.result && state.result.best && !state.saved;
  btn.disabled = !ok;
  btn.textContent = state.saved ? "Guardada" : "Guardar esta tanda";
  btn.title = state.source === "demo" ? "Sube una tanda tuya para guardarla" : "";
}

export async function saveCurrent(): Promise<void> {
  const r = state.result;
  if (!(state.source === "file" && r && r.best) || state.saved) return;
  const doc = summaryDoc(r, r.best);
  const btn = $<HTMLButtonElement>("save-btn");
  btn.disabled = true;
  try {
    if (store.kind === "db") {
      await store.col.doc("t" + Date.now().toString(36)).set(doc);
    } else {
      const list = readLocal();
      list.unshift(Object.assign({ id: "t" + Date.now().toString(36) }, doc));
      if (!writeLocal(list))
        throw userError(
          "El navegador no deja guardar aquí (modo privado o almacenamiento bloqueado).",
        );
      store.docs = list;
      renderHistory();
    }
    state.saved = true;
    renderSaveState();
  } catch (e) {
    btn.disabled = false;
    const t = e as Thrown | null | undefined;
    $("hist-where").textContent =
      t && t.code === "quota_exceeded"
        ? "No queda espacio para más tandas: borra alguna antigua."
        : t && t.user
          ? t.message
          : "No se ha podido guardar la tanda. Inténtalo de nuevo.";
  }
}

async function removeDoc(id: string): Promise<void> {
  try {
    if (store.kind === "db") await store.col.doc(id).delete();
    else {
      const list = readLocal().filter((d) => d.id !== id);
      writeLocal(list);
      store.docs = list;
      renderHistory();
    }
  } catch {
    $("hist-where").textContent = "No se ha podido borrar la tanda. Inténtalo de nuevo.";
  }
}

function renderHistory(): void {
  const list = $("hist-list");
  list.textContent = "";
  const docs = store.docs
    .slice()
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  if (!docs.length) {
    el(
      "li",
      "",
      "Aún no has guardado ninguna tanda. Sube una grabación y pulsa «Guardar esta tanda».",
      list,
    );
  }
  for (const d of docs) {
    const li = el("li", "", null, list);
    const info = el("div", "", null, li);
    const date = new Date(d.savedAt);
    el(
      "div",
      "",
      isNaN(date.getTime())
        ? "Tanda"
        : date.toLocaleDateString("es-ES", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }) +
            " · " +
            (d.label || "tanda"),
      info,
    );
    const sub = el("div", "caption", null, info);
    // Number(): como con el isFinite de siempre, un tiempo guardado como null sale 0:00,00.
    sub.textContent =
      (d.laps ? d.laps.length : 0) +
      " vueltas · ideal " +
      fmtLap(Number(d.ideal)) +
      (d.dir === "rev" ? " · horario" : "");
    el("b", "", fmtLap(Number(d.best)), li);
    const actions = el("div", "", null, li);
    const del = el("button", "", "Borrar", actions);
    del.type = "button";
    del.addEventListener("click", () => {
      actions.textContent = "";
      const c = el("span", "confirm", "¿Borrar?", actions);
      const yes = el("button", "", "Sí", c);
      const no = el("button", "", "No", c);
      yes.type = no.type = "button";
      yes.addEventListener("click", () => removeDoc(d.id));
      no.addEventListener("click", renderHistory);
    });
  }
  renderHistoryChart(docs.slice().reverse());
}

function renderHistoryChart(docs: SavedDoc[]): void {
  const root = $("hist-svg");
  root.textContent = "";
  // Number(): como con el isFinite de siempre, una mejor vuelta guardada como null cuenta como 0.
  const best = (d: SavedDoc) => Number(d.best);
  const pts = docs.filter((d) => isFinite(best(d)));
  const vals = pts.map(best).concat([state.target]);
  const lo = Math.min(...vals) - 0.5;
  const hi = Math.max(...vals) + 0.5;
  const Y = (v: number) => 112 - ((v - lo) / (hi - lo || 1)) * 104;
  const yT = Y(state.target);
  svg(
    "line",
    {
      x1: 0,
      x2: 1000,
      y1: yT,
      y2: yT,
      class: "l-ref",
      "vector-effect": "non-scaling-stroke",
    },
    root,
  );
  if (pts.length < 1) return;
  const xs = pts.map((_, i) => (pts.length === 1 ? 500 : 20 + (i / (pts.length - 1)) * 960));
  svg(
    "path",
    {
      d: pathOf(
        xs,
        pts.map((d) => Y(best(d))),
      ),
      class: "l-lap",
      "vector-effect": "non-scaling-stroke",
    },
    root,
  );
  // Un trazo corto por tanda (los círculos se deformarían con el escalado libre de la gráfica).
  pts.forEach((d, i) =>
    svg(
      "line",
      {
        x1: xs[i],
        x2: xs[i],
        y1: Y(best(d)) - 6,
        y2: Y(best(d)) + 6,
        class: "l-lap",
        "vector-effect": "non-scaling-stroke",
      },
      root,
    ),
  );
}
