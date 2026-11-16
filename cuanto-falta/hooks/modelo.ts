// Lo que sabe el mod, sin motor: las transiciones de estado de cada agente, el ModeloVista que
// recibe la vista y la medición de la propia precisión. Todo son funciones puras (el estimador, el
// clasificador de fases y la lista de pasos se pueden inyectar), así se prueban sin simular el motor.
import type { SessionMessage } from 'claude-code'

import type { Agente, Flujo, Foto, Medicion, Precision, Resumen, Tarea, Turno, Uso } from '../types'
import { TEXTO_FASE } from './contrato'
import type {
  AgenteVista,
  Confianza,
  EntradaEstimador,
  EstadoLista,
  Estimacion,
  Fase,
  FlujoVista,
  ModeloVista,
} from './contrato'
import { actualizarLista, clasificar, resumirLista } from './fase'
import { estimar } from './estimar'
import { dolares, duracion, modeloLegible, nombreRol, plural, porcentaje, rango } from './formato'

export const TIPO_GENERICO = 'general-purpose'
export const TIPO_WORKFLOW = 'workflow-subagent'

/** Herramientas con las que un agente lanza a otro y lo espera. */
export const ES_DELEGACION = new Set(['Agent', 'Task', 'Workflow'])
/** Herramientas que escriben la lista de pasos del agente. */
export const ES_LISTA = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
/** Un paso con al menos tanto texto y sin herramientas todavía es el informe final. */
export const MIN_TEXTO_INFORME = 200

const MIN = 60_000

export function limpio<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// ——— Lo que observa el seguimiento y cómo se aplica al estado ———

/** Una observación de un agente, en el orden en que ocurrió. El reloj las aplica al estado cada 10 s. */
export type Evento =
  /** Una llamada a herramienta (`n` seguidas iguales). `fase` es lo que dijo el clasificador (null = se mantiene). */
  | { k: 'llamada'; fase: Fase | null; sobre: boolean; n: number }
  /** Lanzó un agente o un workflow y lo espera. */
  | { k: 'delegar' }
  /** Volvió lo último que esperaba. */
  | { k: 'regreso' }
  /** Un paso lleva texto de informe y todavía ninguna herramienta. */
  | { k: 'informe' }
  /** Después del texto vino una herramienta: no era el informe. */
  | { k: 'sinInforme' }
  | { k: 'lista'; tool: string; input: unknown; resultado: unknown }
  | { k: 'modelo'; modelo: string }

type Dependencias = {
  actualizarLista?: typeof actualizarLista
  clasificar?: typeof clasificar
}

/** Un registro de 0.1.0 o a medio llenar queda completo. */
export function normalizar(a: Agente): Agente {
  const { pasos, ...resto } = a
  return {
    ...resto,
    llamadas: a.llamadas ?? pasos ?? 0,
    fase: a.fase ?? 'arrancando',
    faseDesde: a.faseDesde ?? a.inicio,
    vistas: a.vistas ?? [],
  }
}

export function agenteNuevo(base: Pick<Agente, 'id' | 'tipo' | 'descripcion' | 'inicio'> & Partial<Agente>): Agente {
  return normalizar(
    limpio({
      enPrimerPlano: false,
      deMain: true,
      aprende: false,
      llamadas: 0,
      fase: 'arrancando' as Fase,
      faseDesde: base.inicio,
      vistas: [] as Fase[],
      ...base,
    }),
  )
}

function entrar(a: Agente, fase: Fase, ahora: number): Agente {
  if (a.fase === fase) return a
  // `arrancando` es de dónde se parte: no cuenta como una fase por la que se pasó.
  const vistas = fase === 'arrancando' || a.vistas.includes(fase) ? a.vistas : [...a.vistas, fase]
  return { ...a, fase, faseDesde: ahora, vistas }
}

