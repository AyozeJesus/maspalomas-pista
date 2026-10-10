// Lo que el arnés de paridad necesita del motor nuevo dentro del navegador (se empaqueta en un solo script).
import { mergeChunks, type Chunk } from "../../src/core/formato";
import { demoSession } from "../../src/core/maspalomas";
import { enterPits, replayRecording, type EngineHost, type ReplayMeta } from "../../src/engine";
import { memoryKV } from "../../src/engine/kv";
import { DEFAULT_SETTINGS } from "../../src/engine/settings";
import { digestOf } from "../../test/engine-digest";

function host(): EngineHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    kv: memoryKV(),
    wallNow: () => Date.now(),
    perfNow: () => 0,
    isCurrent: () => true,
    // Como la app de antes en el navegador de las pruebas (ventana horizontal, sin girar).
    screenAngle: () => 0,
    axesPrior: () => 0,
    events: {},
  };
}

// Repasa una grabación (sus trozos, como los guarda el móvil) con el motor nuevo y devuelve su resumen en JSON.
async function replayDigest(meta: ReplayMeta, chunks: Chunk[]): Promise<string> {
  const S = mergeChunks(chunks).series;
  if (!S.loc || !S.loc.t.length) return JSON.stringify({ fail: "sin posiciones" });
  const eng = await replayRecording(host(), meta, S, () => false);
  if (!eng.free) enterPits(eng);
  return JSON.stringify(digestOf(eng));
}

(window as unknown as { __pista: unknown }).__pista = { replayDigest, demoSession };
