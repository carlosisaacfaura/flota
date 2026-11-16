// Corridas reales de subagentes, leídas de los transcripts de Claude Code y repetidas como las ve el mod
// en vivo. Cada corrida queda solo como números y nombres de rol, modelo y fase: nada de descripciones,
// prompts, rutas ni comandos.
//
//   node herramientas/dataset.mjs            → escribe datos/corridas.jsonl (caché para evaluar.mjs)
//
// Lo usan tablas.mjs (siempre relee los transcripts: regenerar es determinista) y evaluar.mjs.
import './resolver.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
export const RAIZ_MOD = path.resolve(AQUI, '..')
export const CACHE = path.join(RAIZ_MOD, 'datos', 'corridas.jsonl')
const { clasificar, actualizarLista, resumirLista } = await import(path.join(RAIZ_MOD, 'hooks', 'fase.ts'))

export const FASES = ['arrancando', 'leyendo', 'investigando', 'editando', 'probando', 'navegando', 'commit', 'delegando', 'informe']
const IDX = Object.fromEntries(FASES.map((f, i) => [f, i]))

// Las mismas reglas que la pieza B (hooks/modelo.ts): qué delega, qué escribe la lista y cuánto texto es informe.
const ES_DELEGACION = new Set(['Agent', 'Task', 'Workflow'])
const ES_LISTA = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
const MIN_TEXTO_INFORME = 200
const ENTREGA = new Set(['StructuredOutput', 'SubagentHandback'])

export const MIN_DUR = 0.25 // min: corridas de segundos suelen ser fallas
export const MAX_DUR = 360

function archivos(raiz) {
  const salida = []
  const walk = (d, k) => {
    let entradas
    try {
      entradas = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entradas) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (k < 6) walk(p, k + 1)
      } else if (/^agent-[\w-]+\.jsonl$/.test(e.name) && p.includes(`${path.sep}subagents${path.sep}`)) salida.push(p)
    }
  }
  walk(raiz, 0)
  return salida.sort()
}

function textoDe(m) {
  if (!m) return ''
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.filter(b => b?.type === 'text').map(b => b.text ?? '').join('')
  return ''
}

function esResultado(o) {
  return Array.isArray(o.message?.content) && o.message.content.some(b => b?.type === 'tool_result')
}

/** Un mensaje de usuario que abre una corrida (el encargo, o una reanudación escrita como mensaje). */
function esPedido(o) {
  if (o.type !== 'user' || o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly || esResultado(o)) return false
  return !/^This session is being continued/.test(textoDe(o.message))
}

