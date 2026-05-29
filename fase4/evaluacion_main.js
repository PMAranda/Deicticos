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

    // ── Estado anotación manual ───────────────────────────────────────────────
    this._annotations        = [];
    this._currentImageResult = null;
    this._currentGResult     = null;
    this._currentFileName    = '';
    this._pendingGtPointing  = null;

    // ── DOM — anotación ───────────────────────────────────────────────────────
    this.gtPanel         = document.getElementById('gtPanel');
    this.gtSystemResult  = document.getElementById('gtSystemResult');
    this.gtPointingRow   = document.getElementById('gtPointingRow');
    this.gtImpactRow     = document.getElementById('gtImpactRow');
    this.gtCoordsRow     = document.getElementById('gtCoordsRow');
    this.gtYesBtn        = document.getElementById('gtYesBtn');
    this.gtNoBtn         = document.getElementById('gtNoBtn');
    this.gtImpactYesBtn  = document.getElementById('gtImpactYesBtn');
    this.gtImpactNoBtn   = document.getElementById('gtImpactNoBtn');
    this.gtCoordsYesBtn  = document.getElementById('gtCoordsYesBtn');
    this.gtCoordsNoBtn   = document.getElementById('gtCoordsNoBtn');
    this.gtFeedback      = document.getElementById('gtFeedback');
    this.gtFeedbackText  = document.getElementById('gtFeedbackText');
    this.nextImageBtn    = document.getElementById('nextImageBtn');
    this.annotationSection = document.getElementById('annotationSection');
    this.annotationBodyEl  = document.getElementById('annotationBody');
    this.annotationStatsEl = document.getElementById('annotationStats');
    this.exportAnnotBtn    = document.getElementById('exportAnnotBtn');
    this.clearAnnotBtn     = document.getElementById('clearAnnotBtn');

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
    this._bindAnnotationControls();

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
    this._currentFileName = file.name;

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
    const rawResult = this.pointingEst.estimate(pose, hands, this._side, true);
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

    // Guardar resultado y mostrar panel de etiquetado
    this._currentImageResult = result;
    this._currentGResult     = gResult;
    this._showGTPanel(result, gResult);
  }

  // ── Anotación manual de imágenes ──────────────────────────────────────────

  _bindAnnotationControls() {
    this.gtYesBtn?.addEventListener('click',       () => this._onGtPointing(true));
    this.gtNoBtn?.addEventListener('click',        () => this._onGtPointing(false));
    this.gtImpactYesBtn?.addEventListener('click', () => this._onGtRegion(true));
    this.gtImpactNoBtn?.addEventListener('click',  () => this._onGtRegion(false));
    this.gtCoordsYesBtn?.addEventListener('click', () => this._annotate(this._pendingGtPointing, true,  true));
    this.gtCoordsNoBtn?.addEventListener('click',  () => this._annotate(this._pendingGtPointing, true,  false));

    this.nextImageBtn?.addEventListener('click', () => {
      this.nextImageBtn.style.display  = 'none';
      this.gtFeedback.style.display    = 'none';
      this.gtPanel.style.display       = 'none';
      this.fileInput.click();
    });

    this.exportAnnotBtn?.addEventListener('click', () => this._exportAnnotationsCSV());
    this.clearAnnotBtn?.addEventListener('click', () => {
      if (!this._annotations.length) return;
      this._annotations = [];
      this._updateAnnotationTable();
      this.exportAnnotBtn.disabled = true;
      this.annotationStatsEl.innerHTML = '';
    });
  }

  _showGTPanel(result, gResult) {
    if (!this.gtPanel) return;

    const detected = result.isGesture;
    let label;
    if (detected && gResult) {
      label = `Sistema: APUNTA → impacto en ${gResult.region.label} (modo ${result.mode}, conf. ${(result.confidence * 100).toFixed(0)}%)`;
    } else if (detected && !gResult) {
      label = `Sistema: APUNTA pero el rayo no alcanza la pizarra (modo ${result.mode}, conf. ${(result.confidence * 100).toFixed(0)}%)`;
    } else {
      label = `Sistema: NO APUNTA (razón: ${result.reason ?? '—'})`;
    }

    this.gtSystemResult.textContent = label;
    this.gtSystemResult.style.color = detected ? '#4DFF88' : '#FF8C4D';

    this.gtPointingRow.style.display = 'flex';
    this.gtImpactRow.style.display   = 'none';
    this.gtCoordsRow.style.display   = 'none';
    this.gtFeedback.style.display    = 'none';
    this.nextImageBtn.style.display  = 'none';
    this._pendingGtPointing          = null;
    this.gtPanel.style.display       = 'flex';
    this._setStatus('Imagen analizada — etiqueta si la persona está apuntando.');
  }

  _onGtPointing(isPointing) {
    this._pendingGtPointing = isPointing;
    const detected  = this._currentImageResult?.isGesture ?? false;
    const hasImpact = !!this._currentGResult;

    if (isPointing && detected && hasImpact) {
      // Paso 2: preguntar si la región es correcta
      this.gtPointingRow.style.display = 'none';
      this.gtImpactRow.style.display   = 'flex';
    } else {
      // TP sin impacto → grounding falla automáticamente; FP/FN/TN → no evalúa grounding
      const regionAuto = (isPointing && detected && !hasImpact) ? false : null;
      this._annotate(isPointing, regionAuto, null);
    }
  }

  _onGtRegion(regionCorrect) {
    if (regionCorrect) {
      // Paso 3: preguntar si las coordenadas son precisas dentro de la región
      this.gtImpactRow.style.display  = 'none';
      this.gtCoordsRow.style.display  = 'flex';
    } else {
      // Región incorrecta → coordenadas también incorrectas por definición
      this._annotate(this._pendingGtPointing, false, null);
    }
  }

  // gtRegionCorrect: true/false/null — null si no aplica (FP, FN, TN)
  //                                    false automático si TP pero rayo no alcanzó tablero
  // gtCoordsCorrect: true/false/null — solo se pregunta cuando gtRegionCorrect=true
  _annotate(gtPointing, gtRegionCorrect, gtCoordsCorrect) {
    if (!this._currentImageResult) return;
    const result   = this._currentImageResult;
    const gResult  = this._currentGResult;
    const detected = result.isGesture;
    const correct  = (gtPointing === detected);

    this._annotations.push({
      filename:        this._currentFileName,
      gtPointing,
      detected,
      correct,
      hasImpact:       !!gResult,
      gtRegionCorrect,
      gtCoordsCorrect,
      mode:            result.mode           ?? 'lost',
      confidence:      result.confidence     ?? 0,
      reason:          result.reason         ?? '—',
      side:            result.side           ?? '—',
      region:          gResult?.region?.label ?? null,
      xn:              gResult?.xn           ?? null,
      yn:              gResult?.yn           ?? null,
    });

    this.gtPointingRow.style.display = 'none';
    this.gtImpactRow.style.display   = 'none';
    this.gtCoordsRow.style.display   = 'none';
    this.gtFeedback.style.display    = 'flex';
    this.nextImageBtn.style.display  = 'inline-block';
    this.exportAnnotBtn.disabled     = false;

    if (this.gtFeedbackText) {
      if (correct) {
        this.gtFeedbackText.textContent = '✓ Detección correcta';
        this.gtFeedbackText.style.color = '#4DFF88';
      } else {
        const tipo = gtPointing && !detected
          ? 'Falso negativo (no detectó pero sí apuntaba)'
          : 'Falso positivo (detectó pero no apuntaba)';
        this.gtFeedbackText.textContent = `✗ ${tipo}`;
        this.gtFeedbackText.style.color = '#FF4D4D';
      }
    }

    this._updateAnnotationStats();
    this._updateAnnotationTable();
    if (this.annotationSection) this.annotationSection.style.display = 'block';
  }

  _updateAnnotationStats() {
    if (!this.annotationStatsEl || !this._annotations.length) return;
    const A   = this._annotations;
    const n   = A.length;
    const tp  = A.filter(a =>  a.gtPointing &&  a.detected).length;
    const tn  = A.filter(a => !a.gtPointing && !a.detected).length;
    const fp  = A.filter(a => !a.gtPointing &&  a.detected).length;
    const fn  = A.filter(a =>  a.gtPointing && !a.detected).length;
    const acc = ((tp + tn) / n * 100).toFixed(1);
    const pre = (tp + fp) ? (tp / (tp + fp) * 100).toFixed(1) : '—';
    const rec = (tp + fn) ? (tp / (tp + fn) * 100).toFixed(1) : '—';
    const f1  = (tp + fp) && (tp + fn) && tp
      ? (2 * tp / (2 * tp + fp + fn) * 100).toFixed(1) : '—';

    // Grounding — solo sobre TPs
    const tpList = A.filter(a => a.gtPointing && a.detected);
    const gMiss  = tpList.filter(a => !a.hasImpact).length;

    // Acc. región: TPs evaluados (gtRegionCorrect !== null)
    const rEval    = tpList.filter(a => a.gtRegionCorrect !== null);
    const rCorrect = rEval.filter(a => a.gtRegionCorrect === true).length;
    const rAcc     = rEval.length ? (rCorrect / rEval.length * 100).toFixed(1) : '—';

    // Acc. coordenadas: TPs donde la región fue correcta y se evaluaron coords
    const cEval    = tpList.filter(a => a.gtRegionCorrect === true && a.gtCoordsCorrect !== null);
    const cCorrect = cEval.filter(a => a.gtCoordsCorrect === true).length;
    const cAcc     = cEval.length ? (cCorrect / cEval.length * 100).toFixed(1) : '—';

    this.annotationStatsEl.innerHTML = `
      <div class="stat-pill">Total <strong>${n}</strong></div>
      <div class="stat-pill good">Acc. gesto <strong>${acc}%</strong></div>
      <div class="stat-pill good">Precisión <strong>${pre}%</strong></div>
      <div class="stat-pill good">Recall <strong>${rec}%</strong></div>
      <div class="stat-pill good">F1 <strong>${f1}%</strong></div>
      <div class="stat-pill">TP <strong>${tp}</strong></div>
      <div class="stat-pill">TN <strong>${tn}</strong></div>
      <div class="stat-pill warn">FP <strong>${fp}</strong></div>
      <div class="stat-pill bad">FN <strong>${fn}</strong></div>
      <div class="stat-pill good" title="Región correcta sobre TPs evaluados (${rEval.length}/${tpList.length})">Acc. región <strong>${rAcc}${rEval.length ? '%' : ''}</strong></div>
      <div class="stat-pill good" title="Coords precisas sobre TPs con región correcta (${cEval.length}/${rCorrect})">Acc. coords <strong>${cAcc}${cEval.length ? '%' : ''}</strong></div>
      ${gMiss ? `<div class="stat-pill warn" title="TPs donde el rayo no llegó a la pizarra">Rayo fuera <strong>${gMiss}</strong></div>` : ''}`;
  }

  _updateAnnotationTable() {
    if (!this.annotationBodyEl) return;
    if (!this._annotations.length) {
      this.annotationBodyEl.innerHTML =
        '<tr><td colspan="10" class="empty">Sin anotaciones todavía</td></tr>';
      return;
    }

    this.annotationBodyEl.innerHTML = [...this._annotations].reverse().map((a, i) => {
      const idx    = this._annotations.length - i;
      const gtIcon  = a.gtPointing ? '<span style="color:#4DFF88">Sí</span>' : '<span style="color:#888">No</span>';
      const detIcon = a.detected   ? '<span style="color:#4DFF88">Sí</span>' : '<span style="color:#888">No</span>';
      const okColor = a.correct ? '#4DFF88' : '#FF4D4D';

      let impIcon;
      if (!a.hasImpact && a.gtRegionCorrect === false) {
        impIcon = '<span style="color:#FFD700">✗ sin rayo</span>';
      } else if (a.gtRegionCorrect === null) {
        impIcon = '<span style="color:#333">—</span>';
      } else if (a.gtRegionCorrect === false) {
        impIcon = '<span style="color:#FF4D4D">✗ región</span>';
      } else if (a.gtCoordsCorrect === true) {
        impIcon = '<span style="color:#4DFF88">✓ preciso</span>';
      } else if (a.gtCoordsCorrect === false) {
        impIcon = '<span style="color:#FFD700">~ región ok</span>';
      } else {
        impIcon = '<span style="color:#4DFF88">✓ región ok</span>';
      }

      const mc = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#555' };
      const conf  = `${(a.confidence * 100).toFixed(0)}%`;
      const fname = a.filename.length > 22 ? `…${a.filename.slice(-20)}` : a.filename;

      return `<tr>
        <td style="color:#555">${idx}</td>
        <td title="${a.filename}" style="color:#9ab4f5">${fname}</td>
        <td>${gtIcon}</td>
        <td>${detIcon}</td>
        <td style="color:${okColor};font-weight:700">${a.correct ? '✓' : '✗'}</td>
        <td>${impIcon}</td>
        <td style="color:#FFD700">${a.region ?? '—'}</td>
        <td style="color:${mc[a.mode] ?? '#888'}">${a.mode}</td>
        <td>${conf}</td>
        <td style="color:${a.reason === 'ok' ? '#4DFF88' : '#FF8C4D'}">${a.reason}</td>
      </tr>`;
    }).join('');
  }

  _exportAnnotationsCSV() {
    if (!this._annotations.length) return;
    const header = [
      'Imagen', 'Apuntando_GT', 'Detectado', 'Gesto_Correcto',
      'Tiene_Impacto', 'Región_Correcta', 'Coords_Precisas', 'Región',
      'X_norm', 'Y_norm', 'Modo', 'Confianza(%)', 'Razón', 'Brazo',
    ].join(',');

    const rows = [header, ...this._annotations.map(a => [
      `"${a.filename}"`,
      a.gtPointing ? 1 : 0,
      a.detected   ? 1 : 0,
      a.correct    ? 1 : 0,
      a.hasImpact  ? 1 : 0,
      a.gtRegionCorrect !== null ? (a.gtRegionCorrect ? 1 : 0) : '',
      a.gtCoordsCorrect !== null ? (a.gtCoordsCorrect ? 1 : 0) : '',
      `"${a.region ?? ''}"`,
      a.xn != null ? a.xn.toFixed(4) : '',
      a.yn != null ? a.yn.toFixed(4) : '',
      a.mode,
      (a.confidence * 100).toFixed(1),
      `"${a.reason}"`,
      a.side,
    ].join(','))];

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const el   = document.createElement('a');
    el.href    = url;
    el.download = `eval_grounding_${Date.now()}.csv`;
    el.click();
    URL.revokeObjectURL(url);
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
    // Estado de anotación de la imagen actual (las anotaciones acumuladas se conservan)
    this._currentImageResult = null;
    this._currentGResult     = null;
    this._pendingGtPointing  = null;
    if (this.gtPanel)      this.gtPanel.style.display      = 'none';
    if (this.gtFeedback)   this.gtFeedback.style.display   = 'none';
    if (this.gtCoordsRow)  this.gtCoordsRow.style.display  = 'none';
    if (this.nextImageBtn) this.nextImageBtn.style.display  = 'none';
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
