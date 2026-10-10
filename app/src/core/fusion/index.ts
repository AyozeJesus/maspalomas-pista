// Posición y velocidad en la pista a 60 Hz: Kalman [s, v, sesgo] con acelerómetro y fijos GPS que llegan tarde.
// EXPERIMENTAL, la app no lo carga: probado en el panel no mejora a la proyección del último fijo (ver README,
// «Filtro de Kalman: probado y descartado»).
export { TrackKalman } from "./kalman";
export type * from "./types";
