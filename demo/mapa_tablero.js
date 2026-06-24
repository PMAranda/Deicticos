import { loadCountries, normToLonLat, findCountry, drawBaseMap, fillCountry, CHANNEL_MAP } from './geo.js';

const canvas   = document.getElementById('map');
const ctx      = canvas.getContext('2d');
const countryEl = document.getElementById('country');
const connDot  = document.getElementById('connDot');
const connLbl  = document.getElementById('connLbl');
const fsBtn    = document.getElementById('fsBtn');

let features    = null;
let baseCanvas  = null;
let W = 0, H = 0;
let livePoint   = null;     // {xn, yn} mientras hay gesto
let activeFeat  = null;     // país confirmado (persistente)
let connTimer   = null;

// ── Dimensionado: ratio 2:1, encaja en el área disponible ──────────────────────
function fit() {
  const stage = document.querySelector('.stage');
  const aw = stage.clientWidth, ah = stage.clientHeight;
  W = Math.min(aw, ah * 2);
  H = W / 2;
  canvas.width = W; canvas.height = H;
  if (features) {
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = W; baseCanvas.height = H;
    drawBaseMap(baseCanvas.getContext('2d'), features, W, H);
    render();
  }
}

function hotFromLive() {
  if (!livePoint) return null;
  const { lon, lat } = normToLonLat(livePoint.xn, livePoint.yn);
  return findCountry(lon, lat, features);
}

function render() {
  if (!baseCanvas) return;
  ctx.drawImage(baseCanvas, 0, 0);
  const hot = hotFromLive();
  if (activeFeat) fillCountry(ctx, activeFeat, W, H, 'rgba(217,164,65,0.55)', '#d9a441');
  if (hot && hot !== activeFeat) fillCountry(ctx, hot, W, H, 'rgba(217,164,65,0.22)');
  if (livePoint) {
    const x = livePoint.xn * W, y = livePoint.yn * H;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#d9a441'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(217,164,65,0.7)'; ctx.lineWidth = 2; ctx.stroke();
  }
  // Etiqueta de cabecera: país confirmado, o el apuntado en vivo
  const shown = activeFeat ? activeFeat._name : (hot ? hot._name : (livePoint ? 'océano' : '—'));
  countryEl.textContent = shown;
}

function markLive() {
  connDot.classList.add('live');
  connLbl.textContent = 'consola conectada';
  clearTimeout(connTimer);
  connTimer = setTimeout(() => { connDot.classList.remove('live'); connLbl.textContent = 'consola inactiva'; }, 4000);
}

// ── Arranque ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    features = await loadCountries('data/paises.geojson');
  } catch (err) {
    connLbl.textContent = 'error cargando el mapa';
    console.error(err);
    return;
  }
  fit();
  window.addEventListener('resize', fit);

  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel(CHANNEL_MAP);
    bc.onmessage = (e) => {
      const m = e.data ?? {};
      markLive();
      if (m.type === 'live') {
        livePoint = (m.xn == null) ? null : { xn: m.xn, yn: m.yn };
      } else if (m.type === 'confirm') {
        const { lon, lat } = normToLonLat(m.xn, m.yn);
        activeFeat = findCountry(lon, lat, features);
      } else if (m.type === 'reset') {
        livePoint = null; activeFeat = null;
      }
      render();
    };
  } else {
    connLbl.textContent = 'navegador sin BroadcastChannel';
  }
})();

fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
