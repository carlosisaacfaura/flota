import { expect, mock, test } from 'claude-code/testing'

import type { Agente, Flujo, Medicion } from './types'
import type { AgenteVista, EntradaEstimador, Estimacion } from './hooks/contrato'
import {
  aplicarEventos,
  agenteNuevo,
  coberturaPorConfianza,
  construirModelo,
  evaluar,
  fotoDe,
  medicionesValidas,
  normalizar,
  precisionDe,
  precisionPorRol,
  reconstruirDeMensajes,
  textoDatos,
  tocaFoto,
} from './hooks/modelo'
import type { Evento } from './hooks/modelo'
import { actualizarLista } from './hooks/fase'

const MIN = 60_000
const EN_CURSO = '/casa/.claude/cuanto-falta/en-curso/s-test.json' // un archivo por sesión
const MEDICIONES = '/casa/.claude/cuanto-falta/mediciones/s-test.jsonl' // un archivo por sesión
const MEDICIONES_DIR = '/casa/.claude/cuanto-falta/mediciones'
const MEDICIONES_ANTIGUO = '/casa/.claude/cuanto-falta/mediciones.jsonl'

// El "motor" de mentira: uso de la cuenta, lista de agentes, spawns, herramientas, archivos y la UI.
function motor(on: any, store: Record<string, unknown> = {}, estado?: Record<string, unknown>) {
  const r = {
    /** $.state en memoria (solo si el test lo pide): clave `plugin.key` → { value, version }. */
    estado: Object.fromEntries(Object.entries(estado ?? {}).map(([k, v]) => [k, { value: v, version: 1 }])) as Record<string, { value: unknown; version: number }>,
    store: { ...store } as Record<string, unknown>,
    archivos: {} as Record<string, string>,
    avisos: [] as string[],
    toasts: [] as string[],
    aperturas: 0,
    uso: { semana: 10, costo: 1 },
    lista: [] as { id: string; type: string; description: string; status: string }[],
    /** Mensajes por agente, como los entrega `$.session.messages({ agentId })`. */
    mensajes: {} as Record<string, unknown[]>,
    siguiente: 0,
    logs: [] as string[],
    bloquearFin: false,
    /** Lo que hace cada llamada a herramienta antes de contestar (para retenerla en el aire). */
    alLlamar: undefined as undefined | ((e: any) => Promise<void>),
    /** fs.write falla (sin permiso). */
    sinPermiso: false,
    /** Cada escritura de archivo, en orden. */
    escrituras: [] as string[],
    /** La próxima escritura de esa clave del estado espera a esto antes de aterrizar (una sola vez). */
    demorar: undefined as undefined | { clave: string; espera: () => Promise<void> },
    /** El id que contesta `$.session.id()`. */
    idSesion: 's-test',
    /** Última modificación de cada archivo, para `fs.list`. */
    mtimes: {} as Record<string, number>,
    /** fs.read falla aunque el archivo exista. */
    fallarLectura: false,
    resultados: {} as Record<string, unknown>,
  }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'cuanto-falta' } }))
  on('ui.open', () => {
    r.aperturas++
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('ui.log', (_: unknown, e: any) => {
    r.logs.push(String(e.text))
    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: any) => {
    r.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.notify', (_: unknown, e: any) => {
    r.avisos.push(String(e.text))
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 1000, window: 1_000_000, percent: 0 },
      rateLimits: [{ kind: 'seven_day', percentUsed: r.uso.semana }],
      cost: { usd: r.uso.costo },
    },
  }))
  on('store.get', (_: unknown, e: any) => ({ value: r.store[e.key] }))
  on('store.set', (_: unknown, e: any) => {
    r.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/casa' : undefined }))
  on('fs.write', (_: unknown, e: any) => {
    if (r.sinPermiso) throw new Error('sin permiso')
    r.escrituras.push(e.path)
    r.archivos[e.path] = e.text
    return { value: undefined }
  })
  on('session.id', () => ({ value: r.idSesion }))
  on('fs.list', (_: unknown, e: any) => {
    const dir = String(e.path).replace(/\/+$/, '')
    const hijos = Object.keys(r.archivos).filter(p => p.startsWith(`${dir}/`))
    if (!hijos.length) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return {
      value: hijos
        .filter(p => !p.slice(dir.length + 1).includes('/'))
        .map(p => ({ name: p.slice(dir.length + 1), kind: 'file', size: r.archivos[p]!.length, mtimeMs: r.mtimes[p] ?? 0, isLink: false })),
    }
  })
  on('fs.exists', (_: unknown, e: any) => ({ value: e.path in r.archivos }))
  on('fs.read', (_: unknown, e: any) => {
    if (!(e.path in r.archivos)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    if (r.fallarLectura) throw new Error('EIO')
    return { value: r.archivos[e.path] }
  })
  on('session.messages', (_: unknown, e: any) => ({ value: r.mensajes[e.agentId] ?? { deny: `sin mensajes de ${e.agentId}` } }))
  if (estado) {
    on('state.get', (_: unknown, e: any) => ({ value: r.estado[`${e.plugin}.${e.key}`] ?? { value: undefined, version: 0 } }))
    on('state.set', async (_: unknown, e: any) => {
      if (r.demorar && e.key === r.demorar.clave) {
        const { espera } = r.demorar
        r.demorar = undefined
        await espera()
      }
      const k = `${e.plugin}.${e.key}`
      const actual = r.estado[k] ?? { value: undefined, version: 0 }
      if (e.ifVersion !== undefined && e.ifVersion !== actual.version) return { value: { isSet: false, version: actual.version } }
      r.estado[k] = { value: JSON.parse(JSON.stringify(e.value ?? null)), version: actual.version + 1 }
      return { value: { isSet: true, version: actual.version + 1 } }
    })
  }
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => (r.bloquearFin ? { block: 'sigue trabajando' } : {}))
  // La lista del motor: un agente lanzado por la sesión sale como "running" y al terminar como "completed".
  on('agent.list', () => ({ value: r.lista }))
  on('agent.spawn', (_: unknown, e: any) => {
    const agentId = e.resume?.agentId ?? `a${++r.siguiente}` // una reanudación sigue con el mismo id
    if (!e.workflow) {
      const fila = r.lista.find(a => a.id === agentId)
      if (fila) fila.status = 'running'
      else r.lista.push({ id: agentId, type: e.subagentType, description: e.description, status: 'running' })
    }
    return { model: 'claude-sonnet-5-5', agentId }
  })
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => {
    const fila = r.lista.find(a => a.id === e.agentId)
    if (fila) fila.status = 'completed'
    return { text: '' }
  })
  on('tool.call', async (_: unknown, e: any) => {
    await r.alLlamar?.(e)
    if (r.resultados[e.tool] !== undefined) return { result: r.resultados[e.tool] }
    return e.tool === 'Workflow'
      ? { result: { status: 'async_launched', taskId: 'tw1', runId: 'wf_1', workflowName: 'revisar-cambios' } }
      : { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  // El motor dibuja "motor" donde el mod no dibuja nada.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>motor</Text>
  })
  return r
}

type Motor = ReturnType<typeof motor>

const BANDA = {
  plugin: 'cuanto-falta',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const PANEL = {
  plugin: 'cuanto-falta',
  component: 'Pane',
  requestId: 'cuanto-falta',
  props: { title: 'Cuánto falta', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const inicio = { cwd: '/', surface: 'desktop', isInteractive: true } as any
const fin = (agentId: string | undefined, durationMs: number, reason = 'answer') =>
  ({ text: '', answer: 'listo', durationMs, isAborted: false, turnId: `t-${agentId ?? 'main'}`, reason, agentId }) as any

// Un spawn como lo arma el motor para la herramienta Agent.
function lanzar($: any, subagentType: string, description: string, extra: Record<string, unknown> = {}) {
  return $.agent.spawn({
    prompt: 'x',
    description,
    subagentType,
    tool_use_id: 'tu-1',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
    ...extra,
  }) as Promise<{ agentId?: string }>
}

/** ¿Suma el mod su línea fija? El motor pone siempre su "motor"; lo que el mod dibuja va aparte. */
async function hayBanda($: any, surface: 'terminal' | 'desktop' = 'desktop'): Promise<boolean> {
  const ui = await $.ui.mount({ ...BANDA, surface })
  const textos = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  await ui.unmount()
  return textos.some((t: string) => t !== 'motor')
}

type FilaEnCurso = {
  id: string
  rol: string
  modelo?: string
  llevaMin: number
  inicioAprox?: boolean
  fase: string
  faseDesdeMin: number
  vistas: string[]
  llamadas: number
  reanudacion?: boolean
  silencioMin?: number
  lista?: { hechos: number; total: number }
  estimacion: { estado: string; bajoMin?: number; medioMin?: number; altoMin?: number; confianza?: string }
}

/** Lo que el mod dejó en en-curso.json: el modelo por dentro, sin pasar por el dibujo. */
function enCurso(r: Motor): { t: number; agentes: FilaEnCurso[] } {
  const crudo = r.archivos[EN_CURSO]
  if (crudo === undefined) throw new Error('el mod no escribió en-curso.json')
  return JSON.parse(crudo)
}

const llamar = ($: any, tool: string, agentId: string, resto: Record<string, unknown> = {}) =>
  $.tool.call({ tool, agentId, ...resto } as any) as Promise<any>

// ——— Lo que conserva de la 0.1.0 ———

test('sin agentes no aparece nada, aunque la sesión principal trabaje', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'hola', turnId: 'm1' })
  await reloj.advance(3 * MIN)
  for (const surface of ['terminal', 'desktop'] as const) expect(await hayBanda($, surface)).toBe(false)
  await $.turn.complete(fin(undefined, 3 * MIN))
  await reloj.advance(10 * MIN)
  expect(r.aperturas).toBe(0)
  expect(r.avisos.length).toBe(0)
  expect(r.store.mediciones).toBeUndefined()
  expect(enCurso(r).agentes).toEqual([]) // el archivo no queda con datos de otra sesión
})

test('abre el panel al empezar un agente y la línea fija aparece mientras corre', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  expect(await hayBanda($)).toBe(false)
  const { agentId } = await lanzar($, 'implementador', 'Endpoints de pagos')
  expect(agentId).toBe('a1') // el spawn sale tal cual: el mod no lo toca
  await reloj.settle()
  expect(r.aperturas).toBe(1)
  expect(await hayBanda($)).toBe(true)
})

