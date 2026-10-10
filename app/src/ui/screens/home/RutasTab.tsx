// Pestaña «Mis rutas»: lo grabado y los tramos. (Provisional: la rellena la fase de pantallas.)
export function RutasTab({ hidden }: { hidden: boolean }) {
  return (
    <div
      className="tab-panel"
      id="tab-rutas"
      role="tabpanel"
      aria-labelledby="tb-rutas"
      hidden={hidden}
    ></div>
  );
}
