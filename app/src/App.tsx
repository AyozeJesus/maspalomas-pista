// La app: todas las pantallas están siempre en la página y solo se ve una (como en la de siempre, con los mismos ids;
// así el panel no se vuelve a montar al ir y venir de boxes y la batería de pruebas de siempre sirve igual). Encima,
// las capas: el destello, los avisos, el repaso de una grabación y el aviso de caída.
import { Crash } from "./ui/overlays/Crash";
import { Flash } from "./ui/overlays/Flash";
import { Replaying } from "./ui/overlays/Replaying";
import { Toast } from "./ui/overlays/Toast";
import { Dash } from "./ui/screens/dash/Dash";
import { Dia } from "./ui/screens/dia/Dia";
import { Home } from "./ui/screens/home/Home";
import { Pits } from "./ui/screens/pits/Pits";
import { Ruta } from "./ui/screens/ruta/Ruta";
import { RutaFin } from "./ui/screens/ruta-fin/RutaFin";
import { Sensores } from "./ui/screens/sensores/Sensores";

export function App() {
  return (
    <>
      <Home />
      <Dash />
      <Ruta />
      <RutaFin />
      <Pits />
      <Sensores />
      <Dia />
      <Flash />
      <Toast />
      <Replaying />
      <Crash />
    </>
  );
}
