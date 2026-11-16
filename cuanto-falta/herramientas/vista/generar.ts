// Vista previa de la vista del mod, fuera del motor: dibuja cada fixture con hooks/vista.tsx y lo
// pasa a HTML con las mismas reglas con que la app de escritorio pinta Box, Text, Button y Svg
// (leídas de la app instalada: Box → div flex, Text → span, Svg → <img> con el color y la letra del
// tema inyectados en la raíz). Es una aproximación para iterar el diseño; la revisión final es en
// la app real.
//
//   deno run --config herramientas/vista/deno.json --allow-read --allow-write herramientas/vista/generar.ts
//
// Deja en herramientas/vista/salida/ un HTML por fixture, superficie y tema, los Svg sueltos y las
// versiones de texto de la terminal. Las capturas (PNG) van en herramientas/vista/capturas/.
import { FIXTURES } from '../../hooks/vista.fixtures.ts'
import { dibujarBanda, dibujarPanel } from '../../hooks/vista.tsx'

type Nodo = { type: string; props: Record<string, unknown>; children: unknown[] }

// ——— Un motor de mentira: h, Fragment y la tabla de elementos ———

const pieza = (type: string) => (props: Record<string, unknown>) => {
  const { children, ...resto } = props ?? {}
  return { type, props: resto, children: (children as unknown[]) ?? [] }
}
const aplanar = (hijos: unknown[]): unknown[] =>
  hijos.flat(Infinity as 1).filter(c => c !== null && c !== undefined && c !== false && c !== true)

Object.assign(globalThis, {
  h: (tag: unknown, props: Record<string, unknown> | null, ...hijos: unknown[]) => {
    if (typeof tag !== 'function') throw new Error(`etiqueta sin tabla: ${String(tag)}`)
    return tag({ ...(props ?? {}), children: aplanar(hijos) })
  },
  Fragment: (props: { children?: unknown[] }) => pieza('Box')({ flexDirection: 'column', children: props.children ?? [] }),
})

const COMUNES = ['Box', 'Text', 'Button', 'Progress', 'Markdown', 'Link', 'Code', 'Input', 'Select', 'Client']
const TABLAS: Record<string, string[]> = { desktop: [...COMUNES, 'Svg'], terminal: [...COMUNES, 'Raster', 'Image'] }
const motor = {
  ui: {
    resolve: (e: { surface: string }) => Object.fromEntries(TABLAS[e.surface]!.map(t => [t, pieza(t)])),
  },
}

