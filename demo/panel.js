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
import { BoardGrounding }    from '../src/modules/grounding/grounding.js';
import { GroundingRenderer } from '../src/modules/grounding/renderer.js';
import { ImpactTracker }     from '../src/modules/grounding/metricas.js';
import { DwellConfirmer }    from '../src/modules/semantica/dwell.js';
import { CONTENT, GRID_ORDER, CHANNEL } from './contenido.js';

const RECT_W  = 640;
const RECT_H  = 480;
const FPS_NOMINAL = 30;
const CAM_CONSTRAINTS = { video: { width: 960, height: 540, facingMode: 'user' } };

const STATES = Object.freeze({
  LOADING: 'LOADING', READY: 'READY', CALIBRATING: 'CALIBRATING', ACTIVE: 'ACTIVE',
});

class PanelApp {
  constructor(cv) {
    this.cv = cv;

    // ── DOM ──────────────────────────────────────────────────────────────────
    this.video      = document.getElementById('video');
    this.rawCanvas  = document.getElementById('rawCanvas');
    this.rawCtx     = this.rawCanvas.getContext('2d');

    this.statusEl      = document.getElementById('status');
    this.calibBadge    = document.getElementById('calibBadge');
    this.trackingBadge = document.getElementById('trackingBadge');
    this.pointingBadge = document.getElementById('pointingBadge');
    this.fpsBadgeEl    = document.getElementById('fpsBadge');

    this.calibrateBtn = document.getElementById('calibrateBtn');
    this.resetBtn     = document.getElementById('resetBtn');
    this.dwellSlider  = document.getElementById('dwellSlider');
    this.dwellValueEl = document.getElementById('dwellValue');

    this.dwellBarWrap  = document.getElementById('dwellBarWrap');
    this.dwellFill     = document.getElementById('dwellFill');
    this.dwellBarLabel = document.getElementById('dwellBarLabel');

    this.contentCard = document.getElementById('contentCard');
    this.miniGridEl  = document.getElementById('miniGrid');
    this.voiceBtn    = document.getElementById('voiceBtn');

    // ── Voz (TTS) y sincronización con el tablero ────────────────────────────
    this.synth        = window.speechSynthesis ?? null;
    this.voiceEnabled = !!this.synth;
    this.bc           = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL) : null;
    this._lastHot     = null;

    // ── Módulos (mismo pipeline robusto que la fase 5) ───────────────────────
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
    this.impactTrack = new ImpactTracker(30);

    this.dwell = new DwellConfirmer(Number(this.dwellSlider.value));

    // ── Estado ───────────────────────────────────────────────────────────────
    this._state       = STATES.LOADING;
    this._corners     = null;
    this._activeLabel = null;   // región confirmada actualmente mostrada (persistente)
    this._cells       = new Map();

