export const JITTER_THRESHOLDS = Object.freeze({ LOW: 0.004, HIGH: 0.012 });

/** @returns {'stable' | 'moderate' | 'unstable'} */
export function jitterLevel(jitter) {
  if (jitter < JITTER_THRESHOLDS.LOW)  return 'stable';
  if (jitter < JITTER_THRESHOLDS.HIGH) return 'moderate';
  return 'unstable';
}

export const LEVEL_COLOR = Object.freeze({
  stable:   '#4DFF88',
  moderate: '#FFD700',
  unstable: '#FF4D4D',
});

// ─────────────────────────────────────────────────────────────────────────────

export class StabilityTracker {
  /** @param {number} windowSize - Frames en la ventana deslizante */
  constructor(windowSize = 30) {
    this.windowSize      = windowSize;
    this._history        = new Map();  // key → [{x, y, visibility}]
    this._continuity     = new Map();  // key → frames consecutivos detectados
    this._totalFrames    = new Map();  // key → total de frames en que se llamó update()
    this._detectedFrames = new Map();  // key → frames con landmark válido
  }

  /**
   * Registra la posición de un landmark en el frame actual.
   * Llamar con null cuando el landmark no se detecta (resetea continuidad y
   * contabiliza el frame como pérdida).
   */
  update(key, landmark) {
    this._totalFrames.set(key, (this._totalFrames.get(key) ?? 0) + 1);

    if (!landmark || (landmark.visibility ?? 1) < 0.1) {
      this._continuity.set(key, 0);
      return;
    }

    this._detectedFrames.set(key, (this._detectedFrames.get(key) ?? 0) + 1);

    if (!this._history.has(key)) this._history.set(key, []);
    const buf = this._history.get(key);
    buf.push({ x: landmark.x, y: landmark.y, visibility: landmark.visibility ?? 1 });
    if (buf.length > this.windowSize) buf.shift();

    this._continuity.set(key, (this._continuity.get(key) ?? 0) + 1);
  }

  /**
   * Métricas completas sobre la ventana acumulada.
   * @returns {{
   *   jitter: number, meanVisibility: number, level: string,
   *   sampleCount: number, continuity: number, trackingLoss: number
   * }}
   */
  getMetrics(key) {
    const total        = this._totalFrames.get(key)    ?? 0;
    const detected     = this._detectedFrames.get(key) ?? 0;
    const trackingLoss = total > 0 ? ((total - detected) / total) * 100 : 0;

    const buf = this._history.get(key);
    if (!buf || buf.length < 2) {
      return {
        jitter: 0, meanVisibility: 0, level: 'stable',
        sampleCount: 0, continuity: 0, trackingLoss,
      };
    }

    let jitterSum = 0;
    for (let i = 1; i < buf.length; i++) {
      const dx = buf[i].x - buf[i - 1].x;
      const dy = buf[i].y - buf[i - 1].y;
      jitterSum += Math.sqrt(dx * dx + dy * dy);
    }
    const jitter         = jitterSum / (buf.length - 1);
    const meanVisibility = buf.reduce((s, p) => s + p.visibility, 0) / buf.length;

    return {
      jitter,
      meanVisibility,
      level:        jitterLevel(jitter),
      sampleCount:  buf.length,
      continuity:   this._continuity.get(key) ?? 0,
      trackingLoss,
    };
  }

  /**
   * Posición suavizada mediante EMA sobre la ventana.
   * @returns {{ x: number, y: number } | null}
   */
  getSmoothed(key, alpha = 0.35) {
    const buf = this._history.get(key);
    if (!buf || buf.length === 0) return null;
    let x = buf[0].x, y = buf[0].y;
    for (let i = 1; i < buf.length; i++) {
      x = alpha * buf[i].x + (1 - alpha) * x;
      y = alpha * buf[i].y + (1 - alpha) * y;
    }
    return { x, y };
  }

  /**
   * Historial de jitter frame a frame para los sparklines.
   * @returns {number[]}
   */
  getJitterHistory(key) {
    const buf = this._history.get(key);
    if (!buf || buf.length < 2) return [];
    const result = [];
    for (let i = 1; i < buf.length; i++) {
      const dx = buf[i].x - buf[i - 1].x;
      const dy = buf[i].y - buf[i - 1].y;
      result.push(Math.sqrt(dx * dx + dy * dy));
    }
    return result;
  }

  /** Snapshot de todas las métricas activas. */
  getAllMetrics() {
    const result = {};
    for (const key of this._totalFrames.keys()) {
      result[key] = this.getMetrics(key);
    }
    return result;
  }

  clear() {
    this._history.clear();
    this._continuity.clear();
    this._totalFrames.clear();
    this._detectedFrames.clear();
  }
}

// ── FPS Tracker ───────────────────────────────────────────────────────────────

export class FPSTracker {
  /**
   * @param {number} windowSize - Número de frames para el promedio deslizante
   */
  constructor(windowSize = 60) {
    this.windowSize  = windowSize;
    this._timestamps = [];
  }

  /** Llamar una vez por frame al inicio del loop. */
  tick() {
    this._timestamps.push(performance.now());
    if (this._timestamps.length > this.windowSize) this._timestamps.shift();
  }

  /** FPS promedio sobre la ventana actual. */
  get fps() {
    if (this._timestamps.length < 2) return 0;
    const elapsed = this._timestamps.at(-1) - this._timestamps[0];
    return ((this._timestamps.length - 1) / elapsed) * 1000;
  }
}
