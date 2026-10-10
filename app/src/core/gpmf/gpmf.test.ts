import { describe, expect, it } from "vitest";
import * as F from "../../../test/fixtures-gpmf";
import { legacy } from "../../../test/legacy";
import * as G from "./index";

// La app de antes, tal cual (gpmf.js de la raíz del repo).
const old = legacy<typeof G>("MaspaGPMF", "gpmf.js");

type Api = typeof G;
type Src = Uint8Array | G.ByteReader;

// Lo que devolvió una lectura.
interface Got {
  data: G.GpmfData | null;
  error: string | null;
  reads: [number, number][];
  // Lecturas en vuelo a la vez, como mucho.
  inflight: number;
  progress: number[];
}

// Una lectura con una de las dos versiones. cmp es lo que se compara: la telemetría (y el orden de sus claves) o el
// error con su causa, el progreso y cada lectura pedida al archivo, en orden y cuántas a la vez.
async function run(api: Api, src: Src): Promise<{ cmp: unknown; got: Got }> {
  const progress: number[] = [];
  const reads: [number, number][] = [];
  let open = 0;
  let inflight = 0;
  const base = src instanceof Uint8Array ? api.bufferReader(src) : src;
  const reader: G.ByteReader = {
    size: base.size,
    read(offset, length) {
      reads.push([offset, length]);
      inflight = Math.max(inflight, ++open);
      const r = base.read(offset, length);
      const settle = () => {
        open--;
      };
      Promise.resolve(r).then(settle, settle);
      return r;
    },
  };
  try {
    const data = await api.extract(reader, { onProgress: (f) => progress.push(f) });
    return {
      cmp: { data: F.plain(data), keys: Object.keys(data), progress, reads, inflight },
      got: { data, error: null, reads, inflight, progress },
    };
  } catch (e) {
    const err = e as Error;
    const cause = err.cause === undefined ? undefined : String(err.cause);
    return {
      cmp: { name: err.name, message: err.message, cause, progress, reads, inflight },
      got: { data: null, error: err.message, reads, inflight, progress },
    };
  }
}

// La misma entrada a las dos versiones, cada una con su lector: todo igual.
async function same(src: (api: Api) => Src): Promise<{ mine: Got; theirs: Got }> {
  const a = await run(G, src(G));
  const b = await run(old, src(old));
  expect(a.cmp).toEqual(b.cmp);
  return { mine: a.got, theirs: b.got };
}

// La telemetría de una lectura que tenía que salir bien.
function data(got: Got): G.GpmfData {
  expect(got.error).toBeNull();
  if (!got.data) throw new Error("sin telemetría");
  return got.data;
}

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("falta");
  return x;
}

// La tanda con las dos versiones y la misma entrada: igual, también en el orden de las claves.
function session(src: G.SessionSource, opts?: G.ToSessionOptions | null): G.GoproSession {
  const mine = G.toSession(src, opts);
  const theirs = old.toSession(src, opts);
  expect(F.plain(mine)).toEqual(F.plain(theirs));
  expect(Object.keys(mine)).toEqual(Object.keys(theirs));
  return mine;
}

// Lector que devuelve como mucho max bytes por lectura (o nada, si se le pide más de max).
function short(r: G.ByteReader, max: number, empty = false): G.ByteReader {
  return {
    size: r.size,
    read: (o, l) => (empty && l > max ? new Uint8Array(0) : r.read(o, Math.min(l, max))),
  };
}

