// ── Índices MediaPipe Pose (33 landmarks) ────────────────────────────────────
export const POSE_IDX = Object.freeze({
  LEFT_SHOULDER:  11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW:     13,
  RIGHT_ELBOW:    14,
  LEFT_WRIST:     15,
  RIGHT_WRIST:    16,
  LEFT_PINKY:     17,
  RIGHT_PINKY:    18,
  LEFT_INDEX:     19,
  RIGHT_INDEX:    20,
  LEFT_THUMB:     21,
  RIGHT_THUMB:    22,
});

// ── Índices MediaPipe Hands (21 landmarks) ───────────────────────────────────
export const HAND_IDX = Object.freeze({
  WRIST:       0,
  THUMB_TIP:   4,
  INDEX_MCP:   5,
  INDEX_PIP:   6,
  INDEX_DIP:   7,
  INDEX_TIP:   8,
  MIDDLE_TIP: 12,
});

// Cadenas cinemáticas del brazo (hombro → codo → muñeca)
export const ARM_CHAIN_LEFT  = [POSE_IDX.LEFT_SHOULDER,  POSE_IDX.LEFT_ELBOW,  POSE_IDX.LEFT_WRIST];
export const ARM_CHAIN_RIGHT = [POSE_IDX.RIGHT_SHOULDER, POSE_IDX.RIGHT_ELBOW, POSE_IDX.RIGHT_WRIST];

// Cadena del dedo índice (muñeca → punta)
export const INDEX_CHAIN = [
  HAND_IDX.WRIST,
  HAND_IDX.INDEX_MCP,
  HAND_IDX.INDEX_PIP,
  HAND_IDX.INDEX_DIP,
  HAND_IDX.INDEX_TIP,
];

/**
 * Landmarks de pose cuya estabilidad se monitoriza activamente.
 * source:
 *   'pose'  → solo MediaPipe Pose puede estimarlo
 *   'both'  → también disponible en MediaPipe Hands (permite comparar robustez)
 */
export const STABILITY_KEYS = [
  { key: 'L_SHOULDER', idx: POSE_IDX.LEFT_SHOULDER,  source: 'pose' },
  { key: 'R_SHOULDER', idx: POSE_IDX.RIGHT_SHOULDER, source: 'pose' },
  { key: 'L_ELBOW',    idx: POSE_IDX.LEFT_ELBOW,     source: 'pose' },
  { key: 'R_ELBOW',    idx: POSE_IDX.RIGHT_ELBOW,    source: 'pose' },
  { key: 'L_WRIST',    idx: POSE_IDX.LEFT_WRIST,     source: 'both' },
  { key: 'R_WRIST',    idx: POSE_IDX.RIGHT_WRIST,    source: 'both' },
];

export const SOURCE_LABEL = Object.freeze({
  pose:  'Pose',
  hands: 'Hands',
  both:  'Pose + Hands',
});

/**
 * Empaqueta los landmarks relevantes de los resultados de pose y manos.
 *
 * Corrección del flip especular de MediaPipe Hands: la categoría "Left" que
 * devuelve el modelo corresponde a la mano derecha real del usuario cuando la
 * cámara está en modo espejo (comportamiento por defecto en navegador).
 *
 * @param {PoseLandmarkerResult}  poseResult
 * @param {HandLandmarkerResult}  handsResult
 * @returns {{ pose: NormalizedLandmark[] | null, hands: { Left?, Right? } }}
 */
export function extractDeicticLandmarks(poseResult, handsResult) {
  const pose  = poseResult?.landmarks?.[0] ?? null;
  const hands = {};

  if (handsResult?.landmarks) {
    handsResult.landmarks.forEach((lmks, i) => {
      const raw       = handsResult.handednesses[i]?.[0]?.categoryName ?? 'Unknown';
      const corrected = raw === 'Left' ? 'Right' : 'Left';
      hands[corrected] = lmks;
    });
  }

  return { pose, hands };
}
