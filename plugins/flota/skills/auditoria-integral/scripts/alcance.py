#!/usr/bin/env python3
"""Alcance auditable de un proyecto (Paso 0 de /auditoria-integral). Solo lee; no ejecuta nada del proyecto.

Uso: alcance.py <ruta_proyecto> [--json salida.json] [--max-loc-particion 4000]

Calcula: archivos y LOC REALES (sin node_modules, builds, respaldos, generados, lockfiles),
LOC por carpeta, particiones para los revisores (<= ~4k LOC, agrupadas por módulo), estado git
(sha, -dirty, sin git), tipo de proyecto sugerido, frontend sí/no, comando de tests detectado,
llamadas a modelos de IA (archivo:línea e ID), archivos de secretos en disco (SOLO la ruta y si
.gitignore los cubre; jamás abre su contenido), docs de roadmap, auditoría previa y
directorios de auditoría incompletos.
"""
import json, os, re, subprocess, sys
from collections import Counter, defaultdict

raiz = os.path.abspath(sys.argv[1])
salida = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
MAX_LOC = int(sys.argv[sys.argv.index("--max-loc-particion") + 1]) if "--max-loc-particion" in sys.argv else 4000

DIRS_EXCLUIDOS = {"node_modules", ".next", ".nuxt", ".venv", "venv", "env", "__pycache__", "dist", "build", "out",
                  "coverage", ".git", ".turbo", ".vercel", ".cache", ".ua", "target", ".pytest_cache", ".mypy_cache"}
PREFIJOS_EXCLUIDOS = ("respaldo", "backup", "CLAUDE-SECURITY-", "data")
ARCH_EXCLUIDOS = re.compile(r"(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|uv\.lock|"
                            r"\.min\.(js|css)|\.map|\.(png|jpe?g|gif|webp|avif|ico|svg|mp4|mov|webm|pdf|zip|gz|woff2?|ttf|otf|"
                            r"db|sqlite3?|parquet|csv|pkl|bin|ex4|ex5|so|dylib|dll))$", re.I)
GENERADOS = re.compile(r"(database\.types\.ts|\.generated\.|_pb2\.py|next-env\.d\.ts)$")
CODIGO = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|py|mq4|mq5|mqh|sql|go|rs|java|kt|swift|rb|php|cs|vue|svelte|astro|html|css|scss|sh)$", re.I)
SECRETOS = re.compile(r"(^|/)(\.env(\..+)?|.*\.session|token\.json|credentials.*\.json|service[-_]?account.*\.json|.*\.pem|.*\.key|id_rsa|id_ed25519)$")
MODELO_IA = re.compile(r"""["'`](claude-[a-z0-9.\-]+|gpt-[a-z0-9.\-]+|o[134]-[a-z0-9\-]+|gemini-[a-z0-9.\-]+)["'`]""")
SDK_IA = re.compile(r"(from anthropic|import anthropic|@anthropic-ai/|claude_agent_sdk|from openai|import openai|\"openai\"|'openai'|google\.generativeai|@google/genai)")


def sh(*args, cwd=raiz):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout


def excluido(rel):
    partes = rel.split("/")
    if any(p in DIRS_EXCLUIDOS for p in partes[:-1]):
        return True
    if any(p.startswith(PREFIJOS_EXCLUIDOS) for p in partes[:-1]):
        return True
    if rel.startswith("docs/auditorias/"):
        return True
    return bool(ARCH_EXCLUIDOS.search(rel) or GENERADOS.search(rel))


# --- git ---
rc, top = sh("git", "rev-parse", "--show-toplevel")
es_git = rc == 0
git = {"es_git": es_git}
if es_git:
    _, sha = sh("git", "rev-parse", "--short", "HEAD")
    _, estado = sh("git", "status", "--porcelain")
    _, rama = sh("git", "rev-parse", "--abbrev-ref", "HEAD")
    _, n = sh("git", "rev-list", "--count", "HEAD")
    _, trailers = sh("git", "log", "--format=%(trailers:key=Co-Authored-By,valueonly)%x00")
    commits = [t for t in trailers.split("\x00")]
    sin_trailer = sum(1 for t in commits[:-1] if "claude" not in t.lower())
    git.update(sha=sha.strip() + ("-dirty" if estado.strip() else ""), rama=rama.strip(),
               commits=int(n.strip() or 0), commits_sin_firma_claude=sin_trailer)
    _, ls = sh("git", "ls-files")
    candidatos = [l for l in ls.splitlines() if l]
else:
    candidatos = []
    for dp, dn, fn in os.walk(raiz):
        dn[:] = [d for d in dn if d not in DIRS_EXCLUIDOS and not d.startswith(PREFIJOS_EXCLUIDOS)]
        for f in fn:
            candidatos.append(os.path.relpath(os.path.join(dp, f), raiz))