/** El encargo de un agente de workflow llega como mensajes del arnés: abren la corrida, nunca una reanudación. */
function esDelArnes(o) {
  return /^\[Workflow harness/.test(textoDe(o.message))
}

/**
 * Un empujón del motor: mensaje meta que el arnés inyecta dentro del mismo turno («Your response above was
 * cut off…», `[handback-send-enforce]`, `[structured-output-enforce]`, un `<system-reminder>`). No es una
 * reanudación: el agente sigue en la misma corrida.
 */
function esEmpujon(o) {
  return /^(Your response above was cut off|\[handback-send-enforce\]|\[structured-output-enforce\]|<system-reminder>)/.test(textoDe(o.message).trimStart())
}

function normalizarModelo(m) {
  if (typeof m !== 'string' || !m || m.startsWith('<')) return undefined
  return m.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
}

/**
 * Repite un tramo como lo vería el mod: fase, desde cuándo, vistas, llamadas, lista y desde cuándo está en
 * silencio (sin ninguna herramienta en vuelo, desde el último resultado), en cada cambio.
 */
function repetir(lineas, inicio) {
  const t = o => Math.max(0, (Date.parse(o.timestamp) - inicio) / 60_000)
  let fase = 'arrancando'
  let faseDesde = 0
  const vistas = []
  let llamadas = 0
  let lista
  let previa
  const enVuelo = new Set() // delegaciones que espera
  const pendientes = new Set() // cualquier herramienta sin resultado todavía
  let silencioDesde = -1
  const usos = new Map()
  const puntos = []
  let ultimoResultado = 0
  let ultimoT = 0
  const marcar = tt => {
    const r = resumirLista(lista)
    let mask = 0
    for (const v of vistas) mask |= 1 << IDX[v]
    const r3 = x => Math.round(x * 1000) / 1000
    puntos.push([r3(tt), IDX[fase], llamadas, r3(faseDesde), mask, r?.hechos ?? 0, r?.total ?? 0, silencioDesde < 0 ? -1 : r3(silencioDesde)])
  }
  const entrar = (f, tt) => {
    if (fase === f) return
    if (f !== 'arrancando' && !vistas.includes(f)) vistas.push(f)
    fase = f
    faseDesde = tt
  }
  for (const o of lineas) {
    if (o.type !== 'assistant' && o.type !== 'user') continue
    const tt = Math.max(ultimoT, t(o))
    ultimoT = tt
    const contenido = Array.isArray(o.message?.content) ? o.message.content : []
    if (o.type === 'assistant') {
      let hubo = false
      for (const b of contenido) {
        if (b?.type !== 'tool_use') continue
        hubo = true
        llamadas++
        usos.set(b.id, b)
        pendientes.add(b.id)
        silencioDesde = -1
        if (ES_DELEGACION.has(b.name)) {
          previa = fase === 'delegando' ? previa : { fase, desde: faseDesde }
          entrar('delegando', tt)
          enVuelo.add(b.id)
          continue
        }
        let f = null
        try {
          f = clasificar(b.name, b.input)
        } catch {
          f = null
        }
        if (f) {
          if (fase === 'delegando' && enVuelo.size) {
            if (!vistas.includes(f) && f !== 'arrancando') vistas.push(f)
            previa = { fase: f, desde: tt }
          } else entrar(f, tt)
        }
      }
      if (hubo) marcar(tt)
    } else {
      let cambio = false
      for (const b of contenido) {
        if (b?.type !== 'tool_result') continue
        ultimoResultado = tt
        const uso = usos.get(b.tool_use_id)
        if (!uso) continue
        if (pendientes.delete(b.tool_use_id) && pendientes.size === 0) {
          silencioDesde = tt
          cambio = true
        }
        if (enVuelo.delete(b.tool_use_id) && enVuelo.size === 0 && fase === 'delegando') {
          const vuelve = previa?.fase
          if (vuelve && vuelve !== 'arrancando' && vuelve !== 'delegando') entrar(vuelve, tt)
          previa = undefined
          cambio = true
        }
        if (ES_LISTA.has(uso.name) && !b.is_error) {
          try {
            const nueva = actualizarLista(lista, uso.name, uso.input, o.toolUseResult ?? b.content)
            if (nueva !== lista) {
              lista = nueva
              cambio = true
            }
          } catch {
            /* como en vivo: una lista que no se entiende no tumba nada */
          }
        }
      }
      if (cambio) marcar(tt)
    }
  }
  return { puntos, ultimoResultado, llamadas }
}

/**
 * Corta un transcript en corridas y deja solo las que terminaron bien. Cada turno es una corrida, como en
 * vivo (el mod cierra al agente en su turn.complete): el encargo abre la primera, y cada reanudación (casi
 * siempre un mensaje meta del motor —«The coordinator sent a message…», «[SYSTEM NOTIFICATION…»— que llega
 * después de que el agente cerró su turno) abre otra. El tiempo dormido entre turnos no cuenta.
 */
function corridasDe(lineas, meta, wf) {
  const tramos = []
  let actual = null
  let cerroTurno = false
  for (const o of lineas) {
    if (o.type !== 'user' && o.type !== 'assistant') continue
    const reanuda = o.type === 'user' && o.isMeta && !esResultado(o) && cerroTurno && !esEmpujon(o)
    if (o.type === 'assistant') cerroTurno = o.message?.stop_reason === 'end_turn' || o.message?.stop_reason === 'stop_sequence'
    if (esPedido(o) || reanuda) {
      const t = textoDe(o.message)
      if (/^\[Request interrupted/.test(t)) {
        if (actual) actual.interrumpida = true
        continue
      }
      if (!actual || (actual.asistente > 0 && !esDelArnes(o))) {
        actual = { lineas: [], asistente: 0, interrumpida: false, reanudacion: tramos.length > 0 }
        tramos.push(actual)
      }
    }
    if (!actual) continue
    if (o.type === 'assistant') actual.asistente++
    actual.lineas.push(o)
  }
  const salida = []
  for (const tr of tramos) {
    if (tr.interrumpida || !tr.asistente) continue
    const ls = tr.lineas
    const ultima = ls[ls.length - 1]
    const asistentes = ls.filter(o => o.type === 'assistant')
    const ultimoA = asistentes[asistentes.length - 1]
    let fin = null
    if (ultima.type === 'assistant' && ultima.message?.stop_reason === 'end_turn' && !ultima.isApiErrorMessage && textoDe(ultima.message).trim()) fin = 'texto'
    else if (ultima.type === 'user' && esResultado(ultima)) {
      const tu = (ultimoA?.message?.content ?? []).filter(b => b?.type === 'tool_use').map(b => b.name)
      if (tu.length && tu.every(n => ENTREGA.has(n))) fin = 'entrega'
    }
    if (!fin) continue
    const inicio = Date.parse(ls[0].timestamp)
    const termino = Date.parse(ultima.timestamp)
    if (!Number.isFinite(inicio) || !Number.isFinite(termino)) continue
    const dur = (termino - inicio) / 60_000
    if (dur < MIN_DUR || dur > MAX_DUR) continue
    const { puntos, ultimoResultado, llamadas } = repetir(ls, inicio)
    // El informe final, como lo detecta el mod: texto largo sin herramientas después de la última llamada.
    // Se guarda dónde empieza (el último resultado); el retraso con que el mod lo ve lo pone entradaEn.
    let informe = null
    if (fin === 'texto') {
      let textoFinal = ''
      for (let k = ls.length - 1; k >= 0; k--) {
        const o = ls[k]
        if (o.type === 'user' && esResultado(o)) break
        if (o.type === 'assistant') textoFinal = textoDe(o.message) + textoFinal
      }
      const ult = puntos[puntos.length - 1]
      if (textoFinal.length >= MIN_TEXTO_INFORME && ult?.[1] !== IDX.informe) {
        informe = Math.round(Math.max(ult?.[0] ?? 0, ultimoResultado) * 1000) / 1000
      }
    }
    salida.push({
      rol: meta.agentType,
      modelo: normalizarModelo(asistentes.find(o => normalizarModelo(o.message?.model))?.message?.model),
      wf,
      reanudacion: tr.reanudacion,
      inicio,
      dur: Math.round(dur * 1000) / 1000,
      llamadas,
      informe,
      puntos,
    })
  }
  return salida
}

/** Todas las corridas terminadas de los transcripts de subagentes, en orden determinista. */
export function leerCorridas({ raiz = path.join(os.homedir(), '.claude', 'projects') } = {}) {
  const corridas = []
  for (const f of archivos(raiz)) {
    let meta
    try {
      meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    } catch {
      continue
    }
    if (typeof meta?.agentType !== 'string' || !meta.agentType) continue
    const lineas = []
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!l || (!l.startsWith('{"') && !l.startsWith('{'))) continue
      if (!l.includes('"type":"user"') && !l.includes('"type":"assistant"')) continue
      try {
        lineas.push(JSON.parse(l))
      } catch {
        /* línea a medio escribir */
      }
    }
    corridas.push(...corridasDe(lineas, meta, f.includes(`${path.sep}workflows${path.sep}`)))
  }
  corridas.sort((a, b) => a.inicio - b.inicio || a.dur - b.dur)
  return corridas
}

