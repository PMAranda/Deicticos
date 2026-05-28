import { PoseEstimator }    from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }    from '../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks } from '../src/modules/estimacion_corporal/landmarks.js';
import { LandmarkRenderer } from '../src/modules/estimacion_corporal/renderer.js';
import { FPSTracker }       from '../src/modules/estimacion_corporal/stability.js';
import { PointingEstimator } from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }  from '../src/modules/heuristica/renderer.js';
import { AngularTracker }    from '../src/modules/heuristica/metricas.js';
import { CalibrationModule } from '../src/modules/homografia/calibration.js';
import { HomographyModule }  from '../src/modules/homografia/homography.js';
import { CoordinateSystem }  from '../src/modules/homografia/coordinates.js';
import { BoardGrounding }    from '../src/modules/grounding/grounding.js';
import { GroundingRenderer } from '../src/modules/grounding/renderer.js';
import { ImpactTracker }     from '../src/modules/grounding/metricas.js';

const RECT_W  = 640;
const RECT_H  = 480;
const BOARD_W = 320;
const BOARD_H = 240;

class Eval4App {
  constructor() {
    // ── DOM ───────────────────────────────────────────────────────────────────
    this.video          = document.getElementById('video');
    this.mainCanvas     = document.getElementById('mainCanvas');
    this.boardCanvas    = document.getElementById('boardCanvas');
    this.mainCtx        = this.mainCanvas.getContext('2d');
    this.boardCtx       = this.boardCanvas.getContext('2d');
    this.statusEl       = document.getElementById('status');
    this.calibBadge     = document.getElementById('calibBadge');
    this.trackingBadge  = document.getElementById('trackingBadge');
    this.impactBadge    = document.getElementById('impactBadge');
    this.fpsBadgeEl     = document.getElementById('fpsBadge');
    this.calibPanel     = document.getElementById('calibPanel');
    this.calibInstr     = document.getElementById('calibInstructions');
    this.recalibBtn     = document.getElementById('recalibBtn');
    this.viewsRow       = document.getElementById('viewsRow');
    this.tablesRow      = document.getElementById('tablesRow');
    this.videoControls  = document.getElementById('videoControls');
    this.playBtn        = document.getElementById('playBtn');
    this.seekBar        = document.getElementById('seekBar');
    this.timeDisplay    = document.getElementById('timeDisplay');
    this.speedSelect    = document.getElementById('speedSelect');
    this.stepBtn        = document.getElementById('stepBtn');
    this.groundingMetrics = document.getElementById('groundingMetrics');
    this.pointingMetrics  = document.getElementById('pointingMetrics');
    this.summarySection   = document.getElementById('summarySection');
    this.summaryBody      = document.getElementById('summaryBody');
    this.dropZone       = document.getElementById('dropZone');
    this.fileInput      = document.getElementById('fileInput');
    this.sourceBar      = document.getElementById('sourceBar');
    this.reloadBtn      = document.getElementById('reloadBtn');

    // ── Módulos sin cv ────────────────────────────────────────────────────────
    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.poseImg     = new PoseEstimator();
    this.handsImg    = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.pointingEst = new PointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.angTracker  = new AngularTracker(30);
    this.fpsTracker  = new FPSTracker(60);
    this.groundRdr   = new GroundingRenderer();
    this.impactTrack = new ImpactTracker(30);
    this.coordSystem = new CoordinateSystem(3, 3);

    // ── Módulos con cv — se crean en onOpenCVReady ────────────────────────────
    this.homography  = null;
    this.calibration = null;
    this.grounding   = null;

    // ── Estado ────────────────────────────────────────────────────────────────
    this._cvReady     = false;
    this._mpReady     = false;
    this._calibrating = false;
    this._corners     = null;
    this._mode        = null;
    this._isPlaying   = false;
    this._loopId      = null;
    this._loadedImg   = null;
    this._side        = 'auto';
    this._frameCount  = 0;
    this._impactCount = 0;

    this.boardCanvas.width  = BOARD_W;
    this.boardCanvas.height = BOARD_H;

    this.dropZone.style.pointerEvents = 'none';
    this.dropZone.style.opacity = '0.45';

    this._bindUI();
  }

  // ── Inicialización ─────────────────────────────────────────────────────────

