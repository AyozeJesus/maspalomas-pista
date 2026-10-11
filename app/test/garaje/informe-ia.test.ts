// Informe con IA del garaje, contra un Anthropic falso (MASPA_IA_URL): la clave se guarda en el Mac (0600) y nunca se
// devuelve, a la IA le llegan métricas sin posiciones ni nombre, dos peticiones a la vez son una sola, el informe se
// guarda con la tanda, los errores salen en castellano y por el túnel no se llega a nada de esto.
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSession } from "../../src/core/maspalomas";
import type { IaEstado, Informe } from "../../../garaje/api";
import { abrirGaraje, upload, type GarajePrueba } from "./servidor";

const KEY = "sk-ant-api03-" + "PruebaDeClave_".repeat(4);
const ID = "20261009-110000-ia01";
const EPOCH = Date.UTC(2026, 9, 9, 10, 0);

// Anthropic falso: contesta según `fake.mode` y apunta lo que le llega.
interface PeticionIa {
  model: string;
  system: string;
  messages: { content: string }[];
}
const fake: {
  mode: string;
  calls: number;
  last: PeticionIa | null;
  headers: IncomingHttpHeaders | null;
} = { mode: "ok", calls: 0, last: null, headers: null };

const ERRORES: Record<string, [number, string, string]> = {
  "401": [401, "authentication_error", "invalid x-api-key"],
  "429": [429, "rate_limit_error", "rate limited"],
  "529": [529, "overloaded_error", "Overloaded"],
  credit: [
    400,
    "invalid_request_error",
    "Your credit balance is too low to access the Anthropic API.",
  ],
};

let api: Server;
let g: GarajePrueba;

const post = (path: string, body?: unknown, garaje = true) =>
  fetch(g.garaje + path, {
    method: "POST",
    headers: garaje
      ? { "X-Garaje": "1", "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  api = createServer((req, res) => {
    let body = "";
    req.on("data", (d: Buffer) => (body += d));
    req.on("end", () => {
      fake.calls++;
      fake.headers = req.headers;
      try {
        fake.last = JSON.parse(body) as PeticionIa;
      } catch {
        fake.last = null;
      }
      const send = (status: number, obj: unknown, delay = 0) =>
        setTimeout(() => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(obj));
        }, delay);
      if (fake.mode === "slow") return; // no contesta
      const err = ERRORES[fake.mode];
      if (err) return send(err[0], { type: "error", error: { type: err[1], message: err[2] } });
      send(
        200,
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [
            {
              type: "text",
              text: "## La tanda\nBuena **tanda**: mejor vuelta 1:07,2.\n\n## Para la próxima tanda\n- Abre gas antes en C1",
            },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 5123, output_tokens: 410 },
        },
        300,
      );
    });
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
  const port = (api.address() as AddressInfo).port;
  g = await abrirGaraje({
    env: {
      MASPA_IA_URL: "http://127.0.0.1:" + port + "/v1/messages",
      MASPA_IA_TIEMPO_MS: "1500",
      ANTHROPIC_API_KEY: undefined,
      MASPA_IA_MODELO: undefined,
    },
  });
  await upload(g, ID, EPOCH, demoSession({ seed: 7 }).session, {
    tipo: "pista",
    piloto: "Ayoze Prueba",
    objetivo: 65,
    sentido: "osm",
    mejor: 67.2,
    recorrido: {
      frenadas: 31,
      frenadaMax: 1.21,
      mordidaMejor: 0.31,
      hundimientoMax: 2.6,
      frenadaTumbadoMax: 22,
    },
  });
});

afterAll(async () => {
  await g?.stop();
  api?.close();
});

