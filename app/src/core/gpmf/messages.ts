// Mensajes para quien abre el vídeo: los de los errores de extract y el aviso de toSession sin acelerómetro.
export const MSG = {
  notMp4: "No parece un vídeo MP4 de GoPro.",
  noGpmf: "Este vídeo no lleva telemetría de GoPro (GPMF).",
  noGps: "Este vídeo no tiene posiciones GPS (¿GPS apagado o GoPro sin GPS, como la HERO12?).",
  noImu: "Este vídeo no trae acelerómetro o giroscopio: análisis solo con GPS.",
  unreadable: "No se ha podido leer el vídeo (¿se ha movido o borrado el archivo?).",
} as const;
