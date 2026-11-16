// Cuánto le falta a un agente que corre, como un rango con su confianza.
//
// Método (elegido midiendo contra corridas reales, ver herramientas/EVALUACION.md):
//   1. Tiempo: los cuantiles 10/50/90 de lo que de verdad les faltaba a las corridas del mismo rol y
//      modelo que ya llevaban lo mismo (supervivencia condicionada a lo transcurrido), con retroceso al
//      rol cuando el modelo tiene pocas corridas.
//   2. Etapa: un factor por rol y etapa del trabajo (explorando, editó, ya probó, hizo commit) que
//      corrige esos cuantiles. En el informe final manda cuánto lleva escribiéndolo.
//   3. Silencio: en los roles donde se comprobó en el entrenamiento (no en el implementador), pasada la
//      duración típica, un rato sin herramientas suele ser el cierre: manda la tabla de silencio.
//   4. Lista de pasos del propio agente, si la lleva: acerca el centro a lo que le tomó cada paso.
// Una reanudación (SendMessage a un agente que ya cerró su turno) se estima con sus propias tablas:
// dura mucho menos que un encargo nuevo.
// Las tablas salen de `node herramientas/tablas.mjs`. Nunca un número inventado: un rol sin historial
// queda en 'calculando'; más allá de casi todo lo visto para su rol, 'pasado'.
// Barato: unas cuantas búsquedas en arreglos chicos (se llama cada 10 s por agente).
import { TEXTO_FASE } from './contrato'
import type { Confianza, EntradaEstimador, Estimacion, Fase } from './contrato'
import { modeloLegible } from './formato'
import { TABLAS } from './tablas'

/** Una celda: cuántas corridas la respaldan y los cuantiles 10/50/90 de los minutos que les faltaban. */
export type Celda = [n: number, q10: number, q50: number, q90: number]

export type Grupo = {
  /** Corridas del grupo. */
  n: number
  /** Duración típica (mediana, min). */
  tipico: number
  /** Corridas que seguían vivas en cada punto de la rejilla. */
  vivos: number[]
  /** Llamadas típicas de una corrida completa (mediana). */
  llamadas?: number
  /** Por etapa (`*` = todas), una celda por punto de la rejilla (0 = sin muestras suficientes). */
  etapas: Record<string, (Celda | 0)[]>
}

export type ModoEtapa = 'nada' | 'fase' | 'progreso' | 'mixta' | 'llamadas' | 'llamadas+progreso'

export type Tablas = {
  version: number
  /** Fecha de la corrida más reciente que respalda las tablas. */
  hasta: string
  corridas: number
  /** Cómo se agrupan las corridas por etapa (ver etapaDe). */
  modoEtapa: ModoEtapa
  /** Minutos transcurridos en que se tomaron las muestras. */
  rejilla: number[]
  /** Minutos escribiendo el informe en que se tomaron las muestras. */
  rejillaInforme: number[]
  /** Clave `rol|modelo`, `rol` o `*`. */
  grupos: Record<string, Grupo>
  /** Lo que falta una vez que escribe el informe, por clave de grupo, en cada punto de rejillaInforme. */
  informe: Record<string, (Celda | 0)[]>
  /** Minutos sin herramientas en que se tomaron las muestras de silencio. */
  rejillaSilencio?: number[]
  /** Por rol (o `rol#r`): desde cuántos minutos de silencio se usa, y lo que faltaba en cada punto de
   *  rejillaSilencio, pasada la duración típica del rol. Solo los roles donde mejoró en el entrenamiento. */
  silencio?: Record<string, { desde: number; celdas: (Celda | 0)[] }>
  /** Mínimo de corridas por celda para usarla. */
  minimo: number
  /** Ensanche del rango hacia abajo y hacia arriba, en escala logarítmica alrededor del centro,
   *  calibrado en la evaluación para que la cobertura quede en 75–85% ([1, 1] = los cuantiles tal cual). */
  ensanche?: [bajo: number, alto: number]
  /** Umbrales de confianza, calibrados en la evaluación: corridas y ancho del rango sobre la duración total. */
  confianza: { altaN: number; altaAncho: number; mediaN: number; mediaAncho: number }
}

