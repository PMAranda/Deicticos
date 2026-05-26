import { PoseLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { getVisionResolver } from './vision.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class PoseEstimator {
  constructor() {
    this._landmarker = null;
  }

  async init() {
    const vision = await getVisionResolver();
    this._landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence:  0.5,
      minTrackingConfidence:      0.5,
    });
  }

  /**
   * Detección sincrónica sobre un frame de vídeo.
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs - timestamp monotónico (performance.now())
   * @returns {PoseLandmarkerResult | null}
   */
  detect(video, timestampMs) {
    if (!this._landmarker) return null;
    return this._landmarker.detectForVideo(video, timestampMs);
  }

  get isReady() { return this._landmarker !== null; }

  dispose() {
    this._landmarker?.close();
    this._landmarker = null;
  }
}
