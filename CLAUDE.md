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

`index.html` en la raíz es el **índice del proyecto** (enlaza fases, demos, showcase y evaluación). No contiene lógica propia; cada fase/demo se ejecuta de forma aislada.

## Arquitectura actual

```
index.html              # Índice del proyecto (enlaza fases, demos, showcase, evaluación)
src/
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
      comparador.js          #   compareSourceLandmarks() — divergencia Pose vs Hands
      logger.js              #   SessionLogger — grabación, resumen y exportación CSV
    heuristica/              # Fase 3 — heurística de pointing deíctico
      vectores.js            #   Utilidades 2D + extractArmVectors() + computeExtensionAngle()
      fusion.js              #   fuseVectors() — fusión jerárquica ponderada
      validacion.js          #   validateGesture() + detectActiveSide()
      pointing.js            #   PointingEstimator — orquesta todo + suavizado EMA
      renderer.js            #   PointingRenderer — rayo, vectores componente, panel, sparklines
      metricas.js            #   AngularTracker — jitter angular, continuidad, distribución modos
      logger.js              #   PointingSessionLogger — grabación y exportación CSV por sesión
fase1/
  index.html            # Standalone fase 1
  style.css
  main.js
fase2/
  index.html            # Standalone fase 2 (sin OpenCV)
  style.css
  main.js
fase3/
  index.html            # Standalone fase 3 (sin OpenCV)
  style.css
  main.js
fase4/
  index.html            # Standalone fase 4 (requiere OpenCV para homografía)
  style.css
  main.js               # Combina fase 1 (calibración) + fase 3 (pointing) + fase 4 (grounding)
fase5/
  index.html            # Standalone fase 5 (requiere OpenCV)
  style.css
  main.js               # Combina fases 1-4 + DwellConfirmer; configuración de umbrales en UI
```

**Módulos fase 4 — grounding espacial (`src/modules/grounding/`)**:
- `interseccion.js` — `raySegmentIntersect()` + `rayPolygonIntersect()`: geometría 2D pura, rayo vs cuadrilátero del tablero
- `grounding.js` — `BoardGrounding`: rayo (píxeles cámara) → intersección → homografía → coords normalizadas + EMA del impacto
- `metricas.js` — `ImpactTracker`: jitter espacial del impacto (ventana 30 frames), cambios de región, tasa de impacto
- `renderer.js` — `GroundingRenderer`: rayo extendido en vista cámara, impacto + trail en vista tablero, panel de métricas
- `logger.js` — `GroundingSessionLogger`: grabación frame a frame y exportación CSV

## Convenciones clave

**OpenCV.js y memoria:** todo `cv.Mat` creado con `new cv.Mat()` o `cv.matFromArray()` debe llamarse `.delete()` cuando ya no se use. Los métodos de `HomographyModule` que devuelven un `Mat` transfieren la responsabilidad de borrado al llamador.

**Orden de esquinas en calibración:** siempre ↖ → ↗ → ↘ → ↙. Este orden es el que espera `HomographyModule.compute()` para mapear al rectángulo destino.

**Módulo ES vs script clásico:** todos los módulos usan `import/export` ES. La inicialización de OpenCV se hace con `var Module = { onRuntimeInitialized }` en un script clásico *antes* del `<script async src="opencv.js">`, que despacha el evento `'opencv-ready'`. Los módulos de fase 2 no necesitan OpenCV.

**Flip especular de MediaPipe Hands:** la categoría `"Left"` del modelo corresponde a la mano **derecha** real del usuario (imagen en espejo). `extractDeicticLandmarks()` corrige este flip automáticamente.

**Detección en el loop:** `pose.detect(video, now)` y `hands.detect(video, now)` son síncronos. El timestamp debe ser monotónico (`performance.now()`).

**Modos de ejecución MediaPipe:** `init('VIDEO')` (por defecto) mantiene estado temporal entre frames — correcto para cámara y vídeo. `init('IMAGE')` procesa cada llamada de forma independiente sin estado — obligatorio para imágenes estáticas; garantiza resultados deterministas (la misma imagen siempre da el mismo resultado). En modo IMAGE, `detect(source)` llama a `landmarker.detect()` internamente, ignorando el timestamp.

**Estabilidad:** ventana de 30 frames. Umbrales de jitter (coordenadas normalizadas): < 0.004 → estable (verde), 0.004–0.012 → moderado (amarillo), > 0.012 → inestable (rojo).

**Sistema de coordenadas normalizadas:** origen (0,0) en esquina superior-izquierda del plano rectificado. X crece hacia la derecha, Y hacia abajo. La rejilla 3×3 divide el espacio en: superior/medio/inferior × izquierda/centro/derecha.

**Heurística de pointing — fusión jerárquica:** pesos base shoulderElbow=0.35, shoulderWrist=0.15, elbowWrist=0.35, wristIndex=0.15. `elbowWrist` tiene peso igual a `shoulderElbow` para capturar variaciones angulares del antebrazo en gestos laterales (el hombro como referencia única subestima la desviación lateral cuando el usuario mira a cámara). Los pesos de vectores no disponibles se redistribuyen automáticamente entre los activos. Modos: `full` (todos), `partial` (sin índice), `fallback` (solo proximal), `lost` (sin gesto).

