import { POSE_IDX, HAND_IDX } from '../estimacion_corporal/landmarks.js';

// ── Utilidades vectoriales 2D ─────────────────────────────────────────────────

export function sub2D(a, b)       { return { x: a.x - b.x, y: a.y - b.y }; }
export function add2D(a, b)       { return { x: a.x + b.x, y: a.y + b.y }; }
export function scale2D(v, s)     { return { x: v.x * s, y: v.y * s }; }
export function magnitude2D(v)    { return Math.hypot(v.x, v.y); }
export function dot2D(a, b)       { return a.x * b.x + a.y * b.y; }

export function normalize2D(v) {
  const m = magnitude2D(v);
  return m > 1e-9 ? { x: v.x / m, y: v.y / m } : { x: 0, y: 0 };
}

/**
 * Ángulo de extensión del brazo en grados.
 * Mide el ángulo en el codo: 0° = totalmente extendido, ~180° = completamente doblado.
 * Recibe los vectores dirección hombro→codo y codo→muñeca.
 */
export function computeExtensionAngle(shoulderElbow, elbowWrist) {
  const a = normalize2D(shoulderElbow);
  const b = normalize2D(elbowWrist);
  // Ángulo entre los dos segmentos (continuación = 0°)
  const cosA = Math.max(-1, Math.min(1, dot2D(a, b)));
  return Math.acos(cosA) * (180 / Math.PI);
}

// ── Extracción de vectores del brazo ─────────────────────────────────────────

/**
 * Extrae los vectores corporales para el brazo indicado.
 * @param {Array|null}  poseLandmarks  - array de 33 landmarks de Pose
 * @param {Object}      hands          - { Left, Right } landmarks de Hands (ya corregidos)
 * @param {'Left'|'Right'} side
 * @returns {Object}  { side, points, vectors, visibility, hasHands }
 */
export function extractArmVectors(poseLandmarks, hands, side) {
  const isRight = side === 'Right';
  const IDX = {
    shoulder: isRight ? POSE_IDX.RIGHT_SHOULDER : POSE_IDX.LEFT_SHOULDER,
    elbow:    isRight ? POSE_IDX.RIGHT_ELBOW    : POSE_IDX.LEFT_ELBOW,
    wrist:    isRight ? POSE_IDX.RIGHT_WRIST    : POSE_IDX.LEFT_WRIST,
    index:    isRight ? POSE_IDX.RIGHT_INDEX    : POSE_IDX.LEFT_INDEX,
  };

  // Puntos de Pose
  const shoulder = poseLandmarks?.[IDX.shoulder] ?? null;
  const elbow    = poseLandmarks?.[IDX.elbow]    ?? null;
  const wristP   = poseLandmarks?.[IDX.wrist]    ?? null;
  const indexP   = poseLandmarks?.[IDX.index]    ?? null;

  // Selección de la mano por proximidad geométrica a wristP.
  // Pose usa convención anatómica (Left/Right del cuerpo) y Hands usa perspectiva
  // de imagen, por lo que la etiqueta puede no coincidir. Se busca entre ambas manos
  // la que tenga la muñeca más cercana a wristP dentro del umbral de coherencia.
  // Si wristP no es fiable, se usa la mano etiquetada como `side` sin verificación.
  const PROX_THRESH = 0.15;
  let bestHandLms = null;

  if (wristP && (wristP.visibility ?? 1) >= 0.3) {
    let bestDist = PROX_THRESH;
    for (const lms of [hands?.['Left'], hands?.['Right']]) {
      if (!lms) continue;
      const wH = lms[HAND_IDX.WRIST];
      if (!wH) continue;
      const d = Math.hypot(wH.x - wristP.x, wH.y - wristP.y);
      if (d < bestDist) { bestDist = d; bestHandLms = lms; }
    }
  } else {
    bestHandLms = hands?.[side] ?? null;
  }

  const wristH   = bestHandLms ? bestHandLms[HAND_IDX.WRIST]     : null;
  const indexH   = bestHandLms ? bestHandLms[HAND_IDX.INDEX_TIP] : null;
  const hasHands = wristH !== null;

  // Visibilidad de cada punto clave
  const vis = {
    shoulder: shoulder?.visibility ?? 0,
    elbow:    elbow?.visibility    ?? 0,
    wrist:    wristP?.visibility   ?? 0,
    index:    indexP?.visibility   ?? 0,
  };

  // Vectores calculados (null si algún punto falta)
  const vectors = {
    shoulderElbow: (shoulder && elbow)  ? sub2D(elbow,    shoulder) : null,
    shoulderWrist: (shoulder && wristP) ? sub2D(wristP,   shoulder) : null,
    elbowWrist:    (elbow    && wristP) ? sub2D(wristP,   elbow)    : null,
    // Preferimos el índice de Hands cuando está disponible
    wristIndex:    hasHands && wristH && indexH
      ? sub2D(indexH, wristH)
      : (wristP && indexP ? sub2D(indexP, wristP) : null),
  };

  return {
    side,
    points: { shoulder, elbow, wrist: wristP, wristH, indexH },
    vectors,
    visibility: vis,
    hasHands,
  };
}
