// Dos vueltas a lo largo de la pista (metros desde meta): arriba, la velocidad de las dos (la mejor en morado, la
// vuelta que se mira en naranja, el objetivo en gris discontinuo); debajo, lo que la vuelta que se mira lleva perdido
// (rojo, hacia arriba) o ganado (verde, hacia abajo) hasta cada metro. Rayas finas en cada curva, con su nombre abajo.
// Al deslizar el dedo (o con las flechas), una raya vertical con los puntos de las dos y lo de ese metro encima.
import { AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { scaleLinear } from "@visx/scale";
import { Area, LinePath } from "@visx/shape";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmt, fmtSigned } from "../../lib/format";
import {
  indexAtMeters,
  readoutAt,
  type CompareNames,
  type CompareSeries,
  type CornerMark,
} from "./lap-compare";
import { niceStep, spacedLabels, stepsBetween } from "./ticks";
import { useChartWidth } from "./useChartWidth";

// Qué es cada línea (su color en charts.css).
export type SeriesKind = "best" | "lap" | "model";

const M = { top: 12, right: 12, left: 46 };
const SPEED_H = 150;
const GAP = 16;
const DELTA_H = 70;
const AXIS_H = 22;
const H = M.top + SPEED_H + GAP + DELTA_H + AXIS_H;
const DELTA_TOP = M.top + SPEED_H + GAP;
const DELTA_BOTTOM = DELTA_TOP + DELTA_H;
// Escalas de la diferencia de tiempo (± s).
const DELTA_STEPS = [0.2, 0.5, 1, 2, 3, 5, 10, 20];

const CLASS: Record<SeriesKind, string> = { best: "ch-best", lap: "ch-lap", model: "ch-model" };

interface Props {
  cs: CompareSeries;
  subKind: SeriesKind;
  refKind: SeriesKind;
  names: CompareNames;
  corners: readonly CornerMark[];
}

function finiteRange(...arrs: ArrayLike<number>[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrs)
    for (let i = 0; i < a.length; i++)
      if (Number.isFinite(a[i])) {
        if (a[i] < lo) lo = a[i];
        if (a[i] > hi) hi = a[i];
      }
  return lo <= hi ? [lo, hi] : null;
}

