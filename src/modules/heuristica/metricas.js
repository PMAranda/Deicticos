// Umbrales de jitter angular (grados/frame)
export const ANGULAR_THRESHOLDS = { LOW: 3, HIGH: 8 };
export const ANGULAR_LEVEL_COLOR = { stable: '#4DFF88', moderate: '#FFD700', unstable: '#FF4D4D' };

/**
 * Rastrea la estabilidad angular del vector de pointing a lo largo del tiempo.
 * Análogo a StabilityTracker de fase2 pero para ángulos (grados).
 */
export class AngularTracker {
  constructor(windowSize = 30) {
    this._windowSize  = windowSize;
    this._angles      = [];   // ángulos brutos en grados (ventana deslizante)
    this._deltas      = [];   // |Δángulo| entre frames consecutivos
    this._modeHistory = [];   // modos: 'full'|'partial'|'fallback'|'lost'
    this._totalFrames  = 0;
    this._gestureFrames = 0;
    this._continuity   = 0;
    this._maxContinuity = 0;
  }

  /**
   * Registra el estado del frame actual.
   * @param {PointingResult} result
   */
  update(result) {
    this._totalFrames++;

    const mode = result.isGesture ? (result.mode ?? 'lost') : 'lost';
    this._modeHistory.push(mode);
    if (this._modeHistory.length > this._windowSize) this._modeHistory.shift();

    if (!result.isGesture || !result.vector) {
      this._continuity = 0;
      return;
    }

    this._gestureFrames++;
    this._continuity++;
    if (this._continuity > this._maxContinuity) this._maxContinuity = this._continuity;

    const angle = Math.atan2(result.vector.y, result.vector.x) * (180 / Math.PI);

    if (this._angles.length > 0) {
      let delta = Math.abs(angle - this._angles[this._angles.length - 1]);
      if (delta > 180) delta = 360 - delta;   // corrección wrap-around
      this._deltas.push(delta);
      if (this._deltas.length > this._windowSize) this._deltas.shift();
    }

    this._angles.push(angle);
    if (this._angles.length > this._windowSize) this._angles.shift();
  }

  getMetrics() {
    const jitter = this._computeMeanJitter();
    const level  = jitter < ANGULAR_THRESHOLDS.LOW  ? 'stable'
                 : jitter < ANGULAR_THRESHOLDS.HIGH ? 'moderate'
                 : 'unstable';

    const modeCounts = { full: 0, partial: 0, fallback: 0, lost: 0 };
    this._modeHistory.forEach(m => { modeCounts[m] = (modeCounts[m] ?? 0) + 1; });
    const modeTotal = this._modeHistory.length || 1;
    const modePcts  = {};
    for (const [k, v] of Object.entries(modeCounts)) modePcts[k] = v / modeTotal;

    const detectionRate = this._totalFrames > 0 ? this._gestureFrames / this._totalFrames : 0;
    const fallbackRate  = modePcts.fallback ?? 0;

    return {
      jitter,
      level,
      continuity:    this._continuity,
      maxContinuity: this._maxContinuity,
      fallbackRate,
      detectionRate,
      modePcts,
      sampleCount:   this._deltas.length,
    };
  }

  /** Historial de deltas angulares para la sparkline. */
  getJitterHistory() { return [...this._deltas]; }
  /** Historial de ángulos brutos para la sparkline de dirección. */
  getAngleHistory()  { return [...this._angles]; }

  clear() {
    this._angles      = [];
    this._deltas      = [];
    this._modeHistory = [];
    this._totalFrames  = 0;
    this._gestureFrames = 0;
    this._continuity   = 0;
    this._maxContinuity = 0;
  }

  _computeMeanJitter() {
    if (this._deltas.length === 0) return 0;
    return this._deltas.reduce((a, b) => a + b, 0) / this._deltas.length;
  }
}
