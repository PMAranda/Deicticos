'use strict';

const FPS_NOMINAL = 30;
const DWELL_SWEEP = [0,5,10,15,20,25,30,40,50,60,75,90];

const REGIONS = [
  'superior-izquierda', 'superior-centro',  'superior-derecha',
  'medio-izquierda',    'medio-centro',      'medio-derecha',
  'inferior-izquierda', 'inferior-centro',   'inferior-derecha',
];

const REGION_IDX = Object.fromEntries(REGIONS.map((r, i) => [r, i]));

// Blues (superior), greens (medio), ambers (inferior)
const REGION_COLORS = [
  '#4477EE', '#5599FF', '#66BBFF',
  '#22BB66', '#33DD88', '#44FFAA',
  '#FF8833', '#FFAA44', '#FFCC66',
];
const REGION_COLOR = Object.fromEntries(REGIONS.map((r, i) => [r, REGION_COLORS[i]]));

const SHORT = {
  'superior-izquierda': 'sup-izq', 'superior-centro': 'sup-ctr', 'superior-derecha': 'sup-der',
  'medio-izquierda':    'med-izq', 'medio-centro':    'med-ctr', 'medio-derecha':    'med-der',
  'inferior-izquierda': 'inf-izq', 'inferior-centro': 'inf-ctr', 'inferior-derecha': 'inf-der',
};

// ── App ────────────────────────────────────────────────────────────────────

class EvalApp {
  constructor() {
    // DOM
    this._dropZone        = document.getElementById('dropZone');
    this._fileInput       = document.getElementById('fileInput');
    this._sourceBar       = document.getElementById('sourceBar');
    this._fileNameEl      = document.getElementById('fileName');
    this._frameCountEl    = document.getElementById('frameCount');
    this._videoDurEl      = document.getElementById('videoDuration');
    this._reloadBtn       = document.getElementById('reloadBtn');
    this._configSection   = document.getElementById('configSection');
    this._resultsSection  = document.getElementById('resultsSection');
    this._analyzeBtn      = document.getElementById('analyzeBtn');
    this._exportCsvBtn    = document.getElementById('exportCsvBtn');
    this._exportMatrixBtn = document.getElementById('exportMatrixBtn');
    this._rawNotice       = document.getElementById('rawNotice');
    this._dwellSlider     = document.getElementById('dwellSlider');
    this._dwellValueEl    = document.getElementById('dwellValue');
    this._curveSection    = document.getElementById('curveSection');
    this._curveCanvas     = document.getElementById('curveCanvas');

    this._startTimeEl   = document.getElementById('startTime');
    this._durationEl    = document.getElementById('regionDuration');
    this._gapEl         = document.getElementById('regionGap');
    this._detModeEl     = document.getElementById('detectionMode');
    this._previewBody   = document.getElementById('protocolPreview');

    this._statsPills    = document.getElementById('statsPills');
    this._tGT           = document.getElementById('timelineGT');
    this._tDet          = document.getElementById('timelineDet');
    this._timelineInfo  = document.getElementById('timelineInfo');
    this._timelineLbl   = document.getElementById('timelineLabel');
    this._timelineLeg   = document.getElementById('timelineLegend');
    this._matrixCanvas  = document.getElementById('matrixCanvas');
    this._metricsBody   = document.getElementById('metricsBody');

    // State
    this._frames  = [];
    this._results = null;
    this._isRaw   = false;   // true si el CSV no tiene columna Confirmado

    this._bindEvents();
    this._initRegionOrder();
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  _bindEvents() {
    this._dropZone.addEventListener('click', () => this._fileInput.click());
    this._dropZone.addEventListener('dragover', e => {
      e.preventDefault(); this._dropZone.classList.add('dragover');
    });
    this._dropZone.addEventListener('dragleave', () =>
      this._dropZone.classList.remove('dragover'));
    this._dropZone.addEventListener('drop', e => {
      e.preventDefault();
      this._dropZone.classList.remove('dragover');
      this._loadFile(e.dataTransfer.files[0]);
    });
    this._fileInput.addEventListener('change', () =>
      this._loadFile(this._fileInput.files[0]));
    this._reloadBtn.addEventListener('click', () => this._reset());

    ['startTime', 'regionDuration', 'regionGap'].forEach(id =>
      document.getElementById(id).addEventListener('input', () =>
        this._updatePreview()));

    this._analyzeBtn.addEventListener('click',      () => this._analyze());
    this._exportCsvBtn.addEventListener('click',    () => this._exportCSV());
    this._exportMatrixBtn.addEventListener('click', () => this._exportMatrixPNG());
    this._dwellSlider?.addEventListener('input', () => {
      const n = Number(this._dwellSlider.value);
      const s = (n / FPS_NOMINAL).toFixed(1);
      this._dwellValueEl.textContent = n === 0 ? '0 f (inmediato)' : `${n} f (~${s} s)`;
      if (this._frames.length) this._analyze();
    });

    // Hover sobre timelines
    [this._tGT, this._tDet].forEach(canvas => {
      canvas.addEventListener('mousemove', e => this._onTimelineHover(e));
      canvas.addEventListener('mouseleave', () => {
        this._timelineInfo.textContent = '';
      });
    });
  }

  // ── Drag-to-reorder de regiones ───────────────────────────────────────────

  _initRegionOrder() {
    const container = document.getElementById('regionOrder');
    REGIONS.forEach(r => {
      const chip       = document.createElement('div');
      chip.className   = 'region-chip';
      chip.dataset.region = r;
      chip.draggable   = true;
      chip.style.borderColor = REGION_COLOR[r];
      chip.style.color       = REGION_COLOR[r];
      chip.textContent = r;
      container.appendChild(chip);
    });

    let dragEl = null;
    container.addEventListener('dragstart', e => {
      dragEl = e.target.closest('.region-chip');
      if (dragEl) dragEl.classList.add('dragging');
    });
    container.addEventListener('dragend', () => {
      if (dragEl) { dragEl.classList.remove('dragging'); dragEl = null; }
      this._updatePreview();
    });
    container.addEventListener('dragover', e => {
      e.preventDefault();
      const over = e.target.closest('.region-chip');
      if (!over || over === dragEl) return;
      const rect = over.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        container.insertBefore(dragEl, over);
      } else {
        container.insertBefore(dragEl, over.nextSibling);
      }
    });
  }