export function LapCompareChart({ cs, subKind, refKind, names, corners }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useChartWidth(box);
  const [at, setAt] = useState<number | null>(null);
  const clip = "ch" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const m = cs.s.length;

  const geo = useMemo(() => {
    if (width <= 0 || m < 2) return null;
    const x = scaleLinear<number>({ domain: [0, cs.L], range: [M.left, width - M.right] });
    const vr = finiteRange(cs.ref, cs.sub) || [0, 100];
    const vLo = Math.max(0, Math.floor((vr[0] - 5) / 20) * 20);
    const vHi = Math.max(vLo + 20, Math.ceil((vr[1] + 5) / 20) * 20);
    const v = scaleLinear<number>({ domain: [vLo, vHi], range: [M.top + SPEED_H, M.top] });
    const vTicks = stepsBetween(vLo, vHi, niceStep(vHi - vLo, 4));
    const dr = finiteRange(cs.delta);
    const dMax = dr ? Math.max(Math.abs(dr[0]), Math.abs(dr[1])) : 0;
    const dm = DELTA_STEPS.find((s) => s >= dMax * 1.1) || Math.ceil(dMax);
    const d = scaleLinear<number>({ domain: [-dm, dm], range: [DELTA_BOTTOM, DELTA_TOP] });
    return { x, v, vTicks, d, dm };
  }, [cs, width, m]);

  // Lo que no cambia al deslizar el dedo.
  const base = useMemo(() => {
    if (!geo) return null;
    const { x, v, vTicks, d, dm } = geo;
    const idx = Array.from({ length: m }, (_, i) => i);
    const xi = (i: number) => x(cs.s[i]);
    const marks = corners.filter((c) => c.s >= 0 && c.s <= cs.L).sort((a, b) => a.s - b.s);
    const meters = marks.length
      ? []
      : stepsBetween(0, cs.L, niceStep(cs.L, 5)).filter((s) => s > 0);
    const xLabels = marks.length
      ? marks.map((c) => ({ x: x(c.s), text: c.label }))
      : meters.map((s) => ({ x: x(s), text: fmt(s, 0) + " m" }));
    const keep = spacedLabels(
      xLabels.map((l) => l.x),
      24,
    );
    const zero = d(0);
    const plotW = width - M.left - M.right;
    const dFmt = (s: number) => (s === 0 ? "0" : fmtSigned(s, dm < 1 ? 1 : 0) + " s");
    return (
      <>
        <defs>
          <clipPath id={clip + "-up"}>
            <rect x={M.left} y={DELTA_TOP} width={plotW} height={Math.max(0, zero - DELTA_TOP)} />
          </clipPath>
          <clipPath id={clip + "-dn"}>
            <rect x={M.left} y={zero} width={plotW} height={Math.max(0, DELTA_BOTTOM - zero)} />
          </clipPath>
        </defs>
        <GridRows scale={v} tickValues={vTicks} left={M.left} width={plotW} className="ch-grid" />
        {marks.map((c) => (
          <line
            key={"g" + c.label + c.s}
            className="ch-guide"
            x1={x(c.s)}
            x2={x(c.s)}
            y1={M.top}
            y2={DELTA_BOTTOM}
          />
        ))}
        <AxisLeft
          scale={v}
          left={M.left}
          tickValues={vTicks}
          tickFormat={(t) => fmt(Number(t), 0)}
          hideAxisLine
          hideTicks
          tickLabelProps={{ dx: -4, textAnchor: "end", verticalAnchor: "middle" }}
        />
        <text x={4} y={M.top - 2}>
          km/h
        </text>
        <line className="ch-zero" x1={M.left} x2={width - M.right} y1={zero} y2={zero} />
        <AxisLeft
          scale={d}
          left={M.left}
          tickValues={[dm, 0, -dm]}
          tickFormat={(t) => dFmt(Number(t))}
          hideAxisLine
          hideTicks
          tickLabelProps={{ dx: -4, textAnchor: "end", verticalAnchor: "middle" }}
        />
        <LinePath
          data={idx}
          x={xi}
          y={(i) => v(cs.ref[i])}
          defined={(i) => Number.isFinite(cs.ref[i])}
          className={"ch-line " + CLASS[refKind]}
        />
        <LinePath
          data={idx}
          x={xi}
          y={(i) => v(cs.sub[i])}
          defined={(i) => Number.isFinite(cs.sub[i])}
          className={"ch-line " + CLASS[subKind]}
        />
        {(["up", "dn"] as const).map((side) => (
          <g key={side} clipPath={`url(#${clip}-${side})`}>
            <Area
              data={idx}
              x={xi}
              y0={zero}
              y1={(i) => d(cs.delta[i])}
              defined={(i) => Number.isFinite(cs.delta[i])}
              className={side === "up" ? "ch-loss" : "ch-gain"}
            />
            <LinePath
              data={idx}
              x={xi}
              y={(i) => d(cs.delta[i])}
              defined={(i) => Number.isFinite(cs.delta[i])}
              className={"ch-line " + (side === "up" ? "ch-loss" : "ch-gain")}
            />
          </g>
        ))}
        {xLabels.map((l, i) =>
          keep[i] ? (
            <text key={"x" + i} x={l.x} y={H - 6} textAnchor="middle">
              {l.text}
            </text>
          ) : null,
        )}
      </>
    );
  }, [geo, cs, m, corners, width, clip, subKind, refKind]);

  const cur = at !== null && at < m ? at : null;
  const text =
    cur === null
      ? "Desliza el dedo por la gráfica para ver cada punto de la vuelta."
      : readoutAt(cs, cur, names, corners);

  const moveTo = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * width) / Math.max(1, r.width);
    const s = geo.x.invert(Math.max(M.left, Math.min(width - M.right, px)));
    setAt(indexAtMeters(cs.s, s));
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura: sigue mientras esté encima */
    }
    moveTo(e);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.buttons || e.pointerType === "mouse") moveTo(e);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = Math.max(1, Math.round(m / 100));
    const page = Math.max(1, Math.round(m / 10));
    const from = cur === null ? 0 : cur;
    const to: Record<string, number> = {
      ArrowRight: from + step,
      ArrowUp: from + step,
      ArrowLeft: from - step,
      ArrowDown: from - step,
      PageUp: from + page,
      PageDown: from - page,
      Home: 0,
      End: m - 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    setAt(Math.max(0, Math.min(m - 1, to[e.key])));
  };

  const cursor =
    geo && cur !== null ? (
      <g>
        <line
          className="ch-cursor"
          x1={geo.x(cs.s[cur])}
          x2={geo.x(cs.s[cur])}
          y1={M.top}
          y2={DELTA_BOTTOM}
        />
        {Number.isFinite(cs.ref[cur]) ? (
          <circle
            className={"ch-mark " + refKind}
            cx={geo.x(cs.s[cur])}
            cy={geo.v(cs.ref[cur])}
            r={4.5}
          />
        ) : null}
        {Number.isFinite(cs.sub[cur]) ? (
          <circle
            className={"ch-mark " + subKind}
            cx={geo.x(cs.s[cur])}
            cy={geo.v(cs.sub[cur])}
            r={4.5}
          />
        ) : null}
        {Number.isFinite(cs.delta[cur]) ? (
          <circle
            className={"ch-mark " + (cs.delta[cur] > 0 ? "loss" : "gain")}
            cx={geo.x(cs.s[cur])}
            cy={geo.d(cs.delta[cur])}
            r={4.5}
          />
        ) : null}
      </g>
    ) : null;

  return (
    <div className="ch-plot" ref={box}>
      <p className={"ch-readout" + (cur === null ? " hint" : "")} aria-live="polite">
        {text}
      </p>
      {base && geo ? (
        <svg
          className="ch-svg"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="slider"
          tabIndex={0}
          aria-label="Velocidad y diferencia de tiempo a lo largo de la vuelta"
          aria-valuemin={0}
          aria-valuemax={Math.round(cs.L)}
          aria-valuenow={Math.round(cur === null ? 0 : cs.s[cur])}
          aria-valuetext={text}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onKeyDown={onKey}
        >
          {base}
          {cursor}
        </svg>
      ) : null}
    </div>
  );
}
