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
import { DwellConfirmer }    from '../src/modules/semantica/dwell.js';

const RECT_W  = 640;
const RECT_H  = 480;
const BOARD_W = 480;
const BOARD_H = 360;

const STATES = Object.freeze({
  LOADING:     'LOADING',
  READY:       'READY',
  CALIBRATING: 'CALIBRATING',
  ACTIVE:      'ACTIVE',
});

// FPS nominal asumido para conversión frames → segundos en etiquetas
const FPS_NOMINAL = 30;

class Fase5App {
  constructor(cv) {
    this.cv = cv;

    // ── DOM ───────────────────────────────────────────────────────────────────
    this.video       = document.getElementById('video');
    this.rawCanvas   = document.getElementById('rawCanvas');
    this.boardCanvas = document.getElementById('boardCanvas');
    this.rawCtx      = this.rawCanvas.getContext('2d');
    this.boardCtx    = this.boardCanvas.getContext('2d');

    this.statusEl           = document.getElementById('status');
    this.calibBadge         = document.getElementById('calibBadge');
    this.trackingBadge      = document.getElementById('trackingBadge');
    this.pointingBadge      = document.getElementById('pointingBadge');
    this.dwellBadge         = document.getElementById('dwellBadge');
    this.fpsBadgeEl         = document.getElementById('fpsBadge');
    this.groundingMetricsEl = document.getElementById('groundingMetrics');
    this.pointingMetricsEl  = document.getElementById('pointingMetrics');
    this.summarySection     = document.getElementById('summarySection');
    this.summaryBodyEl      = document.getElementById('summaryBody');

    this.calibrateBtn = document.getElementById('calibrateBtn');
    this.resetBtn     = document.getElementById('resetBtn');
    this.recordBtn    = document.getElementById('recordBtn');
    this.exportBtn    = document.getElementById('exportBtn');

    // Configuración de umbrales
    this.dwellSlider  = document.getElementById('dwellSlider');
    this.dwellValueEl = document.getElementById('dwellValue');
    this.regionSlider = document.getElementById('regionSlider');
    this.regionValueEl = document.getElementById('regionValue');

    // Dwell bar y panel de región
    this.dwellBarWrap  = document.getElementById('dwellBarWrap');
    this.dwellFill     = document.getElementById('dwellFill');
    this.dwellBarLabel = document.getElementById('dwellBarLabel');
    this.regionPanel   = document.getElementById('regionPanel');
    this.regionText    = document.getElementById('regionText');

    // ── Módulos ───────────────────────────────────────────────────────────────
    this.camera      = new CameraModule(this.video);
    this.calibration = new CalibrationModule(this.rawCanvas);
    this.homography  = new HomographyModule(cv);
    this.coordSystem = new CoordinateSystem(3, 3);

    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.fpsTracker  = new FPSTracker(60);
    this.pointingEst = new PointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.angTracker  = new AngularTracker(30);

    this.grounding   = new BoardGrounding(this.homography, this.coordSystem);
    this.groundRdr   = new GroundingRenderer();
    this.impactTrack = new ImpactTracker(30);
    this.logger      = new GroundingSessionLogger();

    this.dwell = new DwellConfirmer(Number(this.dwellSlider.value));

    // ── Estado ────────────────────────────────────────────────────────────────
    this._state       = STATES.LOADING;
    this._corners     = null;
    this._isRecording = false;

    this.boardCanvas.width  = BOARD_W;
    this.boardCanvas.height = BOARD_H;

    this._bindControls();
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

  // ── Controles ──────────────────────────────────────────────────────────────

  _bindControls() {
    this.calibrateBtn.addEventListener('click', () => this._startCalibration());
    this.resetBtn.addEventListener('click',     () => this._reset());
    this.recordBtn.addEventListener('click',    () => this._toggleRecording());
    this.exportBtn.addEventListener('click',    () => this._exportCSV());

    this.dwellSlider.addEventListener('input', () => {
      const n = Number(this.dwellSlider.value);
      this.dwell.setDwellFrames(n);
      const secs = (n / FPS_NOMINAL).toFixed(1);
      this.dwellValueEl.textContent = n === 0
        ? '0 f (inmediato)'
        : `${n} f (~${secs} s)`;
    });

    this.regionSlider.addEventListener('input', () => {
      const n = Number(this.regionSlider.value);
      this.grounding.setRegionDebounce(n);
      this.regionValueEl.textContent = `${n} f`;
    });
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
    this.dwell.reset();
    this.regionPanel.style.display  = 'none';
    this.dwellBarWrap.style.display = 'none';
    this.summarySection.style.display = 'none';
    this._setState(STATES.READY);
  }

  _toggleRecording() {
    if (this._isRecording) this._stopRecording();
    else                   this._startRecording();
  }

  _startRecording() {
    this._isRecording = true;
    this.logger.startSession({
      fase: 'fase5',
      dwellFrames: this.dwell.dwellFrames,
      regionDebounce: Number(this.regionSlider.value),
      ts: new Date().toISOString(),
    });
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
    a.download = `semantica_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Loop principal ─────────────────────────────────────────────────────────

  _loop() {
    requestAnimationFrame(() => this._loop());

    const W = this.rawCanvas.width;
    const H = this.rawCanvas.height;

    this.rawCtx.drawImage(this.video, 0, 0, W, H);

    if (this._state === STATES.CALIBRATING) {
      this.calibration.drawOverlay();
      const n      = this.calibration.corners.length;
      const labels = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
      this._setStatus(`Calibrando: haz clic en esquina ${n + 1}/4 — ${labels[n] ?? ''}`);
      return;
    }

    if (this._state !== STATES.ACTIVE) return;
    if (!this.pose.isReady || !this.hands.isReady) return;

    this.fpsTracker.tick();
    const ts = performance.now();

    // ── Detección ─────────────────────────────────────────────────────────────
    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    // ── Pointing ──────────────────────────────────────────────────────────────
    const pointing = this.pointingEst.estimate(pose, hands, 'auto');
    this.angTracker.update(pointing);

    // ── Dwell — confirmación temporal del gesto ───────────────────────────────
    const dwellResult = this.dwell.update(pointing.isGesture);

    // ── Grounding — proyección sobre el tablero ───────────────────────────────
    // Calculamos siempre que haya gesto (para mostrar el rayo y la barra de dwell).
    // La región semántica solo se expone cuando el dwell está confirmado.
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

    if (gResult) {
      this.groundRdr.drawRayToBoard(this.rawCtx, pointing.origin, gResult.hitPx, W, H);
    }

    // ── Render — vista tablero ────────────────────────────────────────────────
    // Pasamos el resultado solo si el dwell está confirmado, para que el trail
    // y el marcador de impacto solo aparezcan tras la confirmación.
    const confirmedResult = dwellResult.isConfirmed ? gResult : null;
    this.groundRdr.drawBoardImpact(this.boardCtx, confirmedResult, this.coordSystem, BOARD_W, BOARD_H);
    this.groundRdr.drawStatusPanel(this.boardCtx, confirmedResult, impactMetrics, BOARD_W);

    // ── UI dinámica ───────────────────────────────────────────────────────────
    this._updateDwellBar(dwellResult, pointing.isGesture);
    this._updateRegionPanel(dwellResult, gResult);
    this._updateBadges(pose, hands, pointing, dwellResult, gResult);
    this._updateMetrics(pointing, dwellResult, gResult, impactMetrics);
  }

  // ── Barra de progreso de dwell ─────────────────────────────────────────────

  _updateDwellBar(dwellResult, isGesture) {
    // Visible solo mientras hay gesto y aún no se ha confirmado
    if (!isGesture || dwellResult.isConfirmed) {
      this.dwellBarWrap.style.display = 'none';
      return;
    }
    this.dwellBarWrap.style.display = 'flex';
    this.dwellFill.style.width = `${(dwellResult.progress * 100).toFixed(1)}%`;
    const remaining = ((this.dwell.dwellFrames - dwellResult.count) / FPS_NOMINAL).toFixed(1);
    this.dwellBarLabel.textContent = `Manteniendo… ${remaining} s`;
  }

  // ── Panel de región confirmada ─────────────────────────────────────────────

  _updateRegionPanel(dwellResult, gResult) {
    if (dwellResult.isConfirmed && gResult) {
      const label = gResult.region.label.toUpperCase();
      if (this.regionPanel.style.display === 'none' || this.regionText.textContent !== label) {
        this.regionText.textContent = label;
        this.regionPanel.style.display = 'flex';
      }
    } else {
      this.regionPanel.style.display = 'none';
    }
  }

  // ── Badges ────────────────────────────────────────────────────────────────

  _updateBadges(pose, hands, pointing, dwellResult, gResult) {
    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');

    this.trackingBadge.textContent = parts.length ? parts.join(' · ') : 'Sin detección';
    this.trackingBadge.className   = `badge ${parts.length ? 'badge-active' : 'badge-off'}`;

    this.pointingBadge.textContent = pointing.isGesture
      ? `Gesto (${(pointing.confidence * 100).toFixed(0)}%)`
      : 'Sin gesto';
    this.pointingBadge.className   = `badge ${pointing.isGesture ? 'badge-ok' : 'badge-off'}`;

    if (!pointing.isGesture) {
      this.dwellBadge.textContent = 'Sin confirmar';
      this.dwellBadge.className   = 'badge badge-off';
    } else if (dwellResult.isConfirmed) {
      this.dwellBadge.textContent = gResult ? `✓ ${gResult.region.label}` : '✓ Confirmado';
      this.dwellBadge.className   = 'badge badge-ok';
    } else {
      const pct = Math.round(dwellResult.progress * 100);
      this.dwellBadge.textContent = `Dwell ${pct}%`;
      this.dwellBadge.className   = 'badge badge-dwell';
    }

    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className   = `badge ${fps >= 25 ? 'badge-ok' : fps >= 15 ? 'badge-warn' : ''}`;
  }

  // ── Métricas ───────────────────────────────────────────────────────────────

  _updateMetrics(pointing, dwellResult, gResult, impactMetrics) {
    const mc = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#555' };
    const jc = impactMetrics.level === 'stable'   ? '#4DFF88'
             : impactMetrics.level === 'moderate' ? '#FFD700' : '#FF4D4D';

    // Panel grounding — muestra raw (aunque no confirmado) para que se vea la posición
    if (gResult) {
      const gRows = [
        ['Región (bruta)',   gResult.region.label,                                 '#FFD700'],
        ['Confirmada',       dwellResult.isConfirmed ? 'SÍ' : 'NO',               dwellResult.isConfirmed ? '#4DFF88' : '#888'],
        ['X normalizado',    gResult.xn.toFixed(4),                                '#c0c0d0'],
        ['Y normalizado',    gResult.yn.toFixed(4),                                '#c0c0d0'],
        ['X suavizado',      gResult.smoothed.x.toFixed(4),                        '#9ab4f5'],
        ['Y suavizado',      gResult.smoothed.y.toFixed(4),                        '#9ab4f5'],
        ['Jitter impacto',   `${(impactMetrics.jitter * 1000).toFixed(1)} ×10⁻³`,  jc],
        ['Cambios región',   `${impactMetrics.regionChanges}`,                     '#aaa'],
        ['Tasa impacto',     `${(impactMetrics.impactRate * 100).toFixed(1)}%`,    '#aaa'],
      ];
      this.groundingMetricsEl.innerHTML = gRows
        .map(([l, v, c]) => `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`)
        .join('');
    } else {
      this.groundingMetricsEl.innerHTML = '<tr><td colspan="2" class="empty">Sin impacto</td></tr>';
    }

    // Panel pointing + dwell
    const am = this.angTracker.getMetrics();
    const cc = pointing.confidence > 0.7 ? '#4DFF88' : pointing.confidence > 0.4 ? '#FFD700' : '#FF4D4D';
    const pRows = [
      ['Gesto',          pointing.isGesture ? 'SÍ' : 'NO',                    pointing.isGesture ? '#4DFF88' : '#FF4D4D'],
      ['Modo',           pointing.mode ?? '—',                                 mc[pointing.mode] ?? '#888'],
      ['Confianza',      `${(pointing.confidence * 100).toFixed(1)}%`,         cc],
      ['Razón',          pointing.reason ?? '—',                               pointing.reason === 'ok' ? '#4DFF88' : '#FF8C4D'],
      ['Extensión',      `${pointing.extensionAngle?.toFixed(1) ?? '?'}°`,     '#ccc'],
      ['Dwell frames',   `${dwellResult.count} / ${this.dwell.dwellFrames}`,   '#9ab4f5'],
      ['Dwell progress', `${Math.round(dwellResult.progress * 100)}%`,         dwellResult.isConfirmed ? '#4DFF88' : '#FFD700'],
      ['Confirmado',     dwellResult.isConfirmed ? 'SÍ' : 'NO',               dwellResult.isConfirmed ? '#4DFF88' : '#888'],
      ['Jitter angular', `${am.jitter.toFixed(2)}°/f`,                        am.level === 'stable' ? '#4DFF88' : am.level === 'moderate' ? '#FFD700' : '#FF4D4D'],
    ];
    this.pointingMetricsEl.innerHTML = pRows
      .map(([l, v, c]) => `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`)
      .join('');
  }

  // ── Estado de la app ───────────────────────────────────────────────────────

  _setState(state) {
    this._state = state;
    const msgs = {
      [STATES.LOADING]:     'Cargando modelos y cámara…',
      [STATES.READY]:       'Listo. Pulsa "Calibrar pizarra" y selecciona las 4 esquinas (↖ ↗ ↘ ↙)',
      [STATES.CALIBRATING]: 'Calibrando…',
      [STATES.ACTIVE]:      'Activo — mantén el gesto de pointing para confirmar la región señalada',
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

    const jc     = { stable:'#4DFF88', moderate:'#FFD700', unstable:'#FF4D4D' };
    const jLevel = summary.avgJitter < 0.008 ? 'stable' : summary.avgJitter < 0.025 ? 'moderate' : 'unstable';

    const regionList = Object.entries(summary.regionFreq ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(' · ');

    const rows = [
      ['Frames totales',  `${summary.frameCount}`],
      ['Duración',        `${(summary.durationMs / 1000).toFixed(1)} s`],
      ['Tasa de impacto', `${summary.impactRate}%`],
      ['Conf. media',     `${summary.avgConfidence}%`],
      ['Dwell configurado', `${this.dwell.dwellFrames} f (~${(this.dwell.dwellFrames / FPS_NOMINAL).toFixed(1)} s)`],
      ['Debounce región', `${this.regionSlider.value} f`],
      ['Jitter medio',    `<span style="color:${jc[jLevel]}">${(summary.avgJitter * 1000).toFixed(1)} ×10⁻³</span>`],
      ['Región dominante',`<span style="color:#FFD700">${summary.dominantRegion}</span>`],
      ['Distribución',    regionList],
    ];

    this.summaryBodyEl.innerHTML = rows
      .map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`)
      .join('');
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const startApp = async () => {
  try {
    document.getElementById('status').textContent = 'Iniciando…';
    const app = new Fase5App(window.cv || cv);
    await app.init();
  } catch (err) {
    document.getElementById('status').textContent = 'Error arrancando: ' + err.message;
    document.getElementById('status').classList.add('error');
    console.error(err);
  }
};

if (window.cvReady) {
  startApp();
} else {
  window.addEventListener('opencv-ready', startApp);
}
