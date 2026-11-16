// La vista: la línea sobre el prompt y el panel al costado. Dueño: la pieza de la vista.
// Recibe el ModeloVista ya calculado; no lee $.state ni estima nada.
//
// La idea: una tabla de llegadas. Cada agente es una fila con lo que le falta a la derecha, una luna
// que se llena con su avance a la izquierda y, debajo, una franja sobre un eje común que parte en
// «ahora»: el bloque de color marca entre cuándo y cuándo termina, siempre de punta a punta. Mientras
// más firme el rango, más sólido el bloque: lleno, con borde y relleno suave, o con borde punteado
// y trama. El que ya pasó lo típico no está en la escala: lleva su propio signo («!»). Sin leyenda.
//
// El título de cada fila es la descripción del agente (lo que lo distingue cuando hay varios del
// mismo rol); el rol va aparte, en gris. Solo cuando no hay descripción el rol es el título.
//
// Las palabras van en texto nativo (siguen el tema y la letra de la app). Los Svg solo dibujan
// formas: la tinta es `currentColor` (la app le pone al Svg el color del texto del tema) y hay un
// único color, el de «Claude trabajando», que se lee igual sobre claro y sobre oscuro.
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { TEXTO_FASE } from './contrato'
import type { AgenteVista, Estimacion, Fase, FlujoVista, ModeloVista } from './contrato'
import { contar, cortar, duracion, fraccion, marca, nombreRol, pasoLoTipico, plural, rango, tipico } from './formato'

// ——— Lo que se dice (igual en todas las superficies) ———

/** El color de la estimación: el clay de Claude (`fill.brand` de la app). Contraste ≥ 4:1 sobre el panel claro y el oscuro. */
const ACENTO = '#C6613F'

/** Roles que no dicen nada por sí solos: ahí manda la descripción. */
const GENERICOS = new Set(['workflow-subagent', 'general-purpose', 'fork', 'agente', 'subagent'])

/** Cada fase como parada del camino (leer → editar → probar → informe). */
const PARADA: Record<Fase, string> = {
  arrancando: 'arrancar',
  leyendo: 'leer',
  investigando: 'buscar',
  editando: 'editar',
  probando: 'probar',
  navegando: 'pantalla',
  commit: 'commit',
  delegando: 'delegar',
  informe: 'informe',
}

/** Lo que falta, tal cual: un rango, «calculando» o «ya pasó lo típico (~25 min)». Nunca un número inventado. */
function falta(e: Estimacion): string {
  if (e.estado === 'rango') return rango(e.bajoMin, e.altoMin)
  if (e.estado === 'pasado') return pasoLoTipico(e.tipicoMin)
  return 'calculando'
}

function lleva(a: AgenteVista): string {
  return `lleva ${a.inicioAprox ? 'más de ' : ''}${duracion(a.llevaMin)}`
}

function fase(a: AgenteVista): string {
  return TEXTO_FASE[a.fase] ?? a.fase
}

function pasos(a: AgenteVista): string | undefined {
  return a.lista && a.lista.total > 0 ? `${a.lista.hechos} de ${a.lista.total} pasos` : undefined
}

/**
 * El nombre de la fila: su descripción, que es lo que distingue a un agente de otro del mismo rol, y el
 * rol aparte (en gris). El rol es el título solo si no hay descripción (o si repite al rol). Un rol
 * genérico («agente del workflow») no dice nada: sin descripción es el título y no hay detalle.
 */
function nombres(a: AgenteVista): { titulo: string; detalle?: string } {
  const descripcion = a.descripcion.replace(/\s+/g, ' ').trim()
  const rol = nombreRol(a.rol)
  if (GENERICOS.has(a.rol)) return { titulo: descripcion || (a.flujo ? 'agente del workflow' : a.rol === 'subagent' ? 'agente' : rol) }
  const repite = [a.rol, rol].some(r => r.toLowerCase() === descripcion.toLowerCase())
  return descripcion && !repite ? { titulo: descripcion, detalle: rol } : { titulo: rol }
}

/** Por dónde pasó, en orden, y dónde está ahora (la última). Si volvió a una fase anterior, se repite al final. */
function camino(a: AgenteVista): string[] {
  const paradas: Fase[] = a.vistas.filter(f => f !== 'arrancando')
  if (paradas[paradas.length - 1] !== a.fase) paradas.push(a.fase)
  return paradas.map(f => PARADA[f] ?? f)
}

/** «5 agentes», «3 agentes · 1 workflow», «1 workflow entre agentes». */
function cuantos(m: ModeloVista): string {
  const partes: string[] = []
  if (m.agentes.length) partes.push(plural(m.agentes.length, 'agente', 'agentes'))
  if (m.flujos.length) partes.push(plural(m.flujos.length, 'workflow', 'workflows') + (m.agentes.length ? '' : ' entre agentes'))
  if (m.cola.length) partes.push(`${m.cola.length} en cola`)
  return partes.join(' · ')
}

function gasto(m: ModeloVista): string {
  const partes: string[] = []
  if (m.tareaMin !== undefined) partes.push(`lleva ${duracion(m.tareaMin)}`)
  if (m.gasto?.costo) partes.push(m.gasto.costo)
  if (m.gasto?.semana) partes.push(m.gasto.semana)
  return partes.join(' · ')
}

function precision(m: ModeloVista): string[] {
  const p = m.precision
  if (!p || p.agentes <= 0) return []
  return [
    `el rango acertó el ${fraccion(p.cobertura)} de las veces`,
    `error típico de ${duracion(p.errorMedianoMin)}, en ${plural(p.agentes, 'agente medido', 'agentes medidos')}`,
  ]
}

function hayTrabajo(m: ModeloVista): boolean {
  return m.agentes.length > 0 || m.flujos.length > 0
}

/** Los agentes sueltos y, después, cada workflow con los suyos (uno que aún no aparece en `flujos` igual se agrupa). */
function grupos(m: ModeloVista): { sueltos: AgenteVista[]; deFlujo: { flujo: FlujoVista; agentes: AgenteVista[] }[] } {
  const sueltos = m.agentes.filter(a => !a.flujo)
  const flujos = [...m.flujos]
  for (const a of m.agentes) {
    if (a.flujo && !flujos.some(f => f.id === a.flujo)) {
      flujos.push({ id: a.flujo, nombre: 'workflow', fases: [], llevaMin: a.llevaMin, listos: 0, enCurso: 0, lanzados: 0, remoto: false })
    }
  }
  return { sueltos, deFlujo: flujos.map(flujo => ({ flujo, agentes: m.agentes.filter(a => a.flujo === flujo.id) })) }
}

