// Una línea de estado con su punto de color (verde «ok», ámbar «wait», rojo «bad»; sin estado, gris): las de la
// portada (GPS, sensores, mejor vuelta, receptor externo, el Mac). Con los ids de siempre: el punto lleva el id y el
// texto, el id con «-t». La clase del punto, como la ponía setStatus: «dot » y el estado.

export interface StatusLineData {
  state: string;
  text: string;
}

export function StatusLine({ id, state, text }: { id: string } & StatusLineData) {
  return (
    <div>
      <span className={"dot " + state} id={id}></span>
      <span id={id + "-t"}>{text}</span>
    </div>
  );
}