test('avisa al terminar todo, con duración, costo y semana', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'implementa', turnId: 'm1' })
  await lanzar($, 'implementador', 'Pagos')
  await reloj.settle()
  await $.turn.complete(fin(undefined, 1 * MIN)) // la principal queda en pausa
  await reloj.advance(12 * MIN)
  r.uso = { semana: 12.1, costo: 4.5 }
  await $.turn.complete(fin('a1', 12 * MIN))
  await reloj.advance(5_000)
  expect(r.avisos.length).toBe(0) // espera por si la principal retoma
  await reloj.advance(30_000)
  expect(r.avisos).toEqual(['Terminó todo: 1 agente en 12 min · US$ 3,50 · 2,1% de la semana.'])
  expect(await hayBanda($)).toBe(false) // y la línea fija desaparece
})

test('no avisa si la tarea fue corta, ni si la principal retoma a tiempo', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'verificador', 'Verificar')
  await reloj.settle()
  await reloj.advance(2 * MIN)
  await $.turn.complete(fin('a1', 2 * MIN))
  await reloj.advance(1 * MIN)
  expect(r.avisos.length).toBe(0)

  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(10 * MIN)
  await $.turn.complete(fin('a2', 10 * MIN))
  await reloj.advance(5_000)
  await $.turn.start({ text: '', turnId: 'm2' }) // la principal retoma para leer el resultado
  await reloj.advance(2 * MIN)
  expect(r.avisos.length).toBe(0)
  await $.turn.complete(fin(undefined, 2 * MIN))
  await reloj.advance(30_000)
  expect(r.avisos.length).toBe(1)
})

test('el panel y la línea fija se dibujan con la vista, en terminal y escritorio', async ($, on) => {
  const reloj = mock.clock(on)
  motor(on)
  await $.session.start(inicio)
  await lanzar($, 'investigador', 'Docs de Meta')
  const wf = await $.tool.call({
    tool: 'Workflow',
    script: "export const meta = {\n  name: 'revisar-cambios',\n  description: 'x',\n  phases: [{ title: 'Revisar' }, { title: 'Verificar' }],\n}\nawait agent('p')",
  } as any)
  expect((wf as any).result?.runId).toBe('wf_1')
  await lanzar($, 'general-purpose', 'revisar:bugs', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await reloj.settle()
  await reloj.advance(3 * MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect(await ui.findAll({ type: 'Text' })).not.toEqual([])
    await ui.unmount()
    expect(await hayBanda($, surface)).toBe(true)
  }
})

test('un workflow termina cuando sale de la lista de tareas de fondo', async ($, on) => {
  const reloj = mock.clock(on)
  motor(on)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'auditar', description: 'x', phases: [] }" } as any)
  await reloj.settle()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'tw1', type: 'workflow', status: 'running', description: 'auditar' }] } as any)
  await reloj.advance(1 * MIN)
  expect(await hayBanda($)).toBe(true)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)
  await reloj.settle()
  expect(await hayBanda($)).toBe(false)
})

test('un agente que muere sin avisar sale cuando la lista lo da por terminado, y no se mide', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(1 * MIN)
  expect(await hayBanda($)).toBe(true)
  r.lista[0]!.status = 'killed'
  await reloj.advance(35_000) // una vuelta lo marca, la siguiente lo quita
  expect(await hayBanda($)).toBe(false)
  expect(r.store.mediciones).toBeUndefined()
})

test('un workflow que termina en segundos no deja la línea fija pegada', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'rapido', description: 'x', phases: [] }" } as any)
  await reloj.settle()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'tw1', type: 'workflow', status: 'running', description: 'rapido' }] } as any)
  await reloj.advance(2_000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)
  await reloj.settle()
  expect(await hayBanda($)).toBe(false)
  await reloj.advance(30 * MIN)
  expect(r.avisos.length).toBe(0) // duró segundos: no hay aviso, ni uno falso de 30 min
})

test('si se pierde el turn.complete de agentes de workflow, salen cuando el workflow termina', async ($, on) => {
  const reloj = mock.clock(on)
  motor(on)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'auditar', description: 'x', phases: [] }" } as any)
  await lanzar($, 'revisor', 'auditar:bugs', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await reloj.settle()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'tw1', type: 'workflow', status: 'running', description: 'auditar' }] } as any)
  await reloj.advance(5 * MIN)
  expect(await hayBanda($)).toBe(true)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any) // terminó, sin turn.complete
  await reloj.settle()
  expect(await hayBanda($)).toBe(false)
})

test('SubagentStop sirve de respaldo, salvo que un hook de la persona bloquee el fin', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'auditar:a', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await lanzar($, 'revisor', 'auditar:b', { workflow: { runId: 'wf_1', agentIndex: 2 } })
  await reloj.settle()
  await reloj.advance(2 * MIN)
  r.bloquearFin = true
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'revisor' } as any)
  await reloj.advance(40_000)
  expect((await enCurso(r)).agentes.map(a => a.id)).toEqual(['a1', 'a2']) // bloqueado: sigue corriendo
  r.bloquearFin = false
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a2', agent_transcript_path: '', agent_type: 'revisor' } as any)
  await reloj.advance(40_000)
  expect((await enCurso(r)).agentes.map(a => a.id)).toEqual(['a1'])
})

test('un fin de turno que llega antes que su inicio no deja el turno marcado', async ($, on) => {
  const reloj = mock.clock(on)
  motor(on)
  await $.session.start(inicio)
  await Promise.all([$.turn.start({ text: 'hola', turnId: 'm1' }), $.turn.complete({ ...fin(undefined, 1), turnId: 'm1' })])
  await reloj.advance(1 * MIN)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const textos = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join(' | ')
  expect(textos).toContain('esperando tu mensaje')
  await ui.unmount()
})

test('un agente que ya corría cuando se cargó el mod cuenta en la tarea y en el aviso', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  r.lista.push({ id: 'viejo', type: 'investigador', description: 'Algo largo', status: 'running' })
  await $.session.start(inicio)
  await $.turn.start({ text: '', turnId: 'm1' })
  await $.turn.complete(fin(undefined, 1))
  await reloj.advance(20_000)
  expect(await hayBanda($)).toBe(true)
  await reloj.advance(6 * MIN)
  r.lista[0]!.status = 'completed'
  await reloj.advance(2 * MIN)
  expect(r.avisos.length).toBe(1)
  expect(r.avisos[0]).toMatch(/^Terminó todo: 1 agente en /)
  expect(r.store.mediciones).toBeUndefined() // no lo vio desde su spawn: no se mide
})

// ——— Seguimiento de cada agente ———

test('cada llamada fija la fase y se cuenta, y la herramienta contesta lo mismo de siempre', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature grande')
  await reloj.settle()
  const res = await llamar($, 'Read', 'a1', { file_path: '/a' })
  expect(res.result?.stdout).toBe('ok') // el resultado pasa intacto
  await reloj.advance(10_000)
  let a = enCurso(r).agentes[0]!
  expect([a.rol, a.fase, a.llamadas, a.vistas]).toEqual(['implementador', 'leyendo', 1, ['leyendo']])
  await llamar($, 'Edit', 'a1', { file_path: '/a', old_string: 'x', new_string: 'y' })
  await llamar($, 'Edit', 'a1', { file_path: '/b', old_string: 'x', new_string: 'y' })
  await reloj.advance(10_000)
  a = enCurso(r).agentes[0]!
  expect([a.fase, a.llamadas, a.vistas]).toEqual(['editando', 3, ['leyendo', 'editando']])
  expect(a.modelo).toBe('claude-sonnet-5-5') // el que dijo el spawn, hasta que un paso diga otro
})

test('mientras espera a un subagente está delegando, y después vuelve a lo que hacía', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  let soltar: () => void = () => {}
  r.alLlamar = async e => {
    if (e.tool === 'Agent') await new Promise<void>(res => (soltar = res))
  }
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  const delegacion = llamar($, 'Agent', 'a1', { prompt: 'p', description: 'verificar', subagent_type: 'verificador' })
  await reloj.advance(10_000)
  let a = enCurso(r).agentes[0]!
  expect([a.fase, a.llamadas]).toEqual(['delegando', 2])
  // Lo que haga aparte mientras espera no cambia la fase, pero a eso vuelve cuando el subagente responde.
  await llamar($, 'Edit', 'a1', { file_path: '/a', old_string: 'x', new_string: 'y' })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.fase).toBe('delegando')
  soltar()
  await delegacion
  await reloj.advance(10_000)
  a = enCurso(r).agentes[0]!
  expect([a.fase, a.llamadas]).toEqual(['editando', 3])
  expect(a.vistas).toEqual(['leyendo', 'delegando', 'editando'])
})

test('un agente que delega como primera cosa se queda delegando hasta su siguiente llamada', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'general-purpose', 'Coordinador')
  await reloj.settle()
  await llamar($, 'Task', 'a1', { prompt: 'p', description: 'x', subagent_type: 'revisor' })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.fase).toBe('delegando') // ya volvió, pero antes no hacía nada: no retrocede a "arrancando"
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.fase).toBe('leyendo')
})