function textoFlujo(f: FlujoVista): string {
  const partes: string[] = []
  if (f.lanzados > 0) partes.push(`${f.listos} de ${f.lanzados} listos`)
  partes.push(`lleva ${duracion(f.llevaMin)}`)
  return partes.join(' · ')
}

const NUBE = 'corre en la nube: su avance no se ve desde aquí'

/** La cola, contada y en palabras: «agente del workflow ×2, verificador». */
function enCola(m: ModeloVista): string {
  return `En cola: ${contar(m.cola.map(nombreRol))}`
}

// ——— El eje común: de «ahora» hasta un horizonte redondo ———

/** Horizontes y cada cuánto va una marca, en minutos. Fijos, así al bajar lo que falta los bloques se acercan a «ahora». */
const ESCALAS: readonly (readonly [number, number])[] = [
  [3, 1],
  [6, 2],
  [9, 3],
  [12, 4],
  [15, 5],
  [20, 5],
  [30, 10],
  [40, 10],
  [45, 15],
  [60, 15],
  [90, 30],
  [120, 30],
  [180, 60],
  [240, 60],
  [360, 120],
  [480, 120],
  [720, 240],
]

type Eje = { hasta: number; marcas: number[] }

function eje(m: ModeloVista): Eje | null {
  const altos = m.agentes.flatMap(a => (a.estimacion.estado === 'rango' ? [a.estimacion.altoMin] : []))
  if (m.total.estado === 'rango') altos.push(m.total.altoMin)
  if (!altos.length) return null
  const max = Math.max(...altos) * (m.totalIncompleto ? 1.08 : 1)
  const dia = Math.ceil(max / 240) * 240
  const [hasta, paso] = ESCALAS.find(([h]) => h >= max) ?? [dia, dia / 4]
  const marcas: number[] = []
  for (let t = paso; t <= hasta; t += paso) marcas.push(t)
  return { hasta, marcas }
}

/** Las marcas con su unidad solo donde hace falta: «10 · 20 · 30 min», «15 · 30 · 45 min · 1 h». */
function rotulos(e: Eje): string[] {
  return e.marcas.map((t, i) => {
    const sigue = e.marcas[i + 1]
    return marca(t, sigue === undefined || sigue >= 60)
  })
}

// ——— Las formas (Svg) ———

function n(x: number): string {
  return String(Math.round(x * 100) / 100)
}

/**
 * La tinta de los Svg es `currentColor`: la app le pone a la raíz el color del texto del tema
 * (`color="…"`), así las formas siguen el tema claro y el oscuro. Por si una superficie no lo pone,
 * esta regla da un gris medio que se ve sobre los dos fondos; con el atributo puesto, no aplica.
 */
const TINTA_DE_RESPALDO = '<style>svg:not([color]){color:#8C8A83}</style>'

function svg(ancho: number, alto: number, cuerpo: string, estirar = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(ancho)}" height="${n(alto)}" viewBox="0 0 ${n(ancho)} ${n(alto)}"` +
    `${estirar ? ' preserveAspectRatio="none"' : ''}>${TINTA_DE_RESPALDO}${cuerpo}</svg>`
  )
}

/**
 * La luna de un agente: un aro y, dentro, la porción que lleva. Punteada si aún se calcula. Si ya pasó
 * lo típico no hay porción que mostrar: sale de la escala con su propio signo, un aro en el color de
 * acento con una «!» (la luna llena es la de uno a punto de terminar, y no puede parecérsele).
 */
function formaLuna(e: Estimacion, lado: number): string {
  const c = lado / 2
  const aro = c - 0.8
  const r = aro - 1.9
  if (e.estado === 'calculando') {
    const tramo = (2 * Math.PI * aro) / 10
    return `<circle cx="${n(c)}" cy="${n(c)}" r="${n(aro)}" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.1" stroke-dasharray="${n(tramo * 0.45)} ${n(tramo * 0.55)}"/>`
  }
  if (e.estado === 'pasado') {
    return (
      `<circle cx="${n(c)}" cy="${n(c)}" r="${n(aro)}" fill="${ACENTO}" fill-opacity=".14" stroke="${ACENTO}" stroke-width="1.4"/>` +
      `<rect x="${n(c - lado * 0.07)}" y="${n(lado * 0.24)}" width="${n(lado * 0.14)}" height="${n(lado * 0.32)}" rx="${n(lado * 0.07)}" fill="${ACENTO}"/>` +
      `<circle cx="${n(c)}" cy="${n(lado * 0.72)}" r="${n(lado * 0.085)}" fill="${ACENTO}"/>`
    )
  }
  const p = Math.min(1, Math.max(0, e.progreso))
  const fondo = `<circle cx="${n(c)}" cy="${n(c)}" r="${n(aro)}" fill="none" stroke="currentColor" stroke-opacity=".34" stroke-width="1.1"/>`
  if (p >= 0.995) return `${fondo}<circle cx="${n(c)}" cy="${n(c)}" r="${n(r)}" fill="currentColor" fill-opacity=".85"/>`
  if (p <= 0.03) return `${fondo}<circle cx="${n(c)}" cy="${n(c)}" r="1" fill="currentColor" fill-opacity=".85"/>`
  const a = 2 * Math.PI * p
  const x = c + r * Math.sin(a)
  const y = c - r * Math.cos(a)
  return `${fondo}<path d="M${n(c)} ${n(c)}L${n(c)} ${n(c - r)}A${n(r)} ${n(r)} 0 ${p > 0.5 ? 1 : 0} 1 ${n(x)} ${n(y)}Z" fill="currentColor" fill-opacity=".85"/>`
}

/** Lo que dice la luna para quien no la ve: lo mismo que el texto de al lado (nunca un avance que no está en pantalla). */
function altLuna(e: Estimacion): string {
  return e.estado === 'rango' ? `lo que falta: ${falta(e)}` : falta(e)
}

function svgLuna(e: Estimacion, lado: number): string {
  return svg(lado, lado, formaLuna(e, lado))
}

/** Las lunas de todos los agentes en una fila: el vistazo de la línea sobre el prompt. */
function svgLunas(agentes: readonly AgenteVista[], lado: number): { fuente: string; ancho: number } {
  const paso = lado + 3
  const ancho = Math.max(lado, agentes.length * paso - 3)
  const cuerpo = agentes.map((a, i) => `<g transform="translate(${i * paso} 0)">${formaLuna(a.estimacion, lado)}</g>`).join('')
  return { fuente: svg(ancho, lado, cuerpo), ancho }
}