function panel(fixture: string, surface: 'desktop' | 'terminal', cols: number, placement = 'dock', anchoredEdges?: string[]): Nodo {
  const e = {
    surface,
    component: 'Pane',
    requestId: 'cuanto-falta',
    props: { title: 'Cuánto falta', isFocused: false, bodyColumns: cols, placement, anchoredEdges, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }
  // deno-lint-ignore no-explicit-any
  return dibujarPanel(motor as any, e as any, FIXTURES[fixture]!) as Nodo
}

function banda(fixture: string, surface: 'desktop' | 'terminal', cols: number): Nodo {
  const e = { surface, component: 'AbovePrompt', requestId: 'banda', props: { bodyColumns: cols, maxRows: 4, isWorking: true } }
  // deno-lint-ignore no-explicit-any
  return dibujarBanda(motor as any, e as any, FIXTURES[fixture]!, () => {}) as Nodo
}

// ——— De árbol a HTML, como lo pinta la app de escritorio ———

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

const TEMA: Record<string, string> = {
  text: 'var(--cds-text-primary)',
  inverseText: 'var(--cds-surface-0)',
  inactive: 'var(--cds-text-secondary)',
  subtle: 'var(--cds-text-muted)',
  claude: 'var(--cds-fill-brand)',
  suggestion: 'var(--cds-text-accent)',
  permission: 'var(--cds-text-accent)',
  success: 'var(--cds-text-success)',
  warning: 'var(--cds-text-warning)',
  error: 'var(--cds-text-danger)',
}
const color = (c: unknown): string | undefined => {
  if (typeof c !== 'string') return undefined
  if (TEMA[c]) return TEMA[c]
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) || /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)$/i.test(c) ? c : 'currentColor'
}
const PASOS = new Set(['xs', 'sm', 'md', 'lg', 'xl'])
const UNIDAD = 'var(--engine-row-unit,.5lh)'
function espacio(v: unknown, eje: 'across' | 'down', familia: 'gap' | 'pad'): string | undefined {
  if (typeof v === 'string' && PASOS.has(v)) return `var(--cds-${familia}-${v})`
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return eje === 'across' ? `${v}ch` : `calc(${v} * ${UNIDAD})`
}
function medida(v: unknown, unidad: string): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}${unidad}`
  return typeof v === 'string' && /^\d+(?:\.\d+)?%$/.test(v) ? v : undefined
}
const regla = (nombre: string, valor: string | number | undefined) => (valor === undefined ? undefined : `${nombre}:${valor}`)

function lados(p: Record<string, unknown>, que: 'margin' | 'padding'): (string | undefined)[] {
  const familia = que === 'margin' ? 'gap' : 'pad'
  const de = (sufijo: string, eje: 'across' | 'down') => espacio(p[`${que}${sufijo}`], eje, familia)
  const base = de('', 'down')
  return [
    base === undefined ? undefined : `${que}:${base} ${de('', 'across')}`,
    regla(`${que}-top`, de('Top', 'down') ?? de('Y', 'down')),
    regla(`${que}-bottom`, de('Bottom', 'down') ?? de('Y', 'down')),
    regla(`${que}-left`, de('Left', 'across') ?? de('X', 'across')),
    regla(`${que}-right`, de('Right', 'across') ?? de('X', 'across')),
  ]
}

function estiloBox(p: Record<string, unknown>): string {
  const gap = espacio(p.gap, 'down', 'gap')
  const borde = typeof p.borderStyle === 'string' && p.borderStyle !== ''
  return [
    'display:flex',
    'box-sizing:border-box',
    `flex-direction:${p.flexDirection ?? 'row'}`,
    regla('flex-grow', p.flexGrow as number),
    regla('flex-shrink', p.flexShrink as number),
    regla('flex-wrap', p.flexWrap as string),
    regla('align-items', p.alignItems as string),
    regla('align-self', p.alignSelf as string),
    regla('justify-content', p.justifyContent as string),
    gap === undefined ? undefined : `gap:${gap} ${espacio(p.gap, 'across', 'gap')}`,
    regla('column-gap', espacio(p.columnGap, 'across', 'gap')),
    regla('row-gap', espacio(p.rowGap, 'down', 'gap')),
    regla('width', medida(p.width, 'ch')),
    regla('height', medida(p.height, 'lh')),
    regla('min-width', medida(p.minWidth, 'ch')),
    regla('min-height', medida(p.minHeight, 'lh')),
    ...lados(p, 'margin'),
    borde ? 'padding:var(--cds-pad-md) var(--cds-pad-lg)' : undefined,
    ...lados(p, 'padding'),
    ...(borde ? ['border:1px solid var(--cds-border)', 'border-radius:calc(var(--cds-radius) + .25rem)'] : []),
    regla('background-color', color(p.backgroundColor) === 'currentColor' ? undefined : color(p.backgroundColor)),
    regla('overflow', p.overflow as string),
    p.display === 'none' ? 'display:none' : undefined,
  ]
    .filter(Boolean)
    .join(';')
}

const mezcla = (c: string) => `color-mix(in srgb,${c} 60%,transparent)`
function estiloText(p: Record<string, unknown>): string {
  const propio = color(p.color)
  const sinTinta = propio === 'currentColor' ? undefined : propio
  const tinta = p.dimColor === true ? (sinTinta === undefined ? 'var(--engine-dim-ink,var(--cds-text-secondary))' : mezcla(sinTinta)) : propio
  const peso = (p.weight as string | undefined) ?? (p.bold === true ? 'semibold' : undefined)
  const envuelve = p.wrap === undefined || p.wrap === 'wrap'
  return [
    regla('color', tinta),
    regla('--engine-dim-ink', sinTinta === undefined ? undefined : mezcla(sinTinta)),
    regla('background-color', color(p.backgroundColor) === 'currentColor' ? undefined : color(p.backgroundColor)),
    ...(typeof p.size === 'string'
      ? [`font-size:var(--cds-font-size-${p.size})`, `line-height:var(--cds-leading-${p.size})`, p.size === 'title' ? 'font-family:var(--cds-font-sans-display)' : undefined]
      : []),
    ...(peso ? [`font-weight:var(--cds-font-weight-${peso})`, `font-variation-settings:"wght" var(--cds-font-weight-${peso})`] : []),
    p.mono === true ? 'font-family:var(--cds-font-mono)' : undefined,
    p.tabular === true ? 'font-variant-numeric:tabular-nums' : undefined,
    p.italic === true ? 'font-style:italic' : undefined,
    p.underline === true ? 'text-decoration:underline' : undefined,
    ...(envuelve
      ? ['white-space:pre-wrap', 'overflow-wrap:anywhere']
      : ['display:inline-block', 'max-width:100%', 'white-space:pre', 'overflow:hidden', 'text-overflow:ellipsis', 'min-width:0']),
  ]
    .filter(Boolean)
    .join(';')
}

/** Como la app: le pone a la raíz del Svg la letra del sistema y el color del texto del tema. */
function conTinta(fuente: string, tinta: string): string {
  return fuente.replace('<svg ', `<svg font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" color="${tinta}" `)
}

