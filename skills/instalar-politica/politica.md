<!-- flota:politica:inicio v1.3.1 -->
## Política de modelos (flota v1.3.1)

Instalada por el plugin **flota**. La mantiene su autor: cada vez que sale un modelo nuevo,
recalibra con evidencia (benchmarks públicos verificados y pruebas propias a ciegas) y publica una
versión nueva. Si instalaste flota desde la app, la versión nueva llega sola con Sync
automatically (o con Check for updates en Customize → Plugins). Si la instalaste desde la
terminal: `claude plugin marketplace update flota` y `claude plugin update flota@flota`. En los
dos casos, después corre `/flota:instalar-politica`. No edites este bloque: se reemplaza completo
en cada actualización. Tus propias instrucciones van fuera de los marcadores.

**Prioridad del usuario: el MEJOR resultado, no el mayor ahorro, sin dejar la semana sin cuota
en un día.** El juicio se concentra donde rinde y el barrido va barato.

| Rol | Cómo se invoca | Modelo · effort | Por qué |
|---|---|---|---|
| Sesión principal | selector de modelo de la app | **Opus 5.5 · xhigh** | Ver nota 1 |
| Verificador / juez | `flota:verificador` | `fable` · xhigh | Ver nota 2 |
| Revisor (buscar bugs) | `flota:revisor` | `opus` (= Opus 5.5) · xhigh | Ver nota 3 |
| Revisor crítico (dinero, seguridad, reglas de Meta) | `flota:revisor-critico` | `opus` (= Opus 5.5) · xhigh | Ver nota 4 |
| Auditor (calidad, UX/UI, accesibilidad, rendimiento; sin Bash) | `flota:auditor` | `opus` (= Opus 5.5) · xhigh | Ver nota 8 |
| Ideas de producto (con web) | `flota:auditor-producto` | `opus` (= Opus 5.5) · xhigh | Ver nota 8 |
| Investigar, docs/web, tests, evidencia | `flota:investigador` | `sonnet` (= Sonnet 5.5) · xhigh | Ver nota 5 |
| Implementar con decisiones (tarea de un plan, feature, integración) | `flota:implementador` | `sonnet` (= Sonnet 5.5) · xhigh; `model: opus` en tareas largas o de dinero | Ver nota 9 |
| Cambios mecánicos ya especificados al detalle + tests | `flota:mecanico` | `sonnet` (= Sonnet 5.5) · xhigh | Ver nota 5 |
| Buscar, listar, localizar | `flota:explorador` | `haiku` (= Haiku 5.5) · hereda xhigh | Ver nota 5 |
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
2. **Verificador: Fable.** En la prueba a ciegas del 27-oct (un SaaS propio del mantenedor, 12 hallazgos con 5
   falsos, 2 rondas) Fable y Opus acertaron 12/12 en todas las corridas; Opus costó ~45% menos.
   Con calidad empatada se mantiene Fable por diseño: es el único rol de otra familia que revisa
   el trabajo de los revisores Opus, y pesa ~5% del gasto. Si la cuota aprieta, es el primer
   candidato a pasar a Opus.
3. **Revisor.** Opus 5.5 es una mejora clara sobre Opus 5 (+bugs detectados, 20% más barato) y
   no hay evidencia para pagar Fable.
4. **Revisor crítico: Opus desde el 27-oct.** Prueba a ciegas en el código de dinero y permisos
   de un SaaS propio del mantenedor, 7 bugs plantados (5 entre archivos), 2 rondas: Opus encontró 13/14 y Fable
   9/14, ninguno reportó los hallazgos falsos plantados, y Opus costó ~27% menos ($3,6 vs $4,9 por
   corrida). La diferencia no es significativa con n=2 (Fisher p≈0,17), pero fue en la misma
   dirección en las dos rondas y Opus es más barato: con calidad al menos igual gana el más
   barato. Es un agente propio desde el 24-sep, con effort independiente del revisor.
