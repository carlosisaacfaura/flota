import { expect, test } from 'claude-code/testing'

import type { EntradaEstimador, EstadoLista, Estimacion, Fase } from './contrato'
import { estimar, estimarCon, MAS_ALLA } from './estimar'
import type { Tablas } from './estimar'
import { actualizarLista, clasificar, resumirLista } from './fase'
import { TABLAS } from './tablas'

const bash = (command: string) => clasificar('Bash', { command })

// ——— clasificar: comandos Bash reales, tal como los escriben los agentes ———

test('las pruebas, el typecheck y los builds son "probando"', async () => {
  for (const c of [
    'cd /Users/x/proyecto && pnpm test 2>&1 | tail -20',
    'cd "/Users/x/a b" && pnpm --filter @ace/brain test -- --run',
    'pnpm typecheck',
    'npx vitest run src/estado.test.ts',
    'pytest -x tests/',
    '.venv/bin/python -m pytest -q',
    'uv run pytest -q',
    'npx tsc --noEmit -p apps/face',
    'xcodebuild test -project App.xcodeproj -scheme App -destination "platform=macOS"',
    'timeout 600 pnpm build',
    'swift test --filter Puente',
    'make test',
    'claude plugin test .',
    'rm -rf .next && pnpm build',
    '(cd apps/face && pnpm build) 2>&1 | tail -5',
    'until curl -s localhost:3000 >/dev/null; do sleep 1; done',
    'curl -s http://127.0.0.1:8790/salud',
    'node scripts/correr.mjs',
    'bash -c "pnpm test"',
  ]) {
    expect([c, bash(c)]).toEqual([c, 'probando'])
  }
})

test('git commit, push y gh pr create son "commit", aunque antes corran pruebas', async () => {
  expect(bash('git add -A && git commit -m "fix: arregla las pruebas de pytest"')).toBe('commit')
  expect(bash('pnpm test && git commit -am wip')).toBe('commit')
  expect(bash('git push origin main')).toBe('commit')
  expect(bash('gh pr create --title "x" --body "y"')).toBe('commit')
})

test('lo que escribe archivos es "editando": sed -i, heredoc a archivo, mv, scripts que escriben', async () => {
  expect(bash("sed -i '' 's/viejo/nuevo/' hooks/fase.ts")).toBe('editando')
  expect(bash("perl -pi -e 's/a/b/' x.txt")).toBe('editando')
  // El cuerpo del heredoc nunca se lee como comando: "pytest" ahí dentro no corre pruebas.
  expect(bash("cat > /tmp/prueba.py <<'EOF'\nimport pytest\nprint('hola')\nEOF")).toBe('editando')
  expect(bash("python3 - <<'EOF'\np='a.ts'\ns=open(p).read()\ns=s.replace('a','b')\nopen(p,'w').write(s)\nEOF")).toBe('editando')
  expect(bash('echo "listo" > notas.txt')).toBe('editando')
  expect(bash('mv a.ts b.ts')).toBe('editando')
  expect(bash('git checkout -- hooks/fase.ts')).toBe('editando')
})

test('leer con Bash es "leyendo": cat, sed -n, grep, git diff/log/status, scripts que solo leen', async () => {
  for (const c of [
    'cat package.json',
    'sed -n 1,80p hooks/register.tsx',
    'grep -rn "pytest" src | head',
    'rg -n "estimar" hooks/',
    'git diff HEAD~1 -- hooks/',
    'git -C /x log --oneline | head -5',
    'git status --short',
    'ls -la && wc -l hooks/*.ts',
    'find . -name "*.ts" | xargs grep -l foo',
    'for f in a.ts b.ts; do sed -n 1,5p $f; done',
    "python3 - <<'EOF'\nimport json\nprint(json.load(open('x.json'))['a'])\nEOF",
    'node -e "console.log(require(\'./package.json\').version)"',
    'sqlite3 datos.db "SELECT count(*) FROM corridas"',
  ]) {
    expect([c, bash(c)]).toEqual([c, 'leyendo'])
  }
})

