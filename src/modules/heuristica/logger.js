/**
 * Registra sesiones de evaluación de la heurística de pointing.
 * Análogo a SessionLogger de fase2, adaptado a métricas angulares y de modo.
 */
export class PointingSessionLogger {
  constructor() {
    this._sessions = [];
    this._current  = null;
  }

  get isRecording()  { return this._current !== null; }
  get sessionCount() { return this._sessions.length; }

  /**
   * @param {{
   *   heuristic: string,
   *   distance: string,
   *   movement: string,
   *   occlusion: string
   * }} condition
   */
  startSession(condition) {
    this._current = {
      id:        this._sessions.length + 1,
      condition: { ...condition },
      startTime: performance.now(),
      frames:    [],
    };
  }

  /**
   * @param {PointingResult} pointingResult
   * @param {Object}         angularMetrics  - resultado de AngularTracker.getMetrics()
   * @param {number}         fps
   */
  recordFrame(pointingResult, angularMetrics, fps = 0) {
    if (!this._current) return;
    this._current.frames.push({
      t:              Math.round(performance.now() - this._current.startTime),
      fps,
      mode:           pointingResult.mode     ?? 'lost',
      isGesture:      pointingResult.isGesture ?? false,
      confidence:     pointingResult.confidence    ?? 0,
      extensionAngle: pointingResult.extensionAngle ?? 180,
      side:           pointingResult.side     ?? '—',
      angularJitter:  angularMetrics.jitter   ?? 0,
      continuity:     angularMetrics.continuity ?? 0,
      fallbackActive: pointingResult.mode === 'fallback',
    });
  }

  stopSession() {
    if (!this._current) return null;
    const session = {
      ...this._current,
      endTime: performance.now(),
      summary: this._summarize(this._current),
    };
    this._sessions.push(session);
    this._current = null;
    return session.summary;
  }

  getSessions() {
    return this._sessions.map(s => ({ ...s.summary, id: s.id }));
  }

  exportCSV() {
    const header = [
      'Sesión', 'Heurística', 'Distancia', 'Movimiento', 'Oclusión',
      'Frames', 'Duración(ms)', 'FPSMedio',
      'JitterAngMedio(°)', 'JitterAngMax(°)', 'NivelEstabilidad',
      'Detección(%)', 'Fallback(%)', 'ContinuidadMax(f)',
      'ModeFull(%)', 'ModePartial(%)', 'ModeFallback(%)', 'ModeLost(%)',
      'ConfianzaMedia(%)',
    ].join(',');

    const rows = [header];
    this._sessions.forEach(s => {
      const c  = s.summary.condition;
      const sm = s.summary;
      rows.push([
        s.id,
        c.heuristic,
        c.distance, c.movement, c.occlusion,
        sm.frameCount,
        sm.durationMs,
        sm.avgFps.toFixed(1),
        sm.avgJitter.toFixed(2),
        sm.maxJitter.toFixed(2),
        sm.level,
        sm.detectionRate.toFixed(1),
        sm.fallbackRate.toFixed(1),
        sm.maxContinuity,
        sm.modePcts.full.toFixed(1),
        sm.modePcts.partial.toFixed(1),
        sm.modePcts.fallback.toFixed(1),
        sm.modePcts.lost.toFixed(1),
        sm.avgConfidence.toFixed(1),
      ].join(','));
    });

    return rows.join('\n');
  }

  // ── Privado ─────────────────────────────────────────────────────────────────

  _summarize(session) {
    const { frames, condition } = session;
    if (frames.length === 0) {
      return {
        condition, frameCount: 0, durationMs: 0, avgFps: 0,
        avgJitter: 0, maxJitter: 0, level: 'unstable',
        detectionRate: 0, fallbackRate: 0, maxContinuity: 0,
        modePcts: { full: 0, partial: 0, fallback: 0, lost: 0 },
        avgConfidence: 0,
      };
    }

    const gestureFrames = frames.filter(f => f.isGesture);

    // Jitter angular
    const jitters   = gestureFrames.map(f => f.angularJitter);
    const avgJitter = jitters.length > 0 ? jitters.reduce((a, b) => a + b, 0) / jitters.length : 0;
    const maxJitter = jitters.length > 0 ? Math.max(...jitters) : 0;
    const level     = avgJitter < 3 ? 'stable' : avgJitter < 8 ? 'moderate' : 'unstable';

    // Tasas de detección y fallback
    const detectionRate = (gestureFrames.length / frames.length) * 100;
    const fallbackRate  = (frames.filter(f => f.mode === 'fallback').length / frames.length) * 100;

    // Distribución de modos
    const modeCounts = { full: 0, partial: 0, fallback: 0, lost: 0 };
    frames.forEach(f => { modeCounts[f.mode] = (modeCounts[f.mode] ?? 0) + 1; });
    const modePcts = {};
    for (const [k, v] of Object.entries(modeCounts)) modePcts[k] = (v / frames.length) * 100;

    // Continuidad máxima
    let maxCont = 0, cur = 0;
    frames.forEach(f => {
      if (f.isGesture) { cur++; if (cur > maxCont) maxCont = cur; }
      else cur = 0;
    });

    // Confianza media
    const confs = gestureFrames.map(f => f.confidence);
    const avgConfidence = confs.length > 0
      ? (confs.reduce((a, b) => a + b, 0) / confs.length) * 100
      : 0;

    // FPS medio
    const fpsValues = frames.map(f => f.fps).filter(v => v > 0);
    const avgFps    = fpsValues.length > 0
      ? fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length
      : 0;

    return {
      condition,
      frameCount:    frames.length,
      durationMs:    frames.at(-1)?.t ?? 0,
      avgFps,
      avgJitter,
      maxJitter,
      level,
      detectionRate,
      fallbackRate,
      maxContinuity: maxCont,
      modePcts,
      avgConfidence,
    };
  }
}
