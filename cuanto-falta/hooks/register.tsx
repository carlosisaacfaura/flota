import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, Register, Timer, TurnCompleteInput } from 'claude-code'

import type { Agente, Flujo, Foto, Medicion, Resumen, Tarea, Uso } from '../types'
import {
  ES_DELEGACION,
  ES_LISTA,
  MIN_TEXTO_INFORME,
  TIPO_GENERICO,
  TIPO_WORKFLOW,
  agenteNuevo,
  ahoraDe,
  aplicarEventos,
  construirModelo,
  eventoDeLlamada,
  filaEnCurso,
  fotoDe,
  hayTrabajo,
  limpio,
  medicionesValidas,
  normalizar,
  precisionDe,
  reconstruirDeMensajes,
  textoDatos,
  textoResumen,
  tocaFoto,
} from './modelo'
import type { Evento } from './modelo'
import { plural } from './formato'
import { dibujarBanda, dibujarPanel } from './vista'

// Muestra cuánto falta para que la sesión y sus agentes terminen. Solo observa:
// todos los hooks devuelven `next(e)` tal cual, sin `deny` y sin tocar prompts ni herramientas.
// Lo que ve de cada agente (modelo, fase, llamadas, lista de pasos) lo anota en memoria sin esperar nada
// y el reloj lo vuelca al estado cada 10 s; de ahí lo lee el estimador y lo dibuja la vista.

const PANEL = 'cuanto-falta'
const TITULO = 'Cuánto falta'
const TICK_MS = 10_000
const ESPERA_FIN_MS = 20_000 // la sesión principal suele retomar unos segundos después de un agente
const MIN_AVISO_MS = 5 * 60_000
const FLUJO_QUIETO_MS = 3 * 60_000
const FLUJO_OLVIDO_MS = 30 * 60_000
const AGENTE_OLVIDO_MS = 6 * 60 * 60_000
const MIN_MEDIR = 0.25 // minutos: corridas de segundos suelen ser fallas y no enseñan nada
const MAX_MEDICIONES = 300
const CLAVE_MEDICIONES = 'mediciones'
const MEDICIONES_DIR = 'mediciones'
const CARPETA_DATOS = '.claude/cuanto-falta'
/** Cuánto se guarda la ficha de un agente que se retiró, por si su turn.complete llega tarde. */
const FICHA_MS = 5 * 60_000
/** Un turn.complete cuya corrida empezó más de esto antes que la actual es de una corrida anterior (reanudación). */
const TOL_CORRIDA_MS = 15_000
/** Tope de ids que se recuerdan como terminados (solo ids: no crece sin límite en sesiones larguísimas). */
const MAX_TERMINADOS = 2000
const ESTADOS_FIN = new Set(['completed', 'failed', 'killed'])
/** Lo que `tool.call` trae además de los argumentos de la herramienta. */
const RESERVADAS = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])

const agentesA = atom({ plugin: 'cuanto-falta', key: 'agentes' } as const, {})
const flujosA = atom({ plugin: 'cuanto-falta', key: 'flujos' } as const, {})
const turnoA = atom({ plugin: 'cuanto-falta', key: 'turno' } as const, null)
const tareaA = atom({ plugin: 'cuanto-falta', key: 'tarea' } as const, null)
const usoA = atom({ plugin: 'cuanto-falta', key: 'uso' } as const, null)
const colaA = atom({ plugin: 'cuanto-falta', key: 'cola' } as const, [])
const ahoraA = atom({ plugin: 'cuanto-falta', key: 'ahora' } as const, 0)
const ultimaA = atom({ plugin: 'cuanto-falta', key: 'ultima' } as const, null)
const panelCerradoA = atom({ plugin: 'cuanto-falta', key: 'panelCerrado' } as const, false)
const fotosA = atom({ plugin: 'cuanto-falta', key: 'fotos' } as const, {})
const precisionA = atom({ plugin: 'cuanto-falta', key: 'precision' } as const, null)

// Memoria del módulo (una recarga la pierde; lo importante vive en $.state).
/** Lo observado de cada agente desde el último volcado, en orden; `vueltas` = volcados en que no tuvo dueño. */
let eventos = new Map<string, { evs: Evento[]; vueltas: number }>()
/** Llamadas Agent/Task/Workflow de cada agente que siguen en vuelo (para la fase `delegando`). */
const enVuelo = new Map<string, number>()
/** Todas las llamadas a herramientas de cada agente que siguen en vuelo. */
const pendientes = new Map<string, number>()
/** Hora en que volvió la última llamada pendiente de cada agente: desde ahí corre su silencio. */
const ultimoRetorno = new Map<string, number>()
/** Último modelo anotado de cada agente (para anotar solo cuando cambia). */
const modeloVisto = new Map<string, string>()
/** Agentes que ya terminaron: ni la lista ni un alta tardío los vuelven a crear (solo una reanudación los saca de aquí). */
const terminados = new Set<string>()
/**
 * Agentes que se retiraron sin que llegara su turn.complete: la ficha sirve para medirlos si llega tarde.
 * Existe desde el mismo instante en que sale del estado; sus fotos se completan un momento después.
 */
type Ficha = { a: Agente; fotos: Promise<Foto[]>; completar: (f: Foto[]) => void; hasta: number }
const fichas = new Map<string, Ficha>()
/** Cuántas veces se reanudó cada agente: marca de qué corrida es cada llamada, para ignorar retornos viejos. */
const generacion = new Map<string, number>()
/** Agentes ya contados en la tarea en curso: una reanudación no suma otro. */
const contados = new Set<string>()
let ticker: Timer | undefined
let avisoFin: Timer | undefined
let tickando = false
let cadenaStore: Promise<unknown> = Promise.resolve()
/** Volcados de eventos al estado, en fila: uno nunca se salta lo que el anterior dejó a medio escribir. */
let volcado: Promise<unknown> = Promise.resolve()
/** Turno principal en curso según turn.start/turn.complete (evita que un inicio tardío pise un fin). */
let turnoVivo: string | undefined
/** Lo que dijo la última línea fija: false = la pantalla no pone paneles al costado (terminal sin pantalla completa). */
let dockea: boolean | undefined
/** Carpeta del usuario, leída una vez. */
let casa: string | undefined
/** Id de esta sesión (para su propio en-curso.json), leído una vez. */
let sesionId: string | undefined
/** El en-curso.json de esta sesión ya quedó sin agentes: no hace falta escribirlo otra vez (al abrir la sesión se escribe una vez). */
let enCursoVacio = true
/** Errores de escritura ya avisados: una falla repetida se dice una sola vez. */
const fallosArchivo = new Set<string>()

type $ = EngineInterface

