// Toma las capturas de la vista previa (herramientas/vista/salida/) y las deja en capturas/.
// Es la función que se le pasa a Playwright (herramienta browser_run_code_unsafe, pegada en `code`:
// la herramienta solo lee archivos del proyecto abierto).
//
// Antes:
//   1. deno run --config herramientas/vista/deno.json --allow-read --allow-write herramientas/vista/generar.ts
//   2. Servir por http una carpeta con dos enlaces: `salida` → herramientas/vista/salida y
//      `fuente` → la carpeta de fuentes de la app de Claude (Anthropic Sans; sin ella se ve con la del sistema):
//        mkdir web && cd web && ln -s <repo>/herramientas/vista/salida salida \
//          && ln -s /Applications/Claude.app/Contents/Resources/fonts fuente && python3 -m http.server 8765
async page => {
  const BASE = 'http://127.0.0.1:8765/salida/'
  // Ruta absoluta de capturas/ (aquí no hay `process`): cámbiala por la de tu copia del mod.
  const DESTINO = '<carpeta del mod>/herramientas/vista/capturas/'
  const TODOS = ['reposo', 'reposoSinDatos', 'uno', 'dos', 'cinco', 'flujo', 'nueve']
  const CON_ANCHOS = ['dos', 'cinco', 'flujo', 'nueve']
  const hechas = []
  const abrir = async nombre => {
    await page.goto(`${BASE}${nombre}.html`)
    await page.evaluate(() => document.fonts.ready)
    // El doble de pixeles, para que se lean bien en una pantalla retina.
    await page.evaluate(() => void (document.body.style.zoom = '2'))
  }
  await page.setViewportSize({ width: 1400, height: 1000 })
  for (const fixture of TODOS) {
    for (const ancho of CON_ANCHOS.includes(fixture) ? [320, 400, 480] : [400]) {
      await abrir(`${fixture}-${ancho}`)
      await page.locator('.lamina').screenshot({ path: `${DESTINO}${fixture}-${ancho}.png` })
      hechas.push(`${fixture}-${ancho}.png`)
      // Solo el panel, sin rótulos, en cada tema: para mostrar una imagen y decidir sí o no.
      if (ancho === 400 && ['cinco', 'flujo', 'nueve'].includes(fixture)) {
        for (const tema of ['claro', 'oscuro']) {
          await page.locator(`#${tema} .panel .marco`).screenshot({ path: `${DESTINO}panel-${fixture}-${tema}.png` })
          hechas.push(`panel-${fixture}-${tema}.png`)
        }
      }
    }
  }
  for (const fixture of ['reposo', 'uno', 'cinco', 'flujo', 'nueve']) {
    await abrir(`${fixture}-terminal`)
    await page.locator('.lamina').screenshot({ path: `${DESTINO}${fixture}-terminal.png` })
    hechas.push(`${fixture}-terminal.png`)
  }
  return hechas
}
