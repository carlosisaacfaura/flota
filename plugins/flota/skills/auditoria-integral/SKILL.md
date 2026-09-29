---
name: auditoria-integral
description: >-
  Auditoría integral de UN proyecto completo con los modelos actuales: bugs y errores que dejaron
  modelos anteriores, seguridad y dinero, tests, dependencias, operación (backups, alertas,
  defaults peligrosos), IA dentro del producto (IDs de modelo viejos, costo, harness), privacidad,
  calidad, UX/UI e ideas de producto ancladas al objetivo del proyecto. Deja un informe priorizado
  (AHORA / PRÓXIMO / DESPUÉS) en docs/auditorias/ del proyecto y compara contra la auditoría
  anterior. Úsalo cuando el usuario pida revisar, auditar o "poner al día" un proyecto
  entero, buscar lo que dejó un modelo viejo (Opus 4.x, Fable 5), una revisión integral, ideas
  para mejorar un producto existente, re-auditar tras un modelo nuevo, o invoque
  /flota:auditoria-integral. NO es para revisar un diff o un PR, ni para un escaneo de seguridad
  exhaustivo (eso es una herramienta dedicada, p. ej. el plugin claude-security).
---

# Auditoría integral de un proyecto

Los proyectos hechos con modelos anteriores acumulan bugs sutiles, dependencias atrasadas, IDs de
modelo viejos en el producto y oportunidades que hoy son baratas. Este skill los revisa con los
modelos actuales, pero con criterio de costo: barrido barato, juicio caro solo donde importa.

Principios:
- **Por tipo de proyecto.** Un bot de trading no necesita UX ni SEO; un SaaS sí. La matriz está en
  `references/tipos.md`.
- **Lo más viejo primero, nunca solo lo viejo.** El mapa de antigüedad ordena el trabajo; no
  excluye nada.
- **Nada llega al informe sin evidencia.** Cada hallazgo trae ruta:línea y escenario. Los altos
  dudosos pasan por el verificador (Fable), con tope.
- **Solo lectura.** Los agentes leen el proyecto y ejecutan cosas solo en una copia sin secretos.
  Arreglar es una fase aparte, con OK por hallazgo.
- **Comparable en el tiempo.** Cada hallazgo tiene un ID estable. La próxima auditoría dice qué
  persiste, qué cambió y qué es nuevo.

Archivos (en `${CLAUDE_PLUGIN_ROOT}/skills/auditoria-integral/`):
- `scripts/alcance.py`: alcance real (sin builds ni respaldos), particiones, tipo sugerido,
  IA en el producto, secretos en disco (solo rutas).
- `scripts/mapa-antiguedad.py`: qué modelo escribió cada línea viva (git blame).
- `scripts/copia-segura.sh`: copia sin .git, sin secretos y sin datos, para correr tests.
- `scripts/plan.py`: dimensiones encendidas, agentes y % de cuota estimado.
- `${CLAUDE_PLUGIN_ROOT}/workflows/auditar.js` (el workflow `flota:auditar`): mapa → dimensiones
  en paralelo → verificación acotada. Trae las checklists y los riesgos por tipo incrustados.
- `scripts/hallazgos.py`: IDs estables, dedupe, AHORA/PRÓXIMO/DESPUÉS, delta, decisiones.
- `references/tipos.md`, `references/checklists.md`, `references/formato-informe.md`.
- `~/.claude/flota/historial-costos.md` y `~/.claude/flota/auditorias.md`: consumo real y registro
  de auditorías del usuario. Viven fuera del plugin para que una actualización no los borre.

## Reglas que no se negocian

- Nunca abrir `.env*`, sesiones, tokens ni llaves, ni pegar valores de secretos en ningún archivo.
  Los secretos se reportan por ruta.
- Nunca ejecutar la app, el bot ni nada bajo `scripts/`, `tools/`, `ea/` o `bin/` del proyecto,
  ni CLIs de Railway, Vercel, Supabase u otros proveedores. Algunos proyectos mueven dinero real
  (bots de trading en vivo, cobros). Los tests corren solo en la copia segura.
