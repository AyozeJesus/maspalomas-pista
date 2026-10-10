// Umbrales del recorrido. Aceleración en g, tiempos en s, giros en rad/s, inclinación en grados.

// Frenar con margen: empieza por debajo de −0,15 g y acaba por encima de −0,10 g. Rodando sin gas (freno
// motor, viento) se decelera algo, y eso es tiempo muerto, no frenada.
export const BRAKE = -0.15; // g
export const BRAKE_END = -0.1; // g
export const GAS = 0.05; // g: por encima, acelerando
// Una fase nueva cuenta si dura 0,25 s (el acelerómetro lleva ±0,1 g de ruido aun suavizado: sin esto la fase
// cambiaba una vez por segundo); una frenada fuerte (−0,3 g) entra en el momento.
export const PH_HOLD = 0.25; // s
export const BRAKE_NOW = -0.3; // g
export const YAW_IN = 0.15; // rad/s: giro claro → empieza una curva
export const YAW_OUT = 0.08; // rad/s: por debajo un rato → se acaba
export const STEP = 3; // m entre puntos de la trazada
// Frenada de verdad (no soltar gas): más de 0,3 g de pico, 0,4 s y entrando a más de 20 km/h.
export const BRK_MIN_G = 0.3;
// Frenando tumbado: más de 0,25 g (el freno motor y el roce de la rueda tumbada no llegan) con más de 12°.
export const TRAIL_LEAN = 12;
export const TRAIL_G = 0.25;
// Hundimiento: el móvil mide el cabeceo del chasis. Batalla × tan(cabeceo) es la diferencia de altura
// entre ejes; la horquilla se lleva ~80 % (el resto es la trasera estirándose, y la inclinación de la
// horquilla lo compensa en parte). Es una estimación para comparar frenadas, no una medida del recorrido.
export const WHEELBASE_MM = 1440;
export const FORK_SHARE = 0.8;
export const G = 9.80665;
