// En qué está un agente según su última llamada a herramienta, y la lista de pasos que lleva.
// `clasificar` es la ÚNICA fuente de verdad de las fases: la usa el mod en vivo y la evaluación offline
// (`herramientas/`), así lo que se mide es exactamente lo que corre.
import type { EstadoLista, Fase, ListaPasos } from './contrato'

// ——— Herramientas que no son Bash ———

const LEER = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TaskGet', 'TaskList'])
const EDITAR = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Artifact'])
const WEB = new Set(['WebSearch', 'WebFetch'])
const DELEGAR = new Set(['Agent', 'Task', 'Workflow'])
/** Entregan la respuesta final del agente (los de un workflow terminan con StructuredOutput). */
const ENTREGAR = new Set(['StructuredOutput', 'SubagentHandback', 'ReportFindings'])

/** Fase de una llamada; `null` cuando la llamada no dice nada de la fase (se mantiene la anterior). */
export function clasificar(tool: string, input: unknown): Fase | null {
  if (typeof tool !== 'string' || !tool) return null
  if (tool === 'Bash' || tool === 'bash' || tool === 'bash_placeholder') {
    const comando = (input as { command?: unknown } | null | undefined)?.command
    return typeof comando === 'string' ? clasificarBash(comando) : null
  }
  if (LEER.has(tool)) return 'leyendo'
  if (EDITAR.has(tool)) return 'editando'
  if (WEB.has(tool)) return 'investigando'
  if (DELEGAR.has(tool)) return 'delegando'
  if (ENTREGAR.has(tool)) return 'informe'
  if (tool.startsWith('mcp__')) return clasificarMcp(tool)
  return null
}

function clasificarMcp(tool: string): Fase | null {
  const t = tool.toLowerCase()
  const metodo = t.slice(t.lastIndexOf('__') + 2)
  if (/xcodebuild/.test(t)) {
    if (/(^|_)(build|test|clean|coverage)/.test(metodo)) return 'probando'
    return 'navegando'
  }
  if (/claude_browser|claude-in-chrome|playwright|claude_preview|computer-use|ios_simulator|simulator|puppeteer|chrome/.test(t))
    return 'navegando'
  if (/ccd_turn|ccd_session|scan_secrets/.test(t)) return null
  if (/fetch|firecrawl|exa_|brave|tavily|perplexity|context7|search_web|web_search|websearch|scrape/.test(t)) return 'investigando'
  if (/(^|_|-)(create|update|delete|write|send|move|upload|insert|apply|set|label|trash|edit|replace|restore|duplicate)/.test(metodo))
    return 'editando'
  if (/(^|_|-)(get|list|search|fetch|read|query|find|view|describe|show|download)/.test(metodo)) return 'leyendo'
  return null
}

// ——— Bash ———

const PRIORIDAD: Fase[] = ['commit', 'probando', 'editando', 'navegando', 'investigando', 'leyendo']

function masFuerte(a: Fase | null, b: Fase | null): Fase | null {
  if (!a) return b
  if (!b) return a
  return PRIORIDAD.indexOf(a) <= PRIORIDAD.indexOf(b) ? a : b
}

type Segmento = { palabras: string[]; escribe: string[]; cuerpo?: string }

/**
 * Un comando de Bash puede encadenar varios (`cd x && pnpm test | tail`): se clasifica cada uno por su
 * comando y gana el más cercano al final del trabajo (commit > pruebas > edición > pantalla > web > lectura).
 * El texto de los heredocs y de las comillas nunca se lee como comando (un `grep pytest` no corre pruebas).
 */
export function clasificarBash(comando: string): Fase | null {
  let fase: Fase | null = null
  for (const s of segmentos(comando)) fase = masFuerte(fase, segmento(s, 0))
  return fase
}

