import { PoseEstimator }          from '../../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }          from '../../src/modules/estimacion_corporal/hands.js';
import { extractDeicticLandmarks } from '../../src/modules/estimacion_corporal/landmarks.js';
import { PointingEstimator }      from '../../src/modules/heuristica/pointing.js';
import { rayPolygonIntersect, isPointInConvexPolygon } from '../../src/modules/grounding/interseccion.js';

// ── Perspectiva pura JS (sin OpenCV) ──────────────────────────────────────────

function computeHomography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x: xi, y: yi } = src[i];
    const { x: ui, y: vi } = dst[i];
    A.push([xi, yi, 1,  0,  0, 0, -ui*xi, -ui*yi, ui]);
    A.push([ 0,  0, 0, xi, yi, 1, -vi*xi, -vi*yi, vi]);
  }
  for (let col = 0; col < 8; col++) {
    let maxRow = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    const p = A[col][col];
    if (Math.abs(p) < 1e-12) return null;
    for (let j = col; j < 9; j++) A[col][j] /= p;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const f = A[row][col];
      for (let j = col; j < 9; j++) A[row][j] -= f * A[col][j];
    }
  }
  return [...A.map(r => r[8]), 1];
}

function applyHomography(H, pt) {
  if (!H) return pt;
  const w = H[6]*pt.x + H[7]*pt.y + H[8];
  return { x: (H[0]*pt.x + H[1]*pt.y + H[2]) / w, y: (H[3]*pt.x + H[4]*pt.y + H[5]) / w };
}

function regionFromNorm(xn, yn) {
  const col = xn < 1/3 ? 'izquierda' : xn < 2/3 ? 'centro' : 'derecha';
  const row = yn < 1/3 ? 'superior'  : yn < 2/3 ? 'medio'  : 'inferior';
  return `${row}-${col}`;
}

// ── Redimensionado de imagen para VLLM ───────────────────────────────────────
// Muchos modelos ignoran o malinterpretan imágenes muy grandes.
// Redimensionamos a max 1120px manteniendo aspecto, en JPEG calidad 0.85.

function resizeForVLLM(dataUrl, maxSide = 1120) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth  * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const resized = c.toDataURL('image/jpeg', 0.85).split(',')[1];
      console.log(`[VLLM] imagen: ${img.naturalWidth}×${img.naturalHeight} → ${w}×${h} (${Math.round(resized.length/1024)} KB base64)`);
      resolve(resized);
    };
    img.src = dataUrl;
  });
}

// ── Constantes ────────────────────────────────────────────────────────────────

const REGIONS = [
  'superior-izquierda', 'superior-centro', 'superior-derecha',
  'medio-izquierda',    'medio-centro',    'medio-derecha',
  'inferior-izquierda', 'inferior-centro', 'inferior-derecha',
];
const NO_POINTING   = 'no_pointing';
const FUERA_PIZARRA = 'fuera_pizarra';

const REGION_ALIASES = {
  'top-left': 'superior-izquierda', 'top left': 'superior-izquierda',
  'top-center': 'superior-centro',  'top center': 'superior-centro', 'top-middle': 'superior-centro',
  'top-right': 'superior-derecha',  'top right': 'superior-derecha',
  'middle-left': 'medio-izquierda', 'middle left': 'medio-izquierda', 'center-left': 'medio-izquierda',
  'middle-center': 'medio-centro',  'middle center': 'medio-centro', 'center': 'medio-centro',
  'middle-right': 'medio-derecha',  'middle right': 'medio-derecha', 'center-right': 'medio-derecha',
  'bottom-left': 'inferior-izquierda', 'bottom left': 'inferior-izquierda',
  'bottom-center': 'inferior-centro', 'bottom center': 'inferior-centro', 'bottom-middle': 'inferior-centro',
  'bottom-right': 'inferior-derecha', 'bottom right': 'inferior-derecha',
  'no pointing': NO_POINTING, 'not pointing': NO_POINTING, 'none': NO_POINTING, 'ninguna': NO_POINTING,
  'fuera_pizarra': FUERA_PIZARRA, 'fuera pizarra': FUERA_PIZARRA, 'outside board': FUERA_PIZARRA,
  'pointing elsewhere': FUERA_PIZARRA, 'not at whiteboard': FUERA_PIZARRA, 'not at the whiteboard': FUERA_PIZARRA,
};

