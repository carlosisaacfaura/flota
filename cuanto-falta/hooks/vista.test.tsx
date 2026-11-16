// Pruebas de la vista: monta el panel y la línea con cada modelo de ejemplo, en la terminal y en
// el escritorio, y revisa que el motor acepte el árbol y que estén los textos que importan.
// La vista no lee estado: aquí la dibuja un hook de la prueba, que ocupa el lugar del motor.
import { expect, test } from 'claude-code/testing'

import { TEXTO_FASE } from './contrato'
import type { AgenteVista, Estimacion, ModeloVista } from './contrato'
import { contar, cortar, fraccion, marca, nombreRol, pasoLoTipico, rango, tipico } from './formato'
import { dibujarBanda, dibujarPanel } from './vista'
import { cinco, dos, FIXTURES, flujo, nueve, reposo, uno } from './vista.fixtures'

const SUPERFICIES = ['terminal', 'desktop'] as const

const PANEL = {
  plugin: 'cuanto-falta',
  component: 'Pane',
  requestId: 'vista-de-prueba',
  props: { title: 'Cuánto falta', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const BANDA = {
  plugin: 'cuanto-falta',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

/**
 * El hook que dibuja la vista con un modelo; cuenta las veces que se pidió abrir el panel. Un hook solo
 * se registra antes de la primera llamada a `$`: para dibujar otro modelo en el mismo test se cambia
 * `r.modelo`, no se vuelve a llamar.
 */
function conModelo(on: any, m: ModeloVista) {
  const r = { aperturas: 0, modelo: m }
  on('ui.render', ($: any, e: any) =>
    e.component === 'AbovePrompt' ? dibujarBanda($, e, r.modelo, () => void r.aperturas++) : dibujarPanel($, e, r.modelo),
  )
  return r
}

type NodoTexto = { text: string; props: Record<string, unknown> }
type NodoSvg = { props: Record<string, unknown> }

/** Los Text del dibujo con sus props, en el orden en que se pintan. */
async function nodosDeTexto(ui: any): Promise<NodoTexto[]> {
  return (await ui.findAll({ type: 'Text' })) as NodoTexto[]
}

/** Todo lo que el dibujo muestra en texto, línea por línea. */
async function textos(ui: any): Promise<string[]> {
  return (await nodosDeTexto(ui)).map(t => t.text)
}

/** Los Svg de un dibujo: su fuente y su alt. */
async function dibujosDe(ui: any): Promise<{ fuente: string; alt: string }[]> {
  return ((await ui.findAll({ type: 'Svg' })) as NodoSvg[]).map(d => ({ fuente: String(d.props.source), alt: String(d.props.alt) }))
}

const ACENTO = '#C6613F'

function dice(lineas: string[], frase: string): boolean {
  return lineas.some(l => l.includes(frase))
}

/** Lo que la vista tiene que decir de lo que falta: el rango, «calculando» o que ya pasó lo típico. */
function partesDeFalta(e: Estimacion): string[] {
  if (e.estado === 'rango') return [rango(e.bajoMin, e.altoMin)]
  if (e.estado === 'pasado') return ['ya pasó lo típico', `(${tipico(e.tipicoMin)})`]
  return ['calculando']
}

/** El título de la fila: la descripción; el rol solo cuando no hay (el rol va aparte, en gris). */
function titulo(a: AgenteVista): string {
  return a.descripcion || nombreRol(a.rol)
}

for (const [nombre, m] of Object.entries(FIXTURES)) {
  test(`el panel dibuja «${nombre}» en la terminal y en el escritorio`, async ($, on) => {
    conModelo(on, m)
    for (const surface of SUPERFICIES) {
      for (const bodyColumns of [50, 37, 80]) {
        const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, bodyColumns } })
        const lineas = await textos(ui)
        expect(lineas.length).toBeGreaterThan(0)
        for (const a of m.agentes) {
          for (const parte of partesDeFalta(a.estimacion)) expect(dice(lineas, parte)).toBe(true)
          // En la terminal angosta la fase y el nombre pueden ir cortados (con «…»): basta con su comienzo.
          expect(dice(lineas, TEXTO_FASE[a.fase].slice(0, 8))).toBe(true)
          expect(dice(lineas, titulo(a).slice(0, 4))).toBe(true)
        }
        if (m.agentes.length === 0 && m.flujos.length === 0) expect(dice(lineas, 'Nada corriendo')).toBe(true)
        await ui.unmount()
      }
    }
  })
}

