// Modelos de ejemplo para diseñar y probar la vista sin motor. Dueño: la pieza de la vista.
// Cada uno es un ModeloVista completo, como lo arma hooks/modelo.ts.
import type { AgenteVista, Estimacion, Fase, ModeloVista } from './contrato'
import { nombreRol, plural } from './formato'

const AHORA = 1_794_850_000_000

function rango(bajoMin: number, altoMin: number, confianza: 'alta' | 'media' | 'baja', progreso: number, motivo: string): Estimacion {
  return { estado: 'rango', bajoMin, altoMin, medioMin: (bajoMin + altoMin) / 2, confianza, progreso, motivo }
}

function agente(a: Partial<AgenteVista> & Pick<AgenteVista, 'id' | 'rol' | 'estimacion'>): AgenteVista {
  const fase: Fase = a.fase ?? 'leyendo'
  return {
    descripcion: '',
    llevaMin: 1,
    inicioAprox: false,
    fase,
    faseDesdeMin: 1,
    vistas: fase === 'arrancando' ? [] : [fase],
    llamadas: 0,
    enPrimerPlano: false,
    ...a,
  }
}

/**
 * El total, como lo arma `totalDe` de hooks/modelo.ts: el máximo de lo bajo y de lo alto entre los
 * agentes con rango (todo termina cuando termina el último), con la confianza del que más tarda.
 * Así ningún fixture muestra un total que el seguimiento real no produciría.
 */
function totalDe(agentes: readonly AgenteVista[]): Estimacion {
  const rangos = agentes.flatMap(a => (a.estimacion.estado === 'rango' ? [{ a, e: a.estimacion }] : []))
  if (!rangos.length) throw new Error('totalDe: sin agentes con rango; el total se escribe a mano')
  const ultimo = rangos.reduce((x, y) => (y.e.medioMin > x.e.medioMin ? y : x))
  const bajoMin = Math.max(...rangos.map(r => r.e.bajoMin))
  const altoMin = Math.max(bajoMin, ...rangos.map(r => r.e.altoMin))
  const medioMin = Math.max(...rangos.map(r => r.e.medioMin))
  const lleva = Math.max(...agentes.map(a => a.llevaMin))
  return {
    estado: 'rango',
    bajoMin,
    altoMin,
    medioMin,
    confianza: ultimo.e.confianza,
    progreso: lleva + medioMin > 0 ? Math.min(1, lleva / (lleva + medioMin)) : 0,
    motivo: `lo último en terminar: ${nombreRol(ultimo.a.rol)}${agentes.length > 1 ? ` (${plural(agentes.length, 'agente corriendo', 'agentes corriendo')})` : ''}`,
  }
}

/** Un modelo con su total calculado de sus agentes, para que nunca se contradigan. */
function conTotal(m: Omit<ModeloVista, 'total'>): ModeloVista {
  return { ...m, total: totalDe(m.agentes) }
}

/** Nada corriendo: la última tarea y la precisión medida del mod. */
export const reposo: ModeloVista = {
  ahora: AHORA,
  agentes: [],
  flujos: [],
  cola: [],
  total: { estado: 'calculando', motivo: 'nada corriendo' },
  totalIncompleto: false,
  principal: 'esperando tu mensaje',
  ultima: '3 agentes en 18 min · US$ 2,40 · 0,6% de la semana',
  precision: { agentes: 42, errorMedianoMin: 3, cobertura: 0.81 },
}

/** Nada corriendo y todavía sin nada medido. */
export const reposoSinDatos: ModeloVista = {
  ahora: AHORA,
  agentes: [],
  flujos: [],
  cola: [],
  total: { estado: 'calculando', motivo: 'nada corriendo' },
  totalIncompleto: false,
  principal: 'trabajando hace 2 min',
}

