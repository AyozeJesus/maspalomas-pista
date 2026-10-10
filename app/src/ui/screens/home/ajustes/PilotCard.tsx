// «Piloto»: nombre (cada piloto tiene su mejor vuelta: al cambiarlo se repinta la portada con la suya) y vuelta
// objetivo.
import { refreshHome, useUi } from "../../../../app/ui-store";
import { useSettings } from "../../../../runtime/settings";
import { useRuntime } from "../../../runtime-context";
import { CommitField } from "./CommitField";
import { commitTarget, targetText } from "./objetivo";

export function PilotCard() {
  const { settings } = useRuntime();
  const s = useSettings(settings, (x) => x);
  const version = useUi((u) => u.homeVersion);
  const onPilot = (raw: string) => {
    settings.setPilot(raw);
    refreshHome();
  };
  const onTarget = (raw: string) => {
    const r = commitTarget(raw, settings.get());
    if (r.objetivo !== null) settings.update({ objetivo: r.objetivo });
    return r.text;
  };
  return (
    <section className="card" aria-labelledby="set-h">
      <h2 id="set-h">Piloto</h2>
      <div className="pilot">
        <label htmlFor="piloto">Nombre</label>
        <CommitField
          id="piloto"
          type="text"
          maxLength={30}
          autoComplete="nickname"
          placeholder="Tu nombre"
          value={s.piloto || ""}
          version={version}
          onCommit={onPilot}
        />
        <label htmlFor="objetivo">Objetivo</label>
        <CommitField
          id="objetivo"
          className="num"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="1:05,0"
          value={targetText(s)}
          version={version}
          onCommit={onTarget}
        />
      </div>
      <p className="muted">
        Cada piloto tiene su mejor vuelta y su objetivo por vuelta. Si compartís móvil, cambiad el
        nombre antes de salir.
      </p>
    </section>
  );
}
