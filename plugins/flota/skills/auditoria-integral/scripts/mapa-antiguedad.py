#!/usr/bin/env python3
"""Mapa de antigüedad POR LÍNEA: qué modelo de Claude escribió las líneas que siguen vivas en cada archivo.

Uso: mapa-antiguedad.py <ruta_proyecto> [--alcance alcance.json] [--json salida.json]

- Con git: `git blame --line-porcelain` por archivo → commit de cada línea viva → trailer
  "Co-Authored-By: Claude <Modelo> <versión>" normalizado (ignora sufijos como "(1M context)").
  Commits sin firma quedan como "sin firma" y se usa su fecha.
- Sin git: fecha de modificación del archivo (mtime) y etiqueta "sin historial".
Solo audita archivos de CÓDIGO del alcance (usa alcance.json si se pasa; si no, git ls-files).
Sirve para ORDENAR el trabajo (lo escrito por modelos más viejos se revisa primero), nunca para
excluir archivos: un bug en código nuevo cuesta lo mismo. Solo lee; no modifica nada.
"""
import json, os, re, subprocess, sys, time
from collections import Counter, defaultdict

raiz = os.path.abspath(sys.argv[1])
arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
alcance_json, salida = arg("--alcance"), arg("--json")
TRAILER = re.compile(r"Claude\s+(Opus|Fable|Sonnet|Haiku|Mythos)\s+([0-9]+(?:\.[0-9]+)?)", re.I)
CODIGO = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|py|mq4|mq5|mqh|sql|go|rs|java|kt|swift|rb|php|cs|vue|svelte|astro|html|css|scss|sh)$", re.I)
# Generación aproximada (mayor = más nuevo). Sirve solo para ordenar.
GEN = {"opus 4.5": 1, "opus 4.6": 2, "sonnet 4.6": 2, "opus 4.7": 3, "opus 4.8": 4, "sonnet 5": 5, "opus 5": 5,
       "fable 5": 5, "fable 5.1": 6, "mythos 5.1": 6, "opus 5.5": 7, "sonnet 5.5": 7}


def git(*a):
    return subprocess.run(["git", "-C", raiz, *a], capture_output=True, text=True).stdout


es_git = subprocess.run(["git", "-C", raiz, "rev-parse"], capture_output=True).returncode == 0
if alcance_json:
    al = json.load(open(alcance_json))
    archivos = [a for p in al.get("particiones", []) for a in p["archivos"]]
else:
    archivos = [a for a in (git("ls-files").splitlines() if es_git else []) if CODIGO.search(a)]

por_archivo = {}
if es_git:
    # 1) commit → (modelo, fecha) en una sola pasada
    info = {}
    log = git("log", "--format=%H%x1f%cs%x1f%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)%x1e")
    for reg in log.split("\x1e"):
        partes = reg.strip().split("\x1f")
        if len(partes) < 2:
            continue
        sha, fecha = partes[0], partes[1]
        m = TRAILER.search(partes[2] if len(partes) > 2 else "")
        info[sha] = (f"{m.group(1).capitalize()} {m.group(2)}" if m else "sin firma", fecha)
    # 2) blame por archivo
    for a in archivos:
        out = git("blame", "--line-porcelain", "HEAD", "--", a)
        cuenta, fechas = Counter(), []
        for linea in out.splitlines():
            if re.match(r"^[0-9a-f]{40} ", linea):
                sha = linea[:40]
                modelo, fecha = info.get(sha, ("sin firma", "?"))
                cuenta[modelo] += 1
                fechas.append(fecha)
        total = sum(cuenta.values())
        if total:
            por_archivo[a] = {"lineas": total, "modelos": {k: round(v / total, 3) for k, v in cuenta.most_common()},
                              "fecha_mediana": sorted(fechas)[len(fechas) // 2]}
else:
    for a in archivos:
        p = os.path.join(raiz, a)
        if os.path.isfile(p):
            por_archivo[a] = {"lineas": sum(1 for _ in open(p, errors="replace")), "modelos": {"sin historial": 1.0},
                              "fecha_mediana": time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(p)))}


def gen_media(modelos):
    conocidos = {m: f for m, f in modelos.items() if m.lower() in GEN}
    if not conocidos:
        return None
    return sum(GEN[m.lower()] * f for m, f in conocidos.items()) / sum(conocidos.values())


tot = Counter()
for a, d in por_archivo.items():
    for m, f in d["modelos"].items():
        tot[m] += f * d["lineas"]
lineas_tot = sum(tot.values()) or 1
print(f"Mapa de antigüedad por línea · {raiz} · {len(por_archivo)} archivos de código · {int(lineas_tot):,} líneas vivas")
print("Quién escribió las líneas vivas:")
for m, n in sorted(tot.items(), key=lambda kv: (GEN.get(kv[0].lower(), 99), kv[0])):
    print(f"  {m:<14} {n / lineas_tot:6.1%}  ({int(n):,} líneas)")

carpetas = defaultdict(lambda: [Counter(), 0, []])
for a, d in por_archivo.items():
    partes = a.split("/")[:-1]
    c = "/".join(partes[:3]) if partes and partes[0] in ("src", "app", "lib") else (partes[0] if partes else "(raíz)")
    for m, f in d["modelos"].items():
        carpetas[c][0][m] += f * d["lineas"]
    carpetas[c][1] += d["lineas"]
    carpetas[c][2].append(d["fecha_mediana"])
filas = []
for c, (cnt, n, fechas) in carpetas.items():
    mods = {m: v / n for m, v in cnt.items()}
    g = gen_media(mods)
    filas.append((g if g is not None else 99, sorted(fechas)[len(fechas) // 2], c, n, max(mods, key=mods.get)))
print("\nCarpetas de más vieja a más nueva (generación media del modelo; luego fecha):")
for g, f, c, n, dom in sorted(filas)[:20]:
    print(f"  {c:<42} {n:>6,} líneas · mayoría {dom:<12} · mediana {f}")

if salida:
    json.dump({"proyecto": raiz, "es_git": es_git, "resumen": {m: round(n / lineas_tot, 4) for m, n in tot.items()},
               "archivos": por_archivo, "orden_prioridad": [a for _, _, a in sorted(
                   ((gen_media(d["modelos"]) or 99), d["fecha_mediana"], a) for a, d in por_archivo.items())]},
              open(salida, "w"), ensure_ascii=False, indent=1)
    print(f"\nDetalle por archivo: {salida}")
