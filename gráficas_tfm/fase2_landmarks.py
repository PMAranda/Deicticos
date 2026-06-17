"""
Figura: Calidad de landmarks BlazePose por distancia e iluminación (Fase 2)
Genera: fase2_landmarks.pdf  (y .png para previsualización)

Lee los datos desde:
  resultados_evaluacion/fase_dos/deicticos_sesiones_1779808877293.csv
"""

import csv
import pathlib
import collections
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ── Lectura del CSV ───────────────────────────────────────────────────────────

CSV_PATH = (pathlib.Path(__file__).parent.parent
            / 'resultados_evaluacion' / 'fase_dos'
            / 'deicticos_sesiones_1779808877293.csv')

_acc = collections.defaultdict(list)
with open(CSV_PATH, encoding='utf-8') as f:
    for row in csv.DictReader(f):
        key = (float(row['Distancia']), row['Iluminación'], row['Landmark'])
        _acc[key].append({
            'jitter': float(row['JitterMedio(‰)']),
            'vis':    float(row['Visibilidad(%)']),
        })

def avg_lr(dist, luz, base, field):
    vals = (_acc.get((dist, luz, f'L_{base}'), []) +
            _acc.get((dist, luz, f'R_{base}'), []))
    return sum(v[field] for v in vals) / len(vals) if vals else None

dists_fuerte = sorted({k[0] for k in _acc if k[1] == 'fuerte'})
dists_normal = sorted({k[0] for k in _acc if k[1] == 'normal'})
dists_all    = sorted({k[0] for k in _acc})
dists_common = sorted(set(dists_fuerte) & set(dists_normal))

def avg_cond(dist, base, field):
    vf = avg_lr(dist, 'fuerte', base, field)
    vn = avg_lr(dist, 'normal', base, field)
    vals = [v for v in [vf, vn] if v is not None]
    return sum(vals) / len(vals) if vals else None

# Panel 1 — gradiente (promedio ambas condiciones, distancias comunes)
jit_hom = [avg_cond(d, 'SHOULDER', 'jitter') for d in dists_common]
jit_cod = [avg_cond(d, 'ELBOW',    'jitter') for d in dists_common]
jit_mun = [avg_cond(d, 'WRIST',    'jitter') for d in dists_common]

# Panel 2 — efecto iluminación (muñeca)
jit_mun_f = [avg_lr(d, 'fuerte', 'WRIST', 'jitter') for d in dists_fuerte]
jit_mun_n = [avg_lr(d, 'normal', 'WRIST', 'jitter') for d in dists_normal]

# Panel 3 — visibilidad muñeca
vis_mun_f = [avg_lr(d, 'fuerte', 'WRIST', 'vis') for d in dists_fuerte]
vis_mun_n = [avg_lr(d, 'normal', 'WRIST', 'vis') for d in dists_normal]

# ── Estilo global ─────────────────────────────────────────────────────────────

plt.rcParams.update({
    'font.family':        'sans-serif',
    'font.size':          9,
    'axes.titlesize':     10,
    'axes.titleweight':   'bold',
    'axes.labelsize':     9,
    'axes.spines.top':    False,
    'axes.spines.right':  False,
    'axes.spines.left':   True,
    'axes.spines.bottom': True,
    'axes.grid':          True,
    'grid.color':         '#ebebeb',
    'grid.linewidth':     0.6,
    'grid.alpha':         1.0,
    'xtick.labelsize':    8.5,
    'ytick.labelsize':    8.5,
    'legend.fontsize':    8,
    'legend.framealpha':  0.95,
    'legend.edgecolor':   '#dddddd',
    'legend.borderpad':   0.5,
    'figure.facecolor':   'white',
    'axes.facecolor':     'white',
})

C_HOMBRO = '#3498db'   # azul
C_CODO   = '#e67e22'   # naranja
C_MUNECA = '#e74c3c'   # rojo
C_FUERTE = '#c0392b'   # rojo oscuro
C_NORMAL = '#2980b9'   # azul

# Zonas de fondo para jitter (sin texto)
def fondo_jitter(ax, ymax=42):
    ax.axhspan(0,   4,    color='#eafaf1', zorder=0)
    ax.axhspan(4,   12,   color='#fef9e7', zorder=0)
    ax.axhspan(12,  ymax, color='#fdf2f2', zorder=0)
    ax.axhline(4,  color='#aaaaaa', lw=0.7, ls='--', zorder=1)
    ax.axhline(12, color='#aaaaaa', lw=0.7, ls='--', zorder=1)

