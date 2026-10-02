# flota

Plugin privado de Claude Code. Trae un equipo de subagentes donde **cada rol corre en el modelo y
con el esfuerzo que mejor rinden para ese trabajo**. La asignación se recalibra con evidencia cada
vez que sale un modelo nuevo.

## Qué trae

| Agente | Para qué | Modelo |
|---|---|---|
| `flota:verificador` | Intentar refutar un hallazgo concreto, o decidir entre alternativas | Fable |
| `flota:revisor` | Buscar bugs reales (lógica, concurrencia, casos borde, contratos rotos) | Opus |
| `flota:revisor-critico` | Lo mismo, en zonas críticas: dinero, seguridad, permisos, datos personales | Fable |
| `flota:auditor` | Calidad, deuda técnica, UX/UI, accesibilidad, rendimiento (sin Bash) | Opus |
| `flota:auditor-producto` | Ideas de producto ancladas al objetivo del proyecto (con web) | Opus |
| `flota:investigador` | Investigar código, documentación o web; correr tests; traer evidencia | Sonnet |
| `flota:implementador` | Implementar con decisiones: una tarea de un plan, una feature, una integración | Opus |
| `flota:mecanico` | Cambios ya especificados al detalle más sus tests | Sonnet |
| `flota:explorador` | Buscar y localizar archivos, símbolos y callers | Haiku |

Todos corren en esfuerzo **xhigh**, salvo el explorador. La tabla completa, con el porqué de cada
decisión y las reglas de presupuesto, queda en tu `~/.claude/CLAUDE.md` al instalar.

Además:
- **`/flota:auditoria-integral`.** Revisa un proyecto entero con los modelos actuales: bugs que
  dejaron modelos anteriores, seguridad y dinero, tests, dependencias, operación, IA dentro del
  producto, calidad, UX e ideas de producto. Deja un informe priorizado en `docs/auditorias/` del
  proyecto. La versión rápida gasta ~2–5% de la semana; la completa pide OK antes.
- **Un hook** que impide abaratar un agente de flota en silencio. Si un skill o plugin lo lanza
  con un modelo más barato que el suyo, la llamada a la herramienta Agent se bloquea y se explica
  por qué.
- **`/flota:instalar-politica`.** Aplica lo que un plugin no puede fijar solo: la política en tu
  CLAUDE.md y tres ajustes de settings.json. Siempre muestra antes qué va a cambiar y deja respaldo.
- **Un aviso al abrir sesión** cuando hay una política nueva por instalar o tu CLI está vieja.

## Requisitos

- Plan **Max**. La política usa Fable en dos agentes y xhigh en todos; en Pro gastaría la semana
  muy rápido.
- La app de Claude para escritorio (se actualiza sola) o Claude Code en la terminal.
- Una cuenta de GitHub con acceso a este repo privado: acepta la invitación que te llega por correo.
- macOS con `python3`, `git` y `rsync`. Vienen con el sistema; si `python3 --version` te pide
  instalar las herramientas de desarrollo de Apple, acepta.

## Instalar

### Opción A (recomendada): desde la app, sin terminal

1. En la app de Claude (o en claude.ai), ve a **Customize → Plugins → Add → Add marketplace**.
2. Escribe `carlosisaacfaura/flota`.
3. Como el repo es privado, el diálogo te pide **Connect GitHub**. Conecta tu cuenta de GitHub, la
   misma que recibió la invitación. Si además pide instalar la **Claude GitHub App** en el repo,
   avísale al mantenedor: eso lo hace el dueño del repo una sola vez.
4. En la lista de plugins de ese marketplace, agrega **flota**.
5. En el marketplace, activa **Sync automatically**: así cada versión nueva te llega sola.
6. Abre una sesión en la pestaña **Code**. La primera vez puede que tengas que escribir
   `/reload-plugins` o abrir otra sesión para que cargue. Después escribe `/flota:instalar-politica`:
   te muestra qué va a agregar a tu `~/.claude/CLAUDE.md` y `settings.json` y lo aplica con tu OK.
   Abre una sesión nueva para que tome efecto.

Instalado así, el plugin queda en tu cuenta de Claude y aparece en Claude Code como `flota@synced`.

### Opción B: desde la terminal

Necesitas git autenticado con GitHub (`gh auth login` y después `gh auth setup-git`). Luego:

```bash
claude plugin marketplace add carlosisaacfaura/flota
```

```bash
claude plugin install flota@flota
```

Y en una sesión: `/flota:instalar-politica`.

## Actualizar

Cuando sale un modelo nuevo, el mantenedor recalibra y publica una versión.

- **Si instalaste desde la app:** llega sola si activaste **Sync automatically**. Si no, ve a
  Customize → Plugins y elige **Check for updates**.
- **Si instalaste desde la terminal:** los marketplaces de terceros no se actualizan solos por
  defecto. Actívalo en `/plugin` → Marketplaces → flota → Enable auto-update, o hazlo a mano:

  ```bash
  claude plugin marketplace update flota
  ```

  ```bash
  claude plugin update flota@flota
  ```

En los dos casos, al abrir la sesión siguiente el aviso de inicio te pide correr
`/flota:instalar-politica` para actualizar el bloque de la política. Qué cambió en cada versión:
`plugins/flota/CHANGELOG.md`.

## Usar

- **Delegación automática.** Claude elige al agente según la tabla de la política; no hace falta
  pedirlo.
- **Pedir un agente puntual:** "usa flota:revisor-critico para revisar el flujo de pagos".
- **Auditar un proyecto:** abre la sesión en su carpeta y escribe `/flota:auditoria-integral`, o
  pide "audita este proyecto a fondo" para la versión completa. La primera vez Claude Code pide
  aprobar el workflow `flota:auditar`; elige "no volver a preguntar". En modo de permisos auto,
  los comandos de los agentes no piden aprobación uno por uno.

## Desinstalar

En una sesión, `/flota:instalar-politica` y pide desinstalar: quita el bloque de la política y
solo los ajustes que agregó flota. Después quita el plugin:

- **Si lo instalaste desde la app:** Customize → Plugins → flota → menú → **Remove**.
- **Si lo instalaste desde la terminal:**

  ```bash
  claude plugin uninstall flota@flota
  ```

## Para el mantenedor

La fuente de verdad es la configuración personal del mantenedor. Tras cada recalibración:

1. Regenera el plugin. El script copia agentes, política, ajustes y las partes compartibles de la
   auditoría, y **aborta si detecta datos personales**:

   ```bash
   python3 mantenedor/sincronizar.py --version X.Y.Z
   ```

2. Escribe la entrada de la versión en `plugins/flota/CHANGELOG.md`.
3. Valida, commitea, pushea y taguea:

   ```bash
   claude plugin validate .
   ```

Para la instalación desde la app con el repo privado, la Claude GitHub App necesita acceso al
repo. Si un amigo ve "Install the Claude GitHub App", instálala tú como dueño (GitHub → Settings →
Applications, o el botón del propio diálogo) y dale acceso al repo `flota`.

El `SKILL.md` de la auditoría del plugin se mantiene a mano, porque el del mantenedor tiene
integraciones personales. Si cambia el del mantenedor, porta el cambio.