const DEFAULT_PROMPT =
`In this image a person may or may not be making a pointing gesture. There may or may not be a whiteboard visible.

Possible scenarios:
1. The person is NOT making a pointing gesture → answer: no_pointing
2. The person IS pointing, but there is no whiteboard in the image, or they are not pointing at the whiteboard → answer: fuera_pizarra
3. The person IS pointing at the whiteboard → answer with the region they are pointing at (see grid below)

If pointing at the whiteboard, it is divided into a 3×3 grid:
Row 1 (top):    top-left (superior-izquierda) | top-center (superior-centro) | top-right (superior-derecha)
Row 2 (middle): middle-left (medio-izquierda) | middle-center (medio-centro) | middle-right (medio-derecha)
Row 3 (bottom): bottom-left (inferior-izquierda) | bottom-center (inferior-centro) | bottom-right (inferior-derecha)

Answer with ONLY one of these exact identifiers:
no_pointing | fuera_pizarra
superior-izquierda | superior-centro | superior-derecha
medio-izquierda | medio-centro | medio-derecha
inferior-izquierda | inferior-centro | inferior-derecha

One identifier only. No explanation.`;

// ── Estado ────────────────────────────────────────────────────────────────────

const state = {
  images: [],
  idx: -1,
  // results[i] = { name, gt, sys, notes, models: { modelKey: {region, raw, latencyMs} } }
  results: [],
  calibration: null,
  systemCsv: {},
  activeModel: '',   // clave del modelo activo (ej. "llava", "gpt-4o")
  modelOrder: [],    // orden de aparición de modelos para las columnas
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('txt-prompt').value = DEFAULT_PROMPT;
buildRegionGrid('grid-gt',  'gt');
buildRegionGrid('grid-sys', 'sys');
buildRegionGrid('grid-vllm','vllm');
syncActiveModel();

// ── Helpers de región ─────────────────────────────────────────────────────────

function buildRegionGrid(containerId, key) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  const labels = {
    'superior-izquierda':'Sup-Izq','superior-centro':'Sup-Cen','superior-derecha':'Sup-Der',
    'medio-izquierda':'Med-Izq','medio-centro':'Med-Cen','medio-derecha':'Med-Der',
    'inferior-izquierda':'Inf-Izq','inferior-centro':'Inf-Cen','inferior-derecha':'Inf-Der',
  };
  REGIONS.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'region-btn';
    btn.dataset.region = r;
    btn.textContent = labels[r];
    btn.title = r;
    btn.addEventListener('click', () => {
      selectRegion(containerId, r);
      if (key === 'gt')  currentResult().gt  = r;
      if (key === 'sys') currentResult().sys = r;
      if (key === 'vllm') setModelResult(state.activeModel, r, null, null);
    });
    el.appendChild(btn);
  });
  const np = document.createElement('button');
  np.className = 'region-btn no-pointing';
  np.dataset.region = NO_POINTING;
  np.textContent = 'Sin gesto / no_pointing';
  np.addEventListener('click', () => {
    selectRegion(containerId, NO_POINTING);
    if (key === 'gt')   currentResult().gt  = NO_POINTING;
    if (key === 'sys')  currentResult().sys = NO_POINTING;
    if (key === 'vllm') setModelResult(state.activeModel, NO_POINTING, null, null);
  });
  el.appendChild(np);

  const fp = document.createElement('button');
  fp.className = 'region-btn fuera-pizarra';
  fp.dataset.region = FUERA_PIZARRA;
  fp.textContent = 'Apunta fuera de la pizarra';
  fp.addEventListener('click', () => {
    selectRegion(containerId, FUERA_PIZARRA);
    if (key === 'gt')   currentResult().gt  = FUERA_PIZARRA;
    if (key === 'sys')  currentResult().sys = FUERA_PIZARRA;
    if (key === 'vllm') setModelResult(state.activeModel, FUERA_PIZARRA, null, null);
  });
  el.appendChild(fp);
}

function selectRegion(containerId, region) {
  document.querySelectorAll(`#${containerId} .region-btn`).forEach(b => b.classList.remove('selected'));
  document.querySelector(`#${containerId} [data-region="${region}"]`)?.classList.add('selected');
}

function setSelected(containerId, region) {
  document.querySelectorAll(`#${containerId} .region-btn`).forEach(b => b.classList.remove('selected'));
  if (region) document.querySelector(`#${containerId} [data-region="${region}"]`)?.classList.add('selected');
}

function getSelected(containerId) {
  return document.querySelector(`#${containerId} .region-btn.selected`)?.dataset.region ?? null;
}

