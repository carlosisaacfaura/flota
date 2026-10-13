# Política de privacidad de flota

Última actualización: 13 de octubre de 2026.

**flota no recopila, almacena ni envía datos personales ni de uso.** No tiene telemetría, no
tiene servidor propio y su autor no recibe ninguna información de quienes lo instalan.

## Qué pasa con tus datos

- **Todo corre en tu equipo.** Los agentes, los hooks y los scripts de flota se ejecutan dentro
  de tu Claude Code. Tu código y tus conversaciones se procesan con tu propia cuenta de Claude,
  bajo los términos y la política de privacidad de Anthropic.
- **Qué lee y qué escribe** está detallado en la sección "Qué ejecuta y qué modifica en tu equipo"
  del [README](README.md): tu `CLAUDE.md` y `settings.json` de Claude (solo con tu aprobación),
  el proyecto que le pidas auditar, y sus propios registros en `~/.claude/flota/`.
- **Secretos.** La auditoría no abre archivos `.env`, llaves, tokens ni credenciales, y nunca
  escribe sus valores en un informe.
- **Servicios de terceros que tú ya usas.** Si la auditoría corre `npm audit` u otra herramienta
  instalada en tu equipo, esa herramienta contacta a su propio servicio (por ejemplo, el registro
  de npm) como lo hace siempre. Si un agente consulta documentación en la web, lo hace con las
  herramientas de búsqueda de tu Claude.

## Contacto

Dudas o reportes de seguridad: abre un issue en
https://github.com/carlosisaacfaura/flota/issues

---

**English summary:** flota collects, stores and transmits no personal or usage data. It has no
telemetry and no server; everything runs locally inside your own Claude Code session under your
own Claude account. See the README section "Qué ejecuta y qué modifica en tu equipo" for exactly
what it reads and writes.
