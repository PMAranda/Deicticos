import { PoseEstimator }    from '../../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }    from '../../src/modules/estimacion_corporal/hands.js';
import { LandmarkRenderer } from '../../src/modules/estimacion_corporal/renderer.js';
import { FPSTracker }       from '../../src/modules/estimacion_corporal/stability.js';
import { extractDeicticLandmarks } from '../../src/modules/estimacion_corporal/landmarks.js';
import { PointingRenderer }        from '../../src/modules/heuristica/renderer.js';
import { AngularTracker }          from '../../src/modules/heuristica/metricas.js';
import { PointingSessionLogger }   from '../../src/modules/heuristica/logger.js';
import {
  extractArmVectors,
  computeExtensionAngle,
  normalize2D,
  scale2D,
  add2D,
  magnitude2D,
} from '../../src/modules/heuristica/vectores.js';
import { detectActiveSide } from '../../src/modules/heuristica/validacion.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes visuales
// ─────────────────────────────────────────────────────────────────────────────

const SPARKLINE_H = 100;
const TIMELINE_H  = 28;

const BASE_WEIGHTS = {
  shoulderElbow: 0.35,
  shoulderWrist: 0.15,
  elbowWrist:    0.35,
  wristIndex:    0.15,
};
const HANDS_WEIGHTS = {
  shoulderElbow: 0.10,
  shoulderWrist: 0.05,
  elbowWrist:    0.25,
  wristIndex:    0.60,
};

const MODE_COLORS = {
  full:     '#4DFF88',
  partial:  '#FFD700',
  fallback: '#FF8C4D',
  lost:     '#1e1e2e',
};

