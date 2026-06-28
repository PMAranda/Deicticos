/* ════════════════════════════════════════════════════════════════════════════
   CONTENIDO DEL PANEL — compartido por la consola (panel) y la pantalla (tablero).
   Edita este objeto para tu propio póster temático.

   La clave es la región de la rejilla 3×3: «<fila>-<columna>»
     filas:    superior · medio · inferior
     columnas: izquierda · centro · derecha
   Cada zona corresponde a una celda física del panel que vas a calibrar.
   Ejemplo: póster del Sistema Solar dispuesto en 3×3.
   ════════════════════════════════════════════════════════════════════════════ */
export const CONTENT = {
  'superior-izquierda': { img: 'img/sol.svg',      title: 'Sol',      body: 'Estrella central del sistema. Concentra el 99,8 % de la masa total y es una esfera de plasma a unos 5.500 °C en su superficie.' },
  'superior-centro':    { img: 'img/mercurio.svg', title: 'Mercurio', body: 'El planeta más cercano al Sol y el más pequeño. Sin apenas atmósfera, su temperatura oscila entre menos 180 y 430 grados.' },
  'superior-derecha':   { img: 'img/venus.svg',    title: 'Venus',    body: 'El planeta más caliente por su densa atmósfera de dióxido de carbono. Gira en sentido inverso al resto y un día dura más que su año.' },
  'medio-izquierda':    { img: 'img/tierra.svg',   title: 'Tierra',   body: 'El único planeta con vida conocida. Su atmósfera y el agua líquida en superficie lo hacen habitable.' },
  'medio-centro':       { img: 'img/marte.svg',    title: 'Marte',    body: 'El planeta rojo, por el óxido de hierro de su suelo. Alberga el mayor volcán del sistema solar, el Monte Olimpo.' },
  'medio-derecha':      { img: 'img/jupiter.svg',  title: 'Júpiter',  body: 'El gigante gaseoso más grande. Su Gran Mancha Roja es una tormenta mayor que la Tierra, activa desde hace siglos.' },
  'inferior-izquierda': { img: 'img/saturno.svg',  title: 'Saturno',  body: 'Famoso por su espectacular sistema de anillos de hielo y roca. Es el planeta menos denso: flotaría en agua.' },
  'inferior-centro':    { img: 'img/urano.svg',    title: 'Urano',    body: 'Gigante helado que rota casi tumbado sobre su órbita. Su tono azulado proviene del metano de su atmósfera.' },
  'inferior-derecha':   { img: 'img/neptuno.svg',  title: 'Neptuno',  body: 'El planeta más lejano. Tiene los vientos más rápidos del sistema solar, de hasta 2.000 kilómetros por hora.' },
};

// Orden de la cuadrícula 3×3 (fila-mayor) para construir las vistas
export const GRID_ORDER = [
  'superior-izquierda', 'superior-centro', 'superior-derecha',
  'medio-izquierda',    'medio-centro',    'medio-derecha',
  'inferior-izquierda', 'inferior-centro', 'inferior-derecha',
];

// Canal de sincronización consola ↔ tablero (mismo navegador, distintas ventanas)
export const CHANNEL = 'panel-tematico';
