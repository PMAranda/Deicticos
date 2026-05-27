import { HandLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { getVisionResolver } from './vision.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandEstimator {
  constructor() {
    this._landmarker = null;
  }

  /**
   * @param {'VIDEO'|'IMAGE'} mode
   *   VIDEO — tracking temporal entre frames (cámara/vídeo).
   *   IMAGE — sin estado entre llamadas; determinista para imágenes estáticas.
   */
  async init(mode = 'VIDEO') {
    const vision = await getVisionResolver();
    this._landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: mode,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence:  0.5,
      minTrackingConfidence:      0.5,
    });
    this._mode = mode;
  }

  /**
   * Detección sincrónica.
   * En modo VIDEO se requiere timestampMs monotónico (performance.now()).
   * En modo IMAGE el timestamp se ignora.
   * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
   * @param {number} timestampMs
   * @returns {HandLandmarkerResult | null}
   */
  detect(source, timestampMs) {
    if (!this._landmarker) return null;
    return this._mode === 'IMAGE'
      ? this._landmarker.detect(source)
      : this._landmarker.detectForVideo(source, timestampMs);
  }

  get isReady() { return this._landmarker !== null; }

  dispose() {
    this._landmarker?.close();
    this._landmarker = null;
  }
}
