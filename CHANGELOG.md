# Cambios de flota

Cada versión dice qué cambió en la asignación de modelos y por qué. Así el aviso de actualización
puede explicarle al usuario qué recibe.

## 1.5.0 — 2026-11-11

- **El trabajo visual va en Fable 5.2 por defecto.** `flota:implementador` recibe `model: fable`
  por llamada cuando la tarea es diseñar o animar algo que se ve: landings, anuncios y videos
  hechos con código, animaciones, escenas 3D y pantallas con diseño nuevo. Backend, lógica, tests
  y retoques chicos de estilo siguen en el modelo normal del rol. Ningún rol cambia de modelo base.
  - Prueba a ciegas con 3 encargos (landing, anuncio vertical, escena 3D), Fable 5.2 xhigh contra
    Opus 5.5 xhigh: dos jueces a ciegas prefirieron a Fable en la landing y el anuncio, y el
    mantenedor, también a ciegas, lo prefirió con claridad en los tres.
  - Fable costó 2,8 veces más ($119 contra $43) y entregó la escena 3D en negro por un error de
    una línea en un shader. Por eso la regla exige revisar lo visual en un navegador con GPU real.
  - Son 3 encargos: es un indicio, no una diferencia significativa.
- **Umbral de Fable en un solo lugar.** El 70% de uso semanal de Fable sobre el cual no se sube
  de modelo ahora se define en una línea al inicio de la política. Se cambia editando ese número,
  y se salta una vez diciendo "usa Fable igual". Lo usan esta regla y la del revisor crítico.

## 1.4.1 — 2026-11-10

- **Fable 5.2 arranca en high en la sesión principal.** `ajustes.json` agrega
  `modelSettings.claude-fable-5-2.effortLevel: high`. Antes, al elegir Fable en el selector, la
  sesión arrancaba en su esfuerzo por defecto o en el último usado, y había que ponerlo en high a
  mano. Los agentes tipados que corren en Fable conservan el `effort:` de su frontmatter (el
  verificador sigue en xhigh).
- **Por qué high y no xhigh:** en la sesión principal Fable 5.2 es un escalón puntual, y en high
  rinde casi igual que en xhigh por ~30% menos. Medido el 10-nov en la prueba difícil: usa ~35%
  menos turnos que Opus 5.5 xhigh, pero cuesta 1,6–1,9× más por tarea.

## 1.4.0 — 2026-11-09

- **Fable 5.2 llega solo al verificador.** Con la CLI 2.1.321 el alias `fable` pasa de 5.1 a 5.2,
  así que `flota:verificador` lo usa sin cambiar nada. Requiere esa CLI o una posterior.
- **El revisor crítico sigue en Opus 5.5 y sube a Fable 5.2 high solo en cambios críticos
  grandes:** cobros, reembolsos, webhooks de pago o permisos que crucen varios archivos o vayan a
  producción, y solo si el tope semanal de Fable va bajo ~70%.
  - En una prueba a ciegas difícil en código real de dinero y permisos (3 rondas), Fable 5.2 high
    encontró 20 de 27 bugs y Opus 17 de 27. No es significativo (p=0,25), pero las diferencias
    fueron todas a favor de Fable y en permisos.
  - Pasarlo entero no cabe en el tope semanal de Fable, y al llenarse el tope Claude Code no
    cambia solo a Opus.
- **La sesión principal sigue en Opus 5.5 xhigh.** Opus gana en planificar y redactar, y Fable
  5.2 costaría 1,47× con tokens reales. Cuando haga falta subir, el escalón ahora es Fable 5.2
  high.
- **`flota:explorador` lleva `effort: xhigh` explícito.** Desde la CLI 2.1.317 un subagente en
  otro modelo que la sesión ya no hereda su esfuerzo, y corría en medium.
- **Nueva regla: no dejes `/advisor` como default.** Los subagentes lo heredan y lo consultan.

## 1.3.2 — 2026-11-03

- **Cada pedido sigue tres pasos fijos.** Tras el 1.3.1, los registros de una semana mostraron
  que Claude no propuso ningún workflow. Con eso casi desapareció la verificación (de 137 corridas
  del verificador a 4), y el implementador tardaba ~50% más porque hacía solo tareas grandes. La
  política ahora abre con "Cómo ejecutar cada pedido":
  1. **Antes de empezar,** Claude elige el formato y te propone un workflow cuando conviene, con
     el mismo criterio del 1.3.1.
  2. **En una implementación grande** (más de ~30 min), Claude lanza 3 `flota:implementador` en
     paralelo, 4 como máximo, sobre archivos distintos. Antes decide lo compartido (tipos,
     contratos, qué archivos toca cada uno) y lo escribe en cada encargo.
     - Según una simulación con 416 corridas reales, 3 piezas cuestan lo mismo y tardan ~30%
       menos, porque el 69% del costo de un implementador es releer su propio contexto.
     - Desde 5 piezas el costo sube.
  3. **Al terminar código,** Claude lanza `flota:revisor` o `flota:revisor-critico` sin
     preguntar, y un `flota:verificador` por cada hallazgo alto, por ~1–2% de la semana por
     tarea.
- **Compactación en pausa:** Claude Code ya resume solo las sesiones inactivas de más de 200k
  tokens (`idleCompaction`, activa por defecto). La política deja de pedir que Claude recomiende
  `/compact` antes de una pausa.
- Sin cambios en la asignación de modelos. `flota:verificador` sigue en Fable.
- Corrige `/flota:instalar-politica`, que todavía decía que `flota:revisor-critico` usa Fable.

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