/** Separa un comando en comandos simples, con sus redirecciones de salida y el heredoc que reciben. */
function segmentos(texto: string): Segmento[] {
  const { sinCuerpos, cuerpos } = sacarHeredocs(texto.replace(/\\\r?\n/g, ' '))
  const salida: Segmento[] = []
  let palabras: string[] = []
  let escribe: string[] = []
  let cuerpo: string | undefined
  let actual = ''
  let hay = false // la palabra en curso existe aunque esté vacía ('')
  let redir = false
  const cerrarPalabra = () => {
    if (!hay) return
    const h = /^\u0000H(\d+)\u0000$/.exec(actual)
    if (h) cuerpo = cuerpos[Number(h[1])] ?? ''
    else if (redir) {
      escribe.push(actual)
      redir = false
    } else palabras.push(actual)
    actual = ''
    hay = false
  }
  const cerrarSegmento = () => {
    cerrarPalabra()
    if (palabras.length || escribe.length || cuerpo !== undefined) salida.push({ palabras, escribe, cuerpo })
    palabras = []
    escribe = []
    cuerpo = undefined
    redir = false
  }
  const n = sinCuerpos.length
  for (let i = 0; i < n; i++) {
    const c = sinCuerpos[i]!
    if (c === "'") {
      const fin = sinCuerpos.indexOf("'", i + 1)
      const hasta = fin < 0 ? n : fin
      actual += sinCuerpos.slice(i + 1, hasta)
      hay = true
      i = hasta
    } else if (c === '"') {
      let j = i + 1
      while (j < n && sinCuerpos[j] !== '"') {
        if (sinCuerpos[j] === '\\' && j + 1 < n) j++
        j++
      }
      actual += sinCuerpos.slice(i + 1, j).replace(/\\(["\\$`])/g, '$1')
      hay = true
      i = j
    } else if (c === '\\' && i + 1 < n) {
      actual += sinCuerpos[i + 1]
      hay = true
      i++
    } else if (c === '$' && sinCuerpos[i + 1] === '(') {
      // Sustitución de comando: queda dentro de la palabra (su contenido no es un comando aparte).
      let prof = 0
      let j = i + 1
      for (; j < n; j++) {
        if (sinCuerpos[j] === '(') prof++
        else if (sinCuerpos[j] === ')' && --prof === 0) break
      }
      actual += sinCuerpos.slice(i, j + 1)
      hay = true
      i = j
    } else if (c === '`') {
      const fin = sinCuerpos.indexOf('`', i + 1)
      const hasta = fin < 0 ? n : fin
      actual += sinCuerpos.slice(i, hasta + 1)
      hay = true
      i = hasta
    } else if (c === '#' && !hay) {
      const fin = sinCuerpos.indexOf('\n', i)
      i = fin < 0 ? n : fin - 1
    } else if (c === ' ' || c === '\t') {
      cerrarPalabra()
    } else if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}') {
      if (c === '&' && sinCuerpos[i + 1] === '>') {
        // &> archivo: salida a un archivo
        cerrarPalabra()
        redir = true
        i++
        if (sinCuerpos[i + 1] === '>') i++
        continue
      }
      if ((c === '{' || c === '}') && hay) {
        actual += c
        continue
      }
      cerrarSegmento()
    } else if (c === '>' || c === '<') {
      // Descriptor delante (2>, 1>): no es una palabra.
      if (/^\d$/.test(actual)) {
        actual = ''
        hay = false
      }
      cerrarPalabra()
      let j = i
      while (sinCuerpos[j + 1] === c) j++
      if (sinCuerpos[j + 1] === '&' || sinCuerpos[j + 1] === '(') {
        // 2>&1, >&2, <(…): duplicación o sustitución, no un archivo
        i = j + 1
        if (sinCuerpos[i] === '&') while (i + 1 < n && /[\d-]/.test(sinCuerpos[i + 1]!)) i++
        continue
      }
      if (c === '>') redir = true
      else {
        // < archivo: se lee, no se escribe. La palabra siguiente es la entrada: se descarta.
        let k = j + 1
        while (k < n && (sinCuerpos[k] === ' ' || sinCuerpos[k] === '\t')) k++
        while (k < n && !/[\s;|&()<>]/.test(sinCuerpos[k]!)) k++
        j = k - 1
      }
      i = j
    } else {
      actual += c
      hay = true
    }
  }
  cerrarSegmento()
  return salida
}

/** Saca los cuerpos de los heredocs (`<<'EOF' … EOF`) y deja en su lugar una marca que apunta al cuerpo. */
function sacarHeredocs(texto: string): { sinCuerpos: string; cuerpos: string[] } {
  if (!texto.includes('<<')) return { sinCuerpos: texto, cuerpos: [] }
  const lineas = texto.split('\n')
  const fuera: string[] = []
  const cuerpos: string[] = []
  for (let i = 0; i < lineas.length; i++) {
    const pendientes: { fin: string; idx: number; tabs: boolean }[] = []
    const linea = lineas[i]!.replace(/<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g, (m, menos: string, _q, fin: string, pos: number, s: string) => {
      if (s[pos - 1] === '<' || s[pos + 2] === '<') return m // <<< (here-string)
      const idx = cuerpos.length
      cuerpos.push('')
      pendientes.push({ fin, idx, tabs: menos === '-' })
      return ` \u0000H${idx}\u0000 `
    })
    fuera.push(linea)
    for (const p of pendientes) {
      const cuerpo: string[] = []
      i++
      for (; i < lineas.length; i++) {
        const l = lineas[i]!
        if ((p.tabs ? l.replace(/^\t+/, '') : l).trim() === p.fin) break
        cuerpo.push(l)
      }
      cuerpos[p.idx] = cuerpo.join('\n')
    }
  }
  return { sinCuerpos: fuera.join('\n'), cuerpos }
}

const NULOS = new Set([
  'cd', 'pushd', 'popd', 'export', 'unset', 'set', 'source', '.', 'true', 'false', ':', 'sleep', 'wait', 'echo',
  'printf', 'date', 'which', 'type', 'pwd', 'kill', 'pkill', 'killall', 'ps', 'pgrep', 'lsof', 'exit', 'return',
  'trap', 'read', 'test', '[', '[[', 'local', 'declare', 'alias', 'mktemp', 'basename', 'dirname', 'realpath',
  'seq', 'tput', 'say', 'afplay', 'pbcopy', 'pbpaste', 'tmux', 'mkdir', 'touch', 'for', 'case', 'esac', 'select',
  'function', 'shift', 'let', 'eval', 'hash', 'ulimit', 'umask', 'history', 'clear', 'reset', 'id', 'whoami',
  'hostname', 'uname', 'sw_vers', 'top', 'launchctl', 'security', 'disown', 'jobs', 'fg', 'bg', 'chflags',
])

const LECTURA = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'ls', 'tree', 'wc', 'stat',
  'file', 'du', 'df', 'diff', 'cmp', 'colordiff', 'jq', 'yq', 'sort', 'uniq', 'cut', 'tr', 'xxd', 'od', 'hexdump',
  'strings', 'pdftotext', 'pdfinfo', 'md5', 'md5sum', 'shasum', 'sha256sum', 'readlink', 'column', 'nl', 'paste',
  'comm', 'rev', 'fold', 'fd', 'locate', 'mdfind', 'mdls', 'otool', 'nm', 'ffprobe', 'exiftool', 'identify',
  'mediainfo', 'look', 'zcat', 'bat', 'zipinfo', 'lipo', 'dwarfdump', 'ldd', 'printenv', 'tac', 'expand', 'iconv', 'textutil', 'plutil', 'defaults', 'log', 'pdfgrep', 'csvlook',
])

