// Comparativa del día entre pilotos: mejor vuelta, sectores, curvas y todas las vueltas.
// La pintan el móvil (boxes) y el garaje del Mac con los datos que calcula el garaje (/api/dia). Aquí, lo que se
// enseña (textos, celdas y quién va mejor), sin DOM: lo pinta ui/draw/comparativa.ts.

// ---------- lo que manda el garaje (/api/dia) ----------

// Una curva del circuito (nombres de las curvas del día).
export interface CurvaDia {
  num?: number;
  name: string;
}

// Lo mejor de un piloto en una curva: velocidad mínima (km/h), tumbada máxima (°) y frenada máxima (g).
export interface CurvaPiloto {
  name?: string;
  vMin: number | null;
  leanMax: number | null;
  peakG: number | null;
}

// Una vuelta de la lista: su tiempo (s), con su inclinación máxima (°) y su velocidad punta (km/h).
export interface VueltaLista {
  time: number;
  leanMax?: number | null;
  vMax?: number | null;
}

export interface PilotoDia {
  piloto: string;
  tandas: number;
  vueltas: number;
  // s
  mejor: number;
  ideal: number;
  media3: number;
  // El mejor tiempo de cada sector (s).
  sectores: number[];
  curvas: CurvaPiloto[];
  // Máximos del día: inclinación (°) y velocidad punta (km/h).
  leanMax?: number | null;
  vMax?: number | null;
  // Todas sus vueltas (de garajes antiguos, solo el tiempo).
  lista: (number | VueltaLista)[];
}

// Vueltas en el otro sentido, que no entran en la comparativa.
export interface OtroSentido {
  sentido: string;
  vueltas: number;
}

export interface DiaComparativa {
  // AAAAMMDD; null: aún no hay ningún día.
  fecha: string | null;
  // «osm»: antihorario.
  sentido?: string | null;
  curvas?: CurvaDia[];
  // Ordenados por la mejor vuelta.
  pilotos: PilotoDia[];
  // Los móviles tenían la meta en sitios distintos: todo medido con la de metaDe.
  metaIgualada?: boolean;
  metaDe?: string[] | null;
  otros?: OtroSentido[];
  analizando?: boolean;
  calculado?: string;
  dias?: string[];
}

// ---------- lo que se enseña ----------

// Cabecera de una columna: texto, clase (num: alineada a la derecha) y debajo, en pequeño, sub ("" sin nada).
export interface HeadCell {
  text: string;
  cls: string;
  sub: string;
}

// Una celda: el valor y, debajo, la diferencia con el mejor ("" sin nada); top: es el mejor.
export interface Cell {
  main: string;
  sub: string;
  top: boolean;
}

export interface Row {
  who: string;
  cells: Cell[];
}

// Una vuelta de la lista: su tiempo, si es la mejor y, debajo, inclinación y punta (null sin ninguna).
export interface LapChip {
  time: string;
  top: boolean;
  sub: string | null;
}

// Lo que se pinta, en orden: el aviso de que no hay nada, la cabecera, tablas (con su título), notas, títulos sueltos
// y la fila de vueltas de cada piloto.
export type Block =
  | { kind: "empty"; text: string }
  | { kind: "head"; text: string }
  | { kind: "table"; title: string; head: HeadCell[]; rows: Row[] }
  | { kind: "note"; text: string }
  | { kind: "title"; text: string }
  | { kind: "laps"; piloto: string; laps: LapChip[] };

export type Decimals = 0 | 1 | 2 | 3;

const NF = [0, 1, 2, 3].map(
  (d) =>
    new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
);

// Un número con d decimales, como se escribe en España; «—» si no lo hay.
export function fmt(x: number | null | undefined, d: Decimals): string {
  return x === null || x === undefined || !isFinite(x) ? "—" : NF[d].format(x);
}

// Tiempo de vuelta (s) como m:ss,cc, redondeado a la centésima; «—» si no lo hay.
export function fmtLap(t: number | null | undefined): string {
  if (t === null || t === undefined || !isFinite(t)) return "—";
  const tc = Math.round(t * 100) / 100;
  const m = Math.floor(tc / 60);
  const s = tc - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + fmt(s, 2);
}

// Diferencia con el mejor (+0,12); nada si no llega a media centésima.
export function gap(d: number): string {
  return d >= 0.005 ? "+" + fmt(d, 2) : "";
}

