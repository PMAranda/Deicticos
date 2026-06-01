import { CameraModule }           from '../src/modules/homografia/camera.js';
import { CalibrationModule }       from '../src/modules/homografia/calibration.js';
import { HomographyModule }        from '../src/modules/homografia/homography.js';
import { CoordinateSystem }        from '../src/modules/homografia/coordinates.js';
import { PoseEstimator }           from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }           from '../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks } from '../src/modules/estimacion_corporal/landmarks.js';
import { LandmarkRenderer }        from '../src/modules/estimacion_corporal/renderer.js';
import { PointingEstimator }       from '../src/modules/heuristica/pointing.js';
import { PointingRenderer }        from '../src/modules/heuristica/renderer.js';
import { BoardGrounding }          from '../src/modules/grounding/grounding.js';
import { GroundingRenderer }       from '../src/modules/grounding/renderer.js';
import { DwellConfirmer }          from '../src/modules/semantica/dwell.js';

// ── Constantes ────────────────────────────────────────────────────────────
const RECT_W  = 640;
const RECT_H  = 480;
const BOARD_W = 320;
const BOARD_H = 240;
const FPS_NOMINAL = 30;

const REGIONS = [
  'superior-izquierda', 'superior-centro',  'superior-derecha',
  'medio-izquierda',    'medio-centro',      'medio-derecha',
  'inferior-izquierda', 'inferior-centro',   'inferior-derecha',
];
const REGION_IDX = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
const REGION_COLORS = [
  '#4477EE', '#5599FF', '#66BBFF',
  '#22BB66', '#33DD88', '#44FFAA',
  '#FF8833', '#FFAA44', '#FFCC66',
];
const REGION_COLOR = Object.fromEntries(REGIONS.map((r, i) => [r, REGION_COLORS[i]]));
const SHORT = {
  'superior-izquierda':'sup-izq','superior-centro':'sup-ctr','superior-derecha':'sup-der',
  'medio-izquierda':'med-izq',   'medio-centro':'med-ctr',   'medio-derecha':'med-der',
  'inferior-izquierda':'inf-izq','inferior-centro':'inf-ctr','inferior-derecha':'inf-der',
};

// Estados del protocolo
const S = Object.freeze({
  LOADING:    'LOADING',
  CALIBRATING:'CALIBRATING',
  READY:      'READY',
  WAITING:    'WAITING',    // calibrado, esperando ESPACIO para iniciar la región
  RECORDING:  'RECORDING',  // grabando frames para la región actual
  DONE:       'DONE',
});

