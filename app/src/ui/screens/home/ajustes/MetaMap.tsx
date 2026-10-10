// El circuito de Maspalomas para poner la línea de meta donde la tenga el cronometraje del circuito o RaceChrono:
// tocar la pista la mueve ahí (en los dos sentidos) y la portada se vuelve a pintar (la mejor vuelta guardada es la de
// esa meta).
import type { MouseEvent } from "react";
import { refreshHome } from "../../../../app/ui-store";
import { MASPA_GEO } from "../../../../core/maspalomas";
import { useSettings } from "../../../../runtime/settings";
import { useRuntime } from "../../../runtime-context";
import { finishAt, finishMark, metaViewBox, nearestPoint, roadPath } from "./meta";

const C = MASPA_GEO.main;
const VIEW_BOX = metaViewBox(C);
const ROAD = roadPath(C);

export function MetaMap() {
  const { settings } = useRuntime();
  const osm = useSettings(settings, (s) => s.finish.osm);
  const mark = finishMark(C, osm);
  const pick = (ev: MouseEvent<SVGSVGElement>) => {
    const root = ev.currentTarget;
    const m = root.getScreenCTM();
    if (!m) return;
    const pt = root.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const q = pt.matrixTransform(m.inverse());
    const i = nearestPoint(C, q.x, q.y);
    if (i === null) return;
    settings.update({ finish: finishAt(C, i) });
    refreshHome();
  };
  return (
    <svg
      id="meta-svg"
      role="img"
      aria-label="Mapa del circuito para elegir la línea de meta"
      viewBox={VIEW_BOX}
      onClick={pick}
    >
      <path d={ROAD} className="m-road" />
      {mark && (
        <>
          <line x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} className="m-finish" />
          <text x={mark.tx} y={mark.ty} className="m-text">
            Meta
          </text>
        </>
      )}
    </svg>
  );
}
