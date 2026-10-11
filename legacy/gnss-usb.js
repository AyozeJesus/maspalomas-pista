// Receptor GNSS externo por cable USB (p. ej. un u-blox M9/M10 con USB-C, como los de cronometraje): Chrome en
// Android habla con él directamente (WebUSB), sin apps intermedias, a sus 10–25 posiciones por segundo. Las frases
// NMEA (o tramas UBX/RaceBox) las lee el mismo lector que el Bluetooth (MaspaGNSS.createParser).
// Chips: USB serie estándar (CDC-ACM, el USB nativo de u-blox), CH340/CH341 y CP210x.
(function (root) {
  "use strict";
  const BAUD = 115200;
  const FILTERS = [
    { vendorId: 0x1546 }, // u-blox
    { vendorId: 0x1a86 }, // WCH CH340/CH341
    { vendorId: 0x10c4 }, // Silicon Labs CP210x
    { classCode: 0x02 }, // CDC (comunicaciones)
    { classCode: 0x0a }, // CDC datos
  ];

  function supported() {
    return !!(root.navigator && navigator.usb && navigator.usb.requestDevice);
  }
  const le32 = (n) =>
    new Uint8Array([
      n & 255,
      (n >> 8) & 255,
      (n >> 16) & 255,
      (n >>> 24) & 255,
    ]);

  // Qué chip es y qué interfaz/puntos de lectura usar.
  function layoutOf(dev) {
    const conf = dev.configuration;
    const ifaces = conf ? conf.interfaces : [];
    const alt = (i) => i.alternate || (i.alternates && i.alternates[0]);
    const bulkIn = (i) => {
      const a = alt(i);
      const ep =
        a && a.endpoints.find((e) => e.direction === "in" && e.type === "bulk");
      return ep ? ep.endpointNumber : null;
    };
    if (dev.vendorId === 0x1a86)
      return {
        kind: "ch34x",
        data: ifaces[0],
        ctrl: null,
        ep: bulkIn(ifaces[0]),
      };
    if (dev.vendorId === 0x10c4)
      return {
        kind: "cp210x",
        data: ifaces[0],
        ctrl: null,
        ep: bulkIn(ifaces[0]),
      };
    const data = ifaces.find(
      (i) => alt(i) && alt(i).interfaceClass === 0x0a && bulkIn(i) !== null,
    );
    const ctrl =
      ifaces.find((i) => alt(i) && alt(i).interfaceClass === 0x02) || null;
    if (data) return { kind: "cdc", data, ctrl, ep: bulkIn(data) };
    // Algunos receptores dan una sola interfaz con su punto de lectura.
    const any = ifaces.find((i) => bulkIn(i) !== null);
    return any ? { kind: "cdc", data: any, ctrl: null, ep: bulkIn(any) } : null;
  }

  // Configura el chip (velocidad 115200 8N1 y líneas de control) según su tipo.
  async function setup(dev, lay) {
    const out = (o, data) => dev.controlTransferOut(o, data);
    if (lay.kind === "cdc") {
      if (!lay.ctrl) return;
      const index = lay.ctrl.interfaceNumber;
      // SET_LINE_CODING: velocidad, 1 bit de parada, sin paridad, 8 bits (el USB nativo de u-blox lo ignora).
      const lc = new Uint8Array(7);
      lc.set(le32(BAUD), 0);
      lc[6] = 8;
      await out(
        {
          requestType: "class",
          recipient: "interface",
          request: 0x20,
          value: 0,
          index,
        },
        lc,
      ).catch(() => {});
      // SET_CONTROL_LINE_STATE: DTR y RTS (algunos no mandan datos sin ellas).
      await out({
        requestType: "class",
        recipient: "interface",
        request: 0x22,
        value: 0x03,
        index,
      }).catch(() => {});
    } else if (lay.kind === "ch34x") {
      // Como el driver de Linux (ch341.c): inicio, divisor de la velocidad, formato 8N1 y líneas de control.
      let factor = Math.floor(1532620800 / BAUD);
      let divisor = 3;
      while (factor > 0xfff0 && divisor) {
        factor >>= 3;
        divisor--;
      }
      factor = 0x10000 - factor;
      const v = (factor & 0xff00) | divisor;
      const vend = (request, value, index) =>
        out({
          requestType: "vendor",
          recipient: "device",
          request,
          value,
          index,
        });
      await vend(0xa1, 0, 0);
      await vend(0x9a, 0x1312, v);
      await vend(0x9a, 0x0f2c, factor & 0xff);
      await vend(0x9a, 0x2518, 0x00c3);
      await vend(0xa4, ~0x60 & 0xff, 0);
    } else if (lay.kind === "cp210x") {
      const index = lay.data.interfaceNumber;
      const vend = (request, value, data) =>
        out(
          {
            requestType: "vendor",
            recipient: "interface",
            request,
            value,
            index,
          },
          data,
        );
      await vend(0x00, 0x0001); // IFC_ENABLE
      await vend(0x1e, 0, le32(BAUD)); // SET_BAUDRATE
      await vend(0x03, 0x0800); // SET_LINE_CTL: 8N1
      await vend(0x07, 0x0303); // SET_MHS: DTR y RTS
    }
  }

  // Por qué no se ha podido abrir, para el piloto (sin los mensajes técnicos del navegador).
  function openErrorText(e) {
    const name = e && e.name;
    if (e && e.notReceiver)
      return "Ese aparato USB no parece un receptor GPS compatible.";
    if (name === "SecurityError" || name === "NotAllowedError")
      return "Chrome no tiene permiso para usar el receptor USB: desenchúfalo, vuelve a enchufarlo y pulsa «Conectar por USB».";
    if (name === "NetworkError" || name === "InvalidStateError")
      return "El receptor USB está ocupado (quizá lo usa otra app): ciérrala, o desenchufa y vuelve a enchufar el receptor.";
    return "No se ha podido abrir el receptor USB: desenchúfalo, vuelve a enchufarlo y prueba otra vez.";
  }

  // Abre el receptor y lee sin parar. connect debe llamarse desde un toque (Chrome pide permiso la primera vez).
  // opts: { onFix(fix) (con recvMs), onStatus({state, text}), device? (uno ya permitido, para reconectar) }.
  async function connect(opts) {
    const o = opts || {};
    let shown = "";
    // Cada estado se avisa una vez (no con cada fijo).
    const status = (state, text) => {
      if (shown === state + text) return;
      shown = state + text;
      if (o.onStatus) o.onStatus({ state, text });
    };
    if (!supported()) {
      status(
        "error",
        "Este navegador no puede usar receptores USB (hace falta Chrome en Android).",
      );
      throw new Error("sin WebUSB");
    }
    let dev = o.device || null;
    if (!dev) {
      try {
        dev = await navigator.usb.requestDevice({ filters: FILTERS });
      } catch (e) {
        status("error", "No se ha elegido ningún receptor USB.");
        throw e;
      }
    }
    status("conectando", "Conectando con el receptor USB…");
    const name = dev.productName || "Receptor USB";
    const ready = "Receptor USB conectado (" + name + ").";
    const arrivals = [];
    let open = true;
    let noFix = null;
    // Cuántos fijos llegan (para rate) y si tienen cobertura, como con el Bluetooth.
    const parser = root.MaspaGNSS.createParser((f) => {
      const t = f.recvMs || performance.now();
      arrivals.push(t);
      if (f.fix >= 2) {
        noFix = null;
        status("conectado", ready);
      } else if (noFix === null) noFix = t;
      else if (t - noFix > 3000)
        status(
          "sin-fix",
          "Receptor USB sin cobertura todavía: déjalo a cielo abierto y espera un poco.",
        );
      if (o.onFix) o.onFix(f);
    });
    // Fin de la conexión (desenchufado, fallo de lectura o a mano), una sola vez.
    function finish(state, text) {
      if (!open) return;
      open = false;
      navigator.usb.removeEventListener("disconnect", onGone);
      status(state, text);
    }
    function onGone(ev) {
      if (ev.device === dev)
        finish("desconectado", "Se ha desenchufado el receptor USB.");
    }
    const handle = {
      name,
      profile: "usb",
      // Fijos por segundo en los últimos 2 s (intervalos entre llegadas, como con el Bluetooth).
      rate() {
        const now = performance.now();
        while (arrivals.length && now - arrivals[0] > 2000) arrivals.shift();
        const span = arrivals.length ? now - arrivals[0] : 0;
        if (arrivals.length < 2 || span < 250) return 0;
        return ((arrivals.length - 1) * 1000) / span;
      },
      async disconnect() {
        finish("desconectado", "Receptor USB desconectado.");
        try {
          await dev.close();
        } catch (e) {
          /* ya cerrado */
        }
      },
    };
    navigator.usb.addEventListener("disconnect", onGone);
    try {
      await dev.open();
      if (!dev.configuration) await dev.selectConfiguration(1);
      const lay = layoutOf(dev);
      if (!lay || lay.ep === null)
        throw Object.assign(new Error("sin punto de lectura"), {
          notReceiver: true,
        });
      if (lay.ctrl)
        await dev.claimInterface(lay.ctrl.interfaceNumber).catch(() => {});
      await dev.claimInterface(lay.data.interfaceNumber);
      await setup(dev, lay);
      status("conectado", ready);
      (async () => {
        while (open) {
          let r;
          try {
            r = await dev.transferIn(lay.ep, 512);
          } catch (e) {
            finish(
              "desconectado",
              "Se ha perdido el receptor USB: desenchúfalo.",
            );
            break;
          }
          if (r.status === "stall") {
            await dev.clearHalt("in", lay.ep).catch(() => {});
            continue;
          }
          if (r.data && r.data.byteLength)
            parser.push(
              new Uint8Array(
                r.data.buffer,
                r.data.byteOffset,
                r.data.byteLength,
              ),
              performance.now(),
            );
        }
      })();
    } catch (e) {
      finish("error", openErrorText(e));
      dev.close().catch(() => {});
      throw e;
    }
    return handle;
  }

  const api = { supported, connect, layoutOf, FILTERS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MaspaGNSSUSB = api;
})(typeof window !== "undefined" ? window : globalThis);
