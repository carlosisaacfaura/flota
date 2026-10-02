#!/usr/bin/env python3
"""Regenera el plugin flota desde la configuración del mantenedor (~/.claude). Uso del MANTENEDOR.

Uso: python3 mantenedor/sincronizar.py [--version X.Y.Z] [--revisar]

La fuente de verdad es la configuración personal del mantenedor. El script arma en memoria:
  1. Los agentes de AGENTES (~/.claude/agents/<nombre>.md). En la description, las menciones a otros
     agentes pasan a "flota:<agente>", que es como los nombra el plugin.
  2. La política de ~/.claude/CLAUDE.md: desde "**Prioridad del usuario" hasta el siguiente
     encabezado de nivel 1 o 2 (o hasta <!-- fin-politica-flota --> si existe). Los nombres de
     agentes llevan prefijo y se quitan las referencias personales. Va a
     skills/instalar-politica/politica.md.
  3. Los ajustes que un plugin no puede fijar solo (CLAUDE_CODE_SUBAGENT_MODEL, modelSettings,
     fallbackModel) y la CLI mínima. Van a skills/instalar-politica/ajustes.json.
  4. De /auditoria-integral: scripts/ y references/ tal cual, y el workflow como workflow de plugin
     (workflows/auditar.js, invocable como flota:auditar) con las checklists y los riesgos por tipo
     incrustados. Así los agentes no leen archivos fuera del proyecto. El SKILL.md del plugin se
     mantiene a mano.
Aplica los reemplazos privados a TODO lo generado y escanea en memoria el contenido nuevo más el
resto del repo. Si encuentra un dato personal aborta SIN escribir nada. Con --revisar solo muestra
qué cambiaría. Con --version actualiza plugin.json, marketplace.json y la marca de la política.
Nunca hace commit ni push.
"""
import difflib, json, os, re, sys

HOME = os.path.expanduser("~")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(REPO, "plugins", "flota")
AGENTES = ["verificador", "revisor", "revisor-critico", "auditor", "auditor-producto", "implementador",
           "investigador", "mecanico", "explorador"]
AUDITORIA = os.path.join(HOME, ".claude", "skills", "auditoria-integral")
REVISAR = "--revisar" in sys.argv
VERSION = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else None

# Patrones privados y reemplazos: viven FUERA del repo, porque la propia lista es privada.
PRIVADO_JSON = os.path.join(HOME, ".claude", "skills", "recalibrar-modelos", "flota-privado.json")
if not os.path.exists(PRIVADO_JSON):
    sys.exit(f"Falta {PRIVADO_JSON}: {{\"bloquear\": [regex...], \"reemplazar\": [[texto, reemplazo]...]}}")
_priv = json.load(open(PRIVADO_JSON, encoding="utf-8"))
REEMPLAZOS = [tuple(par) for par in _priv.get("reemplazar", [])]
PRIVADO = [re.escape(HOME)] + _priv.get("bloquear", []) + [re.escape(a) for a, _ in REEMPLAZOS]

NOMBRES = sorted(AGENTES, key=len, reverse=True)
RE_NOMBRE_LIBRE = re.compile(r"(?<![\w:\-])(" + "|".join(map(re.escape, NOMBRES)) + r")(?![\w\-])")
RE_NOMBRE_TICK = re.compile(r"`(" + "|".join(map(re.escape, NOMBRES)) + r")`")

pendientes = {}  # ruta absoluta -> contenido nuevo (texto)
modos = {}       # ruta -> 0o755 si debe quedar ejecutable


def plan(ruta, contenido, ejecutable=False):
    for a, b in REEMPLAZOS:
        contenido = contenido.replace(a, b)
    pendientes[ruta] = contenido
    if ejecutable:
        modos[ruta] = 0o755


# 1) Agentes
for nombre in AGENTES:
    texto = open(os.path.join(HOME, ".claude", "agents", f"{nombre}.md"), encoding="utf-8").read()
    fin = texto.index("\n---", 3)
    cabecera, cuerpo = texto[:fin], texto[fin:]
    cabecera = re.sub(r"^(description:.*)$", lambda m: RE_NOMBRE_LIBRE.sub(r"flota:\1", m.group(1)), cabecera,
                      flags=re.MULTILINE)
    plan(os.path.join(PLUGIN, "agents", f"{nombre}.md"), cabecera + cuerpo)
