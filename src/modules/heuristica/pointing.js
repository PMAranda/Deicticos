import { extractArmVectors, computeExtensionAngle } from './vectores.js';
import { fuseVectors } from './fusion.js';
import { validateGesture, detectActiveSide } from './validacion.js';
import { normalize2D } from './vectores.js';

const EMA_ALPHA = 0.3;   // suavizado temporal del vector

// ── Histéresis asimétrica ──────────────────────────────────────────────────
// Activación rápida (~2 frames con gesto claro) y desactivación lenta
// (~7 frames desde confianza máxima) para absorber pérdidas temporales de tracking.
const CONF_RISE            = 0.40;  // subida de confianza acumulada por frame con gesto
const CONF_FALL            = 0.10;  // caída por frame sin gesto (asimétrica — más lenta)
const ACTIVATION_THRESHOLD = 0.45;  // acumulado mínimo para activar el gesto
const HOLD_THRESHOLD       = 0.20;  // acumulado mínimo para mantenerse activo

export class PointingEstimator {
  constructor() {
    this._smoothed      = null;   // vector EMA suavizado
    this._accumConf     = 0;      // confianza acumulada (histéresis)
    this._gestureActive = false;  // estado filtrado por histéresis
    this._lastReason    = 'lost'; // última razón válida cuando había gesto
  }

  /**
   * Estima el vector de pointing para el frame actual con histéresis temporal.
   * Para imágenes estáticas usa `rawIsGesture`/`rawConfidence` (sin histéresis).
   * @param {Array|null}            poseLandmarks
   * @param {Object}                hands  - { Left, Right }
   * @param {'Right'|'Left'|'auto'} side
   * @returns {PointingResult}
   */
  estimate(poseLandmarks, hands, side = 'auto') {
    const activeSide = side === 'auto'
      ? detectActiveSide(poseLandmarks, hands)
      : side;

    const armData = extractArmVectors(poseLandmarks, hands, activeSide);

    const seVec = armData.vectors.shoulderElbow;
    const ewVec = armData.vectors.elbowWrist;
    const extensionAngle = (seVec && ewVec)
      ? computeExtensionAngle(seVec, ewVec)
      : 180;

    const validation = validateGesture(armData, extensionAngle);

    const { vector: rawVector, weights, mode } = fuseVectors(
      armData.vectors,
      armData.visibility,
      armData.hasHands,
    );

    const shoulder = armData.points.shoulder;
    const origin   = shoulder ? { x: shoulder.x, y: shoulder.y } : null;

    // ── Confianza acumulada + histéresis asimétrica ───────────────────────────
    if (validation.isGesture) {
      this._accumConf  = Math.min(1, this._accumConf + CONF_RISE * validation.confidence);
      this._lastReason = validation.reason;
    } else {
      this._accumConf  = Math.max(0, this._accumConf - CONF_FALL);
    }

    if (!this._gestureActive && this._accumConf >= ACTIVATION_THRESHOLD) {
      this._gestureActive = true;
    } else if (this._gestureActive && this._accumConf < HOLD_THRESHOLD) {
      this._gestureActive = false;
    }

    // ── EMA sobre el vector (actualiza solo con gesto raw) ────────────────────
    let vector = null;

    if (rawVector && validation.isGesture) {
      vector = this._smoothed
        ? normalize2D({
            x: EMA_ALPHA * rawVector.x + (1 - EMA_ALPHA) * this._smoothed.x,
            y: EMA_ALPHA * rawVector.y + (1 - EMA_ALPHA) * this._smoothed.y,
          })
        : normalize2D(rawVector);
      this._smoothed = vector;
    } else if (this._smoothed) {
      // Decaimiento lento aunque no haya gesto raw
      this._smoothed = normalize2D({
        x: this._smoothed.x * 0.9,
        y: this._smoothed.y * 0.9,
      });
    }

    // Histéresis: mientras el estado sea activo mantener el último vector suavizado
    if (this._gestureActive) {
      vector = vector ?? this._smoothed;
    }

    return {
      isGesture:     this._gestureActive,
      rawIsGesture:  validation.isGesture,
      confidence:    this._accumConf,
      rawConfidence: validation.confidence,
      reason:        this._gestureActive
                       ? this._lastReason
                       : (validation.reason ?? 'lost'),
      mode,
      vector,
      rawVector,
      smoothed:      this._smoothed,
      extensionAngle,
      weights,
      origin,
      armData,
      side:          activeSide,
    };
  }

  reset() {
    this._smoothed      = null;
    this._accumConf     = 0;
    this._gestureActive = false;
    this._lastReason    = 'lost';
  }
}

/**
 * @typedef {Object} PointingResult
 * @property {boolean}        isGesture      estado filtrado por histéresis
 * @property {boolean}        rawIsGesture   detección directa frame a frame (sin histéresis)
 * @property {number}         confidence     confianza acumulada [0,1] (histéresis)
 * @property {number}         rawConfidence  confianza del frame actual [0,1]
 * @property {string}         reason         motivo de validación
 * @property {string}         mode           'full'|'partial'|'fallback'|'lost'
 * @property {{x,y}|null}     vector         vector activo (suavizado o mantenido por histéresis)
 * @property {{x,y}|null}     rawVector      vector fusionado sin suavizar
 * @property {{x,y}|null}     smoothed       último vector EMA
 * @property {number}         extensionAngle grados
 * @property {Object}         weights        pesos activos normalizados
 * @property {{x,y}|null}     origin         posición del hombro en coords normalizadas
 * @property {Object}         armData        datos del brazo (extractArmVectors)
 * @property {'Right'|'Left'} side           brazo activo
 */
