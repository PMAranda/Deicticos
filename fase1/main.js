import { CameraModule }     from '../src/modules/homografia/camera.js';
import { CalibrationModule } from '../src/modules/homografia/calibration.js';
import { HomographyModule }  from '../src/modules/homografia/homography.js';
import { CoordinateSystem }  from '../src/modules/homografia/coordinates.js';

const STATES = Object.freeze({ IDLE: 'IDLE', CALIBRATING: 'CALIBRATING', CALIBRATED: 'CALIBRATED' });

const RECT_W = 640;
const RECT_H = 480;

class Fase1App {
  constructor(cv) {
    this.cv = cv;

    this.video        = document.getElementById('video');
    this.rawCanvas    = document.getElementById('rawCanvas');
    this.rectCanvas   = document.getElementById('rectCanvas');
    this.statusEl     = document.getElementById('status');
    this.calibrateBtn = document.getElementById('calibrateBtn');
    this.resetBtn     = document.getElementById('resetBtn');
    this.coordsEl     = document.getElementById('coords');

    this.rawCtx  = this.rawCanvas.getContext('2d');
    this.rectCtx = this.rectCanvas.getContext('2d');

    this.camera       = new CameraModule(this.video);
    this.calibration  = new CalibrationModule(this.rawCanvas);
    this.homography   = new HomographyModule(cv);
    this.coordSystem  = new CoordinateSystem(3, 3);

    this.state          = STATES.IDLE;
    this.lastClickedRef = null;

    this._bindEvents();
  }

  async start() {
    try {
      await this.camera.start();
    } catch (err) {
      this.statusEl.textContent = `Error: ${err.message}`;
      this.statusEl.classList.add('error');
      return;
    }

    this.rawCanvas.width   = this.camera.width;
    this.rawCanvas.height  = this.camera.height;
    this.rectCanvas.width  = RECT_W;
    this.rectCanvas.height = RECT_H;

    this._setState(STATES.IDLE);
    this._loop();
  }

  _bindEvents() {
    this.calibrateBtn.addEventListener('click', () => this._startCalibration());
    this.resetBtn.addEventListener('click',     () => this._reset());
    this.rectCanvas.addEventListener('click',    e  => this._onRectClick(e));
  }

  _startCalibration() {
    this._setState(STATES.CALIBRATING);
    this.calibration.start(corners => {
      this.homography.compute(corners, RECT_W, RECT_H);
      this.lastClickedRef = null;
      this._setState(STATES.CALIBRATED);
    });
  }

  _reset() {
    this.calibration.reset();
    this.homography.dispose();
    this.lastClickedRef = null;
    this.coordsEl.innerHTML = '';
    this._setState(STATES.IDLE);
  }

  _onRectClick(event) {
    if (this.state !== STATES.CALIBRATED) return;
    const rect   = this.rectCanvas.getBoundingClientRect();
    const scaleX = this.rectCanvas.width  / rect.width;
    const scaleY = this.rectCanvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top)  * scaleY;
    this.lastClickedRef = { px: x, py: y,
      ...this.coordSystem.toSpatialReference(x, y, RECT_W, RECT_H) };
    this._renderCoords(this.lastClickedRef);
  }

  _setState(state) {
    this.state = state;
    const messages = {
      [STATES.IDLE]:        'Pulsa "Calibrar" y selecciona las 4 esquinas de la pizarra (↖ ↗ ↘ ↙)',
      [STATES.CALIBRATING]: 'Selecciona esquina 1/4 (↖ Superior-Izquierda)',
      [STATES.CALIBRATED]:  'Calibración completada · Haz clic en la vista rectificada para ver coordenadas',
    };
    this.statusEl.textContent = messages[state];
    this.statusEl.classList.remove('error');
    this.calibrateBtn.disabled = state !== STATES.IDLE;
    this.resetBtn.disabled     = state === STATES.IDLE;
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this.rawCtx.drawImage(this.video, 0, 0, this.rawCanvas.width, this.rawCanvas.height);

    if (this.state === STATES.CALIBRATING) {
      const n      = this.calibration.corners.length;
      const labels = ['↖ Superior-Izquierda', '↗ Superior-Derecha', '↘ Inferior-Derecha', '↙ Inferior-Izquierda'];
      this.statusEl.textContent = `Selecciona esquina ${n + 1}/4: ${labels[n]}`;
      this.calibration.drawOverlay();
    }

    if (this.state === STATES.CALIBRATED) {
      this.calibration.drawOverlay();
      this._drawRectified();
    }
  }

  _drawRectified() {
    const cv  = this.cv;
    const src = cv.imread(this.rawCanvas);
    let warped;
    try {
      warped = this.homography.warpFrame(src);
      cv.imshow(this.rectCanvas, warped);
    } finally {
      src.delete();
      if (warped) warped.delete();
    }
    if (this.lastClickedRef) {
      this.coordSystem.highlightRegion(this.rectCtx,
        this.lastClickedRef.col, this.lastClickedRef.row, RECT_W, RECT_H);
    }
    this.coordSystem.drawGrid(this.rectCtx, RECT_W, RECT_H);
    if (this.lastClickedRef) this._drawClickMarker(this.lastClickedRef.px, this.lastClickedRef.py);
  }

  _drawClickMarker(x, y) {
    const ctx = this.rectCtx;
    ctx.save();
    const sz = 10;
    ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - sz, y); ctx.lineTo(x + sz, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - sz); ctx.lineTo(x, y + sz); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  _renderCoords(ref) {
    this.coordsEl.innerHTML = `
      <div class="coord-row">
        <span class="coord-label">Coordenadas normalizadas</span>
        <span class="coord-value">(${ref.xn.toFixed(4)},  ${ref.yn.toFixed(4)})</span>
      </div>
      <div class="coord-row">
        <span class="coord-label">Región</span>
        <span class="coord-value coord-region">${ref.label}</span>
      </div>
      <div class="coord-row">
        <span class="coord-label">Celda en rejilla</span>
        <span class="coord-value">fila ${ref.row} · columna ${ref.col}</span>
      </div>
      <div class="coord-row">
        <span class="coord-label">Píxel en plano rectificado</span>
        <span class="coord-value">(${Math.round(ref.px)}, ${Math.round(ref.py)})</span>
      </div>
    `;
  }
}

window.addEventListener('opencv-ready', async () => {
  const app = new Fase1App(window.cv);
  await app.start();
});