function depurar($: $, texto: string) {
  $.ui.log(`cuanto-falta: ${texto}`, { to: 'debug' })
}

function fallo($: $) {
  return (err: unknown) => depurar($, `error: ${err instanceof Error ? err.message : String(err)}`)
}

async function leerUso($: $): Promise<Uso> {
  const u = await $.session.usage()
  const semana = u.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed
  return limpio({ costo: u.cost?.usd, semana })
}

// ——— Ciclo de la tarea ———

async function asegurarTarea($: $, ahora: number) {
  if (await read($, tareaA)) return
  const uso = await leerUso($).catch((): Uso => ({}))
  await update($, tareaA, t => t ?? limpio<Tarea>({ inicio: ahora, costo0: uso.costo, semana0: uso.semana, agentes: 0, flujos: 0 }))
  await update($, usoA, () => uso)
}

function arrancarTicker($: $) {
  avisoFin?.cancel()
  avisoFin = undefined
  if (ticker) return
  ticker = $.clock.every(TICK_MS, () => {
    void tick($).catch(fallo($))
  })
}

function pararTicker() {
  ticker?.cancel()
  ticker = undefined
}

async function tick($: $) {
  if (tickando) return // un tic lento no se pisa con el siguiente
  tickando = true
  try {
    const ahora = await $.clock.now()
    await volcarEventos($, ahora)
    await update($, ahoraA, () => ahora)
    const uso = await leerUso($).catch(() => undefined)
    if (uso) await update($, usoA, () => uso)
    await conciliarLista($, ahora)
    await limpiarFlujos($, ahora)
    // Medir y dejar los datos a la vista nunca debe impedir cerrar la tarea.
    await tomarFotos($, ahora).catch(fallo($))
    await escribirEnCurso($, ahora).catch(fallo($))
    await revisarFin($)
  } finally {
    tickando = false
  }
}

// ——— Lo que se ve de cada agente ———

function registrar(id: string, ev: Evento) {
  const bolsa = eventos.get(id) ?? { evs: [], vueltas: 0 }
  const ultimo = bolsa.evs[bolsa.evs.length - 1]
  // Llamadas seguidas de una misma fase se juntan: la memoria no crece con agentes muy activos.
  if (ev.k === 'llamada' && ultimo?.k === 'llamada' && ultimo.fase === ev.fase && ultimo.sobre === ev.sobre) ultimo.n += ev.n
  else bolsa.evs.push(ev)
  eventos.set(id, bolsa)
}

function olvidarMemoria(id: string) {
  eventos.delete(id)
  enVuelo.delete(id)
  pendientes.delete(id)
  ultimoRetorno.delete(id)
  modeloVisto.delete(id)
}

function anotar(ids: Set<string>, id: string) {
  ids.add(id)
  if (ids.size <= MAX_TERMINADOS) return
  for (const viejo of ids) {
    ids.delete(viejo) // los más antiguos primero (el orden de un Set es el de entrada)
    if (ids.size <= MAX_TERMINADOS * 0.75) break
  }
}

/** Silencio de cada agente: cuándo volvió su última llamada pendiente, solo si ya no queda ninguna en vuelo. */
function silenciosDesde(): Record<string, number> {
  const r: Record<string, number> = {}
  for (const [id, t] of ultimoRetorno) if (!pendientes.has(id)) r[id] = t
  return r
}

/** Una reanudación es otra corrida: lo que quedó en memoria de la anterior no vale, y sus retornos tardíos se ignoran. */
function reiniciarMemoria(id: string) {
  olvidarMemoria(id)
  generacion.set(id, (generacion.get(id) ?? 0) + 1)
}

/**
 * Un agente sale del estado sin su turn.complete: desde ese mismo instante hay una ficha (así un turn.complete
 * que llegue justo ahora lo encuentra), y sus fotos se completan después. Se llama dentro del update que lo saca.
 */
function fichar(a: Agente, ahora: number): Ficha {
  const previa = fichas.get(a.id)
  if (previa) {
    previa.a = a // un reintento del update: se conserva la promesa de las fotos, que alguien puede estar esperando
    return previa
  }
  let completar!: (f: Foto[]) => void
  const fotos = new Promise<Foto[]>(res => (completar = res))
  const ficha = { a, fotos, completar, hasta: ahora + FICHA_MS }
  fichas.set(a.id, ficha)
  return ficha
}

/** Ya salieron del estado: se recuerda que terminaron y se sacan sus fotos para completar su ficha. */
async function completarFichas($: $, fichados: readonly Ficha[]) {
  for (const f of fichados) {
    anotar(terminados, f.a.id)
    olvidarMemoria(f.a.id)
  }
  // Se completa la ficha misma, no la que esté en el mapa: un turn.complete tardío ya la pudo sacar de ahí y espera sus fotos.
  await Promise.all(fichados.map(async f => f.completar(await sacarFotos($, f.a.id).catch((): Foto[] => []))))
}

function podarFichas(ahora: number) {
  for (const [id, f] of fichas) if (ahora > f.hasta) fichas.delete(id)
}

function argumentos(e: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(e).filter(([k]) => !RESERVADAS.has(k)))
}

/** Sin await: se llama antes de `next(e)` y no demora ninguna herramienta. */
function seguirLlamada(id: string, tool: string, input: unknown) {
  pendientes.set(id, (pendientes.get(id) ?? 0) + 1)
  ultimoRetorno.delete(id) // con una llamada en vuelo no hay silencio
  const sobre = (enVuelo.get(id) ?? 0) > 0
  registrar(id, eventoDeLlamada(tool, input, sobre))
  if (ES_DELEGACION.has(tool)) {
    enVuelo.set(id, (enVuelo.get(id) ?? 0) + 1)
    if (!sobre) registrar(id, { k: 'delegar' })
  }
}

/** Volvió una llamada: cuando vuelve la última pendiente del agente, desde ese momento corre su silencio. */
function llamadaVolvio($: $, id: string) {
  const n = (pendientes.get(id) ?? 1) - 1
  if (n > 0) {
    pendientes.set(id, n)
    return
  }
  pendientes.delete(id)
  void $.clock
    .now()
    .then(t => {
      if (!pendientes.has(id)) ultimoRetorno.set(id, t) // si arrancó otra mientras tanto, el silencio no empezó
    })
    .catch(() => undefined)
}