/** Un agente recién lanzado: todavía sin datos para estimar. */
export const uno: ModeloVista = {
  ahora: AHORA,
  agentes: [
    agente({
      id: 'a1',
      rol: 'investigador',
      modelo: 'Sonnet 5.5',
      descripcion: 'Comparar proveedores de voz en español',
      llevaMin: 0.4,
      fase: 'arrancando',
      faseDesdeMin: 0.4,
      vistas: [],
      llamadas: 0,
      enPrimerPlano: true,
      estimacion: { estado: 'calculando', motivo: 'recién arrancó: aún sin llamadas' },
    }),
  ],
  flujos: [],
  cola: [],
  total: { estado: 'calculando', motivo: 'recién arrancó: aún sin llamadas' },
  totalIncompleto: true,
  principal: 'espera a investigador',
  tareaMin: 1,
  gasto: { costo: 'US$ 0,12', semana: '<0,1% de la semana' },
}

/** Dos agentes: hay espacio para el camino de fases, el paso actual y de dónde sale el rango. */
export const dos: ModeloVista = conTotal({
  ahora: AHORA,
  agentes: [
    agente({
      id: 'd1',
      rol: 'implementador',
      modelo: 'Sonnet 5.5',
      descripcion: 'Cobros con reintento',
      llevaMin: 18,
      fase: 'probando',
      faseDesdeMin: 4,
      vistas: ['leyendo', 'editando', 'probando'],
      llamadas: 71,
      enPrimerPlano: true,
      lista: { hechos: 3, total: 5, actual: 'Probar el reintento con el banco caído' },
      estimacion: rango(8, 15, 'alta', 0.6, 'fase de pruebas · 3 de 5 pasos · 140 corridas de implementador'),
    }),
    agente({
      id: 'd2',
      rol: 'revisor',
      modelo: 'Opus 5.5',
      descripcion: 'Revisar la migración',
      llevaMin: 5,
      fase: 'editando',
      faseDesdeMin: 1,
      vistas: ['leyendo', 'probando', 'editando'],
      llamadas: 19,
      estimacion: rango(4, 12, 'media', 0.4, 'fase de edición · 60 corridas de revisor'),
    }),
  ],
  flujos: [],
  cola: [],
  totalIncompleto: false,
  principal: 'espera a implementador',
  tareaMin: 19,
  gasto: { costo: 'US$ 1,90', semana: '0,5% de la semana' },
})

/** Cinco agentes mezclados: confianza alta, media y baja, uno pasado, uno en informe, uno con lista. */
export const cinco: ModeloVista = conTotal({
  ahora: AHORA,
  agentes: [
    agente({
      id: 'a1',
      rol: 'implementador',
      modelo: 'Sonnet 5.5',
      descripcion: 'Pieza A: el estimador',
      llevaMin: 14,
      fase: 'probando',
      faseDesdeMin: 6,
      vistas: ['leyendo', 'editando', 'probando'],
      llamadas: 62,
      lista: { hechos: 3, total: 5, actual: 'Correr la suite del estimador' },
      estimacion: rango(10, 20, 'alta', 0.48, 'fase de pruebas · 3 de 5 pasos · 140 corridas de implementador'),
    }),
    agente({
      id: 'a2',
      rol: 'implementador',
      modelo: 'Opus 5.5',
      descripcion: 'Pieza B: el seguimiento',
      llevaMin: 13,
      fase: 'editando',
      faseDesdeMin: 2,
      vistas: ['leyendo', 'editando'],
      llamadas: 41,
      estimacion: rango(15, 40, 'media', 0.32, 'fase de edición · 140 corridas de implementador'),
    }),
    agente({
      id: 'a3',
      rol: 'implementador',
      modelo: 'Fable 5.2',
      descripcion: 'Pieza C: la vista',
      llevaMin: 12,
      fase: 'navegando',
      faseDesdeMin: 4,
      vistas: ['leyendo', 'editando', 'navegando'],
      llamadas: 88,
      estimacion: rango(8, 45, 'baja', 0.3, 'pocas corridas en Fable 5.2'),
    }),
    agente({
      id: 'a4',
      rol: 'investigador',
      modelo: 'Sonnet 5.5',
      descripcion: 'Precios de la API de voz',
      llevaMin: 41,
      inicioAprox: true,
      fase: 'investigando',
      faseDesdeMin: 19,
      vistas: ['leyendo', 'investigando'],
      llamadas: 120,
      estimacion: { estado: 'pasado', tipicoMin: 25, motivo: 'más largo que las 90 corridas de investigador' },
    }),
    agente({
      id: 'a5',
      rol: 'revisor',
      modelo: 'Opus 5.5',
      descripcion: 'Revisar el cambio del contrato',
      llevaMin: 9,
      fase: 'informe',
      faseDesdeMin: 0.5,
      vistas: ['leyendo', 'probando', 'informe'],
      llamadas: 35,
      estimacion: rango(0.4, 2, 'alta', 0.93, 'escribe el informe · 60 corridas de revisor'),
    }),
  ],
  flujos: [],
  cola: [],
  totalIncompleto: true,
  principal: 'en pausa hasta que termine un agente',
  tareaMin: 43,
  gasto: { costo: 'US$ 4,10', semana: '1,2% de la semana' },
})

