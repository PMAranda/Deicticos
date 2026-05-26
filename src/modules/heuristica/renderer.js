import { ANGULAR_THRESHOLDS, ANGULAR_LEVEL_COLOR } from './metricas.js';

// Colores por modo de estimación
const MODE_COLOR = {
  full:     '#4DFF88',
  partial:  '#FFD700',
  fallback: '#FF8C4D',
  lost:     '#FF4D4D',
};

const RAY_LENGTH_NORM = 0.55;   // longitud máxima del rayo en coords normalizadas

export class PointingRenderer {

  // ── Rayo de pointing ──────────────────────────────────────────────────────

  drawPointingRay(ctx, result, W, H) {
    const { isGesture, vector, origin, mode, confidence } = result;
    if (!isGesture || !vector || !origin) return;

    const ox = origin.x * W;
    const oy = origin.y * H;
    const ex = (origin.x + vector.x * RAY_LENGTH_NORM) * W;
    const ey = (origin.y + vector.y * RAY_LENGTH_NORM) * H;

    const color = MODE_COLOR[mode] ?? '#fff';

    ctx.save();
    ctx.globalAlpha = 0.55 + confidence * 0.45;

    // Gradiente a lo largo del rayo
    const grad = ctx.createLinearGradient(ox, oy, ex, ey);
    grad.addColorStop(0, color + 'aa');
    grad.addColorStop(1, color);

    ctx.strokeStyle = grad;
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Punta de flecha
    this._drawArrowhead(ctx, ox, oy, ex, ey, color, 12);
    ctx.restore();
  }

  _drawArrowhead(ctx, x1, y1, x2, y2, color, size) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  // ── Vectores componente ───────────────────────────────────────────────────

  drawComponentVectors(ctx, result, W, H) {
    const { armData, weights, isGesture } = result;
    if (!isGesture || !armData) return;

    const { points, vectors } = armData;
    if (!points.shoulder) return;

    const COMPS = [
      { key: 'shoulderElbow', from: points.shoulder, vec: vectors.shoulderElbow, color: '#4D9FFF' },
      { key: 'elbowWrist',    from: points.elbow,    vec: vectors.elbowWrist,    color: '#ff8888' },
      { key: 'wristIndex',    from: points.wristH ?? points.wrist, vec: vectors.wristIndex, color: '#FFD700' },
    ];

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;

    COMPS.forEach(({ key, from, vec, color }) => {
      if (!from || !vec || !weights[key]) return;
      const w = weights[key];
      if (w < 0.01) return;

      const scale = 0.25 * w / 0.5;   // escalar según peso relativo
      const ex = (from.x + vec.x * scale) * W;
      const ey = (from.y + vec.y * scale) * H;

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5 + w * 0.5;
      ctx.beginPath();
      ctx.moveTo(from.x * W, from.y * H);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });

    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Arco de extensión en el codo ──────────────────────────────────────────

  drawExtensionAngle(ctx, armData, extensionAngle, W, H) {
    const elbow = armData?.points?.elbow;
    if (!elbow) return;

    const ex = elbow.x * W;
    const ey = elbow.y * H;
    const r  = 22;

    const color = extensionAngle < 45  ? '#4DFF88'
                : extensionAngle < 90  ? '#FFD700'
                : '#FF4D4D';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, (extensionAngle / 180) * Math.PI);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font      = 'bold 10px monospace';
    ctx.fillText(`${extensionAngle.toFixed(0)}°`, ex + r + 4, ey + 4);
    ctx.restore();
  }

  // ── Panel de estado ───────────────────────────────────────────────────────

  drawStatusPanel(ctx, result, W) {
    const { isGesture, mode, confidence, weights, extensionAngle, side, reason } = result;

    const PAD   = 10;
    const LINE  = 16;
    const W_BOX = 210;

    // Calcular altura dinámica según pesos activos
    const weightEntries = Object.entries(weights ?? {});
    const H_BOX = 22 + LINE * 5 + weightEntries.length * (LINE + 4) + PAD;

    const x0 = W - W_BOX - PAD;
    const y0 = 10;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.70)';
    ctx.beginPath();
    ctx.roundRect(x0, y0, W_BOX, H_BOX, 6);
    ctx.fill();