const svgs: { nombre: string; fuente: string }[] = []
let serie = 0

function html(nodo: unknown, tinta: string, etiqueta: string): string {
  if (typeof nodo === 'string') return esc(nodo)
  if (typeof nodo === 'number') return String(nodo)
  const { type, props, children } = nodo as Nodo
  const hijos = () => children.map(c => html(c, tinta, etiqueta)).join('')
  if (type === 'Box') return `<div style="${esc(estiloBox(props))}">${hijos()}</div>`
  if (type === 'Text') return `<span style="${esc(estiloText(props))}">${hijos()}</span>`
  if (type === 'Button') return `<button class="boton${props.plain ? ' plano' : ''}">${esc(String(props.label ?? ''))}${hijos()}</button>`
  if (type === 'Svg') {
    const fuente = String(props.source)
    svgs.push({ nombre: `${etiqueta}-${String(++serie).padStart(2, '0')}.svg`, fuente })
    const estilo = ['display:block', 'max-width:100%', 'border:0', regla('width', `${props.width}px`), regla('height', `${props.height}px`)].join(';')
    return `<img draggable="false" alt="${esc(String(props.alt))}" style="${estilo}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(conTinta(fuente, tinta))}">`
  }
  throw new Error(`la vista previa no sabe pintar ${type}`)
}

/** El árbol de la terminal en texto plano (sin colores): para leer cómo queda en una fuente de ancho fijo. */
function texto(nodo: unknown): string {
  if (typeof nodo === 'string') return nodo
  if (typeof nodo === 'number') return String(nodo)
  const { type, props, children } = nodo as Nodo
  if (type === 'Text') return children.map(texto).join('')
  if (type === 'Button') return props.plain ? String(props.label) : `[ ${String(props.label)} ]`
  if (type === 'Box') {
    const partes = children.map(texto)
    if ((props.flexDirection ?? 'row') === 'row') return partes.join(' '.repeat(typeof props.gap === 'number' ? props.gap : 0))
    return partes.join('\n' + '\n'.repeat(typeof props.gap === 'number' ? props.gap : 0))
  }
  return ''
}

// ——— Los colores y la letra de la app (tema claro y oscuro, densidad por defecto) ———