  _getRegionOrder() {
    return [...document.querySelectorAll('#regionOrder .region-chip')]
      .map(el => el.dataset.region);
  }

  // ── Carga del CSV ─────────────────────────────────────────────────────────

  _loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const text   = e.target.result;
      const header = text.split('\n')[0] ?? '';
      this._isRaw  = !header.includes('Confirmado');
      this._frames = this._parseCSV(text);
      if (!this._frames.length) {
        alert('El CSV no tiene datos o el formato no es compatible.');
        return;
      }
      const dur = this._frames[this._frames.length - 1].time;
      this._fileNameEl.textContent   = file.name;
      this._frameCountEl.textContent = `${this._frames.length} frames · ${this._isRaw ? 'bruto' : 'procesado'}`;
      this._videoDurEl.textContent   = `${dur.toFixed(1)} s`;
      this._sourceBar.style.display     = 'flex';
      this._configSection.style.display = 'block';
      this._resultsSection.style.display = 'none';
      this._rawNotice.style.display     = this._isRaw ? 'flex' : 'none';
      this._updatePreview();
    };
    reader.readAsText(file);
  }

  _parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const o    = Object.fromEntries(header.map((h, i) => [h, vals[i] ?? '']));
      const isRawRow = !('Confirmado' in o);
      return {
        frame:     parseInt(o['Frame'])       || 0,
        time:      parseFloat(o['Tiempo(s)']) || 0,
        isGesture: o['Gesto']     === 'Sí' || o['Gesto'] === '1',
        confirmed: isRawRow ? null : (o['Confirmado'] === 'Sí' || o['Confirmado'] === '1'),
        region:    o['Region']    ?? '',
        confidence: parseFloat(o['Confianza(%)']) || 0,
        mode:      o['Modo'] ?? '',
        xn:        parseFloat(o['X_norm']) || 0,
        yn:        parseFloat(o['Y_norm']) || 0,
      };
    });
  }

  _reset() {
    this._frames  = [];
    this._results = null;
    this._fileInput.value = '';
    this._sourceBar.style.display       = 'none';
    this._configSection.style.display   = 'none';
    this._resultsSection.style.display  = 'none';
    this._dropZone.style.display        = 'block';
  }

  // ── Vista previa del protocolo ────────────────────────────────────────────

  _buildSegments() {
    const start    = parseFloat(this._startTimeEl.value)  || 0;
    const duration = parseFloat(this._durationEl.value)   || 4;
    const gap      = parseFloat(this._gapEl.value)        || 0;
    const order    = this._getRegionOrder();
    let t = start;
    return order.map(region => {
      const seg = { start: t, end: t + duration, region };
      t += duration + gap;
      return seg;
    });
  }

  _updatePreview() {
    const segs = this._buildSegments();
    this._previewBody.innerHTML = segs.map((s, i) =>
      `<tr>
        <td>${i + 1}</td>
        <td><span class="region-dot" style="background:${REGION_COLOR[s.region] ?? '#666'}"></span>${s.region}</td>
        <td>${s.start.toFixed(1)} s</td>
        <td>${s.end.toFixed(1)} s</td>
      </tr>`
    ).join('');
  }

  // ── Dwell simulation (para CSV bruto) ─────────────────────────────────────

  _applyDwell(frames, dwellFrames) {
    let count = 0, confirmed = false;
    return frames.map(f => {
      if (f.isGesture) {
        count = Math.min(count + 1, Math.max(1, dwellFrames));
        if (dwellFrames === 0 || count >= dwellFrames) confirmed = true;
      } else { count = 0; confirmed = false; }
      return { ...f, confirmed };
    });
  }

  // ── Análisis ──────────────────────────────────────────────────────────────

  _analyze() {
    if (!this._frames.length) return;
    const segments = this._buildSegments();
    const dwellFrames  = this._isRaw ? Number(this._dwellSlider?.value ?? 30) : 0;
    const workFrames   = this._isRaw ? this._applyDwell(this._frames, dwellFrames) : this._frames;
    const useConfirmed = this._isRaw ? true : this._detModeEl.value === 'confirmed';

    // Asignar GT a cada frame
    const annotated = workFrames.map(f => {
      const seg = segments.find(s => f.time >= s.start && f.time < s.end);
      const detected = (useConfirmed ? f.confirmed : f.isGesture) && f.region
        ? f.region : null;
      return { ...f, gtRegion: seg?.region ?? null, detected };
    });

    this._results = { ...this._computeMetrics(annotated, segments), annotated, segments,
                      dwellFrames };
    this._resultsSection.style.display = 'block';
    this._renderResults();
    this._resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _computeMetrics(annotated, segments) {
    const gtFrames = annotated.filter(f => f.gtRegion !== null);
    const total    = gtFrames.length;

    // Matriz de confusión 9×9
    const matrix = Array.from({ length: 9 }, () => new Array(9).fill(0));
    let tp = 0, noDetection = 0;

    const perRegion = Object.fromEntries(
      REGIONS.map(r => [r, { tp: 0, fp: 0, fn: 0 }])
    );

    // Latencia: primer frame correcto por segmento
    const segLatency = segments.map(s => ({ ...s, firstCorrectTime: null }));

    gtFrames.forEach(f => {
      const gtIdx  = REGION_IDX[f.gtRegion];
      if (gtIdx === undefined) return;

      if (!f.detected) {
        noDetection++;
        perRegion[f.gtRegion].fn++;
        return;
      }

      const detIdx = REGION_IDX[f.detected];
      if (detIdx !== undefined) matrix[gtIdx][detIdx]++;

      if (f.detected === f.gtRegion) {
        tp++;
        perRegion[f.gtRegion].tp++;
        const seg = segLatency.find(s => f.time >= s.start && f.time < s.end);
        if (seg && seg.firstCorrectTime === null) seg.firstCorrectTime = f.time;
      } else {
        perRegion[f.gtRegion].fn++;
        if (perRegion[f.detected]) perRegion[f.detected].fp++;
      }
    });

    // Métricas por región
    const regionMetrics = {};
    REGIONS.forEach(r => {
      const { tp: rtp, fp, fn } = perRegion[r];
      const precision = rtp + fp > 0 ? rtp / (rtp + fp) : 0;
      const recall    = rtp + fn > 0 ? rtp / (rtp + fn) : 0;
      const f1        = precision + recall > 0
        ? 2 * precision * recall / (precision + recall) : 0;
      regionMetrics[r] = { tp: rtp, fp, fn, precision, recall, f1 };
    });

    // Latencias
    const latencies  = segLatency.map(s =>
      s.firstCorrectTime !== null ? s.firstCorrectTime - s.start : null);
    const validLat   = latencies.filter(l => l !== null);
    const avgLatency = validLat.length
      ? validLat.reduce((a, b) => a + b, 0) / validLat.length : null;

    const gestureFrames = gtFrames.filter(f => f.isGesture).length;
    const confirmedFrames = gtFrames.filter(f => f.confirmed).length;

    return {
      accuracy:    total > 0 ? tp / total : 0,
      tp, total, noDetection,
      gestureRate:   total > 0 ? gestureFrames   / total : 0,
      confirmRate:   total > 0 ? confirmedFrames / total : 0,
      matrix,
      regionMetrics,
      segLatencies: latencies,
      avgLatency,
      missedSegs:  latencies.filter(l => l === null).length,
      totalSegs:   segments.length,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _renderResults() {
    const r = this._results;

    // Pills
    const accColor = r.accuracy > 0.75 ? '#4DFF88' : r.accuracy > 0.5 ? '#FFD700' : '#FF4D4D';
    const pills = [
      { v: `${(r.accuracy * 100).toFixed(1)}%`,  l: 'Precisión región',  c: accColor },
      { v: `${r.tp} / ${r.total}`,                l: 'Frames correctos',  c: '#c0c0e0' },
      { v: `${(r.gestureRate  * 100).toFixed(1)}%`, l: 'Gesto detectado', c: '#9ab4f5' },
      { v: `${(r.confirmRate  * 100).toFixed(1)}%`, l: 'Confirmado',      c: '#FFD700' },
      { v: r.avgLatency !== null ? `${r.avgLatency.toFixed(2)} s` : '—',
         l: 'Latencia media', c: '#FF8C4D' },
      { v: `${r.missedSegs} / ${r.totalSegs}`, l: 'Regiones perdidas',
         c: r.missedSegs === 0 ? '#4DFF88' : '#FF4D4D' },
    ];
    this._statsPills.innerHTML = pills
      .map(p => `<div class="stat-pill">
                   <span class="stat-value" style="color:${p.c}">${p.v}</span>
                   <span class="stat-label">${p.l}</span>
                 </div>`).join('');

    // Leyenda timeline
    this._timelineLbl.textContent = `— ${this._detModeEl.value === 'confirmed' ? 'detección confirmada (dwell)' : 'detección bruta'}`;
    this._timelineLeg.innerHTML = REGIONS.map(r =>
      `<span class="legend-item">
         <span class="legend-dot" style="background:${REGION_COLOR[r]}"></span>
         ${SHORT[r]}
       </span>`
    ).join('') + `<span class="legend-item">
      <span class="legend-dot" style="background:#1a1a2e;border:1px solid #333"></span>sin detección
    </span>`;

    this._drawTimelines();
    this._drawConfusionMatrix();
    this._renderMetricsTable();

    // Curva solo para CSV bruto
    if (this._isRaw) {
      this._curveSection.style.display = 'block';
      this._drawDwellCurve(r.segments);
    } else {
      this._curveSection.style.display = 'none';
    }

    this._exportCsvBtn.disabled    = false;
    this._exportMatrixBtn.disabled = false;
  }

  // ── Timelines ─────────────────────────────────────────────────────────────

  _drawTimelines() {
    const { annotated, segments } = this._results;
    const gtFrames = annotated.filter(f => f.gtRegion !== null);
    if (!gtFrames.length) return;

    const W    = this._tGT.parentElement.clientWidth - 30;
    const H    = 28;
    const tMin = gtFrames[0].time;
    const tMax = gtFrames[gtFrames.length - 1].time;
    const tR   = tMax - tMin || 1;
    const toX  = t => Math.round(((t - tMin) / tR) * W);

    [this._tGT, this._tDet].forEach(c => {
      c.width  = W;
      c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, W, H);
    });

    const gtCtx  = this._tGT.getContext('2d');
    const detCtx = this._tDet.getContext('2d');

    // GT: bloques de color por segmento
    segments.forEach(s => {
      const x0 = toX(s.start), x1 = toX(s.end);
      gtCtx.fillStyle = REGION_COLOR[s.region] ?? '#444';
      gtCtx.fillRect(x0, 0, x1 - x0, H);
    });

    // Detected: frame a frame
    let runStart = null, runColor = null;
    const flushRun = endX => {
      if (runStart !== null) {
        detCtx.fillStyle = runColor;
        detCtx.fillRect(runStart, 0, endX - runStart, H);
      }
    };
    gtFrames.forEach((f, i) => {
      const x     = toX(f.time);
      const color = f.detected ? (REGION_COLOR[f.detected] ?? '#888') : '#1a1a2e';
      if (color !== runColor) { flushRun(x); runStart = x; runColor = color; }
      if (i === gtFrames.length - 1) flushRun(W);
    });

    // Marker de separación entre segmentos
    gtCtx.strokeStyle = '#0f1117';
    gtCtx.lineWidth   = 2;
    segments.forEach(s => {
      const x = toX(s.end);
      gtCtx.beginPath(); gtCtx.moveTo(x, 0); gtCtx.lineTo(x, H); gtCtx.stroke();
    });
  }

  _onTimelineHover(e) {
    const { annotated, segments } = this._results ?? {};
    if (!annotated) return;
    const canvas = e.currentTarget;
    const rect   = canvas.getBoundingClientRect();
    const rx     = (e.clientX - rect.left) / rect.width;

    const gtFrames = annotated.filter(f => f.gtRegion !== null);
    if (!gtFrames.length) return;
    const tMin = gtFrames[0].time, tMax = gtFrames[gtFrames.length - 1].time;
    const t    = tMin + rx * (tMax - tMin);

    const f   = gtFrames.reduce((best, cur) =>
      Math.abs(cur.time - t) < Math.abs(best.time - t) ? cur : best);
    const seg = segments.find(s => f.time >= s.start && f.time < s.end);

    this._timelineInfo.textContent =
      `t=${f.time.toFixed(2)}s · GT: ${f.gtRegion ?? '—'} · Det: ${f.detected ?? 'sin det.'} · ` +
      `${f.detected === f.gtRegion ? '✓ correcto' : '✗ error'}` +
      (seg ? ` · segmento ${segments.indexOf(seg) + 1}/${segments.length}` : '');
  }

  // ── Matriz de confusión ───────────────────────────────────────────────────

  _drawConfusionMatrix() {
    const matrix = this._results.matrix;
    const SIZE   = 500;
    const PAD    = 8;
    const LABEL  = 70;
    const N      = 9;
    const cellW  = (SIZE - PAD - LABEL) / N;
    const cellH  = (SIZE - PAD - LABEL) / N;

    this._matrixCanvas.width  = SIZE;
    this._matrixCanvas.height = SIZE;
    const ctx = this._matrixCanvas.getContext('2d');

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const maxVal = Math.max(...matrix.flat(), 1);

    // Etiquetas filas (GT)
    REGIONS.forEach((r, i) => {
      ctx.fillStyle = REGION_COLOR[r];
      ctx.font      = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(SHORT[r], PAD + LABEL - 4,
        PAD + LABEL + i * cellH + cellH * 0.62);
    });

    // Etiquetas columnas (Detected) — rotadas
    REGIONS.forEach((r, j) => {
      ctx.save();
      ctx.translate(PAD + LABEL + j * cellW + cellW / 2, PAD + LABEL - 4);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign  = 'right';
      ctx.fillStyle  = REGION_COLOR[r];
      ctx.font       = '9px monospace';
      ctx.fillText(SHORT[r], 0, 0);
      ctx.restore();
    });

    // Título ejes
    ctx.fillStyle = '#3a3a5e';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Detectado →', PAD + LABEL + (N * cellW) / 2, SIZE - 2);
    ctx.save();
    ctx.translate(6, PAD + LABEL + (N * cellH) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('GT →', 0, 0);
    ctx.restore();

    // Celdas
    matrix.forEach((row, i) => {
      row.forEach((val, j) => {
        const x    = PAD + LABEL + j * cellW;
        const y    = PAD + LABEL + i * cellH;
        const norm = val / maxVal;

        if (val === 0) {
          ctx.fillStyle = '#111120';
        } else if (i === j) {
          const g = Math.round(40 + norm * 180);
          ctx.fillStyle = `rgb(20, ${g}, 40)`;
        } else {
          const r = Math.round(40 + norm * 180);
          ctx.fillStyle = `rgb(${r}, 20, 20)`;
        }
        ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);

        if (val > 0) {
          ctx.fillStyle  = norm > 0.45 ? '#ffffff' : '#888888';
          ctx.font       = `${Math.min(11, cellW * 0.45)}px monospace`;
          ctx.textAlign  = 'center';
          ctx.fillText(val, x + cellW / 2, y + cellH * 0.65);
        }
      });
    });
  }

  // ── Tabla de métricas ─────────────────────────────────────────────────────

  _renderMetricsTable() {
    const { regionMetrics, segLatencies } = this._results;
    let bestF1 = 0;
    REGIONS.forEach(r => { if (regionMetrics[r].f1 > bestF1) bestF1 = regionMetrics[r].f1; });

    this._metricsBody.innerHTML = REGIONS.map((r, i) => {
      const m   = regionMetrics[r];
      const lat = segLatencies[i] !== null ? `${segLatencies[i].toFixed(2)} s` : '✗';
      const f1c = m.f1 > 0.75 ? '#4DFF88' : m.f1 > 0.45 ? '#FFD700' : '#FF4D4D';
      const best = m.f1 === bestF1 && m.f1 > 0;
      return `<tr${best ? ' class="best-row"' : ''}>
        <td><span class="region-dot" style="background:${REGION_COLOR[r]}"></span>${r}</td>
        <td>${m.tp}</td><td>${m.fp}</td><td>${m.fn}</td>
        <td>${(m.precision * 100).toFixed(0)}%</td>
        <td>${(m.recall    * 100).toFixed(0)}%</td>
        <td style="color:${f1c};font-weight:700">${(m.f1 * 100).toFixed(0)}%</td>
        <td>${lat}</td>
      </tr>`;
    }).join('');
  }

  // ── Curva precisión / latencia vs. dwell ─────────────────────────────────

  _drawDwellCurve(segments) {
    const canvas = this._curveCanvas;
    const W = canvas.offsetWidth || 700;
    const H = 200;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    // Calcular accuracy y latencia para cada umbral
    const points = DWELL_SWEEP.map(d => {
      const worked  = this._applyDwell(this._frames, d);
      const annotated = worked.map(f => {
        const seg      = segments.find(s => f.time >= s.start && f.time < s.end);
        const detected = f.confirmed && f.region ? f.region : null;
        return { ...f, gtRegion: seg?.region ?? null, detected };
      });
      const gtF   = annotated.filter(f => f.gtRegion !== null);
      const total = gtF.length;
      const tp    = gtF.filter(f => f.detected === f.gtRegion).length;
      const acc   = total > 0 ? tp / total : 0;

      // Latencia media por segmento
      const segLats = segments.map(s => {
        const first = annotated.find(f =>
          f.time >= s.start && f.time < s.end && f.detected === s.region);
        return first ? first.time - s.start : null;
      });
      const valid    = segLats.filter(l => l !== null);
      const avgLat   = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;

      return { d, acc, avgLat };
    });

    const PAD   = 36;
    const chartW = W - PAD * 2;
    const chartH = H - PAD * 2;
    const maxD   = DWELL_SWEEP[DWELL_SWEEP.length - 1];
    const maxLat = Math.max(...points.map(p => p.avgLat ?? 0), 1);
    const toX    = d   => PAD + (d / maxD) * chartW;
    const accY   = acc => PAD + chartH - acc * chartH;
    const latY   = lat => lat !== null ? PAD + chartH - (lat / maxLat) * chartH : null;

    // Ejes
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, PAD); ctx.lineTo(PAD, PAD + chartH);
    ctx.lineTo(PAD + chartW, PAD + chartH);
    ctx.stroke();

    // Líneas de guía horizontales
    [0.25, 0.5, 0.75, 1.0].forEach(v => {
      const y = accY(v);
      ctx.strokeStyle = '#1a1a2e';
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(PAD + chartW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#3a3a5e';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${(v * 100).toFixed(0)}%`, PAD - 4, y + 3);
    });

    // Etiquetas eje X
    DWELL_SWEEP.forEach(d => {
      const x = toX(d);
      ctx.fillStyle = '#3a3a5e';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d, x, PAD + chartH + 14);
    });
    ctx.fillStyle = '#3a3a5e';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Dwell (frames)', PAD + chartW / 2, H - 2);

    // Línea de latencia (naranja)
    ctx.strokeStyle = '#FF8C4D';
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    let first = true;
    points.forEach(p => {
      const x = toX(p.d);
      const y = latY(p.avgLat);
      if (y === null) return;
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    });
    ctx.stroke();

    // Línea de precisión (verde)
    ctx.strokeStyle = '#4DFF88';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = toX(p.d);
      const y = accY(p.acc);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Puntos en la línea de precisión
    points.forEach(p => {
      ctx.fillStyle = '#4DFF88';
      ctx.beginPath();
      ctx.arc(toX(p.d), accY(p.acc), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Línea vertical del umbral seleccionado
    const selD = this._results?.dwellFrames ?? 30;
    if (DWELL_SWEEP.includes(selD) || true) {
      ctx.strokeStyle = '#9ab4f5';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      const x = toX(selD);
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, PAD + chartH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9ab4f5';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${selD}f`, x, PAD - 4);
    }
  }

  // ── Exportar CSV ──────────────────────────────────────────────────────────

  _exportCSV() {
    if (!this._results) return;
    const { annotated, accuracy, regionMetrics, segLatencies, avgLatency,
            missedSegs, totalSegs } = this._results;

    const lines = ['Frame,Tiempo(s),GT_Region,Det_Region,Correcto'];
    annotated.filter(f => f.gtRegion !== null).forEach(f => {
      lines.push(`${f.frame},${f.time.toFixed(3)},${f.gtRegion},` +
        `${f.detected ?? ''},${f.detected === f.gtRegion ? 'Sí' : 'No'}`);
    });

    lines.push('', 'MÉTRICAS GLOBALES');
    lines.push(`Precisión global,${(accuracy * 100).toFixed(2)}%`);
    lines.push(`Latencia media,${avgLatency !== null ? avgLatency.toFixed(3) + ' s' : '—'}`);
    lines.push(`Regiones perdidas,${missedSegs}/${totalSegs}`);

    lines.push('', 'MÉTRICAS POR REGIÓN', 'Región,TP,FP,FN,Precisión,Recall,F1,Latencia');
    REGIONS.forEach((r, i) => {
      const m   = regionMetrics[r];
      const lat = segLatencies[i] !== null ? segLatencies[i].toFixed(3) + ' s' : '—';
      lines.push(`${r},${m.tp},${m.fp},${m.fn},` +
        `${(m.precision*100).toFixed(1)}%,${(m.recall*100).toFixed(1)}%,` +
        `${(m.f1*100).toFixed(1)}%,${lat}`);
    });

    this._download(lines.join('\n'), `evaluacion_${Date.now()}.csv`, 'text/csv');
  }

  // ── Exportar matriz como PNG ──────────────────────────────────────────────

  _exportMatrixPNG() {
    this._matrixCanvas.toBlob(blob => {
      this._download(URL.createObjectURL(blob), `matriz_confusion_${Date.now()}.png`, 'image/png');
    });
  }

  _download(data, filename, type) {
    const isURL  = data.startsWith('blob:') || data.startsWith('data:');
    const url    = isURL ? data : URL.createObjectURL(new Blob([data], { type }));
    const a      = document.createElement('a');
    a.href       = url; a.download = filename; a.click();
    if (!isURL) URL.revokeObjectURL(url);
  }
}

document.addEventListener('DOMContentLoaded', () => new EvalApp());