function pasoConTexto(on: any, pasos: { chunks: any[]; espera?: Promise<void>; antes?: number }) {
  on('turn.step', async function* (_$: unknown, e: any) {
    const antes = pasos.antes ?? 1
    for (const c of pasos.chunks.slice(0, antes)) yield c
    if (pasos.espera) await pasos.espera
    for (const c of pasos.chunks.slice(antes)) yield c
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId: 'a1' } as any
const texto = (n: number, index = 0) => ({ kind: 'text', index, text: 'x'.repeat(n) })
const parar = { kind: 'stop', stopReason: 'end_turn', usage: null }

async function consumir(it: AsyncGenerator<any, any>): Promise<any[]> {
  const chunks: any[] = []
  let x = await it.next()
  while (!x.done) {
    chunks.push(x.value)
    x = await it.next()
  }
  return chunks
}

test('el modelo sale de turn.step, y los pedazos de la respuesta pasan tal cual', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  pasoConTexto(on, { chunks: [texto(20), parar] })
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  const it = $.turn.step(STEP)
  const chunks: any[] = []
  let x = await it.next()
  while (!x.done) {
    chunks.push(x.value)
    x = await it.next()
  }
  expect(chunks).toEqual([texto(20), parar])
  expect(x.value).toEqual({ turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }) // y su resultado, igual
  await reloj.advance(10_000)
  const a = enCurso(r).agentes[0]!
  expect(a.modelo).toBe('claude-opus-5-5')
  expect(a.fase).toBe('arrancando') // 20 caracteres no son un informe
})

test('un paso con texto largo y sin herramientas es el informe; si después viene una herramienta, no lo era', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  let seguir: () => void = () => {}
  const espera = new Promise<void>(res => (seguir = res))
  pasoConTexto(on, { chunks: [texto(150), texto(100), { kind: 'tool', index: 1, id: 'tu1', name: 'Read' }, parar], espera, antes: 2 })
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  const it = $.turn.step(STEP)
  await it.next() // 150 caracteres: todavía no
  await it.next() // 250: ya escribe el informe
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.fase).toBe('informe')
  seguir()
  await consumir(it)
  await reloj.advance(10_000)
  const a = enCurso(r).agentes[0]!
  expect(a.fase).toBe('leyendo') // vuelve a lo que hacía
  expect(a.vistas).toEqual(['leyendo']) // y el falso aviso no queda en lo que ya pasó
})

test('el informe de verdad se queda como fase hasta que el agente termina', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  pasoConTexto(on, { chunks: [texto(400), parar] })
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await llamar($, 'Edit', 'a1', { file_path: '/a', old_string: 'x', new_string: 'y' })
  await consumir($.turn.step(STEP))
  await reloj.advance(10_000)
  const a = enCurso(r).agentes[0]!
  expect([a.fase, a.vistas]).toEqual(['informe', ['editando', 'informe']])
})

test('la lista de pasos: la llamada se cuenta sin mover la fase, y la lista sale de lo que escribe y contesta la herramienta', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  r.resultados.TaskCreate = { task: { id: '1', subject: 'Escribir tests' } }
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  const todos = [
    { content: 'Leer', status: 'completed', activeForm: 'Leyendo' },
    { content: 'Editar', status: 'in_progress', activeForm: 'Editando' },
    { content: 'Probar', status: 'pending', activeForm: 'Probando' },
  ]
  await llamar($, 'TodoWrite', 'a1', { todos })
  await reloj.advance(10_000)
  const a = enCurso(r).agentes[0]!
  expect([a.llamadas, a.fase]).toEqual([2, 'leyendo']) // escribir la lista no es una fase
  // La lista misma la arma `actualizarLista` (pieza del estimador): se comprueba contra su contrato en cuanto es real.
  const real = actualizarLista(undefined, 'TodoWrite', { todos }, undefined) !== undefined
  if (real) expect(a.lista).toMatchObject({ hechos: 1, total: 3 })
  else expect(a.lista).toBeUndefined()
})

test('un agente que ya corría se reconstruye con sus mensajes: llamadas, fase y lista', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  r.lista.push({ id: 'viejo', type: 'investigador', description: 'Algo largo', status: 'running' })
  const uso = (tool: string, input: unknown, resultado: unknown = { ok: true }) => ({ tool_use_id: tool, tool, input, result: resultado, text: 'ok' })
  r.mensajes.viejo = [
    { role: 'user', text: 'haz algo', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [uso('Read', { file_path: '/a' }), uso('Grep', { pattern: 'x' })] },
    { role: 'assistant', text: '', toolUses: [uso('Edit', { file_path: '/a', old_string: 'x', new_string: 'y' })] },
  ]
  await $.session.start(inicio) // lo descubre al abrir la sesión, sin esperar a un turno
  await reloj.advance(10_000)
  const a = enCurso(r).agentes.find(x => x.id === 'viejo')!
  expect(a.inicioAprox).toBe(true)
  expect([a.rol, a.llamadas, a.fase, a.vistas]).toEqual(['investigador', 3, 'editando', ['leyendo', 'editando']])
  // Las llamadas nuevas se suman a lo reconstruido.
  await llamar($, 'Read', 'viejo', { file_path: '/b' })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes.find(x => x.id === 'viejo')!.llamadas).toBe(4)
})

test('un agente que el motor no deja leer queda con inicio aproximado y sin historia', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  r.lista.push({ id: 'ajeno', type: 'revisor', description: 'x', status: 'running' }) // session.messages contesta { deny }
  await $.session.start(inicio)
  await reloj.advance(10_000)
  const a = enCurso(r).agentes.find(x => x.id === 'ajeno')!
  expect([a.inicioAprox, a.llamadas, a.fase]).toEqual([true, 0, 'arrancando'])
})

// ——— Medir la propia precisión ———

test('toma una foto por minuto y, al terminar, guarda la medición en el store y en el archivo', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Pagos con descripción privada')
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  await reloj.advance(2 * MIN + 5_000)
  await llamar($, 'Edit', 'a1', { file_path: '/a', old_string: 'x', new_string: 'y' })
  await reloj.advance(1 * MIN + 45_000) // 3 min 50 s en total
  // En vivo, antes de terminar, el archivo tiene la estimación de lo que corre.
  const vivo = enCurso(r).agentes[0]!
  expect(vivo.llevaMin).toBeGreaterThanOrEqual(3.5)
  expect(['rango', 'calculando', 'pasado']).toContain(vivo.estimacion.estado)
  await $.turn.complete(fin('a1', 230_000))
  await reloj.settle()

  const guardadas = r.store.mediciones as Medicion[]
  expect(guardadas.length).toBe(1)
  const m = guardadas[0]!
  expect([m.rol, m.modelo, m.durMin, m.llamadas]).toEqual(['implementador', 'claude-sonnet-5-5', 3.83, 2])
  expect(m.fotos.map(f => f[0])).toEqual([1, 2, 3]) // una por minuto de corrida
  expect(m.fotos.map(f => f[5])).toEqual(['leyendo', 'leyendo', 'editando']) // la fase de cada momento
  for (const f of m.fotos) expect(['r', 'c', 'p']).toContain(f[1])

  // El archivo trae lo mismo, una línea JSON por agente, y nada de descripciones ni de prompts.
  const lineas = r.archivos[MEDICIONES]!.trim().split('\n')
  expect(lineas.length).toBe(1)
  expect(JSON.parse(lineas[0]!)).toEqual(m)
  expect(r.archivos[MEDICIONES]).not.toContain('privada')
  expect(r.archivos[EN_CURSO]).not.toContain('privada')
  // Y al quedar en reposo, en-curso.json ya no muestra agentes.
  expect(enCurso(r).agentes).toEqual([])
})

test('la foto es la misma estimación que el mod mostraba en ese momento', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(1 * MIN)
  const e = enCurso(r).agentes[0]!.estimacion
  await reloj.advance(1 * MIN)
  await $.turn.complete(fin('a1', 2 * MIN))
  await reloj.settle()
  const foto1 = (r.store.mediciones as Medicion[])[0]!.fotos[0]!
  expect(foto1[0]).toBe(1)
  expect(foto1[1]).toBe(e.estado === 'rango' ? 'r' : e.estado === 'pasado' ? 'p' : 'c')
  if (e.estado === 'rango') expect([foto1[2], foto1[3], foto1[4]]).toEqual([e.bajoMin, e.medioMin, e.altoMin].map(x => Math.round(x! * 10) / 10))
})

test('solo mide agentes que terminan bien y que vio desde su spawn; una reanudación también, marcada aparte', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Falla')
  await lanzar($, 'revisor', 'Normal')
  await reloj.settle()
  await reloj.advance(2 * MIN)
  await $.turn.complete(fin('a1', 2 * MIN, 'error')) // no terminó con una respuesta
  await reloj.settle()
  expect(r.store.mediciones).toBeUndefined()
  await $.turn.complete(fin('a2', 2 * MIN))
  await reloj.advance(5_000)
  // Se le escribe y retoma: otra corrida del mismo agente, con su reloj desde cero.
  await lanzar($, 'revisor', 'Retomado', { resume: { agentId: 'a2' } })
  await reloj.settle()
  await reloj.advance(90_000)
  await $.turn.complete(fin('a2', 90_000))
  await reloj.settle()
  const medidas = r.store.mediciones as Medicion[]
  expect(medidas.map(m => [m.rol, m.durMin, m.reanudacion])).toEqual([['revisor', 2, undefined], ['revisor', 1.5, true]])
  expect(medidas[1]!.fotos[0]![0]).toBe(1) // sus fotos cuentan desde que se reanudó
  const lineas = r.archivos[MEDICIONES]!.trim().split('\n')
  expect(lineas.map(l => JSON.parse(l).reanudacion)).toEqual([undefined, true])
})

