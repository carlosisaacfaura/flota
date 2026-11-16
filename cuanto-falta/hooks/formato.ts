// Formato de cifras para la interfaz: frases cortas y sin falsa precisión.
// Dueño: la pieza de la vista. Las demás piezas solo importan estas funciones.

/** Redondea minutos estimados: exacto bajo 15, de a 5 hasta 1 h, de a media hora después. */
export function redondear(min: number): number {
  if (min < 15) return Math.round(min)
  if (min < 60) return Math.round(min / 5) * 5
  return Math.round(min / 30) * 30
}

function horas(min: number): string {
  const h = Math.round(min / 30) / 2
  return String(h).replace('.', ',')
}

/** "~12–25 min", "~40 min–1,5 h", "~1–2 h", "hasta ~5 min", "<1 min". */
export function rango(desde: number, hasta: number): string {
  const a = redondear(desde)
  const b = Math.max(a, redondear(hasta))
  if (b < 1) return '<1 min'
  if (a < 1) return b < 60 ? `hasta ~${b} min` : `hasta ~${horas(b)} h`
  if (b < 60) return a === b ? `~${a} min` : `~${a}–${b} min`
  if (a < 60) return `~${a} min–${horas(b)} h`
  return horas(a) === horas(b) ? `~${horas(a)} h` : `~${horas(a)}–${horas(b)} h`
}

/** Tiempo ya transcurrido (medido, no estimado): "<1 min", "12 min", "1 h 5 min". */
export function duracion(min: number): string {
  if (min < 1) return '<1 min'
  const m = Math.floor(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  return resto ? `${h} h ${resto} min` : `${h} h`
}

export function porcentaje(p: number): string {
  if (p < 0.1) return '<0,1%'
  return `${p.toFixed(1).replace('.', ',')}%`
}

export function dolares(usd: number): string {
  return `US$ ${usd.toFixed(2).replace('.', ',')}`
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

/** "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5"; desconocido → undefined. */
export function modeloLegible(id: string | undefined): string | undefined {
  if (!id) return undefined
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?(?:\[|$)/i.exec(id.replace(/^claude-/, ''))
  if (!m) return undefined
  const nombre = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  return m[3] ? `${nombre} ${m[2]}.${m[3]}` : `${nombre} ${m[2]}`
}

// ——— Lo que usa la vista (nuevo en la 0.2) ———

/** Lo típico de una corrida, como una sola cifra: "~25 min", "~1,5 h". */
export function tipico(min: number): string {
  return rango(min, min)
}

/** Fuera de todo lo visto: se dice tal cual, sin inventar cuánto falta. "ya pasó lo típico (~25 min)". */
export function pasoLoTipico(tipicoMin: number): string {
  return `ya pasó lo típico (${tipico(tipicoMin)})`
}

/** Una marca de un eje de tiempo: "10", y con unidad "10 min"; desde una hora, siempre "1 h", "1,5 h". */
export function marca(min: number, conUnidad: boolean): string {
  if (min >= 60) return `${horas(min)} h`
  return conUnidad ? `${min} min` : String(min)
}

/** Una fracción de 0 a 1 como porcentaje entero: 0.81 → "81%". */
export function fraccion(f: number): string {
  const p = Math.round(Math.min(1, Math.max(0, f)) * 100)
  return `${p}%`
}

/** Tipos repetidos, contados y en el orden en que aparecen: ["a", "b", "a"] → "a ×2, b". */
export function contar(tipos: readonly string[]): string {
  const cuenta = new Map<string, number>()
  for (const t of tipos) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  return [...cuenta].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')
}

/** Corta un texto a `largo` caracteres con puntos suspensivos; nunca deja menos de un carácter. */
export function cortar(texto: string, largo: number): string {
  if (largo <= 0) return ''
  const letras = [...texto]
  if (letras.length <= largo) return texto
  if (largo === 1) return '…'
  return `${letras.slice(0, largo - 1).join('').trimEnd()}…`
}

const NOMBRES_ROL: Record<string, string> = {
  mecanico: 'mecánico',
  'revisor-critico': 'revisor crítico',
  'auditor-producto': 'auditor de producto',
  'general-purpose': 'agente',
  'workflow-subagent': 'agente del workflow',
  fork: 'copia',
  Explore: 'explorador',
  Plan: 'planificador',
  'claude-code-guide': 'guía de Claude Code',
}

/** Nombre del rol para mostrar: "revisor-critico" → "revisor crítico", "plugin:scan-verifier" → "scan verifier". */
export function nombreRol(rol: string): string {
  const propio = NOMBRES_ROL[rol]
  if (propio) return propio
  const corto = rol.includes(':') ? rol.slice(rol.lastIndexOf(':') + 1) : rol
  return corto.replace(/[-_]+/g, ' ')
}
