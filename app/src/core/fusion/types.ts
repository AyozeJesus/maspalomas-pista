// Tipos del filtro de Kalman de la pista (TrackKalman).

// Opciones del filtro. L es obligatoria; las sigmas y la historia, si faltan o no son números positivos y finitos,
// toman su valor por defecto.
export interface TrackKalmanOptions {
  // Longitud de la pista (m).
  L: number;
  // Ruido del acelerómetro ya suavizado (m/s²).
  accelSigma?: number;
  // Deriva del sesgo del acelerómetro (m/s² por √s).
  biasSigma?: number;
  // Error del fijo a lo largo de la pista (m), GPS del móvil.
  sSigma?: number;
  // Error de su velocidad (m/s).
  vSigma?: number;
  // Segundos de historia para rebobinar.
  history?: number;
}

// Errores de un fijo concreto (por ejemplo, la precisión que da el GPS); si faltan o no valen, los del filtro.
export interface FixOptions {
  sSigma?: number;
  vSigma?: number;
}

// Lo que dice update() del fijo al meterlo.
export interface FixResult {
  // Si entró: la posición pasó la puerta (o el fijo hizo nacer el estado), o, en un fijo sin posición, la velocidad.
  accepted: boolean;
  // Diferencia entre la posición del fijo y la del filtro en su instante (m), aunque se descarte; 0 si hizo nacer el
  // estado; NaN si no traía posición o aún no había estado.
  innovation: number;
}

// Estado en un instante. Antes del primer fijo, todo NaN y ready a false.
export interface TrackState {
  // Distancia desde la meta (m), en [0, L).
  s: number;
  // Velocidad (m/s).
  v: number;
  // Sesgo del acelerómetro (m/s²); NaN sin acelerómetro.
  b: number;
  // σ de s (m).
  sSigma: number;
  ready: boolean;
  // Vuelta coherente con s (la de lapCount, salvo que t ya pase la meta).
  lap: number;
}