test('las demás superficies con Svg aceptan el mismo árbol del escritorio', async ($, on) => {
  conModelo(on, flujo)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const lineas = await textos(ui)
    for (const a of flujo.agentes) expect(dice(lineas, partesDeFalta(a.estimacion)[0]!)).toBe(true)
    await ui.unmount()
    const banda = await $.ui.mount({ ...BANDA, surface })
    expect(dice(await textos(banda), '~12–25 min')).toBe(true)
    await banda.unmount()
  }
})

test('con pocos agentes se ve el camino de fases, el paso actual y de dónde sale el rango', async ($, on) => {
  conModelo(on, dos)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const lineas = await textos(ui)
  expect(dice(lineas, 'leer → editar → ')).toBe(true)
  expect(dice(lineas, 'probar')).toBe(true)
  // Volvió a editar después de probar: el camino lo repite al final, donde está ahora.
  expect(dice(lineas, 'leer → probar → ')).toBe(true)
  // El paso que lleva en su lista va junto a la parada en que está.
  expect(dice(lineas, ': Probar el reintento con el banco caído')).toBe(true)
  expect(dice(lineas, '140 corridas de implementador')).toBe(true)
  // Sin «o más» cuando el total no está abierto.
  expect(dice(lineas, 'o más')).toBe(false)
  await ui.unmount()
})

test('cada agente dice lo que falta, en qué está, cuánto lleva y sus pasos', async ($, on) => {
  conModelo(on, cinco)
  for (const surface of SUPERFICIES) {
    // La terminal dibuja en texto y a 50 columnas corta la cabecera; con 80 cabe todo.
    const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, bodyColumns: 80 } })
    const lineas = await textos(ui)
    expect(dice(lineas, 'Todo termina en')).toBe(true)
    // El total es el máximo de lo bajo y de lo alto entre los agentes: 15 (el de la pieza B) y 45 (el de la C).
    expect(dice(lineas, '~15–45 min')).toBe(true)
    expect(dice(lineas, 'o más')).toBe(true)
    expect(dice(lineas, '~10–20 min')).toBe(true)
    expect(dice(lineas, '~15–40 min')).toBe(true)
    expect(dice(lineas, 'corriendo pruebas')).toBe(true)
    expect(dice(lineas, '3 de 5 pasos')).toBe(true)
    expect(dice(lineas, 'lleva 14 min')).toBe(true)
    // El modelo es lo último que cede en la terminal: el de la pieza B cabe, el de la A puede ir cortado.
    expect(dice(lineas, 'Opus 5.5')).toBe(true)
    expect(dice(lineas, 'escribiendo el informe')).toBe(true)
    // El que el mod encontró ya corriendo dice que su tiempo es un mínimo.
    expect(dice(lineas, 'lleva más de 41 min')).toBe(true)
    // La sesión principal y el gasto de la tarea, arriba.
    expect(dice(lineas, 'en pausa hasta que termine un agente')).toBe(true)
    expect(dice(lineas, 'lleva 43 min · US$ 4,10')).toBe(true)
    expect(dice(lineas, '1,2% de la semana')).toBe(true)
    await ui.unmount()
  }
})

test('sin datos se dice «calculando» y fuera de lo visto «ya pasó lo típico»: nunca un número inventado', async ($, on) => {
  const m: ModeloVista = {
    ...uno,
    agentes: [
      uno.agentes[0]!,
      { ...cinco.agentes[3]!, id: 'p1' },
    ],
    total: { estado: 'pasado', tipicoMin: 25, motivo: '' },
  }
  conModelo(on, m)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const lineas = await textos(ui)
    expect(dice(lineas, 'calculando')).toBe(true)
    expect(dice(lineas, 'ya pasó lo típico')).toBe(true)
    expect(dice(lineas, '(~25 min)')).toBe(true)
    // Ninguna fila muestra un rango: el único «~» es el de lo típico.
    expect(lineas.filter(l => l.includes('~')).every(l => l.includes('~25 min'))).toBe(true)
    expect(dice(lineas, 'Todo termina en')).toBe(false)
    await ui.unmount()

    const banda = await $.ui.mount({ ...BANDA, surface })
    expect(dice(await textos(banda), pasoLoTipico(25))).toBe(true)
    await banda.unmount()
  }
})

