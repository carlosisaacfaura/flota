// Genera hooks/tablas.ts desde los transcripts reales de subagentes. Un comando, determinista:
//
//   node herramientas/tablas.mjs              → relee ~/.claude/projects y escribe hooks/tablas.ts
//   node herramientas/tablas.mjs --cache      → usa datos/corridas.jsonl en vez de releer
//
// La fecha del encabezado es la de la corrida más reciente (no la de hoy): mismos transcripts, mismo archivo.
// Las tablas llevan solo números y nombres de rol y modelo.
import './resolver.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAIZ_MOD, corridasEnCache, entradaEn, inicioInforme, leerCorridas, silencios } from './dataset.mjs'

const { estimarCon, etapaDe, normalizarModelo, REANUDA, TODOS } = await import(path.join(RAIZ_MOD, 'hooks', 'estimar.ts'))

/** Lo que se eligió en la evaluación (herramientas/EVALUACION.md). */
export const OPCIONES = {
  /** Etapa con que se separan las celdas: llamadas hechas sobre las típicas del rol, y si ya editó, probó
   *  o hizo commit (ver etapaDe). Con pocas muestras retrocede a solo llamadas y luego a todas. */
  modoEtapa: 'llamadas+progreso',
  /** Vida media del peso de una corrida, en días: lo reciente pesa más (los modelos cambian). */
  vidaDias: 30,
  /** Mínimo de corridas por celda. */
  minimo: 20,
  /** Un grupo rol+modelo existe con al menos tantas corridas. */
  minimoGrupo: 30,
  rejilla: [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 23, 26, 30, 34, 38, 43, 48, 54, 60, 70, 80, 90, 105, 120, 140, 160, 180, 210, 240, 300],
  rejillaInforme: [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8],
  /** El mod ve el informe cuando ya salieron 200 caracteres de texto: ~11 s después del último resultado
   *  (mediana medida). Las tablas del informe cuentan desde ahí. */
  retrasoInforme: 11 / 60,
  rejillaSilencio: [0, 0.15, 0.3, 0.6, 1, 1.5, 2, 3, 4, 6, 8],
  /** Silencio: 'validar' elige por rol si se usa y desde cuántos minutos, con una validación dentro de las
   *  corridas que recibe (ajusta con el 75% más antiguo y decide con el 25% más reciente). Un objeto
   *  `{ rol: desde }` lo fija; `{}` lo apaga. */
  silencio: 'validar',
  silencioCandidatos: [0.3, 0.6, 1],
  cuantiles: [0.1, 0.5, 0.9],
  /** Ensancha el rango hacia abajo y hacia arriba en escala logarítmica ([1, 1] = los cuantiles tal cual).
   *  Calibrado con las ventanas de octubre para una cobertura de ~80%; noviembre quedó como prueba limpia. */
  ensanche: [1.7, 1],
  /** Alta: celda propia del rol y modelo, ≥ altaN corridas y un rango de a lo más altaAncho × la duración. */
  confianza: { altaN: 40, altaAncho: 0.9, mediaN: 25, mediaAncho: 1.4 },
}

const DIA = 86_400_000

/** Cuantil ponderado con interpolación entre muestras. `xs` son pares [valor, peso] ya ordenados. */
export function cuantil(xs, q) {
  const total = xs.reduce((s, x) => s + x[1], 0)
  if (!xs.length || !total) return 0
  // Cada muestra ocupa el centro de su peso acumulado; entre centros, interpolación lineal.
  let acum = 0
  let prevPos = -Infinity
  let prevV = xs[0][0]
  for (const [v, w] of xs) {
    const pos = (acum + w / 2) / total
    if (q <= pos) return prevPos === -Infinity ? v : prevV + ((v - prevV) * (q - prevPos)) / (pos - prevPos || 1)
    acum += w
    prevPos = pos
    prevV = v
  }
  return xs[xs.length - 1][0]
}

const r1 = x => Math.round(x * 10) / 10

function celda(muestras, o) {
  if (muestras.length < o.minimo) return 0
  const xs = [...muestras].sort((a, b) => a[0] - b[0])
  return [muestras.length, ...o.cuantiles.map(q => r1(cuantil(xs, q)))]
}

