import { FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

// Singleton: un único módulo WASM compartido por PoseEstimator y HandEstimator.
// Se guarda la Promise (no el valor resuelto) para evitar race conditions cuando
// pose.init() y hands.init() se llaman de forma concurrente: ambas leen la misma
// Promise antes de que resuelva, y el WASM solo se carga una vez.
let _resolverPromise = null;

export function getVisionResolver() {
  if (!_resolverPromise) {
    _resolverPromise = FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
  }
  return _resolverPromise;
}
