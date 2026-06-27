# Reconocimiento de Gestos Deícticos y Referencias Espaciales en Tiempo Real

**Trabajo de Fin de Máster · Universidad Carlos III de Madrid**
Autor: Pablo Moreno · 2026

Sistema de reconocimiento de gestos de *pointing* (señalado deíctico) que, a partir de una
**cámara RGB estándar**, estima hacia qué región de una superficie calibrada apunta una persona.
Todo el procesamiento se ejecuta **en el navegador**, sin hardware especializado (sin cámaras de
profundidad, guantes ni marcadores) y sin enviar datos a ningún servidor externo.

**Stack:** OpenCV.js 4.8 · MediaPipe Tasks for Web (BlazePose + Hands) · JavaScript (módulos ES).

---

## Requisitos

- **Node.js** (solo para servir los archivos estáticos en local).
- Un **navegador moderno** con acceso a cámara (Chrome/Edge/Firefox recientes).
- La webcam **requiere HTTPS o `localhost`**: nunca abrir los `.html` con `file://`.

OpenCV.js y MediaPipe se cargan por CDN, por lo que la primera carga necesita conexión a internet.

## Cómo ejecutar

```bash
npm run dev
```

Levanta un servidor estático en `http://localhost:8080` y abre el **índice del proyecto**
(`index.html`), desde el que se accede a todas las fases, demos y herramientas de evaluación.

---

## Estructura del proyecto

```
index.html              Índice del proyecto (enlaza fases, demos, showcase y evaluación)
src/modules/            Módulos reutilizables del sistema (el núcleo)
  homografia/           Fase 1 — cámara, calibración, homografía, coordenadas
  estimacion_corporal/  Fase 2 — BlazePose, Hands, estabilidad, render
  heuristica/           Fase 3 — vectores, fusión, validación, pointing
  grounding/            Fase 4 — intersección rayo/polígono, grounding sobre tablero
  semantica/            Fase 5 — confirmación por dwell
fase1/ … fase5/         Aplicaciones standalone de cada fase
fase_evaluacion/        Herramientas de evaluación (captura, protocolo, ablación, VLLM)
demo/                   Demostraciones de aplicación (panel temático, mapamundi)
showcase/               Demostración integrada del sistema completo
resultados_evaluacion/  Datos (CSV) de los experimentos reportados en la memoria
memoria_tfm/            Memoria LaTeX, figuras y scripts de generación de gráficas
```

El desarrollo sigue **fases progresivas**: cada fase añade una capa sobre la anterior y puede
ejecutarse de forma aislada para analizar su comportamiento por separado.

---

## Fases del sistema

| Fase | Componente | Descripción |
|------|------------|-------------|
| **1** | Infraestructura geométrica | Calibración de las 4 esquinas de la superficie, homografía (OpenCV.js) y coordenadas normalizadas `[0,1]²`. |
| **2** | Estimación corporal | BlazePose (33 landmarks) y MediaPipe Hands (21 landmarks). Estabilidad temporal y jitter. |
| **3** | Heurística de pointing | Fusión jerárquica de vectores articulares, validación biomecánica y suavizado EMA con histéresis. |
| **4** | Grounding espacial | Proyección del rayo de pointing sobre el tablero y clasificación del impacto en rejilla 3×3. |
| **5** | Pipeline integrado | Sistema completo con confirmación temporal por *dwell* y exportación de sesión. |

---

## Demostraciones

Casos de uso del sistema completo (consola con cámara + pantalla proyectable opcional). Todas
funcionan en local, sin servidor ni modelos en la nube:

- **🪐 Panel temático** (`demo/panel.html`) — póster en rejilla 3×3 (Sistema Solar). Se señala una
  zona, se confirma por permanencia y se muestra su ficha con **lectura por voz**.
- **🌍 Mapamundi** (`demo/mapa.html`) — planisferio equirectangular calibrado. Se señala un país y
  el sistema lo identifica por su geometría de fronteras (GeoJSON local), con voz.

Cada demo incluye una **pantalla pública** (`tablero.html` / `mapa_tablero.html`) para proyectar en
un segundo monitor, sincronizada con la consola mediante `BroadcastChannel`.

> Condiciones recomendadas: distancia 1,5–2,5 m, luz ambiente (no directa intensa), usuario de
> frente y brazo extendido lateralmente.

---

## Evaluación experimental

Las herramientas de evaluación están en `fase_evaluacion/` y los datos en `resultados_evaluacion/`:

- **Estudio de ablación** (E1–E6) sobre imágenes estáticas anotadas — detección binaria del gesto.
- **Precisión espacial (*fingerprint*)** — protocolo guiado con *ground truth* automático de región
  (escenarios frontal, lateral, espaldas, 45° y movimiento).
- **Comparador VLLM** — línea base con modelos de visión-lenguaje locales vía Ollama.




---

## Notas

- Todo el cómputo de visión ocurre **en el dispositivo**; no se envían imágenes a servidores externos.
- El acento del sistema es la **privacidad** y el funcionamiento sobre **hardware común**.
