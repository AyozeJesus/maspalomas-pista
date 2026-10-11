// Arranque: el runtime (sesión, grabar, garaje…) se crea una vez, fuera de React; las pantallas lo usan con
// useRuntime(). Los accesos de las pruebas (window.MaspaPista…) se ponen ya, antes de DOMContentLoaded.
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installCompat } from "./app/compat";
import { registerServiceWorker } from "./app/sw-register";
import { createRuntime } from "./runtime";
import appCss from "./styles/app.css?inline";
import rootCss from "./styles/root.css?inline";
import sheetCss from "./styles/sheet.css?inline";
import chartsCss from "./ui/charts/charts.css?inline";
import { RuntimeContext } from "./ui/runtime-context";

// Los estilos van dentro de la página, como en la de siempre: llegan con ella (sin un archivo aparte que pueda faltar
// sin cobertura o servirse con otro tipo) y están antes de pintar nada. Sin ellos los lienzos que se miden por su caja
// crecerían sin parar.
const style = document.createElement("style");
style.textContent = appCss + "\n" + rootCss + "\n" + sheetCss + "\n" + chartsCss;
document.head.appendChild(style);

const runtime = createRuntime();
installCompat(runtime);

const root = document.getElementById("root");
if (!root) throw new Error("Falta #root en index.html");

// El primer pintado, ya (no en la siguiente vuelta del navegador): como el marcado de la app de siempre, todas las
// pantallas están en la página antes de DOMContentLoaded (las pruebas se enganchan a #toast en ese momento).
const reactRoot = createRoot(root);
flushSync(() =>
  reactRoot.render(
    <StrictMode>
      <RuntimeContext.Provider value={runtime}>
        <App />
      </RuntimeContext.Provider>
    </StrictMode>,
  ),
);
runtime.start();
registerServiceWorker(runtime);
