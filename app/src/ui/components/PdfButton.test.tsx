// @vitest-environment jsdom
// «Compartir (PDF)»: hace el PDF de la pantalla en la que está, lo comparte (o avisa de que se ha descargado), no hace
// dos a la vez, y si tarda más de lo que el navegador deja para compartir tras un toque, pide otro.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiStore } from "../../app/ui-store";
import type { Engine } from "../../engine";
import { DEFAULT_SETTINGS } from "../../engine/settings";
import type { Runtime } from "../../runtime";
import { makePdf, type PdfFile } from "../../services/pdf";
import { compartir } from "../draw/compartir";
import { RuntimeContext } from "../runtime-context";
import { PdfButton } from "./PdfButton";

vi.mock("../../services/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/pdf")>()),
  makePdf: vi.fn(),
}));

const FILE: PdfFile = {
  blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
  name: "poortelemetry-ruta-20261011-1030.pdf",
  text: "Ruta libre · 12,5 km",
};
const toastText = () => uiStore.getState().toast?.text ?? "";
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

const engA = { id: "a" } as unknown as Engine;
const engB = { id: "b" } as unknown as Engine;

function mount(kind: "ruta" | "tanda", rt: { E: Engine | null; lastE: Engine | null }) {
  const runtime = {
    session: { rt },
    settings: { get: () => ({ ...DEFAULT_SETTINGS, piloto: "Ayoze" }) },
  } as unknown as Runtime;
  const r = render(
    <RuntimeContext.Provider value={runtime}>
      <main className="page" id="pantalla">
        <PdfButton id="pdf" kind={kind}>
          Compartir (PDF)
        </PdfButton>
      </main>
    </RuntimeContext.Provider>,
  );
  const btn = r.container.querySelector("#pdf") as HTMLButtonElement;
  return { btn, main: r.container.querySelector("#pantalla") };
}

let share: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  uiStore.setState({ toast: null });
  share = vi.spyOn(compartir, "share").mockResolvedValue("compartida");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(makePdf).mockReset();
});

describe("PdfButton", () => {
  it("hace el PDF de su pantalla y lo comparte; mientras, quieto y diciendo que se prepara", async () => {
    let done: (f: PdfFile) => void = () => {};
    vi.mocked(makePdf).mockImplementationOnce(() => new Promise((r) => (done = r)));
    const { btn, main } = mount("ruta", { E: null, lastE: engA });
    fireEvent.click(btn);
    expect(makePdf).toHaveBeenCalledWith(
      "ruta",
      engA,
      main,
      expect.objectContaining({ piloto: "Ayoze" }),
    );
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Preparando el PDF…");
    // Otro toque mientras no hace otro.
    fireEvent.click(btn);
    expect(makePdf).toHaveBeenCalledTimes(1);
    await act(async () => done(FILE));
    expect(share).toHaveBeenCalledWith(FILE.blob, FILE.name, FILE.text);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Compartir (PDF)");
    expect(toastText()).toBe("");
  });

  it("sin «compartir archivos», avisa de que está en Descargas", async () => {
    vi.mocked(makePdf).mockResolvedValueOnce(FILE);
    share.mockResolvedValueOnce("descargada");
    const { btn } = mount("ruta", { E: null, lastE: engA });
    fireEvent.click(btn);
    await settle();
    expect(toastText()).toBe("PDF guardado en Descargas");
  });

  it("si no se puede hacer, lo dice y el botón vuelve", async () => {
    vi.mocked(makePdf).mockRejectedValueOnce(new Error("sin canvas"));
    const { btn } = mount("ruta", { E: null, lastE: engA });
    fireEvent.click(btn);
    await settle();
    expect(toastText()).toBe("No se ha podido hacer el PDF");
    expect(share).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Compartir (PDF)");
  });

  it("si tardó más de lo que deja el navegador, queda listo y se comparte con el siguiente toque", async () => {
    vi.stubGlobal("navigator", { ...navigator, userActivation: { isActive: false } });
    vi.mocked(makePdf).mockResolvedValue(FILE);
    const { btn } = mount("ruta", { E: null, lastE: engA });
    fireEvent.click(btn);
    await settle();
    expect(share).not.toHaveBeenCalled();
    expect(btn.textContent).toBe("Compartir el PDF");
    expect(toastText()).toBe("PDF listo: toca «Compartir el PDF»");
    fireEvent.click(btn);
    await settle();
    expect(makePdf).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(FILE.blob, FILE.name, FILE.text);
    expect(btn.textContent).toBe("Compartir (PDF)");
  });

  it("listo de otra ruta (ya no es la de la pantalla): se hace de nuevo", async () => {
    vi.stubGlobal("navigator", { ...navigator, userActivation: { isActive: false } });
    vi.mocked(makePdf).mockResolvedValue(FILE);
    const rt = { E: null as Engine | null, lastE: engA as Engine | null };
    const { btn } = mount("ruta", rt);
    fireEvent.click(btn);
    await settle();
    rt.lastE = engB;
    fireEvent.click(btn);
    await settle();
    expect(vi.mocked(makePdf).mock.calls.map((c) => c[1])).toEqual([engA, engB]);
    expect(share).not.toHaveBeenCalled();
  });

  it("en boxes, la tanda que se está rodando antes que la última acabada; sin ninguna, nada", async () => {
    vi.mocked(makePdf).mockResolvedValue(FILE);
    const { btn } = mount("tanda", { E: engB, lastE: engA });
    fireEvent.click(btn);
    await settle();
    expect(vi.mocked(makePdf).mock.calls[0][1]).toBe(engB);
    cleanup();
    const none = mount("ruta", { E: engB, lastE: null });
    fireEvent.click(none.btn);
    await settle();
    expect(makePdf).toHaveBeenCalledTimes(1);
  });
});