/** Un workflow con tres agentes, un agente suelto y cola. */
export const flujo: ModeloVista = conTotal({
  ahora: AHORA,
  agentes: [
    agente({
      id: 'a0',
      rol: 'revisor-critico',
      modelo: 'Opus 5.5',
      descripcion: 'Cobros y permisos de arriendos',
      llevaMin: 6,
      fase: 'leyendo',
      faseDesdeMin: 6,
      vistas: ['leyendo'],
      llamadas: 22,
      enPrimerPlano: true,
      estimacion: rango(6, 12, 'alta', 0.4, 'fase de lectura · 61 corridas de revisor-critico'),
    }),
    agente({
      id: 'w1',
      rol: 'workflow-subagent',
      modelo: 'Sonnet 5.5',
      descripcion: 'Auditar apps/brain',
      llevaMin: 11,
      fase: 'leyendo',
      faseDesdeMin: 3,
      vistas: ['leyendo', 'probando'],
      llamadas: 54,
      flujo: 'wf_1',
      lista: { hechos: 2, total: 6 },
      estimacion: rango(12, 25, 'media', 0.38, '2 de 6 pasos · 300 corridas de workflow'),
    }),
    agente({
      id: 'w2',
      rol: 'workflow-subagent',
      modelo: 'Sonnet 5.5',
      descripcion: 'Auditar apps/face',
      llevaMin: 11,
      fase: 'probando',
      faseDesdeMin: 5,
      vistas: ['leyendo', 'probando'],
      llamadas: 47,
      flujo: 'wf_1',
      estimacion: rango(5, 10, 'alta', 0.6, 'fase de pruebas · 300 corridas de workflow'),
    }),
    agente({
      id: 'w3',
      rol: 'workflow-subagent',
      modelo: 'Haiku 5.5',
      descripcion: 'Listar dependencias viejas',
      llevaMin: 2,
      fase: 'leyendo',
      faseDesdeMin: 2,
      vistas: ['leyendo'],
      llamadas: 9,
      flujo: 'wf_1',
      estimacion: rango(1, 3, 'media', 0.5, '300 corridas de workflow'),
    }),
  ],
  flujos: [
    {
      id: 'wf_1',
      nombre: 'auditoria-integral',
      fases: ['Explorar', 'Verificar', 'Informe'],
      llevaMin: 11,
      listos: 4,
      enCurso: 3,
      lanzados: 7,
      remoto: false,
    },
  ],
  cola: ['workflow-subagent', 'workflow-subagent', 'verificador'],
  totalIncompleto: true,
  principal: 'espera a revisor crítico',
  tareaMin: 12,
  gasto: { costo: 'US$ 6,80', semana: '2,1% de la semana' },
})