/** Qué fase dice la herramienta. Las que delegan no se clasifican aquí: las maneja la cuenta de las que están en vuelo. */
export function eventoDeLlamada(tool: string, input: unknown, sobre: boolean, clasif: typeof clasificar = clasificar): Evento {
  let fase: Fase | null = null
  if (!ES_DELEGACION.has(tool)) {
    try {
      fase = clasif(tool, input)
    } catch {
      fase = null
    }
  }
  return { k: 'llamada', fase, sobre, n: 1 }
}

/** Aplica, en orden, lo observado a un agente. Pura: se puede repetir sobre el último estado sin duplicar nada. */
export function aplicarEventos(agente: Agente, eventos: readonly Evento[], ahora: number, deps: Dependencias = {}): Agente {
  const lista = deps.actualizarLista ?? actualizarLista
  let a = normalizar(agente)
  for (const ev of eventos) {
    switch (ev.k) {
      case 'llamada': {
        a = { ...a, llamadas: a.llamadas + ev.n }
        if (ev.fase) {
          // Mientras espera a un subagente la fase sigue siendo `delegando`: a lo que haga aparte vuelve después.
          if (ev.sobre && a.fase === 'delegando') {
            const vistas = ev.fase === 'arrancando' || a.vistas.includes(ev.fase) ? a.vistas : [...a.vistas, ev.fase]
            a = { ...a, previa: { fase: ev.fase, desde: ahora }, vistas }
          } else a = entrar(a, ev.fase, ahora)
        }
        break
      }
      case 'delegar': {
        const previa = a.fase === 'delegando' ? a.previa : { fase: a.fase, desde: a.faseDesde }
        a = entrar(previa ? { ...a, previa } : a, 'delegando', ahora)
        break
      }
      case 'regreso': {
        if (a.fase !== 'delegando') break
        const vuelve = a.previa?.fase
        const { previa: _previa, ...sin } = a
        // Si antes no había hecho nada, `arrancando` sería retroceder: se queda en `delegando` hasta su siguiente llamada.
        a = !vuelve || vuelve === 'arrancando' || vuelve === 'delegando' ? sin : entrar(sin, vuelve, ahora)
        break
      }
      case 'informe': {
        if (a.fase === 'informe') break
        const nuevo = !a.vistas.includes('informe')
        a = entrar({ ...a, previa: { fase: a.fase, desde: a.faseDesde }, ...(nuevo ? { informeNuevo: true as const } : {}) }, 'informe', ahora)
        break
      }
      case 'sinInforme': {
        if (a.fase !== 'informe') break
        const { previa, informeNuevo, ...sin } = a
        const vistas = informeNuevo ? sin.vistas.filter(f => f !== 'informe') : sin.vistas
        const vuelve = previa?.fase ?? 'arrancando'
        // Era un pedazo de texto antes de una herramienta: vuelve a lo que hacía, con su hora de entrada.
        a = { ...sin, fase: vuelve, faseDesde: previa?.desde ?? ahora, vistas }
        break
      }
      case 'lista': {
        try {
          a = { ...a, lista: lista(a.lista, ev.tool, ev.input, ev.resultado) }
        } catch {
          /* una lista que no se entiende no tumba el seguimiento */
        }
        break
      }
      case 'modelo':
        a = { ...a, modelo: ev.modelo }
        break
    }
  }
  return limpio(a)
}

/**
 * Lo que se puede reconstruir de un agente que ya corría cuando el mod se cargó, a partir de sus mensajes:
 * llamadas, fases, lista de pasos y si espera a un subagente. El modelo y la hora de inicio no vienen ahí.
 */
