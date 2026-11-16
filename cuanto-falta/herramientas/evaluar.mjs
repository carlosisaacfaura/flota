// Evalúa el estimador como corre en vivo: repite cada corrida del período de prueba con una foto cada 30 s,
// arma la EntradaEstimador de ese momento (fase.ts del mod, vía dataset.mjs), estima con estimar.ts del mod
// y compara con lo que de verdad faltaba. Holdout temporal: tablas con lo anterior al corte (y la elección
// del silencio, dentro de ese entrenamiento). Una corrida = un turno: cada reanudación es otra.
//
//   node herramientas/evaluar.mjs                    → holdout 9–16 nov en markdown (para EVALUACION.md)
//   node herramientas/evaluar.mjs --resumen          → evaluación móvil de 3 ventanas, una línea por ventana
//   node herramientas/evaluar.mjs --resumen --roles --confianza   → además, por rol y por confianza
//   node herramientas/evaluar.mjs --retraso 0        → el informe visto en el último resultado (sin retraso)
//   node herramientas/evaluar.mjs --modo fase        → otra variante (ver OPCIONES en tablas.mjs)
//   node herramientas/evaluar.mjs --fresco           → relee los transcripts (si cambió fase.ts)
import './resolver.mjs'
import path from 'node:path'
import { RAIZ_MOD, corridasEnCache, entradaEn } from './dataset.mjs'
import { OPCIONES, construirTablas, cuantil } from './tablas.mjs'

const { estimarCon } = await import(path.join(RAIZ_MOD, 'hooks', 'estimar.ts'))

const arg = (nombre, defecto) => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : defecto
}
const CORTE = Date.parse(arg('corte', '2026-11-09T00:00:00-03:00'))
const FIN = Date.parse(arg('fin', '2026-11-17T00:00:00-03:00'))
const FOTO = 0.5 // min
const REMUESTREOS = Number(arg('remuestreos', 200))

const ROLES = ['implementador', 'investigador', 'revisor', 'revisor-critico', 'verificador', 'mecanico', 'general-purpose']
const grupoRol = c => (c.reanudacion ? 'reanudaciones' : ROLES.includes(c.rol) ? c.rol : 'otros')

