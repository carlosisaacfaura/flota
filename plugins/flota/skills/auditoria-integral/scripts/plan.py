#!/usr/bin/env python3
"""Plan de la auditoría: qué dimensiones se encienden, cuántos agentes y cuánto cuesta (Paso 1).

Uso: plan.py <alcance.json> <tipo> <rapida|completa> [--forzar ux,producto] [--apagar calidad]
             [--mapa-previo] [--vendido] [--json plan.json]

Aplica la matriz de references/tipos.md. Estima el % de la cuota semanal con la referencia de
costo por agente (dato propio; se recalibra con el consumo real que registra cada auditoría en
historial-costos.md). En completa respeta el techo del 20%: si se pasa, recorta primero
particiones de bugs y después verificaciones, nunca las dimensiones críticas.
"""
import json, sys

arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
alcance = json.load(open(sys.argv[1]))
tipo, prof = sys.argv[2], sys.argv[3]
forzar = set(filter(None, (arg("--forzar") or "").split(",")))
apagar = set(filter(None, (arg("--apagar") or "").split(",")))

# % de la cuota semanal por agente (referencia 2-sep, ajustada: Opus 5.5 ≈ 20% más barato que Opus 5).
# Todos corren en xhigh desde el 29-sep: tomar como piso y corregir con historial-costos.md.
COSTO = {"investigador": 0.35, "revisor": 0.7, "auditor": 0.7, "auditor-producto": 0.7,
         "revisor-critico": 1.7, "verificador": 1.7}
AGENTE = {"bugs": "revisor", "critico": "revisor-critico", "chequeo": "investigador", "tests": "investigador",
          "operacion": "investigador", "dependencias": "investigador", "ia": "investigador",
          "privacidad": "investigador", "calidad": "auditor", "ux": "auditor", "rendimiento": "auditor",
          "producto": "auditor-producto"}
N = "n"
MATRIZ = {
    "saas-web": {"rapida": {"bugs": 1, "critico": 1, "chequeo": 1},
                 "completa": {"bugs": N, "critico": 2, "tests": 1, "operacion": 1, "dependencias": 1, "ia": "llm",
                              "privacidad": 1, "calidad": 1, "ux": "frontend", "producto": 1}},
    "bot-trading": {"rapida": {"bugs": 1, "critico": 1, "chequeo": 1},
                    "completa": {"bugs": N, "critico": 2, "tests": 1, "operacion": 1, "dependencias": 1, "ia": "llm", "calidad": 1}},
    "investigacion-trading": {"rapida": {"bugs": 1, "chequeo": 1},
                              "completa": {"bugs": N, "tests": 1, "dependencias": 1, "calidad": 1}},
    "bot-mensajeria": {"rapida": {"bugs": 1, "critico": 1, "chequeo": 1},
                       "completa": {"bugs": N, "critico": 2, "tests": 1, "operacion": 1, "dependencias": 1, "ia": 1,
                                    "privacidad": 1, "calidad": 1, "producto": "vendido"}},
    "landing": {"rapida": {"ux": 1, "chequeo": 1},
                "completa": {"ux": 1, "bugs": 1, "dependencias": 1, "producto": 1, "rendimiento": 1}},
    "herramienta-personal": {"rapida": {"bugs": 1, "chequeo": 1},
                             "completa": {"bugs": N, "tests": 1, "dependencias": 1, "ia": "llm", "calidad": 1}},
}
if tipo not in MATRIZ or prof not in ("rapida", "completa"):
    sys.exit(f"tipo o profundidad inválidos: {tipo} {prof}. Tipos: {', '.join(MATRIZ)}")

hay_llm = bool(alcance.get("ia", {}).get("total_ids") or alcance.get("ia", {}).get("archivos_con_sdk"))
n_part = len(alcance.get("particiones", []))
hay_criticos = bool(alcance.get("criticos_sugeridos"))
dims = {}
for d, v in MATRIZ[tipo][prof].items():
    if v == "llm" and not hay_llm or v == "frontend" and not alcance.get("frontend") or v == "vendido" and "--vendido" not in sys.argv:
        continue
    dims[d] = n_part if v == N else (1 if isinstance(v, str) else v)
for d in forzar:
    dims.setdefault(d, 1)
for d in apagar:
    dims.pop(d, None)
if "bugs" in dims:
    dims["bugs"] = min(dims["bugs"], n_part)
if "critico" in dims and not hay_criticos:
    dims["critico"] = 1 if prof == "completa" else dims["critico"]  # el mapa decide; en rápida puede quedar en 0
tope_ver = 1 if prof == "rapida" else 3


def estimar(dims, tope):
    reparto = {}
    if "--mapa-previo" not in sys.argv:
        reparto["investigador"] = 1
    for d, n in dims.items():
        reparto[AGENTE[d]] = reparto.get(AGENTE[d], 0) + n
    reparto["verificador"] = tope
    return round(sum(COSTO[a] * n for a, n in reparto.items()), 1), reparto


pct, reparto = estimar(dims, tope_ver)
recortes = []
TECHO = 20 if prof == "completa" else 6
while pct > TECHO:
    if dims.get("bugs", 0) > 2:
        dims["bugs"] -= 1
        recortes.append("una partición de bugs menos (queda como 'no revisada' en Cobertura)")
    elif tope_ver > 1:
        tope_ver -= 1
        recortes.append("una verificación Fable menos")
    else:
        break
    pct, reparto = estimar(dims, tope_ver)

plan = {"tipo": tipo, "profundidad": prof, "dims": dims, "tope_verificacion": tope_ver, "estimado_pct": pct,
        "reparto": reparto, "recortes": recortes, "particiones_totales": n_part,
        "pide_ok": prof == "completa" or pct > 10}
if arg("--json"):
    json.dump(plan, open(arg("--json"), "w"), ensure_ascii=False, indent=1)
print(f"Plan {tipo} · {prof}: " + " · ".join(f"{d} {n}" if n != 1 else d for d, n in dims.items()) + f" · verificación ≤{tope_ver}")
print("Agentes: " + ", ".join(f"{n}× {a}" for a, n in reparto.items()) +
      f" → ~{pct}% de la cuota semanal (Fable: {reparto.get('revisor-critico', 0) + reparto.get('verificador', 0)} agentes como máximo)")
for r in recortes:
    print("  recorte por techo:", r)
if "bugs" in dims and dims["bugs"] < n_part:
    print(f"  bugs cubre {dims['bugs']} de {n_part} particiones (las de código más antiguo primero)")
print("Pide OK al usuario antes de lanzar." if plan["pide_ok"] else "No requiere OK (rápida ≤10%).")
