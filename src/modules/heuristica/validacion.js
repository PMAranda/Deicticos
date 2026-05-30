import { computeExtensionAngle, normalize2D, extractArmVectors } from './vectores.js';

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
  // Dos guardias contra falsos positivos por foreshortening (brazo extendido
  // en profundidad hacia/desde la cámara → distancia 2D pequeña aunque el brazo
  // esté realmente extendido):
  //   - Guardia por codo: el codo ya está lejos del hombro en 2D → segmento
  //     proximal visible y extendido (funciona cuando el brazo se extiende lateralmente).
  //   - Guardia por extensión: el ángulo de extensión es pequeño → el brazo está
  //     casi recto en 3D aunque proyecte colapsado (funciona cuando el brazo apunta
  //     en profundidad; el ángulo entre vectores se conserva mejor que la distancia).
  if (points.shoulder && points.wrist && visibility.wrist >= MIN_WRIST_VIS) {
    const elbowFar = points.elbow && Math.hypot(
      points.elbow.x - points.shoulder.x,
      points.elbow.y - points.shoulder.y,
    ) > 0.10;

    const armStraight = extensionAngle < 60;

    if (!elbowFar && !armStraight) {
      const dist = Math.hypot(
        points.wrist.x - points.shoulder.x,
        points.wrist.y - points.shoulder.y,
      );
      if (dist < MIN_WRIST_REACH) {
        return { isGesture: false, confidence: 0.1, reason: 'muneca_muy_cerca' };
      }
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

// Margen cuando el brazo activo SIGUE gesticulando: muy alto para evitar switches
// cuando ambos brazos pasan validateGesture con scores similares (ej. brazo activo
// apunta a la pizarra mientras el otro se apoya en una silla).
const SIDE_SWITCH_MARGIN_ACTIVE = 0.50;

// Margen cuando el brazo activo HA PERDIDO el gesto: bajo para que el sistema
// cambie ágilmente al brazo que sí está gesticulando.
const SIDE_SWITCH_MARGIN_LOST = 0.10;

/**
 * Detecta el brazo activo usando ÚNICAMENTE Pose como fuente de verdad semántica.
 * Hands no interviene en la selección — solo en el refinamiento direccional
 * (gestionado por PointingEstimator con su tracker de estabilidad manual).
 *
 * Scoring de 2 niveles:
 *   gesto validado por Pose → 1.0 + confidence
 *   sin gesto               → visBase × 0.3  (desempate por visibilidad básica)
 *
 * Si se proporciona `currentSide`, se aplica histéresis: el brazo contrario debe
 * superar al activo en al menos SIDE_SWITCH_MARGIN para provocar el cambio.
 *
 * @param {Array|null}          poseLandmarks
 * @param {'Right'|'Left'|null} currentSide   - brazo actualmente seleccionado
 * @returns {'Right'|'Left'}
 */
export function detectActiveSide(poseLandmarks, currentSide = null) {
  if (!poseLandmarks) return currentSide ?? 'Right';

  const scoreForSide = (side) => {
    const armData = extractArmVectors(poseLandmarks, null, side);
    const { vectors, visibility } = armData;

    const seVec = vectors.shoulderElbow;
    const ewVec = vectors.elbowWrist;
    const extensionAngle = (seVec && ewVec)
      ? computeExtensionAngle(seVec, ewVec)
      : 180;

    const { isGesture, confidence } = validateGesture(armData, extensionAngle);

    if (isGesture) return 1.0 + confidence;

    const visBase = (visibility.shoulder + visibility.elbow) / 2;
    return visBase * 0.3;
  };

  const scoreRight = scoreForSide('Right');
  const scoreLeft  = scoreForSide('Left');

  if (currentSide === null) {
    return scoreRight >= scoreLeft ? 'Right' : 'Left';
  }

  const scoreCurrent = currentSide === 'Right' ? scoreRight : scoreLeft;
  const scoreOther   = currentSide === 'Right' ? scoreLeft  : scoreRight;
  const other        = currentSide === 'Right' ? 'Left'     : 'Right';

  // Margen adaptativo: si el brazo activo sigue gesticulando (score > 1.0),
  // se exige una ventaja grande para cambiar — evita switches cuando el brazo
  // no activo también pasa validateGesture con confianza similar.
  // Si el brazo activo ya no gesticula, el margen es pequeño para reaccionar rápido.
  const currentGesturing = scoreCurrent > 1.0;
  const margin = currentGesturing ? SIDE_SWITCH_MARGIN_ACTIVE : SIDE_SWITCH_MARGIN_LOST;

  return scoreOther >= scoreCurrent + margin ? other : currentSide;
}
