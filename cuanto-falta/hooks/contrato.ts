// Contrato compartido entre las tres piezas del mod (estimador, seguimiento, vista).
// NINGUNA PIEZA LO EDITA: si hace falta un cambio, se reporta a la sesión principal.
// Todo aquí es JSON plano: cabe en $.state y en las props de un Client.

/** En qué está el agente ahora, según su última llamada a herramienta o lo que escribe. */
export type Fase =
  | 'arrancando' // todavía sin llamadas a herramientas
  | 'leyendo' // Read/Grep/Glob, Bash de solo lectura (cat, sed -n, grep, rg, find, ls, git diff/log/show)
  | 'investigando' // WebSearch, WebFetch y lecturas de la web
  | 'editando' // Edit/Write/MultiEdit/NotebookEdit, Bash que escribe archivos (sed -i, heredoc, mv, rm)
  | 'probando' // tests, typecheck, build, lint, correr el programa para verlo funcionar
  | 'navegando' // navegador, simulador, computer-use, capturas
  | 'commit' // git add/commit/push, gh pr create
  | 'delegando' // lanzó un subagente o un workflow y lo espera
  | 'informe' // escribe la respuesta final: texto sin herramientas

/** Cómo se dice cada fase en la interfaz (corto, en minúscula, sin jerga). */
export const TEXTO_FASE: Record<Fase, string> = {
  arrancando: 'arrancando',
  leyendo: 'leyendo el código',
  investigando: 'buscando en la web',
  editando: 'editando',
  probando: 'corriendo pruebas',
  navegando: 'probando en pantalla',
  commit: 'haciendo commit',
  delegando: 'esperando a su subagente',
  informe: 'escribiendo el informe',
}

/** La lista de pasos que lleva el propio agente (TodoWrite o TaskCreate/TaskUpdate), como se guarda. */
export type EstadoLista = Record<string, { titulo: string; estado: 'pendiente' | 'en-curso' | 'hecha' }>

/** Resumen de esa lista para estimar y dibujar. */
export type ListaPasos = { hechos: number; total: number; actual?: string }

/** Lo que el estimador sabe de un agente en curso. */
export type EntradaEstimador = {
  /** Tipo normalizado: implementador, revisor, revisor-critico, verificador, investigador, mecanico,
   *  explorador, auditor, general-purpose, workflow-subagent, fork, ... */
  rol: string
  /** Id del modelo que usa (claude-opus-5-5, claude-sonnet-5-5, claude-fable-5-2, claude-haiku-5-5); sin saber aún, undefined. */
  modelo?: string
  /** Minutos desde que arrancó. Si inicioAprox, es un mínimo. */
  llevaMin: number
  /** Llamadas a herramientas hasta ahora. */
  llamadas: number
  fase: Fase
  /** Minutos desde que entró en la fase actual. */
  faseDesdeMin: number
  /** Fases por las que ya pasó, en el orden en que entró a cada una por primera vez. */
  vistas: Fase[]
  lista?: ListaPasos
  /** El mod lo encontró ya corriendo: su inicio y sus llamadas son aproximados. */
  inicioAprox: boolean
  /** Es una reanudación (SendMessage a un agente que ya había terminado su turno): llevaMin cuenta
   *  desde que se reanudó, y se estima con las tablas de reanudaciones, que son mucho más cortas. */
  reanudacion?: boolean
  /** Minutos desde que volvió el resultado de su última herramienta, sin ninguna llamada en vuelo.
   *  undefined mientras alguna herramienta corre o antes de la primera llamada. Pasada la mediana del
   *  rol, un silencio largo suele ser el cierre (piensa o escribe el informe). */
  silencioMin?: number
}

export type Confianza = 'alta' | 'media' | 'baja'

/** Lo que falta. Nunca un número inventado: sin datos, 'calculando'; fuera de todo lo visto, 'pasado'. */
export type Estimacion =
  | { estado: 'calculando'; motivo: string }
  | {
      estado: 'rango'
      /** Minutos que faltan: el rango que se muestra (bajo–alto) y el centro. */
      bajoMin: number
      altoMin: number
      medioMin: number
      confianza: Confianza
      /** Avance estimado 0–1, para dibujar. */
      progreso: number
      /** De dónde sale, en palabras: "fase de pruebas · 3 de 5 pasos · 140 corridas de implementador". */
      motivo: string
    }
  | {
      estado: 'pasado'
      /** Lo que suele durar una corrida así (minutos), para decir "ya pasó lo típico (~25 min)". */
      tipicoMin: number
      motivo: string
    }

/** Un agente como lo dibuja la vista. */
export type AgenteVista = {
  id: string
  rol: string
  /** Legible: "Opus 5.5", "Sonnet 5.5", "Fable 5.2", "Haiku 5.5". */
  modelo?: string
  descripcion: string
  llevaMin: number
  inicioAprox: boolean
  fase: Fase
  faseDesdeMin: number
  vistas: Fase[]
  llamadas: number
  lista?: ListaPasos
  estimacion: Estimacion
  /** Id del workflow al que pertenece. */
  flujo?: string
  /** Bloquea a quien lo lanzó (no corre en segundo plano). */
  enPrimerPlano: boolean
}

export type FlujoVista = {
  id: string
  nombre: string
  /** Títulos de las fases del script, si los declara. */
  fases: string[]
  llevaMin: number
  listos: number
  enCurso: number
  lanzados: number
  /** Corre en la nube: su avance no se ve desde aquí. */
  remoto: boolean
}

/** Todo lo que la vista necesita, ya calculado. La vista no lee $.state ni estima nada. */
export type ModeloVista = {
  ahora: number
  /** Ordenados por inicio (posición estable: el ojo no persigue filas que saltan). */
  agentes: AgenteVista[]
  flujos: FlujoVista[]
  /** Tipos de los agentes en cola (pendientes). */
  cola: string[]
  /** Hasta que termine lo último que corre. */
  total: Estimacion
  /** Hay algo que no se puede estimar (un workflow que puede lanzar más, un agente 'pasado' o 'calculando'). */
  totalIncompleto: boolean
  /** Estado de la sesión principal en palabras: "trabajando hace 3 min", "espera a implementador", "esperando tu mensaje". */
  principal: string
  /** Minutos desde que empezó la tarea en curso. */
  tareaMin?: number
  /** Gasto de la tarea en curso, ya formateado: "US$ 4,10", "1,2% de la semana". */
  gasto?: { costo?: string; semana?: string }
  /** Resumen de la última tarea terminada, ya formateado (solo cuando no corre nada). */
  ultima?: string
  /** Lo que el mod midió de sí mismo: agentes terminados con estimación, error típico y cobertura del rango. */
  precision?: { agentes: number; errorMedianoMin: number; cobertura: number }
}
