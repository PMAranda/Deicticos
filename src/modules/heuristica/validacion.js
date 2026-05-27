import { POSE_IDX } from '../estimacion_corporal/landmarks.js';
import { computeExtensionAngle, normalize2D } from './vectores.js';

const EXT_ANGLE_REF     = 150;   // grados — referencia para escala de extScore (0°→1, 150°+→0)
const MIN_PROXIMAL_VIS  = 0.4;   // visibilidad mínima de hombro y codo
const MIN_WRIST_VIS     = 0.3;   // umbral más permisivo para la muñeca

// Restricción de orientación: el vector del brazo debe desviarse al menos este
// ángulo de la dirección vertical-abajo {0,1} (Y crece hacia abajo en imagen).
// Evita falsos positivos con el brazo relajado colgando hacia abajo.
const MIN_ANGLE_FROM_DOWN = 30;  // grados

// Restricción de alcance: distancia mínima hombro-muñeca en coords normalizadas [0,1].
// Filtra brazos doblados sobre el cuerpo cuya muñeca queda cerca del hombro.
const MIN_WRIST_REACH = 0.12;

/**
 * Valida si la pose actual corresponde a un gesto deíctico.
 *
 * Checks por orden de coste computacional ascendente:
 *   1. Visibilidad de landmarks proximales
 *   2. Orientación global — brazo no colgante hacia abajo
 *   3. Alcance hombro-muñeca — brazo suficientemente extendido
 *
 * El ángulo de extensión ya no es criterio binario de rechazo; se incorpora
 * como factor gradual de confianza (brazo extendido → mayor confianza).
 *
 * @param {Object} armData        - resultado de extractArmVectors()
 * @param {number} extensionAngle - ángulo codo en grados (0°=extendido)
 * @returns {{ isGesture: boolean, confidence: number, reason: string }}
 */
export function validateGesture(armData, extensionAngle) {
  const { visibility, vectors, points } = armData;

  // ── 1. Visibilidad proximal ───────────────────────────────────────────────
  if (visibility.shoulder < MIN_PROXIMAL_VIS) {
    return { isGesture: false, confidence: 0, reason: 'hombro_no_visible' };
  }
  if (visibility.elbow < MIN_PROXIMAL_VIS) {
    return { isGesture: false, confidence: 0, reason: 'codo_no_visible' };
  }
  if (!vectors.shoulderElbow) {
    return { isGesture: false, confidence: 0, reason: 'vector_proximal_ausente' };
  }

  // ── 2. Orientación global — brazo no colgante ─────────────────────────────
  // Preferimos shoulderWrist (dirección completa); fallback a shoulderElbow
  // si la muñeca no es visible.
  const dirVec = vectors.shoulderWrist ?? vectors.shoulderElbow;
  let angleFromDown = 180;   // valor seguro cuando no hay vector
  if (dirVec) {
    const v = normalize2D(dirVec);
    // dot((vx, vy), (0, 1)) = vy  →  ángulo con vertical-abajo
    angleFromDown = Math.acos(Math.max(-1, Math.min(1, v.y))) * (180 / Math.PI);
    if (angleFromDown < MIN_ANGLE_FROM_DOWN) {
      return { isGesture: false, confidence: 0.1, reason: 'brazo_colgante' };
    }
  }

  // ── 3. Alcance hombro-muñeca ──────────────────────────────────────────────
  // Solo se comprueba cuando la muñeca tiene visibilidad suficiente.
  if (points.shoulder && points.wrist && visibility.wrist >= MIN_WRIST_VIS) {
    const dist = Math.hypot(
      points.wrist.x - points.shoulder.x,
      points.wrist.y - points.shoulder.y,
    );
    if (dist < MIN_WRIST_REACH) {
      return { isGesture: false, confidence: 0.1, reason: 'muneca_muy_cerca' };
    }
  }

  // ── Confidencia ponderada ─────────────────────────────────────────────────
  // visibilidad 50% + extensión 30% + elevación 20%
  // extScore: gradual entre 0° (=1) y EXT_ANGLE_REF (=0); nunca rechaza el gesto
  const visScore = (visibility.shoulder + visibility.elbow) / 2;
  const extScore = 1 - Math.min(1, extensionAngle / EXT_ANGLE_REF);
  // elevScore: 0 cuando el brazo roza el umbral mínimo, 1 cuando es horizontal o más arriba
  const elevScore = Math.max(0, Math.min(1,
    (angleFromDown - MIN_ANGLE_FROM_DOWN) / (90 - MIN_ANGLE_FROM_DOWN)
  ));

  const confidence = visScore * 0.5 + extScore * 0.3 + elevScore * 0.2;
  return { isGesture: true, confidence, reason: 'ok' };
}

/**
 * Detecta automáticamente el brazo más extendido / activo.
 * Penaliza brazos que cuelgan hacia abajo para no elegir el brazo relajado.
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

    // Penalizar si la muñeca está significativamente por debajo del hombro
    // (brazo colgante): resta hasta 0.2 según cuánto caiga
    let hangPenalty = 0;
    if (sh && wr) {
      const drop = wr.y - sh.y;   // positivo = muñeca más baja que hombro en imagen
      if (drop > 0.1) hangPenalty = Math.min(0.2, drop);
    }

    // Bonus si el codo está levantado respecto al hombro
    let elevationBonus = 0;
    if (sh && el) {
      const dy = sh.y - el.y;
      if (dy > 0.05) elevationBonus = 0.1;
    }

    return visBase + hasHand + elevationBonus - hangPenalty;
  };

  return score('Right') >= score('Left') ? 'Right' : 'Left';
}