/** Lee la caché de datos/ si existe; si no (o con `fresco`), relee los transcripts y la escribe. */
export function corridasEnCache({ fresco = false } = {}) {
  if (!fresco && fs.existsSync(CACHE)) {
    return fs.readFileSync(CACHE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  }
  const corridas = leerCorridas()
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, corridas.map(c => JSON.stringify(c)).join('\n') + '\n')
  return corridas
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now()
  const corridas = corridasEnCache({ fresco: true })
  const porRol = {}
  for (const c of corridas) porRol[c.rol] = (porRol[c.rol] ?? 0) + 1
  console.log(`reanudaciones: ${corridas.filter(c => c.reanudacion).length}`)
  console.log(`${corridas.length} corridas en ${((Date.now() - t0) / 1000).toFixed(1)} s → ${path.relative(process.cwd(), CACHE)}`)
  console.log(Object.entries(porRol).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([r, n]) => `${n} ${r}`).join('\n'))
}

/**
 * Lo que el mod sabría de una corrida en el minuto `s`, como EntradaEstimador. `puntos` son los cambios de
 * estado: [t, fase, llamadas, faseDesde, vistas (máscara), hechos, total, silencio desde (-1 = algo en vuelo)].
 * `retrasoInforme` (min): cuánto después del último resultado ve el mod el informe (en vivo, cuando ya salieron
 * 200 caracteres de texto).
 */
