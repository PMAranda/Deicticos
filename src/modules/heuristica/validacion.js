import { POSE_IDX } from '../estimacion_corporal/landmarks.js';
import { computeExtensionAngle } from './vectores.js';

// Ángulo máximo de doblado del codo para considerar que hay gesto (grados)
const MAX_BEND_ANGLE = 90;
// Visibilidad mínima de landmarks proximales
const MIN_PROXIMAL_VIS = 0.4;
// Extensión mínima para considerar gesto activo (grados entre el vector del brazo y la horizontal)
const MIN_ARM_ELEVATION = 10;

/**
 * Valida si la pose actual corresponde a un gesto deíctico.
 * @param {Object} armData       - resultado de extractArmVectors()
 * @param {number} extensionAngle - ángulo de extensión calculado
 * @returns {{ isGesture: boolean, confidence: number, reason: string }}
 */
export function validateGesture(armData, extensionAngle) {
  const { visibility, vectors } = armData;

  if (visibility.shoulder < MIN_PROXIMAL_VIS) {
    return { isGesture: false, confidence: 0, reason: 'hombro_no_visible' };
  }
  if (visibility.elbow < MIN_PROXIMAL_VIS) {
    return { isGesture: false, confidence: 0, reason: 'codo_no_visible' };
  }
  if (!vectors.shoulderElbow) {
    return { isGesture: false, confidence: 0, reason: 'vector_proximal_ausente' };
  }
  if (extensionAngle > MAX_BEND_ANGLE) {
    return { isGesture: false, confidence: 0.2, reason: 'brazo_doblado' };
  }

  // Confidencia basada en visibilidad y extensión
  const visScore  = (visibility.shoulder + visibility.elbow) / 2;
  const extScore  = 1 - Math.min(1, extensionAngle / MAX_BEND_ANGLE);
  const confidence = visScore * 0.6 + extScore * 0.4;

  return { isGesture: true, confidence, reason: 'ok' };
}

/**
 * Detecta automáticamente el brazo más extendido / activo.
 * Prefiere el brazo con mayor visibilidad de muñeca e índice y menor ángulo de doblado.
 * @param {Array|null} poseLandmarks
 * @param {Object}     hands          - { Left, Right }
 * @returns {'Right'|'Left'}
 */
export function detectActiveSide(poseLandmarks, hands) {
  if (!poseLandmarks) return 'Right';

  const score = (side) => {
    const isRight = side === 'Right';
    const sh = poseLandmarks[isRight ? POSE_IDX.RIGHT_SHOULDER : POSE_IDX.LEFT_SHOULDER];
    const el = poseLandmarks[isRight ? POSE_IDX.RIGHT_ELBOW    : POSE_IDX.LEFT_ELBOW];
    const wr = poseLandmarks[isRight ? POSE_IDX.RIGHT_WRIST    : POSE_IDX.LEFT_WRIST];

    const visBase = ((sh?.visibility ?? 0) + (el?.visibility ?? 0) + (wr?.visibility ?? 0)) / 3;
    const hasHand = hands?.[side] != null ? 0.15 : 0;

    // Bonus si el codo está levantado respecto al hombro (el.y < sh.y en coords imagen)
    let elevationBonus = 0;
    if (sh && el) {
      const dy = sh.y - el.y;   // positivo cuando el codo está por encima del hombro
      if (dy > 0.05) elevationBonus = 0.1;
    }

    return visBase + hasHand + elevationBonus;
  };

  return score('Right') >= score('Left') ? 'Right' : 'Left';
}