function parseRegion(raw) {
  if (!raw?.trim()) return null;
  // Eliminar bloques de razonamiento y normalizar
  const clean = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/_/g, '-')
    .trim();
  const text  = (clean || raw).toLowerCase();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const last  = lines[lines.length - 1] ?? '';

  const find = t => {
    for (const r of REGIONS) if (t.includes(r)) return r;
    if (t.includes('no_pointing') || t.includes('no-pointing') || t.includes('no pointing') || t.includes('not pointing')) return NO_POINTING;
    if (t.includes('fuera') || t.includes('outside') || t.includes('off board') ||
        t.includes('not at') || t.includes('away from')) return FUERA_PIZARRA;
    for (const [alias, canon] of Object.entries(REGION_ALIASES)) if (t.includes(alias)) return canon;
    return null;
  };
  return find(last) ?? find(text);
}

// ── Resultado actual ──────────────────────────────────────────────────────────

function currentResult() {
  if (state.idx < 0) return {};
  if (!state.results[state.idx]) {
    state.results[state.idx] = {
      name: state.images[state.idx]?.name ?? '', gt: null, sys: null, notes: '', models: {},
    };
  }
  return state.results[state.idx];
}

function setModelResult(modelKey, region, raw, latencyMs) {
  if (!modelKey) return;
  const r = currentResult();
  if (!r.models) r.models = {};
  r.models[modelKey] = {
    region,
    raw:       raw       ?? r.models[modelKey]?.raw       ?? '',
    latencyMs: latencyMs ?? r.models[modelKey]?.latencyMs ?? null,
  };
  if (!state.modelOrder.includes(modelKey)) state.modelOrder.push(modelKey);
}

async function fetchOllamaModels() {
  const endpoint = document.getElementById('inp-endpoint').value.replace(/\/$/, '');
  const sel = document.getElementById('sel-model');
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const res  = await fetch(`${endpoint}/api/tags`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const models = (data.models ?? []).map(m => m.name).sort();
    sel.innerHTML = models.length
      ? models.map(m => `<option value="${m}">${m}</option>`).join('')
      : '<option value="">— sin modelos —</option>';
    syncActiveModel();
  } catch {
    sel.innerHTML = '<option value="">Error: Ollama no responde</option>';
  }
}

function syncActiveModel() {
  const backend = document.getElementById('sel-backend').value;
  let key = '';
  if (backend === 'ollama')    key = document.getElementById('sel-model').value          || '';
  if (backend === 'openai')    key = document.getElementById('inp-oai-model').value.trim()|| 'gpt-4o';
  if (backend === 'manual')    key = document.getElementById('inp-label').value.trim()    || 'manual';
  state.activeModel = key;
  document.getElementById('lbl-active-model').textContent = key ? `Modelo activo: ${key}` : '';
}

// ── Carga de imágenes ─────────────────────────────────────────────────────────

async function loadFiles(files) {
  const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!arr.length) return;
  for (const file of arr) {
    const dataUrl = await readAsDataURL(file);
    state.images.push({ name: file.name, dataUrl });
    state.results.push(null);
  }
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('viewer').style.display = 'block';
  if (state.idx < 0) navigateTo(0);
  renderResults();
}

function readAsDataURL(file) {
  return new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(file); });
}

// ── Navegación ────────────────────────────────────────────────────────────────

function navigateTo(idx) {
  if (idx < 0 || idx >= state.images.length) return;
  state.idx = idx;
  drawFrame();
  loadResultIntoUI();
  document.getElementById('img-counter').textContent = `${idx + 1} / ${state.images.length}`;
  document.getElementById('img-name').textContent = state.images[idx].name;
  document.getElementById('vllm-status').textContent = '';
  document.getElementById('vllm-status').className = 'vllm-status';
  document.getElementById('raw-box').style.display = 'none';
  // Auto-evaluar con el sistema si está listo y la imagen aún no tiene resultado
  if (sysState.ready && currentResult().sys == null) autoRunSystem();
}

function loadResultIntoUI() {
  const r = currentResult();
  setSelected('grid-gt',  r.gt  ?? null);
  setSelected('grid-sys', r.sys ?? null);
  document.getElementById('txt-notes').value = r.notes ?? '';
  // Auto-fill sistema desde CSV
  if (!r.sys && state.systemCsv[r.name]) { r.sys = state.systemCsv[r.name]; setSelected('grid-sys', r.sys); }
  // Cargar resultado del modelo activo en el grid de VLLM
  const mr = r.models?.[state.activeModel];
  setSelected('grid-vllm', mr?.region ?? null);
  if (mr?.latencyMs != null) {
    document.getElementById('vllm-status').textContent = `→ ${mr.region ?? '?'} (${mr.latencyMs} ms)`;
    document.getElementById('vllm-status').className = 'vllm-status ok';
  }
}

// ── Canvas y cuadrícula ───────────────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let   imgEl  = new Image();

