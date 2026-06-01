import { PoseEstimator }           from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }           from '../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks } from '../src/modules/estimacion_corporal/landmarks.js';
import { LandmarkRenderer }        from '../src/modules/estimacion_corporal/renderer.js';
import { PointingEstimator }       from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }        from '../src/modules/heuristica/renderer.js';
import { CalibrationModule }       from '../src/modules/homografia/calibration.js';
import { HomographyModule }        from '../src/modules/homografia/homography.js';
import { CoordinateSystem }        from '../src/modules/homografia/coordinates.js';
import { BoardGrounding }          from '../src/modules/grounding/grounding.js';
import { GroundingRenderer }       from '../src/modules/grounding/renderer.js';

const RECT_W  = 640;
const RECT_H  = 480;
const BOARD_W = 320;
const BOARD_H = 240;

// Cabecera del CSV bruto — la ausencia de "Confirmado" lo identifica como bruto
const CSV_HEADER = 'Frame,Tiempo(s),Gesto,Confianza(%),Modo,Region,X_norm,Y_norm';

class CapturaApp {
  constructor() {
    this.video          = document.getElementById('video');
    this.mainCanvas     = document.getElementById('mainCanvas');
    this.boardCanvas    = document.getElementById('boardCanvas');
    this.mainCtx        = this.mainCanvas.getContext('2d');
    this.boardCtx       = this.boardCanvas.getContext('2d');
    this.statusEl       = document.getElementById('status');
    this.calibBadge     = document.getElementById('calibBadge');
    this.trackingBadge  = document.getElementById('trackingBadge');
    this.fpsBadgeEl     = document.getElementById('fpsBadge');
    this.calibPanel     = document.getElementById('calibPanel');
    this.calibInstr     = document.getElementById('calibInstructions');
    this.recalibBtn     = document.getElementById('recalibBtn');
    this.viewsRow       = document.getElementById('viewsRow');
    this.dropZone       = document.getElementById('dropZone');
    this.fileInput      = document.getElementById('fileInput');
    this.sourceBar      = document.getElementById('sourceBar');
    this.reloadBtn      = document.getElementById('reloadBtn');
    this.analysisPanel  = document.getElementById('analysisPanel');
    this.analyzeBtn     = document.getElementById('analyzeBtn');
    this.speedSelect    = document.getElementById('speedSelect');
    this.progressWrap   = document.getElementById('progressWrap');
    this.progressFill   = document.getElementById('progressFill');
    this.progressLabel  = document.getElementById('progressLabel');
    this.exportWrap     = document.getElementById('exportWrap');
    this.exportSummary  = document.getElementById('exportSummary');
    this.exportBtn      = document.getElementById('exportBtn');
    this.goAnalysisBtn  = document.getElementById('goAnalysisBtn');
    this.timelineWrap   = document.getElementById('timelineWrap');
    this.timelineCanvas = document.getElementById('timelineCanvas');
    this.timelineInfo   = document.getElementById('timelineInfo');

    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.pointingEst = new PointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.groundRdr   = new GroundingRenderer();
    this.coordSystem = new CoordinateSystem(3, 3);

    this.homography  = null;
    this.calibration = null;
    this.grounding   = null;

    this._cvReady    = false;
    this._mpReady    = false;
    this._calibrating = false;
    this._corners    = null;
    this._analyzing  = false;
    this._loopId     = null;
    this._frames     = [];
    this._lastTs     = -1;

    this.boardCanvas.width  = BOARD_W;
    this.boardCanvas.height = BOARD_H;
    this.dropZone.style.pointerEvents = 'none';
    this.dropZone.style.opacity = '0.45';

    this._bindUI();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  onOpenCVReady(cv) {
    this.homography  = new HomographyModule(cv);
    this.calibration = new CalibrationModule(this.mainCanvas);
    this.grounding   = new BoardGrounding(this.homography, this.coordSystem);
    this._cvReady    = true;
    this._checkReady();
  }

  async initMediaPipe() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await Promise.all([this.pose.init('VIDEO'), this.hands.init('VIDEO')]);
      this._mpReady = true;
      this._checkReady();
    } catch (err) {
      this._setStatus(`Error MediaPipe: ${err.message}`, true);
    }
  }

  _checkReady() {
    if (!this._cvReady || !this._mpReady) return;
    this._setStatus('Listo. Sube un vídeo para capturar datos.');
    this.dropZone.style.pointerEvents = 'auto';
    this.dropZone.style.opacity = '1';
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _bindUI() {
    this.dropZone.addEventListener('click',    () => this.fileInput.click());
    this.dropZone.addEventListener('dragover', e  => { e.preventDefault(); this.dropZone.classList.add('dragover'); });
    this.dropZone.addEventListener('dragleave',()  => this.dropZone.classList.remove('dragover'));
    this.dropZone.addEventListener('drop', e => {
      e.preventDefault(); this.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._loadFile(e.dataTransfer.files[0]);
    });
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files[0]) this._loadFile(this.fileInput.files[0]);
    });

    this.reloadBtn.addEventListener('click',  () => this._resetToUpload());
    this.recalibBtn.addEventListener('click', () => this._startCalibration());
    this.analyzeBtn.addEventListener('click', () => this._startAnalysis());
    this.exportBtn.addEventListener('click',  () => this._exportRawCSV());
    this.video.addEventListener('ended',      () => this._finishAnalysis());
  }

  // ── Carga de vídeo ────────────────────────────────────────────────────────

  async _loadFile(file) {
    if (!file.type.startsWith('video/')) {
      this._setStatus('Solo se admiten vídeos (MP4, MOV, WebM…).', true); return;
    }
    this._resetState();
    this.dropZone.style.display  = 'none';
    this.sourceBar.style.display = 'flex';
    document.getElementById('fileName').textContent     = file.name;
    document.getElementById('fileDuration').textContent = '…';

    const url = URL.createObjectURL(file);
    this.video.src = url;
    await new Promise((res, rej) => {
      this.video.onloadedmetadata = res;
      this.video.onerror = () => rej(new Error('No se pudo cargar el vídeo'));
    });

    this.mainCanvas.width  = this.video.videoWidth;
    this.mainCanvas.height = this.video.videoHeight;
    document.getElementById('fileDuration').textContent = this._fmtTime(this.video.duration);

    this.video.currentTime = 0;
    await new Promise(res => { this.video.onseeked = () => { this.video.onseeked = null; res(); }; });
    this.mainCtx.drawImage(this.video, 0, 0, this.mainCanvas.width, this.mainCanvas.height);

    this.viewsRow.style.display      = 'grid';
    this.analysisPanel.style.display = 'flex';
    this._startCalibration();
  }

  // ── Calibración ───────────────────────────────────────────────────────────

  _startCalibration() {
    this._corners     = null;
    this._calibrating = true;
    this.analyzeBtn.disabled = true;
    if (this.homography?.isReady) this.homography.dispose();
    this.calibration.reset();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this._updateCalibBadge(false);
    this.calibPanel.style.display  = 'flex';
    this.recalibBtn.style.display  = 'none';
    this.exportWrap.style.display  = 'none';
    this.timelineWrap.style.display = 'none';

    this.calibration.start(corners => {
      this._corners     = corners;
      this._calibrating = false;
      this.homography.compute(corners, RECT_W, RECT_H);
      this._updateCalibBadge(true);
      this.recalibBtn.style.display  = 'inline-block';
      this.calibInstr.textContent    = '✓ Pizarra calibrada';
      this.analyzeBtn.disabled       = false;
      this._setStatus('Calibrado. Pulsa "Analizar vídeo" para procesar todos los frames.');
    });

    const LABELS = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
    const loop = () => {
      if (!this._calibrating) return;
      this.mainCtx.drawImage(this.video, 0, 0, this.mainCanvas.width, this.mainCanvas.height);
      this.calibration.drawOverlay();
      const n = this.calibration.corners?.length ?? 0;
      this.calibInstr.textContent = n < 4
        ? `Haz clic en esquina ${n + 1}/4 — ${LABELS[n] ?? ''}`
        : 'Procesando…';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this._setStatus('Calibración: haz clic en las 4 esquinas de la pizarra (↖ ↗ ↘ ↙)');
  }

  // ── Análisis ──────────────────────────────────────────────────────────────

  _startAnalysis() {
    if (!this._corners) return;
    this._frames    = [];
    this._lastTs    = -1;
    this._analyzing = true;

    this.analyzeBtn.disabled         = true;
    this.progressWrap.style.display  = 'flex';
    this.progressFill.style.width    = '0%';
    this.progressLabel.textContent   = 'Analizando… 0%';
    this.exportWrap.style.display    = 'none';
    this.timelineWrap.style.display  = 'none';
    this.exportBtn.disabled          = true;

    this.pointingEst.reset();
    this.grounding.reset();

    this.video.currentTime = 0;
    this.video.playbackRate = parseFloat(this.speedSelect.value);
    this.video.onseeked = () => {
      this.video.onseeked = null;
      this.video.play().catch(() => {});
      this._analyzeLoop();
    };
    this._setStatus('Analizando…');
  }

  _analyzeLoop() {
    if (!this._analyzing) return;
    this._loopId = requestAnimationFrame(() => this._analyzeLoop());

    const ts = this.video.currentTime;
    if (ts === this._lastTs) return;
    this._lastTs = ts;

    const W = this.mainCanvas.width;
    const H = this.mainCanvas.height;

    this.mainCtx.drawImage(this.video, 0, 0, W, H);

    const poseRes  = this.pose.detect(this.video, performance.now());
    const handsRes = this.hands.detect(this.video, performance.now());
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    const pointing = this.pointingEst.estimate(pose, hands, 'auto');
    const gResult  = this.grounding.project(pointing, W, H, this._corners);

    // Datos brutos — sin dwell
    this._frames.push({
      frame:      this._frames.length,
      ts:         parseFloat(ts.toFixed(4)),
      isGesture:  pointing.isGesture,
      confidence: parseFloat((pointing.confidence * 100).toFixed(1)),
      mode:       pointing.mode ?? 'lost',
      region:     gResult?.region?.label ?? '',
      xn:         gResult != null ? parseFloat(gResult.xn.toFixed(4)) : '',
      yn:         gResult != null ? parseFloat(gResult.yn.toFixed(4)) : '',
    });

    // Render ligero
    this.bodyRdr.drawArmSkeleton(this.mainCtx, pose, W, H);
    this.pointingRdr.drawPointingRay(this.mainCtx, pointing, W, H);
    this.calibration.drawOverlay();
    if (gResult) {
      this.groundRdr.drawRayToBoard(this.mainCtx, pointing.origin, gResult.hitPx, W, H);
      this.groundRdr.drawBoardImpact(this.boardCtx, gResult, this.coordSystem, BOARD_W, BOARD_H);
    }

    const hasPose = pose !== null;
    this.trackingBadge.textContent = hasPose ? 'Pose ✓' : 'Sin detección';
    this.trackingBadge.className   = `badge ${hasPose ? 'badge-active' : 'badge-off'}`;

    const pct = this.video.duration
      ? Math.round((ts / this.video.duration) * 100) : 0;
    this.progressFill.style.width  = `${pct}%`;
    this.progressLabel.textContent = `Analizando… ${pct}% · ${this._frames.length} frames`;
    document.getElementById('frameInfo').textContent = `${this._frames.length} f`;
  }

  _finishAnalysis() {
    this._analyzing = false;
    cancelAnimationFrame(this._loopId);
    this._loopId = null;
    this.video.pause();

    this.progressFill.style.width  = '100%';
    this.progressLabel.textContent = `✓ Análisis completo — ${this._frames.length} frames`;

    const gestureFrames  = this._frames.filter(f => f.isGesture).length;
    const regionFrames   = this._frames.filter(f => f.region).length;
    const gesturePct     = (gestureFrames / this._frames.length * 100).toFixed(1);
    const regionPct      = (regionFrames  / this._frames.length * 100).toFixed(1);

    this.exportSummary.textContent =
      `${this._frames.length} frames · ${gesturePct}% con gesto · ${regionPct}% con región detectada`;
    this.exportWrap.style.display   = 'flex';
    this.exportBtn.disabled         = false;
    this.goAnalysisBtn.style.display = 'inline-block';
    this.analyzeBtn.disabled        = false;

    this._drawTimeline();
    this.timelineWrap.style.display = 'block';
    this._setStatus(`Listo. Exporta el CSV bruto y ábrelo en "Análisis GT".`);
  }

  // ── Timeline de vista previa ──────────────────────────────────────────────

  _drawTimeline() {
    const canvas = this.timelineCanvas;
    const n      = this._frames.length;
    canvas.width  = Math.min(n, 2000);
    canvas.height = 36;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, 36);

    for (let px = 0; px < W; px++) {
      const fi = Math.floor((px / W) * n);
      const f  = this._frames[fi];
      let color;
      if (!f.isGesture)  color = '#12121e';
      else if (f.region) color = '#FFD700';
      else               color = '#4DFF88';
      ctx.fillStyle = color;
      ctx.fillRect(px, 4, 1, 28);
    }

    const gestureFrames = this._frames.filter(f => f.isGesture).length;
    const regionFrames  = this._frames.filter(f => f.region).length;
    this.timelineInfo.textContent =
      `${gestureFrames} frames con gesto (${(gestureFrames/n*100).toFixed(1)}%) · ` +
      `${regionFrames} frames con región (${(regionFrames/n*100).toFixed(1)}%)`;

    canvas.onmousemove = e => {
      const rect = canvas.getBoundingClientRect();
      const fi   = Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n));
      const f    = this._frames[fi];
      this.timelineInfo.textContent =
        `Frame ${f.frame} · t=${f.ts.toFixed(2)}s · ` +
        `${f.isGesture ? `Gesto (${f.confidence}% ${f.mode})` : 'Sin gesto'}` +
        (f.region ? ` · ${f.region}` : '');
    };
    canvas.onmouseleave = () => {
      this.timelineInfo.textContent =
        `${gestureFrames} frames con gesto (${(gestureFrames/n*100).toFixed(1)}%) · ` +
        `${regionFrames} frames con región (${(regionFrames/n*100).toFixed(1)}%)`;
    };
  }

  // ── Exportar CSV bruto ────────────────────────────────────────────────────

  _exportRawCSV() {
    if (!this._frames.length) return;
    const rows = this._frames.map(f =>
      [f.frame, f.ts, f.isGesture ? 'Sí' : 'No',
       f.confidence, f.mode, f.region, f.xn, f.yn].join(',')
    );
    const csv  = CSV_HEADER + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `raw_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  _resetToUpload() {
    this._resetState();
    this.dropZone.style.display      = 'block';
    this.sourceBar.style.display     = 'none';
    this.viewsRow.style.display      = 'none';
    this.analysisPanel.style.display = 'none';
    this.calibPanel.style.display    = 'none';
  }

  _resetState() {
    this._analyzing = false;
    this._frames    = [];
    this._lastTs    = -1;
    if (this._loopId) { cancelAnimationFrame(this._loopId); this._loopId = null; }
    this.video.pause();
    this.video.src = '';
    this.homography?.dispose();
    this.calibration?.reset();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this.pointingEst.reset();
    this._corners     = null;
    this._calibrating = false;
    this.progressWrap.style.display   = 'none';
    this.exportWrap.style.display     = 'none';
    this.timelineWrap.style.display   = 'none';
    this.analyzeBtn.disabled          = true;
    this.exportBtn.disabled           = true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _updateCalibBadge(ok) {
    this.calibBadge.textContent = ok ? 'Calibrado' : 'Sin calibrar';
    this.calibBadge.className   = `badge ${ok ? 'badge-ok' : 'badge-warn'}`;
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }

  _fmtTime(s) {
    if (!s || isNaN(s)) return '—';
    return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
let _app;
if (window.cvReady) {
  _app = new CapturaApp();
  _app.onOpenCVReady(window.cv);
  _app.initMediaPipe();
} else {
  window.addEventListener('opencv-ready', () => {
    if (!_app) _app = new CapturaApp();
    _app.onOpenCVReady(window.cv);
    _app.initMediaPipe();
  });
}