// El día AAAAMMDD como «viernes, 9 de octubre».
export function dayLabel(f: string): string {
  const d = new Date(Number(f.slice(0, 4)), Number(f.slice(4, 6)) - 1, Number(f.slice(6, 8)));
  return d.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const finite = (x: unknown): x is number => Number.isFinite(x);
const head = (text: string, cls = "", sub = ""): HeadCell => ({ text, cls, sub });
const plain = (main: string): Cell => ({ main, sub: "", top: false });

// Todo lo que enseña la comparativa de un día, en orden.
export function comparativaBlocks(d: DiaComparativa | null | undefined): Block[] {
  const out: Block[] = [];
  const P = (d && d.pilotos) || [];
  if (!d || !d.fecha || !P.length) {
    out.push({
      kind: "empty",
      text:
        d && d.analizando
          ? "El Mac está analizando las últimas tandas…"
          : "Todavía no hay vueltas en el garaje.",
    });
    return out;
  }
  const many = P.length > 1;
  out.push({
    kind: "head",
    text:
      dayLabel(d.fecha) +
      " · " +
      (d.sentido === "osm" ? "antihorario" : "horario") +
      " · " +
      P.length +
      (P.length === 1 ? " piloto" : " pilotos") +
      (d.analizando ? " · actualizando…" : ""),
  });

  // 1. Mejor vuelta
  out.push({
    kind: "table",
    title: "Mejor vuelta",
    head: [
      head("Piloto"),
      head("Mejor", "num"),
      head("Ideal", "num"),
      head("Media", "num"),
      head("Vueltas", "num"),
    ],
    rows: P.map((p, i) => ({
      who: p.piloto,
      cells: [
        {
          main: fmtLap(p.mejor),
          sub: i ? gap(p.mejor - P[0].mejor) : many ? "el más rápido" : "",
          top: many && !i,
        },
        plain(fmtLap(p.ideal)),
        plain(fmtLap(p.media3)),
        {
          main: String(p.vueltas),
          sub: p.tandas + (p.tandas === 1 ? " tanda" : " tandas"),
          top: false,
        },
      ],
    })),
  });
  out.push({
    kind: "note",
    text: "Ideal: la suma de los mejores sectores de cada uno. Media: de sus tres mejores vueltas.",
  });

  // 2. Sectores
  const nSec = P[0].sectores.length;
  const curv = d.curvas || [];
  const bestSec: number[] = [];
  for (let k = 0; k < nSec; k++) bestSec.push(Math.min(...P.map((p) => p.sectores[k])));
  out.push({
    kind: "table",
    title: "Sectores (el mejor de cada uno)",
    head: [
      head("Piloto"),
      ...bestSec.map((_, k) => head("S" + (k + 1), "num", curv[k] ? curv[k].name : "")),
    ],
    rows: P.map((p) => ({
      who: p.piloto,
      cells: p.sectores.map((s, k) => {
        const top = many && s - bestSec[k] < 0.005;
        return { main: fmt(s, 2), sub: top ? "" : gap(s - bestSec[k]), top };
      }),
    })),
  });
  if (many) {
    const wins = bestSec.map((b, k) => {
      const w = P.filter((p) => p.sectores[k] - b < 0.005).map((p) => p.piloto);
      return "S" + (k + 1) + " " + w.join(" y ");
    });
    out.push({ kind: "note", text: "Más rápido en cada sector: " + wins.join(" · ") + "." });
  }

  // Máximos del día
  if (P.some((p) => Number.isFinite(p.leanMax) || Number.isFinite(p.vMax))) {
    const top = (key: "leanMax" | "vMax") => Math.max(...P.map((p) => p[key]).filter(finite));
    const topLean = top("leanMax");
    const topV = top("vMax");
    out.push({
      kind: "table",
      title: "Máximos del día",
      head: [head("Piloto"), head("Inclinación", "num"), head("Velocidad punta", "num")],
      rows: P.map((p) => ({
        who: p.piloto,
        cells: [
          {
            main: Number.isFinite(p.leanMax) ? fmt(p.leanMax, 0) + "°" : "—",
            sub: "",
            top: many && p.leanMax === topLean,
          },
          {
            main: Number.isFinite(p.vMax) ? fmt(p.vMax, 0) + " km/h" : "—",
            sub: "",
            top: many && p.vMax === topV,
          },
        ],
      })),
    });
  }

  // 3. Curvas
  out.push({
    kind: "table",
    title: "Curvas (lo mejor de cada uno)",
    head: [head("Curva"), ...P.map((p) => head(p.piloto, "num"))],
    rows: curv.map((c, k) => {
      const vs = P.map((p) => (p.curvas[k] ? p.curvas[k].vMin : null));
      const top = Math.max(...vs.filter((v) => v !== null));
      return {
        who: "C" + (k + 1) + " " + c.name,
        cells: P.map((p, i) => {
          const cc: Partial<CurvaPiloto> = p.curvas[k] || {};
          return {
            main: vs[i] === null ? "—" : fmt(vs[i], 0) + " km/h",
            sub:
              (cc.leanMax !== null && cc.leanMax !== undefined ? fmt(cc.leanMax, 0) + "° · " : "") +
              (cc.peakG !== null && cc.peakG !== undefined ? fmt(cc.peakG, 2) + " g" : ""),
            top: many && vs[i] !== null && vs[i] === top,
          };
        }),
      };
    }),
  });
  out.push({
    kind: "note",
    text: "Velocidad mínima en la curva (marcada la más alta), tumbada máxima y frenada máxima.",
  });

  // 4. Todas las vueltas, cada una con su inclinación máxima y su velocidad punta
  out.push({ kind: "title", text: "Todas las vueltas" });
  for (const p of P)
    out.push({
      kind: "laps",
      piloto: p.piloto,
      laps: p.lista.map((raw) => {
        const v: VueltaLista = typeof raw === "number" ? { time: raw } : raw;
        return {
          time: fmtLap(v.time),
          top: v.time === p.mejor,
          sub:
            Number.isFinite(v.leanMax) || Number.isFinite(v.vMax)
              ? (Number.isFinite(v.leanMax) ? fmt(v.leanMax, 0) + "°" : "—") +
                " · " +
                (Number.isFinite(v.vMax) ? fmt(v.vMax, 0) : "—")
              : null,
        };
      }),
    });
  out.push({
    kind: "note",
    text: "Debajo de cada vuelta: inclinación máxima y velocidad punta (km/h).",
  });
  if (d.metaIgualada)
    out.push({
      kind: "note",
      text:
        "Los móviles tenían la línea de meta en sitios distintos: vueltas y sectores se han medido para todos con la " +
        (d.metaDe && d.metaDe.length ? "de " + d.metaDe.join(" y ") : "misma") +
        ". Para que coincida siempre, poned la meta en el mismo sitio en Ajustes.",
    });
  for (const o of d.otros || [])
    out.push({
      kind: "note",
      text:
        "Hay además " +
        o.vueltas +
        " vueltas en sentido " +
        (o.sentido === "osm" ? "antihorario" : "horario") +
        " que no entran en la comparativa.",
    });
  return out;
}
