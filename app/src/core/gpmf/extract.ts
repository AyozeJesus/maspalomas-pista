// La telemetría de una GoPro (HERO5…HERO13) leída del MP4 a trozos: GPS, acelerómetro y giroscopio, con su hora.
import { eachPayload } from "./batches";
import { MSG } from "./messages";
import { editShift, parseMovie, readMoov, sampleTable, type Track } from "./mp4";
import { parsePayload, type ExtractState } from "./payload";
import { GPS_COLS, IMU_COLS, Series, type GpsCol } from "./series";
import { SANE_FROM, SANE_TO } from "./time";
import type { ByteReader, ExtractOptions, GpmfData } from "./types";

function firstFix(g: Record<GpsCol, Float64Array>): number {
  for (let i = 0; i < g.t.length; i++) if (g.fix[i] >= 2) return i;
  return -1;
}

// Lee el MP4 y devuelve la telemetría en bruto, con t en segundos de la línea del vídeo (0 = primer fotograma).
export async function extract(reader: ByteReader, opts?: ExtractOptions | null): Promise<GpmfData> {
  const o = opts || {};
  const progress = typeof o.onProgress === "function" ? o.onProgress : () => {};
  const moov = await readMoov(reader);
  if (!moov) throw new Error(MSG.notMp4);
  const movie = parseMovie(moov);
  let track: Track | null = null;
  for (const tr of movie.tracks) if (!track && tr.formats.indexOf("gpmd") >= 0) track = tr;
  if (!track) throw new Error(MSG.noGpmf);
  const sm = sampleTable(moov, track);
  // GoPro guarda la telemetría en una pista «gpmd» aparte del vídeo: sus muestras van en el mismo reloj que
  // el vídeo, salvo lo que mueva su lista de edición.
  const shift = editShift(moov, track.elst, movie.timescale, track.timescale);
  const st: ExtractState = {
    gps5: new Series(GPS_COLS),
    gps9: new Series(GPS_COLS),
    acc: new Series(IMU_COLS),
    gyro: new Series(IMU_COLS),
    anchors: [],
    memo: {},
    owner: {},
    dvnm: null,
    orin: null,
    broken: 0,
    brokenAt: Infinity,
  };
  const startT = (i: number) => sm.start[i] / sm.scale + shift;
  // Una muestra con duración 0 en stts apilaría todo su segundo en un instante: vale la de la anterior.
  const durT = (i: number) => (sm.dur[i] || (i ? sm.dur[i - 1] : 0)) / sm.scale;
  const bad = (i: number) => {
    st.broken++;
    st.brokenAt = Math.min(st.brokenAt, startT(i));
  };
  progress(0);
  await eachPayload(
    reader,
    sm,
    (i, payload) => {
      const whole = parsePayload(payload, startT(i), durT(i), st);
      if (!whole || payload.length < sm.size[i]) bad(i);
    },
    bad,
    progress,
  );
  // HERO11+ graba GPS9 (fijo, DOP y hora en cada muestra) además de GPS5: se usa GPS9 si tiene fijos.
  let gs = st.gps9.out();
  let i0 = firstFix(gs);
  const use9 = i0 >= 0;
  if (!use9) {
    gs = st.gps5.out();
    i0 = firstFix(gs);
  }
  if (i0 < 0) throw new Error(MSG.noGps);
  // Hora UTC del primer fijo: GPS9 la lleva en cada muestra y GPS5 solo al principio de cada trozo (GPSU);
  // si justo ese fijo no la trae, se lleva hacia atrás la del siguiente con el reloj del vídeo.
  const t0 = gs.t[i0];
  let utc0: number | null = null;
  if (use9)
    for (let i = i0; i < gs.t.length && utc0 === null; i++)
      if (gs.fix[i] >= 2 && gs.utc[i] >= SANE_FROM && gs.utc[i] < SANE_TO)
        utc0 = gs.utc[i] - (gs.t[i] - t0) * 1000;
  if (utc0 === null && st.anchors.length) utc0 = st.anchors[0][1] - (st.anchors[0][0] - t0) * 1000;
  const warnings: string[] = [];
  if (st.broken) {
    const at = Math.max(0, Math.floor(st.brokenAt));
    warnings.push(
      st.broken === 1
        ? "Un trozo de la telemetría está dañado o cortado (hacia el segundo " +
            at +
            " del vídeo): se ha usado lo que se podía leer."
        : st.broken +
            " trozos de la telemetría están dañados o cortados (el primero hacia el segundo " +
            at +
            " del vídeo): se ha usado lo que se podía leer.",
    );
  }
  progress(1);
  return {
    camera: movie.model || st.dvnm || null,
    duration: movie.timescale
      ? movie.duration / movie.timescale
      : track.duration / track.timescale || 0,
    created: movie.created,
    gpsStartUtc: utc0 === null ? null : Math.round(utc0),
    // Segundos del vídeo en que llega ese primer fijo (para pasar su hora al instante 0).
    gpsStartT: t0,
    gps: {
      t: gs.t,
      lat: gs.lat,
      lon: gs.lon,
      alt: gs.alt,
      speed: gs.speed,
      fix: gs.fix,
      dop: gs.dop,
    },
    acc: st.acc.n ? st.acc.out() : null,
    gyro: st.gyro.n ? st.gyro.out() : null,
    orin: st.orin,
    warnings,
  };
}