export function reconstruirDeMensajes(
  mensajes: readonly SessionMessage[],
  deps: Dependencias = {},
): Pick<Agente, 'llamadas' | 'fase' | 'vistas' | 'lista' | 'previa'> {
  const clasif = deps.clasificar ?? clasificar
  const eventos: Evento[] = []
  let ultimoSinHerramientas = ''
  for (const m of mensajes) {
    if (m.role !== 'assistant') continue
    const usos = m.toolUses ?? []
    ultimoSinHerramientas = usos.length === 0 ? (m.text ?? '') : ''
    for (const u of usos) {
      const contestada = u.result !== undefined || u.text !== undefined
      eventos.push(eventoDeLlamada(u.tool, u.input, false, clasif))
      if (ES_DELEGACION.has(u.tool)) {
        eventos.push({ k: 'delegar' })
        if (contestada) eventos.push({ k: 'regreso' })
      } else if (ES_LISTA.has(u.tool) && contestada && !u.isError) {
        eventos.push({ k: 'lista', tool: u.tool, input: u.input, resultado: u.result ?? u.text })
      }
    }
  }
  if (ultimoSinHerramientas.length >= MIN_TEXTO_INFORME) eventos.push({ k: 'informe' })
  const base = agenteNuevo({ id: '', tipo: '', descripcion: '', inicio: 0 })
  const { llamadas, fase, vistas, lista, previa } = aplicarEventos(base, eventos, 0, deps)
  return limpio({ llamadas, fase, vistas, lista, previa })
}

// ——— El ModeloVista ———

export type EntradaModelo = {
  ahora: number
  agentes: readonly Agente[]
  flujos: readonly Flujo[]
  cola: readonly string[]
  turno: Turno | null
  tarea: Tarea | null
  uso: Uso | null
  ultima: Resumen | null
  precision?: Precision | null
  /** Por agente, la hora en que volvió su última llamada pendiente (solo de los que no tienen ninguna en vuelo). */
  silencioDesde?: Readonly<Record<string, number>>
}

/** El reloj del modelo: lo último que se guardó o lo más reciente que se sabe de un inicio. */
export function ahoraDe(guardado: number, agentes: readonly Agente[], turno: Turno | null): number {
  return Math.max(guardado, ...agentes.filter(a => !a.terminado).map(a => a.inicio), turno?.inicio ?? 0)
}

export function entradaEstimador(a: Agente, ahora: number, silencioDesde?: number): EntradaEstimador {
  return limpio({
    rol: a.tipo,
    modelo: a.modelo,
    llevaMin: Math.max(0, ahora - a.inicio) / MIN,
    llamadas: a.llamadas,
    fase: a.fase,
    faseDesdeMin: Math.max(0, ahora - a.faseDesde) / MIN,
    vistas: a.vistas,
    lista: resumirLista(a.lista),
    inicioAprox: !!a.inicioAprox,
    reanudacion: a.reanudacion ? true : undefined,
    // Desde que volvió su última herramienta, con ninguna en vuelo; sin dato mientras alguna corre.
    silencioMin: silencioDesde !== undefined ? Math.max(0, ahora - silencioDesde) / MIN : undefined,
  })
}

function estimarSeguro(estimador: (e: EntradaEstimador) => Estimacion, entrada: EntradaEstimador): Estimacion {
  try {
    return estimador(entrada)
  } catch {
    return { estado: 'calculando', motivo: 'no se pudo estimar' }
  }
}

const ORDEN_CONFIANZA: Record<Confianza, number> = { baja: 0, media: 1, alta: 2 }

/**
 * Lo que le falta a un agente como una distribución: su rango son cuantiles (bajo ≈ p10, medio = p50, alto ≈ p90) y
 * entre ellos la probabilidad crece en línea recta. Por debajo de `bajo` y por encima de `alto` sigue con la pendiente
 * del tramo vecino, hasta 0 de probabilidad (sin pasar del minuto 0) y hasta 1 (sin pasar de 2×alto).
 */
type Curva = { puntos: [number, number][]; fin: number }

const EPS_MIN = 1e-6