const TOKENS = `
:root{--cds-font-system:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--cds-font-sans:"Anthropic Sans",var(--cds-font-system);
--cds-font-sans-display:var(--cds-font-sans);--cds-font-mono:"SF Mono",ui-monospace,Menlo,monospace;
--cds-font-weight-regular:400;--cds-font-weight-medium:500;--cds-font-weight-semibold:580;--cds-font-weight-bold:600;
--cds-font-size-caption:.6875rem;--cds-font-size-footnote:.75rem;--cds-font-size-body:.8125rem;--cds-font-size-heading:.875rem;--cds-font-size-title:1.25rem;
--cds-leading-caption:1.0625rem;--cds-leading-footnote:.9375rem;--cds-leading-body:1.1875rem;--cds-leading-heading:1.125rem;--cds-leading-title:1.5625rem;
--cds-pad-xs:.25rem;--cds-pad-sm:.375rem;--cds-pad-md:.5rem;--cds-pad-lg:.75rem;--cds-pad-xl:1.25rem;
--cds-gap-xs:.375rem;--cds-gap-sm:.5rem;--cds-gap-md:.75rem;--cds-gap-lg:1.25rem;--cds-gap-xl:2rem;--cds-radius:.375rem;
--cds-fill-brand:#c6613f}
.claro{--cds-surface-0:#f9f9f7;--cds-surface-1:#fcfcfb;--cds-surface-2:#fff;--cds-text-primary:#0b0b0b;--cds-text-secondary:#52514e;--cds-text-muted:#898781;
--cds-border:rgb(11 11 11/10%);--cds-text-accent:#184f95;--cds-text-success:#1c7a36;--cds-text-warning:#8a6100;--cds-text-danger:#b3261e}
.oscuro{--cds-surface-0:#0b0b0b;--cds-surface-1:#151515;--cds-surface-2:#1a1a19;--cds-text-primary:#f0efec;--cds-text-secondary:#c3c2b7;--cds-text-muted:#898781;
--cds-border:rgb(255 255 255/10%);--cds-text-accent:#6da7ec;--cds-text-success:#4cc26b;--cds-text-warning:#e5b93c;--cds-text-danger:#ff8a80}
@font-face{font-family:"Anthropic Sans";src:url("../fuente/AnthropicSans-Romans-Variable-25x258.ttf");font-weight:300 800}
html,body{margin:0}
body{font-family:var(--cds-font-sans);font-size:var(--cds-font-size-body);line-height:var(--cds-leading-body);-webkit-font-smoothing:antialiased}
.lamina{display:flex;gap:24px;padding:24px;align-items:flex-start;width:max-content}
.tema{background:var(--cds-surface-0);color:var(--cds-text-primary);padding:20px;border-radius:14px;display:flex;flex-direction:column;gap:16px}
.marco{background:var(--cds-surface-2);border:1px solid var(--cds-border);border-radius:12px;overflow:hidden;box-sizing:border-box}
.titulo{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--cds-border);font-size:var(--cds-font-size-footnote);line-height:var(--cds-leading-footnote);color:var(--cds-text-secondary)}
.cuerpo{padding:12px}
.widget{border-radius:10px}.widget .cuerpo{padding:10px 12px}
.banda{padding:6px 12px;background:var(--cds-surface-1);border:1px solid var(--cds-border);border-radius:10px;box-sizing:border-box}
.rotulo{font:500 11px/1.4 var(--cds-font-system);color:var(--cds-text-muted);letter-spacing:.02em}
.boton{font:inherit;font-size:var(--cds-font-size-footnote);line-height:var(--cds-leading-footnote);color:var(--cds-text-secondary);background:transparent;border:1px solid var(--cds-border);border-radius:var(--cds-radius);padding:2px 8px;white-space:nowrap}
.boton.plano{border-color:transparent;padding:2px 4px;text-decoration:underline;text-decoration-color:var(--cds-border);text-underline-offset:3px}
pre.terminal{margin:0;font:12px/1.35 "SF Mono",ui-monospace,Menlo,monospace;background:#161616;color:#e6e4dd;padding:14px 16px;border-radius:10px;white-space:pre}
`

const TINTA = { claro: '#0b0b0b', oscuro: '#f0efec' } as const
/** Ancho de una celda del cuerpo (1ch de Anthropic Sans a 13 px), medido en el navegador. */
const CELDA = 7.85
/** Relleno del cuerpo del panel en esta aproximación. */
const RELLENO = 12