**Ángulo de extensión del brazo:** mide el ángulo entre los vectores hombro→codo y codo→muñeca en el plano 2D de imagen. 0° = brazo totalmente extendido. Se calcula con `computeExtensionAngle()` en `vectores.js`. **No es un criterio binario de rechazo**: se integra como factor gradual de confianza mediante `extScore = 1 − min(1, angle / EXT_ANGLE_REF)` (con `EXT_ANGLE_REF = 150°` en `validacion.js`). Brazo extendido → extScore≈1; brazo muy doblado (≥150°) → extScore=0. Señalar elementos cercanos con el codo parcialmente flexionado reduce la confianza pero no invalida el gesto.

**Restricciones adicionales de validación (falsos positivos):** el ángulo de extensión solo mide linealidad, no dirección — un brazo colgando hacia abajo también tiene extensionAngle ≈ 0° y generaba falsos positivos. `validateGesture()` aplica dos restricciones extra:
- *Orientación global* (`MIN_ANGLE_FROM_DOWN = 30°`): el vector hombro→muñeca (o hombro→codo si la muñeca no es visible) debe desviarse al menos 30° de la dirección vertical-abajo `{0,1}`. Razón de rechazo: `'brazo_colgante'`.
- *Alcance mínimo* (`MIN_WRIST_REACH = 0.12`): distancia hombro-muñeca en coords normalizadas debe superar 0.12. Solo se comprueba cuando la muñeca tiene visibilidad ≥ 0.3. Razón de rechazo: `'muneca_muy_cerca'`.
La confidencia incorpora un tercer factor (elevScore) que vale 0 cerca del umbral mínimo y 1 cuando el brazo es horizontal o superior: `confidence = vis×0.5 + ext×0.3 + elev×0.2`.

**Ángulo de pointing:** dirección del vector fusionado en el plano imagen, calculado con `atan2(y, x)` en `metricas.js`. 0° = derecha, ±90° = abajo/arriba, ±180° = izquierda. Es distinto del ángulo de extensión del codo.

**Jitter angular:** variación frame a frame del ángulo de pointing `|Δθ|` en grados, con corrección wrap-around. Umbrales: < 3°/frame → estable, 3–8° → moderado, > 8° → inestable. `AngularTracker` mantiene ventana de 30 frames igual que `StabilityTracker`.

**Suavizado temporal EMA:** `PointingEstimator` aplica α=0.3 sobre el vector fusionado cuando hay gesto raw activo. Sin gesto raw, el vector decae ×0.9/frame.

**Histéresis asimétrica:** `PointingEstimator` mantiene `_accumConf` acumulado entre frames. Sube `CONF_RISE=0.40×confidence` por frame con gesto y baja `CONF_FALL=0.10` por frame sin él. Activa en `_accumConf ≥ 0.45` (~2 frames con conf≥0.6) y desactiva en `_accumConf < 0.20` (~7 frames desde máximo). El resultado expone `isGesture` (histéresis) y `rawIsGesture` (frame a frame). La evaluación de imágenes usa `rawIsGesture`/`rawConfidence` para que la anotación refleje la detección directa del frame.

**Grounding espacial (fase 4):** `BoardGrounding.project(result, W, H, corners)` convierte el rayo de pointing en coordenadas normalizadas [0,1]² del tablero. Flujo: (1) escala origen y dirección de [0,1] a píxeles (corrigiendo aspecto de imagen), (2) `rayPolygonIntersect` con las 4 esquinas calibradas, (3) `homography.transformPoint` al plano rectificado, (4) normaliza y clasifica región con `CoordinateSystem`. El resultado incluye `hitPx` (píxeles cámara), `rectPx` (píxeles rectificados), `xn/yn` (normalized), `smoothed` (EMA α=0.25) y `region` (label de rejilla 3×3). Si el rayo no intersecta el tablero, devuelve `null`.

**Condición experimental fase 3:** añade campo `heuristic` (nombre de la config, p.ej. `config_base`) a los metadatos de sesión. Permite comparar distintas configuraciones de pesos en el CSV exportado.

**Dwell de gesto (fase 5):** `DwellConfirmer` (`src/modules/semantica/dwell.js`) requiere N frames consecutivos con `isGesture=true` antes de emitir `isConfirmed=true`. Si el gesto se interrumpe un solo frame, el contador se reinicia. Con `dwellFrames=0` la confirmación es inmediata. El umbral es configurable en caliente con `setDwellFrames(n)`. La barra de progreso de la UI rellena linealmente durante la espera y desaparece al confirmarse; el panel de región (prominente) solo se muestra cuando `isConfirmed=true`.

**Debounce de región configurable:** `BoardGrounding.setRegionDebounce(n)` actualiza el número de frames consecutivos necesarios para confirmar un cambio de región. Por defecto 5 frames (`REGION_CHANGE_FRAMES`). La fase 5 expone este parámetro como slider en la UI para explorar el equilibrio robustez/latencia.