test('la web y la pantalla tienen su fase', async () => {
  expect(bash('curl -sL https://docs.example.com/api')).toBe('investigando')
  expect(bash('xcrun simctl io booted screenshot /tmp/s.png')).toBe('navegando')
  expect(bash('screencapture -x /tmp/pantalla.png')).toBe('navegando')
  expect(clasificar('WebSearch', { query: 'x' })).toBe('investigando')
  expect(clasificar('WebFetch', { url: 'https://x' })).toBe('investigando')
  expect(clasificar('mcp__Claude_Browser__navigate', { url: 'http://localhost:3000' })).toBe('navegando')
  expect(clasificar('mcp__XcodeBuildMCP__build_sim', {})).toBe('probando')
})

test('herramientas propias: leer, editar, delegar, entregar', async () => {
  expect(clasificar('Read', { file_path: '/x' })).toBe('leyendo')
  expect(clasificar('Grep', { pattern: 'x' })).toBe('leyendo')
  expect(clasificar('Edit', {})).toBe('editando')
  expect(clasificar('Write', {})).toBe('editando')
  expect(clasificar('Agent', {})).toBe('delegando')
  expect(clasificar('Workflow', {})).toBe('delegando')
  // Los agentes de un workflow terminan entregando su resultado.
  expect(clasificar('StructuredOutput', {})).toBe('informe')
})

test('lo que no dice nada de la fase devuelve null (se mantiene la anterior)', async () => {
  for (const c of ['sleep 30', 'echo hola', 'pnpm install', 'mkdir -p /tmp/x', 'true', 'cd /x', 'cat <<EOF\nhola\nEOF']) {
    expect([c, bash(c)]).toEqual([c, null])
  }
  expect(clasificar('ToolSearch', { query: 'select:Read' })).toBeNull()
  expect(clasificar('TodoWrite', { todos: [] })).toBeNull()
  expect(clasificar('mcp__ccd_turn__update_plan', {})).toBeNull()
  expect(clasificar('Bash', null)).toBeNull()
  expect(clasificar('Bash', { command: 5 })).toBeNull()
  expect(clasificar('', {})).toBeNull()
})

// ——— La lista de pasos ———

test('TodoWrite reemplaza la lista entera', async () => {
  const lista = actualizarLista(undefined, 'TodoWrite', {
    todos: [
      { content: 'Leer el código', status: 'completed', activeForm: 'Leyendo el código' },
      { content: 'Escribir la prueba', status: 'in_progress', activeForm: 'Escribiendo la prueba' },
      { content: 'Correr la suite', status: 'pending', activeForm: 'Corriendo la suite' },
    ],
  }, { oldTodos: [], newTodos: [] })
  expect(resumirLista(lista)).toEqual({ hechos: 1, total: 3, actual: 'Escribir la prueba' })
  const despues = actualizarLista(lista, 'TodoWrite', {
    todos: [
      { content: 'Leer el código', status: 'completed', activeForm: '' },
      { content: 'Escribir la prueba', status: 'completed', activeForm: '' },
    ],
  }, undefined)
  expect(resumirLista(despues)).toEqual({ hechos: 2, total: 2 })
  expect(actualizarLista(lista, 'TodoWrite', { todos: [] }, undefined)).toBeUndefined()
})

test('TaskCreate toma el id del resultado (estructurado o texto) y TaskUpdate lo avanza', async () => {
  let lista: EstadoLista | undefined
  lista = actualizarLista(lista, 'TaskCreate', { subject: 'Explorar', description: 'x' }, { task: { id: '7', subject: 'Explorar' } })
  lista = actualizarLista(lista, 'TaskCreate', { subject: 'Implementar', description: 'x' }, 'Task #8 created successfully: Implementar')
  lista = actualizarLista(lista, 'TaskCreate', { subject: 'Probar', description: 'x' }, [{ type: 'text', text: 'Task #9 created successfully: Probar' }])
  expect(Object.keys(lista ?? {}).sort()).toEqual(['7', '8', '9'])
  expect(resumirLista(lista)).toEqual({ hechos: 0, total: 3 })
  lista = actualizarLista(lista, 'TaskUpdate', { taskId: '7', status: 'in_progress' }, { success: true, taskId: '7', updatedFields: ['status'] })
  expect(resumirLista(lista)).toEqual({ hechos: 0, total: 3, actual: 'Explorar' })
  lista = actualizarLista(lista, 'TaskUpdate', { taskId: '7', status: 'completed' }, { success: true, taskId: '7', updatedFields: ['status'] })
  lista = actualizarLista(lista, 'TaskUpdate', { taskId: '8', status: 'in_progress' }, 'Updated task #8 status')
  expect(resumirLista(lista)).toEqual({ hechos: 1, total: 3, actual: 'Implementar' })
  // Un cambio fallido no cuenta; uno borrado sale de la lista.
  const igual = actualizarLista(lista, 'TaskUpdate', { taskId: '9', status: 'completed' }, { success: false, taskId: '9', updatedFields: [], error: 'x' })
  expect(igual).toBe(lista)
  lista = actualizarLista(lista, 'TaskUpdate', { taskId: '9', status: 'deleted' }, { success: true, taskId: '9', updatedFields: ['status'] })
  expect(resumirLista(lista)).toEqual({ hechos: 1, total: 2, actual: 'Implementar' })
})

