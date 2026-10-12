// Tiempos por vuelta (o por 8, con OCHO_WORDS): un punto por vuelta unidos por una raya tenue (la mejor en morado, con
// su tiempo al lado), la raya discontinua del objetivo y, al tocar un punto (o con las flechas), lo de esa vuelta
// encima. Las vueltas muy lentas se quedan en el tope con un triángulo (lap-times.ts). La tabla de vueltas lleva los
// mismos números.
import { AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LAP_WORDS, lapReadout, lapTimesScale, type LapPoint, type TimeWords } from "./lap-times";
import { spacedLabels } from "./ticks";
import { useChartWidth } from "./useChartWidth";

const H = 176;
const M = { top: 16, right: 14, bottom: 24, left: 46 };
// Aire a los lados para que el primer y el último punto no queden pegados al borde.
const SIDE = 14;

interface Props {
  // El de su caja (data-chart: las pruebas que comparan con la app de antes no miran dentro).
  id: string;
  laps: readonly LapPoint[];
  target: number | null;
  // Cómo se llama y se escribe cada punto (sin ello, vueltas de un circuito; los ochos llevan OCHO_WORDS).
  words?: TimeWords;
}

export function LapTimesChart({ id, laps, target, words = LAP_WORDS }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useChartWidth(box);
  const [pick, setPick] = useState<number | null>(null);
  const sc = useMemo(() => lapTimesScale(laps, target, words), [laps, target, words]);
  const n = laps.length;
  const geo = useMemo(() => {
    if (!sc || width <= 0) return null;
    const x0 = M.left + SIDE;
    const x1 = Math.max(x0 + 1, width - M.right - SIDE);
    const xOf = (i: number) => (n > 1 ? x0 + ((x1 - x0) * i) / (n - 1) : (x0 + x1) / 2);
    const y = scaleLinear<number>({ domain: [sc.lo, sc.hi], range: [H - M.bottom, M.top] });
    // Las muy lentas, en el tope.
    const yOf = (t: number) => y(sc.capAt !== null && t > sc.capAt ? sc.hi : t);
    return { xOf, y, yOf };
  }, [sc, width, n]);

  // Lo que no cambia al tocar: rejilla, ejes, la raya, los puntos, la mejor y el objetivo.
  const base = useMemo(() => {
    if (!sc || !geo) return null;
    const { xOf, y, yOf } = geo;
    const xs = laps.map((_, i) => xOf(i));
    const label = spacedLabels(xs, 20);
    const bestI = laps.findIndex((l) => l.best);
    const bestY = bestI >= 0 ? yOf(laps[bestI].time) : 0;
    return (
      <>
        <GridRows
          scale={y}
          tickValues={sc.ticks}
          left={M.left}
          width={width - M.left - M.right}
          className="ch-grid"
        />
        <AxisLeft
          scale={y}
          left={M.left}
          tickValues={sc.ticks}
          tickFormat={(v) => words.time(Number(v), sc.decimals)}
          hideAxisLine
          hideTicks
          tickLabelProps={{ dx: -4, textAnchor: "end", verticalAnchor: "middle" }}
        />
        {sc.showTarget && target !== null ? (
          <g>
            <line
              className="ch-target"
              x1={M.left}
              x2={width - M.right}
              y1={y(target)}
              y2={y(target)}
            />
            <text
              className="ch-target-label"
              x={width - M.right}
              y={y(target) - 5}
              textAnchor="end"
            >
              {"Objetivo " + words.time(target)}
            </text>
          </g>
        ) : null}
        <LinePath
          data={laps as LapPoint[]}
          x={(_, i) => xOf(i)}
          y={(l) => yOf(l.time)}
          defined={(l) => Number.isFinite(l.time)}
          className="ch-line ch-trend"
        />
        {laps.map((l, i) =>
          sc.capAt !== null && l.time > sc.capAt ? (
            <path
              key={l.num}
              className="ch-dot"
              d={`M${xOf(i) - 5},${M.top + 6}L${xOf(i) + 5},${M.top + 6}L${xOf(i)},${M.top - 2}Z`}
            />
          ) : (
            <circle
              key={l.num}
              className={"ch-dot" + (l.best ? " best" : "")}
              cx={xOf(i)}
              cy={yOf(l.time)}
              r={l.best ? 5 : 4}
            />
          ),
        )}
        {bestI >= 0 ? (
          <text
            className="ch-strong"
            x={xOf(bestI)}
            y={bestY - 10 < M.top + 6 ? bestY + 20 : bestY - 10}
            textAnchor="middle"
          >
            {words.time(laps[bestI].time)}
          </text>
        ) : null}
        {laps.map((l, i) =>
          label[i] ? (
            <text key={"x" + l.num} x={xs[i]} y={H - 6} textAnchor="middle">
              {String(l.num)}
            </text>
          ) : null,
        )}
      </>
    );
  }, [sc, geo, laps, target, width, words]);

  const empty = !sc;
  const at = pick !== null && pick < n ? pick : null;
  const text = at === null ? words.hint : lapReadout(laps, at, words);

  // La vuelta más cercana al dedo (en horizontal).
  const pickAt = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo || !n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * width) / Math.max(1, r.width);
    let best = 0;
    for (let i = 1; i < n; i++)
      if (Math.abs(geo.xOf(i) - px) < Math.abs(geo.xOf(best) - px)) best = i;
    setPick(best);
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
    const next = at === null ? 0 : Math.min(n - 1, at + 1);
    const prev = at === null ? n - 1 : Math.max(0, at - 1);
    const to: Record<string, number> = {
      ArrowRight: next,
      ArrowUp: next,
      ArrowLeft: prev,
      ArrowDown: prev,
      Home: 0,
      End: n - 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    setPick(to[e.key]);
  };

  return (
    <div className="ch" id={id} ref={box} data-chart="" data-empty={empty ? "" : undefined}>
      <p className={"ch-readout" + (at === null ? " hint" : "")} aria-live="polite">
        {empty ? "" : text}
      </p>
      {base && geo ? (
        <svg
          className="ch-svg"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="slider"
          tabIndex={0}
          aria-label={words.aria}
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={
            (at === null
              ? Math.max(
                  0,
                  laps.findIndex((l) => l.best),
                )
              : at) + 1
          }
          aria-valuetext={text}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onKeyDown={onKey}
        >
          {base}
          {at !== null ? (
            <circle
              className="ch-pick"
              cx={geo.xOf(at)}
              cy={
                sc && sc.capAt !== null && laps[at].time > sc.capAt
                  ? M.top + 2
                  : geo.yOf(laps[at].time)
              }
              r={9}
            />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
