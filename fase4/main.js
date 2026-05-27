import { CameraModule }     from '../src/modules/homografia/camera.js';
import { CalibrationModule } from '../src/modules/homografia/calibration.js';
import { HomographyModule }  from '../src/modules/homografia/homography.js';
import { CoordinateSystem }  from '../src/modules/homografia/coordinates.js';
import { PoseEstimator }     from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }     from '../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks } from '../src/modules/estimacion_corporal/landmarks.js';
import { LandmarkRenderer }  from '../src/modules/estimacion_corporal/renderer.js';
import { FPSTracker }        from '../src/modules/estimacion_corporal/stability.js';
import { PointingEstimator } from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }  from '../src/modules/heuristica/renderer.js';
import { AngularTracker }    from '../src/modules/heuristica/metricas.js';
import { BoardGrounding }    from '../src/modules/grounding/grounding.js';
import { GroundingRenderer } from '../src/modules/grounding/renderer.js';
import { ImpactTracker }     from '../src/modules/grounding/metricas.js';
import { GroundingSessionLogger } from '../src/modules/grounding/logger.js';

const RECT_W   = 640;
const RECT_H   = 480;
const BOARD_W  = 480;   // canvas de visualización del tablero
const BOARD_H  = 360;

const STATES = Object.freeze({
  LOADING:     'LOADING',
  READY:       'READY',
  CALIBRATING: 'CALIBRATING',
  ACTIVE:      'ACTIVE',
});

class Fase4App {
  constructor(cv) {
    this.cv = cv;

    // ── Elementos DOM ─────────────────────────────────────────────────────────
    this.video          = document.getElementById('video');
    this.rawCanvas      = document.getElementById('rawCanvas');
    this.boardCanvas    = document.getElementById('boardCanvas');
    this.rawCtx         = this.rawCanvas.getContext('2d');
    this.boardCtx       = this.boardCanvas.getContext('2d');

    this.statusEl           = document.getElementById('status');
    this.calibBadge         = document.getElementById('calibBadge');
    this.trackingBadge      = document.getElementById('trackingBadge');
    this.pointingBadge      = document.getElementById('pointingBadge');
    this.impactBadge        = document.getElementById('impactBadge');
    this.fpsBadgeEl         = document.getElementById('fpsBadge');
    this.groundingMetricsEl = document.getElementById('groundingMetrics');
    this.pointingMetricsEl  = document.getElementById('pointingMetrics');
    this.summarySection     = document.getElementById('summarySection');
    this.summaryBodyEl      = document.getElementById('summaryBody');

    this.calibrateBtn = document.getElementById('calibrateBtn');
    this.resetBtn     = document.getElementById('resetBtn');
    this.recordBtn    = document.getElementById('recordBtn');
    this.exportBtn    = document.getElementById('exportBtn');

    // ── Módulos ───────────────────────────────────────────────────────────────
    this.camera       = new CameraModule(this.video);
    this.calibration  = new CalibrationModule(this.rawCanvas);
    this.homography   = new HomographyModule(cv);
    this.coordSystem  = new CoordinateSystem(3, 3);

    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.fpsTracker  = new FPSTracker(60);
    this.pointingEst = new PointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.angTracker  = new AngularTracker(30);

    this.grounding    = new BoardGrounding(this.homography, this.coordSystem);
    this.groundRdr    = new GroundingRenderer();
    this.impactTrack  = new ImpactTracker(30);
    this.logger       = new GroundingSessionLogger();

    // ── Estado ────────────────────────────────────────────────────────────────
    this._state      = STATES.LOADING;
    this._loopId     = null;
    this._corners    = null;   // 4 esquinas calibradas (px rawCanvas)
    this._isRecording = false;

    this.boardCanvas.width  = BOARD_W;
    this.boardCanvas.height = BOARD_H;

    this._bindButtons();
  }

  // ── Inicialización ─────────────────────────────────────────────────────────

