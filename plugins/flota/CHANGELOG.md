# Cambios de flota

Cada versión dice qué cambió en la asignación de modelos y por qué. Así el aviso de actualización
puede explicarle al usuario qué recibe.

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