test('sigue guardando los últimos 300 agentes, aunque el archivo no se pueda escribir', async ($, on) => {
  const reloj = mock.clock(on)
  const previas: Medicion[] = Array.from({ length: 300 }, (_, i) => ({ t: i, rol: 'viejo', durMin: 1, llamadas: 1, fotos: [] }))
  const r = motor(on, { mediciones: previas })
  r.sinPermiso = true
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Nuevo')
  await reloj.settle()
  await reloj.advance(1 * MIN)
  await $.turn.complete(fin('a1', 1 * MIN))
  await reloj.settle()
  const guardadas = r.store.mediciones as Medicion[]
  expect(guardadas.length).toBe(300)
  expect(guardadas.at(-1)!.rol).toBe('revisor')
  expect(guardadas[0]!.t).toBe(1)
  expect(r.logs.filter(l => l.includes('no pude escribir')).length).toBeLessThanOrEqual(2) // avisa una vez por archivo, no en cada tic
})

test('al medir un agente deja el resumen de precisión en el estado y vacía sus fotos', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {}, {})
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(2 * MIN + 30_000)
  expect(Object.keys(r.estado['cuanto-falta.fotos']!.value as object)).toEqual(['a1']) // en vivo, las fotos del agente
  expect((r.estado['cuanto-falta.fotos']!.value as any).a1.length).toBe(2)
  await $.turn.complete(fin('a1', 150_000))
  await reloj.settle()
  const medidas = r.store.mediciones as Medicion[]
  expect(r.estado['cuanto-falta.precision']!.value).toEqual(precisionDe(medidas) ?? null)
  expect(r.estado['cuanto-falta.fotos']!.value).toEqual({})
})

test('tras recargar el mod con el estado de la 0.1.0, el agente sigue con su conteo y se mide al terminar', async ($, on) => {
  const reloj = mock.clock(on, { now: 5 * MIN })
  const viejo = { id: 'a9', tipo: 'implementador', descripcion: 'd', inicio: 0, pasos: 40, enPrimerPlano: false, deMain: true, aprende: true, visto: true }
  const r = motor(on, {}, {
    'cuanto-falta.agentes': { a9: viejo },
    'cuanto-falta.tarea': { inicio: 0, agentes: 1, flujos: 0 },
    'cuanto-falta.ahora': 5 * MIN,
  })
  r.lista.push({ id: 'a9', type: 'implementador', description: 'd', status: 'running' })
  await $.session.start(inicio) // el estado sigue: retoma el reloj sin que nadie lo llame
  await reloj.advance(10_000)
  let a = enCurso(r).agentes[0]!
  expect([a.id, a.llamadas, a.fase, a.inicioAprox]).toEqual(['a9', 40, 'arrancando', undefined])
  await llamar($, 'Edit', 'a9', { file_path: '/a', old_string: 'x', new_string: 'y' })
  await reloj.advance(10_000)
  a = enCurso(r).agentes[0]!
  expect([a.llamadas, a.fase]).toEqual([41, 'editando'])
  await $.turn.complete(fin('a9', 5 * MIN))
  await reloj.settle()
  expect((r.store.mediciones as Medicion[]).map(m => [m.rol, m.llamadas])).toEqual([['implementador', 41]])
})

test('el reloj late cada 10 s mientras algo corre y se detiene en reposo', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  const antes = r.escrituras.length
  await reloj.advance(60_000)
  expect(r.escrituras.length - antes).toBe(6) // un en-curso.json por tic
  await $.turn.complete(fin('a1', 60_000))
  await reloj.advance(1 * MIN) // alcanza el cierre de la tarea
  const quieto = r.escrituras.length
  await reloj.advance(30 * MIN)
  expect(r.escrituras.length).toBe(quieto) // sin agentes no hay reloj
  expect(enCurso(r).agentes).toEqual([])
})

test('el silencio corre desde que vuelve la última herramienta y no existe mientras alguna corre', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  const soltar: Record<string, () => void> = {}
  r.alLlamar = async e => {
    if (e.tool === 'Bash') await new Promise<void>(res => (soltar[e.command] = res))
  }
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBeUndefined() // todavía no hizo ninguna llamada
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  await reloj.settle()
  await reloj.advance(90_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBe(1.5) // desde que volvió el Read
  // Dos llamadas en paralelo: mientras alguna corre no hay silencio; empieza cuando vuelve la última.
  const lenta = llamar($, 'Bash', 'a1', { command: 'lenta' })
  const otra = llamar($, 'Bash', 'a1', { command: 'otra' })
  await reloj.advance(30_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBeUndefined()
  soltar.lenta!()
  await lenta
  await reloj.settle()
  await reloj.advance(20_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBeUndefined() // aún queda una
  soltar.otra!()
  await otra
  await reloj.settle()
  await reloj.advance(30_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBe(0.5) // desde que volvió la última, no la primera
  // Una llamada nueva corta el silencio de nuevo.
  const tercera = llamar($, 'Bash', 'a1', { command: 'tercera' })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBeUndefined()
  soltar.tercera!()
  await tercera
})

test('un agente que muere con llamadas pendientes no deja su silencio colgado', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  r.alLlamar = async e => {
    if (e.tool === 'Bash') await new Promise<void>(() => {}) // nunca vuelve
  }
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  void llamar($, 'Bash', 'a1', { command: 'colgada' })
  await reloj.advance(1 * MIN)
  await $.turn.complete(fin('a1', 1 * MIN))
  await reloj.settle()
  await lanzar($, 'revisor', 'Retomado', { resume: { agentId: 'a1' } })
  await reloj.settle()
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBeUndefined() // sin llamadas viejas pendientes que lo falseen
})

test('/cuanto-falta datos responde la precisión y las estimaciones en curso; sin argumentos abre el panel', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {
    mediciones: [{ t: 1, rol: 'implementador', modelo: 'claude-opus-5-5', durMin: 10, llamadas: 40, fotos: [[2, 'r', 6, 8, 12, 'leyendo', 'm']] }],
  })
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(1 * MIN)
  const entrada = { origin: { kind: 'composer' }, presentation: {} } as any
  const datos = (await $.command.run({ command: 'cuanto-falta', args: 'datos', ...entrada })) as any
  expect(datos.text).toContain('Precisión medida con 1 agente terminado')
  expect(datos.text).toContain('implementador')
  expect(datos.text).toContain('Estimaciones en curso')
  expect(datos.text).toContain('revisor')
  const antes = r.aperturas
  const abre = (await $.command.run({ command: 'cuanto-falta', args: '', ...entrada })) as any
  expect(abre.text).toContain('Panel')
  expect(r.aperturas).toBe(antes + 1)
})

// ——— Ronda de arreglos: lo que encontraron la revisión y el barrido de privacidad ———

const SUBAGENT_STOP = (id: string, tipo: string) =>
  ({ stop_hook_active: false, agent_id: id, agent_transcript_path: '', agent_type: tipo }) as any

test('un agente dado por terminado por SubagentStop no reaparece si la lista aún lo da corriendo, y se mide cuando su turn.complete llega tarde', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Pagos')
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  await reloj.advance(6 * MIN)
  await $.classic.SubagentStop(SUBAGENT_STOP('a1', 'implementador'))
  await reloj.advance(35_000) // la lista del motor de mentira sigue diciendo "running" hasta el turn.complete
  expect(enCurso(r).agentes).toEqual([]) // no vuelve como "agente que ya corría"
  await $.turn.complete(fin('a1', 6 * MIN + 35_000)) // llega tarde
  await reloj.advance(40_000)
  expect(r.avisos).toEqual([expect.stringMatching(/^Terminó todo: 1 agente en /)]) // contado una vez
  const medidas = r.store.mediciones as Medicion[]
  expect(medidas.map(m => [m.rol, m.llamadas])).toEqual([['implementador', 1]]) // y medido, con sus fotos
  expect(medidas[0]!.fotos.length).toBeGreaterThanOrEqual(5)
  expect(medidas[0]!.durMin).toBe(6) // terminó cuando SubagentStop lo dijo, no cuando llegó el turn.complete tardío
})

test('el agente que pasa de 6 horas se retira y no vuelve a crearse como uno nuevo mientras la lista lo da corriendo', async ($, on) => {
  const seis = 6 * 60 * MIN
  const reloj = mock.clock(on, { now: seis + MIN })
  // Un agente que el mod viene siguiendo desde hace más de 6 h y que la lista del motor sigue dando corriendo.
  const viejo = { id: 'a9', tipo: 'implementador', descripcion: 'd', inicio: 0, llamadas: 5, fase: 'leyendo', faseDesde: 0, vistas: ['leyendo'], enPrimerPlano: false, deMain: true, aprende: true, visto: true }
  const r = motor(on, {}, {
    'cuanto-falta.agentes': { a9: viejo },
    'cuanto-falta.tarea': { inicio: 0, agentes: 1, flujos: 0 },
    'cuanto-falta.ahora': seis + MIN,
  })
  r.lista.push({ id: 'a9', type: 'implementador', description: 'd', status: 'running' })
  await $.session.start(inicio)
  await reloj.advance(10_000)
  expect(enCurso(r).agentes).toEqual([]) // antes volvía como un agente nuevo de «<1 min»
  await reloj.advance(2 * MIN)
  expect(r.avisos).toEqual([expect.stringMatching(/^Terminó todo: 1 agente en /)]) // y no «2 agentes»
})

