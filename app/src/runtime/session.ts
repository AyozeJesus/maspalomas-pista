// La sesión en marcha: el motor de ahora (E) y el último acabado (lastE), salir a pista, la ruta libre, la vuelta de
// ejemplo, los sensores y el GPS del navegador, cada fotograma, «Nuevo tramo» y terminar. Es lo que en la app de antes
// hacía live.js alrededor del motor; la interfaz lo usa y lo pinta.
import { mapClock, perfNow } from "../engine/clock";
import {
  createEngine,
  enterPits as enginePits,
  enterRide as engineRide,
  nowOf,
  onFix,
  onMotion,
  tramoFlush,
  type Engine,
  type EngineHost,
} from "../engine";
import type { KeyValueStore } from "../engine/kv";
import type { MergedSeriesSet } from "../core/formato";
import { demoSession } from "../core/maspalomas";
import type { PistaStore } from "../storage";
import { hideToast, refreshHome, refreshSummary, show, toast, uiStore } from "../app/ui-store";
import {
  askMotion,
  enterFullscreen,
  exitFullscreen,
  lockOrientation as lockScreen,
  markMotion,
  orientationType,
  prepareAlarmAudio,
  requestWakeLock,
  screenAngle,
  sensorsBlocked,
  settledAngle,
  unlockOrientation,
  type WakeLockHandle,
} from "./platform";
import { createRecorder } from "./recorder";
import type { SettingsService } from "./settings";

// Datos de la vuelta de ejemplo (o de otra grabación metida a mano en las pruebas).
export interface SimData {
  loc: {
    t: ArrayLike<number>;
    lat: ArrayLike<number>;
    lon: ArrayLike<number>;
    speed: ArrayLike<number>;
    hacc: ArrayLike<number>;
  };
  acc: { t: ArrayLike<number>; x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> };
  gyro: { t: ArrayLike<number>; x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> };
  grav: { t: ArrayLike<number>; x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> };
}

export interface SimState {
  t: number;
  data: SimData | null;
  iL: number;
  iM: number;
  last: number | null;
  speed: number;
}

export interface SessionDeps {
  kv: KeyValueStore;
  store: PistaStore | null;
  settings: SettingsService;
  // Lo que hacen otras partes del runtime (se conectan al crearlo todo).
  hooks: SessionHooks;
}

export interface SessionHooks {
  // Una ruta libre de verdad acabada: guardar y enseñar su resumen (el del repaso).
  finishRide(live: Engine): void;
  // Una ruta (de ejemplo o sin grabación) acabada: su resumen con el motor del directo.
  showRouteSummary(eng: Engine): void;
  // Borrar del móvil una grabación sin nada (sin moverse).
  discard(eng: Engine): Promise<void>;
  // Receptor externo dando posiciones ahora (las del móvil no se usan).
  extFresh(): boolean;
  // Aviso de caída: si hay uno en pantalla, y empezar uno.
  crashActive(): boolean;
  crashStart(E: Engine, rec: Engine["crashLog"][number]): void;
  // Trazado de un circuito sacado de lo grabado (en un worker), y arrancar ese worker ya (parado): en el Vivo Y33s su
  // arranque paró el panel medio segundo, que rodando se notaría.
  buildCircuit: EngineHost["events"]["buildCircuit"];
  warmCircuit(): void;
  // Ha cambiado la vista 3D (la crea o la quita la interfaz).
  close3D(): void;
}

// Al echar a rodar, la orientación de la pantalla se queda fija: al tumbar en curva, el giro automático de Android
// podría cambiar el panel de vertical a horizontal a mitad de curva. No al pulsar «Salir»: el móvil aún puede ir en la
// mano y luego colocarse plano y en horizontal. Con «Pantalla en pista» elegida en Ajustes, se fija esa.
const ORIENTS = ["auto", "portrait-primary", "landscape-primary", "landscape-secondary"];