- Nunca `git commit`, `push` ni deploy sin pedido explícito. El informe queda sin versionar y el
  usuario decide.
- Una auditoría completa por día como máximo, y nunca dos proyectos en paralelo.
- No bajar el modelo de ningún agente de flota; para abaratar se apagan dimensiones.

## Paso 0 — Preparación (sin cuota)

1. **Proyecto y contexto del dueño.** Resuelve la ruta absoluta; por defecto es la carpeta de la
   sesión. Si el CLAUDE.md del usuario define un sistema de notas por proyecto (p. ej. un vault de
   Obsidian), lee la nota del proyecto. Si no, usa el README, el CLAUDE.md y los docs de roadmap
   del repo. Extrae, en pocas líneas cada uno:
   - Objetivo.
   - Próximos pasos.
   - Decisiones clave.
   - Stack.
   Esto es la variable `nota`.
2. **Carpeta de trabajo** fuera del proyecto: `T=<scratchpad>/auditoria-<proyecto>-<AAAA-MM-DD>`.
   Si no hay scratchpad, usa `mktemp -d`.
3. Corre, en este orden:
   ```bash
   S="${CLAUDE_PLUGIN_ROOT}/skills/auditoria-integral/scripts"
   python3 $S/alcance.py "$P" --json "$T/alcance.json"
   python3 $S/mapa-antiguedad.py "$P" --alcance "$T/alcance.json" --json "$T/antiguedad.json"
   python3 $S/hallazgos.py previos --proyecto "$P" > "$T/previos.json"
   bash $S/copia-segura.sh "$P" "$T/copia"
   ```
   Lee la salida de `alcance.py`:
   - Si el proyecto está en producción y no tiene git, ese es un hallazgo alta automático.
   - Anota los secretos en disco (solo rutas).
   - Anota los `CLAUDE-SECURITY-*` incompletos.
4. **Mapa previo.** Si existe `docs/auditorias/mapa.json`, se puede reutilizar cuando el código
   cambió menos del 20% desde su sha. Mídelo con
   `git -C "$P" diff --shortstat <sha_del_mapa> HEAD` contra `loc_codigo`. Si se reutiliza, ahorras
   la Fase Mapa; pásalo como `mapa_previo`.

## Paso 1 — Tipo, profundidad y costo

1. **Tipo.** Confirma el sugerido por `alcance.py` con el stack de la nota. Tipos posibles:
   - saas-web
   - bot-trading
   - investigacion-trading
   - bot-mensajeria
   - landing
   - herramienta-personal

   Si hay duda razonable, pregunta en una línea.
2. **Profundidad.** Por defecto es `rapida`. Usa `completa` si el usuario pide "a fondo",
   "completa" o "integral de verdad", o si es un producto con clientes y nunca se auditó.
3. Planifica:
   `python3 $S/plan.py "$T/alcance.json" <tipo> <profundidad> --json "$T/plan.json"`.
   Opciones de `plan.py`:
   - `--forzar ux,producto` y `--apagar ...`: si el usuario lo pidió.
   - `--mapa-previo`: si se reutiliza el mapa.
   - `--vendido`: si el producto se vende a terceros.
4. Lee la cuota actual: en la app de escritorio, con la herramienta de uso del plan
   (`get_usage`: semana, ventana de 5 h y tope de Fable). Si no está disponible, pídele al usuario
   el % semanal que muestra `/usage`, o sáltate la medición. Anota el % semanal: es el "antes".
5. **OK del usuario:**
   - **Rápida** (≤10%, normalmente 3–5%): no pide OK. Di en una línea qué se va a revisar, el %
     estimado y que lo reportarás, y lanza.
   - **Completa**: SIEMPRE pide OK. Muestra el reparto de agentes, el % estimado y la cuota
     actual. Si la ventana de 5 h está sobre ~70%, sugiere esperar. En el mismo mensaje ofrece
     dos cosas opcionales:
     - **Foto de producción.** Solo NOMBRES de las variables definidas en Railway, Vercel o el
       VPS, la versión desplegada y la rama que despliega. Nunca valores. Sin foto, lo que
       depende de producción queda como "no verificable".
     - **Búsqueda de competidores en la web** para la dimensión producto. Va encendida por
       defecto en completa, para saas-web y landing.