test('un turn.complete que llega antes de que se registre el agente no deja un fantasma', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  // El agente de un workflow termina enseguida: su turn.complete se procesa antes de que su alta escriba el estado.
  await lanzar($, 'revisor', 'auditar:rapido', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await $.turn.complete(fin('a1', 500))
  await reloj.advance(10 * MIN)
  expect(enCurso(r).agentes).toEqual([]) // antes quedaba 6 h, con el reloj latiendo
  expect(r.avisos).toEqual([])
  const antes = r.escrituras.length
  await reloj.advance(30 * MIN)
  expect(r.escrituras.length).toBe(antes) // y el reloj se detuvo
})

test('un agente retomado con el mismo id vuelve a registrarse, con el reloj de la reanudación y marcado', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(5 * MIN)
  await $.turn.complete(fin('a1', 5 * MIN))
  await reloj.advance(1 * MIN)
  await lanzar($, 'revisor', 'Retomado', { resume: { agentId: 'a1' } })
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  await reloj.advance(30_000)
  const a = enCurso(r).agentes[0]!
  expect([a.id, a.reanudacion, a.llevaMin, a.llamadas]).toEqual(['a1', true, 0.5, 1]) // no arrastra los 5 min ni las llamadas de antes
  expect(enCurso(r).agentes.length).toBe(1)
})

test('las llamadas de los últimos segundos cuentan aunque el volcado del tic siga a medio escribir cuando termina el agente', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {}, {})
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Pagos')
  await reloj.settle()
  await reloj.advance(60_000)
  for (const f of ['/a', '/b', '/c']) await llamar($, 'Read', 'a1', { file_path: f })
  // El tic empieza a volcarlas, pero la escritura al estado tarda 5 s en aterrizar...
  r.demorar = { clave: 'agentes', espera: () => reloj.sleep(5_000) }
  await reloj.advance(10_000)
  // ...y en ese rato llega el turn.complete del agente.
  await $.turn.complete(fin('a1', 70_000))
  await reloj.advance(6_000)
  await reloj.settle()
  expect((r.store.mediciones as Medicion[]).map(m => m.llamadas)).toEqual([3])
})

test('las llamadas aún no volcadas cuando llega el turn.complete también cuentan', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Pagos')
  await reloj.settle()
  await reloj.advance(60_000)
  for (const f of ['/a', '/b']) await llamar($, 'Read', 'a1', { file_path: f })
  await $.turn.complete(fin('a1', 60_000)) // sin esperar al tic
  await reloj.settle()
  expect((r.store.mediciones as Medicion[]).map(m => m.llamadas)).toEqual([2])
})

test('en-curso.json es de cada sesión: otra sesión corriendo no queda pisada cuando esta queda en reposo', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  const deOtra = JSON.stringify({ sesion: 'otra', t: 1, agentes: [{ id: 'x1', rol: 'revisor' }] })
  r.archivos['/casa/.claude/cuanto-falta/en-curso/otra.json'] = deOtra
  r.archivos['/casa/.claude/cuanto-falta/en-curso.json'] = deOtra // el archivo global de la 0.2.0 inicial
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(30_000)
  expect(enCurso(r).agentes.map(a => a.rol)).toEqual(['revisor'])
  expect(JSON.parse(r.archivos[EN_CURSO]!).sesion).toBe('s-test')
  await $.turn.complete(fin('a1', 30_000))
  await reloj.advance(1 * MIN)
  expect(enCurso(r).agentes).toEqual([]) // en reposo, el suyo queda vacío
  expect(r.archivos['/casa/.claude/cuanto-falta/en-curso/otra.json']).toBe(deOtra)
  expect(r.archivos['/casa/.claude/cuanto-falta/en-curso.json']).toBe(deOtra)
})

const ajena = (t: number, rol = 'otra-sesion'): Medicion => ({ t, rol, durMin: 10, llamadas: 4, fotos: [[2, 'r', 6, 8, 12, 'leyendo', 'm']] })
const lineas = (ms: Medicion[]) => ms.map(m => JSON.stringify(m)).join('\n') + '\n'

test('cada sesión escribe su propio mediciones/<sesión>.jsonl: no toca el de otras ni hay a quién pisarle una línea', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  const deOtra = lineas([ajena(1), ajena(2)])
  r.archivos[`${MEDICIONES_DIR}/otra.jsonl`] = deOtra // escrito por otra sesión
  r.archivos[MEDICIONES_ANTIGUO] = lineas([ajena(0, 'del-archivo-unico')]) // el archivo de una versión anterior
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(2 * MIN)
  await $.turn.complete(fin('a1', 2 * MIN))
  await reloj.settle()
  const propias = r.archivos[MEDICIONES]!.trim().split('\n').map(l => JSON.parse(l))
  expect(propias.map(l => l.rol)).toEqual(['revisor']) // solo lo suyo
  expect(r.archivos[`${MEDICIONES_DIR}/otra.jsonl`]).toBe(deOtra)
  expect(r.archivos[MEDICIONES_ANTIGUO]).toBe(lineas([ajena(0, 'del-archivo-unico')]))
})

test('la precisión y /cuanto-falta datos unen los archivos de todas las sesiones al leer', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {}, {})
  r.archivos[`${MEDICIONES_DIR}/otra.jsonl`] = lineas([ajena(1), ajena(2)])
  r.archivos[`${MEDICIONES_DIR}/tercera.jsonl`] = lineas([ajena(3, 'investigador')])
  r.archivos[MEDICIONES_ANTIGUO] = lineas([ajena(0, 'del-archivo-unico')])
  await $.session.start(inicio) // la precisión parte de lo que ya hay en disco
  expect((r.estado['cuanto-falta.precision']!.value as any).agentes).toBe(4)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(2 * MIN)
  await $.turn.complete(fin('a1', 2 * MIN))
  await reloj.settle()
  expect((r.estado['cuanto-falta.precision']!.value as any).agentes).toBe(5) // las 4 de antes y la suya
  const datos = (await $.command.run({ command: 'cuanto-falta', args: 'datos', origin: { kind: 'composer' }, presentation: {} } as any)) as any
  expect(datos.text).toContain('Precisión medida con 5 agentes terminados')
  expect(datos.text).toContain('· investigador: 1 agente')
  expect(datos.text).toContain('· del archivo unico: 1 agente')
})

test('si ningún archivo se puede leer, la precisión sale del respaldo en el store', async ($, on) => {
  const r = motor(on, { mediciones: [ajena(1), ajena(2)] }, {})
  await $.session.start(inicio)
  expect((r.estado['cuanto-falta.precision']!.value as any).agentes).toBe(2)
})

test('mediciones/<sesión>.jsonl conserva solo las últimas 300 líneas y no se pisa si no se puede leer', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  r.archivos[MEDICIONES] = Array.from({ length: 300 }, (_, i) => JSON.stringify(ajena(i))).join('\n') + '\n'
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Uno')
  await lanzar($, 'revisor', 'Dos')
  await reloj.settle()
  await reloj.advance(2 * MIN)
  await $.turn.complete(fin('a1', 2 * MIN))
  await reloj.settle()
  let ls = r.archivos[MEDICIONES]!.trim().split('\n').map(l => JSON.parse(l))
  expect(ls.length).toBe(300)
  expect([ls[0].t, ls.at(-1).rol]).toEqual([1, 'revisor'])
  // Si el archivo existe pero no se puede leer, no se reescribe con lo poco que se sabe.
  const intacto = r.archivos[MEDICIONES]
  r.fallarLectura = true
  await $.turn.complete(fin('a2', 2 * MIN))
  await reloj.settle()
  expect(r.archivos[MEDICIONES]).toBe(intacto)
  ls = intacto!.trim().split('\n').map(l => JSON.parse(l))
  expect(ls.length).toBe(300)
})

test('el id de sesión se vuelve a leer en cada session.start', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(10_000)
  expect(JSON.parse(r.archivos['/casa/.claude/cuanto-falta/en-curso/s-test.json']!).agentes.length).toBe(1)
  r.idSesion = 's-nueva' // otra sesión en el mismo proceso (p. ej. tras /clear)
  await $.session.start(inicio)
  await reloj.advance(10_000)
  expect(JSON.parse(r.archivos['/casa/.claude/cuanto-falta/en-curso/s-nueva.json']!).sesion).toBe('s-nueva')
  await $.turn.complete(fin('a1', 20_000))
  await reloj.advance(1 * MIN)
  expect(JSON.parse(r.archivos['/casa/.claude/cuanto-falta/en-curso/s-nueva.json']!).agentes).toEqual([])
})

test('privacidad: en-curso.json lleva cuántos pasos hay, no sus títulos', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await llamar($, 'TodoWrite', 'a1', {
    todos: [
      { content: 'paso-privado-uno', status: 'completed', activeForm: 'Haciendo paso-privado-uno' },
      { content: 'paso-privado-dos', status: 'in_progress', activeForm: 'Haciendo paso-privado-dos' },
      { content: 'paso-privado-tres', status: 'pending', activeForm: 'Haciendo paso-privado-tres' },
    ],
  })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]!.lista).toEqual({ hechos: 1, total: 3 })
  expect(r.archivos[EN_CURSO]).not.toContain('privado')
})

test('privacidad: el registro de depuración dice cuántas fases tiene un workflow, no cómo se llaman', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await $.tool.call({
    tool: 'Workflow',
    script: "export const meta = {\n  name: 'auditar',\n  description: 'x',\n  phases: [{ title: 'Fase secreta uno' }, { title: 'Fase secreta dos' }],\n}\n",
  } as any)
  await reloj.settle()
  const linea = r.logs.find(l => l.includes('workflow wf_1'))!
  expect(linea).toContain('2 fases')
  expect(r.logs.join('\n')).not.toContain('secreta')
})

// ——— Ronda final: reanudaciones que se cruzan, retiros y el total ———

