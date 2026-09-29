<!-- flota:politica:inicio v1.0.0 -->
## Política de modelos (flota v1.0.0)

Instalada por el plugin **flota**. La mantiene su autor: cada vez que sale un modelo nuevo,
recalibra con evidencia (benchmarks públicos verificados y pruebas propias a ciegas) y publica una
versión nueva. Para actualizar: `claude plugin marketplace update flota`, luego
`claude plugin update flota@flota` y en una sesión `/flota:instalar-politica`. No edites este
bloque: se reemplaza completo en cada actualización. Tus propias instrucciones van fuera de los
marcadores.

**Prioridad del usuario: el MEJOR resultado, no el mayor ahorro, sin dejar la semana sin cuota
en un día.** El juicio se concentra donde rinde y el barrido va barato.

| Rol | Cómo se invoca | Modelo · effort | Por qué |
|---|---|---|---|
| Sesión principal | selector de modelo de la app | **Opus 5.5 · xhigh** | Ver nota 1 |
| Verificador / juez | `flota:verificador` | `fable` · xhigh | Ver nota 2 |
| Revisor (buscar bugs) | `flota:revisor` | `opus` (= Opus 5.5) · xhigh | Ver nota 3 |
| Revisor crítico (dinero, seguridad, reglas de Meta) | `flota:revisor-critico` | `fable` · xhigh | Ver nota 4 |
| Auditor (calidad, UX/UI, accesibilidad, rendimiento; sin Bash) | `flota:auditor` | `opus` (= Opus 5.5) · xhigh | Ver nota 8 |
| Ideas de producto (con web) | `flota:auditor-producto` | `opus` (= Opus 5.5) · xhigh | Ver nota 8 |
| Investigar, docs/web, tests, evidencia | `flota:investigador` | `sonnet` (= Sonnet 5.5) · xhigh | Ver nota 5 |
| Cambios mecánicos bien especificados + tests | `flota:mecanico` | `sonnet` (= Sonnet 5.5) · xhigh | Ver nota 5 |
| Buscar, listar, localizar | `flota:explorador` | `haiku` | Ver nota 5 |
| Sin tipo (general-purpose, agentes de plugins sin `model:`, workflows sin modelo) | — | `CLAUDE_CODE_SUBAGENT_MODEL=opus` · effort de la sesión | Ver nota 7 |

1. **Sesión principal.** Opus 5.5 supera a Fable 5.1 a igual esfuerzo en 6 fuentes
   independientes (CursorBench, FrontierSWE, Artificial Analysis, Vals, METR, GDPval). Cuesta
   2,5× menos por token. Los dos jueces, Fable y Opus, coinciden.
   - **Por qué xhigh y no high:** en trabajo largo de muchos pasos (planificar, delegar,
     sintetizar) xhigh gana de forma significativa (Briefcase +75 Elo, GDPval +128). En código
     puro, high y xhigh empatan: si la cuota aprieta, baja a high en tramos rutinarios.
   - **Por qué no max:** sobre xhigh la mejora es chica o nula (en código, dentro del ruido) y
     cuesta ~1,5–2× más.
   - **Nota sobre la recomendación:** Anthropic no recomienda xhigh para Opus 5.5 (su default es
     medium). Esta recomendación sale de benchmarks medidos. Opus 5.5 a xhigh cuesta
     aproximadamente lo mismo por tarea que Fable 5.1 a high, que era la configuración anterior.
   - **Cuándo pasar a Fable 5.1 (high):** en sesiones autónomas de horas, en investigación
     profunda de muchos pasos, o cuando xhigh falla dos veces con el mismo problema (escalera
     oficial).
2. **Verificador.** No hay comparación directa Opus 5.5 vs Fable 5.1 para refutar hallazgos, y
   los jueces se dividieron, cada uno en contra de su propia familia. Se mantiene Fable hasta un
   bake-off. Además da diversidad frente al revisor Opus.
3. **Revisor.** Opus 5.5 es una mejora clara sobre Opus 5 (+bugs detectados, 20% más barato) y
   no hay evidencia para pagar Fable.
