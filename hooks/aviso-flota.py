#!/usr/bin/env python3
"""SessionStart: avisa si falta terminar la instalación de flota o si hay una política nueva.

Revisa tres cosas, sin ejecutar nada (solo lee archivos):
  1. Que el bloque de la política esté en ~/.claude/CLAUDE.md y en la misma versión que el plugin.
  2. Que settings.json tenga CLAUDE_CODE_SUBAGENT_MODEL (lo que un plugin no puede fijar solo).
  3. Que la CLI instalada sea al menos la mínima que asumen los alias de la política.
Si todo está bien, no imprime nada. Ante cualquier error, silencio.
"""
import json
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLAUDE_DIR = os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude")


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0"))


def main():
    version = json.load(open(os.path.join(RAIZ, ".claude-plugin", "plugin.json"), encoding="utf-8"))["version"]
    ajustes = json.load(open(os.path.join(RAIZ, "skills", "instalar-politica", "ajustes.json"), encoding="utf-8"))
    avisos = []

    md = os.path.join(CLAUDE_DIR, "CLAUDE.md")
    texto = open(md, encoding="utf-8").read() if os.path.isfile(md) else ""
    m = re.search(r"<!-- flota:politica:inicio v([\d.]+) -->", texto)
    if not m:
        avisos.append("la política de modelos de flota todavía no está en tu CLAUDE.md")
    elif version_tuple(m.group(1)) < version_tuple(version):
        avisos.append(f"hay una política nueva de flota (v{version}; tienes la v{m.group(1)})")

    try:
        s = json.load(open(os.path.join(CLAUDE_DIR, "settings.json"), encoding="utf-8"))
    except Exception:
        s = {}
    if not (s.get("env") or {}).get("CLAUDE_CODE_SUBAGENT_MODEL"):
        avisos.append("falta el modelo por defecto de los subagentes sin tipo en settings.json")

    minima = ajustes.get("cli_minima")
    versiones = []
    for base in ("~/Library/Application Support/Claude/claude-code", "~/.local/share/claude/versions"):
        base = os.path.expanduser(base)
        if os.path.isdir(base):
            versiones += [d for d in os.listdir(base) if re.fullmatch(r"\d+(\.\d+)+", d)]
    cli_vieja = None
    if minima and versiones:
        actual = max(versiones, key=version_tuple)
        if version_tuple(actual) < version_tuple(minima):
            cli_vieja = f"la CLI de Claude Code instalada es la {actual} y flota asume la {minima} o posterior (con una más vieja, los alias pueden apuntar a modelos anteriores): actualízala con `claude update`"

    if not avisos and not cli_vieja:
        return
    partes = []
    if avisos:
        partes.append("Flota: " + "; ".join(avisos) + ". Corre /flota:instalar-politica para dejarlo al día.")
    if cli_vieja:
        partes.append("Flota: " + cli_vieja + ".")
    mensaje = " ".join(partes)
    print(json.dumps({
        "systemMessage": mensaje,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": mensaje + " Menciónaselo al usuario en una línea al empezar; no lo corras sin que lo pida.",
        },
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