const ALTO_FRANJA = 10
/** Grosor del borde de un bloque con confianza media o baja, en pixeles de pantalla (no se estira con el panel). */
const TRAZO = 1.2

/**
 * La franja de una fila, sobre el eje común. Se dibuja estirada al ancho del panel
 * (preserveAspectRatio="none"): las posiciones son fracciones del ancho, así calzan fila con fila
 * y con el eje sin saber cuántos pixeles mide el panel.
 *
 * El bloque cubre siempre el rango entero, de punta a punta. La firmeza se dice con la forma, no con
 * el largo: firme es lleno; aproximado, un borde del acento con relleno suave; incierto, un borde
 * punteado con trama. El borde (acento pleno, ≥ 3:1 sobre el panel claro y el oscuro) lo mantiene a la
 * vista aunque el relleno sea suave.
 */
function svgFranja(e: Estimacion, escala: Eje | null, ancho: number): string {
  const medio = ALTO_FRANJA / 2
  const ahora = `<rect x="0" y="1" width="1.6" height="${ALTO_FRANJA - 2}" rx=".8" fill="currentColor" fill-opacity=".45"/>`
  if (e.estado === 'pasado') {
    // Sin horizonte: una trama que se pierde hacia la derecha.
    return svg(
      ancho,
      ALTO_FRANJA,
      `<defs><pattern id="t" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.7" height="5" fill="currentColor"/></pattern>` +
        `<linearGradient id="f"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
        `<mask id="m"><rect width="${n(ancho)}" height="${ALTO_FRANJA}" fill="url(#f)"/></mask></defs>` +
        `${ahora}<rect x="4" y="1.5" width="${n(ancho - 4)}" height="${ALTO_FRANJA - 3}" rx="2" fill="url(#t)" mask="url(#m)"/>`,
      true,
    )
  }
  if (e.estado === 'calculando' || !escala) {
    return svg(
      ancho,
      ALTO_FRANJA,
      `${ahora}<line x1="6" y1="${medio}" x2="${n(ancho - 1)}" y2="${medio}" stroke="currentColor" stroke-opacity=".38" stroke-width="1.5" stroke-linecap="round" stroke-dasharray=".1 6"/>`,
      true,
    )
  }
  const x = (min: number) => (Math.min(escala.hasta, Math.max(0, min)) / escala.hasta) * ancho
  const largo = Math.max(5, x(e.altoMin) - x(e.bajoMin))
  const desde = Math.min(x(e.bajoMin), ancho - largo)
  const guia =
    desde > 7 ? `<rect x="4" y="${medio - 0.6}" width="${n(desde - 6)}" height="1.2" rx=".6" fill="currentColor" fill-opacity=".2"/>` : ''
  if (e.confianza === 'alta') {
    return svg(ancho, ALTO_FRANJA, `${ahora}${guia}<rect x="${n(desde)}" y="1" width="${n(largo)}" height="${ALTO_FRANJA - 2}" rx="2" fill="${ACENTO}"/>`, true)
  }
  // Con borde: el trazo queda hacia adentro del rango (se corre medio grosor), así el bloque mide lo que el rango.
  const caja = (resto: string) =>
    `<rect x="${n(desde + TRAZO / 2)}" y="${n(1 + TRAZO / 2)}" width="${n(largo - TRAZO)}" height="${n(ALTO_FRANJA - 2 - TRAZO)}" rx="1.6" stroke="${ACENTO}" stroke-width="${TRAZO}" vector-effect="non-scaling-stroke"${resto}/>`
  if (e.confianza === 'media') return svg(ancho, ALTO_FRANJA, `${ahora}${guia}${caja(` fill="${ACENTO}" fill-opacity=".35"`)}`, true)
  const trama =
    `<defs><pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="1.1" height="4" fill="${ACENTO}" fill-opacity=".6"/></pattern></defs>`
  return svg(
    ancho,
    ALTO_FRANJA,
    `${trama}${ahora}${guia}${caja(` fill="${ACENTO}" fill-opacity=".18" stroke-dasharray="2.4 2"`)}` +
      `<rect x="${n(desde + TRAZO)}" y="${n(1 + TRAZO)}" width="${n(Math.max(0, largo - 2 * TRAZO))}" height="${n(ALTO_FRANJA - 2 - 2 * TRAZO)}" rx="1" fill="url(#h)"/>`,
    true,
  )
}

function altFranja(e: Estimacion): string {
  if (e.estado === 'pasado') return `sin horizonte: ${pasoLoTipico(e.tipicoMin)}`
  if (e.estado === 'calculando') return 'aún sin estimación'
  const firmeza = e.confianza === 'alta' ? 'rango firme' : e.confianza === 'media' ? 'rango aproximado' : 'rango incierto'
  return `termina en ${rango(e.bajoMin, e.altoMin)} desde ahora (${firmeza})`
}

const ALTO_EJE = 7

/**
 * La regla bajo las marcas: una línea fina con una muesca en cada marca y, sobre ella, el tramo
 * entre el que termina todo, en el mismo color de los bloques. Si puede ser más, se pierde hacia la derecha.
 */
function svgEje(escala: Eje, total: Estimacion, abierto: boolean, ancho: number): string {
  const x = (min: number) => (Math.min(escala.hasta, Math.max(0, min)) / escala.hasta) * ancho
  const muescas = [0, ...escala.marcas]
    .map(t => `<rect x="${n(Math.min(ancho - 1, x(t)))}" y="0" width="1" height="${ALTO_EJE - 1}" fill="currentColor" fill-opacity="${t === 0 ? '.45' : '.28'}"/>`)
    .join('')
  const base = `<rect x="0" y="${ALTO_EJE - 2}" width="${n(ancho)}" height="1" fill="currentColor" fill-opacity=".16"/>`
  if (total.estado !== 'rango') return svg(ancho, ALTO_EJE, `${base}${muescas}`, true)
  const desde = x(total.bajoMin)
  const hasta = Math.max(desde + 4, x(total.altoMin))
  const cola =
    abierto && hasta < ancho - 2
      ? `<defs><linearGradient id="c"><stop offset="0" stop-color="${ACENTO}" stop-opacity=".55"/><stop offset="1" stop-color="${ACENTO}" stop-opacity="0"/></linearGradient></defs>` +
        `<rect x="${n(hasta)}" y="${ALTO_EJE - 3}" width="${n(Math.min(ancho - hasta, ancho * 0.22))}" height="3" fill="url(#c)"/>`
      : ''
  return svg(ancho, ALTO_EJE, `${base}${muescas}${cola}<rect x="${n(desde)}" y="${ALTO_EJE - 3}" width="${n(hasta - desde)}" height="3" rx="1.5" fill="${ACENTO}"/>`, true)
}

// ——— La tabla de elementos de cada superficie ———

// Sin `tsc` a mano y con una tabla distinta por superficie, las piezas se tratan como funciones
// sueltas: el motor valida el árbol al dibujarlo y la prueba lo monta en terminal y en escritorio.
type Pieza = (props: any) => any
type Tabla = { Box: Pieza; Text: Pieza; Button: Pieza; Svg?: Pieza }

function tabla($: EngineInterface, e: RenderInput<'Pane'> | RenderInput<'AbovePrompt'>): Tabla {
  return $.ui.resolve(e) as unknown as Tabla
}

/**
 * La terminal es la única superficie sin Svg: se dibuja en texto. No se detecta mirando si la tabla trae
 * `Svg`: `$.ui.resolve` entrega todos los nombres en toda superficie, y en la terminal el `Svg` es un
 * fragmento vacío (así se vería sin lunas ni franjas), por eso se pregunta por la superficie.
 */
function enTexto(e: RenderInput<'Pane'> | RenderInput<'AbovePrompt'>): boolean {
  return e.surface === 'terminal'
}

function columnas(e: RenderInput<'Pane'> | RenderInput<'AbovePrompt'>, porDefecto: number): number {
  const c = e.props.bodyColumns ?? e.viewport?.columns
  return typeof c === 'number' && Number.isFinite(c) && c > 0 ? Math.floor(c) : porDefecto
}

/** Ancho aproximado de una celda en las superficies gráficas: da la proporción del dibujo, no su tamaño. */
const PX_CELDA = 8
/** Lo que se le pide al Svg estirado: de sobra, y la superficie lo ajusta al ancho del panel. */
const PX_PEDIDO = 10

/** El ancho en pixeles que se pide para un Svg estirado (las superficies aceptan hasta 4096). */
function pedido(cols: number): number {
  return Math.min(4000, Math.max(40, cols * PX_PEDIDO))
}

/** El ancho del dibujo de un Svg estirado: cerca de los pixeles reales, para que las esquinas y la trama no se deformen. */
function lienzo(cols: number): number {
  return Math.max(40, cols * PX_CELDA)
}

// ——— Escritorio (y las demás superficies con Svg) ———

type Densidad = 'amplia' | 'normal' | 'compacta'

function densidad(m: ModeloVista): Densidad {
  return m.agentes.length <= 3 ? 'amplia' : m.agentes.length <= 6 ? 'normal' : 'compacta'
}

type Lienzo = { el: Tabla; cols: number; escala: Eje | null; densidad: Densidad }

/**
 * El tercer tono del texto, para lo que solo acompaña: el color del texto del tema, atenuado.
 * Sigue el tema y se lee en los dos (contraste cercano a 5:1 sobre el panel claro y 6:1 sobre el
 * oscuro); el secundario atenuado quedaba bajo 3:1 en claro.
 */
const TENUE = { color: 'text', dimColor: true } as const

function franja(l: Lienzo, e: Estimacion) {
  const Svg = l.el.Svg!
  return <Svg source={svgFranja(e, l.escala, lienzo(l.cols))} alt={altFranja(e)} width={pedido(l.cols)} height={ALTO_FRANJA} />
}

/** Rótulo y valor en dos columnas: «Principal   espera a implementador». */
function par(el: Tabla, rotulo: string, valor: string | string[]) {
  const { Box, Text } = el
  const lineas = Array.isArray(valor) ? valor : [valor]
  return (
    <Box flexDirection="row" gap={1}>
      <Box width={10} flexShrink={0}>
        <Text size="footnote" {...TENUE} wrap="truncate">
          {rotulo}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {lineas.map(linea => (
          <Text size="footnote" color="inactive">
            {linea}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

/** Lo que encabeza: «Todo termina en» con su rango, o tal cual que aún se calcula o que ya pasó lo típico. */
function titular(t: Estimacion): string {
  if (t.estado === 'rango') return 'Todo termina en'
  return t.estado === 'pasado' ? `Ya pasó lo típico (${tipico(t.tipicoMin)})` : 'Calculando cuánto falta'
}

function cabecera(l: Lienzo, m: ModeloVista) {
  const { Box, Text } = l.el
  const t = m.total
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} paddingTop={t.estado === 'rango' ? 'xs' : 0}>
          <Text size="heading" weight="semibold" wrap="truncate-end">
            {titular(t)}
          </Text>
          <Text size="footnote" color="inactive">
            {cuantos(m)}
          </Text>
        </Box>
        {t.estado === 'rango' ? (
          <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
            <Text size="title" weight="semibold" tabular wrap="truncate">
              {rango(t.bajoMin, t.altoMin)}
            </Text>
            {m.totalIncompleto ? (
              <Text size="caption" color="inactive" wrap="truncate">
                o más
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
      <Box flexDirection="column">
        {par(l.el, 'Principal', m.principal)}
        {gasto(m) ? par(l.el, 'Esta tarea', gasto(m)) : null}
      </Box>
    </Box>
  )
}

/** Las marcas del eje, cada una arrancando en su muesca, y la regla debajo. */
function regla(l: Lienzo, m: ModeloVista) {
  const { Box, Text, Svg } = l.el
  if (!l.escala || !Svg) return null
  const escala = l.escala
  const textos = rotulos(escala)
  // El motor solo acepta porcentajes enteros: se redondea el borde de cada tramo, no su ancho, así
  // el error no se acumula (a lo más medio punto, un par de pixeles).
  const bordes = [0, ...escala.marcas].map(t => Math.round((t / escala.hasta) * 100))
  const celdas = textos.map((_, i) => {
    const ancho = `${bordes[i + 1]! - bordes[i]!}%`
    return (
      <Box width={ancho} flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <Text size="caption" {...TENUE} tabular wrap="truncate">
          {i === 0 ? 'ahora' : textos[i - 1]}
        </Text>
        {i === textos.length - 1 ? (
          <Text size="caption" {...TENUE} tabular wrap="truncate">
            {textos[i]}
          </Text>
        ) : null}
      </Box>
    )
  })
  const termina = m.total.estado === 'rango' ? `; todo termina en ${rango(m.total.bajoMin, m.total.altoMin)}` : ''
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">{celdas}</Box>
      <Svg
        source={svgEje(escala, m.total, m.totalIncompleto, lienzo(l.cols))}
        alt={`eje de tiempo: de ahora a ${textos[textos.length - 1]}${termina}`}
        width={pedido(l.cols)}
        height={ALTO_EJE}
      />
    </Box>
  )
}

function fila(l: Lienzo, a: AgenteVista, sangria = 0) {
  const { Box, Text } = l.el
  const Svg = l.el.Svg!
  const e = a.estimacion
  const { titulo, detalle } = nombres(a)
  const compacta = l.densidad === 'compacta'
  const amplia = l.densidad === 'amplia'
  // «(12 min)» pegado a la fase solo cuando dice algo: lleva rato en esa fase y no es la corrida entera.
  const rato = a.fase !== 'arrancando' && a.faseDesdeMin >= (amplia ? 3 : 10) && a.llevaMin - a.faseDesdeMin >= 1
  // Lo que acompaña a la fase, en orden de importancia. Cada dato es una pieza entera: si no cabe
  // en la línea baja a la siguiente, nunca se corta a medias.
  const datos = [pasos(a), lleva(a)].filter((s): s is string => Boolean(s))
  const paradas = camino(a)

  const derecha =
    e.estado === 'rango' ? (
      <Text size="heading" weight="semibold" tabular wrap="truncate">
        {rango(e.bajoMin, e.altoMin)}
      </Text>
    ) : e.estado === 'pasado' ? (
      <Text weight="medium" wrap="truncate">
        {'ya pasó lo típico '}
        <Text weight="regular" color="inactive" tabular>{`(${tipico(e.tipicoMin)})`}</Text>
      </Text>
    ) : (
      <Text color="inactive" wrap="truncate">
        calculando
      </Text>
    )

  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap={1} paddingLeft={sangria}>
        <Box flexShrink={0}>
          <Box height={1} alignItems="center">
            <Svg source={svgLuna(e, 14)} alt={altLuna(e)} width={14} height={14} />
          </Box>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Box flexDirection="row" gap={1}>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="flex-end" flexGrow={1} flexShrink={1} minWidth={0}>
              {/* La descripción es lo que distingue al agente: baja de línea antes que cortarse (salvo en la lista densa). */}
              <Text weight="semibold" wrap={compacta ? 'truncate-end' : 'wrap'}>
                {titulo}
              </Text>
              {/* El rol cede primero: si no cabe junto al título, baja a la línea siguiente y ahí se corta. */}
              {detalle ? (
                <Text size="footnote" color="inactive" wrap="truncate-end">
                  {detalle}
                </Text>
              ) : null}
            </Box>
            <Box flexShrink={0}>{derecha}</Box>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap="md" alignItems="flex-end">
            <Text size="footnote" wrap="truncate-end">
              {fase(a)}
              {rato ? <Text color="inactive" tabular>{` (${duracion(a.faseDesdeMin)})`}</Text> : null}
            </Text>
            {datos.map(dato => (
              <Text size="footnote" color="inactive" tabular wrap="truncate-end">
                {dato}
              </Text>
            ))}
            {a.modelo ? (
              <Text size="footnote" {...TENUE} wrap="truncate-end">
                {a.modelo}
              </Text>
            ) : null}
          </Box>
          {amplia && (paradas.length > 1 || a.lista?.actual) ? (
            <Text size="caption" {...TENUE} wrap="truncate-end">
              {paradas.length > 1 ? `${paradas.slice(0, -1).join(' → ')} → ` : ''}
              <Text color="inactive" weight="medium">
                {paradas[paradas.length - 1] ?? ''}
              </Text>
              {a.lista?.actual ? <Text color="inactive">{`: ${a.lista.actual}`}</Text> : null}
            </Text>
          ) : null}
          {amplia && e.motivo ? (
            <Text size="caption" {...TENUE} wrap="truncate-end">
              {e.motivo}
            </Text>
          ) : null}
        </Box>
      </Box>
      {franja(l, e)}
    </Box>
  )
}

/** La luna de un workflow: los agentes que ya terminaron, de los que lanzó. */
function avanceFlujo(f: FlujoVista): Estimacion {
  if (f.remoto || f.lanzados <= 0) return { estado: 'calculando', motivo: '' }
  return { estado: 'rango', bajoMin: 0, altoMin: 0, medioMin: 0, confianza: 'media', progreso: f.listos / f.lanzados, motivo: '' }
}

function encabezadoFlujo(l: Lienzo, f: FlujoVista) {
  const { Box, Text } = l.el
  const Svg = l.el.Svg!
  return (
    <Box flexDirection="row" gap={1}>
      <Box height={1} alignItems="center" flexShrink={0}>
        <Svg
          source={svgLuna(avanceFlujo(f), 14)}
          alt={f.lanzados > 0 && !f.remoto ? `${f.listos} de ${f.lanzados} agentes listos` : 'avance del workflow sin datos'}
          width={14}
          height={14}
        />
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="flex-end">
          <Text weight="semibold" wrap="truncate-end">
            {f.nombre}
          </Text>
          <Text size="footnote" color="inactive" wrap="truncate-end">
            workflow
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap="md" alignItems="flex-end">
          {f.lanzados > 0 ? (
            <Text size="footnote" tabular wrap="truncate-end">{`${f.listos} de ${f.lanzados} listos`}</Text>
          ) : null}
          <Text size="footnote" color="inactive" tabular wrap="truncate-end">{`lleva ${duracion(f.llevaMin)}`}</Text>
          {f.fases.length > 0 ? (
            <Text size="footnote" {...TENUE} wrap="truncate-end">
              {f.fases.join(' → ')}
            </Text>
          ) : null}
        </Box>
        {f.remoto ? (
          <Text size="caption" color="inactive">
            {NUBE}
          </Text>
        ) : null}
      </Box>
    </Box>
  )
}

function reposoGrafico(el: Tabla, m: ModeloVista) {
  const { Box, Text } = el
  const medido = precision(m)
  return (
    <Box flexDirection="column" gap="sm">
      <Text size="heading" weight="semibold">
        Nada corriendo
      </Text>
      <Box flexDirection="column" gap="xs">
        {par(el, 'Principal', m.principal)}
        {m.ultima ? par(el, 'Última tarea', m.ultima) : null}
        {medido.length ? par(el, 'Precisión', medido) : null}
      </Box>
    </Box>
  )
}

function panelGrafico(el: Tabla, m: ModeloVista, cols: number) {
  const { Box, Text } = el
  if (!hayTrabajo(m)) return reposoGrafico(el, m)
  const l: Lienzo = { el, cols, escala: eje(m), densidad: densidad(m) }
  const { sueltos, deFlujo } = grupos(m)
  const entreFilas = l.densidad === 'compacta' ? 'sm' : 'md'
  return (
    <Box flexDirection="column" gap="md">
      {cabecera(l, m)}
      {regla(l, m)}
      {sueltos.length > 0 ? (
        <Box flexDirection="column" gap={entreFilas}>
          {sueltos.map(a => fila(l, a))}
        </Box>
      ) : null}
      {deFlujo.map(g => (
        <Box flexDirection="column" gap={entreFilas}>
          {encabezadoFlujo(l, g.flujo)}
          {g.agentes.map(a => fila(l, a, 3))}
        </Box>
      ))}
      {m.cola.length > 0 ? (
        <Text size="footnote" color="inactive">
          {enCola(m)}
        </Text>
      ) : null}
    </Box>
  )
}

/**
 * Los agentes que caben en un lugar de un vistazo. Los que ya pasaron lo típico van primero (son los que
 * piden mirar), después los más antiguos; los que entran se dejan en su orden de inicio para que las
 * filas no salten.
 */
function elegirVisibles(agentes: readonly AgenteVista[], cabe: number): { visibles: AgenteVista[]; ocultos: AgenteVista[] } {
  const pasado = (a: AgenteVista) => a.estimacion.estado === 'pasado'
  const entran = new Set([...agentes.filter(pasado), ...agentes.filter(a => !pasado(a))].slice(0, cabe))
  return { visibles: agentes.filter(a => entran.has(a)), ocultos: agentes.filter(a => !entran.has(a)) }
}

/** El panel minimizado: lo mismo de un vistazo, sin franjas. */
function widgetGrafico(el: Tabla, m: ModeloVista, bordes: readonly string[]) {
  const { Box, Text } = el
  const Svg = el.Svg!
  const aLaDerecha = bordes.includes('right') && !bordes.includes('left')
  const lado = aLaDerecha ? 'flex-end' : 'flex-start'
  if (!hayTrabajo(m)) {
    return (
      <Box flexDirection="column" alignItems={lado}>
        <Text size="footnote" weight="semibold">
          Nada corriendo
        </Text>
        {m.ultima ? (
          <Text size="caption" color="inactive" wrap="truncate-end">{`Última tarea: ${m.ultima}`}</Text>
        ) : null}
      </Box>
    )
  }
  const { visibles, ocultos } = elegirVisibles(m.agentes, 6)
  const pasadosFuera = ocultos.filter(a => a.estimacion.estado === 'pasado').length
  const pie = [
    ocultos.length > 0
      ? `y ${ocultos.length} más${pasadosFuera > 0 ? ` (${pasadosFuera} ${pasadosFuera === 1 ? 'pasó' : 'pasaron'} lo típico)` : ''}`
      : '',
    m.cola.length ? `${m.cola.length} en cola` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="column" alignItems={lado}>
        {m.total.estado === 'rango' ? (
          <Text size="caption" color="inactive" wrap="truncate-end">
            Todo termina en
          </Text>
        ) : null}
        <Text size="heading" weight="semibold" tabular wrap="truncate-end">
          {m.total.estado === 'rango' ? rango(m.total.bajoMin, m.total.altoMin) : titular(m.total)}
          {m.total.estado === 'rango' && m.totalIncompleto ? (
            <Text size="caption" weight="regular" color="inactive">
              {' o más'}
            </Text>
          ) : null}
        </Text>
        {m.agentes.length === 0 ? (
          <Text size="caption" color="inactive" wrap="truncate-end">
            {cuantos(m)}
          </Text>
        ) : null}
      </Box>
      {visibles.length > 0 ? (
        <Box flexDirection="column">
          {visibles.map(a => (
            <Box flexDirection="row" gap={1} alignItems="center">
              <Box flexShrink={0}>
                <Svg source={svgLuna(a.estimacion, 12)} alt={altLuna(a.estimacion)} width={12} height={12} />
              </Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                {/* Una sola línea y sin el rol: aquí solo cabe lo que distingue al agente, su descripción. */}
                <Text size="footnote" wrap="truncate-end">
                  {nombres(a).titulo}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text
                  size="footnote"
                  weight={a.estimacion.estado === 'rango' ? 'semibold' : 'regular'}
                  color={a.estimacion.estado === 'calculando' ? 'inactive' : 'text'}
                  tabular
                  wrap="truncate"
                >
                  {a.estimacion.estado === 'pasado' ? 'pasó lo típico' : falta(a.estimacion)}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      {pie ? (
        <Text size="caption" color="inactive">
          {pie}
        </Text>
      ) : null}
    </Box>
  )
}

// ——— Terminal: lo mismo, en texto ———

type Tramo = { t: string; fuerte?: boolean; tenue?: boolean; color?: string }

function largo(s: string): number {
  return [...s].length
}

/** Una línea con un lado izquierdo que se corta y un lado derecho que nunca se corta, pegado al borde. */
function linea(el: Tabla, izquierda: Tramo[], derecha: Tramo[], cols: number) {
  const { Text } = el
  const anchoDerecha = derecha.reduce((s, t) => s + largo(t.t), 0)
  let libre = Math.max(0, cols - anchoDerecha - (anchoDerecha ? 2 : 0))
  const cabe: Tramo[] = []
  for (const tramo of izquierda) {
    if (libre <= 0) break
    const t = cortar(tramo.t, libre)
    cabe.push({ ...tramo, t })
    libre -= largo(t)
  }
  const usado = cabe.reduce((s, t) => s + largo(t.t), 0)
  const relleno = anchoDerecha ? ' '.repeat(Math.max(1, cols - usado - anchoDerecha)) : ''
  const pinta = (t: Tramo) =>
    t.fuerte || t.tenue || t.color ? (
      <Text weight={t.fuerte ? 'semibold' : undefined} dimColor={t.tenue || undefined} color={t.color}>
        {t.t}
      </Text>
    ) : (
      t.t
    )
  return (
    <Text wrap="truncate-end">
      {cabe.map(pinta)}
      {relleno}
      {derecha.map(pinta)}
    </Text>
  )
}

/**
 * La luna en un carácter: ○ ◔ ◑ ◕ ●; ◌ si aún se calcula. Si ya pasó lo típico sale de la escala: un «!»
 * (nunca un círculo más lleno, que se leería como a punto de terminar).
 */
function luna(e: Estimacion): string {
  if (e.estado === 'calculando') return '◌'
  if (e.estado === 'pasado') return '!'
  return '○◔◑◕●'[Math.min(4, Math.max(0, Math.round(e.progreso * 4)))]!
}

/** La luna de la terminal como tramo: el «!» del que pasó lo típico va fuerte y en el color de acento. */
function tramoLuna(e: Estimacion): Tramo {
  return e.estado === 'pasado' ? { t: luna(e), fuerte: true, color: 'claude' } : { t: luna(e) }
}

/** La franja en caracteres: una guía fina y el bloque, más denso mientras más firme el rango. */
function franjaTexto(e: Estimacion, escala: Eje | null, ancho: number): Tramo[] {
  if (ancho < 8) return []
  if (e.estado === 'pasado') return [{ t: '╶' + '┄'.repeat(ancho - 1), tenue: true }]
  if (e.estado === 'calculando' || !escala) return [{ t: '╶' + ' ·'.repeat(Math.floor((ancho - 1) / 2)), tenue: true }]
  const x = (min: number) => Math.round((Math.min(escala.hasta, Math.max(0, min)) / escala.hasta) * ancho)
  const fin = Math.max(1, x(e.altoMin))
  const desde = Math.min(x(e.bajoMin), fin - 1)
  const trazo = e.confianza === 'alta' ? '█' : e.confianza === 'media' ? '▓' : '▒'
  return [
    ...(desde > 0 ? [{ t: '╶' + '─'.repeat(desde - 1), tenue: true }] : []),
    { t: trazo.repeat(fin - desde), color: 'claude' },
  ]
}

/** Las marcas del eje puestas en su columna: «ahora      10        20        30 min». */
function reglaTexto(escala: Eje, ancho: number): string {
  const celdas = Array.from({ length: ancho }, () => ' ')
  const pon = (texto: string, en: number) => {
    const desde = Math.max(0, Math.min(ancho - largo(texto), en))
    if (celdas.slice(Math.max(0, desde - 1), desde + largo(texto) + 1).some(c => c !== ' ')) return
    ;[...texto].forEach((c, i) => (celdas[desde + i] = c))
  }
  const textos = rotulos(escala)
  pon('ahora', 0)
  pon(textos[textos.length - 1]!, ancho)
  escala.marcas.slice(0, -1).forEach((t, i) => pon(textos[i]!, Math.round((t / escala.hasta) * ancho)))
  return celdas.join('').trimEnd()
}

function filaTexto(el: Tabla, a: AgenteVista, escala: Eje | null, cols: number, densidad: Densidad, enFlujo = false) {
  const e = a.estimacion
  const { titulo, detalle } = nombres(a)
  // Los agentes de un workflow van un paso adentro; la franja no se mueve: sigue en el eje común.
  const margen = enFlujo ? '  ' : ''
  const sangria = `${margen}  `
  const datos = [fase(a), pasos(a)].filter((s): s is string => Boolean(s))
  const derecha: Tramo[] = [e.estado === 'rango' ? { t: falta(e), fuerte: true } : { t: falta(e), tenue: e.estado === 'calculando' }]
  const libre = cols - largo(falta(e)) - 2
  // El título es la descripción (lo que distingue al agente); el rol, en gris detrás, si cabe.
  const nombre: Tramo[] = [...(margen ? [{ t: margen }] : []), tramoLuna(e), { t: ' ' }, { t: titulo, fuerte: true }]
  const rol: Tramo[] = detalle ? [{ t: `  ${detalle}`, tenue: true }] : []
  // El rol es una pieza entera: entra si cabe junto al título sin cortarse; si no, se omite (nunca «implementa…»).
  // Con muchos agentes, todo en una línea si la fase cabe entera; si no, baja a la segunda. En esa línea
  // la descripción y la fase mandan: el rol entra solo si cabe también.
  const base = largo(sangria + titulo)
  const cabeElRol = (extra: number) => detalle !== undefined && base + 2 + largo(detalle) + extra <= libre
  const enUna = densidad === 'compacta' && base + 2 + largo(fase(a)) <= libre
  const primera = enUna
    ? [...nombre, ...(cabeElRol(2 + largo(fase(a))) ? rol : []), { t: `  ${[...datos, lleva(a)].join(' · ')}`, tenue: true }]
    : [...nombre, ...(cabeElRol(0) ? rol : [])]
  const segunda =
    densidad === 'compacta'
      ? linea(el, [{ t: sangria + [...datos, lleva(a)].join(' · '), tenue: true }], [], cols)
      : linea(el, [{ t: sangria + [...datos, a.modelo].filter(Boolean).join(' · ') }], [{ t: lleva(a), tenue: true }], cols)
  const paradas = camino(a)
  const recorrido = [paradas.length > 1 ? paradas.join(' → ') : '', a.lista?.actual ?? ''].filter(Boolean).join(': ')
  return [
    linea(el, primera, derecha, cols),
    ...(enUna ? [] : [segunda]),
    ...(densidad === 'amplia' && recorrido ? [linea(el, [{ t: sangria + recorrido, tenue: true }], [], cols)] : []),
    ...(densidad === 'amplia' && e.motivo ? [linea(el, [{ t: sangria + e.motivo, tenue: true }], [], cols)] : []),
    linea(el, [{ t: '  ' }, ...franjaTexto(e, escala, cols - 2)], [], cols),
  ]
}

function panelTexto(el: Tabla, m: ModeloVista, cols: number) {
  const { Box, Text } = el
  if (!hayTrabajo(m)) {
    return (
      <Box flexDirection="column">
        <Text weight="semibold">Nada corriendo</Text>
        {linea(el, [{ t: 'principal     ', tenue: true }, { t: m.principal }], [], cols)}
        {m.ultima ? linea(el, [{ t: 'última tarea  ', tenue: true }, { t: m.ultima }], [], cols) : null}
        {precision(m).map((p, i) => linea(el, [{ t: i === 0 ? 'precisión     ' : '              ', tenue: true }, { t: p }], [], cols))}
      </Box>
    )
  }
  const escala = eje(m)
  const compacta = densidad(m) === 'compacta'
  const { sueltos, deFlujo } = grupos(m)
  const filas = (agentes: AgenteVista[], enFlujo = false) =>
    agentes.map(a => <Box flexDirection="column">{filaTexto(el, a, escala, cols, densidad(m), enFlujo)}</Box>)
  const total: Tramo[] =
    m.total.estado === 'rango'
      ? [{ t: 'Todo termina en ' }, { t: falta(m.total), fuerte: true }, ...(m.totalIncompleto ? [{ t: ' o más' }] : [])]
      : [{ t: titular(m.total), fuerte: true }]
  return (
    <Box flexDirection="column" gap={compacta ? 0 : 1}>
      <Box flexDirection="column">
        {linea(el, total, [], cols)}
        {linea(el, [{ t: `${cuantos(m)} · principal: ${m.principal}`, tenue: true }], [], cols)}
        {gasto(m) ? linea(el, [{ t: `esta tarea: ${gasto(m)}`, tenue: true }], [], cols) : null}
      </Box>
      {escala ? linea(el, [{ t: `  ${reglaTexto(escala, cols - 2)}`, tenue: true }], [], cols) : null}
      {filas(sueltos)}
      {deFlujo.map(g => (
        <Box flexDirection="column" gap={compacta ? 0 : 1}>
          <Box flexDirection="column">
            {linea(el, [{ t: 'workflow ', tenue: true }, { t: g.flujo.nombre, fuerte: true }], [{ t: textoFlujo(g.flujo), tenue: true }], cols)}
            {g.flujo.fases.length ? linea(el, [{ t: g.flujo.fases.join(' → '), tenue: true }], [], cols) : null}
            {g.flujo.remoto ? linea(el, [{ t: NUBE, tenue: true }], [], cols) : null}
          </Box>
          {filas(g.agentes, true)}
        </Box>
      ))}
      {m.cola.length ? linea(el, [{ t: enCola(m), tenue: true }], [], cols) : null}
    </Box>
  )
}

// ——— Lo que llama el seguimiento ———

/**
 * Si un dato llega fuera del contrato y el dibujo revienta, el motor cierra el panel sin decir nada
 * a la vista. Mejor una línea que lo diga: el panel sigue abierto y el error queda a la vista.
 */
function conRespaldo($: EngineInterface, e: RenderInput<'Pane'> | RenderInput<'AbovePrompt'>, dibuja: () => RenderElement): RenderElement {
  try {
    return dibuja()
  } catch (error) {
    const { Text } = tabla($, e)
    return (
      <Text dimColor wrap="truncate-end">{`Cuánto falta: no se pudo dibujar (${error instanceof Error ? error.message : String(error)})`}</Text>
    )
  }
}

/** Lo que dice la línea, de más a menos palabras según el ancho. */
function textoBanda(m: ModeloVista, cols: number): { antes: string; cifra: string; despues: string; esCifra: boolean } {
  const t = m.total
  const unico = m.agentes.length === 1 && m.flujos.length === 0 ? m.agentes[0]! : undefined
  const quien = unico ? nombres(unico).titulo : cuantos(m)
  const despues = t.estado === 'rango' && m.totalIncompleto ? ' o más' : ''
  if (t.estado !== 'rango') {
    return { antes: `${quien} · `, cifra: t.estado === 'pasado' ? pasoLoTipico(t.tipicoMin) : 'calculando cuánto falta', despues: '', esCifra: false }
  }
  const cifra = rango(t.bajoMin, t.altoMin)
  const verbo = unico ? 'termina en ' : m.agentes.length > 1 ? 'el último termina en ' : 'termina en '
  const corto = cols < largo(quien) + 3 + largo(verbo) + largo(cifra) + largo(despues)
  return { antes: `${quien} · ${corto ? '' : verbo}`, cifra, despues: unico && !corto ? `${despues} · ${fase(unico)}` : despues, esCifra: true }
}

/** La línea sobre el prompt. Solo se llama cuando hay agentes o workflows corriendo. */
export function dibujarBanda($: EngineInterface, e: RenderInput<'AbovePrompt'>, m: ModeloVista, abrirPanel: () => void): RenderElement {
  return conRespaldo($, e, () => banda($, e, m, abrirPanel))
}

function banda($: EngineInterface, e: RenderInput<'AbovePrompt'>, m: ModeloVista, abrirPanel: () => void): RenderElement {
  const el = tabla($, e)
  const { Box, Text, Button, Svg } = el
  const cols = columnas(e, 80)
  const conSvg = !enTexto(e)
  const MAX = 12
  const visibles = m.agentes.slice(0, MAX)
  // Lo que queda para la frase, en caracteres: sin las lunas ni el botón. En una letra proporcional
  // (las superficies con Svg) un carácter ocupa cerca de 0,8 celdas. En la terminal el botón lleva una
  // flecha, para que no se lea pegado al final de la frase («o más ver detalle»).
  const BOTON = conSvg ? 'ver detalle' : '→ ver detalle'
  const libres = cols - visibles.length - largo(BOTON) - 3
  const dicho = textoBanda(m, conSvg ? Math.floor(libres / 0.8) : libres)
  const frase = (
    <Text dimColor wrap="truncate-end">
      {dicho.antes}
      {dicho.esCifra ? <Text weight="semibold">{dicho.cifra}</Text> : dicho.cifra}
      {dicho.despues}
    </Text>
  )
  if (conSvg) {
    const lunas = svgLunas(visibles, 12)
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        {visibles.length > 0 ? (
          <Box flexShrink={0}>
            <Svg
              source={lunas.fuente}
              alt={`${plural(visibles.length, 'agente', 'agentes')}: ${visibles.map(a => `${nombres(a).titulo} ${falta(a.estimacion)}`).join('; ')}`}
              width={lunas.ancho}
              height={12}
            />
          </Box>
        ) : null}
        <Box flexShrink={1} minWidth={0}>
          {frase}
        </Box>
        <Box flexShrink={0}>
          <Button key="ver" plain dimColor label={BOTON} onPress={abrirPanel} />
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="row" gap={1}>
      {visibles.length > 0 ? (
        <Text>
          {visibles.map(a => (a.estimacion.estado === 'pasado' ? <Text weight="semibold" color="claude">{luna(a.estimacion)}</Text> : luna(a.estimacion)))}
        </Text>
      ) : null}
      {frase}
      <Button key="ver" plain dimColor label={BOTON} onPress={abrirPanel} />
    </Box>
  )
}

/** El panel al costado (también en su forma de widget, e.props.placement === 'widget'). */
export function dibujarPanel($: EngineInterface, e: RenderInput<'Pane'>, m: ModeloVista): RenderElement {
  return conRespaldo($, e, () => {
    const el = tabla($, e)
    const esWidget = e.props.placement === 'widget'
    const cols = columnas(e, esWidget ? 32 : 48)
    if (enTexto(e)) return panelTexto(el, m, cols)
    if (esWidget) return widgetGrafico(el, m, e.props.anchoredEdges ?? [])
    return panelGrafico(el, m, cols)
  })
}
