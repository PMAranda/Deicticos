import {
  ARM_CHAIN_LEFT, ARM_CHAIN_RIGHT,
  INDEX_CHAIN, HAND_IDX,
  STABILITY_KEYS,
} from './landmarks.js';
import { LEVEL_COLOR, JITTER_THRESHOLDS } from './stability.js';
import { DIVERGENCE_COLOR } from './comparador.js';

// ─────────────────────────────────────────────────────────────────────────────

export class LandmarkRenderer {

  // ── Esqueleto del brazo ─────────────────────────────────────────────────────

  drawArmSkeleton(ctx, poseLandmarks, W, H) {
    if (!poseLandmarks) return;
    this._drawChain(ctx, poseLandmarks, ARM_CHAIN_LEFT,  W, H, 'rgba(77, 159, 255, 0.9)');
    this._drawChain(ctx, poseLandmarks, ARM_CHAIN_RIGHT, W, H, 'rgba(255, 100, 100, 0.9)');
  }

  _drawChain(ctx, lmks, chain, W, H, color) {
    const pts = chain.map(i => ({
      x: lmks[i].x * W,
      y: lmks[i].y * H,
      v: lmks[i].visibility ?? 1,
    }));

    const minVis = Math.min(...pts.map(p => p.v));
    if (minVis < 0.1) return;

    ctx.save();
    ctx.globalAlpha = Math.max(0.3, minVis);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 3;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();

    pts.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });
    ctx.restore();
  }

  // ── Landmarks de mano ───────────────────────────────────────────────────────

  drawHandLandmarks(ctx, handLandmarks, side, W, H) {
    if (!handLandmarks) return;

    const jointColor = side === 'Right'
      ? 'rgba(255, 100, 100, 0.85)'
      : 'rgba(77, 159, 255, 0.85)';
    const indexColor = '#FFD700';

    ctx.save();

    const idxPts = INDEX_CHAIN.map(i => ({
      x: handLandmarks[i].x * W,
      y: handLandmarks[i].y * H,
    }));
    ctx.strokeStyle = indexColor;
    ctx.lineWidth   = 3;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(idxPts[0].x, idxPts[0].y);
    idxPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();

    handLandmarks.forEach((lm, i) => {
      const isIndex = INDEX_CHAIN.includes(i);
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, isIndex ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isIndex ? indexColor : jointColor;
      ctx.fill();
    });

    const tip = handLandmarks[HAND_IDX.INDEX_TIP];
    ctx.fillStyle   = '#fff';
    ctx.font        = 'bold 11px system-ui';
    ctx.shadowColor = '#000';
    ctx.shadowBlur  = 3;
    ctx.fillText(`TIP ${side[0]}`, tip.x * W + 8, tip.y * H - 5);
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  // ── Anillos de estabilidad ──────────────────────────────────────────────────

  drawStabilityRings(ctx, poseLandmarks, stabilityTracker, W, H) {
    if (!poseLandmarks) return;
    STABILITY_KEYS.forEach(({ key, idx }) => {
      const lm      = poseLandmarks[idx];
      const metrics = stabilityTracker.getMetrics(key);
      if (!lm || metrics.sampleCount === 0) return;

      ctx.save();
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, 11, 0, Math.PI * 2);
      ctx.strokeStyle = LEVEL_COLOR[metrics.level];
      ctx.lineWidth   = 2.5;
      ctx.stroke();
      ctx.restore();
    });
  }

  // ── Badge de FPS ────────────────────────────────────────────────────────────

  /**
   * Dibuja el FPS actual en la esquina superior derecha del canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} fps
   * @param {number} canvasW
   */
  drawFPS(ctx, fps, canvasW) {
    const text = `${fps.toFixed(1)} FPS`;
    const PAD  = 8;

    ctx.save();
    ctx.font = 'bold 12px monospace';
    const tw = ctx.measureText(text).width;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.60)';
    ctx.beginPath();
    ctx.roundRect(canvasW - tw - PAD * 2 - 10, 10, tw + PAD * 2, 24, 4);
    ctx.fill();

    ctx.fillStyle = fps >= 25 ? '#4DFF88' : fps >= 15 ? '#FFD700' : '#FF4D4D';
    ctx.fillText(text, canvasW - tw - PAD - 10, 27);
    ctx.restore();
  }

  // ── Panel de estabilidad (overlay sobre el canvas principal) ────────────────

  drawStabilityPanel(ctx, allMetrics) {
    const entries = Object.entries(allMetrics);
    if (entries.length === 0) return;

    const PAD   = 10;
    const LINE  = 17;
    const W_BOX = 230;
    const H_BOX = entries.length * LINE + PAD * 2 + 22;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.beginPath();
    ctx.roundRect(10, 10, W_BOX, H_BOX, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font      = 'bold 11px monospace';
    ctx.fillText('ESTABILIDAD  jitter(‰)  vis', 10 + PAD, 10 + PAD + 12);

    ctx.font = '11px monospace';
    entries.forEach(([key, m], i) => {
      const y = 10 + PAD + 26 + i * LINE;
      ctx.beginPath();
      ctx.arc(10 + PAD + 5, y - 3, 4, 0, Math.PI * 2);
      ctx.fillStyle = LEVEL_COLOR[m.level];
      ctx.fill();

      const jStr = (m.jitter * 1000).toFixed(1).padStart(5);
      const vStr = (m.meanVisibility * 100).toFixed(0).padStart(3) + '%';
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${key.padEnd(11)} ${jStr}  ${vStr}`, 10 + PAD + 13, y);
    });
    ctx.restore();
  }

  // ── Líneas de comparación Pose vs Hands ─────────────────────────────────────

  /**
   * Dibuja líneas discontinuas entre el landmark estimado por Pose y por Hands
   * para cada par anatómico. El color refleja la divergencia.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} comparisons - resultado de compareSourceLandmarks()
   */
  drawComparisonLines(ctx, comparisons, W, H) {
    comparisons.forEach(({ posePt, handPt, level }) => {
      if (!posePt || !handPt || !level) return;

      const px = posePt.x * W, py = posePt.y * H;
      const hx = handPt.x  * W, hy = handPt.y  * H;
      const color = DIVERGENCE_COLOR[level] ?? '#ffffff';

      ctx.save();
      ctx.strokeStyle  = color;
      ctx.lineWidth    = 2;
      ctx.globalAlpha  = 0.75;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Punto Pose (azul oscuro) y punto Hands (naranja)
      [[px, py, '#8899ff'], [hx, hy, '#ffaa44']].forEach(([x, y, c]) => {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle   = c;
        ctx.globalAlpha = 0.9;
        ctx.fill();
      });
      ctx.restore();
    });
  }

  // ── Sparklines (canvas separado) ────────────────────────────────────────────

  /**
   * Dibuja el historial de jitter de los 6 landmarks en un canvas de 3×2 celdas.
   * @param {CanvasRenderingContext2D} ctx  - contexto del canvas de sparklines
   * @param {StabilityTracker}         stabilityTracker
   * @param {number} W  - ancho del canvas de sparklines
   * @param {number} H  - alto del canvas de sparklines
   */
  drawSparklines(ctx, stabilityTracker, W, H) {
    const KEYS = ['L_SHOULDER', 'R_SHOULDER', 'L_ELBOW', 'R_ELBOW', 'L_WRIST', 'R_WRIST'];
    const COLS = 3, ROWS = 2;
    const cellW = W / COLS;
    const cellH = H / ROWS;
    const PAD   = 8;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    KEYS.forEach((key, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x0  = col * cellW;
      const y0  = row * cellH;

      const history = stabilityTracker.getJitterHistory(key);
      const metrics = stabilityTracker.getMetrics(key);
      const color   = LEVEL_COLOR[metrics.level] ?? '#666';

      // Fondo de celda
      ctx.fillStyle = '#111122';
      ctx.fillRect(x0 + 2, y0 + 2, cellW - 4, cellH - 4);

      // Nombre del landmark
      ctx.fillStyle = '#777';
      ctx.font      = '10px monospace';
      ctx.fillText(key, x0 + PAD, y0 + PAD + 10);

      // Valor actual de jitter
      ctx.fillStyle = color;
      ctx.font      = 'bold 12px monospace';
      ctx.fillText(
        metrics.sampleCount > 0 ? `${(metrics.jitter * 1000).toFixed(1)}‰` : '---',
        x0 + PAD, y0 + PAD + 25
      );

      // Continuidad y tracking loss
      ctx.fillStyle = '#555';
      ctx.font      = '10px monospace';
      const lossColor = metrics.trackingLoss > 20 ? '#FF4D4D'
                      : metrics.trackingLoss > 5  ? '#FFD700' : '#555';
      ctx.fillStyle = lossColor;
      ctx.fillText(`lost: ${metrics.trackingLoss.toFixed(0)}%`, x0 + cellW - PAD - 62, y0 + PAD + 10);
      ctx.fillStyle = '#555';
      ctx.fillText(`cont: ${metrics.continuity}f`,              x0 + cellW - PAD - 62, y0 + PAD + 22);

      if (history.length < 2) return;

      const chartX = x0 + PAD;
      const chartY = y0 + 36;
      const chartW = cellW - PAD * 2;
      const chartH = cellH - 46;
      const maxJ   = Math.max(...history, JITTER_THRESHOLDS.HIGH * 1.5);

      // Líneas umbral
      [
        [JITTER_THRESHOLDS.LOW,  'rgba(77,255,136,0.3)'],
        [JITTER_THRESHOLDS.HIGH, 'rgba(255,77,77,0.3)'],
      ].forEach(([thresh, tc]) => {
        const ty = chartY + chartH - (thresh / maxJ) * chartH;
        ctx.save();
        ctx.strokeStyle = tc;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(chartX, ty); ctx.lineTo(chartX + chartW, ty); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });

      // Sparkline
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      history.forEach((v, j) => {
        const px = chartX + (j / (history.length - 1)) * chartW;
        const py = chartY + chartH - Math.min(1, v / maxJ) * chartH;
        j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    });

    // Líneas de rejilla entre celdas
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth   = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * cellW, 0); ctx.lineTo(c * cellW, H); ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * cellH); ctx.lineTo(W, r * cellH); ctx.stroke();
    }
  }
}