# --- secretos en disco: recorre TODO el árbol (también lo no versionado), solo nombres ---
secretos = []
for dp, dn, fn in os.walk(raiz):
    dn[:] = [d for d in dn if d not in {"node_modules", ".git", ".venv", "venv", ".next"}]
    for f in fn:
        rel = os.path.relpath(os.path.join(dp, f), raiz)
        if SECRETOS.search(rel) and not rel.endswith((".example", ".sample", ".template")):
            cubierto = None
            if es_git:
                cubierto = subprocess.run(["git", "check-ignore", "-q", rel], cwd=raiz).returncode == 0
            secretos.append({"ruta": rel, "cubierto_por_gitignore": cubierto})

# --- LOC reales, IA, frontend ---
loc_dir = Counter()
archivos = []
llm = []
sdk = set()
excluidos = Counter()
for rel in candidatos:
    if excluido(rel):
        excluidos[rel.split("/")[0]] += 1
        continue
    p = os.path.join(raiz, rel)
    if not os.path.isfile(p) or os.path.getsize(p) > 2_000_000:
        continue
    try:
        texto = open(p, encoding="utf-8", errors="strict").read()
    except (UnicodeDecodeError, OSError):
        continue
    if SECRETOS.search(rel):
        continue  # nunca contar ni leer secretos versionados; ya salen en la lista de secretos
    n = texto.count("\n") + (0 if texto.endswith("\n") or not texto else 1)
    archivos.append((rel, n, bool(CODIGO.search(rel))))
    d = "/".join(rel.split("/")[:2]) if rel.count("/") >= 2 else (rel.split("/")[0] if "/" in rel else "(raíz)")
    loc_dir[d] += n
    if CODIGO.search(rel):
        for i, linea in enumerate(texto.splitlines(), 1):
            for m in MODELO_IA.finditer(linea):
                llm.append({"archivo": rel, "linea": i, "id": m.group(1)})
            if SDK_IA.search(linea):
                sdk.add(rel)

loc_codigo = sum(n for _, n, c in archivos if c)
nombres = {a for a, _, _ in archivos}
pkg = {}
if "package.json" in nombres:
    try:
        pkg = json.load(open(os.path.join(raiz, "package.json")))
    except Exception:
        pass
deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
frontend = any(k in deps for k in ("next", "react", "vue", "svelte", "astro", "vite")) or any(a.endswith((".tsx", ".jsx", ".vue", ".svelte", ".html")) for a in nombres)

# --- tipo sugerido (heurística; la sesión lo confirma con la nota o los docs del proyecto) ---
todo = " ".join(nombres).lower()
if any(a.endswith((".mq5", ".mq4", ".mqh")) for a in nombres) or re.search(r"(mt5|metatrader|broker|backtest|ccxt|ib_insync)", todo + " ".join(deps)):
    # "en vivo" solo si hay señales de ejecución real FUERA de backtest/ y tests/ (signals.py de un backtest no cuenta)
    vivos = [a for a in nombres if not re.search(r"(^|/)(backtest|tests?|docs)/", a, re.I)]
    tipo = "bot-trading" if re.search(r"(webhook|telegram|telethon|live|ejecutor|executor|order_send|broker_client|/ea/)", " ".join(vivos).lower()) else "investigacion-trading"
elif re.search(r"(whatsapp|telegram|twilio|meta.*webhook|python-telegram-bot|telethon|aiogram)", todo + " ".join(deps)):
    tipo = "bot-mensajeria"
elif "next" in deps or "@supabase/supabase-js" in deps or re.search(r"(fastapi|django|flask|supabase/migrations)", todo):
    tipo = "saas-web"
elif frontend and loc_codigo < 3000:
    tipo = "landing"
else:
    tipo = "herramienta-personal"

# --- tests ---
tests = {"archivos_test": sum(1 for a in nombres if re.search(r"(^|/)(test_|tests?/)|\.(test|spec)\.", a))}
if pkg.get("scripts", {}).get("test"):
    tests["cmd_detectado"] = "npm test  (package.json: %s)" % pkg["scripts"]["test"]
elif any(a in nombres for a in ("pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini")) or tests["archivos_test"]:
    tests["cmd_detectado"] = "python -m pytest  (verificar que no importe config con secretos reales)"

# --- particiones para revisores: por carpeta, cortando en ~MAX_LOC ---
grupos = defaultdict(list)
ES_TEST = re.compile(r"(^|/)(tests?/|test_)|\.(test|spec)\.", re.I)
for rel, n, c in archivos:
    if not c or ES_TEST.search(rel):  # los tests los revisa su propia dimensión, no el revisor de bugs
        continue
    partes = rel.split("/")
    clave = "/".join(partes[:3]) if partes[0] in ("src", "app", "lib") and len(partes) > 3 else "/".join(partes[:2]) if len(partes) > 2 else partes[0] if len(partes) > 1 else "(raíz)"
    grupos[clave].append((rel, n))
particiones = []
actual, loc_act = [], 0
for clave in sorted(grupos):
    for rel, n in sorted(grupos[clave]):
        if loc_act + n > MAX_LOC and actual:
            particiones.append({"archivos": actual, "loc": loc_act})
            actual, loc_act = [], 0
        actual.append(rel)
        loc_act += n