describe("garaje: informe con IA", () => {
  it("sin clave no pide nada a Anthropic, y una clave mal copiada no se guarda", async () => {
    expect(((await (await fetch(g.garaje + "/api/ia")).json()) as IaEstado).configurada).toBe(
      false,
    );
    let r = await post("/api/tandas/" + ID + "/informe");
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/Falta la clave/);
    expect(fake.calls).toBe(0);
    r = await post("/api/ia", { clave: "hola" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/sk-ant-/);
  });

  it("guarda la clave solo legible por el usuario y nunca la devuelve", async () => {
    const r = await post("/api/ia", { clave: KEY });
    const saved = (await r.json()) as IaEstado & { ok: boolean };
    expect(saved).toEqual({
      ok: true,
      configurada: true,
      desde: "archivo",
      modelo: "claude-opus-5-5",
    });
    expect(statSync(join(g.datos, "ia.json")).mode & 0o777).toBe(0o600);
    const j = await (await fetch(g.garaje + "/api/ia")).text();
    expect(j).not.toContain("sk-ant");
  });

  it("dos peticiones a la vez son una sola, sin posiciones ni nombre del piloto", async () => {
    const [a1, a2] = await Promise.all([
      post("/api/tandas/" + ID + "/informe"),
      post("/api/tandas/" + ID + "/informe"),
    ]);
    expect([a1.status, a2.status]).toEqual([200, 200]);
    const [j1, j2] = (await Promise.all([a1.json(), a2.json()])) as { informe: Informe }[];
    expect(j1.informe.creado).toBe(j2.informe.creado);
    expect(fake.calls).toBe(1);
    expect(fake.headers?.["x-api-key"]).toBe(KEY);
    expect(fake.headers?.["anthropic-version"]).toBeTruthy();
    expect(fake.last?.model).toBe("claude-opus-5-5");
    expect(fake.last?.system).toMatch(/entrenador de motociclismo/);
    const msg = fake.last?.messages[0].content || "";
    expect(msg).not.toMatch(
      /"(lat|lon|latitud|longitud|latitude|longitude)"|Ayoze|27\.7\d{3}|-15\.5\d{3}/i,
    );
    expect(msg.length).toBeLessThan(60000);
    const datos = JSON.parse(msg.slice(msg.indexOf("{"), msg.lastIndexOf("}") + 1)) as {
      vueltas: unknown[];
      mejor_frente_al_objetivo: { plan_del_entrenador: string[] };
      frenadas: { frenadas: number };
    };
    expect(datos.vueltas.length).toBeGreaterThanOrEqual(5);
    expect(datos.mejor_frente_al_objetivo.plan_del_entrenador.length).toBeGreaterThan(0);
    expect(datos.frenadas.frenadas).toBe(31);
    const inf = JSON.parse(
      readFileSync(join(g.datos, "tandas", ID, "informe.json"), "utf8"),
    ) as Informe;
    expect(inf.modelo).toBe("claude-opus-5-5");
    expect(inf.uso?.entrada).toBe(5123);
    expect(inf.viejo).toBeUndefined();
    const guardado = (await (await fetch(g.garaje + "/api/tandas/" + ID + "/informe")).json()) as {
      informe: Informe;
    };
    expect(guardado.informe.texto).toMatch(/^## La tanda/);
    expect(guardado.informe.viejo).toBe(false);
  });

  it("explica en castellano lo que contesta Anthropic y conserva el informe bueno", async () => {
    const creado = (
      JSON.parse(readFileSync(join(g.datos, "tandas", ID, "informe.json"), "utf8")) as Informe
    ).creado;
    for (const [mode, re] of [
      ["401", /no acepta la clave/],
      ["429", /límite de uso/],
      ["529", /saturado/],
      ["credit", /no tiene saldo/],
      ["slow", /no ha contestado en 2 s/],
    ] as const) {
      fake.mode = mode;
      const r = await post("/api/tandas/" + ID + "/informe");
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect([mode, ((await r.json()) as { error: string }).error]).toEqual([
        mode,
        expect.stringMatching(re),
      ]);
    }
    fake.mode = "ok";
    const inf = JSON.parse(
      readFileSync(join(g.datos, "tandas", ID, "informe.json"), "utf8"),
    ) as Informe;
    expect(inf.creado).toBe(creado);
  });

  it("por el túnel no se llega, ni sin la cabecera del garaje", async () => {
    const key = g.clave();
    expect((await fetch(g.muelle + "/api/ia")).status).toBe(401);
    expect(
      (await fetch(g.muelle + "/api/ia", { headers: { Authorization: "Bearer " + key } })).status,
    ).toBe(404);
    expect(
      (
        await fetch(g.muelle + "/api/tandas/" + ID + "/informe", {
          method: "POST",
          headers: { Authorization: "Bearer " + key },
        })
      ).status,
    ).toBe(404);
    expect((await post("/api/tandas/" + ID + "/informe", undefined, false)).status).toBe(403);
    expect((await post("/api/ia", { clave: KEY }, false)).status).toBe(403);
  });
});
