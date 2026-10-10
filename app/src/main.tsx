// Arranque: el runtime (sesión, grabar, garaje…) se crea una vez, fuera de React; las pantallas lo usan con
// useRuntime(). Los accesos de las pruebas (window.MaspaPista…) se ponen ya, antes de DOMContentLoaded.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installCompat } from "./app/compat";
import { createRuntime } from "./runtime";
import { RuntimeContext } from "./ui/runtime-context";
import "./styles/app.css";
import "./styles/root.css";

const runtime = createRuntime();
installCompat(runtime);

const root = document.getElementById("root");
if (!root) throw new Error("Falta #root en index.html");

createRoot(root).render(
  <StrictMode>
    <RuntimeContext.Provider value={runtime}>
      <App />
    </RuntimeContext.Provider>
  </StrictMode>,
);
runtime.start();