describe("gpmf (igual que el de antes)", () => {
  it("mensajes y lector de un buffer: igual", async () => {
    expect(G.MSG).toEqual(old.MSG);
    const u8 = Uint8Array.from({ length: 50 }, (_, i) => i * 3);
    const cuts: [number, number][] = [
      [0, 10],
      [-5, 10],
      [45, 20],
      [60, 5],
      [10, -3],
      [0, 0],
      [3, 47],
    ];
    for (const [o, l] of cuts) {
      const mine = await G.bufferReader(u8).read(o, l);
      expect(F.plain(mine)).toEqual(F.plain(await old.bufferReader(u8).read(o, l)));
    }
    expect(F.plain(await G.bufferReader(u8).read(3, 4))).toEqual({ Uint8Array: [9, 12, 15, 18] });
    expect(G.bufferReader(u8).size).toBe(old.bufferReader(u8).size);
  });

  it("HERO5–10: GPS5 con GPSU, ACCL/GYRO con ORIN y el modelo en udta (trozos de 2 + 1 muestras), igual", async () => {
    const u8 = F.mp4(F.h5Payloads(), { chunks: [2, 1], minf: "HERO7 Black" });
    const { mine, theirs } = await same(() => u8);
    const d = data(mine);
    expect(d.gps.t.length).toBe(54);
    for (let j = 0; j < 54; j++) {
      expect(d.gps.t[j]).toBeCloseTo(F.t5(j), 9);
      expect(d.gps.lat[j]).toBeCloseTo(F.lat5(j), 9);
      expect(d.gps.lon[j]).toBeCloseTo(F.lon5(j), 9);
    }
    expect(d.gps.t[18]).toBeCloseTo(1.001, 12);
    expect(d.gps.t[36]).toBeCloseTo(2.002, 12);
    expect(d.gps.speed[20]).toBeCloseTo(21, 9);
    expect(d.gps.alt[20]).toBeCloseTo(25.2, 9);
    expect(Array.from(d.gps.dop).every((x) => x === 1.5)).toBe(true);
    expect(Array.from(d.gps.fix).every((x) => x === 3)).toBe(true);
    expect(d.gpsStartUtc).toBe(F.UTC0);
    expect(d.gpsStartT).toBe(0);
    const acc = must(d.acc);
    const gyro = must(d.gyro);
    expect([acc.t.length, gyro.t.length]).toEqual([600, 600]);
    // El acelerómetro / SCAL 418 en m/s², con la gravedad y en el orden guardado; el giroscopio / 939 en rad/s.
    expect(acc.x[5]).toBeCloseTo(105 / 418, 12);
    expect(acc.y[5]).toBeCloseTo(4100 / 418, 12);
    expect(acc.z[205]).toBeCloseTo(-199 / 418, 12);
    expect([gyro.x[7], gyro.y[7], gyro.z[7]]).toEqual([7 / 939, -7 / 939, 14 / 939]);
    expect(acc.t[1]).toBeCloseTo(1.001 / 200, 12);
    expect(acc.t[200]).toBeCloseTo(1.001, 12);
    expect(d.orin).toBe("ZXY");
    expect(d.camera).toBe("HERO7 Black");
    expect(d.duration).toBeCloseTo(3.003, 9);
    expect(d.created).toBe(F.T0);
    expect(d.warnings).toEqual([]);
    expect(d.gps.t).toBeInstanceOf(Float64Array);
    expect(acc.x).toBeInstanceOf(Float64Array);
    const p = mine.progress;
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect([p[0], p[p.length - 1]]).toEqual([0, 1]);
    expect(p.every((f, i) => !i || f >= p[i - 1])).toBe(true);
    // Su tanda: la misma con las dos, también desde la telemetría que sacó cada una.
    const s = session(d);
    expect(F.plain(s)).toEqual(F.plain(old.toSession(data(theirs))));
    expect(s.loc.hacc[0]).toBe(3.75);
  });

  it("HERO11+: GPS9 con co64, mvhd/mdhd v1 y un moov de 20 MB detrás de 5 GB, igual", async () => {
    const { mine } = await same(() => F.bigFile());
    const d = data(mine);
    expect(d.gps.t.length).toBe(30);
    for (let g = 0; g < 30; g++) {
      expect(d.gps.lat[g]).toBeCloseTo((277600000 + g * 111) / 1e7, 9);
      expect(d.gps.lon[g]).toBeCloseTo((-155400000 + g * 55) / 1e7, 9);
    }
    // Fijo y DOP por muestra (sin fijo hasta la 5.ª); velocidad 2D y altitud de GPS9.
    expect([d.gps.fix[3], d.gps.fix[4]]).toEqual([0, 3]);
    expect(d.gps.dop[4]).toBeCloseTo(1.04, 12);
    expect(d.gps.speed[12]).toBeCloseTo(15.12, 9);
    expect(d.gps.alt[12]).toBeCloseTo(30.012, 9);
    expect(d.gps.t[15]).toBeCloseTo(1.001 + 0.5005, 9);
    // Hora del primer fijo desde los días y segundos de GPS9.
    expect(d.gpsStartUtc).toBe(Date.UTC(2000, 0, 1) + F.DAYS * 864e5 + 37815000 + 400);
    expect(d.gpsStartT).toBeCloseTo(0.4004, 9);
    expect(d.created).toBe(F.T11);
    expect(d.duration).toBeCloseTo(3.003, 9);
    expect([d.camera, d.orin]).toEqual(["HERO11 Black", null]);
    expect(must(d.acc).t.length).toBe(600);
    expect(must(d.acc).x[0]).toBeCloseTo(4100 / 418, 12);
    expect(d.warnings).toEqual([]);
    // El moov de 20 MB, a trozos de 8 MB como mucho.
    expect(Math.max(...mine.reads.map((r) => r[1]))).toBe(8 * 1024 * 1024);
    session(d);
  }, 30000);

  it("claves desconocidas con tamaños y tipos raros (en un STRM propio y antes de GPS5): se saltan, igual", async () => {
    const odd = [
      F.kv(
        "ZZZ1",
        "B",
        3,
        5,
        Uint8Array.from({ length: 15 }, (_, i) => i + 1),
      ),
      F.kv(
        "ZZZ2",
        "h",
        5,
        3,
        Uint8Array.from({ length: 15 }, (_, i) => 200 - i),
      ),
      F.nest("ZZZ3", F.kstr("QQQQ", "abc"), F.kv("QQQR", "b", 1, 1, [7])),
      F.kv("ZZZ4", "G", 16, 1, F.zeros(16).fill(9)),
      F.kv("ZZZ5", "d", 8, 2, F.nums("d", [1.5, -2.5])),
      F.kv("ZZZ6", "c", 7, 1, "abcdefg"),
    ];
    const pre = F.nest(
      "STRM",
      F.kstr("STNM", "Raro"),
      F.knum("SCAL", "s", [3]),
      odd,
      F.kv("CORI", "s", 8, 2, F.zeros(16)),
    );
    const { mine } = await same(() => F.mp4(F.h5Payloads({ pre, extra: odd }), { chunks: [3] }));
    const d = data(mine);
    expect([d.gps.t.length, must(d.acc).t.length]).toEqual([54, 600]);
    for (let j = 0; j < 54; j++) expect(d.gps.lat[j]).toBeCloseTo(F.lat5(j), 9);
    expect(d.warnings).toEqual([]);
  });

  it("trozos cortados: el último a mitad del acelerómetro, o el archivo a mitad del último trozo, igual", async () => {
    const pls = F.h5Payloads();
    const cut = F.find(pls[2], "ACCL") + 100;
    const a = data(
      (await same(() => F.mp4([pls[0], pls[1], pls[2].subarray(0, cut)], { chunks: [2, 1] }))).mine,
    );
    // Su GPS (antes del corte) se queda; su ACCL/GYRO no.
    expect([a.gps.t.length, must(a.acc).t.length, must(a.gyro).t.length]).toEqual([54, 400, 400]);
    expect(a.warnings).toHaveLength(1);
    expect(a.warnings[0]).toMatch(/segundo 2 del vídeo/);
    const whole = F.mp4(pls, { chunks: [2, 1], moovFirst: true, mdatToEnd: true });
    const end = F.find(whole, "DEVC", true) + 300;
    const b = data((await same(() => whole.subarray(0, end))).mine);
    expect(b.gps.t.length).toBe(36);
    expect(b.gps.lat[35]).toBeCloseTo(F.lat5(35), 9);
    expect(must(b.acc).t.length).toBe(400);
    expect(b.warnings).toHaveLength(1);
  });

  it("listas de edición: hueco inicial, adelanto (v1), solo huecos y sin reloj de película, igual", async () => {
    const cases: [F.Mp4Options, number][] = [
      [
        {
          elst: [
            [500, -1],
            [3003, 0],
          ],
        },
        0.5,
      ],
      [{ elst: [[3003, 500]], elst1: true }, -0.5],
      [
        {
          elst: [
            [250, -1],
            [100, -1],
            [3003, 1001],
          ],
          elst1: true,
        },
        0.35 - 1.001,
      ],
      [
        {
          elst: [
            [200, -1],
            [300, -1],
          ],
        },
        0,
      ],
      [
        {
          elst: [
            [500, -1],
            [3003, 0],
          ],
          mvhd: false,
        },
        0,
      ],
    ];
    for (const [o, t0] of cases) {
      const d = data((await same(() => F.mp4(F.h5Payloads(), o))).mine);
      expect(d.gps.t[0]).toBeCloseTo(t0, 12);
      expect(d.gps.t[18]).toBeCloseTo(t0 + 1.001, 12);
    }
  });

  it("stsc con dos tramos (1 muestra por trozo y, desde el 3.º, 2): cada posición en su sitio, igual", async () => {
    const six = [0, 1, 2, 3, 4, 5].map((k) => F.h5Payload(k));
    const d = data((await same(() => F.mp4(six, { chunks: [1, 1, 2, 2] }))).mine);
    expect(d.gps.t.length).toBe(108);
    for (let j = 0; j < 108; j++) {
      expect(d.gps.lat[j]).toBeCloseTo(F.lat5(j), 9);
      expect(d.gps.t[j]).toBeCloseTo(F.t5(j), 9);
    }
  });

  it("duración 0 en stts: el último trozo dura como el anterior, igual", async () => {
    const d = data((await same(() => F.mp4(F.h5Payloads(), { deltas: [1001, 1001, 0] }))).mine);
    expect(d.gps.t[53]).toBeCloseTo(2.002 + (1.001 * 17) / 18, 9);
  });

  it("GPS9: sin hora (vale el GPSU del GPS5), con la hora más tarde, con TYPE «l[7]S[2]» o sin fijos, igual", async () => {
    const g5 = (k: number, fix = 3) =>
      F.gps5Strm({
        fix,
        dop: 99,
        utc: F.GPSU[k],
        rows: Array.from({ length: 18 }, (_, i) => [277000000 + i, -155000000, 0, 0, 0]),
      });
    const g9 = (k: number, days: (g: number) => number, fix: number, type?: string) =>
      F.gps9Strm(
        Array.from({ length: 10 }, (_, i) => {
          const g = k * 10 + i;
          return [277600000 + g, -155400000, 0, 0, 0, days(g), 1000 * g, 120, fix];
        }),
        type,
      );
    const noTime = [0, 1, 2].map((k) =>
      F.devc(
        "HERO11 Black",
        g5(k),
        g9(k, () => 0, 3),
      ),
    );
    const a = data((await same(() => F.mp4(noTime))).mine);
    expect([a.gps.t.length, a.gpsStartUtc]).toEqual([30, F.UTC0]);
    expect(a.gps.lat[29]).toBeCloseTo((277600000 + 29) / 1e7, 9);
    // Hora desde la 6.ª muestra (5 s del día: su campo va en ms con SCAL 1000), llevada hacia atrás con el reloj del
    // vídeo.
    const later = [0, 1, 2].map((k) =>
      F.devc(
        "HERO11 Black",
        g9(k, (g) => (g < 5 ? 0 : F.DAYS), 3, "l[7]S[2]"),
      ),
    );
    const b = data((await same(() => F.mp4(later))).mine);
    expect(b.gps.t.length).toBe(30);
    expect(b.gpsStartUtc).toBe(
      Math.round(Date.UTC(2000, 0, 1) + F.DAYS * 864e5 + 5000 - (b.gps.t[5] - b.gps.t[0]) * 1000),
    );
    // GPS9 sin ningún fijo: se usa el GPS5.
    const noFix = [0, 1, 2].map((k) =>
      F.devc(
        "HERO11 Black",
        g5(k),
        g9(k, () => F.DAYS, 0),
      ),
    );
    const c = data((await same(() => F.mp4(noFix))).mine);
    expect([c.gps.t.length, c.gpsStartUtc]).toEqual([54, F.UTC0]);
  });

  it("errores: sin pista gpmd, sin fijo, sin GPS, sin índice y lo que no es un MP4, igual", async () => {
    let x = 12345;
    const noise = Uint8Array.from({ length: 4096 }, () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return (x >> 16) & 255;
    });
    const ftyp = F.box("ftyp", "mp41");
    const huge = 300 * 1024 * 1024;
    const cases: [() => Src, string][] = [
      [() => F.mp4(F.h5Payloads(), { gpmd: false }), G.MSG.noGpmf],
      [() => F.mp4(F.h5Payloads({ fix: 0 })), G.MSG.noGps],
      [() => F.mp4(F.h5Payloads({ fix: 1 })), G.MSG.noGps],
      [() => F.mp4(F.h5Payloads({ gps: false })), G.MSG.noGps],
      [() => F.mp4(F.h5Payloads(), { drop: ["stco"] }), G.MSG.noGps],
      [() => F.mp4(F.h5Payloads(), { drop: ["stts"] }), G.MSG.noGps],
      [() => F.mp4(F.h5Payloads(), { timescale: 0 }), G.MSG.noGps],
      [() => new TextEncoder().encode("hola, esto no es un vídeo de nada"), G.MSG.notMp4],
      [() => noise, G.MSG.notMp4],
      [() => new Uint8Array(0), G.MSG.notMp4],
      [() => F.cat(ftyp, F.box("mdat", F.zeros(1000))), G.MSG.notMp4],
      // Caja de 4 bytes; tamaño de 64 bits sin sitio para él, o igual a 0.
      [() => F.cat(F.be32(4), "ftyp", F.zeros(20)), G.MSG.notMp4],
      [() => F.cat(F.be32(1), "ftyp"), G.MSG.notMp4],
      [() => F.cat(F.be32(1), "ftyp", F.be64(0), F.zeros(8)), G.MSG.notMp4],
      // Tipo de caja que no es de letras.
      [() => F.cat(F.be32(16), [1, 2, 3, 4], F.zeros(8)), G.MSG.notMp4],
      // Un mdat «hasta el final» delante: el moov de detrás no se ve.
      [() => F.cat(ftyp, F.be32(0), "mdat", F.zeros(64), F.box("moov", F.zeros(16))), G.MSG.notMp4],
      // moov más largo que el archivo, o de más de 256 MB.
      [() => F.cat(ftyp, F.be32(1000), "moov", F.zeros(10)), G.MSG.notMp4],
      [
        () =>
          F.sparse(ftyp.length + huge + 64, [{ off: 0, bytes: F.cat(ftyp, F.be32(huge), "moov") }]),
        G.MSG.notMp4,
      ],
    ];
    for (const [src, msg] of cases) expect((await same(src)).mine.error).toBe(msg);
  });

  it("lectores que fallan, que tardan, que leen poco o que devuelven otra cosa: igual", async () => {
    const u8 = F.mp4(F.h5Payloads(), { chunks: [2, 1] });
    const mdatBody = F.find(u8, "mdat") + 4;
    const moovAt = F.find(u8, "moov", true) - 4;
    const from = (o: number, l: number) => u8.subarray(o, o + l);
    const base = await same(() => u8);
    const failing: (() => G.ByteReader)[] = [
      () => ({ size: u8.length, read: () => Promise.reject(new Error("disco")) }),
      () => ({
        size: u8.length,
        read: () => {
          throw new Error("sin permiso");
        },
      }),
      // Solo al leer la telemetría (dentro del mdat), y con algo que no es un Error.
      () => ({
        size: u8.length,
        read: (o, l) =>
          o >= mdatBody && o < moovAt ? Promise.reject("se fue") : Promise.resolve(from(o, l)),
      }),
    ];
    for (const mk of failing) {
      const { mine } = await same(mk);
      expect(mine.error).toBe(G.MSG.unreadable);
    }
    // ArrayBuffer, lista de bytes sin promesa, o lecturas que acaban en otro orden: lo mismo que con el buffer.
    const odd: (() => G.ByteReader)[] = [
      () => ({ size: u8.length, read: (o, l) => Promise.resolve(u8.slice(o, o + l).buffer) }),
      () => ({ size: u8.length, read: (o, l) => Array.from(from(o, l)) }),
    ];
    for (const mk of odd) {
      const { mine } = await same(mk);
      expect(F.plain(mine.data)).toEqual(F.plain(base.mine.data));
    }
    const spread = F.mp4(
      [0, 1, 2, 3, 4, 5].map((k) => F.h5Payload(k % 3)),
      { frame: 70 * 1024 },
    );
    const slow = (): G.ByteReader => ({
      size: spread.length,
      read: (o, l) =>
        new Promise((done) => setTimeout(() => done(spread.subarray(o, o + l)), (o * 7) % 5)),
    });
    const inOrder = await same(slow);
    expect(F.plain(inOrder.mine.data)).toEqual(F.plain((await same(() => spread)).mine.data));
    // Lecturas cortas: el moov no llega entero (no es un MP4); en el grande, a trozos de 3 MB sí.
    expect((await same(() => short(G.bufferReader(u8), 300))).mine.error).toBe(G.MSG.notMp4);
    const big = await same(() => short(F.bigFile(), 3 * 1024 * 1024));
    expect(F.plain(big.mine.data)).toEqual(F.plain((await same(() => F.bigFile())).mine.data));
    expect((await same(() => short(F.bigFile(), 1024 * 1024, true))).mine.error).toBe(G.MSG.notMp4);
  }, 30000);

  it("varios dispositivos: el accesorio no se mezcla; dos GPS5 en un STRM y GPSU/GPSP detrás de los datos, igual", async () => {
    const rows = (k: number, n: number) =>
      Array.from({ length: n }, (_, i) => [k * 1000 + i, -i, 4100 - i]);
    const pls = [0, 1, 2].map((k) => {
      const fixes = Array.from({ length: 10 }, (_, i) => [
        277500000 + (k * 10 + i) * 99,
        -155300000 - i,
        1000 + i,
        5000 + i,
        0,
      ]);
      const gps = F.nest(
        "STRM",
        F.knum("GPSF", "L", [3]),
        F.knum("SCAL", "l", [1e7, 1e7, 1000, 1000, 100]),
        F.knum("GPS5", "l", fixes.slice(0, 4).flat(), 5),
        F.knum("GPS5", "l", fixes.slice(4).flat(), 5),
        F.kv("GPSU", "U", 16, 1, F.GPSU[k]),
        F.knum("GPSP", "S", [250]),
      );
      const camera = F.device(
        1,
        k ? null : "Cámara",
        gps,
        F.imuStrm("ACCL", 418, rows(k, 50)),
        F.imuStrm("GYRO", 939, rows(k, 50)),
      );
      const accessory = F.device(
        7,
        "Accesorio",
        F.imuStrm("ACCL", 100, rows(9, 30), "XYZ"),
        F.imuStrm("GYRO", 100, rows(9, 30)),
      );
      // Sin DVID: otro dispositivo más.
      const anon = F.nest("DEVC", F.kstr("DVNM", "Anónimo"), F.imuStrm("ACCL", 1, rows(5, 20)));
      return k === 0 ? F.cat(camera, accessory) : F.cat(accessory, anon, camera);
    });
    const d = data((await same(() => F.mp4(pls))).mine);
    expect([d.camera, d.orin]).toEqual(["Cámara", null]);
    const acc = must(d.acc);
    expect(acc.t.length).toBe(150);
    expect(acc.x[50]).toBeCloseTo(1000 / 418, 12);
    expect(d.gps.t.length).toBe(30);
    expect(d.gps.t[4]).toBeCloseTo(0.4004, 12);
    expect(d.gps.dop[0]).toBe(2.5);
    expect(d.gpsStartUtc).toBe(F.UTC0);
  });

  it("claves pegajosas: SCAL, TYPE, GPSF y GPSP del primer trozo valen para los siguientes, igual", async () => {
    const pls = [0, 1, 2].map((k) => {
      const fixes = Array.from({ length: 5 }, (_, i) => [
        277500000 + (k * 5 + i) * 50,
        -155300000,
        0,
        3000,
        0,
      ]);
      const acc = Array.from({ length: 20 }, (_, i) => [i, k, -i]).flat();
      return F.devc(
        "Camera",
        F.nest(
          "STRM",
          k
            ? []
            : [
                F.knum("GPSF", "L", [2]),
                F.knum("GPSP", "S", [400]),
                F.knum("SCAL", "l", [1e7, 1e7, 1000, 1000, 100]),
              ],
          F.knum("GPS5", "l", fixes.flat(), 5),
        ),
        F.nest(
          "STRM",
          k ? [] : [F.knum("SCAL", "s", [418]), F.kstr("TYPE", "s[3]")],
          F.kv("ACCL", "?", 6, 20, F.nums("s", acc)),
        ),
        // Un tipo complejo que nunca dice su TYPE: no sale.
        F.nest("STRM", F.knum("SCAL", "s", [2]), F.kv("GYRO", "?", 6, 20, F.nums("s", acc))),
      );
    });
    const d = data((await same(() => F.mp4(pls))).mine);
    expect(d.gps.t.length).toBe(15);
    expect(d.gps.lat[14]).toBeCloseTo((277500000 + 14 * 50) / 1e7, 9);
    expect(Array.from(d.gps.dop)).toEqual(new Array(15).fill(4));
    expect(Array.from(d.gps.fix)).toEqual(new Array(15).fill(2));
    expect(must(d.acc).y[59]).toBeCloseTo(2 / 418, 12);
    expect(d.gyro).toBeNull();
    expect(d.gpsStartUtc).toBeNull();
  });

  it("tipos de dato del acelerómetro y del giroscopio (b, B, s, S, l, L, f, d, q, Q, j, J y los que no son números), igual", async () => {
    const gen: Record<string, (i: number, c: number) => number> = {
      b: (i, c) => ((i * 7 + c * 31) % 200) - 100,
      B: (i, c) => (i * 7 + c * 31) % 256,
      s: (i, c) => ((i * 977 + c * 131) % 60000) - 30000,
      S: (i, c) => (i * 977 + c * 131) % 65536,
      l: (i, c) => ((i * 977123 + c * 13) % 2e9) - 1e9,
      L: (i, c) => (i * 977123 + c * 13) % 4e9,
      f: (i, c) => (i - 50) * 0.37 + c * 1e-3,
      d: (i, c) => (i - 50) * 0.123456789 + c,
      q: (i, c) => (i - 50) * 0.125 + c / 4,
      Q: (i, c) => (i - 50) * 1.5 + c * 0.25,
      j: (i, c) => (i - 50) * 1e10 + c,
      J: (i, c) => i * 1e10 + c,
    };
    // Bytes por valor de los que no tienen escritura (x no es un tipo de GPMF).
    const raw: Record<string, number> = { c: 1, U: 16, F: 4, G: 16, x: 2 };
    for (const t of [...F.WRITABLE, ...Object.keys(raw)]) {
      const make = gen[t];
      const data3 = (key: string, k: number) =>
        make
          ? F.knum(
              key,
              t,
              Array.from({ length: 40 * 3 }, (_, n) => make(Math.floor(n / 3) + 40 * k, n % 3)),
              3,
            )
          : F.kv(
              key,
              t,
              3 * raw[t],
              40,
              Uint8Array.from({ length: 3 * raw[t] * 40 }, (_, n) => 0x41 + ((n + k) % 26)),
            );
      const pls = [0, 1, 2].map((k) =>
        F.h5Payload(k, {
          imu: false,
          pre: [
            F.nest("STRM", F.knum("SCAL", "s", [4]), data3("ACCL", k)),
            F.nest("STRM", data3("GYRO", k)),
          ],
        }),
      );
      const d = data((await same(() => F.mp4(pls))).mine);
      expect(d.gps.t.length).toBe(54);
      if (make) {
        expect([must(d.acc).t.length, must(d.gyro).t.length]).toEqual([120, 120]);
        expect(must(d.acc).x[1]).toBeCloseTo(make(1, 0) / 4, 2);
      } else expect([d.acc, d.gyro]).toEqual([null, null]);
    }
  });

  it("SCAL: uno para todos, uno por campo, con ceros, de menos, negativo, de otro tipo, en texto o ninguno, igual", async () => {
    const scals: F.Part[] = [
      F.knum("SCAL", "s", [418]),
      F.knum("SCAL", "l", [100, 200, 400]),
      F.knum("SCAL", "s", [0]),
      F.knum("SCAL", "s", [10, 20]),
      F.knum("SCAL", "s", [-418]),
      F.knum("SCAL", "f", [2.5]),
      F.knum("SCAL", "L", [7, 0, 9, 11]),
      F.knum("SCAL", "q", [1.5]),
      F.kstr("SCAL", "abc"),
      [],
    ];
    for (const scal of scals) {
      const pls = [0, 1].map((k) =>
        F.h5Payload(k, {
          imu: false,
          pre: F.nest(
            "STRM",
            scal,
            F.knum(
              "ACCL",
              "s",
              Array.from({ length: 60 }, (_, i) => (i % 7) - 3 + k),
              3,
            ),
          ),
        }),
      );
      const d = data((await same(() => F.mp4(pls))).mine);
      expect(must(d.acc).t.length).toBe(40);
    }
  });

  it("tipos complejos con TYPE: repeticiones [n], letra desconocida, tamaño que no cuadra o sin TYPE, igual", async () => {
    // TYPE, tamaño de estructura y si sale el acelerómetro.
    const cases: [string | null, number, boolean][] = [
      ["sss", 6, true],
      ["s[3]", 6, true],
      ["s[2]s", 6, true],
      ["lsS", 8, true],
      ["ssc", 5, true],
      ["f[3]", 12, true],
      ["s[0]sss", 6, true],
      ["bBsSf", 10, true],
      ["xss", 6, false],
      ["ll", 6, false],
      ["ss", 4, false],
      [null, 6, false],
      ["", 6, false],
    ];
    for (const [type, ss, shows] of cases) {
      const bytes = (k: number) =>
        Uint8Array.from({ length: ss * 25 }, (_, i) => (i * 29 + 7 + k) & 255);
      const pls = [0, 1].map((k) =>
        F.h5Payload(k, {
          imu: false,
          pre: F.nest(
            "STRM",
            F.knum("SCAL", "s", [3]),
            type === null ? [] : F.kstr("TYPE", type),
            F.kv("ACCL", "?", ss, 25, bytes(k)),
          ),
        }),
      );
      const d = data((await same(() => F.mp4(pls))).mine);
      if (shows) expect(must(d.acc).t.length).toBe(50);
      else expect(d.acc).toBeNull();
    }
  });

  it("KLV dañados: clave o tipo que no son letras, basura al final, dato cortado, otras claves y relleno, igual", async () => {
    const badKey = F.cat([1, 2, 3, 4], "L", 4, F.be16(1), F.be32(5));
    const badType = F.cat("ABCD", 1, 4, F.be16(1), F.be32(5));
    const cutData = F.nest(
      "STRM",
      F.knum("SCAL", "s", [418]),
      F.cat("ACCL", "s", 6, F.be16(1000), F.zeros(12)),
    );
    // Cada muestra (k = 0, 1, 2) y cuántos avisos salen.
    const variants: [(k: number) => Uint8Array, number][] = [
      [(k) => F.h5Payload(k, k === 1 ? { extra: badKey } : {}), 1],
      [(k) => F.h5Payload(k, k === 1 ? { pre: badType } : {}), 1],
      [(k) => F.cat(F.h5Payload(k), k === 2 ? [0, 0, 0, 0, 0, 7] : []), 1],
      [(k) => F.cat(F.h5Payload(k), F.zeros(64)), 0],
      [(k) => F.h5Payload(k, k === 0 ? { pre: cutData } : {}), 1],
      [(k) => F.cat(F.nest("XXXX", F.kstr("ABCD", "x")), F.kstr("DEVC", "no"), F.h5Payload(k)), 0],
      [(k) => (k === 1 ? F.zeros(32) : F.h5Payload(k)), 0],
    ];
    for (const [mk, warnings] of variants) {
      const d = data((await same(() => F.mp4([0, 1, 2].map(mk)))).mine);
      expect(d.gps.t.length).toBeGreaterThanOrEqual(36);
      expect(d.warnings).toHaveLength(warnings);
    }
  });

  it("muestras raras en el índice: tamaño 0, de más de 4 MB, fuera del archivo o más allá del final, igual", async () => {
    const pls = [0, 1, 2, 3, 4, 5].map((k) => F.h5Payload(k % 3));
    const sizes = pls.map((p) => p.length);
    sizes[1] = 0;
    sizes[2] = 5 * 1024 * 1024;
    sizes[5] += 2000;
    const u8 = F.mp4(pls, {
      moovFirst: true,
      sizes,
      offs: (o) => o.map((x, i) => (i === 3 ? 1e9 : x)),
    });
    const d = data((await same(() => u8)).mine);
    expect(d.gps.t.length).toBe(54);
    expect(d.warnings).toEqual([
      "3 trozos de la telemetría están dañados o cortados (el primero hacia el segundo 2 del vídeo): se ha usado lo que se podía leer.",
    ]);
  });

  it("lotes: muestras lejanas (una lectura cada una, 4 en vuelo) y cercanas que pasan de 1 MB, igual", async () => {
    const far = F.mp4(
      [0, 1, 2, 3, 4, 5, 6].map((k) => F.h5Payload(k % 3)),
      { frame: 70 * 1024 },
    );
    const a = await same(() => far);
    expect(data(a.mine).gps.t.length).toBe(7 * 18);
    // 4 lecturas para dar con el moov y leerlo, y una por muestra.
    expect(a.mine.reads.length).toBe(4 + 7);
    expect(a.mine.inflight).toBe(4);
    expect(a.mine.progress).toEqual([0, 1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1, 1]);
    const fat = (k: number) =>
      F.h5Payload(k % 3, { pre: F.kv("ZZZZ", "B", 250, 800, F.zeros(200000).fill(7)) });
    const b = await same(() => F.mp4([0, 1, 2, 3, 4, 5].map(fat)));
    expect(data(b.mine).gps.t.length).toBe(6 * 18);
    // Hasta 1 MB por lectura: dos lotes.
    expect(b.mine.reads.length).toBe(4 + 2);
    expect(Math.max(...b.mine.reads.map((r) => r[1]))).toBeLessThanOrEqual(1024 * 1024);
  });

  it("moov y pistas raras: tamaños de 64 bits o 0, delante, sin mvhd, fechas imposibles, co64, índices a medias, igual", async () => {
    const deep = (n: number): F.Part =>
      n ? F.nest("DEEP", deep(n - 1)) : F.kstr("MINF", "HERO9 Black");
    const cases: [F.Mp4Options, number, string | null][] = [
      [{ moov64: true }, 54, "Camera"],
      [{ moovToEnd: true }, 54, "Camera"],
      [{ moovFirst: true, moov64: true, mdatToEnd: true }, 54, "Camera"],
      [{ mvhd: false }, 54, "Camera"],
      [{ mvhd1: true, mdhd1: true, co64: true }, 54, "Camera"],
      [{ created: Date.UTC(2001, 0, 1) }, 54, "Camera"],
      [{ created: Date.UTC(2101, 0, 1) }, 54, "Camera"],
      [{ createdRaw: 0 }, 54, "Camera"],
      [{ uniform: true, video: false }, 54, "Camera"],
      [{ minf: "" }, 54, "Camera"],
      [{ minf: "  HERO8 Black  " }, 54, "HERO8 Black"],
      [{ udta: F.box("udta", F.box("GPMF", deep(3))) }, 54, "HERO9 Black"],
      [{ udta: F.box("udta", F.box("GPMF", deep(6))) }, 54, "Camera"],
      [{ stsc: [[0, 1]] }, 54, "Camera"],
      [
        {
          chunks: [2, 1],
          stsc: [
            [1, 2],
            [2, 1],
          ],
        },
        54,
        "Camera",
      ],
      [{ deltas: [1001, 1001] }, 36, "Camera"],
      [{ offs: (o) => o.slice(0, 2) }, 36, "Camera"],
      [{ chunks: [3], stsc: [[1, 5]] }, 54, "Camera"],
      [{ timescale: 90000, deltas: [90090, 90090, 90090] }, 54, "Camera"],
    ];
    for (const [o, n, camera] of cases) {
      const d = data((await same(() => F.mp4(F.h5Payloads(), o))).mine);
      expect([d.gps.t.length, d.camera]).toEqual([n, camera]);
    }
  });

  it("fileReader con un Blob: lo mismo que con el buffer, igual", async () => {
    const u8 = F.mp4(F.h5Payloads(), { chunks: [2, 1], minf: "HERO7 Black" });
    const viaBuffer = await same(() => u8);
    const viaFile = await same((api) => api.fileReader(new Blob([u8])));
    expect(F.plain(viaFile.mine.data)).toEqual(F.plain(viaBuffer.mine.data));
    expect(viaFile.mine.reads).toEqual(viaBuffer.mine.reads);
    expect(data(viaFile.mine).gps.t.length).toBe(54);
  });

  it("tanda: solo los fijos ≥ 2, hacc del DOP y la hora del instante 0, igual", async () => {
    // Sin fijo el primer segundo, 3D con DOP 30 el segundo y 2D con DOP 0,2 el tercero.
    const pls = [
      F.h5Payload(0, { fix: 0, dop: 9999 }),
      F.h5Payload(1, { fix: 3, dop: 3000 }),
      F.h5Payload(2, { fix: 2, dop: 20 }),
    ];
    const { mine, theirs } = await same(() => F.mp4(pls));
    const d = data(mine);
    const s = session(d);
    expect(F.plain(s)).toEqual(F.plain(old.toSession(data(theirs))));
    expect(Object.keys(s)).toEqual([
      "loc",
      "acc",
      "grav",
      "gyro",
      "warnings",
      "source",
      "videoDuration",
      "startUtc",
    ]);
    expect(s.loc.t.length).toBe(36);
    expect(s.loc.t[0]).toBeCloseTo(1.001, 12);
    expect(s.loc.lat[0]).toBeCloseTo(F.lat5(18), 9);
    expect(s.loc.speed[0]).toBeCloseTo(20.9, 9);
    expect(s.loc.bearing).toBeNull();
    expect([s.loc.hacc[0], s.loc.hacc[35]]).toEqual([50, 1]);
    expect(s.source).toBe("gopro");
    expect(s.videoDuration).toBeCloseTo(3.003, 9);
    // startUtc = hora del instante 0 (GPSU del primer fijo − 1,001 s).
    expect(s.startUtc).toBe(F.UTC0);
    expect(s.warnings).toEqual([]);
    expect(s.warnings).not.toBe(d.warnings);
    // IMU a 100 Hz por defecto, promediado por cajones.
    expect(Math.abs(must(s.acc).t.length - 300)).toBeLessThanOrEqual(3);
    expect(must(s.gyro).y[0]).toBeCloseTo(-0.5 / 939, 12);
    expect(must(s.gyro).t[0]).toBeCloseTo(1.001 / 400, 12);
  });

  it("tanda: cámara quieta, con vibración y con un giro brusco; IMU a 100 Hz, a 50 o sin reducir, igual", async () => {
    const gv = [1.5, 9.6, 1.4];
    const gq = Math.hypot(...gv.map((v) => Math.round(v * 418) / 418));
    const files: [string, Uint8Array][] = [
      ["quieta", F.stillFile(10, () => gv)],
      [
        "vibración",
        F.stillFile(10, (t) => gv.map((v) => v + 0.5 * Math.sin(2 * Math.PI * 37 * t))),
      ],
      ["giro", F.stillFile(10, (t) => (t < 5 ? [0, 9.81, 0] : [0, 0, 9.81]))],
    ];
    const raw: Record<string, G.GpmfData> = {};
    for (const [name, u8] of files) {
      const { mine, theirs } = await same(() => u8);
      raw[name] = data(mine);
      expect(must(raw[name].acc).t.length).toBe(2000);
      for (const imuHz of [undefined, 100, 50, 0, -5, 1000, 99.5, NaN])
        session(raw[name], { imuHz });
      session(raw[name], null);
      expect(F.plain(G.toSession(raw[name]))).toEqual(F.plain(old.toSession(data(theirs))));
    }
    const stats = (s: G.GoproSession) => {
      const grav = must(s.grav);
      const acc = must(s.acc);
      let gMin = Infinity;
      let gMax = -Infinity;
      let lin = 0;
      let mean = 0;
      for (let i = 0; i < grav.t.length; i++) {
        const m = Math.hypot(grav.x[i], grav.y[i], grav.z[i]);
        gMin = Math.min(gMin, m);
        gMax = Math.max(gMax, m);
        lin = Math.max(lin, Math.abs(acc.x[i]), Math.abs(acc.y[i]), Math.abs(acc.z[i]));
        mean += acc.y[i] / grav.t.length;
      }
      return { gMin, gMax, lin, mean };
    };
    // Quieta: |g| ≈ 9,81 en toda la tanda y aceleración lineal ≈ 0; 200 Hz → 100 Hz.
    const still = G.toSession(raw["quieta"]);
    const a = stats(still);
    expect(Math.abs(gq - 9.81)).toBeLessThan(0.05);
    expect(Math.abs(a.gMin - gq)).toBeLessThan(0.05);
    expect(Math.abs(a.gMax - gq)).toBeLessThan(0.05);
    expect(a.lin).toBeLessThan(0.05);
    const acc = must(still.acc);
    expect(Math.abs(acc.t.length - 1000)).toBeLessThanOrEqual(2);
    expect(acc.t[1] - acc.t[0]).toBeCloseTo(0.01, 9);
    expect(
      Math.abs(must(G.toSession(raw["quieta"], { imuHz: 50 }).acc).t.length - 500),
    ).toBeLessThanOrEqual(2);
    expect(must(G.toSession(raw["quieta"], { imuHz: 0 }).acc).t.length).toBe(2000);
    // Con vibración de motor (0,5 m/s² a 37 Hz) la gravedad no se mueve.
    const v = stats(G.toSession(raw["vibración"]));
    expect(Math.abs(v.gMin - gq)).toBeLessThan(0.05);
    expect(Math.abs(v.gMax - gq)).toBeLessThan(0.05);
    expect(Math.abs(v.mean)).toBeLessThan(0.05);
    // Un giro brusco a los 5 s se ve a los 5 s (sin retraso).
    const step = must(G.toSession(raw["giro"]).grav);
    let cross = NaN;
    for (let i = 1; i < step.t.length && Number.isNaN(cross); i++)
      if (step.y[i - 1] >= 4.905 && step.y[i] < 4.905) cross = step.t[i];
    expect(Math.abs(cross - 5)).toBeLessThan(0.05);
  }, 30000);

  it("tanda: sin acelerómetro (solo GPS y el aviso) y con datos montados a mano, igual", async () => {
    const d = data((await same(() => F.mp4(F.h5Payloads({ imu: false })))).mine);
    expect([d.acc, d.gyro]).toEqual([null, null]);
    const s = session(d);
    expect(Object.keys(s)).toEqual(["loc", "warnings", "source", "videoDuration", "startUtc"]);
    expect(s.warnings).toContain(G.MSG.noImu);
    expect(s.loc.t.length).toBe(54);
    const one = { t: [0], x: [1], y: [2], z: [3] };
    const hand: G.SessionSource[] = [
      // Sin fix, DOP ni velocidad: hacc 5 m, velocidad NaN y la hora de creación.
      {
        gps: { t: [0, 1], lat: [27.75, 27.7501], lon: [-15.53, -15.53] },
        duration: 2,
        created: F.T0,
      },
      {
        gps: {
          t: [0, 1, 2, 3],
          lat: [27.75, NaN, 27.76, 27.77],
          lon: [-15.5, -15.5, -15.5],
          fix: [3, 3, 1, 2],
          dop: [1, 2, 300],
          speed: [5, 6, 7, 8],
        },
        acc: { t: [], x: [], y: [], z: [] },
        gyro: one,
        warnings: ["aviso"],
        gpsStartUtc: 1.76e12,
        gpsStartT: NaN,
      },
      { gps: null, acc: one, gyro: one, gpsStartUtc: 1.76e12, gpsStartT: 2.5 },
      { acc: one, gpsStartUtc: 1.76e12 + 0.4, gpsStartT: 0.0004 },
      {},
      { gpsStartUtc: 0, created: 0 },
    ];
    for (const h of hand) session(h);
    const s0 = session(hand[0]);
    expect(s0.loc.t.length).toBe(2);
    expect(s0.loc.hacc[0]).toBe(5);
    expect(s0.loc.speed[0]).toBeNaN();
    expect(s0.startUtc).toBe(F.T0);
    expect(session(hand[1]).loc.hacc[0]).toBe(2.5);
  });
});
