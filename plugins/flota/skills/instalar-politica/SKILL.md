---
name: instalar-politica
description: >-
  Instala, actualiza o quita la política de modelos de flota en la configuración del usuario.
  Agrega el bloque de la política a ~/.claude/CLAUDE.md y los ajustes que un plugin no puede fijar
  solo en ~/.claude/settings.json: el modelo por defecto de los subagentes sin tipo, el esfuerzo de
  Opus en la sesión principal y los modelos de respaldo. Úsalo al instalar flota, cuando el aviso de
  inicio de sesión diga que hay una política nueva o que falta terminar la instalación, después de
  `claude plugin update flota@flota`, o cuando el usuario pida instalar, actualizar, revisar o
  desinstalar la política de flota.
---

# Instalar la política de flota

Flota trae agentes con el modelo y el esfuerzo fijados en cada uno. Hay tres cosas que un plugin no
puede hacer solo, y este skill las hace con el OK del usuario:
- **La tabla de política en `~/.claude/CLAUDE.md`.** Así la sesión principal sabe qué agente usar
  para cada trabajo y con qué presupuesto.
- **`CLAUDE_CODE_SUBAGENT_MODEL`.** Es el modelo de los subagentes sin tipo: general-purpose y
  agentes de otros plugins que no fijan `model:`. Explore y Plan tienen su propio modelo y esta
  variable no los cambia.
- **`modelSettings` y `fallbackModel`.** Fijan el esfuerzo de Opus en la sesión principal y los
  modelos de respaldo.

`S="${CLAUDE_PLUGIN_ROOT}/skills/instalar-politica/scripts/aplicar.py"`

## Pasos

1. **Revisar sin tocar nada:** `python3 "$S" --revisar`.
2. **Explicarle al usuario en palabras simples** qué va a pasar:
   - Si el bloque de la política es nuevo o es una actualización. Si es una actualización, resume
     qué cambió usando la sección de esa versión en `${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md`.
   - Qué ajustes de settings.json se agregan.
   - Si hay **conflictos**: el usuario ya tenía otro valor. Esos no se pisan salvo que él lo pida.
   - Si aparece el aviso de `CLAUDE_CODE_EFFORT_LEVEL`, explícalo: esa variable anula el esfuerzo de
     todos los agentes. Recomienda quitarla, pero no la quites tú.
   - Si su CLAUDE.md ya tiene otras reglas de modelos, señálalas para que revise que no choquen.
3. **Pedir OK.** Con el OK, corre `python3 "$S" --aplicar`. Agrega `--forzar` solo si el usuario
   aceptó pisar los conflictos.
4. **Cerrar:**
   - Di dónde quedaron los respaldos.
   - Los cambios se leen al abrir una sesión nueva.
   - Se recomienda Opus como modelo de la sesión principal (en el selector de modelo).

**Desinstalar:** `python3 "$S" --desinstalar` quita el bloque y solo los ajustes que agregó flota,
si siguen con el mismo valor. Después, el plugin se quita con `claude plugin uninstall flota@flota`.

## Requisitos que conviene confirmar

- **Plan Max.** La política usa Fable en `flota:verificador` y `flota:revisor-critico`, y xhigh en
  todos los agentes. En Pro, Fable se cobra aparte con créditos y la cuota semanal es mucho menor:
  si el usuario no tiene Max, adviérteselo antes de aplicar.
- **CLI de Claude Code igual o posterior a la `cli_minima` de `ajustes.json`.** Con una más vieja,
  los alias (`opus`, `sonnet`) pueden apuntar a modelos anteriores. Se actualiza con
  `claude update`. La app de escritorio trae su propia CLI y se actualiza sola.
