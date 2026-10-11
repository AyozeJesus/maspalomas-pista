// El reproductor 3D en la página, como la vista de la vuelta de ejemplo: el recuadro con la carretera o el circuito, el
// marcador encima, las tres cámaras (casco, detrás, arriba) y, debajo, reproducir, la barra y la velocidad. Lo que
// cambia en cada fotograma lo escribe el reproductor (player.ts) sin pasar por React.
import { useEffect, useRef, useState } from "react";
import type { Vista3DMode } from "../three/vista3d";
import {
  createPlayer,
  rememberedMode,
  type Player,
  type PlayerEls,
  type PlayerSync,
} from "./player";
import type { Replay3dSource } from "./sources";

const CAMS: readonly { mode: Vista3DMode; label: string }[] = [
  { mode: "casco", label: "Casco" },
  { mode: "detras", label: "Detrás" },
  { mode: "arriba", label: "Arriba" },
];

interface Props {
  source: Replay3dSource;
  // La pantalla se ve: si no, se cierra (y suelta la vista).
  active: boolean;
  sync?: PlayerSync | null;
  // Prefijo de los ids (ruf-3d, p-3d).
  id: string;
}

function elsOf(r: {
  box: HTMLDivElement | null;
  wait: HTMLParagraphElement | null;
  main: HTMLElement | null;
  side: HTMLSpanElement | null;
  sub: HTMLElement | null;
  play: HTMLButtonElement | null;
  speed: HTMLButtonElement | null;
  range: HTMLInputElement | null;
}): PlayerEls | null {
  const { box, wait, main, side, sub, play, speed, range } = r;
  return box && wait && main && side && sub && play && speed && range
    ? { box, wait, main, side, sub, play, speed, range }
    : null;
}

export function Replay3dPlayer({ source, active, sync, id }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const wait = useRef<HTMLParagraphElement>(null);
  const main = useRef<HTMLElement>(null);
  const side = useRef<HTMLSpanElement>(null);
  const sub = useRef<HTMLElement>(null);
  const play = useRef<HTMLButtonElement>(null);
  const speed = useRef<HTMLButtonElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const player = useRef<Player | null>(null);
  const [cam, setCam] = useState<Vista3DMode>(rememberedMode);

  // El reproductor, con sus piezas ya en la página; fuera de la pantalla no pinta y, si el recuadro cambia de tamaño
  // (girar el móvil), pinta otra vez. Se suelta al quitarlo.
  useEffect(() => {
    const els = elsOf({
      box: box.current,
      wait: wait.current,
      main: main.current,
      side: side.current,
      sub: sub.current,
      play: play.current,
      speed: speed.current,
      range: range.current,
    });
    if (!els) return;
    const p = createPlayer(els);
    player.current = p;
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((list) => {
            for (const e of list) p.setVisible(e.isIntersecting);
          });
    io?.observe(els.box);
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => p.invalidate());
    ro?.observe(els.box);
    return () => {
      io?.disconnect();
      ro?.disconnect();
      p.close();
      player.current = null;
    };
  }, []);

  // Esta grabación, mientras la pantalla se vea.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (active) void p.open(source, { sync });
    else p.close();
  }, [source, active, sync]);

  const pick = (m: Vista3DMode) => {
    setCam(m);
    player.current?.setMode(m);
  };

  return (
    <div className="r3d" id={id + "-player"}>
      <div className="v3d r3d-box" ref={box}>
        <p className="v3d-wait" ref={wait}>
          Cargando la vista 3D…
        </p>
        <div className="r3d-hud" aria-hidden="true">
          <b className="num" ref={main}></b>
          <span className="r3d-side" ref={side}></span>
          <small ref={sub}></small>
        </div>
        <div className="v3d-ctl" role="group" aria-label="Cámara">
          {CAMS.map((c) => (
            <button
              key={c.mode}
              type="button"
              data-cam={c.mode}
              aria-pressed={cam === c.mode}
              onClick={() => pick(c.mode)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="r3d-bar">
        <button
          type="button"
          className="r3d-play"
          id={id + "-play"}
          ref={play}
          aria-label="Reproducir"
          onClick={() => player.current?.toggle()}
        >
          ▶
        </button>
        <input
          type="range"
          id={id + "-pos"}
          ref={range}
          aria-label="Momento del repaso"
          onChange={(ev) => player.current?.seek(+ev.currentTarget.value)}
        />
        <button
          type="button"
          id={id + "-speed"}
          ref={speed}
          aria-label="Velocidad del repaso"
          onClick={() => player.current?.faster()}
        >
          ×1
        </button>
      </div>
    </div>
  );
}
