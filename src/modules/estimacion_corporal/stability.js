// Umbrales de jitter en coordenadas normalizadas [0, 1]
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
    this.windowSize = windowSize;
    this._history   = new Map();
  }

  /**
   * Registra la posición de un landmark en el frame actual.
   * @param {string} key
   * @param {{ x: number, y: number, visibility?: number } | null} landmark
   */
  update(key, landmark) {
    if (!landmark) return;
    if (!this._history.has(key)) this._history.set(key, []);
    const buf = this._history.get(key);
    buf.push({ x: landmark.x, y: landmark.y, visibility: landmark.visibility ?? 1 });
    if (buf.length > this.windowSize) buf.shift();
  }

  /**
   * Métricas de estabilidad calculadas sobre la ventana acumulada.
   * @returns {{ jitter: number, meanVisibility: number, level: string, sampleCount: number }}
   */
  getMetrics(key) {
    const buf = this._history.get(key);
    if (!buf || buf.length < 2) {
      return { jitter: 0, meanVisibility: 0, level: 'stable', sampleCount: 0 };
    }

    let jitterSum = 0;
    for (let i = 1; i < buf.length; i++) {
      const dx = buf[i].x - buf[i - 1].x;
      const dy = buf[i].y - buf[i - 1].y;
      jitterSum += Math.sqrt(dx * dx + dy * dy);
    }
    const jitter         = jitterSum / (buf.length - 1);
    const meanVisibility = buf.reduce((s, p) => s + p.visibility, 0) / buf.length;

    return { jitter, meanVisibility, level: jitterLevel(jitter), sampleCount: buf.length };
  }

  /**
   * Posición suavizada del landmark mediante EMA sobre la ventana.
   * @param {string} key
   * @param {number} alpha - Factor de suavizado (0 = máximo suavizado, 1 = sin suavizar)
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

  /** Snapshot de todas las métricas activas (para la UI). */
  getAllMetrics() {
    const result = {};
    for (const key of this._history.keys()) {
      result[key] = this.getMetrics(key);
    }
    return result;
  }

  clear() { this._history.clear(); }
}
