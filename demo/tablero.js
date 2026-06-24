import { CONTENT, GRID_ORDER, CHANNEL } from './contenido.js';

const boardEl = document.getElementById('board');
const connDot = document.getElementById('connDot');
const connLbl = document.getElementById('connLbl');
const fsBtn   = document.getElementById('fsBtn');

const cells = new Map();
let activeLabel = null;
let connTimer   = null;

// ── Construir el tablero 3×3 ───────────────────────────────────────────────────
for (const label of GRID_ORDER) {
  const c    = CONTENT[label] ?? { img: '', title: label, body: '' };
  const cell = document.createElement('div');
  cell.className = 'tcell';
  cell.dataset.region = label;
  cell.innerHTML = `
    <span class="tregion">${label}</span>
    <img class="ticon" src="${c.img}" alt="${c.title}" draggable="false">
    <span class="ttitle">${c.title}</span>
    <span class="tbody">${c.body}</span>`;
  boardEl.appendChild(cell);
  cells.set(label, cell);
}

// ── Sincronización con la consola (panel.html) ─────────────────────────────────
function setHot(label) {
  for (const [l, cell] of cells) {
    cell.classList.toggle('hot', l === label && l !== activeLabel);
  }
}

function setActive(label) {
  activeLabel = label;
  for (const [l, cell] of cells) {
    cell.classList.toggle('active', l === label);
    if (l === label) cell.classList.remove('hot');
  }
}

function clearAll() {
  activeLabel = null;
  for (const cell of cells.values()) cell.classList.remove('active', 'hot');
}

function markLive() {
  connDot.classList.add('live');
  connLbl.textContent = 'consola conectada';
  clearTimeout(connTimer);
  connTimer = setTimeout(() => {
    connDot.classList.remove('live');
    connLbl.textContent = 'consola inactiva';
  }, 4000);
}

if ('BroadcastChannel' in window) {
  const bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (e) => {
    const { type, label } = e.data ?? {};
    markLive();
    if (type === 'hot')     setHot(label);
    else if (type === 'confirm') setActive(label);
    else if (type === 'reset')   clearAll();
  };
} else {
  connLbl.textContent = 'navegador sin BroadcastChannel';
}

// ── Pantalla completa ──────────────────────────────────────────────────────────
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
