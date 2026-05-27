/**
 * ImpactTracker — Seguimiento de la estabilidad del punto de impacto.
 *
 * Ventana deslizante de N frames sobre la posición suavizada (EMA) del impacto.
 * Calcula jitter espacial en coords normalizadas [0,1]² del tablero y detecta
 * cambios de región.
 *
 * Umbrales de jitter (distancia media entre frames consecutivos, [0,1]):
 *   < 0.008  → estable (verde)
 *   0.008-0.025 → moderado (amarillo)
 *   > 0.025  → inestable (rojo)
 */
export class ImpactTracker {
  constructor(windowSize = 30) {
    this._window         = [];   // { x, y } en coords normalizadas
    this._winSize        = windowSize;
    this._lastRegion     = null;
    this._regionChanges  = 0;
    this._totalFrames    = 0;
    this._impactFrames   = 0;
  }

  /**
   * @param {import('./grounding.js').GroundingResult | null} groundingResult
   */
  update(groundingResult) {
    this._totalFrames++;

    if (!groundingResult) return;

    this._impactFrames++;
    this._window.push({ x: groundingResult.smoothed.x, y: groundingResult.smoothed.y });
    if (this._window.length > this._winSize) this._window.shift();

    const region = groundingResult.region.label;
    if (this._lastRegion !== null && this._lastRegion !== region) {
      this._regionChanges++;
    }
    this._lastRegion = region;
  }

  getMetrics() {
    const n = this._window.length;

    let jitter = 0;
    if (n >= 2) {
      let total = 0;
      for (let i = 1; i < n; i++) {
        total += Math.hypot(
          this._window[i].x - this._window[i - 1].x,
          this._window[i].y - this._window[i - 1].y,
        );
      }
      jitter = total / (n - 1);
    }

    const level = jitter < 0.008 ? 'stable'
                : jitter < 0.025 ? 'moderate'
                : 'unstable';

    const impactRate = this._totalFrames > 0
      ? this._impactFrames / this._totalFrames
      : 0;

    return { jitter, level, regionChanges: this._regionChanges, impactRate };
  }

  getWindow() { return [...this._window]; }

  clear() {
    this._window        = [];
    this._lastRegion    = null;
    this._regionChanges = 0;
    this._totalFrames   = 0;
    this._impactFrames  = 0;
  }
}