test('TaskCreate sin id legible usa el siguiente número; otra herramienta no toca la lista', async () => {
  let lista = actualizarLista(undefined, 'TaskCreate', { subject: 'Uno' }, undefined)
  lista = actualizarLista(lista, 'TaskCreate', { subject: 'Dos' }, 'creada')
  expect(Object.keys(lista ?? {})).toEqual(['1', '2'])
  const previa = lista
  const congelada = JSON.stringify(previa)
  expect(actualizarLista(previa, 'Read', { file_path: '/x' }, 'texto')).toBe(previa)
  actualizarLista(previa, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
  expect(JSON.stringify(previa)).toBe(congelada) // nunca muta la lista anterior
  expect(resumirLista(undefined)).toBeUndefined()
  expect(resumirLista({})).toBeUndefined()
})

// ——— estimar: invariantes con las tablas reales ———

function entrada(p: Partial<EntradaEstimador>): EntradaEstimador {
  return { rol: 'implementador', modelo: 'claude-opus-5-5', llevaMin: 10, llamadas: 40, fase: 'editando', faseDesdeMin: 1, vistas: ['leyendo', 'editando'], inicioAprox: false, ...p }
}

function rango(e: Estimacion) {
  if (e.estado !== 'rango') throw new Error(`esperaba un rango y vino ${e.estado}: ${e.motivo}`)
  return e
}

test('las tablas están generadas y respaldadas por corridas reales', async () => {
  expect(TABLAS.corridas).toBeGreaterThan(1000)
  expect(TABLAS.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(Object.keys(TABLAS.grupos)).toContain('implementador')
})

test('en todo lo que se puede pedir: bajo ≤ medio ≤ alto, progreso entre 0 y 1, nunca NaN', async () => {
  const roles = ['implementador', 'investigador', 'revisor', 'revisor-critico', 'verificador', 'mecanico', 'general-purpose', 'workflow-subagent', 'Explore']
  const modelos = [undefined, 'claude-opus-5-5', 'claude-sonnet-5-5[1m]', 'claude-fable-5-2', 'claude-haiku-5-5']
  const fases: Fase[] = ['arrancando', 'leyendo', 'investigando', 'editando', 'probando', 'navegando', 'commit', 'delegando', 'informe']
  let rangos = 0
  for (const rol of roles)
    for (const modelo of modelos)
      for (const llevaMin of [0, 0.4, 2, 7.5, 25, 61, 130, 400])
        for (const fase of fases) {
          const e = estimar(entrada({ rol, modelo, llevaMin, llamadas: Math.round(llevaMin * 4), fase, faseDesdeMin: Math.min(llevaMin, 2), vistas: fase === 'arrancando' ? [] : ['leyendo', fase] }))
          expect(e.motivo.length).toBeGreaterThan(0)
          if (e.estado === 'rango') {
            rangos++
            for (const x of [e.bajoMin, e.medioMin, e.altoMin, e.progreso]) expect(Number.isFinite(x)).toBe(true)
            expect(e.bajoMin).toBeGreaterThanOrEqual(0)
            expect(e.bajoMin).toBeLessThanOrEqual(e.medioMin)
            expect(e.medioMin).toBeLessThanOrEqual(e.altoMin)
            expect(e.progreso).toBeGreaterThanOrEqual(0)
            expect(e.progreso).toBeLessThanOrEqual(1)
            expect(['alta', 'media', 'baja']).toContain(e.confianza)
          } else if (e.estado === 'pasado') {
            expect(e.tipicoMin).toBeGreaterThan(0)
          }
        }
  expect(rangos).toBeGreaterThan(1000)
})

test('sin historial del rol: calculando, nunca un número', async () => {
  const e = estimar(entrada({ rol: 'un-rol-que-no-existe' }))
  expect(e.estado).toBe('calculando')
  expect(e.motivo).toMatch(/sin historial/)
  const vacias: Tablas = { ...TABLAS, grupos: {}, informe: {} }
  expect(estimarCon(vacias, entrada({})).estado).toBe('calculando')
})

test('muy lejos de lo visto para su rol: pasado, con lo típico', async () => {
  const e = estimar(entrada({ rol: 'verificador', modelo: 'claude-fable-5-2', llevaMin: 900, llamadas: 300, fase: 'leyendo' }))
  expect(e.estado).toBe('pasado')
  if (e.estado === 'pasado') {
    expect(e.tipicoMin).toBeGreaterThan(1)
    expect(e.tipicoMin).toBeLessThan(60)
  }
  // Y no antes: a lo que todavía dura una buena parte de sus corridas, le da un rango.
  const g = TABLAS.grupos['verificador']!
  const k = g.vivos.findIndex(v => v / g.n < 0.5)
  expect(g.vivos[k]! / g.n).toBeGreaterThan(MAS_ALLA)
  expect(estimar(entrada({ rol: 'verificador', modelo: 'claude-fable-5-2', llevaMin: TABLAS.rejilla[k]!, llamadas: 20, fase: 'leyendo' })).estado).toBe('rango')
})

test('escribiendo el informe, el rango es corto', async () => {
  const informe = rango(estimar(entrada({ llevaMin: 40, llamadas: 160, fase: 'informe', faseDesdeMin: 0.5, vistas: ['leyendo', 'editando', 'probando', 'informe'] })))
  const probando = rango(estimar(entrada({ llevaMin: 40, llamadas: 160, fase: 'probando', faseDesdeMin: 0.5, vistas: ['leyendo', 'editando', 'probando'] })))
  expect(informe.altoMin).toBeLessThan(10)
  expect(informe.altoMin - informe.bajoMin).toBeLessThan(probando.altoMin - probando.bajoMin)
  expect(informe.medioMin).toBeLessThan(probando.medioMin)
  expect(informe.motivo).toMatch(/escribiendo el informe/)
})

test('al arrancar ya hay un rango: lo que suele durar su rol y modelo', async () => {
  const e = rango(estimar(entrada({ llevaMin: 0, llamadas: 0, fase: 'arrancando', faseDesdeMin: 0, vistas: [] })))
  expect(e.medioMin).toBeGreaterThan(5)
  expect(e.progreso).toBe(0)
  expect(e.motivo).toMatch(/corridas de implementador \(Opus 5\.5\)/)
})

test('un modelo sin corridas propias retrocede al rol y lo dice', async () => {
  const e = rango(estimar(entrada({ modelo: 'claude-modelo-del-futuro-9' })))
  expect(e.motivo).toMatch(/corridas de implementador$/)
  expect(e.confianza).not.toBe('alta')
})

test('la lista de pasos acerca el centro a lo que tardó por paso', async () => {
  const base = entrada({ llevaMin: 30, llamadas: 120, fase: 'probando', vistas: ['leyendo', 'editando', 'probando'] })
  const sin = rango(estimar(base))
  const casi = rango(estimar({ ...base, lista: { hechos: 9, total: 10 } }))
  const recien = rango(estimar({ ...base, lista: { hechos: 1, total: 10 } }))
  expect(casi.medioMin).toBeLessThan(sin.medioMin)
  expect(recien.medioMin).toBeGreaterThan(casi.medioMin)
  expect(casi.motivo).toMatch(/9 de 10 pasos/)
})

test('encontrado ya corriendo: nunca confianza alta', async () => {
  for (const llevaMin of [1, 5, 15, 40]) {
    const e = estimar(entrada({ llevaMin, llamadas: llevaMin * 4, inicioAprox: true }))
    if (e.estado === 'rango') expect(e.confianza).not.toBe('alta')
  }
})

test('es barato: 10 agentes cada 10 s durante una hora caben en unos milisegundos', async () => {
  const t0 = Date.now()
  for (let i = 0; i < 3600; i++) estimar(entrada({ llevaMin: (i % 120) / 2, llamadas: i % 300, fase: i % 2 ? 'leyendo' : 'probando' }))
  expect(Date.now() - t0).toBeLessThan(1000)
})

// ——— Reanudaciones y silencio ———

test('una reanudación se estima con sus propias tablas: mucho más corta que un encargo nuevo', async () => {
  const base = entrada({ llevaMin: 2, llamadas: 8, fase: 'leyendo', vistas: ['leyendo'] })
  const inicial = rango(estimar(base))
  const reanudada = rango(estimar({ ...base, reanudacion: true }))
  expect(reanudada.medioMin).toBeLessThan(inicial.medioMin)
  expect(reanudada.motivo).toMatch(/reanudaciones de implementador/)
  expect(inicial.motivo).toMatch(/corridas de implementador/)
})

test('una reanudación de un rol con pocas usa las de todos los agentes, con confianza baja', async () => {
  const e = estimar(entrada({ rol: 'verificador', modelo: 'claude-fable-5-2', reanudacion: true, llevaMin: 1, llamadas: 3, fase: 'leyendo' }))
  if (TABLAS.grupos['verificador#r']) return // si algún día junta las suyas, este caso ya no aplica
  const r = rango(e)
  expect(r.confianza).toBe('baja')
  expect(r.motivo).toMatch(/reanudaciones de todos los agentes/)
  // Y un rol desconocido reanudado sigue sin número.
  expect(estimar(entrada({ rol: 'un-rol-nuevo', reanudacion: true })).estado).toBe('calculando')
})

test('pasada la duración típica, un silencio largo acerca el fin donde se comprobó', async () => {
  const roles = Object.keys(TABLAS.silencio ?? {}).filter(r => !r.includes('#'))
  expect(roles.length).toBeGreaterThan(0)
  expect(roles).not.toContain('implementador')
  for (const rol of roles) {
    const g = TABLAS.grupos[rol]!
    const desde = TABLAS.silencio![rol]!.desde
    const base = entrada({ rol, modelo: undefined, llevaMin: g.tipico * 1.3, llamadas: (g.llamadas ?? 30) + 5, fase: 'leyendo', vistas: ['leyendo'] })
    const sin = rango(estimar(base))
    const con = rango(estimar({ ...base, silencioMin: desde + 1 }))
    expect([rol, con.medioMin < sin.medioMin]).toEqual([rol, true])
    expect(con.motivo).toMatch(/suele ser el cierre/)
    // Antes de la duración típica, o con una herramienta en vuelo, el silencio no cuenta.
    const temprano = estimar({ ...base, llevaMin: g.tipico * 0.5, silencioMin: desde + 1 })
    expect(temprano.motivo).not.toMatch(/el cierre/)
    expect(estimar({ ...base, silencioMin: undefined }).motivo).not.toMatch(/el cierre/)
  }
})

test('en el implementador el silencio no cambia nada (en el entrenamiento no ayudó)', async () => {
  const base = entrada({ llevaMin: 45, llamadas: 200, fase: 'probando', vistas: ['leyendo', 'editando', 'probando'] })
  expect(estimar({ ...base, silencioMin: 3 })).toEqual(estimar(base))
})

test('un agente de plugin («flota:implementador») usa las tablas de su rol sin prefijo', async () => {
  const conPrefijo = estimar(entrada({ rol: 'flota:implementador', llevaMin: 10, llamadas: 40, fase: 'editando', vistas: ['leyendo', 'editando'] }))
  const sinPrefijo = estimar(entrada({ rol: 'implementador', llevaMin: 10, llamadas: 40, fase: 'editando', vistas: ['leyendo', 'editando'] }))
  expect(conPrefijo.estado).toBe('rango')
  expect(conPrefijo).toEqual(sinPrefijo)
  // Un rol de plugin con tablas propias las conserva; uno desconocido sigue en «calculando».
  expect(estimar(entrada({ rol: 'otro-plugin:desconocido', llevaMin: 3, llamadas: 5 })).estado).toBe('calculando')
})