export const TODOS = '*'
/** Sufijo de las claves de reanudaciones: `implementador#r`, `implementador#r|claude-opus-5-5`, `*#r`. */
export const REANUDA = '#r'

/** "claude-opus-5-5[1m]" → "claude-opus-5-5"; "claude-haiku-4-5-20251001" → "claude-haiku-4-5". */
export function normalizarModelo(m: string | undefined): string | undefined {
  if (typeof m !== 'string' || !m || m.startsWith('<')) return undefined
  return m.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
}

/** La etapa del trabajo en que va el agente, según su fase y las fases por las que ya pasó. */
export function etapaDe(modo: ModoEtapa, fase: Fase, vistas: readonly Fase[], llamadas = 0, tipicas = 0): string {
  if (modo === 'nada') return TODOS
  if (modo === 'llamadas' || modo === 'llamadas+progreso') {
    if (!tipicas) return TODOS
    const r = llamadas / tipicas
    const l = r < 0.3 ? 'l0' : r < 0.6 ? 'l1' : r < 1 ? 'l2' : 'l3'
    if (modo === 'llamadas') return l
    return `${l}-${etapaDe('progreso', fase, vistas)}`
  }
  if (modo === 'fase') return fase === 'arrancando' || fase === 'informe' ? 'leyendo' : fase
  const ya = (f: Fase) => fase === f || vistas.includes(f)
  const progreso = ya('commit') ? 'cierre' : ya('probando') || ya('navegando') ? 'prueba' : ya('editando') ? 'edita' : 'explora'
  if (modo === 'progreso') return progreso
  // mixta: además, qué hace ahora mismo
  const ahora = fase === 'probando' || fase === 'navegando' ? 'p' : fase === 'editando' ? 'e' : fase === 'commit' ? 'c' : 'l'
  return `${progreso}-${ahora}`
}

/** Índice del último punto de la rejilla que no pasa de `t`, y cuánto se avanzó hacia el siguiente. */
function ubicar(rejilla: readonly number[], t: number): { k: number; frac: number } {
  let k = 0
  while (k + 1 < rejilla.length && rejilla[k + 1]! <= t) k++
  const a = rejilla[k]!
  const b = rejilla[k + 1]
  return { k, frac: b === undefined || b <= a ? 0 : Math.min(1, Math.max(0, (t - a) / (b - a))) }
}

/** La celda en `t`, interpolada entre los dos puntos de la rejilla que lo rodean si ambos tienen muestras. */
function celdaEn(celdas: readonly (Celda | 0)[] | undefined, k: number, frac: number, minimo: number): Celda | undefined {
  const c = celdas?.[k]
  if (!c || c[0] < minimo) return undefined
  const d = celdas?.[k + 1]
  if (!d || d[0] < minimo || frac <= 0) return c
  const mezcla = (i: 1 | 2 | 3) => c[i] + (d[i] - c[i]) * frac
  return [Math.round(c[0] + (d[0] - c[0]) * frac), mezcla(1), mezcla(2), mezcla(3)]
}

function vivosEn(g: Grupo, k: number, frac: number): number {
  const a = g.vivos[k] ?? 0
  const b = g.vivos[k + 1] ?? 0
  return a + (b - a) * frac
}

/** De dónde sale la estimación: la celda y cuánto hubo que retroceder (0 = rol+modelo y etapa propios). */
type Fuente = { celda: Celda; clave: string; nivel: number }

function buscar(t: Tablas, claves: readonly string[], etapa: string, k: number, frac: number): Fuente | undefined {
  const orden: [string, string, number][] = []
  // De la etapa más fina a la más gruesa ("l2-prueba" → "l2" → todas), en cada grupo.
  const etapas = etapa === TODOS ? [TODOS] : etapa.includes('-') && t.modoEtapa === 'llamadas+progreso' ? [etapa, etapa.split('-')[0]!, TODOS] : [etapa, TODOS]
  etapas.forEach((et, j) => claves.forEach((clave, i) => orden.push([clave, et, i + j])))
  for (const [clave, et, nivel] of orden) {
    const celda = celdaEn(t.grupos[clave]?.etapas[et], k, frac, t.minimo)
    if (celda) return { celda, clave, nivel }
  }
  return undefined
}