/** Lo que pasa cuando la herramienta vuelve (el resultado se lee, nunca se cambia). */
async function alVolver(
  $: $,
  tool: string,
  input: unknown,
  id: string | undefined,
  corrida: number,
  llamada: Promise<unknown>,
  workflow?: { script?: string; name?: string },
) {
  const r = (await llamada.catch(() => undefined)) as { result?: unknown; isError?: boolean; deny?: string } | undefined
  const bueno = !!r && r.result !== undefined && !r.isError
  // Una llamada de una corrida anterior (el agente se reanudó mientras volvía) no toca la cuenta de la nueva.
  if (id !== undefined && corrida !== (generacion.get(id) ?? 0)) id = undefined
  if (id !== undefined) llamadaVolvio($, id)
  if (id !== undefined && ES_DELEGACION.has(tool)) {
    const n = (enVuelo.get(id) ?? 1) - 1
    if (n <= 0) {
      enVuelo.delete(id)
      registrar(id, { k: 'regreso' })
    } else enVuelo.set(id, n)
  }
  // El id de TaskCreate viene en el resultado: la lista se arma con lo que contestó.
  if (id !== undefined && ES_LISTA.has(tool) && bueno) registrar(id, { k: 'lista', tool, input, resultado: r!.result })
  if (workflow && bueno) await registrarFlujo($, workflow.script, workflow.name, r!.result)
}

/** Aplica al estado lo observado desde el último volcado. Siempre detrás del anterior: nadie lo adelanta. */
function volcarEventos($: $, ahoraDado?: number): Promise<void> {
  const mio = volcado.then(() => volcarAhora($, ahoraDado))
  volcado = mio.catch(() => undefined)
  return mio
}

/** Repetible: cada reintento parte del último estado. */
async function volcarAhora($: $, ahoraDado?: number) {
  if (eventos.size === 0) return
  const ahora = ahoraDado ?? (await $.clock.now())
  const lote = eventos
  eventos = new Map()
  const sinDueno = new Set<string>()
  await update($, agentesA, ags => {
    sinDueno.clear()
    const sig = { ...ags }
    for (const [id, { evs }] of lote) {
      const a = sig[id]
      if (a) sig[id] = aplicarEventos(a, evs, ahora)
      else sinDueno.add(id)
    }
    return sig
  })
  // Lo de un agente cuyo registro todavía no llega se guarda una vuelta más (y se suma a lo que llegó mientras tanto).
  for (const id of sinDueno) {
    const bolsa = lote.get(id)
    if (!bolsa || bolsa.vueltas >= 1) {
      // No es un agente nuestro (un fork, una compactación): no se guarda nada de él.
      enVuelo.delete(id)
      pendientes.delete(id)
      ultimoRetorno.delete(id)
      modeloVisto.delete(id)
      continue
    }
    const nuevo = eventos.get(id)
    eventos.set(id, { evs: [...bolsa.evs, ...(nuevo?.evs ?? [])], vueltas: bolsa.vueltas + 1 })
  }
}

/** Un agente que ya corría cuando el mod se cargó: sus mensajes dicen cuántas llamadas lleva, en qué fase y su lista. */
async function reconstruirAgente($: $, id: string) {
  const mensajes = await $.session.messages({ agentId: id })
  if (!Array.isArray(mensajes)) return // el motor no deja leer ese agente
  const r = reconstruirDeMensajes(mensajes)
  const ahora = await $.clock.now()
  await update($, agentesA, ags => {
    const a = ags[id]
    if (!a || !a.inicioAprox) return ags // ya lo vimos desde su spawn: lo exacto manda
    const { lista: _l, previa: _p, ...base } = normalizar(a)
    return {
      ...ags,
      [id]: limpio({ ...base, llamadas: r.llamadas, fase: r.fase, faseDesde: ahora, vistas: r.vistas, lista: r.lista, previa: r.previa }),
    }
  })
  depurar($, `agente ${id} ya corría: ${plural(r.llamadas, 'llamada', 'llamadas')}, ${r.fase}`)
}

/** Agentes que terminaron sin que llegara su turn.complete, agentes que ya corrían y la cola. */
async function conciliarLista($: $, ahora: number) {
  const lista = await $.agent.list()
  const porId = new Map(lista.map(a => [a.id, a]))
  const cola = lista.filter(a => a.status === 'pending' && !a.teammateId).map(a => a.type || TIPO_GENERICO)
  await update($, colaA, () => cola)
  const agregados = new Set<string>()
  const retiradas: Agente[] = [] // salieron sin su turn.complete: se recuerdan, y se miden si llega tarde
  const fichados: Ficha[] = []
  const olvidados: string[] = [] // la red de seguridad de 6 h: se recuerdan, pero no se miden
  await update($, agentesA, ags => {
    agregados.clear()
    retiradas.length = 0
    fichados.length = 0
    olvidados.length = 0
    const sig: Record<string, Agente> = {}
    /** Lo que salió en esta pasada: aunque la lista lo dé corriendo, no se vuelve a crear. */
    const fuera = new Set<string>()
    for (const [id, a] of Object.entries(ags)) {
      if (ahora - a.inicio > AGENTE_OLVIDO_MS) {
        olvidados.push(id) // red de seguridad: nunca se queda pegado
        fuera.add(id)
        continue
      }
      const fila = porId.get(id)
      // Terminado según la lista o SubagentStop: se quita una vuelta después, para que su
      // turn.complete alcance a llegar y se mida.
      const terminado = a.terminado ?? (fila && ESTADOS_FIN.has(fila.status) ? ahora : undefined)
      if (terminado !== undefined) {
        if (ahora - terminado < TICK_MS - 1_000) sig[id] = a.terminado ? a : { ...a, terminado }
        else {
          retiradas.push({ ...a, terminado })
          fuera.add(id)
        }
        continue
      }
      if (!fila) {
        // Los de un workflow nunca salen en la lista; los demás, solo se dan por terminados
        // si ya se habían visto y desaparecieron (la lista los suelta un rato después).
        if (a.flujo || !a.visto) sig[id] = a
        else if ((a.ausente ?? 0) + 1 < 3) sig[id] = { ...a, ausente: (a.ausente ?? 0) + 1 }
        else {
          retiradas.push(a)
          fuera.add(id)
        }
        continue
      }
      sig[id] = a.visto && !a.ausente ? a : { ...a, visto: true, ausente: 0 }
    }
    for (const fila of lista) {
      if (fila.status !== 'running' || fila.teammateId || sig[fila.id] || terminados.has(fila.id) || fuera.has(fila.id)) continue
      agregados.add(fila.id)
      sig[fila.id] = agenteNuevo({
        id: fila.id,
        tipo: fila.type || TIPO_GENERICO,
        descripcion: fila.description || fila.type,
        inicio: ahora,
        deMain: fila.parentId === undefined,
        inicioAprox: true,
      })
    }
    // Con la ficha ya puesta, un turn.complete que llegue mientras se retira lo encuentra.
    for (const a of retiradas) fichados.push(fichar(a, ahora))
    return sig
  })
  await completarFichas($, fichados)
  for (const id of olvidados) {
    anotar(terminados, id)
    olvidarMemoria(id)
  }
  podarFichas(ahora)
  // Agentes que ya corrían sin que viéramos su spawn (p. ej., el mod se cargó después): cuentan en la tarea
  // y se reconstruye lo que se pueda. Lo anotado antes de conocerlos ya está en sus mensajes.
  if (agregados.size) {
    await asegurarTarea($, ahora)
    await update($, tareaA, t => (t ? { ...t, agentes: t.agentes + agregados.size } : t))
    for (const id of agregados) {
      contados.add(id)
      eventos.delete(id)
      modeloVisto.delete(id) // el modelo se vuelve a anotar en su próximo paso
      void reconstruirAgente($, id).catch(fallo($))
    }
  }
}