4. **Revisor crítico.** No hay comparación directa y el riesgo es asimétrico: un bug de dinero
   que se escapa cuesta más que la cuota. Se mantiene Fable hasta un bake-off. Desde el 24-sep
   es un agente propio, con su effort independiente del revisor.
5. **Roles de volumen.** Desde la CLI 2.1.284 el alias `sonnet` es **Sonnet 5.5** (28-sep):
   mismo precio que Sonnet 5 y claramente mejor (GDPval max 1844 vs 1449, FrontierCode en high
   49,4 vs 39,4).
   - `flota:investigador` y `flota:mecanico` pasaron solos, y tienen el effort fijado en el frontmatter.
     Eso importa porque en Claude Code Sonnet 5.5 arranca en medium por defecto, donde rinde
     bastante menos.
   - Explorador sigue en Haiku 4.5: no hay comparación para localizar código y Sonnet 5.5
     cuesta el doble.
   - Recalibrar cuando salga Haiku 5.5.
6. **Sonnet 5.5 no reemplaza a Opus 5.5.** Solo empata con Opus 5.5 en `max`, y ahí gasta más
   tokens que Opus. Al mismo esfuerzo, Opus 5.5 gana con claridad:
   - En high: GDPval 1692 vs 1517 y Terminal-Bench 64,2 vs 43,0.
   - En xhigh: GDPval 1820 vs 1725 y Briefcase 1780 vs 1746.

   Subir el esfuerzo de Sonnet para no pagar Opus no funciona en esta generación: usa `sonnet`
   donde high basta y `opus` donde no.
