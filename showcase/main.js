import { CameraModule }            from '../src/modules/homografia/camera.js';
import { CalibrationModule }         from '../src/modules/homografia/calibration.js';
import { HomographyModule }          from '../src/modules/homografia/homography.js';
import { CoordinateSystem }          from '../src/modules/homografia/coordinates.js';
import { PoseEstimator }             from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }             from '../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks }   from '../src/modules/estimacion_corporal/landmarks.js';
import { LandmarkRenderer }          from '../src/modules/estimacion_corporal/renderer.js';
import { FPSTracker }                from '../src/modules/estimacion_corporal/stability.js';
import { PointingEstimator }         from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }          from '../src/modules/heuristica/renderer.js';
import { BoardGrounding }            from '../src/modules/grounding/grounding.js';
import { GroundingRenderer }         from '../src/modules/grounding/renderer.js';

const RECT_W = 640;
const RECT_H = 480;

const STATES = Object.freeze({
  LOADING:     'LOADING',
  READY:       'READY',
  CALIBRATING: 'CALIBRATING',
  ACTIVE:      'ACTIVE',
});

const MODE_COLOR = { full: '#4DFF88', partial: '#FFD700', fallback: '#FF8C4D', lost: '#555' };
const REASON_LABEL = {
  ok:                     'ok',
  hombro_no_visible:      'hombro no visible',
  codo_no_visible:        'codo no visible',
  vector_proximal_ausente:'vector ausente',
  brazo_colgante:         'brazo colgante',
  muneca_muy_cerca:       'muñeca muy cerca',
  lost:                   '—',
};

class ShowcaseApp {
  constructor(cv) {
    this.cv = cv;

    // ── DOM ──────────────────────────────────────────────────────────────────
    this.video        = document.getElementById('video');
    this.rawCanvas    = document.getElementById('rawCanvas');
    this.rawCtx       = this.rawCanvas.getContext('2d');

    this.statusEl     = document.getElementById('status');
    this.calibrateBtn = document.getElementById('calibrateBtn');
    this.resetBtn     = document.getElementById('resetBtn');
    this.videoBtn     = document.getElementById('videoBtn');
    this.videoInput   = document.getElementById('videoInput');
    this.calibHint    = document.getElementById('calibHint');

    // Badges
    this.badgeFps      = document.getElementById('badgeFps');
    this.badgeSource   = document.getElementById('badgeSource');
    this.badgeTracking = document.getElementById('badgeTracking');
    this.badgePointing = document.getElementById('badgePointing');
    this.badgeCalib    = document.getElementById('badgeCalib');
    this.badgeHands    = document.getElementById('badgeHands');

    // Controles de vídeo
    this.videoControls  = document.getElementById('videoControls');
    this.playPauseBtn   = document.getElementById('playPauseBtn');
    this.videoFileNameEl = document.getElementById('videoFileName');

    // Panel derecho — región
    this.regionCard     = document.getElementById('regionCard');
    this.regionRowLabel = document.getElementById('regionRowLabel');
    this.regionColLabel = document.getElementById('regionColLabel');
    this.regionNoCalib  = document.getElementById('regionNoCalib');

    // Rejilla
    this.cells = document.querySelectorAll('#miniGrid .cell');

    // Coordenadas
    this.fillX   = document.getElementById('fillX');
    this.fillY   = document.getElementById('fillY');
    this.valX    = document.getElementById('valX');
    this.valY    = document.getElementById('valY');
    this.coordPx = document.getElementById('coordPx');

    // Métricas
    this.confFill  = document.getElementById('confFill');
    this.valConf   = document.getElementById('valConf');
    this.valMode   = document.getElementById('valMode');
    this.valSide   = document.getElementById('valSide');
    this.valExt    = document.getElementById('valExt');
    this.valAngle  = document.getElementById('valAngle');
    this.valReason = document.getElementById('valReason');

    // ── Módulos ──────────────────────────────────────────────────────────────
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
    this.grounding   = new BoardGrounding(this.homography, this.coordSystem);
    this.groundRdr   = new GroundingRenderer();

    // ── Estado ───────────────────────────────────────────────────────────────
    this._state        = STATES.LOADING;
    this._corners      = null;
    this._source       = null;   // 'camera' | 'video' | null
    this._videoBlobUrl = null;
    this._loopRunning  = false;

    this._bindControls();
  }

