// Contrato de lo que el mod guarda en $.state (sobrevive a una recarga del mod, no a la sesión)
// y en $.store (sobrevive a la sesión).
// El validador exige que este archivo no importe nada: `Fase` y `EstadoLista` repiten, tal cual, los
// tipos de hooks/contrato.ts (TypeScript los trata como el mismo tipo porque su forma es idéntica).

/** Igual que `Fase` de hooks/contrato.ts. */
export type Fase =
  | 'arrancando'
  | 'leyendo'
  | 'investigando'
  | 'editando'
  | 'probando'
  | 'navegando'
  | 'commit'
  | 'delegando'
  | 'informe'

/** Igual que `EstadoLista` de hooks/contrato.ts. */
export type EstadoLista = Record<string, { titulo: string; estado: 'pendiente' | 'en-curso' | 'hecha' }>

/** Un agente que sigue corriendo. Tiempos en ms de $.clock.now(). */
export type Agente = {
  id: string
  /** Tipo con el que se estima (`implementador`, `workflow-subagent`, ...). */
  tipo: string
  descripcion: string
  inicio: number
  /** Llamadas a herramientas contadas hasta el último volcado (el reloj las vuelca cada 10 s). */
  llamadas: number
  /** El agente bloquea al que lo lanzó (no corre en segundo plano). */
  enPrimerPlano: boolean
  /** Lo lanzó la sesión principal. */
  deMain: boolean
  /** runId del workflow al que pertenece, si es de uno. */
  flujo?: string
  /** Solo se mide de corridas vistas desde su spawn (las reanudaciones también, marcadas). */
  aprende: boolean
  /** Ya corría cuando el mod se cargó: el inicio es aproximado (un mínimo). */
  inicioAprox?: boolean
  /** Ya apareció en `$.agent.list()`. */
  visto?: boolean
  /** Veces seguidas que `$.agent.list()` no lo listó después de haberlo visto. */
  ausente?: number
  /** Cuándo la lista o SubagentStop lo dieron por terminado; sale una vuelta después si no llegó su turn.complete. */
  terminado?: number
  /** Id del modelo con el que corre (el último que dijo `turn.step`). */
  modelo?: string
  /** En qué está ahora. */
  fase: Fase
  /** Desde cuándo está en esa fase. */
  faseDesde: number
  /**
   * Fases de trabajo por las que ya pasó, en el orden en que entró a cada una por primera vez
   * (incluye la actual; `arrancando` nunca entra: es el punto de partida, no una fase que se cruza).
   */
  vistas: Fase[]
  /** Su lista de pasos (TodoWrite o TaskCreate/TaskUpdate), si lleva una. */
  lista?: EstadoLista
  /** Corre por una reanudación (`agent.spawn` con `resume`): su reloj parte de nuevo y se estima aparte. */
  reanudacion?: true
  /** Fase y desde cuándo, antes de entrar a `informe` o a `delegando`: a ella vuelve. */
  previa?: { fase: Fase; desde: number }
  /** `informe` no estaba en `vistas` antes de entrar: si era un falso aviso, se saca. */
  informeNuevo?: true
  /** 0.1.0: hoy se llama `llamadas`. Solo se lee, para no perder el conteo tras una recarga. */
  pasos?: number
}

/** Un workflow lanzado en esta sesión. */
export type Flujo = {
  id: string
  taskId?: string
  nombre: string
  fases: string[]
  inicio: number
  /** Agentes que el workflow lanzó hasta ahora (no se sabe cuántos más lanzará). */
  lanzados: number
  listos: number
  ultimaActividad: number
  /** Ya apareció en la lista de tareas de fondo (Stop/SubagentStop): su salida de la lista marca el fin. */
  visto?: boolean
  remoto?: boolean
}

/** Turno en curso de la sesión principal. */
export type Turno = { inicio: number }

/** La tarea: desde que algo empezó a trabajar hasta que no queda nada corriendo. */
export type Tarea = {
  inicio: number
  costo0?: number
  semana0?: number
  agentes: number
  flujos: number
}

/** Última lectura de $.session.usage(). */
export type Uso = { costo?: number; semana?: number }

/** Resumen de la última tarea terminada. */
export type Resumen = {
  fin: number
  minutos: number
  agentes: number
  flujos: number
  costo?: number
  semana?: number
}

/**
 * Foto de lo que el mod estimaba de un agente, tomada cada minuto de su corrida:
 * `[llevaMin, estado, bajoMin, medioMin, altoMin, fase, confianza]`.
 *
 * - estado: `r` rango, `c` calculando, `p` pasado.
 * - En `c` van ceros; en `p` el medio guarda lo típico (`tipicoMin`) y bajo y alto van en cero.
 * - confianza: `a` alta, `m` media, `b` baja, o `''` si no es un rango.
 */
export type Foto = [number, 'r' | 'c' | 'p', number, number, number, Fase, 'a' | 'm' | 'b' | '']

/**
 * Un agente terminado que el mod vio de punta a punta, con sus fotos. Lo que faltaba de verdad en cada
 * foto es `durMin - foto[0]`. Se guarda en `$.store` (`mediciones`, los últimos 300, de respaldo) y como una línea JSON en
 * `~/.claude/cuanto-falta/mediciones/<sesión>.jsonl` (un archivo por sesión, las últimas 300 por archivo).
 * Nunca lleva descripciones ni prompts.
 */
export type Medicion = {
  /** Cuándo terminó (ms del reloj de la sesión). */
  t: number
  rol: string
  modelo?: string
  /** Minutos de corrida medidos con el mismo reloj que las fotos. */
  durMin: number
  llamadas: number
  fotos: Foto[]
  /** Fue una reanudación: se mide igual, pero marcada para poder separar su precisión. */
  reanudacion?: true
}

/** Lo que el mod midió de sí mismo, resumido (el contrato de la vista lo muestra). */
export type Precision = { agentes: number; errorMedianoMin: number; cobertura: number }

declare module 'claude-code' {
  interface PluginState {
    'cuanto-falta': {
      agentes: Record<string, Agente>
      flujos: Record<string, Flujo>
      turno: Turno | null
      tarea: Tarea | null
      uso: Uso | null
      cola: string[]
      ahora: number
      ultima: Resumen | null
      panelCerrado: boolean
      /** Fotos de los agentes en curso, por id; se vacían al terminar cada uno. */
      fotos: Record<string, Foto[]>
      /** Resumen de las mediciones de todas las sesiones, para que la vista no lea archivos en cada dibujo. */
      precision: Precision | null
    }
  }
}
