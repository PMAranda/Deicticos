import { extractArmVectors, computeExtensionAngle } from './vectores.js';
import { fuseVectors } from './fusion.js';
import { validateGesture, detectActiveSide } from './validacion.js';
import { normalize2D } from './vectores.js';

const EMA_ALPHA = 0.3;   // suavizado temporal del vector

// ── Histéresis asimétrica ──────────────────────────────────────────────────
const CONF_RISE            = 0.40;
const CONF_FALL            = 0.10;
const ACTIVATION_THRESHOLD = 0.45;
const HOLD_THRESHOLD       = 0.20;

// ── Estabilidad de Hands ───────────────────────────────────────────────────
// Hands solo se usa para refinamiento direccional cuando lleva suficientes
// frames seguidos con wristH coherente con wristP (validado por vectores.js).
// Activación lenta (evita saltos en cuanto aparece la mano) y desactivación
// más rápida (reacciona a pérdidas de tracking sin inercia excesiva).
const HANDS_WINDOW     = 10;  // ventana de frames para evaluar estabilidad
const HANDS_MIN_STABLE =  6;  // mínimo de frames válidos para activar Hands

// ── Debounce de cambio de brazo ────────────────────────────────────────────
// detectActiveSide evalúa frame a frame; si ambos brazos tienen puntuaciones
// similares, un frame ruidoso puede provocar un switch momentáneo al otro brazo.
// Se exige que el candidato gane N frames consecutivos antes de confirmar el cambio.
const SIDE_CHANGE_FRAMES = 5;

export class PointingEstimator {
  constructor() {
    this._smoothed      = null;
    this._accumConf     = 0;
    this._gestureActive = false;
    this._lastReason    = 'lost';
    // Tracker de estabilidad de Hands
    this._handStableFrames = 0;
    this._lastSide         = null;
    // Debounce de cambio de brazo
    this._pendingSide      = null;
    this._pendingSideCount = 0;
  }

  /**
   * Estima el vector de pointing con arquitectura jerárquica:
   *   Fase 1 — Pose detecta el gesto y selecciona el brazo (siempre activo).
   *   Fase 2 — Hands refina la dirección solo cuando lleva ≥ HANDS_MIN_STABLE
   *             frames con wristH coherente con wristP; de lo contrario fallback Pose.
   *
   * @param {Array|null}            poseLandmarks
   * @param {Object}                hands  - { Left, Right }
   * @param {'Right'|'Left'|'auto'} side
   * @param {boolean}               singleFrame - true en imágenes estáticas: omite el
   *                                              tracker temporal y activa Hands si está
   *                                              disponible en el frame actual.
   * @returns {PointingResult}
   */
  estimate(poseLandmarks, hands, side = 'auto', singleFrame = false) {
    // ── Fase 1: selección del brazo — solo Pose, con debounce ────────────────
    const rawSide = side === 'auto'
      ? detectActiveSide(poseLandmarks, this._lastSide)
      : side;

    // En modo manual el cambio es inmediato; en auto se requieren SIDE_CHANGE_FRAMES
    // frames consecutivos con el mismo candidato para confirmar el switch.
    let activeSide;
    if (this._lastSide === null || side !== 'auto') {
      activeSide             = rawSide;
      this._lastSide         = rawSide;
      this._pendingSide      = null;
      this._pendingSideCount = 0;
    } else if (rawSide === this._lastSide) {
      activeSide             = rawSide;
      this._pendingSide      = null;
      this._pendingSideCount = 0;
    } else {
      // Candidato distinto al brazo activo — acumular frames consecutivos
      if (rawSide !== this._pendingSide) {
        this._pendingSide      = rawSide;
        this._pendingSideCount = 1;
      } else {
        this._pendingSideCount++;
      }

      if (this._pendingSideCount >= SIDE_CHANGE_FRAMES) {
        // Cambio confirmado
        activeSide             = rawSide;
        this._lastSide         = rawSide;
        this._pendingSide      = null;
        this._pendingSideCount = 0;
        this._handStableFrames = 0;  // reset Hands al cambiar de brazo
      } else {
        // Todavía no confirmado — mantener el brazo activo anterior
        activeSide = this._lastSide;
      }
    }

    // ── Fase 2: evaluar estabilidad de Hands para el brazo activo ─────────────
    // extractArmVectors aplica internamente la verificación de proximidad
    // wristH vs wristP; hasHands=true solo si son coherentes (mismo brazo).
    const probeData = extractArmVectors(poseLandmarks, hands, activeSide);

    // En singleFrame (imagen estática) no hay historia temporal: Hands se activa
    // directamente si está disponible en este frame (pasa la verificación de proximidad).
    // En vídeo/cámara se requiere estabilidad sostenida para evitar saltos.
    let handsReliable;
    if (singleFrame) {
      handsReliable = probeData.hasHands;
    } else {
      if (probeData.hasHands) {
        this._handStableFrames = Math.min(this._handStableFrames + 1, HANDS_WINDOW);
      } else {
        this._handStableFrames = Math.max(0, this._handStableFrames - 1);
      }
      handsReliable = this._handStableFrames >= HANDS_MIN_STABLE;
    }

    // ── Fase 3: dirección con fuente efectiva ─────────────────────────────────
    // Si Hands es estable, usar datos completos (ya validados en probeData).
    // Si no, recalcular solo con Pose para evitar contaminación direccional.
    const armData = handsReliable
      ? probeData
      : extractArmVectors(poseLandmarks, null, activeSide);

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
      handsReliable,
    );

    // Origen del rayo: punto distal más preciso disponible.
    // wristH (Hands, ya validada por proximidad) → wristP (Pose) → shoulder (último recurso).
    // Cuando handsReliable=false, armData.points.wristH es null y el fallback es automático.
    const originPt = armData.points.wristH ?? armData.points.wrist ?? armData.points.shoulder;
    const origin   = originPt ? { x: originPt.x, y: originPt.y } : null;

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
      handsReliable,
      handStability: this._handStableFrames / HANDS_WINDOW,
    };
  }

  reset() {
    this._smoothed         = null;
    this._accumConf        = 0;
    this._gestureActive    = false;
    this._lastReason       = 'lost';
    this._handStableFrames = 0;
    this._lastSide         = null;
    this._pendingSide      = null;
    this._pendingSideCount = 0;
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
 * @property {{x,y}|null}     origin         origen del rayo: wristH → wristP → shoulder
 * @property {Object}         armData        datos del brazo (extractArmVectors)
 * @property {'Right'|'Left'} side           brazo activo
 * @property {boolean}        handsReliable  true cuando Hands lleva ≥ HANDS_MIN_STABLE frames estables
 * @property {number}         handStability  [0,1] fracción de la ventana con Hands válido
 */