/** El caso extremo: nueve a la vez. */
export const nueve: ModeloVista = conTotal({
  ahora: AHORA,
  agentes: [
    agente({ id: 'n1', rol: 'implementador', modelo: 'Sonnet 5.5', descripcion: 'Endpoints de cobros', llevaMin: 22, fase: 'probando', faseDesdeMin: 4, vistas: ['leyendo', 'editando', 'probando'], lista: { hechos: 4, total: 6 }, estimacion: rango(6, 12, 'alta', 0.7, '4 de 6 pasos') }),
    agente({ id: 'n2', rol: 'implementador', modelo: 'Sonnet 5.5', descripcion: 'Vista del tablero', llevaMin: 21, fase: 'editando', faseDesdeMin: 9, vistas: ['leyendo', 'editando'], estimacion: rango(15, 30, 'media', 0.45, 'fase de edición') }),
    agente({ id: 'n3', rol: 'implementador', modelo: 'Opus 5.5', descripcion: 'Migración de pagos', llevaMin: 21, fase: 'leyendo', faseDesdeMin: 21, vistas: ['leyendo'], estimacion: rango(30, 70, 'baja', 0.25, 'tarea larga') }),
    agente({ id: 'n4', rol: 'revisor', modelo: 'Opus 5.5', descripcion: 'Revisar el contrato', llevaMin: 8, fase: 'leyendo', faseDesdeMin: 8, vistas: ['leyendo'], estimacion: rango(4, 9, 'alta', 0.55, 'fase de lectura') }),
    agente({ id: 'n5', rol: 'revisor-critico', modelo: 'Fable 5.2', descripcion: 'Webhooks de pago', llevaMin: 8, fase: 'probando', faseDesdeMin: 1, vistas: ['leyendo', 'probando'], estimacion: rango(10, 25, 'media', 0.35, 'fase de pruebas') }),
    agente({ id: 'n6', rol: 'verificador', modelo: 'Fable 5.2', descripcion: 'Hallazgo 3: reembolso doble', llevaMin: 3, fase: 'informe', faseDesdeMin: 0.3, vistas: ['leyendo', 'informe'], estimacion: rango(0.3, 0.8, 'alta', 0.95, 'escribe el informe') }),
    agente({ id: 'n7', rol: 'investigador', modelo: 'Sonnet 5.5', descripcion: 'Límites de la API de Meta', llevaMin: 17, fase: 'investigando', faseDesdeMin: 12, vistas: ['investigando'], estimacion: { estado: 'pasado', tipicoMin: 12, motivo: 'más largo que lo visto' } }),
    agente({ id: 'n8', rol: 'explorador', modelo: 'Haiku 5.5', descripcion: 'Ubicar usos de rango()', llevaMin: 0.6, fase: 'leyendo', faseDesdeMin: 0.6, vistas: ['leyendo'], estimacion: rango(0.5, 2, 'media', 0.3, 'pocas llamadas') }),
    agente({ id: 'n9', rol: 'mecanico', modelo: 'Sonnet 5.5', descripcion: 'Renombrar el campo foco', llevaMin: 0.2, fase: 'arrancando', faseDesdeMin: 0.2, vistas: [], estimacion: { estado: 'calculando', motivo: 'recién arrancó' } }),
  ],
  flujos: [],
  cola: ['verificador', 'verificador'],
  totalIncompleto: true,
  principal: 'trabajando hace 3 min',
  tareaMin: 24,
  gasto: { costo: 'US$ 11,30', semana: '3,4% de la semana' },
})

/** Los que la prueba y las capturas recorren, con nombre. */
export const FIXTURES: Record<string, ModeloVista> = { reposo, reposoSinDatos, uno, dos, cinco, flujo, nueve }