  // Llamado desde el bootstrap DESPUÉS de opencv-ready (window.Module ya borrado)
  onOpenCVReady(cv) {
    this.homography  = new HomographyModule(cv);
    this.calibration = new CalibrationModule(this.mainCanvas);
    this.grounding   = new BoardGrounding(this.homography, this.coordSystem);
    this._cvReady    = true;
    this._checkAllReady();
  }

  async initMediaPipe() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await Promise.all([
        this.pose.init('VIDEO'),
        this.hands.init('VIDEO'),
        this.poseImg.init('IMAGE'),
        this.handsImg.init('IMAGE'),
      ]);
      this._mpReady = true;
      this._checkAllReady();
    } catch (err) {
      this._setStatus(`Error MediaPipe: ${err.message}`, true);
    }
  }

  _checkAllReady() {
    if (!this._cvReady || !this._mpReady) return;
    this._setStatus('Listo. Sube una imagen o vídeo para evaluar.');
    this.dropZone.style.pointerEvents = 'auto';
    this.dropZone.style.opacity = '1';
  }

  // ── Subida de archivo ──────────────────────────────────────────────────────

  _bindUI() {
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files[0]) this._loadFile(this.fileInput.files[0]);
    });
    this.dropZone.addEventListener('dragover', e => {
      e.preventDefault(); this.dropZone.classList.add('dragover');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('dragover');
    });
    this.dropZone.addEventListener('drop', e => {
      e.preventDefault(); this.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._loadFile(e.dataTransfer.files[0]);
    });

    this.reloadBtn?.addEventListener('click', () => this._resetToUpload());
    this.recalibBtn?.addEventListener('click', () => this._startCalibration());

    this.playBtn.addEventListener('click', () => this._togglePlay());
    this.seekBar.addEventListener('input', () => {
      if (this._mode !== 'video') return;
      this.video.currentTime = (this.seekBar.value / 1000) * this.video.duration;
    });
    this.speedSelect.addEventListener('change', () => {
      this.video.playbackRate = parseFloat(this.speedSelect.value);
    });
    this.stepBtn.addEventListener('click', () => {
      if (this._mode !== 'video' || this._isPlaying) return;
      const next = Math.min(this.video.duration, this.video.currentTime + 1 / 30);
      this.video.currentTime = next;
      this.video.onseeked = () => {
        this.video.onseeked = null;
        this._processVideoFrame();
      };
    });
    this.video.addEventListener('timeupdate', () => {
      if (this._mode !== 'video') return;
      this.seekBar.value = this.video.duration
        ? (this.video.currentTime / this.video.duration) * 1000 : 0;
      this._updateTimeDisplay();
    });
    this.video.addEventListener('ended', () => {
      this._isPlaying = false;
      this.playBtn.textContent = '▶ Play';
      cancelAnimationFrame(this._loopId);
      this._loopId = null;
      this._onVideoEnded();
    });

    document.querySelectorAll('.tag[data-group="side"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._side = btn.dataset.value;
        this.pointingEst.reset();
        document.querySelectorAll('.tag[data-group="side"]')
          .forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  async _loadFile(file) {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      this._setStatus('Formato no soportado. Usa vídeo (MP4, MOV…) o imagen (JPG, PNG…).', true);
      return;
    }

    this._resetState();
    this.dropZone.style.display  = 'none';
    this.sourceBar.style.display = 'flex';
    document.getElementById('fileName').textContent    = file.name;
    document.getElementById('fileTypeTag').textContent = isVideo ? 'VÍDEO' : 'IMAGEN';

    this._mode = isVideo ? 'video' : 'image';
    if (isVideo) await this._initVideo(file);
    else         await this._initImage(file);
  }

  async _initVideo(file) {
    const url = URL.createObjectURL(file);
    this.video.src = url;
    this.video.playbackRate = parseFloat(this.speedSelect.value);

    await new Promise((res, rej) => {
      this.video.onloadedmetadata = res;
      this.video.onerror = () => rej(new Error('No se pudo cargar el vídeo'));
    });

    this.mainCanvas.width  = this.video.videoWidth;
    this.mainCanvas.height = this.video.videoHeight;
    document.getElementById('fileDuration').textContent = this._fmtTime(this.video.duration);

    this.video.currentTime = 0;
    await new Promise(res => {
      this.video.onseeked = () => { this.video.onseeked = null; res(); };
    });
    this.mainCtx.drawImage(this.video, 0, 0, this.mainCanvas.width, this.mainCanvas.height);

    this.viewsRow.style.display = 'grid';
    this._startCalibration();
  }

  async _initImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

    this.mainCanvas.width  = img.width;
    this.mainCanvas.height = img.height;
    this.mainCtx.drawImage(img, 0, 0);
    this._loadedImg = img;
    document.getElementById('fileDuration').textContent = '—';
    URL.revokeObjectURL(url);

    this.viewsRow.style.display = 'grid';
    this._startCalibration();
  }

  // ── Calibración ────────────────────────────────────────────────────────────

  _startCalibration() {
    this._corners     = null;
    this._calibrating = true;
    if (this.homography?.isReady) this.homography.dispose();
    this.calibration.reset();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this.impactTrack.clear();
    this._updateCalibBadge(false);

    this.calibPanel.style.display    = 'flex';
    this.recalibBtn.style.display    = 'none';
    this.videoControls.style.display = 'none';

    this.calibration.start(corners => {
      this._corners     = corners;
      this._calibrating = false;
      this.homography.compute(corners, RECT_W, RECT_H);
      this._onCalibrationDone();
    });

    this._runCalibLoop();
    this._setStatus('Calibración: haz clic en las 4 esquinas de la pizarra (↖ ↗ ↘ ↙)');
  }

  _runCalibLoop() {
    const LABELS = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
    const loop = () => {
      if (!this._calibrating) return;

      if (this._loadedImg) {
        this.mainCtx.drawImage(this._loadedImg, 0, 0, this.mainCanvas.width, this.mainCanvas.height);
      } else if (this._mode === 'video') {
        this.mainCtx.drawImage(this.video, 0, 0, this.mainCanvas.width, this.mainCanvas.height);
      }
      this.calibration.drawOverlay();

      const n = this.calibration.corners?.length ?? 0;
      this.calibInstr.textContent = n < 4
        ? `Haz clic en esquina ${n + 1}/4 — ${LABELS[n] ?? ''}`
        : 'Procesando…';

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _onCalibrationDone() {
    this._updateCalibBadge(true);
    this.recalibBtn.style.display = 'inline-block';
    this.calibInstr.textContent   = '✓ Pizarra calibrada';

    if (this._mode === 'image') {
      this._detectImage();
    } else {
      this.videoControls.style.display = 'flex';
      this.tablesRow.style.display     = 'grid';
      this._setStatus('Calibrado. Pulsa Play para analizar el vídeo.');
    }
  }

  // ── Detección — imagen ─────────────────────────────────────────────────────

  _detectImage() {
    const img = this._loadedImg;
    const W   = this.mainCanvas.width;
    const H   = this.mainCanvas.height;

    const poseRes  = this.poseImg.detect(img);
    const handsRes = this.handsImg.detect(img);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);
    const rawResult = this.pointingEst.estimate(pose, hands, this._side);
    // Modo IMAGE: usar rawIsGesture/rawConfidence para detección directa sin histéresis
    const result    = { ...rawResult, isGesture: rawResult.rawIsGesture, confidence: rawResult.rawConfidence };
    this.angTracker.update(result);

    const gResult = this.grounding.project(result, W, H, this._corners);
    this.impactTrack.update(gResult);

    this.mainCtx.drawImage(img, 0, 0);
    this.calibration.drawOverlay();
    this._renderOverlay(result, pose, hands, gResult, false);

    this.groundRdr.drawBoardImpact(this.boardCtx, gResult, this.coordSystem, BOARD_W, BOARD_H);
    this.groundRdr.drawStatusPanel(this.boardCtx, gResult, this.impactTrack.getMetrics(), BOARD_W);

    this.tablesRow.style.display = 'grid';
    this._updateBadges(pose, hands, result, gResult);
    this._updateMetricsTables(result, gResult);
    document.getElementById('frameInfo').textContent = '1 frame';
    this._setStatus('Imagen analizada.');
  }

  // ── Detección — vídeo ──────────────────────────────────────────────────────

  _togglePlay() {
    if (this._mode !== 'video') return;
    if (this._isPlaying) {
      this.video.pause();
      this._isPlaying = false;
      this.playBtn.textContent = '▶ Play';
      cancelAnimationFrame(this._loopId);
      this._loopId = null;
    } else {
      if (this.video.ended) { this.video.currentTime = 0; this._frameCount = 0; this._impactCount = 0; }
      this.video.play();
      this._isPlaying = true;
      this.playBtn.textContent = '⏸ Pausa';
      this._videoLoop();
    }
  }

  _videoLoop() {
    this._loopId = requestAnimationFrame(() => {
      if (!this._isPlaying) return;
      this._processVideoFrame();
      this._videoLoop();
    });
  }

  _processVideoFrame() {
    if (!this.pose.isReady || !this.hands.isReady) return;
    this.fpsTracker.tick();
    const ts = performance.now();
    const W  = this.mainCanvas.width;
    const H  = this.mainCanvas.height;

    this.mainCtx.drawImage(this.video, 0, 0, W, H);
    this.calibration.drawOverlay();

    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);
    const result   = this.pointingEst.estimate(pose, hands, this._side);
    this.angTracker.update(result);

    const gResult  = this.grounding.project(result, W, H, this._corners);
    this.impactTrack.update(gResult);

    this._frameCount++;
    if (gResult) this._impactCount++;

    this._renderOverlay(result, pose, hands, gResult, true);
    this.groundRdr.drawBoardImpact(this.boardCtx, gResult, this.coordSystem, BOARD_W, BOARD_H);
    this.groundRdr.drawStatusPanel(this.boardCtx, gResult, this.impactTrack.getMetrics(), BOARD_W);

    this._updateBadges(pose, hands, result, gResult);
    this._updateMetricsTables(result, gResult);
    document.getElementById('frameInfo').textContent =
      `~Frame ${Math.round(this.video.currentTime * 30)} · ${this._fmtTime(this.video.currentTime)}`;
  }

  _onVideoEnded() {
    const impactRate = this._frameCount > 0
      ? (this._impactCount / this._frameCount * 100).toFixed(1) : '0';
    const impMetrics = this.impactTrack.getMetrics();
    const jc = impMetrics.level === 'stable' ? '#4DFF88'
             : impMetrics.level === 'moderate' ? '#FFD700' : '#FF4D4D';

    this.summarySection.style.display = 'block';
    this.summarySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    this.summaryBody.innerHTML = [
      ['Frames totales',   `${this._frameCount}`],
      ['Duración',         this._fmtTime(this.video.duration)],
      ['Tasa de impacto',  `${impactRate}%`],
      ['Jitter espacial',  `<span style="color:${jc}">${(impMetrics.jitter * 1000).toFixed(1)} ×10⁻³</span>`],
      ['Cambios de región', `${impMetrics.regionChanges}`],
      ['Tasa impacto acum.', `${(impMetrics.impactRate * 100).toFixed(1)}%`],
    ].map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join('');

    this._setStatus('Análisis completo.');
  }

  // ── Renderizado ────────────────────────────────────────────────────────────

  _renderOverlay(result, pose, hands, gResult, showFps) {
    const W = this.mainCanvas.width;
    const H = this.mainCanvas.height;
    this.bodyRdr.drawArmSkeleton(this.mainCtx, pose, W, H);
    if (hands.Left)  this.bodyRdr.drawHandLandmarks(this.mainCtx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.bodyRdr.drawHandLandmarks(this.mainCtx, hands.Right, 'Right', W, H);
    this.pointingRdr.drawComponentVectors(this.mainCtx, result, W, H);
    this.pointingRdr.drawExtensionAngle(this.mainCtx, result.armData, result.extensionAngle, W, H);
    this.pointingRdr.drawPointingRay(this.mainCtx, result, W, H);
    this.pointingRdr.drawStatusPanel(this.mainCtx, result, W);
    if (gResult) {
      this.groundRdr.drawRayToBoard(this.mainCtx, result.origin, gResult.hitPx, W, H);
    }
    if (showFps) this.bodyRdr.drawFPS(this.mainCtx, this.fpsTracker.fps, W);
  }

  // ── Actualización UI ───────────────────────────────────────────────────────

  _updateBadges(pose, hands, pointing, gResult) {
    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Izq');
    if (hands.Right) parts.push('Der');
    this.trackingBadge.textContent = parts.length ? parts.join(' · ') : 'Sin detección';
    this.trackingBadge.className   = `badge ${parts.length ? 'badge-active' : 'badge-off'}`;

    this.impactBadge.textContent = gResult ? `Impacto: ${gResult.region.label}` : 'Sin impacto';
    this.impactBadge.className   = `badge ${gResult ? 'badge-ok' : 'badge-off'}`;

    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className   = `badge ${fps >= 25 ? 'badge-ok' : ''}`;
  }

  _updateCalibBadge(done) {
    this.calibBadge.textContent = done ? 'Calibrado' : 'Sin calibrar';
    this.calibBadge.className   = `badge ${done ? 'badge-ok' : 'badge-warn'}`;
  }

  _updateMetricsTables(pointing, gResult) {
    const mc = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#FF4D4D' };
    const cc = (pointing.confidence ?? 0) > 0.7 ? '#4DFF88'
             : (pointing.confidence ?? 0) > 0.4 ? '#FFD700' : '#FF4D4D';

    this.pointingMetrics.innerHTML = [
      ['Gesto',     pointing.isGesture ? 'SÍ' : 'NO',                   pointing.isGesture ? '#4DFF88' : '#FF4D4D'],
      ['Modo',      pointing.mode ?? '—',                                mc[pointing.mode] ?? '#888'],
      ['Confianza', `${((pointing.confidence ?? 0) * 100).toFixed(1)}%`, cc],
      ['Brazo',     pointing.side ?? '—',                                '#aaa'],
      ['Extensión', `${pointing.extensionAngle?.toFixed(1) ?? '?'}°`,    '#ccc'],
      ['Motivo',    pointing.reason ?? '—',                              pointing.reason === 'ok' ? '#4DFF88' : '#FF8C4D'],
    ].map(([l, v, c]) => `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`).join('');

    const impMetrics = this.impactTrack.getMetrics();
    const jc = impMetrics.level === 'stable' ? '#4DFF88'
             : impMetrics.level === 'moderate' ? '#FFD700' : '#FF4D4D';

    this.groundingMetrics.innerHTML = gResult ? [
      ['Región',       gResult.region.label,                               '#FFD700'],
      ['X norm.',      gResult.xn.toFixed(4),                              '#c0c0d0'],
      ['Y norm.',      gResult.yn.toFixed(4),                              '#c0c0d0'],
      ['X suavizado',  gResult.smoothed.x.toFixed(4),                      '#9ab4f5'],
      ['Y suavizado',  gResult.smoothed.y.toFixed(4),                      '#9ab4f5'],
      ['Jitter',       `${(impMetrics.jitter * 1000).toFixed(1)} ×10⁻³`,   jc],
      ['Tasa impacto', `${(impMetrics.impactRate * 100).toFixed(1)}%`,      '#aaa'],
    ].map(([l, v, c]) => `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`).join('')
      : '<tr><td colspan="2" class="empty">Sin impacto</td></tr>';
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  _resetState() {
    cancelAnimationFrame(this._loopId);
    this._loopId = null;
    if (this._isPlaying) { this.video.pause(); this._isPlaying = false; }
    this._calibrating = false;
    this.pointingEst.reset();
    this.angTracker.clear();
    this.impactTrack.clear();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this._corners     = null;
    this._loadedImg   = null;
    this._mode        = null;
    this._frameCount  = 0;
    this._impactCount = 0;
    this.playBtn.textContent = '▶ Play';
    this.videoControls.style.display  = 'none';
    this.tablesRow.style.display      = 'none';
    this.summarySection.style.display = 'none';
    this.calibPanel.style.display     = 'none';
    this.viewsRow.style.display       = 'none';
    this.summaryBody.innerHTML        = '';
    this._updateCalibBadge(false);
    this.mainCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    this.boardCtx.clearRect(0, 0, BOARD_W, BOARD_H);
  }

  _resetToUpload() {
    this._resetState();
    this.sourceBar.style.display = 'none';
    this.dropZone.style.display  = 'flex';
    this.fileInput.value         = '';
    this._setStatus('Listo. Sube una imagen o vídeo para evaluar.');
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  _fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  _updateTimeDisplay() {
    this.timeDisplay.textContent =
      `${this._fmtTime(this.video.currentTime)} / ${this._fmtTime(this.video.duration)}`;
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
// MediaPipe se inicia DESPUÉS de opencv-ready, una vez que window.Module ya ha
// sido borrado por OpenCV. Si MediaPipe arranca antes, ambos entornos WASM
// colisionan sobre window.Module y el navegador se congela (issue #5282).
document.addEventListener('DOMContentLoaded', () => {
  const app = new Eval4App();

  const start = () => {
    app.onOpenCVReady(window.cv);
    app.initMediaPipe();
  };

  if (window.cvReady) {
    start();
  } else {
    window.addEventListener('opencv-ready', start);
  }
});