/** "implementador (Sonnet 5.5)", "implementador", "todos los agentes". */
function quien(clave: string): string {
  const [conSufijo, modelo] = clave.split('|')
  const rol = conSufijo!.replace(REANUDA, '')
  const legible = modeloLegible(modelo)
  if (rol === TODOS) return 'todos los agentes'
  return legible ? `${rol} (${legible})` : rol
}

/** "140 corridas de implementador (Sonnet 5.5)", "12 reanudaciones de implementador". */
function respaldo(n: number, clave: string): string {
  const cosa = clave.split('|')[0]!.endsWith(REANUDA) ? (n === 1 ? 'reanudación' : 'reanudaciones') : n === 1 ? 'corrida' : 'corridas'
  return `${n} ${cosa} de ${quien(clave)}`
}

function minutos(x: number): string {
  return x < 1 ? 'menos de 1 min' : `${Math.round(x)} min`
}

function confianzaDe(t: Tablas, n: number, ancho: number, total: number, nivel: number, aprox: boolean): Confianza {
  const rel = ancho / Math.max(1, total)
  let c: Confianza = 'baja'
  if (nivel === 0 && n >= t.confianza.altaN && rel <= t.confianza.altaAncho) c = 'alta'
  else if (n >= t.confianza.mediaN && rel <= t.confianza.mediaAncho) c = 'media'
  // Encontrado ya corriendo: lo que lleva y sus llamadas son un mínimo, se confía un escalón menos.
  if (aprox) c = c === 'alta' ? 'media' : 'baja'
  return c
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** Más allá de casi todo lo visto: menos de esta fracción de las corridas del rol duró tanto. */
export const MAS_ALLA = 0.03

/** Estima con unas tablas dadas (la evaluación usa tablas de entrenamiento; el mod, las generadas). */
export function estimarCon(t: Tablas, e: EntradaEstimador): Estimacion {
  const lleva = Math.max(0, Number.isFinite(e.llevaMin) ? e.llevaMin : 0)
  const pedido = e.rol || 'general-purpose'
  // Un agente de plugin («flota:implementador») usa las tablas del rol sin prefijo si no tiene las suyas.
  const corto = pedido.includes(':') ? pedido.slice(pedido.lastIndexOf(':') + 1) : pedido
  const sinTablas = (r: string) => !t.grupos[r] && !t.grupos[`${r}${REANUDA}`]
  const rolPedido = sinTablas(pedido) && !sinTablas(corto) ? corto : pedido
  if (rolPedido === TODOS || rolPedido.includes(REANUDA)) return { estado: 'calculando', motivo: `todavía sin historial de ${rolPedido}` }
  // Una reanudación usa las tablas de reanudaciones de su rol; si su rol (conocido) tiene pocas, las de todos.
  let rol = e.reanudacion ? `${rolPedido}${REANUDA}` : rolPedido
  let generico = false
  if (!t.grupos[rol] && e.reanudacion && t.grupos[rolPedido] && t.grupos[`${TODOS}${REANUDA}`]) {
    rol = `${TODOS}${REANUDA}`
    generico = true
  }
  const deRol = t.grupos[rol]
  if (!deRol) return { estado: 'calculando', motivo: `todavía sin historial de ${rolPedido}${e.reanudacion ? ' reanudado' : ''}` }
  const modelo = normalizarModelo(e.modelo)
  const conModelo = modelo && !generico && t.grupos[`${rol}|${modelo}`] ? `${rol}|${modelo}` : undefined
  const claves = conModelo ? [conModelo, rol] : [rol]
  const fase: Fase = TEXTO_FASE[e.fase] ? e.fase : 'arrancando'
  const texto = TEXTO_FASE[fase]
  const lista = e.lista && e.lista.total >= 2 && e.lista.hechos <= e.lista.total ? e.lista : undefined
  const pasos = lista ? ` · ${lista.hechos} de ${lista.total} pasos` : ''

  // Más allá de casi todo lo visto para su rol: no hay con qué comparar.
  const { k, frac } = ubicar(t.rejilla, lleva)
  const pasado = (): Estimacion => ({
    estado: 'pasado',
    tipicoMin: r1((t.grupos[claves[0]!] ?? deRol).tipico),
    motivo: `${texto}${pasos} · ya pasó lo que dura casi toda ${e.reanudacion ? 'reanudación' : 'corrida'} de ${quien(claves[0]!)}`,
  })
  if (lleva > 0 && fase !== 'informe' && vivosEn(deRol, k, frac) / Math.max(1, deRol.n) < MAS_ALLA) return pasado()
  const pocas = (): Estimacion => ({
    estado: 'calculando',
    motivo: `${texto}${pasos} · pocas ${e.reanudacion ? 'reanudaciones' : 'corridas'} de ${quien(claves[0]!)} que hayan llegado hasta aquí`,
  })

  let fuente: Fuente | undefined
  if (fase === 'informe') {
    const ki = ubicar(t.rejillaInforme, Math.max(0, e.faseDesdeMin || 0))
    for (const [nivel, clave] of claves.entries()) {
      const celda = celdaEn(t.informe[clave], ki.k, ki.frac, t.minimo)
      if (celda) {
        fuente = { celda, clave, nivel }
        break
      }
    }
  }
  // Pasada la duración típica, un rato sin herramientas suele ser el cierre (solo donde se comprobó).
  let callado = ''
  const sil = t.silencio?.[rol]
  const silencio = e.silencioMin
  if (!fuente && sil && t.rejillaSilencio && silencio !== undefined && Number.isFinite(silencio) && silencio >= sil.desde && lleva >= deRol.tipico) {
    const ks = ubicar(t.rejillaSilencio, silencio)
    const celda = celdaEn(sil.celdas, ks.k, ks.frac, t.minimo)
    if (celda) {
      fuente = { celda, clave: rol, nivel: claves.length - 1 }
      callado = ` · sin usar herramientas hace ${minutos(silencio)}, suele ser el cierre`
    }
  }
  const etapa = fase === 'informe' ? TODOS : etapaDe(t.modoEtapa, fase, e.vistas ?? [], e.llamadas, deRol.llamadas)
  if (!fuente) fuente = buscar(t, claves, etapa, k, frac)
  if (!fuente) return pocas()

  let [n, bajo, medio, alto] = fuente.celda
  // La lista de pasos del agente: si va en el 3 de 5, lo que falta se acerca a lo que tardó por paso.
  if (lista && lista.hechos >= 1 && lista.hechos < lista.total && fase !== 'informe' && lleva > 0) {
    const avance = Math.min(0.95, lista.hechos / lista.total)
    const porLista = (lleva * (1 - avance)) / avance
    const peso = 0.5 * avance
    const nuevo = Math.exp((1 - peso) * Math.log(Math.max(0.1, medio)) + peso * Math.log(Math.max(0.1, porLista)))
    const factor = nuevo / Math.max(0.1, medio)
    medio = nuevo
    bajo *= factor
    alto *= factor
  }
  const [gb, ga] = t.ensanche ?? [1, 1]
  if (medio > 0) {
    if (gb !== 1) bajo = medio * Math.pow(Math.min(1, Math.max(1e-3, bajo / medio)), gb)
    if (ga !== 1) alto = medio * Math.pow(Math.max(1, alto / medio), ga)
  }
  bajo = Math.max(0, Math.min(bajo, medio))
  alto = Math.max(alto, medio)
  const confianza = generico ? 'baja' : confianzaDe(t, n, alto - bajo, lleva + medio, fuente.nivel, !!e.inicioAprox)
  return {
    estado: 'rango',
    bajoMin: r1(bajo),
    altoMin: r1(alto),
    medioMin: r1(medio),
    confianza,
    progreso: Math.round(Math.min(1, Math.max(0, lleva / Math.max(0.01, lleva + medio))) * 1000) / 1000,
    motivo: `${texto}${callado}${pasos} · según ${respaldo(n, fuente.clave)}`,
  }
}

/** Lo que falta a un agente en curso, con las tablas generadas de las corridas reales. */
export function estimar(entrada: EntradaEstimador): Estimacion {
  return estimarCon(TABLAS, entrada)
}