function drawFrame() {
  if (state.idx < 0) return;
  imgEl = new Image();
  imgEl.onload = () => {
    canvas.width  = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    ctx.drawImage(imgEl, 0, 0);
    if (document.getElementById('chk-grid').checked && state.calibration?.corners?.length === 4)
      drawGrid3x3(state.calibration.corners);
  };
  imgEl.src = state.images[state.idx].dataUrl;
}

function drawGrid3x3(corners) {
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const [tl, tr, br, bl] = corners;
  ctx.strokeStyle = 'rgba(150,200,255,0.7)';
  ctx.lineWidth   = Math.max(1, canvas.width / 400);
  for (const t of [1/3, 2/3]) {
    ctx.beginPath(); ctx.moveTo(...Object.values(lerp(tl,bl,t))); ctx.lineTo(...Object.values(lerp(tr,br,t))); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...Object.values(lerp(tl,tr,t))); ctx.lineTo(...Object.values(lerp(bl,br,t))); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(150,200,255,0.9)';
  ctx.beginPath(); ctx.moveTo(tl.x,tl.y); ctx.lineTo(tr.x,tr.y); ctx.lineTo(br.x,br.y); ctx.lineTo(bl.x,bl.y); ctx.closePath(); ctx.stroke();
  const labels = ['Sup-Izq','Sup-Cen','Sup-Der','Med-Izq','Med-Cen','Med-Der','Inf-Izq','Inf-Cen','Inf-Der'];
  ctx.fillStyle = 'rgba(150,200,255,0.75)'; ctx.font = `${Math.max(10,canvas.width/70)}px system-ui`; ctx.textAlign = 'center';
  let li = 0;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const c = lerp(lerp(tl,tr,(col+.5)/3), lerp(bl,br,(col+.5)/3), (row+.5)/3);
    ctx.fillText(labels[li++], c.x, c.y);
  }
}

// ── Calibración ───────────────────────────────────────────────────────────────

