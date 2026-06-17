"""Genera figura con los 4 vectores articulares en 3 situaciones del brazo.
Estilo: diagrama técnico limpio, sin figura de palo."""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.patheffects as pe
import numpy as np
from pathlib import Path

OUT = Path(r'C:\Users\pmara\Desktop\Deicticos\memoria_tfm\imagenes\vectores_brazo.png')

# Paleta
C_SE    = '#3b82f6'   # azul  — hombro→codo
C_EW    = '#10b981'   # verde — codo→muñeca
C_SW    = '#9ca3af'   # gris  — hombro→muñeca (referencia)
C_WI    = '#f59e0b'   # ámbar — muñeca→índice
C_BONE  = '#cbd5e1'   # gris claro — segmento de brazo
C_DOT   = '#1e293b'   # puntos de landmark
BG      = '#ffffff'


def vec_arrow(ax, p1, p2, color, lw=2.8, dashed=False, perp=0.0, alpha=1.0):
    """Flecha de p1 a p2 con offset perpendicular opcional para evitar solapamiento."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = np.hypot(dx, dy)
    if L > 0 and perp != 0:
        nx, ny = -dy / L, dx / L
        p1 = (p1[0] + nx * perp, p1[1] + ny * perp)
        p2 = (p2[0] + nx * perp, p2[1] + ny * perp)
    ax.annotate('', xy=p2, xytext=p1,
                arrowprops=dict(
                    arrowstyle='->', color=color, lw=lw, alpha=alpha,
                    linestyle='dashed' if dashed else 'solid',
                    mutation_scale=18,
                    shrinkA=6, shrinkB=6,
                ))


def draw_panel(ax, pts, title, note, lbl_off):
    """
    pts: dict con 'S'(shoulder), 'E'(elbow), 'W'(wrist), 'I'(index)
    lbl_off: dict de offsets {nombre: (dx, dy, ha)} para las etiquetas
    """
    S, E, W, I = pts['S'], pts['E'], pts['W'], pts['I']

    ax.set_facecolor(BG)

    # ── Silueta de brazo (segmentos gruesos grises) ───────────────────────
    xs = [S[0], E[0], W[0], I[0]]
    ys = [S[1], E[1], W[1], I[1]]
    ax.plot(xs, ys, color=C_BONE, lw=12,
            solid_capstyle='round', solid_joinstyle='round', zorder=1)

    # ── Vector de referencia v_SW (punteado, ligeramente desplazado) ──────
    vec_arrow(ax, S, W, C_SW, lw=1.8, dashed=True, perp=0.025, alpha=0.85)

    # ── Vectores principales ──────────────────────────────────────────────
    vec_arrow(ax, S, E, C_SE, lw=3.0)
    vec_arrow(ax, E, W, C_EW, lw=3.0)
    vec_arrow(ax, W, I, C_WI, lw=3.0)

    # ── Puntos de landmark ────────────────────────────────────────────────
    landmark_colors = {
        'S': C_SE, 'E': C_EW, 'W': C_WI, 'I': C_WI,
    }
    for key, (x, y) in pts.items():
        c = landmark_colors.get(key, C_DOT)
        ax.plot(x, y, 'o', color=C_DOT,  ms=11, zorder=5)
        ax.plot(x, y, 'o', color='white', ms=6,  zorder=6)
        ax.plot(x, y, 'o', color=c,       ms=3,  zorder=7)

    # ── Etiquetas de landmarks ────────────────────────────────────────────
    names = {'S': 'hombro', 'E': 'codo', 'W': 'muñeca', 'I': 'índice'}
    default = {
        'S': (-0.07,  0.04, 'right'),
        'E': ( 0.00, -0.08, 'center'),
        'W': ( 0.00, -0.08, 'center'),
        'I': ( 0.06,  0.00, 'left'),
    }
    default.update(lbl_off)
    for key, (x, y) in pts.items():
        dx, dy, ha = default[key]
        ax.text(x + dx, y + dy, names[key],
                fontsize=8.5, ha=ha, va='center',
                color='#374151', style='italic',
                fontfamily='DejaVu Sans')

    # ── Etiquetas de los vectores (en el punto medio de cada segmento) ────
    vec_labels = [
        (S, E, C_SE, r'$\vec{v}_{SE}$', 'right'),
        (E, W, C_EW, r'$\vec{v}_{EW}$', 'right'),
        (W, I, C_WI, r'$\vec{v}_{WI}$', 'right'),
    ]
    for p1, p2, col, label, ha in vec_labels:
        mx = (p1[0] + p2[0]) / 2
        my = (p1[1] + p2[1]) / 2
        # pequeño offset perpendicular para no tapar la flecha
        dx2, dy2 = p2[0]-p1[0], p2[1]-p1[1]
        L2 = np.hypot(dx2, dy2)
        if L2 > 0:
            ox, oy = -dy2/L2 * 0.06, dx2/L2 * 0.06
        else:
            ox, oy = 0, 0
        ax.text(mx + ox, my + oy, label,
                fontsize=9, color=col, ha='center', va='center',
                fontweight='bold', zorder=8,
                path_effects=[pe.withStroke(linewidth=2, foreground='white')])

    # ── Marco, título y nota ──────────────────────────────────────────────
    for spine in ax.spines.values():
        spine.set_edgecolor('#e2e8f0')
        spine.set_linewidth(1.2)

    ax.set_title(title, fontsize=10.5, fontweight='bold',
                 pad=10, color='#0f172a')
    ax.text(0.5, -0.04, note, transform=ax.transAxes,
            fontsize=8, ha='center', color='#64748b', style='italic')

    ax.set_xlim(-0.20, 1.20)
    ax.set_ylim(-0.60, 0.55)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])


# ── Escenarios ────────────────────────────────────────────────────────────────
scenarios = [
    {
        'pts': {
            'S': (0.10, 0.20),
            'E': (0.40, 0.20),
            'W': (0.70, 0.20),
            'I': (0.90, 0.20),
        },
        'title': 'Brazo extendido\n(señalando al frente)',
        'note':  'Todos los vectores apuntan en la misma dirección',
        'lbl': {
            'S': (-0.07,  0.06, 'right'),
            'E': ( 0.00, -0.08, 'center'),
            'W': ( 0.00, -0.08, 'center'),
            'I': ( 0.06,  0.00, 'left'),
        },
    },
    {
        'pts': {
            'S': (0.10, 0.25),
            'E': (0.28, 0.06),
            'W': (0.68, -0.06),
            'I': (0.88, -0.13),
        },
        'title': 'Codo doblado\n(señalando lateralmente)',
        'note':  r'$\vec{v}_{EW}$ captura el ángulo real; $\vec{v}_{SE}$ lo subestima',
        'lbl': {
            'S': (-0.07,  0.06, 'right'),
            'E': (-0.08,  0.00, 'right'),
            'W': ( 0.00, -0.09, 'center'),
            'I': ( 0.06,  0.00, 'left'),
        },
    },
    {
        'pts': {
            'S': (0.40, 0.35),
            'E': (0.40, 0.10),
            'W': (0.40, -0.18),
            'I': (0.40, -0.35),
        },
        'title': 'Brazo colgando\n(no es gesto)',
        'note':  'E1: falso positivo  —  E6: rechazado (orientación vertical)',
        'lbl': {
            'S': ( 0.08,  0.00, 'left'),
            'E': ( 0.08,  0.00, 'left'),
            'W': ( 0.08,  0.00, 'left'),
            'I': ( 0.08,  0.00, 'left'),
        },
    },
]

fig, axes = plt.subplots(1, 3, figsize=(13, 5.0),
                         gridspec_kw={'wspace': 0.12})
fig.patch.set_facecolor(BG)

for ax, sc in zip(axes, scenarios):
    draw_panel(ax, sc['pts'], sc['title'], sc['note'], sc['lbl'])

# ── Leyenda ───────────────────────────────────────────────────────────────────
handles = [
    mpatches.Patch(color=C_SE, label=r'$\vec{v}_{SE}$  hombro → codo'),
    mpatches.Patch(color=C_EW, label=r'$\vec{v}_{EW}$  codo → muñeca'),
    mpatches.Patch(color=C_SW, label=r'$\vec{v}_{SW}$  hombro → muñeca  (referencia)'),
    mpatches.Patch(color=C_WI, label=r'$\vec{v}_{WI}$  muñeca → índice'),
]
fig.legend(handles=handles, loc='lower center', ncol=4,
           fontsize=9.5, frameon=True, framealpha=1.0,
           edgecolor='#e2e8f0', facecolor='white',
           bbox_to_anchor=(0.5, 0.01))

fig.suptitle(
    'Vectores articulares del sistema de pointing en tres configuraciones del brazo',
    fontsize=11.5, fontweight='bold', y=1.01, color='#0f172a'
)
plt.tight_layout(rect=[0, 0.11, 1, 1.0])
plt.savefig(OUT, dpi=180, bbox_inches='tight', facecolor=BG)
print(f'Guardado: {OUT}')
