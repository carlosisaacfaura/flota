# Cómo estima `cuanto-falta` 0.2, y cuánto acierta

Medido el 16-nov-2026 contra 5.310 corridas reales de subagentes: 5.000 encargos y 310 reanudaciones, de
5.538 transcripts. Todo se reproduce con los comandos del final. Revisión 2: un verificador reprodujo la
primera versión al decimal y sin fuga al entrenamiento, pero encontró un sesgo de segmentación; esta
versión lo corrige y agrega el silencio, el informe con su retraso real y los intervalos. Revisión 3: la
segmentación ya no toma un empujón del motor por una reanudación ni da por terminada una corrida en un
`end_turn` sin texto (ver «Los datos y cómo se repiten»). Sobre los mismos transcripts, 21 corridas menos
(5.331 → 5.310), todas reanudaciones (331 → 310), y en la semana de prueba 16 menos (459 → 443), 13 de
ellas reanudaciones (70 → 57).

## El método

Para un agente que corre, con su rol, su modelo, los minutos que lleva, sus llamadas, su fase, su lista, si
es una reanudación y cuánto lleva en silencio:

1. **Supervivencia condicionada a lo transcurrido.** Se buscan las corridas pasadas del mismo rol y
   modelo que *llegaron a durar al menos lo que este lleva*, y se toman los cuantiles 10, 50 y 90 de lo
   que les faltaba en ese momento. Rejilla de 37 puntos (0 a 300 min), interpolada.
2. **Encargo o reanudación.** Una reanudación (un `SendMessage` a un agente que ya cerró su turno) tiene
   tablas propias. En el implementador, un encargo dura p10/p50/p90 13,3/31,2/59,6 min y una reanudación
   1,7/8,4/22,7. Si el rol tiene pocas reanudaciones, se usan las de todos los agentes, con confianza
   baja.
3. **Etapa.** Las corridas se separan además por las llamadas hechas sobre las típicas del rol (menos de
   0,3×, 0,3–0,6×, 0,6–1×, más) y por si ya editó, probó o hizo commit. Con pocas muestras retrocede:
   etapa fina → solo llamadas → todas; rol+modelo → rol.
4. **Informe final.** Si escribe el informe (200 caracteres de texto sin herramientas, o `StructuredOutput`
   en un workflow), manda una tabla aparte: lo que falta según cuánto lleva escribiéndolo, contado desde
   que el mod lo ve.
5. **Silencio.** Pasada la duración típica de su rol, un rato sin ninguna herramienta en vuelo (`silencioMin`)
   suele ser el cierre: manda una tabla de lo que faltaba según ese silencio. Solo en los roles donde se
   comprobó, y desde el umbral que se eligió *dentro del entrenamiento* (ver abajo). En las tablas finales
   aplica a investigador (desde 0,3 min), revisor (0,3) y verificador (1,0). En el implementador no ayuda
   y no se usa.
6. **Lista de pasos.** Si el agente lleva una (TodoWrite o TaskCreate/TaskUpdate) con al menos un paso
   hecho, el centro se acerca, en escala logarítmica y con peso `0,5 × hechos/total`, a lo que le
   tomaría el resto al ritmo que lleva.
7. **Calibración del rango.** El extremo bajo se ensancha (`bajo = medio·(p10/medio)^1,7`), porque casi
   todos los fallos eran agentes que terminaban antes de lo bajo. El alto queda en el p90.
8. **Recencia.** Cada corrida pesa `0,5^(días de antigüedad/30)`.
9. **Nunca un número inventado.** Un rol sin al menos 20 corridas da `calculando` (también reanudado). Si
   faltan muestras a esa altura de la corrida, también `calculando`. Si menos del 3% de las corridas del
   rol duró tanto, `pasado`, con su duración típica.

`clasificar` (en `hooks/fase.ts`) es la única fuente de las fases. La usa el mod en vivo y la usa el
extractor del histórico. Bash se clasifica comando por comando (`&&`, `;`, `|`, subshells, `bash -c`,
`xargs`, `timeout`, `npx`/`pnpm exec`/`uv run`…). Nunca lee como comando el cuerpo de un heredoc ni lo
que va entre comillas, y gana la fase más cercana al final del trabajo: commit > pruebas > edición >
pantalla > web > lectura. Sobre los 223 mil Bash de los subagentes, el 99% recibe una fase.

