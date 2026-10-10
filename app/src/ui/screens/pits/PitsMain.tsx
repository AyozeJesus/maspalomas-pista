// Lo que se hace en boxes, arriba: seguir («Volver a pista») o acabar («Terminar», con dos toques). Repasando una tanda
// guardada no se ve (se cierra con «Volver»); su «Terminar» sería «Cerrar», sin confirmar: no hay nada que terminar.
import { ConfirmButton } from "../../components/ConfirmButton";
import { useRuntime } from "../../runtime-context";

export function PitsMain({ viewing }: { viewing: boolean }) {
  const { session } = useRuntime();
  return (
    <div className="actions" id="p-main" hidden={viewing}>
      <button className="primary" id="resume" hidden={viewing} onClick={() => session.enterRide()}>
        Volver a pista
      </button>
      {viewing ? (
        <button className="danger" id="finish" onClick={() => session.stopAll()}>
          Cerrar
        </button>
      ) : (
        <ConfirmButton
          className="danger"
          id="finish"
          label="Terminar"
          armedLabel="¿Terminar? Toca otra vez"
          onConfirm={() => session.stopAll()}
        />
      )}
    </div>
  );
}
