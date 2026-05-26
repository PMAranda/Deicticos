import { POSE_IDX, HAND_IDX } from './landmarks.js';

// Pares anatómicos donde tanto Pose como Hands ofrecen estimación del mismo punto
const PAIRS = Object.freeze([
  { id: 'wrist_r',  label: 'Muñeca Der', poseIdx: POSE_IDX.RIGHT_WRIST,  side: 'Right', handIdx: HAND_IDX.WRIST     },
  { id: 'wrist_l',  label: 'Muñeca Izq', poseIdx: POSE_IDX.LEFT_WRIST,   side: 'Left',  handIdx: HAND_IDX.WRIST     },
  { id: 'index_r',  label: 'Índice Der', poseIdx: POSE_IDX.RIGHT_INDEX,  side: 'Right', handIdx: HAND_IDX.INDEX_TIP },
  { id: 'index_l',  label: 'Índice Izq', poseIdx: POSE_IDX.LEFT_INDEX,   side: 'Left',  handIdx: HAND_IDX.INDEX_TIP },
]);

// Umbrales de divergencia (coordenadas normalizadas)
export const DIVERGENCE_THRESHOLDS = Object.freeze({ LOW: 0.02, HIGH: 0.06 });

export const DIVERGENCE_COLOR = Object.freeze({
  similar:   '#4DFF88',
  moderate:  '#FFD700',
  divergent: '#FF4D4D',
});

/**
 * Compara los landmarks Pose vs Hands para los pares anatómicos de interés.
 *
 * @param {NormalizedLandmark[] | null} poseLandmarks
 * @param {{ Left?: NormalizedLandmark[], Right?: NormalizedLandmark[] }} hands
 * @returns {Array<{
 *   id: string,
 *   label: string,
 *   posePt: NormalizedLandmark | null,
 *   handPt: NormalizedLandmark | null,
 *   distance: number | null,
 *   level: 'similar'|'moderate'|'divergent'|null
 * }>}
 */
export function compareSourceLandmarks(poseLandmarks, hands) {
  return PAIRS.map(({ id, label, poseIdx, side, handIdx }) => {
    const posePt = poseLandmarks?.[poseIdx] ?? null;
    const handPt = hands[side]?.[handIdx]   ?? null;

    let distance = null;
    if (posePt && handPt) {
      const dx = posePt.x - handPt.x;
      const dy = posePt.y - handPt.y;
      distance = Math.sqrt(dx * dx + dy * dy);
    }

    const level = distance === null                             ? null
      : distance < DIVERGENCE_THRESHOLDS.LOW                   ? 'similar'
      : distance < DIVERGENCE_THRESHOLDS.HIGH                  ? 'moderate'
      :                                                           'divergent';

    return { id, label, posePt, handPt, distance, level };
  });
}
