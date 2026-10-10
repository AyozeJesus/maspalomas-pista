// Lectores del vídeo, que nunca se carga entero: se le piden trozos, a un buffer en memoria o a un File.
import { MSG } from "./messages";
import type { ByteReader } from "./types";

// Ninguna lectura pasa de 8 MB: el vídeo puede pesar varios GB y el navegador del móvil no lo aguantaría.
const MAX_READ = 8 * 1024 * 1024;

// Sobre un Uint8Array ya en memoria (Node y pruebas).
export function bufferReader(u8: Uint8Array): ByteReader {
  return {
    size: u8.length,
    read(offset, length) {
      const a = Math.max(0, Math.min(u8.length, offset));
      const b = Math.max(a, Math.min(u8.length, offset + length));
      return Promise.resolve(u8.subarray(a, b));
    },
  };
}

// Sobre un File del navegador: cada lectura es un slice(), así nunca se carga el vídeo entero.
export function fileReader(blob: Blob): ByteReader {
  return {
    size: blob.size,
    read(offset, length) {
      const a = Math.max(0, Math.min(blob.size, offset));
      const b = Math.max(a, Math.min(blob.size, offset + length));
      return blob
        .slice(a, b)
        .arrayBuffer()
        .then((buf) => new Uint8Array(buf));
    },
  };
}

// Una lectura, siempre como Uint8Array. Si el lector falla (archivo movido o borrado), el error lo explica para quien
// abre el vídeo y lleva el original como causa.
export function read(reader: ByteReader, offset: number, length: number): Promise<Uint8Array> {
  return Promise.resolve()
    .then(() => reader.read(offset, length))
    .then(
      (u8) => (u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)),
      (e: unknown) => {
        throw new Error(MSG.unreadable, { cause: e });
      },
    );
}

// Una lectura de más de 8 MB, en trozos; si el archivo se acaba antes, lo que haya.
export async function readFull(
  reader: ByteReader,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (length <= MAX_READ) return read(reader, offset, length);
  const out = new Uint8Array(length);
  let got = 0;
  while (got < length) {
    const part = await read(reader, offset + got, Math.min(MAX_READ, length - got));
    if (!part.length) break;
    out.set(part, got);
    got += part.length;
  }
  return got < length ? out.subarray(0, got) : out;
}