test('una reanudación que se cruza con el turn.complete de la corrida anterior no se pierde, y se miden las dos corridas', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(5 * MIN)
  // Reanudación instantánea: su alta se procesa antes que el turn.complete de la corrida 1.
  await lanzar($, 'revisor', 'Retomado', { resume: { agentId: 'a1' } })
  await reloj.settle()
  await $.turn.complete(fin('a1', 5 * MIN)) // el de la corrida anterior, tarde
  r.lista.find(f => f.id === 'a1')!.status = 'running' // el motor real lo sigue listando corriendo: es la corrida 2
  await reloj.settle()
  await reloj.advance(30_000)
  const a = enCurso(r).agentes[0]!
  expect([a.id, a.reanudacion, a.llevaMin]).toEqual(['a1', true, 0.5]) // la corrida 2 sigue a la vista
  expect(r.avisos).toEqual([]) // y no sale «Terminó todo» con ella corriendo
  await reloj.advance(30_000)
  await $.turn.complete(fin('a1', 60_000)) // el de la corrida 2
  await reloj.advance(1 * MIN)
  expect((r.store.mediciones as Medicion[]).map(m => [m.durMin, m.reanudacion])).toEqual([[5, undefined], [1, true]])
  expect(r.avisos).toEqual([expect.stringMatching(/^Terminó todo: 1 agente en 6 min/)])
})

test('si la reanudación se registra mientras el turn.complete anterior aún se escribe, la corrida nueva sobrevive', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {}, {})
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(5 * MIN)
  r.demorar = { clave: 'agentes', espera: () => reloj.sleep(5_000) } // el cierre de la corrida 1 queda en el aire...
  await $.turn.complete(fin('a1', 5 * MIN))
  await lanzar($, 'revisor', 'Retomado', { resume: { agentId: 'a1' } }) // ...y la reanudación aterriza antes
  await reloj.settle()
  await reloj.advance(6_000) // el cierre viejo aterriza, es rechazado y se reintenta sobre la corrida nueva
  await reloj.advance(10_000)
  expect(enCurso(r).agentes.map(a => [a.id, a.reanudacion])).toEqual([['a1', true]])
  expect((r.store.mediciones as Medicion[]).map(m => [m.durMin, m.reanudacion])).toEqual([[5, undefined]]) // la 1, una sola vez
})

test('un turn.complete que llega mientras se retira el agente se mide igual', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {}, {})
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Pagos')
  await reloj.settle()
  await reloj.advance(6 * MIN)
  await $.classic.SubagentStop(SUBAGENT_STOP('a1', 'implementador'))
  r.demorar = { clave: 'fotos', espera: () => reloj.sleep(5_000) } // sacar sus fotos al retirarlo tarda
  await reloj.advance(10_000) // el tic lo retira
  await $.turn.complete(fin('a1', 6 * MIN + 10_000)) // llega justo mientras se retira
  await reloj.advance(6_000)
  await reloj.settle()
  const medidas = r.store.mediciones as Medicion[]
  expect(medidas.map(m => [m.rol, m.durMin])).toEqual([['implementador', 6]])
  expect(medidas[0]!.fotos.length).toBeGreaterThanOrEqual(5) // con sus fotos completas
})

test('una llamada de la corrida anterior que vuelve tarde no toca el silencio ni la fase de la corrida nueva', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  const soltar: Record<string, () => void> = {}
  r.alLlamar = async e => {
    if (e.tool === 'Agent') await new Promise<void>(res => (soltar[e.description] = res))
  }
  await $.session.start(inicio)
  await lanzar($, 'implementador', 'Feature')
  await reloj.settle()
  await llamar($, 'Read', 'a1', { file_path: '/a' })
  const vieja = llamar($, 'Agent', 'a1', { prompt: 'p', description: 'vieja', subagent_type: 'revisor' }) // sigue en el aire...
  await reloj.advance(10_000)
  await $.turn.complete(fin('a1', 10_000))
  await reloj.advance(5_000)
  await lanzar($, 'implementador', 'Retomado', { resume: { agentId: 'a1' } }) // ...cuando se reanuda
  await reloj.settle()
  const nueva = llamar($, 'Agent', 'a1', { prompt: 'p', description: 'nueva', subagent_type: 'revisor' })
  await reloj.advance(10_000)
  expect(enCurso(r).agentes[0]).toMatchObject({ fase: 'delegando', reanudacion: true })
  soltar.vieja!() // la llamada vieja vuelve tarde
  await vieja
  await reloj.settle()
  await reloj.advance(20_000)
  const a = enCurso(r).agentes[0]!
  expect(a.fase).toBe('delegando') // la nueva sigue esperando a su subagente
  expect(a.silencioMin).toBeUndefined() // y no hay silencio mientras su llamada corre
  soltar.nueva!()
  await nueva
  await reloj.settle()
  await reloj.advance(30_000)
  expect(enCurso(r).agentes[0]!.silencioMin).toBe(0.5) // el silencio empieza cuando vuelve la suya
})

test('una reanudación no suma otro agente a la tarea ni otro lanzado al workflow', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on, {}, {})
  const flujo = { workflow: { runId: 'wf_1', agentIndex: 1 } }
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'auditar:a', flujo)
  await reloj.settle()
  await reloj.advance(3 * MIN)
  await $.turn.complete(fin('a1', 3 * MIN))
  await reloj.advance(5_000)
  await lanzar($, 'revisor', 'auditar:a', { ...flujo, resume: { agentId: 'a1' } })
  await reloj.settle()
  await reloj.advance(3 * MIN)
  await $.turn.complete(fin('a1', 3 * MIN))
  await reloj.settle()
  const wf = (r.estado['cuanto-falta.flujos']!.value as any).wf_1
  expect([wf.lanzados, wf.listos]).toEqual([1, 1]) // un agente lanzado, una vez listo
  await reloj.advance(5 * MIN) // el workflow se da por terminado tras unos minutos quieto, y recién ahí cierra la tarea
  expect(r.avisos).toEqual([expect.stringMatching(/^Terminó todo: 1 agente y 1 workflow en \d+ min/)])
})

test('una reanudación cuenta como agente si la tarea es nueva', async ($, on) => {
  const reloj = mock.clock(on)
  const r = motor(on)
  await $.session.start(inicio)
  await lanzar($, 'revisor', 'Revisar')
  await reloj.settle()
  await reloj.advance(1 * MIN)
  await $.turn.complete(fin('a1', 1 * MIN))
  await reloj.advance(2 * MIN) // la tarea ya cerró
  await lanzar($, 'revisor', 'Retomado', { resume: { agentId: 'a1' } })
  await reloj.settle()
  await reloj.advance(6 * MIN)
  await $.turn.complete(fin('a1', 6 * MIN))
  await reloj.advance(1 * MIN)
  expect(r.avisos).toEqual([expect.stringMatching(/^Terminó todo: 1 agente en 6 min/)]) // en su tarea, es uno
})

// ——— Lo que no necesita el motor ———

const estimacionFija = (e: Estimacion) => (_: EntradaEstimador) => e
const rangoDe = (bajoMin: number, medioMin: number, altoMin: number, confianza: 'alta' | 'media' | 'baja' = 'media'): Estimacion => ({
  estado: 'rango',
  bajoMin,
  medioMin,
  altoMin,
  confianza,
  progreso: 0.5,
  motivo: 'x',
})

const ag = (id: string, inicio: number, extra: Partial<Agente> = {}): Agente =>
  agenteNuevo({ id, tipo: 'implementador', descripcion: `d-${id}`, inicio, enPrimerPlano: false, aprende: true, ...extra })

const base = (extra: Partial<Parameters<typeof construirModelo>[0]> = {}) => ({
  ahora: 10 * MIN,
  agentes: [] as Agente[],
  flujos: [] as Flujo[],
  cola: [] as string[],
  turno: null,
  tarea: null,
  uso: null,
  ultima: null,
  ...extra,
})

test('aplicarEventos: fases en orden, sin repetir las ya vistas ni contar el arranque', () => {
  const llamada = (fase: any, n = 1): Evento => ({ k: 'llamada', fase, sobre: false, n })
  const a = aplicarEventos(ag('a', 0), [llamada('leyendo', 3), llamada(null), llamada('editando'), llamada('leyendo'), llamada('probando')], 5 * MIN)
  expect([a.fase, a.llamadas, a.vistas, a.faseDesde]).toEqual(['probando', 7, ['leyendo', 'editando', 'probando'], 5 * MIN])
  // Una llamada que mantiene la fase no reinicia desde cuándo está en ella.
  const b = aplicarEventos(a, [llamada(null), llamada('probando')], 9 * MIN)
  expect([b.llamadas, b.faseDesde]).toEqual([9, 5 * MIN])
})

test('aplicarEventos: delegando guarda a qué vuelve, y informe es reversible', () => {
  const dentro = aplicarEventos(ag('a', 0), [{ k: 'llamada', fase: 'leyendo', sobre: false, n: 1 }, { k: 'llamada', fase: null, sobre: false, n: 1 }, { k: 'delegar' }], 3 * MIN)
  expect([dentro.fase, dentro.previa?.fase]).toEqual(['delegando', 'leyendo'])
  const vuelve = aplicarEventos(dentro, [{ k: 'regreso' }], 6 * MIN)
  expect([vuelve.fase, vuelve.faseDesde, vuelve.previa]).toEqual(['leyendo', 6 * MIN, undefined])

  const informe = aplicarEventos(vuelve, [{ k: 'informe' }], 7 * MIN)
  expect([informe.fase, informe.informeNuevo]).toEqual(['informe', true])
  const revertido = aplicarEventos(informe, [{ k: 'sinInforme' }], 8 * MIN)
  expect([revertido.fase, revertido.faseDesde, revertido.vistas, revertido.informeNuevo]).toEqual(['leyendo', 6 * MIN, ['leyendo', 'delegando'], undefined])
})

