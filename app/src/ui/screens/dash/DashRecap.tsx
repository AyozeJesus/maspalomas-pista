// La última curva en el panel del circuito: tumbada, frenada, mínima y dónde frenas, cada una frente a la mejor vuelta
// en esa curva, y la frenada (la rellena el pintor).
export function DashRecap() {
  return (
    <div className="recap" id="d-recap" hidden>
      <div className="recap-h">
        <span id="r-name"></span>
        <b className="num" id="r-dt"></b>
      </div>
      <div className="recap-g">
        <div>
          <small>Tumbada</small>
          <b className="num" id="r-lean">
            —
          </b>
          <i className="num" id="r-lean-d"></i>
        </div>
        <div>
          <small>Frenada</small>
          <b className="num" id="r-g">
            —
          </b>
          <i className="num" id="r-g-d"></i>
        </div>
        <div>
          <small>Mínima</small>
          <b className="num" id="r-v">
            —
          </b>
          <i className="num" id="r-v-d"></i>
        </div>
        <div>
          <small>Frenas</small>
          <b className="num" id="r-bp">
            —
          </b>
          <i>vs mejor</i>
        </div>
      </div>
      <p className="recap-b num" id="r-brk" hidden></p>
    </div>
  );
}
