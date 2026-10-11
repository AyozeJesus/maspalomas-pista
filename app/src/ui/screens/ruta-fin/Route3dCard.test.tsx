// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TrailPoint } from "../../../core/recorrido";
import type { Engine } from "../../../engine";
import type { Paint } from "./paint";
import { Route3dCard } from "./Route3dCard";
import { scrubSync } from "./scrub-sync";

afterEach(cleanup);

function trail(n: number): TrailPoint[] {
  return Array.from({ length: n }, (_, k) => ({
    x: 3 * k,
    y: 0,
    t: k * 0.2,
    v: 15,
    lean: 10,
    ph: "gas" as const,
    gap: false,
    wh: false,
  }));
}

const paintOf = (n: number): Paint =>
  ({
    eng: { route: { trail: trail(n) } } as unknown as Engine,
    s: {},
    turn: null,
    now: 0,
  }) as unknown as Paint;

function scrub() {
  let at = 0;
  return {
    position: () => at,
    scrubTo: (i: number) => {
      at = i;
    },
  };
}

const $ = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;

describe("«En 3D» del resumen de la ruta", () => {
  it("cerrada: lo que se verá y «Ver en 3D» (la cáscara, siempre la misma)", () => {
    const { container } = render(
      <Route3dCard paint={paintOf(40)} visible={true} scrub={scrub()} />,
    );
    const card = $(container, "#ruf-3d");
    expect(card?.className).toBe("card r3d-card");
    expect($(container, "#ruf-3d-h")?.textContent).toBe("En 3D");
    const box = $(container, "#ruf-3d-in");
    expect(box?.hasAttribute("data-chart")).toBe(true);
    expect(box?.hasAttribute("data-empty")).toBe(false);
    expect($(container, "#ruf-3d-open")?.textContent).toBe("Ver en 3D");
    expect($(container, "#ruf-3d-player")).toBeNull();
  });

  it("sin trazada (parado o unos metros): vacía, y la tarjeta no sale", () => {
    for (const p of [paintOf(3), null]) {
      const { container } = render(<Route3dCard paint={p} visible={true} scrub={scrub()} />);
      expect($(container, "#ruf-3d-in")?.getAttribute("data-empty")).toBe("");
      expect($(container, "#ruf-3d-open")).toBeNull();
      cleanup();
    }
  });

  it("«Ver en 3D» abre el reproductor (y «Cerrar la vista 3D» lo quita); otra ruta empieza cerrada", async () => {
    const sc = scrub();
    const a = paintOf(40);
    const view = render(<Route3dCard paint={a} visible={true} scrub={sc} />);
    const c = view.container;
    await act(async () => {
      fireEvent.click($(c, "#ruf-3d-open") as HTMLElement);
    });
    expect($(c, "#ruf-3d-player")).not.toBeNull();
    expect($(c, "#ruf-3d-play")?.getAttribute("aria-label")).toBe("Reproducir");
    expect($(c, "#ruf-3d-speed")?.textContent).toBe("×1");
    // Sin WebGL (jsdom) lo dice en el recuadro.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect($(c, ".v3d-wait")?.textContent).toMatch(/3D/);
    fireEvent.click($(c, "#ruf-3d-close") as HTMLElement);
    expect($(c, "#ruf-3d-player")).toBeNull();
    expect($(c, "#ruf-3d-open")).not.toBeNull();
    await act(async () => {
      fireEvent.click($(c, "#ruf-3d-open") as HTMLElement);
    });
    view.rerender(<Route3dCard paint={paintOf(50)} visible={true} scrub={sc} />);
    expect($(c, "#ruf-3d-player")).toBeNull();
    expect($(c, "#ruf-3d-open")).not.toBeNull();
  });
});

describe("la vista 3D a la par que el punto del mapa", () => {
  it("leer: el punto y su instante; escribir: el punto de ese instante", () => {
    const sc = scrub();
    const src = { indexAt: (t: number) => Math.round(t * 10), timeOf: (i: number) => i / 10 };
    const sync = scrubSync(src, sc);
    expect(sync.read()).toEqual({ key: 0, t: 0 });
    sc.scrubTo(33);
    expect(sync.read()).toEqual({ key: 33, t: 3.3 });
    expect(sync.write(1.24)).toBe(12);
    expect(sc.position()).toBe(12);
  });
});