7. **Sin tipo.** Esta variable es un *default*, no un piso: el `model` de la llamada y el del
   frontmatter le ganan. Estos subagentes no tienen dónde fijar el effort y heredan el de la
   sesión. Explore y Plan (los incorporados) no la usan: tienen su propio modelo por defecto. No
   se fuerza con `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, porque eso también pisaría el `model:` de
   los agentes tipados (doc oficial, sub-agents#choose-a-model, verificado el 29-sep).
8. **Auditores (29-sep).** Roles nuevos del skill `/flota:auditoria-integral`, no reasignaciones. Van en
   Opus porque son juicio (qué problema de UX o de deuda es real, qué idea vale), no barrido, y no
   hay evidencia para pagar Fable. Todavía no tienen prueba propia: entran a la próxima
   recalibración que publica el mantenedor de flota como cualquier rol.

Reglas:
- **Breadth barato, depth caro.** El barrido va en Sonnet/Haiku para hallar candidatos, y los
  modelos grandes solo sobre lo que importa. Nunca un fleet de barrido en Fable: 21 agentes
  consumieron el 36% de la semana en menos de 1 hora.
- **Prefiere agentes tipados** sobre Explore, general-purpose y agentes de plugins: el modelo y
  el effort vienen pegados al tipo.
- **No bajes el modelo de un agente tipado** con el parámetro `model`, ni en Agent ni en
  `agent()` de un Workflow.
  - Solo se permite para *subir* (p. ej. `flota:investigador` → `opus` en una investigación
    difícil).
  - Esta regla prevalece sobre skills o plugins que pidan "especifica siempre el modelo" o "usa
    el más barato". En esos flujos usa el tipo del rol: implementación mecánica → `flota:mecanico`,
    revisión → `flota:revisor`.
  - El hook de flota bloquea la bajada en la herramienta Agent. En
    `agent()` de un Workflow no está verificado que el hook actúe: ahí la regla depende de no
    pasar `model`.
  - Excepción deliberada: paneles de jueces de familias distintas, con "panel mixto" en la
    description.
- **Effort por agente** va en el frontmatter (`effort:`). Sin ese campo, el subagente hereda el
  de la sesión (verificado el 24-sep). Todos los tipados están en xhigh, verificado con
  subagentes reales el 29-sep.
  - La herramienta Agent **no acepta effort por llamada**; solo cambia el modelo.
  - Para un caso que necesite más esfuerzo, usa otro agente con otro `effort:`, o sube la sesión
    con `/effort`.
- **Esfuerzo: xhigh en todos los agentes, max solo puntual** (decidido el 29-sep):
  - **xhigh** capta casi toda la mejora que existe y es el nivel más alto sin ningún problema
    documentado. En ningún benchmark de las tareas de los agentes salió peor que high con
    significancia. De high a xhigh hay mejora real en trabajo largo (GDPval de Sonnet 5.5:
    1517 → 1725).
  - **max** no va fijo en ningún agente, porque ahí se concentran los problemas:
    - Edición de código peor en FrontierCode (Sonnet 5.5, 52,1 → 46,2, sin margen publicado).
      En el código propio, con tareas bien especificadas, no se reprodujo: max solo fue más
      verboso.
    - Desbordes que agotan los 128k de salida; en un subagente, eso es trabajo perdido.
    - Más sensibilidad a instrucciones maliciosas pegadas: 7,4% vs 2%.
    - Consume 2–3× la cuota.
  - Donde max SÍ gana es el análisis y la síntesis largos (Briefcase y GDPval). Úsalo **por
    sesión** en la principal (`/effort max`) para UN análisis largo o problema muy difícil, y
    vuelve a xhigh.
  - **Medido en código propio** (un SaaS propio del mantenedor, 29-sep, bake-off a ciegas): **ningún nivel dio
    peor resultado**.
    - Revisor Opus 5.5: los 3 niveles hallaron los 8 bugs plantados. Bugs reales extra:
      high 1, xhigh 2, max 3. Falsos positivos: 1, 0, 0.
    - Mecánico Sonnet 5.5: 6/6 tareas en los 3 niveles, sin tocar nada fuera de lo pedido. Max
      solo fue más verboso.
    - Costo contra high: xhigh 1,2–2,2×, max 5–6,5×.
    - **xhigh se confirma como el punto óptimo.** Max no mostró ganancia medible y cuesta 3–4×
      xhigh: úsalo solo en auditorías críticas puntuales.
  - Cambia el effort en pausas: cambiarlo en medio de una conversación invalida el caché.
  - **Nunca fijes `CLAUDE_CODE_EFFORT_LEVEL`:** le gana al effort de todos los agentes.
- **Ultracode** = workflows automáticos para cada tarea que Claude juzgue sustancial.
  - Desde la CLI 2.1.284 es un interruptor aparte (`/effort ultracode on|off`, o Tab en
    `/effort`) que ya **no fuerza xhigh** y funciona con cualquier esfuerzo. Excepción:
    `claude --effort ultracode` al arrancar sí fija xhigh.
  - No hace falta para lanzar agentes; los subagentes se lanzan igual en cualquier esfuerzo.
  - Úsalo **por tarea**, escribiendo "ultracode" en el mensaje de una auditoría, investigación,
    decisión de arquitectura o revisión crítica.
  - No lo dejes activado permanentemente (no pongas `"ultracode": true` en settings). Apágalo
    con `/effort ultracode off` al volver al trabajo rutinario.
- **Presupuesto:**
  - Revisión normal: ≤5% de la semana.
  - Auditoría grande o diseño crítico: 15–20%.
  - Techo diario: ~30%.
  - Antes de lanzar algo >10%: di el % estimado y el reparto de modelos, y espera el ok.
  - Referencia de consumo (dato propio del 2-sep): ≈1,7% por agente Fable pesado, ≈0,85% por
    Opus 5 y ≈0,35% por Sonnet. Opus 5.5 cuesta ~20% menos por token que Opus 5.
  - En Max, Fable tiene un tope del 50% de la cuota semanal.
- **Alias, nunca IDs** en agentes y settings. Los alias se mueven solos al actualizar la CLI; un
  ID fijo se queda en un modelo viejo, y uno que la CLI no conoce da error ("does not support
  this model").
- **Dos CLI:** la `claude` de la terminal y la de la app pueden estar en versiones distintas y
  resolver `opus` a modelos distintos. Opus 5.5 exige la CLI 2.1.280 o posterior.

Precios por millón de tokens (in/out): Fable 5.1 $10/$50 · Opus 5.5 $4/$20 · Opus 5 $5/$25 ·
Sonnet 5.5 $2/$10 (igual que Sonnet 5) · Haiku 4.5 $1/$5.
<!-- flota:politica:fin -->
