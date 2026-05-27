import { CameraModule }     from '../src/modules/homografia/camera.js';
import { PoseEstimator }    from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }    from '../src/modules/estimacion_corporal/hands.js';
import { LandmarkRenderer } from '../src/modules/estimacion_corporal/renderer.js';
import { FPSTracker }       from '../src/modules/estimacion_corporal/stability.js';
import { extractDeicticLandmarks } from '../src/modules/estimacion_corporal/landmarks.js';
import { PointingEstimator }      from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }       from '../src/modules/heuristica/renderer.js';
import { AngularTracker }         from '../src/modules/heuristica/metricas.js';
import { PointingSessionLogger }  from '../src/modules/heuristica/logger.js';

const SPARKLINE_H = 120;

const BASE_WEIGHTS = {
  shoulderElbow: 0.35,
  shoulderWrist: 0.15,
  elbowWrist:    0.35,
  wristIndex:    0.15,
};

const DEFAULT_CONDITION = {
  heuristic: 'config_base',
  distance:  '1.5',
  movement:  'lento',
  occlusion: 'ninguna',
};

class Fase3App {
  constructor() {
    // ── DOM ──────────────────────────────────────────────────────────────────
    this.video         = document.getElementById('video');
    this.canvas        = document.getElementById('canvas');
    this.sparkCanvas   = document.getElementById('sparklines');
    this.statusEl      = document.getElementById('status');
    this.badgeEl       = document.getElementById('trackingBadge');
    this.fpsBadgeEl    = document.getElementById('fpsBadge');
    this.modeBadgeEl   = document.getElementById('modeBadge');
    this.metricsBodyEl = document.getElementById('metricsBody');
    this.weightsBodyEl = document.getElementById('weightsBody');
    this.recordBtn     = document.getElementById('recordBtn');
    this.exportBtn     = document.getElementById('exportBtn');
    this.sessionCountEl = document.getElementById('sessionCount');
    this.sessionLogEl  = document.getElementById('sessionLog');

    this.ctx       = this.canvas.getContext('2d');
    this.sparkCtx  = this.sparkCanvas.getContext('2d');

    // ── Módulos ──────────────────────────────────────────────────────────────
    this.camera       = new CameraModule(this.video);
    this.pose         = new PoseEstimator();
    this.hands        = new HandEstimator();
    this.bodyRenderer = new LandmarkRenderer();
    this.pointingEst  = new PointingEstimator();
    this.pointingRdr  = new PointingRenderer();
    this.angTracker   = new AngularTracker(30);
    this.fpsTracker   = new FPSTracker(60);
    this.logger       = new PointingSessionLogger();

    // ── Estado ───────────────────────────────────────────────────────────────
    this.condition    = { ...DEFAULT_CONDITION };
    this._side        = 'auto';
    this._showVectors = true;
    this._showAngle   = true;
    this._poseResult  = null;
    this._handsResult = null;

    this._bindConditionControls();
    this._bindVisualizationControls();
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

    this.canvas.width        = this.camera.width;
    this.canvas.height       = this.camera.height;
    this.sparkCanvas.width   = this.camera.width;
    this.sparkCanvas.height  = SPARKLINE_H;

    this._setStatus('Tracking activo');
    this._loop();
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  _loop() {
    requestAnimationFrame(() => this._loop());
    this.fpsTracker.tick();
    const now = performance.now();

    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    if (this.pose.isReady)  this._poseResult  = this.pose.detect(this.video, now);
    if (this.hands.isReady) this._handsResult = this.hands.detect(this.video, now);

    const { pose, hands } = extractDeicticLandmarks(this._poseResult, this._handsResult);
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Heurística
    const result = this.pointingEst.estimate(pose, hands, this._side);
    this.angTracker.update(result);

    // Grabación
    if (this.logger.isRecording) {
      this.logger.recordFrame(result, this.angTracker.getMetrics(), this.fpsTracker.fps);
    }

    // Dibujo
    this.bodyRenderer.drawArmSkeleton(this.ctx, pose, W, H);
    if (hands.Left)  this.bodyRenderer.drawHandLandmarks(this.ctx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.bodyRenderer.drawHandLandmarks(this.ctx, hands.Right, 'Right', W, H);
    this.bodyRenderer.drawFPS(this.ctx, this.fpsTracker.fps, W);

    if (this._showVectors) this.pointingRdr.drawComponentVectors(this.ctx, result, W, H);
    if (this._showAngle)   this.pointingRdr.drawExtensionAngle(this.ctx, result.armData, result.extensionAngle, W, H);
    this.pointingRdr.drawPointingRay(this.ctx, result, W, H);
    this.pointingRdr.drawStatusPanel(this.ctx, result, W);

    // Sparklines
    this.pointingRdr.drawAngularSparklines(this.sparkCtx, this.angTracker, this.sparkCanvas.width, SPARKLINE_H);

    // UI
    this._updateBadge(pose, hands);
    this._updateFpsBadge();
    this._updateModeBadge(result);
    this._updateMetricsTable(result);
    this._updateWeightsTable(result);
  }

  // ── Controles de condición ────────────────────────────────────────────────

  _bindConditionControls() {
    const nameInput = document.getElementById('heuristicName');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        this.condition.heuristic = nameInput.value.trim() || 'config_base';
      });
    }