// ── App ───────────────────────────────────────────────────────────────────
class ProtocoloApp {
  constructor() {
    // DOM
    this.video         = document.getElementById('video');
    this.rawCanvas     = document.getElementById('rawCanvas');
    this.boardCanvas   = document.getElementById('boardCanvas');
    this.rawCtx        = this.rawCanvas.getContext('2d');
    this.boardCtx      = this.boardCanvas.getContext('2d');
    this.statusEl      = document.getElementById('status');
    this.calibBadge    = document.getElementById('calibBadge');
    this.trackingBadge = document.getElementById('trackingBadge');
    this.fpsBadgeEl    = document.getElementById('fpsBadge');
    this.configBar     = document.getElementById('configBar');
    this.dwellSlider   = document.getElementById('dwellSlider');
    this.dwellValueEl  = document.getElementById('dwellValue');

    // Protocol panels
    this.calibPanel    = document.getElementById('calibPanel');
    this.calibInstr    = document.getElementById('calibInstructions');
    this.recalibBtn    = document.getElementById('recalibBtn');
    this.readyPanel    = document.getElementById('readyPanel');
    this.waitPanel     = document.getElementById('waitPanel');
    this.recordPanel   = document.getElementById('recordPanel');
    this.donePanel     = document.getElementById('donePanel');

    this.progressFill   = document.getElementById('progressFill');
    this.regionCounter  = document.getElementById('regionCounter');
    this.waitRegionName = document.getElementById('waitRegionName');
    this.regionGrid     = document.getElementById('regionGrid');
    this.recRegionName  = document.getElementById('recRegionName');
    this.recFramesEl    = document.getElementById('recFrames');
    this.dwellBar       = document.getElementById('dwellBar');
    this.dwellFill      = document.getElementById('dwellFill');
    this.confirmedBadge = document.getElementById('confirmedBadge');
    this.doneSummary    = document.getElementById('doneSummary');
    this.exportBtn      = document.getElementById('exportBtn');
    this.restartBtn     = document.getElementById('restartBtn');

    this.quickResults   = document.getElementById('quickResults');
    this.quickPills     = document.getElementById('quickPills');
    this.matrixCanvas   = document.getElementById('matrixCanvas');

    // Módulos
    this.camera      = new CameraModule(this.video);
    this.calibration = null;
    this.homography  = null;
    this.coordSystem = new CoordinateSystem(3, 3);
    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.pointingEst = new PointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.grounding   = null;
    this.groundRdr   = new GroundingRenderer();
    this.dwell       = new DwellConfirmer(15);

    // Estado
    this._state       = S.LOADING;
    this._cvReady     = false;
    this._mpReady     = false;
    this._corners     = null;
    this._currentIdx  = 0;       // índice de la región actual en REGIONS[]
    this._allFrames   = [];      // todos los frames grabados con GT
    this._recFrames   = 0;       // frames grabados en la región actual
    this._frameCount  = 0;       // contador global de frames

    this.boardCanvas.width  = BOARD_W;
    this.boardCanvas.height = BOARD_H;

    this._buildGrid();
    this._bindEvents();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  onOpenCVReady(cv) {
    this.homography  = new HomographyModule(cv);
    this.calibration = new CalibrationModule(this.rawCanvas);
    this.grounding   = new BoardGrounding(this.homography, this.coordSystem);
    this._cvReady    = true;
    this._checkReady();
  }

  async initMediaPipe() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await this.pose.init('VIDEO');
      await this.hands.init('VIDEO');
      this._mpReady = true;
      this._checkReady();
    } catch (err) { this._setStatus(`Error MediaPipe: ${err.message}`, true); }
  }

  async _checkReady() {
    if (!this._cvReady || !this._mpReady) return;
    this._setStatus('Cargando cámara…');
    try {
      await this.camera.start();
    } catch (err) { this._setStatus(`Sin acceso a cámara: ${err.message}`, true); return; }

    this.rawCanvas.width  = this.camera.width;
    this.rawCanvas.height = this.camera.height;
    this.configBar.style.display = 'flex';
    this._startCalibration();
    this._loop();
  }

  // ── Controles ─────────────────────────────────────────────────────────────

  _bindEvents() {
    this.recalibBtn.addEventListener('click', () => this._startCalibration());
    this.exportBtn.addEventListener('click',  () => this._exportCSV());
    this.restartBtn.addEventListener('click', () => this._restart());

    this.dwellSlider.addEventListener('input', () => {
      const n = Number(this.dwellSlider.value);
      this.dwell.setDwellFrames(n);
      const s = (n / FPS_NOMINAL).toFixed(1);
      this.dwellValueEl.textContent = n === 0 ? '0 f (inmediato)' : `${n} f (~${s} s)`;
    });

    document.addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); this._onSpace(); }
      if (e.code === 'Backspace') { e.preventDefault(); this._onBackspace(); }
      if (e.code === 'Escape') { e.preventDefault(); this._onEscape(); }
    });
  }

  _onSpace() {
    if (this._state === S.READY) {
      this._currentIdx = 0;
      this._setState(S.WAITING);
    } else if (this._state === S.WAITING) {
      // Empezar a grabar la región actual
      this._recFrames = 0;
      this.dwell.reset();
      this._setState(S.RECORDING);
    } else if (this._state === S.RECORDING) {
      // Terminar región actual y avanzar
      this._currentIdx++;
      if (this._currentIdx >= REGIONS.length) {
        this._setState(S.DONE);
      } else {
        this.dwell.reset();
        this._setState(S.WAITING);
      }
    }
  }

  _onBackspace() {
    if (this._state === S.WAITING && this._currentIdx > 0) {
      // Borrar frames de la región anterior y volver a grabarla
      const prevRegion = REGIONS[this._currentIdx - 1];
      this._allFrames = this._allFrames.filter(f => f.gtRegion !== prevRegion);
      this._currentIdx--;
      this.dwell.reset();
      this._setState(S.WAITING);
    } else if (this._state === S.RECORDING) {
      // Cancelar grabación de la región actual
      this._allFrames = this._allFrames.filter(f => f.gtRegion !== REGIONS[this._currentIdx]);
      this.dwell.reset();
      this._setState(S.WAITING);
    }
  }

  _onEscape() {
    if (this._state === S.RECORDING) {
      this._allFrames = this._allFrames.filter(f => f.gtRegion !== REGIONS[this._currentIdx]);
      this.dwell.reset();
      this._setState(S.WAITING);
    }
  }

  // ── Calibración ───────────────────────────────────────────────────────────

  _startCalibration() {
    this._setState(S.CALIBRATING);
    this._corners = null;
    if (this.homography?.isReady) this.homography.dispose();
    this.calibration.reset();
    this.grounding?.reset();
    this.groundRdr.clearTrail();
    this.pointingEst.reset();

    this.calibration.start(corners => {
      this._corners = corners;
      this.homography.compute(corners, RECT_W, RECT_H);
      this._setState(S.READY);
      this.recalibBtn.style.display = 'inline-block';
      this.calibInstr.textContent   = '✓ Calibrado';
      this._setCalibBadge(true);
    });

    const LABELS = ['↖ Superior-Izq', '↗ Superior-Der', '↘ Inferior-Der', '↙ Inferior-Izq'];
    this._setCalibBadge(false);
    this._setStatus('Haz clic en las 4 esquinas de la pizarra (↖ ↗ ↘ ↙)');
    this.calibInstr.textContent = 'Haz clic en las 4 esquinas: ↖ ↗ ↘ ↙';

    const calibUpdate = () => {
      if (this._state !== S.CALIBRATING) return;
      const n = this.calibration.corners?.length ?? 0;
      this.calibInstr.textContent = n < 4
        ? `Haz clic en esquina ${n + 1}/4 — ${LABELS[n] ?? ''}` : 'Procesando…';
      requestAnimationFrame(calibUpdate);
    };
    requestAnimationFrame(calibUpdate);
  }

  // ── Loop principal ────────────────────────────────────────────────────────

  _loop() {
    requestAnimationFrame(() => this._loop());

    const W = this.rawCanvas.width;
    const H = this.rawCanvas.height;
    this.rawCtx.drawImage(this.video, 0, 0, W, H);

    if (this._state === S.CALIBRATING) {
      this.calibration.drawOverlay();
      return;
    }
    if (this._state === S.LOADING || this._state === S.READY) return;
    if (!this.pose.isReady || !this.hands.isReady) return;

    const ts = performance.now();
    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);

    const pointing = this.pointingEst.estimate(pose, hands, 'auto');
    const gResult  = this.grounding.project(pointing, W, H, this._corners);
    const dwellRes = this.dwell.update(pointing.isGesture);

    // Guardar frame con GT si estamos grabando
    if (this._state === S.RECORDING) {
      this._recFrames++;
      this._allFrames.push({
        frame:     this._frameCount,
        ts:        parseFloat((ts / 1000).toFixed(4)),
        gtRegion:  REGIONS[this._currentIdx],
        isGesture: pointing.isGesture,
        confidence: parseFloat((pointing.confidence * 100).toFixed(1)),
        mode:           pointing.mode ?? 'lost',
        confirmed:      dwellRes.isConfirmed,
        region:         gResult?.region?.label ?? '',
        xn:             gResult != null ? parseFloat(gResult.xn.toFixed(4)) : '',
        yn:             gResult != null ? parseFloat(gResult.yn.toFixed(4)) : '',
        modoGrounding:  gResult != null ? (gResult.fingertipDirect ? 'fingertip' : 'raycast') : '',
        handsReliable:  pointing.handsReliable ? 'Sí' : 'No',
      });
      this._updateRecordUI(dwellRes);
    }
    this._frameCount++;

    // Render
    this.bodyRdr.drawArmSkeleton(this.rawCtx, pose, W, H);
    this.pointingRdr.drawPointingRay(this.rawCtx, pointing, W, H);
    this.calibration.drawOverlay();
    if (gResult) {
      this.groundRdr.drawRayToBoard(this.rawCtx, pointing.origin, gResult.hitPx, W, H);
      const showResult = this._state === S.RECORDING && dwellRes.isConfirmed ? gResult : null;
      this.groundRdr.drawBoardImpact(this.boardCtx, showResult, this.coordSystem, BOARD_W, BOARD_H);
    }

    // Badges
    const hasPose = pose !== null;
    this.trackingBadge.textContent = hasPose ? 'Pose ✓' : 'Sin detección';
    this.trackingBadge.className   = `badge ${hasPose ? 'badge-active' : 'badge-off'}`;
  }

  // ── UI de estado ──────────────────────────────────────────────────────────

  _setState(state) {
    this._state = state;
    // Ocultar todos los paneles
    [this.calibPanel, this.readyPanel, this.waitPanel,
     this.recordPanel, this.donePanel].forEach(p => p.style.display = 'none');

    if (state === S.CALIBRATING) {
      this.calibPanel.style.display = 'flex';
      this._setStatus('Calibra la pizarra haciendo clic en sus 4 esquinas.');
    } else if (state === S.READY) {
      this.readyPanel.style.display = 'flex';
      this._setStatus('Pizarra calibrada. Pulsa ESPACIO para comenzar el protocolo.');
    } else if (state === S.WAITING) {
      this.waitPanel.style.display  = 'flex';
      this._updateWaitUI();
      this._setStatus(`Región ${this._currentIdx + 1}/9 — pulsa ESPACIO cuando estés en posición.`);
    } else if (state === S.RECORDING) {
      this.recordPanel.style.display = 'flex';
      this.recRegionName.textContent = REGIONS[this._currentIdx].toUpperCase();
      this.recRegionName.style.color = REGION_COLOR[REGIONS[this._currentIdx]];
      this.recFramesEl.textContent   = '0';
      this.confirmedBadge.style.display = 'none';
      const hasDwell = this.dwell.dwellFrames > 0;
      this.dwellBar.style.display = hasDwell ? 'block' : 'none';
      this.dwellFill.style.width  = '0%';
      this._setStatus(`Grabando: ${REGIONS[this._currentIdx]} — pulsa ESPACIO cuando termines.`);
    } else if (state === S.DONE) {
      this.donePanel.style.display  = 'flex';
      this._showDoneSummary();
      this._renderQuickResults();
      this.quickResults.style.display = 'block';
      this._setStatus('Protocolo completado. Exporta el CSV para continuar el análisis.');
    }
  }

  _updateWaitUI() {
    const r = REGIONS[this._currentIdx];
    this.regionCounter.textContent  = `Región ${this._currentIdx + 1} / ${REGIONS.length}`;
    this.waitRegionName.textContent = r.toUpperCase();
    this.waitRegionName.style.color = REGION_COLOR[r];
    this.progressFill.style.width   = `${(this._currentIdx / REGIONS.length) * 100}%`;
    this._updateGrid();
  }

  _updateRecordUI(dwellRes) {
    this.recFramesEl.textContent = this._recFrames;
    if (this.dwell.dwellFrames > 0) {
      this.dwellFill.style.width = `${(dwellRes.progress * 100).toFixed(1)}%`;
    }
    if (dwellRes.isConfirmed) {
      this.confirmedBadge.style.display = 'block';
    }
  }

  // ── Mini grid 3×3 ─────────────────────────────────────────────────────────

  _buildGrid() {
    this.regionGrid.innerHTML = '';
    REGIONS.forEach((r, i) => {
      const cell = document.createElement('div');
      cell.className    = 'grid-cell';
      cell.dataset.idx  = i;
      cell.style.background = '#1a1a2e';
      this.regionGrid.appendChild(cell);
    });
  }

  _updateGrid() {
    [...this.regionGrid.querySelectorAll('.grid-cell')].forEach((cell, i) => {
      cell.className = 'grid-cell';
      if (i < this._currentIdx) {
        cell.classList.add('done');
        cell.style.background = REGION_COLOR[REGIONS[i]] + '44';
        cell.style.borderColor = REGION_COLOR[REGIONS[i]];
      } else if (i === this._currentIdx) {
        cell.classList.add('active');
        cell.style.background  = REGION_COLOR[REGIONS[i]] + '33';
        cell.style.borderColor = REGION_COLOR[REGIONS[i]];
      } else {
        cell.style.background  = '#1a1a2e';
        cell.style.borderColor = '#2a2a3e';
      }
    });
  }

  // ── Resumen y resultados rápidos ──────────────────────────────────────────

  _showDoneSummary() {
    const total     = this._allFrames.length;
    const gesture   = this._allFrames.filter(f => f.isGesture).length;
    const confirmed = this._allFrames.filter(f => f.confirmed).length;
    const correct   = this._allFrames.filter(f => f.confirmed && f.region === f.gtRegion).length;
    const acc       = confirmed > 0 ? (correct / confirmed * 100).toFixed(1) : '—';
    this.doneSummary.innerHTML =
      `${total} frames grabados<br>` +
      `${gesture} con gesto (${(gesture/total*100).toFixed(1)}%)<br>` +
      `${confirmed} confirmados · Precisión: ${acc}%`;
  }

  _renderQuickResults() {
    const frames = this._allFrames;
    if (!frames.length) return;

    // Pills
    const total     = frames.length;
    const correct   = frames.filter(f => f.confirmed && f.region === f.gtRegion).length;
    const confirmed = frames.filter(f => f.confirmed).length;
    const acc       = total > 0 ? correct / total : 0;
    const accColor  = acc > 0.75 ? '#4DFF88' : acc > 0.5 ? '#FFD700' : '#FF4D4D';

    this.quickPills.innerHTML = [
      { v: `${(acc*100).toFixed(1)}%`, l: 'Precisión', c: accColor },
      { v: `${correct}/${total}`,       l: 'Correctos', c: '#c0c0e0' },
      { v: `${(confirmed/total*100).toFixed(1)}%`, l: 'Confirmados', c: '#9ab4f5' },
    ].map(p => `<div class="stat-pill">
      <span class="stat-value" style="color:${p.c}">${p.v}</span>
      <span class="stat-label">${p.l}</span>
    </div>`).join('');

    // Confusion matrix 9×9
    const matrix = Array.from({length:9}, () => new Array(9).fill(0));
    frames.forEach(f => {
      if (!f.confirmed || !f.region) return;
      const gtIdx  = REGION_IDX[f.gtRegion];
      const detIdx = REGION_IDX[f.region];
      if (gtIdx !== undefined && detIdx !== undefined) matrix[gtIdx][detIdx]++;
    });
    this._drawMatrix(matrix);
  }

  _drawMatrix(matrix) {
    const SIZE = 460, PAD = 8, LABEL = 65, N = 9;
    const cW = (SIZE - PAD - LABEL) / N;
    const cH = (SIZE - PAD - LABEL) / N;
    this.matrixCanvas.width  = SIZE;
    this.matrixCanvas.height = SIZE;
    const ctx = this.matrixCanvas.getContext('2d');
    const max = Math.max(...matrix.flat(), 1);

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    REGIONS.forEach((r, i) => {
      ctx.fillStyle = REGION_COLOR[r];
      ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(SHORT[r], PAD + LABEL - 3,
        PAD + LABEL + i * cH + cH * 0.62);
    });
    REGIONS.forEach((r, j) => {
      ctx.save();
      ctx.translate(PAD + LABEL + j * cW + cW/2, PAD + LABEL - 4);
      ctx.rotate(-Math.PI/4);
      ctx.textAlign = 'right'; ctx.fillStyle = REGION_COLOR[r];
      ctx.font = '8px monospace'; ctx.fillText(SHORT[r], 0, 0);
      ctx.restore();
    });

    matrix.forEach((row, i) => {
      row.forEach((val, j) => {
        const x = PAD + LABEL + j * cW, y = PAD + LABEL + i * cH;
        const n = val / max;
        ctx.fillStyle = val === 0 ? '#111120'
          : i === j ? `rgb(20,${Math.round(40+n*180)},40)`
          : `rgb(${Math.round(40+n*180)},20,20)`;
        ctx.fillRect(x+1, y+1, cW-2, cH-2);
        if (val > 0) {
          ctx.fillStyle = n > 0.45 ? '#fff' : '#888';
          ctx.font = `${Math.min(11, cW*0.45)}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(val, x + cW/2, y + cH * 0.65);
        }
      });
    });
  }

  // ── Exportar CSV con GT embebido ──────────────────────────────────────────

  _exportCSV() {
    const header = 'Frame,Tiempo(s),GT_Region,Gesto,Confianza(%),Modo,Confirmado,Region,X_norm,Y_norm,Modo_grounding,Hands_fiable';
    const rows   = this._allFrames.map(f =>
      [f.frame, f.ts, f.gtRegion,
       f.isGesture ? 'Sí' : 'No',
       f.confidence, f.mode,
       f.confirmed  ? 'Sí' : 'No',
       f.region, f.xn, f.yn,
       f.modoGrounding, f.handsReliable].join(',')
    );
    const csv  = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `protocolo_gt_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reinicio ──────────────────────────────────────────────────────────────

  _restart() {
    this._allFrames    = [];
    this._recFrames    = 0;
    this._frameCount   = 0;
    this._currentIdx   = 0;
    this.dwell.reset();
    this.pointingEst.reset();
    this.grounding.reset();
    this.groundRdr.clearTrail();
    this.quickResults.style.display = 'none';
    this._buildGrid();
    this._setState(S.READY);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _setCalibBadge(ok) {
    this.calibBadge.textContent = ok ? 'Calibrado' : 'Sin calibrar';
    this.calibBadge.className   = `badge ${ok ? 'badge-ok' : 'badge-warn'}`;
  }
  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
let _app;
if (window.cvReady) {
  _app = new ProtocoloApp();
  _app.onOpenCVReady(window.cv);
  _app.initMediaPipe();
} else {
  window.addEventListener('opencv-ready', () => {
    if (!_app) _app = new ProtocoloApp();
    _app.onOpenCVReady(window.cv);
    _app.initMediaPipe();
  });
}