    this._buildMiniGrid();
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
      await this.camera.start(CAM_CONSTRAINTS);
    } catch (err) {
      this._setStatus(`Sin acceso a cámara: ${err.message}`, true);
      return;
    }

    this.rawCanvas.width  = this.camera.width;
    this.rawCanvas.height = this.camera.height;

    this._setState(STATES.READY);
    this._loop();
  }

  // ── Mini-rejilla ─────────────────────────────────────────────────────────────
  _buildMiniGrid() {
    this.miniGridEl.innerHTML = '';
    for (const label of GRID_ORDER) {
      const c    = CONTENT[label] ?? { img: '', title: label };
      const cell = document.createElement('div');
      cell.className = 'mini-cell';
      cell.dataset.region = label;
      cell.innerHTML = `<img class="mc-img" src="${c.img}" alt="${c.title}" draggable="false"><span class="mc-name">${c.title}</span>`;
      this.miniGridEl.appendChild(cell);
      this._cells.set(label, cell);
    }
  }

  // ── Controles ────────────────────────────────────────────────────────────────
  _bindControls() {
    this.calibrateBtn.addEventListener('click', () => this._startCalibration());
    this.resetBtn.addEventListener('click',     () => this._reset());

    this.dwellSlider.addEventListener('input', () => {
      const n = Number(this.dwellSlider.value);
      this.dwell.setDwellFrames(n);
      const secs = (n / FPS_NOMINAL).toFixed(1);
      this.dwellValueEl.textContent = n === 0 ? '0 f (inmediato)' : `${n} f (~${secs} s)`;
    });

    if (this.voiceBtn) {
      if (!this.synth) {
        this.voiceBtn.disabled = true;
        this.voiceBtn.textContent = 'Voz no disponible';
      }
      this.voiceBtn.addEventListener('click', () => this._toggleVoice());
    }
  }

  _toggleVoice() {
    this.voiceEnabled = !this.voiceEnabled;
    if (!this.voiceEnabled) this.synth?.cancel();
    this.voiceBtn.textContent = this.voiceEnabled ? '🔊 Voz: ON' : '🔇 Voz: OFF';
    this.voiceBtn.classList.toggle('btn-primary', this.voiceEnabled);
  }

  _speak(c) {
    if (!this.voiceEnabled || !this.synth) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(`${c.title}. ${c.body}`);
    u.lang = 'es-ES';
    u.rate = 1.0;
    this.synth.speak(u);
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
    this.calibration.reset();
    this.homography.dispose();
    this._corners = null;
    this.grounding.reset();
    this.impactTrack.clear();
    this.pointingEst.reset();
    this.dwell.reset();
    this._activeLabel = null;
    this._clearContent();
    this._highlightCells(null, null);
    this.dwellBarWrap.style.display = 'none';
    this.synth?.cancel();
    this.bc?.postMessage({ type: 'reset' });
    this._setState(STATES.READY);
  }

  // ── Loop principal ───────────────────────────────────────────────────────────
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

    // ── Detección + pointing + dwell + grounding ────────────────────────────────
    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    const pointing    = this.pointingEst.estimate(pose, hands, 'auto');
    const dwellResult = this.dwell.update(pointing.isGesture);
    const gResult     = this.grounding.project(pointing, W, H, this._corners);
    this.impactTrack.update(gResult);

    // ── Render vista cámara ─────────────────────────────────────────────────────
    this.bodyRdr.drawArmSkeleton(this.rawCtx, pose, W, H);
    if (hands.Left)  this.bodyRdr.drawHandLandmarks(this.rawCtx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.bodyRdr.drawHandLandmarks(this.rawCtx, hands.Right, 'Right', W, H);
    this.pointingRdr.drawPointingRay(this.rawCtx, pointing, W, H);
    this.calibration.drawOverlay();
    if (gResult) {
      this.groundRdr.drawRayToBoard(this.rawCtx, pointing.origin, gResult.hitPx, W, H);
    }

    // ── Confirmación de región → contenido persistente ──────────────────────────
    if (dwellResult.isConfirmed && gResult) {
      const label = gResult.region.label;
      if (label !== this._activeLabel) {
        this._activeLabel = label;
        this._showContent(label);
        this.bc?.postMessage({ type: 'confirm', label });
        if (CONTENT[label]) this._speak(CONTENT[label]);
      }
    }

    // ── Feedback visual ─────────────────────────────────────────────────────────
    const hotLabel = pointing.isGesture && gResult ? gResult.region.label : null;
    this._highlightCells(this._activeLabel, hotLabel);
    this._updateDwellBar(dwellResult, pointing.isGesture);
    this._updateBadges(pose, hands, pointing, dwellResult);
  }

  // ── Ficha de contenido ───────────────────────────────────────────────────────
  _showContent(label) {
    const c = CONTENT[label];
    if (!c) { this._clearContent(); return; }
    this.contentCard.classList.remove('empty');
    this.contentCard.innerHTML = `
      <div class="content-eyebrow">Región · ${label}</div>
      <img class="content-img" src="${c.img}" alt="${c.title}" draggable="false">
      <div class="content-title">${c.title}</div>
      <p class="content-body">${c.body}</p>`;
    // Reinicia la animación de entrada
    this.contentCard.style.animation = 'none';
    void this.contentCard.offsetWidth;
    this.contentCard.style.animation = 'fade-in 0.25s ease';
  }

  _clearContent() {
    this.contentCard.classList.add('empty');
    this.contentCard.innerHTML = `
      <div>
        <div class="content-empty-icon">◎</div>
        <p class="content-empty-msg">Calibra el panel y señala una de las<br>9 zonas para ver su contenido</p>
      </div>`;
  }

  // ── Resaltado de la mini-rejilla ─────────────────────────────────────────────
  _highlightCells(activeLabel, hotLabel) {
    for (const [label, cell] of this._cells) {
      cell.classList.toggle('active', label === activeLabel);
      cell.classList.toggle('hot', label === hotLabel && label !== activeLabel);
    }
    // Propaga al tablero solo cuando cambia la región apuntada (evita spam por frame)
    if (hotLabel !== this._lastHot) {
      this._lastHot = hotLabel;
      this.bc?.postMessage({ type: 'hot', label: hotLabel });
    }
  }

  // ── Barra de dwell ───────────────────────────────────────────────────────────
  _updateDwellBar(dwellResult, isGesture) {
    if (!isGesture || dwellResult.isConfirmed) {
      this.dwellBarWrap.style.display = 'none';
      return;
    }
    this.dwellBarWrap.style.display = 'flex';
    this.dwellFill.style.width = `${(dwellResult.progress * 100).toFixed(1)}%`;
    const remaining = ((this.dwell.dwellFrames - dwellResult.count) / FPS_NOMINAL).toFixed(1);
    this.dwellBarLabel.textContent = `Manteniendo… ${remaining} s`;
  }

  // ── Badges ───────────────────────────────────────────────────────────────────
  _updateBadges(pose, hands, pointing, dwellResult) {
    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');
    this.trackingBadge.textContent = parts.length ? parts.join(' · ') : 'Sin detección';
    this.trackingBadge.className   = `badge ${parts.length ? 'badge-active' : 'badge-off'}`;

    if (dwellResult.isConfirmed && this._activeLabel) {
      this.pointingBadge.textContent = `✓ ${this._activeLabel}`;
      this.pointingBadge.className   = 'badge badge-ok';
    } else if (pointing.isGesture) {
      this.pointingBadge.textContent = `Apuntando (${(pointing.confidence * 100).toFixed(0)}%)`;
      this.pointingBadge.className   = 'badge badge-dwell';
    } else {
      this.pointingBadge.textContent = 'Sin gesto';
      this.pointingBadge.className   = 'badge badge-off';
    }

    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className   = `badge ${fps >= 25 ? 'badge-ok' : fps >= 15 ? 'badge-warn' : ''}`;
  }

  // ── Estado ───────────────────────────────────────────────────────────────────
  _setState(state) {
    this._state = state;
    const msgs = {
      [STATES.LOADING]:     'Cargando modelos y cámara…',
      [STATES.READY]:       'Listo. Pulsa «Calibrar panel» y selecciona las 4 esquinas del póster (↖ ↗ ↘ ↙)',
      [STATES.CALIBRATING]: 'Calibrando…',
      [STATES.ACTIVE]:      'Activo — señala una zona del panel y mantén el gesto para confirmar',
    };
    this._setStatus(msgs[state] ?? '');

    this.calibrateBtn.disabled = state !== STATES.READY;
    this.resetBtn.disabled     = state === STATES.LOADING || state === STATES.READY;

    if (state === STATES.ACTIVE) {
      this.calibBadge.textContent = 'Calibrado'; this.calibBadge.className = 'badge badge-ok';
    } else if (state === STATES.CALIBRATING) {
      this.calibBadge.textContent = 'Calibrando…'; this.calibBadge.className = 'badge badge-warn';
    } else {
      this.calibBadge.textContent = 'Sin calibrar'; this.calibBadge.className = 'badge badge-warn';
    }
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────────
const startApp = async () => {
  try {
    document.getElementById('status').textContent = 'Iniciando…';
    const app = new PanelApp(window.cv || cv);
    await app.init();
  } catch (err) {
    document.getElementById('status').textContent = 'Error arrancando: ' + err.message;
    document.getElementById('status').classList.add('error');
    console.error(err);
  }
};

if (window.cvReady) startApp();
else window.addEventListener('opencv-ready', startApp);