const EDICION = new Set(['mv', 'rm', 'cp', 'ln', 'chmod', 'patch', 'rsync', 'rmdir', 'unlink', 'truncate', 'install', 'dd', 'ditto'])

const PRUEBAS = new Set([
  'pytest', 'py.test', 'mypy', 'ruff', 'flake8', 'pylint', 'black', 'isort', 'tox', 'nox', 'vitest', 'jest', 'mocha',
  'ava', 'tap', 'playwright', 'cypress', 'tsc', 'eslint', 'prettier', 'biome', 'oxlint', 'xcodebuild', 'swiftc',
  'swiftlint', 'swiftformat', 'make', 'gmake', 'cmake', 'ninja', 'gradle', 'gradlew', 'mvn', 'rspec', 'phpunit',
  'go', 'cargo', 'rustc', 'gcc', 'clang', 'g++', 'clang++', 'javac', 'just', 'ffmpeg', 'deno', 'tsx', 'ts-node',
  'vite', 'next', 'remotion', 'webpack', 'esbuild', 'rollup', 'turbo', 'nx', 'lerna', 'pyright', 'shellcheck',
  'hadolint', 'actionlint', 'markdownlint', 'stylelint', 'htmlhint', 'xmllint', 'codesign', 'spctl', 'xctrace',
  'instruments', 'ab', 'wrk', 'hey', 'k6', 'locust', 'lighthouse', 'pa11y', 'axe', 'unittest', 'coverage', 'nyc',
  'c8', 'stryker', 'bats', 'shunit2', 'dotnet', 'flutter', 'dart', 'kotlinc', 'scalac', 'sbt', 'elixir', 'mix',
  'ruby', 'rake', 'bundle', 'node-gyp', 'electron', 'electron-builder', 'wrangler', 'miniflare', 'expo', 'eas',
  'react-native', 'pod', 'fastlane', 'xcbeautify', 'xcpretty', 'tuist', 'xcodegen', 'swift',
])

const NAVEGAR = new Set(['screencapture', 'osascript', 'cliclick', 'open', 'agent-browser', 'chrome', 'chromium', 'safari'])

const WEB_CMD = new Set(['curl', 'wget', 'http', 'https', 'httpie', 'xh', 'yt-dlp', 'youtube-dl', 'whois', 'dig', 'nslookup', 'host', 'lynx', 'w3m', 'aria2c'])

