import { FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

// Singleton: un único módulo WASM compartido por PoseEstimator y HandEstimator
let _resolver = null;

export async function getVisionResolver() {
  if (!_resolver) {
    _resolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
  }
  return _resolver;
}
