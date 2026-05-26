/**
 * Graba sesiones de evaluación etiquetadas con una condición experimental
 * y genera resúmenes estadísticos y exportación CSV.
 */
export class SessionLogger {
  constructor() {
    this._sessions = [];
    this._current  = null;
  }

  get isRecording() { return this._current !== null; }
  get sessionCount() { return this._sessions.length; }

  /**
   * Inicia una nueva sesión de grabación.
   * @param {{ distance: string, lighting: string, movement: string, occlusion: string }} condition
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
   * Registra el estado de un frame.
   * @param {Object} metrics     - resultado de stabilityTracker.getAllMetrics()
   * @param {Array}  comparisons - resultado de compareSourceLandmarks()
   * @param {number} fps         - FPS actual del loop (FPSTracker.fps)
   */
  recordFrame(metrics, comparisons, fps = 0) {
    if (!this._current) return;
    this._current.frames.push({
      t:           Math.round(performance.now() - this._current.startTime),
      fps,
      metrics:     this._snapshotMetrics(metrics),
      comparisons: comparisons.map(c => ({
        id:       c.id,
        label:    c.label,
        distance: c.distance,
        level:    c.level,
      })),
    });
  }

  /**
   * Finaliza la sesión y devuelve el resumen.
   * @returns {Object | null}
   */
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

  /** Exporta todas las sesiones como string CSV. */
  exportCSV() {
    const header = [
      'Sesión', 'Distancia', 'Iluminación', 'Movimiento', 'Oclusión',
      'Frames', 'Duración(ms)', 'FPSMedio',
      'Landmark', 'JitterMedio(‰)', 'Visibilidad(%)', 'Continuidad', 'TrackingLost(%)',
    ].join(',');

    const rows = [header];
    this._sessions.forEach(s => {
      const cond = s.summary.condition;
      Object.entries(s.summary.avgStability).forEach(([key, m]) => {
        rows.push([
          s.id,
          cond.distance, cond.lighting, cond.movement, cond.occlusion,
          s.summary.frameCount,
          s.summary.durationMs,
          s.summary.avgFps.toFixed(1),
          key,
          (m.avgJitter * 1000).toFixed(2),
          (m.avgVisibility * 100).toFixed(1),
          m.avgContinuity.toFixed(0),
          m.avgTrackingLoss !== undefined ? m.avgTrackingLoss.toFixed(1) : '',
        ].join(','));
      });
    });

    return rows.join('\n');
  }

  // ── Privado ─────────────────────────────────────────────────────────────────

  _snapshotMetrics(metrics) {
    const snap = {};
    for (const [key, m] of Object.entries(metrics)) {
      snap[key] = { jitter: m.jitter, meanVisibility: m.meanVisibility, continuity: m.continuity ?? 0 };
    }
    return snap;
  }

  _summarize(session) {
    const { frames, condition } = session;
    if (frames.length === 0) return { condition, frameCount: 0, durationMs: 0, avgStability: {}, avgDivergence: {} };

    // ── Estabilidad media por landmark ──────────────────────────────────────
    const landmarkKeys = Object.keys(frames[0]?.metrics ?? {});
    const avgStability = {};
    landmarkKeys.forEach(key => {
      const jitters     = frames.map(f => f.metrics[key]?.jitter         ?? 0);
      const vis         = frames.map(f => f.metrics[key]?.meanVisibility  ?? 0);
      const conts       = frames.map(f => f.metrics[key]?.continuity      ?? 0);
      const losses = frames.map(f => f.metrics[key]?.trackingLoss ?? 0);
      avgStability[key] = {
        avgJitter:        jitters.reduce((a, b) => a + b, 0) / jitters.length,
        avgVisibility:    vis.reduce((a, b) => a + b, 0)     / vis.length,
        avgContinuity:    conts.reduce((a, b) => a + b, 0)   / conts.length,
        avgTrackingLoss:  losses.reduce((a, b) => a + b, 0)  / losses.length,
      };
    });

    // ── Divergencia media Pose vs Hands ─────────────────────────────────────
    const compIds = [...new Set(frames.flatMap(f => f.comparisons.map(c => c.id)))];
    const avgDivergence = {};
    compIds.forEach(id => {
      const dists = frames
        .flatMap(f => f.comparisons.filter(c => c.id === id && c.distance !== null))
        .map(c => c.distance);
      if (dists.length > 0) {
        avgDivergence[id] = dists.reduce((a, b) => a + b, 0) / dists.length;
      }
    });

    const fpsValues = frames.map(f => f.fps ?? 0).filter(v => v > 0);
    const avgFps    = fpsValues.length > 0
      ? fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length
      : 0;

    return {
      condition,
      frameCount:   frames.length,
      durationMs:   frames.at(-1)?.t ?? 0,
      avgFps,
      avgStability,
      avgDivergence,
    };
  }
}