// ─────────────────────────────────────────────────────────────────────────────
// Definición de las 6 etapas de la heurística
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = [
  {
    id:    'etapa1',
    label: 'Etapa 1 — Solo proximal',
    desc:  'Heurística mínima (V1): único vector hombro→codo, sin umbral de extensión, sin filtros de validación, sin histéresis ni Hands.',
    chips: [
      { text: 'Solo SE',      cls: 'neu' },
      { text: 'Sin validar',  cls: 'off' },
      { text: 'Sin histér.', cls: 'off' },
      { text: 'Sin Hands',   cls: 'off' },
    ],
    cfg: {
      // Pesos: solo shoulderElbow
      baseWeights:       { shoulderElbow: 1.0, shoulderWrist: 0, elbowWrist: 0, wristIndex: 0 },
      useDynamicWeights: false,
      // Validación
      minProximalVis:    0.1,
      binaryExtThreshold: null,
      extAngleRef:       Infinity,
      minAngleFromDown:  0,
      minWristReach:     0,
      // Histéresis (desactivada)
      useHysteresis: false,
      confRise:      1.0,
      confFall:      1.0,
      activationThr: 0.01,
      holdThr:       0.00,
      // Hands
      handsMinStable:   999,
      handsWindow:       10,
      sideChangeFrames:   1,
    },
  },
  {
    id:    'etapa2',
    label: 'Etapa 2 — Umbral binario',
    desc:  'V2: añade umbral binario de extensión (codo < 30°) y usa los 4 vectores con pesos base. Sin histéresis ni Hands.',
    chips: [
      { text: 'Ext.<30°',    cls: 'on'  },
      { text: 'Pesos BASE',  cls: 'neu' },
      { text: 'Sin histér.', cls: 'off' },
      { text: 'Sin Hands',   cls: 'off' },
    ],
    cfg: {
      baseWeights:       BASE_WEIGHTS,
      useDynamicWeights: false,
      minProximalVis:    0.4,
      binaryExtThreshold: 30,
      extAngleRef:       Infinity,
      minAngleFromDown:  0,
      minWristReach:     0,
      useHysteresis:     false,
      confRise:      1.0,
      confFall:      1.0,
      activationThr: 0.01,
      holdThr:       0.00,
      handsMinStable:   999,
      handsWindow:       10,
      sideChangeFrames:   1,
    },
  },
  {
    id:    'etapa3',
    label: 'Etapa 3 — Validación gradual',
    desc:  'V3: validación gradual completa — orientación global (≥30° de vertical), alcance mínimo (≥0.12), confianza ponderada (vis×0.5 + ext×0.3 + elev×0.2). Sin histéresis.',
    chips: [
      { text: 'Ext. gradual', cls: 'on' },
      { text: 'Orientación',  cls: 'on' },
      { text: 'Alcance',      cls: 'on' },
      { text: 'Sin histér.',  cls: 'off' },
    ],
    cfg: {
      baseWeights:       BASE_WEIGHTS,
      useDynamicWeights: false,
      minProximalVis:    0.4,
      binaryExtThreshold: null,
      extAngleRef:       150,
      minAngleFromDown:  30,
      minWristReach:     0.12,
      useHysteresis:     false,
      confRise:      1.0,
      confFall:      1.0,
      activationThr: 0.01,
      holdThr:       0.00,
      handsMinStable:   999,
      handsWindow:       10,
      sideChangeFrames:   1,
    },
  },
  {
    id:    'etapa4',
    label: 'Etapa 4 — + Histéresis',
    desc:  'V4: añade histéresis asimétrica sobre la validación gradual (rise=0.40, fall=0.10, act=0.45, hold=0.20). Sin Hands.',
    chips: [
      { text: 'Validación',  cls: 'on' },
      { text: 'Histéresis',  cls: 'on' },
      { text: 'Sin Hands',   cls: 'off' },
    ],
    cfg: {
      baseWeights:       BASE_WEIGHTS,
      useDynamicWeights: false,
      minProximalVis:    0.4,
      binaryExtThreshold: null,
      extAngleRef:       150,
      minAngleFromDown:  30,
      minWristReach:     0.12,
      useHysteresis:     true,
      confRise:      0.40,
      confFall:      0.10,
      activationThr: 0.45,
      holdThr:       0.20,
      handsMinStable:   999,
      handsWindow:       10,
      sideChangeFrames:   1,
    },
  },
  {
    id:    'etapa5',
    label: 'Etapa 5 — + Hands (pesos fijos)',
    desc:  'V5: integra Hands como refinamiento direccional (≥6/10 frames estables) pero mantiene pesos BASE aunque Hands sea fiable. Sin debounce de brazo.',
    chips: [
      { text: 'Histéresis',    cls: 'on' },
      { text: 'Hands',         cls: 'on' },
      { text: 'Pesos fijos',   cls: 'neu' },
      { text: 'Sin debounce',  cls: 'off' },
    ],
    cfg: {
      baseWeights:       BASE_WEIGHTS,
      useDynamicWeights: false,
      minProximalVis:    0.4,
      binaryExtThreshold: null,
      extAngleRef:       150,
      minAngleFromDown:  30,
      minWristReach:     0.12,
      useHysteresis:     true,
      confRise:      0.40,
      confFall:      0.10,
      activationThr: 0.45,
      holdThr:       0.20,
      handsMinStable:    6,
      handsWindow:       10,
      sideChangeFrames:   1,
    },
  },
  {
    id:    'etapa6',
    label: 'Etapa 6 — Sistema completo',
    desc:  'V6.1 (sistema final): pesos dinámicos Pose↔Hands según fiabilidad, debounce de cambio de brazo (5 frames). Todos los filtros activos.',
    chips: [
      { text: 'Validación',    cls: 'on' },
      { text: 'Histéresis',    cls: 'on' },
      { text: 'Hands',         cls: 'on' },
      { text: 'Pesos dinámicos', cls: 'on' },
      { text: 'Debounce brazo', cls: 'on' },
    ],
    cfg: {
      baseWeights:       BASE_WEIGHTS,
      useDynamicWeights: true,
      minProximalVis:    0.4,
      binaryExtThreshold: null,
      extAngleRef:       150,
      minAngleFromDown:  30,
      minWristReach:     0.12,
      useHysteresis:     true,
      confRise:      0.40,
      confFall:      0.10,
      activationThr: 0.45,
      holdThr:       0.20,
      handsMinStable:    6,
      handsWindow:       10,
      sideChangeFrames:  5,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Funciones heurísticas configurables (sin modificar los módulos originales)
// ─────────────────────────────────────────────────────────────────────────────

function validateGestureConfigurable(armData, extensionAngle, cfg) {
  const { visibility, vectors, points } = armData;

  if (visibility.shoulder < cfg.minProximalVis) {
    return { isGesture: false, confidence: 0, reason: 'hombro_no_visible' };
  }
  if (visibility.elbow < cfg.minProximalVis) {
    return { isGesture: false, confidence: 0, reason: 'codo_no_visible' };
  }
  if (!vectors.shoulderElbow) {
    return { isGesture: false, confidence: 0, reason: 'vector_proximal_ausente' };
  }

  // Umbral binario de extensión (etapa 2)
  if (cfg.binaryExtThreshold !== null && extensionAngle > cfg.binaryExtThreshold) {
    return { isGesture: false, confidence: 0, reason: 'extension_insuficiente' };
  }

  const dirVec = vectors.shoulderWrist ?? vectors.shoulderElbow;
  let angleFromDown = 180;
  if (dirVec && cfg.minAngleFromDown > 0) {
    const v = normalize2D(dirVec);
    angleFromDown = Math.acos(Math.max(-1, Math.min(1, v.y))) * (180 / Math.PI);
    if (angleFromDown < cfg.minAngleFromDown) {
      return { isGesture: false, confidence: 0.1, reason: 'brazo_colgante' };
    }
  }

  if (cfg.minWristReach > 0 && points.shoulder && points.wrist && visibility.wrist >= 0.3) {
    const elbowFar = points.elbow && Math.hypot(
      points.elbow.x - points.shoulder.x,
      points.elbow.y - points.shoulder.y,
    ) > 0.10;
    const armStraight = extensionAngle < 60;
    if (!elbowFar && !armStraight) {
      const dist = Math.hypot(
        points.wrist.x - points.shoulder.x,
        points.wrist.y - points.shoulder.y,
      );
      if (dist < cfg.minWristReach) {
        return { isGesture: false, confidence: 0.1, reason: 'muneca_muy_cerca' };
      }
    }
  }

  const visScore  = (visibility.shoulder + visibility.elbow) / 2;
  const extScore  = cfg.extAngleRef !== Infinity
    ? 1 - Math.min(1, extensionAngle / cfg.extAngleRef)
    : 1.0;
  const elevScore = cfg.minAngleFromDown > 0
    ? Math.max(0, Math.min(1, (angleFromDown - cfg.minAngleFromDown) / (90 - cfg.minAngleFromDown)))
    : 1.0;

  const confidence = visScore * 0.5 + extScore * 0.3 + elevScore * 0.2;
  return { isGesture: true, confidence, reason: 'ok' };
}

function fuseVectorsConfigurable(vectors, visibility, hasHands, handsReliable, cfg) {
  const VIS_MIN        = 0.4;
  const VIS_INDEX_H    = 0.35;
  const VIS_INDEX_POSE = 0.15;

  const useBase  = vectors.shoulderElbow !== null &&
    visibility.shoulder >= VIS_MIN && visibility.elbow >= VIS_MIN;
  const useSW    = vectors.shoulderWrist !== null && visibility.wrist >= VIS_MIN;
  const useEW    = vectors.elbowWrist    !== null &&
    visibility.elbow >= VIS_MIN && visibility.wrist >= VIS_MIN;
  const useIndex = vectors.wristIndex   !== null &&
    (hasHands ? visibility.index >= VIS_INDEX_H : visibility.index >= VIS_INDEX_POSE);

  if (!useBase) return { vector: null, weights: {}, mode: 'lost' };

  let mode;
  if (useSW && useEW && useIndex) mode = 'full';
  else if (useSW || useEW)        mode = 'partial';
  else                            mode = 'fallback';

  // Seleccionar tabla de pesos según configuración
  const W = (cfg.useDynamicWeights && handsReliable) ? HANDS_WEIGHTS : cfg.baseWeights;

  const active = {};
  if (W.shoulderElbow > 0)            active.shoulderElbow = W.shoulderElbow;
  if (useSW  && W.shoulderWrist > 0)  active.shoulderWrist = W.shoulderWrist;
  if (useEW  && W.elbowWrist    > 0)  active.elbowWrist    = W.elbowWrist;
  if (useIndex && W.wristIndex  > 0)  active.wristIndex    = W.wristIndex;

  // Si no hay ningún vector activo en la tabla (ej. pesos todos 0 para SE en etapa1
  // cuando SE sí está disponible), garantizar que al menos SE esté presente.
  if (Object.keys(active).length === 0) active.shoulderElbow = 1.0;

  const total = Object.values(active).reduce((a, b) => a + b, 0);
  const weights = {};
  for (const [k, w] of Object.entries(active)) weights[k] = w / total;

  let fused = { x: 0, y: 0 };
  for (const [k, w] of Object.entries(weights)) {
    if (vectors[k]) fused = add2D(fused, scale2D(normalize2D(vectors[k]), w));
  }

  const mag = magnitude2D(fused);
  const vector = mag > 1e-9 ? normalize2D(fused) : null;
  return { vector, weights, mode };
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfigurablePointingEstimator
// ─────────────────────────────────────────────────────────────────────────────

class ConfigurablePointingEstimator {
  constructor() {
    this._cfg             = STAGES[0].cfg;
    this._smoothed        = null;
    this._accumConf       = 0;
    this._gestureActive   = false;
    this._lastReason      = 'lost';
    this._handStableFrames = 0;
    this._lastSide        = null;
    this._pendingSide     = null;
    this._pendingSideCount = 0;
  }

  setConfig(cfg) {
    this._cfg = cfg;
    this.reset();
  }

  estimate(poseLandmarks, hands, side = 'auto', singleFrame = false) {
    const cfg = this._cfg;

    // ── Selección del brazo con debounce configurable ─────────────────────────
    const rawSide = side === 'auto'
      ? detectActiveSide(poseLandmarks, this._lastSide)
      : side;

    let activeSide;
    if (this._lastSide === null || side !== 'auto') {
      activeSide             = rawSide;
      this._lastSide         = rawSide;
      this._pendingSide      = null;
      this._pendingSideCount = 0;
    } else if (rawSide === this._lastSide) {
      activeSide             = rawSide;
      this._pendingSide      = null;
      this._pendingSideCount = 0;
    } else {
      if (rawSide !== this._pendingSide) {
        this._pendingSide      = rawSide;
        this._pendingSideCount = 1;
      } else {
        this._pendingSideCount++;
      }
      if (this._pendingSideCount >= cfg.sideChangeFrames) {
        activeSide             = rawSide;
        this._lastSide         = rawSide;
        this._pendingSide      = null;
        this._pendingSideCount = 0;
        this._handStableFrames = 0;
      } else {
        activeSide = this._lastSide;
      }
    }

    // ── Estabilidad de Hands ──────────────────────────────────────────────────
    const probeData = extractArmVectors(poseLandmarks, hands, activeSide);

    let handsReliable;
    if (cfg.handsMinStable >= 999) {
      handsReliable = false;
    } else if (singleFrame) {
      handsReliable = probeData.hasHands;
    } else {
      if (probeData.hasHands) {
        this._handStableFrames = Math.min(this._handStableFrames + 1, cfg.handsWindow);
      } else {
        this._handStableFrames = Math.max(0, this._handStableFrames - 1);
      }
      handsReliable = this._handStableFrames >= cfg.handsMinStable;
    }

    // ── Dirección ─────────────────────────────────────────────────────────────
    const armData = handsReliable
      ? probeData
      : extractArmVectors(poseLandmarks, null, activeSide);

    const seVec = armData.vectors.shoulderElbow;
    const ewVec = armData.vectors.elbowWrist;
    const extensionAngle = (seVec && ewVec)
      ? computeExtensionAngle(seVec, ewVec)
      : 180;

    const validation = validateGestureConfigurable(armData, extensionAngle, cfg);

    const { vector: rawVector, weights, mode } = fuseVectorsConfigurable(
      armData.vectors, armData.visibility, armData.hasHands, handsReliable, cfg,
    );

    const originPt = armData.points.wristH ?? armData.points.wrist ?? armData.points.shoulder;
    const origin   = originPt ? { x: originPt.x, y: originPt.y } : null;

    // ── Histéresis asimétrica (configurable) ──────────────────────────────────
    if (validation.isGesture) {
      this._accumConf  = Math.min(1, this._accumConf + cfg.confRise * validation.confidence);
      this._lastReason = validation.reason;
    } else {
      this._accumConf  = Math.max(0, this._accumConf - cfg.confFall);
    }

    if (!this._gestureActive && this._accumConf >= cfg.activationThr) {
      this._gestureActive = true;
    } else if (this._gestureActive && this._accumConf < cfg.holdThr) {
      this._gestureActive = false;
    }

    // ── EMA sobre el vector ───────────────────────────────────────────────────
    const EMA_ALPHA = 0.3;
    let vector = null;

    if (rawVector && validation.isGesture) {
      vector = this._smoothed
        ? normalize2D({
            x: EMA_ALPHA * rawVector.x + (1 - EMA_ALPHA) * this._smoothed.x,
            y: EMA_ALPHA * rawVector.y + (1 - EMA_ALPHA) * this._smoothed.y,
          })
        : normalize2D(rawVector);
      this._smoothed = vector;
    } else if (this._smoothed) {
      this._smoothed = normalize2D({
        x: this._smoothed.x * 0.9,
        y: this._smoothed.y * 0.9,
      });
    }

    if (this._gestureActive) {
      vector = vector ?? this._smoothed;
    }

    return {
      isGesture:     this._gestureActive,
      rawIsGesture:  validation.isGesture,
      confidence:    this._accumConf,
      rawConfidence: validation.confidence,
      reason:        this._gestureActive
                       ? this._lastReason
                       : (validation.reason ?? 'lost'),
      mode,
      vector,
      rawVector,
      smoothed:      this._smoothed,
      extensionAngle,
      weights,
      origin,
      armData,
      side:          activeSide,
      handsReliable,
      handStability: cfg.handsMinStable < 999
        ? this._handStableFrames / cfg.handsWindow
        : 0,
    };
  }

  reset() {
    this._smoothed         = null;
    this._accumConf        = 0;
    this._gestureActive    = false;
    this._lastReason       = 'lost';
    this._handStableFrames = 0;
    this._lastSide         = null;
    this._pendingSide      = null;
    this._pendingSideCount = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// App principal
// ─────────────────────────────────────────────────────────────────────────────

class StageEvalApp {
  constructor() {
    this.video          = document.getElementById('video');
    this.canvas         = document.getElementById('canvas');
    this.sparkCanvas    = document.getElementById('sparklines');
    this.timelineCanvas = document.getElementById('timeline');
    this.ctx            = this.canvas.getContext('2d');
    this.sparkCtx       = this.sparkCanvas.getContext('2d');
    this.timelineCtx    = this.timelineCanvas?.getContext('2d') ?? null;

    this.statusEl          = document.getElementById('status');
    this.badgeEl           = document.getElementById('trackingBadge');
    this.fpsBadgeEl        = document.getElementById('fpsBadge');
    this.modeBadgeEl       = document.getElementById('modeBadge');
    this.metricsBodyEl     = document.getElementById('metricsBody');
    this.weightsBodyEl     = document.getElementById('weightsBody');
    this.dropZone          = document.getElementById('dropZone');
    this.fileInput         = document.getElementById('fileInput');
    this.sourceBar         = document.getElementById('sourceBar');
    this.videoControls     = document.getElementById('videoControls');
    this.timelineSection   = document.getElementById('timelineSection');
    this.playBtn           = document.getElementById('playBtn');
    this.seekBar           = document.getElementById('seekBar');
    this.timeDisplay       = document.getElementById('timeDisplay');
    this.speedSelect       = document.getElementById('speedSelect');
    this.stepBtn           = document.getElementById('stepBtn');
    this.summarySection    = document.getElementById('summarySection');
    this.summaryBodyEl     = document.getElementById('summaryBody');
    this.exportBtn         = document.getElementById('exportBtn');
    this.reloadBtn         = document.getElementById('reloadBtn');
    this.frameInfoEl       = document.getElementById('frameInfo');
    this.heuristicNameEl   = document.getElementById('heuristicName');

    this.gtPanel           = document.getElementById('gtPanel');
    this.gtPointingRow     = document.getElementById('gtPointingRow');
    this.gtDirRow          = document.getElementById('gtDirRow');
    this.gtYesBtn          = document.getElementById('gtYesBtn');
    this.gtNoBtn           = document.getElementById('gtNoBtn');
    this.gtDirYesBtn       = document.getElementById('gtDirYesBtn');
    this.gtDirNoBtn        = document.getElementById('gtDirNoBtn');
    this.gtFeedback        = document.getElementById('gtFeedback');
    this.gtFeedbackText    = document.getElementById('gtFeedbackText');
    this.nextImageBtn      = document.getElementById('nextImageBtn');
    this.annotationSection = document.getElementById('annotationSection');
    this.annotationBodyEl  = document.getElementById('annotationBody');
    this.annotationStatsEl = document.getElementById('annotationStats');
    this.exportAnnotBtn    = document.getElementById('exportAnnotBtn');
    this.clearAnnotBtn     = document.getElementById('clearAnnotBtn');

    this.pose        = new PoseEstimator();
    this.hands       = new HandEstimator();
    this.poseImg     = new PoseEstimator();
    this.handsImg    = new HandEstimator();
    this.bodyRdr     = new LandmarkRenderer();
    this.pointingEst = new ConfigurablePointingEstimator();
    this.pointingRdr = new PointingRenderer();
    this.angTracker  = new AngularTracker(30);
    this.fpsTracker  = new FPSTracker(60);
    this.logger      = new PointingSessionLogger();

    this._mode               = null;
    this._loopId             = null;
    this._isPlaying          = false;
    this._recorded           = false;
    this._timeline           = [];
    this._side               = 'auto';
    this._currentStage       = STAGES[0];
    this._annotations        = [];
    this._currentImageResult = null;
    this._currentFileName    = '';
    this._pendingGtPointing  = null;

    this._buildStageSelector();
    this._selectStage(STAGES[0]);
    this._bindUpload();
    this._bindVideoControls();
    this._bindConditionControls();
    this._bindAnnotationControls();
    this.exportBtn.addEventListener('click', () => this._exportVideoCSV());
    this.reloadBtn?.addEventListener('click', () => this._resetToUpload());
  }

  // ── Selector de etapas ────────────────────────────────────────────────────

  _buildStageSelector() {
    const container = document.getElementById('stageButtons');
    STAGES.forEach(stage => {
      const btn = document.createElement('button');
      btn.className   = 'stage-btn';
      btn.textContent = stage.label;
      btn.addEventListener('click', () => this._selectStage(stage));
      stage._btn = btn;
      container.appendChild(btn);
    });
  }

  _selectStage(stage) {
    this._currentStage = stage;
    STAGES.forEach(s => s._btn?.classList.toggle('active', s === stage));

    const chips = stage.chips
      .map(c => `<span class="chip ${c.cls}">${c.text}</span>`)
      .join('');
    document.getElementById('stageDesc').innerHTML =
      `<strong>${stage.label}</strong><br>${stage.desc}<div class="stage-chips">${chips}</div>`;

    if (this.heuristicNameEl) this.heuristicNameEl.value = stage.id;
    this.pointingEst.setConfig(stage.cfg);
  }

  // ── Inicialización ────────────────────────────────────────────────────────

  async init() {
    this._setStatus('Cargando modelos MediaPipe…');
    try {
      await Promise.all([
        this.pose.init('VIDEO'),
        this.hands.init('VIDEO'),
        this.poseImg.init('IMAGE'),
        this.handsImg.init('IMAGE'),
      ]);
      this._setStatus('Listo. Selecciona una etapa y sube un vídeo o imagen.');
    } catch (err) {
      this._setStatus(`Error cargando modelos: ${err.message}`, true);
    }
  }

  // ── Subida de archivo ─────────────────────────────────────────────────────

  _bindUpload() {
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
  }

  async _loadFile(file) {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      this._setStatus('Formato no soportado. Usa vídeo (MP4…) o imagen (JPG, PNG…).', true);
      return;
    }
    this._resetState();
    this.dropZone.style.display = 'none';
    this.sourceBar.style.display = 'flex';
    document.getElementById('fileName').textContent    = file.name;
    document.getElementById('fileTypeTag').textContent = isVideo ? 'VÍDEO' : 'IMAGEN';

    if (isVideo) { this._mode = 'video'; await this._initVideo(file); }
    else         { this._mode = 'image'; await this._initImage(file); }
  }

  async _initVideo(file) {
    const url = URL.createObjectURL(file);
    this.video.src          = url;
    this.video.playbackRate = parseFloat(this.speedSelect.value);
    await new Promise((res, rej) => {
      this.video.onloadedmetadata = res;
      this.video.onerror = () => rej(new Error('No se pudo cargar el vídeo'));
    });
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    this.canvas.width       = W;
    this.canvas.height      = H;
    this.sparkCanvas.width  = W;
    this.sparkCanvas.height = SPARKLINE_H;
    if (this.timelineCanvas) {
      this.timelineCanvas.width  = W;
      this.timelineCanvas.height = TIMELINE_H;
    }
    document.getElementById('fileDuration').textContent = this._fmtTime(this.video.duration);
    this.videoControls.style.display   = 'flex';
    this.timelineSection.style.display = 'block';
    this.video.currentTime = 0;
    await new Promise(res => {
      this.video.onseeked = () => { this.video.onseeked = null; res(); };
    });
    this.ctx.drawImage(this.video, 0, 0, W, H);
    this._setStatus(
      `Vídeo listo: ${W}×${H} · ${this._fmtTime(this.video.duration)} — ` +
      `etapa: ${this._currentStage.id} — pulsa Play`
    );
  }

  async _initImage(file) {
    this._currentFileName = file.name;
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

    const W = img.width;
    const H = img.height;
    this.canvas.width       = W;
    this.canvas.height      = H;
    this.sparkCanvas.width  = W;
    this.sparkCanvas.height = SPARKLINE_H;

    const poseRes  = this.poseImg.detect(img);
    const handsRes = this.handsImg.detect(img);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);
    const rawResult = this.pointingEst.estimate(pose, hands, this._side, true);
    const result = {
      ...rawResult,
      isGesture:  rawResult.rawIsGesture,
      confidence: rawResult.rawConfidence,
    };
    this.angTracker.update(result);

    this.ctx.drawImage(img, 0, 0);
    this._renderOverlay(result, pose, hands, false);
    this._updateUI(result, pose, hands);

    document.getElementById('fileDuration').textContent = '—';
    if (this.frameInfoEl) this.frameInfoEl.textContent = '1 frame';
    this._currentImageResult = result;
    this._showGTPanel(result);
    URL.revokeObjectURL(url);
  }

  // ── Controles de vídeo ────────────────────────────────────────────────────

  _bindVideoControls() {
    this.playBtn.addEventListener('click', () => this._togglePlay());
    this.seekBar.addEventListener('input', () => {
      if (this._mode !== 'video') return;
      this.video.currentTime = (this.seekBar.value / 1000) * this.video.duration;
    });
    this.speedSelect.addEventListener('change', () => {
      this.video.playbackRate = parseFloat(this.speedSelect.value);
    });
    this.stepBtn.addEventListener('click', () => {
      if (this._mode !== 'video') return;
      if (this._isPlaying) this._togglePlay();
      const next = Math.min(this.video.duration, this.video.currentTime + 1 / 30);
      this.video.currentTime = next;
      this.video.onseeked = () => { this.video.onseeked = null; this._processVideoFrame(); };
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
  }

  _togglePlay() {
    if (this._mode !== 'video') return;
    if (this._isPlaying) {
      this.video.pause();
      this._isPlaying = false;
      this.playBtn.textContent = '▶ Play';
      cancelAnimationFrame(this._loopId);
      this._loopId = null;
    } else {
      if (this.video.ended) this.video.currentTime = 0;
      if (!this._recorded && !this.logger.isRecording) {
        this.logger.startSession(this._getCondition());
      }
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
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const poseRes  = this.pose.detect(this.video, ts);
    const handsRes = this.hands.detect(this.video, ts);
    const { pose, hands } = extractDeicticLandmarks(poseRes, handsRes);
    const result = this.pointingEst.estimate(pose, hands, this._side);
    this.angTracker.update(result);
    if (this.logger.isRecording) {
      this.logger.recordFrame(result, this.angTracker.getMetrics(), this.fpsTracker.fps);
    }
    this._timeline.push({ t: this.video.currentTime, mode: result.mode ?? 'lost' });
    this._renderOverlay(result, pose, hands, true);
    this._drawTimeline();
    this._updateUI(result, pose, hands);
    if (this.frameInfoEl) {
      this.frameInfoEl.textContent =
        `~Frame ${Math.round(this.video.currentTime * 30)} · ${this._fmtTime(this.video.currentTime)}`;
    }
  }

  _onVideoEnded() {
    if (this.logger.isRecording) {
      const summary = this.logger.stopSession();
      this._recorded = true;
      this._showVideoSummary(summary);
    }
    this._setStatus('Análisis completo. Consulta el resumen o exporta el CSV.');
  }

  // ── Anotación manual ──────────────────────────────────────────────────────

  _bindAnnotationControls() {
    this.gtYesBtn?.addEventListener('click',    () => this._onGtPointing(true));
    this.gtNoBtn?.addEventListener('click',     () => this._onGtPointing(false));
    this.gtDirYesBtn?.addEventListener('click', () => this._annotate(this._pendingGtPointing, true));
    this.gtDirNoBtn?.addEventListener('click',  () => this._annotate(this._pendingGtPointing, false));
    this.nextImageBtn?.addEventListener('click', () => {
      this.nextImageBtn.style.display = 'none';
      this.gtFeedback.style.display   = 'none';
      this.fileInput.click();
    });
    this.exportAnnotBtn?.addEventListener('click', () => this._exportAnnotationsCSV());
    this.clearAnnotBtn?.addEventListener('click', () => {
      if (!this._annotations.length) return;
      this._annotations = [];
      this._updateAnnotationTable();
      this.exportAnnotBtn.disabled = true;
    });
  }

  _onGtPointing(isPointing) {
    this._pendingGtPointing = isPointing;
    if (isPointing && this._currentImageResult?.isGesture) {
      if (this.gtPointingRow) this.gtPointingRow.style.display = 'none';
      if (this.gtDirRow)      this.gtDirRow.style.display      = 'flex';
    } else {
      this._annotate(isPointing, null);
    }
  }

  _showGTPanel(result) {
    if (!this.gtPanel) return;
    const detectedLabel = result.isGesture
      ? `Sistema detecta: APUNTA (modo ${result.mode}, ${(result.confidence * 100).toFixed(0)}% conf.)`
      : `Sistema detecta: NO APUNTA (razón: ${result.reason ?? '—'})`;
    const detectedEl = document.getElementById('gtSystemResult');
    if (detectedEl) {
      detectedEl.textContent = detectedLabel;
      detectedEl.style.color = result.isGesture ? '#4DFF88' : '#FF8C4D';
    }
    if (this.gtPointingRow) this.gtPointingRow.style.display = 'flex';
    if (this.gtDirRow)      this.gtDirRow.style.display      = 'none';
    this._pendingGtPointing = null;
    this.gtPanel.style.display     = 'block';
    this.gtFeedback.style.display  = 'none';
    this.nextImageBtn.style.display = 'none';
    this._setStatus(
      `Imagen analizada [${this._currentStage.id}]: ${this.canvas.width}×${this.canvas.height} — etiqueta si apunta`
    );
  }

  _annotate(isPointing, gtDirection) {
    if (!this._currentImageResult) return;
    const result   = this._currentImageResult;
    const detected = result.isGesture;
    const correct  = (isPointing === detected);

    this._annotations.push({
      filename:       this._currentFileName,
      gt:             isPointing,
      detected,
      correct,
      gtDirection,
      mode:           result.mode           ?? 'lost',
      confidence:     result.confidence     ?? 0,
      extensionAngle: result.extensionAngle ?? null,
      reason:         result.reason         ?? '—',
      side:           result.side           ?? '—',
      condition:      { ...this._getCondition() },
    });

    this.gtPanel.style.display     = 'none';
    this.gtFeedback.style.display  = 'flex';
    this.nextImageBtn.style.display  = 'inline-block';
    this.exportAnnotBtn.disabled     = false;

    if (this.gtFeedbackText) {
      if (correct) {
        this.gtFeedbackText.textContent = '✓ Correcto — detección acertada';
        this.gtFeedbackText.style.color = '#4DFF88';
      } else {
        const tipo = isPointing && !detected
          ? 'Falso negativo (no detectó pero sí apuntaba)'
          : 'Falso positivo (detectó pero no apuntaba)';
        this.gtFeedbackText.textContent = `✗ Error — ${tipo}`;
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
    const tp  = A.filter(a =>  a.gt &&  a.detected).length;
    const tn  = A.filter(a => !a.gt && !a.detected).length;
    const fp  = A.filter(a => !a.gt &&  a.detected).length;
    const fn  = A.filter(a =>  a.gt && !a.detected).length;
    const acc = ((tp + tn) / n * 100).toFixed(1);
    const pre = (tp + fp) ? (tp / (tp + fp) * 100).toFixed(1) : '—';
    const rec = (tp + fn) ? (tp / (tp + fn) * 100).toFixed(1) : '—';
    const f1  = (tp + fp) && (tp + fn) && tp
      ? (2 * tp / (2 * tp + fp + fn) * 100).toFixed(1) : '—';
    const dirAnnots = A.filter(a => a.gtDirection !== null && a.gtDirection !== undefined);
    const dirTotal  = dirAnnots.length;
    const dirAcc    = dirTotal
      ? (dirAnnots.filter(a => a.gtDirection).length / dirTotal * 100).toFixed(1) : '—';

    // Estadísticas por etapa
    const byStage = {};
    A.forEach(a => {
      const s = a.condition.heuristic;
      if (!byStage[s]) byStage[s] = { n: 0, ok: 0 };
      byStage[s].n++;
      if (a.correct) byStage[s].ok++;
    });
    const stagePills = Object.entries(byStage)
      .map(([s, d]) => `<span class="stat-pill">${s}: <strong>${(d.ok/d.n*100).toFixed(0)}%</strong> (${d.n})</span>`)
      .join('');

    this.annotationStatsEl.innerHTML = `
      <div class="stat-pill">Total <strong>${n}</strong></div>
      <div class="stat-pill good">Accuracy <strong>${acc}%</strong></div>
      <div class="stat-pill good">Precisión <strong>${pre}%</strong></div>
      <div class="stat-pill good">Recall <strong>${rec}%</strong></div>
      <div class="stat-pill good">F1 <strong>${f1}%</strong></div>
      <div class="stat-pill">TP <strong>${tp}</strong></div>
      <div class="stat-pill">TN <strong>${tn}</strong></div>
      <div class="stat-pill warn">FP <strong>${fp}</strong></div>
      <div class="stat-pill bad">FN <strong>${fn}</strong></div>
      <div class="stat-pill good">Acc. dirección <strong>${dirAcc}${dirTotal ? '%' : ''}</strong></div>
      ${stagePills}`;
  }

  _updateAnnotationTable() {
    if (!this.annotationBodyEl) return;
    if (!this._annotations.length) {
      this.annotationBodyEl.innerHTML =
        '<tr><td colspan="10" class="empty">Sin anotaciones todavía</td></tr>';
      return;
    }
    this.annotationBodyEl.innerHTML = [...this._annotations].reverse().map((a, i) => {
      const idx     = this._annotations.length - i;
      const gtIcon  = a.gt       ? '<span style="color:#4DFF88">Sí</span>' : '<span style="color:#888">No</span>';
      const detIcon = a.detected ? '<span style="color:#4DFF88">Sí</span>' : '<span style="color:#888">No</span>';
      const okIcon  = a.correct  ? '✓' : '✗';
      const okColor = a.correct  ? '#4DFF88' : '#FF4D4D';
      const dirIcon = a.gtDirection === null || a.gtDirection === undefined
        ? '<span style="color:#333">—</span>'
        : a.gtDirection
          ? '<span style="color:#4DFF88">✓</span>'
          : '<span style="color:#FF4D4D">✗</span>';
      const mc   = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#555' }[a.mode] ?? '#888';
      const conf = `${(a.confidence * 100).toFixed(0)}%`;
      const ext  = a.extensionAngle != null ? `${a.extensionAngle.toFixed(1)}°` : '—';
      const fname = a.filename.length > 22 ? `…${a.filename.slice(-20)}` : a.filename;
      return `<tr>
        <td style="color:#555">${idx}</td>
        <td title="${a.filename}" style="color:#9ab4f5">${fname}</td>
        <td>${gtIcon}</td>
        <td>${detIcon}</td>
        <td style="color:${okColor};font-weight:700">${okIcon}</td>
        <td>${dirIcon}</td>
        <td style="color:${mc}">${a.mode}</td>
        <td>${conf}</td>
        <td>${ext}</td>
        <td style="color:${a.reason === 'ok' ? '#4DFF88' : '#FF8C4D'}">${a.reason}</td>
      </tr>`;
    }).join('');
  }

  _exportAnnotationsCSV() {
    if (!this._annotations.length) return;
    const header = [
      'Imagen', 'Apuntando_Real', 'Detectado', 'Correcto', 'Dirección_Correcta',
      'Modo', 'Confianza(%)', 'Extensión(°)', 'Razón', 'Brazo',
      'Heurística', 'Distancia', 'Movimiento', 'Oclusión',
    ].join(',');
    const rows = [header, ...this._annotations.map(a => [
      `"${a.filename}"`,
      a.gt       ? 1 : 0,
      a.detected ? 1 : 0,
      a.correct  ? 1 : 0,
      a.gtDirection !== null && a.gtDirection !== undefined ? (a.gtDirection ? 1 : 0) : '',
      a.mode,
      (a.confidence * 100).toFixed(1),
      a.extensionAngle != null ? a.extensionAngle.toFixed(1) : '',
      `"${a.reason}"`,
      a.side,
      `"${a.condition.heuristic}"`,
      a.condition.distance,
      a.condition.movement,
      a.condition.occlusion,
    ].join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ablacion_${this._currentStage.id}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Renderizado ───────────────────────────────────────────────────────────

  _renderOverlay(result, pose, hands, showFps) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.bodyRdr.drawArmSkeleton(this.ctx, pose, W, H);
    if (hands.Left)  this.bodyRdr.drawHandLandmarks(this.ctx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.bodyRdr.drawHandLandmarks(this.ctx, hands.Right, 'Right', W, H);
    if (showFps) this.bodyRdr.drawFPS(this.ctx, this.fpsTracker.fps, W);
    this.pointingRdr.drawComponentVectors(this.ctx, result, W, H);
    this.pointingRdr.drawExtensionAngle(this.ctx, result.armData, result.extensionAngle, W, H);
    this.pointingRdr.drawPointingRay(this.ctx, result, W, H);
    this.pointingRdr.drawStatusPanel(this.ctx, result, W);
    this.pointingRdr.drawAngularSparklines(
      this.sparkCtx, this.angTracker, this.sparkCanvas.width, SPARKLINE_H
    );
  }

  _drawTimeline() {
    if (!this.timelineCtx || !this._timeline.length || !this.video.duration) return;
    const ctx = this.timelineCtx;
    const W   = this.timelineCanvas.width;
    const H   = TIMELINE_H;
    const dur = this.video.duration;
    ctx.clearRect(0, 0, W, H);
    const segW = Math.max(1, W / (dur * 30));
    this._timeline.forEach(f => {
      ctx.fillStyle = MODE_COLORS[f.mode] ?? MODE_COLORS.lost;
      ctx.fillRect((f.t / dur) * W, 3, segW, H - 6);
    });
    const cx = (this.video.currentTime / dur) * W;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
    ctx.stroke();
  }

  // ── Resumen vídeo ─────────────────────────────────────────────────────────

  _showVideoSummary(summary) {
    if (!summary) return;
    this.summarySection.style.display = 'block';
    this.summarySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const lc = { stable:'#4DFF88', moderate:'#FFD700', unstable:'#FF4D4D' }[summary.level] ?? '#aaa';
    const rows = [
      ['Frames totales',   `${summary.frameCount}`],
      ['Duración',         `${(summary.durationMs / 1000).toFixed(1)} s`],
      ['FPS medio',        summary.avgFps.toFixed(1)],
      ['Detección',        `${summary.detectionRate.toFixed(1)}%`],
      ['Confianza media',  `${summary.avgConfidence.toFixed(1)}%`],
      ['Jitter angular',   `<span style="color:${lc}">${summary.avgJitter.toFixed(2)}°/f</span>`],
      ['Jitter máximo',    `${summary.maxJitter.toFixed(2)}°/f`],
      ['Estabilidad',      `<span style="color:${lc}">${summary.level}</span>`],
      ['Fallback rate',    `${summary.fallbackRate.toFixed(1)}%`],
      ['Continuidad máx',  `${summary.maxContinuity} frames`],
    ];
    const pills = Object.entries(summary.modePcts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `<span class="mode-pill ${k}">${k} ${v.toFixed(1)}%</span>`)
      .join('');
    this.summaryBodyEl.innerHTML =
      rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join('') +
      `<tr><td>Modos</td><td><div class="mode-pills">${pills}</div></td></tr>`;
    this.exportBtn.disabled = false;
  }

  _exportVideoCSV() {
    const csv  = this.logger.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ablacion_video_${this._currentStage.id}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Controles de condición ────────────────────────────────────────────────

  _bindConditionControls() {
    document.querySelectorAll('.tag[data-group]').forEach(btn => {
      const g = btn.dataset.group;
      btn.addEventListener('click', () => {
        if (g === 'side') { this._side = btn.dataset.value; this.pointingEst.reset(); }
        document.querySelectorAll(`.tag[data-group="${g}"]`)
          .forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  _getCondition() {
    return {
      heuristic: this._currentStage.id,
      distance:  document.getElementById('distanceInput')?.value || '1.5',
      movement:  document.querySelector('.tag.active[data-group="movement"]')?.dataset?.value ?? 'lento',
      occlusion: document.querySelector('.tag.active[data-group="occlusion"]')?.dataset?.value ?? 'ninguna',
    };
  }

  // ── Actualizaciones de UI ─────────────────────────────────────────────────

  _updateUI(result, pose, hands) {
    this._updateBadge(pose, hands);
    this._updateFpsBadge();
    this._updateModeBadge(result);
    this._updateMetricsTable(result);
    this._updateWeightsTable(result);
  }

  _updateBadge(pose, hands) {
    const parts = [];
    if (pose)        parts.push('Pose');
    if (hands.Left)  parts.push('Mano Izq');
    if (hands.Right) parts.push('Mano Der');
    this.badgeEl.textContent = parts.length ? `Detectando: ${parts.join(' · ')}` : 'Sin detección';
    this.badgeEl.className   = `tracking-badge ${parts.length ? 'active' : 'inactive'}`;
  }

  _updateFpsBadge() {
    const fps = this.fpsTracker.fps;
    this.fpsBadgeEl.textContent = `${fps.toFixed(1)} FPS`;
    this.fpsBadgeEl.className   = `fps-badge ${fps >= 25 ? 'good' : fps >= 15 ? 'warn' : 'bad'}`;
  }

  _updateModeBadge(result) {
    const mode = result.isGesture ? (result.mode ?? 'lost') : 'lost';
    this.modeBadgeEl.textContent = mode.toUpperCase();
    this.modeBadgeEl.className   = `mode-badge ${mode}`;
  }

  _updateMetricsTable(result) {
    if (!this.metricsBodyEl) return;
    const { isGesture, mode, confidence, extensionAngle, side, reason, handStability } = result;
    const am = this.angTracker.getMetrics();
    const mc = { full:'#4DFF88', partial:'#FFD700', fallback:'#FF8C4D', lost:'#FF4D4D' };
    const cc = (confidence ?? 0) > 0.7 ? '#4DFF88' : (confidence ?? 0) > 0.4 ? '#FFD700' : '#FF4D4D';
    const jc = am.level === 'stable' ? '#4DFF88' : am.level === 'moderate' ? '#FFD700' : '#FF4D4D';
    const hs = this._currentStage.cfg.handsMinStable < 999
      ? `${((handStability ?? 0) * 100).toFixed(0)}%`
      : 'desact.';
    const rows = [
      ['Brazo activo',   side ?? '—',                              '#aaa'],
      ['Gesto',          isGesture ? 'SÍ' : 'NO',                 isGesture ? '#4DFF88' : '#FF4D4D'],
      ['Modo',           mode ?? '—',                              mc[mode] ?? '#aaa'],
      ['Confianza',      `${((confidence ?? 0) * 100).toFixed(1)}%`, cc],
      ['Hands fiabilidad', hs,                                      '#ccc'],
      ['Extensión',      `${extensionAngle?.toFixed(1) ?? '?'}°`,  '#ccc'],
      ['Jitter angular', `${am.jitter.toFixed(2)}°/f`,             jc],
      ['Continuidad',    `${am.continuity}f`,                      '#aaa'],
      ['Tasa detección', `${(am.detectionRate * 100).toFixed(1)}%`, '#ccc'],
      ['Fallback rate',  `${(am.fallbackRate * 100).toFixed(1)}%`, am.fallbackRate > 0.2 ? '#FF8C4D' : '#4DFF88'],
      ['Motivo',         reason ?? '—',                            reason === 'ok' ? '#4DFF88' : '#FF8C4D'],
    ];
    this.metricsBodyEl.innerHTML = rows.map(([l, v, c]) =>
      `<tr><td>${l}</td><td style="color:${c}">${v}</td></tr>`
    ).join('');
  }

  _updateWeightsTable(result) {
    if (!this.weightsBodyEl) return;
    const aw = result.weights ?? {};
    const wc = {
      shoulderElbow: '#4D9FFF', shoulderWrist: '#88ccff',
      elbowWrist:    '#ff8888', wristIndex:    '#FFD700',
    };
    const baseRef = this._currentStage.cfg.baseWeights;
    this.weightsBodyEl.innerHTML = Object.entries(BASE_WEIGHTS).map(([k]) => {
      const active = aw[k] ?? 0;
      const base   = baseRef[k] ?? 0;
      const color  = wc[k] ?? '#888';
      const pct    = (active * 100).toFixed(1);
      const bar    = `<div class="weight-bar-bg">
                        <div class="weight-bar-fill" style="width:${pct}%;background:${color}"></div>
                      </div>`;
      return `<tr>
        <td>${k}</td>
        <td class="weight-bar-cell">${bar}<span style="color:${color};font-size:0.78rem">${pct}%</span></td>
        <td>${(base * 100).toFixed(0)}%</td>
        <td style="color:${aw[k] != null ? '#4DFF88' : '#555'}">${aw[k] != null ? 'Sí' : 'No'}</td>
      </tr>`;
    }).join('');
  }

  _updateTimeDisplay() {
    this.timeDisplay.textContent =
      `${this._fmtTime(this.video.currentTime)} / ${this._fmtTime(this.video.duration)}`;
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  _resetState() {
    cancelAnimationFrame(this._loopId);
    this._loopId = null;
    if (this._isPlaying) { this.video.pause(); this._isPlaying = false; }
    if (this.logger.isRecording) this.logger.stopSession();
    this.angTracker.clear();
    this.pointingEst.reset();
    this._timeline           = [];
    this._recorded           = false;
    this._mode               = null;
    this._currentImageResult = null;
    this._currentFileName    = '';
    this.playBtn.textContent = '▶ Play';
    this.exportBtn.disabled  = true;
    this.sparkCtx.clearRect(0, 0, this.sparkCanvas.width, this.sparkCanvas.height);
    this.timelineCtx?.clearRect(0, 0, this.timelineCanvas?.width ?? 0, TIMELINE_H);
    this.summarySection.style.display = 'none';
    this.summaryBodyEl.innerHTML      = '';
    if (this.gtPanel)     this.gtPanel.style.display    = 'none';
    if (this.gtFeedback)  this.gtFeedback.style.display = 'none';
    if (this.nextImageBtn) this.nextImageBtn.style.display = 'none';
  }

  _resetToUpload() {
    this._resetState();
    this.videoControls.style.display   = 'none';
    this.timelineSection.style.display = 'none';
    this.sourceBar.style.display       = 'none';
    this.dropZone.style.display        = 'flex';
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._setStatus('Listo. Selecciona una etapa y sube un vídeo o imagen.');
    this.fileInput.value = '';
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  _fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const app = new StageEvalApp();
  await app.init();
});
