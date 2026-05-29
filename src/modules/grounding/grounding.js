import { rayPolygonIntersect, isPointInConvexPolygon } from './interseccion.js';

const EMA_ALPHA = 0.25;  // suavizado del punto de impacto en coords normalizadas

/**
 * BoardGrounding — Proyecta el rayo de pointing sobre la superficie calibrada
 * de la pizarra y obtiene coordenadas espaciales normalizadas.
 *
 * Flujo por frame:
 *   1. Convierte origen y dirección de coords normalizadas [0,1] a píxeles de cámara.
 *   2. Calcula la intersección del rayo con el cuadrilátero del tablero.
 *   3. Transforma el punto de impacto al espacio rectificado mediante homografía.
 *   4. Normaliza a [0,1]² y clasifica la región mediante CoordinateSystem.
 *   5. Aplica EMA sobre la posición normalizada del impacto.
 */
export class BoardGrounding {
  /**
   * @param {import('../homografia/homography.js').HomographyModule} homography
   * @param {import('../homografia/coordinates.js').CoordinateSystem}  coordSystem
   */
  constructor(homography, coordSystem) {
    this.homography  = homography;
    this.coordSystem = coordSystem;
    this._smoothed   = null;   // { x, y } en coords normalizadas [0,1]
  }

  /**
   * Proyecta un resultado de pointing sobre el tablero calibrado.
   *
   * @param {import('../heuristica/pointing.js').PointingResult} result
   * @param {number}         canvasWidth   - Ancho del canvas de cámara (px)
   * @param {number}         canvasHeight  - Alto del canvas de cámara (px)
   * @param {Array<{x,y}>}   corners       - 4 esquinas del tablero (↖↗↘↙, px cámara)
   * @returns {GroundingResult | null}
   */
  project(result, canvasWidth, canvasHeight, corners) {
    if (!result.isGesture || !result.vector || !result.origin) {
      if (this._smoothed) {
        this._smoothed = { x: this._smoothed.x * 0.95, y: this._smoothed.y * 0.95 };
      }
      return null;
    }
    if (!this.homography.isReady || !corners || corners.length !== 4) return null;

    // ── 1. Origen y dirección en espacio de píxeles ───────────────────────────
    const origin = {
      x: result.origin.x * canvasWidth,
      y: result.origin.y * canvasHeight,
    };

    // La dirección en [0,1]² se escala a píxeles para preservar los ángulos
    // respecto al aspecto real de la imagen (evita distorsión con aspecto ≠ 1:1).
    const rawDx = result.vector.x * canvasWidth;
    const rawDy = result.vector.y * canvasHeight;
    const mag   = Math.hypot(rawDx, rawDy);
    if (mag < 1e-9) return null;
    const dir = { x: rawDx / mag, y: rawDy / mag };

    // ── 2. Hit point: fingertip directo o intersección del rayo ─────────────────
    // Si Hands es fiable y el dedo índice está físicamente dentro del polígono
    // del tablero, lo usamos directamente — evita que el rayo solo alcance bordes.
    const indexH = result.handsReliable && result.armData?.points?.indexH;
    const indexPx = indexH
      ? { x: indexH.x * canvasWidth, y: indexH.y * canvasHeight }
      : null;

    const fingertipInside = indexPx ? isPointInConvexPolygon(indexPx, corners) : false;
    let hitPx;
    let hitT = null;
    if (fingertipInside) {
      hitPx = indexPx;
    } else {
      const rayHit = rayPolygonIntersect(origin, dir, corners);
      if (!rayHit) return null;
      hitPx = { x: rayHit.x, y: rayHit.y };
      hitT  = rayHit.t;
    }

    // ── 3. Homografía: píxeles de cámara → plano rectificado ─────────────────
    const rectPt = this.homography.transformPoint(hitPx.x, hitPx.y);

    // ── 4. Normalización y clasificación de región ────────────────────────────
    const ref = this.coordSystem.toSpatialReference(
      rectPt.x, rectPt.y,
      this.homography.rectWidth,
      this.homography.rectHeight,
    );

    // ── 5. EMA sobre la posición normalizada del impacto ──────────────────────
    if (this._smoothed) {
      this._smoothed = {
        x: EMA_ALPHA * ref.xn + (1 - EMA_ALPHA) * this._smoothed.x,
        y: EMA_ALPHA * ref.yn + (1 - EMA_ALPHA) * this._smoothed.y,
      };
    } else {
      this._smoothed = { x: ref.xn, y: ref.yn };
    }

    return {
      hitPx:   { x: hitPx.x,  y: hitPx.y  },   // impacto en píxeles de cámara
      rectPx:  { x: rectPt.x, y: rectPt.y },   // impacto en plano rectificado (px)
      xn:      ref.xn,                           // coords normalizadas [0,1]
      yn:      ref.yn,
      smoothed: { ...this._smoothed },            // posición EMA
      region: {
        col:      ref.col,
        row:      ref.row,
        colLabel: ref.colLabel,
        rowLabel: ref.rowLabel,
        label:    ref.label,
      },
      fingertipDirect: fingertipInside,
      t: hitT,   // distancia rayo → impacto (null si hit directo por fingertip)
    };
  }

  reset() {
    this._smoothed = null;
  }
}

/**
 * @typedef {Object} GroundingResult
 * @property {{x,y}} hitPx    - Punto de impacto en píxeles de cámara
 * @property {{x,y}} rectPx   - Punto de impacto en plano rectificado (px)
 * @property {number} xn       - Coordenada X normalizada [0,1] en el tablero
 * @property {number} yn       - Coordenada Y normalizada [0,1] en el tablero
 * @property {{x,y}} smoothed  - Posición EMA normalizada
 * @property {Object} region   - { col, row, colLabel, rowLabel, label }
 * @property {number} t        - Distancia del rayo al impacto (px cámara)
 */