test('los agentes de un workflow van bajo su workflow, y se muestra la cola', async ($, on) => {
  conModelo(on, flujo)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, bodyColumns: 80 } })
    const lineas = await textos(ui)
    const pos = (frase: string) => lineas.findIndex(l => l.includes(frase))
    expect(pos('auditoria-integral')).toBeGreaterThan(-1)
    expect(dice(lineas, '4 de 7 listos')).toBe(true)
    expect(dice(lineas, 'Explorar → Verificar → Informe')).toBe(true)
    // El suelto va antes del workflow; los del workflow, después de su nombre.
    expect(pos('Cobros y permisos')).toBeLessThan(pos('auditoria-integral'))
    for (const a of flujo.agentes.filter(a => a.flujo)) expect(pos(a.descripcion)).toBeGreaterThan(pos('auditoria-integral'))
    expect(dice(lineas, 'En cola: agente del workflow ×2, verificador')).toBe(true)
    await ui.unmount()
  }
})

test('un agente de un workflow que aún no aparece igual se dibuja', async ($, on) => {
  conModelo(on, { ...flujo, flujos: [] })
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const lineas = await textos(ui)
    for (const a of flujo.agentes) expect(dice(lineas, rango((a.estimacion as any).bajoMin, (a.estimacion as any).altoMin))).toBe(true)
    await ui.unmount()
  }
})

test('un workflow en la nube y sin agentes a la vista se dice tal cual', async ($, on) => {
  const m: ModeloVista = {
    ...flujo,
    agentes: [],
    cola: [],
    flujos: [{ ...flujo.flujos[0]!, remoto: true, lanzados: 0, listos: 0, enCurso: 0, fases: [] }],
    total: { estado: 'calculando', motivo: 'entre agentes' },
  }
  conModelo(on, m)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const lineas = await textos(ui)
    expect(dice(lineas, 'Calculando cuánto falta')).toBe(true)
    expect(dice(lineas, '1 workflow entre agentes')).toBe(true)
    expect(dice(lineas, 'auditoria-integral')).toBe(true)
    expect(dice(lineas, 'corre en la nube: su avance no se ve desde aquí')).toBe(true)
    await ui.unmount()

    const banda = await $.ui.mount({ ...BANDA, surface })
    expect(dice(await textos(banda), '1 workflow entre agentes · calculando cuánto falta')).toBe(true)
    await banda.unmount()
  }
})

test('en reposo: la última tarea y la precisión medida, con la cobertura como porcentaje', async ($, on) => {
  conModelo(on, reposo)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, bodyColumns: 80 } })
    const lineas = await textos(ui)
    expect(dice(lineas, 'Nada corriendo')).toBe(true)
    expect(dice(lineas, 'esperando tu mensaje')).toBe(true)
    expect(dice(lineas, '3 agentes en 18 min · US$ 2,40 · 0,6% de la semana')).toBe(true)
    // Lo medido es por foto (una por minuto): se dice del rango, no de cuántos agentes terminaron dentro.
    expect(dice(lineas, 'el rango acertó el 81% de las veces')).toBe(true)
    expect(dice(lineas, 'terminó dentro del rango')).toBe(false)
    expect(dice(lineas, 'error típico de 3 min, en 42 agentes medidos')).toBe(true)
    await ui.unmount()
  }
})

test('con nueve agentes, cada uno conserva su rango y su fase', async ($, on) => {
  conModelo(on, nueve)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    const lineas = await textos(ui)
    for (const a of nueve.agentes) {
      for (const parte of partesDeFalta(a.estimacion)) expect(dice(lineas, parte)).toBe(true)
      expect(dice(lineas, TEXTO_FASE[a.fase])).toBe(true)
    }
    expect(dice(lineas, 'En cola: verificador ×2')).toBe(true)
    await ui.unmount()
  }
})