    ctx.font      = 'bold 11px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('POINTING', x0 + PAD, y0 + PAD + 11);

    let y = y0 + PAD + 28;
    ctx.font = '11px monospace';

    const modeColor = MODE_COLOR[mode] ?? '#aaa';
    const rows = [
      [`Brazo:`, side ?? '—',                          '#aaa'],
      [`Modo:`,  mode ?? '—',                          modeColor],
      [`Gesto:`, isGesture ? 'SÍ' : 'NO',             isGesture ? '#4DFF88' : '#FF4D4D'],
      [`Conf:`,  `${((confidence ?? 0) * 100).toFixed(0)}%`, '#ccc'],
      [`Ext:`,   `${extensionAngle?.toFixed(0) ?? '?'}°`,   '#ccc'],
    ];

    rows.forEach(([label, val, color]) => {
      ctx.fillStyle = '#666';
      ctx.fillText(label.padEnd(8), x0 + PAD, y);
      ctx.fillStyle = color;
      ctx.fillText(val, x0 + PAD + 75, y);
      y += LINE;
    });

    if (!isGesture && reason && reason !== 'ok') {
      ctx.fillStyle = '#FF4D4D';
      ctx.font      = '10px monospace';
      ctx.fillText(reason, x0 + PAD, y);
      y += LINE;
    }

    // Barras de pesos
    if (weightEntries.length > 0) {
      y += 4;
      ctx.fillStyle = '#444';
      ctx.font      = '10px monospace';
      ctx.fillText('PESOS', x0 + PAD, y);
      y += LINE;

      const BAR_W = W_BOX - PAD * 2;
      const WEIGHT_COLORS = {
        shoulderElbow: '#4D9FFF',
        shoulderWrist: '#88ccff',
        elbowWrist:    '#ff8888',
        wristIndex:    '#FFD700',
      };

      weightEntries.forEach(([key, w]) => {
        const barW  = Math.round(w * BAR_W);
        const color = WEIGHT_COLORS[key] ?? '#888';

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(x0 + PAD, y, BAR_W, 10);
        ctx.fillStyle = color + 'bb';
        ctx.fillRect(x0 + PAD, y, barW, 10);

        ctx.fillStyle = '#777';
        ctx.fillText(`${key.slice(0,10).padEnd(10)} ${(w * 100).toFixed(0)}%`, x0 + PAD, y + 22);
        y += LINE + 4;
      });
    }

