# Cambios de flota

Cada versión dice qué cambió en la asignación de modelos y por qué. Así el aviso de actualización
puede explicarle al usuario qué recibe.

## 1.1.0 — 2026-10-01

- **Agente nuevo `flota:implementador` (Opus 5.5 · xhigh)** para implementar con decisiones: una
  tarea de un plan, una feature o una integración entre módulos.
- **`flota:mecanico` (Sonnet 5.5) queda solo para cambios ya especificados al detalle.**
- **Por qué:** al medir los registros reales, la implementación de tareas de planes estaba
  llegando a `mecanico`. La prueba propia solo había mostrado que Sonnet basta para cambios
  especificados, y la evidencia pública favorece a Opus 5.5 al implementar (Terminal-Bench 64 vs
  43; GDPval 1820 vs 1725).
- **Pendiente:** prueba a ciegas Opus contra Sonnet en tareas reales de planes. Si Sonnet empata,
  el rol se revierte en una versión futura.
- **La regla de delegación de la política cambió:** el "implementer" de skills como superpowers
  ahora va a `flota:implementador`.
- **Costo:** cada tarea de implementación cuesta más o menos el doble que con Sonnet.
- **Auditoría integral:**
  - En la profundidad completa, el mapa del proyecto lo hace Opus. Decide qué ve el revisor crítico
    y qué no se reporta, así que es juicio, no barrido.
  - Al deduplicar, un hallazgo alto ya no queda en severidad media por una variante de menor
    severidad.
  - Estimación de costo recalibrada con dos mediciones reales: el consumo fue ~0,4× lo estimado.
  - La copia segura también excluye entornos virtuales rotos y los worktrees de `.claude`.

## 1.0.0 — 2026-09-29

Primera versión.

- **Asignación de modelos** (calibrada el 24-sep con el lanzamiento de Opus 5.5 y revisada el
  28-sep con Sonnet 5.5):
  - Opus 5.5 en la sesión principal, `flota:revisor`, `flota:auditor` y `flota:auditor-producto`.
  - Fable 5.1 en `flota:verificador` y `flota:revisor-critico`: no hay comparación directa contra
    Opus 5.5 para refutar hallazgos, y el riesgo en dinero y seguridad es asimétrico.
  - Sonnet 5.5 en `flota:investigador` y `flota:mecanico`.
  - Haiku 4.5 en `flota:explorador`.
- **Esfuerzo xhigh en todos los agentes** (decidido el 29-sep). Se midió en código propio con un
  bake-off a ciegas: ningún nivel dio peor resultado, y xhigh encontró más bugs reales que high sin
  falsos positivos. max no mostró ganancia medible y cuesta 3–4× xhigh, así que queda solo para
  usos puntuales.
- **`/flota:auditoria-integral`:** primera versión, probada en un SaaS real. La profundidad rápida
  gastó ~2% de la semana y encontró 22 hallazgos, 1 alto de dinero reproducido. El workflow
  `flota:auditar` trae las checklists incrustadas, así que los agentes no leen archivos fuera del
  proyecto.
- **Hook** que impide bajar el modelo de un agente de flota en silencio.
- **`/flota:instalar-politica`** y el aviso al abrir sesión.