test('en el escritorio cada agente lleva su luna y su franja, con un alt que se entiende', async ($, on) => {
  conModelo(on, cinco)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const dibujos = (await ui.findAll({ type: 'Svg' })) as { props: Record<string, unknown> }[]
  // El eje, y por agente una luna y una franja.
  expect(dibujos.length).toBe(1 + 2 * cinco.agentes.length)
  for (const d of dibujos) {
    const fuente = String(d.props.source)
    expect(fuente.startsWith('<svg ')).toBe(true)
    expect(fuente.length).toBeLessThan(131_072)
    expect(String(d.props.alt).trim().length).toBeGreaterThan(3)
    expect(Number(d.props.width)).toBeGreaterThan(0)
    expect(Number(d.props.height)).toBeGreaterThan(0)
    // La tinta sigue el tema: nada de negros ni grises fijos.
    expect(/#0{3,6}\b|#(?:8a8f98|888|999)/i.test(fuente)).toBe(false)
  }
  const alts = dibujos.map(d => String(d.props.alt))
  // Cada alt dice lo mismo que la pantalla: el rango estimado, no el tiempo medido ni un porcentaje que no se ve.
  expect(alts.some(a => a === 'termina en ~10–20 min desde ahora (rango firme)')).toBe(true)
  expect(alts.some(a => a === 'termina en ~15–40 min desde ahora (rango aproximado)')).toBe(true)
  expect(alts.some(a => a === 'termina en ~8–45 min desde ahora (rango incierto)')).toBe(true)
  expect(alts.some(a => a === 'sin horizonte: ya pasó lo típico (~25 min)')).toBe(true)
  expect(alts.some(a => a.includes('todo termina en ~15–45 min'))).toBe(true)
  // La luna dice lo que falta, como el texto de al lado; nada de «avance 48%».
  expect(alts.some(a => a === 'lo que falta: ~10–20 min')).toBe(true)
  expect(alts.some(a => a === 'ya pasó lo típico (~25 min)')).toBe(true)
  expect(alts.some(a => /avance|\d%/.test(a))).toBe(false)
  await ui.unmount()

  // La terminal no tiene Svg: ahí va todo en texto.
  const texto = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await texto.findAll({ type: 'Svg' })).toHaveLength(0)
  await texto.unmount()
})

test('el panel minimizado dice de un vistazo lo que le falta a cada agente', async ($, on) => {
  conModelo(on, nueve)
  for (const anchoredEdges of [['bottom', 'right'], [], undefined] as const) {
    const ui = await $.ui.mount({
      ...PANEL,
      surface: 'desktop',
      props: { ...PANEL.props, bodyColumns: 30, placement: 'widget', ...(anchoredEdges ? { anchoredEdges } : {}) },
    })
    const lineas = await textos(ui)
    expect(dice(lineas, 'Todo termina en')).toBe(true)
    expect(dice(lineas, '~30 min–1 h')).toBe(true)
    // Los seis lugares son para los seis primeros, pero el que ya pasó lo típico entra aunque sea el séptimo.
    const verlos = [...nueve.agentes.slice(0, 5), nueve.agentes[6]!]
    for (const a of verlos) {
      // En el panel minimizado el que pasó lo típico lo dice más corto («pasó lo típico»), para dejar lugar al nombre.
      expect(dice(lineas, a.estimacion.estado === 'pasado' ? 'pasó lo típico' : partesDeFalta(a.estimacion)[0]!)).toBe(true)
      expect(dice(lineas, titulo(a).slice(0, 8))).toBe(true)
    }
    // Y sin el rol: solo la descripción, que es lo que distingue.
    expect(lineas.some(l => l === 'implementador' || l.includes('implementador'))).toBe(false)
    expect(dice(lineas, nueve.agentes[5]!.descripcion)).toBe(false)
    expect(dice(lineas, 'y 3 más · 2 en cola')).toBe(true)
    await ui.unmount()
  }
})