  async init() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await this.pose.init('VIDEO');
      await this.hands.init('VIDEO');
    } catch (err) {
      this._setStatus(`Error cargando modelos: ${err.message}`, true);
      return;
    }

    this._setStatus('Cargando cámara…');
    try {
      await this.camera.start();
    } catch (err) {
      this._setStatus(`Sin acceso a cámara: ${err.message}`, true);
      return;
    }

    this.rawCanvas.width  = this.camera.width;
    this.rawCanvas.height = this.camera.height;

    this._setState(STATES.READY);
    this._loop();
  }

  // ── Botones ────────────────────────────────────────────────────────────────

  _bindButtons() {
    this.calibrateBtn.addEventListener('click', () => this._startCalibration());
    this.resetBtn.addEventListener('click',     () => this._reset());
    this.recordBtn.addEventListener('click',    () => this._toggleRecording());
    this.exportBtn.addEventListener('click',    () => this._exportCSV());
  }

  _startCalibration() {
    this._setState(STATES.CALIBRATING);
    this.calibration.start(corners => {
      this._corners = corners;
      this.homography.compute(corners, RECT_W, RECT_H);
      this._setState(STATES.ACTIVE);
    });
  }

  _reset() {
    if (this._isRecording) this._stopRecording();
    this.calibration.reset();
    this.homography.dispose();
    this._corners = null;
    this.grounding.reset();
    this.groundRdr.clearTrail();
    this.impactTrack.clear();
    this.pointingEst.reset();
    this.angTracker.clear();
    this.summarySection.style.display = 'none';
    this._setState(STATES.READY);
  }

  _toggleRecording() {
    if (this._isRecording) {
      this._stopRecording();
    } else {
      this._startRecording();
    }
  }

  _startRecording() {
    this._isRecording = true;
    this.logger.startSession({ fase: 'fase4', ts: new Date().toISOString() });
    this.recordBtn.textContent = '■ Detener';
    this.recordBtn.classList.add('recording');
    this.exportBtn.disabled    = true;
    this.summarySection.style.display = 'none';
  }

  _stopRecording() {
    this._isRecording = false;
    const summary = this.logger.stopSession();
    this.recordBtn.textContent = '● Grabar';
    this.recordBtn.classList.remove('recording');
    this.exportBtn.disabled    = false;
    if (summary) this._showSummary(summary);
  }

  _exportCSV() {
    const csv  = this.logger.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `grounding_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Loop principal ─────────────────────────────────────────────────────────

  _loop() {
    this._loopId = requestAnimationFrame(() => this._loop());

    const W = this.rawCanvas.width;
    const H = this.rawCanvas.height;

    // Dibujar frame de cámara
    this.rawCtx.drawImage(this.video, 0, 0, W, H);

    // Calibración en curso: solo overlay
    if (this._state === STATES.CALIBRATING) {
      this.calibration.drawOverlay();
      const n = this.calibration.corners.length;
      const labels = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
      this._setStatus(`Calibrando: haz clic en esquina ${n + 1}/4 — ${labels[n] ?? ''}`);
      return;
    }

    if (this._state !== STATES.ACTIVE) return;

    // ── Detección Pose + Hands ────────────────────────────────────────────────
    if (!this.pose.isReady || !this.hands.isReady) return;

    this.fpsTracker.tick();
    const ts = performance.now();

    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    // ── Pointing (Fase 3) ─────────────────────────────────────────────────────
    const pointing = this.pointingEst.estimate(pose, hands, 'auto');
    this.angTracker.update(pointing);

    // ── Grounding (Fase 4) ────────────────────────────────────────────────────
    const gResult = this.grounding.project(pointing, W, H, this._corners);
    this.impactTrack.update(gResult);
    const impactMetrics = this.impactTrack.getMetrics();

    if (this._isRecording) {
      this.logger.recordFrame(gResult, impactMetrics, pointing, this.fpsTracker.fps);
    }

    // ── Render — vista cámara ─────────────────────────────────────────────────
    this.bodyRdr.drawArmSkeleton(this.rawCtx, pose, W, H);
    if (hands.Left)  this.bodyRdr.drawHandLandmarks(this.rawCtx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.bodyRdr.drawHandLandmarks(this.rawCtx, hands.Right, 'Right', W, H);
    this.pointingRdr.drawComponentVectors(this.rawCtx, pointing, W, H);
    this.pointingRdr.drawExtensionAngle(this.rawCtx, pointing.armData, pointing.extensionAngle, W, H);
    this.pointingRdr.drawPointingRay(this.rawCtx, pointing, W, H);
    this.calibration.drawOverlay();

    // Rayo extendido hasta el tablero (solo si hay impacto)
    if (gResult) {
      this.groundRdr.drawRayToBoard(this.rawCtx, pointing.origin, gResult.hitPx, W, H);
    }

    // ── Render — vista tablero ────────────────────────────────────────────────
    this.groundRdr.drawBoardImpact(this.boardCtx, gResult, this.coordSystem, BOARD_W, BOARD_H);
    this.groundRdr.drawStatusPanel(this.boardCtx, gResult, impactMetrics, BOARD_W);

    // ── Actualizar UI ─────────────────────────────────────────────────────────
    this._updateBadges(pose, hands, pointing, gResult);
    this._updateMetrics(pointing, gResult, impactMetrics);
  }

  // ── Actualización de UI ────────────────────────────────────────────────────

  _updateBadges(pose, hands, pointing, gResult) {
    const hasPose = pose !== null;
    const parts   = [];
    if (hasPose)      parts.push('Pose');
    if (hands.Left)   parts.push('Mano Izq');
    if (hands.Right)  parts.push('Mano Der');

    this.trackingBadge.textContent = parts.length ? parts.join(' · ') : 'Sin detección';
    this.trackingBadge.className   = `badge ${parts.length ? 'badge-active' : 'badge-off'}`;

    const hasGesture = pointing.isGesture;
    this.pointingBadge.textContent = hasGesture
      ? `Apunta (${(pointing.confidence * 100).toFixed(0)}%)`
      : 'Sin gesto';
    this.pointingBadge.className   = `badge ${hasGesture ? 'badge-ok' : 'badge-off'}`;

    this.impactBadge.textContent = gResult
      ? `Impacto: ${gResult.region.label}`
      : 'Sin impacto';
    this.impactBadge.className   = `badge ${gResult ? 'badge-ok' : 'badge-off'}`;

    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent  = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className    = `badge ${fps >= 25 ? 'badge-ok' : fps >= 15 ? 'badge-warn' : ''}`;
  }

  _updateMetrics(pointing, gResult, impactMetrics) {
    // Tabla de grounding
    const mc = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#555' };
    const jc = impactMetrics.level === 'stable'   ? '#4DFF88'
             : impactMetrics.level === 'moderate' ? '#FFD700' : '#FF4D4D';

    if (gResult) {
      const gRows = [
        ['Región',      gResult.region.label,                                  '#FFD700'],
        ['X normalizado', gResult.xn.toFixed(4),                               '#c0c0d0'],
        ['Y normalizado', gResult.yn.toFixed(4),                               '#c0c0d0'],
        ['X suavizado',   gResult.smoothed.x.toFixed(4),                       '#9ab4f5'],
        ['Y suavizado',   gResult.smoothed.y.toFixed(4),                       '#9ab4f5'],
        ['Dist. hombro',  `${Math.round(gResult.t)} px`,                       '#888'],
        ['Jitter impact', `${(impactMetrics.jitter * 1000).toFixed(1)} ×10⁻³`, jc],
        ['Cambios región', `${impactMetrics.regionChanges}`,                   '#aaa'],
        ['Tasa impacto',  `${(impactMetrics.impactRate * 100).toFixed(1)}%`,   '#aaa'],
      ];
      this.groundingMetricsEl.innerHTML = gRows
        .map(([l, v, c]) => `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`)
        .join('');
    } else {
      this.groundingMetricsEl.innerHTML = '<tr><td colspan="2" class="empty">Sin impacto</td></tr>';
    }

    // Tabla de pointing
    const am = this.angTracker.getMetrics();
    const cc = pointing.confidence > 0.7 ? '#4DFF88' : pointing.confidence > 0.4 ? '#FFD700' : '#FF4D4D';
    const pRows = [
      ['Gesto',        pointing.isGesture ? 'SÍ' : 'NO',                   pointing.isGesture ? '#4DFF88' : '#FF4D4D'],
      ['Modo',         pointing.mode ?? '—',                                mc[pointing.mode] ?? '#888'],
      ['Confianza',    `${(pointing.confidence * 100).toFixed(1)}%`,        cc],
      ['Extensión',    `${pointing.extensionAngle?.toFixed(1) ?? '?'}°`,    '#ccc'],
      ['Motivo',       pointing.reason ?? '—',                              pointing.reason === 'ok' ? '#4DFF88' : '#FF8C4D'],
      ['Jitter angular', `${am.jitter.toFixed(2)}°/f`,                     am.level === 'stable' ? '#4DFF88' : am.level === 'moderate' ? '#FFD700' : '#FF4D4D'],
      ['Continuidad',  `${am.continuity} f`,                                '#aaa'],
    ];
    this.pointingMetricsEl.innerHTML = pRows
      .map(([l, v, c]) => `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`)
      .join('');
  }

  // ── Estado de la app ──────────────────────────────────────────────────────

  _setState(state) {
    this._state = state;
    const msgs = {
      [STATES.LOADING]:     'Cargando modelos y cámara…',
      [STATES.READY]:       'Listo. Pulsa "Calibrar pizarra" y selecciona las 4 esquinas (↖ ↗ ↘ ↙)',
      [STATES.CALIBRATING]: 'Calibrando…',
      [STATES.ACTIVE]:      'Activo — detección de pointing y proyección sobre la pizarra en marcha',
    };
    this._setStatus(msgs[state] ?? '');

    this.calibrateBtn.disabled = state !== STATES.READY;
    this.resetBtn.disabled     = state === STATES.LOADING || state === STATES.READY;
    this.recordBtn.disabled    = state !== STATES.ACTIVE;

    if (state === STATES.ACTIVE) {
      this.calibBadge.textContent = 'Calibrado';
      this.calibBadge.className   = 'badge badge-ok';
    } else if (state === STATES.CALIBRATING) {
      this.calibBadge.textContent = 'Calibrando…';
      this.calibBadge.className   = 'badge badge-warn';
    } else {
      this.calibBadge.textContent = 'Sin calibrar';
      this.calibBadge.className   = 'badge badge-warn';
    }
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }

  // ── Resumen de sesión ─────────────────────────────────────────────────────

  _showSummary(summary) {
    this.summarySection.style.display = 'block';
    this.summarySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const jc = { stable:'#4DFF88', moderate:'#FFD700', unstable:'#FF4D4D' };
    const jLevel = summary.avgJitter < 0.008 ? 'stable' : summary.avgJitter < 0.025 ? 'moderate' : 'unstable';

    const regionList = Object.entries(summary.regionFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(' · ');

    const rows = [
      ['Frames totales',    `${summary.frameCount}`],
      ['Duración',          `${(summary.durationMs / 1000).toFixed(1)} s`],
      ['Tasa de impacto',   `${summary.impactRate}%`],
      ['Confianza media',   `${summary.avgConfidence}%`],
      ['Jitter medio',      `<span style="color:${jc[jLevel]}">${(summary.avgJitter * 1000).toFixed(1)} ×10⁻³</span>`],
      ['Región dominante',  `<span style="color:#FFD700">${summary.dominantRegion}</span>`],
      ['Distribución',      regionList],
    ];

    this.summaryBodyEl.innerHTML = rows
      .map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`)
      .join('');
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
const startApp = async () => {
  try {
    document.getElementById('status').textContent = 'Iniciando aplicación...';
    // Le pasamos el CV si ya lo cargó el script de OpenCV
    const app = new Fase4App(window.cv || cv);
    await app.init();
  } catch (err) {
    // Si algo falla, lo sacamos en pantalla
    document.getElementById('status').textContent = 'Error arrancando: ' + err.message;
    document.getElementById('status').classList.add('error');
    console.error(err);
  }
};

if (window.cvReady) {
  startApp();
} else {
  // Ahora escuchamos también en `window`
  window.addEventListener('opencv-ready', startApp);
}