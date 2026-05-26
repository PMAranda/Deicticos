import { extractArmVectors, computeExtensionAngle } from './vectores.js';
import { fuseVectors } from './fusion.js';
import { validateGesture, detectActiveSide } from './validacion.js';
import { normalize2D } from './vectores.js';

const EMA_ALPHA = 0.3;   // suavizado temporal — menor = más suavizado

export class PointingEstimator {
  constructor() {
    this._smoothed = null;   // vector EMA suavizado
  }

  /**
   * Estima el vector de pointing para el frame actual.
   * @param {Array|null}     poseLandmarks
   * @param {Object}         hands          - { Left, Right }
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

    // Origen del rayo: hombro
    const shoulder = armData.points.shoulder;
    const origin   = shoulder ? { x: shoulder.x, y: shoulder.y } : null;

    let vector = rawVector;

    if (rawVector && validation.isGesture) {
      // Aplicar EMA sobre el vector
      if (this._smoothed) {
        vector = normalize2D({
          x: EMA_ALPHA * rawVector.x + (1 - EMA_ALPHA) * this._smoothed.x,
          y: EMA_ALPHA * rawVector.y + (1 - EMA_ALPHA) * this._smoothed.y,
        });
      }
      this._smoothed = vector;
    } else {
      // Sin gesto activo: decaimiento lento del suavizado
      if (this._smoothed) {
        this._smoothed = normalize2D({
          x: this._smoothed.x * 0.9,
          y: this._smoothed.y * 0.9,
        });
      }
      vector = null;
    }

    return {
      isGesture:      validation.isGesture,
      confidence:     validation.confidence,
      reason:         validation.reason,
      mode,
      vector,
      rawVector,
      smoothed:       this._smoothed,
      extensionAngle,
      weights,
      origin,
      armData,
      side:           activeSide,
    };
  }

  reset() {
    this._smoothed = null;
  }
}

/**
 * @typedef {Object} PointingResult
 * @property {boolean}        isGesture
 * @property {number}         confidence     [0,1]
 * @property {string}         reason         motivo de validación
 * @property {string}         mode           'full'|'partial'|'fallback'|'lost'
 * @property {{x,y}|null}     vector         vector suavizado (null si no hay gesto)
 * @property {{x,y}|null}     rawVector      vector fusionado sin suavizar
 * @property {{x,y}|null}     smoothed       último vector EMA
 * @property {number}         extensionAngle grados
 * @property {Object}         weights        pesos activos normalizados
 * @property {{x,y}|null}     origin         posición del hombro en coords normalizadas
 * @property {Object}         armData        datos del brazo (extractArmVectors)
 * @property {'Right'|'Left'} side           brazo activo
 */
