import { normalize2D, scale2D, add2D, magnitude2D } from './vectores.js';

// Pesos base de la fusión jerárquica
const BASE_WEIGHTS = {
  shoulderElbow: 0.50,
  shoulderWrist: 0.20,
  elbowWrist:    0.15,
  wristIndex:    0.15,
};

/**
 * Fusiona los vectores del brazo en un único vector de pointing normalizado.
 *
 * Estrategia jerárquica:
 *   1. Proximales (shoulder→elbow) son la base principal — alta estabilidad.
 *   2. Distales se añaden como refinamiento solo cuando su visibilidad es suficiente.
 *   3. Los pesos se redistribuyen automáticamente entre los vectores activos.
 *
 * @param {Object} vectors    - { shoulderElbow, shoulderWrist, elbowWrist, wristIndex }
 * @param {Object} visibility - { shoulder, elbow, wrist, index }
 * @param {boolean} hasHands
 * @returns {{ vector: {x,y}|null, weights: Object, mode: string }}
 */
export function fuseVectors(vectors, visibility, hasHands) {
  const VIS_MIN   = 0.4;   // visibilidad mínima para usar un landmark
  const VIS_INDEX = 0.35;  // umbral más permisivo para el índice (Hands es más ruidoso)

  const useBase   = vectors.shoulderElbow !== null && visibility.shoulder >= VIS_MIN && visibility.elbow >= VIS_MIN;
  const useSW     = vectors.shoulderWrist !== null && visibility.wrist    >= VIS_MIN;
  const useEW     = vectors.elbowWrist    !== null && visibility.elbow    >= VIS_MIN && visibility.wrist >= VIS_MIN;
  const useIndex  = vectors.wristIndex    !== null && (hasHands || visibility.index >= VIS_INDEX);

  if (!useBase) {
    return { vector: null, weights: {}, mode: 'lost' };
  }

  // Determinar modo según qué información está disponible
  let mode;
  if (useSW && useEW && useIndex) mode = 'full';
  else if (useSW || useEW)        mode = 'partial';
  else                            mode = 'fallback';

  // Construir mapa de vectores activos con sus pesos base
  const active = {};
  active.shoulderElbow = BASE_WEIGHTS.shoulderElbow;
  if (useSW)    active.shoulderWrist = BASE_WEIGHTS.shoulderWrist;
  if (useEW)    active.elbowWrist    = BASE_WEIGHTS.elbowWrist;
  if (useIndex) active.wristIndex    = BASE_WEIGHTS.wristIndex;

  // Redistribuir pesos para que sumen 1
  const total = Object.values(active).reduce((a, b) => a + b, 0);
  const weights = {};
  for (const [k, w] of Object.entries(active)) weights[k] = w / total;

  // Acumular vector fusionado
  let fused = { x: 0, y: 0 };
  for (const [k, w] of Object.entries(weights)) {
    if (vectors[k]) fused = add2D(fused, scale2D(normalize2D(vectors[k]), w));
  }

  const mag = magnitude2D(fused);
  const vector = mag > 1e-9 ? normalize2D(fused) : null;

  return { vector, weights, mode };
}
