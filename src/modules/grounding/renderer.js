/**
 * GroundingRenderer — Visualización del punto de impacto del rayo de pointing.
 *
 * Proporciona dos tipos de render:
 *   1. drawRayToBoard()   — sobre el canvas de cámara (rayo extendido hasta el tablero)
 *   2. drawBoardImpact()  — sobre el canvas del tablero (impacto + historial)
 *   3. drawStatusPanel()  — panel de métricas de grounding
 */
export class GroundingRenderer {
  constructor() {
    this._trail = [];   // historial de impactos suavizados para el rastro visual
    this._maxTrail = 40;
  }

  /**
   * Dibuja el rayo desde el hombro hasta el punto de impacto en el tablero,
   * sobre el canvas de cámara raw.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x,y}|null} origin  - Hombro en coords normalizadas [0,1]
   * @param {{x,y}|null} hitPx   - Impacto en píxeles de cámara
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  drawRayToBoard(ctx, origin, hitPx, canvasWidth, canvasHeight) {
    if (!origin || !hitPx) return;

    const ox = origin.x * canvasWidth;
    const oy = origin.y * canvasHeight;

    ctx.save();

    // Línea punteada hombro → tablero
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.80)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(hitPx.x, hitPx.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Marcador de impacto: círculo amarillo con halo blanco
    ctx.beginPath();
    ctx.arc(hitPx.x, hitPx.y, 10, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255, 215, 0, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Cruz interior
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 1.5;
    const s = 5;
    ctx.beginPath();
    ctx.moveTo(hitPx.x - s, hitPx.y); ctx.lineTo(hitPx.x + s, hitPx.y);
    ctx.moveTo(hitPx.x, hitPx.y - s); ctx.lineTo(hitPx.x, hitPx.y + s);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Dibuja el impacto y el rastro de posiciones sobre el canvas del tablero.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./grounding.js').GroundingResult | null} result
   * @param {import('../homografia/coordinates.js').CoordinateSystem} coordSystem
   * @param {number} boardWidth
   * @param {number} boardHeight
   */
  drawBoardImpact(ctx, result, coordSystem, boardWidth, boardHeight) {
    if (result) {
      const pt = { x: result.smoothed.x, y: result.smoothed.y };
      this._trail.push(pt);
      if (this._trail.length > this._maxTrail) this._trail.shift();
    }

    // Fondo del tablero
    ctx.save();
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, boardWidth, boardHeight);

    if (result) {
      // Región activa resaltada
      coordSystem.highlightRegion(ctx,
        result.region.col, result.region.row,
        boardWidth, boardHeight,
        'rgba(255, 215, 0, 0.15)');
    }

    // Rejilla del tablero
    coordSystem.drawGrid(ctx, boardWidth, boardHeight, {
      strokeStyle: 'rgba(255,255,255,0.18)',
      lineWidth:   1,
      showLabels:  true,
      labelColor:  'rgba(255,255,255,0.25)',
    });

    if (!result) { ctx.restore(); return; }

    // Rastro de impactos anteriores (degradado de opacidad)
    for (let i = 0; i < this._trail.length - 1; i++) {
      const alpha = (i / this._trail.length) * 0.5;
      const px    = this._trail[i].x * boardWidth;
      const py    = this._trail[i].y * boardHeight;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,215,0,${alpha})`;
      ctx.fill();
    }

    // Punto raw (impacto directo)
    const rx = result.xn       * boardWidth;
    const ry = result.yn       * boardHeight;
    ctx.beginPath();
    ctx.arc(rx, ry, 5, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255,215,0,0.45)';
    ctx.fill();

    // Punto suavizado (impacto EMA, más visible)
    const sx = result.smoothed.x * boardWidth;
    const sy = result.smoothed.y * boardHeight;

    ctx.beginPath();
    ctx.arc(sx, sy, 11, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255, 215, 0, 0.90)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Cruz central
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 2;
    const cs = 6;
    ctx.beginPath();
    ctx.moveTo(sx - cs, sy); ctx.lineTo(sx + cs, sy);
    ctx.moveTo(sx, sy - cs); ctx.lineTo(sx, sy + cs);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Panel de estado de grounding debajo del canvas del tablero.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./grounding.js').GroundingResult | null} result
   * @param {Object} metrics  - Resultado de ImpactTracker.getMetrics()
   * @param {number} boardWidth
   */
  drawStatusPanel(ctx, result, metrics, boardWidth) {
    const jColor = metrics.level === 'stable'   ? '#4DFF88'
                 : metrics.level === 'moderate' ? '#FFD700'
                 : '#FF4D4D';

    const lines = result ? [
      [`Región:`,  result.region.label,                   '#FFD700'],
      [`Coord:`,   `(${result.xn.toFixed(3)}, ${result.yn.toFixed(3)})`, '#c0c0d0'],
      [`Impacto:`, `${Math.round(result.t)} px del hombro`, '#888'],
      [`Jitter:`,  `${(metrics.jitter * 1000).toFixed(1)}`,  jColor],
    ] : [
      [`Estado:`,  'Sin impacto',  '#555'],
    ];

    const padX = 10, padY = 8, lineH = 19;
    const panelH = lines.length * lineH + padY * 2;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, boardWidth, panelH);

    ctx.font = '12px monospace';
    lines.forEach(([label, value, color], i) => {
      const y = padY + i * lineH + 12;
      ctx.fillStyle = '#5060a0';
      ctx.fillText(label, padX, y);
      ctx.fillStyle = color;
      ctx.fillText(value, padX + 72, y);
    });

    ctx.restore();
  }

  clearTrail() {
    this._trail = [];
  }
}
