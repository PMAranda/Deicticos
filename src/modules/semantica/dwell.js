/**
 * DwellConfirmer — Requiere N frames consecutivos de gesto activo para confirmar.
 *
 * Añade una segunda capa de confirmación sobre la histéresis de PointingEstimator:
 * el gesto solo se considera semánticamente válido cuando se mantiene de forma
 * continua durante al menos dwellFrames frames. Si el gesto se interrumpe aunque
 * sea un frame, el contador se reinicia desde cero.
 *
 * Con dwellFrames = 0 la confirmación es inmediata (sin espera).
 */
export class DwellConfirmer {
  /** @param {number} dwellFrames  Frames consecutivos requeridos (0 = sin espera) */
  constructor(dwellFrames = 60) {
    this.dwellFrames = dwellFrames;
    this._count      = 0;
    this._confirmed  = false;
  }

  /**
   * Procesa el estado del gesto en el frame actual.
   *
   * @param {boolean} isGesture  Gesto activo (salida de PointingEstimator.isGesture)
   * @returns {{ isConfirmed: boolean, progress: number, count: number }}
   *   - isConfirmed: true cuando el acumulado supera el umbral de dwell
   *   - progress:    fracción [0,1] del umbral completado
   *   - count:       frames consecutivos acumulados
   */
  update(isGesture) {
    if (isGesture) {
      const limit     = Math.max(1, this.dwellFrames);
      this._count     = Math.min(this._count + 1, limit);
      if (this.dwellFrames === 0 || this._count >= this.dwellFrames) {
        this._confirmed = true;
      }
    } else {
      this._count     = 0;
      this._confirmed = false;
    }
    const progress = this.dwellFrames > 0
      ? this._count / this.dwellFrames
      : (isGesture ? 1 : 0);
    return { isConfirmed: this._confirmed, progress, count: this._count };
  }

  /**
   * Cambia el umbral en caliente sin perder el conteo acumulado.
   * Si el conteo actual ya supera el nuevo valor, confirma inmediatamente.
   * @param {number} n
   */
  setDwellFrames(n) {
    this.dwellFrames = Math.max(0, Math.round(n));
    if (this._count > 0 && (this.dwellFrames === 0 || this._count >= this.dwellFrames)) {
      this._confirmed = true;
    } else if (this.dwellFrames > 0 && this._count < this.dwellFrames) {
      this._confirmed = false;
    }
  }

  reset() {
    this._count     = 0;
    this._confirmed = false;
  }
}
