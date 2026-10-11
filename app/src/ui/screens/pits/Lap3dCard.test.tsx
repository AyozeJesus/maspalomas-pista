// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoTanda, memoryStore } from "../../../../test/fixtures-pits";
import { refreshSummary, show, uiStore } from "../../../app/ui-store";
import type { Engine } from "../../../engine";
import { memoryKV } from "../../../engine/kv";
import { createRuntime } from "../../../runtime";
import { RuntimeContext } from "../../runtime-context";
import { Lap3dCard } from "./Lap3dCard";

afterEach(cleanup);
beforeEach(() => {
  uiStore.setState({ screen: "home", summaryVersion: 0, homeVersion: 0, toast: null });
});

function mount(E: Engine | null) {
  const rt = createRuntime({ kv: memoryKV(), store: memoryStore() });
  rt.session.rt.E = E;
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <Lap3dCard />
    </RuntimeContext.Provider>,
  );
  act(() => {
    show("pits");
    refreshSummary();
  });
  return view.container;
}

const $ = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLElement | null;

describe("«Vuelta en 3D» de boxes", () => {
  it("repasando una tanda guardada: una por vuelta válida, la mejor con ★; al elegir, el reproductor", async () => {
    const E = await demoTanda();
    const c = mount(E);
    expect($(c, "#p-3d-in")?.hasAttribute("data-empty")).toBe(false);
    const buttons = Array.from(c.querySelectorAll<HTMLButtonElement>(".r3d-laps button"));
    const valid = E.laps.filter((l) => l.valid);
    expect(buttons.length).toBe(valid.length);
    expect(buttons.filter((b) => b.textContent?.endsWith("★")).length).toBe(1);
    expect(buttons[0].textContent).toMatch(/^V\d+ · \d:\d\d,\d/);
    expect(buttons[0].getAttribute("aria-label")).toMatch(/^Vuelta \d+, \d:\d\d,\d/);
    expect($(c, "#p-3d-player")).toBeNull();
    await act(async () => {
      fireEvent.click(buttons[1]);
    });
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect($(c, "#p-3d-player")).not.toBeNull();
    expect($(c, "#p-3d-speed")?.textContent).toBe("×1");
  });

  it("en boxes de una tanda de verdad (rodando), o sin tanda: vacía (la tarjeta no sale)", async () => {
    const live = mount(await demoTanda({ viewing: false }));
    expect($(live, "#p-3d-in")?.getAttribute("data-empty")).toBe("");
    expect(live.querySelectorAll(".r3d-laps button").length).toBe(0);
    cleanup();
    const none = mount(null);
    expect($(none, "#p-3d-in")?.getAttribute("data-empty")).toBe("");
  });
});
