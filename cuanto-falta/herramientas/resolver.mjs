// Deja que Node importe los archivos del mod tal como los importa el motor: sin extensión
// (`import ... from './contrato'`). Node 24 corre `.ts` con type stripping; solo falta la extensión.
// Uso: `import './resolver.mjs'` antes de cualquier `await import('../hooks/...')`.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (/^\.\.?\//.test(especificador) && !/\.[cm]?[jt]sx?$/.test(especificador) && contexto.parentURL?.startsWith('file:')) {
      for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
        const url = new URL(especificador + ext, contexto.parentURL)
        if (existsSync(fileURLToPath(url))) return siguiente(url.href, contexto)
      }
    }
    return siguiente(especificador, contexto)
  },
})
