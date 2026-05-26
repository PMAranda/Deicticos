// Orden de selección: ↖ Superior-Izquierda → ↗ Superior-Derecha → ↘ Inferior-Derecha → ↙ Inferior-Izquierda
const CORNER_LABELS  = ['↖ Sup-Izq', '↗ Sup-Der', '↘ Inf-Der', '↙ Inf-Izq'];
const CORNER_COLORS  = ['#FF4D4D', '#4DFF88', '#4D9FFF', '#FFD700'];
const REQUIRED_CORNERS = 4;

export class CalibrationModule {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.corners   = [];
    this._onComplete = null;
    this._clickHandler = this._onClick.bind(this);
  }

  // Inicia el modo de calibración. onComplete(corners) se llama al seleccionar las 4 esquinas.
  start(onComplete) {
    this.corners     = [];
    this._onComplete = onComplete;
    this.canvas.addEventListener('click', this._clickHandler);
    this.canvas.style.cursor = 'crosshair';
  }

  stop() {
    this.canvas.removeEventListener('click', this._clickHandler);
    this.canvas.style.cursor = 'default';
  }

  reset() {
    this.stop();
    this.corners     = [];
    this._onComplete = null;
  }

  get isComplete() {
    return this.corners.length === REQUIRED_CORNERS;
  }

  getCorners() {
    return this.corners.map(p => ({ ...p }));
  }

  // Dibuja el overlay de calibración sobre el canvas de cámara (llamar en el loop de render)
  drawOverlay() {
    if (this.corners.length === 0) return;

    const ctx = this.ctx;

    // Polígono de las esquinas seleccionadas
    if (this.corners.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.corners[0].x, this.corners[0].y);
      for (let i = 1; i < this.corners.length; i++) {
        ctx.lineTo(this.corners[i].x, this.corners[i].y);
      }
      if (this.isComplete) ctx.closePath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Puntos con etiqueta
    this.corners.forEach((pt, i) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      ctx.fillStyle   = CORNER_COLORS[i];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font      = 'bold 13px system-ui, sans-serif';
      ctx.shadowColor  = '#000';
      ctx.shadowBlur   = 4;
      ctx.fillText(CORNER_LABELS[i], pt.x + 14, pt.y + 5);
      ctx.shadowBlur   = 0;
    });
  }

  _onClick(event) {
    if (this.isComplete) return;

    const rect   = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;

    this.corners.push({
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top)  * scaleY,
    });

    if (this.isComplete) {
      this.stop();
      this._onComplete?.(this.getCorners());
    }
  }
}