/** Como celda, pero las muestras son [valor, peso, corrida] y el mínimo cuenta corridas distintas. */
function celdaRuns(muestras, o) {
  const n = new Set(muestras.map(x => x[2])).size
  if (n < o.minimo) return 0
  const xs = muestras.map(x => [x[0], x[1]]).sort((a, b) => a[0] - b[0])
  return [n, ...o.cuantiles.map(q => r1(cuantil(xs, q)))]
}

/**
 * Para qué roles sirve el silencio y desde cuántos minutos, sin mirar nada fuera de `corridas`: arma tablas
 * con el 75% más antiguo y prueba en el 25% más reciente, en las fotos (cada 30 s) pasada la duración
 * típica, sin informe visible y con al menos ese silencio. Se usa donde baja el error mediano al menos un
 * 10% sin perder más de 5 puntos de cobertura, con al menos 15 corridas de validación.
 */
export function elegirSilencio(corridas, o) {
  const orden = [...corridas].sort((a, b) => a.inicio - b.inicio)
  const corte = Math.floor(orden.length * 0.75)
  const ajuste = orden.slice(0, corte)
  const valida = orden.slice(corte)
  const roles = [...new Set(valida.map(rolTabla))].sort()
  const mejor = {}
  const detalle = []
  for (const u of o.silencioCandidatos) {
    const t = construirTablas(ajuste, { ...o, silencio: Object.fromEntries(roles.map(r => [r, u])) })
    for (const r of roles) {
      const g = t.grupos[r]
      if (!g || !t.silencio[r]) continue
      const fotos = []
      let corridasVal = 0
      for (const c of valida) {
        if (rolTabla(c) !== r) continue
        const propias = []
        for (let s = 0; s < c.dur; s += 0.5) {
          if (s < g.tipico) continue
          const e = entradaEn(c, s, { retrasoInforme: o.retrasoInforme })
          if (e.fase === 'informe' || e.silencioMin === undefined || e.silencioMin < u) continue
          const con = estimarCon(t, e)
          const sin = estimarCon(t, { ...e, silencioMin: undefined })
          if (con.estado !== 'rango' || sin.estado !== 'rango' || !con.motivo.includes('el cierre')) continue
          const real = c.dur - s
          propias.push([Math.abs(con.medioMin - real), Math.abs(sin.medioMin - real), real >= con.bajoMin && real <= con.altoMin, real >= sin.bajoMin && real <= sin.altoMin])
        }
        if (!propias.length) continue
        corridasVal++
        for (const x of propias) fotos.push([...x, 1 / propias.length])
      }
      if (corridasVal < 15) continue
      const med = i => cuantil(fotos.map(x => [x[i], x[4]]).sort((a, b) => a[0] - b[0]), 0.5)
      const cob = i => fotos.reduce((s, x) => s + (x[i] ? x[4] : 0), 0) / fotos.reduce((s, x) => s + x[4], 0)
      const [errCon, errSin, cobCon, cobSin] = [med(0), med(1), cob(2), cob(3)]
      detalle.push({ rol: r, desde: u, corridas: corridasVal, errCon, errSin, cobCon, cobSin })
      if (errCon <= 0.9 * errSin && cobCon >= cobSin - 0.05 && (!mejor[r] || errCon < mejor[r].err)) mejor[r] = { desde: u, err: errCon }
    }
  }
  const elegido = Object.fromEntries(Object.entries(mejor).map(([r, m]) => [r, m.desde]))
  if (o.alElegirSilencio) o.alElegirSilencio(detalle, elegido)
  return elegido
}

/** Las tablas de una corrida: su rol (o `rol#r` si es una reanudación), con su modelo, y en las reanudaciones
 *  también las de todos los agentes (`*#r`), porque fuera del implementador hay pocas. */
export function rolTabla(c) {
  return c.reanudacion ? `${c.rol}${REANUDA}` : c.rol
}

function clavesDe(c) {
  const modelo = normalizarModelo(c.modelo)
  const rol = rolTabla(c)
  return [modelo ? `${rol}|${modelo}` : null, rol, c.reanudacion ? `${TODOS}${REANUDA}` : null].filter(Boolean)
}