test('en el panel minimizado, los que pasaron lo típico van primero y el pie dice cuántos quedaron fuera', async ($, on) => {
  const pasado = nueve.agentes[6]!
  const firme = nueve.agentes[0]!
  const buscan = (n: number) => Array.from({ length: n }, (_, i): AgenteVista => ({ ...pasado, id: `p${i}`, descripcion: `Búsqueda ${i + 1}` }))
  const widget = { ...PANEL, surface: 'desktop', props: { ...PANEL.props, bodyColumns: 30, placement: 'widget' } } as const
  // Siete pasados y dos firmes: caben seis; el pie dice que uno de los que quedan fuera ya pasó lo típico.
  const r = conModelo(on, { ...nueve, agentes: [...buscan(7), firme, { ...firme, id: 'f2', descripcion: 'Otro firme' }], cola: [] })
  const b = await $.ui.mount(widget)
  const lineasB = await textos(b)
  for (let i = 1; i <= 6; i++) expect(dice(lineasB, `Búsqueda ${i}`)).toBe(true)
  expect(dice(lineasB, 'Búsqueda 7')).toBe(false)
  expect(dice(lineasB, 'y 3 más (1 pasó lo típico)')).toBe(true)
  await b.unmount()

  // Ocho pasados y uno firme: dos de los que quedan fuera ya pasaron lo típico, y se dice en plural.
  r.modelo = { ...nueve, agentes: [firme, ...buscan(8)], cola: [] }
  const c = await $.ui.mount(widget)
  expect(dice(await textos(c), 'y 3 más (2 pasaron lo típico)')).toBe(true)
  await c.unmount()
})

test('la línea sobre el prompt resume en una frase y abre el panel', async ($, on) => {
  const r = conModelo(on, cinco)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...BANDA, surface })
    const lineas = await textos(ui)
    expect(dice(lineas, '5 agentes · el último termina en ')).toBe(true)
    expect(dice(lineas, '~15–45 min')).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'ver' })).toBeDefined()
    await ui.press({ key: 'ver', plugin: 'test' })
    await ui.unmount()
  }
  expect(r.aperturas).toBe(SUPERFICIES.length)
})

test('la línea se acorta en una columna angosta y nombra al agente cuando es uno solo', async ($, on) => {
  conModelo(on, cinco)
  const angosta = await $.ui.mount({ ...BANDA, surface: 'terminal', props: { ...BANDA.props, bodyColumns: 44 } })
  const cortas = await textos(angosta)
  expect(dice(cortas, 'el último termina en')).toBe(false)
  expect(dice(cortas, '~15–45 min')).toBe(true)
  await angosta.unmount()
})

test('con un solo agente la línea lo nombra', async ($, on) => {
  conModelo(on, { ...cinco, agentes: [cinco.agentes[0]!], total: cinco.agentes[0]!.estimacion, totalIncompleto: false })
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...BANDA, surface })
    const lineas = await textos(ui)
    // Con tres implementadores a la vez, lo que lo distingue es su descripción, no su rol.
    expect(dice(lineas, 'Pieza A: el estimador · termina en ')).toBe(true)
    expect(dice(lineas, '~10–20 min')).toBe(true)
    expect(dice(lineas, 'corriendo pruebas')).toBe(true)
    await ui.unmount()
  }
})

test('un panel muy angosto o un horizonte de horas no rompen el dibujo', async ($, on) => {
  const largo: ModeloVista = {
    ...cinco,
    agentes: cinco.agentes.map((a, i) =>
      i === 0 ? { ...a, estimacion: { estado: 'rango', bajoMin: 300, altoMin: 900, medioMin: 500, confianza: 'baja', progreso: 0.1, motivo: '' } } : a,
    ),
  }
  conModelo(on, largo)
  for (const surface of SUPERFICIES) {
    for (const bodyColumns of [12, 24, 200]) {
      const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, bodyColumns } })
      expect((await textos(ui)).length).toBeGreaterThan(0)
      await ui.unmount()
    }
  }
})

test('un dato fuera del contrato no cierra el panel: se dice que no se pudo dibujar', async ($, on) => {
  const roto = { ...cinco, agentes: [{ ...cinco.agentes[0]!, estimacion: undefined }] } as unknown as ModeloVista
  conModelo(on, roto)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect(dice(await textos(ui), 'Cuánto falta: no se pudo dibujar')).toBe(true)
    await ui.unmount()
    const banda = await $.ui.mount({ ...BANDA, surface })
    expect((await textos(banda)).length).toBeGreaterThan(0)
    await banda.unmount()
  }
})

