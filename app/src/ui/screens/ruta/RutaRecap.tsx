// La última curva en la ruta libre: tumbada, frenada, velocidad de entrada → mínima, tiempo sin gas y la frenada (la
// rellena el pintor).
export function RutaRecap() {
  return (
    <div className="recap" id="ru-recap" hidden>
      <div className="recap-h">
        <span id="ru-name"></span>
        <b className="num" id="ru-dead"></b>
      </div>
      <div className="recap-g">
        <div>
          <small>Tumbada</small>
          <b className="num" id="ru-c-lean">
            —
          </b>
        </div>
        <div>
          <small>Frenada</small>
          <b className="num" id="ru-c-g">
            —
          </b>
        </div>
        <div>
          <small>Entra → mín.</small>
          <b className="num" id="ru-c-v">
            —
          </b>
        </div>
        <div>
          <small>Sin gas</small>
          <b className="num" id="ru-c-dead">
            —
          </b>
        </div>
      </div>
      <p className="recap-b num" id="ru-brk" hidden></p>
    </div>
  );
}
