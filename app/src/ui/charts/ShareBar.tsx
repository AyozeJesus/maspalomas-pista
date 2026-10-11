// Una barra partida: cuánto del total es cada cosa (por ejemplo, el rato frenando, acelerando, sin gas en curva…), con
// el % dentro de cada trozo si cabe y, al tocar un trozo (o con las flechas), su nombre, su % y su tiempo encima. La
// leyenda y la nota de la tarjeta dicen lo mismo con palabras.
import { BarRounded } from "@visx/shape";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { placeSegments, shareReadout, type ShareSegment } from "./share";
import { useChartWidth } from "./useChartWidth";

const H = 30;
const BAR = 22;
const TOP = 4;

interface Props {
  id: string;
  label: string;
  segments: readonly ShareSegment[];
}

export function ShareBar({ id, label, segments }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useChartWidth(box);
  const [pick, setPick] = useState<string | null>(null);
  const placed = useMemo(() => placeSegments(segments, width), [segments, width]);
  // Sin ancho todavía (pantalla oculta), lo que diga es si hay algo que repartir.
  const empty = !segments.some((s) => Number.isFinite(s.value) && s.value > 0);
  const cur = placed.find((s) => s.key === pick) || null;
  const text = empty ? "" : cur ? shareReadout(cur) : "Toca un trozo para ver su tiempo.";

  const pickAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * width) / Math.max(1, r.width);
    const hit = placed.find((s) => px >= s.x - 1 && px <= s.x + s.w + 1);
    if (hit) setPick(hit.key);
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
    if (!placed.length) return;
    const i = cur ? placed.indexOf(cur) : -1;
    const to: Record<string, number> = {
      ArrowRight: Math.min(placed.length - 1, i + 1),
      ArrowLeft: i < 0 ? placed.length - 1 : Math.max(0, i - 1),
      Home: 0,
      End: placed.length - 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    setPick(placed[to[e.key]].key);
  };

  const last = placed.length - 1;
  return (
    <div className="ch" id={id} ref={box} data-chart="" data-empty={empty ? "" : undefined}>
      <p className={"ch-readout" + (cur ? "" : " hint")} aria-live="polite">
        {text}
      </p>
      {placed.length ? (
        <svg
          className="ch-svg ch-bare"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={label + ": " + placed.map((s) => s.label + " " + s.pct + " %").join(", ")}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onKeyDown={onKey}
        >
          {placed.map((s, i) => (
            <g key={s.key}>
              <BarRounded
                x={s.x}
                y={TOP}
                width={s.w}
                height={BAR}
                radius={4}
                left={i === 0}
                right={i === last}
                fill={s.color}
                className={cur && cur.key !== s.key ? "ch-dim" : undefined}
              />
              {s.fits ? (
                <text className="ch-in" x={s.x + s.w / 2} y={TOP + BAR / 2 + 4} textAnchor="middle">
                  {s.pct + " %"}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}
