// «El móvil se ha movido» (se vuelven a aprender sus ejes). En el entrenamiento en 8, solo parado de verdad y con giro
// sostenido: el GPS del Vivo da velocidad 0 en uno o dos fijos sueltos al ir despacio (por debajo de ~9 km/h, casi
// siempre al cambiar de lado), y un golpe (arrancar, la pata de cabra) es una muestra sola; con las dos se tiraba la
// calibración (12-oct: tres veces en un minuto; después, inclinación vacía o con los ejes del montaje, y vueltas mal
// medidas). En los demás modos, como siempre (igual que la app de antes, que se compara carácter a carácter).
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { mountCheck } from "./motion";
import { createEngine, onFix, onMotion, startOcho, type Engine, type EngineHost } from "./index";
import { memoryKV } from "./kv";

function host(): EngineHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    kv: memoryKV(),
    wallNow: () => Date.UTC(2026, 9, 12, 12, 0, 0),
    perfNow: () => 0,
    isCurrent: () => true,
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: {},
  };
}

interface Ride {
  E: Engine;
  t: number;
  lat: number;
}

const start = (ocho: boolean): Ride => {
  const E = createEngine(host(), true, true);
  if (ocho) startOcho(E);
  E.t0 = 0;
  return { E, t: 0, lat: 28.1 };
};

// s fijos de 1 Hz a la velocidad v (hacia el norte, lo que avance) y sensores a 60 Hz: el giro de cada muestra lo da
// spin (rad/s, alrededor del eje z del móvil), de la muestra i del segundo k.
function ride(
  r: Ride,
  s: number,
  v: number | ((k: number) => number),
  spin: number | ((i: number) => number),
): Ride {
  for (let k = 0; k < s; k++) {
    const vk = typeof v === "number" ? v : v(k);
    onFix(r.E, r.t, r.lat, -15.6, vk, 3);
    for (let i = 0; i < 60; i++) {
      r.E.simT = r.t + i / 60;
      const w = typeof spin === "number" ? spin : spin(i);
      onMotion(r.E, r.t + i / 60, [0, 0, 0], [0, 0, 9.81], [0, 0, w]);
    }
    r.lat += vk / 111000;
    r.t += 1;
  }
  return r;
}

describe("el móvil se ha movido, en el entrenamiento en 8: solo parado de verdad y con giro sostenido", () => {
  it("un fijo o dos a 0 en mitad de un giro no tiran la calibración", () => {
    const r = ride(start(true), 10, 5, 1);
    const cal = r.E.calib;
    // El GPS dice 0 dos segundos, con la moto girando fuerte; luego, deprisa.
    ride(r, 2, 0, 2);
    expect(r.E.moved).toBe(false);
    ride(r, 8, 9, 0.2);
    expect(r.E.calib).toBe(cal);
  });

  it("un golpe de una muestra, parado (arrancar, la pata de cabra), tampoco", () => {
    const r = ride(start(true), 10, 5, 0.2);
    ride(r, 5, 0, 0);
    ride(r, 1, 0, (i) => (i === 30 ? 2.02 : 0));
    expect(r.E.moved).toBe(false);
  });

  it("parado unos segundos y el móvil girado a mano: ejes nuevos al volver a rodar (ya desde 3 m/s)", () => {
    const r = ride(start(true), 10, 5, 0.2);
    ride(r, 3, 0, 0);
    ride(r, 1, 0, (i) => (i < 30 ? 1.6 : 0));
    // Se confirma si sigue parado un par de segundos más.
    ride(r, 3, 0, 0);
    expect(r.E.moved).toBe(true);
    const cal = r.E.calib;
    ride(r, 3, 4, 0.1);
    expect(r.E.moved).toBe(false);
    expect(r.E.calib).not.toBe(cal);
  });

  it("parado con un GPS que baila entre 0,2 y 0,7 m/s cuenta como parado", () => {
    const r = ride(start(true), 10, 5, 0.2);
    ride(r, 5, (k) => (k % 2 ? 0.7 : 0.2), 0);
    ride(r, 1, 0.7, (i) => (i < 30 ? 1.6 : 0));
    ride(r, 3, (k) => (k % 2 ? 0.2 : 0.7), 0);
    expect(r.E.moved).toBe(true);
  });

  // Al arrancar, el GPS (1 Hz y con retraso) sigue en 0 aunque la moto ya ruede girando (12-oct, 1923 s: a 0,04 rad/s
  // de saltar): si en un par de segundos el GPS dice rodando, no era el móvil en la mano.
  it("arrancar girando con el GPS aún a 0 no tira la calibración", () => {
    const r = ride(start(true), 10, 5, 0.2);
    const cal = r.E.calib;
    ride(r, 10, 0, 0);
    ride(r, 1, 0, (i) => (i % 10 === 0 ? 1.6 : 0.9));
    ride(r, 1, 3.2, 0.9);
    ride(r, 3, 4.8, 0.5);
    expect(r.E.moved).toBe(false);
    expect(r.E.calib).toBe(cal);
  });
});