  // ── Arranque ───────────────────────────────────────────────────────────────

  async init() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await this.pose.init('VIDEO');
      await this.hands.init('VIDEO');
    } catch (err) {
      this._setStatus(`Error cargando modelos: ${err.message}`, true);
      return;
    }

    // El loop arranca ya: si no hay fuente, el guard de readyState lo para limpiamente
    this._startLoop();

    // Habilitar el botón de vídeo en cuanto los modelos estén listos
    this.videoBtn.disabled = false;

    // Intentar cámara — si falla, el usuario puede cargar un vídeo
    await this._tryCamera();
  }

  async _tryCamera() {
    this._setStatus('Accediendo a la cámara…');
    try {
      await this.camera.start();
      this.rawCanvas.width  = this.camera.width;
      this.rawCanvas.height = this.camera.height;
      this._source = 'camera';
      this._updateSourceBadge();
      this._setState(STATES.READY);
    } catch (err) {
      this._setStatus('Sin acceso a cámara — carga un vídeo con el botón ↑');
      this._source = null;
      this._updateSourceBadge();
      // No pasamos a READY hasta que haya una fuente válida
    }
  }

  // ── Controles ──────────────────────────────────────────────────────────────

  _bindControls() {
    this.calibrateBtn.addEventListener('click', () => this._startCalibration());
    this.resetBtn.addEventListener('click',     () => this._reset());

    // Botón "Cargar vídeo" abre el file picker
    this.videoBtn.addEventListener('click', () => this.videoInput.click());

    // Selección de fichero
    this.videoInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) this._loadVideoFile(file);
      e.target.value = '';   // permitir recargar el mismo fichero
    });

    // Play/Pausa del vídeo
    this.playPauseBtn.addEventListener('click', () => this._togglePlayPause());

    // Arrastrar un fichero de vídeo sobre el canvas también funciona
    this.rawCanvas.addEventListener('dragover',  e => { e.preventDefault(); });
    this.rawCanvas.addEventListener('drop', e => {
      e.preventDefault();
      const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('video/'));
      if (file) this._loadVideoFile(file);
    });
  }

  async _loadVideoFile(file) {
    this._setStatus(`Cargando vídeo: ${file.name}…`);

    // Detener cámara si estaba activa
    if (this._source === 'camera') {
      this.camera.stop();
    }

    // Liberar blob URL anterior
    if (this._videoBlobUrl) {
      URL.revokeObjectURL(this._videoBlobUrl);
      this._videoBlobUrl = null;
    }

    // Preparar el elemento <video> para el fichero
    this._videoBlobUrl      = URL.createObjectURL(file);
    this.video.srcObject    = null;
    this.video.src          = this._videoBlobUrl;
    this.video.loop         = true;
    this.video.muted        = true;
    this.video.playsInline  = true;

    // Esperar al primer frame (sin reproducir): el usuario verá el frame 0
    // para poder hacer clic en las esquinas de la pizarra antes de que empiece.
    try {
      await new Promise((resolve, reject) => {
        this.video.onloadeddata = resolve;
        this.video.onerror      = () => reject(new Error('No se pudo cargar el vídeo'));
      });
    } catch (err) {
      this._setStatus(`Error con el vídeo: ${err.message}`, true);
      return;
    }

    const newW = this.video.videoWidth;
    const newH = this.video.videoHeight;

    // Si las dimensiones cambian, la calibración anterior ya no es válida
    const dimensionsChanged = newW !== this.rawCanvas.width || newH !== this.rawCanvas.height;
    this.rawCanvas.width  = newW;
    this.rawCanvas.height = newH;

    if (dimensionsChanged && this._corners) {
      this._corners = null;
      this.homography.dispose();
      this.grounding.reset();
      this.groundRdr.clearTrail?.();
      this.pointingEst.reset();
      this._clearRightPanel();
    }

    this._source = 'video';
    this._updateSourceBadge(file.name);
    this.videoFileNameEl.textContent = file.name;
    this.videoControls.style.display = 'flex';

    if (this._corners) {
      // Ya hay calibración válida — reproducir directamente
      this.video.play().catch(() => {});
      this.playPauseBtn.textContent = '⏸';
      this._setState(STATES.ACTIVE);
    } else {
      // Esperando calibración — vídeo en pausa sobre el frame 0
      this.playPauseBtn.textContent = '▶';
      this._setState(STATES.READY);
      this._setStatus('Vídeo listo · Calibra la pizarra para comenzar la reproducción');
    }
  }

  _togglePlayPause() {
    if (!this.video || this._source !== 'video') return;
    if (this.video.paused) {
      this.video.play();
      this.playPauseBtn.textContent = '⏸';
    } else {
      this.video.pause();
      this.playPauseBtn.textContent = '▶';
    }
  }

  _startCalibration() {
    this._setState(STATES.CALIBRATING);
    this.calibHint.style.display = 'block';
    this.calibration.start(corners => {
      this._corners = corners;
      this.homography.compute(corners, RECT_W, RECT_H);
      this.calibHint.style.display = 'none';
      // Si el vídeo estaba pausado esperando calibración, arrancarlo ahora
      if (this._source === 'video' && this.video.paused) {
        this.video.play().catch(() => {});
        this.playPauseBtn.textContent = '⏸';
      }
      this._setState(STATES.ACTIVE);
    });
  }

  _reset() {
    this.calibration.reset();
    this.homography.dispose();
    this._corners = null;
    this.grounding.reset();
    this.groundRdr.clearTrail?.();
    this.pointingEst.reset();
    this.calibHint.style.display = 'none';
    this._clearRightPanel();
    // Volver a pausar el vídeo: espera una nueva calibración
    if (this._source === 'video') {
      this.video.pause();
      this.video.currentTime = 0;
      this.playPauseBtn.textContent = '▶';
    }
    this._setState(STATES.READY);
    if (this._source === 'video') {
      this._setStatus('Vídeo listo · Calibra la pizarra para comenzar la reproducción');
    }
  }

  // ── Loop principal ─────────────────────────────────────────────────────────

  _startLoop() {
    if (this._loopRunning) return;
    this._loopRunning = true;
    this._loop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    // Sin fuente de vídeo (readyState < HAVE_CURRENT_DATA) no hay frame que procesar
    if (this.video.readyState < 2) return;

    const W = this.rawCanvas.width;
    const H = this.rawCanvas.height;

    this.rawCtx.drawImage(this.video, 0, 0, W, H);

    if (this._state === STATES.CALIBRATING) {
      this.calibration.drawOverlay();
      const n      = this.calibration.corners.length;
      const labels = ['↖ Superior-Izquierda', '↗ Superior-Derecha', '↘ Inferior-Derecha', '↙ Inferior-Izquierda'];
      this._setStatus(`Esquina ${n + 1}/4 — ${labels[n] ?? ''}`);
      return;
    }

    // Detección activa en READY (fuente sin calibrar) y ACTIVE (calibrado)
    if (this._state !== STATES.ACTIVE && this._state !== STATES.READY) return;
    if (!this.pose.isReady || !this.hands.isReady) return;

    this.fpsTracker.tick();
    const ts = performance.now();

    // ── Detección ─────────────────────────────────────────────────────────────
    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    // ── Pointing ──────────────────────────────────────────────────────────────
    const pointing = this.pointingEst.estimate(pose, hands, 'auto');

    // ── Grounding ─────────────────────────────────────────────────────────────
    const gResult = this.grounding.project(pointing, W, H, this._corners);

    // ── Render canvas izquierdo ───────────────────────────────────────────────
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

    // ── Actualizar panel derecho ──────────────────────────────────────────────
    this._updateBadges(pose, hands, pointing);
    this._updateRegion(gResult);
    this._updateCoords(gResult);
    this._updateMetrics(pointing);
  }

  // ── Panel derecho ──────────────────────────────────────────────────────────

  _updateSourceBadge(fileName = null) {
    if (this._source === 'camera') {
      this.badgeSource.textContent = 'Cámara';
      this.badgeSource.className   = 'badge badge-active';
      this.videoControls.style.display = 'none';
    } else if (this._source === 'video') {
      this.badgeSource.textContent = 'Vídeo';
      this.badgeSource.className   = 'badge badge-ok';
    } else {
      this.badgeSource.textContent = 'Sin fuente';
      this.badgeSource.className   = 'badge badge-warn';
    }
  }

  _updateBadges(pose, hands, pointing) {
    const fps = this.fpsTracker.fps;
    this.badgeFps.textContent = `${fps.toFixed(1)} FPS`;
    this.badgeFps.className   = `badge ${fps >= 25 ? 'badge-ok' : fps >= 15 ? 'badge-warn' : ''}`;

    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');
    this.badgeTracking.textContent = parts.length ? parts.join(' · ') : 'Sin detección';
    this.badgeTracking.className   = `badge ${parts.length ? 'badge-active' : 'badge-off'}`;

    this.badgePointing.textContent = pointing.isGesture
      ? `Gesto · ${(pointing.confidence * 100).toFixed(0)}%`
      : 'Sin gesto';
    this.badgePointing.className = `badge ${pointing.isGesture ? 'badge-ok' : 'badge-off'}`;

    this.badgeHands.textContent = pointing.handsReliable ? 'Pose + Hands' : 'Pose only';
    this.badgeHands.className   = `badge ${pointing.handsReliable ? 'badge-active' : 'badge-off'}`;
  }

  _updateRegion(gResult) {
    const calibrated = this._corners !== null;

    if (!calibrated) {
      this.regionNoCalib.style.display = 'block';
      this.regionRowLabel.textContent  = '—';
      this.regionColLabel.textContent  = '';
      this._setRegionZone(null);
      this._highlightCell(null, null);
      return;
    }

    this.regionNoCalib.style.display = 'none';

    if (!gResult) {
      this.regionRowLabel.textContent = '—';
      this.regionColLabel.textContent = '';
      this._setRegionZone(null);
      this._highlightCell(null, null);
      return;
    }

    const { row, col, rowLabel, colLabel } = gResult.region;
    this.regionRowLabel.textContent = rowLabel.toUpperCase();
    this.regionColLabel.textContent = colLabel.toUpperCase();
    this._setRegionZone(row);       // row: 0=superior, 1=medio, 2=inferior
    this._highlightCell(row, col);  // ambos 0-indexed
  }

  _setRegionZone(row) {
    const card   = this.regionCard;
    const rLabel = this.regionRowLabel;
    const cLabel = this.regionColLabel;

    card.classList.remove('active-sup', 'active-med', 'active-inf');
    rLabel.classList.remove('color-sup', 'color-med', 'color-inf');
    cLabel.classList.remove('color-sup', 'color-med', 'color-inf');

    if (row === 0) {
      card.classList.add('active-sup');
      rLabel.classList.add('color-sup');
      cLabel.classList.add('color-sup');
    } else if (row === 1) {
      card.classList.add('active-med');
      rLabel.classList.add('color-med');
      cLabel.classList.add('color-med');
    } else if (row === 2) {
      card.classList.add('active-inf');
      rLabel.classList.add('color-inf');
      cLabel.classList.add('color-inf');
    }
  }

  _highlightCell(rowIdx, colIdx) {
    this.cells.forEach(cell => {
      cell.classList.remove('active-sup', 'active-med', 'active-inf');
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);
      if (r === rowIdx && c === colIdx) {
        if (r === 0)      cell.classList.add('active-sup');
        else if (r === 1) cell.classList.add('active-med');
        else if (r === 2) cell.classList.add('active-inf');
      }
    });
  }

  _updateCoords(gResult) {
    if (!gResult) {
      this.fillX.style.width = '0%';
      this.fillY.style.width = '0%';
      this.valX.textContent  = '—';
      this.valY.textContent  = '—';
      this.coordPx.textContent = '';
      return;
    }

    const { smoothed, hitPx } = gResult;
    this.fillX.style.width = `${(smoothed.x * 100).toFixed(1)}%`;
    this.fillY.style.width = `${(smoothed.y * 100).toFixed(1)}%`;
    this.valX.textContent  = smoothed.x.toFixed(3);
    this.valY.textContent  = smoothed.y.toFixed(3);
    this.coordPx.textContent = `Impacto px: (${Math.round(hitPx.x)}, ${Math.round(hitPx.y)})`;
  }

  _updateMetrics(pointing) {
    const conf = pointing.confidence;
    this.confFill.style.width      = `${(conf * 100).toFixed(1)}%`;
    this.confFill.style.background = conf > 0.7 ? '#4DFF88' : conf > 0.4 ? '#FFD700' : '#FF4D4D';
    this.valConf.textContent       = pointing.isGesture ? `${(conf * 100).toFixed(0)}%` : '—';

    this.valMode.textContent = pointing.mode ?? '—';
    this.valMode.style.color = MODE_COLOR[pointing.mode] ?? '#888';

    this.valSide.textContent = pointing.side === 'Right' ? 'Derecho' : pointing.side === 'Left' ? 'Izquierdo' : '—';
    this.valSide.style.color = pointing.side === 'Right' ? '#FF8888' : '#88aaFF';

    const ext = pointing.extensionAngle;
    this.valExt.textContent = ext != null && ext < 180 ? `${ext.toFixed(1)}°` : '—';
    this.valExt.style.color = ext < 30 ? '#4DFF88' : ext < 90 ? '#FFD700' : '#FF4D4D';

    if (pointing.vector) {
      const deg = Math.atan2(pointing.vector.y, pointing.vector.x) * (180 / Math.PI);
      this.valAngle.textContent = `${deg.toFixed(1)}°`;
    } else {
      this.valAngle.textContent = '—';
    }
    this.valAngle.style.color = '#9ab4f5';

    const reason = pointing.reason ?? 'lost';
    this.valReason.textContent = REASON_LABEL[reason] ?? reason;
    this.valReason.style.color = reason === 'ok' ? '#4DFF88' : '#FF8C4D';
  }

  _clearRightPanel() {
    this.regionRowLabel.textContent  = '—';
    this.regionColLabel.textContent  = '';
    this.regionNoCalib.style.display = 'block';
    this._setRegionZone(null);
    this._highlightCell(null, null);
    this.fillX.style.width = '0%';
    this.fillY.style.width = '0%';
    this.valX.textContent  = '—';
    this.valY.textContent  = '—';
    this.coordPx.textContent = '';
    this.confFill.style.width  = '0%';
    this.valConf.textContent   = '—';
    this.valMode.textContent   = '—';
    this.valSide.textContent   = '—';
    this.valExt.textContent    = '—';
    this.valAngle.textContent  = '—';
    this.valReason.textContent = '—';
  }

  // ── Estado de la app ───────────────────────────────────────────────────────

  _setState(state) {
    this._state = state;

    const msgs = {
      [STATES.LOADING]:     'Cargando…',
      [STATES.READY]:       'Listo · Pulsa "Calibrar pizarra" y haz clic en las 4 esquinas (↖ ↗ ↘ ↙)',
      [STATES.CALIBRATING]: 'Calibrando…',
      [STATES.ACTIVE]:      'Activo · Señala la pizarra con el brazo extendido',
    };
    this._setStatus(msgs[state] ?? '');

    this.calibrateBtn.disabled = state !== STATES.READY;
    this.resetBtn.disabled     = state === STATES.LOADING || state === STATES.READY;

    if (state === STATES.ACTIVE) {
      this.badgeCalib.textContent = 'Calibrado';
      this.badgeCalib.className   = 'badge badge-ok';
    } else if (state === STATES.CALIBRATING) {
      this.badgeCalib.textContent = 'Calibrando…';
      this.badgeCalib.className   = 'badge badge-warn';
    } else {
      this.badgeCalib.textContent = 'Sin calibrar';
      this.badgeCalib.className   = 'badge badge-warn';
    }
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
const startApp = async () => {
  try {
    const app = new ShowcaseApp(window.cv || cv);
    await app.init();
  } catch (err) {
    document.getElementById('status').textContent = 'Error: ' + err.message;
    document.getElementById('status').classList.add('error');
    console.error(err);
  }
};

if (window.cvReady) {
  startApp();
} else {
  window.addEventListener('opencv-ready', startApp);
}
