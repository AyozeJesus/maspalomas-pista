// «Vuelta en 3D» (repasando una tanda guardada): cada vuelta en el circuito en 3D, como la vuelta de ejemplo, con tu
// inclinación y tu velocidad, contra la mejor vuelta de la tanda (en morado, a la misma hora de vuelta) y con la
// diferencia en directo. Lo de dentro de la caja (data-chart) es lo que cambia; sin vueltas que ver (o rodando de
// verdad, en boxes) queda vacía (data-empty) y la tarjeta no sale. three.js solo se carga al elegir una vuelta.
import { useMemo, useState } from "react";
import { useUi } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { fmtLap } from "../../../lib/format";
import { Replay3dPlayer } from "../../replay3d/Replay3dPlayer";
import { lapChoices, lapSource } from "../../replay3d/sources";
import { useRuntime } from "../../runtime-context";
import { useSnapshot } from "./useSnapshot";

export function Lap3dCard() {
  const { session } = useRuntime();
  const screen = useUi((s) => s.screen);
  const version = useUi((s) => s.summaryVersion);
  // El motor de esta entrada en boxes (se lee cuando el runtime avisa, como el resto de boxes).
  const eng = useSnapshot<Engine | null>(
    version,
    (prev) => {
      const E = session.rt.E;
      return E && E.mode === "pits" ? E : prev;
    },
    null,
  );
  const laps = useMemo(() => (eng && eng.viewing ? lapChoices(eng) : []), [eng]);
  // La vuelta elegida vale para este motor (otra tanda empieza sin elegir).
  const [sel, setSel] = useState<{ eng: Engine; num: number } | null>(null);
  const num = sel && sel.eng === eng ? sel.num : null;
  const source = useMemo(() => (eng && num !== null ? lapSource(eng, num) : null), [eng, num]);
  const has = !!eng && laps.length > 0;
  return (
    // En el PDF de boxes no sale (un lienzo WebGL no se copia).
    <section className="card r3d-card" aria-labelledby="p-3d-h" id="p-3d" data-pdf="omit">
      <h2 id="p-3d-h">Vuelta en 3D</h2>
      <div className="r3d-in" id="p-3d-in" data-chart="" data-empty={has ? undefined : ""}>
        {has && eng ? (
          <>
            <p className="muted">
              Cada vuelta como la de ejemplo, con tu inclinación y tu velocidad. En morado, tu mejor
              vuelta de la tanda a la misma hora de vuelta.
            </p>
            <div className="r3d-laps" role="group" aria-label="Vuelta que ver en 3D">
              {laps.map((l) => (
                <button
                  key={l.num}
                  type="button"
                  className="num"
                  aria-pressed={num === l.num}
                  aria-label={
                    "Vuelta " + l.num + ", " + fmtLap(l.time, 1) + (l.best ? ", la mejor" : "")
                  }
                  onClick={() => setSel({ eng, num: l.num })}
                >
                  {"V" + l.num + " · " + fmtLap(l.time, 1) + (l.best ? " ★" : "")}
                </button>
              ))}
            </div>
            {source ? (
              <Replay3dPlayer source={source} active={screen === "pits"} id="p-3d" />
            ) : num !== null ? (
              <p className="muted">Esta vuelta no se puede ver en 3D.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