describe("el móvil se ha movido, en los demás modos: como siempre", () => {
  it("parado (menos de 2 m/s) y un giro brusco: ejes nuevos al pasar de 8 m/s", () => {
    const r = ride(start(false), 10, 5, 1);
    ride(r, 1, 0, 2);
    expect(r.E.moved).toBe(true);
    const cal = r.E.calib;
    ride(r, 3, 4, 0.1);
    expect(r.E.calib).toBe(cal);
    ride(r, 3, 9, 0.1);
    expect(r.E.calib).not.toBe(cal);
  });
});

// Con los ejes del montaje (la postura del móvil), las curvas los corrigen si están girados 90°. En ochos nunca se pasa
// de 8 m/s (12-oct: seis fijos en 44 min), así que ahí se comprueba desde 3 m/s; y con más giro juntado antes de
// decidir: en un 8 se junta en menos de una vuelta, y una entrada tumbando (balanceo, poca inclinación aún) parecía la
// curva de otro eje (12-oct, repetido con los ejes buenos: 49 cambios a un eje girado 90°).
describe("ejes del montaje comprobados con las curvas", () => {
  function engine(ocho: boolean) {
    const E = createEngine(host(), true, true);
    if (ocho) startOcho(E);
    // Supone adelante el eje y del móvil (vertical, z; lateral, l = u × f = −x).
    E.lean.setAxes([0, 1, 0], [0, 0, 1]);
    E.leanAxes = "montaje";
    E.mountChk = { uu: 0, fu: 0, lu: 0 };
    return E;
  }

  function tilted(ocho: boolean) {
    const E = engine(ocho);
    // De verdad adelante es el x (girado 90°). Girando a 1 rad/s tumbado 40° hacia el y del móvil: lo que el montaje
    // toma por balanceo es la curva.
    const phi = (40 * Math.PI) / 180;
    for (let i = 0; i < 600; i++) mountCheck(E, [0, Math.sin(phi), Math.cos(phi)], 4, 1 / 60);
    return E;
  }

  it("en el 8, desde 3 m/s", () => {
    expect(tilted(true).leanAxes).toBe("curvas");
  });

  it("en los demás modos, desde 8 m/s (como siempre)", () => {
    expect(tilted(false).leanAxes).toBe("montaje");
  });

  it("en el 8, con los ejes buenos, entrar en la vuelta tumbando no los cambia", () => {
    const E = engine(true);
    // Vuelta a la izquierda (giro +, tumbada −): ω = Ω·(u·cos φ + l·sen φ), con l = −x; y al entrar, el balanceo sobre
    // el eje adelante (y).
    const w = (omega: number, phiDeg: number, roll: number) => {
      const phi = (phiDeg * Math.PI) / 180;
      return [-omega * Math.sin(phi), roll, omega * Math.cos(phi)];
    };
    // 1,2 s entrando (poca inclinación, balanceo de 0,8 rad/s) y 4 s de vuelta tumbado 35°.
    for (let i = 0; i < 72; i++) mountCheck(E, w(1, -5, 0.8), 4, 1 / 60);
    for (let i = 0; i < 240; i++) mountCheck(E, w(1, -35, 0), 4, 1 / 60);
    expect(E.leanAxes).toBe("montaje");
  });
});
