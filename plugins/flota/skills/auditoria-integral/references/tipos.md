# Matriz por tipo de proyecto

El Paso 0 clasifica el proyecto (alcance.py sugiere y la sesión confirma con la nota o los docs del proyecto).
Cada tipo enciende solo las dimensiones que pagan y le pasa al revisor sus riesgos propios.
El usuario puede forzar una dimensión ("incluye UX") o apagarla.

## Dimensiones y agentes

| clave | qué mira | agente | checklists (references/checklists.md) |
|---|---|---|---|
| bugs | correctitud por partición (≤4k LOC), lo más viejo primero | revisor (Opus) | Bugs, Fallos silenciosos |
| critico | zonas de dinero, órdenes, auth/permisos, webhooks, datos personales | revisor-critico (Fable) | Seguridad, Bugs |
| chequeo | SOLO en rápida: tests + dependencias + IA + operación, versión corta | investigador (Sonnet) | Tests, Dependencias, IA en el producto, Operación |
| tests | correr la suite en la copia segura, cobertura de comportamiento, confiabilidad | investigador | Tests |
| operacion | fail-open, endpoints dev, deploy, backups, observabilidad, drift, runbooks | investigador | Operación |
| dependencias | CVEs y desactualizadas con tooling del ecosistema, deltas de stack, licencias | investigador | Dependencias |
| ia | llamadas a LLM, IDs vs modelos vigentes, SDK, prompts viejos, costo, harness | investigador | IA en el producto |
| privacidad | datos personales, retención, terceros, reglas de Meta | investigador | Privacidad y reglas de terceros |
| calidad | deuda técnica, tipos, comentarios mentirosos, duplicación | auditor (Opus) | Deuda técnica, Tipos e invariantes |
| ux | UX/UI, accesibilidad, copy, SEO (estático, sin navegador) | auditor | UX/UI, Accesibilidad, Copy (+ Robustez de landings y SEO y analítica en landings) |
| rendimiento | solo si el mapa detecta sospechas o el usuario lo pide | auditor | Rendimiento |
| producto | ≤5 ideas ancladas al objetivo de la nota y al roadmap | auditor-producto (Opus, web) | Producto |

Verificación: verificador (Fable) SOLO sobre hallazgos alta + PLAUSIBLE + (zona crítica o esfuerzo ≥ M).
Tope: 1 en rápida, 3 en completa. Las ideas de producto las juzga la sesión principal, no Fable.

## Encendido por tipo y profundidad

`n` = todas las particiones que quepan en el presupuesto. `—` = apagada. `si X` = solo si se cumple X.

| tipo | rápida | completa |
|---|---|---|
| saas-web | bugs 1 · critico 1 · chequeo | bugs n · critico 2 · tests · operacion · dependencias · ia (si hay LLM) · privacidad · calidad · ux (si frontend) · producto · rendimiento (si sospechas) |
| bot-trading | bugs 1 · critico 1 · chequeo | bugs n · critico 2 · tests · operacion · dependencias · ia (si hay LLM) · calidad |
| investigacion-trading | bugs 1 · chequeo | bugs n · tests · dependencias · calidad · critico 1 (si hay EA que opera en vivo) |
| bot-mensajeria | bugs 1 · critico 1 · chequeo | bugs n · critico 2 · tests · operacion · dependencias · ia · privacidad · calidad · producto (si se vende a terceros) |
| landing | ux · chequeo | ux · bugs 1 (si hay formularios o lógica) · dependencias · producto (copy y conversión) · rendimiento |
| herramienta-personal | bugs 1 · chequeo | bugs n · tests · dependencias · ia (si hay LLM) · calidad |

En rápida, `critico 1` solo corre si el mapa marca zonas críticas; si no, se omite.

## Riesgos por tipo (se inyectan en el prompt de bugs y critico)