test('con roles repetidos, el título de cada fila es su descripción y el rol va aparte, en gris', async ($, on) => {
  const r = conModelo(on, cinco)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const nodos = await nodosDeTexto(ui)
  const pos = (frase: string, props: Record<string, unknown> = {}) =>
    nodos.findIndex(n => n.text === frase && Object.entries(props).every(([k, v]) => n.props[k] === v))
  const implementadores = cinco.agentes.filter(a => a.rol === 'implementador')
  expect(implementadores.length).toBe(3)
  for (const a of implementadores) {
    // El título: su descripción, en fuerte y sin cortarse a media palabra (puede bajar de línea, no truncarse).
    const t = pos(a.descripcion, { weight: 'semibold' })
    expect(t).toBeGreaterThan(-1)
    expect(nodos[t]!.props.wrap).not.toBe('truncate-end')
    // El rol, justo después y en gris.
    expect(nodos[t + 1]!.text).toBe('implementador')
    expect(nodos[t + 1]!.props.color).toBe('inactive')
  }
  // Ningún título es «implementador»: tres filas iguales no se distinguirían.
  expect(pos('implementador', { weight: 'semibold' })).toBe(-1)
  await ui.unmount()

  // Sin descripción, el rol pasa a ser el título (y ya no hay nada en gris que repetir).
  r.modelo = { ...cinco, agentes: [{ ...cinco.agentes[0]!, descripcion: '' }, { ...cinco.agentes[4]!, descripcion: 'revisor' }] }
  const solo = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const sinDescripcion = await nodosDeTexto(solo)
  expect(sinDescripcion.some(n => n.text === 'implementador' && n.props.weight === 'semibold')).toBe(true)
  expect(sinDescripcion.some(n => n.text === 'revisor' && n.props.weight === 'semibold')).toBe(true)
  expect(sinDescripcion.some(n => n.props.color === 'inactive' && (n.text === 'implementador' || n.text === 'revisor'))).toBe(false)
  await solo.unmount()
})

test('en la terminal compacta cada agente se distingue por su descripción', async ($, on) => {
  conModelo(on, nueve)
  for (const bodyColumns of [80, 60, 44]) {
    const ui = await $.ui.mount({ ...PANEL, surface: 'terminal', props: { ...PANEL.props, bodyColumns } })
    const lineas = await textos(ui)
    for (const a of nueve.agentes) expect(dice(lineas, a.descripcion.slice(0, 10))).toBe(true)
    await ui.unmount()
  }
})

test('con roles y descripciones largas a 320 px, lo que se corta es el rol, no la descripción', async ($, on) => {
  const largo: ModeloVista = {
    ...cinco,
    agentes: cinco.agentes.slice(0, 3).map(a => ({ ...a, descripcion: `${a.descripcion} con su informe completo al terminar` })),
  }
  conModelo(on, largo)
  // 320 px son unas 33 celdas de cuerpo.
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop', props: { ...PANEL.props, bodyColumns: 33 } })
  const nodos = await nodosDeTexto(ui)
  for (const a of largo.agentes) {
    const t = nodos.find(n => n.text === a.descripcion)!
    expect(t).toBeDefined()
    expect(t.props.wrap).not.toBe('truncate-end')
  }
  // El rol, en cambio, es lo que cede.
  const roles = nodos.filter(n => n.text === 'implementador' && n.props.color === 'inactive')
  expect(roles.length).toBe(3)
  for (const r of roles) expect(r.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('ningún texto para la persona deja un nombre interno de rol', async ($, on) => {
  const r = conModelo(on, flujo)
  for (const m of [flujo, nueve]) {
    r.modelo = m
    for (const surface of SUPERFICIES) {
      for (const placement of ['dock', 'widget']) {
        const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, placement } })
        const lineas = await textos(ui)
        for (const interno of ['workflow-subagent', 'general-purpose', 'revisor-critico', 'mecanico']) expect(dice(lineas, interno)).toBe(false)
        await ui.unmount()
      }
    }
  }
  r.modelo = nueve
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const lineas = await textos(ui)
  expect(dice(lineas, 'revisor crítico')).toBe(true)
  expect(dice(lineas, 'mecánico')).toBe(true)
  await ui.unmount()
})

