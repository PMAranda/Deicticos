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

## Arquitectura

```
index.html              # Carga OpenCV.js (WASM), despacha 'opencv-ready', monta el módulo ES
styles/main.css
src/
  main.js               # Orquestador: máquina de estados IDLE → CALIBRATING → CALIBRATED
  modules/
    camera.js           # CameraModule — getUserMedia, expone width/height
    calibration.js      # CalibrationModule — selección de 4 esquinas con overlay visual
    homography.js       # HomographyModule — getPerspectiveTransform / warpPerspective (cv.Mat)
    coordinates.js      # CoordinateSystem — normalización [0,1]², rejilla de regiones, dibujo
```

## Convenciones clave

**OpenCV.js y memoria:** todo `cv.Mat` creado con `new cv.Mat()` o `cv.matFromArray()` debe llamarse `.delete()` cuando ya no se use. Los métodos de `HomographyModule` que devuelven un `Mat` transfieren la responsabilidad de borrado al llamador.

**Orden de esquinas en calibración:** siempre ↖ → ↗ → ↘ → ↙. Este orden es el que espera `HomographyModule.compute()` para mapear al rectángulo destino.

**Módulo ES vs script clásico:** `src/main.js` y todos los módulos usan `import/export`. El bloque `<script type="module">` en el HTML garantiza el aislamiento de ámbito. La inicialización de OpenCV se hace con `var Module = { onRuntimeInitialized }` en un script clásico *antes* del `<script async src="opencv.js">`.

**Sistema de coordenadas normalizadas:** origen (0,0) en esquina superior-izquierda del plano rectificado. X crece hacia la derecha, Y hacia abajo. La rejilla 3×3 por defecto divide el espacio en: superior/medio/inferior × izquierda/centro/derecha.
