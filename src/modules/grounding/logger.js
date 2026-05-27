/**
 * GroundingSessionLogger — Grabación y exportación CSV de sesiones de grounding.
 * Registra frame a frame: posición del impacto, región, jitter y tasa de impacto.
 */
export class GroundingSessionLogger {
  constructor() {
    this._frames     = [];
    this._meta       = null;
    this.isRecording = false;
  }

  startSession(meta = {}) {
    this._frames     = [];
    this._meta       = { ...meta, startTime: Date.now() };
    this.isRecording = true;
  }

  /**
   * @param {import('./grounding.js').GroundingResult | null} groundingResult
   * @param {Object} impactMetrics - ImpactTracker.getMetrics()
   * @param {Object} pointingResult - PointingResult (de fase 3)
   * @param {number} fps
   */
  recordFrame(groundingResult, impactMetrics, pointingResult, fps) {
    if (!this.isRecording) return;
    const ts = Date.now() - this._meta.startTime;
    this._frames.push({
      ts,
      fps:       fps,
      hasImpact: groundingResult !== null,
      xn:        groundingResult?.xn                ?? null,
      yn:        groundingResult?.yn                ?? null,
      sx:        groundingResult?.smoothed.x        ?? null,
      sy:        groundingResult?.smoothed.y        ?? null,
      region:    groundingResult?.region.label      ?? '—',
      t:         groundingResult?.t                 ?? null,
      jitter:    impactMetrics.jitter,
      jitterLvl: impactMetrics.level,
      isGesture: pointingResult?.isGesture    ?? false,
      ptConf:    pointingResult?.confidence   ?? 0,
      ptMode:    pointingResult?.mode         ?? 'lost',
    });
  }

  stopSession() {
    this.isRecording = false;
    if (!this._frames.length) return null;

    const total      = this._frames.length;
    const withImpact = this._frames.filter(f => f.hasImpact);
    const impactRate = (withImpact.length / total * 100);

    const avgJitter = this._frames.reduce((s, f) => s + f.jitter, 0) / total;

    const regionFreq = {};
    withImpact.forEach(f => { regionFreq[f.region] = (regionFreq[f.region] ?? 0) + 1; });
    const dominantRegion = Object.entries(regionFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

    const avgConf = this._frames.reduce((s, f) => s + f.ptConf, 0) / total;

    return {
      frameCount:      total,
      impactRate:      impactRate.toFixed(1),
      avgJitter,
      dominantRegion,
      regionFreq,
      avgConfidence:   (avgConf * 100).toFixed(1),
      durationMs:      this._frames.at(-1)?.ts ?? 0,
    };
  }

  exportCSV() {
    if (!this._frames.length) return '';

    const header = [
      'Tiempo(ms)', 'FPS', 'Impacto',
      'Xn', 'Yn', 'Sx(EMA)', 'Sy(EMA)',
      'Región', 'Dist_Rayo(px)',
      'Jitter', 'Jitter_Nivel',
      'Pointing', 'Confianza_Pt', 'Modo_Pt',
    ].join(',');

    const rows = this._frames.map(f => [
      f.ts,
      f.fps.toFixed(1),
      f.hasImpact ? 1 : 0,
      f.xn  != null ? f.xn.toFixed(4)  : '',
      f.yn  != null ? f.yn.toFixed(4)  : '',
      f.sx  != null ? f.sx.toFixed(4)  : '',
      f.sy  != null ? f.sy.toFixed(4)  : '',
      `"${f.region}"`,
      f.t   != null ? Math.round(f.t)  : '',
      f.jitter.toFixed(4),
      f.jitterLvl,
      f.isGesture ? 1 : 0,
      (f.ptConf * 100).toFixed(1),
      f.ptMode,
    ].join(','));

    const meta = `# Sesión grounding · ${new Date(this._meta.startTime).toISOString()}\n` +
                 `# Condición: ${JSON.stringify(this._meta)}\n`;
    return meta + [header, ...rows].join('\n');
  }
}