function curvaDe(bajoMin: number, medioMin: number, altoMin: number): Curva {
  const b = Math.max(0, bajoMin)
  const m = Math.max(medioMin, b + EPS_MIN)
  const a = Math.max(altoMin, m + EPS_MIN)
  const bajada = 0.4 / (m - b) // probabilidad por minuto entre p10 y p50
  const subida = 0.4 / (a - m) // entre p50 y p90
  const t0 = Math.max(0, b - 0.1 / bajada)
  const t1 = Math.min(a + 0.1 / subida, 2 * a)
  const p0 = Math.max(0, 0.1 - bajada * (b - t0)) // sobre cero solo si el minuto 0 llega antes: queda masa en 0
  const p1 = Math.min(1, 0.9 + subida * (t1 - a))
  return { puntos: [[t0, p0], [b, 0.1], [m, 0.5], [a, 0.9], [t1, p1]], fin: t1 }
}

/** Probabilidad de que el agente haya terminado a los `t` minutos. */
function acumulada(c: Curva, t: number): number {
  const p = c.puntos
  if (t < p[0]![0]) return 0
  if (t >= c.fin) return 1 // lo que falte para 1 es masa que cae justo en `fin`
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1]!
    const [x1, y1] = p[i]!
    if (t <= x1) return x1 > x0 ? y0 + ((y1 - y0) * (t - x0)) / (x1 - x0) : y1
  }
  return 1
}

/**
 * Cuándo terminan todos: la probabilidad de que todos hayan terminado a los t minutos es el producto de las suyas
 * (agentes independientes), y de ahí se leen p10, p50 y p90. Con un solo agente es su propio rango, tal cual.
 * Tomar el máximo de los bajo/medio/alto es optimista: con 5 agentes parecidos el máximo de los altos acierta ~59%.
 */
function rangoConjunto(rangos: readonly { bajoMin: number; medioMin: number; altoMin: number }[]): { bajoMin: number; medioMin: number; altoMin: number } {
  if (rangos.length === 1) return { bajoMin: rangos[0]!.bajoMin, medioMin: rangos[0]!.medioMin, altoMin: rangos[0]!.altoMin }
  const curvas = rangos.map(r => curvaDe(r.bajoMin, r.medioMin, r.altoMin))
  const todos = (t: number) => curvas.reduce((p, c) => p * acumulada(c, t), 1)
  const cuantil = (q: number) => {
    if (todos(0) >= q) return 0
    let lo = 0
    let hi = Math.max(...curvas.map(c => c.fin))
    for (let i = 0; i < 60; i++) {
      const medio = (lo + hi) / 2
      if (todos(medio) >= q) hi = medio
      else lo = medio
    }
    return hi
  }
  return { bajoMin: cuantil(0.1), medioMin: cuantil(0.5), altoMin: cuantil(0.9) }
}

function totalDe(agentes: readonly AgenteVista[]): Estimacion {
  const rangos = agentes.flatMap(a => (a.estimacion.estado === 'rango' ? [{ a, e: a.estimacion }] : []))
  if (rangos.length) {
    const ultimo = rangos.reduce((x, y) => (y.e.medioMin > x.e.medioMin ? y : x))
    const { bajoMin, medioMin, altoMin } = rangoConjunto(rangos.map(r => r.e))
    const lleva = Math.max(...agentes.map(a => a.llevaMin))
    return {
      estado: 'rango',
      bajoMin,
      altoMin: Math.max(bajoMin, altoMin),
      medioMin,
      confianza: ultimo.e.confianza,
      progreso: lleva + medioMin > 0 ? Math.min(1, lleva / (lleva + medioMin)) : 0,
      motivo: `lo último en terminar: ${nombreRol(ultimo.a.rol)}${agentes.length > 1 ? ` (${plural(agentes.length, 'agente corriendo', 'agentes corriendo')})` : ''}`,
    }
  }
  const pasados = agentes.flatMap(a => (a.estimacion.estado === 'pasado' ? [a.estimacion] : []))
  if (pasados.length) {
    return { estado: 'pasado', tipicoMin: Math.max(...pasados.map(p => p.tipicoMin)), motivo: 'ya pasó lo típico de lo que corre' }
  }
  return { estado: 'calculando', motivo: agentes.length ? 'calculando lo que falta' : 'sin agentes corriendo' }
}