test('aplicarEventos: el modelo y la lista pasan por lo inyectado, y una lista rota no tumba nada', () => {
  const guardada = { '1': { titulo: 'a', estado: 'hecha' as const } }
  const a = aplicarEventos(
    ag('a', 0),
    [{ k: 'modelo', modelo: 'claude-opus-5-5' }, { k: 'lista', tool: 'TodoWrite', input: {}, resultado: undefined }],
    0,
    { actualizarLista: () => guardada },
  )
  expect([a.modelo, a.lista]).toEqual(['claude-opus-5-5', guardada])
  const b = aplicarEventos(a, [{ k: 'lista', tool: 'TodoWrite', input: {}, resultado: undefined }], 0, {
    actualizarLista: () => {
      throw new Error('forma rara')
    },
  })
  expect(b.lista).toEqual(guardada)
})

test('un registro de la 0.1.0 (con pasos y sin fase) se completa sin perder el conteo', () => {
  const viejo = { id: 'x', tipo: 'revisor', descripcion: 'd', inicio: 100, pasos: 17, enPrimerPlano: false, deMain: true, aprende: true } as unknown as Agente
  const n = normalizar(viejo)
  expect([n.llamadas, n.fase, n.faseDesde, n.vistas, 'pasos' in n]).toEqual([17, 'arrancando', 100, [], false])
  const m = construirModelo(base({ agentes: [viejo] }), estimacionFija(rangoDe(1, 2, 3)))
  expect(m.agentes[0]!.llamadas).toBe(17)
})

test('reconstruirDeMensajes: cuenta llamadas, sigue las fases y detecta al que espera a un subagente', () => {
  const uso = (tool: string, extra: Record<string, unknown> = {}) => ({ tool_use_id: tool, tool, input: {}, ...extra })
  const r = reconstruirDeMensajes(
    [
      { role: 'user', text: 'haz', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [uso('Read', { text: 'ok' }), uso('Edit', { text: 'ok' })] },
      { role: 'assistant', text: '', toolUses: [uso('Agent')] }, // sin resultado: sigue esperando
    ] as any,
    { clasificar: tool => (tool === 'Read' ? 'leyendo' : tool === 'Edit' ? 'editando' : null) },
  )
  expect([r.llamadas, r.fase, r.vistas, r.previa?.fase]).toEqual([3, 'delegando', ['leyendo', 'editando', 'delegando'], 'editando'])
  const sin = reconstruirDeMensajes([{ role: 'assistant', text: 'y'.repeat(300), toolUses: [] }] as any)
  expect(sin.fase).toBe('informe')
})

test('construirModelo: agentes por inicio, y qué hace incompleto el total', () => {
  const porId: Record<string, Estimacion> = { a: rangoDe(2, 4, 6, 'alta'), b: rangoDe(5, 9, 15, 'baja'), c: rangoDe(1, 1, 2) }
  const estimador = (e: EntradaEstimador) => porId[e.rol]!
  const agentes = [ag('c', 3 * MIN, { tipo: 'c' }), ag('a', 1 * MIN, { tipo: 'a' }), ag('b', 2 * MIN, { tipo: 'b' })]
  const m = construirModelo(base({ agentes }), estimador)
  expect(m.agentes.map(a => a.id)).toEqual(['a', 'b', 'c']) // por inicio: posición estable
  expect(m.total).toMatchObject({ estado: 'rango', confianza: 'baja' }) // la confianza es la del que más falta (b)
  expect(m.totalIncompleto).toBe(false)
  expect(m.agentes[0]).toMatchObject({ rol: 'a', llevaMin: 9, enPrimerPlano: false, inicioAprox: false })

  // La cola, un agente sin estimar o un workflow que puede lanzar más dejan el total incompleto.
  expect(construirModelo(base({ agentes, cola: ['revisor'] }), estimador).totalIncompleto).toBe(true)
  const flujo: Flujo = { id: 'wf', nombre: 'x', fases: [], inicio: 0, lanzados: 1, listos: 0, ultimaActividad: 0 }
  expect(construirModelo(base({ agentes, flujos: [flujo] }), estimador).totalIncompleto).toBe(true)
  expect(construirModelo(base({ agentes, flujos: [{ ...flujo, remoto: true }] }), estimador).totalIncompleto).toBe(false)
  const mezcla = construirModelo(base({ agentes }), e => (e.rol === 'a' ? { estado: 'calculando', motivo: 'x' } : rangoDe(1, 2, 3)))
  expect([mezcla.total.estado, mezcla.totalIncompleto]).toEqual(['rango', true])
})

const totalDe = (rangos: [number, number, number][]) => {
  const agentes = rangos.map((r, i) => ag(`a${i}`, 0, { tipo: `r${i}` }))
  const m = construirModelo(base({ agentes }), e => rangoDe(...rangos[Number(e.rol.slice(1))]!))
  const t = m.total
  if (t.estado !== 'rango') throw new Error('el total no es un rango')
  return t
}
const cerca = (x: number, y: number, tol = 0.01) => Math.abs(x - y) <= tol

test('el total con un solo agente es el rango de ese agente, tal cual', () => {
  expect(totalDe([[3, 7, 12]])).toMatchObject({ bajoMin: 3, medioMin: 7, altoMin: 12 })
  expect(totalDe([[0, 0, 0]])).toMatchObject({ bajoMin: 0, medioMin: 0, altoMin: 0 })
})

test('el total de varios agentes es cuándo terminan todos: más que el máximo de los rangos, y calculado con la CDF conjunta', () => {
  // Cinco agentes iguales (p10 10, p50 20, p90 30): el máximo de los altos acertaría ~59% de las veces.
  const t = totalDe(Array.from({ length: 5 }, () => [10, 20, 30] as [number, number, number]))
  // Con tramos lineales: F^5 = q → F = q^(1/5); sobre p50 sube 0,04 por minuto; sobre p90 sigue con esa pendiente.
  expect(cerca(t.bajoMin, 20 + (0.1 ** 0.2 - 0.5) / 0.04)).toBe(true) // ≈ 23,3
  expect(cerca(t.medioMin, 20 + (0.5 ** 0.2 - 0.5) / 0.04)).toBe(true) // ≈ 29,3
  expect(cerca(t.altoMin, 30 + (0.9 ** 0.2 - 0.9) / 0.04)).toBe(true) // ≈ 32,0
  // El total nunca baja de lo que falta al más lento: las probabilidades solo bajan al juntarlas.
  expect([t.bajoMin >= 10, t.medioMin >= 20, t.altoMin >= 30]).toEqual([true, true, true])
  expect(t.bajoMin < t.medioMin && t.medioMin < t.altoMin).toBe(true)
})

test('el total: uno muy atrasado domina; sumar uno más corto casi no cambia nada', () => {
  const solo = totalDe([[20, 30, 40]])
  const con = totalDe([[20, 30, 40], [1, 2, 3]])
  expect(cerca(con.bajoMin, solo.bajoMin, 0.05) && cerca(con.medioMin, solo.medioMin, 0.05) && cerca(con.altoMin, solo.altoMin, 0.05)).toBe(true)
  // Y el orden de los agentes no cambia el resultado.
  const a = totalDe([[2, 4, 6], [5, 9, 15], [1, 1, 2]])
  const b = totalDe([[1, 1, 2], [5, 9, 15], [2, 4, 6]])
  expect([b.bajoMin, b.medioMin, b.altoMin]).toEqual([a.bajoMin, a.medioMin, a.altoMin])
  expect(a.bajoMin >= 5 && a.medioMin >= 9 && a.altoMin >= 15).toBe(true)
})

test('el total acota la cola de arriba en 2 veces el alto y la de abajo en 0', () => {
  // Rango muy ancho hacia arriba: la cola no pasa de 2×alto.
  const t = totalDe([[1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]])
  expect(t.altoMin <= 6).toBe(true)
  // Un rango pegado a 0: nada negativo.
  const cero = totalDe([[0, 0.2, 0.5], [0, 0.1, 0.4]])
  expect(cero.bajoMin >= 0).toBe(true)
  expect(cero.bajoMin <= cero.medioMin && cero.medioMin <= cero.altoMin).toBe(true)
})

test('construirModelo: sin rangos, el total es pasado o calculando; un estimador que falla no tumba el modelo', () => {
  const agentes = [ag('a', 0), ag('b', 0)]
  expect(construirModelo(base({ agentes }), estimacionFija({ estado: 'pasado', tipicoMin: 25, motivo: 'x' })).total).toMatchObject({ estado: 'pasado', tipicoMin: 25 })
  expect(construirModelo(base({ agentes }), estimacionFija({ estado: 'calculando', motivo: 'x' })).total.estado).toBe('calculando')
  const roto = construirModelo(base({ agentes }), () => {
    throw new Error('boom')
  })
  expect(roto.agentes.map(a => a.estimacion.estado)).toEqual(['calculando', 'calculando'])
  expect(construirModelo(base()).total.estado).toBe('calculando')
})

test('construirModelo: workflows, la sesión principal, el gasto y el resumen de la última tarea', () => {
  const agentes = [ag('a', 0, { flujo: 'wf_x', deMain: false }), ag('p', 0, { tipo: 'verificador', enPrimerPlano: true })]
  const m = construirModelo(
    base({
      agentes,
      turno: { inicio: 7 * MIN },
      tarea: { inicio: 0, costo0: 1, semana0: 10, agentes: 2, flujos: 1 },
      uso: { costo: 5.1, semana: 11.2 },
    }),
    estimacionFija(rangoDe(1, 2, 3)),
  )
  // Un agente que nombra un workflow que todavía no aparece lo hace aparecer.
  expect(m.flujos).toMatchObject([{ id: 'wf_x', enCurso: 1, lanzados: 1, remoto: false }])
  expect(m.agentes.find(a => a.id === 'a')!.flujo).toBe('wf_x')
  expect(m.principal).toBe('espera a verificador')
  expect(m.tareaMin).toBe(10)
  expect(m.gasto).toEqual({ costo: 'US$ 4,10', semana: '1,2% de la semana' })
  expect(m.ultima).toBeUndefined() // solo cuando no corre nada

  const quieto = construirModelo(base({ turno: { inicio: 7 * MIN }, ultima: { fin: 1, minutos: 12, agentes: 2, flujos: 1, costo: 3.5, semana: 2.1 } }))
  expect(quieto.principal).toBe('trabajando hace 3 min')
  expect(quieto.ultima).toBe('2 agentes y 1 workflow en 12 min · US$ 3,50 · 2,1% de la semana')
  expect(construirModelo(base()).principal).toBe('esperando tu mensaje')
})