5. **Roles de volumen.** Desde la CLI 2.1.284 el alias `sonnet` es **Sonnet 5.5** (28-sep):
   mismo precio que Sonnet 5 y claramente mejor (GDPval max 1844 vs 1449, FrontierCode en high
   49,4 vs 39,4).
   - `flota:investigador` y `flota:mecanico` pasaron solos, y tienen el effort fijado en el frontmatter.
     Eso importa porque en Claude Code Sonnet 5.5 arranca en medium por defecto, donde rinde
     bastante menos.
   - **Explorador en Haiku 5.5** (15-oct). Salió el 7-oct y el alias `haiku` lo resuelve desde la
     CLI 2.1.300. Es un salto grande sobre Haiku 4.5 (Epoch ECI 159 vs 142) y cuesta 10 veces
     menos, salvo con prompts de más de 100K tokens, que pagan 5 veces más por token.
   - **Effort del explorador: hereda xhigh, por decisión del mantenedor de flota.** Haiku 5.5 es el primer
     Haiku con effort y su default es medium. Anthropic y los dos jueces recomendaban fijar
     medium; el mantenedor prefirió xhigh porque igual gasta muy poco.
   - **Haiku 5.5 no reemplaza a Sonnet** en `flota:investigador` ni en `flota:mecanico`:
     - Su ficha oficial dice que alucina más que Sonnet y Opus, y el entregable del
       investigador es evidencia fiel.
     - En migraciones y refactors queda muy abajo (Vals Code Migration 44,6 vs 69,8, fuera del
       margen).
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
9. **Implementador (1-oct).** Rol nuevo, no una reasignación. Lo motivó una medición de los
   registros de sesiones:
   - Del 1 al 23 de septiembre, el 53% de los subagentes corría en Opus, casi todos como agentes
     sin tipo dentro de workflows.
   - Del 28-sep al 1-oct, el 50% corrió en Sonnet: la implementación de tareas de planes se iba a
     `flota:mecanico` (85 agentes, 56 en un proyecto del mantenedor, con tareas como "endpoints + conectar la vista a la API").
   - La prueba del 29-sep solo mostró que Sonnet basta para cambios ya especificados (6/6). Nunca
     comparó Sonnet contra Opus en implementar con decisiones, y ahí la evidencia pública favorece
     a Opus 5.5 al mismo esfuerzo (Terminal-Bench 64 vs 43 en high; GDPval 1820 vs 1725 en xhigh).
   - **Bake-off del 27-oct: el `flota:implementador` pasa a Sonnet 5.5 xhigh** (se mantiene el rol y su
     método; solo cambia el modelo).
     - 5 tareas reales con decisiones en un SaaS propio del mantenedor (dinero, zona horaria de Chile, permisos),
       tests ocultos y un juez a ciegas (Fable) por tarea. Tres brazos: Opus xhigh, Opus high y
       Sonnet xhigh.
     - Los 15 pasaron los tests ocultos (44/44 casos por brazo) sin romper la suite.
     - Juez: Sonnet xhigh nota 8,5 (mejor en 3 de 5), Opus xhigh 8,3 (mejor en 2), Opus high 7,3
       (último en las 5, con más bugs y 2 requisitos incumplidos). En ninguna tarea la diferencia
       entre la mejor y la peor habría cambiado algo en producción.
     - Costo en la prueba: Sonnet −48% y Opus high −46% frente a Opus xhigh. En tareas reales,
       largas, el ahorro de Sonnet es menor (~20% del costo del rol), porque releer contexto cuesta
       lo mismo en ambos modelos.
     - **Límite de la evidencia:** las tareas duraron 5–9 min y las reales ~30 min. Por eso, en
       tareas largas (más de ~1 h estimada o que cruzan muchos módulos) o de dinero y seguridad,
       pasa `model: opus` al `flota:implementador`. Subir el modelo está permitido.

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
    el más barato". En esos flujos usa el tipo del rol:
    - Implementar una tarea de un plan, una feature o una integración → `flota:implementador`. Es el
      "implementer" de skills como superpowers.
    - Aplicar un cambio que ya dice exactamente qué hacer → `flota:mecanico`.
    - Revisión → `flota:revisor`.
    - Ante la duda entre `flota:implementador` y `flota:mecanico`: si alguien tiene que decidir cómo hacerlo,
      es `flota:implementador`.
  - El hook de flota bloquea la bajada en la herramienta Agent. En
    `agent()` de un Workflow no está verificado que el hook actúe: ahí la regla depende de no
    pasar `model`.
  - Excepción deliberada: paneles de jueces de familias distintas, con "panel mixto" en la
    description.
- **Effort por agente** va en el frontmatter (`effort:`). Sin ese campo, el subagente hereda el
  de la sesión (verificado el 24-sep). Todos los tipados están en xhigh, verificado con
  subagentes reales el 29-sep.
  - Desde la CLI 2.1.292 la herramienta Agent acepta `effort` por llamada, y ese valor **le gana
    al frontmatter**. Úsalo solo para *subir* (p. ej. `max` puntual), nunca para bajar el de un
    agente tipado. El hook no lo bloquea: la regla depende de no pasarlo.
  - Para un caso que necesite más esfuerzo, pasa un `effort` más alto en esa llamada, o sube la
    sesión con `/effort`.
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
  - **Medido de nuevo el 27-oct (high vs xhigh): bajar a high empeora.**
    - Implementador (Opus): high quedó último en las 5 tareas, con más bugs y 2 requisitos
      incumplidos.
    - Investigador (Sonnet, 8 preguntas difíciles): 7 empates, y xhigh ganó en la otra porque
      encontró un bug real de dinero que high no vio. High costó ~48% menos.
    - Sesión principal: el pensamiento es solo ~11% de su costo, así que bajar el effort casi no
      ahorra. Su costo es releer y reescribir contexto (ver "Contexto y pausas").
    - Conclusión: **no se baja el effort de ningún rol.**
  - Cambia el effort en pausas: cambiarlo en medio de una conversación invalida el caché.
  - **Nunca fijes `CLAUDE_CODE_EFFORT_LEVEL`:** le gana al effort de todos los agentes.
