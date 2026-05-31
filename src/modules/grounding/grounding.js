import { rayPolygonIntersect, isPointInConvexPolygon } from './interseccion.js';

const EMA_ALPHA = 0.25;  // suavizado del punto de impacto en coords normalizadas

// Frames consecutivos que la región candidata debe mantener antes de confirmar
// el cambio. Evita parpadeo de etiqueta cuando el impacto roza el borde de la rejilla.
const REGION_CHANGE_FRAMES = 5;

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
    this._smoothed          = null;
    this._lastRegion        = null;
    this._pendingRegion     = null;
    this._pendingRegionCount = 0;
    this._regionChangeFrames = REGION_CHANGE_FRAMES;
  }

  /** Actualiza el umbral de debounce de región en caliente. */
  setRegionDebounce(n) {
    this._regionChangeFrames = Math.max(1, Math.round(n));
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
  project(result, canvasWidth, canvasHeight, corners, forceRay = false) {
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

    const fingertipInside = !forceRay && indexPx ? isPointInConvexPolygon(indexPx, corners) : false;
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

    // ── 4. Normalización de las coordenadas brutas ────────────────────────────
    const { xn, yn } = this.coordSystem.normalize(
      rectPt.x, rectPt.y,
      this.homography.rectWidth,
      this.homography.rectHeight,
    );

    // ── 5. EMA sobre la posición normalizada ──────────────────────────────────
    if (this._smoothed) {
      this._smoothed = {
        x: EMA_ALPHA * xn + (1 - EMA_ALPHA) * this._smoothed.x,
        y: EMA_ALPHA * yn + (1 - EMA_ALPHA) * this._smoothed.y,
      };
    } else {
      this._smoothed = { x: xn, y: yn };
    }

    // ── 6. Clasificación de región desde coords suavizadas + debounce ─────────
    // Clasificar desde smoothed (no desde xn/yn brutas) para que la etiqueta
    // semántica sea coherente con la posición visual del impacto.
    // El debounce evita cambios de etiqueta cuando el impacto roza un borde.
    const rawRegion = this.coordSystem.classifyRegion(this._smoothed.x, this._smoothed.y);

    let stableRegion;
    if (this._lastRegion === null) {
      stableRegion             = rawRegion;
      this._lastRegion         = rawRegion;
      this._pendingRegion      = null;
      this._pendingRegionCount = 0;
    } else if (rawRegion.col === this._lastRegion.col && rawRegion.row === this._lastRegion.row) {
      stableRegion             = rawRegion;
      this._pendingRegion      = null;
      this._pendingRegionCount = 0;
    } else {
      // Candidato nuevo — acumular frames consecutivos antes de confirmar
      if (this._pendingRegion &&
          rawRegion.col === this._pendingRegion.col &&
          rawRegion.row === this._pendingRegion.row) {
        this._pendingRegionCount++;
      } else {
        this._pendingRegion      = rawRegion;
        this._pendingRegionCount = 1;
      }

      if (this._pendingRegionCount >= this._regionChangeFrames) {
        stableRegion             = rawRegion;
        this._lastRegion         = rawRegion;
        this._pendingRegion      = null;
        this._pendingRegionCount = 0;
      } else {
        stableRegion = this._lastRegion;
      }
    }

    return {
      hitPx:   { x: hitPx.x,  y: hitPx.y  },   // impacto en píxeles de cámara
      rectPx:  { x: rectPt.x, y: rectPt.y },   // impacto en plano rectificado (px)
      xn,                                        // coords normalizadas brutas [0,1]
      yn,
      smoothed: { ...this._smoothed },            // posición EMA
      region:  stableRegion,                      // región estabilizada temporalmente
      fingertipDirect: fingertipInside,
      t: hitT,   // distancia rayo → impacto (null si hit directo por fingertip)
    };
  }

  reset() {
    this._smoothed          = null;
    this._lastRegion        = null;
    this._pendingRegion     = null;
    this._pendingRegionCount = 0;
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