test('fotoDe y tocaFoto: una por minuto, cada 5 pasada la hora, con un tope', () => {
  expect(fotoDe(1.04, rangoDe(2.04, 3.06, 4.2, 'alta'), 'probando')).toEqual([1, 'r', 2, 3.1, 4.2, 'probando', 'a'])
  expect(fotoDe(2, { estado: 'pasado', tipicoMin: 25.04, motivo: 'x' }, 'editando')).toEqual([2, 'p', 0, 25, 0, 'editando', ''])
  expect(fotoDe(3, { estado: 'calculando', motivo: 'x' }, 'leyendo')).toEqual([3, 'c', 0, 0, 0, 'leyendo', ''])
  expect(tocaFoto([], 0.9)).toBe(false)
  expect(tocaFoto([], 1)).toBe(true)
  expect(tocaFoto([[1, 'c', 0, 0, 0, 'leyendo', '']], 1.9)).toBe(false)
  expect(tocaFoto([[1, 'c', 0, 0, 0, 'leyendo', '']], 2)).toBe(true)
  expect(tocaFoto([[7.2, 'c', 0, 0, 0, 'leyendo', '']], 8)).toBe(true) // tras un tic perdido, la siguiente
  expect(tocaFoto([[60, 'c', 0, 0, 0, 'leyendo', '']], 64)).toBe(false)
  expect(tocaFoto([[60, 'c', 0, 0, 0, 'leyendo', '']], 65)).toBe(true)
  expect(tocaFoto(Array.from({ length: 120 }, () => [1, 'c', 0, 0, 0, 'leyendo', ''] as any), 500)).toBe(false)
})

const medicion = (rol: string, durMin: number, fotos: any[]): Medicion => ({ t: 1, rol, durMin, llamadas: 5, fotos })

test('precisión: error mediano del centro y cobertura del rango, sobre lo que de verdad faltaba', () => {
  const ms = [
    // Terminó a los 10 min. A los 2 faltaban 8 (centro 8, error 0; rango 6–12 acierta); a los 5 faltaban 5 (centro 2, error 3; rango 1–3 falla).
    medicion('implementador', 10, [[2, 'r', 6, 8, 12, 'leyendo', 'm'], [5, 'r', 1, 2, 3, 'editando', 'a'], [7, 'c', 0, 0, 0, 'editando', '']]),
    // Terminó a los 4 min: a 1 faltaban 3 (centro 3, error 0; rango 2–4 acierta). Una foto 'pasado' no cuenta.
    medicion('revisor', 4, [[1, 'r', 2, 3, 4, 'leyendo', 'b'], [3, 'p', 0, 2, 0, 'informe', '']]),
  ]
  expect(evaluar(ms[0]!).map(x => [x.err, x.cubierto])).toEqual([[0, true], [3, false]])
  expect(precisionDe(ms)).toEqual({ agentes: 2, errorMedianoMin: 0, cobertura: 0.67 })
  expect(precisionPorRol(ms)).toEqual({
    implementador: { agentes: 1, fotos: 2, errorMedianoMin: 1.5, cobertura: 0.5 },
    revisor: { agentes: 1, fotos: 1, errorMedianoMin: 0, cobertura: 1 },
  })
  expect(coberturaPorConfianza(ms)).toEqual({ a: { fotos: 1, cobertura: 0 }, m: { fotos: 1, cobertura: 1 }, b: { fotos: 1, cobertura: 1 } })
  expect(precisionDe([])).toBeUndefined()
  expect(precisionDe([medicion('x', 3, [[1, 'c', 0, 0, 0, 'leyendo', '']])])).toBeUndefined() // sin ningún rango no hay nada que medir
})

test('precisión: un rango que acierta por muy poco (el redondeo de las fotos) cuenta como acierto', () => {
  // Terminó a los 10 min: a los 2 faltaban 8, con un margen de 0,05 por el redondeo de las fotos.
  expect(evaluar(medicion('x', 10, [[2, 'r', 8.04, 9, 9.5, 'leyendo', 'm']]))[0]!.cubierto).toBe(true)
  expect(evaluar(medicion('x', 10, [[2, 'r', 8.2, 9, 9.5, 'leyendo', 'm']]))[0]!.cubierto).toBe(false)
  expect(evaluar(medicion('x', 10, [[2, 'r', 5, 6, 7.96, 'leyendo', 'm']]))[0]!.cubierto).toBe(true)
  expect(evaluar(medicion('x', 10, [[2, 'r', 5, 6, 7.8, 'leyendo', 'm']]))[0]!.cubierto).toBe(false)
})

test('textoDatos: sin mediciones lo explica; con ellas, total, por rol y por confianza', () => {
  const vacio = textoDatos([], [])
  expect(vacio).toContain('todavía no hay agentes medidos')
  expect(vacio).toContain('Nada corriendo')
  const vista: AgenteVista = {
    id: 'a1',
    rol: 'implementador',
    modelo: 'Opus 5.5',
    descripcion: 'secreto',
    llevaMin: 12,
    inicioAprox: false,
    fase: 'probando',
    faseDesdeMin: 2,
    vistas: ['leyendo', 'editando', 'probando'],
    llamadas: 40,
    estimacion: rangoDe(8, 11, 15),
    enPrimerPlano: false,
  }
  const t = textoDatos([medicion('implementador', 10, [[2, 'r', 6, 8, 12, 'leyendo', 'm']])], [vista])
  expect(t).toContain('Precisión medida con 1 agente terminado')
  expect(t).toContain('· implementador: 1 agente')
  expect(t).toContain('por confianza')
  expect(t).toContain('implementador (Opus 5.5): lleva 12 min, corriendo pruebas, 40 llamadas · faltan ~8–15 min (confianza media)')
  expect(t).not.toContain('secreto')
})

test('los roles van con su nombre legible en lo que lee la persona', () => {
  const m = construirModelo(
    base({
      agentes: [ag('a', 0, { tipo: 'revisor-critico', enPrimerPlano: true }), ag('b', 0, { tipo: 'general-purpose', enPrimerPlano: true })],
      turno: { inicio: 0 },
    }),
    estimacionFija(rangoDe(1, 2, 3)),
  )
  expect(m.principal).toBe('espera a revisor crítico y agente')
  expect(m.total).toMatchObject({ motivo: expect.stringContaining('revisor crítico') })
  const vista: AgenteVista = {
    id: 'a1',
    rol: 'revisor-critico',
    descripcion: 'x',
    llevaMin: 3,
    inicioAprox: false,
    fase: 'leyendo',
    faseDesdeMin: 1,
    vistas: ['leyendo'],
    llamadas: 4,
    estimacion: rangoDe(1, 2, 3),
    enPrimerPlano: false,
  }
  const t = textoDatos([medicion('revisor-critico', 4, [[1, 'r', 2, 3, 4, 'leyendo', 'm']])], [vista])
  expect(t).toContain('· revisor crítico: 1 agente')
  expect(t).toContain('revisor crítico: lleva 3 min')
  expect(t).not.toContain('revisor-critico')
})

test('el estimador recibe si es una reanudación y cuántos minutos lleva en silencio', () => {
  const vistas: EntradaEstimador[] = []
  const estimador = (e: EntradaEstimador): Estimacion => {
    vistas.push(e)
    return rangoDe(1, 2, 3)
  }
  const agentes = [ag('a1', 0, { tipo: 'normal' }), ag('a2', 0, { tipo: 'retomado', reanudacion: true }), ag('a3', 0, { tipo: 'callado' })]
  construirModelo(base({ agentes, silencioDesde: { a3: 7 * MIN, a2: 10 * MIN } }), estimador)
  const por = (rol: string) => vistas.find(v => v.rol === rol)!
  expect('reanudacion' in por('normal')).toBe(false)
  expect('silencioMin' in por('normal')).toBe(false) // sin dato, el campo no existe
  expect(por('retomado').reanudacion).toBe(true)
  expect(por('retomado').silencioMin).toBe(0) // volvió justo ahora
  expect(por('callado').silencioMin).toBe(3) // ahora = 10 min, silencio desde el min 7
  expect('reanudacion' in por('callado')).toBe(false)
})

test('las mediciones leídas conservan la marca de reanudación', () => {
  const guardada = { t: 1, rol: 'x', durMin: 2, llamadas: 1, fotos: [], reanudacion: true }
  expect(medicionesValidas([guardada, { ...guardada, reanudacion: 'sí' }]).map(m => m.reanudacion)).toEqual([true, undefined])
})

test('textoDatos separa la precisión de las reanudaciones', () => {
  const f = (r: boolean): Medicion => ({ ...medicion('revisor', 10, [[2, 'r', 6, 8, 12, 'leyendo', 'm']]), ...(r ? { reanudacion: true as const } : {}) })
  expect(textoDatos([f(false)], [])).not.toContain('reanudaciones')
  expect(textoDatos([f(false), f(true)], [])).toContain('· reanudaciones (van también en el total): 1 agente')
})
