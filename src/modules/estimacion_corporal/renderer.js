import {
  ARM_CHAIN_LEFT, ARM_CHAIN_RIGHT,
  INDEX_CHAIN, HAND_IDX,
  STABILITY_KEYS,
} from './landmarks.js';
import { LEVEL_COLOR } from './stability.js';

// ─────────────────────────────────────────────────────────────────────────────

export class LandmarkRenderer {

  // ── Esqueleto del brazo ─────────────────────────────────────────────────────

  /**
   * Dibuja las cadenas hombro→codo→muñeca de ambos brazos.
   * @param {CanvasRenderingContext2D} ctx
   * @param {NormalizedLandmark[] | null} poseLandmarks
   */
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

  /**
   * Dibuja los landmarks de una mano resaltando la cadena del dedo índice.
   * @param {CanvasRenderingContext2D} ctx
   * @param {NormalizedLandmark[]} handLandmarks
   * @param {'Left' | 'Right'} side
   */
  drawHandLandmarks(ctx, handLandmarks, side, W, H) {
    if (!handLandmarks) return;

    const jointColor = side === 'Right'
      ? 'rgba(255, 100, 100, 0.85)'
      : 'rgba(77, 159, 255, 0.85)';
    const indexColor = '#FFD700';

    ctx.save();

    // Cadena del índice
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

    // Todos los landmarks
    handLandmarks.forEach((lm, i) => {
      const isIndex = INDEX_CHAIN.includes(i);
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, isIndex ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isIndex ? indexColor : jointColor;
      ctx.fill();
    });

    // Etiqueta en la punta del índice
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

  /**
   * Dibuja un anillo coloreado sobre cada landmark monitorizado indicando
   * su nivel de estabilidad: verde (estable) · amarillo (moderado) · rojo (inestable).
   */
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

  // ── Panel de estabilidad ────────────────────────────────────────────────────

  /**
   * Dibuja el panel de métricas de jitter y visibilidad en la esquina
   * superior-izquierda del canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} allMetrics - resultado de stabilityTracker.getAllMetrics()
   */
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
      const y     = 10 + PAD + 26 + i * LINE;
      const color = LEVEL_COLOR[m.level];

      ctx.beginPath();
      ctx.arc(10 + PAD + 5, y - 3, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      const jStr = (m.jitter * 1000).toFixed(1).padStart(5);
      const vStr = (m.meanVisibility * 100).toFixed(0).padStart(3) + '%';
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${key.padEnd(11)} ${jStr}  ${vStr}`, 10 + PAD + 13, y);
    });

    ctx.restore();
  }
}