// «Nuevo tramo»: lo que no depende del reloj de la grabación pasa al tramo nuevo.
const SEGMENT_CARRY = [
  // Ejes, calibración, inclinación y cabeceo (con el sesgo del giroscopio y el orden de sus ejes).
  "calib",
  "lean",
  "pitch",
  "pitchAxes",
  "axes",
  "leanAxes",
  "leanKey",
  "axesVer",
  "leanSign",
  "leanVote",
  "mount",
  "mountChk",
  "screenAngle",
  "calibManual",
  "hasGyro",
  "motionDenied",
  "moved",
  // Aceleración (y la pendiente que se le quita), retraso del GPS y traducción de su reloj.
  "aRaw",
  "aBias",
  "aEma",
  "wLp",
  "lag",
  "lagR2",
  "phoneClock",
  // Receptor externo y orientación de la pantalla.
  "extGps",
  "extUsed",
  "extInfo",
  "orientLock",
  "orientTried",
  "orientChecked",
] as const;

export function createSession(deps: SessionDeps) {
  const { kv, store, settings, hooks } = deps;
  const recorder = createRecorder(store);
  const rt = {
    E: null as Engine | null,
    lastE: null as Engine | null,
    sim: { t: 0, data: null, iL: 0, iM: 0, last: null, speed: 1 } as SimState,
    watchId: null as number | null,
    wakeLock: null as WakeLockHandle,
    // Hay que pedir el estado de los sensores y el GPS en la portada (puntos de estado).
    status: {
      gps: { state: "", text: "GPS: se activará al salir" },
      imu: { state: "", text: "Pantalla y sensores: se activarán al salir" },
    },
  };

  function setStatus(which: "gps" | "imu", state: string, text: string): void {
    rt.status = { ...rt.status, [which]: { state, text } };
    refreshHome();
  }

  function host(): EngineHost {
    return {
      get settings() {
        return settings.get();
      },
      kv,
      wallNow: () => Date.now(),
      perfNow,
      isCurrent: (e) => rt.E === e,
      screenAngle,
      axesPrior,
      events: {
        lapFlash: (E, time, isBest, prevBest) => {
          if (E.viewing) return;
          uiStore.setState({
            flash: E.mode === "ride" ? { kind: "lap", time, isBest, prevBest } : null,
          });
        },
        crash: (E, _ev, rec) => hooks.crashStart(E, rec),
        crashActive: () => hooks.crashActive(),
        pits: (E) => {
          // El aviso de vuelta terminada solo se quita desde el panel: en boxes se quedaría tapándolo todo.
          uiStore.setState({ flash: null });
          show("pits");
          refreshSummary();
          void E;
        },
        ride: () => show("dash"),
        meta: (E, estado, flush) => {
          if (flush) recorder.flush(E, true);
          recorder.saveMeta(E, estado);
        },
        toast: (text, ms) => toast(text, ms),
        tramosChanged: () => refreshHome(),
        buildCircuit: hooks.buildCircuit,
      },
    };
  }

  // ---------- vuelta de ejemplo ----------
  function simStep(): void {
    const E = rt.E;
    const sim = rt.sim;
    const d = sim.data;
    if (!E || !d) return;
    const nowMs = performance.now();
    const dt = sim.last === null ? 0 : Math.min(0.1, (nowMs - sim.last) / 1000);
    sim.last = nowMs;
    sim.t += dt * sim.speed;
    E.simT = sim.t;
    while (sim.iM < d.acc.t.length && d.acc.t[sim.iM] <= sim.t) {
      const i = sim.iM++;
      onMotion(
        E,
        d.acc.t[i],
        [d.acc.x[i], d.acc.y[i], d.acc.z[i]],
        [d.grav.x[i], d.grav.y[i], d.grav.z[i]],
        [d.gyro.x[i], d.gyro.y[i], d.gyro.z[i]],
      );
    }
    while (sim.iL < d.loc.t.length && d.loc.t[sim.iL] <= sim.t) {
      const i = sim.iL++;
      onFix(E, d.loc.t[i], d.loc.lat[i], d.loc.lon[i], d.loc.speed[i], d.loc.hacc[i]);
    }
    if (sim.iL >= d.loc.t.length && E.mode === "ride") {
      if (E.free) stopAll();
      else enterPits();
    }
  }

  // Solo para pruebas automáticas: opts.grabar guarda la tanda simulada como una de verdad y opts.session reproduce
  // otra grabación (por ejemplo, con un GPS peor).
  function startSim(
    speedFactor?: number,
    opts?: { free?: boolean; no3d?: boolean; grabar?: boolean; session?: SimData },
  ): void {
    const E = createEngine(host(), true, opts && opts.free);
    E.t0 = 0;
    rt.E = E;
    hideToast();
    rt.sim.data =
      opts && opts.session
        ? opts.session
        : (demoSession({ seed: 7 }).session as unknown as SimData);
    rt.sim.t = 0;
    rt.sim.iL = 0;
    rt.sim.iM = 0;
    rt.sim.last = null;
    rt.sim.speed = speedFactor || 1;
    if (opts && opts.grabar) recorder.start(E, Date.now());
    // La vuelta de ejemplo se ve en 3D (casco, detrás o arriba) con todas las métricas del panel.
    E.replay = !E.free && !(opts && opts.no3d);
    show(E.free ? "ruta" : "dash");
    refreshSummary();
  }

  // ---------- en pista de verdad ----------
  async function keepAwake(): Promise<void> {
    rt.wakeLock = await requestWakeLock();
    setStatus(
      "imu",
      rt.wakeLock ? "ok" : "wait",
      rt.wakeLock
        ? "Pantalla: siempre encendida"
        : "Pantalla: desactiva el apagado automático en Ajustes del móvil",
    );
  }

  function forcedOrient(): string | null {
    const w = settings.get().pantalla;
    return ORIENTS.includes(w) && w !== "auto" ? w : null;
  }

  async function lockOrientation(): Promise<void> {
    const E = rt.E;
    if (!E) return;
    E.orientTried = true;
    const want = forcedOrient();
    if (want) return forceOrientation();
    E.screenAngle = screenAngle();
    const type = orientationType();
    if (type && (await lockScreen(type))) {
      if (rt.E) rt.E.orientLock = type;
    }
  }

  // «Pantalla en pista» (Ajustes): con el giro automático apagado, el panel saldría como esté la pantalla aunque el
  // móvil vaya de lado. Al salir (ya en pantalla completa, que es lo que permite fijarla) se pone la elegida, y con
  // ella se sabe desde el principio hacia dónde está adelante con el móvil plano. En el Vivo Y33s, el aviso de permiso
  // de ubicación de la primera vez la deshace: se vuelve a poner con el primer fijo.
  async function forceOrientation(): Promise<void> {
    const want = forcedOrient();
    if (!want || !orientationType()) return;
    const turning = orientationType() !== want;
    if (!(await lockScreen(want))) return;
    if (rt.E) rt.E.orientLock = want;
    const ang = turning ? await settledAngle() : screenAngle();
    if (rt.E) rt.E.screenAngle = ang;
  }

  function onMotionEvent(ev: DeviceMotionEvent): void {
    markMotion(ev);
    const E = rt.E;
    if (!E || E.sim) return;
    const t = (performance.timeOrigin + ev.timeStamp) / 1000 - (E.t0 as number);
    const g = ev.accelerationIncludingGravity;
    const a = ev.acceleration;
    const r = ev.rotationRate;
    if (!g || g.x === null) return;
    let lin: number[];
    let grav: number[];
    if (a && a.x !== null) {
      lin = [a.x as number, a.y as number, a.z as number];
      grav = [
        (g.x as number) - (a.x as number),
        (g.y as number) - (a.y as number),
        (g.z as number) - (a.z as number),
      ];
    } else {
      // Sin aceleración lineal: gravedad por filtro paso bajo de la total.
      const gv = [g.x as number, g.y as number, g.z as number];
      E.lp = E.lp || gv.slice();
      for (let k = 0; k < 3; k++) E.lp[k] += (gv[k] - E.lp[k]) * 0.02;
      grav = E.lp.slice();
      lin = [gv[0] - grav[0], gv[1] - grav[1], gv[2] - grav[2]];
    }
    // Giro tal cual lo da el navegador (alpha, beta, gamma en °/s → rad/s); a qué eje corresponde cada uno lo decide
    // E.axes comprobándolo con la gravedad.
    const DEG = Math.PI / 180;
    const gyro =
      r && r.alpha !== null
        ? [(r.alpha as number) * DEG, (r.beta as number) * DEG, (r.gamma as number) * DEG]
        : [0, 0, 0];
    onMotion(E, t, lin, grav, gyro);
  }

  // free: ruta libre por cualquier carretera (sin circuito).
  async function startReal(free?: boolean): Promise<void> {
    const motionOk = await askMotion();
    if (!("geolocation" in navigator)) {
      setStatus("gps", "bad", "Este navegador no da acceso al GPS.");
      return;
    }
    const E = createEngine(host(), false, free === true);
    E.t0 = perfNow();
    E.wall0 = Date.now();
    rt.E = E;
    // Un aviso de la portada no se queda encima del panel.
    hideToast();
    E.motionDenied = !motionOk;
    sensorsBlocked().then((b) => {
      if (b && rt.E) rt.E.motionDenied = true;
    });
    recorder.start(E, E.wall0);
    if (store) store.persist();
    await enterFullscreen();
    E.orientLock = null;
    E.orientTried = false;
    await forceOrientation();
    await keepAwake();
    window.addEventListener("devicemotion", onMotionEvent);
    rt.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const cur = rt.E;
        if (!cur || cur.sim) return;
        // El primer fijo llega después del aviso de permiso, que puede haber deshecho la orientación elegida.
        if (!cur.orientChecked) {
          cur.orientChecked = true;
          const w = forcedOrient();
          if (w && orientationType() && orientationType() !== w) forceOrientation();
        }
        // Con el receptor externo dando posiciones, las del móvil (peores y con otro retraso) no se usan. Hora del
        // fijo en el reloj de la tanda (la del navegador es la de pared; ver perfNow).
        const tf =
          mapClock(cur.phoneClock, pos.timestamp, performance.timeOrigin + performance.now()) /
            1000 -
          (cur.t0 as number);
        if (hooks.extFresh()) return;
        cur.extGps = null;
        const c = pos.coords;
        onFix(cur, tf, c.latitude, c.longitude, c.speed, c.accuracy);
        const v = c.speed !== null && c.speed >= 0 ? c.speed : cur.fix ? cur.fix.v : 0;
        if (rt.E && !rt.E.orientTried && v > 4) lockOrientation();
      },
      (err) => {
        const msg =
          err.code === 1
            ? "GPS: permiso denegado. Actívalo para esta web en los ajustes de Chrome."
            : "GPS: sin señal todavía…";
        setStatus("gps", err.code === 1 ? "bad" : "wait", msg);
        if (err.code === 1) stopAll();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    setStatus("gps", "wait", "GPS: buscando señal…");
    show(E.free ? "ruta" : "dash");
    refreshSummary();
    // El worker que saca el trazado de un circuito arranca ya, parado. Y el sonido del aviso de caída solo puede
    // prepararse tras un toque.
    if (E.free) {
      hooks.warmCircuit();
      if (E.crash) prepareAlarmAudio();
    }
  }

  // Un fijo del receptor externo (ya en el reloj del móvil, en ms como performance.now).
  function onExtFix(
    tpMs: number,
    f: { lat: number; lon: number; speed: number | null; hacc: number },
    kind: string,
    info: { name: string | null },
  ): void {
    const E = rt.E;
    if (!E || E.sim) return;
    E.extGps = kind;
    if (!E.extUsed) {
      E.extUsed = true;
      E.extInfo = { fuente: kind, nombre: info.name, hz: null };
    }
    onFix(
      E,
      (performance.timeOrigin + tpMs) / 1000 - (E.t0 as number),
      f.lat,
      f.lon,
      f.speed,
      f.hacc,
    );
    if (rt.E && !rt.E.orientTried && f.speed !== null && f.speed > 4) lockOrientation();
  }

  // ---------- «Nuevo tramo» (ruta libre) ----------
  // Cierra la grabación de ahora (queda en «Tus rutas y tandas» y se sube como siempre) y empieza otra en el momento,
  // sin parar los sensores ni el GPS y sin perder lo aprendido.
  async function newSegment(): Promise<boolean> {
    const old = rt.E;
    if (!old || old.sim || old.viewing || !old.free || !old.rec) return false;
    const passes = tramoFlush(old, nowOf(old));
    recorder.flush(old, true);
    recorder.saveMeta(old, "terminada");
    const saved = old.rec.queue;
    // Parado desde el principio del tramo: ese no se guarda (ni cuenta).
    const empty = emptyRecording(old);
    if (empty) void hooks.discard(old);
    const eng = createEngine(host(), false, true);
    const carry = eng as unknown as Record<string, unknown>;
    const from = old as unknown as Record<string, unknown>;
    for (const k of SEGMENT_CARRY) carry[k] = from[k];
    eng.segment = (old.segment || 1) + (empty ? 0 : 1);
    eng.t0 = perfNow();
    eng.wall0 = Date.now();
    // Los sensores pasan ya al tramo nuevo (se guardan en memoria hasta que tenga su grabación).
    rt.E = eng;
    rt.lastE = empty ? null : old;
    refreshSummary();
    const msg = empty
      ? "Tramo " + eng.segment + ": empieza de nuevo (parado no se guarda)"
      : "Tramo " + eng.segment + ": el anterior queda guardado";
    // Con una pasada acabada ahí mismo, primero su tiempo.
    if (passes) setTimeout(() => toast(msg), 4000);
    else toast(msg);
    // La grabación nueva cierra como «cortada» lo que quede a medias: primero, que el anterior quede terminado.
    await saved.catch(() => {});
    if (rt.E === eng) recorder.start(eng, eng.wall0);
    return true;
  }

  // Una grabación sin nada (sin moverse: menos de 50 m y ninguna vuelta), como un «Salir a pista» tocado sin querer o
  // un «Nuevo tramo» dado parado, no se queda en la lista.
  function emptyRecording(eng: Engine | null): boolean {
    return !!(
      eng &&
      eng.rec &&
      !eng.sim &&
      !eng.viewing &&
      eng.route.stats.dist < 50 &&
      !eng.laps.some((l) => l.valid) &&
      !(eng.circ && eng.circ.laps.length)
    );
  }

  function enterPits(): void {
    if (rt.E) enginePits(rt.E);
  }
  function enterRide(): void {
    if (rt.E) engineRide(rt.E);
  }

  function stopAll(): void {
    const E = rt.E;
    if (E) {
      if (E.free && !E.viewing) tramoFlush(E, nowOf(E));
      recorder.flush(E, true);
      recorder.saveMeta(E, "terminada");
    }
    if (rt.watchId !== null) navigator.geolocation.clearWatch(rt.watchId);
    rt.watchId = null;
    window.removeEventListener("devicemotion", onMotionEvent);
    if (rt.wakeLock) rt.wakeLock.release().catch(() => {});
    rt.wakeLock = null;
    unlockOrientation();
    exitFullscreen();
    hooks.close3D();
    rt.lastE = E;
    rt.E = null;
    // Los avisos de mientras se rodaba («Sigue grabando…») ya no valen.
    hideToast();
    uiStore.setState({ flash: null });
    const last = rt.lastE;
    if (emptyRecording(last) && last) {
      void hooks.discard(last);
      rt.lastE = null;
      show("home");
      refreshHome();
      toast("No se ha guardado: no llegaste a moverte");
      return;
    }
    // Al terminar una ruta libre, su resumen con el mapa entero: el del repaso de lo grabado si es de verdad.
    if (last && last.free) {
      if (last.rec && !last.sim && store) hooks.finishRide(last);
      else hooks.showRouteSummary(last);
    } else {
      show("home");
      refreshHome();
    }
  }

  // Cada fotograma: la vuelta de ejemplo avanza y lo grabado se guarda cada 10 s. (El panel se pinta en su componente.)
  function frame(): void {
    const E = rt.E;
    // Repasando una tanda guardada, el motor no se mueve: no hay nada que avanzar ni que guardar.
    if (!E || E.viewing) return;
    if (E.sim) simStep();
    if (rt.E) recorder.flush(rt.E, false);
  }

  // Al salir de la página (o si Android la congela) se guarda lo grabado hasta ese momento.
  function saveNow(): void {
    const E = rt.E;
    if (!E || !E.rec) return;
    recorder.flush(E, true);
    recorder.saveMeta(E, "grabando");
  }

  // La pantalla vuelve a estar a la vista: si se está grabando de verdad, otra vez siempre encendida.
  function onVisible(): void {
    const E = rt.E;
    if (E && !E.sim && rt.watchId !== null) keepAwake();
  }

  return {
    rt,
    host,
    recorder,
    startSim,
    startReal,
    onExtFix,
    newSegment,
    emptyRecording,
    enterPits,
    enterRide,
    stopAll,
    frame,
    saveNow,
    onVisible,
    lockOrientation,
    setStatus,
  };
}

export type Session = ReturnType<typeof createSession>;

// Orden de partida de alpha, beta, gamma: Chrome en Android los da en x, y, z (medido en un Pixel 10 Pro); Safari en
// iPhone, según la norma, en z, x, y. Luego se comprueba con los datos (GyroAxes).
export function axesPrior(): number {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios ? 1 : 0;
}

export type { MergedSeriesSet };