function unicos(xs: readonly string[]): string[] {
  return [...new Set(xs)]
}

/** La sesión principal en palabras: "trabajando hace 3 min", "espera a implementador", "esperando tu mensaje". */
export function textoPrincipal(agentes: readonly Agente[], turno: Turno | null, ahora: number, hayTrabajo: boolean): string {
  const esperando = agentes.filter(a => !a.terminado && a.deMain && a.enPrimerPlano && !a.flujo)
  if (turno) {
    if (esperando.length) {
      const tipos = unicos(esperando.map(a => nombreRol(a.tipo)))
      return tipos.length <= 2 ? `espera a ${tipos.join(' y ')}` : `espera a ${plural(esperando.length, 'agente', 'agentes')}`
    }
    return `trabajando hace ${duracion(Math.max(0, ahora - turno.inicio) / MIN)}`
  }
  if (hayTrabajo) return 'en pausa hasta que termine un agente'
  return 'esperando tu mensaje'
}

/** "2 agentes y 1 workflow en 12 min · US$ 3,50 · 2,1% de la semana" */
export function textoResumen(r: Resumen): string {
  const quienes = [r.agentes ? plural(r.agentes, 'agente', 'agentes') : '', r.flujos ? plural(r.flujos, 'workflow', 'workflows') : '']
    .filter(Boolean)
    .join(' y ')
  const partes = [`${quienes} en ${duracion(r.minutos)}`]
  if (r.costo !== undefined) partes.push(dolares(r.costo))
  if (r.semana !== undefined) partes.push(`${porcentaje(r.semana)} de la semana`)
  return partes.join(' · ')
}

function gastoDe(tarea: Tarea | null, uso: Uso | null): ModeloVista['gasto'] {
  if (!tarea || !uso) return undefined
  const costo = tarea.costo0 !== undefined && uso.costo !== undefined ? dolares(Math.max(0, uso.costo - tarea.costo0)) : undefined
  const semana =
    tarea.semana0 !== undefined && uso.semana !== undefined
      ? `${porcentaje(Math.max(0, uso.semana - tarea.semana0))} de la semana`
      : undefined
  return costo || semana ? limpio({ costo, semana }) : undefined
}

