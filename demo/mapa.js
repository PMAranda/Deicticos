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
import { loadCountries, normToLonLat, findCountry, drawBaseMap, fillCountry, CHANNEL_MAP } from './geo.js';

const RECT_W = 640, RECT_H = 480;
const MAP_W  = 720, MAP_H  = 360;   // proyección equirectangular 2:1
const FPS_NOMINAL = 30;
const CAM_CONSTRAINTS = { video: { width: 960, height: 540, facingMode: 'user' } };

const STATES = Object.freeze({ LOADING:'LOADING', READY:'READY', CALIBRATING:'CALIBRATING', ACTIVE:'ACTIVE' });

class MapaApp {
  constructor(cv) {
    this.cv = cv;
    this.video      = document.getElementById('video');
    this.rawCanvas  = document.getElementById('rawCanvas');
    this.rawCtx     = this.rawCanvas.getContext('2d');
    this.mapCanvas  = document.getElementById('mapCanvas');
    this.mapCtx     = this.mapCanvas.getContext('2d');

    this.statusEl      = document.getElementById('status');
    this.calibBadge    = document.getElementById('calibBadge');
    this.trackingBadge = document.getElementById('trackingBadge');
    this.pointingBadge = document.getElementById('pointingBadge');
    this.fpsBadgeEl    = document.getElementById('fpsBadge');

    this.calibrateBtn = document.getElementById('calibrateBtn');
    this.resetBtn     = document.getElementById('resetBtn');
    this.dwellSlider  = document.getElementById('dwellSlider');
    this.dwellValueEl = document.getElementById('dwellValue');
    this.voiceBtn     = document.getElementById('voiceBtn');

    this.dwellBarWrap  = document.getElementById('dwellBarWrap');
    this.dwellFill     = document.getElementById('dwellFill');
    this.dwellBarLabel = document.getElementById('dwellBarLabel');

    this.countryCard   = document.getElementById('countryCard');
    this.countryNameEl = document.getElementById('countryName');
    this.countryCoords = document.getElementById('countryCoords');

    // Módulos (mismo pipeline de la fase 5)
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
    this.dwell       = new DwellConfirmer(Number(this.dwellSlider.value));

    // Geografía
    this.features    = null;
    this.baseCanvas  = null;

    // Voz
    this.synth        = window.speechSynthesis ?? null;
    this.voiceEnabled = !!this.synth;

    // Sincronización con el mapa a pantalla completa
    this.bc       = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_MAP) : null;
    this._wasLive = false;

    // Estado
    this._state         = STATES.LOADING;
    this._corners       = null;
    this._activeName    = null;     // país confirmado (persistente)
    this._activeFeature = null;

    this.mapCanvas.width  = MAP_W;
    this.mapCanvas.height = MAP_H;