sobrantes = sorted(set(f[:-3] for f in os.listdir(os.path.join(HOME, ".claude", "agents")) if f.endswith(".md"))
                   - set(AGENTES))
if sobrantes:
    print(f"Aviso: agentes tuyos que NO van en flota (agrégalos a AGENTES si corresponde): {', '.join(sobrantes)}")

# 2) Política
md = open(os.path.join(HOME, ".claude", "CLAUDE.md"), encoding="utf-8").read()
ini = md.index("**Prioridad del usuario")
resto = md[ini:]
corte = [m.start() for m in (re.search(r"^#{1,2} ", resto, re.MULTILINE), re.search(r"<!-- fin-politica-flota -->", resto)) if m]
cuerpo = resto[:min(corte)] if corte else resto
for viejo, nuevo in [
    ("El hook `~/.claude/hooks/no-bajar-modelo.py`", "El hook de flota"),
    ("`/auditoria-integral`", "`/flota:auditoria-integral`"),
    ("`/recalibrar-modelos`", "recalibración que publica el mantenedor de flota"),
    ("/recalibrar-modelos", "la recalibración del mantenedor de flota"),
]:
    cuerpo = cuerpo.replace(viejo, nuevo)
cuerpo = RE_NOMBRE_TICK.sub(r"`flota:\1`", cuerpo).rstrip() + "\n"
if "~/.claude/hooks" in cuerpo or "~/.claude/skills" in cuerpo:
    sys.exit("La política todavía nombra rutas personales de ~/.claude (hooks o skills): agrega el reemplazo en el paso 2.")
version = VERSION or json.load(open(os.path.join(PLUGIN, ".claude-plugin", "plugin.json")))["version"]
plan(os.path.join(PLUGIN, "skills", "instalar-politica", "politica.md"), f"""<!-- flota:politica:inicio v{version} -->
## Política de modelos (flota v{version})

Instalada por el plugin **flota**. La mantiene su autor: cada vez que sale un modelo nuevo,
recalibra con evidencia (benchmarks públicos verificados y pruebas propias a ciegas) y publica una
versión nueva. Si instalaste flota desde la app, la versión nueva llega sola con Sync
automatically (o con Check for updates en Customize → Plugins). Si la instalaste desde la
terminal: `claude plugin marketplace update flota` y `claude plugin update flota@flota`. En los
dos casos, después corre `/flota:instalar-politica`. No edites este bloque: se reemplaza completo
en cada actualización. Tus propias instrucciones van fuera de los marcadores.

{cuerpo}<!-- flota:politica:fin -->
""")

# 3) Ajustes que el plugin no puede fijar solo
s = json.load(open(os.path.join(HOME, ".claude", "settings.json"), encoding="utf-8"))
cli = None
estado = os.path.join(HOME, ".claude", "skills", "recalibrar-modelos", "estado-alias.txt")
if os.path.exists(estado):
    m = re.search(r"^# cli:\s*(\S+)", open(estado, encoding="utf-8").read(), re.MULTILINE)
    cli = m.group(1) if m else None
ajustes = {"version": version, "cli_minima": cli,
           "env": {"CLAUDE_CODE_SUBAGENT_MODEL": (s.get("env") or {}).get("CLAUDE_CODE_SUBAGENT_MODEL")},
           "modelSettings": s.get("modelSettings", {}), "fallbackModel": s.get("fallbackModel")}
plan(os.path.join(PLUGIN, "skills", "instalar-politica", "ajustes.json"), json.dumps(ajustes, ensure_ascii=False, indent=2) + "\n")

# 4) Auditoría integral: scripts/ y references/ tal cual; el workflow como workflow de plugin
for sub in ("scripts", "references"):
    for dp, _, fn in os.walk(os.path.join(AUDITORIA, sub)):
        if "__pycache__" in dp:
            continue
        for f in fn:
            if f.endswith((".pyc", ".bak")) or f.startswith("."):
                continue
            src = os.path.join(dp, f)
            plan(os.path.join(PLUGIN, "skills", "auditoria-integral", os.path.relpath(src, AUDITORIA)),
                 open(src, encoding="utf-8").read(), ejecutable=os.access(src, os.X_OK))


