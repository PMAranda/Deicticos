/**
 * Geometría 2D para la intersección rayo-tablero en espacio de píxeles de cámara.
 * El tablero se representa como un polígono cuadrangular definido por sus 4 esquinas
 * (↖↗↘↙) en coordenadas de píxel del canvas de cámara.
 */

/**
 * Intersección entre un rayo 2D y un segmento 2D.
 *
 * Rayo:     P(t) = O + t·D,  t ≥ 0
 * Segmento: Q(s) = A + s·(B-A),  s ∈ [0,1]
 *
 * @param {{x,y}} O - Origen del rayo
 * @param {{x,y}} D - Dirección del rayo (no necesita ser unitaria)
 * @param {{x,y}} A - Extremo inicial del segmento
 * @param {{x,y}} B - Extremo final del segmento
 * @returns {{ t:number, s:number, x:number, y:number } | null}
 */
export function raySegmentIntersect(O, D, A, B) {
  const ex = B.x - A.x, ey = B.y - A.y;
  const rx = O.x - A.x, ry = O.y - A.y;
  const denom = D.x * ey - D.y * ex;
  if (Math.abs(denom) < 1e-9) return null;        // paralelo

  const t = (ex * ry - ey * rx) / denom;
  const s = (D.x * ry - rx * D.y) / denom;

  if (t < 0 || s < -1e-9 || s > 1 + 1e-9) return null;
  return { t, s, x: O.x + t * D.x, y: O.y + t * D.y };
}

/**
 * Intersección del rayo con un polígono convexo (el cuadrilátero del tablero).
 * Devuelve el primer impacto (t mínimo > 0) o null si no hay intersección.
 *
 * @param {{x,y}}        origin  - Origen del rayo en píxeles de cámara
 * @param {{x,y}}        dir     - Dirección del rayo en píxeles (normalizada)
 * @param {Array<{x,y}>} polygon - 4 esquinas del tablero en orden ↖↗↘↙
 * @returns {{ x:number, y:number, t:number, edgeIdx:number } | null}
 */
export function rayPolygonIntersect(origin, dir, polygon) {
  const n = polygon.length;
  let best = null;

  for (let i = 0; i < n; i++) {
    const A = polygon[i];
    const B = polygon[(i + 1) % n];
    const hit = raySegmentIntersect(origin, dir, A, B);
    if (hit && (best === null || hit.t < best.t)) {
      best = { x: hit.x, y: hit.y, t: hit.t, edgeIdx: i };
    }
  }

  return best;
}
