// Lectura de las muestras de telemetría del vídeo por lotes.
import type { SampleTable } from "./mp4";
import { read } from "./reader";
import type { ByteReader } from "./types";

const MAX_PAYLOAD = 4 * 1024 * 1024;
// La telemetría va repartida por el archivo entre trozos de vídeo: se juntan las muestras que caen cerca y
// se dejan varias lecturas en vuelo, que en el navegador cada una tarda lo suyo.
const BATCH_BYTES = 1024 * 1024;
const BATCH_GAP = 64 * 1024;
const PREFETCH = 4;

// Un lote: los bytes [off, end) del archivo y las muestras que van en ellos.
interface Group {
  off: number;
  end: number;
  idx: number[];
}

// Un lote leído, o el error al leerlo.
type Arrival = { gr: Group; buf: Uint8Array } | { gr: Group; err: unknown };

// Lee las muestras de telemetría por lotes, con unas cuantas lecturas en vuelo, y las entrega en orden. Las que no se
// pueden leer (más de 4 MB, o fuera del archivo) van a onBad.
export async function eachPayload(
  reader: ByteReader,
  sm: SampleTable,
  onPayload: (i: number, payload: Uint8Array) => void,
  onBad: (i: number) => void,
  progress: (fraction: number) => void,
): Promise<void> {
  const groups: Group[] = [];
  let g: Group | null = null;
  for (let i = 0; i < sm.n; i++) {
    const off = sm.off[i];
    const size = sm.size[i];
    if (!size) continue;
    if (size > MAX_PAYLOAD || off >= reader.size) {
      onBad(i);
      continue;
    }
    if (g && off >= g.end && off - g.end <= BATCH_GAP && off + size - g.off <= BATCH_BYTES) {
      g.end = off + size;
      g.idx.push(i);
    } else {
      g = { off, end: off + size, idx: [i] };
      groups.push(g);
    }
  }
  const pending: Promise<Arrival>[] = [];
  let next = 0;
  let done = 0;
  const launch = () => {
    while (pending.length < PREFETCH && next < groups.length) {
      const gr = groups[next++];
      pending.push(
        read(reader, gr.off, gr.end - gr.off).then(
          (buf): Arrival => ({ gr, buf }),
          (err: unknown): Arrival => ({ gr, err }),
        ),
      );
    }
  };
  launch();
  while (pending.length) {
    const got = await (pending.shift() as Promise<Arrival>);
    if ("err" in got) throw got.err;
    launch();
    for (const i of got.gr.idx) {
      const a = sm.off[i] - got.gr.off;
      onPayload(i, got.buf.subarray(a, Math.min(got.buf.length, a + sm.size[i])));
    }
    done += got.gr.idx.length;
    progress(Math.min(1, done / sm.n));
  }
}
