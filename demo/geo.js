/* ════════════════════════════════════════════════════════════════════════════
   geo.js — utilidades geográficas para la demo del mapamundi.

   Asume un planisferio EQUIRECTANGULAR completo (lon −180..180, lat 90..−90).
   El plano rectificado normalizado [0,1]² coincide exactamente con esa proyección:
     lon = −180 + xn·360      ·      lat = 90 − yn·180
   Así que el impacto del grounding (xn,yn) se convierte a (lon,lat) de forma directa,
   y la identificación del país es un test punto-en-polígono contra el GeoJSON.
   ════════════════════════════════════════════════════════════════════════════ */

export const CHANNEL_MAP = 'mapa-tematico';

/** Carga el GeoJSON de países (Natural Earth, local). */
export async function loadCountries(url = 'data/paises.geojson') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url} (${res.status})`);
  const geo = await res.json();
  // Nombre preferente en español
  for (const f of geo.features) {
    f._name = f.properties.NAME_ES || f.properties.NAME || f.properties.ADMIN || '—';
  }
  return geo.features;
}

/** Coordenadas normalizadas [0,1]² → (lon, lat) en proyección equirectangular. */
export function normToLonLat(xn, yn) {
  return { lon: -180 + xn * 360, lat: 90 - yn * 180 };
}

/** Ray-casting sobre un conjunto de anillos (maneja agujeros por paridad de cruces). */
function inRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit = ((yi > lat) !== (yj > lat)) &&
                  (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
  }
  return inside;
}

function geomContains(geom, lon, lat) {
  if (geom.type === 'Polygon')      return inRings(lon, lat, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(poly => inRings(lon, lat, poly));
  return false;
}

/** Devuelve la feature del país que contiene (lon,lat), o null si es océano. */
export function findCountry(lon, lat, features) {
  for (const f of features) {
    if (geomContains(f.geometry, lon, lat)) return f;
  }
  return null;
}

// ── Dibujo del mapa en canvas (proyección equirectangular lineal) ──────────────
function eachPolygon(geom, cb) {
  if (geom.type === 'Polygon')      cb(geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(cb);
}

function tracePath(ctx, geom, W, H) {
  // Un único path por país: acumula todas las piezas (MultiPolygon) y sus
  // anillos, de modo que un solo fill('evenodd') las rellene todas a la vez.
  ctx.beginPath();
  eachPolygon(geom, (rings) => {
    for (const ring of rings) {
      for (let k = 0; k < ring.length; k++) {
        const x = (ring[k][0] + 180) / 360 * W;
        const y = (90 - ring[k][1]) / 180 * H;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  });
}

/** Dibuja el mapa base completo (tierra + fronteras). Llamar una sola vez y cachear. */
export function drawBaseMap(ctx, features, W, H, {
  sea = '#0d0f14', land = '#23252b', border = '#3a3d44',
} = {}) {
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);
  for (const f of features) {
    tracePath(ctx, f.geometry, W, H);
    ctx.fillStyle = land;
    ctx.fill('evenodd');
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
}

/** Rellena un país concreto (para resaltarlo). */
export function fillCountry(ctx, feature, W, H, fill, stroke) {
  tracePath(ctx, feature.geometry, W, H);
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
  if (stroke) { ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke(); }
}
