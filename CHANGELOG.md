# Cambios de flota

Cada versión dice qué cambió en la asignación de modelos y por qué. Así el aviso de actualización
puede explicarle al usuario qué recibe.

## 1.3.1 — 2026-10-27

- **Claude decide cuándo conviene un workflow y te lo propone.** Trabajas siempre en Opus 5.5
  xhigh con ultracode apagado. Cuando un pedido rinde claramente más con varios agentes en
  paralelo, Claude te lo propone antes de empezar: qué haría, cuántos agentes y el % estimado de
  la semana. Tú respondes "sí" o "no". Pasa, por ejemplo, al auditar un proyecto entero, revisar
  un cambio grande, migrar muchos archivos, investigar con muchas fuentes o hacer una revisión
  crítica de dinero o seguridad. Para el resto, Claude trabaja solo o con los agentes de flota,
  sin preguntar.
- Sin cambios en la asignación de modelos.

## 1.3.0 — 2026-10-27

- **Pruebas a ciegas en código real.** Se hicieron en un SaaS con pagos, con bugs plantados, tareas
  con tests ocultos y jueces de otra familia. Cambian dos roles:
  - `flota:revisor-critico` pasa de **Fable a Opus**. Encontró 13 de 14 bugs plantados contra 9 de
    14 de Fable, sin falsos positivos, y cuesta ~27% menos.
  - `flota:implementador` pasa de **Opus a Sonnet** (xhigh). Empató o superó a Opus en 5 tareas con
    decisiones y costó ~48% menos. En tareas largas o de dinero, la política indica pasarle
    `model: opus`.
- `flota:verificador` sigue en Fable: empató con Opus (12/12), pero aporta una verificación de otra
  familia.
- **El esfuerzo sigue en xhigh en todos los roles.** En la prueba, high empeoró al implementador
  (último en las 5 tareas) y le hizo perder un bug real al investigador.
- **`flota:implementador` y `flota:mecanico` ya no cargan herramientas que no usan** (artefactos,
  controles de la app, navegador de Chrome, etc.). Arrancan con ~25% menos contexto. Es una lista
  de exclusión: las herramientas nuevas de Claude Code les siguen llegando.
- **La política suma "Contexto y pausas".** Compactar antes de una pausa larga evita reescribir
  todo el caché al volver, que en el uso medido era ~1/3 del gasto de las sesiones principales.
  También corrige la nota sobre el esfuerzo por llamada: existe desde la CLI 2.1.292.

## 1.2.1 — 2026-10-15

- **Recalibración tras Haiku 5.5** (salió el 7-oct): sin cambios de asignación.
  - `flota:explorador` ya corre en Haiku 5.5 por el alias `haiku`. Es un salto grande sobre
    Haiku 4.5 y cuesta 10 veces menos, salvo con prompts de más de 100K tokens.
  - Haiku 5.5 no reemplaza a Sonnet en `flota:investigador` ni en `flota:mecanico`: alucina más
    según su ficha oficial y queda muy abajo en refactors.
  - `flota:verificador` y `flota:revisor-critico` siguen en Fable hasta una prueba a ciegas
    contra Opus.
- La política suma Haiku 5.5 a la tabla de precios.

## 1.2.0 — 2026-10-13

- **flota pasa a ser público**, con licencia MIT. Cualquiera puede instalarlo: ya no hace falta
  invitación ni conectar GitHub.
- El plugin vive ahora en la raíz del repositorio.
- README nuevo, con la sección "Qué ejecuta y qué modifica en tu equipo", y política de privacidad.
- Sin cambios en la asignación de modelos.

## 1.1.1 — 2026-10-02

- **Instalación desde la app, sin terminal:** Customize → Plugins → Add → Add marketplace →
  `carlosisaacfaura/flota`, conectando GitHub. Con Sync automatically las versiones nuevas llegan
  solas. El README, la política y la desinstalación ahora cubren los dos caminos: app y terminal.
- Sin cambios en la asignación de modelos.

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
