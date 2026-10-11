// «Inclinación a cada lado»: cuántas curvas a izquierdas (barras hacia la izquierda) y a derechas (hacia la derecha) en
// cada tramo de inclinación máxima, del menos al más tumbado hacia arriba, con los colores del mapa «por inclinación».
// Arriba, lo más tumbado de cada lado. Al tocar una barra (o con las flechas), lo de esa barra encima. La tabla de
// curvas de debajo es la vista en tabla.
import { BarRounded } from "@visx/shape";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { leanReadout, leanSummary, maxText, type LeanSides } from "./lean-sides";
import { useChartWidth } from "./useChartWidth";

const HEAD = 22;
const ROW = 30;
const BAR = 16;
const LABEL_W = 64;
const M = { left: 10, right: 10, bottom: 4 };

type Side = "left" | "right";

interface Props {
  id: string;
  data: LeanSides | null;
  // Lo más tumbado de la ruta a cada lado (los del resumen).
  maxLeft: number | null;
  maxRight: number | null;
}

export function LeanSidesChart({ id, data, maxLeft, maxRight }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useChartWidth(box);
  const [pick, setPick] = useState<{ band: number; side: Side } | null>(null);
  const rows = data ? data.bands.length : 0;
  const H = HEAD + rows * ROW + M.bottom;

  const geo = useMemo(() => {
    if (!data || width <= 0) return null;
    const mid = width / 2;
    const half = Math.max(10, mid - LABEL_W / 2 - M.left - 28);
    const most = Math.max(1, ...data.bands.map((b) => Math.max(b.left, b.right)));
    const len = (n: number) => (half * n) / most;
    // De abajo (menos tumbado) arriba (más tumbado).
    const yOf = (k: number) => HEAD + (rows - 1 - k) * ROW + (ROW - BAR) / 2;
    return { mid, len, yOf };
  }, [data, width, rows]);

  const base = useMemo(() => {
    if (!data || !geo) return null;
    const { mid, len, yOf } = geo;
    const l0 = mid - LABEL_W / 2;
    const r0 = mid + LABEL_W / 2;
    return (
      <>
        <text x={M.left} y={14} className="ch-strong">
          {"Izquierda · " + maxText(maxLeft)}
        </text>
        <text x={width - M.right} y={14} textAnchor="end" className="ch-strong">
          {"Derecha · " + maxText(maxRight)}
        </text>
        {data.bands.map((b, k) => {
          const y = yOf(k);
          const wl = len(b.left);
          const wr = len(b.right);
          return (
            <g key={b.label}>
              <text x={mid} y={y + BAR / 2 + 4} textAnchor="middle">
                {b.label}
              </text>
              {b.left ? (
                <>
                  <BarRounded
                    x={l0 - wl}
                    y={y}
                    width={wl}
                    height={BAR}
                    radius={4}
                    left
                    fill={b.color}
                  />
                  <text x={l0 - wl - 5} y={y + BAR / 2 + 4} textAnchor="end" className="ch-strong">
                    {String(b.left)}
                  </text>
                </>
              ) : null}
              {b.right ? (
                <>
                  <BarRounded
                    x={r0}
                    y={y}
                    width={wr}
                    height={BAR}
                    radius={4}
                    right
                    fill={b.color}
                  />
                  <text x={r0 + wr + 5} y={y + BAR / 2 + 4} className="ch-strong">
                    {String(b.right)}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </>
    );
  }, [data, geo, width, maxLeft, maxRight]);

  // También una barra vacía («0 curvas»): con las flechas se pasa por todas.
  const cur = pick && data && pick.band < data.bands.length ? pick : null;
  const text = !data
    ? ""
    : cur
      ? leanReadout(data.bands[cur.band], cur.side)
      : "Toca una barra para ver sus curvas.";

  // La barra bajo el dedo: el lado por la mitad en que cae y el tramo por la fila.
  const pickAt = (e: PointerEvent<SVGSVGElement>) => {
    if (!data || !geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.max(1, r.width) / width;
    const px = (e.clientX - r.left) / k;
    const py = (e.clientY - r.top) / k;
    const row = Math.floor((py - HEAD) / ROW);
    if (row < 0 || row >= rows) return;
    setPick({ band: rows - 1 - row, side: px < geo.mid ? "left" : "right" });
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura: sigue mientras esté encima */
    }
    pickAt(e);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.buttons || e.pointerType === "mouse") pickAt(e);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!rows) return;
    const at = cur || { band: 0, side: "left" as Side };
    const moves: Record<string, { band: number; side: Side }> = {
      ArrowUp: { band: Math.min(rows - 1, at.band + 1), side: at.side },
      ArrowDown: { band: Math.max(0, at.band - 1), side: at.side },
      ArrowLeft: { band: at.band, side: "left" },
      ArrowRight: { band: at.band, side: "right" },
    };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    setPick(to);
  };

  return (
    <div className="ch" id={id} ref={box} data-chart="" data-empty={data ? undefined : ""}>
      <p className={"ch-readout" + (cur ? "" : " hint")} aria-live="polite">
        {text}
      </p>
      {base && geo && data ? (
        <svg
          className="ch-svg"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={leanSummary(data)}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onKeyDown={onKey}
        >
          {base}
          {/* Una barra vacía no lleva aro: lo dice la línea de encima («0 curvas»). */}
          {cur && data.bands[cur.band][cur.side] ? (
            <rect
              className="ch-pick"
              x={
                cur.side === "left"
                  ? geo.mid - LABEL_W / 2 - geo.len(data.bands[cur.band].left) - 3
                  : geo.mid + LABEL_W / 2 - 3
              }
              y={geo.yOf(cur.band) - 3}
              width={geo.len(data.bands[cur.band][cur.side]) + 6}
              height={BAR + 6}
              rx={6}
            />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