    this._bindControls();
  }

  async init() {
    this._setStatus('Cargando modelos MediaPipe…');
    try { await this.pose.init('VIDEO'); await this.hands.init('VIDEO'); }
    catch (err) { this._setStatus(`Error cargando modelos: ${err.message}`, true); return; }

    this._setStatus('Cargando mapa de países…');
    try {
      this.features   = await loadCountries('data/paises.geojson');
      this.baseCanvas = document.createElement('canvas');
      this.baseCanvas.width = MAP_W; this.baseCanvas.height = MAP_H;
      drawBaseMap(this.baseCanvas.getContext('2d'), this.features, MAP_W, MAP_H);
      this.mapCtx.drawImage(this.baseCanvas, 0, 0);
    } catch (err) { this._setStatus(`Error cargando el mapa: ${err.message}`, true); return; }

    this._setStatus('Cargando cámara…');
    try { await this.camera.start(CAM_CONSTRAINTS); }
    catch (err) { this._setStatus(`Sin acceso a cámara: ${err.message}`, true); return; }

    this.rawCanvas.width  = this.camera.width;
    this.rawCanvas.height = this.camera.height;

    this._setState(STATES.READY);
    this._loop();
  }

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
      if (!this.synth) { this.voiceBtn.disabled = true; this.voiceBtn.textContent = 'Voz no disponible'; }
      this.voiceBtn.addEventListener('click', () => this._toggleVoice());
    }
  }

  _toggleVoice() {
    this.voiceEnabled = !this.voiceEnabled;
    if (!this.voiceEnabled) this.synth?.cancel();
    this.voiceBtn.textContent = this.voiceEnabled ? '🔊 Voz: ON' : '🔇 Voz: OFF';
    this.voiceBtn.classList.toggle('btn-primary', this.voiceEnabled);
  }

  _speak(text) {
    if (!this.voiceEnabled || !this.synth) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
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
    this._activeName = null;
    this._activeFeature = null;
    this.synth?.cancel();
    this.countryNameEl.textContent = 'Calibra y señala el mapa';
    this.countryNameEl.classList.add('none');
    this.countryCoords.textContent = '—';
    this.dwellBarWrap.style.display = 'none';
    this.mapCtx.drawImage(this.baseCanvas, 0, 0);
    this._wasLive = false;
    this.bc?.postMessage({ type: 'reset' });
    this._setState(STATES.READY);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const W = this.rawCanvas.width, H = this.rawCanvas.height;
    this.rawCtx.drawImage(this.video, 0, 0, W, H);

    if (this._state === STATES.CALIBRATING) {
      this.calibration.drawOverlay();
      const n = this.calibration.corners.length;
      const labels = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
      this._setStatus(`Calibrando: haz clic en esquina ${n + 1}/4 — ${labels[n] ?? ''}`);
      return;
    }
    if (this._state !== STATES.ACTIVE) return;
    if (!this.pose.isReady || !this.hands.isReady) return;

    this.fpsTracker.tick();
    const ts = performance.now();
    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    const pointing    = this.pointingEst.estimate(pose, hands, 'auto');
    const dwellResult = this.dwell.update(pointing.isGesture);
    const gResult     = this.grounding.project(pointing, W, H, this._corners);
    this.impactTrack.update(gResult);

    // País bajo el rayo (solo cuando hay gesto)
    let hotFeature = null, lonLat = null;
    if (pointing.isGesture && gResult) {
      lonLat = normToLonLat(gResult.xn, gResult.yn);
      hotFeature = findCountry(lonLat.lon, lonLat.lat, this.features);
    }

    // Render vista cámara
    this.bodyRdr.drawArmSkeleton(this.rawCtx, pose, W, H);
    if (hands.Left)  this.bodyRdr.drawHandLandmarks(this.rawCtx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.bodyRdr.drawHandLandmarks(this.rawCtx, hands.Right, 'Right', W, H);
    this.pointingRdr.drawPointingRay(this.rawCtx, pointing, W, H);
    this.calibration.drawOverlay();
    if (gResult) this.groundRdr.drawRayToBoard(this.rawCtx, pointing.origin, gResult.hitPx, W, H);

    // Emite el punto en vivo al mapa a pantalla completa
    if (pointing.isGesture && gResult) {
      this.bc?.postMessage({ type: 'live', xn: gResult.xn, yn: gResult.yn });
      this._wasLive = true;
    } else if (this._wasLive) {
      this.bc?.postMessage({ type: 'live', xn: null, yn: null });
      this._wasLive = false;
    }

    // Confirmación → país persistente + voz
    if (dwellResult.isConfirmed && gResult) {
      const name = hotFeature ? hotFeature._name : 'Aguas internacionales';
      if (name !== this._activeName) {
        this._activeName    = name;
        this._activeFeature = hotFeature;
        this._showCountry(name, !!hotFeature);
        this._speak(name);
        this.bc?.postMessage({ type: 'confirm', xn: gResult.xn, yn: gResult.yn });
      }
    }

    // Render mapa de referencia
    this._drawMap(hotFeature, gResult);

    // Coordenadas en vivo
    this.countryCoords.textContent = lonLat
      ? `lon ${lonLat.lon.toFixed(1)}°  ·  lat ${lonLat.lat.toFixed(1)}°` +
        (hotFeature ? `  →  ${hotFeature._name}` : '  →  océano')
      : '—';

    this._updateDwellBar(dwellResult, pointing.isGesture);
    this._updateBadges(pose, hands, pointing, dwellResult);
  }

  _drawMap(hotFeature, gResult) {
    const ctx = this.mapCtx;
    ctx.drawImage(this.baseCanvas, 0, 0);
    if (this._activeFeature)
      fillCountry(ctx, this._activeFeature, MAP_W, MAP_H, 'rgba(217,164,65,0.55)', '#d9a441');
    if (hotFeature && hotFeature !== this._activeFeature)
      fillCountry(ctx, hotFeature, MAP_W, MAP_H, 'rgba(217,164,65,0.22)');
    if (gResult) {
      const x = gResult.xn * MAP_W, y = gResult.yn * MAP_H;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#d9a441'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(217,164,65,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  _showCountry(name, isLand) {
    this.countryNameEl.textContent = name;
    this.countryNameEl.classList.toggle('none', !isLand);
  }

  _updateDwellBar(dwellResult, isGesture) {
    if (!isGesture || dwellResult.isConfirmed) { this.dwellBarWrap.style.display = 'none'; return; }
    this.dwellBarWrap.style.display = 'flex';
    this.dwellFill.style.width = `${(dwellResult.progress * 100).toFixed(1)}%`;
    const remaining = ((this.dwell.dwellFrames - dwellResult.count) / FPS_NOMINAL).toFixed(1);
    this.dwellBarLabel.textContent = `Manteniendo… ${remaining} s`;
  }

  _updateBadges(pose, hands, pointing, dwellResult) {
    const parts = [];
    if (pose) parts.push('Pose');
    if (hands.Left) parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');
    this.trackingBadge.textContent = parts.length ? parts.join(' · ') : 'Sin detección';
    this.trackingBadge.className   = `badge ${parts.length ? 'badge-active' : 'badge-off'}`;

    if (dwellResult.isConfirmed && this._activeName) {
      this.pointingBadge.textContent = `✓ ${this._activeName}`;
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

  _setState(state) {
    this._state = state;
    const msgs = {
      [STATES.LOADING]:     'Cargando…',
      [STATES.READY]:       'Listo. Pulsa «Calibrar mapa» y selecciona las 4 esquinas del planisferio (↖ ↗ ↘ ↙)',
      [STATES.CALIBRATING]: 'Calibrando…',
      [STATES.ACTIVE]:      'Activo — señala un país y mantén el gesto para confirmarlo',
    };
    this._setStatus(msgs[state] ?? '');
    this.calibrateBtn.disabled = state !== STATES.READY;
    this.resetBtn.disabled     = state === STATES.LOADING || state === STATES.READY;

    if (state === STATES.ACTIVE)        { this.calibBadge.textContent = 'Calibrado';   this.calibBadge.className = 'badge badge-ok'; }
    else if (state === STATES.CALIBRATING) { this.calibBadge.textContent = 'Calibrando…'; this.calibBadge.className = 'badge badge-warn'; }
    else                                { this.calibBadge.textContent = 'Sin calibrar'; this.calibBadge.className = 'badge badge-warn'; }
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

const startApp = async () => {
  try {
    document.getElementById('status').textContent = 'Iniciando…';
    const app = new MapaApp(window.cv || cv);
    await app.init();
  } catch (err) {
    document.getElementById('status').textContent = 'Error arrancando: ' + err.message;
    document.getElementById('status').classList.add('error');
    console.error(err);
  }
};

if (window.cvReady) startApp();
else window.addEventListener('opencv-ready', startApp);