/** SubagentStop: respaldo por si el turn.complete de un agente (de workflow sobre todo) no llega. */
async function marcarTerminado($: $, id: string | undefined) {
  if (!id) return
  const ahora = await $.clock.now()
  await update($, agentesA, ags => {
    const a = ags[id]
    return a && a.terminado === undefined ? { ...ags, [id]: { ...a, terminado: ahora } } : ags
  })
}

async function limpiarFlujos($: $, ahora: number) {
  const ags = await read($, agentesA)
  const conAgentes = new Set(Object.values(ags).map(a => a.flujo))
  await update($, flujosA, fls => {
    let cambio = false
    const sig = { ...fls }
    for (const f of Object.values(fls)) {
      if (conAgentes.has(f.id)) continue
      const quieto = ahora - f.ultimaActividad
      // Visto en la lista de tareas de fondo: espera a que la lista diga que terminó.
      if ((!f.visto && quieto > FLUJO_QUIETO_MS) || quieto > FLUJO_OLVIDO_MS) {
        delete sig[f.id]
        cambio = true
      }
    }
    return cambio ? sig : fls
  })
}

/** `background_tasks` de Stop y SubagentStop: lo que sigue en vuelo en la sesión. */
async function conciliarTareasDeFondo($: $, tareas: readonly { id: string; type: string }[] | undefined) {
  if (!tareas) return
  const vivos = new Set(tareas.map(t => t.id))
  const quitados = new Set<string>()
  await update($, flujosA, fls => {
    quitados.clear()
    let cambio = false
    const sig = { ...fls }
    for (const f of Object.values(fls)) {
      if (!f.taskId) continue
      if (vivos.has(f.taskId)) {
        if (!f.visto) {
          sig[f.id] = { ...f, visto: true }
          cambio = true
        }
        continue
      }
      // Ya estuvo en la lista y salió: terminó (aunque haya durado segundos).
      if (f.visto) {
        delete sig[f.id]
        quitados.add(f.id)
        cambio = true
      }
    }
    return cambio ? sig : fls
  })
  if (quitados.size) {
    // Sus agentes ya no corren, aunque se haya perdido algún turn.complete.
    const salieron: Agente[] = []
    const fichados: Ficha[] = []
    const ahoraFondo = await $.clock.now()
    await update($, agentesA, ags => {
      salieron.length = 0
      fichados.length = 0
      const quedan = Object.entries(ags).filter(([, a]) => {
        const sale = !!a.flujo && quitados.has(a.flujo)
        if (sale) salieron.push(a)
        return !sale
      })
      for (const a of salieron) fichados.push(fichar(a, ahoraFondo))
      return quedan.length === Object.keys(ags).length ? ags : Object.fromEntries(quedan)
    })
    await completarFichas($, fichados)
    depurar($, `${quitados.size} workflow(s) terminaron`)
    await revisarFin($)
  }
}

/** Si no queda nada corriendo, espera un poco (la sesión principal suele retomar) y cierra la tarea. */
async function revisarFin($: $) {
  const [ags, fls, turno, tarea] = await Promise.all([read($, agentesA), read($, flujosA), read($, turnoA), read($, tareaA)])
  const hay = Object.keys(ags).length > 0 || Object.keys(fls).length > 0 || turno !== null
  if (hay) {
    arrancarTicker($)
    return
  }
  pararTicker()
  // Sin tic que lo actualice, en-curso.json quedaría con agentes que ya no corren.
  await escribirEnCurso($, await $.clock.now()).catch(fallo($))
  if (!tarea) return
  const fin = await $.clock.now()
  if (avisoFin) return // ya hay un cierre en espera (se revisa sin await en medio)
  avisoFin = $.clock.after(ESPERA_FIN_MS, () => {
    avisoFin = undefined
    void cerrarTarea($, fin).catch(fallo($))
  })
}

async function cerrarTarea($: $, fin: number) {
  const [ags, fls, turno] = await Promise.all([read($, agentesA), read($, flujosA), read($, turnoA)])
  if (Object.keys(ags).length || Object.keys(fls).length || turno) return
  const uso = await leerUso($).catch((): Uso => ({}))
  // Solo un cierre se queda con la tarea: update escribe con ifVersion y reintenta.
  const caja: { tarea?: Tarea } = {}
  await update($, tareaA, t => {
    caja.tarea = t ?? undefined
    return null
  })
  const tarea = caja.tarea
  if (!tarea) return
  contados.clear() // la tarea siguiente cuenta a sus agentes de cero
  await update($, usoA, () => uso)
  await update($, fotosA, () => ({})) // nada corre: no queda foto huérfana
  if (tarea.agentes + tarea.flujos === 0) return // solo la sesión principal: nada que avisar
  const resumen = limpio<Resumen>({
    fin,
    minutos: (fin - tarea.inicio) / 60_000,
    agentes: tarea.agentes,
    flujos: tarea.flujos,
    costo: uso.costo !== undefined && tarea.costo0 !== undefined ? Math.max(0, uso.costo - tarea.costo0) : undefined,
    semana: uso.semana !== undefined && tarea.semana0 !== undefined ? Math.max(0, uso.semana - tarea.semana0) : undefined,
  })
  await update($, ultimaA, () => resumen)
  await update($, ahoraA, () => fin)
  if (fin - tarea.inicio < MIN_AVISO_MS) return
  const texto = `Terminó todo: ${textoResumen(resumen)}.`
  const enviado = await $.ui.notify(texto, { title: 'Terminó la tarea' })
  depurar($, `aviso: ${enviado.isSent ? 'enviado' : `no enviado (${enviado.reason}), va como toast`}`)
  if (!enviado.isSent) $.ui.toast(texto, { timeoutMs: 15_000 })
}

// ——— Agentes y workflows ———