- **Ultracode** = workflows automáticos para cada tarea que Claude juzgue sustancial.
  - Desde la CLI 2.1.284 es un interruptor aparte (`/effort ultracode on|off`, o Tab en
    `/effort`) que ya **no fuerza xhigh** y funciona con cualquier esfuerzo. Excepción:
    `claude --effort ultracode` al arrancar sí fija xhigh.
  - No hace falta para lanzar agentes; los subagentes se lanzan igual en cualquier esfuerzo.
  - **Default: apagado. Claude decide cuándo conviene y lo propone** (decidido el 27-oct). El
    usuario trabaja siempre en Opus 5.5 xhigh con ultracode apagado. Al recibir cada pedido,
    evalúa si un workflow (varios agentes en paralelo, con verificación adversarial) daría un
    resultado claramente mejor que trabajar solo o con 1–3 agentes tipados.
    - **Conviene cuando hay que cubrir mucho en paralelo:** auditar un proyecto entero, revisar
      un cambio grande (más de ~15 archivos o varias zonas), migrar o refactorizar en muchos
      archivos.
    - **Conviene en investigación con muchas fuentes o ángulos,** o en una decisión de
      arquitectura con alternativas que vale la pena juzgar por separado.
    - **Conviene en una revisión crítica** de dinero, seguridad o permisos, donde vale verificar
      cada hallazgo con un agente aparte.
    - **Conviene si el usuario pide** "a fondo", "exhaustivo" o "lo mejor posible" sobre algo
      grande.
    - **No conviene** para preguntas, conversación, cambios acotados, tareas de pocos archivos o
      configuraciones chicas: ahí basta con trabajar solo o con agentes tipados.
    - **Si conviene, antes de empezar** di en una línea qué haría el workflow, cuántos agentes y
      el % estimado de la semana, y pregunta "¿lo lanzo como workflow?". Un sí del usuario es el
      opt-in para esa tarea y nada más. Si dice que no, o no lo contesta, sigue sin workflow.
    - **Nunca enciendas ultracode por tu cuenta.** Lanzar un workflow requiere el sí del usuario
      (regla de Claude Code), y uno puede costar entre 5% y 20% de la semana.
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
  - **Contexto y pausas** (medido el 27-oct en los registros: releer contexto es la mayor parte
    del costo):
    - Volver a una sesión grande después de más de 1 h reescribe el caché entero. Entre el 13 y el
      27-oct eso fue ~1/3 del gasto de las sesiones principales. Si el usuario dice que se va por
      un rato o cierra una fase, y la sesión pasa de ~300k tokens (en la app, revísalo con
      `get_usage`), recomiéndale `/compact` *antes* de irse: con el caché activo cuesta ~5% de
      esa reescritura. Tú no puedes compactar; solo recomendarlo.
    - Una sesión por fase, no por proyecto: el 72% del gasto de las sesiones principales ocurrió
      con más de 400k tokens de contexto. Al cambiar de fase, propone abrir una sesión nueva con
      una nota de traspaso.
  - **`flota:implementador` y `flota:mecanico` excluyen herramientas que nunca usaron** en 136 corridas
    (artefactos, Vercel, Higgsfield, trading, correo, control de la app, etc.). Arrancaban con
    ~109k tokens de contexto. Es una lista de exclusión (`disallowedTools`), no de permitidos,
    para que las herramientas nuevas de Anthropic les sigan llegando. Si conectas un conector
    pesado que no les sirva, agrégalo ahí.
- **Alias, nunca IDs** en agentes y settings. Los alias se mueven solos al actualizar la CLI; un
  ID fijo se queda en un modelo viejo, y uno que la CLI no conoce da error ("does not support
  this model").
- **Dos CLI:** la `claude` de la terminal y la de la app pueden estar en versiones distintas y
  resolver `opus` a modelos distintos. Opus 5.5 exige la CLI 2.1.280 o posterior.

Precios por millón de tokens (in/out): Fable 5.1 $10/$50 · Opus 5.5 $4/$20 · Opus 5 $5/$25 ·
Sonnet 5.5 $2/$10 (igual que Sonnet 5) · Haiku 5.5 $0,10/$0,50 (con prompt ≤100K tokens; sobre
100K, 5 veces más) · Haiku 4.5 $1/$5.
<!-- flota:politica:fin -->
