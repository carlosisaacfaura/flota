# Formato del informe

Archivo: `<proyecto>/docs/auditorias/AAAA-MM-DD-auditoria-integral.md`, **≤150 líneas visibles**
(lo colapsado en `<details>` no cuenta). Junto a él, en la misma carpeta:
- `hallazgos.jsonl`: estado acumulado de hallazgos entre auditorías (lo escribe hallazgos.py).
- `mapa.json`: el mapa del proyecto, reutilizable si el código cambió <20%.
- `AAAA-MM-DD-tablas.md`: las tablas que generó hallazgos.py (se pegan en el informe y se puede borrar).
Nunca valores de secretos en ninguno de estos archivos.

## Escalas fijas

- Severidad: **alta** = pérdida de dinero, exposición de datos o caída en producción; **media** =
  comportamiento incorrecto en un caso real pero acotado; **baja** = deuda o mejora.
- Esfuerzo: **S** < 1 h · **M** < 1 día · **L** > 1 día.
- Estado: **REPRODUCIDO** (el agente lo ejecutó) · **CONFIRMADO** (el verificador no pudo
  refutarlo) · **PLAUSIBLE** (sin verificar; se dice así).
- AHORA = alta con S/M, o media con S en zona crítica (tope 7). PRÓXIMO = resto de alta y media
  S/M (tope 10). DESPUÉS = lo demás. Los topes son duros: el excedente baja un nivel.

## Plantilla

```markdown
# Auditoría integral · <Proyecto> · AAAA-MM-DD

> sha `<sha>` (o "sin git") · tipo <tipo> · profundidad <rápida|completa> · modelos: <reparto>
> cuota: ~<X>% estimado (<real si se midió>) · anterior: <enlace o "primera auditoría">
> Código vivo por modelo: <Opus 4.8 64% · Fable 5 31% · ...> (mapa de antigüedad por línea)

## Veredicto
<≤5 líneas: estado general en una frase; los 3 riesgos que más pesan; la oportunidad principal;
qué NO se pudo verificar (producción, servicios externos, navegador).>

## AHORA
<tabla de hallazgos.py: id | sev | esf | hallazgo | ruta | estado | arreglo>

## PRÓXIMO
<tabla de hallazgos.py>

## DESPUÉS
<details> de hallazgos.py, agrupado por dimensión </details>

## IA en el producto
<≤8 líneas: tabla corta de llamadas a LLM (ID actual → candidato, ¿harness?, costo por unidad).
Si no hay LLM: "sin IA en el producto" y, si aplica, 1 línea de oportunidad.>

## Ideas de producto
| idea | objetivo al que sirve | evidencia | valor | esf | veredicto |
Ya en plan (no cuentan): <lista corta>

## Delta vs auditoría anterior
<de hallazgos.py; omitir en la primera auditoría>

## Cobertura
- Auditado: <LOC> LOC de código en <n> archivos · excluido: <qué y por qué>
- Particiones: <P1 → revisor, C1 → revisor-critico, ...> · sin revisar: <particiones o archivos>
- Dimensiones apagadas: <cuáles y por qué (tipo, profundidad, costo)>
- No verificable: <producción, servicios externos, recorrido en navegador, tests que requieren servicios reales>

## Decisiones registradas (no son hallazgos)
<p. ej. "kill switch apagado por decisión (MAX_DAILY_LOSS_USD=0)"; la próxima auditoría no las re-reporta>

## Secretos e higiene
<solo rutas, tipo y si .gitignore los cubre; jamás valores. Sin git en producción = alta.>
```

## Registro

- Portafolio: una fila por auditoría en el registro que indique el SKILL.md:
  `| AAAA-MM-DD | <Proyecto> | <profundidad> | <modelos> | ~<X>% | <n alta abiertas> | <ruta> |`
- Si el usuario lleva notas por proyecto (su CLAUDE.md lo dice), agrega una sola línea en la nota:
  `- Auditoría integral AAAA-MM-DD (<profundidad>, <n> alta abiertas): <ruta al informe>`, sin tocar
  nada más de la nota.