### bot-trading
Dinero real: el costo de un bug es asimétrico.
- Defaults fail-open: autorizar todo si falta el secreto del webhook; `LIVE_TRADING` o `DRY_RUN` con default peligroso.
- Endpoints de desarrollo vivos en producción (inyectar señales, forzar órdenes) sin guardia de entorno.
- Idempotencia entre reinicios y entre canales: un mensaje o una edición ejecutada dos veces; estado en memoria (del bot o del EA) que se pierde entre dos pasos.
- Staleness y reconexión: fuente de señales que deja de empujar en silencio, órdenes viejas ejecutadas tarde, reconexión del EA con posiciones abiertas.
- Gestión de riesgo: riesgo por señal vs balance real, tope de posiciones concurrentes, kill switch (y si está apagado por decisión registrada), nunca abrir sin SL, lote mínimo y redondeo, slippage máximo, persecución acotada.
- Ejecución: fills parciales, rechazo de orden, hedging vs netting, zona horaria del servidor del broker y DST, whitelist de símbolos.
- Reconciliación broker ↔ base de datos tras una caída; qué pasa si el bot y el EA discrepan.
- LLM como conductor: salida no validada contra un esquema, auto-corrección de dirección (compra ↔ venta), cambio de modelo = cambio de comportamiento de trading.
- Secretos: sesión de usuario de Telegram y API keys en disco; secretos del EA visibles como inputs del terminal.

### investigacion-trading
- Look-ahead y fuga entre in-sample y out-of-sample en walk-forward; DSR calculado con el número real de configuraciones probadas.
- Modelo de costos: spread, comisión, swap; fills al precio del tick vs de la vela.
- Huecos y velas de relleno (fin de semana), timezone del broker y DST.
- EA de evaluación vs backtest propio: reglas distintas, parámetros distintos; reglas de prop firm (consistencia, drawdown diario) codificadas en el EA.
- Resultados irreproducibles: data/ ausente, rutas absolutas, datos sin hash ni versión, seeds.

### saas-web
- RLS ausente o políticas que confían en el cliente; service role key en el frontend; rutas API y server actions sin verificación de tenant o de propiedad del recurso.
- Multi-tenant: fuga entre organizaciones al listar, duplicar o exportar.
- Idempotencia de webhooks (pagos, correo) y de acciones de un clic (crear, pagar, votar, reservar).
- Dinero: CLP sin decimales, redondeo, comisiones, reembolsos parciales, estados de pago intermedios.
- Fechas de cierre y zonas horarias ("cierra a las 23:59" ¿de qué zona?).
- Rate limiting y abuso en registro, login por código y reenvíos de correo.
- Backups sin restore probado; sin error tracking; correo que cae en spam (SPF, DKIM, DMARC).

### bot-mensajeria
- Webhook sin verificación de firma (HMAC de Meta) o sin deduplicar por message id: el reintento de Meta crea dos reservas.
- Inyección de prompt desde el usuario que dispara una herramienta de escritura sin confirmación.
- Ventana de 24 h, plantillas, opt-in y opt-out de Meta; riesgo de baneo del número.
- Fuente de verdad externa (Google Calendar): carreras entre dos clientes por el mismo bloque, zona horaria del calendario.
- Sesiones que expiran, costo por conversación sin tope por usuario, datos placeholder que llegan a producción.

### landing
- Contenido above-the-fold oculto esperando una animación; reveals por scroll que dejan secciones invisibles.
- Formularios que no llegan a ningún lado, sin anti-spam o sin mensaje de éxito/error.
- Meta, OG, sitemap y robots ausentes; imágenes sin dimensiones; Core Web Vitals en móvil.
- Enlaces de conversión rotos; promesas no verificables (publicidad financiera).

### herramienta-personal
- Dinero en enteros de la unidad mínima; reparto por mayor resto sin sesgo acumulado.
- Lectura de moneda por locale ("12.990" en CLP vs USD).
- Fallback sin IA cuando la plataforma no entrega lo esperado; dependencias por CDN sin versión fija.