let calibPoints = [];
canvas.addEventListener('click', e => {
  if (!state.calibration?.calibrating) return;
  const rect = canvas.getBoundingClientRect();
  calibPoints.push({ x: (e.clientX-rect.left)*canvas.width/rect.width, y: (e.clientY-rect.top)*canvas.height/rect.height });
  drawFrame();
  calibPoints.forEach((p, i) => {
    ctx.fillStyle = ['#f05050','#50f050','#5050f0','#f0f050'][i];
    ctx.beginPath(); ctx.arc(p.x,p.y,8,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='14px sans-serif'; ctx.textAlign='center';
    ctx.fillText(['↖','↗','↘','↙'][i], p.x, p.y+5);
  });
  if (calibPoints.length === 4) {
    state.calibration = { corners: calibPoints, calibrating: false };
    calibPoints = [];
    document.getElementById('calib-hint').style.display = 'none';
    canvas.style.cursor = 'default';
    drawFrame();
  }
});

// ── Consulta al VLLM ──────────────────────────────────────────────────────────

async function queryVLLM() {
  if (state.idx < 0) return;
  syncActiveModel();
  const backend  = document.getElementById('sel-backend').value;
  const status   = document.getElementById('vllm-status');
  const rawBox   = document.getElementById('raw-box');
  const prompt   = document.getElementById('txt-prompt').value;
  const modelKey = state.activeModel;

  status.textContent = `⏳ Consultando ${modelKey}…`;
  status.className   = 'vllm-status loading';

  if (backend === 'manual') {
    rawBox.style.display = 'block';
    document.getElementById('txt-raw').value = '';
    document.getElementById('txt-raw').focus();
    status.textContent = `Pega la respuesta de ${modelKey}`;
    status.className   = 'vllm-status';
    return;
  }

  const base64 = await resizeForVLLM(state.images[state.idx].dataUrl);
  const t0 = Date.now();

  try {
    let raw = '';
    if (backend === 'ollama') raw = await callOllama(base64, prompt);
    else                      raw = await callOpenAI(base64, prompt);

    const latencyMs = Date.now() - t0;
    const region    = parseRegion(raw);

    setModelResult(modelKey, region, raw, latencyMs);
    setSelected('grid-vllm', region);
    rawBox.style.display = 'block';
    document.getElementById('txt-raw').value = raw;
    const rawTrimmed = raw.trim();
    status.textContent = region
      ? `→ ${region}  (${latencyMs} ms)`
      : rawTrimmed
        ? `⚠ No reconocido  (${latencyMs} ms)`
        : `⚠ Respuesta vacía — modelo en thinking sin output  (${latencyMs} ms)`;
    status.className = region ? 'vllm-status ok' : 'vllm-status error';
    renderResults();
  } catch (err) {
    const latencyMs = Date.now() - t0;
    status.textContent = `Error: ${err.message}  (${latencyMs} ms)`;
    status.className   = 'vllm-status error';
    rawBox.style.display = 'block';
  }
}

async function callOllama(base64, prompt) {
  const endpoint = document.getElementById('inp-endpoint').value.replace(/\/$/, '');
  const model    = document.getElementById('sel-model').value;
  const t0       = Date.now();
  console.log(`[VLLM] ${model} — enviando imagen…`);

  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt, images: [base64] }], stream: true, options: { temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let content  = '';   // message.content
  let thinking = '';   // message.thinking (campo separado en algunos modelos)
  let logged   = 0;
  let tokens   = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (logged < 3) {
          console.log(`[VLLM] chunk ${logged+1}:`, JSON.stringify(obj).slice(0, 250));
          logged++;
        }
        const c = obj.message?.content  ?? '';
        const t = obj.message?.thinking ?? '';
        if (c) { content  += c; tokens++; }
        if (t)   thinking += t;
      } catch { /* línea incompleta */ }
    }
    if (tokens > 0 && tokens % 5 === 0)
      console.log(`[VLLM] ${model} — ${tokens} tokens… ${((Date.now()-t0)/1000).toFixed(1)}s`);
  }

  // Prioridad: texto tras </think> → thinking separado → content completo
  const afterThink = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fullText   = afterThink || thinking.trim() || content.trim();

  console.log(`[VLLM] ${model} — DONE ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log(`  content  (${content.length}c): "${content.trim().slice(0, 120)}"`);
  console.log(`  thinking (${thinking.length}c): "${thinking.trim().slice(0, 120)}"`);
  console.log(`  → usado: "${fullText.slice(0, 120)}"`);
  return fullText;
}

async function callOpenAI(base64, prompt) {
  const apiKey = document.getElementById('inp-apikey').value;
  const model  = document.getElementById('inp-oai-model').value;
  if (!apiKey) throw new Error('API Key vacía');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}` },
    body: JSON.stringify({
      model, max_tokens: 50, temperature: 0,
      messages: [{ role:'user', content: [
        { type:'text', text: prompt },
        { type:'image_url', image_url: { url:`data:image/jpeg;base64,${base64}` } },
      ]}],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Parsear respuesta manual ──────────────────────────────────────────────────

document.getElementById('btn-parse').addEventListener('click', () => {
  const raw    = document.getElementById('txt-raw').value;
  const region = parseRegion(raw);
  // Latencia manual = null (no medible con fiabilidad)
  setModelResult(state.activeModel, region, raw, null);
  setSelected('grid-vllm', region);
  const status = document.getElementById('vllm-status');
  status.textContent = region ? `→ ${region}` : '⚠ No reconocido';
  status.className   = region ? 'vllm-status ok' : 'vllm-status error';
  renderResults();
});

// ── Guardar ───────────────────────────────────────────────────────────────────

function saveAndNext() {
  const r = currentResult();
  r.gt    = getSelected('grid-gt');
  r.sys   = getSelected('grid-sys');
  r.notes = document.getElementById('txt-notes').value;
  // La región VLLM ya se guarda en tiempo real en models{}
  renderResults();
  if (state.idx + 1 < state.images.length) navigateTo(state.idx + 1);
}

// ── Resultados y métricas ─────────────────────────────────────────────────────

const REGION_SHORT = {
  'superior-izquierda':'Sup-Izq','superior-centro':'Sup-Cen','superior-derecha':'Sup-Der',
  'medio-izquierda':'Med-Izq','medio-centro':'Med-Cen','medio-derecha':'Med-Der',
  'inferior-izquierda':'Inf-Izq','inferior-centro':'Inf-Cen','inferior-derecha':'Inf-Der',
  [NO_POINTING]:   'sin gesto',
  [FUERA_PIZARRA]: 'fuera ↗',
};

function cellClass(v) { return v === '✓' ? 'cell-ok' : v === '✗' ? 'cell-err' : ''; }

function detRegCells(gtRegion, myRegion) {
  if (!gtRegion || myRegion === null) return { det:'—', reg:'—', detOk: null, regOk: null };
  const gtG  = gtRegion !== NO_POINTING;
  const myG  = myRegion !== NO_POINTING;
  const detOk = myG === gtG;
  const regOk = gtG && myG ? myRegion === gtRegion : null;
  return {
    det: detOk ? '✓' : '✗',
    reg: regOk === true ? '✓' : regOk === false ? '✗' : '—',
    detOk, regOk,
  };
}

function renderResults() {
  const saved = state.results.filter(r => r && (r.gt || r.sys || Object.keys(r.models||{}).length));
  if (!saved.length) { document.getElementById('results-wrap').style.display = 'none'; return; }
  document.getElementById('results-wrap').style.display = 'block';
  document.getElementById('res-count').textContent = saved.length;

  const models = state.modelOrder;

  // Cabecera dinámica
  const thead = document.querySelector('#res-table thead tr');
  thead.innerHTML = '<th>#</th><th>Imagen</th><th>GT</th><th>Sistema</th><th>Sys Det</th><th>Sys Reg</th>';
  models.forEach(m => {
    const s = m.split('/').pop();
    thead.innerHTML += `<th>${s}</th><th>Det✓</th><th>Reg✓</th><th>ms</th>`;
  });
  thead.innerHTML += '<th>Notas</th>';

  // Acumuladores
  const sysStat = { detOk:0, detTotal:0, regOk:0, regTotal:0 };
  const stats = {};
  models.forEach(m => { stats[m] = { detOk:0, detTotal:0, regOk:0, regTotal:0, totalMs:0, countMs:0 }; });

  const body = document.getElementById('res-body');
  body.innerHTML = '';
  saved.forEach((r, i) => {
    const gtShort = r.gt ? (REGION_SHORT[r.gt] ?? r.gt) : '—';
    const sys = detRegCells(r.gt, r.sys ?? null);
    if (sys.detOk !== null) { sysStat.detTotal++; if (sys.detOk) sysStat.detOk++; }
    if (sys.regOk !== null) { sysStat.regTotal++; if (sys.regOk) sysStat.regOk++; }

    const sysShort = r.sys ? (REGION_SHORT[r.sys] ?? r.sys) : '—';
    const tr = document.createElement('tr');
    let html = `<td>${i+1}</td>
      <td title="${r.name}">${r.name.length>20?r.name.slice(0,18)+'…':r.name}</td>
      <td title="${r.gt??''}">${gtShort}</td>
      <td title="${r.sys??''}">${sysShort}</td>
      <td class="${cellClass(sys.det)}">${sys.det}</td>
      <td class="${cellClass(sys.reg)}">${sys.reg}</td>`;

    models.forEach(m => {
      const mr  = r.models?.[m];
      const region = mr?.region ?? null;
      const lat    = mr?.latencyMs ?? null;
      const c = detRegCells(r.gt, region);
      if (c.detOk !== null) { stats[m].detTotal++; if (c.detOk) stats[m].detOk++; }
      if (c.regOk !== null) { stats[m].regTotal++; if (c.regOk) stats[m].regOk++; }
      if (lat !== null) { stats[m].totalMs += lat; stats[m].countMs++; }
      const regShort = region ? (REGION_SHORT[region] ?? region) : '—';
      html += `<td title="${region??''}">${regShort}</td>
        <td class="${cellClass(c.det)}">${c.det}</td>
        <td class="${cellClass(c.reg)}">${c.reg}</td>
        <td class="cell-lat">${lat!=null?lat+'ms':'—'}</td>`;
    });

    html += `<td>${r.notes??''}</td>`;
    tr.innerHTML = html;
    body.appendChild(tr);
  });

  // Métricas
  const pct = (n,d) => d>0 ? `${Math.round(n/d*100)}%` : '—';
  const avgMs = s => s.countMs>0 ? `${Math.round(s.totalMs/s.countMs)} ms` : '—';
  let metricsHtml = `<div class="metric-pill"><span class="m-label">Imágenes</span><span class="m-val">${saved.length}</span></div>`;

  if (sysStat.detTotal > 0) {
    metricsHtml += `
      <div class="metric-pill green"><span class="m-label">Sistema — Detección</span>
        <span class="m-val">${pct(sysStat.detOk,sysStat.detTotal)} <small style="font-size:.65rem;color:#506080">(${sysStat.detOk}/${sysStat.detTotal})</small></span></div>
      <div class="metric-pill green"><span class="m-label">Sistema — Región (TP)</span>
        <span class="m-val">${pct(sysStat.regOk,sysStat.regTotal)} <small style="font-size:.65rem;color:#506080">(${sysStat.regOk}/${sysStat.regTotal})</small></span></div>`;
  }

  models.forEach(m => {
    const s = stats[m];
    const mShort = m.split('/').pop();
    metricsHtml += `
      <div class="metric-pill green"><span class="m-label">${mShort} — Detección</span>
        <span class="m-val">${pct(s.detOk,s.detTotal)} <small style="font-size:.65rem;color:#506080">(${s.detOk}/${s.detTotal})</small></span></div>
      <div class="metric-pill"><span class="m-label">${mShort} — Región (TP)</span>
        <span class="m-val">${pct(s.regOk,s.regTotal)} <small style="font-size:.65rem;color:#506080">(${s.regOk}/${s.regTotal})</small></span></div>
      <div class="metric-pill"><span class="m-label">${mShort} — Lat. media</span>
        <span class="m-val">${avgMs(s)}</span></div>`;
  });
  document.getElementById('metrics-bar').innerHTML = metricsHtml;
}

// ── Exportar CSV ──────────────────────────────────────────────────────────────

function exportCSV() {
  const models = state.modelOrder;
  const sysCols = ['Sistema_Region','Sistema_Deteccion_OK','Sistema_Region_OK'];
  const modelCols = models.flatMap(m => [`${m}_Region`,`${m}_Det_OK`,`${m}_Reg_OK`,`${m}_Latencia_ms`]);
  const header = ['Imagen','GT', ...sysCols, ...modelCols, 'Notas'].join(',');

  const rows = state.results.filter(r => r && (r.gt||r.sys||Object.keys(r.models||{}).length)).map(r => {
    const sys = detRegCells(r.gt, r.sys ?? null);
    const base = [
      `"${r.name}"`, `"${r.gt??''}"`,
      `"${r.sys??''}"`,
      `"${sys.detOk===null?'':sys.detOk?'Sí':'No'}"`,
      `"${sys.regOk===null?'':sys.regOk?'Sí':'No'}"`,
    ];
    models.forEach(m => {
      const mr = r.models?.[m];
      const c = detRegCells(r.gt, mr?.region ?? null);
      base.push(`"${mr?.region??''}"`);
      base.push(`"${c.detOk===null?'':c.detOk?'Sí':'No'}"`);
      base.push(`"${c.regOk===null?'':c.regOk?'Sí':'No'}"`);
      base.push(`"${mr?.latencyMs??''}"`);
    });
    base.push(`"${(r.notes??'').replace(/"/g,'""')}"`);
    return base.join(',');
  });

  const blob = new Blob([header+'\n'+rows.join('\n')], { type:'text/csv;charset=utf-8' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download:'comparacion_vllm.csv' }).click();
}

// ── Cargar CSV del sistema ────────────────────────────────────────────────────

function loadSystemCSV(text) {
  const lines  = text.trim().split('\n');
  if (lines.length < 2) return;
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  const colRegion = header.findIndex(h => /region/i.test(h));
  const colName   = header.findIndex(h => /archivo|file|nombre|name/i.test(h));
  if (colRegion < 0) { alert('CSV no tiene columna "Region"'); return; }
  lines.slice(1).forEach(line => {
    const cells = line.split(',').map(c => c.trim().replace(/"/g,''));
    const region = cells[colRegion];
    const name   = colName >= 0 ? cells[colName] : null;
    if (name && region) state.systemCsv[name] = region;
  });
  alert(`CSV cargado: ${Object.keys(state.systemCsv).length} entradas`);
}

// ── Sistema de pointing — evaluación estática ─────────────────────────────────

const sysState = { ready: false, loading: false, pose: null, hands: null, pointing: null };

function setSysStatus(text, cls = '') {
  const el = document.getElementById('sys-status');
  el.textContent = text;
  el.className   = `vllm-status ${cls}`.trim();
}

async function initSystem() {
  if (sysState.loading) return;
  sysState.loading = true;
  setSysStatus('Cargando modelos…', 'loading');
  try {
    sysState.pose     = new PoseEstimator();
    sysState.hands    = new HandEstimator();
    sysState.pointing = new PointingEstimator();
    await sysState.pose.init('IMAGE');
    await sysState.hands.init('IMAGE');
    sysState.ready   = true;
    sysState.loading = false;
    setSysStatus('Listo ✓', 'ok');
    if (state.idx >= 0) autoRunSystem();
  } catch (err) {
    sysState.loading = false;
    setSysStatus(`Error: ${err.message}`, 'error');
  }
}

function loadImageEl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function computeRegionFromResult(result, W, H, corners) {
  if (!result.rawVector || !result.origin) return null;
  const origin = { x: result.origin.x * W, y: result.origin.y * H };
  const dx = result.rawVector.x * W;
  const dy = result.rawVector.y * H;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-9) return null;
  const dir = { x: dx / mag, y: dy / mag };

  const indexH  = result.handsReliable && result.armData?.points?.indexH;
  const indexPx = indexH ? { x: indexH.x * W, y: indexH.y * H } : null;

  let hitPx;
  if (indexPx && isPointInConvexPolygon(indexPx, corners)) {
    hitPx = indexPx;
  } else {
    const ray = rayPolygonIntersect(origin, dir, corners);
    if (!ray) return null;
    hitPx = { x: ray.x, y: ray.y };
  }

  const Hmat = computeHomography(corners, [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ]);
  if (!Hmat) return null;
  const { x: xn, y: yn } = applyHomography(Hmat, hitPx);
  return regionFromNorm(Math.max(0, Math.min(1, xn)), Math.max(0, Math.min(1, yn)));
}

async function autoRunSystem() {
  if (!sysState.ready || state.idx < 0) return;
  const idx = state.idx;
  setSysStatus('Procesando…', 'loading');
  try {
    const imgEl = await loadImageEl(state.images[idx].dataUrl);
    const W = imgEl.naturalWidth;
    const H = imgEl.naturalHeight;

    const poseResult  = sysState.pose.detect(imgEl);
    const handsResult = sysState.hands.detect(imgEl);
    const { pose, hands } = extractDeicticLandmarks(poseResult, handsResult);

    sysState.pointing.reset();
    const result = sysState.pointing.estimate(pose, hands, 'auto', true);

    if (state.idx !== idx) { setSysStatus('Listo ✓', 'ok'); return; }

    let region;
    if (!result.rawIsGesture) {
      region = NO_POINTING;
      setSysStatus('Sin gesto detectado', 'ok');
    } else {
      const corners = state.calibration?.corners;
      if (corners?.length === 4) {
        region = computeRegionFromResult(result, W, H, corners) ?? FUERA_PIZARRA;
        setSysStatus(`→ ${region}  (${Math.round(result.rawConfidence*100)}% conf.)`, 'ok');
      } else {
        region = FUERA_PIZARRA;
        setSysStatus(`Gesto detectado, sin pizarra calibrada → fuera_pizarra`, 'ok');
      }
    }

    const r = currentResult();
    if (r.sys === null || r.sys === undefined) {
      r.sys = region;
      setSelected('grid-sys', region);
    }
    renderResults();
  } catch (err) {
    setSysStatus(`Error: ${err.message}`, 'error');
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('inp-files').addEventListener('change', e => loadFiles(e.target.files));
document.getElementById('inp-add').addEventListener('change',   e => { loadFiles(e.target.files); e.target.value = ''; });
document.getElementById('btn-prev').addEventListener('click', () => navigateTo(state.idx-1));
document.getElementById('btn-next').addEventListener('click', () => navigateTo(state.idx+1));
document.getElementById('btn-query').addEventListener('click', queryVLLM);
document.getElementById('btn-save').addEventListener('click', saveAndNext);
document.getElementById('btn-export').addEventListener('click', exportCSV);
document.getElementById('btn-reset-prompt').addEventListener('click', () => { document.getElementById('txt-prompt').value = DEFAULT_PROMPT; });
document.getElementById('chk-grid').addEventListener('change', drawFrame);

document.getElementById('sel-backend').addEventListener('change', e => {
  const v = e.target.value;
  document.getElementById('cfg-ollama').style.display = v === 'ollama' ? '' : 'none';
  document.getElementById('cfg-openai').style.display = v === 'openai' ? '' : 'none';
  document.getElementById('cfg-manual').style.display = v === 'manual' ? '' : 'none';
  if (v === 'ollama') fetchOllamaModels();
  else syncActiveModel();
});
['inp-oai-model','inp-label'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', syncActiveModel);
});
document.getElementById('sel-model').addEventListener('change', syncActiveModel);
document.getElementById('btn-refresh-models').addEventListener('click', fetchOllamaModels);

// Cargar modelos de Ollama al inicio
fetchOllamaModels();

document.getElementById('btn-init-sys').addEventListener('click', initSystem);

document.getElementById('btn-calibrate').addEventListener('click', () => {
  calibPoints = [];
  state.calibration = { corners: [], calibrating: true };
  document.getElementById('calib-hint').style.display = 'block';
  canvas.style.cursor = 'crosshair';
});
document.getElementById('btn-load-csv').addEventListener('click', () => document.getElementById('inp-csv').click());
document.getElementById('inp-csv').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  loadSystemCSV(await f.text()); e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); loadFiles(e.dataTransfer.files); });
dropZone.addEventListener('click', () => document.getElementById('inp-files').click());

document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') navigateTo(state.idx+1);
  if (e.key === 'ArrowLeft')  navigateTo(state.idx-1);
  if (e.key === 'Enter')      saveAndNext();
});
