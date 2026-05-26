# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

TFM: **Reconocimiento de Gestos Deícticos y Referencias Espaciales en Tiempo Real**
Stack: OpenCV.js 4.8 + MediaPipe Tasks for Web, todo ejecutado en el navegador sobre cámara RGB estándar.
El desarrollo sigue **fases progresivas**; no añadir funcionalidad fuera de la fase activa.

## Cómo ejecutar

```bash
npm run dev          # levanta http-server en localhost:8080
```

El navegador **requiere HTTPS o localhost** para acceder a la webcam. Nunca abrir `index.html` directamente con `file://`.

## Convención de estructura por fases

Cada fase sigue el mismo patrón:

```
src/modules/<nombre-fase>/     ← módulos reutilizables de esa fase
fase<N>/
  index.html                   ← standalone para probar solo esa fase
  style.css
  main.js                      ← orquestador solo con los módulos de esa fase
```

`index.html` en la raíz + `src/main.js` es la app integrada que combina todas las fases.

## Arquitectura actual

```
index.html              # App integrada — carga OpenCV.js, despacha 'opencv-ready'
styles/main.css
src/
  main.js               # Orquestador integrado (todas las fases)
  modules/
    homografia/              # Fase 1 — infraestructura geométrica
      camera.js              #   CameraModule — getUserMedia
      calibration.js         #   CalibrationModule — selección de 4 esquinas con overlay
      homography.js          #   HomographyModule — getPerspectiveTransform / warpPerspective
      coordinates.js         #   CoordinateSystem — normalización [0,1]², rejilla, dibujo
    estimacion_corporal/     # Fase 2 — estimación corporal MediaPipe
      vision.js              #   Singleton FilesetResolver (WASM compartido)
      pose.js                #   PoseEstimator — PoseLandmarker (33 landmarks)
      hands.js               #   HandEstimator — HandLandmarker (21 landmarks × 2 manos)
      landmarks.js           #   Índices POSE_IDX/HAND_IDX, cadenas, extractDeicticLandmarks()
      stability.js           #   StabilityTracker — ventana 30 frames, jitter + EMA
      renderer.js            #   LandmarkRenderer — esqueleto, índice, anillos, panel
fase1/
  index.html            # Standalone fase 1
  style.css
  main.js
fase2/
  index.html            # Standalone fase 2 (sin OpenCV)
  style.css
  main.js
```

## Convenciones clave

**OpenCV.js y memoria:** todo `cv.Mat` creado con `new cv.Mat()` o `cv.matFromArray()` debe llamarse `.delete()` cuando ya no se use. Los métodos de `HomographyModule` que devuelven un `Mat` transfieren la responsabilidad de borrado al llamador.

**Orden de esquinas en calibración:** siempre ↖ → ↗ → ↘ → ↙. Este orden es el que espera `HomographyModule.compute()` para mapear al rectángulo destino.

**Módulo ES vs script clásico:** todos los módulos usan `import/export` ES. La inicialización de OpenCV se hace con `var Module = { onRuntimeInitialized }` en un script clásico *antes* del `<script async src="opencv.js">`, que despacha el evento `'opencv-ready'`. Los módulos de fase 2 no necesitan OpenCV.

**Flip especular de MediaPipe Hands:** la categoría `"Left"` del modelo corresponde a la mano **derecha** real del usuario (imagen en espejo). `extractDeicticLandmarks()` corrige este flip automáticamente.

**Detección en el loop:** `pose.detect(video, now)` y `hands.detect(video, now)` son síncronos. El timestamp debe ser monotónico (`performance.now()`).

**Estabilidad:** ventana de 30 frames. Umbrales de jitter (coordenadas normalizadas): < 0.004 → estable (verde), 0.004–0.012 → moderado (amarillo), > 0.012 → inestable (rojo).

**Sistema de coordenadas normalizadas:** origen (0,0) en esquina superior-izquierda del plano rectificado. X crece hacia la derecha, Y hacia abajo. La rejilla 3×3 divide el espacio en: superior/medio/inferior × izquierda/centro/derecha.