export function construirModelo(entrada: EntradaModelo, estimador: (e: EntradaEstimador) => Estimacion = estimar): ModeloVista {
  const { ahora } = entrada
  const activos = entrada.agentes
    .filter(a => !a.terminado)
    .map(normalizar)
    .sort((x, y) => x.inicio - y.inicio || x.id.localeCompare(y.id))

  const agentes: AgenteVista[] = activos.map(a => {
    const e = entradaEstimador(a, ahora, entrada.silencioDesde?.[a.id])
    return limpio<AgenteVista>({
      id: a.id,
      rol: a.tipo,
      modelo: modeloLegible(a.modelo),
      descripcion: a.descripcion,
      llevaMin: e.llevaMin,
      inicioAprox: !!a.inicioAprox,
      fase: a.fase,
      faseDesdeMin: e.faseDesdeMin,
      vistas: a.vistas,
      llamadas: a.llamadas,
      lista: e.lista,
      estimacion: estimarSeguro(estimador, e),
      flujo: a.flujo,
      enPrimerPlano: a.enPrimerPlano,
    })
  })

  // Workflows: los registrados y, si un agente nombra uno que todavía no aparece, una fila mínima.
  const flujos: FlujoVista[] = entrada.flujos.map(f => {
    const suyos = agentes.filter(a => a.flujo === f.id).length
    return {
      id: f.id,
      nombre: f.nombre,
      fases: f.fases,
      llevaMin: Math.max(0, ahora - f.inicio) / MIN,
      listos: f.listos,
      enCurso: suyos,
      lanzados: Math.max(f.lanzados, f.listos + suyos),
      remoto: !!f.remoto,
    }
  })
  const conocidos = new Set(entrada.flujos.map(f => f.id))
  for (const id of unicos(activos.flatMap(a => (a.flujo && !conocidos.has(a.flujo) ? [a.flujo] : [])))) {
    const suyos = activos.filter(a => a.flujo === id)
    flujos.push({
      id,
      nombre: 'workflow',
      fases: [],
      llevaMin: Math.max(0, ahora - Math.min(...suyos.map(a => a.inicio))) / MIN,
      listos: 0,
      enCurso: suyos.length,
      lanzados: suyos.length,
      remoto: false,
    })
  }
  flujos.sort((x, y) => y.llevaMin - x.llevaMin || x.id.localeCompare(y.id))

  const hay = agentes.length > 0 || flujos.length > 0
  const total = totalDe(agentes)
  const totalIncompleto =
    agentes.some(a => a.estimacion.estado !== 'rango') || entrada.cola.length > 0 || flujos.some(f => !f.remoto)

  return limpio<ModeloVista>({
    ahora,
    agentes,
    flujos,
    cola: [...entrada.cola],
    total,
    totalIncompleto,
    principal: textoPrincipal(activos, entrada.turno, ahora, hay),
    tareaMin: entrada.tarea ? Math.max(0, ahora - entrada.tarea.inicio) / MIN : undefined,
    gasto: gastoDe(entrada.tarea, entrada.uso),
    ultima: !hay && entrada.ultima ? textoResumen(entrada.ultima) : undefined,
    precision: entrada.precision ?? undefined,
  })
}

export const hayTrabajo = (m: ModeloVista) => m.agentes.length > 0 || m.flujos.length > 0

// ——— Medir la propia precisión ———

/** Un rango de minutos se da por acertado con este margen (las fotos redondean a una décima). */
const MARGEN_MIN = 0.05
const MAX_FOTOS = 120

const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

export function fotoDe(llevaMin: number, est: Estimacion, fase: Fase): Foto {
  if (est.estado === 'rango') {
    const conf = est.confianza === 'alta' ? 'a' : est.confianza === 'media' ? 'm' : 'b'
    return [r1(llevaMin), 'r', r1(est.bajoMin), r1(est.medioMin), r1(est.altoMin), fase, conf]
  }
  if (est.estado === 'pasado') return [r1(llevaMin), 'p', 0, r1(est.tipicoMin), 0, fase, '']
  return [r1(llevaMin), 'c', 0, 0, 0, fase, '']
}

/** ¿Toca otra foto? Una por minuto de corrida (cada 5 min pasada la hora); nunca más de MAX_FOTOS. */
export function tocaFoto(previas: readonly Foto[], llevaMin: number): boolean {
  if (previas.length >= MAX_FOTOS) return false
  const ultima = previas[previas.length - 1]
  const proxima = ultima ? (ultima[0] < 60 ? Math.floor(ultima[0]) + 1 : ultima[0] + 5) : 1
  return llevaMin >= proxima
}

export type Acierto = { err: number; cubierto: boolean; confianza: 'a' | 'm' | 'b'; fase: Fase }

/** Para cada foto con rango de un agente terminado: cuánto se equivocó el centro y si el rango acertó. */
export function evaluar(m: Medicion): Acierto[] {
  const salida: Acierto[] = []
  for (const f of m.fotos) {
    if (f[1] !== 'r' || (f[6] !== 'a' && f[6] !== 'm' && f[6] !== 'b')) continue
    const faltaba = Math.max(0, m.durMin - f[0])
    salida.push({
      err: Math.abs(f[3] - faltaba),
      cubierto: f[2] - MARGEN_MIN <= faltaba && faltaba <= f[4] + MARGEN_MIN,
      confianza: f[6],
      fase: f[5],
    })
  }
  return salida
}

