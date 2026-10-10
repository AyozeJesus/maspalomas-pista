// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshHome } from "../../../../app/ui-store";
import { BUILD } from "../../../../app/version";
import { MASPA_GEO } from "../../../../core/maspalomas";
import { CIRCUITS_KEY } from "../../../../engine";
import { memoryKV, type KeyValueStore } from "../../../../engine/kv";
import { createRuntime, type Runtime } from "../../../../runtime";
import type { GarageStatus } from "../../../../runtime/garage";
import { exportSession, exportStored } from "../../../../services/export";
import type { PistaStore } from "../../../../storage";
import { RuntimeContext } from "../../../runtime-context";
import { AjustesTab } from "../AjustesTab";

vi.mock("../../../../services/export", () => ({
  exportSession: vi.fn(async () => true),
  exportStored: vi.fn(async () => "exportada"),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(
  opts: { kv?: KeyValueStore; store?: PistaStore | null; status?: GarageStatus } = {},
) {
  const rt: Runtime = createRuntime({ kv: opts.kv ?? memoryKV(), store: opts.store ?? null });
  if (opts.status) vi.spyOn(rt.garage, "status").mockResolvedValue(opts.status);
  const view = render(
    <RuntimeContext.Provider value={rt}>
      <AjustesTab hidden={false} />
    </RuntimeContext.Provider>,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = view.container.querySelector<T>("#" + id);
    if (!el) throw new Error("falta #" + id);
    return el;
  };
  return { rt, $ };
}

// Escribir en un campo y confirmarlo (el «change» del navegador), como en la batería: con el foco en el campo.
function commit(el: HTMLInputElement, text: string) {
  el.focus();
  act(() => {
    fireEvent.change(el, { target: { value: text } });
  });
}

describe("pestaña «Ajustes»: piloto y objetivo", () => {
  it("lo guardado al abrir", () => {
    const kv = memoryKV({
      "pista-ajustes": { piloto: "Ayoze", objetivo: 64.5, emergencia: "600123123" },
    });
    const { $ } = mount({ kv });
    expect($<HTMLInputElement>("piloto").value).toBe("Ayoze");
    expect($<HTMLInputElement>("objetivo").value).toBe("1:04,5");
    expect($<HTMLInputElement>("emergencia").value).toBe("600123123");
    expect($("home-build").textContent).toBe("Versión " + BUILD);
  });

  it("el nombre se guarda limpio al confirmarlo, sin pisar lo escrito mientras tiene el foco", () => {
    const { rt, $ } = mount();
    const field = $<HTMLInputElement>("piloto");
    // A medio escribir no se guarda nada (React llama onChange a cada letra; aquí cuenta el «change»).
    field.focus();
    fireEvent.input(field, { target: { value: "Ay" } });
    expect(rt.settings.get().piloto).toBe("");
    commit(field, "  Ayoze  ");
    expect(rt.settings.get().piloto).toBe("Ayoze");
    act(() => refreshHome());
    expect(field.value).toBe("  Ayoze  ");
    // Sin el foco, la portada enseña lo guardado.
    field.blur();
    act(() => refreshHome());
    expect(field.value).toBe("Ayoze");
  });

  it("el objetivo: vale si es una vuelta posible y el campo dice siempre el que vale", () => {
    const { rt, $ } = mount();
    const field = $<HTMLInputElement>("objetivo");
    commit(field, "1:12,5");
    expect([rt.settings.get().objetivo, field.value]).toEqual([72.5, "1:12,5"]);
    commit(field, "rapidísimo");
    expect([rt.settings.get().objetivo, field.value]).toEqual([72.5, "1:12,5"]);
    commit(field, "39");
    expect([rt.settings.get().objetivo, field.value]).toEqual([72.5, "1:12,5"]);
  });

  it("el teléfono de emergencia, sin espacios de sobra y como mucho 20", () => {
    const { rt, $ } = mount();
    commit($<HTMLInputElement>("emergencia"), "  +34 600 123 456 789 012 ");
    // Como antes: primero sin espacios de sobra y luego cortado a 20 (puede quedar el espacio del corte).
    expect(rt.settings.get().emergencia).toBe("+34 600 123 456 789 ");
    commit($<HTMLInputElement>("emergencia"), " 600 123 123 ");
    expect(rt.settings.get().emergencia).toBe("600 123 123");
  });
});

describe("pestaña «Ajustes»: pantalla y avisos", () => {
  it("la pantalla elegida, marcada", () => {
    const { rt, $ } = mount();
    const checked = () =>
      [...$("tab-ajustes").querySelectorAll<HTMLElement>('[data-orient][aria-checked="true"]')].map(
        (b) => b.dataset.orient,
      );
    expect(checked()).toEqual(["auto"]);
    fireEvent.click(
      $("tab-ajustes").querySelector('[data-orient="landscape-secondary"]') as Element,
    );
    expect(rt.settings.get().pantalla).toBe("landscape-secondary");
    expect(checked()).toEqual(["landscape-secondary"]);
  });

  it("interruptores: mapa, aviso de frenada (con su distancia) y aviso de caída", () => {
    const { rt, $ } = mount();
    expect($<HTMLInputElement>("mapopt").checked).toBe(true);
    expect($<HTMLInputElement>("cue").checked).toBe(false);
    expect($<HTMLInputElement>("caidaopt").checked).toBe(true);
    expect($("cue-opts").hidden).toBe(true);
    fireEvent.click($("cue"));
    expect(rt.settings.get().cue).toBe(true);
    expect($("cue-opts").hidden).toBe(false);
    expect($<HTMLInputElement>("lead").value).toBe("20");
    // Como la batería: el valor puesto por código y luego el evento.
    const lead = $<HTMLInputElement>("lead");
    act(() => {
      lead.value = "35";
      lead.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rt.settings.get().lead).toBe(35);
    expect($("lead-v").textContent).toBe("35");
    fireEvent.click($("mapopt"));
    fireEvent.click($("caidaopt"));
    expect([rt.settings.get().mapa, rt.settings.get().caida]).toEqual([false, false]);
    expect($<HTMLInputElement>("caidaopt").checked).toBe(false);
  });
});

describe("pestaña «Ajustes»: receptor y el Mac", () => {
  it("sin Bluetooth ni USB (este navegador): lo dice y no ofrece conectar", () => {
    const { $ } = mount();
    expect($("st-ext-t").textContent).toBe(
      "Este navegador no puede usar receptores externos: hace falta Chrome en Android.",
    );
    expect([$("ext-ble").hidden, $("ext-usb").hidden, $("ext-off").hidden]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("los botones del receptor, según cómo esté", () => {
    const { rt, $ } = mount();
    const view = vi.spyOn(rt.ext, "view").mockReturnValue({
      ble: true,
      usb: true,
      on: false,
      busy: false,
      dot: "",
      text: "Sin receptor: se usa el GPS del móvil (1 posición por segundo).",
    });
    const connect = vi.spyOn(rt.ext, "connect").mockResolvedValue(undefined);
    const disconnect = vi.spyOn(rt.ext, "disconnect").mockImplementation(() => {});
    act(() => refreshHome());
    expect([$("ext-ble").hidden, $("ext-usb").hidden, $("ext-off").hidden]).toEqual([
      false,
      false,
      true,
    ]);
    fireEvent.click($("ext-ble"));
    fireEvent.click($("ext-usb"));
    expect(connect.mock.calls).toEqual([["ble"], ["usb"]]);
    view.mockReturnValue({
      ble: true,
      usb: true,
      on: true,
      busy: false,
      dot: "ok",
      text: "Bluetooth · BonoGPS-1234: 25 posiciones por segundo · 14 satélites.",
    });
    act(() => refreshHome());
    expect($("st-ext").className).toBe("dot ok");
    expect($("st-ext-t").textContent).toBe(
      "Bluetooth · BonoGPS-1234: 25 posiciones por segundo · 14 satélites.",
    );
    expect([$("ext-ble").hidden, $("ext-usb").hidden, $("ext-off").hidden]).toEqual([
      true,
      true,
      false,
    ]);
    fireEvent.click($("ext-off"));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("sin base de datos: lo de siempre al abrir, sin subir ni desconectar", () => {
    const kv = memoryKV({ "pista-ajustes": { garaje: { u: "http://mac", k: "x" } } });
    const { $ } = mount({ kv });
    expect($("st-cola-t").textContent).toBe("Tandas guardadas en el móvil: ninguna");
    expect($("st-mac-t").textContent).toBe("Mac sin conectar.");
    expect([$("garage-sync").hidden, $("garage-forget").hidden, $("home-export").hidden]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("emparejado: el estado de la subida, subir ya, exportar y desconectar (dos toques)", async () => {
    const kv = memoryKV({ "pista-ajustes": { garaje: { u: "http://mac", k: "x" } } });
    const status: GarageStatus = {
      cola: { state: "ok", text: "Tandas guardadas en el móvil: 2 · todo subido al Mac" },
      mac: { state: "ok", text: "Mac conectado: las tandas se suben solas." },
      paired: true,
      stored: 2,
    };
    const { rt, $ } = mount({ kv, store: {} as PistaStore, status });
    await waitFor(() => expect($("st-mac-t").textContent).toBe(status.mac.text));
    expect($("st-cola").className).toBe("dot ok");
    expect($("st-cola-t").textContent).toBe(status.cola.text);
    const sync = vi.spyOn(rt.garage, "syncNow").mockImplementation(() => {});
    const forget = vi.spyOn(rt.garage, "forget").mockImplementation(() => {});
    fireEvent.click($("garage-sync"));
    expect(sync).toHaveBeenCalledTimes(1);
    // Exportar lo guardado (no hay tanda en memoria).
    expect($("home-export").hidden).toBe(false);
    await act(async () => {
      fireEvent.click($("home-export"));
    });
    expect(exportStored).toHaveBeenCalledTimes(1);
    expect(exportSession).not.toHaveBeenCalled();
    expect($("home-export").textContent).toBe("Exportada");
    // Desconectar pide un segundo toque.
    fireEvent.click($("garage-forget"));
    expect($("garage-forget").textContent).toBe("¿Desconectar? Toca otra vez");
    expect(forget).not.toHaveBeenCalled();
    fireEvent.click($("garage-forget"));
    expect(forget).toHaveBeenCalledTimes(1);
    expect($("garage-forget").textContent).toBe("Desconectar el Mac");
  });

  it("exportar: la tanda recién terminada si la hay; si lo guardado no se lee, lo dice", async () => {
    const status: GarageStatus = {
      cola: { state: "", text: "Tandas guardadas en el móvil: ninguna" },
      mac: { state: "", text: "Mac sin conectar." },
      paired: false,
      stored: 1,
    };
    const { rt, $ } = mount({ store: {} as PistaStore, status });
    await waitFor(() => expect($("home-export").hidden).toBe(false));
    vi.mocked(exportStored).mockResolvedValueOnce("error");
    await act(async () => {
      fireEvent.click($("home-export"));
    });
    expect($("home-export").textContent).toBe("No se ha podido leer la tanda guardada");
    const eng = {} as NonNullable<typeof rt.session.rt.lastE>;
    rt.session.rt.lastE = eng;
    await act(async () => {
      fireEvent.click($("home-export"));
    });
    expect(vi.mocked(exportSession).mock.calls).toEqual([[eng]]);
  });
});

describe("pestaña «Ajustes»: circuitos", () => {
  const C = MASPA_GEO.main;

  it("la meta: tocando la pista, la de siempre y la raya en su sitio", () => {
    const { rt, $ } = mount();
    const svg = $("meta-svg") as unknown as SVGSVGElement;
    // jsdom no coloca el SVG en pantalla: de la pantalla al mapa, tal cual.
    Object.assign(svg, {
      getScreenCTM: () => ({ inverse: () => ({}) }),
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform(this: { x: number; y: number }) {
          return { x: this.x, y: this.y };
        },
      }),
    });
    const line = () => svg.querySelector("line")?.getAttribute("x1");
    const before = line();
    fireEvent.click(svg, { clientX: C[100][0], clientY: C[100][1] });
    expect(rt.settings.get().finish).toEqual({ osm: 100, rev: C.length - 100 });
    expect(line()).not.toBe(before);
    // Lejos de la pista no cambia nada.
    fireEvent.click(svg, { clientX: -500, clientY: -500 });
    expect(rt.settings.get().finish.osm).toBe(100);
    fireEvent.click($("meta-reset"));
    expect(rt.settings.get().finish).toEqual({ osm: 0, rev: 0 });
    expect(line()).toBe(before);
  });

  it("borrar la mejor vuelta guardada: dos toques, y solo la del piloto", () => {
    const kv = memoryKV({
      "pista-ajustes": { piloto: "Ayoze" },
      "pista-mejor-osm-0-ayoze": { time: 68.5 },
      "pista-mejor-osm-0": { time: 70 },
    });
    const { $ } = mount({ kv });
    fireEvent.click($("best-reset"));
    expect($("best-reset").textContent).toBe("¿Seguro? Toca otra vez");
    expect(kv.load("pista-mejor-osm-0-ayoze", null)).not.toBeNull();
    fireEvent.click($("best-reset"));
    expect(kv.load("pista-mejor-osm-0-ayoze", null)).toBeNull();
    expect(kv.load("pista-mejor-osm-0", null)).toEqual({ time: 70 });
    expect($("best-reset").textContent).toBe("Borrar mejor vuelta guardada");
  });

  it("otros circuitos guardados, con «Borrar» de dos toques", () => {
    const line: [number, number][] = [
      [28.1, -15.5],
      [28.2, -15.6],
    ];
    const kv = memoryKV({
      [CIRCUITS_KEY]: [
        { name: "Maspalomas (prueba)", length: 2234, centerline: line, origin: { lat: 0, lon: 0 } },
        { name: "Circuito 2", length: 980, centerline: line, origin: { lat: 0, lon: 0 } },
      ],
    });
    const { $ } = mount({ kv });
    expect($("circ-group").hidden).toBe(false);
    const rows = () => [...$("circ-list").children].map((r) => r.textContent);
    expect(rows()).toEqual([
      "Maspalomas (prueba) · 2,2 km" + "Borrar",
      "Circuito 2 · 1,0 km" + "Borrar",
    ]);
    const first = () => $("circ-list").querySelector("button") as HTMLButtonElement;
    fireEvent.click(first());
    expect(first().textContent).toBe("¿Borrar? Otra vez");
    // Que la portada se pinte entre los dos toques no lo desarma.
    act(() => refreshHome());
    expect(first().textContent).toBe("¿Borrar? Otra vez");
    fireEvent.click(first());
    expect(rows()).toEqual(["Circuito 2 · 1,0 km" + "Borrar"]);
    fireEvent.click(first());
    fireEvent.click(first());
    expect(kv.load(CIRCUITS_KEY, null)).toEqual([]);
    expect($("circ-group").hidden).toBe(true);
  });
});