YMAX = 42
fig, axes = plt.subplots(1, 3, figsize=(13, 4.0))
fig.subplots_adjust(wspace=0.40)

xtick_labels = lambda ds: [f'{d} m' for d in ds]

# ── Panel 1: Gradiente de estabilidad ────────────────────────────────────────

ax = axes[0]
fondo_jitter(ax)

ax.plot(dists_common, jit_hom, 'o-',  color=C_HOMBRO, lw=2.2, ms=6, zorder=4, label='Hombro')
ax.plot(dists_common, jit_cod, 's-',  color=C_CODO,   lw=2.2, ms=6, zorder=4, label='Codo')
ax.plot(dists_common, jit_mun, '^-',  color=C_MUNECA, lw=2.2, ms=6, zorder=4, label='Muñeca')

# Yticks personalizados con etiquetas de zona
ax.set_yticks([0, 4, 12, 20, 30, 40])
ax.set_yticklabels(['0', '4 ← estable', '12 ← mod.', '20', '30', '40'])

ax.set_xlim(0.4, 3.2)
ax.set_ylim(0, YMAX)
ax.set_xticks(dists_common)
ax.set_xticklabels(xtick_labels(dists_common))
ax.set_xlabel('Distancia sujeto–cámara')
ax.set_ylabel('Jitter medio (‰)')
ax.set_title('Estabilidad por landmark')
ax.legend(loc='upper right')

# ── Panel 2: Efecto iluminación ───────────────────────────────────────────────

ax = axes[1]
fondo_jitter(ax)

jit_f_c = [jit_mun_f[dists_fuerte.index(d)] for d in dists_common]
jit_n_c = [jit_mun_n[dists_normal.index(d)] for d in dists_common]
ax.fill_between(dists_common, jit_f_c, jit_n_c, color='#e74c3c', alpha=0.08, zorder=2)

ax.plot(dists_fuerte, jit_mun_f, 'o-', color=C_FUERTE, lw=2.2, ms=6, zorder=4, label='Luz fuerte')
ax.plot(dists_normal, jit_mun_n, 's-', color=C_NORMAL, lw=2.2, ms=6, zorder=4, label='Luz normal')

ax.set_yticks([0, 4, 12, 20, 30, 40])
ax.set_yticklabels(['0', '4', '12', '20', '30', '40'])

ax.set_xlim(0.4, 4.2)
ax.set_ylim(0, YMAX)
ax.set_xticks(dists_all)
ax.set_xticklabels(xtick_labels(dists_all))
ax.set_xlabel('Distancia sujeto–cámara')
ax.set_ylabel('Jitter medio muñeca (‰)')
ax.set_title('Efecto de la iluminación')
ax.legend(loc='upper right')

# ── Panel 3: Visibilidad ──────────────────────────────────────────────────────

ax = axes[2]
ax.axhspan(55,  90,  color='#fdf2f2', zorder=0)
ax.axhspan(90,  102, color='#eafaf1', zorder=0)
ax.axhline(90, color='#aaaaaa', lw=0.7, ls='--', zorder=1)

vis_f_c = [vis_mun_f[dists_fuerte.index(d)] for d in dists_common]
vis_n_c = [vis_mun_n[dists_normal.index(d)] for d in dists_common]
ax.fill_between(dists_common, vis_f_c, vis_n_c, color='#2980b9', alpha=0.08, zorder=2)

ax.plot(dists_fuerte, vis_mun_f, 'o-', color=C_FUERTE, lw=2.2, ms=6, zorder=4, label='Luz fuerte')
ax.plot(dists_normal, vis_mun_n, 's-', color=C_NORMAL, lw=2.2, ms=6, zorder=4, label='Luz normal')

ax.set_yticks([60, 70, 80, 90, 100])
ax.set_yticklabels(['60%', '70%', '80%', '90% ←', '100%'])

ax.set_xlim(0.4, 4.2)
ax.set_ylim(55, 102)
ax.set_xticks(dists_all)
ax.set_xticklabels(xtick_labels(dists_all))
ax.set_xlabel('Distancia sujeto–cámara')
ax.set_ylabel('Visibilidad media')
ax.set_title('Visibilidad de muñeca')
ax.legend(loc='lower right')

# ── Exportar ──────────────────────────────────────────────────────────────────

fig.savefig('fase2_landmarks.pdf', bbox_inches='tight', dpi=300)
fig.savefig('fase2_landmarks.png', bbox_inches='tight', dpi=150)
print('Guardado: fase2_landmarks.pdf  y  fase2_landmarks.png')
plt.close()