## Los datos y cómo se repiten

- Transcripts en `~/.claude/projects/*/*/subagents/agent-*.jsonl` (1.989) y los de workflows en
  `…/subagents/workflows/wf_*/agent-*.jsonl` (3.549), con `agentType` propio o `workflow-subagent` en su
  `.meta.json`, igual que los llama el mod en vivo. En los transcripts no aparece ningún fork.
- **Una corrida es un turno**, como en vivo: el mod cierra al agente en su `turn.complete`. El encargo
  abre la primera. Cada reanudación abre otra: un mensaje de usuario que llega después de que el agente
  cerró su turno, casi siempre un mensaje *meta* del motor («The coordinator sent a message…»,
  «[SYSTEM NOTIFICATION…»). El tiempo dormido entre turnos no cuenta.
  - **La versión 1 no hacía esto**: descartaba los mensajes meta y juntaba todos los turnos de un
    transcript en una sola corrida, con el tiempo dormido adentro. En el implementador de noviembre, 102
    de 353 corridas tenían pausas de 2 min o más, y el 23% de sus minutos eran dormidos.
  - Los dos mensajes `[Workflow harness …]` del inicio de un agente de workflow son su encargo, no una
    reanudación.
  - **Los empujones del motor no abren una reanudación** (revisión 3). El motor también mete mensajes
    *meta* dentro del mismo turno, aunque el agente ya haya escrito un `end_turn`: «Your response above
    was cut off…», `[handback-send-enforce]`, `[structured-output-enforce]` y los `<system-reminder>`. Son
    un empujón a seguir, no una pregunta nueva: la corrida continúa. La versión 2 los tomaba por
    reanudaciones y partía en dos un turno que seguía corriendo (el pedazo suelto salía como una
    «reanudación» corta). Sobre los mismos transcripts, este arreglo quita las 21 reanudaciones de más.
- Solo cuentan las corridas que terminaron bien: `end_turn` con texto, o el resultado de un
  `StructuredOutput`/`SubagentHandback`. Un `end_turn` solo da por buen el fin si ese mensaje trae texto,
  no solo pensamiento (revisión 3: antes se aceptaba sin mirar; ahora, sin texto, la corrida no cuenta
  como terminada bien). Solo, este cambio quita 12 corridas (5.331 → 5.319); sumado al de los empujones
  casi no cambia nada más, porque esos pedazos sueltos ya no se separan. Se descartan las interrumpidas, las que terminaron en error de
  la API, las cortadas, las de menos de 15 s y las de más de 6 h.
- El estado en cada momento se arma como lo arma la pieza B en `hooks/modelo.ts`:
  - Una llamada suma 1 y su fase reemplaza a la anterior si no es `null`.
  - `Agent`/`Task`/`Workflow` ponen `delegando` hasta su resultado.
  - `arrancando` no entra en `vistas`.
  - `silencioMin` cuenta desde el último resultado, solo si no queda ninguna herramienta en vuelo.
- **El informe con su retraso real.** En vivo se detecta cuando ya salieron 200 caracteres de texto:
  medido, ~11 s después del último resultado en la mediana y 39 s en el p90. Las tablas cuentan desde los
  11 s. La evaluación sortea para cada corrida un retraso log-normal con esa mediana y ese p90 (fijo por
  corrida, determinista). En la versión 1 el informe partía en el último resultado: era un pequeño
  oráculo.
- **Evaluación**: una foto cada 30 s de cada corrida de prueba, con la `EntradaEstimador` de ese
  momento, comparada con lo que de verdad faltaba. Cada corrida pesa lo mismo dentro de cada tercio. Se
  importan `fase.ts` y `estimar.ts` del mod tal cual. Los intervalos son del 95%, por remuestreo de
  corridas: 200 sorteos con reemplazo, cada corrida con todas sus fotos.
- **La línea base honesta.** La 0.1.0 se evalúa "tal cual" (su punto de partida) y "con historial": lo
  que habría aprendido de verdad, sus últimas 200 corridas por tipo. Solo cuentan encargos completos,
  porque no aprendía de las reanudaciones (`aprende: !e.resume`), y cada uno con la duración de su turno.
  La versión 1 la inflaba con las corridas mal segmentadas.

## Resultado: holdout temporal pedido

Entrenamiento con las 4.867 corridas hasta el 8-nov. Prueba con 443 corridas del 9 al 16-nov (57 de ellas
reanudaciones; 18.321 fotos). Las filas por rol son encargos; las reanudaciones van juntas aparte.

"Error en comunes" compara solo las fotos donde los tres métodos dieron un número: la 0.1.0 no da número
en sus fotos `pasado`, que son las difíciles.

| Rol | Método | Corridas | Error mediano (min), 1º / 2º / 3º tercio [IC 95%] | Error en comunes | Cobertura, 1º / 2º / 3º tercio [IC 95%] | Pasado |
|---|---|---|---|---|---|---|
| **todos** | **0.2** | 443 | **4,7** (4,1–5,6) / **3,7** (3,4–4,2) / **3,4** (3,0–3,8) | 4,8 / 3,8 / 4,1 | **80%** (76–83) / **85%** (82–88) / **81%** (79–85) | 1% |
| todos | 0.1.0 con historial | 443 | 6,7 (5,9–7,7) / 5,0 (4,4–6,0) / 2,6 (2,2–2,9) | 7,0 / 6,1 / 3,4 | 36% (32–40) / 38% (34–42) / 43% (38–47) | 8% |
| todos | 0.1.0 tal cual | 443 | 7,9 (7,3–8,7) / 6,6 (6,1–7,6) / 3,5 (2,9–4,7) | 8,0 / 6,7 / 3,6 | 33% (30–37) / 33% (29–38) / 39% (33–44) | 20% |
| implementador | **0.2** | 128 | 13,4 (10,4–17,0) / 10,2 (8,3–12,4) / 6,8 (6,2–7,6) | 13,2 / 9,5 / 7,6 | 70% (63–77) / 84% (79–89) / 90% (87–93) | 4% |
| implementador | 0.1.0 con historial | 128 | 16,7 (12,7–20,2) / 12,8 (10,4–15,3) / 5,3 (4,3–6,2) | 16,7 / 12,6 / 5,4 | 28% (22–37) / 31% (23–39) / 40% (31–50) | 13% |
| reanudaciones | **0.2** | 57 | 6,2 (4,7–7,4) / 3,1 (2,4–3,6) / 4,1 (3,1–4,5) | 6,2 / 3,1 / 4,1 | 76% (67–86) / 86% (78–95) / 77% (67–85) | 0% |
| reanudaciones | 0.1.0 con historial | 57 | 22,7 (17,6–24,5) / 21,3 (15,3–23,5) / 20,5 (14,9–23,6) | 22,7 / 21,3 / 22,3 | 8% (2–14) / 8% (2–16) / 8% (2–14) | 0% |
| investigador | **0.2** | 55 | 5,2 (3,6–6,4) / 3,7 (2,9–4,5) / 2,9 (1,9–3,8) | 5,2 / 3,9 / 4,5 | 76% (65–84) / 75% (66–85) / 72% (61–83) | 0% |
| investigador | 0.1.0 con historial | 55 | 6,2 (4,1–7,6) / 4,2 (3,4–5,7) / 2,4 (1,7–3,4) | 6,2 / 4,8 / 3,9 | 45% (35–60) / 50% (38–62) / 51% (39–64) | 0% |
| revisor | **0.2** | 44 | 3,3 (2,5–4,6) / 3,1 (2,2–4,4) / 1,9 (1,6–2,6) | 3,3 / 2,9 / 2,1 | 85% (75–95) / 85% (74–94) / 94% (89–97) | 0% |
| revisor | 0.1.0 con historial | 44 | 5,1 (3,9–6,4) / 4,5 (3,6–5,6) / 2,0 (1,6–2,5) | 5,1 / 4,4 / 2,0 | 52% (37–63) / 53% (38–64) / 57% (40–72) | 9% |
| revisor-critico | **0.2** | 37 | 3,7 (3,1–4,6) / 3,7 (2,9–4,5) / 2,8 (2,0–3,4) | 4,1 / 3,7 / 3,4 | 89% (80–96) / 85% (76–93) / 86% (81–94) | 0% |
| revisor-critico | 0.1.0 con historial | 37 | 3,0 (2,0–3,9) / 2,8 (2,1–3,8) / 1,2 (0,7–2,0) | 2,6 / 2,0 / 2,0 | 34% (24–45) / 42% (29–58) / 42% (28–57) | 8% |
| verificador | **0.2** | 70 | 2,0 (1,7–2,6) / 2,1 (1,6–2,5) / 1,5 (1,3–2,1) | 2,0 / 2,0 / 2,4 | 89% (82–94) / 95% (90–97) / 83% (75–89) | 0% |
| verificador | 0.1.0 con historial | 70 | 3,1 (2,3–4,1) / 1,6 (1,3–2,3) / 0,8 (0,6–1,1) | 3,0 / 1,4 / 0,7 | 59% (47–67) / 61% (48–72) / 67% (56–78) | 4% |
| general-purpose | **0.2** | 25 | 1,3 (1,0–1,9) / 2,1 (1,6–4,1) / 5,7 (3,8–6,0) | 1,3 / 2,0 / 5,9 | 100% (100–100) / 95% (90–99) / 49% (37–63) | 0% |
| general-purpose | 0.1.0 con historial | 25 | 2,6 (2,0–2,9) / 2,5 (1,5–2,7) / 2,4 (1,7–2,6) | 2,6 / 2,2 / 2,5 | 30% (16–46) / 21% (8–37) / 21% (8–37) | 2% |
| mecanico | **0.2** | 9 | 4,4 (3,3–10,6) / 6,9 (2,5–8,4) / 8,1 (6,8–9,4) | 4,4 / 7,0 / 8,2 | 97% (94–100) / 78% (44–100) / 54% (29–80) | 0% |
| mecanico | 0.1.0 con historial | 9 | 9,1 (3,6–10,6) / 4,7 (3,5–8,4) / 5,4 (3,7–8,0) | 9,1 / 5,1 / 7,4 | 51% (22–85) / 56% (22–89) / 56% (22–89) | 0% |

**El implementador, con todas sus corridas (183: 128 encargos y 55 reanudaciones)**: la 0.2 da error
9,2 / 7,1 / 5,9 min con cobertura de 73% / 85% / 86%; la 0.1.0 con historial, 19,0 / 15,1 / 7,7 min con
22% / 24% / 28%. Con las reanudaciones adentro, gana también en el último tercio. En los encargos solos
no: la 0.1.0 con historial tiene menos error en el último tercio (5,3 min contra 6,8 de la 0.2) con menos
de la mitad de cobertura (40% contra 90%).

En la versión 1 el error de la 0.2 en ese último tercio era de 13,4 min y su rango mediano de 85 min;
ahora son 6,8 min y 36,5 min en los encargos. **Esa baja vino de cambiar la segmentación** (sacar de las
corridas el tiempo dormido), **no de mejorar el estimador**: no se debe leer como una ganancia del método.
Las reanudaciones tienen 4,1 min de error en el último tercio.

### Evaluación móvil (más corridas, menos ruido)

Tres ventanas de 15 días, cada una entrenada con todo lo anterior a su corte: 10-oct, 25-oct y 9-nov,
con 2.458 corridas de prueba en total.

| Ventana | Corridas | 0.1.0 con historial: error / cobertura | 0.2: error (1º/2º/3º) | 0.2: cobertura (1º/2º/3º) | Ancho | Calculando | Silencio elegido en el entrenamiento |
|---|---|---|---|---|---|---|---|
| 10-oct | 895 | 3,7 / 43% | 3,6 (4,7/3,0/3,2) | 79% (72/87/80) | 14,2 | 23% | ninguno |
| 25-oct | 1.120 | 5,8 / 39% | 3,6 (4,3/3,5/3,0) | 84% (82/88/83) | 14,5 | 11% | workflow-subagent |
| 9-nov | 443 | 4,6 / 39% | 3,9 (4,7/3,7/3,4) | 82% (80/85/81) | 16,6 | 3% | investigador, revisor, verificador, revisor-critico |
| **juntas** | 2.458 | 4,6 / 40% | **3,7** (4,5/3,4/3,1) | **82%** (78/87/82) | 14,8 | 14% | |

Por rol, las tres ventanas juntas (intervalo del 95%; 0.1.0 con historial):

| Rol | Corridas | 0.2: error 1º / 2º / 3º | 0.1.0: error 1º / 2º / 3º | 0.2: cobertura | 0.1.0: cobertura |
|---|---|---|---|---|---|
| todos | 2.458 | 4,5 (4,3–4,8) / 3,4 (3,2–3,6) / 3,1 (3,0–3,3) | 6,2 (5,9–6,6) / 4,9 (4,7–5,2) / 2,8 (2,7–3,0) | 78% / 87% / 82% | 37% / 40% / 45% |
| implementador | 721 | 10,6 (9,8–11,4) / 10,3 (9,4–11,2) / 7,9 (7,3–8,5) | 11,4 (10,6–12,4) / 10,2 (9,6–11,0) / 5,6 (5,1–6,0) | 74% / 88% / 81% | 36% / 37% / 43% |
| reanudaciones | 283 | 3,4 (2,9–4,1) / 1,4 (1,2–1,7) / 2,6 (2,4–2,8) | 20,1 (18,4–22,4) / 19,1 (18,0–20,9) / 18,6 (17,6–20,2) | 67% / 94% / 76% | 5% / 7% / 7% |
| investigador | 526 | 4,4 (3,9–4,8) / 3,3 (3,0–3,5) / 3,2 (3,0–3,4) | 4,5 (4,1–5,1) / 3,4 (3,1–3,7) / 2,0 (1,8–2,2) | 79% / 86% / 83% | 40% / 48% / 54% |
| revisor | 191 | 3,7 (3,1–4,5) / 2,6 (2,2–3,1) / 2,3 (2,0–2,5) | 5,8 (4,9–6,5) / 4,2 (3,8–4,7) / 1,7 (1,4–1,9) | 82% / 90% / 91% | 56% / 54% / 65% |
| revisor-critico | 193 | 3,1 (2,7–3,6) / 3,0 (2,5–3,3) / 1,6 (1,4–1,8) | 4,4 (3,9–5,1) / 4,2 (3,8–4,7) / 1,4 (1,1–1,7) | 75% / 73% / 89% | 35% / 30% / 47% |
| verificador | 334 | 2,5 (2,2–2,8) / 1,9 (1,7–2,1) / 2,1 (2,0–2,3) | 2,9 (2,7–3,2) / 1,9 (1,7–2,1) / 1,4 (1,2–1,5) | 88% / 90% / 79% | 48% / 57% / 62% |
| general-purpose | 50 | 2,6 (1,7–3,1) / 3,5 (2,0–3,9) / 5,3 (4,0–5,9) | 3,4 (2,8–4,8) / 2,6 (2,2–3,2) / 2,6 (1,9–2,9) | 98% / 95% / 62% | 40% / 32% / 35% |
| mecanico | 28 | 6,9 (5,5–8,4) / 7,7 (6,5–9,6) / 10,4 (8,7–11,5) | 6,6 (4,9–9,5) / 5,0 (3,9–7,9) / 5,7 (4,9–7,7) | 94% / 91% / 59% | 39% / 50% / 54% |

### Lo que gana y lo que no

- **Cobertura: gana en todos los roles y tramos**, y con intervalos separados en casi todos.
  - En la semana de prueba (pocas corridas por rol), los intervalos del 95% se cruzan en el último
    tercio del investigador (72% contra 51%), del verificador (83% contra 67%), del general-purpose (49%
    contra 21%) y del mecánico (54% contra 56%: ahí no gana), y en el segundo tercio del mecánico. Con las
    ventanas juntas, solo se cruzan en el último tercio del mecánico (59% contra 54%).
  - El rango contiene lo que de verdad faltaba el 80–85% de las veces en la semana de prueba, contra
    36–43% de la 0.1.0 con su historial real.
  - En las reanudaciones, 76–86% contra 8%: la 0.1.0 les daba la duración de un encargo nuevo.
- **Error del centro: en total gana con claridad en el primer y el segundo tercio** (intervalos
  separados).
  - En la semana de prueba: 4,7 contra 6,7 min y 3,7 contra 5,0.
  - En las reanudaciones: 6,2 contra 22,7 min y 3,1 contra 21,3.
- **El último tercio, en total, es un empate o una pérdida chica.**
  - En la semana: 3,4 (3,0–3,8) contra 2,6 (2,2–2,9). En las fotos comunes, 4,1 contra 3,4.
  - En las ventanas juntas: 3,1 contra 2,8.
  - Pierde en investigador, verificador, revisor-crítico, mecánico, general-purpose y en los encargos del
    implementador; el revisor empata en la semana (1,9 contra 2,0) y pierde en las ventanas juntas
    (2,3 contra 1,7). Pasado su p50, la 0.1.0 dice "casi nada", y al final eso suele acertar, aunque su
    rango cubre menos de la mitad de las veces.
  - En el implementador con todas sus corridas, gana: 5,9 contra 7,7 min.
- **Cómo leer el titular.** Con solo los encargos (386 corridas de la semana de prueba, sin las
  reanudaciones), la 0.2 gana el primer tercio en error (4,5 [3,9–5,3] contra 5,7 [4,7–6,4] min: los
  intervalos se cruzan), casi empata el segundo (3,9 contra 4,2) y pierde el último (3,3 [2,9–3,7] contra
  2,1 [1,8–2,5]). Gana en cobertura en los tres (80% / 85% / 82% contra 40% / 42% / 48%), con un rango un
  53% más ancho (15,6 contra 10,2 min). Buena parte de la ventaja de error del total viene de las
  reanudaciones, donde la 0.1.0 daba la duración de un encargo nuevo. En las tres ventanas juntas,
  también solo con encargos (2.175 corridas), sale parecido, con el segundo tercio algo más a favor de la
  0.2: 4,6 / 3,6 / 3,2 min contra 5,4 / 4,3 / 2,4, y cobertura de 79% / 87% / 82% contra 41% / 44% / 51%.
- **Mecánico y general-purpose** tienen pocas corridas de prueba (9 y 25) y una cobertura baja en el
  último tercio (54% y 49%).
- **`calculando` en octubre (23%)**: el rol implementador nació el 1-oct y al 10-oct no tenía 20
  corridas. "Calculando" es lo honesto.

### El silencio

**Cómo se eligió.** Sin mirar la prueba: con las corridas de entrenamiento, se arman tablas con el 75% más
antiguo y se prueba en el 25% más reciente. La prueba se hace en las fotos pasada la duración típica, sin
informe visible y con al menos tanto silencio. Se usa donde el error mediano baja al menos un 10% sin
perder más de 5 puntos de cobertura, con al menos 15 corridas de validación. Se probaron umbrales de 0,3,
0,6 y 1 min.
- **En el entrenamiento del holdout** eligió investigador (desde 0,3 min), revisor (0,6), verificador
  (0,3) y revisor-crítico (1,0).
- **El implementador queda fuera.** En su validación el error *subía*: 7,6 contra 5,8 min desde 0,6 min,
  y 10,3 contra 5,8 desde 1 min. Coincide con lo que midió el investigador.

**Efecto en la semana de prueba.**

| Rol | Fotos donde decidió (corridas) | Error con silencio | Error sin silencio | Cobertura con / sin |
|---|---|---|---|---|
| investigador | 94 (18) | 1,2 | 2,7 | 98% / 91% |
| revisor | 53 (18) | 1,4 | 2,6 | 94% / 93% |
| verificador | 115 (33) | 1,3 | 1,7 | 86% / 87% |

(El revisor-crítico decidió una sola foto, de una corrida: no cuenta.)

En el último tercio de esos roles: investigador 3,3 → 2,9 min, revisor 2,1 → 1,9, verificador 1,8 → 1,5.
En total, 3,4 → 3,4 (sin cambio a un decimal).

**Inestable con pocos datos.** Con todas las corridas, para las tablas finales, eligió investigador 0,3,
revisor 0,3 y verificador 1,0; revisor-crítico quedó fuera. En las ventanas de octubre casi no eligió
nada, porque no había 15 corridas de validación tardías.

### El retraso del informe

Con el informe partiendo en el último resultado, como en la versión 1, el error del último tercio en la
semana de prueba sería de 3,1 min y la cobertura de 83%. Con el retraso real sorteado (mediana 11 s, p90
39 s) queda en 3,4 min y 81%; con 39 s fijos, en 3,6 min y 79%. En las fotos de informe el error sigue en
0,2 min con el retraso real (0,4 con 39 s fijos), y la cobertura de esa fase es de 74% sin retraso, 80%
con el real y 85% con 39 s fijos, sobre una parte cada vez menor de las fotos (5%, 3% y 1%). El efecto es
chico, y los números de arriba ya lo incluyen.

## Qué se probó y cómo se eligió

**Advertencia de honestidad.** En la versión 1, la variante de etapa se eligió mirando las tres ventanas
juntas, noviembre incluido. En esta revisión se volvió a elegir **solo con las dos ventanas de octubre**,
y salió la misma (error y ancho más bajos en ambas). El ensanche [1,7, 1] también se calibró solo con
octubre, ahora con la segmentación nueva: cobertura de 79% y 84%. Noviembre queda como prueba limpia del
método. Los umbrales de confianza siguen siendo los de la versión 1, que sí miraron las tres ventanas.

Ventanas de octubre, ensanche [1,7, 1]:

| Variante | 10-oct: error / cobertura / ancho | 25-oct: error / cobertura / ancho |
|---|---|---|
| Solo tiempo (supervivencia por rol+modelo) | 3,9 / 81% / 18,2 | 3,8 / 86% / 17,2 |
| + fase actual | 3,8 / 79% / 14,6 | 3,7 / 85% / 16,2 |
| + etapa (explora/editó/probó/commit) | 3,9 / 79% / 16,1 | 3,7 / 86% / 15,6 |
| + llamadas sobre las típicas | 3,7 / 80% / 14,2 | 3,7 / 85% / 15,2 |
| **+ llamadas y etapa (elegida)** | **3,6 / 79% / 14,2** | **3,6 / 84% / 14,5** |

| Ensanche hacia abajo | 10-oct: cobertura | 25-oct: cobertura | Ancho |
|---|---|---|---|
| 1 (los cuantiles tal cual) | 67% | 73% | ~13 |
| 1,4 | 75% | 81% | ~14 |
| **1,7 (elegido)** | **79%** | **84%** | ~14 |
| 2 | 81% | 87% | ~15 |

La fase sí dice algo: un implementador que todavía explora va en el 13% de su corrida; uno que ya probó,
en el 57%. Pero pesa menos que el tiempo que lleva. Sola, como etapa, no mejora más allá del ruido.
Combinada con las llamadas da los rangos más angostos con la misma cobertura. Donde la fase pesa de verdad
es en el informe, con error de 0,2 min. El final se ve mejor en el silencio, en los roles donde sirve.

## Confianza

`alta`: celda propia del rol y modelo, al menos 40 corridas y un rango de a lo más 0,9 × la duración
total estimada. `media`: al menos 25 corridas y a lo más 1,4 ×. El resto es `baja`. Un agente que el mod
encontró ya corriendo baja un escalón, y una reanudación con las tablas de todos los agentes es `baja`.

| Confianza | Semana de prueba: fotos / cobertura / error / error sobre la duración | Ventanas juntas: fotos / cobertura / error / error sobre la duración |
|---|---|---|
| alta | 14% / 88% / 2,3 min / 13% | 8% / 88% / 2,6 min / 14% |
| media | 42% / 83% / 4,2 min / 26% | 44% / 84% / 3,8 min / 25% |
| baja | 43% / 79% / 4,1 min / 44% | 48% / 79% / 3,7 min / 41% |

`alta` cubre más (88% contra 79%) y se equivoca menos (2,3–2,6 min, 13–14% de la duración, contra
41–44%). Entre `media` y `baja` el error absoluto es parecido, porque `baja` junta muchos agentes cortos;
el error relativo sí separa con claridad.

## Las tablas

`hooks/tablas.ts`: 69,8 KB y 42 grupos, con 5.310 corridas hasta el 16-nov:
- rol y rol+modelo con al menos 30 corridas, y sus reanudaciones (`implementador#r`, `*#r`);
- las tablas de informe y la de silencio.

Solo números y nombres de rol y modelo. La fecha del encabezado es la de la última corrida, así que
regenerar es determinista: con los mismos transcripts sale el mismo archivo (mismo hash). Una estimación
toma unos 0,002 ms.

## Comandos

```
node herramientas/tablas.mjs              # relee los transcripts y regenera hooks/tablas.ts (≈35 s)
node herramientas/dataset.mjs             # refresca la caché datos/corridas.jsonl (ignorada por git)
node herramientas/evaluar.mjs             # holdout 9–16 nov con intervalos, confianza, fases y silencio
node herramientas/evaluar.mjs --resumen --roles --ic --confianza   # evaluación móvil de 3 ventanas
node herramientas/evaluar.mjs --retraso 0     # el informe en el último resultado (sin retraso)
node herramientas/evaluar.mjs --sin-silencio  # sin la tabla de silencio
node herramientas/evaluar.mjs --resumen --modo nada   # otra variante (también --ensanche 1,1 --vida 0 …)
```

`evaluar.mjs` usa la caché si existe. Después de cambiar `fase.ts` o `dataset.mjs`, corre `dataset.mjs`
(o `evaluar.mjs --fresco`).

## Medición en vivo (16-nov)

Agentes reales de una sesión de trabajo, medidos por el propio mod (una foto por minuto, comparada al
terminar con lo que de verdad faltaba). Datos crudos en `datos/vivo/` (ignorados por git).

| Lote | Estimador | Agentes (con rango) | Fotos con rango | Error mediano | Rango acertó |
|---|---|---|---|---|---|
| 1 | ronda 1 | 6 (6) | 84 | 7,2 min | 77% |
| 2 | ronda 2 | 8 (5) | 61 | 3,1 min | 87% |
| juntos | | 14 (11) | 145 | 6,1 min | 81% |

- Los lotes son agentes distintos: no es una comparación pareada. Repetir el lote 1 con el estimador de la
  ronda 2 (tablas sin esos agentes) casi no lo cambia: 6,8 min y 70% en los 5 pedidos; el implementador de
  ese lote sí mejora (8,1 → 4,8 min, rango de 77 a 32 min de ancho).
- El lote 1 fue de corridas atípicamente largas: el verificador duró 19,8 min (solo 8 de 419 verificadores
  del historial duraron eso o más). Ahí falla cualquier estimador basado en lo típico.
- 3 de los 8 agentes del lote 2 quedaron en `calculando` (explorador, auditor-producto, un mecánico de 1 min):
  sin historial suficiente del rol, el mod no da número.
- La entrada que arma `dataset.mjs` coincide con lo que vio el mod en vivo: modelo y llamadas 6/6, fase
  84/86 fotos. Las dos que difieren son el momento exacto en que se detecta el informe.

## Abierto

- **El último tercio, fuera de los roles con silencio**: en los encargos del implementador, mecánico y
  general-purpose la 0.1.0 todavía tiene menos error al final, aunque cubre la mitad.
- **El silencio con pocos datos**: qué roles lo usan y desde cuántos minutos cambia según cuántas
  corridas haya. Conviene revisarlo cada vez que se regeneren las tablas.
- **Reanudaciones fuera del implementador**: son pocas (revisor-crítico tiene 21; los demás, menos de 15)
  y usan las de todos los agentes.
- **Su cobertura**: 67% y 76% en el primer y el último tercio de las ventanas juntas (76% y 77% en la
  semana de prueba), por debajo de la meta. Las reanudaciones son muy dispares: una pregunta corta o una
  tarea nueva entera.
- **La lista de pasos no está validada**: los subagentes casi no la usan (1 TaskCreate y 3 TaskUpdate en
  todo el histórico).
- **Forks**: no hay ninguno en los transcripts, así que quedan en `calculando`.
- **El retraso del informe** se simuló con una log-normal de dos cuantiles medidos, no con la
  distribución real por corrida.
- El mod mide su propia precisión en vivo (pieza B). Cuando junte unas semanas, conviene compararla con
  la de aquí y volver a correr `tablas.mjs`.