/** Gestores de paquetes y de proyectos: su subcomando dice si instala, lee o corre un script. */
const GESTORES = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'uv', 'uvx', 'poetry', 'pipx', 'pdm', 'hatch', 'rye', 'corepack'])
const CON_VALOR = new Set(['-C', '--dir', '--filter', '-F', '--prefix', '--workspace', '--cwd', '-p', '--package', '--project', '--directory', '--python', '--with', '--from', '-w'])
const INSTALAR = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'ci', 'link', 'unlink', 'init', 'create', 'setup', 'store', 'config', 'cache', 'login', 'logout', 'whoami', 'version', 'venv', 'sync', 'lock', 'pip', 'self', 'prune', 'dedupe', 'rebuild', 'approve-builds', 'import', 'patch', 'patch-commit', 'set', 'get', 'tool'])
const LEER_GESTOR = new Set(['ls', 'list', 'view', 'info', 'show', 'why', 'outdated', 'audit', 'licenses', 'search', 'explain', 'fund', 'doctor', 'tree', 'help'])

const PREFIJOS = new Set(['time', 'exec', 'command', 'builtin', 'nohup', 'sudo', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'noglob', 'unbuffer'])

function base(palabra: string): string {
  const b = palabra.slice(palabra.lastIndexOf('/') + 1)
  return b.toLowerCase()
}

/** Quita lo que va delante del comando real: variables, `time`, `timeout 600`, `env`, `xargs -n1`, `nice -n 5`… */
function quitarPrefijos(p: string[]): string[] {
  let i = 0
  while (i < p.length) {
    const w = p[i]!
    const b = base(w)
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w)) i++
    else if (PREFIJOS.has(w)) i++
    else if (b === 'env') {
      i++
      while (i < p.length && (p[i]!.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(p[i]!))) i += p[i] === '-u' ? 2 : 1
    } else if (b === 'timeout' || b === 'gtimeout') {
      i++
      while (i < p.length && p[i]!.startsWith('-')) i += /^-(s|k|-signal|-kill-after)$/.test(p[i]!) ? 2 : 1
      i++ // la duración
    } else if (b === 'nice') {
      i++
      if (p[i] === '-n') i += 2
      else if (p[i]?.startsWith('-')) i++
    } else if (b === 'xargs') {
      i++
      while (i < p.length && p[i]!.startsWith('-')) i += /^-[IJLnPdsE]$/.test(p[i]!) ? 2 : 1
    } else if (b === 'caffeinate' || b === 'stdbuf') {
      i++
      while (i < p.length && p[i]!.startsWith('-')) i++
    } else if (b === 'script' && p[i + 1] === '-q') {
      i += 3
    } else break
  }
  return p.slice(i)
}

function esLocal(url: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[\w.-]+\.localhost|[\w.-]+\.test)(:\d+)?(\/|$)/i.test(url)
}