// ——— Con qué retraso ve el mod el informe ———
// En vivo se detecta cuando ya salieron 200 caracteres de texto: mediana ~11 s y p90 ~39 s después del
// último resultado (medido). Aquí, un retraso log-normal con esa mediana y ese p90, fijo por corrida.
const RETRASO = arg('retraso', 'vivo')
const SIGMA = Math.log(39 / 11) / 1.2816
function normalDe(c) {
  // dos uniformes deterministas a partir de la corrida (Box–Muller)
  let h = 2166136261
  for (const ch of `${c.inicio}|${c.dur}|${c.rol}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  const u1 = ((h & 0xffff) + 1) / 65537
  const u2 = ((h >>> 16) + 1) / 65537
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
function retrasoDe(c) {
  if (RETRASO === 'vivo') return (11 / 60) * Math.exp(SIGMA * normalDe(c))
  return Number(RETRASO) / 60
}

// ——— La línea base: 0.1.0 (commit d1dea91), igual que corría ———

const PUNTO_DE_PARTIDA = {
  implementador: { p50: 30.4, p90: 50.6, pasos: 93 },
  investigador: { p50: 12.1, p90: 22.7, pasos: 47 },
  revisor: { p50: 14.1, p90: 23.7, pasos: 47 },
  'revisor-critico': { p50: 12.3, p90: 16.4, pasos: 13 },
  verificador: { p50: 5.3, p90: 13.0, pasos: 11 },
  auditor: { p50: 8.5, p90: 12.4, pasos: 25 },
  'auditor-producto': { p50: 7.5, p90: 11.9, pasos: 22 },
  'general-purpose': { p50: 11.0, p90: 15.2, pasos: 37 },
  'workflow-subagent': { p50: 7.7, p90: 14.9, pasos: 14 },
}
function cuantilSimple(valores, q) {
  if (!valores.length) return 0
  const xs = [...valores].sort((a, b) => a - b)
  const pos = (xs.length - 1) * q
  const b = Math.floor(pos)
  const a = Math.ceil(pos)
  return xs[b] + (xs[a] - xs[b]) * (pos - b)
}
/** calcularStats de 0.1.0: el punto de partida pesa como 10 corridas; se mezclan las últimas 200 propias. */
function stats010(historial) {
  const tipos = new Set([...Object.keys(PUNTO_DE_PARTIDA), ...Object.keys(historial)])
  const g = PUNTO_DE_PARTIDA['general-purpose']
  const salida = {}
  for (const tipo of tipos) {
    const previo = PUNTO_DE_PARTIDA[tipo] ?? g
    const m = (historial[tipo] ?? []).slice(-200)
    const n = m.length
    const w = n / (n + 10)
    const p50 = n ? (1 - w) * previo.p50 + w * cuantilSimple(m.map(x => x[0]), 0.5) : previo.p50
    const p90 = n ? (1 - w) * previo.p90 + w * cuantilSimple(m.map(x => x[0]), 0.9) : previo.p90
    const pasos = n ? (1 - w) * previo.pasos + w * cuantilSimple(m.map(x => x[1]), 0.5) : previo.pasos
    salida[tipo] = { p50: Math.max(0.5, p50), p90: Math.max(p50 * 1.1, p90), pasos: Math.max(1, pasos) }
  }
  return salida
}
/**
 * El historial que la 0.1.0 habría tenido: las corridas iniciales que terminaron bien (no aprendía de las
 * reanudaciones, `aprende: !e.resume`), con la duración de su turno, en orden.
 */
function historial010(entreno) {
  const h = {}
  for (const c of entreno) if (!c.reanudacion) (h[c.rol] ??= []).push([c.dur, c.llamadas])
  return h
}
function base010(stats) {
  return e => {
    const s = stats[e.rol] ?? stats['general-purpose']
    const progreso = Math.max(e.llevaMin / s.p50, s.pasos > 0 ? e.llamadas / s.pasos : 0)
    const eq = progreso * s.p50
    const falta50 = Math.max(0, s.p50 - eq)
    const falta90 = Math.max(0, s.p90 - eq)
    if (eq >= s.p90) return { estado: 'pasado' }
    // "faltan ~a–b" en lo normal; "ya pasó lo típico · hasta ~b" pasado el p50
    if (eq >= s.p50) return { estado: 'rango', bajoMin: 0, medioMin: falta90 / 2, altoMin: falta90, confianza: 'baja' }
    return { estado: 'rango', bajoMin: falta50, medioMin: falta50, altoMin: falta90, confianza: 'baja' }
  }
}

// ——— Repetir corridas ———

function fotos(corridas, estimador) {
  const regs = []
  for (const c of corridas) {
    const n = Math.max(1, Math.ceil(c.dur / FOTO))
    const retrasoInforme = retrasoDe(c)
    for (let i = 0; i < n; i++) {
      const s = i * FOTO
      if (s >= c.dur) break
      const e = entradaEn(c, s, { retrasoInforme })
      const est = estimador(e)
      const real = c.dur - s
      const tramo = s / c.dur < 1 / 3 ? 0 : s / c.dur < 2 / 3 ? 1 : 2
      regs.push({ c, s, rol: grupoRol(c), tramo, real, est, fase: e.fase })
    }
  }
  // Cada corrida pesa lo mismo dentro de cada tramo, sea larga o corta.
  const cuenta = new Map()
  for (const r of regs) {
    const x = cuenta.get(r.c) ?? [0, 0, 0]
    x[r.tramo]++
    cuenta.set(r.c, x)
  }
  for (const r of regs) r.w = 1 / cuenta.get(r.c)[r.tramo]
  return regs
}

const dentro = r => r.real >= r.est.bajoMin - 1e-9 && r.real <= r.est.altoMin + 1e-9

function medidas(regs) {
  const w = regs.reduce((s, r) => s + r.w, 0)
  const rango = regs.filter(r => r.est.estado === 'rango')
  const wr = rango.reduce((s, r) => s + r.w, 0)
  const err = rango.map(r => [Math.abs(r.est.medioMin - r.real), r.w]).sort((a, b) => a[0] - b[0])
  // Error como fracción de lo que de verdad duró la corrida.
  const errRel = rango.map(r => [Math.abs(r.est.medioMin - r.real) / Math.max(1, r.c.dur), r.w]).sort((a, b) => a[0] - b[0])
  const ancho = rango.map(r => [r.est.altoMin - r.est.bajoMin, r.w]).sort((a, b) => a[0] - b[0])
  const cubre = rango.reduce((s, r) => s + (dentro(r) ? r.w : 0), 0)
  const antes = rango.reduce((s, r) => s + (r.real < r.est.bajoMin - 1e-9 ? r.w : 0), 0)
  return {
    corridas: new Set(regs.map(r => r.c)).size,
    error: err.length ? cuantil(err, 0.5) : NaN,
    errorRel: errRel.length ? cuantil(errRel, 0.5) : NaN,
    cobertura: wr ? cubre / wr : NaN,
    antes: wr ? antes / wr : NaN,
    ancho: ancho.length ? cuantil(ancho, 0.5) : NaN,
    calculando: w ? regs.filter(r => r.est.estado === 'calculando').reduce((s, r) => s + r.w, 0) / w : NaN,
    pasado: w ? regs.filter(r => r.est.estado === 'pasado').reduce((s, r) => s + r.w, 0) / w : NaN,
    peso: w,
  }
}

/**
 * Intervalo del 95% del error mediano y de la cobertura por remuestreo de corridas (se sortean corridas con
 * reemplazo; cada una entra con todas sus fotos). Determinista.
 */
function intervalos(regs) {
  const rango = regs.filter(r => r.est.estado === 'rango')
  const corridas = [...new Set(rango.map(r => r.c))]
  if (corridas.length < 5) return { error: [NaN, NaN], cobertura: [NaN, NaN] }
  const idx = new Map(corridas.map((c, i) => [c, i]))
  const xs = rango.map(r => ({ i: idx.get(r.c), w: r.w, e: Math.abs(r.est.medioMin - r.real), d: dentro(r) ? 1 : 0 })).sort((a, b) => a.e - b.e)
  let semilla = 7
  const azar = () => ((semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  const errs = []
  const cobs = []
  const m = new Float64Array(corridas.length)
  for (let b = 0; b < REMUESTREOS; b++) {
    m.fill(0)
    for (let k = 0; k < corridas.length; k++) m[Math.floor(azar() * corridas.length)]++
    let total = 0
    let cub = 0
    for (const x of xs) {
      total += x.w * m[x.i]
      cub += x.w * m[x.i] * x.d
    }
    let acum = 0
    let mediana = NaN
    for (const x of xs) {
      acum += x.w * m[x.i]
      if (acum >= total / 2) {
        mediana = x.e
        break
      }
    }
    errs.push(mediana)
    cobs.push(total ? cub / total : NaN)
  }
  const ic = v => {
    const s = v.filter(Number.isFinite).sort((a, b) => a - b)
    return [s[Math.floor(s.length * 0.025)], s[Math.min(s.length - 1, Math.floor(s.length * 0.975))]]
  }
  return { error: ic(errs), cobertura: ic(cobs) }
}

const f1 = x => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '–')
const pc = x => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–')
const conIc = (x, [a, b], fmt) => (Number.isFinite(x) ? `${fmt(x)} (${fmt(a)}–${fmt(b)})` : '–')

/**
 * Por rol y método, con el intervalo del 95% en el error y la cobertura de cada tercio. "Error en comunes"
 * compara solo las fotos donde todos los métodos dieron un rango: la 0.1.0 no da número en sus fotos
 * 'pasado' (las difíciles), así que su error mediano a secas sale favorecido.
 */
function tabla(metodos, { ic = true } = {}) {
  const filas = [
    '| Rol | Método | Corridas | Error mediano (min), 1º / 2º / 3º tercio | Error en comunes | Cobertura, 1º / 2º / 3º tercio | Ancho | Calc. | Pasado |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  const clave = r => `${r.c.inicio}|${r.c.dur}|${r.s}`
  const conRango = metodos.map(([, regs]) => new Set(regs.filter(r => r.est.estado === 'rango').map(clave)))
  const comun = r => conRango.every(s => s.has(clave(r)))
  for (const rol of [...ROLES, 'otros', 'reanudaciones', 'todos']) {
    for (const [nombre, regs] of metodos) {
      const sel = rol === 'todos' ? regs : regs.filter(r => r.rol === rol)
      if (!sel.length) continue
      const porTercio = [0, 1, 2].map(k => sel.filter(r => r.tramo === k))
      const t = porTercio.map(medidas)
      const tic = porTercio.map(x => (ic ? intervalos(x) : { error: [NaN, NaN], cobertura: [NaN, NaN] }))
      const tc = [0, 1, 2].map(k => medidas(sel.filter(r => r.tramo === k && comun(r))))
      const m = medidas(sel)
      const err = t.map((x, k) => (ic ? conIc(x.error, tic[k].error, f1) : f1(x.error))).join(' / ')
      const cob = t.map((x, k) => (ic ? conIc(x.cobertura, tic[k].cobertura, pc) : pc(x.cobertura))).join(' / ')
      filas.push(`| ${rol} | ${nombre} | ${m.corridas} | ${err} | ${tc.map(x => f1(x.error)).join(' / ')} | ${cob} | ${f1(m.ancho)} | ${pc(m.calculando)} | ${pc(m.pasado)} |`)
    }
  }
  return filas.join('\n')
}

function tablaConfianza(regs) {
  const filas = ['| Confianza | Fotos | Cobertura | Error mediano (min) | Error / duración real | Ancho mediano (min) |', '|---|---|---|---|---|---|']
  const total = regs.filter(r => r.est.estado === 'rango').reduce((s, r) => s + r.w, 0)
  for (const c of ['alta', 'media', 'baja']) {
    const sel = regs.filter(r => r.est.estado === 'rango' && r.est.confianza === c)
    if (!sel.length) continue
    const m = medidas(sel)
    filas.push(`| ${c} | ${pc(m.peso / total)} | ${pc(m.cobertura)} | ${f1(m.error)} | ${pc(m.errorRel)} | ${f1(m.ancho)} |`)
  }
  return filas.join('\n')
}

function tablaFase(regs) {
  const filas = ['| Fase | Fotos | Cobertura | Error mediano (min) | Ancho mediano (min) |', '|---|---|---|---|---|']
  const total = regs.reduce((s, r) => s + r.w, 0)
  for (const f of [...new Set(regs.map(r => r.fase))].sort()) {
    const m = medidas(regs.filter(r => r.fase === f))
    filas.push(`| ${f} | ${pc(m.peso / total)} | ${pc(m.cobertura)} | ${f1(m.error)} | ${f1(m.ancho)} |`)
  }
  return filas.join('\n')
}

/** Las fotos donde decidió el silencio, contra la misma foto estimada sin él. */
function tablaSilencio(regs, tablas) {
  const sel = regs.filter(r => r.est.estado === 'rango' && r.est.motivo.includes('el cierre'))
  if (!sel.length) return '(el silencio no decidió ninguna foto)'
  const filas = ['| Rol | Corridas | Fotos | Error con silencio | Error sin silencio | Cobertura con / sin |', '|---|---|---|---|---|---|']
  for (const rol of [...new Set(sel.map(r => r.rol))].sort()) {
    const xs = sel.filter(r => r.rol === rol)
    const sin = xs.map(r => ({ ...r, est: estimarCon(tablas, { ...entradaEn(r.c, r.s, { retrasoInforme: retrasoDe(r.c) }), silencioMin: undefined }) })).filter(r => r.est.estado === 'rango')
    const a = medidas(xs)
    const b = medidas(sin)
    filas.push(`| ${rol} | ${a.corridas} | ${xs.length} | ${f1(a.error)} | ${f1(b.error)} | ${pc(a.cobertura)} / ${pc(b.cobertura)} |`)
  }
  return filas.join('\n')
}

export function resumenGlobal(regs) {
  const m = medidas(regs)
  const t = [0, 1, 2].map(k => medidas(regs.filter(r => r.tramo === k)))
  return { ...m, tercios: t.map(x => ({ error: x.error, cobertura: x.cobertura, antes: x.antes })) }
}

/** Las ventanas de la evaluación móvil: entrena con todo lo anterior a cada corte, prueba los 15 días siguientes. */
const VENTANAS = ['2026-10-10', '2026-10-25', '2026-11-09'].map(d => {
  const corte = Date.parse(`${d}T00:00:00-03:00`)
  return { corte, fin: Math.min(corte + 15 * 86_400_000, Date.parse('2026-11-17T00:00:00-03:00')) }
})

/** Repite una ventana: tablas con lo anterior al corte; 0.2 y las dos líneas base sobre las corridas de prueba. */
export function evaluarVentana(corridas, corte, fin, opciones) {
  const entreno = corridas.filter(c => c.inicio < corte)
  const prueba = corridas.filter(c => c.inicio >= corte && c.inicio < fin)
  let silencioElegido = {}
  const tablas = construirTablas(entreno, { ...opciones, alElegirSilencio: (_d, e) => (silencioElegido = e) })
  const t0 = performance.now()
  const nuevo = fotos(prueba, e => estimarCon(tablas, e))
  const ms = (performance.now() - t0) / Math.max(1, nuevo.length)
  return {
    entreno,
    prueba,
    ms,
    tablas,
    silencioElegido,
    metodos: [
      ['0.2', nuevo],
      ['0.1.0 tal cual', fotos(prueba, base010(stats010({})))],
      ['0.1.0 con historial', fotos(prueba, base010(stats010(historial010(entreno))))],
    ],
  }
}

function lineaResumen(etiqueta, regs, base) {
  const g = resumenGlobal(regs)
  const b = resumenGlobal(base)
  return `${etiqueta} base err ${f1(b.error)} cob ${pc(b.cobertura)} | err ${f1(g.error)} (${g.tercios.map(x => f1(x.error)).join('/')}) cob ${pc(g.cobertura)} (${g.tercios.map(x => pc(x.cobertura)).join('/')}) antes ${g.tercios.map(x => pc(x.antes)).join('/')} ancho ${f1(g.ancho)} calc ${pc(g.calculando)} pas ${pc(g.pasado)}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const corridas = corridasEnCache({ fresco: process.argv.includes('--fresco') })
  const opciones = { ...OPCIONES }
  if (arg('modo')) opciones.modoEtapa = arg('modo')
  if (arg('vida')) opciones.vidaDias = Number(arg('vida'))
  if (arg('minimo')) opciones.minimo = Number(arg('minimo'))
  if (arg('minimoGrupo')) opciones.minimoGrupo = Number(arg('minimoGrupo'))
  if (arg('ensanche')) opciones.ensanche = arg('ensanche').split(',').map(Number)
  if (arg('umbrales')) opciones.confianza = JSON.parse(arg('umbrales'))
  if (process.argv.includes('--sin-silencio')) opciones.silencio = {}
  const etiqueta = `${JSON.stringify(opciones.modoEtapa)} vida=${opciones.vidaDias} min=${opciones.minimo} ens=${opciones.ensanche} retraso=${RETRASO}${opciones.silencio === 'validar' ? '' : ' sin-silencio'}`
  const dia = ms => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10) // hora de Chile (UTC−3)
  if (process.argv.includes('--resumen')) {
    const juntas = [[], [], []]
    for (const v of VENTANAS) {
      const r = evaluarVentana(corridas, v.corte, v.fin, opciones)
      console.log(lineaResumen(`${dia(v.corte).slice(5)} n=${r.prueba.length} ${etiqueta}`, r.metodos[0][1], r.metodos[2][1]), JSON.stringify(r.silencioElegido))
      r.metodos.forEach(([, regs], i) => juntas[i].push(...regs))
    }
    console.log(lineaResumen(`juntas ${etiqueta}`, juntas[0], juntas[2]))
    if (process.argv.includes('--roles')) console.log(tabla([['0.2', juntas[0]], ['0.1.0 tal cual', juntas[1]], ['0.1.0 con historial', juntas[2]]], { ic: process.argv.includes('--ic') }))
    if (process.argv.includes('--confianza')) console.log(tablaConfianza(juntas[0]))
    process.exit(0)
  }
  const r = evaluarVentana(corridas, CORTE, FIN, opciones)
  const nuevo = r.metodos[0][1]
  const re = r.prueba.filter(c => c.reanudacion).length
  console.log(`Entrenamiento: ${r.entreno.length} corridas hasta el ${dia(CORTE - 1)}. Prueba: ${r.prueba.length} corridas (${re} reanudaciones) del ${dia(CORTE)} al ${dia(FIN - 1)}, ${nuevo.length} fotos (cada ${FOTO * 60} s). Informe con retraso ${RETRASO}. ${r.ms.toFixed(3)} ms por estimación. Silencio elegido en el entrenamiento: ${JSON.stringify(r.silencioElegido)}.\n`)
  console.log(tabla(r.metodos))
  console.log('\n**Confianza (0.2):**\n')
  console.log(tablaConfianza(nuevo))
  console.log('\n**Por fase (0.2):**\n')
  console.log(tablaFase(nuevo))
  console.log('\n**Donde decidió el silencio (0.2):**\n')
  console.log(tablaSilencio(nuevo, r.tablas))
}
