# flota

**Un equipo de subagentes para Claude Code donde cada rol corre en el modelo y con el esfuerzo
que mejor rinden para ese trabajo.** La asignación se recalibra con evidencia cada vez que sale un
modelo nuevo. Incluye además una auditoría integral de proyectos.

Hecho y mantenido por [Carlos Isaac](https://github.com/carlosisaacfaura).

> **In English:** flota is a Claude Code plugin (in Spanish) that ships nine typed subagents, each
> pinned to the Claude model and effort level that performs best for its role, plus a
> whole-project audit workflow. The model assignment is recalibrated with evidence on every model
> release. Requires a Max plan.

## Qué trae

| Agente | Para qué | Modelo |
|---|---|---|
| `flota:verificador` | Intentar refutar un hallazgo concreto, o decidir entre alternativas | Fable |
| `flota:revisor` | Buscar bugs reales (lógica, concurrencia, casos borde, contratos rotos) | Opus |
| `flota:revisor-critico` | Lo mismo, en zonas críticas: dinero, seguridad, permisos, datos personales | Fable |
| `flota:auditor` | Calidad, deuda técnica, UX/UI, accesibilidad, rendimiento (sin Bash) | Opus |
| `flota:auditor-producto` | Ideas de producto ancladas al objetivo del proyecto (con web) | Opus |
| `flota:implementador` | Implementar con decisiones: una tarea de un plan, una feature, una integración | Opus |
| `flota:investigador` | Investigar código, documentación o web; correr tests; traer evidencia | Sonnet |
| `flota:mecanico` | Cambios ya especificados al detalle más sus tests | Sonnet |
| `flota:explorador` | Buscar y localizar archivos, símbolos y callers | Haiku |

Todos corren en esfuerzo **xhigh**, salvo el explorador. La tabla completa, con el porqué de cada
decisión y las reglas de presupuesto, queda en tu `~/.claude/CLAUDE.md` al instalar la política.

Además:
- **`/flota:auditoria-integral`.** Revisa un proyecto entero con los modelos actuales: bugs que
  dejaron modelos anteriores, seguridad y dinero, tests, dependencias, operación, IA dentro del
  producto, calidad, UX e ideas de producto. Deja un informe priorizado en `docs/auditorias/` del
  proyecto. La versión rápida gasta ~2–5% de la semana de un plan Max; la completa pide OK antes.
- **`/flota:instalar-politica`.** Aplica lo que un plugin no puede fijar solo: la política en tu
  CLAUDE.md y tres ajustes de settings.json. Siempre muestra antes qué va a cambiar y deja respaldo.
- **Un hook** que impide abaratar un agente de flota en silencio. Si un skill o plugin lo lanza
  con un modelo más barato que el suyo, la llamada se bloquea y se explica por qué.
- **Un aviso al abrir sesión** cuando hay una política nueva por instalar o tu CLI está vieja.

## Requisitos

- Plan **Max** de Claude. La política usa Fable en dos agentes y xhigh en todos; en Pro gastaría
  la semana muy rápido, y Fable se cobra aparte.
- La app de Claude para escritorio o Claude Code en la terminal, actualizados.
- macOS con `python3`, `git` y `rsync`. Vienen con el sistema; si `python3 --version` te pide
  instalar las herramientas de desarrollo de Apple, acepta.

## Instalar

### Desde la app (recomendado)

1. En la app de Claude o en claude.ai: **Customize → Plugins → Add → Add marketplace**.
2. Escribe `carlosisaacfaura/flota`.
3. Agrega el plugin **flota**.
4. En el marketplace, activa **Sync automatically** para que las versiones nuevas te lleguen solas.
5. Abre una sesión en la pestaña **Code** (si no carga, escribe `/reload-plugins`) y corre
   `/flota:instalar-politica`. Te muestra qué va a cambiar y lo aplica con tu OK. Abre una sesión
   nueva para que tome efecto.

### Desde la terminal

```bash
claude plugin marketplace add carlosisaacfaura/flota
```

```bash
claude plugin install flota@flota
```

Después, en una sesión: `/flota:instalar-politica`.

## Usar

Tres ejemplos:

- **Auditar un proyecto.** Abre la sesión en su carpeta y escribe `/flota:auditoria-integral`.
  Para la versión completa: "audita este proyecto a fondo".
- **Revisar una zona delicada.** "Usa flota:revisor-critico para revisar el flujo de pagos de
  punta a punta."
- **Ejecutar un plan.** "Implementa la tarea 3 del plan con flota:implementador y después
  revísala con flota:revisor."

Sin pedir nada, Claude delega según la tabla de la política: lo mecánico a Sonnet, lo que exige
criterio a Opus y lo crítico a Fable.

La primera vez que corras la auditoría, Claude Code pide aprobar el workflow `flota:auditar`;
elige "no volver a preguntar". En modo de permisos auto, los comandos de los agentes no piden
aprobación uno por uno.

## Qué ejecuta y qué modifica en tu equipo

Todo es código legible que puedes revisar en este repo. Nada se envía al autor.

- **Dos hooks, que corren scripts locales de Python:**
  - Al abrir sesión, `hooks/aviso-flota.py` lee tu `~/.claude/CLAUDE.md`, tu `settings.json` y
    los nombres de las carpetas de versiones de la CLI. Solo muestra un aviso; no escribe nada.
  - Antes de lanzar un subagente, `hooks/no-bajar-modelo.py` lee el modelo del agente y puede
    bloquear la llamada si le bajan el modelo. No escribe nada.
- **`/flota:instalar-politica` (solo cuando tú lo corres y das el OK):**
  - Agrega un bloque marcado en `~/.claude/CLAUDE.md`. Lo que está fuera del bloque no se toca.
  - Agrega tres ajustes en `~/.claude/settings.json`: `env.CLAUDE_CODE_SUBAGENT_MODEL`,
    `modelSettings` y `fallbackModel`. Si ya tienes otro valor, no lo pisa sin preguntarte.
  - Deja respaldos en `~/.claude/flota/respaldos/` y anota qué agregó, para poder deshacerlo.
  - No cambia permisos ni reglas de seguridad de Claude.
- **`/flota:auditoria-integral`:**
  - Lee el proyecto que le indiques. Nunca abre `.env`, llaves ni tokens.
  - Crea una copia temporal sin secretos ni bases de datos, y corre ahí los tests y las
    herramientas que ya tengas instaladas.
  - Lee el historial de git para saber qué modelo escribió cada línea. Ese historial incluye
    nombres y correos de quienes hicieron commits; flota no los guarda ni los envía. También puede
    encontrar datos personales que estén en tu código, y tampoco los guarda.
  - Escribe el informe en `docs/auditorias/` de tu proyecto y un registro en `~/.claude/flota/`.
    No hace commit, push ni deploy.

### Servicios externos que contacta

flota no tiene servidor ni conectores. Lo único que sale de tu equipo ocurre durante una
auditoría, y va a servicios de terceros, nunca al autor:

| Qué | A dónde | Qué se envía |
|---|---|---|
| `npm audit` y `npm outdated` | Registro de npm | Nombres y versiones de las dependencias de tu proyecto |
| `pip-audit`, si lo tienes instalado | PyPI y la base de avisos de Python | Nombres y versiones de tus dependencias |
| `osv-scanner`, si lo tienes instalado | OSV (osv.dev) | Nombres y versiones de tus dependencias |
| Búsqueda y lectura web de Claude | Sitios de documentación oficial | Consultas sobre modelos, precios y frameworks |
| Búsqueda web de Claude, solo en la auditoría completa y si la aceptas | Sitios públicos | Consultas para encontrar productos comparables al tuyo |

flota no instala ninguna de esas herramientas: solo usa las que ya tienes.

## Actualizar

Cada vez que sale un modelo nuevo se publica una versión recalibrada. Qué cambió en cada una:
[CHANGELOG.md](CHANGELOG.md).

- **Si instalaste desde la app:** llega sola con **Sync automatically**. Si no lo activaste, usa
  **Check for updates** en Customize → Plugins.
- **Si instalaste desde la terminal:**

  ```bash
  claude plugin marketplace update flota
  ```

  ```bash
  claude plugin update flota@flota
  ```

En los dos casos, el aviso de inicio te pide correr `/flota:instalar-politica` para actualizar el
bloque de la política.

## Desinstalar

En una sesión, corre `/flota:instalar-politica` y pide desinstalar: quita el bloque de la política
y solo los ajustes que agregó flota, y restaura los valores que tenías. Después quita el plugin:

- **Desde la app:** Customize → Plugins → flota → menú → **Remove**.
- **Desde la terminal:**

  ```bash
  claude plugin uninstall flota@flota
  ```

## Cómo se decide qué modelo va en cada rol

La asignación no es una opinión. Cada lanzamiento de modelo se evalúa con benchmarks públicos
verificados contra su fuente y con pruebas propias a ciegas en código real: bugs plantados, tareas
con tests ocultos y medición del consumo. Lo que no tiene evidencia suficiente se declara como
pendiente en el CHANGELOG en vez de asumirse.

## Soporte, privacidad y licencia

- **Problemas o ideas:** abre un [issue](https://github.com/carlosisaacfaura/flota/issues).
- **Privacidad:** flota no recopila ni envía datos. Detalle en la
  [política de privacidad (Privacy Policy)](https://github.com/carlosisaacfaura/flota/blob/main/PRIVACY.md).
- **Licencia:** [MIT](LICENSE). Puedes usarlo, copiarlo y modificarlo conservando la autoría. Se
  entrega sin garantía.