test('el agente que ya pasó lo típico tiene su propio signo, que no se confunde con uno a punto de terminar', async ($, on) => {
  conModelo(on, cinco)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const dibujos = await dibujosDe(ui)
  const lunaPasada = dibujos.find(d => d.alt === 'ya pasó lo típico (~25 min)')!
  expect(lunaPasada).toBeDefined()
  // Un aro en el color de acento con una «!» (una barra y un punto): nada de la escala de llenado.
  expect(lunaPasada.fuente).toContain(ACENTO)
  expect(lunaPasada.fuente).toContain('<rect')
  // Ninguna otra luna usa el acento (la de uno casi listo es tinta llena, y distinta).
  const otras = dibujos.filter(d => d !== lunaPasada && /^(lo que falta|calculando)/.test(d.alt))
  expect(otras.length).toBe(cinco.agentes.length - 1)
  for (const o of otras) expect(o.fuente).not.toContain(ACENTO)
  const casiListo = dibujos.find(d => d.alt === 'lo que falta: hasta ~2 min')!
  expect(casiListo.fuente).not.toBe(lunaPasada.fuente)
  await ui.unmount()

  // En la terminal, un glifo propio: «!», no un círculo más lleno.
  const terminal = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  const lineas = await textos(terminal)
  expect(lineas.some(l => l.startsWith('! Precios'))).toBe(true)
  expect(lineas.some(l => l.includes('◉'))).toBe(false)
  await terminal.unmount()
  const banda = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const dichas = await textos(banda)
  expect(dichas.some(l => l.includes('!'))).toBe(true)
  expect(dichas.some(l => l.includes('◉'))).toBe(false)
  await banda.unmount()
})

test('las franjas de confianza media y baja dibujan todo el largo del rango, con base visible', async ($, on) => {
  const r = conModelo(on, cinco)
  const franjaDe = async (confianza: 'alta' | 'media' | 'baja') => {
    const un: AgenteVista = { ...cinco.agentes[0]!, estimacion: { estado: 'rango', bajoMin: 10, altoMin: 20, medioMin: 15, confianza, progreso: 0.5, motivo: '' } }
    r.modelo = { ...cinco, agentes: [un], total: un.estimacion, totalIncompleto: false }
    const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
    const franja = (await dibujosDe(ui)).find(d => d.alt.startsWith('termina en ~10–20 min'))!
    await ui.unmount()
    return franja.fuente
  }
  /** El rect del bloque de color (el primero que lleva el acento) con sus atributos. */
  const bloque = (fuente: string) => {
    const rect = [...fuente.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="[\d.]+"([^>]*)\/>/g)].find(m => m[3]!.includes(ACENTO))!
    return { x: Number(rect[1]), ancho: Number(rect[2]), atributos: rect[3]! }
  }
  /** El tramo horizontal que cubre, contando el grosor de su borde (que se dibuja hacia adentro del rango). */
  const tramo = (fuente: string) => {
    const { x, ancho, atributos } = bloque(fuente)
    const trazo = Number(/stroke-width="([\d.]+)"/.exec(atributos)?.[1] ?? 0)
    return [x - trazo / 2, x + ancho + trazo / 2] as const
  }
  const alta = await franjaDe('alta')
  const media = await franjaDe('media')
  const baja = await franjaDe('baja')
  const [a0, b0] = tramo(alta)
  for (const f of [media, baja]) {
    // Las tres cubren el mismo tramo, de punta a punta: la firmeza no cambia el largo.
    const [desde, hasta] = tramo(f)
    expect(Math.abs(desde - a0)).toBeLessThan(0.05)
    expect(Math.abs(hasta - b0)).toBeLessThan(0.05)
    // Ya no se borran las puntas: ningún degradado que llegue a transparente.
    expect(f).not.toMatch(/stop-opacity="0"/)
    expect(f).not.toContain('<linearGradient')
    // Con base visible (relleno parejo) y un borde en el acento pleno (≥ 3:1 sobre el panel).
    const { atributos } = bloque(f)
    expect(Number(/fill-opacity="([\d.]+)"/.exec(atributos)?.[1])).toBeGreaterThanOrEqual(0.15)
    expect(atributos).toContain(`stroke="${ACENTO}"`)
    expect(atributos).not.toMatch(/stroke-opacity/)
  }
  // La incertidumbre se dice con la forma: borde firme para la aproximada…
  expect(bloque(media).atributos).not.toContain('stroke-dasharray')
  // …y borde punteado con trama para la incierta.
  expect(bloque(baja).atributos).toContain('stroke-dasharray')
  expect(baja).toContain('<pattern')
  expect(media).not.toContain('<pattern')
})