def secciones(texto, nivel):
    """{título: cuerpo} de los encabezados de ese nivel; corta en un encabezado de nivel superior."""
    marca = "#" * nivel + " "
    out, actual, lineas = {}, None, []
    for linea in texto.splitlines():
        es_superior = any(linea.startswith("#" * n + " ") for n in range(1, nivel))
        if linea.startswith(marca) or es_superior:
            if actual:
                out[actual] = "\n".join(lineas).strip()
            actual, lineas = (linea[len(marca):].strip(), []) if linea.startswith(marca) else (None, [])
        elif actual and not linea.startswith("_Fuente:"):
            lineas.append(linea)
    if actual:
        out[actual] = "\n".join(lineas).strip()
    return out


refs = {
    "checklists": secciones(open(os.path.join(AUDITORIA, "references", "checklists.md"), encoding="utf-8").read(), 2),
    "tipos": secciones(open(os.path.join(AUDITORIA, "references", "tipos.md"), encoding="utf-8").read(), 3),
}
wf = open(os.path.join(AUDITORIA, "workflows", "auditar.js"), encoding="utf-8").read()
for viejo, nuevo in [("  name: 'auditoria-integral',", "  name: 'auditar',"),
                     ("const REFS_EMBEBIDAS = null", "const REFS_EMBEBIDAS = " + json.dumps(refs, ensure_ascii=False))]:
    if wf.count(viejo) != 1:
        sys.exit(f"auditar.js cambió de forma: no encuentro '{viejo[:40]}'. Ajusta sincronizar.py.")
    wf = wf.replace(viejo, nuevo)
plan(os.path.join(PLUGIN, "workflows", "auditar.js"), wf)

# 5) Versión
if VERSION:
    for ruta in (os.path.join(PLUGIN, ".claude-plugin", "plugin.json"), os.path.join(REPO, ".claude-plugin", "marketplace.json")):
        d = json.load(open(ruta, encoding="utf-8"))
        for p in d.get("plugins", [d]):
            if p.get("name") == "flota":
                p["version"] = VERSION
        plan(ruta, json.dumps(d, ensure_ascii=False, indent=2) + "\n")

# 6) Escaneo de privacidad EN MEMORIA: contenido nuevo + resto del repo. Si falla, no se escribe nada.
contenidos = dict(pendientes)
for dp, dn, fn in os.walk(REPO):
    dn[:] = [d for d in dn if d not in (".git", "__pycache__")]
    for f in fn:
        ruta = os.path.join(dp, f)
        if ruta not in contenidos:
            try:
                contenidos[ruta] = open(ruta, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                pass
fugas = []
for ruta, texto in contenidos.items():
    for patron in PRIVADO:
        for m in re.finditer(patron, texto):
            fugas.append(f"{os.path.relpath(ruta, REPO)}:{texto.count(chr(10), 0, m.start()) + 1}: '{m.group(0)}'")
if fugas:
    print("DATOS PERSONALES en el plugin. No se escribió nada. Corrige el origen o agrega un reemplazo:\n  "
          + "\n  ".join(fugas[:40]))
    sys.exit(1)

# 7) Escribir (o mostrar) solo lo que cambió
cambios = []
for ruta, contenido in pendientes.items():
    viejo = open(ruta, encoding="utf-8").read() if os.path.exists(ruta) else None
    permiso_ok = ruta not in modos or (viejo is not None and os.access(ruta, os.X_OK))
    if viejo == contenido and permiso_ok:
        continue
    cambios.append(os.path.relpath(ruta, REPO))
    if REVISAR:
        print("\n".join(list(difflib.unified_diff((viejo or "").splitlines(), contenido.splitlines(), lineterm="", n=1))[:30]))
        continue
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    open(ruta, "w", encoding="utf-8").write(contenido)
    if ruta in modos:
        os.chmod(ruta, modos[ruta])
obsoleto = os.path.join(PLUGIN, "skills", "auditoria-integral", "workflows")
if os.path.isdir(obsoleto):
    print(f"Aviso: {os.path.relpath(obsoleto, REPO)} quedó obsoleto (el workflow vive ahora en plugins/flota/workflows/); bórralo.")
print(("Cambiaría: " if REVISAR else "Actualizado: ") + (", ".join(cambios) if cambios else "nada (ya estaba al día)"))
if cambios and not REVISAR:
    print(f"Siguiente: agrega la versión {version} al CHANGELOG.md, valida con `claude plugin validate {REPO}` "
          "y, con OK, haz commit, push y tag.")