## Paso 2 — Lanzar el workflow

Los agentes son los de flota (`flota:revisor`, `flota:revisor-critico`, `flota:investigador`,
`flota:auditor`, `flota:auditor-producto`, `flota:verificador`). El workflow les antepone el prefijo
con `prefijo_agentes: "flota:"`. Se lanza por nombre, así que la primera vez Claude Code pide
aprobarlo y ofrece "no volver a preguntar". Los agentes corren comandos (tests, `npm audit`) en la
copia segura: en modo de permisos manual cada comando pide aprobación, y en modo auto los aprueba
el clasificador.

```
Workflow({ name: "flota:auditar",
  args: { proyecto, copia: "$T/copia", fecha, tipo, profundidad,
          dims: plan.dims, tope_verificacion: plan.tope_verificacion,
          alcance: <alcance.json>, orden_prioridad: <antiguedad.json>.orden_prioridad,
          nota, no_reportar: <previos.json>.no_reportar, foto_produccion (o null),
          mapa_previo (o null), web_producto, vendido, prefijo_agentes: "flota:" } })
```

Si Claude Code no encuentra el workflow `flota:auditar`, lánzalo por ruta con
`Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/auditar.js", args })`. Puede pedir permiso
para leer esa carpeta: acéptalo, o agrégala con `/add-dir`.

Corre en segundo plano y avisa al terminar. No hagas polling. Si falla a mitad, reanúdalo con
`resumeFromRunId`, en la misma sesión: los agentes que terminaron antes del que falló devuelven su
resultado guardado, pero el que falló y los que empezaron después vuelven a correr (y a cobrarse).

## Paso 3 — Consolidar (sin cuota)

1. Crea la carpeta `docs/auditorias/` en el proyecto. La salida completa del workflow está en el
   `output-file` de la notificación: es un JSON y el resultado va en la clave `result` (el texto
   de la notificación viene truncado). Con Python, sin reescribirla a mano:
   - `$T/resultado.json` = `result`.
   - `$T/crudo.json` = `{hallazgos, cobertura}` del resultado.
   - `docs/auditorias/mapa.json` = `{sha, fecha, mapa}`.
   Si algo parece vacío, lee el `journal.jsonl` del directorio del workflow antes de concluir nada.
2. **Control de calidad propio**, barato y rápido: por cada hallazgo alta que quedó PLAUSIBLE, lee
   las líneas citadas.
   - Si es evidentemente falso (la defensa está a la vista), cámbialo a `REFUTADO` en crudo.json.
   - Si la severidad está inflada, bájala.
   - No inventes hallazgos nuevos: si ves algo, anótalo como PLAUSIBLE y di que lo vio la sesión
     principal.
3. Consolida:
   ```bash
   python3 $S/hallazgos.py consolidar --entrada "$T/crudo.json" --proyecto "$P" --fecha <AAAA-MM-DD> \
     --sha "<git.sha de alcance.json o sin-git>" --alcance "$T/alcance.json" --antiguedad "$T/antiguedad.json"
   ```
   Genera las tablas AHORA / PRÓXIMO / DESPUÉS, el delta y la cobertura, y actualiza
   `hallazgos.jsonl`.
4. **Juzga las ideas de producto** tú mismo, sin agente extra. Para cada idea evalúa:
   - ¿sirve al objetivo de la nota?
   - ¿la evidencia es real (flujo, URL, archivo)?
   - ¿ya estaba en el plan?
   - ¿el valor justifica el esfuerzo?

   El veredicto es `vale` / `dudosa` / `descartar`, con una razón.

## Paso 4 — Informe y registro

