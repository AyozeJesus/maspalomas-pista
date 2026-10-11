// Interfaz de «Telemetría Maspalomas»: la página del análisis de una tanda en el garaje (analisis.html). Monta los
// controles y el vídeo, carga la tanda (?tanda=<id> del garaje, o la de ejemplo) y el historial de tandas guardadas.
// Las piezas, en ./analisis/.
import { loadDemo, loadFromGarage } from "./analisis/carga";
import { wire } from "./analisis/controles";
import { initStore } from "./analisis/historial";
import { mountVideo } from "./analisis/video-tanda";

wire();
mountVideo();
const tanda = new URLSearchParams(location.search).get("tanda");
if (tanda) loadFromGarage(tanda);
else loadDemo();
initStore();
