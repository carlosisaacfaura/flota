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
- **Datos personales.** La auditoría lee el historial de git de tu proyecto, que incluye nombres
  y correos de quienes hicieron commits, y puede encontrar datos personales que estén en tu
  código. flota no los guarda ni los envía a ninguna parte.
- **Servicios de terceros.** Durante una auditoría, las herramientas que ya tienes instaladas
  contactan a su propio servicio con los nombres y versiones de tus dependencias: `npm audit` y
  `npm outdated` al registro de npm, `pip-audit` a PyPI y `osv-scanner` a OSV. Los agentes usan
  la búsqueda web de tu Claude para consultar documentación oficial y, solo en la auditoría
  completa y si la aceptas, para buscar productos comparables. La lista completa está en la
  sección "Servicios externos que contacta" del [README](README.md).

## Contacto

Dudas o reportes de seguridad: abre un issue en
https://github.com/carlosisaacfaura/flota/issues

---

**English summary:** flota collects, stores and transmits no personal or usage data. It has no
telemetry and no server; everything runs locally inside your own Claude Code session under your
own Claude account. See the README section "Qué ejecuta y qué modifica en tu equipo" for exactly
what it reads and writes, and "Servicios externos que contacta" for the third-party services
contacted during an audit (npm registry, PyPI, OSV, web search).
