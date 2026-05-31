import { PoseEstimator }    from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }    from '../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks } from '../src/modules/estimacion_corporal/landmarks.js';
import { LandmarkRenderer } from '../src/modules/estimacion_corporal/renderer.js';
import { PointingEstimator } from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }  from '../src/modules/heuristica/renderer.js';
import { CalibrationModule } from '../src/modules/homografia/calibration.js';
import { HomographyModule }  from '../src/modules/homografia/homography.js';
import { CoordinateSystem }  from '../src/modules/homografia/coordinates.js';
import { BoardGrounding }    from '../src/modules/grounding/grounding.js';
import { GroundingRenderer } from '../src/modules/grounding/renderer.js';

const RECT_W  = 640;
const RECT_H  = 480;
const BOARD_W = 320;
const BOARD_H = 240;
const FPS_NOMINAL = 30;

// Umbrales de dwell a comparar (en frames)
const COMPARE_THRESHOLDS = [0, 10, 15, 20, 30, 45, 60, 90];

class Eval5App {
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
    this.dwellControls  = document.getElementById('dwellControls');
    this.dwellSlider    = document.getElementById('dwellSlider');
    this.dwellValueEl   = document.getElementById('dwellValue');
    this.compareBtn     = document.getElementById('compareBtn');
    this.exportBtn      = document.getElementById('exportBtn');
    this.timelineSection = document.getElementById('timelineSection');
    this.timelineCanvas  = document.getElementById('timelineCanvas');
    this.timelineInfo    = document.getElementById('timelineInfo');
    this.timelineThresholdLabel = document.getElementById('timelineThresholdLabel');
    this.statsSection   = document.getElementById('statsSection');
    this.statsPills     = document.getElementById('statsPills');
    this.compareSection = document.getElementById('compareSection');
    this.compareBody    = document.getElementById('compareBody');

    // ── Módulos (sin cv) ──────────────────────────────────────────────────────
    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.pointingEst = new PointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.groundRdr   = new GroundingRenderer();
    this.coordSystem = new CoordinateSystem(3, 3);

    // ── Módulos con cv (se crean en onOpenCVReady) ────────────────────────────
    this.homography  = null;
    this.calibration = null;
    this.grounding   = null;

    // ── Estado ────────────────────────────────────────────────────────────────
    this._cvReady     = false;
    this._mpReady     = false;
    this._calibrating = false;
    this._corners     = null;
    this._analyzing   = false;
    this._loopId      = null;
    this._frames      = [];          // datos brutos por frame
    this._lastTs      = -1;          // timestamp del último frame procesado

    this.boardCanvas.width  = BOARD_W;
    this.boardCanvas.height = BOARD_H;
    this.dropZone.style.pointerEvents = 'none';
    this.dropZone.style.opacity = '0.45';