/** Saca `name` y los títulos de `phases` del bloque `meta` de un script de workflow. */
function metaDeScript(script: string | undefined): { nombre?: string; fases: string[] } {
  if (!script) return { fases: [] }
  const meta = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/.exec(script)?.[1] ?? script.slice(0, 4000)
  const nombre = /\bname\s*:\s*(['"`])([^'"`]+)\1/.exec(meta)?.[2]
  const bloque = /\bphases\s*:\s*\[([\s\S]*?)\]/.exec(meta)?.[1] ?? ''
  const fases = [...bloque.matchAll(/\btitle\s*:\s*(['"`])([^'"`]+)\1/g)].map(m => m[2]!).slice(0, 8)
  return { nombre, fases }
}

function tipoDe(e: AgentSpawnInput): string {
  const t = e.subagentType || TIPO_GENERICO
  if (e.fork) return 'fork'
  if (!e.workflow) return t
  return t === TIPO_GENERICO || t === 'claude' ? TIPO_WORKFLOW : t
}

async function registrarAgente($: $, e: AgentSpawnInput, id: string, modelo: string | undefined) {
  if (e.isTeammate) return
  // Una reanudación es otra corrida del mismo id: se cierra la anterior y se parte de cero, sin esperar nada antes
  // (lo que quedó en memoria de la anterior no vale, y sus llamadas que vuelvan tarde se ignoran).
  let eventosPrevios: Evento[] = []
  let fichaPrevia: Ficha | undefined
  if (e.resume) {
    terminados.delete(id)
    fichaPrevia = fichas.get(id)
    fichas.delete(id)
    eventosPrevios = eventos.get(id)?.evs ?? []
    reiniciarMemoria(id)
  }
  const ahora = await $.clock.now()
  const tipo = tipoDe(e)
  const flujo = e.workflow?.runId || undefined
  await asegurarTarea($, ahora)
  const nuevo = { valor: false }
  const ya = { termino: false }
  const caja: { previo?: Agente } = {}
  await update($, agentesA, ags => {
    caja.previo = undefined
    const antes = ags[id]
    nuevo.valor = !antes
    // Si su turn.complete se procesó antes que este alta, ya terminó: crearlo dejaría un fantasma.
    ya.termino = !e.resume && terminados.has(id)
    if (ya.termino) return ags
    // La corrida anterior sigue en el estado si su turn.complete no llegó: se mide antes de reemplazarla.
    if (e.resume && antes) caja.previo = aplicarEventos(antes, eventosPrevios, ahora)
    // Una reanudación parte de cero (su reloj cuenta desde que se reanudó); el resto, si la lista lo encontró
    // antes que este spawn, conserva lo que ya se sabe de él.
    const exacto = !e.resume && antes && !antes.inicioAprox
    const base = e.resume || !antes ? agenteNuevo({ id, tipo, descripcion: e.description || tipo, inicio: ahora }) : normalizar(antes)
    const { inicioAprox: _a, visto: _v, ausente: _au, terminado: _t, ...sin } = base
    return {
      ...ags,
      [id]: limpio<Agente>({
        ...sin,
        id,
        tipo,
        descripcion: e.description || tipo,
        inicio: exacto ? antes.inicio : ahora,
        enPrimerPlano: !e.background,
        deMain: e.parentAgentId === undefined,
        flujo,
        aprende: true, // una reanudación también se mide, marcada aparte
        reanudacion: e.resume ? true : undefined,
        modelo: base.modelo ?? modelo,
      }),
    }
  })
  if (e.resume) await cerrarCorridaAnterior($, id, caja.previo, fichaPrevia, ahora).catch(fallo($))
  // Un agente cuenta una vez por tarea: reanudarlo no suma otro (salvo que la tarea sea nueva).
  const contar = nuevo.valor && !contados.has(id)
  if (contar) contados.add(id)
  let flujoNuevo = false
  if (flujo) {
    const indice = e.workflow?.agentIndex ?? 0
    const r = { nuevo: false }
    await update($, flujosA, fls => {
      const f = fls[flujo]
      r.nuevo = !f
      const base: Flujo = f ?? { id: flujo, nombre: 'workflow', fases: [], inicio: ahora, lanzados: 0, listos: 0, ultimaActividad: ahora }
      return {
        ...fls,
        [flujo]: {
          ...base,
          lanzados: Math.max(base.lanzados + (e.resume ? 0 : 1), indice), // reanudar no es lanzar otro
          listos: base.listos + (ya.termino ? 1 : 0),
          ultimaActividad: ahora,
        },
      }
    })
    flujoNuevo = r.nuevo
  }
  if (contar || flujoNuevo) {
    await update($, tareaA, t =>
      t ? { ...t, agentes: t.agentes + (contar ? 1 : 0), flujos: t.flujos + (flujoNuevo ? 1 : 0) } : t,
    )
  }
  await update($, ahoraA, () => ahora)
  if (ya.termino) {
    depurar($, `agente ${id} (${tipo}) ya había terminado cuando se registró`)
    await revisarFin($)
    return
  }
  arrancarTicker($)
  void abrirPanel($, false).catch(fallo($))
  depurar($, `agente ${id} (${tipo})${flujo ? ` del workflow ${flujo}` : ''}${e.background ? ' en segundo plano' : ''}`)
}

async function registrarFlujo($: $, script: string | undefined, nombre: string | undefined, resultado: unknown) {
  const r = (resultado ?? {}) as { status?: string; taskId?: string; runId?: string; workflowName?: string }
  const id = r.runId || r.taskId
  if (!id) return
  const meta = metaDeScript(script)
  const ahora = await $.clock.now()
  await asegurarTarea($, ahora)
  const n = { nuevo: false }
  await update($, flujosA, fls => {
    const antes = fls[id]
    n.nuevo = !antes
    return {
      ...fls,
      [id]: limpio<Flujo>({
        id,
        taskId: r.taskId,
        nombre: r.workflowName || meta.nombre || nombre || antes?.nombre || 'workflow',
        fases: meta.fases.length ? meta.fases : (antes?.fases ?? []),
        inicio: antes?.inicio ?? ahora,
        lanzados: antes?.lanzados ?? 0,
        listos: antes?.listos ?? 0,
        ultimaActividad: ahora,
        visto: antes?.visto,
        remoto: r.status === 'remote_launched' ? true : undefined,
      }),
    }
  })
  if (n.nuevo) await update($, tareaA, t => (t ? { ...t, flujos: t.flujos + 1 } : t))
  await update($, ahoraA, () => ahora)
  arrancarTicker($)
  void abrirPanel($, false).catch(fallo($))
  depurar($, `workflow ${id} (${r.workflowName ?? meta.nombre ?? '?'}), ${plural(meta.fases.length, 'fase', 'fases')}`)
}

/** Mide una corrida terminada: solo las vistas desde su spawn, de 15 s a 6 h; `fin` es la hora en que de verdad terminó. */
async function medirCorrida($: $, a: Agente, fotos: Foto[], fin: number) {
  const minutos = Math.max(0, fin - a.inicio) / 60_000
  if (!a.aprende || a.inicioAprox || minutos < MIN_MEDIR || minutos >= 6 * 60) return
  await registrarMedicion(
    $,
    limpio<Medicion>({
      t: fin,
      rol: a.tipo,
      modelo: a.modelo,
      durMin: Math.round(minutos * 100) / 100,
      llamadas: normalizar(a).llamadas,
      fotos,
      reanudacion: a.reanudacion ? true : undefined,
    }),
  )
}

/**
 * Para reanudar un agente su corrida anterior tuvo que terminar: si su turn.complete todavía no llegó, se mide ahora
 * (con el fin que se sepa, o con la hora de la reanudación) y ese turn.complete, cuando llegue, se ignora.
 */
async function cerrarCorridaAnterior($: $, id: string, previo: Agente | undefined, ficha: Ficha | undefined, ahora: number) {
  const delEstado = await sacarFotos($, id) // las fotos de la corrida anterior no se mezclan con las de la nueva
  const a = previo ?? ficha?.a
  if (!a) return
  await medirCorrida($, a, previo ? delEstado : await ficha!.fotos, a.terminado ?? ahora)
}

/** Un turn.complete que empezó antes que la corrida actual es de una corrida anterior (el agente se reanudó). */
function corridaAnterior(a: Agente, durationMs: number, ahora: number): boolean {
  if (a.inicioAprox || !(durationMs > 0)) return false // sin su hora de inicio no se puede decir: se toma como la actual
  return ahora - durationMs < a.inicio - TOL_CORRIDA_MS
}

async function terminarAgente($: $, e: TurnCompleteInput & { agentId: string }) {
  const id = e.agentId
  anotar(terminados, id) // ya terminó: antes de esperar nada, para que ni un alta tardío ni la lista lo vuelvan a crear
  await volcarEventos($).catch(fallo($)) // sus últimas llamadas y fases cuentan antes de cerrarlo
  const ahora = await $.clock.now()
  const caja: { a?: Agente; anterior: boolean } = { anterior: false }
  await update($, agentesA, ags => {
    caja.a = undefined
    caja.anterior = false
    const actual = ags[id]
    if (!actual) return ags
    // El turn.complete de una corrida que ya se reemplazó (reanudación): la corrida actual sigue y no se toca.
    if (corridaAnterior(actual, e.durationMs, ahora)) {
      caja.anterior = true
      return ags
    }
    // Lo que se anotó después del último volcado también cuenta (se lee sin vaciarlo: este cierre puede reintentarse).
    caja.a = aplicarEventos(actual, eventos.get(id)?.evs ?? [], ahora)
    const sig = { ...ags }
    delete sig[id]
    return sig
  })
  if (caja.anterior) {
    terminados.delete(id) // la corrida actual sigue viva
    depurar($, `turn.complete de una corrida anterior de ${id}: se ignora, la actual sigue`)
    return
  }
  olvidarMemoria(id)
  // Si ya se había retirado sin su turn.complete, su ficha permite medirlo igual.
  const ficha = fichas.get(id)
  fichas.delete(id)
  const a = caja.a ?? ficha?.a
  if (!a) return // no es nuestro: un fork del motor, una compactación, un compañero de equipo
  const fotos = caja.a ? await sacarFotos($, id) : ficha ? await ficha.fotos : []
  const flujo = a.flujo
  if (flujo) {
    await update($, flujosA, fls => {
      const f = fls[flujo]
      // Una reanudación no lanzó otro agente: tampoco termina otro más del workflow.
      return f ? { ...fls, [flujo]: { ...f, listos: f.listos + (a.reanudacion ? 0 : 1), ultimaActividad: ahora } } : fls
    })
  }
  // Cuándo terminó de verdad: lo que dijo SubagentStop o la lista; si se retiró sin eso, por lo que duró su turno;
  // si no, ahora. Un turn.complete tardío no alarga la corrida.
  const fin = a.terminado ?? (ficha && e.durationMs > 0 ? a.inicio + e.durationMs : ahora)
  if (e.reason === 'answer') await medirCorrida($, a, fotos, fin)
  depurar($, `agente ${id} (${a.tipo}) terminó: ${(Math.max(0, fin - a.inicio) / 60_000).toFixed(1)} min, ${normalizar(a).llamadas} llamadas, ${e.reason}`)
  await update($, ahoraA, () => ahora)
  await revisarFin($)
}

// ——— Medir la propia precisión ———

/** Una foto de la estimación de cada agente visto desde su spawn, cada minuto de corrida. */
async function tomarFotos($: $, ahora: number) {
  const s = await leerEstado($)
  const m = modeloDe(s, ahora)
  const porId = new Map(m.agentes.map(a => [a.id, a]))
  const nuevas: [string, Foto][] = []
  for (const a of Object.values(s.ags)) {
    if (a.terminado || !a.aprende || a.inicioAprox) continue
    const v = porId.get(a.id)
    if (!v || !tocaFoto(s.fotos[a.id] ?? [], v.llevaMin)) continue
    nuevas.push([a.id, fotoDe(v.llevaMin, v.estimacion, v.fase)])
  }
  const huerfanas = Object.keys(s.fotos).filter(id => !s.ags[id])
  if (!nuevas.length && !huerfanas.length) return
  await update($, fotosA, fs => {
    const sig: Record<string, Foto[]> = {}
    for (const [id, lista] of Object.entries(fs)) if (s.ags[id]) sig[id] = lista
    for (const [id, foto] of nuevas) sig[id] = [...(sig[id] ?? []), foto]
    return sig
  })
}

async function sacarFotos($: $, id: string): Promise<Foto[]> {
  const caja: { fotos: Foto[] } = { fotos: [] }
  await update($, fotosA, fs => {
    caja.fotos = fs[id] ?? []
    if (!(id in fs)) return fs
    const sig = { ...fs }
    delete sig[id]
    return sig
  })
  return caja.fotos
}

async function carpetaDatos($: $): Promise<string | undefined> {
  casa ??= (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return casa ? `${casa.replace(/[\\/]+$/, '')}/${CARPETA_DATOS}` : undefined
}

/** El id de esta sesión, apto para un nombre de archivo. */
async function idDeSesion($: $): Promise<string> {
  if (sesionId) return sesionId
  let id = ''
  try {
    id = String((await $.session.id()) ?? '')
  } catch {
    /* sin id: queda el nombre fijo */
  }
  sesionId = id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'sesion'
  return sesionId
}

/** Una falla de archivo se dice una sola vez, y nunca tumba nada. */
function avisarFalloArchivo($: $, archivo: string, err: unknown) {
  if (fallosArchivo.has(archivo)) return
  fallosArchivo.add(archivo)
  depurar($, `no pude escribir ${archivo}: ${err instanceof Error ? err.message : String(err)}`)
}

/** Escribe un archivo de datos legible desde afuera (entero: `$.fs` no agrega). */
async function escribirDatos($: $, archivo: string, texto: string) {
  try {
    const dir = await carpetaDatos($)
    if (!dir) return
    await $.fs.write(`${dir}/${archivo}`, texto)
    fallosArchivo.delete(archivo)
  } catch (err) {
    avisarFalloArchivo($, archivo, err)
  }
}

/** Una línea JSON por medición, de un archivo ya leído: una línea rota no impide leer las demás. */
function medicionesDeTexto(crudo: string): Medicion[] {
  return crudo.split('\n').flatMap(linea => {
    if (!linea.trim()) return []
    try {
      return medicionesValidas([JSON.parse(linea)])
    } catch {
      return []
    }
  })
}

/**
 * Agrega una medición a mediciones/<sesión>.jsonl, el archivo de esta sesión (las últimas 300 líneas por archivo).
 * Así nadie más lo escribe: `$.fs` no tiene "agregar" ni "renombrar", y un archivo compartido se leería y reescribiría
 * pisando lo que otra sesión escribiera en medio. Si el archivo existe y no se puede leer, no se reescribe: el store
 * queda como respaldo.
 */
async function agregarAlArchivo($: $, medicion: Medicion) {
  const archivo = `${MEDICIONES_DIR}/${await idDeSesion($)}.jsonl`
  try {
    const dir = await carpetaDatos($)
    if (!dir) return
    const ruta = `${dir}/${archivo}`
    let previas: Medicion[] = []
    if (await $.fs.exists(ruta)) {
      const crudo = await $.fs.read(ruta)
      if (typeof crudo !== 'string') throw new Error('el archivo no se pudo leer como texto')
      previas = medicionesDeTexto(crudo)
    }
    const todas = [...previas, medicion].slice(-MAX_MEDICIONES)
    await escribirDatos($, archivo, todas.map(m => JSON.stringify(m)).join('\n') + '\n')
  } catch (err) {
    avisarFalloArchivo($, archivo, err)
  }
}

/**
 * Las mediciones de todas las sesiones: se unen al leer los archivos de mediciones/ (los más nuevos primero, hasta
 * juntar 300) y el archivo único de versiones anteriores; sale lo más reciente. Si nada se puede leer, el respaldo del store.
 */
async function leerMediciones($: $): Promise<Medicion[]> {
  const respaldo = medicionesValidas(await $.store.get(CLAVE_MEDICIONES))
  try {
    const dir = await carpetaDatos($)
    if (!dir) return respaldo
    const rutas: string[] = []
    try {
      const entradas = await $.fs.list(`${dir}/${MEDICIONES_DIR}`)
      for (const x of [...entradas].sort((p, q) => q.mtimeMs - p.mtimeMs)) {
        if (x.kind === 'file' && x.name.endsWith('.jsonl')) rutas.push(`${dir}/${MEDICIONES_DIR}/${x.name}`)
      }
    } catch {
      /* todavía no hay carpeta: nadie midió con esta versión */
    }
    rutas.push(`${dir}/mediciones.jsonl`)
    const todas: Medicion[] = []
    for (const ruta of rutas) {
      if (todas.length >= MAX_MEDICIONES) break
      try {
        if (ruta.endsWith('/mediciones.jsonl') && !(await $.fs.exists(ruta))) continue
        const crudo = await $.fs.read(ruta)
        if (typeof crudo === 'string') todas.push(...medicionesDeTexto(crudo))
      } catch {
        /* un archivo que no se lee no impide leer los otros */
      }
    }
    return todas.length ? todas.sort((x, y) => x.t - y.t).slice(-MAX_MEDICIONES) : respaldo
  } catch {
    return respaldo
  }
}

/** Guarda la medición (store de respaldo + archivo de la sesión + resumen en el estado), en serie. */
function registrarMedicion($: $, medicion: Medicion): Promise<unknown> {
  cadenaStore = cadenaStore
    .then(async () => {
      const respaldo = [...medicionesValidas(await $.store.get(CLAVE_MEDICIONES)), medicion].slice(-MAX_MEDICIONES)
      await $.store.set(CLAVE_MEDICIONES, respaldo)
      await agregarAlArchivo($, medicion)
      const todas = await leerMediciones($)
      await update($, precisionA, () => precisionDe(todas) ?? null)
      depurar($, `medido ${medicion.rol}: ${medicion.durMin} min, ${plural(medicion.fotos.length, 'foto', 'fotos')}`)
    })
    .catch(fallo($))
  return cadenaStore
}

async function cargarPrecision($: $) {
  const todas = await leerMediciones($)
  await update($, precisionA, () => precisionDe(todas) ?? null)
}

/** Lo que corre y su estimación, para compararlo en vivo desde afuera: un archivo por sesión. */
async function escribirEnCurso($: $, ahora: number) {
  const s = await leerEstado($)
  const m = modeloDe(s, ahora)
  if (m.agentes.length === 0 && enCursoVacio) return
  enCursoVacio = m.agentes.length === 0
  const sesion = await idDeSesion($)
  const silencio = silenciosDesde()
  const cuerpo = {
    sesion,
    t: ahora,
    agentes: m.agentes.map(a =>
      filaEnCurso(a, {
        modelo: s.ags[a.id]?.modelo,
        reanudacion: s.ags[a.id]?.reanudacion,
        silencioMin: silencio[a.id] !== undefined ? Math.max(0, ahora - silencio[a.id]!) / 60_000 : undefined,
      }),
    ),
    total: m.agentes.length ? m.total : undefined,
    totalIncompleto: m.agentes.length ? m.totalIncompleto : undefined,
  }
  await escribirDatos($, `en-curso/${sesion}.json`, JSON.stringify(cuerpo, null, 1) + '\n')
}

async function abrirPanel($: $, pedido: boolean) {
  if (pedido) await update($, panelCerradoA, () => false)
  else if (await read($, panelCerradoA)) return
  if (!pedido && (await $.session.surfaces()).length === 0) return // -p o SDK: no hay dónde dibujar
  if (!pedido && dockea === false) return // terminal sin pantalla completa: no se abre sin pedirlo
  const abiertos = await $.ui.panes()
  if (!pedido && abiertos.some(p => p.id === PANEL)) return
  await $.ui.open({ id: PANEL, title: TITULO })
}

// ——— El modelo de la vista: lo que dibujan la línea fija y el panel ———

async function leerEstado($: $) {
  const [ags, fls, turno, tarea, uso, cola, ahoraGuardado, ultima, precision, fotos] = await Promise.all([
    read($, agentesA),
    read($, flujosA),
    read($, turnoA),
    read($, tareaA),
    read($, usoA),
    read($, colaA),
    read($, ahoraA),
    read($, ultimaA),
    read($, precisionA),
    read($, fotosA),
  ])
  return { ags, fls, turno, tarea, uso, cola, ahoraGuardado, ultima, precision, fotos }
}

function modeloDe(s: Awaited<ReturnType<typeof leerEstado>>, ahora?: number) {
  const agentes = Object.values(s.ags)
  return construirModelo({
    ahora: ahora ?? ahoraDe(s.ahoraGuardado, agentes, s.turno),
    agentes,
    flujos: Object.values(s.fls),
    cola: s.cola,
    turno: s.turno,
    tarea: s.tarea,
    uso: s.uso,
    ultima: s.ultima,
    precision: s.precision,
    silencioDesde: silenciosDesde(),
  })
}

async function modeloVista($: $) {
  return modeloDe(await leerEstado($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    sesionId = undefined // cada session.start puede ser otra sesión: su id se vuelve a leer
    await $.command.register({
      name: 'cuanto-falta',
      description: 'Abre el panel de cuánto falta para que terminen los agentes; "datos" muestra qué tan bien acierta el mod y lo que corre ahora',
      argumentHint: '[datos]',
      immediate: true,
    })
    await cargarPrecision($).catch(fallo($))
    enCursoVacio = false // el archivo puede venir de otra sesión: se deja al día una vez
    void escribirEnCurso($, await $.clock.now()).catch(fallo($))
    // Agentes que ya corren (el mod se cargó con la sesión en marcha): se descubren ahora, sin esperar a un turno.
    await conciliarLista($, await $.clock.now()).catch(fallo($))
    // Tras una recarga del mod, $.state sigue: si algo corría, retoma el reloj.
    const [ags, fls, turno, tarea] = await Promise.all([read($, agentesA), read($, flujosA), read($, turnoA), read($, tareaA)])
    if (Object.keys(ags).length || Object.keys(fls).length || turno) arrancarTicker($)
    else if (tarea) await revisarFin($).catch(fallo($)) // un cierre pendiente se perdió con la recarga
    return r
  })

  on('command.run', { command: 'cuanto-falta' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'datos') {
      const [medidas, s] = await Promise.all([leerMediciones($), leerEstado($)])
      return { text: textoDatos(medidas, modeloDe(s).agentes) }
    }
    await abrirPanel($, true)
    return { text: 'Panel «Cuánto falta» abierto.' }
  })

  // Anota cada llamada de un agente (fase, cuenta, lista de pasos). Sin await antes de next: no demora ninguna herramienta.
  on('tool.call', ($, e, next) => {
    const id = e.agentId
    const entrada = id !== undefined || e.tool === 'Workflow' ? argumentos(e) : undefined
    if (id !== undefined) {
      try {
        seguirLlamada(id, e.tool, entrada)
      } catch (err) {
        fallo($)(err) // observar nunca debe romper una herramienta
      }
    }
    const corrida = id !== undefined ? (generacion.get(id) ?? 0) : 0
    const llamada = next(e)
    if (id !== undefined || e.tool === 'Workflow') {
      const flujo = e.tool === 'Workflow' ? { script: e.script, name: e.name } : undefined
      void alVolver($, e.tool, entrada, id, corrida, llamada, flujo).catch(fallo($))
    }
    return llamada
  })

  // El modelo de cada agente y si ya escribe su informe. Cada pedazo pasa tal cual, sin demorar nada.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id === undefined) return yield* next(e)
    try {
      if (modeloVisto.get(id) !== e.model) {
        modeloVisto.set(id, e.model)
        registrar(id, { k: 'modelo', modelo: e.model })
      }
    } catch (err) {
      fallo($)(err)
    }
    let texto = 0
    let herramienta = false
    let informe = false
    for await (const c of next(e)) {
      try {
        if (!herramienta && c.kind === 'text') {
          texto += c.text.length
          if (!informe && texto >= MIN_TEXTO_INFORME) {
            informe = true
            registrar(id, { k: 'informe' })
          }
        } else if (!herramienta && c.kind === 'tool') {
          herramienta = true
          if (informe) {
            informe = false
            registrar(id, { k: 'sinInforme' })
          }
        }
      } catch (err) {
        fallo($)(err)
      }
      yield c
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) void registrarAgente($, e, r.agentId, r.model || undefined).catch(fallo($))
    return r
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      const id = e.turnId
      turnoVivo = id
      void (async () => {
        const ahora = await $.clock.now()
        // Si el turno ya terminó mientras esperábamos, no se vuelve a marcar (ni en un reintento).
        await update($, turnoA, t => (turnoVivo === id ? { inicio: ahora } : t))
        await update($, ahoraA, () => ahora)
        await asegurarTarea($, ahora)
        arrancarTicker($)
      })().catch(fallo($))
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) {
      turnoVivo = undefined
      void (async () => {
        await update($, turnoA, () => null)
        await revisarFin($)
      })().catch(fallo($))
    } else {
      void terminarAgente($, { ...e, agentId }).catch(fallo($))
    }
    return next(e)
  })

  // Lo que sigue en vuelo: así se sabe cuándo terminó un workflow.
  on('classic.Stop', ($, e, next) => {
    void conciliarTareasDeFondo($, e.background_tasks).catch(fallo($))
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    const r = await next(e) // el resultado vuelve intacto; esperar a next no demora nada
    // Si un hook SubagentStop de la persona bloqueó el fin, el agente sigue trabajando: no se marca.
    const sigue = typeof r.block === 'string'
    void (sigue ? Promise.resolve() : marcarTerminado($, e.agent_id))
      .then(() => conciliarTareasDeFondo($, e.background_tasks))
      .catch(fallo($))
    return r
  })

  // Si la persona cierra el panel, no se vuelve a abrir solo en esta sesión.
  on('ui.close', { id: PANEL }, ($, e, next) => {
    if (e.origin.kind === 'person') void update($, panelCerradoA, () => true).catch(fallo($))
    return next(e)
  })

  // ——— Línea fija sobre el prompt ———
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    dockea = e.viewport?.isFullscreen
    if (e.props.hasSurvey) return next(e)
    const m = await modeloVista($)
    if (!hayTrabajo(m)) return next(e)
    return dibujarBanda($, e, m, () => {
      void abrirPanel($, true).catch(fallo($))
    })
  })

  // ——— Panel al costado ———
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => dibujarPanel($, e, await modeloVista($)))
}
