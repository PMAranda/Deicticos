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
    this.windowSize  = windowSize;
    this._history    = new Map();  // key → [{x, y, visibility}]
    this._continuity = new Map();  // key → número de frames consecutivos detectados
  }

  /**
   * Registra la posición de un landmark en el frame actual.
   * Pasar null o un landmark con visibilidad muy baja resetea la continuidad.
   * @param {string} key
   * @param {{ x: number, y: number, visibility?: number } | null} landmark
   */
  update(key, landmark) {
    if (!landmark || (landmark.visibility ?? 1) < 0.1) {
      this._continuity.set(key, 0);
      return;
    }

    if (!this._history.has(key)) this._history.set(key, []);
    const buf = this._history.get(key);
    buf.push({ x: landmark.x, y: landmark.y, visibility: landmark.visibility ?? 1 });
    if (buf.length > this.windowSize) buf.shift();

    this._continuity.set(key, (this._continuity.get(key) ?? 0) + 1);
  }

  /**
   * Métricas de estabilidad calculadas sobre la ventana acumulada.
   * @returns {{ jitter, meanVisibility, level, sampleCount, continuity }}
   */
  getMetrics(key) {
    const buf = this._history.get(key);
    if (!buf || buf.length < 2) {
      return { jitter: 0, meanVisibility: 0, level: 'stable', sampleCount: 0, continuity: 0 };
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
      level:       jitterLevel(jitter),
      sampleCount: buf.length,
      continuity:  this._continuity.get(key) ?? 0,
    };
  }

  /**
   * Posición suavizada del landmark mediante EMA sobre la ventana.
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
   * Historial de jitter frame a frame para dibujar sparklines.
   * @returns {number[]} - distancias euclídeas entre frames consecutivos
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

  /** Snapshot de todas las métricas activas (para la UI y el logger). */
  getAllMetrics() {
    const result = {};
    for (const key of this._history.keys()) {
      result[key] = this.getMetrics(key);
    }
    return result;
  }

  clear() {
    this._history.clear();
    this._continuity.clear();
  }
}