    const distInput = document.getElementById('distanceInput');
    if (distInput) {
      this.condition.distance = distInput.value;
      distInput.addEventListener('input', () => {
        this.condition.distance = distInput.value;
      });
    }

    document.querySelectorAll('.tag[data-group]').forEach(btn => {
      const g = btn.dataset.group;
      if (g === 'side') return;   // se gestiona en _bindVisualizationControls
      btn.addEventListener('click', () => {
        this.condition[g] = btn.dataset.value;
        document.querySelectorAll(`.tag[data-group="${g}"]`)
          .forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  _bindVisualizationControls() {
    document.querySelectorAll('.tag[data-group="side"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._side = btn.dataset.value;
        this.pointingEst.reset();
        document.querySelectorAll('.tag[data-group="side"]')
          .forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    const toggleVectors = document.getElementById('toggleVectors');
    if (toggleVectors) {
      toggleVectors.addEventListener('click', () => {
        this._showVectors = !this._showVectors;
        toggleVectors.textContent = this._showVectors ? 'Mostrar' : 'Ocultar';
        toggleVectors.classList.toggle('active', this._showVectors);
      });
    }

    const toggleAngle = document.getElementById('toggleAngle');
    if (toggleAngle) {
      toggleAngle.addEventListener('click', () => {
        this._showAngle = !this._showAngle;
        toggleAngle.textContent = this._showAngle ? 'Mostrar' : 'Ocultar';
        toggleAngle.classList.toggle('active', this._showAngle);
      });
    }
  }

  // ── Sesiones ──────────────────────────────────────────────────────────────

  _bindSessionButtons() {
    this.recordBtn.addEventListener('click', () => {
      if (this.logger.isRecording) {
        const summary = this.logger.stopSession();
        this.recordBtn.textContent = '● Iniciar sesión';
        this.recordBtn.classList.remove('recording');
        this._appendSessionToLog(summary);
        this._updateSessionCount();
        this.exportBtn.disabled = false;
        // Limpiar tracker al terminar sesión para la siguiente
        this.angTracker.clear();
        this.pointingEst.reset();
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
      a.download = `deicticos_pointing_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  _appendSessionToLog(summary) {
    if (!this.sessionLogEl || !summary) return;
    const c   = summary.condition;
    const div = document.createElement('div');
    div.className = 'session-entry';

    const levelColors = { stable: '#4DFF88', moderate: '#FFD700', unstable: '#FF4D4D' };
    const lc = levelColors[summary.level] ?? '#aaa';

    div.innerHTML = `
      <div class="session-header">
        Sesión #${this.logger.sessionCount}
        <span class="session-tags">${c.heuristic} · ${c.distance}m · ${c.movement} · ${c.occlusion}</span>
      </div>
      <div class="session-detail">
        ${summary.frameCount} frames · ${summary.durationMs}ms ·
        FPS: <strong>${summary.avgFps.toFixed(1)}</strong> ·
        Jitter ang: <strong style="color:${lc}">${summary.avgJitter.toFixed(2)}°/f (${summary.level})</strong> ·
        Detección: <strong>${summary.detectionRate.toFixed(1)}%</strong> ·
        Fallback: <strong>${summary.fallbackRate.toFixed(1)}%</strong> ·
        Cont. máx: <strong>${summary.maxContinuity}f</strong>
      </div>
      <div class="mode-pills">
        ${Object.entries(summary.modePcts)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `<span class="mode-pill ${k}">${k} ${v.toFixed(1)}%</span>`)
          .join('')}
      </div>`;

    this.sessionLogEl.prepend(div);
  }

  _updateSessionCount() {
    if (this.sessionCountEl) {
      const n = this.logger.sessionCount;
      this.sessionCountEl.textContent = `${n} sesión${n !== 1 ? 'es' : ''}`;
    }
  }

  // ── Actualización de UI ───────────────────────────────────────────────────

  _updateBadge(pose, hands) {
    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');
    this.badgeEl.textContent = parts.length ? `Detectando: ${parts.join(' · ')}` : 'Sin detección';
    this.badgeEl.className = `tracking-badge ${parts.length ? 'active' : 'inactive'}`;
  }

  _updateFpsBadge() {
    if (!this.fpsBadgeEl) return;
    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className   = `fps-badge ${fps >= 25 ? 'good' : fps >= 15 ? 'warn' : 'bad'}`;
  }

  _updateModeBadge(result) {
    if (!this.modeBadgeEl) return;
    const mode = result.isGesture ? (result.mode ?? 'lost') : 'lost';
    this.modeBadgeEl.textContent = mode.toUpperCase();
    this.modeBadgeEl.className   = `mode-badge ${mode}`;
  }

  _updateMetricsTable(result) {
    if (!this.metricsBodyEl) return;
    const { isGesture, mode, confidence, extensionAngle, side, reason, vector } = result;
    const am = this.angTracker.getMetrics();

    const modeColor   = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#FF4D4D' };
    const confColor   = (confidence ?? 0) > 0.7 ? '#4DFF88' : (confidence ?? 0) > 0.4 ? '#FFD700' : '#FF4D4D';
    const jitterColor = am.level === 'stable' ? '#4DFF88' : am.level === 'moderate' ? '#FFD700' : '#FF4D4D';
    const contColor   = am.continuity > 15 ? '#4DFF88' : am.continuity > 5 ? '#FFD700' : '#888';

    const rows = [
      ['Brazo activo',    side ?? '—',                           '#aaa',              'Brazo seleccionado para la heurística'],
      ['Gesto detectado', isGesture ? 'SÍ' : 'NO',              isGesture ? '#4DFF88' : '#FF4D4D', 'Validación del gesto deíctico'],
      ['Modo',            mode ?? '—',                           modeColor[mode] ?? '#aaa', 'Nivel de información disponible'],
      ['Confianza',       `${((confidence ?? 0)*100).toFixed(1)}%`, confColor,        'Basada en visibilidad y extensión'],
      ['Extensión',       `${extensionAngle?.toFixed(1) ?? '?'}°`,  '#ccc',           '0°=extendido, >90°=doblado'],
      ['Jitter angular',  `${am.jitter.toFixed(2)}°/f`,          jitterColor,         `Nivel: ${am.level}`],
      ['Continuidad',     `${am.continuity}f`,                   contColor,           'Frames consecutivos con gesto'],
      ['Detección',       `${(am.detectionRate*100).toFixed(1)}%`, '#ccc',            'Tasa de frames con gesto activo'],
      ['Fallback rate',   `${(am.fallbackRate*100).toFixed(1)}%`,  am.fallbackRate > 0.2 ? '#FF8C4D' : '#4DFF88', 'Frames en modo fallback'],
      ['Motivo',          reason ?? '—',                         reason === 'ok' ? '#4DFF88' : '#FF8C4D', 'Resultado de la validación'],
    ];

    this.metricsBodyEl.innerHTML = rows.map(([label, val, color, desc]) =>
      `<tr>
        <td>${label}</td>
        <td style="color:${color}">${val}</td>
        <td style="color:#555;font-size:0.77rem">${desc}</td>
      </tr>`
    ).join('');
  }

  _updateWeightsTable(result) {
    if (!this.weightsBodyEl) return;
    const activeWeights = result.weights ?? {};
    const WEIGHT_COLORS = {
      shoulderElbow: '#4D9FFF',
      shoulderWrist: '#88ccff',
      elbowWrist:    '#ff8888',
      wristIndex:    '#FFD700',
    };

    this.weightsBodyEl.innerHTML = Object.entries(BASE_WEIGHTS).map(([key, base]) => {
      const active    = activeWeights[key] ?? 0;
      const available = activeWeights[key] != null;
      const color     = WEIGHT_COLORS[key] ?? '#888';
      const pct       = (active * 100).toFixed(1);
      const bar = `<div class="weight-bar-bg">
                     <div class="weight-bar-fill" style="width:${pct}%;background:${color}"></div>
                   </div>`;
      return `<tr>
        <td>${key}</td>
        <td class="weight-bar-cell">${bar}<span style="color:${color};font-size:0.78rem">${pct}%</span></td>
        <td style="color:#555">${(base*100).toFixed(0)}%</td>
        <td style="color:${available ? '#4DFF88' : '#555'}">${available ? 'Sí' : 'No'}</td>
      </tr>`;
    }).join('');
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new Fase3App().start();
});
