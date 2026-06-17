"""Genera figura con matrices de confusión (frontal + espaldas) para el Cap. 4."""

import csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from pathlib import Path

REGIONS = [
    'superior-izquierda', 'superior-centro',  'superior-derecha',
    'medio-izquierda',    'medio-centro',      'medio-derecha',
    'inferior-izquierda', 'inferior-centro',   'inferior-derecha',
]
SHORT = [
    'sup-izq', 'sup-ctr', 'sup-der',
    'med-izq', 'med-ctr', 'med-der',
    'inf-izq', 'inf-ctr', 'inf-der',
]
REGION_IDX = {r: i for i, r in enumerate(REGIONS)}

BASE = Path(r'C:\Users\pmara\Desktop\Deicticos\resultados_evaluacion\fase_evaluacion_fingerprint')
OUT  = Path(r'C:\Users\pmara\Desktop\Deicticos\memoria_tfm\imagenes\confusion_matrices.png')

SCENARIOS = [
    ('protocolo_gt_frontal_camara_dist_media.csv',  'Frontal (99,8 %)'),
    ('protocolo_gt_espaldas_camara_dist_media.csv', 'Espaldas (76,3 %)'),
]


def load_matrix(fname):
    matrix = np.zeros((9, 9), dtype=int)
    path = BASE / fname
    with open(path, encoding='utf-8-sig', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            gesto = row.get('Gesto', '').strip().replace('\xa0', '')
            if gesto not in ('Sí', 'Si', 'Sí', 'SÃ­'):
                continue
            gt  = row.get('GT_Region', '').strip()
            det = row.get('Region', '').strip()
            gi  = REGION_IDX.get(gt)
            di  = REGION_IDX.get(det)
            if gi is not None and di is not None:
                matrix[gi][di] += 1
    return matrix


def draw_matrix(ax, matrix, title):
    n = 9
    # Normalise por fila (recall por clase)
    row_sums = matrix.sum(axis=1, keepdims=True)
    norm = np.where(row_sums > 0, matrix / row_sums, 0)

    ax.set_facecolor('#0d0d1a')

    for i in range(n):
        for j in range(n):
            val  = matrix[i, j]
            nval = norm[i, j]
            if val == 0:
                color = '#111120'
            elif i == j:
                g = int(40 + nval * 200)
                color = (20/255, g/255, 40/255)
            else:
                r = int(40 + nval * 200)
                color = (r/255, 20/255, 20/255)
            rect = mpatches.FancyBboxPatch(
                (j + 0.05, n - i - 1 + 0.05), 0.90, 0.90,
                boxstyle='square,pad=0', linewidth=0,
                facecolor=color
            )
            ax.add_patch(rect)
            if val > 0:
                txt_color = 'white' if nval > 0.4 else '#888888'
                ax.text(j + 0.5, n - i - 1 + 0.5, str(val),
                        ha='center', va='center',
                        fontsize=6.5, color=txt_color, fontfamily='monospace')

    ax.set_xlim(0, n)
    ax.set_ylim(0, n)
    ax.set_xticks(np.arange(n) + 0.5)
    ax.set_yticks(np.arange(n) + 0.5)
    ax.set_xticklabels(SHORT, rotation=40, ha='right', fontsize=7, color='#c0c0e0')
    ax.set_yticklabels(SHORT[::-1], fontsize=7, color='#c0c0e0')
    ax.tick_params(length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_xlabel('Predicho →', fontsize=8, color='#8080b0', labelpad=4)
    ax.set_ylabel('← GT', fontsize=8, color='#8080b0', labelpad=4)
    ax.set_title(title, fontsize=9, color='#d0d0f0', pad=6, fontweight='bold')

    # Grid
    for k in range(n + 1):
        ax.axhline(k, color='#1a1a2e', linewidth=0.4)
        ax.axvline(k, color='#1a1a2e', linewidth=0.4)


# ── Main ──────────────────────────────────────────────────────────────────────

fig, axes = plt.subplots(1, 2, figsize=(9, 4.2))
fig.patch.set_facecolor('#0d0d1a')
fig.subplots_adjust(wspace=0.38, left=0.08, right=0.97, top=0.88, bottom=0.18)

for ax, (fname, title) in zip(axes, SCENARIOS):
    m = load_matrix(fname)
    total_gesture = m.sum()
    correct = m.diagonal().sum()
    draw_matrix(ax, m, title)
    ax.text(4.5, -0.9, f'n={total_gesture} frames con gesto  |  correcto: {correct} ({100*correct/total_gesture:.1f}%)',
            ha='center', va='top', fontsize=6.5, color='#606090', transform=ax.transData)

fig.text(0.5, 0.96, 'Matrices de confusión — región detectada vs. región real (filas = GT, columnas = predicho)',
         ha='center', fontsize=8.5, color='#a0a0d0')

plt.savefig(OUT, dpi=180, bbox_inches='tight', facecolor=fig.get_facecolor())
print(f'Guardado: {OUT}')