function marco(titulo: string, ancho: number, cuerpo: string, clase = ''): string {
  return `<div class="marco ${clase}" style="width:${ancho}px"><div class="titulo"><span>${esc(titulo)}</span><span>×</span></div><div class="cuerpo">${cuerpo}</div></div>`
}

function pagina(cuerpo: string): string {
  return `<!doctype html><meta charset="utf-8"><title>cuanto-falta · vista previa</title><style>${TOKENS}</style><body>${cuerpo}</body>`
}

const ANCHOS = [320, 400, 480]
const salida = new URL('./salida/', import.meta.url)
await Deno.mkdir(salida, { recursive: true })
for await (const viejo of Deno.readDir(salida)) await Deno.remove(new URL(viejo.name, salida))
const escribe = (nombre: string, contenido: string) => Deno.writeTextFile(new URL(nombre, salida), contenido)

const indice: string[] = []
for (const fixture of Object.keys(FIXTURES)) {
  const corre = FIXTURES[fixture]!.agentes.length + FIXTURES[fixture]!.flujos.length > 0
  // Una lámina por ancho, con el tema claro y el oscuro lado a lado: panel, panel minimizado y línea.
  for (const ancho of ANCHOS) {
    const cols = Math.floor((ancho - 2 * RELLENO - 2) / CELDA)
    const temas = (['claro', 'oscuro'] as const).map(tema => {
      const etiqueta = `${fixture}-${ancho}`
      const guarda = tema === 'claro' ? etiqueta : `${etiqueta}-x`
      const elPanel = marco('Cuánto falta', ancho, html(panel(fixture, 'desktop', cols), TINTA[tema], guarda))
      const colsWidget = Math.floor((260 - 26) / CELDA)
      const elWidget = marco('Cuánto falta', 260, html(panel(fixture, 'desktop', colsWidget, 'widget', ['bottom', 'right']), TINTA[tema], `${guarda}-widget`), 'widget')
      const laBanda = corre ? `<div class="banda" style="width:${Math.max(ancho, 400) + 160}px">${html(banda(fixture, 'desktop', Math.floor((Math.max(ancho, 400) + 136) / CELDA)), TINTA[tema], `${guarda}-banda`)}</div>` : ''
      return `<div class="tema ${tema}" id="${tema}"><div class="rotulo">panel · ${ancho} px · ${tema}</div><div class="panel">${elPanel}</div>${
        ancho === 400 ? `<div class="rotulo">panel minimizado</div><div class="mini">${elWidget}</div>${laBanda ? `<div class="rotulo">línea sobre el prompt</div><div class="linea">${laBanda}</div>` : ''}` : ''
      }</div>`
    })
    await escribe(`${fixture}-${ancho}.html`, pagina(`<div class="lamina">${temas.join('')}</div>`))
    indice.push(`${fixture}-${ancho}.html`)
  }
  // La terminal, en texto: el panel a 60 y a 44 columnas, y la línea.
  const term = [60, 44]
    .map(c => `── panel · ${c} columnas ──\n${texto(panel(fixture, 'terminal', c))}`)
    .concat(corre ? [`── línea sobre el prompt ──\n${texto(banda(fixture, 'terminal', 100))}`, `── línea, angosta ──\n${texto(banda(fixture, 'terminal', 48))}`] : [])
    .join('\n\n')
  await escribe(`${fixture}-terminal.txt`, term + '\n')
  await escribe(`${fixture}-terminal.html`, pagina(`<div class="lamina"><pre class="terminal">${esc(term)}</pre></div>`))
}
for (const s of svgs.filter(s => !s.nombre.includes('-x'))) await escribe(s.nombre, conTinta(s.fuente, TINTA.claro))
await escribe('index.html', pagina(`<div style="padding:24px;font-size:14px;line-height:2">${indice.map(n => `<a href="${n}">${n}</a>`).join('<br>')}</div>`))
console.log(`listo: ${indice.length} láminas, ${svgs.filter(s => !s.nombre.includes('-x')).length} svg, en ${salida.pathname}`)