function mediana(xs: readonly number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

type ResumenPrecision = { agentes: number; fotos: number; errorMedianoMin: number; cobertura: number }

function resumir(ms: readonly Medicion[]): ResumenPrecision | undefined {
  let agentes = 0
  const errs: number[] = []
  let cubiertos = 0
  for (const m of ms) {
    const ev = evaluar(m)
    if (!ev.length) continue
    agentes++
    for (const x of ev) {
      errs.push(x.err)
      if (x.cubierto) cubiertos++
    }
  }
  if (!errs.length) return undefined
  return { agentes, fotos: errs.length, errorMedianoMin: r1(mediana(errs)), cobertura: r2(cubiertos / errs.length) }
}

/** Lo que muestra la vista: agentes medidos, error mediano del centro (todas las fotos) y cobertura del rango, de 0 a 1. */
export function precisionDe(ms: readonly Medicion[]): Precision | undefined {
  const r = resumir(ms)
  return r ? { agentes: r.agentes, errorMedianoMin: r.errorMedianoMin, cobertura: r.cobertura } : undefined
}

export function precisionPorRol(ms: readonly Medicion[]): Record<string, ResumenPrecision> {
  const roles = unicos(ms.map(m => m.rol)).sort()
  const salida: Record<string, ResumenPrecision> = {}
  for (const rol of roles) {
    const r = resumir(ms.filter(m => m.rol === rol))
    if (r) salida[rol] = r
  }
  return salida
}

/** Cuántas veces acertó el rango según la confianza que dijo tener: la prueba de que la confianza significa algo. */
export function coberturaPorConfianza(ms: readonly Medicion[]): Record<'a' | 'm' | 'b', { fotos: number; cobertura: number } | undefined> {
  const cuenta = { a: [0, 0], m: [0, 0], b: [0, 0] } as Record<'a' | 'm' | 'b', [number, number]>
  for (const m of ms) {
    for (const x of evaluar(m)) {
      cuenta[x.confianza][0]++
      if (x.cubierto) cuenta[x.confianza][1]++
    }
  }
  const de = (c: [number, number]) => (c[0] ? { fotos: c[0], cobertura: r2(c[1] / c[0]) } : undefined)
  return { a: de(cuenta.a), m: de(cuenta.m), b: de(cuenta.b) }
}

/** Lee lo guardado en $.store sin fiarse de su forma. */
export function medicionesValidas(valor: unknown): Medicion[] {
  if (!Array.isArray(valor)) return []
  return valor.flatMap((m): Medicion[] => {
    if (!m || typeof m !== 'object') return []
    const x = m as Record<string, unknown>
    if (typeof x.rol !== 'string' || typeof x.durMin !== 'number' || !Array.isArray(x.fotos)) return []
    const fotos = x.fotos.filter((f): f is Foto => Array.isArray(f) && f.length === 7 && typeof f[0] === 'number' && typeof f[1] === 'string')
    return [
      limpio<Medicion>({
        t: typeof x.t === 'number' ? x.t : 0,
        rol: x.rol,
        modelo: typeof x.modelo === 'string' ? x.modelo : undefined,
        durMin: x.durMin,
        llamadas: typeof x.llamadas === 'number' ? x.llamadas : 0,
        fotos,
        reanudacion: x.reanudacion === true ? true : undefined,
      }),
    ]
  })
}

function textoEstimacion(est: Estimacion): string {
  if (est.estado === 'rango') return `faltan ${rango(est.bajoMin, est.altoMin)} (confianza ${est.confianza})`
  if (est.estado === 'pasado') return `ya pasó lo típico (${rango(est.tipicoMin, est.tipicoMin)})`
  return `calculando (${est.motivo})`
}

const pct = (c: number) => `${Math.round(c * 100)}%`

/** Lo que responde `/cuanto-falta datos`: la precisión medida (total, por rol y por confianza) y lo que corre ahora. */
export function textoDatos(mediciones: readonly Medicion[], enCurso: readonly AgenteVista[]): string {
  const lineas: string[] = []
  const total = resumir(mediciones)
  if (!total) {
    lineas.push(
      'Precisión: todavía no hay agentes medidos. Se mide cuando termina un agente que el mod vio desde que arrancó, con al menos una foto de su estimación (una por minuto).',
    )
  } else {
    lineas.push(
      `Precisión medida con ${plural(total.agentes, 'agente terminado', 'agentes terminados')} (${plural(total.fotos, 'foto', 'fotos')} de su estimación):`,
      `· en total: el centro se equivoca ${rango(total.errorMedianoMin, total.errorMedianoMin)} (mediana) y el rango acertó el ${pct(total.cobertura)} de las veces`,
    )
    const porRol = precisionPorRol(mediciones)
    for (const [rol, r] of Object.entries(porRol)) {
      lineas.push(
        `· ${nombreRol(rol)}: ${plural(r.agentes, 'agente', 'agentes')}, error ${rango(r.errorMedianoMin, r.errorMedianoMin)}, rango acertó ${pct(r.cobertura)}`,
      )
    }
    const reanudaciones = resumir(mediciones.filter(m => m.reanudacion))
    if (reanudaciones) {
      lineas.push(
        `· reanudaciones (van también en el total): ${plural(reanudaciones.agentes, 'agente', 'agentes')}, error ${rango(reanudaciones.errorMedianoMin, reanudaciones.errorMedianoMin)}, rango acertó ${pct(reanudaciones.cobertura)}`,
      )
    }
    const conf = coberturaPorConfianza(mediciones)
    const partes = (['a', 'm', 'b'] as const).flatMap(k =>
      conf[k] ? [`${k === 'a' ? 'alta' : k === 'm' ? 'media' : 'baja'} ${pct(conf[k]!.cobertura)} (${conf[k]!.fotos})`] : [],
    )
    if (partes.length) lineas.push(`· por confianza, el rango acertó: ${partes.join(' · ')}`)
    lineas.push('Los datos crudos están en ~/.claude/cuanto-falta/mediciones/<sesión>.jsonl (uno por agente) y en-curso/<sesión>.json (lo que corre ahora).')
  }
  lineas.push('')
  if (!enCurso.length) lineas.push('Nada corriendo ahora.')
  else {
    lineas.push('Estimaciones en curso:')
    for (const a of enCurso) {
      const quien = a.modelo ? `${nombreRol(a.rol)} (${a.modelo})` : nombreRol(a.rol)
      lineas.push(
        `· ${quien}: lleva ${a.inicioAprox ? '≥' : ''}${duracion(a.llevaMin)}, ${TEXTO_FASE[a.fase]}, ${plural(a.llamadas, 'llamada', 'llamadas')} · ${textoEstimacion(a.estimacion)}`,
      )
    }
  }
  return lineas.join('\n')
}

/** Lo que `en-curso.json` guarda de un agente que corre: nada de descripciones, prompts ni títulos de pasos. */
export function filaEnCurso(a: AgenteVista, extra: { modelo?: string; reanudacion?: boolean; silencioMin?: number } = {}) {
  return limpio({
    id: a.id,
    rol: a.rol,
    modelo: extra.modelo ?? a.modelo,
    llevaMin: r1(a.llevaMin),
    inicioAprox: a.inicioAprox || undefined,
    reanudacion: extra.reanudacion || undefined,
    fase: a.fase,
    faseDesdeMin: r1(a.faseDesdeMin),
    vistas: a.vistas,
    llamadas: a.llamadas,
    silencioMin: extra.silencioMin !== undefined ? r1(extra.silencioMin) : undefined,
    // Solo cuántos pasos lleva: el título de un paso es texto de la persona y no sale de la sesión.
    lista: a.lista ? { hechos: a.lista.hechos, total: a.lista.total } : undefined,
    estimacion: a.estimacion,
  })
}

export type { EstadoLista }