/** Las tablas a partir de unas corridas (la evaluación las arma con las de entrenamiento). */
export function construirTablas(corridas, opciones = {}) {
  const o = { ...OPCIONES, ...opciones }
  if (o.silencio === 'validar') o.silencio = elegirSilencio(corridas, o)
  const ref = Math.max(...corridas.map(c => c.inicio))
  const peso = c => (o.vidaDias ? Math.pow(0.5, (ref - c.inicio) / (o.vidaDias * DIA)) : 1)
  const porClave = new Map()
  for (const c of corridas) for (const k of clavesDe(c)) (porClave.get(k) ?? porClave.set(k, []).get(k)).push(c)
  const grupos = {}
  const informe = {}
  const silencio = {}
  // Llamadas típicas por rol: la etapa 'llamadas' compara contra las del rol en todos sus grupos.
  const tipicasRol = {}
  for (const [clave, cs] of porClave) if (!clave.includes('|')) tipicasRol[clave] = cuantil(cs.map(c => [c.llamadas, 1]).sort((a, b) => a[0] - b[0]), 0.5)
  for (const [clave, cs] of [...porClave.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const especifica = clave.includes('|')
    if (cs.length < (especifica ? o.minimoGrupo : o.minimo)) continue
    const durs = cs.map(c => [c.dur, peso(c)]).sort((a, b) => a[0] - b[0])
    const vivos = o.rejilla.map(g => cs.filter(c => c.dur > g).length)
    const porEtapa = {}
    o.rejilla.forEach((g, k) => {
      for (const c of cs) {
        if (c.dur <= g) continue
        const e = entradaEn(c, g, { retrasoInforme: o.retrasoInforme })
        const falta = c.dur - g
        const w = peso(c)
        const et0 = e.fase === 'informe' ? TODOS : etapaDe(o.modoEtapa, e.fase, e.vistas, e.llamadas, tipicasRol[c.rol])
        const etapas = [...new Set([et0, o.modoEtapa === 'llamadas+progreso' ? et0.split('-')[0] : et0, TODOS])]
        for (const et of etapas) {
          const fila = (porEtapa[et] ??= o.rejilla.map(() => []))
          fila[k].push([falta, w])
        }
      }
    })
    const etapas = {}
    for (const [et, filas] of Object.entries(porEtapa).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const fila = filas.map(m => celda(m, o))
      // sin ninguna celda útil, la etapa no se guarda; y se recortan los ceros del final
      while (fila.length && fila[fila.length - 1] === 0) fila.pop()
      if (fila.some(x => x !== 0)) etapas[et] = fila
    }
    const tipico = r1(cuantil(durs, 0.5))
    grupos[clave] = { n: cs.length, tipico, ...(especifica ? {} : { llamadas: Math.round(tipicasRol[clave]) }), vivos: trimCeros(vivos), etapas }
    // El informe: lo que faltaba desde que el mod lo ve.
    const filas = o.rejillaInforme.map(() => [])
    for (const c of cs) {
      const t0 = inicioInforme(c, o.retrasoInforme)
      if (t0 === null) continue
      const largo = c.dur - t0
      o.rejillaInforme.forEach((d, k) => {
        if (largo > d || (k === 0 && largo >= 0)) filas[k].push([Math.max(0, largo - d), peso(c)])
      })
    }
    const fila = filas.map(m => celda(m, o))
    while (fila.length && fila[fila.length - 1] === 0) fila.pop()
    if (fila.some(x => x !== 0)) informe[clave] = fila
    // El silencio, solo en los roles elegidos: pasada la duración típica y antes de que se vea el informe.
    const desde = especifica ? undefined : o.silencio?.[clave]
    if (desde !== undefined) {
      const porPunto = o.rejillaSilencio.map(() => [])
      for (const c of cs) {
        const fin = inicioInforme(c, o.retrasoInforme) ?? c.dur
        const muestras = o.rejillaSilencio.map(() => [])
        for (const [a, b] of silencios(c)) {
          o.rejillaSilencio.forEach((g, k) => {
            const s = a + g
            if (s < b && s < fin && s >= tipico) muestras[k].push(c.dur - s)
          })
        }
        // Cada corrida pesa lo mismo en cada punto, tenga uno o varios silencios así de largos.
        muestras.forEach((m, k) => m.forEach(v => porPunto[k].push([v, peso(c) / m.length, c])))
      }
      const celdas = porPunto.map(m => celdaRuns(m, o))
      while (celdas.length && celdas[celdas.length - 1] === 0) celdas.pop()
      if (celdas.some(x => x !== 0)) silencio[clave] = { desde, celdas }
    }
  }
  const hasta = new Date(ref).toISOString().slice(0, 10)
  return {
    version: 1,
    hasta,
    corridas: corridas.length,
    modoEtapa: o.modoEtapa,
    rejilla: o.rejilla,
    rejillaInforme: o.rejillaInforme,
    grupos,
    informe,
    rejillaSilencio: o.rejillaSilencio,
    silencio,
    minimo: o.minimo,
    ensanche: o.ensanche,
    confianza: o.confianza,
  }
}

function trimCeros(xs) {
  const ys = [...xs]
  while (ys.length && ys[ys.length - 1] === 0) ys.pop()
  return ys
}

/** El archivo hooks/tablas.ts: compacto, una línea por grupo. */
export function escribirTablasTs(t) {
  const json = v => JSON.stringify(v)
  const grupos = Object.entries(t.grupos)
    .map(([k, g]) => {
      const etapas = Object.entries(g.etapas).map(([e, f]) => `      ${json(e)}: ${json(f)},`).join('\n')
      return `    ${json(k)}: {\n      n: ${g.n}, tipico: ${g.tipico},${g.llamadas !== undefined ? ` llamadas: ${g.llamadas},` : ''} vivos: ${json(g.vivos)}, etapas: {\n${etapas.replace(/^ {6}/gm, '        ')}\n      },\n    },`
    })
    .join('\n')
  const informe = Object.entries(t.informe).map(([k, f]) => `    ${json(k)}: ${json(f)},`).join('\n')
  const silencio = Object.entries(t.silencio ?? {}).map(([k, s]) => `    ${json(k)}: { desde: ${s.desde}, celdas: ${json(s.celdas)} },`).join('\n')
  return `// Generado por herramientas/tablas.mjs: no se edita a mano. Para regenerar: node herramientas/tablas.mjs
// ${t.corridas} corridas reales de subagentes, hasta el ${t.hasta}. Solo números y nombres de rol y modelo.
// Celda: [corridas, faltaban p10, p50, p90] en minutos, en cada punto de \`rejilla\` (minutos que llevaba).
// Las claves \`rol#r\` son reanudaciones. \`silencio\`: solo los roles donde se comprobó en el entrenamiento.
import type { Tablas } from './estimar'

export const TABLAS: Tablas = {
  version: ${t.version},
  hasta: ${json(t.hasta)},
  corridas: ${t.corridas},
  modoEtapa: ${json(t.modoEtapa)},
  rejilla: ${json(t.rejilla)},
  rejillaInforme: ${json(t.rejillaInforme)},
  minimo: ${t.minimo},
  ensanche: ${JSON.stringify(t.ensanche)},
  confianza: ${json(t.confianza).replace(/"(\w+)":/g, '$1: ')},
  grupos: {
${grupos}
  },
  informe: {
${informe}
  },
  rejillaSilencio: ${json(t.rejillaSilencio ?? [])},
  silencio: {
${silencio}
  },
}
`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const corridas = process.argv.includes('--cache') ? corridasEnCache() : leerCorridas()
  const t = construirTablas(corridas)
  const destino = path.join(RAIZ_MOD, 'hooks', 'tablas.ts')
  const texto = escribirTablasTs(t)
  fs.writeFileSync(destino, texto)
  console.log(`${t.corridas} corridas hasta el ${t.hasta}: ${Object.keys(t.grupos).length} grupos, ${(Buffer.byteLength(texto) / 1024).toFixed(1)} KB → hooks/tablas.ts`)
}
