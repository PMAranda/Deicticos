import { CameraModule }    from '../src/modules/homografia/camera.js';
import { PoseEstimator }   from '../src/modules/estimacion_corporal/pose.js';
import { HandEstimator }   from '../src/modules/estimacion_corporal/hands.js';
import { LandmarkRenderer } from '../src/modules/estimacion_corporal/renderer.js';
import { StabilityTracker } from '../src/modules/estimacion_corporal/stability.js';
import {
  extractDeicticLandmarks,
  STABILITY_KEYS,
} from '../src/modules/estimacion_corporal/landmarks.js';

class Fase2App {
  constructor() {
    this.video     = document.getElementById('video');
    this.canvas    = document.getElementById('canvas');
    this.statusEl  = document.getElementById('status');
    this.badgeEl   = document.getElementById('trackingBadge');
    this.ctx       = this.canvas.getContext('2d');

    this.camera    = new CameraModule(this.video);
    this.pose      = new PoseEstimator();
    this.hands     = new HandEstimator();
    this.renderer  = new LandmarkRenderer();
    this.stability = new StabilityTracker(30);

    this._poseResult  = null;
    this._handsResult = null;
  }

  async start() {
    this._setStatus('Cargando modelos MediaPipe…');

    try {
      await Promise.all([
        this.camera.start(),
        this.pose.init().then(() => this.hands.init()),
      ]);
    } catch (err) {
      this._setStatus(`Error: ${err.message}`, true);
      return;
    }

    this.canvas.width  = this.camera.width;
    this.canvas.height = this.camera.height;
    this._setStatus('Tracking activo');
    this._loop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const now = performance.now();

    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    if (this.pose.isReady)  this._poseResult  = this.pose.detect(this.video, now);
    if (this.hands.isReady) this._handsResult = this.hands.detect(this.video, now);

    const { pose, hands } = extractDeicticLandmarks(this._poseResult, this._handsResult);
    const W = this.canvas.width;
    const H = this.canvas.height;

    if (pose) {
      STABILITY_KEYS.forEach(({ key, idx }) => this.stability.update(key, pose[idx]));
    }

    this.renderer.drawArmSkeleton(this.ctx, pose, W, H);
    if (hands.Left)  this.renderer.drawHandLandmarks(this.ctx, hands.Left,  'Left',  W, H);
    if (hands.Right) this.renderer.drawHandLandmarks(this.ctx, hands.Right, 'Right', W, H);
    this.renderer.drawStabilityRings(this.ctx, pose, this.stability, W, H);
    this.renderer.drawStabilityPanel(this.ctx, this.stability.getAllMetrics());

    this._updateBadge(pose, hands);
  }

  _updateBadge(pose, hands) {
    if (!this.badgeEl) return;
    const parts = [];
    if (pose)               parts.push('Pose');
    if (hands.Left)         parts.push('Mano Izq');
    if (hands.Right)        parts.push('Mano Der');
    this.badgeEl.textContent = parts.length
      ? `Detectando: ${parts.join(' · ')}`
      : 'Sin detección';
    this.badgeEl.className = `tracking-badge ${parts.length ? 'active' : 'inactive'}`;
  }

  _setStatus(msg, isError = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('error', isError);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new Fase2App().start();
});
