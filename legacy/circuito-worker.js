// Crea el trazado de un circuito (trackbuilder.js) fuera del hilo del panel: en un móvil modesto tarda de décimas
// a algún segundo y, rodando, el panel no puede pararse. Mensaje {id, fixes {t, lat, lon, speed, hacc}, name}.
/* global importScripts, MaspaTrackBuilder */
importScripts("trackbuilder.js");
self.onmessage = (e) => {
  const { id, fixes, name } = e.data || {};
  try {
    const track = MaspaTrackBuilder.buildTrack(fixes, { name });
    self.postMessage({ id, track });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