test('lo que lleva en la fase va pegado a la fase, y la cabecera dice «lleva»', async ($, on) => {
  conModelo(on, cinco)
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const lineas = await textos(ui)
  expect(dice(lineas, 'buscando en la web (19 min)')).toBe(true)
  // Nada de «hace 19 min» suelto, que se lee como algo que ya ocurrió.
  expect(dice(lineas, 'hace ')).toBe(false)
  expect(dice(lineas, 'lleva 43 min · US$ 4,10 · 1,2% de la semana')).toBe(true)
  expect(lineas.some(l => l === '43 min · US$ 4,10 · 1,2% de la semana')).toBe(false)
  await ui.unmount()
})

test('solo el total va en tamaño grande; las filas, un escalón abajo', async ($, on) => {
  const r = conModelo(on, cinco)
  for (const m of [cinco, nueve]) {
    r.modelo = m
    const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
    const grandes = (await nodosDeTexto(ui)).filter(n => n.props.size === 'title')
    expect(grandes.map(n => n.text)).toEqual([rango((m.total as any).bajoMin, (m.total as any).altoMin)])
    await ui.unmount()
  }
})

test('la banda nombra a cada agente y su rango en el alt, sin porcentajes que no se ven', async ($, on) => {
  conModelo(on, cinco)
  const ui = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  const alt = (await dibujosDe(ui))[0]!.alt
  expect(alt).toContain('5 agentes')
  for (const a of cinco.agentes) expect(alt).toContain(a.descripcion)
  expect(alt).toContain('Pieza A: el estimador ~10–20 min')
  expect(alt).toContain('Precios de la API de voz ya pasó lo típico (~25 min)')
  expect(/avance|\d%/.test(alt)).toBe(false)
  await ui.unmount()
})

test('en la terminal, «ver detalle» no se pega al final de la frase', async ($, on) => {
  conModelo(on, cinco)
  const terminal = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const boton = (await terminal.find({ type: 'Button', key: 'ver' })) as { props: { label: string } }
  expect(boton.props.label).toBe('→ ver detalle')
  await terminal.unmount()
  // En el escritorio el botón ya se ve aparte (subrayado y en gris): se queda como estaba.
  const escritorio = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  expect(((await escritorio.find({ type: 'Button', key: 'ver' })) as { props: { label: string } }).props.label).toBe('ver detalle')
  await escritorio.unmount()
})

test('los modelos de ejemplo dicen lo mismo que el seguimiento: el total es el máximo de lo bajo y de lo alto', () => {
  for (const [nombre, m] of Object.entries(FIXTURES)) {
    const rangos = m.agentes.flatMap(a => (a.estimacion.estado === 'rango' ? [a.estimacion] : []))
    if (!rangos.length) continue
    expect(m.total.estado, nombre).toBe('rango')
    if (m.total.estado !== 'rango') continue
    expect(m.total.bajoMin, nombre).toBe(Math.max(...rangos.map(r => r.bajoMin)))
    expect(m.total.altoMin, nombre).toBe(Math.max(...rangos.map(r => r.altoMin)))
  }
  expect(rango((cinco.total as any).bajoMin, (cinco.total as any).altoMin)).toBe('~15–45 min')
  expect(rango((flujo.total as any).bajoMin, (flujo.total as any).altoMin)).toBe('~12–25 min')
})

test('el formato de la vista', () => {
  expect(tipico(25)).toBe('~25 min')
  expect(pasoLoTipico(25)).toBe('ya pasó lo típico (~25 min)')
  expect(pasoLoTipico(90)).toBe('ya pasó lo típico (~1,5 h)')
  expect(marca(10, false)).toBe('10')
  expect(marca(45, true)).toBe('45 min')
  expect(marca(60, false)).toBe('1 h')
  expect(marca(90, false)).toBe('1,5 h')
  expect(fraccion(0.81)).toBe('81%')
  expect(fraccion(0.666)).toBe('67%')
  expect(fraccion(1.4)).toBe('100%')
  expect(fraccion(-1)).toBe('0%')
  expect(contar(['a', 'b', 'a'])).toBe('a ×2, b')
  expect(contar([])).toBe('')
  expect(cortar('implementador', 8)).toBe('impleme…')
  expect(cortar('corto', 8)).toBe('corto')
  expect(cortar('algo', 0)).toBe('')
})