export function entradaEn(corrida, s, { retrasoInforme = 0 } = {}) {
  let p
  const ps = corrida.puntos
  // búsqueda binaria del último cambio en o antes de s
  let lo = 0
  let hi = ps.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ps[mid][0] <= s) {
      p = ps[mid]
      lo = mid + 1
    } else hi = mid - 1
  }
  const vistas = []
  if (p) for (let i = 1; i < FASES.length; i++) if (p[4] & (1 << i)) vistas.push(FASES[i])
  const entrada = {
    rol: corrida.rol,
    modelo: corrida.modelo,
    llevaMin: s,
    llamadas: p ? p[2] : 0,
    fase: p ? FASES[p[1]] : 'arrancando',
    faseDesdeMin: p ? Math.max(0, s - p[3]) : s,
    vistas,
    inicioAprox: false,
  }
  if (corrida.reanudacion) entrada.reanudacion = true
  if (p && p[7] >= 0) entrada.silencioMin = Math.max(0, s - p[7])
  if (p && p[6] > 0) entrada.lista = { hechos: p[5], total: p[6] }
  const desde = corrida.informe == null ? Infinity : corrida.informe + retrasoInforme
  if (s >= desde) {
    entrada.fase = 'informe'
    entrada.faseDesdeMin = s - desde
    if (!vistas.includes('informe')) vistas.push('informe')
  }
  return entrada
}

/** Cuándo ve el mod el informe de una corrida (StructuredOutput al llamarlo; el texto, con su retraso), o null. */
export function inicioInforme(corrida, retrasoInforme = 0) {
  const p = corrida.puntos.find(x => x[1] === 8)
  const porTexto = corrida.informe == null ? Infinity : corrida.informe + retrasoInforme
  const t = Math.min(p ? p[0] : Infinity, porTexto)
  return t < corrida.dur ? t : null
}

/**
 * Los ratos en silencio de una corrida: [desde, hasta) sin ninguna herramienta en vuelo, desde el último
 * resultado hasta la siguiente llamada (o el fin).
 */
export function silencios(corrida) {
  const ps = corrida.puntos
  const salida = []
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i][7]
    if (a < 0 || (i > 0 && ps[i - 1][7] === a)) continue
    let j = i + 1
    while (j < ps.length && ps[j][7] === a) j++
    salida.push([a, j < ps.length ? ps[j][0] : corrida.dur])
  }
  return salida
}
