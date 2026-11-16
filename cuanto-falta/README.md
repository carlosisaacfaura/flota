# cuanto-falta

Muestra los subagentes y workflows que corren en la sesión, cuánto le falta a cada uno (un rango, con su confianza) y en qué está. Nunca bloquea nada: solo dibuja la banda y el panel y responde `/cuanto-falta`; todo lo demás pasa intacto.

## Qué muestra

Una línea sobre el prompt ("el último termina en 10–20 min") y el panel «Cuánto falta». El panel se abre solo cuando corre algo, o con `/cuanto-falta`. Si lo cierras, no se vuelve a abrir solo en esa sesión; tampoco se abre solo en una terminal sin pantalla completa.

Por cada agente:

- **Rol y modelo**: "implementador", "Opus 5.5". En un rol genérico (agente de workflow, general-purpose), la descripción hace de nombre.
- **En qué está**: arrancando, leyendo el código, buscando en la web, editando, corriendo pruebas, probando en pantalla, haciendo commit, esperando a su subagente o escribiendo el informe (`TEXTO_FASE` en `hooks/contrato.ts`).
- **Lo que falta**: un rango en minutos, en una franja sobre un eje común que parte en «ahora».
- **Cuánto lleva**, y desde cuándo está en su fase si ya lleva un rato. Si el mod lo encontró ya corriendo, dice «lleva más de».
- **Su lista de pasos**, si la lleva ("3 de 5 pasos" y el paso actual).
- **«calculando»** cuando no hay datos para ese rol; **«ya pasó lo típico (~25 min)»** cuando va más lento que casi todas las corridas parecidas.

Arriba van el total ("todo termina en"), el estado de la sesión principal y el gasto de la tarea. Cada workflow muestra cuántos agentes lleva listos; uno que corre en la nube dice que su avance no se ve desde aquí.

## Cómo estima

Detalle y números en `herramientas/EVALUACION.md`.

Las tablas que trae (`hooks/tablas.ts`) salen de las corridas reales del mantenedor: sirven de punto de partida. Con `node herramientas/tablas.mjs` se regeneran con las tuyas (ver «Regenerar las tablas»). Los agentes de un plugin («flota:implementador») usan las tablas de su rol sin el prefijo.

- **Historial por rol y modelo**: toma las corridas pasadas del mismo rol y modelo que duraron al menos lo que este lleva, y mira cuánto les faltaba entonces (cuantiles 10, 50 y 90). Las corridas recientes pesan más.
- **Lo que lleva hecho**: separa esas corridas por las llamadas hechas sobre las típicas del rol y por si ya editó, probó o hizo commit. Con pocas muestras retrocede a un grupo más grande.
- **Fase**: las fases salen de `hooks/fase.ts`, que clasifica cada llamada a herramienta (también cada comando Bash).
- **Informe**: si ya escribe el informe final, usa una tabla aparte, según cuánto lleva escribiéndolo. `StructuredOutput`, `SubagentHandback` y `ReportFindings` cuentan como informe.
- **Reanudaciones**: un agente que se reanuda usa tablas propias; si su rol tiene pocas, las de todos los roles (y la confianza queda baja).
- **Silencio**: pasada la duración típica, un rato sin usar herramientas suele ser el cierre. Tiene tabla propia para el investigador (desde 0,3 min de silencio), el revisor (0,3) y el verificador (1).
- **Lista de pasos**: si el agente lleva una con al menos un paso hecho, el centro se acerca al ritmo que lleva (pesa a lo más la mitad). Está soportada pero no validada: los subagentes casi no la usan.
- **Rango**: el extremo bajo se ensancha, porque casi todos los fallos eran agentes que terminaban antes de lo bajo. El alto queda en el p90. La confianza (alta, media o baja) depende de cuántas corridas hay y de qué tan angosto es el rango; un agente encontrado ya corriendo baja un escalón.
- **«calculando»**: un rol con menos de 20 corridas, o con pocas a esa altura de la corrida. **«pasado»**: menos del 3% de las corridas del rol duró tanto. Nunca un número inventado.

