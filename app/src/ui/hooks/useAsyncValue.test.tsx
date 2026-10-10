// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsyncValue } from "./useAsyncValue";

afterEach(cleanup);

// Lecturas que se contestan a mano, en orden.
function reads() {
  const pending: ((v: string) => void)[] = [];
  const read = vi.fn(
    () =>
      new Promise<string>((res) => {
        pending.push(res);
      }),
  );
  const answer = async (v: string) => {
    const res = pending.shift();
    if (!res) throw new Error("no hay ninguna lectura esperando");
    await act(async () => res(v));
  };
  return { read, answer, pending };
}

describe("useAsyncValue", () => {
  it("lo de partida hasta la primera respuesta; luego, cada respuesta", async () => {
    const r = reads();
    const h = renderHook(({ key }) => useAsyncValue(r.read, key, "nada"), {
      initialProps: { key: 0 },
    });
    expect(h.result.current).toBe("nada");
    await r.answer("uno");
    expect(h.result.current).toBe("uno");
    h.rerender({ key: 1 });
    await r.answer("dos");
    expect(h.result.current).toBe("dos");
    expect(r.read).toHaveBeenCalledTimes(2);
  });

  it("nunca dos a la vez: lo que cambia mientras lee se vuelve a leer una vez al acabar", async () => {
    const r = reads();
    const h = renderHook(({ key }) => useAsyncValue(r.read, key, "nada"), {
      initialProps: { key: 0 },
    });
    // La portada se pinta tres veces mientras la primera lectura (lenta) sigue en marcha.
    h.rerender({ key: 1 });
    h.rerender({ key: 2 });
    h.rerender({ key: 3 });
    expect(r.read).toHaveBeenCalledTimes(1);
    // Su respuesta vale (no se tira por llegar tarde) y enseguida se lee otra vez, una sola.
    await r.answer("lenta");
    expect(h.result.current).toBe("lenta");
    expect(r.read).toHaveBeenCalledTimes(2);
    await r.answer("al día");
    expect(h.result.current).toBe("al día");
    expect(r.read).toHaveBeenCalledTimes(2);
  });

  it("sin lectura (null) no lee nada; desmontado, no apunta respuestas ni vuelve a leer", async () => {
    const none = renderHook(() => useAsyncValue<string>(null, 1, "nada"));
    expect(none.result.current).toBe("nada");
    const r = reads();
    const h = renderHook(({ key }) => useAsyncValue(r.read, key, "nada"), {
      initialProps: { key: 0 },
    });
    h.rerender({ key: 1 });
    h.unmount();
    await r.answer("tarde");
    expect(r.read).toHaveBeenCalledTimes(1);
    expect(r.pending).toHaveLength(0);
  });
});