    ctx.restore();
  }

  // ── Sparklines angulares (canvas separado) ────────────────────────────────

  /**
   * Dibuja dos sparklines: jitter angular y ángulo de pointing.
   * @param {CanvasRenderingContext2D} ctx
   * @param {AngularTracker} tracker
   * @param {number} W
   * @param {number} H
   */
  drawAngularSparklines(ctx, tracker, W, H) {
    const metrics   = tracker.getMetrics();
    const jHistory  = tracker.getJitterHistory();
    const aHistory  = tracker.getAngleHistory();

    const COLS  = 2;
    const cellW = W / COLS;
    const PAD   = 8;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    // ── Celda izquierda: jitter angular ────────────────────────────────────
    {
      const x0    = 0;
      const color = ANGULAR_LEVEL_COLOR[metrics.level] ?? '#666';

      ctx.fillStyle = '#111122';
      ctx.fillRect(x0 + 2, 2, cellW - 4, H - 4);

      ctx.fillStyle = '#777';
      ctx.font      = '10px monospace';
      ctx.fillText('JITTER ANGULAR', x0 + PAD, PAD + 10);

      ctx.fillStyle = color;
      ctx.font      = 'bold 12px monospace';
      ctx.fillText(
        metrics.sampleCount > 0 ? `${metrics.jitter.toFixed(1)}°/frame` : '---',
        x0 + PAD, PAD + 25
      );

      ctx.fillStyle = '#555';
      ctx.font      = '10px monospace';
      const contColor = metrics.continuity > 15 ? '#4DFF88' : metrics.continuity > 5 ? '#FFD700' : '#555';
      ctx.fillStyle = contColor;
      ctx.fillText(`cont: ${metrics.continuity}f`, x0 + cellW - PAD - 72, PAD + 10);
      ctx.fillStyle = '#555';
      const fallPct = (metrics.fallbackRate * 100).toFixed(0);
      ctx.fillText(`fallback: ${fallPct}%`, x0 + cellW - PAD - 72, PAD + 22);

      if (jHistory.length >= 2) {
        const chartX = x0 + PAD;
        const chartY = 38;
        const chartW = cellW - PAD * 2;
        const chartH = H - 48;
        const maxJ   = Math.max(...jHistory, ANGULAR_THRESHOLDS.HIGH * 1.5);

        // Líneas umbral
        [
          [ANGULAR_THRESHOLDS.LOW,  'rgba(77,255,136,0.3)'],
          [ANGULAR_THRESHOLDS.HIGH, 'rgba(255,77,77,0.3)'],
        ].forEach(([thresh, tc]) => {
          const ty = chartY + chartH - (thresh / maxJ) * chartH;
          ctx.save();
          ctx.strokeStyle = tc;
          ctx.lineWidth   = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(chartX, ty);
          ctx.lineTo(chartX + chartW, ty);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        });

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        jHistory.forEach((v, i) => {
          const px = chartX + (i / (jHistory.length - 1)) * chartW;
          const py = chartY + chartH - Math.min(1, v / maxJ) * chartH;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Celda derecha: ángulo de pointing ───────────────────────────────────
    {
      const x0 = cellW;

      ctx.fillStyle = '#111122';
      ctx.fillRect(x0 + 2, 2, cellW - 4, H - 4);

      ctx.fillStyle = '#777';
      ctx.font      = '10px monospace';
      ctx.fillText('ÁNGULO POINTING', x0 + PAD, PAD + 10);

      const lastAngle = aHistory.length > 0 ? aHistory[aHistory.length - 1] : null;
      ctx.fillStyle = '#9ab4f5';
      ctx.font      = 'bold 12px monospace';
      ctx.fillText(lastAngle !== null ? `${lastAngle.toFixed(1)}°` : '---', x0 + PAD, PAD + 25);

      // Distribución de modos como mini barras
      const modePcts  = metrics.modePcts;
      const modeOrder = ['full', 'partial', 'fallback', 'lost'];
      const modeColors = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#444' };
      const barY  = PAD + 32;
      const barW  = cellW - PAD * 2;
      let   bx    = x0 + PAD;
      modeOrder.forEach(m => {
        const w = (modePcts[m] ?? 0) * barW;
        if (w > 0) {
          ctx.fillStyle = modeColors[m];
          ctx.fillRect(bx, barY, w, 8);
          bx += w;
        }
      });
      ctx.fillStyle = '#444';
      ctx.font = '10px monospace';
      ctx.fillText('modos →', x0 + PAD, barY + 20);

      if (aHistory.length >= 2) {
        const chartX = x0 + PAD;
        const chartY = 55;
        const chartW = cellW - PAD * 2;
        const chartH = H - 65;

        // Normalizar ángulos al rango visible
        const minA = Math.min(...aHistory);
        const maxA = Math.max(...aHistory);
        const rangeA = Math.max(maxA - minA, 10);

        // Línea central (cero grados)
        const zeroY = chartY + chartH - ((0 - minA) / rangeA) * chartH;
        if (zeroY >= chartY && zeroY <= chartY + chartH) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(chartX, zeroY);
          ctx.lineTo(chartX + chartW, zeroY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = '#9ab4f5';
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        aHistory.forEach((v, i) => {
          const px = chartX + (i / (aHistory.length - 1)) * chartW;
          const py = chartY + chartH - ((v - minA) / rangeA) * chartH;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // Separador
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cellW, 0);
    ctx.lineTo(cellW, H);
    ctx.stroke();
  }
}
