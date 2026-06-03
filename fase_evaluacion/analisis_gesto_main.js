'use strict';

const REGIONS = [
  'superior-izquierda', 'superior-centro',  'superior-derecha',
  'medio-izquierda',    'medio-centro',      'medio-derecha',
  'inferior-izquierda', 'inferior-centro',   'inferior-derecha',
];
const REGION_IDX    = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
const REGION_COLORS = [
  '#4477EE','#5599FF','#66BBFF',
  '#22BB66','#33DD88','#44FFAA',
  '#FF8833','#FFAA44','#FFCC66',
];
const REGION_COLOR = Object.fromEntries(REGIONS.map((r, i) => [r, REGION_COLORS[i]]));
const SHORT = {
  'superior-izquierda':'sup-izq','superior-centro':'sup-ctr','superior-derecha':'sup-der',
  'medio-izquierda':  'med-izq','medio-centro':  'med-ctr','medio-derecha':  'med-der',
  'inferior-izquierda':'inf-izq','inferior-centro':'inf-ctr','inferior-derecha':'inf-der',
};

// ── App ────────────────────────────────────────────────────────────────────────

class GestureAnalysis {
  constructor() {
    this._dropZone   = document.getElementById('dropZone');
    this._fileInput  = document.getElementById('fileInput');
    this._sourceBar  = document.getElementById('sourceBar');
    this._fileNameEl = document.getElementById('fileName');
    this._frameCountEl = document.getElementById('frameCount');
    this._reloadBtn  = document.getElementById('reloadBtn');
    this._results    = document.getElementById('results');

    this._dropZone.addEventListener('click', () => this._fileInput.click());
    this._dropZone.addEventListener('dragover', e => {
      e.preventDefault(); this._dropZone.classList.add('dragover');
    });
    this._dropZone.addEventListener('dragleave', () =>
      this._dropZone.classList.remove('dragover'));
    this._dropZone.addEventListener('drop', e => {
      e.preventDefault(); this._dropZone.classList.remove('dragover');
      this._load(e.dataTransfer.files[0]);
    });
    this._fileInput.addEventListener('change', () =>
      this._load(this._fileInput.files[0]));
    this._reloadBtn.addEventListener('click', () => this._reset());
  }

  // ── Carga ──────────────────────────────────────────────────────────────────

