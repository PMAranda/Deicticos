import { CameraModule }       from '../src/modules/homografia/camera.js';
import { PoseEstimator }      from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }      from '../src/modules/estimacion_corporal/hands.js';
import { LandmarkRenderer }   from '../src/modules/estimacion_corporal/renderer.js';
import { StabilityTracker, FPSTracker } from '../src/modules/estimacion_corporal/stability.js';
import { SessionLogger }      from '../src/modules/estimacion_corporal/logger.js';
import { compareSourceLandmarks } from '../src/modules/estimacion_corporal/comparador.js';
import {
  extractDeicticLandmarks,
  STABILITY_KEYS,
  SOURCE_LABEL,
} from '../src/modules/estimacion_corporal/landmarks.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const SPARKLINE_H = 140;

// Condición experimental por defecto
const DEFAULT_CONDITION = {
  distance:  '1.5',   // metros
  lighting:  'normal',
  movement:  'lento',
  occlusion: 'ninguna',
};

// ─────────────────────────────────────────────────────────────────────────────

class Fase2App {
  constructor() {
    // ── DOM ──────────────────────────────────────────────────────────────────
    this.video          = document.getElementById('video');
    this.canvas         = document.getElementById('canvas');
    this.sparkCanvas    = document.getElementById('sparklines');
    this.statusEl       = document.getElementById('status');
    this.badgeEl        = document.getElementById('trackingBadge');
    this.fpsBadgeEl     = document.getElementById('fpsBadge');
    this.recordBtn      = document.getElementById('recordBtn');
    this.exportBtn      = document.getElementById('exportBtn');
    this.sessionCountEl = document.getElementById('sessionCount');
    this.statsBodyEl    = document.getElementById('statsBody');
    this.compBodyEl     = document.getElementById('compBody');
    this.sessionLogEl   = document.getElementById('sessionLog');

    this.ctx       = this.canvas.getContext('2d');
    this.sparkCtx  = this.sparkCanvas.getContext('2d');

    // ── Módulos ──────────────────────────────────────────────────────────────
    this.camera    = new CameraModule(this.video);
    this.pose      = new PoseEstimator();
    this.hands     = new HandEstimator();
    this.renderer  = new LandmarkRenderer();
    this.stability = new StabilityTracker(30);
    this.fpsTracker = new FPSTracker(60);
    this.logger    = new SessionLogger();

    // ── Estado ───────────────────────────────────────────────────────────────
    this.condition    = { ...DEFAULT_CONDITION };
    this._poseResult  = null;
    this._handsResult = null;

    this._bindConditionButtons();
    this._bindSessionButtons();
  }

  // ── Inicialización ────────────────────────────────────────────────────────