1. Escribe `docs/auditorias/AAAA-MM-DD-auditoria-integral.md` siguiendo
   `references/formato-informe.md`, con un máximo de 150 líneas visibles.
   - Pega las tablas de hallazgos.py.
   - Usa `tablas.ia`, `tablas.tests` y `tablas.operacion` del resultado.
   - La sección **Cobertura** es obligatoria: particiones revisadas y no revisadas, dimensiones
     apagadas, `no_verificable` y `errores` del workflow.
   - Borra `AAAA-MM-DD-tablas.md` después de pegarlo.
2. **Consumo real.** Vuelve a leer `get_usage`. Anota en el informe el estimado y el medido
   (después − antes). Agrega una fila a `~/.claude/flota/historial-costos.md`. Si no existe, créalo
   con el encabezado
   `| fecha | proyecto | tipo | profundidad | agentes | estimado % | medido % | notas |`. Si el medido
   se desvía mucho del estimado, avísale al mantenedor de flota: es el dato con que se recalibra
   `plan.py`.
3. **Registro.**
   - Agrega una fila en `~/.claude/flota/auditorias.md` con el formato de la sección "Registro" de
     formato-informe.md. Crea el archivo con su encabezado si no existe.
   - Si el usuario lleva notas por proyecto, agrega una sola línea en la nota del proyecto, sin
     tocar nada más.
4. Borra la copia segura: `rm -rf "$T/copia"`. Es tuya, no del usuario.

## Paso 5 — Entregar al usuario

En el chat, corto:
1. El veredicto.
2. La lista AHORA: id y una línea cada uno. Los que son dinero, seguridad o datos van primero y
   marcados.
3. El consumo real y la ruta del informe.
4. Recuerda que los archivos de `docs/auditorias/` quedaron sin versionar. Contienen detalles de
   vulnerabilidades: el usuario decide si commitearlos.

Ofrece, sin lanzar nada:
- **Arreglar** hallazgos concretos (Paso 6).
- **Descartar** los que no apliquen:
  `hallazgos.py marcar --proyecto P --id <id> --estado descartado --motivo "..."`. Así la próxima
  auditoría no los repite.
- **Recorrido con navegador** (UX real), si hay una URL de preview o staging. Se hace con acciones
  de solo lectura: no envía formularios.
- Un escaneo de seguridad dedicado (p. ej. el plugin claude-security), si la seguridad es la pregunta
  principal. Es caro (15–30% de la semana) y lo lanza el usuario.

## Paso 6 — Arreglos (opcional, solo con OK por hallazgo)

1. Verifica el estado del repo:
   - Si `git status` no está limpio, pregunta antes de seguir. No uses `stash` sin permiso.
   - Si no hay git, el primer y único arreglo es `git init` más un `.gitignore` que cubra los
     secretos, con OK.
2. Crea la rama `auditoria/AAAA-MM-DD`. Nunca trabajes en main.
3. Por cada hallazgo aprobado, la sesión principal escribe la spec: archivo, cambio exacto y el
   test que lo prueba.
4. `flota:mecanico` aplica la spec y corre los tests.
5. Si el hallazgo es de zona crítica, `flota:revisor-critico` revisa el diff antes de dar el arreglo
   por bueno.
6. Deja los cambios sin commitear para que el usuario los revise, salvo que pida commit.
   Nunca push ni deploy.

**Prohibido en esta fase, aunque parezca un quick win:**
- Cambiar parámetros de riesgo o defaults de trading.
- Cambiar el ID de modelo de la IA del producto sin un harness de regresión.
- Tocar migraciones ya aplicadas en producción.

Al terminar:
- Marca los arreglados:
  `hallazgos.py marcar --proyecto P --id <id> --estado resuelto --motivo "rama auditoria/..."`.
- Si el usuario lleva notas por proyecto, actualiza el estado en la nota.

## Re-auditar tras un modelo nuevo

Cuando una versión nueva de flota adopta un modelo nuevo (lo dice `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md`),
conviene re-auditar los proyectos activos cuya última fila en `~/.claude/flota/auditorias.md` es
anterior a esa versión. Sugiérelos como una lista de una línea, en rápida por defecto, y nunca los
lances solos.