Medido el 16-nov-2026 con 5.310 corridas reales de las tablas. Entrenamiento hasta el 8-nov; prueba con 443 corridas del 9 al 16-nov, 57 de ellas reanudaciones. La evaluación toma una foto cada 30 s. Filas «todos», 0.2 contra 0.1.0:

| Rol | Método | Corridas | Error mediano (min), 1º / 2º / 3º tercio [IC 95%] | Error en comunes | Cobertura, 1º / 2º / 3º tercio [IC 95%] | Pasado |
|---|---|---|---|---|---|---|
| **todos** | **0.2** | 443 | **4,7** (4,1–5,6) / **3,7** (3,4–4,2) / **3,4** (3,0–3,8) | 4,8 / 3,8 / 4,1 | **80%** (76–83) / **85%** (82–88) / **81%** (79–85) | 1% |
| todos | 0.1.0 con historial | 443 | 6,7 (5,9–7,7) / 5,0 (4,4–6,0) / 2,6 (2,2–2,9) | 7,0 / 6,1 / 3,4 | 36% (32–40) / 38% (34–42) / 43% (38–47) | 8% |
| todos | 0.1.0 tal cual | 443 | 7,9 (7,3–8,7) / 6,6 (6,1–7,6) / 3,5 (2,9–4,7) | 8,0 / 6,7 / 3,6 | 33% (30–37) / 33% (29–38) / 39% (33–44) | 20% |

Cómo leer el titular: solo con encargos (sin las reanudaciones), la 0.2 gana el primer tercio en error (4,5 contra 5,7 min, con los intervalos cruzados), casi empata el segundo (3,9 contra 4,2) y pierde el último (3,3 contra 2,1). Gana en cobertura en los tres (80% / 85% / 82% contra 40% / 42% / 48%), con un rango un 53% más ancho (15,6 contra 10,2 min). Buena parte de la ventaja de error del total viene de las reanudaciones, donde la 0.1.0 daba la duración de un encargo nuevo.

## Cómo se mide solo

El mod revisa cada 10 s y guarda una foto de cada estimación: una por minuto de corrida hasta la hora, y después cada 5 min. Al terminar cada agente, compara esas fotos con lo que de verdad faltaba.

- Mide encargos y también reanudaciones (marcadas `reanudacion: true`).
- Solo mide agentes que vio desde que arrancaron y que terminaron con su respuesta, en corridas de 15 s a 6 h.
- Solo cuentan las fotos donde dio un rango (no «calculando» ni «pasado»).

`/cuanto-falta datos` muestra el error y la cobertura por rol, y lo que corre ahora.

Los datos crudos quedan en `~/.claude/cuanto-falta/`:

- `mediciones/<id de sesión>.jsonl`: una línea por agente terminado, un archivo por sesión (las últimas 300 en cada uno). La precisión y `/cuanto-falta datos` juntan los archivos al leer.
- `en-curso/<id de sesión>.json`: lo que corre ahora y su estimación, un archivo por sesión. En reposo queda con `agentes: []`.

Solo llevan sesión, id del agente, rol, modelo, tiempos, fases, cifras y el motivo de la estimación: nunca descripciones, prompts ni títulos de pasos.

## Regenerar las tablas

Desde la carpeta del mod:

```
node herramientas/tablas.mjs     # relee los transcripts de ~/.claude/projects y regenera hooks/tablas.ts (unos 35 s, determinista)
node herramientas/evaluar.mjs    # vuelve a medir (holdout 9–16 nov)
```

`evaluar.mjs` usa la caché `datos/corridas.jsonl` (ignorada por git). Si cambias `hooks/fase.ts`, refréscala con `node herramientas/dataset.mjs` o corre `node herramientas/evaluar.mjs --fresco`.

## Desarrollo

```
claude plugin test .
claude plugin validate .
```

Las capturas de la vista se regeneran con:

```
deno run --config herramientas/vista/deno.json --allow-read --allow-write herramientas/vista/generar.ts
```

Eso deja en `herramientas/vista/salida/` un HTML por fixture y ancho (320, 400 y 480 px), con el tema claro y el oscuro en la misma lámina, más la versión de terminal (`.txt` y `.html`) y los SVG. Los PNG de `herramientas/vista/capturas/` salen de `herramientas/vista/capturar.js` con Playwright; los pasos están en su cabecera.