  async start() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await Promise.all([
        this.camera.start(),
        this.pose.init().then(() => this.hands.init()),
      ]);
    } catch (err) {
      this._setStatus(`Error: ${err.message}`, true);
      return;
    }

    this.canvas.width       = this.camera.width;
    this.canvas.height      = this.camera.height;
    this.sparkCanvas.width  = this.camera.width;
    this.sparkCanvas.height = SPARKLINE_H;

    this._setStatus('Tracking activo');
    this._loop();
  }

  // ── Loop de renderizado ───────────────────────────────────────────────────

  _loop() {
    requestAnimationFrame(() => this._loop());
    this.fpsTracker.tick();
    const now = performance.now();

    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    if (this.pose.isReady)  this._poseResult  = this.pose.detect(this.video, now);
    if (this.hands.isReady) this._handsResult = this.hands.detect(this.video, now);

    const { pose, hands } = extractDeicticLandmarks(this._poseResult, this._handsResult);
    const comparisons     = compareSourceLandmarks(pose, hands);
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Actualizar tracker — pasar null si un landmark no se detecta
    STABILITY_KEYS.forEach(({ key, idx }) => {
      const lm = pose?.[idx] ?? null;
      this.stability.update(key, lm);
    });

    const allMetrics = this.stability.getAllMetrics();

    // Grabación de sesión
    if (this.logger.isRecording) {
      this.logger.recordFrame(allMetrics, comparisons, this.fpsTracker.fps);
    }

    // ── Dibujo sobre canvas principal ─────────────────────────────────────
    this.renderer.drawArmSkeleton(this.ctx, pose, W, H);
    if (hands.Left)  this.renderer.drawHandLandmarks(this.ctx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.renderer.drawHandLandmarks(this.ctx, hands.Right, 'Right', W, H);
    this.renderer.drawStabilityRings(this.ctx, pose, this.stability, W, H);
    this.renderer.drawStabilityPanel(this.ctx, allMetrics);
    this.renderer.drawComparisonLines(this.ctx, comparisons, W, H);
    this.renderer.drawFPS(this.ctx, this.fpsTracker.fps, W);

    // ── Sparklines ────────────────────────────────────────────────────────
    this.renderer.drawSparklines(this.sparkCtx, this.stability, this.sparkCanvas.width, SPARKLINE_H);

    // ── UI ────────────────────────────────────────────────────────────────
    this._updateBadge(pose, hands);
    this._updateFpsBadge();
    this._updateStatsTable(allMetrics);
    this._updateComparisonTable(comparisons);
  }

  _updateFpsBadge() {
    if (!this.fpsBadgeEl) return;
    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className   = `fps-badge ${fps >= 25 ? 'good' : fps >= 15 ? 'warn' : 'bad'}`;
  }

  // ── Condición experimental ────────────────────────────────────────────────

  _bindConditionButtons() {
    // Input numérico de distancia
    const distInput = document.getElementById('distanceInput');
    if (distInput) {
      this.condition.distance = distInput.value;
      distInput.addEventListener('input', () => {
        this.condition.distance = distInput.value;
      });
    }

    // Botones de tipo tag para el resto de condiciones
    document.querySelectorAll('.tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        const value = btn.dataset.value;
        this.condition[group] = value;
        document.querySelectorAll(`.tag[data-group="${group}"]`)
          .forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  // ── Sesiones ──────────────────────────────────────────────────────────────

  _bindSessionButtons() {
    this.recordBtn.addEventListener('click', () => {
      if (this.logger.isRecording) {
        const summary = this.logger.stopSession();
        this.recordBtn.textContent  = '● Iniciar sesión';
        this.recordBtn.classList.remove('recording');
        this._appendSessionToLog(summary);
        this._updateSessionCount();
        this.exportBtn.disabled = false;
      } else {
        this.logger.startSession({ ...this.condition });
        this.recordBtn.textContent = '■ Detener sesión';
        this.recordBtn.classList.add('recording');
      }
    });

    this.exportBtn.addEventListener('click', () => {
      const csv  = this.logger.exportCSV();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `deicticos_sesiones_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ── Actualización de UI ───────────────────────────────────────────────────

  _updateBadge(pose, hands) {
    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');
    this.badgeEl.textContent = parts.length
      ? `Detectando: ${parts.join(' · ')}`
      : 'Sin detección';
    this.badgeEl.className = `tracking-badge ${parts.length ? 'active' : 'inactive'}`;
  }

  _updateStatsTable(allMetrics) {
    if (!this.statsBodyEl) return;

    // Construir lookup source por clave
    const sourceMap = Object.fromEntries(STABILITY_KEYS.map(({ key, source }) => [key, source]));

    const rows = Object.entries(allMetrics).map(([key, m]) => {
      const dot        = `<span class="level-dot" style="background:${this._levelColor(m.level)}"></span>`;
      const sourceStr  = SOURCE_LABEL[sourceMap[key] ?? 'pose'];
      const lossColor  = m.trackingLoss > 20 ? '#FF4D4D' : m.trackingLoss > 5 ? '#FFD700' : '#4DFF88';
      const lossStr    = `<span style="color:${lossColor}">${m.trackingLoss.toFixed(1)}%</span>`;
      const sourceBadge = sourceMap[key] === 'both'
        ? `<span class="source-badge both">${sourceStr}</span>`
        : `<span class="source-badge pose">${sourceStr}</span>`;
      return `<tr>
        <td>${key}</td>
        <td>${sourceBadge}</td>
        <td>${(m.jitter * 1000).toFixed(2)}</td>
        <td>${(m.meanVisibility * 100).toFixed(0)}%</td>
        <td>${lossStr}</td>
        <td>${m.continuity}</td>
        <td>${dot} ${m.level}</td>
      </tr>`;
    });
    this.statsBodyEl.innerHTML = rows.join('');
  }

  _updateComparisonTable(comparisons) {
    if (!this.compBodyEl) return;
    const rows = comparisons.map(c => {
      const hasBoth = c.posePt && c.handPt;
      const distStr = hasBoth ? `${(c.distance * 1000).toFixed(1)}‰` : '—';
      const levelStr = c.level
        ? `<span class="level-dot" style="background:${this._divColor(c.level)}"></span> ${c.level}`
        : '—';
      const poseStr  = c.posePt  ? '✓' : '—';
      const handsStr = c.handPt  ? '✓' : '—';
      return `<tr>
        <td>${c.label}</td>
        <td class="center">${poseStr}</td>
        <td class="center">${handsStr}</td>
        <td>${distStr}</td>
        <td>${levelStr}</td>
      </tr>`;
    });
    this.compBodyEl.innerHTML = rows.join('');
  }

  _appendSessionToLog(summary) {
    if (!this.sessionLogEl || !summary) return;
    const c    = summary.condition;
    const div  = document.createElement('div');
    div.className = 'session-entry';

    const bestLandmark = Object.entries(summary.avgStability)
      .sort((a, b) => a[1].avgJitter - b[1].avgJitter)[0];
    const best = bestLandmark
      ? `${bestLandmark[0]}: ${(bestLandmark[1].avgJitter * 1000).toFixed(2)}‰`
      : '—';

    div.innerHTML = `
      <div class="session-header">
        Sesión #${this.logger.sessionCount}
        <span class="session-tags">
          ${c.distance} · ${c.lighting} · ${c.movement} · ${c.occlusion}
        </span>
      </div>
      <div class="session-detail">
        ${summary.frameCount} frames · ${summary.durationMs}ms ·
        FPS medio: <strong>${summary.avgFps.toFixed(1)}</strong> ·
        Landmark más estable: <strong>${best}</strong>
      </div>
    `;
    this.sessionLogEl.prepend(div);
  }

  _updateSessionCount() {
    if (this.sessionCountEl) {
      this.sessionCountEl.textContent = `${this.logger.sessionCount} sesión${this.logger.sessionCount !== 1 ? 'es' : ''}`;
    }
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }

  _levelColor(level) {
    return { stable: '#4DFF88', moderate: '#FFD700', unstable: '#FF4D4D' }[level] ?? '#888';
  }

  _divColor(level) {
    return { similar: '#4DFF88', moderate: '#FFD700', divergent: '#FF4D4D' }[level] ?? '#888';
  }
}

// ── Punto de entrada ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  new Fase2App().start();
});
