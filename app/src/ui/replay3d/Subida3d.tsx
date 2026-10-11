// La vuelta de prueba de una subida de montaña en 3D, dentro de su hoja: como la vuelta de ejemplo del circuito, una
// moto simulada por la carretera (tu camino de la primera pasada, o la de OpenStreetMap) para ver por dónde va. Se
// prepara al abrirla; la carretera de OpenStreetMap y three.js solo se cargan entonces.
import { useEffect, useState } from "react";
import { contraria, type SubidaEnSentido } from "../../app/subidas";
import { loadSubidas } from "../../services/subidas-store";
import { useRuntime } from "../runtime-context";
import { Replay3dPlayer } from "./Replay3dPlayer";
import { subidaRide, type SubidaRide } from "./subida-ride";

interface Props {
  s: SubidaEnSentido;
  k: 0 | 1;
  // La hoja se ve.
  active: boolean;
}

interface Ready {
  id: string;
  ride: SubidaRide | null;
  failed: boolean;
}

export function Subida3d({ s, k, active }: Props) {
  const { kv } = useRuntime();
  const [ready, setReady] = useState<Ready | null>(null);
  const id = s.id;
  const subida = s.subida;
  // Lo guardado se lee al abrirla (el camino aprendido de este sentido o del otro).
  useEffect(() => {
    let alive = true;
    const saved = new Map(loadSubidas(kv).map((t) => [t.id, t]));
    const other = contraria(id);
    subidaRide({ subida }, k, saved.get(id), other ? saved.get(other) : undefined).then(
      (ride) => {
        if (alive) setReady({ id, ride, failed: false });
      },
      () => {
        if (alive) setReady({ id, ride: null, failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [kv, id, subida, k]);
  const cur = ready && ready.id === id ? ready : null;
  return (
    <div className="r3d-sub" id="sub-3d">
      {!cur ? (
        <p className="muted">Preparando la vuelta de prueba…</p>
      ) : cur.ride ? (
        <>
          <Replay3dPlayer source={cur.ride.source} active={active} id="sub-3d" />
          <p className="muted">
            Vuelta de prueba para ver por dónde va: la velocidad y la inclinación son simuladas
            (como mucho 90 km/h y 35°).{" "}
            {cur.ride.fuente === "osm"
              ? "Carretera: © colaboradores de OpenStreetMap."
              : "Por tu camino de la primera pasada."}
          </p>
        </>
      ) : (
        <p className="muted">
          {cur.failed
            ? "No se ha podido cargar la carretera (sin conexión la primera vez)."
            : "Esta subida no tiene carretera para verla en 3D."}
        </p>
      )}
    </div>
  );
}