if actual:
    particiones.append({"archivos": actual, "loc": loc_act})
# pista de zonas críticas por nombre de ruta (el mapa del investigador la confirma o corrige)
CRITICO = re.compile(r"(pay|pago|cobro|checkout|stripe|mercadopago|webpay|transbank|billing|factur|wallet|webhook|auth|login|"
                     r"session|sesion|password|token|rls|polic|permis|role|admin|middleware|proxy\.ts|order|orden|trade|"
                     r"risk|riesgo|engine|broker|ejecut|execut|kill|/ea/|\.mq[45]$|migrations?/)", re.I)
loc_archivo = {rel: n for rel, n, c in archivos if c and not ES_TEST.search(rel)}
criticos_sugeridos = sorted(a for a in loc_archivo if CRITICO.search(a))
for i, p in enumerate(particiones, 1):
    p["id"] = f"P{i}"
    carpetas = Counter("/".join(a.split("/")[:-1]) or "(raíz)" for a in p["archivos"])
    p["carpetas"] = [c for c, _ in carpetas.most_common(4)]

# --- contexto de producto y auditorías previas ---
roadmap = sorted(a for a in nombres if re.search(r"(^|/)(PLAN|ROADMAP|SPEC|PRD|VISION)[^/]*\.md$", a, re.I))
previa = None
dir_aud = os.path.join(raiz, "docs", "auditorias")
if os.path.isdir(dir_aud):
    informes = sorted(f for f in os.listdir(dir_aud) if f.endswith("-auditoria-integral.md"))
    previa = os.path.join("docs/auditorias", informes[-1]) if informes else None
incompletos = [d for d in os.listdir(raiz) if d.startswith("CLAUDE-SECURITY-") and not os.path.exists(os.path.join(raiz, d, "CLAUDE-SECURITY-RESULTS.md"))]

res = {
    "proyecto": raiz, "git": git, "tipo_sugerido": tipo, "frontend": frontend,
    "archivos_auditables": len(archivos), "loc_auditables": sum(n for _, n, _ in archivos), "loc_codigo": loc_codigo,
    "loc_por_carpeta": dict(loc_dir.most_common()), "excluidos_por_carpeta": dict(excluidos.most_common(12)),
    "particiones": particiones, "loc_por_archivo": loc_archivo, "criticos_sugeridos": criticos_sugeridos,
    "archivos_test": sorted(a for a, _, _ in archivos if ES_TEST.search(a)), "tests": tests,
    "ia": {"archivos_con_sdk": sorted(sdk), "ids_de_modelo": llm[:60], "total_ids": len(llm)},
    "secretos_en_disco": secretos, "roadmap_docs": roadmap, "auditoria_previa": previa,
    "auditorias_incompletas": incompletos,
    "readme": next((a for a in nombres if a.lower() in ("readme.md", "readme")), None),
    "claude_md": "CLAUDE.md" in nombres,
}
if salida:
    os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    json.dump(res, open(salida, "w"), ensure_ascii=False, indent=1)

print(f"Alcance · {raiz}")
print(f"  git: {git.get('sha', 'SIN GIT (hallazgo ALTA: sin control de versiones)') if es_git else 'SIN GIT (hallazgo ALTA: sin control de versiones)'}"
      + (f" · rama {git['rama']} · {git['commits']} commits ({git['commits_sin_firma_claude']} sin firma de Claude)" if es_git else ""))
print(f"  tipo sugerido: {tipo} · frontend: {'sí' if frontend else 'no'}")
print(f"  auditable: {res['archivos_auditables']} archivos · {res['loc_auditables']:,} LOC ({loc_codigo:,} de código) · {len(particiones)} particiones de ≤{MAX_LOC} LOC")
print(f"  zonas críticas sugeridas por ruta: {len(criticos_sugeridos)} archivos, {sum(loc_archivo[a] for a in criticos_sugeridos):,} LOC")
print(f"  tests: {tests.get('archivos_test', 0)} archivos · comando: {tests.get('cmd_detectado', '(no detectado)')}")
print(f"  IA en el producto: {len(sdk)} archivos con SDK · {len(llm)} IDs de modelo" + (f" · ej. {', '.join(sorted({x['id'] for x in llm})[:5])}" if llm else ""))
print(f"  secretos en disco (solo rutas): {len(secretos)}" + "".join(f"\n    - {s['ruta']} · .gitignore: {'sí' if s['cubierto_por_gitignore'] else 'NO' if s['cubierto_por_gitignore'] is False else '?'}" for s in secretos[:10]))
print(f"  roadmap: {', '.join(roadmap) or '-'} · auditoría previa: {previa or '-'}" + (f" · incompletas: {incompletos}" if incompletos else ""))
print("  LOC por carpeta (top 8): " + ", ".join(f"{d} {n:,}" for d, n in loc_dir.most_common(8)))
