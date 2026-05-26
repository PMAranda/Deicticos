const COL_LABELS = ['izquierda', 'centro', 'derecha'];
const ROW_LABELS = ['superior',  'medio',  'inferior'];

export class CoordinateSystem {
  /**
   * @param {number} cols - Número de columnas de la rejilla (defecto 3)
   * @param {number} rows - Número de filas de la rejilla (defecto 3)
   */
  constructor(cols = 3, rows = 3) {
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * Normaliza coordenadas de píxel al rango [0, 1] × [0, 1].
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @returns {{ xn: number, yn: number }}
   */
  normalize(x, y, width, height) {
    return {
      xn: Math.max(0, Math.min(1, x / width)),
      yn: Math.max(0, Math.min(1, y / height)),
    };
  }

  /**
   * Clasifica un punto normalizado en su celda de rejilla.
   * @param {number} xn - Coordenada X normalizada [0, 1]
   * @param {number} yn - Coordenada Y normalizada [0, 1]
   * @returns {{ col: number, row: number, colLabel: string, rowLabel: string, label: string }}
   */
  classifyRegion(xn, yn) {
    const col = Math.min(this.cols - 1, Math.floor(xn * this.cols));
    const row = Math.min(this.rows  - 1, Math.floor(yn * this.rows));
    const colLabel = COL_LABELS[col] ?? `col-${col}`;
    const rowLabel = ROW_LABELS[row] ?? `fila-${row}`;
    return { col, row, colLabel, rowLabel, label: `${rowLabel}-${colLabel}` };
  }

  /**
   * Operación combinada: a partir de coordenadas de píxel en el plano rectificado
   * devuelve la referencia espacial completa.
   * @returns {{ xn, yn, col, row, colLabel, rowLabel, label }}
   */
  toSpatialReference(x, y, width, height) {
    const { xn, yn } = this.normalize(x, y, width, height);
    return { xn, yn, ...this.classifyRegion(xn, yn) };
  }

  // ── Métodos de visualización ───────────────────────────────────────────────

  /**
   * Dibuja la rejilla de regiones sobre un CanvasRenderingContext2D.
   */
  drawGrid(ctx, canvasWidth, canvasHeight, {
    strokeStyle  = 'rgba(255, 255, 255, 0.25)',
    lineWidth    = 1,
    showLabels   = true,
    labelColor   = 'rgba(255, 255, 255, 0.45)',
  } = {}) {
    ctx.save();

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth   = lineWidth;

    for (let c = 1; c < this.cols; c++) {
      const x = (c / this.cols) * canvasWidth;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); ctx.stroke();
    }
    for (let r = 1; r < this.rows; r++) {
      const y = (r / this.rows) * canvasHeight;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
    }

    if (showLabels) {
      const cellW = canvasWidth  / this.cols;
      const cellH = canvasHeight / this.rows;
      ctx.fillStyle = labelColor;
      ctx.font      = `bold ${Math.max(11, Math.floor(cellH * 0.1))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';

      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const colLabel = COL_LABELS[c] ?? `col-${c}`;
          const rowLabel = ROW_LABELS[r] ?? `fila-${r}`;
          ctx.fillText(
            `${rowLabel}-${colLabel}`,
            c * cellW + cellW / 2,
            r * cellH + cellH / 2
          );
        }
      }
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  /**
   * Resalta una celda de la rejilla con un color semitransparente.
   */
  highlightRegion(ctx, col, row, canvasWidth, canvasHeight, color = 'rgba(255, 220, 50, 0.30)') {
    const cellW = canvasWidth  / this.cols;
    const cellH = canvasHeight / this.rows;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
    ctx.restore();
  }
}