function segmento(s: Segmento, prof: number): Fase | null {
  const p = quitarPrefijos(s.palabras)
  if (!p.length) return s.escribe.some(escribeArchivo) ? 'editando' : null
  const cmd = base(p[0]!)
  const args = p.slice(1)
  const escribe = s.escribe.some(escribeArchivo)

  if (/^python(\d+(\.\d+)?)?$/.test(cmd) || cmd === 'py' || cmd === 'pypy3') return python(args, s.cuerpo)
  if (cmd === 'node' || cmd === 'nodejs') return node(args, s.cuerpo)
  if (cmd === 'git') return git(args)
  if (cmd === 'gh') return gh(args)
  if (GESTORES.has(cmd)) return gestor(cmd, args, s, prof)
  if ((cmd === 'bash' || cmd === 'sh' || cmd === 'zsh' || cmd === 'dash') && prof < 3) {
    const c = args.indexOf('-c')
    if (c >= 0 && args[c + 1] !== undefined) return clasificarBashProf(args[c + 1]!, prof + 1)
    if (s.cuerpo !== undefined && !args.some(a => !a.startsWith('-'))) return clasificarBashProf(s.cuerpo, prof + 1)
    return args.some(a => !a.startsWith('-')) ? 'probando' : null
  }
  if (cmd === 'cat' || cmd === 'echo' || cmd === 'printf' || cmd === 'tee') {
    if (escribe || (cmd === 'tee' && args.some(a => !a.startsWith('-') && escribeArchivo(a)))) return 'editando'
    if (cmd === 'cat') return s.cuerpo !== undefined ? null : 'leyendo'
    return null
  }
  if (cmd === 'sed') return args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place')) ? 'editando' : 'leyendo'
  if (cmd === 'perl') return args.some(a => /^-[a-zA-Z]*i/.test(a)) ? 'editando' : 'leyendo'
  if (cmd === 'awk' || cmd === 'gawk') return args.some((a, k) => a === '-i' && args[k + 1] === 'inplace') ? 'editando' : 'leyendo'
  if (cmd === 'find') return args.some(a => a === '-delete') || args.some((a, k) => (a === '-exec' || a === '-execdir') && /^(rm|mv|sed|perl|chmod)$/.test(base(args[k + 1] ?? ''))) ? 'editando' : 'leyendo'
  if (cmd === 'sqlite3' || cmd === 'psql' || cmd === 'mysql' || cmd === 'duckdb') {
    const sql = [...args, s.cuerpo ?? ''].join(' ')
    return /\b(insert|update|delete|create|drop|alter|replace|vacuum)\b/i.test(sql) ? 'editando' : 'leyendo'
  }
  if (cmd === 'defaults') return /^(write|delete|import)$/.test(args[0] ?? '') ? 'editando' : 'leyendo'
  if (cmd === 'plutil') return args.some(a => /^-(replace|insert|remove|convert)$/.test(a)) ? 'editando' : 'leyendo'
  if (cmd === 'sips') return args.some(a => /^-(z|Z|r|c|s|-resample|-rotate|-crop|-out|-setProperty|-pad)/.test(a)) ? 'editando' : 'leyendo'
  if (cmd === 'magick' || cmd === 'convert' || cmd === 'mogrify' || cmd === 'pngquant' || cmd === 'optipng' || cmd === 'cwebp') return 'editando'
  if (cmd === 'tar') return args.some(a => /^-?[a-z]*t/.test(a) && !/c|x/.test(a)) ? 'leyendo' : 'editando'
  if (cmd === 'unzip') return args.includes('-l') ? 'leyendo' : 'editando'
  if (cmd === 'zip' || cmd === 'gzip' || cmd === 'gunzip') return 'editando'
  if (cmd === 'xcrun') return xcrun(args, s, prof)
  if (cmd === 'docker' || cmd === 'podman') return /^(ps|logs|inspect|images|stats|top|version|info|history)$/.test(args.find(a => !a.startsWith('-')) ?? '') ? 'leyendo' : 'probando'
  if (cmd === 'claude') return /^(plugin|plugins)$/.test(args[0] ?? '') && /^(test|validate)$/.test(args[1] ?? '') ? 'probando' : null
  if (cmd === 'swift') return 'probando'
  if (cmd === 'open') return args.length ? 'navegando' : null
  if (cmd === 'railway' || cmd === 'vercel' || cmd === 'fly' || cmd === 'flyctl' || cmd === 'heroku' || cmd === 'netlify')
    return /^(logs|status|list|ls|inspect|env)$/.test(args[0] ?? '') ? 'leyendo' : null
  if (cmd === 'supabase') return /^(test)$/.test(args[0] ?? '') ? 'probando' : null
  if (WEB_CMD.has(cmd)) {
    const url = args.find(a => /^(https?:\/\/|localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(a)) ?? args.find(a => !a.startsWith('-') && /\w\.\w/.test(a))
    if (!url) return cmd === 'curl' || cmd === 'wget' ? 'investigando' : 'investigando'
    return esLocal(url) ? 'probando' : 'investigando'
  }
  if (/google chrome|chromium/i.test(p[0]!) || cmd === 'google-chrome' || cmd === 'chrome-headless-shell') return 'navegando'
  if (NAVEGAR.has(cmd)) return 'navegando'
  if (PRUEBAS.has(cmd)) return cmd === 'go' || cmd === 'cargo' || cmd === 'dotnet' ? (/^(mod|get|install|add|fmt|env|version|clean|doc|tree|search|metadata)$/.test(args[0] ?? '') ? null : 'probando') : 'probando'
  if (EDICION.has(cmd)) return 'editando'
  if (LECTURA.has(cmd)) return escribe && (cmd === 'jq' || cmd === 'sort' || cmd === 'awk') ? 'editando' : 'leyendo'
  if (NULOS.has(cmd)) return escribe ? 'editando' : null
  // Un programa del proyecto (./scripts/x.sh, bin/algo, ./node_modules/.bin/vitest): correrlo es probar.
  if (/^\.{0,2}\//.test(p[0]!) || p[0]!.includes('/') || /\.(sh|py|js|mjs|ts|rb|pl|swift)$/.test(cmd)) {
    const b = cmd.replace(/\.(sh|py|js|mjs|ts)$/, '')
    if (PRUEBAS.has(b)) return 'probando'
    if (/^python(\d+(\.\d+)?)?$/.test(b)) return python(args, s.cuerpo)
    if (b === 'node') return node(args, s.cuerpo)
    if (GESTORES.has(b)) return gestor(b, args, s, prof)
    if (LECTURA.has(b)) return 'leyendo'
    return 'probando'
  }
  return escribe ? 'editando' : null
}

function clasificarBashProf(texto: string, prof: number): Fase | null {
  let fase: Fase | null = null
  for (const s of segmentos(texto)) fase = masFuerte(fase, segmento(s, prof))
  return fase
}

function escribeArchivo(destino: string): boolean {
  return !!destino && destino !== '/dev/null' && destino !== '/dev/stderr' && destino !== '/dev/stdout' && !/^&?\d$/.test(destino)
}

const PY_WEB = /\b(urllib|requests\.(get|post|Session)|httpx|urlopen|aiohttp|http\.client|feedparser|yt_dlp|bs4|BeautifulSoup)\b/
const PY_ESCRIBE =
  /open\([^)]*,\s*(mode\s*=\s*)?['"](w|a|x|r\+|w\+|wb|ab|xb)['"]|\.write\(|write_text\(|write_bytes\(|json\.dump\(|pickle\.dump\(|shutil\.(copy|move|rmtree)|os\.(remove|rename|replace|unlink|rmdir)\(|\.unlink\(|\.rename\(|\.to_csv\(|\.to_json\(|\.to_parquet\(|\.savefig\(|\.save\(|yaml\.dump\(|toml\.dump\(|\.mkdir\(|os\.makedirs\(|executescript\(|\.commit\(\)/
const PY_PRUEBA = /\b(subprocess|os\.system)\b[\s\S]{0,200}\b(pytest|vitest|jest|xcodebuild|pnpm|npm|tsc|swift|make|cargo)\b|\bunittest\.main\(|\bpytest\.main\(/
const PY_NAVEGA = /\bplaywright\b|\bselenium\b|\bpyautogui\b/

function analizarPython(cuerpo: string): Fase {
  if (PY_NAVEGA.test(cuerpo)) return 'navegando'
  if (PY_WEB.test(cuerpo)) return 'investigando'
  if (PY_PRUEBA.test(cuerpo)) return 'probando'
  if (PY_ESCRIBE.test(cuerpo)) return 'editando'
  return 'leyendo'
}

function python(args: string[], cuerpo: string | undefined): Fase | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-') && args[i] !== '-' && args[i] !== '-c' && args[i] !== '-m') i += /^-[WX]$/.test(args[i]!) ? 2 : 1
  const a = args[i]
  if (a === '-c') return analizarPython(args[i + 1] ?? '')
  if (a === '-m') {
    const mod = args[i + 1] ?? ''
    if (/^(pytest|unittest|mypy|ruff|pyflakes|flake8|pylint|black|isort|compileall|py_compile|doctest|coverage|tox|nox|pyright|build|http\.server)$/.test(mod)) return 'probando'
    if (/^(json\.tool|tokenize|dis|pydoc|site|zipfile|tarfile|pstats)$/.test(mod)) return 'leyendo'
    if (/^(pip|venv|ensurepip|pipx|virtualenv)$/.test(mod)) return null
    return 'probando'
  }
  if (a === undefined || a === '-') return cuerpo !== undefined ? analizarPython(cuerpo) : 'leyendo'
  return 'probando'
}

const NODE_ESCRIBE = /writeFileSync|appendFileSync|writeFile\(|fs\.write|rmSync|renameSync|unlinkSync|copyFileSync|cpSync|rm\(|mkdirSync/
const NODE_WEB = /fetch\(\s*['"`]https?:\/\/(?!localhost|127\.|0\.0\.0\.0)|https\.get\(|axios|got\(/
const NODE_LOCAL = /fetch\(\s*['"`]https?:\/\/(localhost|127\.|0\.0\.0\.0)|http\.get\(/

function analizarNode(cuerpo: string): Fase {
  if (/\bplaywright\b|\bpuppeteer\b/.test(cuerpo)) return 'navegando'
  if (NODE_WEB.test(cuerpo)) return 'investigando'
  if (NODE_LOCAL.test(cuerpo)) return 'probando'
  if (NODE_ESCRIBE.test(cuerpo)) return 'editando'
  return 'leyendo'
}

function node(args: string[], cuerpo: string | undefined): Fase | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') return analizarNode(args[i + 1] ?? '')
    if (a === '--test' || a === '--check' || a === '-c' || a.startsWith('--test-')) return 'probando'
    if (a === '-') return cuerpo !== undefined ? analizarNode(cuerpo) : 'leyendo'
    if (a === '-r' || a === '--require' || a === '--import' || a === '--loader') {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    return 'probando' // node archivo.js: corre el programa
  }
  return cuerpo !== undefined ? analizarNode(cuerpo) : null
}

function git(args: string[]): Fase | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) i += /^-(C|c)$|^--(git-dir|work-tree|namespace)$/.test(args[i]!) ? 2 : 1
  const sub = args[i] ?? ''
  const resto = args.slice(i + 1)
  if (/^(add|commit|push|tag|merge|rebase|cherry-pick|revert|am)$/.test(sub)) {
    if (sub === 'tag' && (resto.length === 0 || resto.includes('-l') || resto.includes('--list'))) return 'leyendo'
    return 'commit'
  }
  if (/^(diff|log|show|status|blame|grep|ls-files|ls-tree|rev-parse|rev-list|describe|shortlog|reflog|cat-file|name-rev|merge-base|for-each-ref|whatchanged|check-ignore|count-objects|annotate|range-diff|cherry|show-ref|fetch|remote|var|help|version)$/.test(sub))
    return 'leyendo'
  if (sub === 'branch') return resto.some(a => /^-(d|D|m|M|c|C|-delete|-move|-copy)$/.test(a)) ? null : 'leyendo'
  if (sub === 'config') return resto.some(a => /^--(get|list|get-all|get-regexp)$|^-l$/.test(a)) ? 'leyendo' : null
  if (sub === 'stash') return /^(list|show)$/.test(resto[0] ?? '') ? 'leyendo' : 'editando'
  if (sub === 'worktree') return /^(list)$/.test(resto[0] ?? '') ? 'leyendo' : null
  if (/^(apply|restore|reset|clean|mv|rm|checkout)$/.test(sub)) {
    if (sub === 'checkout' && !resto.includes('--') && resto.length <= 2 && !resto.some(a => /\.\w+$|\//.test(a))) return null // cambiar de rama
    return 'editando'
  }
  return null
}

function gh(args: string[]): Fase | null {
  const [a = '', b = ''] = args
  if (a === 'pr' && /^(create|merge)$/.test(b)) return 'commit'
  if (a === 'release' && b === 'create') return 'commit'
  if (a === 'run' || (a === 'pr' && b === 'checks')) return 'probando'
  if (a === 'api' || /^(view|list|diff|status|checks)$/.test(b) || a === 'search' || a === 'browse') return 'leyendo'
  return null
}

function gestor(cmd: string, args: string[], s: Segmento, prof: number): Fase | null {
  let i = 0
  const saltar = () => {
    while (i < args.length && args[i]!.startsWith('-')) i += CON_VALOR.has(args[i]!) ? 2 : 1
  }
  saltar()
  let sub = args[i] ?? ''
  // npx/bunx/uvx/pnpx (y `pipx run`): lo primero es la herramienta que se corre.
  const directo = cmd === 'npx' || cmd === 'pnpx' || cmd === 'bunx' || cmd === 'uvx' || (cmd === 'pipx' && sub === 'run')
  if (cmd === 'pipx' && sub === 'run') {
    i++
    saltar()
    sub = args[i] ?? ''
  }
  if (!directo) {
    if (cmd === 'corepack') return null
    if (INSTALAR.has(sub)) return null
    if (LEER_GESTOR.has(sub)) return 'leyendo'
    const deScripts = cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn' || cmd === 'bun'
    // pnpm exec vitest, bun x tsc, uv run pytest, poetry run python x.py (en npm/pnpm, `run` es un script del proyecto)
    if (/^(exec|dlx|x)$/.test(sub) || (sub === 'run' && !deScripts)) {
      i++
      saltar()
      if (i >= args.length) return null
      return prof < 3 ? segmento({ palabras: args.slice(i), escribe: s.escribe, cuerpo: s.cuerpo }, prof + 1) : 'probando'
    }
    if (sub === 'publish' || sub === 'pack' || sub === 'deploy') return null
    return sub ? 'probando' : null // test, build, typecheck, lint, dev, o cualquier script del proyecto
  }
  if (!sub) return null
  if (prof < 3) {
    const r = segmento({ palabras: args.slice(i), escribe: s.escribe, cuerpo: s.cuerpo }, prof + 1)
    return r ?? 'probando'
  }
  return 'probando'
}

function xcrun(args: string[], s: Segmento, prof: number): Fase | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '--sdk' || args[i] === '-sdk' ? 2 : 1
  const t = args[i] ?? ''
  if (t === 'simctl') {
    const sub = args[i + 1] ?? ''
    if (/^(list|getenv|get_app_container|listapps|appinfo)$/.test(sub)) return 'leyendo'
    return 'navegando'
  }
  if (/^(notarytool|stapler|altool|devicectl)$/.test(t)) return null
  if (!t) return null
  return prof < 3 ? (segmento({ palabras: args.slice(i), escribe: s.escribe, cuerpo: s.cuerpo }, prof + 1) ?? 'probando') : 'probando'
}

// ——— La lista de pasos del propio agente ———

const ESTADO_TAREA: Record<string, EstadoLista[string]['estado']> = {
  pending: 'pendiente',
  in_progress: 'en-curso',
  completed: 'hecha',
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** El id que Claude Code le dio a una tarea nueva: en el resultado estructurado o en su texto ("Task #3 created"). */
function idCreado(resultado: unknown): string | undefined {
  if (resultado == null) return undefined
  if (typeof resultado === 'string') return /Task #?(\w+)\s+created/i.exec(resultado)?.[1] ?? /#(\d+)/.exec(resultado)?.[1]
  if (Array.isArray(resultado)) {
    for (const b of resultado) {
      const id = idCreado(typeof b === 'string' ? b : (b as { text?: unknown })?.text)
      if (id) return id
    }
    return undefined
  }
  if (typeof resultado === 'object') {
    const r = resultado as { task?: { id?: unknown }; id?: unknown; text?: unknown; content?: unknown; result?: unknown }
    const id = r.task?.id ?? r.id
    if (typeof id === 'string' || typeof id === 'number') return String(id)
    return idCreado(r.text) ?? idCreado(r.content) ?? idCreado(r.result)
  }
  return undefined
}

function fallo(resultado: unknown): boolean {
  return !!resultado && typeof resultado === 'object' && !Array.isArray(resultado) && (resultado as { success?: unknown }).success === false
}

/**
 * La lista de pasos después de una llamada. TodoWrite reemplaza la lista entera; TaskCreate agrega un paso
 * (su id viene en el resultado) y TaskUpdate le cambia el estado o el título, o lo borra. Cualquier otra
 * herramienta deja la lista como estaba. Nunca muta `previa`.
 */
export function actualizarLista(previa: EstadoLista | undefined, tool: string, input: unknown, resultado: unknown): EstadoLista | undefined {
  const e = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(e.todos) ? e.todos : undefined
    if (!todos) return previa
    const lista: EstadoLista = {}
    todos.forEach((t, k) => {
      const x = (t ?? {}) as Record<string, unknown>
      lista[String(k + 1)] = {
        titulo: texto(x.content) ?? texto(x.activeForm) ?? `paso ${k + 1}`,
        estado: ESTADO_TAREA[String(x.status)] ?? 'pendiente',
      }
    })
    return Object.keys(lista).length ? lista : undefined
  }
  if (tool === 'TaskCreate') {
    if (fallo(resultado)) return previa
    const actual = previa ?? {}
    let id = idCreado(resultado)
    if (!id) {
      // Sin id legible: el siguiente número libre (Claude Code las numera 1, 2, 3…).
      let n = Object.keys(actual).length + 1
      while (actual[String(n)]) n++
      id = String(n)
    }
    return { ...actual, [id]: { titulo: texto(e.subject) ?? texto(e.activeForm) ?? `paso ${id}`, estado: 'pendiente' } }
  }
  if (tool === 'TaskUpdate') {
    if (fallo(resultado)) return previa
    const id = e.taskId === undefined || e.taskId === null ? undefined : String(e.taskId)
    if (!id) return previa
    const actual = previa ?? {}
    if (e.status === 'deleted') {
      if (!actual[id]) return previa
      const { [id]: _borrado, ...resto } = actual
      return Object.keys(resto).length ? resto : undefined
    }
    const antes = actual[id]
    const estado = ESTADO_TAREA[String(e.status)] ?? antes?.estado ?? 'pendiente'
    const titulo = texto(e.subject) ?? antes?.titulo ?? texto(e.activeForm) ?? `paso ${id}`
    if (antes && antes.estado === estado && antes.titulo === titulo) return previa
    return { ...actual, [id]: { titulo, estado } }
  }
  return previa
}

/** Hechos sobre total, y el título del paso en curso. Sin lista (o vacía), undefined. */
export function resumirLista(lista: EstadoLista | undefined): ListaPasos | undefined {
  if (!lista) return undefined
  const items = Object.values(lista)
  if (!items.length) return undefined
  const actual = items.find(i => i.estado === 'en-curso')?.titulo
  const r: ListaPasos = { hechos: items.filter(i => i.estado === 'hecha').length, total: items.length }
  if (actual) r.actual = actual
  return r
}