    this._bindUI();
  }

  // ── Inicialización ─────────────────────────────────────────────────────────

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
      await Promise.all([this.pose.init('VIDEO'), this.hands.init('VIDEO')]);
      this._mpReady = true;
      this._checkAllReady();
    } catch (err) {
      this._setStatus(`Error MediaPipe: ${err.message}`, true);
    }
  }

  _checkAllReady() {
    if (!this._cvReady || !this._mpReady) return;
    this._setStatus('Listo. Sube un vídeo para evaluar.');
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
    this.analyzeBtn.addEventListener('click',  () => this._startAnalysis());
    this.compareBtn.addEventListener('click',  () => this._buildComparisonTable());
    this.exportBtn.addEventListener('click',   () => this._exportCSV());

    this.dwellSlider.addEventListener('input', () => {
      const n = Number(this.dwellSlider.value);
      const secs = (n / FPS_NOMINAL).toFixed(1);
      this.dwellValueEl.textContent = n === 0 ? '0 f (inmediato)' : `${n} f (~${secs} s)`;
      if (this._frames.length > 0) this._renderResults(n);
    });

    this.video.addEventListener('ended', () => this._finishAnalysis());
  }

  async _loadFile(file) {
    if (!file.type.startsWith('video/')) {
      this._setStatus('Solo se admiten vídeos (MP4, MOV, WebM…).', true);
      return;
    }
    this._resetState();
    this.dropZone.style.display  = 'none';
    this.sourceBar.style.display = 'flex';
    document.getElementById('fileName').textContent    = file.name;
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

    this.viewsRow.style.display     = 'grid';
    this.analysisPanel.style.display = 'flex';
    this._startCalibration();
  }

  // ── Calibración ────────────────────────────────────────────────────────────

  _startCalibration() {
    this._corners     = null;
    this._calibrating = true;
    this.analyzeBtn.disabled = true;
    if (this.homography?.isReady) this.homography.dispose();
    this.calibration.reset();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this._updateCalibBadge(false);
    this.calibPanel.style.display = 'flex';
    this.recalibBtn.style.display = 'none';

    this.calibration.start(corners => {
      this._corners     = corners;
      this._calibrating = false;
      this.homography.compute(corners, RECT_W, RECT_H);
      this._onCalibrationDone();
    });

    const LABELS = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
    const calibLoop = () => {
      if (!this._calibrating) return;
      this.mainCtx.drawImage(this.video, 0, 0, this.mainCanvas.width, this.mainCanvas.height);
      this.calibration.drawOverlay();
      const n = this.calibration.corners?.length ?? 0;
      this.calibInstr.textContent = n < 4
        ? `Haz clic en esquina ${n + 1}/4 — ${LABELS[n] ?? ''}`
        : 'Procesando…';
      requestAnimationFrame(calibLoop);
    };
    requestAnimationFrame(calibLoop);
    this._setStatus('Calibración: haz clic en las 4 esquinas de la pizarra (↖ ↗ ↘ ↙)');
  }

  _onCalibrationDone() {
    this._updateCalibBadge(true);
    this.recalibBtn.style.display = 'inline-block';
    this.calibInstr.textContent   = '✓ Pizarra calibrada';
    this.analyzeBtn.disabled      = false;
    this._setStatus('Calibrado. Pulsa "Analizar vídeo" para procesar todos los frames.');
  }

  // ── Análisis ───────────────────────────────────────────────────────────────

  _startAnalysis() {
    if (!this._corners) return;
    this._frames      = [];
    this._lastTs      = -1;
    this._analyzing   = true;

    this.analyzeBtn.disabled        = true;
    this.progressWrap.style.display = 'flex';
    this.progressFill.style.width   = '0%';
    this.progressLabel.textContent  = 'Analizando… 0%';
    this.dwellControls.style.display  = 'none';
    this.timelineSection.style.display = 'none';
    this.statsSection.style.display    = 'none';
    this.compareSection.style.display  = 'none';

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

    // Evitar procesar el mismo frame dos veces
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

    // Guardar solo datos brutos — el dwell se simula post-hoc
    this._frames.push({
      frame:      this._frames.length,
      ts:         parseFloat(ts.toFixed(4)),
      isGesture:  pointing.isGesture,
      confidence: parseFloat((pointing.confidence * 100).toFixed(1)),
      mode:       pointing.mode ?? 'lost',
      region:     gResult?.region?.label ?? null,
      xn:         gResult != null ? parseFloat(gResult.xn.toFixed(4)) : null,
      yn:         gResult != null ? parseFloat(gResult.yn.toFixed(4)) : null,
    });

    // Render ligero
    this.bodyRdr.drawArmSkeleton(this.mainCtx, pose, W, H);
    this.pointingRdr.drawPointingRay(this.mainCtx, pointing, W, H);
    this.calibration.drawOverlay();
    if (gResult) {
      this.groundRdr.drawRayToBoard(this.mainCtx, pointing.origin, gResult.hitPx, W, H);
      this.groundRdr.drawBoardImpact(this.boardCtx, gResult, this.coordSystem, BOARD_W, BOARD_H);
    }

    // Badges mínimos
    const hasPose = pose !== null;
    this.trackingBadge.textContent = hasPose ? 'Pose ✓' : 'Sin detección';
    this.trackingBadge.className   = `badge ${hasPose ? 'badge-active' : 'badge-off'}`;

    // Progreso
    const pct = this.video.duration
      ? Math.round((ts / this.video.duration) * 100) : 0;
    this.progressFill.style.width  = `${pct}%`;
    this.progressLabel.textContent = `Analizando… ${pct}% · ${this._frames.length} frames`;
    document.getElementById('frameInfo').textContent = `${this._frames.length} f procesados`;
  }

  _finishAnalysis() {
    this._analyzing = false;
    cancelAnimationFrame(this._loopId);
    this._loopId = null;
    this.video.pause();

    this.progressFill.style.width  = '100%';
    this.progressLabel.textContent = `✓ Análisis completo — ${this._frames.length} frames`;

    this.analyzeBtn.disabled         = false;
    this.dwellControls.style.display = 'flex';
    this.exportBtn.disabled          = false;

    this._renderResults(Number(this.dwellSlider.value));
    this._setStatus(`Análisis completo: ${this._frames.length} frames procesados. Ajusta el dwell slider.`);
  }

  // ── Simulación de dwell (post-hoc, sin re-procesar vídeo) ─────────────────

  /**
   * Aplica la lógica de DwellConfirmer sobre los frames almacenados.
   * Es una función pura que no modifica this._frames.
   */
  _applyDwell(dwellFrames) {
    let count     = 0;
    let confirmed = false;
    return this._frames.map(f => {
      if (f.isGesture) {
        const limit = Math.max(1, dwellFrames);
        count       = Math.min(count + 1, limit);
        if (dwellFrames === 0 || count >= dwellFrames) confirmed = true;
      } else {
        count     = 0;
        confirmed = false;
      }
      const progress = dwellFrames > 0 ? count / dwellFrames : (f.isGesture ? 1 : 0);
      return { ...f, dwellCount: count, isConfirmed: confirmed, dwellProgress: progress };
    });
  }

  /** Calcula métricas de latencia y confirmaciones para una secuencia de frames. */
  _computeStats(enhanced, dwellFrames) {
    const latencies   = [];
    const durations   = [];
    let inGesture     = false;
    let gestureStart  = -1;
    let inConfirmed   = false;
    let confirmStart  = -1;
    let everConfirmed = false;
    let interruptions = 0;

    for (let i = 0; i < enhanced.length; i++) {
      const f = enhanced[i];

      if (f.isGesture && !inGesture) {
        inGesture     = true;
        gestureStart  = i;
        everConfirmed = false;
      }

      if (f.isConfirmed && !inConfirmed) {
        inConfirmed   = true;
        confirmStart  = i;
        everConfirmed = true;
        latencies.push(i - gestureStart);
      }

      if (!f.isConfirmed && inConfirmed) {
        inConfirmed = false;
        durations.push(i - confirmStart);
      }

      if (!f.isGesture && inGesture) {
        if (!everConfirmed && (i - gestureStart) >= 1) interruptions++;
        inGesture = false;
        gestureStart = -1;
      }
    }

    const total     = enhanced.length;
    const gestureF  = enhanced.filter(f => f.isGesture).length;
    const confirmedF = enhanced.filter(f => f.isConfirmed).length;
    const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      total,
      gestureFrames:    gestureF,
      confirmedFrames:  confirmedF,
      confirmations:    latencies.length,
      interruptions,
      latencyMeanF:     parseFloat(mean(latencies).toFixed(1)),
      latencyMeanS:     parseFloat((mean(latencies) / FPS_NOMINAL).toFixed(2)),
      latencyMinF:      latencies.length ? Math.min(...latencies) : 0,
      latencyMaxF:      latencies.length ? Math.max(...latencies) : 0,
      durationMeanF:    parseFloat(mean(durations).toFixed(1)),
      gesturePct:       parseFloat((gestureF / total * 100).toFixed(1)),
      confirmedPct:     parseFloat((confirmedF / total * 100).toFixed(1)),
    };
  }

  // ── Renderizado de resultados ──────────────────────────────────────────────

  _renderResults(dwellFrames) {
    const enhanced = this._applyDwell(dwellFrames);
    const stats    = this._computeStats(enhanced, dwellFrames);

    this._drawTimeline(enhanced, dwellFrames);
    this._showStats(stats, dwellFrames);

    this.timelineSection.style.display = 'block';
    this.statsSection.style.display    = 'block';

    const secs = (dwellFrames / FPS_NOMINAL).toFixed(1);
    this.timelineThresholdLabel.textContent =
      dwellFrames === 0 ? '· dwell = 0 (sin espera)' : `· dwell = ${dwellFrames} f (~${secs} s)`;
  }

  _drawTimeline(enhanced, dwellFrames) {
    const canvas = this.timelineCanvas;
    canvas.width  = Math.min(enhanced.length, 2000);
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    const n   = enhanced.length;
    if (n === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const W = canvas.width;
    for (let px = 0; px < W; px++) {
      const fi = Math.floor((px / W) * n);
      const f  = enhanced[fi];

      let color;
      if (!f.isGesture) {
        color = '#12121e';
      } else if (f.isConfirmed) {
        color = '#1a4a1a';
      } else {
        // En dwell: degradado de gris-oscuro a ámbar según progreso
        const t = f.dwellProgress;
        const r = Math.round(40 + t * 90);
        const g = Math.round(30 + t * 60);
        const b = 0;
        color = `rgb(${r},${g},${b})`;
      }
      ctx.fillStyle = color;
      ctx.fillRect(px, 4, 1, 40);
    }

    // Marcadores de confirmación (líneas verdes verticales en la parte superior)
    let prevConfirmed = false;
    for (let fi = 0; fi < n; fi++) {
      const f  = enhanced[fi];
      const px = Math.round((fi / n) * W);
      if (f.isConfirmed && !prevConfirmed) {
        ctx.fillStyle = '#4DFF88';
        ctx.fillRect(px, 0, 1, 6);
      }
      prevConfirmed = f.isConfirmed;
    }

    // Tooltip info al hover
    const stats = this._computeStats(enhanced, dwellFrames);
    this.timelineInfo.textContent =
      `${stats.confirmations} confirmaciones · ${stats.interruptions} interrupciones · ` +
      `${stats.gesturePct}% con gesto · ${stats.confirmedPct}% confirmado`;

    canvas.onmousemove = (e) => {
      const rect  = canvas.getBoundingClientRect();
      const relX  = (e.clientX - rect.left) / rect.width;
      const fi    = Math.min(n - 1, Math.floor(relX * n));
      const f     = enhanced[fi];
      const state = !f.isGesture ? 'Sin gesto' : f.isConfirmed ? '✓ Confirmado' : `Dwell ${Math.round(f.dwellProgress * 100)}%`;
      this.timelineInfo.textContent =
        `Frame ${f.frame} · t=${f.ts.toFixed(2)}s · ${state}` +
        (f.region ? ` · ${f.region}` : '') +
        ` · conf.=${f.confidence}%`;
    };
    canvas.onmouseleave = () => {
      this.timelineInfo.textContent =
        `${stats.confirmations} confirmaciones · ${stats.interruptions} interrupciones · ` +
        `${stats.gesturePct}% con gesto · ${stats.confirmedPct}% confirmado`;
    };
  }

  _showStats(stats, dwellFrames) {
    const pill = (value, label, color = '#c0c0e0') =>
      `<div class="stat-pill">
         <span class="stat-pill-value" style="color:${color}">${value}</span>
         <span class="stat-pill-label">${label}</span>
       </div>`;

    const latColor = stats.latencyMeanF > 45 ? '#FF8C4D' : stats.latencyMeanF > 20 ? '#FFD700' : '#4DFF88';
    const confColor = stats.confirmedPct > 20 ? '#4DFF88' : stats.confirmedPct > 5 ? '#FFD700' : '#FF8C4D';

    this.statsPills.innerHTML = [
      pill(stats.confirmations,              'Confirmaciones',       '#9ab4f5'),
      pill(stats.interruptions,              'Interrupciones',       '#FF8C4D'),
      pill(`${stats.latencyMeanF} f`,        'Latencia media',       latColor),
      pill(`${stats.latencyMeanS} s`,        'Latencia media (s)',   latColor),
      pill(`${stats.latencyMinF}–${stats.latencyMaxF} f`, 'Latencia min–max', '#aaa'),
      pill(`${stats.confirmedPct}%`,         '% confirmado',         confColor),
      pill(`${stats.gesturePct}%`,           '% con gesto',          '#c0c0e0'),
      pill(stats.total,                      'Frames totales',       '#555'),
    ].join('');
  }

  _buildComparisonTable() {
    const activeDwell = Number(this.dwellSlider.value);

    this.compareBody.innerHTML = COMPARE_THRESHOLDS.map(d => {
      const enhanced = this._applyDwell(d);
      const s        = this._computeStats(enhanced, d);
      const secs     = (d / FPS_NOMINAL).toFixed(1);
      const isActive = d === activeDwell;
      const cls      = isActive ? 'active-row' : '';

      return `<tr class="${cls}">
        <td><strong>${d}</strong>${isActive ? ' ←' : ''}</td>
        <td>${secs}</td>
        <td>${s.confirmations}</td>
        <td>${s.interruptions}</td>
        <td>${s.latencyMeanF}</td>
        <td>${s.latencyMeanS}</td>
        <td>${s.confirmedPct}%</td>
        <td>${s.gesturePct}%</td>
      </tr>`;
    }).join('');

    this.compareSection.style.display = 'block';
    this.compareSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Exportación CSV ────────────────────────────────────────────────────────

  _exportCSV() {
    const dwellFrames = Number(this.dwellSlider.value);
    const enhanced    = this._applyDwell(dwellFrames);

    const header = 'Frame,Tiempo(s),Gesto,Confianza(%),Modo,Dwell_frames,Dwell_progress(%),Confirmado,Region,X_norm,Y_norm\n';
    const rows   = enhanced.map(f => [
      f.frame,
      f.ts,
      f.isGesture ? 1 : 0,
      f.confidence,
      f.mode,
      f.dwellCount,
      parseFloat((f.dwellProgress * 100).toFixed(1)),
      f.isConfirmed ? 1 : 0,
      f.region ?? '',
      f.xn ?? '',
      f.yn ?? '',
    ].join(',')).join('\n');

    const csv  = header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `dwell_eval_${dwellFrames}f_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  _resetToUpload() {
    this._resetState();
    this.dropZone.style.display    = 'block';
    this.sourceBar.style.display   = 'none';
    this.viewsRow.style.display    = 'none';
    this.analysisPanel.style.display = 'none';
    this.calibPanel.style.display  = 'none';
  }

  _resetState() {
    this._analyzing = false;
    this._frames    = [];
    this._lastTs    = -1;
    if (this._loopId) { cancelAnimationFrame(this._loopId); this._loopId = null; }
    this.video.pause();
    this.video.src  = '';
    this.homography?.dispose();
    this.calibration?.reset();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this.pointingEst.reset();
    this._corners    = null;
    this._calibrating = false;
    this.progressWrap.style.display   = 'none';
    this.dwellControls.style.display  = 'none';
    this.timelineSection.style.display = 'none';
    this.statsSection.style.display    = 'none';
    this.compareSection.style.display  = 'none';
    this.analyzeBtn.disabled           = true;
    this.exportBtn.disabled            = true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _updateCalibBadge(ok) {
    this.calibBadge.textContent = ok ? 'Calibrado' : 'Sin calibrar';
    this.calibBadge.className   = `badge ${ok ? 'badge-ok' : 'badge-warn'}`;
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }

  _fmtTime(secs) {
    if (!secs || isNaN(secs)) return '—';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
let _app;

const startApp = async () => {
  _app = new Eval5App();
  await _app.initMediaPipe();
};

if (window.cvReady) {
  _app = new Eval5App();
  _app.onOpenCVReady(window.cv);
  _app.initMediaPipe();
} else {
  window.addEventListener('opencv-ready', () => {
    if (!_app) _app = new Eval5App();
    _app.onOpenCVReady(window.cv);
    _app.initMediaPipe();
  });
}