  _load(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const rows = this._parse(e.target.result);
      if (!rows.length) { alert('CSV sin datos con GT_Region válido.'); return; }
      this._fileNameEl.textContent  = file.name;
      this._frameCountEl.textContent = `${rows.length} frames con GT`;
      this._dropZone.style.display  = 'none';
      this._sourceBar.style.display = 'flex';
      this._render(this._analyze(rows));
      this._results.style.display   = 'block';
    };
    reader.readAsText(file);
  }

  _reset() {
    this._dropZone.style.display  = 'block';
    this._sourceBar.style.display = 'none';
    this._results.style.display   = 'none';
    this._fileInput.value = '';
  }

  // ── Parseo ─────────────────────────────────────────────────────────────────

  _parse(text) {
    const lines  = text.trim().split('\n');
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.trim());

    if (!header.includes('GT_Region')) {
      alert('El CSV no tiene columna GT_Region. Usa un CSV exportado desde el Protocolo guiado.');
      return [];
    }

    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = line.split(',').map(v => v.trim());
      const o    = Object.fromEntries(header.map((h, i) => [h, vals[i] ?? '']));
      return {
        gtRegion:  o['GT_Region'] || null,
        isGesture: o['Gesto']      === 'Sí' || o['Gesto']      === 'Si',
        confirmed: o['Confirmado'] === 'Sí' || o['Confirmado'] === 'Si',
        region:    o['Region']     ?? '',
      };
    }).filter(r => r.gtRegion);
  }

  // ── Cálculo ────────────────────────────────────────────────────────────────

  _analyze(rows) {
    const gesture   = rows.filter(r => r.isGesture);
    const confirmed = rows.filter(r => r.confirmed);

    // Numeradores: en cada contexto, cuántos acertaron la región
    const correctAll       = rows.filter(r => r.confirmed && r.region === r.gtRegion).length;
    const correctGesture   = gesture.filter(r => r.region === r.gtRegion).length;
    const correctConfirmed = confirmed.filter(r => r.region === r.gtRegion).length;

    const accAll       = rows.length     ? correctAll       / rows.length       : 0;
    const accGesture   = gesture.length  ? correctGesture   / gesture.length    : 0;
    const accConfirmed = confirmed.length? correctConfirmed / confirmed.length  : 0;

    // Por región
    const regionStats = {};
    for (const reg of REGIONS) {
      const rAll  = rows.filter(r => r.gtRegion === reg);
      const rGest = rAll.filter(r => r.isGesture);
      const rConf = rAll.filter(r => r.confirmed);
      regionStats[reg] = {
        total:            rAll.length,
        gestureCount:     rGest.length,
        confirmedCount:   rConf.length,
        correctAll:       rAll.filter(r => r.confirmed && r.region === reg).length,
        correctGesture:   rGest.filter(r => r.region === reg).length,
        correctConfirmed: rConf.filter(r => r.region === reg).length,
      };
    }

    // Matriz de confusión — solo frames con gesto
    const matrix = Array.from({ length: 9 }, () => new Array(9).fill(0));
    gesture.forEach(f => {
      const gtIdx  = REGION_IDX[f.gtRegion];
      const detIdx = REGION_IDX[f.region];
      if (gtIdx !== undefined && detIdx !== undefined) matrix[gtIdx][detIdx]++;
    });

    const dwellIsZero = gesture.length === confirmed.length &&
                        correctGesture === correctConfirmed;

    return {
      total: rows.length, gestureCount: gesture.length, confirmedCount: confirmed.length,
      correctAll, correctGesture, correctConfirmed,
      accAll, accGesture, accConfirmed,
      regionStats, matrix, dwellIsZero,
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _render(m) {
    const pct = v => (v * 100).toFixed(1) + '%';
    const color = v => v >= 0.75 ? '#4DFF88' : v >= 0.5 ? '#FFD700' : '#FF4D4D';

    // Tarjetas globales
    document.getElementById('accAll').textContent      = pct(m.accAll);
    document.getElementById('accAll').style.color      = color(m.accAll);
    document.getElementById('subAll').textContent      =
      `${m.correctAll} / ${m.total} frames`;

    document.getElementById('accGesture').textContent  = pct(m.accGesture);
    document.getElementById('accGesture').style.color  = color(m.accGesture);
    document.getElementById('subGesture').textContent  =
      `${m.correctGesture} / ${m.gestureCount} frames con gesto`;

    document.getElementById('accConfirmed').textContent = pct(m.accConfirmed);
    document.getElementById('accConfirmed').style.color = color(m.accConfirmed);
    document.getElementById('subConfirmed').textContent  =
      `${m.correctConfirmed} / ${m.confirmedCount} frames confirmados`;

    // Caja de diferencia
    const gap = m.accGesture - m.accAll;
    const nonGesture = m.total - m.gestureCount;
    const gapBox = document.getElementById('gapBox');
    gapBox.style.display = gap > 0.005 ? 'block' : 'none';
    document.getElementById('gapVal').textContent          = (gap * 100).toFixed(1);
    document.getElementById('nonGestureCount').textContent = nonGesture;
    document.getElementById('nonGesturePct').textContent   =
      (nonGesture / m.total * 100).toFixed(1);

    // Nota dwell=0
    document.getElementById('dwellNotice').style.display = m.dwellIsZero ? 'block' : 'none';

    // Tabla
    this._renderTable(m);

    // Matriz
    this._drawMatrix(m.matrix);
  }

  _renderTable(m) {
    const pct   = v => (v * 100).toFixed(0) + '%';
    const cls   = v => v >= 0.75 ? 'acc-good' : v >= 0.5 ? 'acc-mid' : 'acc-bad';
    const bar   = (n, d) => {
      const ratio = d ? n / d : 0;
      return `<div class="mini-bar-wrap"><div class="mini-bar-fill" style="width:${(ratio*100).toFixed(0)}%"></div></div>`;
    };

    document.getElementById('tableBody').innerHTML = REGIONS.map(reg => {
      const s = m.regionStats[reg];
      if (!s.total) return '';

      const aAll  = s.total     ? s.correctAll       / s.total            : 0;
      const aGest = s.gestureCount  ? s.correctGesture   / s.gestureCount  : 0;
      const aConf = s.confirmedCount? s.correctConfirmed / s.confirmedCount : 0;
      const gap   = aGest - aAll;
      const gestRate = s.total ? s.gestureCount / s.total : 0;

      return `<tr>
        <td><span class="region-dot" style="background:${REGION_COLOR[reg]}"></span>${reg}</td>
        <td>${s.total}</td>
        <td>${pct(gestRate)} ${bar(s.gestureCount, s.total)}</td>
        <td class="acc-col ${cls(aAll)}">${pct(aAll)}</td>
        <td class="acc-col ${cls(aGest)}">${pct(aGest)}</td>
        <td class="acc-col ${cls(aConf)}">${pct(aConf)}</td>
        <td class="${gap > 0.05 ? 'acc-mid' : 'dim'}">
          ${gap > 0.005 ? '+' + (gap * 100).toFixed(0) + ' pp' : '—'}
        </td>
      </tr>`;
    }).join('');
  }

  _drawMatrix(matrix) {
    const canvas = document.getElementById('matrixCanvas');
    const SIZE = 460, PAD = 8, LABEL = 65, N = 9;
    const cW = (SIZE - PAD - LABEL) / N;
    const cH = (SIZE - PAD - LABEL) / N;
    canvas.width  = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const max = Math.max(...matrix.flat(), 1);

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Etiquetas filas (GT)
    REGIONS.forEach((r, i) => {
      ctx.fillStyle = REGION_COLOR[r];
      ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(SHORT[r], PAD + LABEL - 3, PAD + LABEL + i * cH + cH * 0.62);
    });

    // Etiquetas columnas (detectado, rotadas)
    REGIONS.forEach((r, j) => {
      ctx.save();
      ctx.translate(PAD + LABEL + j * cW + cW / 2, PAD + LABEL - 4);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right'; ctx.fillStyle = REGION_COLOR[r];
      ctx.font = '8px monospace'; ctx.fillText(SHORT[r], 0, 0);
      ctx.restore();
    });

    // Celdas
    matrix.forEach((row, i) => {
      row.forEach((val, j) => {
        const x = PAD + LABEL + j * cW, y = PAD + LABEL + i * cH;
        const n = val / max;
        ctx.fillStyle = val === 0 ? '#111120'
          : i === j ? `rgb(20,${Math.round(40 + n * 180)},40)`
          : `rgb(${Math.round(40 + n * 180)},20,20)`;
        ctx.fillRect(x + 1, y + 1, cW - 2, cH - 2);
        if (val > 0) {
          ctx.fillStyle = n > 0.45 ? '#fff' : '#888';
          ctx.font = `${Math.min(11, cW * 0.45)}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(val, x + cW / 2, y + cH * 0.65);
        }
      });
    });

    // Títulos de eje
    ctx.fillStyle = '#2a2a4e'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Detectado →', PAD + LABEL + (N * cW) / 2, SIZE - 2);
    ctx.save();
    ctx.translate(6, PAD + LABEL + (N * cH) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('GT →', 0, 0);
    ctx.restore();
  }
}

document.addEventListener('DOMContentLoaded', () => new GestureAnalysis());
